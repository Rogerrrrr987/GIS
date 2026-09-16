/**
 * GeoCanvas GIS Tool - Topology Manager
 */

window.TopologyManager = {
  errors: [],
  previewLayer: null,

  checkTopology() {
    this.errors = [];
    const layers = DrawManager.getAllLayers();
    
    layers.forEach(layer => {
      if (!layer.featureProps) return;
      const geojson = layer.toGeoJSON();
      const type = geojson.geometry?.type;
      const coords = geojson.geometry?.coordinates;
      
      if (!coords || coords.length === 0) {
        this.addError(layer, '空幾何 (Empty Geometry)', '圖元沒有有效的座標點。');
        return;
      }
      if (!this.hasValidCoordinates(coords)) {
        this.addError(layer, '無效座標', '座標包含非數字、超出經緯度範圍或不完整的座標值。');
        return;
      }
      
      if (type === 'Polygon' || type === 'MultiPolygon') {
         // Check unclosed polygon
         // leaflet/geoman usually forces close, but if imported from CSV/KML might be broken
         const polygons = type === 'Polygon' ? [coords] : coords;
         const unclosed = polygons.some(polygon => polygon.some(ring => {
           if (!Array.isArray(ring) || ring.length < 2) return true;
           const first = ring[0];
           const last = ring[ring.length - 1];
           return first[0] !== last[0] || first[1] !== last[1];
         }));
         if (unclosed) this.addError(layer, '未閉合多邊形', '一個或多個環的首尾頂點不一致。');
         
         // Check self-intersecting (kinks)
         try {
           const kinks = turf.kinks(geojson);
           if (kinks.features.length > 0) {
              this.addError(layer, '自相交多邊形 (Self-Intersection)', `偵測到 ${kinks.features.length} 處自相交。`);
           }
         } catch(e) {}
      }
      
      // Check duplicate vertices
      try {
        const cleaned = turf.cleanCoords(geojson);
        const originalCount = this.countVertices(geojson);
        const cleanedCount = this.countVertices(cleaned);
        if (originalCount > cleanedCount) {
           this.addError(layer, '重複頂點 (Duplicate Vertices)', `包含 ${originalCount - cleanedCount} 個重複或共線不必要的頂點。`, cleaned);
        }
      } catch(e) {}
    });

    this.showReport();
  },

  countVertices(geojson) {
    let count = 0;
    turf.coordEach(geojson, () => count++);
    return count;
  },

  hasValidCoordinates(coords) {
    let valid = true;
    const walk = value => {
      if (!valid || !Array.isArray(value)) { valid = false; return; }
      if (value.length >= 2 && typeof value[0] !== 'object') {
        const lng = Number(value[0]);
        const lat = Number(value[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) valid = false;
        return;
      }
      value.forEach(walk);
    };
    walk(coords);
    return valid;
  },

  addError(layer, type, message, suggestionGeoJson = null) {
    this.errors.push({
      layer,
      id: layer.featureProps.id,
      name: layer.featureProps.name,
      type,
      message,
      suggestion: suggestionGeoJson
    });
  },

  showReport() {
    if (this.errors.length === 0) {
      App.showToast('圖層檢查完成，未發現拓樸錯誤。', 'success');
      return;
    }
    
    // Create UI modal for report
    const modalId = 'topology-report-modal';
    let modal = document.getElementById(modalId);
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.id = modalId;
      document.body.appendChild(modal);
    }
    
    let html = `
      <div class="modal-card" style="max-width: 600px;">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <i data-lucide="alert-triangle" style="color: #f59e0b; width: 20px; height: 20px;"></i>
            <h3>拓樸與幾何檢查報告</h3>
          </div>
          <button class="modal-close" onclick="TopologyManager.closeReport()">&times;</button>
        </div>
        <div class="modal-body" style="max-height: 60vh; overflow-y: auto;">
          <p style="margin-bottom: 12px; color: #334155;">共發現 <strong>${this.errors.length}</strong> 個問題：</p>
          <div style="display: flex; flex-direction: column; gap: 8px;">
    `;
    
    const esc = (val) => (window.SecurityUtils ? window.SecurityUtils.escapeHtml(val) : DrawManager.escapeHtml(val));
    this.errors.forEach((err, idx) => {
       html += `
          <div style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; background: #f8fafc;">
             <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <strong>${esc(err.name)} <span style="color: #ef4444; font-size: 0.85rem;">(${esc(err.type)})</span></strong>
                <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 0.8rem;" onclick="TopologyManager.zoomToError(${idx})">定位</button>
             </div>
             <div style="font-size: 0.85rem; color: #475569;">${esc(err.message)}</div>
             ${err.suggestion ? `<div style="margin-top: 8px;display:flex;gap:6px"><button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.8rem;" onclick="TopologyManager.previewFix(${idx})">預覽修復</button><button class="btn btn-primary" style="padding: 4px 8px; font-size: 0.8rem;" onclick="TopologyManager.fixError(${idx})">套用修復</button></div>` : ''}
          </div>
       `;
    });
    
    html += `
          </div>
        </div>
      </div>
    `;
    
    // Category B: InnerHTML containing strictly escaped error names, types and messages
    modal.innerHTML = html;
    lucide.createIcons({ root: modal });
    modal.classList.add('active');
  },

  zoomToError(index) {
     const err = this.errors[index];
     if (err && err.layer) {
        let bounds;
        if (err.layer.getBounds) {
           bounds = err.layer.getBounds();
        } else if (err.layer.getLatLng) {
           bounds = L.latLngBounds([err.layer.getLatLng()]);
        }
        if (bounds && bounds.isValid()) {
           App.map.fitBounds(bounds, { maxZoom: 18, padding: [20, 20] });
           document.getElementById('topology-report-modal').classList.remove('active');
           if (window.SelectionManager) SelectionManager.toggleSelection(err.layer);
        }
     }
  },

  clearPreview() {
    if (this.previewLayer && App.map.hasLayer(this.previewLayer)) App.map.removeLayer(this.previewLayer);
    this.previewLayer = null;
  },

  closeReport() {
    this.clearPreview();
    document.getElementById('topology-report-modal')?.classList.remove('active');
  },

  previewFix(index) {
    const err = this.errors[index];
    if (!err?.suggestion) return;
    this.clearPreview();
    this.previewLayer = L.geoJSON(err.suggestion, {
      style: { color: '#7c3aed', weight: 5, dashArray: '8 6', fillOpacity: 0.15 },
      pointToLayer: (_, latlng) => L.circleMarker(latlng, { radius: 8, color: '#7c3aed', fillOpacity: 0.4 })
    }).addTo(App.map);
    const bounds = this.previewLayer.getBounds?.();
    if (bounds?.isValid()) App.map.fitBounds(bounds, { maxZoom: 18, padding: [30, 30] });
    App.showToast('紫色虛線為修復後預覽，確認後再套用修復', 'info');
  },

  fixError(index) {
     const err = this.errors[index];
     if (err && err.suggestion && err.layer) {
        if (!confirm(`確定要修復 ${err.name} 的 ${err.type} 問題嗎？請先使用「預覽修復」確認結果。`)) return;
        this.clearPreview();
        
        const gisLayerId = err.layer.gisLayerId;
        const targetLayer = LayerManager.getLayer(gisLayerId);
        
        if (targetLayer && targetLayer.locked) {
           App.showToast('圖層已鎖定，無法修復。', 'error');
           return;
        }

        const destinationLayer = targetLayer || LayerManager.getActiveLayer();
        if (!destinationLayer || destinationLayer.locked) {
          App.showToast('找不到可寫入的未鎖定圖層，修復已取消。', 'error');
          return;
        }

        // Replace geometry
        const props = err.layer.featureProps;
        const newLayer = L.geoJSON(err.suggestion).getLayers()[0];
        
        // Remove old, add new
        DrawManager.removeLayer(err.layer);
        
        newLayer.featureProps = props;
        newLayer.gisLayerId = gisLayerId;
        DrawManager.applyStyleToLayer(newLayer, props.style);
        DrawManager.setupLayerInteractions(newLayer);
        
        newLayer.gisLayerId = destinationLayer.id;
        destinationLayer.featureGroup.addLayer(newLayer);
        
        SafetyManager?.recordChange(`拓樸修復: ${props.name}`);
        App.showToast('修復完成！', 'success');
        document.getElementById('topology-report-modal').classList.remove('active');
        
        // re-run topology check
        setTimeout(() => this.checkTopology(), 500);
     }
  }
};
