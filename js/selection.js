/**
 * GeoCanvas GIS Tool - Selection Manager
 */

window.SelectionManager = {
  selectedIds: new Set(),
  selectionLayer: null,
  isBoxSelecting: false,

  init(map) {
    this.map = map;
    this.selectionLayer = L.featureGroup().addTo(this.map);
    this.bindEvents();
  },

  bindEvents() {
    this.map.on('click', (e) => {
      // If clicking on map empty area
      if (!e.originalEvent.ctrlKey && !e.originalEvent.shiftKey) {
        this.clearSelection();
      }
    });

    // Box Selection (Shift + Drag)
    this.map.boxZoom.disable(); // disable default zoom
    
    L.Map.BoxSelect = L.Map.BoxZoom.extend({
       _onMouseUp: function (e) {
           if ((e.which !== 1) && (e.button !== 1)) { return; }
           this._finish();
           if (!this._moved) { return; }
           this._clearDeferredResetState();
           this._resetStateTimeout = setTimeout(L.bind(this._resetState, this), 0);
           var bounds = new L.LatLngBounds(
               this._map.containerPointToLatLng(this._startPoint),
               this._map.containerPointToLatLng(this._point));
           this._map.fire('boxselectend', {boxSelectBounds: bounds, originalEvent: e});
       }
    });
    this.map.addHandler('boxSelect', L.Map.BoxSelect);
    this.map.boxSelect.enable();
    
    this.map.on('boxselectend', (e) => {
      const bounds = e.boxSelectBounds;
      const all = DrawManager.getAllLayers();
      let added = false;
      
      // we can't reliably get originalEvent.ctrlKey from Leaflet BoxZoom sometimes, but let's try
      if (!e.originalEvent?.ctrlKey) {
         this.selectedIds.clear();
      }
      
      all.forEach(layer => {
         if (!layer.featureProps) return;
         let intersects = false;
         
         if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
            intersects = bounds.contains(layer.getLatLng());
         } else if (layer.getBounds) {
            intersects = bounds.intersects(layer.getBounds());
         }
         
         if (intersects) {
            this.selectedIds.add(DrawManager.ensureFeatureIdentity(layer));
            added = true;
         }
      });
      
      if (added) {
         this.render();
         App.showToast(`已框選 ${this.selectedIds.size} 個圖元`, 'success');
      }
    });
  },

  toggleSelection(feature, e) {
    if (!feature || !feature.featureProps) return;
    const id = DrawManager.ensureFeatureIdentity(feature);
    
    if (e && (e.ctrlKey || e.metaKey)) {
      if (this.selectedIds.has(id)) {
        this.selectedIds.delete(id);
      } else {
        this.selectedIds.add(id);
      }
    } else {
      this.selectedIds.clear();
      this.selectedIds.add(id);
    }
    
    this.render();
  },

  clearSelection() {
    if (this.selectedIds.size > 0) {
      this.selectedIds.clear();
      this.render();
    }
  },

  selectAll() {
    const all = DrawManager.getAllLayers();
    all.forEach(f => {
       if (f.featureProps) this.selectedIds.add(DrawManager.ensureFeatureIdentity(f));
    });
    this.render();
  },

  invertSelection() {
    const all = DrawManager.getAllLayers();
    const newSelected = new Set();
    all.forEach(f => {
       const id = f.featureProps ? DrawManager.ensureFeatureIdentity(f) : null;
       if (id && !this.selectedIds.has(id)) {
         newSelected.add(id);
       }
    });
    this.selectedIds = newSelected;
    this.render();
  },

  getSelectedFeatures() {
    const all = DrawManager.getAllLayers();
    return all.filter(f => f.featureProps && this.selectedIds.has(f.featureProps.id));
  },

  async deleteSelected() {
    const selected = this.getSelectedFeatures();
    if (selected.length === 0) return;
    
    const confirmMsg = typeof I18n !== 'undefined'
      ? I18n.t('style.delete_confirm', { count: selected.length })
      : `確定要刪除選取的 ${selected.length} 個圖元嗎？`;
    const confirmed = App?.confirm ? await App.confirm(confirmMsg, { isDanger: true }) : true;
    if (!confirmed) return;
    
    let removed = 0;
    selected.forEach(layer => {
       if (layer.gisLayerId) {
          const l = LayerManager.getLayer(layer.gisLayerId);
          if (l && !l.locked) {
             l.featureGroup.removeLayer(layer);
             removed++;
          }
       }
    });
    this.clearSelection();
    LayerManager.render();
    TableManager.render();
    App.updateStats();
    if (removed) SafetyManager?.recordChange(`刪除 ${removed} 個選取圖元`);
    if (removed < selected.length) App.showToast(`${selected.length - removed} 個圖元因圖層鎖定而保留`, 'warning');
  },

  exportSelected(format) {
    const selected = this.getSelectedFeatures();
    if (selected.length === 0) {
       App.showToast('尚未選取任何圖元', 'warning');
       return;
    }
    
    // Create a temporary FeatureCollection
    const features = selected.map(layer => {
       const feature = layer.toGeoJSON?.();
       if (feature) {
          feature.properties = { ...layer.featureProps };
       }
       return feature;
    }).filter(Boolean);
    
    const fc = { type: 'FeatureCollection', features };
    
    try {
      if (format === 'kml') IOManager.exportKML(fc, 'selected_features.kml');
      else if (format === 'shp') IOManager.exportShapefileZip(fc, 'selected_features.zip');
      else if (format === 'geojson') IOManager.exportGeoJSON(fc, 'selected_features.geojson');
      else if (format === 'csv') IOManager.exportCSV(fc, 'selected_features.csv');
    } catch (e) {
      App.showToast(`匯出失敗: ${e.message}`, 'error');
    }
  },

  selectByLocation(targetLayerId, relation, bufferDistance = 0) {
     const targetGisLayer = LayerManager.getLayer(targetLayerId);
     if (!targetGisLayer) return;
     
     const sourceFeatures = this.getSelectedFeatures();
     if (sourceFeatures.length === 0) {
       App.showToast('請先選取參考圖元', 'warning');
       return;
     }

     const sourceFc = turf.featureCollection(sourceFeatures.map(f => f.toGeoJSON()));
     const targetLayers = targetGisLayer.featureGroup.getLayers();
     
     let count = 0;
     targetLayers.forEach(target => {
       if (!target.featureProps) return;
       const targetGeoJson = target.toGeoJSON();
       
       let match = false;
       for (let i = 0; i < sourceFc.features.length; i++) {
          const sourceF = sourceFc.features[i];
          let checkSource = sourceF;
          
          if (bufferDistance > 0) {
             checkSource = turf.buffer(sourceF, bufferDistance, {units: 'meters'});
          }
          
          if (relation === 'intersect') {
             match = turf.booleanIntersects(checkSource, targetGeoJson);
          } else if (relation === 'within') {
             match = turf.booleanWithin(targetGeoJson, checkSource);
          }
          if (match) break;
       }
       
       if (match) {
         this.selectedIds.add(DrawManager.ensureFeatureIdentity(target));
         count++;
       }
     });
     
     this.render();
     App.showToast(`依位置選取了 ${count} 個圖元`, 'success');
  },

  render() {
    // We rely on CSS classes or marker styles to show selection
    // Since we don't want to re-render the whole map style, we can iterate all layers
    const all = DrawManager.getAllLayers();
    all.forEach(layer => {
       const isSelected = layer.featureProps && this.selectedIds.has(layer.featureProps.id);
       
       if (layer instanceof L.Path) {
          // Polygon or Line
          if (isSelected) {
            // Add a visual highlight (e.g. thick yellow border)
            const baseStyle = layer.featureProps?.style || DrawManager.currentStyle;
            layer.setStyle({ color: '#fbbf24', weight: (baseStyle.weight || 3) + 3 });
          } else {
            // Restore original style
            const style = layer.featureProps?.style || DrawManager.currentStyle;
            const gisLayer = LayerManager.getLayer(layer.gisLayerId);
            const opacity = gisLayer?.opacity ?? 1;
            layer.setStyle({
              color: style.color || '#2563eb',
              weight: style.weight || 3,
              opacity: (style.opacity ?? 0.9) * opacity,
              fillOpacity: (style.fillOpacity ?? 0.35) * opacity
            });
          }
       } else if (layer instanceof L.Marker) {
          // Marker
          if (layer._icon) {
             if (isSelected) {
                layer._icon.style.filter = 'drop-shadow(0 0 8px rgba(251, 191, 36, 1))';
             } else {
                layer._icon.style.filter = '';
             }
          }
       }
    });

    // Notify TableManager to update row highlights
    if (typeof TableManager !== 'undefined') {
       TableManager.highlightSelectedRows();
    }
    DrawManager.syncStyleControls();
    
    // Update select-location-layer options
    const select = document.getElementById('select-location-layer');
    if (select && window.LayerManager) {
       select.innerHTML = '<option value="">目標圖層...</option>';
       LayerManager.layers.forEach(l => {
          if (l.featureGroup.getLayers().length > 0) {
             const opt = document.createElement('option');
             opt.value = l.id;
             opt.textContent = l.name;
             select.appendChild(opt);
          }
       });
    }
  }
};
