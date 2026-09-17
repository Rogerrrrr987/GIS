/**
 * GeoCanvas GIS Tool - Geoprocessing Toolbox Manager (ArcGIS style)
 *
 * Implements:
 * 1. Buffer (緩衝區)
 * 2. Clip (裁切)
 * 3. Intersect (相交)
 * 4. Merge (合併圖層)
 * 5. Dissolve (融合)
 * 6. Save Selected as Layer (選取另存圖層)
 *
 * All operations output NEW layers by default, never mutate source data in-place,
 * support cancellation, progress tracking, per-feature error isolation, and undo.
 */

(function () {
  'use strict';

  // Helper: check bounding box intersection [minX, minY, maxX, maxY]
  function bboxesIntersect(b1, b2) {
    if (!b1 || !b2) return false;
    return !(b1[2] < b2[0] || b1[0] > b2[2] || b1[3] < b2[1] || b1[1] > b2[3]);
  }

  // Helper: compute bbox from GeoJSON geometry
  function getBBox(geom) {
    if (typeof turf !== 'undefined' && turf.bbox) {
      try {
        return turf.bbox({ type: 'Feature', geometry: geom });
      } catch (_) {}
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const scan = (coords) => {
      if (Array.isArray(coords) && typeof coords[0] === 'number') {
        const [x, y] = coords;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else if (Array.isArray(coords)) {
        coords.forEach(scan);
      }
    };
    scan(geom.coordinates);
    return isFinite(minX) ? [minX, minY, maxX, maxY] : [0, 0, 0, 0];
  }

  // Normalize geometry category
  function getGeometryFamily(type) {
    const t = String(type || '').toLowerCase();
    if (t.includes('point')) return 'Point';
    if (t.includes('line')) return 'Line';
    if (t.includes('polygon')) return 'Polygon';
    return 'Unknown';
  }

  // Convert Leaflet or GeoJSON feature into standard GeoJSON Feature
  function toGeoJSONFeature(item) {
    if (!item) return null;
    if (item.type === 'Feature' && item.geometry) {
      return JSON.parse(JSON.stringify(item));
    }
    if (typeof L !== 'undefined' && L.Circle && item instanceof L.Circle) {
      const latlng = item.getLatLng();
      const radiusKm = item.getRadius() / 1000;
      if (typeof turf !== 'undefined' && turf.circle) {
        const c = turf.circle([latlng.lng, latlng.lat], radiusKm, { steps: 64, units: 'kilometers' });
        c.properties = { ...(item.featureProps || {}) };
        return c;
      }
    }
    if (item.toGeoJSON) {
      const feat = item.toGeoJSON();
      feat.properties = { ...(item.featureProps || {}), ...(feat.properties || {}) };
      return feat;
    }
    return null;
  }

  const GeoprocessingManager = {
    map: null,
    panel: null,
    isActive: false,
    isBusy: false,
    abortRequested: false,
    currentTool: 'buffer',
    sessionState: {},

    init(map) {
      this.map = map;
      this.panel = document.getElementById('geoprocessing-panel');

      if (this.panel && typeof L !== 'undefined' && L.DomEvent) {
        L.DomEvent.disableClickPropagation(this.panel);
        L.DomEvent.disableScrollPropagation(this.panel);
      }

      this.bindUi();
    },

    bindUi() {
      document.getElementById('btn-geoprocessing')?.addEventListener('click', () => this.toggle());
      document.getElementById('btn-gp-close')?.addEventListener('click', () => this.close());
      document.getElementById('btn-gp-cancel')?.addEventListener('click', () => this.cancel());
      document.getElementById('btn-gp-run')?.addEventListener('click', () => this.runCurrentTool());

      // Tool Selector Tabs
      const toolTabs = document.querySelectorAll('.gp-tool-tab');
      toolTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
          const tool = e.currentTarget.dataset.tool;
          if (tool) this.selectTool(tool);
        });
      });

      // Save Selected Shortcuts
      document.getElementById('btn-table-save-selected')?.addEventListener('click', () => this.promptSaveSelected());
    },

    open(toolName = 'buffer') {
      if (!this.panel) this.panel = document.getElementById('geoprocessing-panel');
      if (!this.panel) return;

      // Mutual exclusivity coordinated via PanelManager with fallback for headless testing
      if (typeof PanelManager !== 'undefined') {
        PanelManager.onPanelOpened('geoprocessing');
      } else {
        if (typeof RoutingManager !== 'undefined' && RoutingManager.isActive) {
          RoutingManager.toggle();
        }
        if (typeof TGOSAddressManager !== 'undefined' && TGOSAddressManager.isActive) {
          TGOSAddressManager.close();
        }
      }

      this.isActive = true;
      this.panel.style.display = 'block';
      document.getElementById('btn-geoprocessing')?.classList.add('active');

      this.selectTool(toolName);
    },

    close() {
      if (!this.panel) return;
      if (this.isBusy) {
        this.abortRequested = true;
      }
      this.isActive = false;
      this.panel.style.display = 'none';
      document.getElementById('btn-geoprocessing')?.classList.remove('active');
      if (typeof PanelManager !== 'undefined') {
        PanelManager.onPanelClosed('geoprocessing');
      }
    },

    toggle(toolName = 'buffer') {
      if (this.isActive) {
        this.close();
      } else {
        this.open(toolName);
      }
    },

    selectTool(toolName) {
      this.currentTool = toolName;

      // Update Tab Headers
      document.querySelectorAll('.gp-tool-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tool === toolName);
      });

      // Update Form Sections
      document.querySelectorAll('.gp-tool-form').forEach(form => {
        form.classList.toggle('active', form.dataset.tool === toolName);
      });

      this.populateLayerDropdowns();
      this.hideProgress();
      this.clearErrorSummary();
    },

    populateLayerDropdowns() {
      const layers = typeof LayerManager !== 'undefined' ? (LayerManager.layers || []) : [];

      // Helper to populate a <select>
      const fillSelect = (selectId, filterFamily = null, allowAll = false) => {
        const select = document.getElementById(selectId);
        if (!select) return;
        const currentVal = select.value;
        select.replaceChildren();

        if (allowAll) {
          select.add(new Option('全部圖層', '__ALL__'));
        }

        layers.forEach(layer => {
          const family = getGeometryFamily(layer.geometryType);
          if (!filterFamily || filterFamily === 'any' || family === filterFamily) {
            const count = layer.featureGroup ? layer.featureGroup.getLayers().length : 0;
            const opt = new Option(`${layer.name} (${layer.geometryType}, ${count} 筆)`, layer.id);
            select.add(opt);
          }
        });

        if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
          select.value = currentVal;
        } else if (select.options.length > 0 && !select.value) {
          select.selectedIndex = 0;
        }
      };

      fillSelect('gp-buffer-layer');
      fillSelect('gp-clip-source');
      fillSelect('gp-clip-mask', 'Polygon'); // Clip mask must be Polygon
      fillSelect('gp-intersect-a');
      fillSelect('gp-intersect-b');
      fillSelect('gp-dissolve-layer', 'Polygon');

      // Populate Merge Checkboxes
      const mergeContainer = document.getElementById('gp-merge-layers-list');
      if (mergeContainer) {
        mergeContainer.replaceChildren();
        if (layers.length === 0) {
          const emptySpan = document.createElement('span');
          emptySpan.className = 'gp-empty-hint';
          emptySpan.textContent = '目前工作區內無可用圖層';
          mergeContainer.appendChild(emptySpan);
        } else {
          layers.forEach(layer => {
            const count = layer.featureGroup ? layer.featureGroup.getLayers().length : 0;
            const label = document.createElement('label');
            label.className = 'gp-checkbox-item';

            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.value = layer.id;
            chk.dataset.family = getGeometryFamily(layer.geometryType);

            const text = document.createTextNode(` ${layer.name} [${layer.geometryType}] (${count} 筆)`);
            label.append(chk, text);
            mergeContainer.appendChild(label);
          });
        }
      }

      // Populate Dissolve Field options for current dissolve layer
      this.updateDissolveFieldOptions();
      document.getElementById('gp-dissolve-layer')?.addEventListener('change', () => this.updateDissolveFieldOptions());
    },

    updateDissolveFieldOptions() {
      const layerSelect = document.getElementById('gp-dissolve-layer');
      const fieldSelect = document.getElementById('gp-dissolve-field');
      if (!layerSelect || !fieldSelect) return;

      fieldSelect.replaceChildren();
      fieldSelect.add(new Option('(全部融合，不分組)', '__ALL__'));

      const layerId = layerSelect.value;
      const layer = typeof LayerManager !== 'undefined' ? LayerManager.getLayer(layerId) : null;
      if (!layer || !layer.featureGroup) return;

      const fields = new Set();
      layer.featureGroup.eachLayer(f => {
        const props = f.featureProps || {};
        Object.keys(props).forEach(k => {
          if (!['id', 'style', '_measure'].includes(k)) fields.add(k);
        });
      });

      fields.forEach(field => {
        fieldSelect.add(new Option(field, field));
      });
    },

    cancel() {
      this.abortRequested = true;
      const progressText = document.getElementById('gp-progress-text');
      if (progressText) progressText.textContent = '正在取消運算...';
    },

    showProgress(percent, message) {
      const container = document.getElementById('gp-progress-container');
      const bar = document.getElementById('gp-progress-bar');
      const text = document.getElementById('gp-progress-text');
      if (container) container.style.display = 'block';
      if (bar) bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
      if (text) text.textContent = message;
    },

    hideProgress() {
      const container = document.getElementById('gp-progress-container');
      if (container) container.style.display = 'none';
      this.isBusy = false;
      this.abortRequested = false;
      const runBtn = document.getElementById('btn-gp-run');
      if (runBtn) runBtn.disabled = false;
    },

    setErrorSummary(summary) {
      const box = document.getElementById('gp-error-summary');
      if (!box) return;

      box.replaceChildren();
      box.style.display = 'block';

      const titleEl = document.createElement('h4');
      titleEl.textContent = summary.title || '處理結果摘要';
      box.appendChild(titleEl);

      const statsEl = document.createElement('p');
      statsEl.className = 'gp-summary-stats';
      statsEl.textContent = `成功: ${summary.successCount ?? 0} 筆 | 略過: ${summary.skipCount ?? 0} 筆 | 失敗: ${summary.failCount ?? 0} 筆`;
      box.appendChild(statsEl);

      if (summary.errors && summary.errors.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'gp-error-list';
        summary.errors.slice(0, 20).forEach(err => {
          const li = document.createElement('li');
          li.textContent = typeof err === 'string' ? err : `${err.id || '圖元'}: ${err.message}`;
          ul.appendChild(li);
        });
        if (summary.errors.length > 20) {
          const more = document.createElement('li');
          more.textContent = `...以及其他 ${summary.errors.length - 20} 個異常項目`;
          ul.appendChild(more);
        }
        box.appendChild(ul);
      }
    },

    clearErrorSummary() {
      const box = document.getElementById('gp-error-summary');
      if (box) {
        box.replaceChildren();
        box.style.display = 'none';
      }
    },

    // =========================================================================
    // UNIFIED OUTPUT LAYER FACTORY
    // =========================================================================

    createOutputLayer({ name, geometryType = 'any', features = [], sourceTool = 'Geoprocessing', parameters = {} }) {
      const cleanName = String(name || '').trim();
      if (!cleanName) {
        throw new Error('輸出圖層名稱不可為空');
      }

      if (!features || features.length === 0) {
        if (typeof App !== 'undefined') {
          App.showToast('未產生任何空間圖元，不建立空圖層', 'info');
        }
        return null;
      }

      // Auto deduplicate name: "Name (2)", "Name (3)"
      let uniqueName = cleanName;
      if (typeof LayerManager !== 'undefined' && LayerManager.layers) {
        const existingNames = new Set(LayerManager.layers.map(l => l.name));
        if (existingNames.has(uniqueName)) {
          let counter = 2;
          while (existingNames.has(`${cleanName} (${counter})`)) {
            counter++;
          }
          uniqueName = `${cleanName} (${counter})`;
        }
      }

      // Safe normalized geometryType
      const safeGeomType = ['Point', 'Line', 'Polygon'].includes(geometryType) ? geometryType : 'any';

      // Create new layer via LayerManager
      const newLayer = LayerManager.createLayer(uniqueName, safeGeomType);

      // Add features into newLayer.featureGroup
      const addedLeafletLayers = [];

      features.forEach((feat, idx) => {
        const geojson = toGeoJSONFeature(feat);
        if (!geojson || !geojson.geometry) return;

        const geom = geojson.geometry;
        const props = { ...(geojson.properties || {}) };

        // Ensure unique feature identity
        const featureId = (typeof DrawManager !== 'undefined' && DrawManager.generateFeatureId)
          ? DrawManager.generateFeatureId()
          : `feat_${Date.now()}_${idx}`;
        props.id = featureId;

        if (!props.name) {
          props.name = `${uniqueName} #${idx + 1}`;
        }

        let lLayer = null;
        const style = props.style || (typeof DrawManager !== 'undefined' ? DrawManager.currentStyle : {});

        if (geom.type === 'Point') {
          const [lng, lat] = geom.coordinates;
          lLayer = L.marker([lat, lng]);
          if (typeof DrawManager !== 'undefined' && DrawManager.createSymbolIcon && style.symbol) {
            lLayer.setIcon(DrawManager.createSymbolIcon(style.symbol, style.color || '#2563eb'));
          }
        } else if (geom.type === 'MultiPoint') {
          // Represent MultiPoint as FeatureGroup of markers or GeoJSON layer
          lLayer = L.geoJSON(geojson);
        } else if (geom.type === 'LineString') {
          const latlngs = geom.coordinates.map(c => [c[1], c[0]]);
          lLayer = L.polyline(latlngs, {
            color: style.color || '#2563eb',
            weight: style.weight || 3,
            opacity: style.opacity || 0.9
          });
        } else if (geom.type === 'MultiLineString') {
          const multiLatlngs = geom.coordinates.map(line => line.map(c => [c[1], c[0]]));
          lLayer = L.polyline(multiLatlngs, {
            color: style.color || '#2563eb',
            weight: style.weight || 3,
            opacity: style.opacity || 0.9
          });
        } else if (geom.type === 'Polygon') {
          const rings = geom.coordinates.map(ring => ring.map(c => [c[1], c[0]]));
          lLayer = L.polygon(rings, {
            color: style.color || '#2563eb',
            fillColor: style.fillColor || '#3b82f6',
            weight: style.weight !== undefined ? style.weight : 2,
            opacity: style.opacity || 0.9,
            fillOpacity: style.fillOpacity !== undefined ? style.fillOpacity : 0.35
          });
        } else if (geom.type === 'MultiPolygon') {
          const multiRings = geom.coordinates.map(poly => poly.map(ring => ring.map(c => [c[1], c[0]])));
          lLayer = L.polygon(multiRings, {
            color: style.color || '#2563eb',
            fillColor: style.fillColor || '#3b82f6',
            weight: style.weight !== undefined ? style.weight : 2,
            opacity: style.opacity || 0.9,
            fillOpacity: style.fillOpacity !== undefined ? style.fillOpacity : 0.35
          });
        } else {
          lLayer = L.geoJSON(geojson);
        }

        if (lLayer) {
          lLayer.featureProps = props;
          lLayer.gisLayerId = newLayer.id;
          if (typeof DrawManager !== 'undefined') {
            DrawManager.ensureFeatureIdentity(lLayer, featureId);
            DrawManager.setupLayerInteractions(lLayer);
          }
          newLayer.featureGroup.addLayer(lLayer);
          addedLeafletLayers.push(lLayer);
        }
      });

      // Synchronize UI
      if (typeof LayerManager !== 'undefined' && LayerManager.render) {
        LayerManager.render();
      }
      if (typeof App !== 'undefined' && App.updateStats) {
        App.updateStats();
      }
      if (typeof TableManager !== 'undefined' && TableManager.render) {
        TableManager.render();
      }

      // Zoom to created layer bounds
      if (newLayer.featureGroup && typeof App !== 'undefined' && App.map) {
        try {
          const bounds = newLayer.featureGroup.getBounds();
          if (bounds && bounds.isValid && bounds.isValid()) {
            App.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
          }
        } catch (_) {}
      }

      // Record Undo Snapshot
      if (typeof SafetyManager !== 'undefined' && SafetyManager.commitChange) {
        SafetyManager.commitChange(`空間處理 [${sourceTool}]: 新增「${newLayer.name}」`);
      }

      if (typeof App !== 'undefined') {
        App.showToast(`已建立圖層「${newLayer.name}」(${addedLeafletLayers.length} 個圖元)`, 'success');
      }

      return newLayer;
    },

    // =========================================================================
    // CORE GEOPROCESSING ALGORITHMS
    // =========================================================================

    /**
     * Tool 1: Buffer (緩衝區)
     */
    async runBuffer(options = {}) {
      const {
        layerId = document.getElementById('gp-buffer-layer')?.value,
        selectedOnly = document.getElementById('gp-buffer-selected-only')?.checked,
        distance = parseFloat(document.getElementById('gp-buffer-dist')?.value),
        unit = document.getElementById('gp-buffer-unit')?.value || 'meters',
        dissolve = document.getElementById('gp-buffer-dissolve')?.checked,
        outputName = document.getElementById('gp-buffer-output-name')?.value || '緩衝區'
      } = options;

      if (isNaN(distance) || distance <= 0) {
        throw new Error('緩衝距離必須大於 0');
      }

      const layer = typeof LayerManager !== 'undefined' ? LayerManager.getLayer(layerId) : null;
      let sourceFeatures = [];

      if (selectedOnly) {
        sourceFeatures = typeof SelectionManager !== 'undefined' ? SelectionManager.getSelectedFeatures() : [];
        if (layerId && layer) {
          sourceFeatures = sourceFeatures.filter(f => f.gisLayerId === layerId);
        }
      } else if (layer && layer.featureGroup) {
        sourceFeatures = layer.featureGroup.getLayers();
      }

      if (sourceFeatures.length === 0) {
        throw new Error('沒有可進行緩衝區分析的圖元');
      }

      this.isBusy = true;
      this.abortRequested = false;
      const runBtn = document.getElementById('btn-gp-run');
      if (runBtn) runBtn.disabled = true;

      const bufferFeatures = [];
      const errors = [];
      const total = sourceFeatures.length;

      for (let i = 0; i < total; i++) {
        if (this.abortRequested) {
          this.hideProgress();
          if (typeof App !== 'undefined') App.showToast('已取消緩衝區計算', 'info');
          return null;
        }

        const feat = sourceFeatures[i];
        const geojson = toGeoJSONFeature(feat);

        try {
          if (!geojson || !geojson.geometry) throw new Error('無效幾何');

          let buffered = null;
          if (typeof turf !== 'undefined' && turf.buffer) {
            buffered = turf.buffer(geojson, distance, { units: unit });
          } else {
            throw new Error('Turf.js 緩衝區函式庫不可用');
          }

          if (buffered && buffered.geometry) {
            buffered.properties = {
              ...(geojson.properties || {}),
              source_id: feat.featureProps?.id || `src_${i}`,
              source_layer: layer ? layer.name : '選取圖元',
              buffer_distance: distance,
              buffer_unit: unit === 'kilometers' ? 'km' : 'm'
            };
            bufferFeatures.push(buffered);
          } else {
            errors.push({ id: feat.featureProps?.id || `#${i + 1}`, message: '緩衝幾何生成為空' });
          }
        } catch (err) {
          errors.push({ id: feat.featureProps?.id || `#${i + 1}`, message: err.message });
        }

        if (i % 10 === 0 || i === total - 1) {
          this.showProgress(Math.round(((i + 1) / total) * 100), `正在計算緩衝區 (${i + 1}/${total})...`);
          await new Promise(r => setTimeout(r, 0));
        }
      }

      let finalFeatures = bufferFeatures;

      // Optional Dissolve
      if (dissolve && bufferFeatures.length > 1 && typeof turf !== 'undefined' && turf.union) {
        this.showProgress(95, '正在融合重疊緩衝區...');
        try {
          let unioned = bufferFeatures[0];
          for (let k = 1; k < bufferFeatures.length; k++) {
            try {
              unioned = turf.union(unioned, bufferFeatures[k]);
            } catch (uErr) {
              errors.push({ id: `融合步驟 #${k}`, message: uErr.message });
            }
          }
          if (unioned) {
            unioned.properties = {
              source_count: bufferFeatures.length,
              buffer_distance: distance,
              buffer_unit: unit === 'kilometers' ? 'km' : 'm',
              name: `${outputName} (融合)`
            };
            finalFeatures = [unioned];
          }
        } catch (dErr) {
          errors.push({ id: '融合失敗', message: dErr.message });
        }
      }

      this.hideProgress();

      if (errors.length > 0) {
        this.setErrorSummary({
          title: '緩衝區處理摘要',
          successCount: bufferFeatures.length,
          skipCount: 0,
          failCount: errors.length,
          errors
        });
      }

      if (finalFeatures.length === 0) {
        if (typeof App !== 'undefined') App.showToast('所有圖元緩衝區計算失敗，未建立圖層', 'error');
        return null;
      }

      return this.createOutputLayer({
        name: outputName,
        geometryType: 'Polygon',
        features: finalFeatures,
        sourceTool: 'Buffer',
        parameters: { distance, unit, dissolve }
      });
    },

    /**
     * Tool 2: Clip (裁切)
     */
    async runClip(options = {}) {
      const {
        sourceLayerId = document.getElementById('gp-clip-source')?.value,
        clipLayerId = document.getElementById('gp-clip-mask')?.value,
        selectedOnly = document.getElementById('gp-clip-selected-only')?.checked,
        outputName = document.getElementById('gp-clip-output-name')?.value || '裁切結果'
      } = options;

      const srcLayer = typeof LayerManager !== 'undefined' ? LayerManager.getLayer(sourceLayerId) : null;
      const maskLayer = typeof LayerManager !== 'undefined' ? LayerManager.getLayer(clipLayerId) : null;

      if (!srcLayer) throw new Error('請選擇來源圖層');
      if (!maskLayer) throw new Error('請選擇裁切遮罩圖層');
      if (srcLayer === maskLayer) throw new Error('來源圖層與裁切圖層不可相同');

      // Validation: Clip mask must be Polygon or MultiPolygon
      const maskFeatures = maskLayer.featureGroup ? maskLayer.featureGroup.getLayers() : [];
      if (maskFeatures.length === 0) throw new Error('裁切遮罩圖層內沒有任何圖元');

      for (const mf of maskFeatures) {
        const gj = toGeoJSONFeature(mf);
        if (!gj || !gj.geometry || !['Polygon', 'MultiPolygon'].includes(gj.geometry.type)) {
          throw new Error('裁切遮罩圖層必須為面狀圖層 (Polygon / MultiPolygon)');
        }
      }

      // Combine mask polygons into a single unioned mask if Turf is available
      let clipMask = toGeoJSONFeature(maskFeatures[0]);
      for (let m = 1; m < maskFeatures.length; m++) {
        if (typeof turf !== 'undefined' && turf.union) {
          try {
            clipMask = turf.union(clipMask, toGeoJSONFeature(maskFeatures[m]));
          } catch (_) {}
        }
      }

      let sourceFeatures = [];
      if (selectedOnly) {
        sourceFeatures = typeof SelectionManager !== 'undefined' ? SelectionManager.getSelectedFeatures() : [];
        sourceFeatures = sourceFeatures.filter(f => f.gisLayerId === srcLayer.id);
      } else {
        sourceFeatures = srcLayer.featureGroup ? srcLayer.featureGroup.getLayers() : [];
      }

      if (sourceFeatures.length === 0) throw new Error('來源圖層沒有可裁切的圖元');

      this.isBusy = true;
      this.abortRequested = false;
      const runBtn = document.getElementById('btn-gp-run');
      if (runBtn) runBtn.disabled = true;

      const clippedFeatures = [];
      const errors = [];
      const total = sourceFeatures.length;

      for (let i = 0; i < total; i++) {
        if (this.abortRequested) {
          this.hideProgress();
          if (typeof App !== 'undefined') App.showToast('已取消裁切運算', 'info');
          return null;
        }

        const feat = sourceFeatures[i];
        const geojson = toGeoJSONFeature(feat);

        try {
          if (!geojson || !geojson.geometry) throw new Error('無效幾何');
          const gType = geojson.geometry.type;

          if (gType === 'Point') {
            // Point inside polygon test
            let inside = false;
            if (typeof turf !== 'undefined' && turf.booleanPointInPolygon) {
              inside = turf.booleanPointInPolygon(geojson, clipMask);
            }
            if (inside) {
              geojson.properties = {
                ...(geojson.properties || {}),
                source_id: feat.featureProps?.id || `pt_${i}`,
                clip_layer: maskLayer.name
              };
              clippedFeatures.push(geojson);
            }
          } else if (gType === 'LineString' || gType === 'MultiLineString') {
            // Line clipping: check within, then split by polygon boundary
            let lineInside = false;
            if (typeof turf !== 'undefined' && turf.booleanWithin) {
              lineInside = turf.booleanWithin(geojson, clipMask);
            }

            if (lineInside) {
              geojson.properties = {
                ...(geojson.properties || {}),
                source_id: feat.featureProps?.id || `ln_${i}`,
                clip_layer: maskLayer.name
              };
              clippedFeatures.push(geojson);
            } else if (typeof turf !== 'undefined' && turf.polygonToLine && turf.lineSplit) {
              // Split line by mask boundary
              const boundary = turf.polygonToLine(clipMask);
              const splitResult = turf.lineSplit(geojson, boundary);
              if (splitResult && splitResult.features && splitResult.features.length > 0) {
                splitResult.features.forEach((segment, sIdx) => {
                  if (turf.length(segment) > 0.0001) {
                    const midPt = turf.along(segment, turf.length(segment) / 2);
                    if (turf.booleanPointInPolygon(midPt, clipMask)) {
                      segment.properties = {
                        ...(geojson.properties || {}),
                        source_id: `${feat.featureProps?.id || `ln_${i}`}_${sIdx + 1}`,
                        clip_layer: maskLayer.name
                      };
                      clippedFeatures.push(segment);
                    }
                  }
                });
              }
            }
          } else if (gType === 'Polygon' || gType === 'MultiPolygon') {
            // Polygon intersection
            if (typeof turf !== 'undefined' && turf.intersect) {
              const intersected = turf.intersect(geojson, clipMask);
              if (intersected && intersected.geometry) {
                intersected.properties = {
                  ...(geojson.properties || {}),
                  source_id: feat.featureProps?.id || `poly_${i}`,
                  clip_layer: maskLayer.name
                };
                clippedFeatures.push(intersected);
              }
            }
          }
        } catch (err) {
          errors.push({ id: feat.featureProps?.id || `#${i + 1}`, message: err.message });
        }

        if (i % 10 === 0 || i === total - 1) {
          this.showProgress(Math.round(((i + 1) / total) * 100), `正在裁切圖元 (${i + 1}/${total})...`);
          await new Promise(r => setTimeout(r, 0));
        }
      }

      this.hideProgress();

      if (errors.length > 0) {
        this.setErrorSummary({
          title: '裁切處理摘要',
          successCount: clippedFeatures.length,
          skipCount: total - clippedFeatures.length - errors.length,
          failCount: errors.length,
          errors
        });
      }

      if (clippedFeatures.length === 0) {
        if (typeof App !== 'undefined') App.showToast('裁切範圍內沒有任何圖元，未建立圖層', 'info');
        return null;
      }

      return this.createOutputLayer({
        name: outputName,
        geometryType: srcLayer.geometryType,
        features: clippedFeatures,
        sourceTool: 'Clip'
      });
    },

    /**
     * Tool 3: Intersect (相交)
     */
    async runIntersect(options = {}) {
      const {
        layerAId = document.getElementById('gp-intersect-a')?.value,
        layerBId = document.getElementById('gp-intersect-b')?.value,
        outputName = document.getElementById('gp-intersect-output-name')?.value || '相交結果'
      } = options;

      const layerA = typeof LayerManager !== 'undefined' ? LayerManager.getLayer(layerAId) : null;
      const layerB = typeof LayerManager !== 'undefined' ? LayerManager.getLayer(layerBId) : null;

      if (!layerA || !layerB) throw new Error('請選擇參與相交的兩圖層');
      if (layerA === layerB) throw new Error('相交兩圖層不可相同');

      const featsA = layerA.featureGroup ? layerA.featureGroup.getLayers() : [];
      const featsB = layerB.featureGroup ? layerB.featureGroup.getLayers() : [];

      if (featsA.length === 0 || featsB.length === 0) {
        throw new Error('參與相交之圖層尚無圖元');
      }

      this.isBusy = true;
      this.abortRequested = false;
      const runBtn = document.getElementById('btn-gp-run');
      if (runBtn) runBtn.disabled = true;

      // 1. Precompute BBoxes for layer A and B
      const itemsA = featsA.map(f => {
        const gj = toGeoJSONFeature(f);
        return { feat: f, geojson: gj, bbox: gj ? getBBox(gj.geometry) : null };
      });
      const itemsB = featsB.map(f => {
        const gj = toGeoJSONFeature(f);
        return { feat: f, geojson: gj, bbox: gj ? getBBox(gj.geometry) : null };
      });

      // 2. Filter Candidate Pairs via BBox
      const candidatePairs = [];
      for (const a of itemsA) {
        if (!a.geojson) continue;
        for (const b of itemsB) {
          if (!b.geojson) continue;
          if (bboxesIntersect(a.bbox, b.bbox)) {
            candidatePairs.push([a, b]);
          }
        }
      }

      const totalCandidates = candidatePairs.length;
      const intersectFeatures = [];
      const errors = [];

      for (let i = 0; i < totalCandidates; i++) {
        if (this.abortRequested) {
          this.hideProgress();
          if (typeof App !== 'undefined') App.showToast('已取消相交計算', 'info');
          return null;
        }

        const [itemA, itemB] = candidatePairs[i];
        const gA = itemA.geojson;
        const gB = itemB.geojson;
        const tA = gA.geometry.type;
        const tB = gB.geometry.type;

        try {
          let intersectedGeom = null;

          // Poly - Poly
          if (tA.includes('Polygon') && tB.includes('Polygon')) {
            if (typeof turf !== 'undefined' && turf.intersect) {
              const res = turf.intersect(gA, gB);
              if (res && res.geometry) intersectedGeom = res.geometry;
            }
          }
          // Point - Poly
          else if (tA.includes('Point') && tB.includes('Polygon')) {
            if (typeof turf !== 'undefined' && turf.booleanPointInPolygon) {
              if (turf.booleanPointInPolygon(gA, gB)) intersectedGeom = gA.geometry;
            }
          }
          // Poly - Point
          else if (tA.includes('Polygon') && tB.includes('Point')) {
            if (typeof turf !== 'undefined' && turf.booleanPointInPolygon) {
              if (turf.booleanPointInPolygon(gB, gA)) intersectedGeom = gB.geometry;
            }
          }
          // Line - Poly
          else if (tA.includes('Line') && tB.includes('Polygon')) {
            if (typeof turf !== 'undefined') {
              if (turf.booleanWithin && turf.booleanWithin(gA, gB)) {
                intersectedGeom = gA.geometry;
              } else if (turf.polygonToLine && turf.lineSplit) {
                const boundary = turf.polygonToLine(gB);
                const splits = turf.lineSplit(gA, boundary);
                if (splits?.features?.length > 0) {
                  for (const seg of splits.features) {
                    if (turf.length(seg) > 0.0001) {
                      const mid = turf.along(seg, turf.length(seg) / 2);
                      if (turf.booleanPointInPolygon(mid, gB)) {
                        intersectedGeom = seg.geometry;
                        break;
                      }
                    }
                  }
                }
              }
            }
          }

          if (intersectedGeom) {
            // Attribute Merging: Prefix conflicting fields with A_ and B_
            const propsA = gA.properties || {};
            const propsB = gB.properties || {};
            const mergedProps = {
              source_a_id: itemA.feat.featureProps?.id || null,
              source_b_id: itemB.feat.featureProps?.id || null
            };

            const allKeys = new Set([...Object.keys(propsA), ...Object.keys(propsB)]);
            allKeys.forEach(k => {
              if (['id', 'style', '_measure'].includes(k)) return;
              if (propsA[k] !== undefined && propsB[k] !== undefined) {
                mergedProps[`A_${k}`] = propsA[k];
                mergedProps[`B_${k}`] = propsB[k];
              } else if (propsA[k] !== undefined) {
                mergedProps[k] = propsA[k];
              } else {
                mergedProps[k] = propsB[k];
              }
            });

            intersectFeatures.push({
              type: 'Feature',
              geometry: intersectedGeom,
              properties: mergedProps
            });
          }
        } catch (err) {
          errors.push({ id: `Pair #${i + 1}`, message: err.message });
        }

        if (i % 10 === 0 || i === totalCandidates - 1) {
          this.showProgress(Math.round(((i + 1) / totalCandidates) * 100), `正在計算幾何相交 (${i + 1}/${totalCandidates} 候選配對)...`);
          await new Promise(r => setTimeout(r, 0));
        }
      }

      this.hideProgress();

      if (errors.length > 0 || totalCandidates > 0) {
        this.setErrorSummary({
          title: '相交運算摘要',
          successCount: intersectFeatures.length,
          skipCount: totalCandidates - intersectFeatures.length - errors.length,
          failCount: errors.length,
          errors
        });
      }

      if (intersectFeatures.length === 0) {
        if (typeof App !== 'undefined') App.showToast('兩圖層沒有相交圖元，未建立圖層', 'info');
        return null;
      }

      return this.createOutputLayer({
        name: outputName,
        geometryType: 'any',
        features: intersectFeatures,
        sourceTool: 'Intersect'
      });
    },

    /**
     * Tool 4: Merge (合併圖層)
     */
    async runMerge(options = {}) {
      let layerIds = options.layerIds;
      if (!layerIds) {
        const checked = document.querySelectorAll('#gp-merge-layers-list input[type="checkbox"]:checked');
        layerIds = Array.from(checked).map(c => c.value);
      }
      const outputName = options.outputName || document.getElementById('gp-merge-output-name')?.value || '合併圖層';

      if (!layerIds || layerIds.length < 2) {
        throw new Error('請至少選擇兩個圖層進行合併');
      }

      const layers = layerIds.map(id => LayerManager.getLayer(id)).filter(Boolean);
      if (layers.length < 2) throw new Error('有效圖層數量不足 2 個');

      // Check geometry type compatibility
      const firstFamily = getGeometryFamily(layers[0].geometryType);
      for (let i = 1; i < layers.length; i++) {
        const fam = getGeometryFamily(layers[i].geometryType);
        if (fam !== firstFamily) {
          throw new Error(`圖層「${layers[i].name}」為【${layers[i].geometryType}】，無法與【${layers[0].geometryType}】圖層合併。合併圖層僅支援相同幾何家族。`);
        }
      }

      // Collect all property keys across all selected layers
      const unionKeys = new Set();
      layers.forEach(layer => {
        layer.featureGroup.eachLayer(f => {
          const props = f.featureProps || {};
          Object.keys(props).forEach(k => {
            if (!['id', 'style', '_measure'].includes(k)) unionKeys.add(k);
          });
        });
      });

      // Combine all features
      const mergedFeatures = [];
      layers.forEach(layer => {
        layer.featureGroup.eachLayer(f => {
          const geojson = toGeoJSONFeature(f);
          if (!geojson) return;

          const props = { ...(geojson.properties || {}) };
          // Ensure all union keys exist with null padding
          unionKeys.forEach(k => {
            if (props[k] === undefined) props[k] = null;
          });

          props.source_layer = layer.name;
          props.source_feature_id = f.featureProps?.id || null;

          geojson.properties = props;
          mergedFeatures.push(geojson);
        });
      });

      if (mergedFeatures.length === 0) {
        throw new Error('所選圖層中無任何圖元');
      }

      return this.createOutputLayer({
        name: outputName,
        geometryType: firstFamily,
        features: mergedFeatures,
        sourceTool: 'Merge'
      });
    },

    /**
     * Tool 5: Dissolve (融合)
     */
    async runDissolve(options = {}) {
      const {
        layerId = document.getElementById('gp-dissolve-layer')?.value,
        dissolveField = document.getElementById('gp-dissolve-field')?.value,
        outputName = document.getElementById('gp-dissolve-output-name')?.value || '融合結果'
      } = options;

      const layer = typeof LayerManager !== 'undefined' ? LayerManager.getLayer(layerId) : null;
      if (!layer) throw new Error('請選擇要融合的面狀圖層');

      if (getGeometryFamily(layer.geometryType) !== 'Polygon') {
        throw new Error('融合工具僅支援面狀圖層 (Polygon / MultiPolygon)');
      }

      const features = layer.featureGroup ? layer.featureGroup.getLayers() : [];
      if (features.length === 0) throw new Error('該圖層沒有任何圖元');

      this.isBusy = true;
      this.abortRequested = false;
      const runBtn = document.getElementById('btn-gp-run');
      if (runBtn) runBtn.disabled = true;

      // Group features by dissolveField
      const isAll = !dissolveField || dissolveField === '__ALL__';
      const groups = new Map();

      features.forEach(f => {
        const gj = toGeoJSONFeature(f);
        if (!gj || !gj.geometry) return;

        const val = isAll ? '__ALL__' : String(gj.properties?.[dissolveField] ?? 'null');
        if (!groups.has(val)) groups.set(val, []);
        groups.get(val).push(gj);
      });

      const outputFeatures = [];
      const errors = [];
      let processed = 0;
      const totalGroups = groups.size;

      for (const [groupVal, groupFeats] of groups.entries()) {
        if (this.abortRequested) {
          this.hideProgress();
          if (typeof App !== 'undefined') App.showToast('已取消融合運算', 'info');
          return null;
        }

        processed++;
        this.showProgress(Math.round((processed / totalGroups) * 100), `正在融合分組 (${processed}/${totalGroups})...`);
        await new Promise(r => setTimeout(r, 0));

        if (groupFeats.length === 1) {
          const single = groupFeats[0];
          let areaM2 = 0;
          if (typeof turf !== 'undefined' && turf.area) {
            try { areaM2 = Math.round(turf.area(single) * 100) / 100; } catch (_) {}
          }
          single.properties = {
            dissolve_field: isAll ? 'ALL' : dissolveField,
            dissolve_value: isAll ? 'ALL' : groupVal,
            source_count: 1,
            area_m2: areaM2
          };
          outputFeatures.push(single);
          continue;
        }

        // Iterative Turf union with per-feature error isolation
        let unioned = groupFeats[0];
        let mergedCount = 1;

        for (let k = 1; k < groupFeats.length; k++) {
          const curr = groupFeats[k];
          if (typeof turf !== 'undefined' && turf.union) {
            try {
              unioned = turf.union(unioned, curr);
              mergedCount++;
            } catch (uErr) {
              errors.push({ id: curr.properties?.name || `圖元 #${k + 1}`, message: uErr.message });
            }
          }
        }

        if (unioned) {
          let areaM2 = 0;
          if (typeof turf !== 'undefined' && turf.area) {
            try { areaM2 = Math.round(turf.area(unioned) * 100) / 100; } catch (_) {}
          }
          unioned.properties = {
            dissolve_field: isAll ? 'ALL' : dissolveField,
            dissolve_value: isAll ? 'ALL' : groupVal,
            source_count: mergedCount,
            area_m2: areaM2
          };
          outputFeatures.push(unioned);
        }
      }

      this.hideProgress();

      if (errors.length > 0) {
        this.setErrorSummary({
          title: '融合運算摘要',
          successCount: outputFeatures.length,
          skipCount: 0,
          failCount: errors.length,
          errors
        });
      }

      if (outputFeatures.length === 0) {
        if (typeof App !== 'undefined') App.showToast('融合未能產生有效幾何，未建立圖層', 'error');
        return null;
      }

      return this.createOutputLayer({
        name: outputName,
        geometryType: 'Polygon',
        features: outputFeatures,
        sourceTool: 'Dissolve'
      });
    },

    /**
     * Tool 6: Save Selected as Layer (選取圖元另存圖層)
     */
    saveSelectedAsLayer(options = {}) {
      const selected = typeof SelectionManager !== 'undefined' ? SelectionManager.getSelectedFeatures() : [];
      if (selected.length === 0) {
        if (typeof App !== 'undefined') App.showToast('請先選取地圖或屬性表中的圖元', 'warning');
        return null;
      }

      let baseName = options.outputName || '選取圖元';

      // Group selected features by geometry family (Point, Line, Polygon)
      const familyGroups = {
        Point: [],
        Line: [],
        Polygon: []
      };

      selected.forEach(f => {
        const geojson = toGeoJSONFeature(f);
        if (!geojson || !geojson.geometry) return;
        const fam = getGeometryFamily(geojson.geometry.type);
        if (familyGroups[fam]) {
          familyGroups[fam].push(geojson);
        }
      });

      const activeFamilies = Object.keys(familyGroups).filter(fam => familyGroups[fam].length > 0);
      if (activeFamilies.length === 0) {
        if (typeof App !== 'undefined') App.showToast('選取的圖元中沒有有效空間幾何', 'warning');
        return null;
      }

      const createdLayers = [];

      // If single geometry family: create single layer
      if (activeFamilies.length === 1) {
        const fam = activeFamilies[0];
        const layer = this.createOutputLayer({
          name: baseName,
          geometryType: fam,
          features: familyGroups[fam],
          sourceTool: 'SaveSelected'
        });
        if (layer) createdLayers.push(layer);
      } else {
        // Mixed geometry families: split into separate layers according to GIS standards
        activeFamilies.forEach(fam => {
          const famName = `${baseName}_${fam}`;
          const layer = this.createOutputLayer({
            name: famName,
            geometryType: fam,
            features: familyGroups[fam],
            sourceTool: 'SaveSelected'
          });
          if (layer) createdLayers.push(layer);
        });
        if (typeof App !== 'undefined') {
          App.showToast(`選取圖元包含不同幾何類型，已依點、線、面分流為 ${createdLayers.length} 個圖層`, 'info');
        }
      }

      return createdLayers;
    },

    promptSaveSelected() {
      const selected = typeof SelectionManager !== 'undefined' ? SelectionManager.getSelectedFeatures() : [];
      if (selected.length === 0) {
        if (typeof App !== 'undefined') App.showToast('請先選取地圖或屬性表中的圖元', 'warning');
        return;
      }
      this.open('save_selected');
      const countEl = document.getElementById('gp-save-selected-count');
      if (countEl) countEl.textContent = `${selected.length} 個選取圖元`;
    },

    runCurrentTool() {
      try {
        switch (this.currentTool) {
          case 'buffer':
            this.runBuffer().catch(e => App?.showToast(e.message, 'error'));
            break;
          case 'clip':
            this.runClip().catch(e => App?.showToast(e.message, 'error'));
            break;
          case 'intersect':
            this.runIntersect().catch(e => App?.showToast(e.message, 'error'));
            break;
          case 'merge':
            this.runMerge().catch(e => App?.showToast(e.message, 'error'));
            break;
          case 'dissolve':
            this.runDissolve().catch(e => App?.showToast(e.message, 'error'));
            break;
          case 'save_selected': {
            const outName = document.getElementById('gp-save-output-name')?.value || '選取圖元';
            this.saveSelectedAsLayer({ outputName: outName });
            break;
          }
          default:
            if (typeof App !== 'undefined') App.showToast('未知的工具項目', 'error');
        }
      } catch (err) {
        if (typeof App !== 'undefined') App.showToast(err.message, 'error');
      }
    }
  };

  // Export
  if (typeof window !== 'undefined') {
    window.GeoprocessingManager = GeoprocessingManager;
  }
  if (typeof global !== 'undefined') {
    global.GeoprocessingManager = GeoprocessingManager;
  }
})();
