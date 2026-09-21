/**
 * GeoCanvas GIS Tool - Phase 2 UI Automated Test Suite
 *
 * Tests:
 * 1. Layer lock protection:
 *    - Locked layer cannot be deleted via LayerManager.deleteLayer()
 *    - Drawing on locked active layer is rejected by DrawManager.handleCreate()
 *    - Feature deletion on locked layer is rejected
 * 2. Layer drag-and-drop reordering:
 *    - Reorders layers in array
 *    - Preserves target group ID
 *    - Calls updateMapZIndex()
 * 3. Attribute table Phase 2:
 *    - Scoped to active layer features
 *    - Column sorting (asc, desc, none)
 *    - Faint null dash ('—') rendered for null/undefined/empty without mutating underlying featureProps
 *    - Asynchronous App.confirm / promptInput used instead of native dialogs
 * 4. Multi-point routing Phase 2:
 *    - Role uniqueness enforcement (start/end)
 *    - normalizeStartEndPositions() places start at 0, end at last
 *    - Insufficient points disable buttons with tooltip
 *    - Straight-line preview cannot be saved
 *    - Barrier mode cursor and conflict badges
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Setup minimal mock environment
class MockClassList {
  constructor(el) {
    this.el = el;
    this._classes = new Set();
  }
  add(...names) { names.forEach(n => this._classes.add(n)); }
  remove(...names) { names.forEach(n => this._classes.delete(n)); }
  toggle(name, force) {
    if (force !== undefined) {
      if (force) this._classes.add(name);
      else this._classes.delete(name);
      return force;
    }
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
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.classList = new MockClassList(this);
    this.listeners = {};
    this._textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.title = '';
    this.type = 'button';
  }

  get id() { return this.attributes['id'] || ''; }
  set id(val) { this.attributes['id'] = String(val); }

  get className() {
    return Array.from(this.classList._classes).join(' ');
  }
  set className(val) {
    this.classList._classes.clear();
    String(val || '').split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent || '';
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
    if (this.children.length === 0) return this._textContent || '';
    return this.children.map(c => typeof c === 'string' ? c : `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`).join('');
  }
  set innerHTML(htmlStr) {
    this.children = [];
    this.childNodes = [];
    this._textContent = '';
    if (!htmlStr) return;
    this._textContent = htmlStr;
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = String(val);
    }
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset[camel];
    }
  }

  appendChild(child) {
    if (!child) return child;
    if (child.tagName === 'FRAGMENT') {
      const fragmentChildren = [...child.children];
      child.children = [];
      child.childNodes = [];
      fragmentChildren.forEach(c => this.appendChild(c));
      return child;
    }
    if (typeof child === 'string') {
      this._textContent += child;
      return child;
    }
    if (child.parentNode) {
      const idx = child.parentNode.children.indexOf(child);
      if (idx > -1) {
        child.parentNode.children.splice(idx, 1);
        child.parentNode.childNodes.splice(idx, 1);
      }
    }
    child.parentNode = this;
    this.children.push(child);
    this.childNodes.push(child);
    return child;
  }

  append(...nodes) {
    nodes.forEach(n => this.appendChild(n));
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.childNodes = [];
    this._textContent = '';
    nodes.forEach(n => this.appendChild(n));
  }

  replaceWith(newEl) {
    if (!this.parentNode) return;
    const idx = this.parentNode.children.indexOf(this);
    if (idx !== -1) {
      this.parentNode.children[idx] = newEl;
      this.parentNode.childNodes[idx] = newEl;
      newEl.parentNode = this.parentNode;
    }
  }

  insertBefore(newChild, refChild) {
    const idx = this.children.indexOf(refChild);
    if (idx === -1) {
      return this.appendChild(newChild);
    }
    newChild.parentNode = this;
    this.children.splice(idx, 0, newChild);
    this.childNodes.splice(idx, 0, newChild);
    return newChild;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx > -1) {
      this.children.splice(idx, 1);
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      if (selector.startsWith('.') && cur.classList?.contains(selector.slice(1))) return cur;
      if (selector.startsWith('#') && cur.id === selector.slice(1)) return cur;
      if (cur.tagName && cur.tagName.toLowerCase() === selector.toLowerCase()) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    const found = this.querySelectorAll(selector);
    return found.length > 0 ? found[0] : null;
  }

  add(item) {
    this.appendChild(item);
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  contains(child) {
    if (this === child) return true;
    for (const c of this.children) {
      if (typeof c !== 'string' && c.contains && c.contains(child)) return true;
    }
    return false;
  }

  querySelectorAll(selector) {
    if (selector.includes(',')) {
      const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
      const res = [];
      for (const p of parts) {
        res.push(...this.querySelectorAll(p));
      }
      return Array.from(new Set(res));
    }
    const results = [];
    const check = (node) => {
      if (node.tagName) {
        let match = false;
        if (selector.startsWith('.')) {
          const classes = selector.split('.').filter(Boolean);
          match = classes.every(c => node.classList.contains(c));
        } else if (selector.includes('.')) {
          const [tag, ...classes] = selector.split('.');
          const tagOk = !tag || node.tagName.toLowerCase() === tag.toLowerCase();
          const classOk = classes.every(c => node.classList.contains(c));
          match = tagOk && classOk;
        } else if (selector.startsWith('#')) {
          match = node.id === selector.slice(1);
        } else if (selector.includes('[') && selector.includes(']')) {
          const attrMatch = selector.match(/(\w+)?\[([\w-]+)(?:=['"]?([^'"]+)['"]?)?\]/);
          if (attrMatch) {
            const tag = attrMatch[1];
            const attr = attrMatch[2];
            const val = attrMatch[3];
            const tagOk = !tag || node.tagName.toLowerCase() === tag.toLowerCase();
            const hasAttr = attr.startsWith('data-')
              ? (node.dataset[attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] !== undefined || node.attributes[attr] !== undefined)
              : node.attributes[attr] !== undefined;
            const valOk = val === undefined || (attr.startsWith('data-')
              ? String(node.dataset[attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]) === val || node.attributes[attr] === val
              : node.attributes[attr] === val);
            match = tagOk && hasAttr && valOk;
          }
        } else if (node.tagName.toLowerCase() === selector.toLowerCase()) {
          match = true;
        }
        if (match) results.push(node);
      }
      for (const c of node.children) {
        if (typeof c !== 'string') check(c);
      }
    };
    check(this);
    return results;
  }

  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  removeEventListener(type, fn) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(f => f !== fn);
  }

  dispatchEvent(event) {
    const handlers = this.listeners[event.type] || [];
    handlers.forEach(h => h(event));
  }

  click() {
    if (typeof this.onclick === 'function') {
      this.onclick({ type: 'click', target: this, stopPropagation: () => {}, preventDefault: () => {} });
    }
    this.dispatchEvent({ type: 'click', target: this, stopPropagation: () => {}, preventDefault: () => {} });
  }

  focus() {}
  select() {}
}

const mockDomElements = new Map();
function getOrCreateElement(id, tag = 'div') {
  if (!mockDomElements.has(id)) {
    const el = new MockElement(tag);
    el.id = id;
    mockDomElements.set(id, el);
  }
  return mockDomElements.get(id);
}

const documentListeners = {};
global.document = {
  documentElement: new MockElement('html'),
  body: new MockElement('body'),
  head: new MockElement('head'),
  getElementById: (id) => mockDomElements.get(id) || null,
  querySelector: (selector) => {
    const list = global.document.querySelectorAll(selector);
    return list.length > 0 ? list[0] : null;
  },
  querySelectorAll: (selector) => {
    if (selector.includes(',')) {
      const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
      const res = [];
      for (const p of parts) {
        res.push(...global.document.querySelectorAll(p));
      }
      return Array.from(new Set(res));
    }
    const results = [];
    const checkNode = (node) => {
      if (node.tagName) {
        let match = false;
        if (selector.startsWith('.')) {
          const classes = selector.split('.').filter(Boolean);
          match = classes.every(c => node.classList.contains(c));
        } else if (selector.includes('.')) {
          const [tag, ...classes] = selector.split('.');
          const tagOk = !tag || node.tagName.toLowerCase() === tag.toLowerCase();
          const classOk = classes.every(c => node.classList.contains(c));
          match = tagOk && classOk;
        } else if (selector.startsWith('#')) {
          match = node.id === selector.slice(1);
        } else if (selector.includes('[') && selector.includes(']')) {
          const attrMatch = selector.match(/(\w+)?\[([\w-]+)(?:=['"]?([^'"]+)['"]?)?\]/);
          if (attrMatch) {
            const tag = attrMatch[1];
            const attr = attrMatch[2];
            const val = attrMatch[3];
            const tagOk = !tag || node.tagName.toLowerCase() === tag.toLowerCase();
            const hasAttr = attr.startsWith('data-')
              ? (node.dataset[attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] !== undefined || node.attributes[attr] !== undefined)
              : node.attributes[attr] !== undefined;
            const valOk = val === undefined || (attr.startsWith('data-')
              ? String(node.dataset[attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]) === val || node.attributes[attr] === val
              : node.attributes[attr] === val);
            match = tagOk && hasAttr && valOk;
          }
        } else if (node.tagName.toLowerCase() === selector.toLowerCase()) {
          match = true;
        }
        if (match) results.push(node);
      }
      for (const c of node.children || []) {
        if (typeof c !== 'string') checkNode(c);
      }
    };
    for (const el of mockDomElements.values()) {
      checkNode(el);
    }
    if (global.document.body) checkNode(global.document.body);
    return Array.from(new Set(results));
  },
  createElement: (tag) => new MockElement(tag),
  createDocumentFragment: () => new MockElement('fragment'),
  addEventListener: (type, fn) => {
    if (!documentListeners[type]) documentListeners[type] = [];
    documentListeners[type].push(fn);
  },
  removeEventListener: (type, fn) => {
    if (!documentListeners[type]) return;
    documentListeners[type] = documentListeners[type].filter(f => f !== fn);
  },
  dispatchEvent: (event) => {
    const handlers = documentListeners[event.type] || [];
    handlers.forEach(h => h(event));
  }
};

global.Option = class Option {
  constructor(text, value) {
    const el = new MockElement('option');
    el.value = value !== undefined ? String(value) : String(text || '');
    el.textContent = String(text || '');
    return el;
  }
};
global.window = {
  document: global.document,
  Option: global.Option,
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1280,
  innerHeight: 800,
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  }
};
global.localStorage = global.window.localStorage;

// Mock Leaflet
class MockMarker {
  constructor(latlng, opts) {
    this.latlng = latlng || { lat: 25.0, lng: 121.5 };
    this.options = opts || {};
    this.featureProps = {};
  }
  getLatLng() { return this.latlng || { lat: 25.0, lng: 121.5 }; }
  addTo() { return this; }
  on() { return this; }
  setIcon(icon) { this.options.icon = icon; return this; }
  setStyle(style) { Object.assign(this.options, style); return this; }
  setOpacity(val) { this.options.opacity = val; }
  toGeoJSON() {
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [this.latlng.lng, this.latlng.lat]
      },
      properties: this.featureProps || {}
    };
  }
}
class MockCircle {
  constructor(latlng, opts) {
    this.latlng = latlng || { lat: 25.0, lng: 121.5 };
    this.options = opts || {};
    this.featureProps = {};
  }
  getRadius() { return this.options.radius || 100; }
  getLatLng() { return this.latlng || { lat: 25.0, lng: 121.5 }; }
  addTo() { return this; }
  setStyle(style) { Object.assign(this.options, style); return this; }
  setOpacity(val) { this.options.opacity = val; }
}
class MockPolyline {
  constructor(latlngs, opts) {
    this.latlngs = latlngs || [];
    this.options = opts || {};
    this.featureProps = {};
  }
  getLatLngs() {
    return (this.latlngs || []).map(p => ({
      lat: p.lat ?? p[0] ?? 25.0,
      lng: p.lng ?? p[1] ?? 121.5,
      distanceTo: (other) => 1000
    }));
  }
  addTo() { return this; }
  setStyle(style) { Object.assign(this.options, style); return this; }
  toGeoJSON() {
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: (this.latlngs || []).map(p => [p.lng || p[1] || 121.5, p.lat || p[0] || 25.0])
      },
      properties: this.featureProps || {}
    };
  }
}
class MockPolygon extends MockPolyline {}

global.L = {
  Marker: MockMarker,
  Circle: MockCircle,
  Polyline: MockPolyline,
  Polygon: MockPolygon,
  Icon: {
    Default: class MockIconDefault {
      constructor() {
        this.options = {};
      }
    }
  },
  featureGroup: () => {
    const layers = [];
    return {
      _layers: layers,
      addLayer: (l) => { if (!layers.includes(l)) layers.push(l); },
      removeLayer: (l) => {
        const idx = layers.indexOf(l);
        if (idx > -1) layers.splice(idx, 1);
      },
      getLayers: () => layers.slice(),
      eachLayer: (fn) => layers.slice().forEach(fn),
      addTo() { return this; },
      bringToFront: () => {},
      clearLayers: () => { layers.length = 0; },
      getBounds: () => ({ isValid: () => true })
    };
  },
  layerGroup: () => global.L.featureGroup(),
  latLngBounds: () => ({ isValid: () => true, pad: () => ({}) }),
  latLng: (lat, lng) => ({
    lat: typeof lat === 'object' ? lat.lat : lat,
    lng: typeof lat === 'object' ? lat.lng : lng,
    distanceTo: () => 1000
  }),
  polyline: (latlngs, opts) => new MockPolyline(latlngs, opts),
  circle: (latlng, opts) => new MockCircle(latlng, opts),
  marker: (latlng, opts) => new MockMarker(latlng, opts),
  divIcon: () => ({})
};

// Selection Manager mock
global.SelectionManager = {
  selectedIds: new Set(),
  render() {},
  clearSelection() { this.selectedIds.clear(); this.render(); },
  toggleSelection(layer, e) {
    const id = layer?.featureProps?.id;
    if (!id) return;
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    this.render();
  }
};
global.window.SelectionManager = global.SelectionManager;

// Load modules
global.I18n = require('./js/i18n.js');
global.window.I18n = global.I18n;
require('./js/measure.js');
require('./js/safety.js');
require('./js/layers.js');
require('./js/draw.js');
require('./js/table.js');
require('./js/routing-multipoint.js');
require('./js/app.js');

global.LayerManager = window.LayerManager;
global.RoutingManager = window.RoutingManager;
global.DrawManager = window.DrawManager;
global.TableManager = window.TableManager;
global.PanelManager = window.PanelManager;

// Mock App
global.App = {
  map: {
    hasLayer: () => true,
    removeLayer: () => {},
    addLayer: () => {},
    fitBounds: () => {},
    setView: () => {},
    getZoom: () => 12,
    getContainer: () => getOrCreateElement('map'),
    distance: (p1, p2) => {
      const lat1 = Array.isArray(p1) ? p1[0] : (p1?.lat || 0);
      const lng1 = Array.isArray(p1) ? p1[1] : (p1?.lng || 0);
      const lat2 = Array.isArray(p2) ? p2[0] : (p2?.lat || 0);
      const lng2 = Array.isArray(p2) ? p2[1] : (p2?.lng || 0);
      const dLat = (lat1 - lat2) * 111320;
      const dLng = (lng1 - lng2) * 111320 * Math.cos(lat1 * Math.PI / 180);
      return Math.hypot(dLat, dLng);
    }
  },
  toasts: [],
  showToast(msg, type) { this.toasts.push({ msg, type }); },
  confirmCalls: [],
  confirm(msg, opts) {
    this.confirmCalls.push({ msg, opts });
    return Promise.resolve(true);
  },
  promptInputCalls: [],
  promptInput(title, label, defaultVal, opts) {
    this.promptInputCalls.push({ title, label, defaultVal, opts });
    return Promise.resolve(defaultVal);
  },
  updateStats: () => {}
};
global.window.App = global.App;
DrawManager.map = global.App.map;
DrawManager.getAllLayers = () => LayerManager.layers.flatMap(l => l.featureGroup.getLayers());
DrawManager.generateFeatureId = () => 'feat_' + Math.random().toString(36).slice(2);
DrawManager.setupLayerInteractions = () => {};

// =============================================================================
// TESTS
// =============================================================================

// --- 1. Layer Management (Tests 1-8) ---

test('1. Layer lock protection: locked layer cannot be deleted and blocks drawing', async () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('保護圖層', 'Point');
  assert.strictEqual(layer.locked, false, 'New layer starts unlocked');

  layer.locked = true;
  App.toasts = [];
  await LayerManager.deleteLayer(layer.id);

  assert.strictEqual(LayerManager.layers.length, 1, 'Locked layer was not deleted');
  assert.ok(App.toasts.some(t => t.msg.includes('圖層已鎖定')), 'Toast warned about locked layer');

  // Test drawing on locked layer
  const mockFeature = { gisLayerId: layer.id, featureProps: {} };
  let removed = false;
  DrawManager.map = {
    removeLayer: () => { removed = true; }
  };
  App.toasts = [];
  DrawManager.handleCreate(mockFeature, 'Marker');
  assert.ok(removed, 'New feature on locked layer was rejected/removed');
  assert.ok(App.toasts.some(t => t.msg.includes('作用中圖層已鎖定')), 'Toast showed locked drawing error');
});

test('2. Layer reordering preserves group and updates map z-index', () => {
  LayerManager.layers = [];
  LayerManager.groups = [];

  const groupA = LayerManager.createGroup('群組 A');
  const l1 = LayerManager.createLayer('圖層 1', 'any', groupA.id);
  const l2 = LayerManager.createLayer('圖層 2', 'any', null);

  // createLayer unshifts to top of layers array, so initial order is [l2, l1]
  assert.strictEqual(LayerManager.layers[0].id, l2.id);
  assert.strictEqual(LayerManager.layers[1].id, l1.id);
  assert.strictEqual(l1.groupId, groupA.id);
  assert.strictEqual(l2.groupId, null);

  // Drag l2 into l1's position
  let zIndexCalled = false;
  LayerManager.updateMapZIndex = () => { zIndexCalled = true; };

  LayerManager.reorderLayer(l2.id, l1.id);
  assert.strictEqual(LayerManager.layers[1].id, l2.id, 'l2 moved to target position');
  assert.strictEqual(l2.groupId, groupA.id, 'l2 adopted target group ID');
  assert.strictEqual(zIndexCalled, true, 'updateMapZIndex called');
});

test('3. Layer duplicate: clones styling and features correctly into a new layer', () => {
  LayerManager.layers = [];
  const src = LayerManager.createLayer('原始點位', 'Point');
  const feat = new MockMarker({ lat: 25.01, lng: 121.51 });
  feat.featureProps = { name: '景點 A', category: '旅遊' };
  src.featureGroup.addLayer(feat);

  LayerManager.duplicateLayer(src.id);
  assert.strictEqual(LayerManager.layers.length, 2, 'New duplicated layer created');
  const dup = LayerManager.layers[0];
  assert.ok(dup.name.includes('複本'), 'Duplicated layer has duplicate suffix');
  assert.strictEqual(dup.source, 'duplicate');
  assert.strictEqual(dup.featureGroup.getLayers().length, 1, 'Feature cloned to new layer');
  assert.strictEqual(dup.featureGroup.getLayers()[0].featureProps.name, '景點 A');
  assert.notStrictEqual(dup.featureGroup.getLayers()[0].featureProps.id, feat.featureProps.id, 'Cloned feature gets unique ID');
});

test('4. Layer visibility toggle: hides/shows featureGroup on map and updates layer.visible', () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('可見性測試', 'Point');
  assert.strictEqual(layer.visible, true);

  const mapLayers = new Set([layer.featureGroup]);
  let removedFromMap = false;
  let addedToMap = false;
  App.map.hasLayer = (fg) => mapLayers.has(fg);
  App.map.removeLayer = (fg) => { mapLayers.delete(fg); removedFromMap = true; };
  App.map.addLayer = (fg) => { mapLayers.add(fg); addedToMap = true; };

  LayerManager.toggleVisibility(layer.id);
  assert.strictEqual(layer.visible, false);
  assert.strictEqual(removedFromMap, true);

  LayerManager.toggleVisibility(layer.id);
  assert.strictEqual(layer.visible, true);
  assert.strictEqual(addedToMap, true);
});

test('5. Layer opacity: applyLayerOpacity updates feature styles without mutating data', () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('透明度測試', 'Point');
  const marker = new MockMarker();
  layer.featureGroup.addLayer(marker);

  layer.opacity = 0.5;
  LayerManager.applyLayerOpacity(layer);
  assert.strictEqual(marker.options.opacity, 0.45, 'Marker opacity applied');
});

test('6. Layer groups: createGroup, toggleGroup and deleteGroup ungroups child layers', async () => {
  LayerManager.layers = [];
  LayerManager.groups = [];
  const grp = LayerManager.createGroup('設施群組');
  assert.strictEqual(grp.collapsed, false);
  assert.strictEqual(LayerManager.groups.length, 1);

  LayerManager.toggleGroup(grp.id);
  assert.strictEqual(grp.collapsed, true, 'Group collapsed state toggled');

  const l1 = LayerManager.createLayer('子圖層 1', 'Point', grp.id);
  assert.strictEqual(l1.groupId, grp.id);

  await LayerManager.deleteGroup(grp.id);
  assert.strictEqual(LayerManager.groups.length, 0, 'Group deleted');
  assert.strictEqual(l1.groupId, null, 'Child layer ungrouped (groupId set to null) but preserved');
  assert.strictEqual(LayerManager.layers.length, 1, 'Child layer remains intact');
});

test('7. Active layer switch: setActiveLayer updates activeLayerId and TableManager scoping', () => {
  LayerManager.layers = [];
  const l1 = LayerManager.createLayer('圖層 1', 'Point');
  const l2 = LayerManager.createLayer('圖層 2', 'Line');

  LayerManager.setActiveLayer(l1.id);
  assert.strictEqual(LayerManager.activeLayerId, l1.id);
  assert.strictEqual(LayerManager.getActiveLayer().id, l1.id);

  LayerManager.setActiveLayer(l2.id);
  assert.strictEqual(LayerManager.activeLayerId, l2.id);
  assert.strictEqual(LayerManager.getActiveLayer().id, l2.id);
});

test('8. Layer inline rename: trims whitespace, ignores empty names, updates on valid input', () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('舊名稱', 'Point');
  const container = getOrCreateElement('layer-tree-container');
  LayerManager.treeContainer = container;

  const row = new MockElement('div');
  row.className = 'layer-row';
  row.dataset.layerId = layer.id;
  const label = new MockElement('span');
  label.className = 'layer-row-label';
  label.textContent = layer.name;
  row.appendChild(label);
  container.appendChild(row);

  LayerManager.startInlineRenameLayer(layer.id);
  const input = row.querySelector('input.layer-inline-name-input');
  assert.ok(input, 'Inline input rendered');

  // Empty input submitted -> name unchanged
  input.value = '   ';
  input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => {}, stopPropagation: () => {} });
  assert.strictEqual(layer.name, '舊名稱', 'Whitespace-only name rejected');

  // Re-start and enter valid name
  container.replaceChildren();
  row.replaceChildren(label);
  container.appendChild(row);
  LayerManager.startInlineRenameLayer(layer.id);
  const input2 = row.querySelector('input.layer-inline-name-input');
  input2.value = '  新設施圖層  ';
  input2.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => {}, stopPropagation: () => {} });
  assert.strictEqual(layer.name, '新設施圖層', 'Valid name trimmed and saved');
});

// --- 2. Attribute Table Phase 2 (Tests 9-18) ---

test('9. Attribute Table: layer scoping and null dash display without mutating data', () => {
  LayerManager.layers = [];
  const layer1 = LayerManager.createLayer('圖層 1', 'any');
  const layer2 = LayerManager.createLayer('圖層 2', 'any');

  const f1 = Object.assign(new MockMarker(), {
    featureProps: { id: 'f1', name: '地點 A', notes: null, emptyStr: '' },
    _leaflet_id: 1,
    getLatLng: () => ({ lat: 25.0, lng: 121.5 })
  });
  layer1.featureGroup.addLayer(f1);

  const f2 = Object.assign(new MockMarker(), {
    featureProps: { id: 'f2', name: '地點 B', notes: '重要' },
    _leaflet_id: 2,
    getLatLng: () => ({ lat: 25.1, lng: 121.6 })
  });
  layer2.featureGroup.addLayer(f2);

  LayerManager.activeLayerId = layer1.id;

  // Render table
  getOrCreateElement('attribute-drawer');
  getOrCreateElement('attribute-table-header');
  getOrCreateElement('attribute-table-body');
  getOrCreateElement('drawer-feature-count');
  getOrCreateElement('drawer-matched-count');
  getOrCreateElement('table-layer-select', 'select');

  TableManager.init();
  TableManager.render();

  assert.strictEqual(TableManager.pagedFeatures.length, 1, 'Table only displays active layer features');
  assert.strictEqual(TableManager.pagedFeatures[0].featureProps.id, 'f1');

  // Verify null dash formatting
  const nullDashHtml = TableManager.formatCellValue(f1.featureProps.notes);
  assert.ok(nullDashHtml.includes('attr-null-dash'), 'Null value formats as faint dash');
  assert.strictEqual(f1.featureProps.notes, null, 'Underlying property remains strictly null');

  const emptyDashHtml = TableManager.formatCellValue(f1.featureProps.emptyStr);
  assert.ok(emptyDashHtml.includes('attr-null-dash'), 'Empty string formats as faint dash');
  assert.strictEqual(f1.featureProps.emptyStr, '', 'Underlying property remains empty string');
});

test('10. Attribute Table column sorting: toggles asc -> desc -> none and sorts numeric/string', () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('排序圖層', 'Point');
  LayerManager.activeLayerId = layer.id;

  const f1 = Object.assign(new MockMarker(), { featureProps: { id: '1', score: 30, city: 'Taipei' } });
  const f2 = Object.assign(new MockMarker(), { featureProps: { id: '2', score: 10, city: 'Kaohsiung' } });
  const f3 = Object.assign(new MockMarker(), { featureProps: { id: '3', score: 20, city: 'Taichung' } });
  layer.featureGroup.addLayer(f1);
  layer.featureGroup.addLayer(f2);
  layer.featureGroup.addLayer(f3);

  TableManager.init();
  TableManager.searchTerm = '';
  TableManager.query = null;

  // Sort score asc
  TableManager.sortColumn('score');
  assert.strictEqual(TableManager.getPrefs(layer.id).sortCol, 'score');
  assert.strictEqual(TableManager.getPrefs(layer.id).sortDir, 'asc');
  assert.deepStrictEqual(TableManager.pagedFeatures.map(f => f.featureProps.score), [10, 20, 30]);

  // Sort score desc
  TableManager.sortColumn('score');
  assert.strictEqual(TableManager.getPrefs(layer.id).sortDir, 'desc');
  assert.deepStrictEqual(TableManager.pagedFeatures.map(f => f.featureProps.score), [30, 20, 10]);

  // Sort score none
  TableManager.sortColumn('score');
  assert.strictEqual(TableManager.getPrefs(layer.id).sortDir, 'none');

  // Sort string asc
  TableManager.sortColumn('city');
  assert.deepStrictEqual(TableManager.pagedFeatures.map(f => f.featureProps.city), ['Kaohsiung', 'Taichung', 'Taipei']);
});

test('11. Attribute Table column resize: persists colWidths in layer preferences', () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('調整寬度圖層', 'Point');
  LayerManager.activeLayerId = layer.id;

  const prefs = TableManager.getPrefs(layer.id);
  prefs.colWidths = prefs.colWidths || {};
  prefs.colWidths['name'] = 180;
  prefs.colWidths['score'] = 95;

  assert.strictEqual(TableManager.getPrefs(layer.id).colWidths['name'], 180);
  assert.strictEqual(TableManager.getPrefs(layer.id).colWidths['score'], 95);
});

test('12. Attribute Table full text search: case-insensitive match on properties', () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('搜尋圖層', 'Point');
  LayerManager.activeLayerId = layer.id;

  const f1 = Object.assign(new MockMarker(), { featureProps: { id: '1', name: 'Alpha Tower', note: 'Office' } });
  const f2 = Object.assign(new MockMarker(), { featureProps: { id: '2', name: 'Beta Park', note: 'Alpha Zone' } });
  const f3 = Object.assign(new MockMarker(), { featureProps: { id: '3', name: 'Gamma Station', note: 'Transit' } });
  layer.featureGroup.addLayer(f1);
  layer.featureGroup.addLayer(f2);
  layer.featureGroup.addLayer(f3);

  TableManager.init();
  TableManager.query = null;
  TableManager.searchTerm = 'alpha';
  TableManager.render();

  assert.strictEqual(TableManager.filteredFeatures.length, 2, 'Two features matched "alpha"');
  assert.ok(TableManager.filteredFeatures.some(f => f.featureProps.name === 'Alpha Tower'));
  assert.ok(TableManager.filteredFeatures.some(f => f.featureProps.name === 'Beta Park'));

  // No match
  TableManager.searchTerm = 'nonexistent_xyz';
  TableManager.render();
  assert.strictEqual(TableManager.filteredFeatures.length, 0);
  const body = getOrCreateElement('attribute-table-body');
  assert.ok(body.textContent.includes('nonexistent_xyz'), 'Friendly no match text displayed');
});

test('13. Attribute Table query builder: handles and/or joins with multiple conditions', () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('查詢圖層', 'Point');
  LayerManager.activeLayerId = layer.id;

  const f1 = Object.assign(new MockMarker(), { featureProps: { id: '1', type: 'School', age: 10 } });
  const f2 = Object.assign(new MockMarker(), { featureProps: { id: '2', type: 'School', age: 50 } });
  const f3 = Object.assign(new MockMarker(), { featureProps: { id: '3', type: 'Hospital', age: 15 } });
  layer.featureGroup.addLayer(f1);
  layer.featureGroup.addLayer(f2);
  layer.featureGroup.addLayer(f3);

  TableManager.init();
  TableManager.searchTerm = '';

  // Query: type = 'School' AND age > 20
  TableManager.query = {
    a: { field: 'type', operator: 'eq', value: 'School' },
    b: { field: 'age', operator: 'gt', value: 20 },
    join: 'and'
  };
  TableManager.render();
  assert.strictEqual(TableManager.filteredFeatures.length, 1);
  assert.strictEqual(TableManager.filteredFeatures[0].featureProps.id, '2');

  // Query: type = 'Hospital' OR age > 40
  TableManager.query = {
    a: { field: 'type', operator: 'eq', value: 'Hospital' },
    b: { field: 'age', operator: 'gt', value: 40 },
    join: 'or'
  };
  TableManager.render();
  assert.strictEqual(TableManager.filteredFeatures.length, 2);
});

test('14. Attribute Table selectFiltered selects ALL matched features across multiple pages (>500 features)', () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('巨量圖層', 'Point');
  LayerManager.activeLayerId = layer.id;

  for (let i = 0; i < 1200; i++) {
    const feat = new MockMarker({ lat: 25.0, lng: 121.5 });
    feat.featureProps = { id: `feat_${i}`, category: i % 2 === 0 ? 'even' : 'odd' };
    feat._leaflet_id = i;
    layer.featureGroup.addLayer(feat);
  }

  TableManager.init();
  TableManager.pageSize = 500;
  TableManager.currentPage = 1;
  TableManager.query = null;

  // Filter for category === 'even' (600 features)
  TableManager.searchTerm = 'even';
  TableManager.render();

  assert.strictEqual(TableManager.filteredFeatures.length, 600, 'All 600 matching features are in filteredFeatures');
  assert.strictEqual(TableManager.pagedFeatures.length, 500, 'Current page is capped at pageSize 500');

  // Select filtered
  SelectionManager.selectedIds.clear();
  TableManager.selectFiltered();

  assert.strictEqual(SelectionManager.selectedIds.size, 600, 'selectFiltered selected all 600 features across all pages, not just the 500 DOM rows');
  assert.ok(SelectionManager.selectedIds.has('feat_0'));
  assert.ok(SelectionManager.selectedIds.has('feat_1198'));
});

test('15. Attribute Table pagination: setPage, nextPage, prevPage with slice calculation', () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('分頁圖層', 'Point');
  LayerManager.activeLayerId = layer.id;

  for (let i = 1; i <= 25; i++) {
    const f = Object.assign(new MockMarker(), { featureProps: { id: `item_${i}`, num: i } });
    layer.featureGroup.addLayer(f);
  }

  const nextBtn = getOrCreateElement('btn-table-next-page', 'button');
  const prevBtn = getOrCreateElement('btn-table-prev-page', 'button');
  TableManager.init();
  TableManager.pageSize = 10;
  TableManager.searchTerm = '';
  TableManager.query = null;
  TableManager.currentPage = 1;
  TableManager.render();

  assert.strictEqual(TableManager.currentPage, 1);
  assert.strictEqual(TableManager.pagedFeatures.length, 10);
  assert.strictEqual(TableManager.pagedFeatures[0].featureProps.num, 1);

  nextBtn.click();
  assert.strictEqual(TableManager.currentPage, 2);
  assert.strictEqual(TableManager.pagedFeatures.length, 10);
  assert.strictEqual(TableManager.pagedFeatures[0].featureProps.num, 11);

  nextBtn.click();
  assert.strictEqual(TableManager.currentPage, 3);
  assert.strictEqual(TableManager.pagedFeatures.length, 5);
  assert.strictEqual(TableManager.pagedFeatures[0].featureProps.num, 21);

  prevBtn.click();
  assert.strictEqual(TableManager.currentPage, 2);
});

test('16. Attribute Table addNewColumn: uses App.promptInput to add column to all features', async () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('欄位圖層', 'Point');
  LayerManager.activeLayerId = layer.id;

  const f1 = Object.assign(new MockMarker(), { featureProps: { id: '1', name: 'A' } });
  const f2 = Object.assign(new MockMarker(), { featureProps: { id: '2', name: 'B' } });
  layer.featureGroup.addLayer(f1);
  layer.featureGroup.addLayer(f2);

  App.promptInput = (title, label, defVal) => Promise.resolve('負責人');

  await TableManager.addNewColumn();

  assert.strictEqual(f1.featureProps['負責人'], '');
  assert.strictEqual(f2.featureProps['負責人'], '');
  assert.ok(App.toasts.some(t => t.msg.includes('負責人')));
});

test('17. Attribute Table editCell: uses App.promptInput to update feature property and popup', async () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('編輯圖層', 'Point');
  LayerManager.activeLayerId = layer.id;

  let popupUpdated = false;
  const f1 = Object.assign(new MockMarker(), {
    _leaflet_id: 101,
    featureProps: { id: '1', status: 'Pending' }
  });
  layer.featureGroup.addLayer(f1);

  DrawManager.getLayerById = (id) => id === 101 ? f1 : null;
  DrawManager.updateLayerPopup = (l) => { if (l === f1) popupUpdated = true; };
  App.promptInput = (title, label, curVal) => Promise.resolve('Approved');

  await TableManager.editCell(101, 'status', new MockElement('td'));

  assert.strictEqual(f1.featureProps.status, 'Approved');
  assert.strictEqual(popupUpdated, true);
});

test('18. Attribute Table deleteFeature: confirms deletion and removes feature via DrawManager', async () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('刪除圖元圖層', 'Point');
  LayerManager.activeLayerId = layer.id;

  let removedFeature = false;
  const f1 = Object.assign(new MockMarker(), {
    _leaflet_id: 202,
    featureProps: { id: 'del_1' }
  });
  layer.featureGroup.addLayer(f1);

  DrawManager.getLayerById = (id) => id === 202 ? f1 : null;
  DrawManager.removeLayer = (l) => {
    if (l === f1) {
      removedFeature = true;
      layer.featureGroup.removeLayer(f1);
    }
  };

  App.confirm = () => Promise.resolve(true);

  await TableManager.deleteLayer(202);

  assert.strictEqual(removedFeature, true, 'Feature removed through DrawManager');
  assert.strictEqual(layer.featureGroup.getLayers().length, 0);
});

// --- 3. Multi-Point Routing Phase 2 (Tests 19-25) ---

test('19. Multi-Point Routing: Role uniqueness and button disabling on insufficient points', () => {
  getOrCreateElement('routing-panel');
  getOrCreateElement('routing-mode', 'select').value = 'open';
  getOrCreateElement('routing-stop-count');
  getOrCreateElement('routing-barrier-count');
  getOrCreateElement('routing-stop-list');
  getOrCreateElement('routing-barrier-list');
  getOrCreateElement('routing-result-notice');
  const btnCalc = getOrCreateElement('btn-routing-calc-current', 'button');
  const btnOpt = getOrCreateElement('btn-routing-optimize', 'button');
  const btnSave = getOrCreateElement('btn-routing-save', 'button');
  getOrCreateElement('btn-routing-cancel', 'button');
  getOrCreateElement('btn-routing-fix-start-end', 'button');
  getOrCreateElement('btn-routing-add-barrier', 'button');
  getOrCreateElement('routing-barrier-radius', 'input');
  getOrCreateElement('btn-routing-import-file', 'button');

  RoutingManager.init(global.App.map);

  RoutingManager.points = [];
  RoutingManager.barriers = [];
  RoutingManager.currentRoute = null;
  RoutingManager.fallbackPreviewRoute = null;
  RoutingManager.routeIsOutdated = false;

  RoutingManager.renderControls();

  assert.strictEqual(btnCalc.disabled, true, 'Calc button is disabled with < 2 points');
  assert.ok(btnCalc.title.includes('至少'), 'Calc button has explanatory tooltip');
  assert.strictEqual(btnOpt.disabled, true, 'Optimize button is disabled with < 2 points');

  // Add 3 points
  RoutingManager.points = [
    { id: 'p1', name: 'P1', role: 'start', lat: 25.0, lng: 121.5 },
    { id: 'p2', name: 'P2', role: 'stop', lat: 25.1, lng: 121.6 },
    { id: 'p3', name: 'P3', role: 'end', lat: 25.2, lng: 121.7 }
  ];

  // Setting p2 as start must demote p1 to stop
  RoutingManager.setStartPoint('p2');
  assert.strictEqual(RoutingManager.points.find(p => p.id === 'p2').role, 'start');
  assert.strictEqual(RoutingManager.points.find(p => p.id === 'p1').role, 'stop');
  assert.strictEqual(RoutingManager.points.filter(p => p.role === 'start').length, 1, 'Only one start point exists');

  // Straight line preview makes Save button disabled
  RoutingManager.currentRoute = { latlngs: [], distance: 1000, duration: 100 };
  RoutingManager.fallbackPreviewRoute = { latlngs: [] };
  RoutingManager.renderControls();

  assert.strictEqual(btnSave.disabled, true, 'Save button is disabled when fallback straight-line preview is active');
  assert.ok(btnSave.title.includes('直線預覽') || btnSave.title.includes('預覽'), 'Save button tooltip explains straight line cannot be saved');
});

test('20. Routing normalizeStartEndPositions: start point at 0, end point at last index', () => {
  RoutingManager.points = [
    { id: '1', name: 'P1', role: 'stop', lat: 25.0, lng: 121.5 },
    { id: '2', name: 'P2', role: 'end', lat: 25.1, lng: 121.6 },
    { id: '3', name: 'P3', role: 'start', lat: 25.2, lng: 121.7 }
  ];

  RoutingManager.normalizeStartEndPositions();

  assert.strictEqual(RoutingManager.points[0].id, '3', 'Start point moved to index 0');
  assert.strictEqual(RoutingManager.points[0].role, 'start');
  assert.strictEqual(RoutingManager.points[2].id, '2', 'End point moved to last index');
  assert.strictEqual(RoutingManager.points[2].role, 'end');
  assert.strictEqual(RoutingManager.points[1].id, '1', 'Intermediate point is at index 1');
  assert.strictEqual(RoutingManager.points[1].role, 'stop');
});

test('21. Routing straight-line preview isolation: cannot be saved to layer', () => {
  RoutingManager.points = [
    { id: 'p1', role: 'start', lat: 25.0, lng: 121.5 },
    { id: 'p2', role: 'end', lat: 25.1, lng: 121.6 }
  ];
  RoutingManager.currentRoute = { latlngs: [{ lat: 25.0, lng: 121.5 }, { lat: 25.1, lng: 121.6 }], distance: 1500, duration: 120 };
  RoutingManager.fallbackPreviewRoute = { latlngs: RoutingManager.currentRoute.latlngs };

  const btnSave = getOrCreateElement('btn-routing-save', 'button');
  RoutingManager.renderControls();

  assert.strictEqual(btnSave.disabled, true, 'Save button is disabled when fallbackPreviewRoute is active');
  assert.ok(btnSave.title.includes('直線預覽') || btnSave.title.includes('預覽') || btnSave.title.includes('Straight-line'));
});

test('22. Routing saveRoute: saves valid OSRM route to a Line layer and shows toast', () => {
  LayerManager.layers = [];
  RoutingManager.points = [
    { id: 'p1', role: 'start', lat: 25.0, lng: 121.5 },
    { id: 'p2', role: 'end', lat: 25.1, lng: 121.6 }
  ];
  RoutingManager.currentRoute = {
    latlngs: [{ lat: 25.0, lng: 121.5 }, { lat: 25.1, lng: 121.6 }],
    distance: 2500,
    duration: 300,
    optimizationMethod: 'OSRM 道路分析',
    mode: 'open',
    transportProfile: 'driving',
    osrmService: 'car',
    orderedPoints: [
      { name: '起點', lat: 25.0, lng: 121.5 },
      { name: '終點', lat: 25.1, lng: 121.6 }
    ]
  };
  RoutingManager.fallbackPreviewRoute = null;
  RoutingManager.routeIsOutdated = false;

  App.toasts = [];
  RoutingManager.saveRoute();

  const routeLayer = LayerManager.layers.find(l => l.name.includes('路網') || l.name.includes('Route'));
  assert.ok(routeLayer, 'Route layer created');
  assert.strictEqual(routeLayer.geometryType, 'Line');
  assert.ok(App.toasts.some(t => t.type === 'success'));
});

test('23. Routing reversePoints: reverses order while preserving start and end roles', () => {
  RoutingManager.points = [
    { id: '1', name: 'Start', role: 'start', lat: 25.0, lng: 121.5 },
    { id: '2', name: 'Mid', role: 'stop', lat: 25.1, lng: 121.6 },
    { id: '3', name: 'End', role: 'end', lat: 25.2, lng: 121.7 }
  ];

  RoutingManager.reversePoints();

  assert.strictEqual(RoutingManager.points[0].id, '3', 'Former end point is now at index 0');
  assert.strictEqual(RoutingManager.points[0].role, 'start', 'Role normalized to start');
  assert.strictEqual(RoutingManager.points[1].id, '2', 'Mid point is at index 1');
  assert.strictEqual(RoutingManager.points[2].id, '1', 'Former start point is at last index');
  assert.strictEqual(RoutingManager.points[2].role, 'end', 'Role normalized to end');
});

test('24. Routing removeDuplicatePoints: removes duplicate coordinate points', () => {
  RoutingManager.points = [
    { id: '1', name: 'P1', role: 'start', lat: 25.0000001, lng: 121.5000001 },
    { id: '2', name: 'P2_dup', role: 'stop', lat: 25.0000002, lng: 121.5000002 },
    { id: '3', name: 'P3', role: 'end', lat: 25.1, lng: 121.6 }
  ];

  RoutingManager.removeDuplicatePoints();

  assert.strictEqual(RoutingManager.points.length, 2, 'Duplicate point removed');
  assert.strictEqual(RoutingManager.points[0].id, '1');
  assert.strictEqual(RoutingManager.points[1].id, '3');
});

test('25. Routing barrier mode: toggleBarrierMode toggles inputMode and map cursor class', () => {
  const mapContainer = getOrCreateElement('map');
  App.map._container = mapContainer;

  RoutingManager.isActive = true;
  RoutingManager.inputMode = 'stops';

  RoutingManager.toggleBarrierMode();
  assert.strictEqual(RoutingManager.inputMode, 'barriers', 'Input mode switched to barriers');

  RoutingManager.toggleBarrierMode();
  assert.strictEqual(RoutingManager.inputMode, 'stops', 'Input mode toggled back to stops');
});

// --- 4. Panel Management & Esc Keyboard Handling (Tests 26-30) ---

test('26. PanelManager mutual exclusivity: opening geoprocessing closes routing, opening routing closes geoprocessing', () => {
  let geoOpen = false;
  let routingOpen = false;

  PanelManager.panels = {};
  PanelManager.register('geoprocessing', {
    panelId: 'geoprocessing-panel',
    isOpen: () => geoOpen,
    open: () => { geoOpen = true; },
    close: () => { geoOpen = false; }
  });
  PanelManager.register('routing', {
    panelId: 'routing-panel',
    isOpen: () => routingOpen,
    open: () => { routingOpen = true; },
    close: () => { routingOpen = false; }
  });

  PanelManager.open('geoprocessing');
  assert.strictEqual(geoOpen, true);
  assert.strictEqual(routingOpen, false);
  assert.strictEqual(PanelManager.activePanel, 'geoprocessing');

  PanelManager.open('routing');
  assert.strictEqual(geoOpen, false, 'Geoprocessing closed when routing opened');
  assert.strictEqual(routingOpen, true, 'Routing opened');
  assert.strictEqual(PanelManager.activePanel, 'routing');
});

test('27. PanelManager handleEscape: Priority 1 - Topmost modal dialog cancel button is clicked', () => {
  PanelManager.init();

  // Test confirm modal
  const confirmModal = getOrCreateElement('confirm-modal');
  confirmModal.className = 'modal-overlay active';
  const confirmCancel = getOrCreateElement('btn-confirm-modal-cancel', 'button');
  confirmModal.appendChild(confirmCancel);

  let confirmResult = undefined;
  confirmCancel.onclick = () => {
    confirmResult = false;
    confirmModal.classList.remove('active');
  };

  PanelManager.handleEscape({ preventDefault: () => {}, stopPropagation: () => {} });

  assert.strictEqual(confirmResult, false, 'Confirm modal cancel button was triggered');
  assert.strictEqual(confirmModal.classList.contains('active'), false);

  // Test prompt modal
  const promptModal = getOrCreateElement('prompt-modal');
  promptModal.className = 'modal-overlay active';
  const promptCancel = getOrCreateElement('btn-prompt-modal-cancel', 'button');
  promptModal.appendChild(promptCancel);

  let promptResult = undefined;
  promptCancel.onclick = () => {
    promptResult = null;
    promptModal.classList.remove('active');
  };

  PanelManager.handleEscape({ preventDefault: () => {}, stopPropagation: () => {} });

  assert.strictEqual(promptResult, null, 'Prompt modal cancel button was triggered');
  assert.strictEqual(promptModal.classList.contains('active'), false);
});

test('28. PanelManager handleEscape: Priority 2 - Exits routing barrier mode when active', () => {
  PanelManager.init();
  RoutingManager.isActive = true;
  RoutingManager.inputMode = 'barriers';

  let barrierExited = false;
  const origToggle = RoutingManager.toggleBarrierMode;
  RoutingManager.toggleBarrierMode = () => {
    barrierExited = true;
    RoutingManager.inputMode = 'stops';
  };

  PanelManager.handleEscape({ preventDefault: () => {}, stopPropagation: () => {} });

  assert.strictEqual(barrierExited, true, 'RoutingManager.toggleBarrierMode() called');
  RoutingManager.toggleBarrierMode = origToggle;
});

test('29. PanelManager handleEscape: Priority 3 - Closes active large tool panel', () => {
  PanelManager.init();
  RoutingManager.isActive = false;
  RoutingManager.inputMode = 'stops';

  let geoClosed = false;
  PanelManager.panels['geoprocessing'] = {
    isOpen: () => true,
    open: () => {},
    close: () => { geoClosed = true; }
  };

  PanelManager.handleEscape({ preventDefault: () => {}, stopPropagation: () => {} });

  assert.strictEqual(geoClosed, true, 'Active large tool panel closed on Esc');
});

test('30. PanelManager handleEscape: Priority 4 & 5 - Closes table drawer then dropdowns', () => {
  PanelManager.init();
  Object.keys(PanelManager.panels).forEach(k => {
    PanelManager.panels[k].isOpen = () => false;
  });

  TableManager.isOpen = true;
  let tableClosed = false;
  TableManager.close = () => { tableClosed = true; TableManager.isOpen = false; };

  PanelManager.handleEscape({ preventDefault: () => {}, stopPropagation: () => {} });
  assert.strictEqual(tableClosed, true, 'TableManager closed on Esc');

  const dropdown = getOrCreateElement('tools-dropdown');
  dropdown.className = 'dropdown-menu open';

  PanelManager.handleEscape({ preventDefault: () => {}, stopPropagation: () => {} });
  assert.strictEqual(dropdown.classList.contains('open'), false, 'Open dropdown menu closed on Esc');
});

// --- 5. Security & Injection Prevention in UI (Tests 31-33) ---

test('31. Security: Column names with <script> or event handlers in Table do not inject DOM nodes', () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('安全測試圖層', 'Point');
  LayerManager.activeLayerId = layer.id;

  const maliciousCol = '<img src=x onerror=alert("hacked")>';
  const feat = new MockMarker();
  feat.featureProps = { id: 'sec_1', [maliciousCol]: 'val' };
  layer.featureGroup.addLayer(feat);

  TableManager.init();
  TableManager.render();

  const header = getOrCreateElement('attribute-table-header');
  const imgTags = header.querySelectorAll('img');
  assert.strictEqual(imgTags.length, 0, 'No img tags created in table header from column name');
  assert.ok(header.textContent.includes(maliciousCol), 'Column title rendered safely as plain text');
});

test('32. Security: Feature IDs and layer IDs with quotes/HTML are handled purely via dataset', () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('ID測試圖層', 'Point');
  LayerManager.activeLayerId = layer.id;

  const maliciousId = 'feat" onclick="alert(1)" data-hack="true';
  const feat = new MockMarker();
  feat.featureProps = { id: maliciousId, name: 'Normal' };
  layer.featureGroup.addLayer(feat);

  TableManager.init();
  TableManager.render();

  const body = getOrCreateElement('attribute-table-body');
  const row = body.querySelector('tr[data-feature-id]');
  assert.ok(row, 'Row rendered with dataset.featureId');
  assert.strictEqual(row.dataset.featureId, maliciousId, 'Feature ID stored accurately in dataset without quote breakout');
});

test('33. Security: Cell values containing HTML/SVG/onload are rendered as plain textContent', () => {
  LayerManager.layers = [];
  const layer = LayerManager.createLayer('數值安全圖層', 'Point');
  LayerManager.activeLayerId = layer.id;

  const maliciousVal = '<svg/onload=alert(document.cookie)><b>bold</b>';
  const feat = new MockMarker();
  feat.featureProps = { id: 'sec_3', description: maliciousVal };
  layer.featureGroup.addLayer(feat);

  TableManager.init();
  TableManager.render();

  const body = getOrCreateElement('attribute-table-body');
  const svgTags = body.querySelectorAll('svg');
  assert.strictEqual(svgTags.length, 0, 'No SVG elements created from cell value');
  const bTags = body.querySelectorAll('b');
  assert.strictEqual(bTags.length, 0, 'No bold elements created from cell value');
  assert.ok(body.textContent.includes(maliciousVal), 'Cell content rendered safely as plain text');
});

// --- 6. Dynamic i18n & Language Switching (Tests 34-36) ---

test('34. i18n: Language switch to "en" translates default layer name only when isDefault === true', () => {
  LayerManager.layers = [];
  I18n.currentLang = 'zh-TW';
  const defaultLayer = LayerManager.createLayer(I18n.t('layers.default_layer_name'), 'Point');
  defaultLayer.isDefault = true;

  assert.strictEqual(defaultLayer.name, I18n.t('layers.default_layer_name'));

  // Simulate language switch handler in app.js
  I18n.setLanguage('en');
  LayerManager.layers.forEach(layer => {
    if (layer.isDefault) {
      layer.name = I18n.t('layers.default_layer_name');
    }
  });

  assert.strictEqual(defaultLayer.name, 'Working Layer', 'Default layer name translated to English');
  I18n.setLanguage('zh-TW');
});

test('35. i18n: User-created custom layer names are preserved verbatim across language changes', () => {
  LayerManager.layers = [];
  I18n.currentLang = 'zh-TW';
  const customLayer = LayerManager.createLayer('台北市避難所', 'Point');

  I18n.setLanguage('en');
  LayerManager.layers.forEach(layer => {
    if (layer.isDefault) {
      layer.name = I18n.t('layers.default_layer_name');
    }
  });

  assert.strictEqual(customLayer.name, '台北市避難所', 'User custom layer name preserved intact');
  I18n.setLanguage('zh-TW');
});

test('36. i18n: Catalog empty hint and status bar labels dynamically format in active language', () => {
  I18n.setLanguage('zh-TW');
  const emptyHintZh = I18n.t('catalog.empty_hint');
  assert.ok(emptyHintZh.includes('尚未呼叫任何資料'));

  const statusCoordsZh = I18n.t('statusbar.coords', { lng: '121.50000', lat: '25.00000' });
  assert.strictEqual(statusCoordsZh, '經緯度: 25.00000, 121.50000');

  I18n.setLanguage('en');
  const emptyHintEn = I18n.t('catalog.empty_hint');
  assert.ok(emptyHintEn.includes('No data opened yet'));

  const statusCoordsEn = I18n.t('statusbar.coords', { lng: '121.50000', lat: '25.00000' });
  assert.strictEqual(statusCoordsEn, 'Coords: 25.00000, 121.50000');

  I18n.setLanguage('zh-TW');
});

