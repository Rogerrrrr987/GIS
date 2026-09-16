/**
 * GeoCanvas GIS Tool - Stage 2 Automated Security & Dependency Test Suite
 *
 * Verifies:
 * 1. Table search HTML injection (<img src=x onerror=alert(1)>) -> Safe DOM textContent only
 * 2. SVG/Script injection in Table search (<svg onload=alert(1)>, "><script>alert(1)</script>, <b>)
 * 3. Imported feature properties HTML injection -> Escaped via SecurityUtils
 * 4. Layer & Group name HTML injection -> Safe DOM textContent
 * 5. TGOS address results injection -> Safe DOM textContent
 * 6. TGOS APIKey protection (never in localStorage, project JSON, or console)
 * 7. Clear TGOS credentials -> Removes storage, signature, DOM values, and script element
 * 8. TGOS addSelectedToRoute preserves valid route, sets routeIsOutdated, enforces role rules
 * 9. OSRM authorization cancellation -> 0 fetch calls (fail-closed)
 * 10. Consented host storage -> Origin key only, no query or coordinates
 * 11. No @latest in any CDN URLs in index.html
 * 12. All CDN dependencies in index.html have explicit versions
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 1. Mock Browser Environment Setup
// ---------------------------------------------------------------------------

class MockClassList {
  constructor(element) {
    this.element = element;
    this._classes = new Set();
  }
  add(...names) { names.forEach(n => this._classes.add(n)); }
  remove(...names) { names.forEach(n => this._classes.delete(n)); }
  toggle(name, force) {
    if (force === true) { this._classes.add(name); return true; }
    if (force === false) { this._classes.delete(name); return false; }
    if (this._classes.has(name)) { this._classes.delete(name); return false; }
    this._classes.add(name); return true;
  }
  contains(name) { return this._classes.has(name); }
}

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.childNodes = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.classList = new MockClassList(this);
    this.listeners = {};
    this._textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.parentNode = null;
    this.type = 'button';
  }

  get id() { return this.attributes['id'] || ''; }
  set id(val) { this.attributes['id'] = String(val); }

  get textContent() {
    let str = this._textContent || '';
    for (const child of this.children) {
      str += typeof child === 'string' ? child : (child.textContent || '');
    }
    return str;
  }

  set textContent(val) {
    this._textContent = String(val ?? '');
    this.children = [];
    this.childNodes = [];
  }

  get innerHTML() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map(c => {
      if (typeof c === 'string') return c;
      const tag = c.tagName.toLowerCase();
      return `<${tag}>${c.innerHTML}</${tag}>`;
    }).join('');
  }

  set innerHTML(htmlStr) {
    this.children = [];
    this.childNodes = [];
    this._textContent = '';
    if (!htmlStr) return;

    // Check for tags
    const tagMatch = htmlStr.match(/<([a-z0-9]+)[^>]*>(.*?)<\/\1>/gi);
    if (tagMatch) {
      tagMatch.forEach(chunk => {
        const m = chunk.match(/<([a-z0-9]+)[^>]*>(.*?)<\/\1>/i);
        if (m) {
          const child = new MockElement(m[1]);
          child.innerHTML = m[2];
          child.parentNode = this;
          this.children.push(child);
          this.childNodes.push(child);
        }
      });
    } else {
      const selfCloseMatch = htmlStr.match(/<([a-z0-9]+)[^>]*>/gi);
      if (selfCloseMatch) {
        selfCloseMatch.forEach(chunk => {
          const m = chunk.match(/<([a-z0-9]+)/i);
          if (m) {
            const child = new MockElement(m[1]);
            child.parentNode = this;
            this.children.push(child);
            this.childNodes.push(child);
          }
        });
      } else {
        this._textContent = htmlStr;
      }
    }
  }

  appendChild(child) {
    if (child instanceof MockElement) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.children.push(child);
      this.childNodes.push(child);
      return child;
    }
    this.children.push(String(child));
    return child;
  }

  append(...items) {
    items.forEach(item => this.appendChild(item));
  }

  replaceChildren(...items) {
    this.children.forEach(c => { if (c instanceof MockElement) c.parentNode = null; });
    this.children = [];
    this.childNodes = [];
    this._textContent = '';
    this.append(...items);
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      if (child instanceof MockElement) child.parentNode = null;
    }
    const cidx = this.childNodes.indexOf(child);
    if (cidx !== -1) this.childNodes.splice(cidx, 1);
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
    if (this.id && mockDocument._standaloneElements.has(this.id)) {
      mockDocument._standaloneElements.delete(this.id);
    }
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  removeEventListener(type, handler) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(h => h !== handler);
  }

  setAttribute(name, val) { this.attributes[name] = String(val); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }

  querySelectorAll(selector) {
    const results = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child instanceof MockElement) {
          if (selector.startsWith('#') && child.id === selector.slice(1)) {
            results.push(child);
          } else if (selector.startsWith('.') && child.classList.contains(selector.slice(1))) {
            results.push(child);
          } else if (child.tagName.toLowerCase() === selector.toLowerCase()) {
            results.push(child);
          }
          walk(child);
        }
      }
    };
    walk(this);
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getElementsByTagName(tagName) {
    return this.querySelectorAll(tagName);
  }

  getBoundingClientRect() {
    return { width: 150, height: 200, left: 0, top: 0 };
  }
}

class MockStorage {
  constructor() { this.store = {}; }
  getItem(k) { return this.store[k] !== undefined ? this.store[k] : null; }
  setItem(k, v) { this.store[k] = String(v); }
  removeItem(k) { delete this.store[k]; }
  clear() { this.store = {}; }
}

const mockDocument = {
  body: new MockElement('body'),
  head: new MockElement('head'),
  _standaloneElements: new Map(),

  createElement(tag) {
    return new MockElement(tag);
  },

  createDocumentFragment() {
    const frag = new MockElement('fragment');
    return frag;
  },

  createTextNode(text) {
    const el = new MockElement('#text');
    el._textContent = String(text ?? '');
    return el;
  },

  getElementById(id) {
    const search = (node) => {
      if (!node) return null;
      if (node.id === id || node.getAttribute?.('id') === id) return node;
      for (const child of node.children) {
        if (child instanceof MockElement) {
          const found = search(child);
          if (found) return found;
        }
      }
      return null;
    };
    const inBody = search(this.body);
    if (inBody) return inBody;
    const inHead = search(this.head);
    if (inHead) return inHead;
    return this._standaloneElements.get(id) || null;
  },

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  },

  querySelectorAll(selector) {
    const results = [];
    results.push(...this.body.querySelectorAll(selector));
    results.push(...this.head.querySelectorAll(selector));
    this._standaloneElements.forEach(el => {
      if (selector.startsWith('#') && el.id === selector.slice(1)) results.push(el);
      else if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) results.push(el);
      else if (el.tagName.toLowerCase() === selector.toLowerCase()) results.push(el);
      results.push(...el.querySelectorAll(selector));
    });
    return results;
  },

  addEventListener() {},
  removeEventListener() {}
};

function getOrCreateElement(id, tag = 'div', parent = mockDocument.body) {
  let el = mockDocument.getElementById(id);
  if (!el) {
    el = new MockElement(tag);
    el.id = id;
    if (parent) parent.appendChild(el);
    else mockDocument._standaloneElements.set(id, el);
  }
  return el;
}

// Global environment initialization
global.window = global;
global.document = mockDocument;
global.localStorage = new MockStorage();
global.sessionStorage = new MockStorage();
global.Option = function(text, val) {
  const el = new MockElement('option');
  el.textContent = text;
  el.value = val !== undefined ? val : text;
  return el;
};
global.DOMException = class DOMException extends Error {
  constructor(msg, name) {
    super(msg);
    this.name = name || 'Error';
  }
};

class MockMarkerClass {
  getLatLng() {
    return { lat: this.latlng ? this.latlng[0] : 25.0, lng: this.latlng ? this.latlng[1] : 121.5 };
  }
  on() { return this; }
  off() { return this; }
}
class MockPolylineClass {}
class MockPolygonClass {}
class MockCircleClass {}

let lastMarkerCreated = null;
global.L = {
  Marker: MockMarkerClass,
  Polyline: MockPolylineClass,
  Polygon: MockPolygonClass,
  Circle: MockCircleClass,
  layerGroup() {
    const layers = [];
    return {
      addTo() { return this; },
      clearLayers() { layers.length = 0; },
      addLayer(l) { layers.push(l); },
      removeLayer(l) {
        const idx = layers.indexOf(l);
        if (idx !== -1) layers.splice(idx, 1);
      },
      getLayers() { return layers; },
      eachLayer(fn) { layers.forEach(fn); }
    };
  },
  marker(latlng, options) {
    const m = Object.assign(new MockMarkerClass(), {
      latlng,
      options,
      popupContent: '',
      bindPopup(content) { this.popupContent = content; return this; },
      addTo(g) { if (g?.addLayer) g.addLayer(this); return this; },
      openPopup() { return this; },
      setIcon() {},
      toGeoJSON() {
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [latlng[1], latlng[0]] },
          properties: {}
        };
      }
    });
    lastMarkerCreated = m;
    return m;
  },
  divIcon(opts) { return opts; },
  DomEvent: {
    disableClickPropagation() {},
    disableScrollPropagation() {}
  }
};

global.App = {
  showToast() {},
  updateStats() {}
};

global.SelectionManager = {
  selectedIds: new Set(),
  render() {}
};

const appRoot = path.resolve(__dirname);
require(path.join(appRoot, 'js/measure.js'));
require(path.join(appRoot, 'js/safety.js'));
require(path.join(appRoot, 'js/draw.js'));
require(path.join(appRoot, 'js/table.js'));
require(path.join(appRoot, 'js/layers.js'));
require(path.join(appRoot, 'js/catalog.js'));
require(path.join(appRoot, 'js/tgos-address.js'));
require(path.join(appRoot, 'js/topology.js'));
require(path.join(appRoot, 'js/routing-multipoint.js'));

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

test('1. Table search HTML injection prevention (<img src=x onerror=alert(1)>)', () => {
  getOrCreateElement('attribute-drawer');
  const tableBody = getOrCreateElement('attribute-table-body');
  getOrCreateElement('attribute-table-header');
  getOrCreateElement('drawer-feature-count');
  getOrCreateElement('table-search-input', 'input');

  TableManager.init();

  DrawManager.getAllLayers = () => [
    Object.assign(new MockMarkerClass(), {
      featureProps: { id: 'f1', name: '公園綠地', description: '景點' },
      _leaflet_id: 101,
      toGeoJSON() { return { geometry: { type: 'Point', coordinates: [121.5, 25.0] } }; }
    })
  ];

  TableManager.searchTerm = '<img src=x onerror=alert(1)>';
  TableManager.render();

  const imgElements = tableBody.getElementsByTagName('img');
  assert.strictEqual(imgElements.length, 0, 'No img element must be created in tableBody');

  const cell = tableBody.children[0]?.children[0];
  assert.ok(cell, 'Notice row should exist');
  assert.ok(cell.textContent.includes('<img src=x onerror=alert(1)>'), 'Cell textContent should contain verbatim search term');
});

test('2. SVG and script tag injection in Table search', () => {
  const tableBody = getOrCreateElement('attribute-table-body');
  const vectors = [
    '<svg onload=alert(1)>',
    '"><script>alert(1)</script>',
    '<b>測試粗體</b>'
  ];

  DrawManager.getAllLayers = () => [
    Object.assign(new MockMarkerClass(), {
      featureProps: { id: 'f1', name: '標準路段', description: '無害' },
      _leaflet_id: 102
    })
  ];

  vectors.forEach(payload => {
    TableManager.searchTerm = payload;
    TableManager.render();

    assert.strictEqual(tableBody.getElementsByTagName('svg').length, 0, `No svg element for ${payload}`);
    assert.strictEqual(tableBody.getElementsByTagName('script').length, 0, `No script element for ${payload}`);
    assert.strictEqual(tableBody.getElementsByTagName('b').length, 0, `No b element for ${payload}`);

    const cell = tableBody.children[0]?.children[0];
    assert.ok(cell.textContent.includes(payload), `textContent must contain raw text for ${payload}`);
  });
});

test('3. Imported feature properties HTML injection safely escaped', () => {
  const layer = Object.assign(new MockMarkerClass(), {
    featureProps: {
      id: 'p_xss',
      name: '<script>alert("name")</script>',
      description: '<img src=x onerror=alert(1)>',
      custom_alert: '<svg onload=alert(1)>'
    },
    _leaflet_id: 201,
    bindPopup(html) { this.popupContent = html; }
  });

  DrawManager.updateLayerPopup(layer);
  const popup = layer.popupContent;

  assert.ok(!popup.includes('<script>'), 'Popup must not contain unescaped script tag');
  assert.ok(popup.includes('&lt;script&gt;'), 'Popup must contain escaped script tag');
  assert.ok(!popup.includes('<img src=x'), 'Popup must not contain unescaped img tag');
  assert.ok(popup.includes('&lt;img src=x'), 'Popup must contain escaped img tag');
  assert.ok(popup.includes('&lt;svg onload='), 'Popup must contain escaped svg tag');
});

test('4. Layer name and group name HTML injection rendered safely', () => {
  const tree = getOrCreateElement('layer-tree-container');
  LayerManager.treeContainer = tree;

  LayerManager.groups = [
    { id: 'g1', name: '<img src=x onerror=alert("group")>', collapsed: false }
  ];

  const fakeFeatureGroup = { getLayers: () => [], eachLayer: () => {} };
  LayerManager.layers = [
    {
      id: 'l1',
      name: '<script>alert("layer")</script>',
      groupId: 'g1',
      geometryType: 'Polygon',
      featureGroup: fakeFeatureGroup,
      visible: true,
      locked: false
    }
  ];

  LayerManager.render();

  assert.strictEqual(tree.getElementsByTagName('script').length, 0, 'No script tags in layer tree');
  assert.strictEqual(tree.getElementsByTagName('img').length, 0, 'No img tags in layer tree');
  assert.ok(tree.textContent.includes('<script>alert("layer")</script>'), 'Layer name is rendered as plain text');
  assert.ok(tree.textContent.includes('<img src=x onerror=alert("group")>'), 'Group name is rendered as plain text');
});

test('5. TGOS address query result injection rendered safely', () => {
  const resultsContainer = getOrCreateElement('tgos-results');
  TGOSAddressManager.results = [
    {
      address: '<img src=x onerror=alert("tgos")>忠孝東路一段',
      lat: 25.04,
      lng: 121.52,
      queryAddress: '忠孝東路'
    }
  ];
  TGOSAddressManager.selectedIndex = 0;
  TGOSAddressManager.renderResults();

  assert.strictEqual(resultsContainer.getElementsByTagName('img').length, 0, 'No img tags in TGOS results');
  assert.ok(resultsContainer.textContent.includes('<img src=x onerror=alert("tgos")>忠孝東路一段'), 'Raw text rendered in strong element');

  // Verify popup escaping
  TGOSAddressManager.map = { setView() {} };
  TGOSAddressManager.markerLayer = {
    clearLayers() {},
    addLayer(m) {}
  };
  TGOSAddressManager.showSelected();
  assert.ok(lastMarkerCreated, 'Marker should be created');
  assert.ok(!lastMarkerCreated.popupContent.includes('<img src=x'), 'TGOS map popup must not have unescaped img tag');
  assert.ok(lastMarkerCreated.popupContent.includes('&lt;img src=x'), 'TGOS map popup must have escaped img tag');
});

test('6. TGOS APIKey excluded from localStorage, project JSON, and sanitized in errors', () => {
  localStorage.clear();
  sessionStorage.clear();

  const appIdInput = getOrCreateElement('tgos-app-id', 'input');
  const apiKeyInput = getOrCreateElement('tgos-api-key', 'input');
  appIdInput.value = 'TEST_APP_ID';
  apiKeyInput.value = 'TOP_SECRET_API_KEY_12345';

  const creds = TGOSAddressManager.getCredentials();
  assert.strictEqual(creds.appId, 'TEST_APP_ID');
  assert.strictEqual(creds.apiKey, 'TOP_SECRET_API_KEY_12345');

  // Verify storage isolation
  assert.strictEqual(localStorage.getItem(TGOSAddressManager.appIdKey), 'TEST_APP_ID');
  assert.strictEqual(localStorage.getItem(TGOSAddressManager.apiKeySessionKey), null, 'APIKey MUST NOT be in localStorage');
  assert.strictEqual(sessionStorage.getItem(TGOSAddressManager.apiKeySessionKey), 'TOP_SECRET_API_KEY_12345', 'APIKey must be in sessionStorage');

  // Verify project serialization excludes APIKey
  const project = SafetyManager.captureProject();
  const projectJson = JSON.stringify(project);
  assert.ok(!projectJson.includes('TOP_SECRET_API_KEY'), 'Project file must not include APIKey');
  assert.ok(!projectJson.includes('TEST_APP_ID'), 'Project file must not include AppID');

  // Verify error sanitization
  const rawError = 'Failed: https://api.tgos.tw/TGOS_API/tgos?AppID=TEST_APP_ID&APIKey=TOP_SECRET_API_KEY_12345&ver=2';
  const sanitized = TGOSAddressManager.sanitizeErrorMessage(rawError);
  assert.ok(!sanitized.includes('TOP_SECRET_API_KEY_12345'), 'Sanitized error must mask APIKey');
  assert.ok(sanitized.includes('APIKey=***'), 'Sanitized error must contain APIKey=***');
});

test('7. Clear TGOS credentials removes storage, inputs, script tag without affecting results/layers', () => {
  localStorage.setItem(TGOSAddressManager.appIdKey, 'MY_APP_ID');
  sessionStorage.setItem(TGOSAddressManager.apiKeySessionKey, 'MY_KEY');
  TGOSAddressManager.apiSignature = 'sig_123';

  const appIdInput = getOrCreateElement('tgos-app-id', 'input');
  const apiKeyInput = getOrCreateElement('tgos-api-key', 'input');
  appIdInput.value = 'MY_APP_ID';
  apiKeyInput.value = 'MY_KEY';

  const script = getOrCreateElement('tgos-web-api-script', 'script', mockDocument.head);
  assert.ok(mockDocument.getElementById('tgos-web-api-script'), 'Script tag should be present initially');

  TGOSAddressManager.results = [{ address: '保有結果', lat: 25, lng: 121 }];

  TGOSAddressManager.clearCredentials();

  assert.strictEqual(localStorage.getItem(TGOSAddressManager.appIdKey), null, 'localStorage AppID removed');
  assert.strictEqual(sessionStorage.getItem(TGOSAddressManager.apiKeySessionKey), null, 'sessionStorage APIKey removed');
  assert.strictEqual(TGOSAddressManager.apiSignature, null, 'apiSignature cleared');
  assert.strictEqual(appIdInput.value, '', 'Input field cleared');
  assert.strictEqual(apiKeyInput.value, '', 'Input field cleared');
  assert.strictEqual(mockDocument.getElementById('tgos-web-api-script'), null, 'Script tag removed');
  assert.strictEqual(TGOSAddressManager.results.length, 1, 'Previous query results preserved');
});

test('8. TGOS addSelectedToRoute preserves valid route, sets routeIsOutdated, enforces role rules', () => {
  RoutingManager.points = [];
  RoutingManager.currentRoute = {
    distance: 5000,
    duration: 600,
    orderedPoints: [{ id: 'p1', name: '起點' }],
    approximate: false
  };
  RoutingManager.routeLayer = { _leaflet_id: 888 };
  RoutingManager.routeIsOutdated = false;

  TGOSAddressManager.results = [
    { address: '台北市信義路五段7號', lat: 25.0339, lng: 121.5644 },
    { address: '台北車站', lat: 25.0478, lng: 121.5170 },
    { address: '松山機場', lat: 25.0696, lng: 121.5524 }
  ];

  // Point 1 (empty points list -> must become start)
  TGOSAddressManager.selectedIndex = 0;
  TGOSAddressManager.addSelectedToRoute();

  assert.strictEqual(RoutingManager.points.length, 1);
  assert.strictEqual(RoutingManager.points[0].role, 'start', 'First point must be start');
  assert.strictEqual(RoutingManager.points[0].source, 'TGOS');
  assert.strictEqual(RoutingManager.points[0].originalIndex, 1);
  assert.ok(RoutingManager.points[0].id, 'Must have valid unique id');
  assert.strictEqual(RoutingManager.routeIsOutdated, true, 'routeIsOutdated must be set to true');
  assert.ok(RoutingManager.currentRoute !== null, 'currentRoute must be preserved');
  assert.ok(RoutingManager.routeLayer !== null, 'routeLayer must be preserved');

  // Point 2 (open mode with 1 point -> 2nd point must become end)
  TGOSAddressManager.selectedIndex = 1;
  TGOSAddressManager.addSelectedToRoute();
  assert.strictEqual(RoutingManager.points.length, 2);
  assert.strictEqual(RoutingManager.points[1].role, 'end', 'Second point in open mode must be end');

  // Point 3 (already has start and end -> 3rd point must become stop)
  TGOSAddressManager.selectedIndex = 2;
  TGOSAddressManager.addSelectedToRoute();
  assert.strictEqual(RoutingManager.points.length, 3);
  assert.strictEqual(RoutingManager.points[2].role, 'stop', 'Subsequent point must be stop');

  // Point count upper limit guard (simulate 200 points)
  RoutingManager.points = new Array(200).fill(null).map((_, i) => ({ id: `p_${i}`, role: 'stop' }));
  const prevLen = RoutingManager.points.length;
  TGOSAddressManager.selectedIndex = 0;
  TGOSAddressManager.addSelectedToRoute();
  assert.strictEqual(RoutingManager.points.length, prevLen, 'Must not add point when limit reached');
});

test('9. OSRM authorization rejection results in exactly 0 fetch calls', async () => {
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    return { ok: true, json: async () => ({}) };
  };

  localStorage.removeItem(RoutingManager.consentedHostsKey);

  getOrCreateElement('routing-consent-modal');
  getOrCreateElement('routing-consent-url');
  getOrCreateElement('routing-consent-count');
  getOrCreateElement('routing-consent-remember', 'input');

  const consentPromise = RoutingManager.ensureOsrmConsent(2);
  RoutingManager.rejectOsrmConsent();

  await assert.rejects(consentPromise, (err) => {
    return err.name === 'AbortError' || /取消/.test(err.message);
  });

  assert.strictEqual(fetchCalls, 0, 'No fetch calls must be made if user rejects authorization');
});

test('10. Consented host storage stores origin key only (no coordinates, no query)', () => {
  const baseKey = RoutingManager.getServiceOriginKey('https://router.project-osrm.org:5000/routing/path?param=val#hash');
  assert.strictEqual(baseKey, 'https://router.project-osrm.org:5000/routing/path');
  assert.ok(!baseKey.includes('?'), 'Key must not contain query parameters');
  assert.ok(!baseKey.includes('#'), 'Key must not contain hash fragments');
  assert.ok(!baseKey.includes(';'), 'Key must not contain coordinate pairs');
});

test('11. All CDN URLs in index.html do NOT contain @latest', () => {
  const indexHtml = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
  const cdnLines = indexHtml.split('\n').filter(line => line.includes('unpkg.com') || line.includes('http'));

  const latestLines = cdnLines.filter(line => line.includes('@latest'));
  assert.strictEqual(latestLines.length, 0, `Found URLs containing @latest: ${latestLines.join(', ')}`);
});

test('12. All CDN dependencies in index.html have explicit fixed versions', () => {
  const indexHtml = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
  const matches = [...indexHtml.matchAll(/src="([^"]+unpkg\.com[^"]+)"|href="([^"]+unpkg\.com[^"]+)"/g)];

  assert.ok(matches.length >= 10, 'Should find all CDN links in index.html');
  matches.forEach(m => {
    const url = m[1] || m[2];
    assert.match(url, /@[0-9]+\.[0-9]+/, `URL ${url} must contain an explicit version tag`);
  });
});
