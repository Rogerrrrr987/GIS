/**
 * GeoCanvas GIS Tool - Common Security String & DOM Utilities
 */
const SecurityUtils = {
  escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  setText(element, value) {
    if (!element) return;
    element.textContent = (value === null || value === undefined) ? '' : String(value);
  },

  safeUrl(value, options = {}) {
    if (value === null || value === undefined) return '';
    const str = String(value).trim();
    if (!str) return '';
    const lower = str.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('file:')) {
      return '#';
    }
    if (lower.startsWith('data:')) {
      if (options.allowDataImage && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(str)) {
        return str;
      }
      return '#';
    }
    return str;
  }
};

if (typeof window !== 'undefined') {
  window.SecurityUtils = SecurityUtils;
}
if (typeof global !== 'undefined') {
  global.SecurityUtils = SecurityUtils;
}

const SafetyManager = {
  projectType: 'GeoCanvasProject',
  projectVersion: 1,
  storageKey: 'geocanvas.workspace.backup.v1',
  historyLimit: 60,
  autosaveDelay: 800,
  autosaveInterval: 60000,
  map: null,
  initialized: false,
  suspended: false,
  dirty: false,
  backupFailed: false,
  backupSignature: '',
  undoStack: [],
  redoStack: [],
  lastSignature: '',
  savedSignature: '',
  pendingTimer: null,
  backupTimer: null,

  init(map) {
    this.map = map;
    this.bindUi();

    const initial = this.captureProject();
    this.resetHistory(initial, false);
    this.initialized = true;

    this.map?.on('moveend', () => this.scheduleBackup());
    window.addEventListener('beforeunload', (event) => {
      this.flushPendingChange();
      this.saveBackup();
      if (!this.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
    window.addEventListener('pagehide', () => this.saveBackup());
    this.backupTimer = window.setInterval(() => {
      if (this.dirty) this.saveBackup();
    }, this.autosaveInterval);

    this.offerRecovery();
    this.updateUi();
  },

  bindUi() {
    const dropdown = document.getElementById('project-dropdown');
    document.getElementById('project-dropdown-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      dropdown?.classList.toggle('open');
    });
    document.addEventListener('click', (event) => {
      if (dropdown && !dropdown.contains(event.target)) dropdown.classList.remove('open');
    });

    document.getElementById('btn-project-save')?.addEventListener('click', () => this.saveProjectFile());
    document.getElementById('btn-project-open')?.addEventListener('click', () => {
      document.getElementById('project-file-input')?.click();
    });
    document.getElementById('btn-project-undo')?.addEventListener('click', () => this.undo());
    document.getElementById('btn-project-redo')?.addEventListener('click', () => this.redo());
    document.getElementById('status-save-state')?.addEventListener('click', () => this.saveProjectFile());
    document.getElementById('btn-recovery-restore')?.addEventListener('click', () => this.restoreBackup());
    document.getElementById('btn-recovery-discard')?.addEventListener('click', () => this.discardBackup());

    document.getElementById('project-file-input')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) await this.openProjectFile(file);
    });
  },

  recordChange(label = '修改工作內容') {
    if (!this.initialized || this.suspended) return;
    window.clearTimeout(this.pendingTimer);
    this.pendingTimer = window.setTimeout(() => this.commitChange(label), 180);
  },

  commitChange(label = '修改工作內容') {
    if (!this.initialized || this.suspended) return false;
    window.clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    const project = this.captureProject();
    const signature = this.getSignature(project);
    if (signature === this.lastSignature) return false;

    this.undoStack.push({ label, project, signature });
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack = [];
    this.lastSignature = signature;
    this.dirty = signature !== this.savedSignature;
    this.backupFailed = false;
    this.scheduleBackup();
    this.updateUi();
    return true;
  },

  flushPendingChange() {
    if (!this.pendingTimer) return;
    this.commitChange('修改工作內容');
  },

  undo() {
    this.flushPendingChange();
    if (this.undoStack.length <= 1) {
      App?.showToast('沒有可復原的操作', 'info');
      return;
    }
    const current = this.undoStack.pop();
    this.redoStack.push(current);
    const target = this.undoStack[this.undoStack.length - 1];
    this.restoreProject(target.project);
    this.lastSignature = target.signature;
    this.dirty = target.signature !== this.savedSignature;
    this.saveBackup();
    this.updateUi();
    App?.showToast(`已復原：${current.label}`, 'success');
  },

  redo() {
    this.flushPendingChange();
    const target = this.redoStack.pop();
    if (!target) {
      App?.showToast('沒有可重做的操作', 'info');
      return;
    }
    this.restoreProject(target.project);
    this.undoStack.push(target);
    this.lastSignature = target.signature;
    this.dirty = target.signature !== this.savedSignature;
    this.saveBackup();
    this.updateUi();
    App?.showToast(`已重做：${target.label}`, 'success');
  },

  resetHistory(project, dirty = false) {
    const signature = this.getSignature(project);
    this.undoStack = [{ label: '初始狀態', project, signature }];
    this.redoStack = [];
    this.lastSignature = signature;
    this.savedSignature = dirty ? '' : signature;
    this.dirty = dirty;
    this.backupFailed = false;
    this.updateUi();
  },

  captureProject() {
    const center = this.map?.getCenter?.();
    const routeMode = document.getElementById('routing-mode')?.value || 'open';
    const route = typeof RoutingManager !== 'undefined' ? RoutingManager : null;
    return {
      type: this.projectType,
      version: this.projectVersion,
      meta: {
        savedAt: new Date().toISOString(),
        dirty: this.dirty,
        app: 'GeoCanvas GIS'
      },
      map: {
        center: center ? [center.lat, center.lng] : [23.85, 120.95],
        zoom: this.map?.getZoom?.() ?? 8,
        baseLayer: window.App?.currentBaseKey && window.App.currentBaseKey !== 'custom' ? window.App.currentBaseKey : 'nlsc_emap',
        cadastral: Boolean(window.App?.isCadastralActive),
        workingLayerVisible: Boolean(this.map && DrawManager?.featureGroup && this.map.hasLayer(DrawManager.featureGroup))
      },
      workspace: {
        style: { ...(DrawManager?.currentStyle || {}) },
        activeLayerId: LayerManager?.activeLayerId || null,
        groups: (LayerManager?.groups || []).map(group => ({
          id: group.id,
          name: group.name,
          collapsed: Boolean(group.collapsed)
        })),
        layers: this.serializeLayers()
      },
      routing: {
        mode: routeMode === 'roundtrip' ? 'roundtrip' : 'open',
        lockStartEnd: Boolean(route?.lockStartEnd),
        points: (route?.points || []).slice(0, 200).map((p, idx) => ({
          id: p.id || `rp_${idx + 1}`,
          name: p.name || `點位 ${idx + 1}`,
          lat: Number(p.lat),
          lng: Number(p.lng),
          role: p.role || 'stop',
          originalIndex: p.originalIndex || (idx + 1)
        })),
        barriers: (route?.barriers || []).slice(0, 20).map((b, idx) => ({
          id: b.id || `rb_${idx + 1}`,
          name: b.name || `屏障 #${idx + 1}`,
          lat: Number(b.lat),
          lng: Number(b.lng),
          radius: Math.min(50000, Math.max(10, Number(b.radius) || 100)),
          enabled: b.enabled !== false
        })),
        osrm: route ? {
          baseUrl: route.osrmBaseUrl,
          profile: route.osrmProfile,
          fallbackPolicy: route.fallbackPolicy
        } : null
      }
    };
  },

  serializeLayers() {
    if (typeof LayerManager === 'undefined') return [];
    return LayerManager.layers.map((layer) => {
      const features = [];
      if (layer.featureGroup) {
        layer.featureGroup.eachLayer(fLayer => {
          const properties = JSON.parse(JSON.stringify(fLayer.featureProps || {}));
          if (fLayer instanceof L.Circle) {
            const center = fLayer.getLatLng();
            features.push({
              shape: 'Circle',
              center: [center.lat, center.lng],
              radius: fLayer.getRadius(),
              properties
            });
          } else {
            const feature = fLayer.toGeoJSON?.();
            if (feature) features.push({ shape: 'GeoJSON', feature: { ...feature, properties } });
          }
        });
      }
      return {
        id: layer.id,
        name: layer.name,
        geometryType: layer.geometryType,
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
        source: layer.source,
        groupId: layer.groupId,
        features: features
      };
    }).filter(Boolean);
  },

  copySafeArray(value, maximum) {
    if (!Array.isArray(value)) return [];
    return JSON.parse(JSON.stringify(value.slice(0, maximum)));
  },

  restoreProject(project) {
    this.validateProject(project);
    this.suspended = true;
    try {
      if (typeof DrawManager !== 'undefined') {
        DrawManager.clearSelection();
      }
      if (typeof LayerManager !== 'undefined') {
        LayerManager.clearAll();
      }

      const layersData = project.workspace?.layers;
      const legacyFeatures = project.workspace?.features;
      
      let layersToRestore = [];
      LayerManager.groups = Array.isArray(project.workspace?.groups)
        ? project.workspace.groups.slice(0, 1000).map(group => ({
            id: /^[A-Za-z0-9_-]+$/.test(String(group.id || '')) ? String(group.id) : LayerManager.generateGroupId(),
            name: String(group.name || '未命名群組'),
            collapsed: Boolean(group.collapsed)
          }))
        : [];
      if (layersData && Array.isArray(layersData)) {
         layersToRestore = layersData;
      } else if (legacyFeatures && Array.isArray(legacyFeatures)) {
         // Upgrade legacy features to a single layer
         layersToRestore = [{
            id: 'legacy_layer_1',
            name: '工作圖層',
            geometryType: 'any',
            visible: true,
            locked: false,
            opacity: 1.0,
            features: legacyFeatures
         }];
      } else {
         // create default empty layer
         layersToRestore = [{
            id: 'layer_default',
            name: '工作圖層',
            geometryType: 'any',
            visible: true,
            locked: false,
            opacity: 1.0,
            features: []
         }];
      }

      layersToRestore.forEach(layerData => {
         const layer = LayerManager.createLayer(layerData.name, layerData.geometryType, layerData.groupId);
         layer.id = /^[A-Za-z0-9_-]+$/.test(String(layerData.id || '')) ? String(layerData.id) : layer.id;
         layer.visible = layerData.visible !== false;
         layer.locked = layerData.locked === true;
         layer.opacity = typeof layerData.opacity === 'number' ? layerData.opacity : 1.0;
         layer.source = layerData.source || 'manual';
         
         if (!layer.visible && App.map.hasLayer(layer.featureGroup)) {
             App.map.removeLayer(layer.featureGroup);
         }
         
         LayerManager.activeLayerId = layer.id;
         
         const records = layerData.features || [];
         const normalFeatures = records
           .filter((record) => record?.shape === 'GeoJSON' && record.feature?.geometry)
           .map((record) => record.feature);
         if (normalFeatures.length) {
           // loadFeatureCollection needs to add to the active layer. 
           // In draw.js loadFeatureCollection uses handleCreate via L.geoJSON onEachFeature.
           // It's safe to call.
           DrawManager.loadFeatureCollection({ type: 'FeatureCollection', features: normalFeatures }, false);
         }

         records.filter((record) => record?.shape === 'Circle').forEach((record, index) => {
           const lat = Number(record.center?.[0]);
           const lng = Number(record.center?.[1]);
           const radius = Number(record.radius);
           if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radius) || radius <= 0) return;
           const style = record.properties?.style || DrawManager.currentStyle;
           const circle = L.circle([lat, lng], {
             radius,
             stroke: (style.weight ?? 3) > 0,
             color: style.color || '#2563eb',
             fillColor: style.fillColor || '#3b82f6',
             weight: style.weight ?? 3,
             opacity: style.opacity ?? 0.9,
             fillOpacity: style.fillOpacity ?? 0.35
           });
           circle.featureProps = { ...(record.properties || {}) };
           if (!circle.featureProps.name) circle.featureProps.name = `復原圓形 #${index + 1}`;
           circle.gisLayerId = layer.id;
           DrawManager.setupLayerInteractions(circle);
           layer.featureGroup.addLayer(circle);
         });
         LayerManager.applyLayerOpacity(layer);
      });

      const requestedActiveId = project.workspace?.activeLayerId;
      if (requestedActiveId && LayerManager.getLayer(requestedActiveId)) {
        LayerManager.activeLayerId = requestedActiveId;
      } else {
        LayerManager.activeLayerId = LayerManager.layers[0]?.id || null;
      }
      
      LayerManager.updateMapZIndex();
      LayerManager.render();

      DrawManager.currentStyle = { ...DrawManager.currentStyle, ...(project.workspace?.style || {}) };
      DrawManager.updateGeomanPathOptions();
      DrawManager.syncStyleControls();

      const route = project.routing || {};
      if (typeof RoutingManager !== 'undefined') {
        RoutingManager.points = this.sanitizePoints(route.points, 200);
        RoutingManager.barriers = this.sanitizeBarriers(route.barriers, 20);
        RoutingManager.lockStartEnd = typeof route.lockStartEnd === 'boolean' ? route.lockStartEnd : true;
        RoutingManager.inputMode = 'stops';
        RoutingManager.resetComputedRoute();
        RoutingManager.resetPointValidation();
        const mode = document.getElementById('routing-mode');
        if (mode) mode.value = route.mode === 'roundtrip' ? 'roundtrip' : 'open';
        const lockBox = document.getElementById('routing-lock-start-end');
        if (lockBox) lockBox.checked = RoutingManager.lockStartEnd;
        if (route.osrm?.baseUrl && route.osrm?.profile) {
          try {
            RoutingManager.osrmBaseUrl = RoutingManager.normalizeOsrmBaseUrl(route.osrm.baseUrl);
            RoutingManager.osrmProfile = RoutingManager.normalizeOsrmProfile(route.osrm.profile);
            RoutingManager.fallbackPolicy = route.osrm.fallbackPolicy === 'preview' ? 'preview' : 'stop';
            RoutingManager.syncOsrmSettingsForm();
          } catch (error) {
            console.warn('專案中的 OSRM 設定無效，已保留目前設定。', error);
          }
        }
        RoutingManager.render();
      }

      const mapState = project.map || {};
      if (mapState.baseLayer && App.baseLayers?.[mapState.baseLayer]) App.setBaseLayer(mapState.baseLayer);
      if (App.cadastralLayer) {
        App.isCadastralActive = Boolean(mapState.cadastral);
        if (App.isCadastralActive && !this.map.hasLayer(App.cadastralLayer)) this.map.addLayer(App.cadastralLayer);
        if (!App.isCadastralActive && this.map.hasLayer(App.cadastralLayer)) this.map.removeLayer(App.cadastralLayer);
        document.getElementById('btn-toggle-cadastral')?.classList.toggle('active', App.isCadastralActive);
      }

      const center = mapState.center;
      if (Array.isArray(center) && Number.isFinite(Number(center[0])) && Number.isFinite(Number(center[1]))) {
        this.map.setView([Number(center[0]), Number(center[1])], Number(mapState.zoom) || 8, { animate: false });
      }

      App.updateStats();
      TableManager.render();
    } finally {
      this.suspended = false;
    }
  },

  sanitizePoints(points, maximum) {
    if (!Array.isArray(points)) return [];
    return points.slice(0, maximum).filter((point) => {
      const lat = Number(point?.lat);
      const lng = Number(point?.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    }).map((point, idx) => ({
      id: point.id || `rp_${Date.now()}_${idx}`,
      name: String(point.name || `點位 ${idx + 1}`).slice(0, 80),
      lat: Number(point.lat),
      lng: Number(point.lng),
      role: ['start', 'stop', 'end'].includes(point.role) ? point.role : (idx === 0 ? 'start' : 'stop'),
      originalIndex: Number(point.originalIndex) || (idx + 1)
    }));
  },

  sanitizeBarriers(barriers, maximum) {
    if (!Array.isArray(barriers)) return [];
    return barriers.slice(0, maximum).filter((barrier) => {
      const lat = Number(barrier?.lat);
      const lng = Number(barrier?.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    }).map((barrier, idx) => ({
      id: barrier.id || `rb_${Date.now()}_${idx}`,
      name: String(barrier.name || `屏障 #${idx + 1}`).slice(0, 50),
      lat: Number(barrier.lat),
      lng: Number(barrier.lng),
      radius: Math.min(50000, Math.max(10, Number(barrier.radius) || 100)),
      enabled: barrier.enabled !== false
    }));
  },

  validateProject(project) {
    if (!project || project.type !== this.projectType) throw new Error('這不是 GeoCanvas 專案檔');
    if (project.version !== this.projectVersion) throw new Error(`不支援的專案版本：${project.version}`);
    
    const hasLegacy = Array.isArray(project.workspace?.features);
    const hasLayers = Array.isArray(project.workspace?.layers);
    
    if (!hasLegacy && !hasLayers) throw new Error('專案缺少工作圖層資料');
    
    let totalFeatures = 0;
    if (hasLayers) {
       project.workspace.layers.forEach(l => {
          if (Array.isArray(l.features)) totalFeatures += l.features.length;
       });
    } else {
       totalFeatures = project.workspace.features.length;
    }
    
    if (totalFeatures > 100000) throw new Error('專案圖元數量超過安全上限');
    return true;
  },

  getSignature(project) {
    const comparable = JSON.parse(JSON.stringify(project));
    if (comparable.meta) {
      comparable.meta.savedAt = '';
      comparable.meta.dirty = false;
    }
    return JSON.stringify(comparable);
  },

  scheduleBackup() {
    if (!this.initialized || this.suspended) return;
    window.clearTimeout(this.backupTimerOnce);
    this.backupTimerOnce = window.setTimeout(() => this.saveBackup(), this.autosaveDelay);
  },

  saveBackup() {
    if (!this.initialized || this.suspended) return;
    window.clearTimeout(this.backupTimerOnce);
    this.backupTimerOnce = null;
    try {
      const project = this.captureProject();
      project.meta.dirty = this.dirty;
      localStorage.setItem(this.storageKey, JSON.stringify(project));
      this.backupFailed = false;
      this.lastBackupAt = project.meta.savedAt;
      this.backupSignature = this.getSignature(project);
    } catch (error) {
      console.error('工作備份失敗:', error);
      this.backupFailed = true;
      App?.showToast('自動備份失敗：瀏覽器儲存空間可能不足，請立即另存專案', 'error');
    }
    this.updateUi();
  },

  offerRecovery() {
    try {
      const project = JSON.parse(localStorage.getItem(this.storageKey) || 'null');
      if (!project) return;
      this.validateProject(project);
      const featureCount = Array.isArray(project.workspace?.layers)
        ? project.workspace.layers.reduce((sum, layer) => sum + (Array.isArray(layer.features) ? layer.features.length : 0), 0)
        : Array.isArray(project.workspace?.features) ? project.workspace.features.length : 0;
      const pointCount = Array.isArray(project.routing?.points) ? project.routing.points.length : 0;
      const barrierCount = Array.isArray(project.routing?.barriers) ? project.routing.barriers.length : 0;
      if (featureCount + pointCount + barrierCount === 0) return;

      this.pendingRecovery = project;
      const savedAt = new Date(project.meta?.savedAt || Date.now());
      const status = project.meta?.dirty ? '尚未另存的工作' : '上次保存的工作';
      const summary = document.getElementById('recovery-summary');
      if (summary) {
        summary.textContent = `${status}，備份時間 ${savedAt.toLocaleString('zh-TW')}。包含 ${featureCount} 個圖元、${pointCount} 個路網點及 ${barrierCount} 個屏障。`;
      }
      document.getElementById('recovery-modal')?.classList.add('active');
    } catch (error) {
      console.warn('上次工作備份已損壞，無法復原。', error);
      localStorage.removeItem(this.storageKey);
    }
  },

  restoreBackup() {
    if (!this.pendingRecovery) return;
    try {
      this.restoreProject(this.pendingRecovery);
      this.resetHistory(this.captureProject(), true);
      this.saveBackup();
      document.getElementById('recovery-modal')?.classList.remove('active');
      this.pendingRecovery = null;
      App?.showToast('已復原上次工作，請另存專案以建立永久備份', 'success');
    } catch (error) {
      App?.showToast(`備份復原失敗：${error.message}`, 'error');
    }
  },

  discardBackup() {
    localStorage.removeItem(this.storageKey);
    this.pendingRecovery = null;
    document.getElementById('recovery-modal')?.classList.remove('active');
    App?.showToast('已捨棄上次工作備份', 'info');
  },

  saveProjectFile() {
    this.flushPendingChange();
    try {
      const project = this.captureProject();
      project.meta.dirty = false;
      const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `geocanvas_project_${this.timestamp()}.gcp.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      this.savedSignature = this.lastSignature = this.getSignature(project);
      const latest = this.undoStack[this.undoStack.length - 1];
      if (latest) {
        latest.project = project;
        latest.signature = this.lastSignature;
      }
      this.dirty = false;
      this.saveBackup();
      this.updateUi();
      App?.showToast('專案已下載保存（不包含 TGOS APIKey）', 'success');
    } catch (error) {
      App?.showToast(`專案保存失敗：${error.message}`, 'error');
    }
  },

  async openProjectFile(file) {
    if (file.size > 50 * 1024 * 1024) {
      App?.showToast('專案檔超過 50 MB 安全上限', 'error');
      return;
    }
    if (this.dirty) {
      const confirmMsg = '目前有尚未另存的修改。確定要開啟另一個專案嗎？';
      const confirmed = App?.confirm ? await App.confirm(confirmMsg, { isDanger: true }) : true;
      if (!confirmed) return;
    }
    try {
      const project = JSON.parse(await file.text());
      this.validateProject(project);
      this.restoreProject(project);
      const current = this.captureProject();
      this.resetHistory(current, false);
      this.saveBackup();
      App?.showToast(`已開啟專案「${file.name}」`, 'success');
    } catch (error) {
      console.error('專案開啟失敗:', error);
      App?.showToast(`專案開啟失敗：${error.message}`, 'error');
    }
  },

  updateUi() {
    const undo = document.getElementById('btn-project-undo');
    const redo = document.getElementById('btn-project-redo');
    if (undo) {
      undo.disabled = this.undoStack.length <= 1;
      undo.title = this.undoStack.length > 1 ? `復原：${this.undoStack[this.undoStack.length - 1].label}` : '沒有可復原的操作';
    }
    if (redo) {
      redo.disabled = this.redoStack.length === 0;
      redo.title = this.redoStack.length ? `重做：${this.redoStack[this.redoStack.length - 1].label}` : '沒有可重做的操作';
    }

    const status = document.getElementById('status-save-state');
    if (!status) return;
    status.classList.remove('is-saved', 'is-dirty', 'is-backed-up', 'is-error');
    const icon = status.querySelector('i');
    const label = status.querySelector('span');
    if (this.backupFailed) {
      status.classList.add('is-error');
      if (label) label.textContent = typeof I18n !== 'undefined' ? I18n.t('safety.backup_failed', '備份失敗') : '備份失敗';
      if (icon) icon.setAttribute('data-lucide', 'shield-alert');
      status.title = typeof I18n !== 'undefined' ? I18n.t('safety.backup_failed_title', '自動備份失敗，點擊立即另存專案') : '自動備份失敗，點擊立即另存專案';
    } else if (this.dirty && this.lastBackupAt && this.backupSignature === this.lastSignature) {
      status.classList.add('is-backed-up');
      if (label) label.textContent = typeof I18n !== 'undefined' ? I18n.t('safety.auto_backed_up', '已自動備份') : '已自動備份';
      if (icon) icon.setAttribute('data-lucide', 'cloud-check');
      const timeStr = new Date(this.lastBackupAt).toLocaleTimeString(typeof I18n !== 'undefined' && I18n.currentLang === 'en' ? 'en-US' : 'zh-TW');
      status.title = typeof I18n !== 'undefined' ? I18n.t('safety.backed_up_title', { time: timeStr }) : `尚未另存；瀏覽器備份：${timeStr}。點擊另存專案`;
    } else if (this.dirty) {
      status.classList.add('is-dirty');
      if (label) label.textContent = typeof I18n !== 'undefined' ? I18n.t('safety.unsaved', '尚未保存') : '尚未保存';
      if (icon) icon.setAttribute('data-lucide', 'circle-dot');
      status.title = typeof I18n !== 'undefined' ? I18n.t('safety.unsaved_title', '尚未保存，點擊另存專案') : '尚未保存，點擊另存專案';
    } else {
      status.classList.add('is-saved');
      if (label) label.textContent = typeof I18n !== 'undefined' ? I18n.t('safety.saved', '已保存') : '已保存';
      if (icon) icon.setAttribute('data-lucide', 'shield-check');
      status.title = typeof I18n !== 'undefined' ? I18n.t('safety.saved_title', '專案已保存，點擊另存新副本') : '專案已保存，點擊另存新副本';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons({ root: status });
  },

  timestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  }
};

if (typeof window !== 'undefined') window.SafetyManager = SafetyManager;
if (typeof global !== 'undefined') global.SafetyManager = SafetyManager;

