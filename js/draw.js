/**
 * GeoCanvas GIS Tool - Vector Drawing & Feature Management
 */

const DrawManager = {
  featureGroup: null,
  selectedLayer: null,
  currentStyle: {
    symbol: 'default',
    color: '#2563eb',
    fillColor: '#3b82f6',
    weight: 3,
    opacity: 0.9,
    fillOpacity: 0.35
  },

  generateFeatureId() {
    if (globalThis.crypto?.randomUUID) return `feature_${crypto.randomUUID()}`;
    return `feature_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  },

  ensureFeatureIdentity(layer, preferredId = null) {
    if (!layer) return null;
    if (!layer.featureProps) layer.featureProps = {};
    const candidate = preferredId ?? layer.featureProps.id;
    const normalized = candidate === null || candidate === undefined || candidate === '' ? '' : String(candidate);
    const duplicate = normalized && this.getAllLayers().some(item => item !== layer && String(item.featureProps?.id ?? '') === normalized);
    layer.featureProps.id = (!normalized || duplicate) ? this.generateFeatureId() : normalized;
    return layer.featureProps.id;
  },

  isLayerLocked(layer) {
    return Boolean(layer?.gisLayerId && LayerManager.getLayer(layer.gisLayerId)?.locked);
  },

  syncFeatureLock(layer, locked = this.isLayerLocked(layer)) {
    if (!layer?.pm) return;
    const methods = locked
      ? ['disable', 'disableLayerDrag', 'disableRotate']
      : [];
    methods.forEach(method => {
      try { layer.pm[method]?.(); } catch (_) { /* unsupported by this geometry */ }
    });
  },

  enforceLockedLayers() {
    if (!window.LayerManager) return;
    LayerManager.layers.filter(layer => layer.locked).forEach(layer => {
      layer.featureGroup.eachLayer(feature => this.syncFeatureLock(feature, true));
    });
  },

  init(map) {
    this.map = map;
    // featureGroup is now managed by LayerManager

    // Initialize Geoman Controls
    map.pm.addControls({
      position: 'topleft',
      drawMarker: true,
      drawCircleMarker: false,
      drawPolyline: true,
      drawRectangle: true,
      drawPolygon: true,
      drawCircle: true,
      drawText: false,
      editMode: true,
      dragMode: true,
      cutPolygon: true,
      removalMode: true,
      rotateMode: true
    });

    // Set default drawing styles
    this.updateGeomanPathOptions();
    
    // Enable Global Snapping
    map.pm.setGlobalOptions({
      snappable: true,
      snapDistance: 20,
      snapSegment: true
    });

    // Setup Geoman Event Listeners
    map.on('pm:create', (e) => {
      this.handleCreate(e.layer, e.shape);
    });

    map.on('pm:remove', (e) => {
      this.handleRemove(e.layer);
    });

    ['pm:globaleditmodetoggled', 'pm:globaldragmodetoggled', 'pm:globalrotatemodetoggled'].forEach(eventName => {
      map.on(eventName, () => setTimeout(() => this.enforceLockedLayers(), 0));
    });

    map.on('click', () => {
      this.clearSelection();
    });

    // Setup style inputs
    this.bindStyleControls();
    this.bindSnappingControls();
    this.syncStyleControls();
  },

  bindSnappingControls() {
    const enabled = document.getElementById('snap-enabled');
    const distance = document.getElementById('snap-distance');
    const apply = () => {
      const snappable = enabled?.checked !== false;
      const snapDistance = Math.min(100, Math.max(1, Number(distance?.value) || 20));
      if (distance) distance.value = snapDistance;
      this.map.pm.setGlobalOptions({ snappable, snapDistance, snapSegment: true });
    };
    enabled?.addEventListener('change', apply);
    distance?.addEventListener('change', apply);
    apply();
  },

  /**
   * Sync current style to Geoman drawing options
   */
  /**
   * Create Custom L.divIcon based on symbol type and color
   */
  createSymbolIcon(symbol, color) {
    if (!symbol || symbol === 'default') {
      return new L.Icon.Default();
    }
    
    let svgContent = '';
    switch (symbol) {
      case 'circle':
        svgContent = `<circle cx="12" cy="12" r="10" fill="${color}" stroke="#ffffff" stroke-width="2"/>`;
        break;
      case 'square':
        svgContent = `<rect x="3" y="3" width="18" height="18" fill="${color}" stroke="#ffffff" stroke-width="2" rx="2"/>`;
        break;
      case 'star':
        svgContent = `<polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`;
        break;
      case 'flag':
        svgContent = `<path d="M4 2v20M4 4h16l-4 4 4 4H4" fill="${color}" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
        break;
      default:
        return new L.Icon.Default();
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24">${svgContent}</svg>`;
    return L.divIcon({
      className: 'custom-svg-icon',
      html: svg,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  },

  updateGeomanPathOptions() {
    this.map.pm.setPathOptions({
      stroke: this.currentStyle.weight > 0,
      color: this.currentStyle.color,
      fillColor: this.currentStyle.fillColor,
      weight: this.currentStyle.weight,
      opacity: this.currentStyle.opacity,
      fillOpacity: this.currentStyle.fillOpacity
    });
  },

  bindStyleControls() {
    const symbolInput = document.getElementById('style-point-symbol');
    const strokeColorInput = document.getElementById('style-stroke-color');
    const fillColorInput = document.getElementById('style-fill-color');
    const strokeWidthInput = document.getElementById('style-stroke-width');
    const fillOpacityInput = document.getElementById('style-fill-opacity');

    const getTargets = () => {
       if (window.SelectionManager) return SelectionManager.getSelectedFeatures();
       return this.selectedLayer ? [this.selectedLayer] : [];
    };

    if (symbolInput) {
      symbolInput.value = this.currentStyle.symbol;
      symbolInput.addEventListener('change', (e) => {
        this.currentStyle.symbol = e.target.value;
        const targets = getTargets();
        targets.forEach(layer => {
          if (layer instanceof L.Marker) {
            const color = (layer.featureProps.style && layer.featureProps.style.color) || this.currentStyle.color;
            layer.setIcon(this.createSymbolIcon(e.target.value, color));
            if (!layer.featureProps.style) layer.featureProps.style = {};
            layer.featureProps.style.symbol = e.target.value;
          }
        });
        if (targets.length) SafetyManager?.recordChange('變更符號樣式');
      });
    }

    if (strokeColorInput) {
      strokeColorInput.value = this.currentStyle.color;
      strokeColorInput.addEventListener('input', (e) => {
        this.currentStyle.color = e.target.value;
        this.updateGeomanPathOptions();
        const targets = getTargets();
        targets.forEach(layer => {
          if (layer.setStyle) {
            layer.setStyle({ color: e.target.value });
          } else if (layer instanceof L.Marker) {
            const sym = (layer.featureProps.style && layer.featureProps.style.symbol) || this.currentStyle.symbol;
            layer.setIcon(this.createSymbolIcon(sym, e.target.value));
          }
          if (!layer.featureProps.style) layer.featureProps.style = {};
          layer.featureProps.style.color = e.target.value;
        });
        if (targets.length) SafetyManager?.recordChange('變更外框顏色');
      });
    }

    if (fillColorInput) {
      fillColorInput.value = this.currentStyle.fillColor;
      fillColorInput.addEventListener('input', (e) => {
        this.currentStyle.fillColor = e.target.value;
        this.updateGeomanPathOptions();
        const targets = getTargets();
        targets.forEach(layer => {
          if (layer.setStyle) {
            layer.setStyle({ fillColor: e.target.value });
            if (!layer.featureProps.style) layer.featureProps.style = {};
            layer.featureProps.style.fillColor = e.target.value;
          }
        });
        if (targets.length) SafetyManager?.recordChange('變更填充顏色');
      });
    }

    if (strokeWidthInput) {
      strokeWidthInput.value = this.currentStyle.weight;
      strokeWidthInput.addEventListener('change', (e) => {
        this.currentStyle.weight = parseInt(e.target.value, 10);
        this.updateGeomanPathOptions();
        const targets = getTargets();
        targets.forEach(layer => {
          if (layer.setStyle) {
            layer.setStyle({ 
              stroke: this.currentStyle.weight > 0,
              weight: this.currentStyle.weight 
            });
            if (!layer.featureProps.style) layer.featureProps.style = {};
            layer.featureProps.style.weight = this.currentStyle.weight;
          }
        });
        if (targets.length) SafetyManager?.recordChange('變更線寬');
      });
    }

    if (fillOpacityInput) {
      fillOpacityInput.value = this.currentStyle.fillOpacity;
      fillOpacityInput.addEventListener('change', (e) => {
        this.currentStyle.fillOpacity = parseFloat(e.target.value);
        this.updateGeomanPathOptions();
        const targets = getTargets();
        targets.forEach(layer => {
          if (layer.setStyle) {
            layer.setStyle({ fillOpacity: this.currentStyle.fillOpacity });
            if (!layer.featureProps.style) layer.featureProps.style = {};
            layer.featureProps.style.fillOpacity = this.currentStyle.fillOpacity;
          }
        });
        if (targets.length) SafetyManager?.recordChange('變更透明度');
      });
    }
  },

  syncStyleControls(layer = null) {
    const panel = document.getElementById('style-panel');
    const controls = document.getElementById('style-controls');
    const selectionLabel = document.getElementById('style-selection-label');
    const selectionActions = document.getElementById('selection-actions');
    if (!panel || !controls || !selectionLabel) return;

    let selectedFeatures = [];
    if (window.SelectionManager) {
       selectedFeatures = SelectionManager.getSelectedFeatures();
    } else if (this.selectedLayer) {
       selectedFeatures = [this.selectedLayer];
    }
    
    const isSelected = selectedFeatures.length > 0;
    panel.classList.toggle('has-selection', isSelected);
    controls.setAttribute('aria-hidden', String(!isSelected));
    if (selectionActions) selectionActions.style.display = isSelected ? 'flex' : 'none';
    
    if (!isSelected) {
      selectionLabel.textContent = '未選取圖元';
      return;
    }

    if (selectedFeatures.length === 1) {
       layer = selectedFeatures[0];
       const props = layer.featureProps || {};
       const style = { ...this.currentStyle, ...(props.style || {}) };
       this.currentStyle = style;
       selectionLabel.textContent = props.name || this.getLayerGeomType(layer);
    } else {
       selectionLabel.textContent = `已選取 ${selectedFeatures.length} 個`;
       layer = selectedFeatures[0]; // use first for style baseline
       const props = layer.featureProps || {};
       this.currentStyle = { ...this.currentStyle, ...(props.style || {}) };
    }

    const symbolInput = document.getElementById('style-point-symbol');
    const strokeColorInput = document.getElementById('style-stroke-color');
    const fillColorInput = document.getElementById('style-fill-color');
    const strokeWidthInput = document.getElementById('style-stroke-width');
    const fillOpacityInput = document.getElementById('style-fill-opacity');
    
    // Check if any selected is Marker
    const hasMarker = selectedFeatures.some(f => f instanceof L.Marker);
    const style = this.currentStyle;

    if (symbolInput) {
      symbolInput.value = style.symbol || 'default';
      symbolInput.disabled = !hasMarker;
      symbolInput.title = hasMarker ? '設定點位符號' : '僅適用於點位圖元';
    }
    if (strokeColorInput) strokeColorInput.value = style.color || '#2563eb';
    if (fillColorInput) fillColorInput.value = style.fillColor || '#3b82f6';
    if (strokeWidthInput) strokeWidthInput.value = String(style.weight ?? 3);
    if (fillOpacityInput) fillOpacityInput.value = String(style.fillOpacity ?? 0.35);
  },

  clearSelection() {
    if (window.SelectionManager) SelectionManager.clearSelection();
    if (!this.selectedLayer) return;
    this.selectedLayer = null;
    this.syncStyleControls();
    TableManager.render();
  },

  /**
   * Handle creation of a new shape
   */
  handleCreate(layer, shapeType) {
    const activeLayer = LayerManager.getActiveLayer();
    if (!activeLayer) {
      App.showToast('無作用中圖層，無法新增圖元', 'error');
      this.map.removeLayer(layer);
      return;
    }
    if (activeLayer.locked) {
      App.showToast('作用中圖層已鎖定，無法新增圖元', 'error');
      this.map.removeLayer(layer);
      return;
    }
    const shapeGeometry = shapeType === 'Marker' || shapeType === 'CircleMarker' ? 'Point'
      : shapeType === 'Line' ? 'Line'
      : ['Polygon', 'Rectangle', 'Circle'].includes(shapeType) ? 'Polygon' : 'any';
    if (activeLayer.geometryType !== 'any' && shapeGeometry !== activeLayer.geometryType) {
      App.showToast(`作用中圖層只允許${activeLayer.geometryType === 'Point' ? '點' : activeLayer.geometryType === 'Line' ? '線' : '面'}圖元`, 'error');
      this.map.removeLayer(layer);
      return;
    }

    const totalCount = this.getAllLayers().length + 1;
    let defaultName = `圖元 #${totalCount}`;
    if (shapeType === 'Marker') defaultName = `地標點 #${totalCount}`;
    else if (shapeType === 'Line') defaultName = `線段 #${totalCount}`;
    else if (shapeType === 'Polygon' || shapeType === 'Rectangle') defaultName = `多邊形 #${totalCount}`;
    else if (shapeType === 'Circle') defaultName = `圓形 #${totalCount}`;

    layer.featureProps = {
      id: this.generateFeatureId(),
      name: defaultName,
      description: '',
      created_at: new Date().toISOString(),
      style: { ...this.currentStyle }
    };
    layer.gisLayerId = activeLayer.id;

    if (layer instanceof L.Marker) {
      layer.setIcon(this.createSymbolIcon(this.currentStyle.symbol, this.currentStyle.color));
    }

    this.setupLayerInteractions(layer);
    activeLayer.featureGroup.addLayer(layer);

    // Refresh UI
    App.updateStats();
    TableManager.render();
    LayerManager?.render();
    App.showToast(`已新增 ${defaultName}`, 'success');
    SafetyManager?.recordChange(`新增 ${defaultName}`);
  },

  /**
   * Handle removal of layer
   */
  handleRemove(layer) {
    if (layer.gisLayerId && window.LayerManager) {
      const activeLayer = LayerManager.getLayer(layer.gisLayerId);
      if (activeLayer && activeLayer.locked) {
        App.showToast('所屬圖層已鎖定，無法刪除圖元', 'error');
        activeLayer.featureGroup.addLayer(layer);
        return;
      }
    }
    
    if (this.selectedLayer === layer) {
      this.selectedLayer = null;
      this.syncStyleControls();
    }
    App.updateStats();
    TableManager.render();
    LayerManager?.render();
    SafetyManager?.recordChange('刪除圖元');
  },

  /**
   * Setup layer events, selection and popups
   */
  setupLayerInteractions(layer) {
    this.ensureFeatureIdentity(layer);
    layer.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      if (window.SelectionManager) {
        SelectionManager.toggleSelection(layer, e.originalEvent);
      } else {
        this.selectFeature(layer);
      }
    });

    layer.on('pm:edit', () => {
      if (this.isLayerLocked(layer)) {
        this.syncFeatureLock(layer, true);
        App.showToast('圖層已鎖定，無法編輯', 'error');
        return;
      }
      this.updateLayerPopup(layer);
      TableManager.render();
      SafetyManager?.recordChange('編輯圖元幾何');
    });

    layer.on('pm:dragend', () => {
      if (this.isLayerLocked(layer)) {
        this.syncFeatureLock(layer, true);
        App.showToast('圖層已鎖定，無法移動', 'error');
        return;
      }
      this.updateLayerPopup(layer);
      TableManager.render();
      SafetyManager?.recordChange('移動圖元');
    });

    layer.on('pm:rotateend', () => {
      if (this.isLayerLocked(layer)) {
        this.syncFeatureLock(layer, true);
        App.showToast('圖層已鎖定，無法旋轉', 'error');
        return;
      }
      this.updateLayerPopup(layer);
      TableManager.render();
      SafetyManager?.recordChange('旋轉圖元');
    });

    this.updateLayerPopup(layer);
  },

  /**
   * Select a layer
   */
  selectLayer(layer) {
    this.selectedLayer = layer;
    this.updateLayerPopup(layer);
    layer.openPopup();
    this.syncStyleControls(layer);
    TableManager.render();
  },

  /**
   * Generate and bind popup content
   */
  updateLayerPopup(layer) {
    const props = layer.featureProps || {};
    const geomType = this.getLayerGeomType(layer);
    const measureText = this.getLayerMeasurementText(layer);

    let customPropsHtml = '';
    for (const [k, v] of Object.entries(props)) {
      if (!['name', 'description', 'style', 'id', '_measure'].includes(k)) {
        customPropsHtml += `
          <div class="feature-prop-row">
            <strong style="color: #64748b;">${this.escapeHtml(k)}:</strong>
            <span>${this.escapeHtml(v)}</span>
          </div>`;
      }
    }

    const popupHtml = `
      <div style="min-width: 220px; font-family: inherit;">
        <div class="feature-popup-title">
          <span>${this.escapeHtml(props.name || '圖元')}</span>
          <span class="feature-popup-badge">${this.escapeHtml(geomType)}</span>
        </div>
        ${props.description ? `<p style="font-size: 0.8rem; color: #475569; margin-bottom: 6px;">${this.escapeHtml(props.description)}</p>` : ''}
        
        <div class="feature-popup-metrics">
          <strong>幾何度量:</strong> ${measureText}
        </div>

        ${customPropsHtml ? `<div class="feature-popup-props">${customPropsHtml}</div>` : ''}

        <div class="feature-popup-actions">
          <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.76rem;" onclick="DrawManager.promptEditLayer(${layer._leaflet_id})">
            <i data-lucide="edit-3"></i> 編輯屬性
          </button>
          <button class="btn btn-danger-outline" style="padding: 3px 8px; font-size: 0.76rem;" onclick="DrawManager.deleteLayerById(${layer._leaflet_id})">
            <i data-lucide="trash-2"></i> 刪除
          </button>
        </div>
      </div>
    `;

    layer.bindPopup(popupHtml);

    // Refresh icons if popup is open
    layer.on('popupopen', () => {
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
    });
  },

  escapeHtml(value) {
    if (typeof window !== 'undefined' && window.SecurityUtils?.escapeHtml) {
      return window.SecurityUtils.escapeHtml(value);
    }
    if (typeof global !== 'undefined' && global.SecurityUtils?.escapeHtml) {
      return global.SecurityUtils.escapeHtml(value);
    }
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  },

  /**
   * Prompt user to edit Name and Description
   */
  promptEditLayer(layerId) {
    const layer = this.getLayerById(layerId);
    if (!layer) return;
    if (this.isLayerLocked(layer)) {
      App.showToast('圖層已鎖定，無法編輯屬性', 'error');
      return;
    }
    if (!layer.featureProps) layer.featureProps = {};

    let changed = false;
    const newName = prompt('請輸入圖元名稱:', layer.featureProps.name || '');
    if (newName !== null) {
      const value = newName.trim();
      changed = changed || value !== (layer.featureProps.name || '');
      layer.featureProps.name = value;
    }

    const newDesc = prompt('請輸入圖元描述或備註:', layer.featureProps.description || '');
    if (newDesc !== null) {
      const value = newDesc.trim();
      changed = changed || value !== (layer.featureProps.description || '');
      layer.featureProps.description = value;
    }

    this.updateLayerPopup(layer);
    layer.openPopup();
    TableManager.render();
    if (changed) SafetyManager?.recordChange('編輯圖元屬性');
  },

  deleteLayerById(layerId) {
    const layer = this.getLayerById(layerId);
    if (layer) {
      this.removeLayer(layer);
      App.showToast('已刪除圖元', 'info');
    }
  },

  removeLayer(layer) {
    if (layer.gisLayerId) {
      const activeLayer = LayerManager.getLayer(layer.gisLayerId);
      if (activeLayer) activeLayer.featureGroup.removeLayer(layer);
    } else {
      if (window.LayerManager) {
        for (const l of LayerManager.layers) {
          if (l.featureGroup.hasLayer(layer)) {
            l.featureGroup.removeLayer(layer);
            break;
          }
        }
      }
    }
    this.handleRemove(layer);
  },

  clearAll() {
    if (window.LayerManager) {
      LayerManager.clearAll();
    }
    this.selectedLayer = null;
    this.syncStyleControls();
    App.updateStats();
    TableManager.render();
    App.showToast('已清空畫布上所有圖元', 'info');
    SafetyManager?.recordChange('清空所有圖元');
  },

  /**
   * Helper to get all layers for serialization or global operations
   */
  getAllLayers() {
    let all = [];
    if (window.LayerManager && LayerManager.layers) {
      LayerManager.layers.forEach(l => {
        if (l.featureGroup) {
          all = all.concat(l.featureGroup.getLayers());
        }
      });
    }
    return all;
  },

  getLayerById(id) {
    if (window.LayerManager && LayerManager.layers) {
      for (const l of LayerManager.layers) {
        if (l.featureGroup) {
          const feature = l.featureGroup.getLayer(id);
          if (feature) return feature;
        }
      }
    }
    return null;
  },

  getLayerGeomType(layer) {
    if (layer instanceof L.Marker) return 'Point (點)';
    if (layer instanceof L.Circle) return 'Circle (圓形)';
    if (layer instanceof L.Polygon) return 'Polygon (面)';
    if (layer instanceof L.Polyline) return 'LineString (線)';
    return 'Geometry';
  },

  getLayerMeasurementText(layer) {
    if (layer instanceof L.Marker) {
      const latlng = layer.getLatLng();
      return `坐標: ${MeasureUtil.formatCoords(latlng.lat, latlng.lng)}`;
    }
    if (layer instanceof L.Circle) {
      const radius = layer.getRadius();
      const area = Math.PI * radius * radius;
      return `半徑: ${radius.toFixed(1)}m | 面積: ${MeasureUtil.formatArea(area)}`;
    }
    if (layer instanceof L.Polygon) {
      const latlngs = layer.getLatLngs();
      const ring = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
      const area = MeasureUtil.calculateArea(ring);
      const perimeter = MeasureUtil.calculateLength(ring);
      return `面積: ${MeasureUtil.formatArea(area)} | 周長: ${MeasureUtil.formatLength(perimeter)}`;
    }
    if (layer instanceof L.Polyline) {
      const latlngs = layer.getLatLngs();
      const length = MeasureUtil.calculateLength(latlngs);
      return `長度: ${MeasureUtil.formatLength(length)}`;
    }
    return '無量測數據';
  },

  /**
   * Convert all layers in map to a standard GeoJSON FeatureCollection
   */
  toFeatureCollection() {
    const features = [];
    const layers = this.getAllLayers();

    layers.forEach(layer => {
      let geojson = null;

      if (layer instanceof L.Circle) {
        // Approximate circle to polygon (64 vertices) via Turf.js
        const center = [layer.getLatLng().lng, layer.getLatLng().lat];
        geojson = turf.circle(center, layer.getRadius() / 1000, { steps: 64, units: 'kilometers' });
      } else if (layer.toGeoJSON) {
        geojson = layer.toGeoJSON();
      }

      if (geojson) {
        geojson.properties = { ...(layer.featureProps || {}), style: layer.featureProps?.style || this.currentStyle };
        features.push(geojson);
      }
    });

    return {
      type: 'FeatureCollection',
      features: features
    };
  },

  /**
   * Load a FeatureCollection onto the map
   */
  loadFeatureCollection(fc, fitBounds = true) {
    if (!fc || !fc.features) return;

    const addedLayers = [];

    fc.features.forEach((feature, index) => {
      const geom = feature.geometry;
      if (!geom) return;

      let layer = null;
      const style = feature.properties?.style || this.currentStyle;

      if (geom.type === 'Point') {
        const lat = geom.coordinates[1];
        const lng = geom.coordinates[0];
        layer = L.marker([lat, lng]);
        if (style && style.symbol) {
          layer.setIcon(this.createSymbolIcon(style.symbol, style.color || '#2563eb'));
        }
      } else if (geom.type === 'LineString') {
        const latlngs = geom.coordinates.map(c => [c[1], c[0]]);
        layer = L.polyline(latlngs, {
          color: style.color || '#2563eb',
          weight: style.weight || 3,
          opacity: style.opacity || 0.9
        });
      } else if (geom.type === 'Polygon') {
        const rings = geom.coordinates.map(ring => ring.map(c => [c[1], c[0]]));
        const w = style.weight !== undefined ? style.weight : 3;
        layer = L.polygon(rings, {
          stroke: w > 0,
          color: style.color || '#2563eb',
          fillColor: style.fillColor || '#3b82f6',
          weight: w,
          opacity: style.opacity || 0.9,
          fillOpacity: style.fillOpacity !== undefined ? style.fillOpacity : 0.35
        });
      } else if (geom.type === 'MultiPolygon') {
        const multiRings = geom.coordinates.map(poly => poly.map(ring => ring.map(c => [c[1], c[0]])));
        const w = style.weight !== undefined ? style.weight : 3;
        layer = L.polygon(multiRings, {
          stroke: w > 0,
          color: style.color || '#2563eb',
          fillColor: style.fillColor || '#3b82f6',
          weight: w,
          opacity: style.opacity || 0.9,
          fillOpacity: style.fillOpacity !== undefined ? style.fillOpacity : 0.35
        });
      }

      if (layer) {
        layer.featureProps = { ...(feature.properties || {}) };
        this.ensureFeatureIdentity(layer, layer.featureProps.id);
        if (!layer.featureProps.name) {
          layer.featureProps.name = `匯入圖元 #${index + 1}`;
        }
        
        const activeLayer = LayerManager.getActiveLayer();
        if (activeLayer) {
           layer.gisLayerId = activeLayer.id;
           this.setupLayerInteractions(layer);
           activeLayer.featureGroup.addLayer(layer);
           addedLayers.push(layer);
        }
      }
    });

    if (fitBounds && addedLayers.length > 0) {
      try {
        const group = L.featureGroup(addedLayers);
        const bounds = group.getBounds();
        if (bounds.isValid()) {
          this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        }
      } catch (e) {
        console.warn('fitBounds warning:', e);
      }
    }

    App.updateStats();
    TableManager.render();
    LayerManager?.render();
    SafetyManager?.recordChange('匯入圖資');
  },

  /**
   * Get all property keys that are purely numeric across all layers
   */
  getNumericFields() {
    const layers = this.getAllLayers();
    const numericKeys = new Set();
    const allKeys = new Set();

    layers.forEach(l => {
      const props = l.featureProps || {};
      Object.keys(props).forEach(k => {
        if (k !== 'name' && k !== 'description' && k !== 'style' && k !== '_measure') {
          allKeys.add(k);
        }
      });
    });

    allKeys.forEach(k => {
      let isNumeric = true;
      let hasValue = false;
      for (const l of layers) {
        const val = l.featureProps?.[k];
        if (val !== undefined && val !== null && val !== '') {
          hasValue = true;
          if (isNaN(Number(val))) {
            isNumeric = false;
            break;
          }
        }
      }
      if (hasValue && isNumeric) {
        numericKeys.add(k);
      }
    });

    return Array.from(numericKeys);
  },

  /**
   * Apply 5-class Equal Interval Classification (Red Gradient)
   */
  applyClassification(field) {
    const layers = this.getAllLayers();
    if (layers.length === 0) return false;

    // 5-class Red Gradient (ColorBrewer Reds)
    const colors = ['#fee5d9', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15'];
    
    let values = [];
    layers.forEach(l => {
      const val = parseFloat(l.featureProps?.[field]);
      if (!isNaN(val)) values.push(val);
    });

    if (values.length === 0) return false;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;

    // Apply color to layers
    layers.forEach(l => {
      const val = parseFloat(l.featureProps?.[field]);
      if (!isNaN(val)) {
        let idx = range === 0 ? Math.floor(colors.length / 2) : Math.floor(((val - min) / range) * colors.length);
        if (idx >= colors.length) idx = colors.length - 1;
        if (idx < 0) idx = 0;
        
        const color = colors[idx];
        
        if (l.setStyle) {
          l.setStyle({ fillColor: color, color: color, fillOpacity: 0.8 });
        } else if (l instanceof L.Marker) {
          const sym = (l.featureProps.style && l.featureProps.style.symbol) ? l.featureProps.style.symbol : 'default';
          l.setIcon(this.createSymbolIcon(sym, color));
        }

        if (!l.featureProps.style) l.featureProps.style = {};
        l.featureProps.style.fillColor = color;
        l.featureProps.style.color = color;
      }
    });

    // Generate Legend HTML
    const legendPanel = document.getElementById('legend-panel');
    const legendContent = document.getElementById('legend-content');
    if (legendPanel && legendContent) {
      let html = '';
      if (range === 0) {
        html += `<div class="legend-item"><div class="legend-color" style="background:${colors[Math.floor(colors.length / 2)]}"></div><span>${min}</span></div>`;
      } else {
        const step = range / colors.length;
        for (let i = 0; i < colors.length; i++) {
          const lower = (min + i * step).toFixed(1);
          const upper = (min + (i + 1) * step).toFixed(1);
          html += `<div class="legend-item"><div class="legend-color" style="background:${colors[i]}"></div><span>${lower} - ${upper}</span></div>`;
        }
      }
      // Category B: InnerHTML uses strictly calculated numeric intervals and safe hex colors
      legendContent.innerHTML = html;
      document.getElementById('legend-title').innerText = `分級: ${field}`;
      legendPanel.style.display = 'block';
    }

    SafetyManager?.recordChange(`套用 ${field} 數值分級`);
    return true;
  },

  /**
   * Clear classification, reset features to current default style, hide legend
   */
  clearClassification() {
    const layers = this.getAllLayers();
    layers.forEach(l => {
      const color = this.currentStyle.color;
      const fillColor = this.currentStyle.fillColor;
      if (l.setStyle) {
        l.setStyle({
          stroke: this.currentStyle.weight > 0,
          color: color,
          fillColor: fillColor,
          weight: this.currentStyle.weight,
          opacity: this.currentStyle.opacity,
          fillOpacity: this.currentStyle.fillOpacity
        });
      } else if (l instanceof L.Marker) {
        const sym = (l.featureProps.style && l.featureProps.style.symbol) ? l.featureProps.style.symbol : 'default';
        l.setIcon(this.createSymbolIcon(sym, color));
      }
      
      if (!l.featureProps.style) l.featureProps.style = {};
      l.featureProps.style.fillColor = fillColor;
      l.featureProps.style.color = color;
    });

    const legendPanel = document.getElementById('legend-panel');
    if (legendPanel) legendPanel.style.display = 'none';
    SafetyManager?.recordChange('清除數值分級');
  }
};

if (typeof window !== 'undefined') window.DrawManager = DrawManager;
if (typeof global !== 'undefined') global.DrawManager = DrawManager;

