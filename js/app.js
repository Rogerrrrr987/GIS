/**
 * GeoCanvas GIS Tool - Panel Manager
 * Coordinates mutual exclusivity, keyboard shortcuts (ESC), and interactive states
 * across large tool panels (Geoprocessing, Routing, TGOS).
 */
const PanelManager = {
  activePanel: null,
  panels: {},

  init() {
    this.register('geoprocessing', {
      panelId: 'geoprocessing-panel',
      buttonId: 'btn-geoprocessing',
      isOpen: () => typeof GeoprocessingManager !== 'undefined' && Boolean(GeoprocessingManager.isActive),
      open: (tool = 'buffer') => {
        if (typeof GeoprocessingManager !== 'undefined') GeoprocessingManager.open(tool);
      },
      close: () => {
        if (typeof GeoprocessingManager !== 'undefined' && GeoprocessingManager.isActive) GeoprocessingManager.close();
      }
    });

    this.register('routing', {
      panelId: 'routing-panel',
      buttonId: 'btn-routing',
      isOpen: () => typeof RoutingManager !== 'undefined' && Boolean(RoutingManager.isActive),
      open: () => {
        if (typeof RoutingManager !== 'undefined' && !RoutingManager.isActive) RoutingManager.toggle();
      },
      close: () => {
        if (typeof RoutingManager !== 'undefined' && RoutingManager.isActive) RoutingManager.toggle();
      }
    });

    this.register('tgos', {
      panelId: 'tgos-locator-panel',
      buttonId: 'btn-tgos-locate',
      isOpen: () => typeof TGOSAddressManager !== 'undefined' && Boolean(TGOSAddressManager.isActive),
      open: () => {
        if (typeof TGOSAddressManager !== 'undefined' && !TGOSAddressManager.isActive) TGOSAddressManager.toggle();
      },
      close: () => {
        if (typeof TGOSAddressManager !== 'undefined' && TGOSAddressManager.isActive) TGOSAddressManager.close();
      }
    });

    // Global ESC key listener to close topmost panel or modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.handleEscape(e);
      }
    });
  },

  register(name, config) {
    this.panels[name] = config;
  },

  open(name, ...args) {
    Object.keys(this.panels).forEach(panelKey => {
      if (panelKey !== name) {
        this.panels[panelKey].close();
      }
    });

    // Large analysis tools receive a focused workspace. The catalog can be
    // reopened explicitly after leaving the tool instead of competing for map space.
    if (typeof CatalogManager !== 'undefined') CatalogManager.hide();

    const target = this.panels[name];
    if (target) {
      target.open(...args);
      this.activePanel = name;
      this.syncButtonStates();
    }
  },

  close(name) {
    const target = this.panels[name];
    if (target) {
      target.close();
      if (this.activePanel === name) {
        this.activePanel = null;
      }
      this.syncButtonStates();
    }
  },

  toggle(name, ...args) {
    const target = this.panels[name];
    if (target && target.isOpen()) {
      this.close(name);
    } else {
      this.open(name, ...args);
    }
  },

  onPanelOpened(name) {
    Object.keys(this.panels).forEach(panelKey => {
      if (panelKey !== name) {
        this.panels[panelKey].close();
      }
    });
    if (typeof CatalogManager !== 'undefined') CatalogManager.hide();
    this.activePanel = name;
    this.syncButtonStates();
  },

  onPanelClosed(name) {
    if (this.activePanel === name) {
      this.activePanel = null;
    }
    this.syncButtonStates();
  },

  syncButtonStates() {
    // activePanel is set by onPanelOpened before some managers finish updating
    // their own isActive flag, so it is the authoritative transition state.
    let anyActive = Boolean(this.activePanel);
    Object.keys(this.panels).forEach(key => {
      const p = this.panels[key];
      const isCurrentlyOpen = p.isOpen();
      if (p.buttonId) {
        const btn = document.getElementById(p.buttonId);
        btn?.classList.toggle('active', isCurrentlyOpen);
      }
      if (isCurrentlyOpen) anyActive = true;
    });

    const toolsDropdownBtn = document.getElementById('tools-dropdown-btn');
    toolsDropdownBtn?.classList.toggle('has-active-tool', anyActive);

    const workspace = document.querySelector('.app-workspace');
    workspace?.classList.toggle('has-focused-tool', anyActive);

    // The contextual inspector is replaced by the active right-side tool.
    const stylePanel = document.getElementById('style-panel');
    if (stylePanel) stylePanel.inert = anyActive;
  },

  handleEscape(event) {
    // 1. Check if an active modal dialog is open (e.g. .modal-overlay.active)
    const activeModals = Array.from(document.querySelectorAll('.modal-overlay.active'));
    if (activeModals.length > 0) {
      const topModal = activeModals[activeModals.length - 1];
      const cancelBtn = topModal.querySelector('#btn-confirm-modal-cancel, #btn-prompt-modal-cancel, .modal-cancel, .btn-modal-cancel, .btn-cancel, .modal-close');
      if (cancelBtn && typeof cancelBtn.click === 'function') {
        cancelBtn.click();
      } else {
        topModal.classList.remove('active');
      }
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }

    // 2. Check if RoutingManager is in barrier addition mode
    if (typeof RoutingManager !== 'undefined' && RoutingManager.isActive && RoutingManager.inputMode === 'barriers') {
      RoutingManager.toggleBarrierMode();
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }

    // 3. Check if a large tool panel is open
    for (const key of Object.keys(this.panels)) {
      const p = this.panels[key];
      if (p && p.isOpen && p.isOpen()) {
        this.close(key);
        event?.preventDefault?.();
        event?.stopPropagation?.();
        return;
      }
    }

    // 4. Attribute table drawer
    if (typeof TableManager !== 'undefined' && (TableManager.isOpen || TableManager.drawer?.classList.contains('open'))) {
      TableManager.close();
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return;
    }

    // 5. Closable menus / popups
    const openMenus = Array.from(document.querySelectorAll('.dropdown-menu.open, .dropdown.open'));
    if (openMenus.length > 0) {
      openMenus.forEach(m => m.classList.remove('open'));
      event?.preventDefault?.();
      event?.stopPropagation?.();
    }
  }
};

window.PanelManager = PanelManager;

const App = {
  map: null,
  baseLayers: {},
  currentBaseLayer: null,
  currentBaseKey: null,
  pendingImport: null,

  init() {
    this.initMap();
    if (typeof I18n !== 'undefined') {
      I18n.init(this.map);
      I18n.onLanguageChange(() => {
        if (typeof LayerManager !== 'undefined' && LayerManager.layers) {
          LayerManager.layers.forEach(layer => {
            if (layer.isDefault) {
              layer.name = I18n.t('layers.default_layer_name', '工作圖層');
            }
          });
          if (LayerManager.render) LayerManager.render();
        }
        this.updateStats();
        if (typeof TableManager !== 'undefined' && TableManager.render) TableManager.render();
        if (typeof RoutingManager !== 'undefined' && RoutingManager.renderStopList) RoutingManager.renderStopList();
        if (typeof SafetyManager !== 'undefined' && SafetyManager.updateUi) SafetyManager.updateUi();
        if (typeof CatalogManager !== 'undefined' && CatalogManager.render) CatalogManager.render();
      });
    }
    this.initBaseMaps();
    this.initStatusBar();
    this.initEventBindings();
    
    // Initialize sub-modules
    LayerManager.init();
    const defaultLayerName = typeof I18n !== 'undefined' ? I18n.t('layers.default_layer_name', '工作圖層') : '工作圖層';
    const defLayer = LayerManager.createLayer(defaultLayerName);
    if (defLayer) {
      defLayer.isDefault = true;
    }
    DrawManager.init(this.map);
    if (window.SelectionManager) SelectionManager.init(this.map);
    
    if (typeof TGOSAddressManager !== 'undefined') {
      TGOSAddressManager.init(this.map);
    } else {
      this.disableUnavailableTool('btn-tgos-locate', 'TGOS 地址定位模組目前無法載入');
    }
    if (typeof RoutingManager !== 'undefined') {
      RoutingManager.init(this.map);
    } else {
      this.disableUnavailableTool('btn-routing', '路網分析模組目前無法載入');
    }
    TableManager.init();
    if (typeof GeoprocessingManager !== 'undefined') {
      GeoprocessingManager.init(this.map);
    }
    if (typeof FieldCalculator !== 'undefined') {
      FieldCalculator.init();
    }
    CatalogManager.init();
    if (typeof SafetyManager !== 'undefined') {
      SafetyManager.init(this.map);
    }
    this.initImportPreview();

    // Initialize PanelManager
    PanelManager.init();

    // Render Lucide icons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }

    this.showToast('GeoCanvas GIS 工具已就緒！歡迎繪製或匯入圖資。', 'info');
  },

  disableUnavailableTool(buttonId, message) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    button.disabled = true;
    button.title = message;
    button.classList.add('is-disabled');
  },

  /**
   * Initialize Leaflet Map
   */
  initMap() {
    // Default center at Taiwan (23.7, 121.0), zoom 8
    this.map = L.map('map', {
      center: [23.85, 120.95],
      zoom: 8,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true // 使用 Canvas 渲染以提升大量路網資料效能
    });
    window.map = this.map;

    // Zoom control on bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // Scale control
    L.control.scale({ imperial: false, metric: true, position: 'bottomleft' }).addTo(this.map);
  },

  /**
   * Initialize Base Tile Layers (including NLSC WMTS: http://maps.nlsc.gov.tw/S_Maps/wmts)
   */
  initBaseMaps() {
    const nlscWmtsUrl = (layer, format = 'image/jpeg') => 
      `https://maps.nlsc.gov.tw/S_Maps/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=_null&TILEMATRIXSET=EPSG:3857&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${format}`;

    this.baseLayers = {
      nlsc_emap: L.tileLayer(nlscWmtsUrl('EMAP'), {
        maxZoom: 20,
        attribution: '&copy; <a href="http://maps.nlsc.gov.tw/S_Maps/wmts" target="_blank">內政部國土測繪中心 (臺灣通用版電子地圖)</a>'
      }),
      nlsc_photo: L.tileLayer(nlscWmtsUrl('PHOTO2'), {
        maxZoom: 20,
        attribution: '&copy; <a href="http://maps.nlsc.gov.tw/S_Maps/wmts" target="_blank">內政部國土測繪中心 (正射影像航照圖)</a>'
      }),
      nlsc_mix: L.tileLayer(nlscWmtsUrl('PHOTO_MIX'), {
        maxZoom: 20,
        attribution: '&copy; <a href="http://maps.nlsc.gov.tw/S_Maps/wmts" target="_blank">內政部國土測繪中心 (航照混合圖)</a>'
      }),
      osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
      }),
      topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
      })
    };

    // Cadastral overlay layer (transparent PNG from NLSC)
    this.cadastralLayer = L.tileLayer(nlscWmtsUrl('LAND_OPENDATA', 'image/png'), {
      minZoom: 14,
      maxZoom: 20,
      opacity: 0.85,
      attribution: '&copy; <a href="http://maps.nlsc.gov.tw/S_Maps/wmts" target="_blank">國土測繪中心 (地籍圖)</a>'
    });
    this.isCadastralActive = false;

    // Default to NLSC EMAP (Taiwan e-Map)
    this.setBaseLayer('nlsc_emap');

    // Bind basemap switch buttons
    document.querySelectorAll('.basemap-btn[data-layer]').forEach(btn => {
      btn.addEventListener('click', () => {
        const layerKey = btn.getAttribute('data-layer');
        this.setBaseLayer(layerKey);

        document.querySelectorAll('.basemap-btn[data-layer]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('basemap-control')?.classList.remove('open');
        this.showToast(`已切換底圖為「${btn.innerText.trim()}」`, 'info');
      });
    });

    const basemapControl = document.getElementById('basemap-control');
    document.getElementById('btn-toggle-basemap')?.addEventListener('click', event => {
      event.stopPropagation();
      basemapControl?.classList.toggle('open');
    });
    document.addEventListener('click', event => {
      if (basemapControl && !basemapControl.contains(event.target)) basemapControl.classList.remove('open');
    });

    // Bind Cadastral Overlay toggle button
    const cadastralBtn = document.getElementById('btn-toggle-cadastral');
    if (cadastralBtn) {
      cadastralBtn.addEventListener('click', () => {
        this.isCadastralActive = !this.isCadastralActive;
        if (this.isCadastralActive) {
          this.map.addLayer(this.cadastralLayer);
          cadastralBtn.classList.add('active');
          if (this.map.getZoom() < 14) {
            this.showToast('已啟用國土測繪地籍圖疊加！請將地圖縮放至 14 級以上即可檢視詳細地段與地號界線。', 'info');
          } else {
            this.showToast('已疊加國土測繪地籍圖 (LAND_OPENDATA)', 'success');
          }
        } else {
          this.map.removeLayer(this.cadastralLayer);
          cadastralBtn.classList.remove('active');
          this.showToast('已關閉地籍圖疊加', 'info');
        }
        SafetyManager?.recordChange('切換地籍圖');
      });
    }

    // Bind Custom WMTS Modal
    this.initWmtsModal();
  },

  initWmtsModal() {
    const modal = document.getElementById('wmts-modal');
    const openBtn = document.getElementById('btn-open-custom-wmts');
    const closeBtn = document.getElementById('btn-close-wmts');
    const cancelBtn = document.getElementById('btn-cancel-wmts');
    const applyBtn = document.getElementById('btn-apply-wmts');
    const presetSelect = document.getElementById('wmts-preset-select');
    const baseUrlInput = document.getElementById('wmts-base-url');
    const genUrlTextarea = document.getElementById('wmts-generated-url');

    const updateGeneratedUrl = () => {
      const base = (baseUrlInput?.value || 'http://maps.nlsc.gov.tw/S_Maps/wmts').trim();
      const layer = presetSelect?.value || 'EMAP';
      const fmt = layer === 'LAND_OPENDATA' ? 'image/png' : 'image/jpeg';
      const safeBase = base.replace(/^http:\/\//i, 'https://');
      const url = `${safeBase}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=_null&TILEMATRIXSET=EPSG:3857&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${fmt}`;
      if (genUrlTextarea) genUrlTextarea.value = url;
    };

    if (openBtn && modal) {
      openBtn.addEventListener('click', () => {
        updateGeneratedUrl();
        modal.classList.add('active');
      });
    }

    if (closeBtn && modal) closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    if (cancelBtn && modal) cancelBtn.addEventListener('click', () => modal.classList.remove('active'));

    presetSelect?.addEventListener('change', updateGeneratedUrl);
    baseUrlInput?.addEventListener('input', updateGeneratedUrl);

    applyBtn?.addEventListener('click', () => {
      const url = genUrlTextarea.value.trim();
      if (!url) return;
      const layerName = presetSelect.options[presetSelect.selectedIndex].text;
      
      const customLayer = L.tileLayer(url, {
        maxZoom: 20,
        attribution: `&copy; <a href="${baseUrlInput.value}" target="_blank">WMTS (${presetSelect.value})</a>`
      });

      if (this.currentBaseLayer) {
        this.map.removeLayer(this.currentBaseLayer);
      }
      this.currentBaseLayer = customLayer;
      this.currentBaseKey = 'custom';
      this.currentBaseLayer.addTo(this.map);

      // Update active styling
      document.querySelectorAll('.basemap-btn[data-layer]').forEach(b => b.classList.remove('active'));
      modal.classList.remove('active');
      this.showToast(`已成功套用自訂 WMTS 圖層：「${layerName}」！`, 'success');
      SafetyManager?.recordChange('變更底圖');
    });
  },

  setBaseLayer(key) {
    if (this.currentBaseLayer) {
      this.map.removeLayer(this.currentBaseLayer);
    }
    if (this.baseLayers[key]) {
      this.currentBaseLayer = this.baseLayers[key];
      this.currentBaseKey = key;
      this.currentBaseLayer.addTo(this.map);
    }
  },

  async triggerSelectByLocation() {
    const sel = document.getElementById('select-location-layer');
    if (!sel || !sel.value) {
      this.showToast(typeof I18n !== 'undefined' ? I18n.t('selection.select_target_first', '請先選擇目標圖層') : '請先選擇目標圖層', 'warning');
      return;
    }
    const targetLayerId = sel.value;
    
    const relationTitle = typeof I18n !== 'undefined' ? I18n.t('selection.location_title', '空間位置選取') : '空間位置選取';
    const relationPrompt = typeof I18n !== 'undefined' ? I18n.t('selection.relation_prompt', '請輸入空間關係 (intersect / within)，預設為 intersect') : '請輸入空間關係 (intersect / within)，預設為 intersect';
    const relationInput = await this.promptInput(relationTitle, relationPrompt, 'intersect');
    if (relationInput === null || relationInput === undefined) return;
    const relation = String(relationInput).trim().toLowerCase() || 'intersect';
    if (!['intersect', 'within'].includes(relation)) {
       this.showToast(typeof I18n !== 'undefined' ? I18n.t('selection.invalid_relation', '無效的空間關係') : '無效的空間關係', 'error');
       return;
    }
    
    let buffer = 0;
    const bufTitle = typeof I18n !== 'undefined' ? I18n.t('selection.buffer_title', '環域距離') : '環域距離';
    const bufPrompt = typeof I18n !== 'undefined' ? I18n.t('selection.buffer_prompt', '請輸入環域距離(公尺)，若為 0 則不進行環域') : '請輸入環域距離(公尺)，若為 0 則不進行環域';
    const bufStr = await this.promptInput(bufTitle, bufPrompt, '0');
    if (bufStr !== null && bufStr !== undefined && !isNaN(Number(bufStr))) {
       buffer = Number(bufStr);
    }

    if (window.SelectionManager) {
      SelectionManager.selectByLocation(targetLayerId, relation, buffer);
    }
  },

  /**
   * Status bar updates
   */
  initStatusBar() {
    const coordsEl = document.getElementById('status-coords');
    const zoomEl = document.getElementById('status-zoom');

    this.map.on('mousemove', (e) => {
      if (coordsEl) {
        if (typeof I18n !== 'undefined') {
          coordsEl.textContent = I18n.t('statusbar.coords', { lat: e.latlng.lat.toFixed(6), lng: e.latlng.lng.toFixed(6) });
        } else {
          coordsEl.textContent = `經緯度: ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
        }
      }
    });

    const updateZoom = () => {
      if (zoomEl) {
        if (typeof I18n !== 'undefined') {
          zoomEl.textContent = I18n.t('statusbar.zoom', { zoom: this.map.getZoom() });
        } else {
          zoomEl.textContent = `縮放級別: ${this.map.getZoom()}`;
        }
      }
    };

    this.map.on('zoomend', updateZoom);
    updateZoom();
  },

  updateStats() {
    const statEl = document.getElementById('status-feature-count');
    const layers = DrawManager.getAllLayers();
    let points = 0, lines = 0, polys = 0;

    layers.forEach(l => {
      if (l instanceof L.Marker) points++;
      else if (l instanceof L.Polyline && !(l instanceof L.Polygon)) lines++;
      else if (l instanceof L.Polygon || l instanceof L.Circle) polys++;
    });

    if (statEl) {
      if (typeof I18n !== 'undefined') {
        statEl.textContent = I18n.t('statusbar.feature_count_detailed', {
          count: layers.length,
          points,
          lines,
          polys
        });
      } else {
        statEl.textContent = `圖元總數: ${layers.length} (點: ${points}, 線: ${lines}, 面: ${polys})`;
      }
    }
  },

  /**
   * UI Event Bindings
   */
  initEventBindings() {
    // Dropdown toggle
    const exportBtn = document.getElementById('export-dropdown-btn');
    const exportDropdown = document.getElementById('export-dropdown');
    if (exportBtn && exportDropdown) {
      exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        exportDropdown.classList.toggle('open');
      });
      document.addEventListener('click', () => {
        exportDropdown.classList.remove('open');
      });
    }

    const toolsBtn = document.getElementById('tools-dropdown-btn');
    const toolsDropdown = document.getElementById('tools-dropdown');
    if (toolsBtn && toolsDropdown) {
      toolsBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toolsDropdown.classList.toggle('open');
        exportDropdown?.classList.remove('open');
      });
      document.addEventListener('click', () => toolsDropdown.classList.remove('open'));
    }

    const langBtn = document.getElementById('lang-dropdown-btn');
    const langDropdown = document.getElementById('lang-dropdown');
    if (langBtn && langDropdown) {
      langBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        langDropdown.classList.toggle('open');
        exportDropdown?.classList.remove('open');
        toolsDropdown?.classList.remove('open');
      });
      document.addEventListener('click', () => langDropdown.classList.remove('open'));
    }

    // Modal Triggers
    const importModal = document.getElementById('import-modal');
    const openImportBtn = document.getElementById('btn-open-import');
    const closeImportBtn = document.getElementById('btn-close-import');
    if (openImportBtn && importModal) {
      openImportBtn.addEventListener('click', () => importModal.classList.add('active'));
    }
    if (closeImportBtn && importModal) {
      closeImportBtn.addEventListener('click', () => importModal.classList.remove('active'));
    }

    // Attribute drawer toggle button
    const tableBtn = document.getElementById('btn-toggle-table');
    const closeDrawerBtn = document.getElementById('btn-close-drawer');
    if (tableBtn) {
      tableBtn.addEventListener('click', () => TableManager.toggle());
    }
    if (closeDrawerBtn) {
      closeDrawerBtn.addEventListener('click', () => TableManager.close());
    }

    // Clear all button
    const clearBtn = document.getElementById('btn-clear-all');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (DrawManager.getAllLayers().length === 0) {
          this.showToast('目前地圖上沒有圖元', 'info');
          return;
        }
        const confirmed = await this.confirm(
          typeof I18n !== 'undefined' ? I18n.t('table.clear_canvas_confirm', '確定要清空畫布上的所有圖元嗎？清空後可使用「復原」救回。') : '確定要清空畫布上的所有圖元嗎？清空後可使用「復原」救回。',
          { isDanger: true }
        );
        if (confirmed) {
          DrawManager.clearAll();
        }
      });
    }

    // Classify button & modal
    const classifyBtn = document.getElementById('btn-classify');
    const classifyModal = document.getElementById('classify-modal');
    const classifyFieldSelect = document.getElementById('classify-field');
    if (classifyBtn && classifyModal) {
      classifyBtn.addEventListener('click', () => {
        const fields = DrawManager.getNumericFields();
        if (fields.length === 0) {
          this.showToast('畫布上沒有包含數值屬性的圖元。請先在屬性資料表新增數值！', 'warning');
          return;
        }
        classifyFieldSelect.replaceChildren(...fields.map(field => new Option(field, field)));
        classifyModal.classList.add('active');
      });
      
      document.getElementById('btn-close-classify')?.addEventListener('click', () => {
        classifyModal.classList.remove('active');
      });
      
      document.getElementById('btn-apply-classify')?.addEventListener('click', () => {
        const field = classifyFieldSelect.value;
        if (field) {
          if (DrawManager.applyClassification(field)) {
            this.showToast(`已套用 [${field}] 數值分級`, 'success');
          }
        }
        classifyModal.classList.remove('active');
      });

      document.getElementById('btn-clear-classify')?.addEventListener('click', () => {
        DrawManager.clearClassification();
        this.showToast('已清除數值分級，恢復預設樣式', 'info');
        classifyModal.classList.remove('active');
      });
    }

    // Routing button
    const routingBtn = document.getElementById('btn-routing');
    if (routingBtn) {
      routingBtn.addEventListener('click', () => {
        if (typeof PanelManager !== 'undefined') {
          PanelManager.toggle('routing');
        } else if (typeof RoutingManager !== 'undefined') {
          RoutingManager.toggle();
        }
      });
    }

    // Setup Drag & Drop File Upload
    this.initFileUpload();

    // Setup Export Action Clicks
    this.initExportActions();

    // Hotkeys
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target;
      const editing = target && (target.matches?.('input, textarea, select') || target.isContentEditable);
      if (editing) return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) SafetyManager?.redo();
        else SafetyManager?.undo();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        SafetyManager?.redo();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        SafetyManager?.saveProjectFile();
      }
    });
  },

  /**
   * File Upload and Dropzone Handling
   */
  initFileUpload() {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    const importModal = document.getElementById('import-modal');

    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await this.processFiles(e.dataTransfer.files);
        if (importModal) importModal.classList.remove('active');
      }
    });

    fileInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        await this.processFiles(e.target.files);
        if (importModal) importModal.classList.remove('active');
        fileInput.value = '';
      }
    });

    // Also support dropping directly onto the map!
    const mapEl = document.getElementById('map');
    mapEl.addEventListener('dragover', (e) => e.preventDefault());
    mapEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await this.processFiles(e.dataTransfer.files);
      }
    });
  },

  /**
   * Process and import multiple files
   */
  async processFiles(fileList) {
    for (const file of Array.from(fileList)) {
      await this.processSingleFile(file);
    }
  },

  async processSingleFile(file) {
    const filename = file.name;
    const ext = filename.split('.').pop().toLowerCase();

    this.showToast(`正在讀取檔案「${filename}」...`, 'info');

    try {
      let geojson = null;

      if (ext === 'kml') {
        const text = await file.text();
        geojson = IOManager.parseKML(text);
      } else if (ext === 'kmz') {
        // KMZ is a zipped KML
        if (typeof JSZip !== 'undefined') {
          const zip = await JSZip.loadAsync(file);
          const kmlFile = Object.values(zip.files).find(f => f.name.toLowerCase().endsWith('.kml'));
          if (!kmlFile) throw new Error('KMZ 檔案內找不到 .kml 內容！');
          const kmlText = await kmlFile.async('text');
          geojson = IOManager.parseKML(kmlText);
        } else {
          throw new Error('KMZ 解析需要 JSZip 支援，請匯入 .kml 或使用 shapefile zip');
        }
      } else if (ext === 'zip') {
        // Shapefile ZIP
        const buffer = await file.arrayBuffer();
        geojson = await IOManager.parseShapefileZip(buffer);
      } else if (ext === 'csv' || ext === 'txt') {
        const text = await file.text();
        geojson = IOManager.parseCSV(text);
      } else if (ext === 'geojson' || ext === 'json') {
        const text = await file.text();
        geojson = IOManager.parseGeoJSON(text);
      } else {
        throw new Error(`不支援的檔案格式 (.${ext})。請提供 KML, SHP(ZIP), CSV 或 GeoJSON 檔案。`);
      }

      if (geojson && geojson.features) {
        await this.openImportPreview({ geojson, filename, ext });
      }
    } catch (err) {
      console.error('檔案匯入失敗:', err);
      this.showToast(`匯入「${filename}」失敗: ${err.message}`, 'error');
    }
  },

  initImportPreview() {
    this.importPreviewModal = document.getElementById('import-preview-modal');
    document.getElementById('btn-confirm-import')?.addEventListener('click', () => this.completePendingImport(true));
    document.getElementById('btn-cancel-import-preview')?.addEventListener('click', () => this.completePendingImport(false));
    document.getElementById('btn-close-import-preview')?.addEventListener('click', () => this.completePendingImport(false));
  },

  openImportPreview(pendingImport) {
    if (!this.importPreviewModal) {
      DrawManager.loadFeatureCollection(pendingImport.geojson);
      return Promise.resolve(true);
    }

    this.pendingImport = pendingImport;
    const { geojson, filename } = pendingImport;
    const features = geojson.features || [];
    const geometryTypes = [...new Set(features.map(feature => feature.geometry?.type).filter(Boolean))];
    const fieldCount = new Set(features.flatMap(feature => Object.keys(feature.properties || {}))).size;
    const crsInfo = this.getCrsInfo(geojson);

    document.getElementById('import-preview-filename').textContent = filename;
    const summary = document.getElementById('import-preview-summary');
    summary.replaceChildren(
      this.createImportSummaryItem('圖元數量', `${features.length} 筆`),
      this.createImportSummaryItem('幾何類型', geometryTypes.join('、') || '無'),
      this.createImportSummaryItem('屬性欄位', `${fieldCount} 個`),
      this.createImportSummaryItem('坐標系統', crsInfo.label)
    );

    const warning = document.getElementById('import-preview-warning');
    warning.hidden = !crsInfo.warning;
    warning.textContent = crsInfo.warning || '';
    this.importPreviewModal.classList.add('active');

    return new Promise(resolve => {
      this.pendingImport.resolve = resolve;
    });
  },

  completePendingImport(shouldImport) {
    const pending = this.pendingImport;
    if (!pending) return;

    this.importPreviewModal?.classList.remove('active');
    this.pendingImport = null;
    if (shouldImport) {
      if (window.LayerManager) {
        const types = [...new Set((pending.geojson.features || []).map(feature => feature.geometry?.type).filter(Boolean))];
        const geometryType = types.length === 1
          ? types[0].includes('Point') ? 'Point' : types[0].includes('Line') ? 'Line' : types[0].includes('Polygon') ? 'Polygon' : 'any'
          : 'any';
        const newLayer = LayerManager.createLayer(pending.filename || '匯入圖層', geometryType);
        newLayer.source = pending.filename || 'import';
        LayerManager.setActiveLayer(newLayer.id);
      }
      DrawManager.loadFeatureCollection(pending.geojson);
      if (window.LayerManager) LayerManager.render();
      this.showToast(`成功匯入「${pending.filename}」！共載入 ${pending.geojson.features.length} 個圖元。`, 'success');
    } else {
      this.showToast(`已取消匯入「${pending.filename}」`, 'info');
    }
    pending.resolve(shouldImport);
  },

  createImportSummaryItem(label, value) {
    const item = document.createElement('div');
    item.className = 'import-summary-item';
    const title = document.createElement('span');
    title.textContent = label;
    const content = document.createElement('strong');
    content.textContent = value;
    item.append(title, content);
    return item;
  },

  getCrsInfo(featureCollection) {
    const declared = featureCollection?.crs?.properties?.name || featureCollection?.crs?.name;
    if (declared) {
      const epsg = String(declared).match(/EPSG(?::|\/0\/)(\d+)/i)?.[1];
      const label = epsg ? `EPSG:${epsg}` : String(declared);
      return {
        label,
        warning: epsg && epsg !== '4326'
          ? `此資料宣告使用 ${label}；目前地圖以 WGS84（EPSG:4326）呈現。請先確認資料已完成坐標轉換，避免圖元位置錯誤。`
          : ''
      };
    }

    const coordinate = this.findFirstCoordinate(featureCollection?.features);
    if (coordinate && (Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 90)) {
      return {
        label: '疑似投影坐標',
        warning: '偵測到座標值超出經緯度範圍，可能是 EPSG:3826 等投影坐標。請先轉換為 WGS84（EPSG:4326），否則位置可能錯誤。'
      };
    }
    return { label: '未宣告（假設 EPSG:4326）', warning: '' };
  },

  findFirstCoordinate(features) {
    const stack = (features || []).map(feature => feature.geometry?.coordinates).filter(Boolean);
    while (stack.length) {
      const candidate = stack.pop();
      if (Array.isArray(candidate) && typeof candidate[0] === 'number' && typeof candidate[1] === 'number') return candidate;
      if (Array.isArray(candidate)) stack.push(...candidate);
    }
    return null;
  },

  /**
   * Setup Export Button Handlers
   */
  initExportActions() {
    const checkLayers = () => {
      const layers = DrawManager.getAllLayers();
      if (layers.length === 0) {
        this.showToast('地圖上尚無圖元可供匯出！請先在畫布上繪製或匯入圖資。', 'warning');
        return false;
      }
      return true;
    };

    // Export KML
    document.getElementById('export-kml')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!checkLayers()) return;
      try {
        const fc = DrawManager.toFeatureCollection();
        IOManager.exportKML(fc, `geocanvas_${this.getTimeStamp()}.kml`);
        this.showToast('已成功匯出 KML 檔案！', 'success');
      } catch (err) {
        this.showToast(`匯出失敗: ${err.message}`, 'error');
      }
    });

    // Export Shapefile ZIP
    document.getElementById('export-shp')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!checkLayers()) return;
      try {
        const fc = DrawManager.toFeatureCollection();
        IOManager.exportShapefileZip(fc, `geocanvas_shapefile_${this.getTimeStamp()}.zip`);
        this.showToast('正在產生並下載 Shapefile ZIP 壓縮檔...', 'success');
      } catch (err) {
        this.showToast(`匯出失敗: ${err.message}`, 'error');
      }
    });

    // Export CSV (WKT + Lat/Lng)
    document.getElementById('export-csv')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!checkLayers()) return;
      try {
        const fc = DrawManager.toFeatureCollection();
        IOManager.exportCSV(fc, `geocanvas_data_${this.getTimeStamp()}.csv`);
        this.showToast('已成功匯出 CSV 檔案（含 WKT 幾何欄位與經緯度）！', 'success');
      } catch (err) {
        this.showToast(`匯出失敗: ${err.message}`, 'error');
      }
    });

    // Export GeoJSON
    document.getElementById('export-geojson')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!checkLayers()) return;
      try {
        const fc = DrawManager.toFeatureCollection();
        IOManager.exportGeoJSON(fc, `geocanvas_features_${this.getTimeStamp()}.geojson`);
        this.showToast('已成功匯出 GeoJSON 檔案！', 'success');
      } catch (err) {
        this.showToast(`匯出失敗: ${err.message}`, 'error');
      }
    });
  },

  getTimeStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  },

  /**
   * Toast Notification
   */
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    else if (type === 'error') iconName = 'alert-triangle';
    else if (type === 'warning') iconName = 'alert-circle';

    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', iconName);
    icon.style.width = '18px';
    icon.style.height = '18px';
    const text = document.createElement('span');
    text.textContent = String(message);
    toast.append(icon, text);

    container.appendChild(toast);

    if (typeof lucide !== 'undefined') {
      lucide.createIcons({ root: toast });
    }

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  /**
   * Custom Asynchronous Confirmation Modal (replaces native window.confirm)
   */
  confirm(message, options = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-modal');
      if (!modal) {
        resolve(true);
        return;
      }
      const titleEl = document.getElementById('confirm-modal-title');
      const msgEl = document.getElementById('confirm-modal-message');
      const okBtn = document.getElementById('btn-confirm-modal-ok');
      const cancelBtn = document.getElementById('btn-confirm-modal-cancel');
      const closeBtn = document.getElementById('btn-confirm-modal-close');

      if (titleEl) {
        titleEl.textContent = options.title || (typeof I18n !== 'undefined' ? I18n.t('common.confirm_title', '操作確認') : '操作確認');
      }
      if (msgEl) {
        msgEl.textContent = message || '';
      }
      if (okBtn) {
        okBtn.textContent = options.confirmText || (typeof I18n !== 'undefined' ? I18n.t('common.confirm', '確定') : '確定');
        if (options.isDanger) {
          okBtn.className = 'btn btn-danger';
        } else {
          okBtn.className = 'btn btn-primary';
        }
      }

      let settled = false;
      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        modal.classList.remove('active');
        document.removeEventListener('keydown', onKey);
        resolve(result);
      };

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup(false);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          cleanup(true);
        }
      };

      if (okBtn) okBtn.onclick = () => cleanup(true);
      if (cancelBtn) cancelBtn.onclick = () => cleanup(false);
      if (closeBtn) closeBtn.onclick = () => cleanup(false);
      document.addEventListener('keydown', onKey);

      modal.classList.add('active');
      setTimeout(() => okBtn?.focus(), 50);
    });
  },

  /**
   * Custom Asynchronous Prompt / Input Modal (replaces native window.prompt)
   */
  promptInput(title, label, defaultValue = '', options = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('prompt-modal');
      if (!modal) {
        resolve(defaultValue);
        return;
      }
      const titleEl = document.getElementById('prompt-modal-title');
      const labelEl = document.getElementById('prompt-modal-label');
      const inputEl = document.getElementById('prompt-modal-input');
      const sliderWrap = document.getElementById('prompt-modal-slider-wrap');
      const slider = document.getElementById('prompt-modal-slider');
      const errEl = document.getElementById('prompt-modal-error');
      const okBtn = document.getElementById('btn-prompt-modal-ok');
      const cancelBtn = document.getElementById('btn-prompt-modal-cancel');
      const closeBtn = document.getElementById('btn-prompt-modal-close');

      if (titleEl) titleEl.textContent = title || (typeof I18n !== 'undefined' ? I18n.t('common.input_title', '請輸入') : '請輸入');
      if (labelEl) labelEl.textContent = label || '';
      if (inputEl) {
        inputEl.type = options.type || 'text';
        inputEl.value = defaultValue ?? '';
      }
      if (errEl) {
        errEl.textContent = '';
        errEl.style.display = 'none';
      }

      if (options.slider && sliderWrap && slider) {
        sliderWrap.style.display = 'block';
        slider.min = options.min ?? 0;
        slider.max = options.max ?? 100;
        slider.value = Number(defaultValue) || 0;
        slider.oninput = () => { if (inputEl) inputEl.value = slider.value; };
        if (inputEl) inputEl.oninput = () => { slider.value = inputEl.value; };
      } else if (sliderWrap) {
        sliderWrap.style.display = 'none';
      }

      let settled = false;
      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        modal.classList.remove('active');
        document.removeEventListener('keydown', onKey);
        resolve(result);
      };

      const validateAndSubmit = () => {
        const val = inputEl ? inputEl.value : '';
        if (options.validate) {
          const err = options.validate(val);
          if (err) {
            if (errEl) {
              errEl.textContent = err;
              errEl.style.display = 'block';
            }
            return;
          }
        }
        cleanup(val);
      };

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup(null);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          validateAndSubmit();
        }
      };

      if (okBtn) okBtn.onclick = validateAndSubmit;
      if (cancelBtn) cancelBtn.onclick = () => cleanup(null);
      if (closeBtn) closeBtn.onclick = () => cleanup(null);
      document.addEventListener('keydown', onKey);

      modal.classList.add('active');
      setTimeout(() => {
        inputEl?.focus();
        inputEl?.select();
      }, 50);
    });
  }
};

// Bootstrap when DOM ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
