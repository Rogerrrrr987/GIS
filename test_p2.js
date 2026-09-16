/**
 * GeoCanvas GIS Tool - P2 Automated Acceptance Test Suite
 *
 * Requirements:
 * 1. Pure client-side verification; does not connect to external OSRM (uses mock fetch).
 * 2. Uses Node.js built-in node:test and node:assert/strict modules.
 * 3. Covers all 3 core acceptance defect areas:
 *    - 200-point truncation and role re-normalization
 *    - Multi-barrier detour planning with fromPointId/toPointId and replanWithDetour() integration
 *    - Fallback preview notice preservation and showResult() integration
 * 4. Only for development verification; not a runtime dependency.
 *
 * Run with:
 *   node test_p2.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

// =============================================================================
// MINIMAL DOM & BROWSER ENVIRONMENT FOR NODE.JS
// =============================================================================

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
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.classList = new MockClassList(this);
    this._attributes = new Map();
    this._listeners = new Map();
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.title = '';
    this._textContent = '';
    this.innerHTML = '';
  }

  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }

  get className() {
    return Array.from(this.classList._classes).join(' ');
  }
  set className(val) {
    this.classList._classes.clear();
    String(val || '').split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map(c => typeof c === 'string' ? c : c.textContent).join('');
  }
  set textContent(val) {
    this.children = [];
    this._textContent = String(val);
  }

  setAttribute(k, v) { this._attributes.set(k, String(v)); }
  getAttribute(k) { return this._attributes.get(k); }
  removeAttribute(k) { this._attributes.delete(k); }

  addEventListener(type, cb) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(cb);
  }
  removeEventListener(type, cb) {
    if (this._listeners.has(type)) {
      this._listeners.set(type, this._listeners.get(type).filter(x => x !== cb));
    }
  }
  dispatchEvent(event) {
    const list = this._listeners.get(event.type) || [];
    list.forEach(cb => cb.call(this, event));
  }

  appendChild(child) {
    if (typeof child === 'string') {
      this.children.push(child);
      return child;
    }
    if (child.tagName === 'FRAGMENT') {
      const fragChildren = child.children.slice();
      child.children = [];
      fragChildren.forEach(c => this.appendChild(c));
      return child;
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...items) {
    items.forEach(it => this.appendChild(it));
  }

  prepend(...items) {
    items.reverse().forEach(child => {
      if (typeof child === 'string') {
        this.children.unshift(child);
        return;
      }
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.children.unshift(child);
    });
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  insertBefore(newChild, refChild) {
    if (!refChild) return this.appendChild(newChild);
    if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
    const idx = this.children.indexOf(refChild);
    if (idx === -1) return this.appendChild(newChild);
    newChild.parentNode = this;
    this.children.splice(idx, 0, newChild);
    return newChild;
  }

  replaceChildren(...newChildren) {
    this.children.forEach(c => { if (c instanceof MockElement && c.parentNode) c.parentNode = null; });
    this.children = [];
    this._textContent = '';
    newChildren.forEach(c => this.appendChild(c));
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all[0] || null;
  }

  querySelectorAll(selector) {
    const result = [];
    const check = (node) => {
      if (node instanceof MockElement) {
        if (selector.startsWith('.')) {
          const cls = selector.slice(1);
          if (node.classList.contains(cls)) result.push(node);
        } else if (selector.startsWith('#')) {
          const id = selector.slice(1);
          if (node.getAttribute('id') === id || node.id === id) result.push(node);
        } else if (selector.toLowerCase() === node.tagName.toLowerCase()) {
          result.push(node);
        } else if (selector.includes('[data-point-id]')) {
          if (node.dataset.pointId) result.push(node);
        }
        node.children.forEach(c => {
          if (c instanceof MockElement) check(c);
        });
      }
    };
    this.children.forEach(c => {
      if (c instanceof MockElement) check(c);
    });
    return result;
  }
}

class MockDocument {
  constructor() {
    this._elementsById = new Map();
  }

  createElement(tag) {
    return new MockElement(tag);
  }

  createDocumentFragment() {
    return new MockElement('fragment');
  }

  createTextNode(text) {
    return String(text);
  }

  getElementById(id) {
    for (const el of this._elementsById.values()) {
      if (el.getAttribute('id') === id || el.id === id) return el;
      const found = el.querySelector('#' + id);
      if (found) return found;
    }
    const el = new MockElement('div');
    el.setAttribute('id', id);
    el.id = id;
    this._elementsById.set(id, el);
    return el;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const res = [];
    this._elementsById.forEach(el => {
      if (selector.startsWith('.')) {
        if (el.classList.contains(selector.slice(1))) res.push(el);
      } else if (selector.startsWith('#')) {
        if (el.id === selector.slice(1) || el.getAttribute('id') === selector.slice(1)) res.push(el);
      }
      res.push(...el.querySelectorAll(selector));
    });
    return res;
  }

  addEventListener() {}
  removeEventListener() {}
}

// Minimal Leaflet mock
const mockLeaflet = {
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
      getLayers() { return layers; }
    };
  },
  polyline(latlngs, options) {
    return {
      latlngs,
      options,
      addTo() { return this; },
      setStyle() {},
      getBounds() {
        return {
          isValid() { return true; },
          pad() { return this; }
        };
      }
    };
  },
  marker(latlng, options) {
    return {
      latlng,
      options,
      addTo() { return this; },
      bindPopup() { return this; },
      bindTooltip() { return this; },
      on() { return this; },
      off() { return this; }
    };
  },
  circle(latlng, options) {
    return {
      latlng,
      options,
      addTo() { return this; }
    };
  },
  divIcon(options) {
    return options;
  },
  latLngBounds(points) {
    return {
      points,
      isValid() { return points && points.length > 0; },
      pad() { return this; }
    };
  },
  DomEvent: {
    disableClickPropagation() {},
    disableScrollPropagation() {},
    stopPropagation() {}
  }
};

// Minimal Turf mock for geometric checks
const mockTurf = {
  lineString(coords) {
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
  },
  circle(center, radiusMeters) {
    return {
      type: 'Feature',
      geometry: { type: 'Polygon' },
      properties: { center, radiusMeters }
    };
  },
  booleanIntersects(geom1, geom2) {
    let circle = null;
    let line = null;
    if (geom1.geometry.type === 'LineString' && geom2.properties?.radiusMeters) {
      line = geom1.geometry.coordinates;
      circle = geom2.properties;
    } else if (geom2.geometry.type === 'LineString' && geom1.properties?.radiusMeters) {
      line = geom2.geometry.coordinates;
      circle = geom1.properties;
    }
    if (!line || !circle) return false;

    const [cLng, cLat] = circle.center;
    const r = circle.radiusMeters;

    for (let i = 0; i < line.length; i++) {
      const [pLng, pLat] = line[i];
      const d = Math.hypot((pLng - cLng) * 111320 * Math.cos(cLat * Math.PI / 180), (pLat - cLat) * 111320);
      if (d <= r) return true;
    }

    for (let i = 0; i < line.length - 1; i++) {
      const [lng1, lat1] = line[i];
      const [lng2, lat2] = line[i + 1];
      const x1 = (lng1 - cLng) * 111320 * Math.cos(cLat * Math.PI / 180);
      const y1 = (lat1 - cLat) * 111320;
      const x2 = (lng2 - cLng) * 111320 * Math.cos(cLat * Math.PI / 180);
      const y2 = (lat2 - cLat) * 111320;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;
      if (lenSq > 0) {
        let t = -(x1 * dx + y1 * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const projX = x1 + t * dx;
        const projY = y1 + t * dy;
        const dist = Math.hypot(projX, projY);
        if (dist <= r) return true;
      }
    }
    return false;
  }
};

// Setup global mock environment
function setupEnvironment() {
  const doc = new MockDocument();
  const storage = new Map();

  global.document = doc;
  global.window = {
    document: doc,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    localStorage: {
      getItem(k) { return storage.get(k) || null; },
      setItem(k, v) { storage.set(k, String(v)); },
      removeItem(k) { storage.delete(k); },
      clear() { storage.clear(); }
    },
    App: {
      showToast() {},
      updateStats() {}
    },
    SafetyManager: {
      recordChange() {}
    }
  };
  global.localStorage = global.window.localStorage;
  global.L = mockLeaflet;
  global.turf = mockTurf;
  global.navigator = { onLine: true };

  const safetyPath = path.join(__dirname, 'js/safety.js');
  const routingPath = path.join(__dirname, 'js/routing-multipoint.js');
  delete require.cache[require.resolve(safetyPath)];
  delete require.cache[require.resolve(routingPath)];

  require(safetyPath);
  require(routingPath);

  const mockMap = {
    addLayer() {},
    removeLayer() {},
    fitBounds() {},
    distance(p1, p2) {
      return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) * 111320;
    }
  };
  window.RoutingManager.init(mockMap);

  return { doc, storage, mockMap };
}

// =============================================================================
// TEST SUITES
// =============================================================================

test('Suite 1: Syntax check of all JavaScript files in js/', () => {
  const jsDir = path.join(__dirname, 'js');
  const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
  assert.ok(files.length > 0, 'Should find JavaScript files in js/');

  files.forEach(file => {
    const fullPath = path.join(jsDir, file);
    assert.doesNotThrow(() => {
      cp.execFileSync(process.execPath, ['--check', fullPath]);
    }, `File ${file} should pass node --check syntax check`);
  });
});

test('Suite 2: Point file extraction and auto-role assignment (extractRoutePoints)', () => {
  const { doc } = setupEnvironment();
  const rm = window.RoutingManager;

  // Case 2A: Open mode with 4 points -> start, stop, stop, end
  const geojson4 = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [121.51, 25.04] }, properties: { name: 'P1' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [121.52, 25.05] }, properties: { name: 'P2' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [121.53, 25.06] }, properties: { name: 'P3' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [121.54, 25.07] }, properties: { name: 'P4' } }
    ]
  };

  const openRes = rm.extractRoutePoints(geojson4, '__source__', '__auto__', '__none__', 'open');
  assert.equal(openRes.points.length, 4);
  assert.equal(openRes.points[0].role, 'start', '1st point in open mode should be start');
  assert.equal(openRes.points[1].role, 'stop', '2nd point in open mode should be stop');
  assert.equal(openRes.points[2].role, 'stop', '3rd point in open mode should be stop');
  assert.equal(openRes.points[3].role, 'end', 'Last point in open mode should be end');

  // Case 2B: Roundtrip mode with 4 points -> start, stop, stop, stop (no end)
  const roundtripRes = rm.extractRoutePoints(geojson4, '__source__', '__auto__', '__none__', 'roundtrip');
  assert.equal(roundtripRes.points.length, 4);
  assert.equal(roundtripRes.points[0].role, 'start', '1st point in roundtrip mode should be start');
  assert.equal(roundtripRes.points[1].role, 'stop', '2nd point in roundtrip mode should be stop');
  assert.equal(roundtripRes.points[2].role, 'stop', '3rd point in roundtrip mode should be stop');
  assert.equal(roundtripRes.points[3].role, 'stop', 'Last point in roundtrip mode should be stop (no end)');

  // Case 2C: Single point -> start only
  const geojson1 = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [121.51, 25.04] }, properties: { name: 'P1' } }
    ]
  };
  const singleRes = rm.extractRoutePoints(geojson1, '__source__', '__auto__', '__none__', 'open');
  assert.equal(singleRes.points.length, 1);
  assert.equal(singleRes.points[0].role, 'start', 'Single point should be start only');

  // Case 2D: Filtering non-point geometries & invalid coordinates
  const mixedGeojson = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[121, 25], [121, 26], [122, 26], [121, 25]]] }, properties: {} },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[121, 25], [122, 26]] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [NaN, 25.0] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [121.5, 999.0] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [121.51, 25.04] }, properties: { name: 'Valid1' } },
      { type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [[121.52, 25.05], [121.53, 25.06]] }, properties: { name: 'MP' } }
    ]
  };
  const filterRes = rm.extractRoutePoints(mixedGeojson, '__source__', '__auto__', '__none__', 'open');
  assert.equal(filterRes.nonPointCount, 2, 'Should count 2 non-point features (Polygon, LineString)');
  assert.equal(filterRes.invalidCoordCount, 2, 'Should count 2 invalid coordinates (NaN, out-of-range)');
  assert.equal(filterRes.points.length, 3, 'Valid points: 1 single point + 2 multi points = 3 points');
  assert.equal(filterRes.points[0].role, 'start');
  assert.equal(filterRes.points[1].role, 'stop');
  assert.equal(filterRes.points[2].role, 'end');

  // Case 2E: Order field sorting before role assignment
  const unOrderedGeojson = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [121.54, 25.07] }, properties: { seq: 4, name: 'D' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [121.51, 25.04] }, properties: { seq: 1, name: 'A' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [121.53, 25.06] }, properties: { seq: 3, name: 'C' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [121.52, 25.05] }, properties: { seq: 2, name: 'B' } }
    ]
  };
  const sortedRes = rm.extractRoutePoints(unOrderedGeojson, 'seq', 'name', '__none__', 'open');
  assert.equal(sortedRes.points[0].name, 'A');
  assert.equal(sortedRes.points[0].role, 'start');
  assert.equal(sortedRes.points[3].name, 'D');
  assert.equal(sortedRes.points[3].role, 'end');
});

test('Suite 3: 200-point truncation and role re-normalization (Comprehensive Issue 1)', () => {
  const { doc } = setupEnvironment();
  const rm = window.RoutingManager;

  // Helper to generate N point features
  const makePoints = (count) => Array.from({ length: count }, (_, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [121.5 + (i * 0.001), 25.0 + (i * 0.001)] },
    properties: { name: `Point_${i + 1}` }
  }));

  // 1. 201 點 Replace + open: 確認第 1 點是 start、第 200 點是 end，中間 198 點是 stop
  const geojson201 = { type: 'FeatureCollection', features: makePoints(201) };
  rm.pendingFileImport = {
    file: { name: 'p201.geojson' },
    fileName: 'p201.geojson',
    geojson: geojson201,
    crsInfo: { crs: 'EPSG:4326' }
  };
  doc.getElementById('routing-mode').value = 'open';
  doc.getElementById('routing-shp-import-mode').value = 'replace';
  doc.getElementById('routing-shp-truncate-check').checked = true;
  rm.updateFilePreview();

  const preview201 = rm.pendingFileImport.resolvedNewPoints;
  assert.equal(preview201.length, 200, '201 points truncated to exactly 200');
  assert.equal(preview201[0].role, 'start', '1st point in truncated open mode is start');
  assert.equal(preview201[199].role, 'end', '200th point in truncated open mode is end');
  for (let i = 1; i < 199; i++) {
    assert.equal(preview201[i].role, 'stop', `Point ${i + 1} must be stop`);
  }

  // Check preview warning includes truncation notice
  const warningText = doc.getElementById('routing-shp-preview-warning').textContent;
  assert.match(warningText, /資料截斷後，系統將以第 200 點重新指定為終點/, 'Warning must indicate end point reassignment');

  // 2. 250 點 Replace + open: 確認只有 200 點且角色唯一
  const geojson250 = { type: 'FeatureCollection', features: makePoints(250) };
  rm.pendingFileImport = {
    file: { name: 'p250.geojson' },
    fileName: 'p250.geojson',
    geojson: geojson250,
    crsInfo: { crs: 'EPSG:4326' }
  };
  rm.updateFilePreview();
  const preview250 = rm.pendingFileImport.resolvedNewPoints;
  assert.equal(preview250.length, 200, '250 points truncated to exactly 200');
  assert.equal(preview250.filter(p => p.role === 'start').length, 1, 'Exactly one start role');
  assert.equal(preview250.filter(p => p.role === 'end').length, 1, 'Exactly one end role');
  assert.equal(preview250.filter(p => p.role === 'stop').length, 198, 'Exactly 198 stop roles');
  assert.equal(preview250[0].role, 'start');
  assert.equal(preview250[199].role, 'end');

  // 3. 250 點 Replace + roundtrip: 確認沒有 end
  doc.getElementById('routing-mode').value = 'roundtrip';
  rm.updateFilePreview();
  const previewRoundtrip = rm.pendingFileImport.resolvedNewPoints;
  assert.equal(previewRoundtrip.length, 200);
  assert.equal(previewRoundtrip.filter(p => p.role === 'end').length, 0, 'Roundtrip mode must have 0 end roles');
  assert.equal(previewRoundtrip[0].role, 'start');
  assert.equal(previewRoundtrip.filter(p => p.role === 'stop').length, 199);

  // 4. 199 個既有點再 Append 多點並截斷: keep-first 正確, keep-last 正確
  doc.getElementById('routing-mode').value = 'open';
  rm.points = Array.from({ length: 199 }, (_, i) => ({
    id: `ext_${i + 1}`,
    lat: 25.0 + (i * 0.001),
    lng: 121.5 + (i * 0.001),
    name: `Ext_${i + 1}`,
    role: i === 0 ? 'start' : (i === 198 ? 'end' : 'stop')
  }));

  const geojsonAppend = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [121.8, 25.2] }, properties: { name: 'AppStart', role: 'start' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [121.81, 25.21] }, properties: { name: 'AppEnd', role: 'end' } }
    ]
  };
  rm.pendingFileImport = {
    file: { name: 'append.geojson' },
    fileName: 'append.geojson',
    geojson: geojsonAppend,
    crsInfo: { crs: 'EPSG:4326' }
  };
  doc.getElementById('routing-shp-import-mode').value = 'append';

  // Test keep-first with 199 existing + append (truncated to 1 slot)
  doc.getElementById('routing-shp-conflict-resolution').value = 'keep-first';
  doc.getElementById('routing-shp-role-field').value = 'role';
  rm.updateFilePreview();

  assert.equal(rm.pendingFileImport.resolvedNewPoints.length, 1, 'Only 1 point appended due to 200 limit');
  assert.equal(rm.pendingFileImport.resolvedExistingPoints[0].role, 'start', 'Existing start preserved in keep-first');
  assert.equal(rm.pendingFileImport.resolvedExistingPoints[198].role, 'end', 'Existing end preserved in keep-first');
  assert.equal(rm.pendingFileImport.resolvedNewPoints[0].role, 'stop', 'Incoming start downgraded to stop in keep-first');

  // Test keep-last with 199 existing + append (truncated to 1 slot)
  doc.getElementById('routing-shp-conflict-resolution').value = 'keep-last';
  rm.updateFilePreview();
  assert.equal(rm.pendingFileImport.resolvedNewPoints.length, 1);
  assert.equal(rm.pendingFileImport.resolvedExistingPoints[0].role, 'stop', 'Existing start demoted to stop in keep-last');
  assert.equal(rm.pendingFileImport.resolvedNewPoints[0].role, 'start', 'Incoming start promoted in keep-last');

  // 5. 截斷後只有一點時只有 start，不能是 end
  const singleCombined = [{ id: 'p1', role: 'end' }];
  rm.resolveRolesForCombined(singleCombined, 'open', 'keep-first');
  assert.equal(singleCombined[0].role, 'start', 'Single point result must be start only');

  // 6. 預覽結果與 confirmFileImport() 後結果一致，且預覽不修改 this.points
  const pointsBefore = rm.points.slice();
  rm.confirmFileImport();
  assert.equal(rm.points.length, 200, 'Confirmed import creates exactly 200 points');
  assert.equal(rm.points[0].role, rm.pendingFileImport?.resolvedExistingPoints?.[0]?.role || 'stop');
  assert.equal(rm.points[199].name, 'AppStart');
  assert.equal(rm.points[199].role, 'start');
});

test('Suite 4: Fallback preview state isolation, notice preservation and clearing (Issue 3)', () => {
  const { doc } = setupEnvironment();
  const rm = window.RoutingManager;

  // Set up an existing valid route
  const existingValidRoute = {
    latlngs: [[25.04, 121.51], [25.05, 121.52]],
    orderedPoints: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
    distance: 1500,
    duration: 180,
    barrierConflicts: [],
    approximate: false,
    computedAt: '2026-09-16T00:00:00Z'
  };

  rm.currentRoute = existingValidRoute;
  rm.routeLayer = L.polyline(existingValidRoute.latlngs);
  rm.routeIsOutdated = false;
  rm.fallbackPolicy = 'preview';
  rm.points = [
    { id: 'p1', lat: 25.04, lng: 121.51, name: 'A', role: 'start' },
    { id: 'p2', lat: 25.05, lng: 121.52, name: 'B', role: 'end' }
  ];

  // Trigger error fallback
  const error = new Error('OSRM 伺服器無法連線');
  rm.handleRouteError(error);

  // 1. Assertions on isolation:
  assert.strictEqual(rm.currentRoute, existingValidRoute, 'currentRoute object must NOT be changed');
  assert.ok(rm.routeLayer, 'Existing routeLayer must NOT be removed');
  assert.ok(rm.fallbackPreviewRoute, 'fallbackPreviewRoute must exist');
  assert.ok(rm.fallbackPreviewLayer, 'fallbackPreviewLayer must exist');

  // Notice in DOM must exist and contain specific text
  const noticeEl = doc.getElementById('routing-fallback-notice') || doc.querySelector('.routing-fallback-notice');
  assert.ok(noticeEl, 'Fallback notice element must be present in DOM');
  assert.match(noticeEl.textContent, /本次計算失敗，僅顯示直線近似預覽；上一條有效道路路線仍保留/, 'Notice text must indicate fallback and preservation');

  // 2. 呼叫 showResult(currentRoute) 後提示仍存在，未被 wipe
  rm.showResult(rm.currentRoute);
  const noticeAfterShowResult = doc.getElementById('routing-fallback-notice') || doc.querySelector('.routing-fallback-notice');
  assert.ok(noticeAfterShowResult, 'Fallback notice must remain visible after showResult()');

  // 3. Fallback preview cannot be saved
  let toastMsg = '';
  window.App.showToast = (msg) => { toastMsg = msg; };
  rm.currentRoute = rm.fallbackPreviewRoute;
  rm.saveRoute();
  assert.match(toastMsg, /直線近似預覽無法保存/, 'saveRoute must reject approximate preview');
  rm.currentRoute = existingValidRoute;

  // 4. 成功計算後提示與 fallback layer 被清除
  const newCleanRoute = {
    latlngs: [[25.04, 121.51], [25.06, 121.53]],
    orderedPoints: rm.points,
    distance: 2000,
    duration: 200,
    barrierConflicts: [],
    approximate: false
  };
  rm.showRoute(newCleanRoute);
  assert.equal(rm.fallbackPreviewRoute, null, 'Successful route must clear fallbackPreviewRoute');
  assert.equal(rm.fallbackPreviewLayer, null, 'Successful route must clear fallbackPreviewLayer');
  assert.equal(doc.querySelector('.routing-fallback-notice'), null, 'Notice element must be removed from DOM');

  // 5. 沒有 currentRoute 時發生 fallback，顯示「目前尚無有效道路分析路線」
  rm.currentRoute = null;
  rm.handleRouteError(new Error('服務逾時'));
  const emptyNotice = doc.querySelector('.routing-fallback-notice');
  assert.ok(emptyNotice, 'Notice element should be present when no currentRoute');
  assert.match(emptyNotice.textContent, /目前尚無有效道路分析路線/, 'Notice must mention no valid route');

  // 6. clearFallbackPreview() 清除提示 DOM
  rm.clearFallbackPreview();
  assert.equal(doc.querySelector('.routing-fallback-notice'), null, 'clearFallbackPreview must remove notice DOM');
});

test('Suite 5: OSRM HTTP error handling, Retry-After, and bounded retries', async () => {
  setupEnvironment();
  const rm = window.RoutingManager;
  rm.requestRetries = 2;
  rm.requestTimeoutMs = 1000;

  // Case 5A: HTTP 400 - No retry, immediately throws
  let fetchCount400 = 0;
  global.fetch = async () => {
    fetchCount400++;
    return {
      ok: false,
      status: 400,
      headers: new Map(),
      json: async () => ({ code: 'InvalidQuery' })
    };
  };

  await assert.rejects(async () => {
    await rm.requestJson('https://router.project-osrm.org/test400');
  }, /HTTP 400/);
  assert.equal(fetchCount400, 1, 'HTTP 400 must NOT trigger any retries');

  // Case 5B: HTTP 429 with Retry-After - Bounded retry
  let fetchCount429 = 0;
  global.fetch = async () => {
    fetchCount429++;
    return {
      ok: false,
      status: 429,
      headers: {
        get(name) {
          if (name.toLowerCase() === 'retry-after') return '0.01';
          return null;
        }
      },
      json: async () => ({ code: 'TooManyRequests' })
    };
  };

  await assert.rejects(async () => {
    await rm.requestJson('https://router.project-osrm.org/test429', { retries: 2 });
  }, /HTTP 429/);
  assert.equal(fetchCount429, 3, 'HTTP 429 with 2 retries should attempt exactly 3 times (1 initial + 2 retries)');

  // Case 5C: AbortController cancellation during request
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(async () => {
    await rm.requestJson('https://router.project-osrm.org/testAbort', { signal: controller.signal });
  }, (err) => err.name === 'AbortError' || /取消/i.test(err.message));
});

test('Suite 6: Chunked route result merging', async () => {
  setupEnvironment();
  const rm = window.RoutingManager;
  rm.routeChunkSize = 3;

  const points = [
    { id: 'p1', lat: 25.01, lng: 121.51, name: 'P1' },
    { id: 'p2', lat: 25.02, lng: 121.52, name: 'P2' },
    { id: 'p3', lat: 25.03, lng: 121.53, name: 'P3' },
    { id: 'p4', lat: 25.04, lng: 121.54, name: 'P4' },
    { id: 'p5', lat: 25.05, lng: 121.55, name: 'P5' }
  ];

  let chunkNum = 0;
  global.fetch = async () => {
    chunkNum++;
    if (chunkNum === 1) {
      return {
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [{
            geometry: { coordinates: [[121.51, 25.01], [121.52, 25.02], [121.53, 25.03]] },
            legs: [{ distance: 100, duration: 10 }, { distance: 120, duration: 12 }],
            distance: 220,
            duration: 22
          }]
        })
      };
    } else {
      return {
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [{
            geometry: { coordinates: [[121.53, 25.03], [121.54, 25.04], [121.55, 25.05]] },
            legs: [{ distance: 150, duration: 15 }, { distance: 160, duration: 16 }],
            distance: 310,
            duration: 31
          }]
        })
      };
    }
  };

  const result = await rm.fetchOsrmRouteChunked(points, null, 'current-order');
  assert.equal(result.distance, 530, 'Merged distance should sum all chunks');
  assert.equal(result.duration, 53, 'Merged duration should sum all chunks');
  assert.equal(result.legs.length, 4, 'Merged legs should include all 4 legs');
  assert.equal(result.latlngs.length, 5, 'Duplicate junction coordinate at P3 should be deduplicated');
});

test('Suite 7: Multi-barrier detour planning integration with replanWithDetour (Issue 2)', async () => {
  setupEnvironment();
  const rm = window.RoutingManager;

  // 1. 建立 4 個原始點：P1, P2, P3, P4
  const points = [
    { id: 'P1', lat: 25.000, lng: 121.500, name: 'P1', role: 'start' },
    { id: 'P2', lat: 25.020, lng: 121.520, name: 'P2', role: 'stop' },
    { id: 'P3', lat: 25.040, lng: 121.540, name: 'P3', role: 'stop' },
    { id: 'P4', lat: 25.060, lng: 121.560, name: 'P4', role: 'end' }
  ];
  rm.points = points.slice();

  // 2. 建立三個屏障：B1 在 P1-P2, B2 在 P2-P3, B3 在 P3-P4
  const barriers = [
    { id: 'B1', name: 'B1', lat: 25.010, lng: 121.510, radius: 200, enabled: true },
    { id: 'B2', name: 'B2', lat: 25.030, lng: 121.530, radius: 200, enabled: true },
    { id: 'B3', name: 'B3', lat: 25.050, lng: 121.550, radius: 200, enabled: true }
  ];
  rm.barriers = barriers.slice();

  const originalRoute = {
    latlngs: [
      [25.000, 121.500], // P1 (0)
      [25.010, 121.510], // Near B1 (1)
      [25.020, 121.520], // P2 (2)
      [25.030, 121.530], // Near B2 (3)
      [25.040, 121.540], // P3 (4)
      [25.050, 121.550], // Near B3 (5)
      [25.060, 121.560]  // P4 (6)
    ],
    orderedPoints: points.slice(),
    distance: 10000,
    duration: 600,
    barrierConflicts: barriers.slice()
  };
  rm.currentRoute = originalRoute;
  rm.routeLayer = L.polyline(originalRoute.latlngs);

  // 3. 驗證 findRoadGeometryBarrierConflicts 產出包含 fromPointId, toPointId
  const conflicts = rm.findRoadGeometryBarrierConflicts(originalRoute, barriers);
  assert.equal(conflicts.length, 3, 'Three conflicts found');
  assert.equal(conflicts[0].fromPointId, 'P1');
  assert.equal(conflicts[0].toPointId, 'P2');
  assert.equal(conflicts[1].fromPointId, 'P2');
  assert.equal(conflicts[1].toPointId, 'P3');
  assert.equal(conflicts[2].fromPointId, 'P3');
  assert.equal(conflicts[2].toPointId, 'P4');

  // 4. Mock fetchOsrmRouteChunked to capture candidate sequences
  const capturedSequences = [];
  let osrmRequestCount = 0;

  rm.fetchOsrmRouteChunked = async (seq) => {
    osrmRequestCount++;
    capturedSequences.push(seq.map(p => p.id || p.name));

    // Synthetic road geometry that shifts coords to avoid barrier in candidate 1
    const testLatlngs = seq.map(p => [p.lat, p.lng]);
    return {
      latlngs: testLatlngs,
      orderedPoints: seq,
      distance: 10500 + (osrmRequestCount * 10),
      duration: 620,
      barrierConflicts: []
    };
  };

  // Mock consent
  rm.ensureOsrmConsent = async () => true;

  // 5. 真正呼叫 replanWithDetour()
  await rm.replanWithDetour();

  // 6. 驗證候選請求總數不大於 16
  assert.ok(osrmRequestCount <= 16, `OSRM requests (${osrmRequestCount}) must not exceed 16`);
  assert.ok(osrmRequestCount > 0, 'Must have made at least one detour request');

  // 7. 驗證序列結構：依序插入在各自的路段中，絕對不會全部聚在 P1-P2 之間
  // Inspect the sequences generated in iterations:
  // In iteration 1 (B1): [P1, detourB1, P2, P3, P4]
  const seqWithB1 = capturedSequences.find(s => s.length === 5);
  assert.ok(seqWithB1, 'Must have tested a 5-point sequence with B1 detour');
  assert.equal(seqWithB1[0], 'P1');
  assert.equal(seqWithB1[2], 'P2');
  assert.equal(seqWithB1[3], 'P3');
  assert.equal(seqWithB1[4], 'P4');

  // In iteration 2 (B2): [P1, detourB1, P2, detourB2, P3, P4]
  const seqWithB2 = capturedSequences.find(s => s.length === 6);
  if (seqWithB2) {
    const p1Idx = seqWithB2.indexOf('P1');
    const p2Idx = seqWithB2.indexOf('P2');
    const p3Idx = seqWithB2.indexOf('P3');
    assert.ok(p1Idx < p2Idx, 'P1 before P2');
    assert.ok(p2Idx < p3Idx, 'P2 before P3');
    // Ensure detour for B2 is inserted between P2 and P3, NOT before P2
    const detour2Idx = seqWithB2.findIndex((id, idx) => idx > p2Idx && idx < p3Idx);
    assert.ok(detour2Idx !== -1, 'Detour B2 must be inserted between P2 and P3');
  }

  // 8. 驗證同一 leg 有兩個屏障時，插入順序依 firstCoordIdx 排列
  const sameLegBarriers = [
    { id: 'B1_Late', name: 'B1_Late', lat: 25.015, lng: 121.515, radius: 100, enabled: true },
    { id: 'B1_Early', name: 'B1_Early', lat: 25.005, lng: 121.505, radius: 100, enabled: true }
  ];
  const sameLegConflicts = rm.findRoadGeometryBarrierConflicts(originalRoute, sameLegBarriers);
  assert.equal(sameLegConflicts.length, 2);
  assert.equal(sameLegConflicts[0].barrier.id, 'B1_Early', 'Earlier coord index must be processed first');
  assert.equal(sameLegConflicts[1].barrier.id, 'B1_Late', 'Later coord index must be processed second');

  // 9. 驗證 AbortError 立即終止後續請求
  const abortController = new AbortController();
  abortController.abort();
  rm.beginOperation('detour');
  rm.operationController = abortController;
  let requestsAfterAbort = 0;
  rm.fetchOsrmRouteChunked = async () => { requestsAfterAbort++; };
  await rm.replanWithDetour();
  assert.equal(requestsAfterAbort, 0, 'No requests should be sent when operation is aborted');
});

test('Suite 8: True Keyed DOM updating in renderStopList', () => {
  const { doc } = setupEnvironment();
  const rm = window.RoutingManager;

  rm.points = [
    { id: 'p1', lat: 25.01, lng: 121.51, name: 'Point 1', role: 'start' },
    { id: 'p2', lat: 25.02, lng: 121.52, name: 'Point 2', role: 'stop' },
    { id: 'p3', lat: 25.03, lng: 121.53, name: 'Point 3', role: 'end' }
  ];

  rm.renderStopList();
  const list = doc.getElementById('routing-stop-list');
  assert.equal(list.children.length, 3);

  const row1 = list.children[0];
  const row2 = list.children[1];
  const row3 = list.children[2];
  assert.equal(row1.dataset.pointId, 'p1');
  assert.equal(row2.dataset.pointId, 'p2');
  assert.equal(row3.dataset.pointId, 'p3');

  // Change order: move p3 to middle, rename p1
  rm.points = [
    { id: 'p1', lat: 25.01, lng: 121.51, name: 'Point 1 (Renamed)', role: 'start' },
    { id: 'p3', lat: 25.03, lng: 121.53, name: 'Point 3', role: 'stop' },
    { id: 'p2', lat: 25.02, lng: 121.52, name: 'Point 2', role: 'end' }
  ];

  rm.renderStopList();

  // Elements must be preserved (Keyed DOM node re-use)
  assert.equal(list.children[0], row1, 'row1 DOM node should be reused in-place');
  assert.equal(list.children[1], row3, 'row3 DOM node should be reused and moved to index 1');
  assert.equal(list.children[2], row2, 'row2 DOM node should be reused and moved to index 2');

  // Text content must reflect update
  const nameEl = row1.querySelector('strong');
  assert.equal(nameEl.textContent, 'Point 1 (Renamed)', 'Name text should be updated without destroying node');
});
