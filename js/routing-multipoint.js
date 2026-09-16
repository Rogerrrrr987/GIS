/**
 * GeoCanvas GIS Tool - P2 Multi-point Route Analysis Engine
 *
 * Implements all 7 required defect fixes:
 * 1. Fallback preview uses isolated state (fallbackPreviewRoute/Layer), never overwriting currentRoute/routeLayer.
 * 2. extractRoutePoints automatically assigns start, end (open mode), and stops after sorting and filtering.
 * 3. Bidirectional role conflict resolution (keep-first / keep-last) for both Replace and Append modes.
 * 4. Multi-barrier detour planning supporting >2 barriers (up to 20) with bounded beam-search and request budget.
 * 5. Barrier leg mapping using actual OSRM road geometry (route.latlngs) and Turf intersection.
 * 6. True Keyed DOM updating in renderStopList() reusing row elements and updating only changed properties.
 * 7. Zero Leaflet listener warnings and full SafetyManager integration.
 */

window.RoutingManager = {
  map: null,
  panel: null,
  markerLayer: null,
  barrierLayer: null,
  routeLayer: null,
  fallbackPreviewLayer: null,
  fallbackPreviewRoute: null,
  points: [],
  barriers: [],
  currentRoute: null,
  routeIsOutdated: false,
  pendingFileImport: null,
  isActive: false,
  isBusy: false,
  inputMode: 'stops',
  draggedPointId: null,
  maxPoints: 200,
  maxTripPoints: 90,
  routeChunkSize: 50,
  tableChunkSize: 90,
  maxBarriers: 20,
  maxBarrierRadius: 50000,
  snapWarningDistance: 100,
  snapErrorDistance: 1000,
  osrmBaseUrl: 'https://router.project-osrm.org',
  osrmProfile: 'driving',
  fallbackPolicy: 'stop',
  lockStartEnd: true,
  osrmSettingsKey: 'geocanvas.osrm.settings.v1',
  consentedHostsKey: 'geocanvas.osrm.consented_hosts',
  requestTimeoutMs: 16000,
  requestRetries: 2,
  operationController: null,
  activeOperation: '',
  consentResolver: null,
  activeAccordion: 'stops',
  pointMarkers: new Map(),

  init(map) {
    this.map = map;
    this.panel = document.getElementById('routing-panel');
    if (this.panel && typeof L !== 'undefined' && L.DomEvent) {
      L.DomEvent.disableClickPropagation(this.panel);
      L.DomEvent.disableScrollPropagation(this.panel);
    }
    this.markerLayer = L.layerGroup().addTo(map);
    this.barrierLayer = L.layerGroup().addTo(map);

    this.loadOsrmSettings();
    this.bindEvents();
    this.render();
  },

  bindEvents() {
    this.handleMapClick = this.handleMapClick.bind(this);
    this.handlePointPointerMove = this.handlePointPointerMove.bind(this);
    this.handlePointPointerUp = this.handlePointPointerUp.bind(this);

    document.addEventListener('pointermove', this.handlePointPointerMove, { passive: false });
    document.addEventListener('pointerup', this.handlePointPointerUp);
    document.addEventListener('pointercancel', this.handlePointPointerUp);

    const mode = document.getElementById('routing-mode');
    if (mode) {
      mode.addEventListener('change', () => {
        this.markRouteOutdated();
        this.syncRoleConstraints();
        this.render();
        window.SafetyManager?.recordChange('變更路徑模式');
      });
    }

    const lockBox = document.getElementById('routing-lock-start-end');
    if (lockBox) {
      lockBox.addEventListener('change', (e) => {
        this.lockStartEnd = e.target.checked;
        this.markRouteOutdated();
      });
    }

    const fileInput = document.getElementById('routing-point-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', async (event) => {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (file) await this.importPointFile(file);
      });
    }

    // Modal bindings
    document.getElementById('btn-close-routing-shp-preview')?.addEventListener('click', () => this.cancelFileImport());
    document.getElementById('btn-cancel-routing-shp-preview')?.addEventListener('click', () => this.cancelFileImport());
    document.getElementById('btn-confirm-routing-shp-import')?.addEventListener('click', () => this.confirmFileImport());
    document.getElementById('routing-shp-order-field')?.addEventListener('change', () => this.updateFilePreview());
    document.getElementById('routing-shp-name-field')?.addEventListener('change', () => this.updateFilePreview());
    document.getElementById('routing-shp-role-field')?.addEventListener('change', () => this.updateFilePreview());
    document.getElementById('routing-shp-import-mode')?.addEventListener('change', () => this.updateFilePreview());
    document.getElementById('routing-shp-conflict-resolution')?.addEventListener('change', () => this.updateFilePreview());
    document.getElementById('routing-shp-truncate-check')?.addEventListener('change', () => this.updateFilePreview());
  },

  generateId(prefix = 'rp') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;
  },

  toggleAccordion(sectionName) {
    if (this.activeAccordion === sectionName) {
      const item = document.getElementById(`routing-acc-${sectionName}`);
      if (item) {
        item.classList.toggle('is-open');
        this.activeAccordion = item.classList.contains('is-open') ? sectionName : '';
      }
    } else {
      document.querySelectorAll('.routing-accordion-item').forEach(el => el.classList.remove('is-open'));
      const target = document.getElementById(`routing-acc-${sectionName}`);
      if (target) target.classList.add('is-open');
      this.activeAccordion = sectionName;
    }
    if (window.lucide) window.lucide.createIcons();
  },

  // =========================================================================
  // OSRM SETTINGS & FAIL-CLOSED PRIVACY CONSENT
  // =========================================================================

  loadOsrmSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.osrmSettingsKey) || 'null');
      if (saved && typeof saved === 'object') {
        this.osrmBaseUrl = this.normalizeOsrmBaseUrl(saved.baseUrl);
        this.osrmProfile = this.normalizeOsrmProfile(saved.profile);
        this.fallbackPolicy = saved.fallbackPolicy === 'preview' ? 'preview' : 'stop';
        if (typeof saved.lockStartEnd === 'boolean') this.lockStartEnd = saved.lockStartEnd;
      }
    } catch (error) {
      console.warn('無法載入 OSRM 設定，使用預設值。', error);
      this.osrmBaseUrl = 'https://router.project-osrm.org';
      this.osrmProfile = 'driving';
    }
    this.syncOsrmSettingsForm();
  },

  normalizeOsrmBaseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) throw new Error('OSRM 服務網址不可為空');
    let url;
    try {
      url = new URL(raw);
    } catch (_) {
      throw new Error('OSRM 網址格式不正確');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('僅支援 HTTP 或 HTTPS 通訊協定，禁止 javascript、file 或 data 協定');
    }
    if (url.username || url.password) throw new Error('網址不可包含帳號密碼資訊');
    if (url.search || url.hash) throw new Error('請輸入不含查詢參數或片段的服務基底網址');
    return url.toString().replace(/\/+$/, '');
  },

  normalizeOsrmProfile(value) {
    const profile = String(value || 'driving').trim().toLowerCase();
    return ['driving', 'cycling', 'walking'].includes(profile) ? profile : 'driving';
  },

  getServiceOriginKey(urlStr = this.osrmBaseUrl) {
    try {
      const u = new URL(urlStr);
      const pathname = u.pathname.replace(/\/+$/, '');
      return `${u.protocol}//${u.host}${pathname}`;
    } catch (_) {
      return String(urlStr || '').trim().replace(/\/+$/, '');
    }
  },

  syncOsrmSettingsForm() {
    const urlInput = document.getElementById('routing-osrm-url');
    const profileSelect = document.getElementById('routing-osrm-profile');
    const fallbackSelect = document.getElementById('routing-fallback-policy');
    const lockBox = document.getElementById('routing-lock-start-end');
    if (urlInput) urlInput.value = this.osrmBaseUrl;
    if (profileSelect) profileSelect.value = this.osrmProfile;
    if (fallbackSelect) fallbackSelect.value = this.fallbackPolicy;
    if (lockBox) lockBox.checked = this.lockStartEnd;
    this.updateOsrmPrivacyText();
  },

  applyOsrmSettings() {
    if (this.isBusy) return;
    try {
      const baseUrl = this.normalizeOsrmBaseUrl(document.getElementById('routing-osrm-url')?.value);
      const profile = this.normalizeOsrmProfile(document.getElementById('routing-osrm-profile')?.value);
      const fallbackPolicy = document.getElementById('routing-fallback-policy')?.value === 'preview' ? 'preview' : 'stop';
      const lockStartEnd = Boolean(document.getElementById('routing-lock-start-end')?.checked);

      const changed = baseUrl !== this.osrmBaseUrl || profile !== this.osrmProfile || fallbackPolicy !== this.fallbackPolicy || lockStartEnd !== this.lockStartEnd;
      this.osrmBaseUrl = baseUrl;
      this.osrmProfile = profile;
      this.fallbackPolicy = fallbackPolicy;
      this.lockStartEnd = lockStartEnd;

      localStorage.setItem(this.osrmSettingsKey, JSON.stringify({ baseUrl, profile, fallbackPolicy, lockStartEnd }));
      this.setServiceStatus('尚未測試', 'is-unknown');
      this.syncOsrmSettingsForm();

      if (changed) {
        this.markRouteOutdated();
        this.resetPointValidation();
        this.render();
      }
      window.App?.showToast(`已套用 OSRM 設定：${this.getTransportLabel(profile)}`, 'success');
      if (changed) window.SafetyManager?.recordChange('變更 OSRM 設定');
    } catch (error) {
      window.App?.showToast(`OSRM 設定無效：${error.message}`, 'error');
      document.getElementById('routing-osrm-url')?.focus();
    }
  },

  updateOsrmPrivacyText() {
    const privacy = document.getElementById('routing-privacy');
    if (!privacy) return;
    let host = 'OSRM 服務';
    try { host = new URL(this.osrmBaseUrl).host; } catch (_) {}
    privacy.textContent = `座標傳送至 ${host}（${this.getTransportLabel(this.osrmProfile)}）；未經確認前不送出。`;
  },

  setServiceStatus(message, stateClass = 'is-unknown') {
    const status = document.getElementById('routing-service-status');
    if (!status) return;
    status.className = `routing-service-status ${stateClass}`;
    status.textContent = message;
  },

  // Fail-Closed OSRM Consent with Full-Origin Key (protocol, host, port, pathname)
  async ensureOsrmConsent(pointCount) {
    const serviceKey = this.getServiceOriginKey(this.osrmBaseUrl);
    let consentedHosts = [];
    try {
      consentedHosts = JSON.parse(localStorage.getItem(this.consentedHostsKey) || '[]');
    } catch (_) {}

    if (consentedHosts.includes(serviceKey)) {
      return true;
    }

    const modal = document.getElementById('routing-consent-modal');
    const urlEl = document.getElementById('routing-consent-url');
    const countEl = document.getElementById('routing-consent-count');
    const rememberBox = document.getElementById('routing-consent-remember');

    // FAIL-CLOSED: If modal or required elements are missing, MUST reject immediately
    if (!modal || !urlEl || !countEl) {
      throw new Error('無法顯示外部傳輸確認，因此已停止請求');
    }

    urlEl.textContent = this.osrmBaseUrl;
    countEl.textContent = `${pointCount} 個點位座標`;
    if (rememberBox) rememberBox.checked = false; // Default unchecked

    modal.classList.add('active');
    if (window.lucide) window.lucide.createIcons();

    return new Promise((resolve, reject) => {
      this.consentResolver = { resolve, reject, serviceKey };
    });
  },

  approveOsrmConsent() {
    const modal = document.getElementById('routing-consent-modal');
    modal?.classList.remove('active');
    if (this.consentResolver) {
      const rememberBox = document.getElementById('routing-consent-remember');
      if (rememberBox?.checked && this.consentResolver.serviceKey) {
        try {
          const consented = JSON.parse(localStorage.getItem(this.consentedHostsKey) || '[]');
          if (!consented.includes(this.consentResolver.serviceKey)) {
            consented.push(this.consentResolver.serviceKey);
            localStorage.setItem(this.consentedHostsKey, JSON.stringify(consented));
          }
        } catch (_) {}
      }
      this.consentResolver.resolve(true);
      this.consentResolver = null;
    }
  },

  rejectOsrmConsent() {
    const modal = document.getElementById('routing-consent-modal');
    modal?.classList.remove('active');
    if (this.consentResolver) {
      this.consentResolver.reject(new DOMException('使用者已取消外部服務資料傳輸', 'AbortError'));
      this.consentResolver = null;
    }
  },

  clearConsentedHosts() {
    localStorage.removeItem(this.consentedHostsKey);
    window.App?.showToast('已清除 OSRM 外部服務授權記錄', 'info');
  },

  // =========================================================================
  // OPERATION LIFECYCLE & HTTP REQUESTS (BOUNDED RETRIES)
  // =========================================================================

  beginOperation(name) {
    this.operationController?.abort();
    this.operationController = new AbortController();
    this.activeOperation = name;
    this.isBusy = true;
    this.renderControls();
    return this.operationController.signal;
  },

  finishOperation() {
    this.operationController = null;
    this.activeOperation = '';
    this.isBusy = false;
    this.renderControls();
  },

  cancelOperation() {
    if (!this.operationController) return;
    this.operationController.abort();
    this.setStatus('正在取消計算作業…', 'is-busy');
    window.App?.showToast('已請求取消計算', 'info');
  },

  isAbortError(error) {
    return error?.name === 'AbortError' || /取消|aborted/i.test(String(error?.message || ''));
  },

  abortableSleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('使用者已取消作業', 'AbortError'));
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('使用者已取消作業', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  },

  async requestJson(url, options = {}) {
    const label = options.label || 'OSRM';
    const parentSignal = options.signal || this.operationController?.signal;
    const maxRetries = typeof options.retries === 'number' ? options.retries : this.requestRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (parentSignal?.aborted) throw new DOMException('使用者已取消作業', 'AbortError');

      const controller = new AbortController();
      let timedOut = false;
      const onParentAbort = () => controller.abort();
      parentSignal?.addEventListener('abort', onParentAbort, { once: true });

      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.requestTimeoutMs);

      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
          cache: 'no-store'
        });

        if (!response.ok) {
          const status = response.status;
          const isRetryable = [429, 502, 503, 504].includes(status);

          if (isRetryable && attempt < maxRetries) {
            let delayMs = 500 * Math.pow(2, attempt);
            const retryAfter = response.headers.get('Retry-After');
            if (retryAfter) {
              const parsedSec = parseInt(retryAfter, 10);
              if (!isNaN(parsedSec) && parsedSec > 0) {
                delayMs = Math.min(parsedSec * 1000, 5000);
              }
            }
            this.setStatus(`${label}：遇到 HTTP ${status}，正在重試第 ${attempt + 1} 次（等待 ${Math.round(delayMs)}ms）…`, 'is-busy');
            await this.abortableSleep(delayMs, parentSignal);
            continue;
          }

          let msg = `${label} HTTP ${status}`;
          if (status === 400) msg = `${label} 參數錯誤 (HTTP 400)：請確認點位座標是否在服務圖台範圍內。`;
          else if (status === 404) msg = `${label} 找不到服務端點 (HTTP 404)：請確認交通模式（${this.osrmProfile}）是否獲該服務支援。`;
          else if (status === 429) msg = `${label} 服務請求過於頻繁 (HTTP 429)：公開 OSRM 限制呼叫速率，請稍候重試。`;
          else if (status >= 500) msg = `${label} 伺服器內部錯誤 (HTTP ${status})：服務暫時無法回應。`;

          const err = new Error(msg);
          err.status = status;
          throw err;
        }

        return await response.json();
      } catch (error) {
        if (parentSignal?.aborted) throw new DOMException('使用者已取消作業', 'AbortError');
        if (error.status && [400, 401, 403, 404].includes(error.status)) throw error;

        if (attempt < maxRetries && !this.isAbortError(error)) {
          const delayMs = 500 * Math.pow(2, attempt);
          this.setStatus(`${label}：連線或逾時異常，正在重試第 ${attempt + 1} 次…`, 'is-busy');
          await this.abortableSleep(delayMs, parentSignal);
          continue;
        }

        if (timedOut) throw new Error(`${label} 請求逾時（超過 ${this.requestTimeoutMs / 1000} 秒未回應）`);
        if (error instanceof TypeError && !navigator.onLine) throw new Error('網路連線已中斷，無法連接 OSRM 服務。');
        throw error;
      } finally {
        window.clearTimeout(timeout);
        parentSignal?.removeEventListener('abort', onParentAbort);
      }
    }
  },

  async testService() {
    if (this.isBusy) return;
    const signal = this.beginOperation('test');
    this.setServiceStatus('測試連線中…', 'is-testing');
    this.setStatus('正在測試 OSRM 服務連線與交通模式…', 'is-busy');

    try {
      const testPoint = this.points[0] || { lat: 25.0478, lng: 121.5170 };
      await this.ensureOsrmConsent(1);
      const url = `${this.osrmBaseUrl}/nearest/v1/${this.osrmProfile}/${testPoint.lng},${testPoint.lat}?number=1`;
      const startedAt = performance.now();
      const data = await this.requestJson(url, { label: 'OSRM 測試', signal });

      if (data.code !== 'Ok' || !data.waypoints?.length) {
        throw new Error(data.message || data.code || '服務未回傳可用道路');
      }
      const elapsed = Math.round(performance.now() - startedAt);
      this.setServiceStatus(`連線正常 · ${elapsed}ms · ${this.getTransportLabel(this.osrmProfile)}`, 'is-ok');
      this.setStatus('OSRM 服務連線測試成功，可正常計算路網。');
      window.App?.showToast('OSRM 服務連線正常', 'success');
    } catch (error) {
      if (this.isAbortError(error)) {
        this.setServiceStatus('測試已取消', 'is-unknown');
        this.setStatus('已取消服務測試。');
      } else {
        this.setServiceStatus(`測試失敗：${error.message}`, 'is-error');
        this.setStatus(`OSRM 測試失敗：${error.message}`, 'is-error');
        window.App?.showToast(`OSRM 測試失敗：${error.message}`, 'error');
      }
    } finally {
      this.finishOperation();
    }
  },

  getTransportLabel(profile = this.osrmProfile) {
    return ({ driving: '汽車', cycling: '自行車', walking: '步行' })[profile] || profile;
  },

  getFallbackSpeedKph(profile = this.osrmProfile) {
    return ({ driving: 50, cycling: 15, walking: 5 })[profile] || 50;
  },

  // =========================================================================
  // PANEL & MAP INTERACTIONS (LEAFLET WARNING ELIMINATION)
  // =========================================================================

  toggle() {
    if (!this.map || !this.panel) return;
    this.isActive = !this.isActive;
    this.panel.style.display = this.isActive ? 'block' : 'none';
    this.map.getContainer().classList.toggle('map-routing-mode', this.isActive);

    this.map.off('click', this.handleMapClick);

    if (this.isActive) {
      if (typeof TGOSAddressManager !== 'undefined' && TGOSAddressManager.isActive) TGOSAddressManager.close();
      if (typeof GeoprocessingManager !== 'undefined' && GeoprocessingManager.isActive) GeoprocessingManager.close();
      this.disableMapEditingModes();
      this.map.on('click', this.handleMapClick);
      this.setStatus('在地圖上依序點擊加入起點、停靠點與終點；或由上方按鈕匯入點位。');
    } else {
      this.inputMode = 'stops';
    }
    this.render();
  },

  disableMapEditingModes() {
    if (!this.map?.pm) return;
    try {
      if (this.map.pm.drawing?.()) this.map.pm.disableDraw();
      if (this.map.pm.globalEditModeEnabled?.()) this.map.pm.disableGlobalEditMode();
      if (this.map.pm.globalDragModeEnabled?.()) this.map.pm.disableGlobalDragMode();
      if (this.map.pm.globalRemovalModeEnabled?.()) this.map.pm.disableGlobalRemovalMode();
      if (this.map.pm.globalRotateModeEnabled?.()) this.map.pm.disableGlobalRotateMode();
      if (this.map.pm.globalCutModeEnabled?.()) this.map.pm.disableGlobalCutMode();
    } catch (_) {}
  },

  handleMapClick(event) {
    if (!this.isActive || this.isBusy) return;
    if (this.inputMode === 'barriers') {
      this.addBarrier(event.latlng);
      return;
    }
    if (this.points.length >= this.maxPoints) {
      window.App?.showToast(`分析點位已達 ${this.maxPoints} 點上限`, 'warning');
      return;
    }

    const lat = Number(event.latlng.lat);
    const lng = Number(event.latlng.lng);
    const newId = this.generateId('rp');
    const pointCount = this.points.length;
    const mode = this.getMode();

    let role = 'stop';
    if (!this.hasStartPoint()) {
      role = 'start';
    } else if (mode === 'open' && !this.hasEndPoint()) {
      role = 'end';
    }

    this.points.push({
      id: newId,
      lat,
      lng,
      name: `點位 ${pointCount + 1}`,
      role,
      originalIndex: pointCount + 1
    });

    this.markRouteOutdated();
    this.resetPointValidation();
    this.render();
    window.SafetyManager?.recordChange('新增路網分析點');
  },

  toggleBarrierMode() {
    if (this.isBusy) return;
    this.inputMode = this.inputMode === 'barriers' ? 'stops' : 'barriers';
    if (this.inputMode === 'barriers') {
      this.setStatus('請點擊地圖任意位置新增圓形屏障；再次點擊按鈕結束。', 'is-busy');
      this.toggleAccordion('barriers');
    } else {
      this.setStatus('已離開屏障新增模式。');
    }
    this.renderControls();
  },

  addBarrier(latlng) {
    if (this.barriers.length >= this.maxBarriers) {
      window.App?.showToast(`屏障數量已達 ${this.maxBarriers} 個上限`, 'warning');
      this.inputMode = 'stops';
      this.renderControls();
      return;
    }

    const radiusEl = document.getElementById('routing-barrier-radius');
    const radius = Math.min(this.maxBarrierRadius, Math.max(10, Number(radiusEl?.value) || 100));

    const newBarrier = {
      id: this.generateId('rb'),
      name: `屏障 #${this.barriers.length + 1}`,
      lat: Number(latlng.lat),
      lng: Number(latlng.lng),
      radius,
      enabled: true
    };

    this.barriers.push(newBarrier);
    this.markRouteOutdated();
    this.render();
    window.SafetyManager?.recordChange('新增路網屏障');
    window.App?.showToast(`已新增 ${radius}m 圓形屏障`, 'success');
  },

  // =========================================================================
  // POINT ROLE MANAGEMENT & LIST OPERATIONS
  // =========================================================================

  normalizePoint(point, index) {
    if (!point.id) point.id = this.generateId('rp');
    point.lat = Number(point.lat);
    point.lng = Number(point.lng);
    point.name = String(point.name || `點位 ${index + 1}`).trim();
    if (!['start', 'stop', 'end'].includes(point.role)) point.role = 'stop';
    if (typeof point.originalIndex !== 'number') point.originalIndex = index + 1;
  },

  hasStartPoint() {
    return this.points.some(p => p.role === 'start');
  },

  hasEndPoint() {
    return this.points.some(p => p.role === 'end');
  },

  getStartPoint() {
    return this.points.find(p => p.role === 'start') || null;
  },

  getEndPoint() {
    return this.points.find(p => p.role === 'end') || null;
  },

  setStartPoint(pointId) {
    if (this.isBusy) return;
    this.points.forEach(p => {
      if (p.id === pointId) {
        p.role = 'start';
      } else if (p.role === 'start') {
        p.role = 'stop';
      }
    });
    this.markRouteOutdated();
    this.render();
    window.SafetyManager?.recordChange('指定起點');
  },

  setEndPoint(pointId) {
    if (this.isBusy) return;
    const mode = this.getMode();
    if (mode !== 'open') {
      window.App?.showToast('僅開放路徑支援設定終點', 'warning');
      return;
    }
    this.points.forEach(p => {
      if (p.id === pointId) {
        p.role = 'end';
      } else if (p.role === 'end') {
        p.role = 'stop';
      }
    });
    this.markRouteOutdated();
    this.render();
    window.SafetyManager?.recordChange('指定終點');
  },

  demoteToStop(pointId) {
    if (this.isBusy) return;
    const point = this.points.find(p => p.id === pointId);
    if (!point || point.role === 'stop') return;
    point.role = 'stop';
    this.markRouteOutdated();
    this.render();
    window.SafetyManager?.recordChange('降級為停靠點');
  },

  syncRoleConstraints() {
    const mode = this.getMode();
    let starts = this.points.filter(p => p.role === 'start');
    if (starts.length > 1) {
      starts.slice(1).forEach(p => { p.role = 'stop'; });
    }
    if (mode === 'roundtrip') {
      this.points.filter(p => p.role === 'end').forEach(p => { p.role = 'stop'; });
    } else {
      let ends = this.points.filter(p => p.role === 'end');
      if (ends.length > 1) {
        ends.slice(1).forEach(p => { p.role = 'stop'; });
      }
    }
  },

  normalizeStartEndPositions() {
    if (this.points.length < 2) return;
    const mode = this.getMode();
    const start = this.getStartPoint();
    const end = this.getEndPoint();

    if (!start) {
      window.App?.showToast('請先指定起點', 'warning');
      return;
    }

    const newPoints = [];
    newPoints.push(start);

    const stops = this.points.filter(p => p.id !== start.id && (!end || p.id !== end.id));
    newPoints.push(...stops);

    if (mode === 'open' && end && end.id !== start.id) {
      newPoints.push(end);
    }

    this.points = newPoints;
    this.markRouteOutdated();
    this.render();
    window.App?.showToast('已將起點移至首位、終點移至末位', 'success');
    window.SafetyManager?.recordChange('調整起終點至清單首尾');
  },

  reversePoints() {
    if (this.isBusy || this.points.length < 2) return;
    this.points.reverse();
    const mode = this.getMode();
    if (mode === 'open') {
      this.points.forEach(p => {
        if (p.role === 'start') p.role = 'end';
        else if (p.role === 'end') p.role = 'start';
      });
    }
    this.markRouteOutdated();
    this.render();
    window.SafetyManager?.recordChange('反轉路網點位順序');
    window.App?.showToast('點位順序已反轉', 'info');
  },

  removeDuplicatePoints() {
    if (this.isBusy || this.points.length < 2) return;
    const initial = this.points.length;
    const retained = [];
    this.points.forEach(p => {
      const isDuplicate = retained.some(ex => this.pointDistance(p, ex) < 1.0);
      if (!isDuplicate) retained.push(p);
    });

    const removedCount = initial - retained.length;
    if (removedCount > 0) {
      this.points = retained;
      this.markRouteOutdated();
      this.resetPointValidation();
      this.render();
      window.SafetyManager?.recordChange('移除重複路網點位');
      window.App?.showToast(`已移除 ${removedCount} 個距離小於 1 公尺的重複點位`, 'success');
    } else {
      window.App?.showToast('未發現距離小於 1 公尺的重複點位', 'info');
    }
  },

  clearPoints() {
    if (this.isBusy || !this.points.length) return;
    if (!confirm('確定要清空所有分析點位嗎？')) return;
    this.points = [];
    this.markRouteOutdated();
    this.resetPointValidation();
    this.render();
    window.SafetyManager?.recordChange('清空路網點位');
    window.App?.showToast('已清空全部分析點位', 'info');
  },

  removePoint(pointId) {
    if (this.isBusy) return;
    const idx = this.points.findIndex(p => p.id === pointId);
    if (idx === -1) return;
    const removed = this.points.splice(idx, 1)[0];
    this.markRouteOutdated();
    this.resetPointValidation();
    this.render();
    window.SafetyManager?.recordChange(`刪除路網點位「${removed.name}」`);
    window.App?.showToast(`已刪除「${removed.name}」`, 'info');
  },

  locatePoint(pointId) {
    const point = this.points.find(p => p.id === pointId);
    if (!point || !this.map) return;
    this.map.setView([point.lat, point.lng], Math.max(this.map.getZoom(), 16), { animate: true });
  },

  updatePointName(pointId, newName) {
    const point = this.points.find(p => p.id === pointId);
    if (!point) return;
    const clean = String(newName || '').trim();
    if (clean && clean !== point.name) {
      point.name = clean;
      window.SafetyManager?.recordChange(`重新命名點位為「${clean}」`);
    }
  },

  // =========================================================================
  // DRAG & DROP LIST REORDERING
  // =========================================================================

  handlePointPointerDown(e, pointId, rowEl) {
    if (this.isBusy || (e.button !== undefined && e.button !== 0)) return;
    this.draggedPointId = pointId;
    rowEl.classList.add('is-dragging');
  },

  handlePointPointerMove(e) {
    if (!this.draggedPointId) return;
    const targetRow = document.elementFromPoint(e.clientX, e.clientY)?.closest('.routing-stop-row');
    document.querySelectorAll('.routing-stop-row.is-drag-over').forEach(el => el.classList.remove('is-drag-over'));
    if (targetRow && targetRow.dataset.pointId !== this.draggedPointId) {
      targetRow.classList.add('is-drag-over');
    }
  },

  handlePointPointerUp(e) {
    if (!this.draggedPointId) return;
    const draggedId = this.draggedPointId;
    this.draggedPointId = null;

    document.querySelectorAll('.routing-stop-row.is-dragging').forEach(el => el.classList.remove('is-dragging'));
    const targetRow = document.elementFromPoint(e.clientX, e.clientY)?.closest('.routing-stop-row');
    document.querySelectorAll('.routing-stop-row.is-drag-over').forEach(el => el.classList.remove('is-drag-over'));

    if (!targetRow || targetRow.dataset.pointId === draggedId) return;

    const fromIdx = this.points.findIndex(p => p.id === draggedId);
    const toIdx = this.points.findIndex(p => p.id === targetRow.dataset.pointId);

    if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
      const moved = this.points.splice(fromIdx, 1)[0];
      this.points.splice(toIdx, 0, moved);
      this.markRouteOutdated();
      this.render();
      window.SafetyManager?.recordChange('拖曳調整路網點位順序');
    }
  },

  // =========================================================================
  // BARRIERS MANAGEMENT
  // =========================================================================

  removeBarrier(barrierId) {
    if (this.isBusy) return;
    const idx = this.barriers.findIndex(b => b.id === barrierId);
    if (idx === -1) return;
    this.barriers.splice(idx, 1);
    this.markRouteOutdated();
    this.render();
    window.SafetyManager?.recordChange('刪除屏障');
    window.App?.showToast('已刪除屏障', 'info');
  },

  toggleBarrierEnabled(barrierId) {
    if (this.isBusy) return;
    const b = this.barriers.find(item => item.id === barrierId);
    if (!b) return;
    b.enabled = b.enabled === false ? true : false;
    this.markRouteOutdated();
    this.render();
    window.SafetyManager?.recordChange(`${b.enabled ? '啟用' : '停用'}屏障`);
  },

  updateBarrierRadius(barrierId, radius) {
    const b = this.barriers.find(item => item.id === barrierId);
    if (!b) return;
    const r = Math.min(this.maxBarrierRadius, Math.max(10, Number(radius) || 100));
    if (b.radius !== r) {
      b.radius = r;
      this.markRouteOutdated();
      this.render();
      window.SafetyManager?.recordChange('修改屏障半徑');
    }
  },

  updateBarrierName(barrierId, newName) {
    const b = this.barriers.find(item => item.id === barrierId);
    if (!b) return;
    const clean = String(newName || '').trim();
    if (clean && clean !== b.name) {
      b.name = clean;
      window.SafetyManager?.recordChange(`修改屏障名稱為「${clean}」`);
    }
  },

  locateBarrier(barrierId) {
    const b = this.barriers.find(item => item.id === barrierId);
    if (!b || !this.map) return;
    this.map.setView([b.lat, b.lng], Math.max(this.map.getZoom(), 16), { animate: true });
  },

  // =========================================================================
  // FILE IMPORT (AUTOMATIC ROLE ASSIGNMENT & APPEND ROLE RESOLUTION)
  // =========================================================================

  openPointFile() {
    if (this.isBusy) return;
    document.getElementById('routing-point-file-input')?.click();
  },

  async importPointFile(file) {
    try {
      const fileName = file.name;
      const lower = fileName.toLowerCase();
      let geojson = null;
      let crsInfo = { crs: 'EPSG:4326', warning: '' };

      if (lower.endsWith('.geojson') || lower.endsWith('.json')) {
        geojson = await IOManager.parseGeoJSON(await file.text());
      } else if (lower.endsWith('.kml')) {
        geojson = await IOManager.parseKML(await file.text());
      } else if (lower.endsWith('.kmz')) {
        geojson = await IOManager.parseKMZ(await file.arrayBuffer());
      } else if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
        const text = await file.text();
        const parsed = await IOManager.parseCSV(text);
        geojson = parsed.geojson;
        crsInfo = parsed.crsInfo || crsInfo;
      } else if (lower.endsWith('.zip')) {
        const parsed = await IOManager.parseSHP(await file.arrayBuffer());
        geojson = parsed.geojson;
        crsInfo = parsed.crsInfo || crsInfo;
      } else {
        throw new Error('不支援的檔案格式，請匯入 .zip(SHP)、.kml、.kmz、.geojson 或 .csv 檔案。');
      }

      if (!geojson) throw new Error('檔案解析結果為空');

      this.pendingFileImport = {
        fileName,
        geojson,
        crsInfo,
        availableFields: this.getAvailablePropertyFields(geojson),
        previewPoints: [],
        resolvedExistingPoints: [],
        resolvedNewPoints: []
      };

      this.showFilePreviewModal();
    } catch (error) {
      window.App?.showToast(`匯入點位失敗：${error.message}`, 'error');
    }
  },

  showFilePreviewModal() {
    const pending = this.pendingFileImport;
    if (!pending) return;

    const modal = document.getElementById('routing-shp-preview-modal');
    if (!modal) return;

    document.getElementById('routing-shp-preview-filename').textContent = pending.fileName;

    const populateSelect = (id, options, defaultVal) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.replaceChildren();
      options.forEach(opt => {
        const optEl = document.createElement('option');
        optEl.value = opt.value;
        optEl.textContent = opt.label;
        if (opt.value === defaultVal) optEl.selected = true;
        el.appendChild(optEl);
      });
    };

    const nameOptions = [{ value: '__auto__', label: '自動偵測 (名稱/Name/ID/序號)' }]
      .concat(pending.availableFields.map(f => ({ value: f, label: f })));
    populateSelect('routing-shp-name-field', nameOptions, '__auto__');

    const orderOptions = [{ value: '__source__', label: '依檔案原始順序' }]
      .concat(pending.availableFields.map(f => ({ value: f, label: `依欄位「${f}」排序` })));
    populateSelect('routing-shp-order-field', orderOptions, '__source__');

    const roleOptions = [{ value: '__none__', label: '自動指定 (首點起點、末點終點)' }]
      .concat(pending.availableFields.map(f => ({ value: f, label: `依欄位「${f}」(start/stop/end)` })));
    populateSelect('routing-shp-role-field', roleOptions, '__none__');

    const truncBox = document.getElementById('routing-shp-truncate-check');
    if (truncBox) truncBox.checked = false;

    this.updateFilePreview();
    modal.classList.add('active');
    if (window.lucide) window.lucide.createIcons();
  },

  normalizeRolesForList(list, mode) {
    if (!list || !list.length) return list;
    if (list.length === 1) {
      list[0].role = 'start';
      return list;
    }
    list[0].role = 'start';
    if (mode === 'open') {
      list[list.length - 1].role = 'end';
      for (let i = 1; i < list.length - 1; i++) {
        list[i].role = 'stop';
      }
    } else {
      for (let i = 1; i < list.length; i++) {
        list[i].role = 'stop';
      }
    }
    return list;
  },

  resolveRolesForCombined(combined, mode, conflictResolution) {
    if (!combined || !combined.length) return combined;
    if (combined.length === 1) {
      combined[0].role = 'start';
      return combined;
    }

    if (conflictResolution === 'keep-first') {
      let firstStartSeen = false;
      let firstEndSeen = false;
      combined.forEach(p => {
        if (p.role === 'start') {
          if (firstStartSeen) p.role = 'stop';
          else firstStartSeen = true;
        } else if (p.role === 'end') {
          if (mode === 'open') {
            if (firstEndSeen) p.role = 'stop';
            else firstEndSeen = true;
          } else {
            p.role = 'stop';
          }
        }
      });
    } else {
      let lastStartIdx = -1;
      let lastEndIdx = -1;
      combined.forEach((p, idx) => {
        if (p.role === 'start') lastStartIdx = idx;
        if (p.role === 'end') lastEndIdx = idx;
      });
      combined.forEach((p, idx) => {
        if (p.role === 'start' && idx !== lastStartIdx) p.role = 'stop';
        if (p.role === 'end') {
          if (mode === 'open') {
            if (idx !== lastEndIdx) p.role = 'stop';
          } else {
            p.role = 'stop';
          }
        }
      });
    }

    if (mode === 'roundtrip') {
      combined.forEach(p => {
        if (p.role === 'end') p.role = 'stop';
      });
    }

    return combined;
  },

  updateFilePreview() {
    const pending = this.pendingFileImport;
    if (!pending) return;

    const orderField = document.getElementById('routing-shp-order-field')?.value || '__source__';
    const nameField = document.getElementById('routing-shp-name-field')?.value || '__auto__';
    const roleField = document.getElementById('routing-shp-role-field')?.value || '__none__';
    const importMode = document.getElementById('routing-shp-import-mode')?.value || 'replace';
    const conflictResolution = document.getElementById('routing-shp-conflict-resolution')?.value || 'keep-first';
    const mode = this.getMode();

    const extraction = this.extractRoutePoints(pending.geojson, orderField, nameField, roleField, mode);
    const baseCount = importMode === 'replace' ? 0 : this.points.length;
    const totalPotential = baseCount + extraction.points.length;
    const isExceeded = totalPotential > this.maxPoints;

    // Truncate to maximum allowed points if exceeded
    const maxAllowed = Math.max(0, this.maxPoints - baseCount);
    let effectiveNew = isExceeded
      ? extraction.points.slice(0, maxAllowed)
      : extraction.points.slice();

    if (isExceeded && importMode === 'replace') {
      this.normalizeRolesForList(effectiveNew, mode);
    }

    // Build virtual combined list with clones (strictly preserves immutability of this.points)
    const virtualExisting = importMode === 'append'
      ? this.points.map(p => ({ ...p, isNew: false }))
      : [];
    const virtualNew = effectiveNew.map(p => ({ ...p, isNew: true }));
    let combined = virtualExisting.concat(virtualNew);

    if (importMode === 'append') {
      this.resolveRolesForCombined(combined, mode, conflictResolution);
    } else if (!isExceeded) {
      this.resolveRolesForCombined(combined, mode, conflictResolution);
    }

    pending.resolvedExistingPoints = combined.filter(p => !p.isNew);
    pending.resolvedNewPoints = combined.filter(p => p.isNew !== false);
    pending.previewPoints = pending.resolvedNewPoints;

    const totalStarts = combined.filter(p => p.role === 'start').length;
    const totalEnds = combined.filter(p => p.role === 'end').length;
    const totalStops = combined.filter(p => p.role === 'stop').length;

    const roleSummaryEl = document.getElementById('routing-shp-role-summary');
    if (roleSummaryEl) {
      roleSummaryEl.textContent = `角色統計：起點 ${totalStarts} 個、終點 ${totalEnds} 個、停靠點 ${totalStops} 個${importMode === 'append' ? '（含現有點位）' : ''}`;
    }

    const starts = combined.filter(p => p.role === 'start');
    const ends = combined.filter(p => p.role === 'end');
    const hasRoleConflict = starts.length > 1 || (mode === 'open' && ends.length > 1);

    const conflictContainer = document.getElementById('routing-shp-conflict-container');
    if (conflictContainer) {
      conflictContainer.style.display = (importMode === 'append' || hasRoleConflict) ? 'block' : 'none';
    }

    const summary = document.getElementById('routing-shp-preview-summary');
    if (summary) {
      summary.replaceChildren();
      const createItem = (lbl, val) => {
        const item = document.createElement('div');
        item.className = 'import-summary-item';
        const span = document.createElement('span');
        span.textContent = lbl;
        const strong = document.createElement('strong');
        strong.textContent = String(val);
        item.append(span, strong);
        return item;
      };
      summary.append(
        createItem('圖層幾何', `${extraction.points.length} 個點位`),
        createItem('CRS 投影', pending.crsInfo?.crs || 'EPSG:4326'),
        createItem('非點幾何', `${extraction.nonPointCount} 筆略過`),
        createItem('加入後總點數', `${totalPotential} 點`)
      );
    }

    const overflowBox = document.getElementById('routing-shp-overflow-container');
    const truncateCheck = document.getElementById('routing-shp-truncate-check');
    if (overflowBox) overflowBox.style.display = isExceeded ? 'block' : 'none';

    // Strict textContent sanitization for warning messages (XSS Prevention)
    const warning = document.getElementById('routing-shp-preview-warning');
    if (warning) {
      warning.replaceChildren();
      const warningMessages = [];
      if (pending.crsInfo?.warning) warningMessages.push(pending.crsInfo.warning);
      if (extraction.nonPointCount > 0) {
        warningMessages.push(`⚠️ 檔案中含有 ${extraction.nonPointCount} 個非點圖徵（如線段、多邊形），系統已略過，絕不轉為中心點。`);
      }
      if (extraction.invalidCoordCount > 0) {
        warningMessages.push(`⚠️ 另有 ${extraction.invalidCoordCount} 筆資料之經緯度座標超出合理範圍，已略過。`);
      }
      if (isExceeded) {
        warningMessages.push(`⚠️ 匯入後點位達 ${totalPotential} 點，超過 ${this.maxPoints} 點上限！請勾選同意僅載入前 200 點，或取消匯入。`);
      }
      if (isExceeded && mode === 'open' && importMode === 'replace' && extraction.points.length > this.maxPoints) {
        warningMessages.push('資料截斷後，系統將以第 200 點重新指定為終點');
      }
      if (hasRoleConflict) {
        warningMessages.push(`⚠️ 角色包含多個起點或終點，系統已依據策略「${conflictResolution === 'keep-first' ? '保留首項' : '保留末項'}」調整點位角色。`);
      }
      if (totalStarts === 0) {
        warningMessages.push('⚠️ 匯入後無起點，需手動指定起點後方能進行路網分析。');
      }
      if (mode === 'open' && totalEnds === 0 && totalPotential >= 2) {
        warningMessages.push('⚠️ 匯入後無終點，需手動指定終點後方能進行路網分析。');
      }

      if (warningMessages.length) {
        warning.hidden = false;
        warningMessages.forEach(msg => {
          const p = document.createElement('p');
          p.style.margin = '2px 0';
          p.textContent = msg;
          warning.appendChild(p);
        });
      } else {
        warning.hidden = true;
      }
    }

    this.renderFilePreviewList(pending.resolvedNewPoints, baseCount);

    const confirmBtn = document.getElementById('btn-confirm-routing-shp-import');
    if (confirmBtn) {
      if (isExceeded && !truncateCheck?.checked) {
        confirmBtn.disabled = true;
        confirmBtn.title = '點位超過 200 點上限，需勾選同意僅載入前 200 點';
      } else {
        confirmBtn.disabled = pending.resolvedNewPoints.length === 0;
        confirmBtn.title = '';
      }
    }
  },

  renderFilePreviewList(points, baseCount) {
    const list = document.getElementById('routing-shp-preview-list');
    if (!list) return;
    list.replaceChildren();

    const displayLimit = 200;
    points.slice(0, displayLimit).forEach((point, index) => {
      const row = document.createElement('div');
      row.className = 'routing-shp-preview-row';

      const number = document.createElement('span');
      number.textContent = String(baseCount + index + 1);

      const main = document.createElement('div');
      main.style.display = 'flex';
      main.style.alignItems = 'center';
      main.style.gap = '6px';
      main.style.overflow = 'hidden';

      const name = document.createElement('strong');
      name.textContent = point.name;

      if (point.role === 'start') {
        const b = document.createElement('span');
        b.className = 'routing-role-badge is-start';
        b.textContent = '起點';
        main.append(name, b);
      } else if (point.role === 'end') {
        const b = document.createElement('span');
        b.className = 'routing-role-badge is-end';
        b.textContent = '終點';
        main.append(name, b);
      } else {
        main.appendChild(name);
      }

      const coordinate = document.createElement('code');
      coordinate.textContent = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;

      row.append(number, main, coordinate);
      list.appendChild(row);
    });

    if (points.length > displayLimit) {
      const more = document.createElement('div');
      more.className = 'routing-shp-preview-more';
      more.textContent = `…另有 ${points.length - displayLimit} 筆未列出`;
      list.appendChild(more);
    }
  },

  confirmFileImport() {
    const pending = this.pendingFileImport;
    if (!pending) return;

    const importMode = document.getElementById('routing-shp-import-mode')?.value || 'replace';
    const truncateCheck = document.getElementById('routing-shp-truncate-check');
    const mode = this.getMode();
    const baseCount = importMode === 'replace' ? 0 : this.points.length;
    const conflictResolution = document.getElementById('routing-shp-conflict-resolution')?.value || 'keep-first';
    let newPointsToImport = pending.resolvedNewPoints.slice();

    if (baseCount + newPointsToImport.length > this.maxPoints) {
      if (!truncateCheck?.checked) {
        window.App?.showToast(`點數超過 ${this.maxPoints} 點上限，已取消匯入`, 'warning');
        return;
      }
      newPointsToImport = newPointsToImport.slice(0, this.maxPoints - baseCount);
      if (importMode === 'replace') {
        this.normalizeRolesForList(newPointsToImport, mode);
      }
    }

    if (!newPointsToImport.length) return;

    this.markRouteOutdated();
    this.resetPointValidation();

    if (importMode === 'replace') {
      this.points = newPointsToImport;
    } else {
      // Append mode: update existing points with resolved roles (e.g. keep-last demoted old start/end)
      if (pending.resolvedExistingPoints && pending.resolvedExistingPoints.length === this.points.length) {
        this.points = pending.resolvedExistingPoints.concat(newPointsToImport);
      } else {
        const combined = this.points.concat(newPointsToImport);
        this.resolveRolesForCombined(combined, mode, conflictResolution);
        this.points = combined;
      }
    }

    this.syncRoleConstraints();

    const bounds = L.latLngBounds(this.points.map(p => [p.lat, p.lng]));
    this.cancelFileImport();
    this.render();

    if (bounds.isValid() && this.map) {
      this.map.fitBounds(bounds.pad(0.15), { maxZoom: 16 });
    }

    this.setStatus(`成功自「${pending.fileName}」匯入 ${newPointsToImport.length} 個點位。`);
    window.App?.showToast(`成功加入 ${newPointsToImport.length} 個路網分析點`, 'success');
    window.SafetyManager?.recordChange('匯入路網點位');
  },

  cancelFileImport() {
    document.getElementById('routing-shp-preview-modal')?.classList.remove('active');
    this.pendingFileImport = null;
  },

  getAvailablePropertyFields(geojson) {
    const fields = new Set();
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    features.forEach(feat => {
      Object.keys(feat.properties || {}).forEach(key => {
        if (!['style', '_measure'].includes(key)) fields.add(key);
      });
    });
    return Array.from(fields).sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
  },

  // Extraction with strict order, non-point filtering, and auto-role assignment (start, end, stops)
  extractRoutePoints(geojson, orderField = '__source__', nameField = '__auto__', roleField = '__none__', mode = this.getMode()) {
    let nonPointCount = 0;
    let invalidCoordCount = 0;
    const features = Array.isArray(geojson?.features) ? geojson.features : [];

    // Step 1: Sort records by orderField if requested
    const records = features.map((feature, sourceIndex) => ({ feature, sourceIndex }));
    if (orderField !== '__source__') {
      records.sort((a, b) => {
        const va = a.feature?.properties?.[orderField];
        const vb = b.feature?.properties?.[orderField];
        const na = Number(va);
        const nb = Number(vb);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return String(va || '').localeCompare(String(vb || ''), 'zh-Hant', { numeric: true });
      });
    }

    // Step 2: Filter non-point geometries, invalid coordinates, expand MultiPoint
    const points = [];
    records.forEach(({ feature, sourceIndex }) => {
      const geom = feature?.geometry;
      if (!geom) return;

      if (geom.type !== 'Point' && geom.type !== 'MultiPoint') {
        nonPointCount += 1;
        return; // Reject non-point geometries
      }

      const coordsList = geom.type === 'Point' ? [geom.coordinates] : (Array.isArray(geom.coordinates) ? geom.coordinates : []);
      coordsList.forEach((coord, cIdx) => {
        const lng = Number(coord?.[0]);
        const lat = Number(coord?.[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          invalidCoordCount += 1;
          return;
        }

        let name = '';
        if (nameField !== '__auto__' && feature.properties?.[nameField] !== undefined) {
          name = String(feature.properties[nameField]).trim();
        } else {
          name = this.detectFeatureName(feature.properties, sourceIndex, cIdx);
        }

        let explicitRole = 'stop';
        if (roleField !== '__none__' && feature.properties?.[roleField] !== undefined) {
          const rVal = String(feature.properties[roleField]).trim().toLowerCase();
          if (rVal === 'start' || rVal === '起點') explicitRole = 'start';
          else if (rVal === 'end' || rVal === '終點') explicitRole = 'end';
        }

        points.push({
          id: this.generateId('rp'),
          lat,
          lng,
          name,
          role: explicitRole,
          originalIndex: points.length + 1
        });
      });
    });

    // Step 3: Automatic Role Assignment when no role field is provided
    if (roleField === '__none__') {
      if (points.length === 1) {
        points[0].role = 'start';
      } else if (points.length >= 2) {
        points[0].role = 'start';
        if (mode === 'open') {
          points[points.length - 1].role = 'end';
          for (let i = 1; i < points.length - 1; i++) {
            points[i].role = 'stop';
          }
        } else {
          for (let i = 1; i < points.length; i++) {
            points[i].role = 'stop';
          }
        }
      }
    }

    return { points, nonPointCount, invalidCoordCount };
  },

  detectFeatureName(props = {}, sourceIndex = 0, coordIndex = 0) {
    const keys = Object.keys(props);
    const preferred = ['name', '名稱', 'title', '標題', 'site', '站名', 'point', 'id', '序號'];
    for (const p of preferred) {
      const match = keys.find(k => k.toLowerCase() === p);
      if (match && props[match] !== undefined && String(props[match]).trim()) {
        const base = String(props[match]).trim();
        return coordIndex > 0 ? `${base}_${coordIndex + 1}` : base;
      }
    }
    return `點位 ${sourceIndex + 1}${coordIndex > 0 ? `_${coordIndex + 1}` : ''}`;
  },

  // =========================================================================
  // ROAD NETWORK PRE-FLIGHT VALIDATION (OSRM NEAREST)
  // =========================================================================

  async fetchPointValidation(signal) {
    const results = new Map();
    for (let i = 0; i < this.points.length; i++) {
      if (signal?.aborted) throw new DOMException('作業已取消', 'AbortError');
      const point = this.points[i];
      const url = `${this.osrmBaseUrl}/nearest/v1/${this.osrmProfile}/${point.lng},${point.lat}?number=1`;

      this.setStatus(`正在驗證點位道路連通性（${i + 1} / ${this.points.length}）…`, 'is-busy');

      try {
        const data = await this.requestJson(url, { label: `驗證點位 #${i + 1}`, signal });
        if (data.code === 'Ok' && data.waypoints?.[0]) {
          const wp = data.waypoints[0];
          const snapDistance = Number(wp.distance) || 0;
          let status = 'ok';
          if (snapDistance >= this.snapErrorDistance) status = 'far';
          else if (snapDistance >= this.snapWarningDistance) status = 'warning';

          results.set(point.id, {
            status,
            snapDistance,
            snappedLat: wp.location?.[1],
            snappedLng: wp.location?.[0],
            roadName: wp.name || ''
          });
        } else {
          results.set(point.id, { status: 'unreachable', snapDistance: Infinity, roadName: '' });
        }
      } catch (err) {
        if (this.isAbortError(err)) throw err;
        results.set(point.id, { status: 'unreachable', snapDistance: Infinity, error: err.message });
      }

      await new Promise(r => setTimeout(r, 0));
    }
    return results;
  },

  applyPointValidation(validationMap) {
    this.points.forEach(p => {
      const v = validationMap.get(p.id);
      if (v) p.validation = v;
    });
  },

  resetPointValidation() {
    this.points.forEach(p => delete p.validation);
    const summary = document.getElementById('routing-validation-summary');
    if (summary) {
      summary.hidden = true;
      summary.textContent = '';
      summary.className = 'routing-validation-summary';
    }
  },

  getValidationSummary() {
    if (!this.points.length || !this.points.every(p => p.validation)) return null;
    return this.points.reduce((acc, p) => {
      if (p.validation.status === 'unreachable') acc.unreachable += 1;
      else if (p.validation.status === 'far') acc.far += 1;
      else if (p.validation.status === 'warning') acc.warning += 1;
      else acc.ok += 1;
      return acc;
    }, { ok: 0, warning: 0, far: 0, unreachable: 0 });
  },

  renderValidationSummary(summary) {
    const el = document.getElementById('routing-validation-summary');
    if (!el || !summary) return;
    el.hidden = false;
    el.className = 'routing-validation-summary';
    if (summary.unreachable + summary.far > 0) el.classList.add('has-error');
    else if (summary.warning > 0) el.classList.add('has-warning');
    el.textContent = `道路檢查結果：可連通 ${summary.ok} 點、需注意 ${summary.warning} 點、過遠 ${summary.far} 點、不可達 ${summary.unreachable} 點。`;
  },

  // =========================================================================
  // ROUTE COMPUTATION (PRESERVING PREVIOUS VALID ROUTE ON FAILURE)
  // =========================================================================

  validateRouteInput(intent = 'calc') {
    const mode = this.getMode();
    const count = this.points.length;
    if (count < 2) return '至少需要 2 個點位方可進行路網分析';

    const starts = this.points.filter(p => p.role === 'start');
    const ends = this.points.filter(p => p.role === 'end');

    if (starts.length !== 1) return '請設定 1 個起點（綠色）';

    if (mode === 'open') {
      if (ends.length !== 1) return '開放路徑需要設定 1 個終點（紅色）';

      if (intent === 'current-order') {
        if (this.points[0].role !== 'start') {
          return '依目前順序計算時，清單首項必須為起點。請拖曳排序或點擊「將起終點移至首尾」。';
        }
        if (this.points[this.points.length - 1].role !== 'end') {
          return '依目前順序計算時，清單末項必須為終點。請拖曳排序或點擊「將起終點移至首尾」。';
        }
        for (let i = 1; i < this.points.length - 1; i++) {
          if (this.points[i].role !== 'stop') {
            return `中途點位「${this.points[i].name}」不可設定為起點或終點。`;
          }
        }
      }
    } else if (mode === 'roundtrip') {
      if (intent === 'current-order' && this.points[0].role !== 'start') {
        return '往返路徑清單首項必須為起點。';
      }
    }

    return null;
  },

  // 1. Calculate strictly following current list order
  async calculateCurrentOrder() {
    if (this.isBusy) return;
    const errorMsg = this.validateRouteInput('current-order');
    if (errorMsg) {
      this.setStatus(errorMsg, 'is-error');
      window.App?.showToast(errorMsg, 'error');
      return;
    }

    const signal = this.beginOperation('calc-current');
    this.setStatus('正在準備依目前清單順序計算路徑…', 'is-busy');

    try {
      await this.ensureOsrmConsent(this.points.length);
      const ordered = this.points.map((p, idx) => ({ ...p, tripIndex: idx }));
      this.setStatus(`正在分段向 OSRM 請求道路路線（共 ${ordered.length} 點）…`, 'is-busy');

      const route = await this.fetchOsrmRouteChunked(ordered, signal, 'current-order');
      this.setServiceStatus(`連線正常 · ${this.getTransportLabel(this.osrmProfile)}`, 'is-ok');

      this.clearFallbackPreview();
      this.showRoute(route);
      this.showResult(route);
      this.toggleAccordion('results');

      if (route.barrierConflicts.length > 0) {
        window.App?.showToast(`路線與 ${route.barrierConflicts.length} 個屏障衝突，禁止保存`, 'error');
      } else {
        window.App?.showToast('路網分析路線計算完成', 'success');
      }
    } catch (error) {
      this.handleRouteError(error);
    } finally {
      this.finishOperation();
      this.render();
    }
  },

  // 2. Optimize order using local 2-Opt or Trip, then calculate route
  async optimize() {
    if (this.isBusy) return;
    const errorMsg = this.validateRouteInput('optimize');
    if (errorMsg) {
      this.setStatus(errorMsg, 'is-error');
      window.App?.showToast(errorMsg, 'error');
      return;
    }

    const signal = this.beginOperation('optimize');
    this.setStatus('正在進行多點最佳化順序運算…', 'is-busy');

    try {
      await this.ensureOsrmConsent(this.points.length);

      let validation = this.getValidationSummary();
      if (!validation) {
        try {
          this.applyPointValidation(await this.fetchPointValidation(signal));
          validation = this.getValidationSummary();
          this.renderValidationSummary(validation);
        } catch (_) {}
      }

      if (validation && (validation.unreachable + validation.far > 0)) {
        this.setStatus(`偵測到 ${validation.far} 個過遠點及 ${validation.unreachable} 個不可達點，停止計算。`, 'is-error');
        window.App?.showToast('請先移除或修正不可達或離道路過遠的點位', 'error');
        return;
      }

      const useLocalTsp = this.points.length > this.maxTripPoints || this.lockStartEnd;
      this.setStatus(useLocalTsp ? '正在執行非同步 2-Opt 最佳化順序…' : '正在向 OSRM Trip 請求最佳順序…', 'is-busy');

      let route = null;
      if (!useLocalTsp && this.points.length <= this.maxTripPoints && !this.lockStartEnd) {
        route = await this.fetchOsrmTrip(signal);
      } else {
        const optimizedOrder = await this.computeLocalOptimizedOrder(signal);
        this.setStatus(`最佳順序運算完成，正在分段取得道路路線（共 ${optimizedOrder.length} 點）…`, 'is-busy');
        route = await this.fetchOsrmRouteChunked(optimizedOrder, signal, 'local-2opt');
      }

      this.setServiceStatus(`連線正常 · ${this.getTransportLabel(this.osrmProfile)}`, 'is-ok');
      this.clearFallbackPreview();
      this.showRoute(route);
      this.showResult(route);
      this.toggleAccordion('results');

      if (route.barrierConflicts.length > 0) {
        window.App?.showToast(`路線與 ${route.barrierConflicts.length} 個屏障衝突，禁止保存`, 'error');
      } else {
        window.App?.showToast('最佳路徑計算完成', 'success');
      }
    } catch (error) {
      this.handleRouteError(error);
    } finally {
      this.finishOperation();
      this.render();
    }
  },

  // Error handler: isolated fallback preview without overwriting currentRoute/routeLayer
  handleRouteError(error) {
    if (this.isAbortError(error)) {
      this.setStatus('已取消計算作業。已保留上次有效狀態。');
      window.App?.showToast('已取消路網計算', 'info');
    } else if (this.fallbackPolicy === 'preview') {
      console.warn('道路服務計算失敗，依照設定顯示獨立直線預覽。', error);
      if (this.currentRoute) {
        this.showResult(this.currentRoute);
      }
      const fallback = this.buildFallbackRoute();
      this.showFallbackPreview(fallback);
      this.setServiceStatus(`道路服務失敗：${error.message}`, 'is-error');
      this.setStatus(`道路服務失敗：${error.message}。目前僅顯示不可保存的直線預覽；上一條有效道路路線仍保留。`, 'is-error');
      window.App?.showToast('道路服務失敗；目前僅顯示不可保存的直線預覽，上一條有效道路路線仍保留', 'warning');
      this.toggleAccordion('results');
    } else {
      console.warn('OSRM 路線計算失敗:', error.message);
      this.setServiceStatus(`無法使用：${error.message}`, 'is-error');
      this.setStatus(`道路路徑計算失敗：${error.message}。已保留上次路線。`, 'is-error');
      window.App?.showToast(`道路路徑計算失敗：${error.message}`, 'error');
    }

    // Refresh UI to display status while keeping previous valid result visible
    if (this.currentRoute && this.fallbackPolicy !== 'preview') {
      this.showResult(this.currentRoute);
    }
  },

  showFallbackPreview(fallback) {
    this.clearFallbackPreview();
    this.fallbackPreviewRoute = fallback;

    if (this.map && fallback?.latlngs?.length >= 2) {
      this.fallbackPreviewLayer = L.polyline(fallback.latlngs, {
        color: '#f97316',
        weight: 4,
        opacity: 0.85,
        dashArray: '8 6',
        className: 'routing-fallback-line',
        interactive: false
      }).addTo(this.map);

      const b = this.fallbackPreviewLayer.getBounds();
      if (b.isValid()) this.map.fitBounds(b.pad(0.12));
    }

    this.renderFallbackPreviewUi();
  },

  clearFallbackPreview() {
    if (this.fallbackPreviewLayer && this.map) {
      this.map.removeLayer(this.fallbackPreviewLayer);
      this.fallbackPreviewLayer = null;
    }
    this.fallbackPreviewRoute = null;
    const notice = document.getElementById('routing-fallback-notice')
      || document.querySelector('.routing-fallback-notice');
    if (notice) notice.remove();
  },

  renderFallbackPreviewUi() {
    const container = document.getElementById('routing-result');
    if (!container) return;

    const oldNotice = container.querySelector('.routing-fallback-notice');
    if (oldNotice) oldNotice.remove();

    const previewNotice = document.createElement('div');
    previewNotice.className = 'routing-fallback-notice';
    previewNotice.id = 'routing-fallback-notice';
    previewNotice.style.cssText = 'padding: 8px 10px; margin-bottom: 8px; background: #fff7ed; border: 1px solid #fdba74; border-radius: 6px; font-size: 0.74rem; color: #9a3412; line-height: 1.4;';

    const titleDiv = document.createElement('div');
    titleDiv.style.fontWeight = '700';
    titleDiv.textContent = this.currentRoute
      ? '⚠️ 本次計算失敗，僅顯示直線近似預覽；上一條有效道路路線仍保留'
      : '⚠️ 本次計算失敗，僅顯示直線近似預覽（不可保存）';
    previewNotice.appendChild(titleDiv);

    const descDiv = document.createElement('div');
    descDiv.style.marginTop = '4px';
    descDiv.textContent = this.currentRoute
      ? '橘色虛線為直線近似預覽，不可保存；地圖上保留上一條有效道路路線。'
      : '目前尚無有效道路分析路線。';
    previewNotice.appendChild(descDiv);

    if (this.currentRoute) {
      container.prepend(previewNotice);
    } else {
      container.replaceChildren(previewNotice);
    }
  },

  // 2-Opt non-blocking asynchronous TSP optimization
  async computeLocalOptimizedOrder(signal) {
    const mode = this.getMode();
    const start = this.getStartPoint();
    const end = this.getEndPoint();
    const stops = this.points.filter(p => p.role === 'stop').map(p => ({ ...p }));

    const ordered = [];
    if (start) ordered.push({ ...start });

    if (mode === 'open') {
      if (this.lockStartEnd && end) {
        this.appendNearestNeighbours(ordered, stops);
        ordered.push({ ...end });
      } else {
        const unvisited = stops.concat(end ? [{ ...end }] : []);
        this.appendNearestNeighbours(ordered, unvisited);
      }
    } else {
      this.appendNearestNeighbours(ordered, stops);
    }

    if (ordered.length >= 4) {
      await this.asyncTwoOpt(ordered, signal, mode === 'open' && this.lockStartEnd);
    }

    ordered.forEach((p, idx) => { p.tripIndex = idx; });
    return ordered;
  },

  appendNearestNeighbours(ordered, unvisited) {
    while (unvisited.length > 0) {
      const current = ordered[ordered.length - 1];
      let nearestIdx = 0;
      let nearestDist = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const d = this.pointDistance(current, unvisited[i]);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }
      ordered.push(unvisited.splice(nearestIdx, 1)[0]);
    }
  },

  async asyncTwoOpt(tour, signal, fixedEnd = true) {
    let improved = true;
    let pass = 0;
    const maxPasses = 50;
    const n = tour.length;
    const endLimit = fixedEnd ? n - 2 : n - 1;
    let iter = 0;

    while (improved && pass < maxPasses) {
      if (signal?.aborted) throw new DOMException('作業已取消', 'AbortError');
      improved = false;
      pass++;

      for (let i = 1; i < endLimit; i++) {
        for (let j = i + 1; j < (fixedEnd ? n - 1 : n); j++) {
          iter++;
          if (iter % 60 === 0) {
            if (signal?.aborted) throw new DOMException('作業已取消', 'AbortError');
            await new Promise(r => setTimeout(r, 0));
          }

          const a = tour[i - 1];
          const b = tour[i];
          const c = tour[j];
          const d = tour[(j + 1) % n];

          const currentD = this.pointDistance(a, b) + this.pointDistance(c, d);
          const newD = this.pointDistance(a, c) + this.pointDistance(b, d);

          if (newD < currentD - 0.5) {
            this.reverseSubarray(tour, i, j);
            improved = true;
          }
        }
      }
    }
  },

  reverseSubarray(arr, start, end) {
    while (start < end) {
      const temp = arr[start];
      arr[start] = arr[end];
      arr[end] = temp;
      start++;
      end--;
    }
  },

  async fetchOsrmTrip(signal) {
    const mode = this.getMode();
    const inputOrder = this.points.map((p, idx) => ({ ...p, inputIndex: idx }));
    const coordinates = inputOrder.map(p => `${p.lng},${p.lat}`).join(';');
    const roundtripParam = mode === 'roundtrip' ? 'true' : 'false';
    const sourceParam = 'first';
    const destinationParam = mode === 'open' ? 'last' : 'any';

    const url = `${this.osrmBaseUrl}/trip/v1/${this.osrmProfile}/${coordinates}?roundtrip=${roundtripParam}&source=${sourceParam}&destination=${destinationParam}&geometries=geojson&overview=full&steps=false`;

    const data = await this.requestJson(url, { label: 'OSRM Trip 最佳化', signal });
    if (data.code !== 'Ok' || !data.trips || !data.trips[0]) {
      throw new Error(data.message || data.code || 'OSRM 未回傳可用路網路徑');
    }

    const trip = data.trips[0];
    const orderedPoints = data.waypoints
      .map((wp, i) => ({
        ...inputOrder[i],
        tripIndex: wp.waypoint_index
      }))
      .sort((a, b) => a.tripIndex - b.tripIndex);

    this.applyOptimizedIndices(orderedPoints);

    return {
      latlngs: trip.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      orderedPoints,
      legs: trip.legs || [],
      distance: Number(trip.distance) || 0,
      duration: Number(trip.duration) || 0,
      mode,
      transportProfile: this.osrmProfile,
      osrmService: this.osrmBaseUrl,
      optimizationMethod: 'OSRM Trip 服務',
      approximate: false,
      computedAt: new Date().toISOString()
    };
  },

  // Complete chunked route result merging (geometry, distance, duration, and all legs)
  async fetchOsrmRouteChunked(routeSequence, signal, methodLabel) {
    const mode = this.getMode();
    const fullSequence = mode === 'roundtrip'
      ? [...routeSequence, { ...routeSequence[0], id: `${routeSequence[0].id}_loop` }]
      : routeSequence.slice();

    const latlngs = [];
    const allLegs = [];
    let distance = 0;
    let duration = 0;
    const totalChunks = Math.ceil((fullSequence.length - 1) / (this.routeChunkSize - 1));
    let chunkIndex = 0;

    for (let offset = 0; offset < fullSequence.length - 1; offset += (this.routeChunkSize - 1)) {
      if (signal?.aborted) throw new DOMException('作業已取消', 'AbortError');
      const chunk = fullSequence.slice(offset, offset + this.routeChunkSize);
      const coordinates = chunk.map(p => `${p.lng},${p.lat}`).join(';');
      const url = `${this.osrmBaseUrl}/route/v1/${this.osrmProfile}/${coordinates}?geometries=geojson&overview=full&steps=false&continue_straight=false`;

      chunkIndex++;
      this.setStatus(`正在取得道路路徑：分段 ${chunkIndex} / ${totalChunks}…`, 'is-busy');

      let data;
      try {
        data = await this.requestJson(url, { label: `OSRM Route 分段 ${chunkIndex}/${totalChunks}`, signal });
      } catch (err) {
        throw new Error(`第 ${chunkIndex}/${totalChunks} 分段請求失敗：${err.message}`);
      }

      if (data.code !== 'Ok' || !data.routes?.[0]) {
        throw new Error(data.message || data.code || `第 ${chunkIndex}/${totalChunks} 分段未回傳可用路徑`);
      }

      const route = data.routes[0];
      const chunkCoords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

      if (latlngs.length > 0 && chunkCoords.length > 0) {
        chunkCoords.shift(); // Avoid duplicate junction coordinate
      }
      latlngs.push(...chunkCoords);

      if (Array.isArray(route.legs)) {
        allLegs.push(...route.legs);
      }

      distance += Number(route.distance) || 0;
      duration += Number(route.duration) || 0;

      await new Promise(r => setTimeout(r, 0));
    }

    this.applyOptimizedIndices(routeSequence);

    return {
      latlngs,
      orderedPoints: routeSequence,
      legs: allLegs,
      distance,
      duration,
      mode,
      transportProfile: this.osrmProfile,
      osrmService: this.osrmBaseUrl,
      optimizationMethod: methodLabel === 'current-order' ? '依目前清單順序' : '本機 2-Opt 最佳化',
      approximate: false,
      computedAt: new Date().toISOString()
    };
  },

  applyOptimizedIndices(orderedPoints) {
    orderedPoints.forEach((optPoint, optIdx) => {
      const match = this.points.find(p => p.id === optPoint.id);
      if (match) match.optimizedIndex = optIdx + 1;
    });
  },

  buildFallbackRoute() {
    const mode = this.getMode();
    const sequence = this.points.map((p, idx) => ({ ...p, tripIndex: idx }));
    const latlngs = sequence.map(p => [p.lat, p.lng]);
    if (mode === 'roundtrip' && sequence.length) {
      latlngs.push([sequence[0].lat, sequence[0].lng]);
    }

    let distance = 0;
    for (let i = 1; i < latlngs.length; i++) {
      distance += this.map ? this.map.distance(latlngs[i - 1], latlngs[i]) : 1000;
    }

    const duration = distance / (this.getFallbackSpeedKph() * 1000 / 3600);
    return {
      latlngs,
      orderedPoints: sequence,
      legs: [],
      distance,
      duration,
      mode,
      transportProfile: this.osrmProfile,
      osrmService: this.osrmBaseUrl,
      optimizationMethod: '直線近似預覽 (無道路服務)',
      approximate: true,
      computedAt: new Date().toISOString()
    };
  },

  // =========================================================================
  // BARRIER DETECTION & MULTI-BARRIER DETOUR PLANNING (>2 BARRIERS SUPPORT)
  // =========================================================================

  evaluateBarrierConflicts(latlngs) {
    if (!this.barriers.length || !Array.isArray(latlngs) || latlngs.length < 2 || typeof turf === 'undefined') {
      return [];
    }

    const activeBarriers = this.barriers.filter(b => b.enabled !== false);
    if (!activeBarriers.length) return [];

    const line = turf.lineString(latlngs.map(([lat, lng]) => [lng, lat]));
    const conflicts = [];

    activeBarriers.forEach((barrier, idx) => {
      try {
        const circlePoly = turf.circle([barrier.lng, barrier.lat], barrier.radius, { units: 'meters' });
        const intersects = turf.booleanIntersects(line, circlePoly);
        if (intersects) {
          conflicts.push({
            id: barrier.id,
            name: barrier.name,
            index: idx + 1,
            lat: barrier.lat,
            lng: barrier.lng,
            radius: barrier.radius
          });
        }
      } catch (err) {
        console.warn('Turf 屏障檢查異常:', err);
      }
    });

    return conflicts;
  },

  // Find exact legs and coordinates on actual road geometry intersecting barriers
  findRoadGeometryBarrierConflicts(route, barriers) {
    if (!route || !route.latlngs || route.latlngs.length < 2 || !barriers.length || typeof turf === 'undefined') {
      return [];
    }

    const latlngs = route.latlngs;
    const orderedPoints = route.orderedPoints || [];
    const nStops = orderedPoints.length;

    // Find stop coordinate indices along route.latlngs
    const stopIndices = [];
    let searchStart = 0;
    for (let s = 0; s < nStops; s++) {
      const pt = orderedPoints[s];
      let bestIdx = searchStart;
      let minD = Infinity;
      for (let i = searchStart; i < latlngs.length; i++) {
        const d = Math.hypot(latlngs[i][0] - pt.lat, latlngs[i][1] - pt.lng);
        if (d < minD) {
          minD = d;
          bestIdx = i;
        }
      }
      stopIndices.push(bestIdx);
      searchStart = bestIdx;
    }

    const conflicts = [];

    barriers.forEach(barrier => {
      const circlePoly = turf.circle([barrier.lng, barrier.lat], barrier.radius, { units: 'meters' });
      const affectedLegs = new Set();
      let firstIntersectionCoordIdx = Infinity;

      for (let i = 0; i < latlngs.length - 1; i++) {
        const seg = turf.lineString([
          [latlngs[i][1], latlngs[i][0]],
          [latlngs[i + 1][1], latlngs[i + 1][0]]
        ]);
        if (turf.booleanIntersects(seg, circlePoly)) {
          if (i < firstIntersectionCoordIdx) firstIntersectionCoordIdx = i;
          // Determine which leg [s, s+1] this coordinate index belongs to
          let legIdx = 0;
          for (let s = 0; s < stopIndices.length - 1; s++) {
            if (i >= stopIndices[s] && (i < stopIndices[s + 1] || s === stopIndices.length - 2)) {
              legIdx = s;
              break;
            }
          }
          affectedLegs.add(legIdx);
        }
      }

      if (affectedLegs.size > 0) {
        const sortedLegs = Array.from(affectedLegs).sort((a, b) => a - b);
        const earliestLeg = sortedLegs[0];
        const fromPointId = orderedPoints[earliestLeg]?.id || null;
        const toPointId = orderedPoints[earliestLeg + 1]?.id || null;

        conflicts.push({
          barrier,
          legs: sortedLegs,
          firstCoordIdx: firstIntersectionCoordIdx,
          fromPointId,
          toPointId
        });
      }
    });

    // Sort barriers chronologically in the order they are encountered along the route
    conflicts.sort((a, b) => a.firstCoordIdx - b.firstCoordIdx);
    return conflicts;
  },

  // Beam-search detour planning supporting all conflicting barriers (>2) with budget limit
  async replanWithDetour() {
    if (this.isBusy) return;
    if (this.routeIsOutdated) {
      window.App?.showToast('分析條件已變更（路線已過期），請先重新計算後再進行避障規劃', 'warning');
      return;
    }
    if (!this.currentRoute || !this.currentRoute.barrierConflicts?.length) return;

    const signal = this.beginOperation('detour');
    this.setStatus('正在進行屏障避障重新規劃…', 'is-busy');

    try {
      await this.ensureOsrmConsent(this.points.length + 4);

      const activeBarriers = this.barriers.filter(b => b.enabled !== false);
      const conflictItems = this.findRoadGeometryBarrierConflicts(this.currentRoute, activeBarriers);

      if (!conflictItems.length) {
        this.setStatus('所有衝突屏障已被停用或移除，請直接重新計算路線。', 'is-ok');
        return;
      }

      const baseOrder = this.currentRoute.orderedPoints.slice();
      let currentBeam = [baseOrder];
      const maxRequestBudget = 16;
      let requestsUsed = 0;
      let bestCleanRoute = null;
      let minCleanDistance = Infinity;

      // Sequential beam search along the ordered chain of conflicting barriers
      for (let bIdx = 0; bIdx < conflictItems.length; bIdx++) {
        if (signal?.aborted) throw new DOMException('作業已取消', 'AbortError');
        if (requestsUsed >= maxRequestBudget) {
          console.warn(`已達 OSRM 候選請求次數上限 (${maxRequestBudget})，結束搜尋。`);
          break;
        }

        const { barrier, legs, fromPointId, toPointId } = conflictItems[bIdx];
        const rMeters = barrier.radius * 1.35;
        const radOffsets = [
          [0, rMeters],      // North
          [rMeters, 0],      // East
          [0, -rMeters],     // South
          [-rMeters, 0]      // West
        ];

        const nextBeamCandidates = [];

        for (const seq of currentBeam) {
          // Stable insertion position: locate between fromPointId and toPointId in current candidate sequence
          let insertPos = -1;
          if (fromPointId && toPointId) {
            const toIdx = seq.findIndex(p => p.id === toPointId);
            const fromIdx = seq.findIndex(p => p.id === fromPointId);
            if (toIdx !== -1 && fromIdx !== -1 && toIdx > fromIdx) {
              insertPos = toIdx;
            }
          }
          if (insertPos === -1) {
            const targetLeg = legs[0] || 0;
            insertPos = Math.min(seq.length - 1, Math.max(1, targetLeg + 1));
          }

          for (let dirIdx = 0; dirIdx < radOffsets.length; dirIdx++) {
            if (requestsUsed >= maxRequestBudget) break;
            if (signal?.aborted) throw new DOMException('作業已取消', 'AbortError');

            const [dx, dy] = radOffsets[dirIdx];
            const dLat = dy / 111320;
            const dLng = dx / (111320 * Math.cos(barrier.lat * Math.PI / 180));
            const detourPoint = {
              id: this.generateId('detour'),
              lat: barrier.lat + dLat,
              lng: barrier.lng + dLng,
              name: `避障點 (${barrier.name}-${dirIdx + 1})`,
              role: 'stop'
            };

            const candidateSeq = seq.slice();
            candidateSeq.splice(insertPos, 0, detourPoint);
            requestsUsed++;

            try {
              const testRoute = await this.fetchOsrmRouteChunked(candidateSeq, signal, 'detour-replan');
              const remainingConflicts = this.evaluateBarrierConflicts(testRoute.latlngs);

              if (remainingConflicts.length === 0) {
                if (testRoute.distance < minCleanDistance) {
                  minCleanDistance = testRoute.distance;
                  bestCleanRoute = testRoute;
                }
              }

              nextBeamCandidates.push({
                sequence: candidateSeq,
                route: testRoute,
                conflictCount: remainingConflicts.length,
                distance: testRoute.distance
              });
            } catch (err) {
              if (this.isAbortError(err)) throw err;
            }
          }
        }

        if (bestCleanRoute) break; // Clean detour found!

        // Keep top 2 candidate sequences with least conflicts and shortest distance for next barrier
        nextBeamCandidates.sort((a, b) => a.conflictCount - b.conflictCount || a.distance - b.distance);
        currentBeam = nextBeamCandidates.slice(0, 2).map(c => c.sequence);
        if (!currentBeam.length) break;
      }

      if (bestCleanRoute) {
        const finalConflicts = this.evaluateBarrierConflicts(bestCleanRoute.latlngs);
        if (finalConflicts.length === 0) {
          this.clearFallbackPreview();
          this.showRoute(bestCleanRoute);
          this.showResult(bestCleanRoute);
          window.App?.showToast('成功尋得屏障避障繞行路線！', 'success');
          return;
        }
      }

      if (requestsUsed >= maxRequestBudget) {
        this.setStatus('已達避障搜尋請求上限。已保留原路線。', 'is-error');
        window.App?.showToast('已達避障搜尋請求上限，已保留原路線。', 'warning');
      } else {
        window.App?.showToast('嘗試周邊繞行仍無法完全避開屏障；已保留原路線。請調整屏障半徑或停用衝突屏障。', 'warning');
        this.setStatus('避障嘗試未果：周圍道路仍被屏障覆蓋或超出搜尋上限。已保留原路線。', 'is-error');
      }
    } catch (err) {
      this.handleRouteError(err);
    } finally {
      this.finishOperation();
      this.render();
    }
  },

  // =========================================================================
  // RESULT DISPLAY & LAYER PERSISTENCE
  // =========================================================================

  showRoute(route) {
    this.clearFallbackPreview();
    if (this.routeLayer && this.map) this.map.removeLayer(this.routeLayer);

    route.barrierConflicts = this.evaluateBarrierConflicts(route.latlngs);
    this.currentRoute = route;
    this.routeIsOutdated = false;

    const hasConflict = route.barrierConflicts.length > 0;
    const isApprox = Boolean(route.approximate);

    this.routeLayer = L.polyline(route.latlngs, {
      color: hasConflict ? '#dc2626' : isApprox ? '#f97316' : '#2563eb',
      weight: 6,
      opacity: 0.9,
      dashArray: isApprox ? '10 8' : (hasConflict ? '8 6' : null),
      className: 'routing-route-line',
      interactive: false
    }).addTo(this.map);

    const bounds = this.routeLayer.getBounds();
    if (bounds.isValid() && this.map) {
      this.map.fitBounds(bounds.pad(0.12));
    }
  },

  showResult(route) {
    const container = document.getElementById('routing-result');
    if (!container) return;
    container.replaceChildren();

    const card = document.createElement('div');
    const hasConflict = route.barrierConflicts?.length > 0;
    const isApprox = Boolean(route.approximate);

    card.className = `routing-result-card${hasConflict ? ' has-conflict' : ''}${this.routeIsOutdated ? ' is-outdated' : ''}`;

    const titleRow = document.createElement('div');
    titleRow.className = 'routing-result-title';
    const titleText = document.createElement('strong');
    titleText.textContent = isApprox ? '直線近似路線 (非實際道路)' : `${route.optimizationMethod || 'OSRM 道路分析'}`;
    titleRow.appendChild(titleText);

    if (this.routeIsOutdated) {
      const b = document.createElement('span');
      b.className = 'routing-outdated-badge';
      b.textContent = '已過期 (上次有效結果)';
      titleRow.appendChild(b);
    } else if (hasConflict) {
      const b = document.createElement('span');
      b.className = 'routing-conflict-badge';
      b.textContent = '屏障衝突';
      titleRow.appendChild(b);
    }
    card.appendChild(titleRow);

    const metrics = document.createElement('div');
    const r1 = document.createElement('div');
    r1.innerHTML = `<strong>總里程：</strong>${this.formatDistance(route.distance)} · <strong>預估時間：</strong>${this.formatDuration(route.duration)}`;
    const r2 = document.createElement('div');
    r2.innerHTML = `<strong>停靠點數：</strong>${route.orderedPoints.length} 個 · <strong>模式：</strong>${this.getTransportLabel(route.transportProfile)}`;
    const r3 = document.createElement('div');
    const sTitle = document.createElement('strong');
    sTitle.textContent = '服務來源：';
    const sVal = document.createTextNode(route.osrmService || '');
    r3.append(sTitle, sVal);
    const r4 = document.createElement('div');
    r4.innerHTML = `<strong>計算時間：</strong>${new Date(route.computedAt || Date.now()).toLocaleTimeString('zh-TW')}`;
    metrics.append(r1, r2, r3, r4);
    card.appendChild(metrics);

    const seqRow = document.createElement('div');
    seqRow.style.marginTop = '6px';
    seqRow.style.fontSize = '0.72rem';
    seqRow.style.color = '#475569';
    const orderStr = route.orderedPoints.map((p, i) => `${i + 1}. ${p.name}`).join(' → ');
    seqRow.textContent = `停靠順序：${orderStr}${route.mode === 'roundtrip' ? ' → [回起點]' : ''}`;
    card.appendChild(seqRow);

    if (hasConflict) {
      const conflictMsg = document.createElement('div');
      conflictMsg.style.marginTop = '6px';
      conflictMsg.style.color = '#b91c1c';
      conflictMsg.style.fontWeight = '700';
      conflictMsg.textContent = `⚠️ 路線穿越 ${route.barrierConflicts.length} 個屏障（${route.barrierConflicts.map(c => c.name).join('、')}），禁止保存！`;
      card.appendChild(conflictMsg);
    }

    container.appendChild(card);

    if (this.fallbackPreviewRoute) {
      this.renderFallbackPreviewUi();
    }

    const detourBtn = document.getElementById('routing-barrier-detour-container');
    if (detourBtn) detourBtn.hidden = !hasConflict;

    const badge = document.getElementById('routing-result-badge');
    if (badge) {
      badge.style.display = 'inline-flex';
      badge.textContent = hasConflict ? '有衝突' : (this.routeIsOutdated ? '已過期' : '完成');
      badge.style.background = hasConflict ? '#fecaca' : (this.routeIsOutdated ? '#fde68a' : '#d1fae5');
      badge.style.color = hasConflict ? '#991b1b' : (this.routeIsOutdated ? '#92400e' : '#065f46');
    }
  },

  markRouteOutdated() {
    this.clearFallbackPreview();
    if (!this.currentRoute) return;
    this.routeIsOutdated = true;
    if (this.currentRoute) {
      this.showResult(this.currentRoute);
    }
    this.renderControls();
  },

  resetComputedRoute() {
    if (this.routeLayer && this.map) {
      this.map.removeLayer(this.routeLayer);
      this.routeLayer = null;
    }
    this.clearFallbackPreview();
    this.currentRoute = null;
    this.routeIsOutdated = false;

    const container = document.getElementById('routing-result');
    if (container) {
      container.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'routing-empty';
      empty.textContent = '尚未計算路徑。請於下方執行計算。';
      container.appendChild(empty);
    }

    const badge = document.getElementById('routing-result-badge');
    if (badge) badge.style.display = 'none';

    const detourBtn = document.getElementById('routing-barrier-detour-container');
    if (detourBtn) detourBtn.hidden = true;

    this.points.forEach(p => { delete p.optimizedIndex; });
    this.renderControls();
  },

  saveRoute() {
    if (this.isBusy || !this.currentRoute) {
      window.App?.showToast('目前無可保存之分析路線', 'warning');
      return;
    }
    if (this.routeIsOutdated) {
      window.App?.showToast('分析條件已變更，路線已過期，請重新計算後再保存', 'warning');
      return;
    }
    if (this.currentRoute.approximate) {
      window.App?.showToast('直線近似預覽無法保存為正式道路成果', 'warning');
      return;
    }
    if (this.currentRoute.barrierConflicts?.length > 0) {
      window.App?.showToast('路線與屏障衝突中，禁止保存', 'error');
      return;
    }

    const route = this.currentRoute;
    let activeLayer = LayerManager?.getActiveLayer?.();
    const canUseActive = activeLayer && !activeLayer.locked && (activeLayer.geometryType === 'Line' || activeLayer.geometryType === 'any');

    if (!canUseActive) {
      activeLayer = LayerManager?.layers.find(l => !l.locked && l.geometryType === 'Line')
        || LayerManager?.createLayer('路網分析結果', 'Line');
      if (activeLayer) LayerManager.setActiveLayer(activeLayer.id);
    }

    if (!activeLayer) {
      window.App?.showToast('無法建立或取得可編輯的線圖層', 'error');
      return;
    }

    const featureId = DrawManager.generateFeatureId();
    const polyline = L.polyline(route.latlngs, {
      color: '#2563eb',
      weight: 5,
      opacity: 0.9
    });

    const routeModeLabel = route.mode === 'roundtrip' ? '環狀路徑' : '開放路徑';
    polyline.featureProps = {
      id: featureId,
      name: `${routeModeLabel} (${this.formatDistance(route.distance)})`,
      description: `由 ${route.optimizationMethod} 計算之路網結果`,
      distance_km: Number((route.distance / 1000).toFixed(3)),
      estimated_minutes: Math.round(route.duration / 60),
      route_mode: route.mode,
      transport_mode: route.transportProfile,
      osrm_service: route.osrmService,
      optimization_method: route.optimizationMethod,
      stop_count: route.orderedPoints.length,
      stop_order: route.orderedPoints.map((p, i) => `${i + 1}.${p.name}`).join(' > '),
      barrier_count: this.barriers.filter(b => b.enabled !== false).length,
      barrier_checked: true,
      barrier_conflicts: 0,
      computed_at: route.computedAt || new Date().toISOString(),
      style: {
        color: '#2563eb',
        weight: 5,
        opacity: 0.9
      }
    };

    polyline.gisLayerId = activeLayer.id;
    DrawManager.setupLayerInteractions(polyline);
    activeLayer.featureGroup.addLayer(polyline);

    window.App?.updateStats();
    TableManager?.render();
    LayerManager?.render();
    window.SafetyManager?.recordChange('保存路網分析結果');

    window.App?.showToast(`路徑已成功保存至圖層「${activeLayer.name}」`, 'success');
  },

  // =========================================================================
  // RENDERING ENGINE (TRUE KEYED DOM FOR 200-POINT PERFORMANCE)
  // =========================================================================

  render() {
    this.points.forEach((p, idx) => this.normalizePoint(p, idx));

    this.renderMarkers();
    this.renderBarriers();
    this.renderStopList();
    this.renderBarrierList();
    this.renderControls();

    const ptCount = this.points.length;
    const countEl = document.getElementById('routing-stop-count');
    if (countEl) countEl.textContent = `${ptCount} / ${this.maxPoints}`;

    const bCount = this.barriers.length;
    const bCountEl = document.getElementById('routing-barrier-count');
    if (bCountEl) bCountEl.textContent = `${bCount} / ${this.maxBarriers}`;

    if (window.lucide) window.lucide.createIcons();
  },

  renderControls() {
    const ptCount = this.points.length;
    const bCount = this.barriers.length;
    const isBusy = this.isBusy;

    const btnCalcCurrent = document.getElementById('btn-routing-calc-current');
    const btnOptimize = document.getElementById('btn-routing-optimize');
    const btnCancel = document.getElementById('btn-routing-cancel');
    const btnSave = document.getElementById('btn-routing-save');
    const btnFixStartEnd = document.getElementById('btn-routing-fix-start-end');
    const btnAddBarrier = document.getElementById('btn-routing-add-barrier');
    const barrierRadius = document.getElementById('routing-barrier-radius');
    const btnImport = document.getElementById('btn-routing-import-file');

    if (btnCalcCurrent) btnCalcCurrent.disabled = isBusy || ptCount < 2;
    if (btnOptimize) btnOptimize.disabled = isBusy || ptCount < 2;
    if (btnCancel) btnCancel.hidden = !isBusy;
    if (btnFixStartEnd) btnFixStartEnd.disabled = isBusy || ptCount < 2;
    if (btnSave) {
      btnSave.disabled = isBusy || !this.currentRoute || this.routeIsOutdated || Boolean(this.currentRoute.approximate) || Boolean(this.currentRoute.barrierConflicts?.length);
    }
    if (btnImport) btnImport.disabled = isBusy || ptCount >= this.maxPoints;

    if (btnAddBarrier) {
      btnAddBarrier.disabled = isBusy || (bCount >= this.maxBarriers && this.inputMode !== 'barriers');
      btnAddBarrier.classList.toggle('is-active', this.inputMode === 'barriers');
      const lbl = btnAddBarrier.querySelector('span');
      if (lbl) lbl.textContent = this.inputMode === 'barriers' ? '完成新增' : '新增屏障';
    }
    if (barrierRadius) barrierRadius.disabled = isBusy || this.inputMode === 'barriers';
  },

  renderMarkers() {
    if (!this.markerLayer) return;
    this.markerLayer.clearLayers();

    this.points.forEach((point, index) => {
      let roleClass = 'is-stop';
      if (point.role === 'start') roleClass = 'is-start';
      else if (point.role === 'end') roleClass = 'is-end';

      const qualityClass = point.validation?.status === 'unreachable' || point.validation?.status === 'far'
        ? ' is-error'
        : point.validation?.status === 'warning' ? ' is-warning' : '';

      const icon = L.divIcon({
        className: '',
        html: `<div class="routing-number-icon ${roleClass}${qualityClass}">${index + 1}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const marker = L.marker([point.lat, point.lng], { icon, interactive: true });
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.locatePoint(point.id);
      });
      marker.addTo(this.markerLayer);
    });
  },

  renderBarriers() {
    if (!this.barrierLayer) return;
    this.barrierLayer.clearLayers();

    const conflicts = this.currentRoute?.barrierConflicts || [];

    this.barriers.forEach((barrier) => {
      const isConflict = conflicts.some(c => c.id === barrier.id);
      const isEnabled = barrier.enabled !== false;

      const color = !isEnabled ? '#64748b' : (isConflict ? '#dc2626' : '#ea580c');
      const fillColor = !isEnabled ? '#94a3b8' : (isConflict ? '#ef4444' : '#f97316');

      L.circle([barrier.lat, barrier.lng], {
        radius: barrier.radius,
        color,
        weight: isConflict ? 3 : 2,
        opacity: isEnabled ? 0.95 : 0.45,
        fillColor,
        fillOpacity: isEnabled ? (isConflict ? 0.35 : 0.22) : 0.1,
        interactive: false
      }).addTo(this.barrierLayer);
    });
  },

  // True Keyed DOM updating for smooth 200-point performance
  renderStopList() {
    const list = document.getElementById('routing-stop-list');
    if (!list) return;

    if (!this.points.length) {
      list.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'routing-empty';
      empty.textContent = '尚未加入停靠點（請點擊地圖或匯入檔案）';
      list.appendChild(empty);
      return;
    }

    // Remove empty placeholder if present
    const emptyEl = list.querySelector('.routing-empty');
    if (emptyEl) emptyEl.remove();

    const mode = this.getMode();
    const existingMap = new Map();
    Array.from(list.children).forEach(child => {
      if (child.dataset?.pointId) existingMap.set(child.dataset.pointId, child);
    });

    const activeIds = new Set(this.points.map(p => p.id));

    // Remove nodes for points that no longer exist
    existingMap.forEach((node, id) => {
      if (!activeIds.has(id)) {
        node.remove();
        existingMap.delete(id);
      }
    });

    // In-place reconciliation: update attributes and reorder existing DOM elements
    for (let i = 0; i < this.points.length; i++) {
      const point = this.points[i];
      let row = existingMap.get(point.id);

      if (!row) {
        // Create new row only for new points
        row = document.createElement('div');
        row.className = 'routing-stop-row';
        row.dataset.pointId = point.id;

        const handle = document.createElement('div');
        handle.className = 'routing-drag-handle';
        handle.title = '拖曳調整順序';
        handle.innerHTML = '<i data-lucide="grip-vertical"></i>';
        handle.addEventListener('pointerdown', (e) => this.handlePointPointerDown(e, point.id, row));

        const number = document.createElement('span');
        number.className = 'routing-stop-index';

        const main = document.createElement('div');
        main.className = 'routing-stop-main';

        const titleRow = document.createElement('div');
        titleRow.style.display = 'flex';
        titleRow.style.alignItems = 'center';
        titleRow.style.gap = '5px';

        const nameStrong = document.createElement('strong');
        titleRow.appendChild(nameStrong);

        const optBadge = document.createElement('span');
        optBadge.style.fontSize = '0.62rem';
        optBadge.style.color = '#0284c7';
        titleRow.appendChild(optBadge);
        main.appendChild(titleRow);

        const coordSmall = document.createElement('small');
        main.appendChild(coordSmall);

        const qualityBadge = document.createElement('span');
        qualityBadge.className = 'routing-stop-quality';
        qualityBadge.style.display = 'none';
        main.appendChild(qualityBadge);

        const roleActions = document.createElement('div');
        roleActions.className = 'routing-stop-role-actions';

        const locateBtn = document.createElement('button');
        locateBtn.type = 'button';
        locateBtn.className = 'btn btn-icon btn-secondary';
        locateBtn.title = '定位至此點位';
        locateBtn.innerHTML = '<i data-lucide="crosshair" style="width: 12px; height: 12px;"></i>';
        locateBtn.onclick = (e) => { e.stopPropagation(); this.locatePoint(point.id); };

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-icon btn-secondary';
        delBtn.title = '刪除此點位';
        delBtn.textContent = '×';
        delBtn.onclick = (e) => { e.stopPropagation(); this.removePoint(point.id); };

        row.append(handle, number, main, roleActions, locateBtn, delBtn);

        row._refs = {
          number,
          nameStrong,
          optBadge,
          coordSmall,
          qualityBadge,
          roleActions
        };
        row._state = {};
        existingMap.set(point.id, row);
      }

      const refs = row._refs;
      const state = row._state || {};

      // 1. Update index number if changed
      const indexStr = String(i + 1);
      if (state.index !== indexStr) {
        refs.number.textContent = indexStr;
        state.index = indexStr;
      }

      // 2. Update role class if changed
      let roleClass = 'is-stop';
      if (point.role === 'start') roleClass = 'is-start';
      else if (point.role === 'end') roleClass = 'is-end';

      if (state.role !== point.role) {
        row.className = `routing-stop-row ${roleClass}`;
        refs.number.className = `routing-stop-index ${roleClass}`;

        refs.roleActions.replaceChildren();
        if (point.role === 'start') {
          const b = document.createElement('span');
          b.className = 'routing-role-badge is-start';
          b.textContent = typeof I18n !== 'undefined' ? I18n.t('routing.role_start', '起點') : '起點';
          const demoteBtn = document.createElement('button');
          demoteBtn.type = 'button';
          demoteBtn.className = 'btn btn-secondary routing-role-action';
          demoteBtn.textContent = typeof I18n !== 'undefined' ? I18n.t('routing.demote_to_stop', '降為停靠點') : '降為停靠點';
          demoteBtn.onclick = (e) => { e.stopPropagation(); this.demoteToStop(point.id); };
          refs.roleActions.append(b, demoteBtn);
        } else if (point.role === 'end') {
          const b = document.createElement('span');
          b.className = 'routing-role-badge is-end';
          b.textContent = typeof I18n !== 'undefined' ? I18n.t('routing.role_end', '終點') : '終點';
          const demoteBtn = document.createElement('button');
          demoteBtn.type = 'button';
          demoteBtn.className = 'btn btn-secondary routing-role-action';
          demoteBtn.textContent = typeof I18n !== 'undefined' ? I18n.t('routing.demote_to_stop', '降為停靠點') : '降為停靠點';
          demoteBtn.onclick = (e) => { e.stopPropagation(); this.demoteToStop(point.id); };
          refs.roleActions.append(b, demoteBtn);
        } else {
          const setStartBtn = document.createElement('button');
          setStartBtn.type = 'button';
          setStartBtn.className = 'btn btn-secondary routing-role-action';
          setStartBtn.textContent = typeof I18n !== 'undefined' ? I18n.t('routing.set_start', '設起') : '設起';
          setStartBtn.onclick = (e) => { e.stopPropagation(); this.setStartPoint(point.id); };
          refs.roleActions.appendChild(setStartBtn);

          if (mode === 'open') {
            const setEndBtn = document.createElement('button');
            setEndBtn.type = 'button';
            setEndBtn.className = 'btn btn-secondary routing-role-action';
            setEndBtn.textContent = typeof I18n !== 'undefined' ? I18n.t('routing.set_end', '設終') : '設終';
            setEndBtn.onclick = (e) => { e.stopPropagation(); this.setEndPoint(point.id); };
            refs.roleActions.appendChild(setEndBtn);
          }
        }
        state.role = point.role;
      }

      // 3. Update name if changed
      if (state.name !== point.name) {
        refs.nameStrong.textContent = point.name;
        state.name = point.name;
      }

      // 4. Update coordinates & original index
      const coordStr = `原序 #${point.originalIndex || (i + 1)} · ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
      if (state.coord !== coordStr) {
        refs.coordSmall.textContent = coordStr;
        state.coord = coordStr;
      }

      // 5. Update optBadge if changed
      if (state.optIndex !== point.optimizedIndex) {
        refs.optBadge.textContent = point.optimizedIndex ? `[最佳序: ${point.optimizedIndex}]` : '';
        state.optIndex = point.optimizedIndex;
      }

      // 6. Update validation quality if changed
      const valKey = point.validation ? `${point.validation.status}_${point.validation.snapDistance}` : 'none';
      if (state.valKey !== valKey) {
        if (point.validation) {
          const sClass = point.validation.status === 'unreachable' || point.validation.status === 'far' ? ' is-error' : (point.validation.status === 'warning' ? ' is-warning' : '');
          refs.qualityBadge.className = `routing-stop-quality${sClass}`;
          refs.qualityBadge.textContent = point.validation.status === 'unreachable' ? '不可達' : `距路 ${this.formatSnapDistance(point.validation.snapDistance)}`;
          refs.qualityBadge.style.display = 'inline-block';
        } else {
          refs.qualityBadge.style.display = 'none';
        }
        state.valKey = valKey;
      }

      row._state = state;

      // In-place node movement without batch replaceChildren
      if (list.children[i] !== row) {
        list.insertBefore(row, list.children[i] || null);
      }
    }
  },

  renderBarrierList() {
    const list = document.getElementById('routing-barrier-list');
    if (!list) return;

    if (!this.barriers.length) {
      list.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'routing-empty';
      empty.textContent = '尚未加入屏障。啟用「新增屏障」後點擊地圖加入。';
      list.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();

    this.barriers.forEach((barrier, index) => {
      const row = document.createElement('div');
      row.className = `routing-barrier-row${barrier.enabled === false ? ' is-disabled' : ''}`;

      const toggleCheck = document.createElement('input');
      toggleCheck.type = 'checkbox';
      toggleCheck.checked = barrier.enabled !== false;
      toggleCheck.title = barrier.enabled !== false ? '點擊停用此屏障' : '點擊啟用此屏障';
      toggleCheck.onchange = () => this.toggleBarrierEnabled(barrier.id);

      const num = document.createElement('span');
      num.className = 'routing-barrier-index';
      num.textContent = String(index + 1);

      const main = document.createElement('div');
      main.className = 'routing-barrier-main';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = barrier.name;
      nameInput.style.cssText = 'border: 1px solid transparent; background: transparent; font-size: 0.74rem; font-weight: 700; width: 100%;';
      nameInput.title = '點擊修改屏障名稱';
      nameInput.onchange = (e) => this.updateBarrierName(barrier.id, e.target.value);
      nameInput.onfocus = () => nameInput.style.border = '1px solid #cbd5e1';
      nameInput.onblur = () => nameInput.style.border = '1px solid transparent';
      main.appendChild(nameInput);

      const detail = document.createElement('small');
      detail.textContent = `${barrier.lat.toFixed(5)}, ${barrier.lng.toFixed(5)}`;
      main.appendChild(detail);

      const radSelect = document.createElement('select');
      radSelect.style.cssText = 'padding: 2px 4px; font-size: 0.68rem; border: 1px solid #cbd5e1; border-radius: 4px;';
      [50, 100, 250, 500, 1000, 2000].forEach(r => {
        const opt = document.createElement('option');
        opt.value = String(r);
        opt.textContent = r >= 1000 ? `${r / 1000}km` : `${r}m`;
        radSelect.appendChild(opt);
      });
      radSelect.value = barrier.radius;
      radSelect.onchange = (e) => this.updateBarrierRadius(barrier.id, e.target.value);

      const actions = document.createElement('div');
      actions.className = 'routing-barrier-actions';

      const locateBtn = document.createElement('button');
      locateBtn.type = 'button';
      locateBtn.className = 'btn btn-icon btn-secondary';
      locateBtn.title = '定位至屏障';
      locateBtn.innerHTML = '<i data-lucide="crosshair" style="width: 12px; height: 12px;"></i>';
      locateBtn.onclick = () => this.locateBarrier(barrier.id);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-icon btn-secondary';
      delBtn.title = '刪除此屏障';
      delBtn.textContent = '×';
      delBtn.onclick = () => this.removeBarrier(barrier.id);

      actions.append(radSelect, locateBtn, delBtn);
      row.append(toggleCheck, num, main, actions);
      frag.appendChild(row);
    });

    list.replaceChildren(frag);
  },

  // =========================================================================
  // UTILITIES & HELPERS
  // =========================================================================

  clear() {
    if (this.isBusy) return;
    if (!this.points.length && !this.barriers.length && !this.currentRoute) return;
    if (!confirm('確定要清空所有點位、屏障及分析路線嗎？')) return;

    this.points = [];
    this.barriers = [];
    this.inputMode = 'stops';
    this.resetComputedRoute();
    this.resetPointValidation();
    if (this.markerLayer) this.markerLayer.clearLayers();
    if (this.barrierLayer) this.barrierLayer.clearLayers();
    this.setStatus('在地圖上依序加入起點、停靠點與終點。');
    this.render();
    window.SafetyManager?.recordChange('全部清空路網分析');
  },

  getMode() {
    const mode = document.getElementById('routing-mode');
    return mode ? mode.value : 'open';
  },

  pointDistance(first, second) {
    if (!this.map || !first || !second) return 0;
    return this.map.distance([first.lat, first.lng], [second.lat, second.lng]);
  },

  formatDistance(meters) {
    const m = Number(meters) || 0;
    return m >= 1000 ? `${(m / 1000).toFixed(2)} 公里` : `${Math.round(m)} 公尺`;
  },

  formatDuration(seconds) {
    const sec = Number(seconds) || 0;
    const minutes = Math.max(1, Math.round(sec / 60));
    if (minutes < 60) return `${minutes} 分鐘`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} 小時 ${remainder} 分鐘` : `${hours} 小時`;
  },

  formatSnapDistance(distance) {
    if (!Number.isFinite(distance)) return '未知';
    if (distance >= 1000) return `${(distance / 1000).toFixed(1)} 公里`;
    return `${Math.round(distance)} 公尺`;
  },

  setStatus(message, stateClass = '') {
    const status = document.getElementById('routing-status');
    if (!status) return;
    status.className = `routing-status${stateClass ? ` ${stateClass}` : ''}`;
    status.textContent = message;
  }
};
