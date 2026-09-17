/**
 * GeoCanvas GIS Tool - TGOS address locator integration.
 * Credentials are supplied by the user. AppID is kept locally; APIKey is kept
 * only in sessionStorage and is transmitted solely to the official TGOS API.
 */

const TGOSAddressManager = {
  map: null,
  panel: null,
  markerLayer: null,
  isActive: false,
  isBusy: false,
  results: [],
  selectedIndex: -1,
  apiSignature: null,
  appIdKey: 'geocanvas.tgos.appid.v1',
  apiKeySessionKey: 'geocanvas.tgos.apikey.v1',

  init(map) {
    this.map = map;
    this.panel = document.getElementById('tgos-locator-panel');
    this.markerLayer = L.layerGroup().addTo(map);
    if (this.panel && L.DomEvent) {
      L.DomEvent.disableClickPropagation(this.panel);
      L.DomEvent.disableScrollPropagation(this.panel);
    }
    const appId = document.getElementById('tgos-app-id');
    const apiKey = document.getElementById('tgos-api-key');
    if (appId) appId.value = localStorage.getItem(this.appIdKey) || '';
    if (apiKey) apiKey.value = sessionStorage.getItem(this.apiKeySessionKey) || '';
    document.getElementById('btn-tgos-locate')?.addEventListener('click', () => this.toggle());
    document.getElementById('tgos-address')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.locate();
      }
    });
    this.renderControls();
  },

  toggle() {
    if (!this.panel) return;
    this.isActive = !this.isActive;
    this.panel.style.display = this.isActive ? 'block' : 'none';
    document.getElementById('btn-tgos-locate')?.classList.toggle('active', this.isActive);
    if (this.isActive) {
      if (typeof PanelManager !== 'undefined') {
        PanelManager.onPanelOpened('tgos');
      } else {
        if (typeof RoutingManager !== 'undefined' && RoutingManager.isActive) RoutingManager.toggle();
        if (typeof GeoprocessingManager !== 'undefined' && GeoprocessingManager.isActive) GeoprocessingManager.close();
      }
      setTimeout(() => document.getElementById('tgos-address')?.focus(), 0);
    } else {
      if (typeof PanelManager !== 'undefined') {
        PanelManager.onPanelClosed('tgos');
      }
    }
  },

  close() {
    if (!this.panel) return;
    this.isActive = false;
    this.panel.style.display = 'none';
    document.getElementById('btn-tgos-locate')?.classList.remove('active');
    if (typeof PanelManager !== 'undefined') {
      PanelManager.onPanelClosed('tgos');
    }
  },

  setStatus(message, className = '') {
    const status = document.getElementById('tgos-status');
    if (!status) return;
    status.textContent = message;
    status.className = `tgos-status${className ? ` ${className}` : ''}`;
  },

  getCredentials() {
    const appId = document.getElementById('tgos-app-id')?.value.trim() || '';
    const apiKey = document.getElementById('tgos-api-key')?.value.trim() || '';
    if (!appId || !apiKey) throw new Error('請先輸入 TGOS AppID 與 APIKey');
    localStorage.setItem(this.appIdKey, appId);
    sessionStorage.setItem(this.apiKeySessionKey, apiKey);
    return { appId, apiKey };
  },

  loadApi(appId, apiKey) {
    const signature = `${appId}\u0000${apiKey}`;
    if (window.TGOS && this.apiSignature === signature) return Promise.resolve();
    if (window.TGOS && this.apiSignature && this.apiSignature !== signature) {
      return Promise.reject(new Error('TGOS 憑證已變更，請重新整理頁面後再查詢'));
    }

    return new Promise((resolve, reject) => {
      const existing = document.getElementById('tgos-web-api-script');
      if (existing) existing.remove();
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        script.remove();
        reject(new Error('TGOS API 載入逾時，請確認網路與 Domain/IP 授權'));
      }, 15000);
      script.id = 'tgos-web-api-script';
      script.charset = 'utf-8';
      script.src = `https://api.tgos.tw/TGOS_API/tgos?ver=2&AppID=${encodeURIComponent(appId)}&APIKey=${encodeURIComponent(apiKey)}`;
      script.onload = () => {
        clearTimeout(timer);
        if (!window.TGOS?.TGLocateService || !window.TGOS?.TGTransformation) {
          reject(new Error('TGOS API 驗證失敗或功能未載入'));
          return;
        }
        this.apiSignature = signature;
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(new Error('TGOS API 載入失敗，請確認憑證與申請網域'));
      };
      document.head.appendChild(script);
    });
  },

  async locate() {
    if (this.isBusy) return;
    const address = document.getElementById('tgos-address')?.value.trim() || '';
    if (!address) {
      this.setStatus('請輸入要定位的臺灣地址。', 'is-error');
      return;
    }

    this.isBusy = true;
    this.results = [];
    this.selectedIndex = -1;
    this.clearMarkers();
    this.renderResults();
    this.renderControls();
    this.setStatus(`正在向 TGOS 查詢「${address}」…`, 'is-busy');

    try {
      const credentials = this.getCredentials();
      await this.loadApi(credentials.appId, credentials.apiKey);
      const rawResults = await this.requestAddress(address);
      this.results = rawResults.map((result, index) => this.normalizeResult(result, address, index)).filter(Boolean);
      if (!this.results.length) throw new Error('TGOS 未回傳可定位的地址');
      this.selectedIndex = 0;
      this.renderResults();
      this.showSelected();
      this.setStatus(`找到 ${this.results.length} 筆結果，已定位至第一筆。`);
    } catch (error) {
      const safeMsg = this.sanitizeErrorMessage(error?.message || error);
      console.error('TGOS 地址定位失敗:', safeMsg);
      this.setStatus(`定位失敗：${safeMsg}`, 'is-error');
      App.showToast(`TGOS 地址定位失敗：${safeMsg}`, 'error');
    } finally {
      this.isBusy = false;
      this.renderControls();
    }
  },

  sanitizeErrorMessage(message) {
    if (!message) return '未知錯誤';
    return String(message)
      .replace(/APIKey=[^&"'\s]+/gi, 'APIKey=***')
      .replace(/AppID=[^&"'\s]+/gi, 'AppID=***');
  },

  requestAddress(address) {
    return new Promise((resolve, reject) => {
      const locator = new TGOS.TGLocateService();
      const timer = setTimeout(() => reject(new Error('TGOS 地址查詢逾時')), 20000);
      locator.locateTWD97({ address, pageNumber: 1 }, (results, status) => {
        clearTimeout(timer);
        if (status !== TGOS.TGLocatorStatus.OK) {
          reject(new Error(`TGOS 查詢狀態：${String(status)}`));
          return;
        }
        resolve(Array.isArray(results) ? results : []);
      });
    });
  },

  normalizeResult(result, queryAddress, index) {
    const x = Number(result?.geometry?.location?.x);
    const y = Number(result?.geometry?.location?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const transformation = new TGOS.TGTransformation();
    transformation.twd97towgs84(x, y);
    const lng = Number(transformation.transResult?.x);
    const lat = Number(transformation.transResult?.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 18 || lat > 28 || lng < 115 || lng > 125) return null;
    return {
      address: String(result.formattedAddress || result.address || result.name || queryAddress || `TGOS 結果 ${index + 1}`),
      queryAddress,
      lat,
      lng,
      twd97X: x,
      twd97Y: y,
      rawType: result.types ? String(result.types) : ''
    };
  },

  renderResults() {
    const container = document.getElementById('tgos-results');
    if (!container) return;
    container.replaceChildren();
    container.hidden = !this.results.length;
    this.results.forEach((result, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tgos-result${index === this.selectedIndex ? ' is-selected' : ''}`;
      const number = document.createElement('span');
      number.textContent = String(index + 1);
      const detail = document.createElement('span');
      const address = document.createElement('strong');
      address.textContent = result.address;
      const coordinate = document.createElement('small');
      coordinate.textContent = `${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`;
      detail.append(address, coordinate);
      button.append(number, detail);
      button.addEventListener('click', () => this.selectResult(index));
      container.appendChild(button);
    });
  },

  selectResult(index) {
    if (index < 0 || index >= this.results.length) return;
    this.selectedIndex = index;
    this.renderResults();
    this.showSelected();
    this.renderControls();
  },

  showSelected() {
    const result = this.results[this.selectedIndex];
    if (!result || !this.map) return;
    this.clearMarkers();
    const icon = L.divIcon({
      className: '',
      html: '<div class="tgos-locate-icon"><span>T</span></div>',
      iconSize: [30, 30],
      iconAnchor: [8, 27]
    });
    L.marker([result.lat, result.lng], { icon })
      .bindPopup(`<strong>${this.escapeHtml(result.address)}</strong><br>${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`)
      .addTo(this.markerLayer)
      .openPopup();
    this.map.setView([result.lat, result.lng], 18);
  },

  clearMarkers() {
    this.markerLayer?.clearLayers();
  },

  addSelectedToLayer() {
    const result = this.results[this.selectedIndex];
    if (!result) return;

    const activeLayer = LayerManager.getActiveLayer();
    if (!activeLayer) {
      App.showToast('無作用中圖層，無法加入', 'error');
      return;
    }
    if (activeLayer.locked) {
      App.showToast('作用中圖層已鎖定，無法加入', 'error');
      return;
    }

    const marker = L.marker([result.lat, result.lng]);
    marker.featureProps = {
      id: DrawManager.generateFeatureId(),
      name: result.address,
      description: 'TGOS 地址定位結果',
      source: 'TGOS',
      query_address: result.queryAddress,
      matched_address: result.address,
      twd97_x: result.twd97X,
      twd97_y: result.twd97Y,
      created_at: new Date().toISOString(),
      style: { ...DrawManager.currentStyle }
    };
    marker.setIcon(DrawManager.createSymbolIcon(DrawManager.currentStyle.symbol, DrawManager.currentStyle.color));
    marker.gisLayerId = activeLayer.id;
    DrawManager.setupLayerInteractions(marker);
    activeLayer.featureGroup.addLayer(marker);
    App.updateStats();
    TableManager.render();
    LayerManager?.render();
    App.showToast('TGOS 地址點已加入工作圖層', 'success');
    SafetyManager?.recordChange('加入 TGOS 地址點');
  },

  addSelectedToRoute() {
    const result = this.results[this.selectedIndex];
    if (!result || typeof RoutingManager === 'undefined') return;

    if (RoutingManager.points.length >= RoutingManager.maxPoints) {
      window.App?.showToast(`路網停靠點已達 ${RoutingManager.maxPoints} 點上限`, 'warning');
      return;
    }

    const currentLen = RoutingManager.points.length;
    const mode = typeof RoutingManager.getMode === 'function' ? RoutingManager.getMode() : 'open';

    let role = 'stop';
    if (currentLen === 0) {
      role = 'start';
    } else if (currentLen === 1 && mode === 'open' && RoutingManager.points[0].role === 'start') {
      role = 'end';
    } else {
      const hasStart = RoutingManager.points.some(p => p.role === 'start');
      const hasEnd = RoutingManager.points.some(p => p.role === 'end');
      if (!hasStart) {
        role = 'start';
      } else if (mode === 'open' && !hasEnd && currentLen === 1) {
        role = 'end';
      } else {
        role = 'stop';
      }
    }

    const pointId = typeof RoutingManager.generateId === 'function'
      ? RoutingManager.generateId('tgos')
      : `tgos_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const newPoint = {
      id: pointId,
      lat: Number(result.lat),
      lng: Number(result.lng),
      name: String(result.address || 'TGOS 定位點').trim(),
      role: role,
      originalIndex: currentLen + 1,
      source: 'TGOS'
    };

    RoutingManager.points.push(newPoint);

    if (typeof RoutingManager.syncRoleConstraints === 'function') {
      RoutingManager.syncRoleConstraints();
    }
    if (typeof RoutingManager.resetPointValidation === 'function') {
      RoutingManager.resetPointValidation();
    }

    RoutingManager.markRouteOutdated();
    RoutingManager.render();

    window.App?.showToast('TGOS 地址點已加入路網停靠點', 'success');
    window.SafetyManager?.recordChange('加入 TGOS 路網停靠點');
  },

  clearCredentials() {
    localStorage.removeItem(this.appIdKey);
    sessionStorage.removeItem(this.apiKeySessionKey);
    this.apiSignature = null;

    const appIdInput = document.getElementById('tgos-app-id');
    const apiKeyInput = document.getElementById('tgos-api-key');
    if (appIdInput) appIdInput.value = '';
    if (apiKeyInput) apiKeyInput.value = '';

    const script = document.getElementById('tgos-web-api-script');
    if (script) script.remove();

    this.setStatus('已清除 TGOS 憑證（AppID、APIKey 及動態腳本已移除）。');
    window.App?.showToast('已清除 TGOS 憑證', 'info');
  },

  renderControls() {
    const hasSelection = this.selectedIndex >= 0 && Boolean(this.results[this.selectedIndex]);
    const search = document.getElementById('btn-tgos-search');
    const addLayer = document.getElementById('btn-tgos-add-layer');
    const addRoute = document.getElementById('btn-tgos-add-route');
    if (search) search.disabled = this.isBusy;
    if (addLayer) addLayer.disabled = this.isBusy || !hasSelection;
    if (addRoute) addRoute.disabled = this.isBusy || !hasSelection;
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
  }
};

window.TGOSAddressManager = TGOSAddressManager;
