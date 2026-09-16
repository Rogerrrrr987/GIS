/**
 * GeoCanvas GIS Tool - Stage 3 Geoprocessing & Data Management Automated Test Suite
 *
 * Covers 35 required assertions across:
 * - Buffer (1-4)
 * - Clip (5-8)
 * - Intersect (9-13)
 * - Merge (14-16)
 * - Dissolve (17-20)
 * - Save Selected (21-24)
 * - Field Calculator (25-30)
 * - Safety, Recovery, and Security (31-35)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// =========================================================================
// MOCK ENVIRONMENT SETUP (DOM, Leaflet, Turf)
// =========================================================================

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.childNodes = [];
    this.dataset = {};
    this.style = {};
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, val) => (val === undefined ? (classes.has(c) ? (classes.delete(c), false) : (classes.add(c), true)) : (val ? (classes.add(c), true) : (classes.delete(c), false))),
      contains: (c) => classes.has(c)
    };
    this.attributes = {};
    this._textContent = '';
    this._innerHTML = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.options = [];
    this.selectedIndex = 0;
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map(c => c.textContent).join(' ') + (this._textContent ? ' ' + this._textContent : '');
    }
    return this._textContent;
  }
  set textContent(val) {
    this._textContent = String(val ?? '');
    this.children = [];
    this.childNodes = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(val) {
    this._innerHTML = String(val ?? '');
  }

  appendChild(child) {
    this.children.push(child);
    this.childNodes.push(child);
    if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
      this.options.push(child);
    }
    return child;
  }

  append(...items) {
    items.forEach(item => {
      if (typeof item === 'string') {
        this._textContent += item;
      } else {
        this.appendChild(item);
      }
    });
  }

  replaceChildren(...items) {
    this.children = [];
    this.childNodes = [];
    this.options = [];
    this._textContent = '';
    if (items) this.append(...items);
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
  }
  getAttribute(name) {
    return this.attributes[name] || null;
  }

  addEventListener() {}
  removeEventListener() {}
  focus() {}
  setSelectionRange() {}

  querySelectorAll() {
    return [];
  }
  querySelector() {
    return null;
  }
}

class MockStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(k) {
    return this.store.has(k) ? this.store.get(k) : null;
  }
  setItem(k, v) {
    this.store.set(k, String(v));
  }
  removeItem(k) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}

// Minimal Turf geometric mock
const mockTurf = {
  buffer(geojson, distance, options = {}) {
    if (!geojson || !geojson.geometry) return null;
    const geom = geojson.geometry;
    let coords = [];
    if (geom.type === 'Point') {
      const [x, y] = geom.coordinates;
      const d = (distance || 100) / 111000;
      coords = [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]];
    } else {
      // Return simple bounding polygon
      coords = [[[120.9, 23.9], [121.1, 23.9], [121.1, 24.1], [120.9, 24.1], [120.9, 23.9]]];
    }
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: coords },
      properties: { ...(geojson.properties || {}) }
    };
  },

  intersect(poly1, poly2) {
    if (!poly1 || !poly2) return null;
    const b1 = this.bbox(poly1);
    const b2 = this.bbox(poly2);
    if (b1[2] < b2[0] || b1[0] > b2[2] || b1[3] < b2[1] || b1[1] > b2[3]) return null;
    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[121.0, 24.0], [121.05, 24.0], [121.05, 24.05], [121.0, 24.05], [121.0, 24.0]]]
      },
      properties: {}
    };
  },

  union(poly1, poly2) {
    if (!poly1 && !poly2) return null;
    if (!poly1) return poly2;
    if (!poly2) return poly1;
    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[120.8, 23.8], [121.2, 23.8], [121.2, 24.2], [120.8, 24.2], [120.8, 23.8]]]
      },
      properties: { ...(poly1.properties || {}), ...(poly2.properties || {}) }
    };
  },

  booleanPointInPolygon(pt, poly) {
    if (!pt || !poly) return false;
    const [x, y] = pt.geometry ? pt.geometry.coordinates : pt.coordinates || [0, 0];
    return x >= 120 && x <= 122 && y >= 23 && y <= 26;
  },

  booleanWithin(line, poly) {
    if (!line || !poly) return false;
    return true;
  },

  polygonToLine(poly) {
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[120.9, 23.9], [121.1, 23.9], [121.1, 24.1], [120.9, 24.1], [120.9, 23.9]] }
    };
  },

  lineSplit(line, splitter) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[121.0, 24.0], [121.05, 24.05]] },
          properties: {}
        }
      ]
    };
  },

  along(line, distance) {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [121.025, 24.025] }
    };
  },

  area(feature) {
    return 1500000; // 1.5 sq km
  },

  length(feature, options) {
    return 2500; // 2500 meters
  },

  centroid(feature) {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [121.51, 25.04] }
    };
  },

  bbox(feature) {
    if (!feature || !feature.geometry) return [0, 0, 0, 0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const scan = (coords) => {
      if (Array.isArray(coords) && typeof coords[0] === 'number') {
        const [x, y] = coords;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else if (Array.isArray(coords)) {
        coords.forEach(scan);
      }
    };
    scan(feature.geometry.coordinates);
    return isFinite(minX) ? [minX, minY, maxX, maxY] : [0, 0, 0, 0];
  }
};

// Mock Leaflet layer
class MockLeafletLayer {
  constructor(type, coords, options = {}) {
    this._leaflet_id = Math.floor(Math.random() * 100000);
    this.type = type;
    this.coords = coords;
    this.options = options;
    this.featureProps = {};
    this.events = {};
  }
  on(event, handler) {
    this.events[event] = handler;
  }
  off() {}
  getLatLng() {
    return { lat: this.coords[0], lng: this.coords[1] };
  }
  getLatLngs() {
    return this.coords;
  }
  getBounds() {
    return {
      isValid: () => true,
      getNorthEast: () => ({ lat: 25, lng: 122 }),
      getSouthWest: () => ({ lat: 23, lng: 120 })
    };
  }
  toGeoJSON() {
    if (this.type === 'Point') {
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [this.coords[1], this.coords[0]] },
        properties: { ...this.featureProps }
      };
    }
    if (this.type === 'LineString') {
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: this.coords.map(c => [c[1], c[0]]) },
        properties: { ...this.featureProps }
      };
    }
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [this.coords.map(c => [c[1], c[0]])] },
      properties: { ...this.featureProps }
    };
  }
}

class MockFeatureGroup {
  constructor() {
    this._layers = new Map();
    this.events = {};
  }
  addLayer(layer) {
    this._layers.set(layer._leaflet_id, layer);
  }
  removeLayer(layer) {
    const id = layer._leaflet_id !== undefined ? layer._leaflet_id : layer;
    this._layers.delete(id);
  }
  getLayers() {
    return Array.from(this._layers.values());
  }
  getLayer(id) {
    return this._layers.get(id) || null;
  }
  hasLayer(layer) {
    return this._layers.has(layer._leaflet_id);
  }
  clearLayers() {
    this._layers.clear();
  }
  eachLayer(cb) {
    this.getLayers().forEach(cb);
  }
  addTo() {
    return this;
  }
  getBounds() {
    return {
      isValid: () => this._layers.size > 0,
      getNorthEast: () => ({ lat: 25, lng: 122 }),
      getSouthWest: () => ({ lat: 23, lng: 120 })
    };
  }
}

class MockMarker extends MockLeafletLayer {
  constructor(latlng, options) {
    super('Point', latlng, options);
  }
}

class MockPolyline extends MockLeafletLayer {
  constructor(latlngs, options) {
    super('LineString', latlngs, options);
  }
}

class MockPolygon extends MockLeafletLayer {
  constructor(rings, options) {
    super('Polygon', rings, options);
  }
}

class MockCircle extends MockLeafletLayer {
  constructor(latlng, radius, options) {
    super('Circle', latlng, options);
    this.radius = radius;
  }
  getRadius() {
    return this.radius || 100;
  }
}

const mockL = {
  Marker: MockMarker,
  Polyline: MockPolyline,
  Polygon: MockPolygon,
  Circle: MockCircle,
  marker: (latlng, options) => new MockMarker(latlng, options),
  polyline: (latlngs, options) => new MockPolyline(latlngs, options),
  polygon: (rings, options) => new MockPolygon(rings, options),
  circle: (latlng, radius, options) => new MockCircle(latlng, radius, options),
  geoJSON: (geojson) => new MockLeafletLayer(geojson?.geometry?.type || 'Geometry', [24, 121]),
  featureGroup: (layers = []) => {
    const fg = new MockFeatureGroup();
    layers.forEach(l => fg.addLayer(l));
    return fg;
  },
  layerGroup: () => new MockFeatureGroup(),
  DomEvent: {
    disableClickPropagation: () => {},
    disableScrollPropagation: () => {},
    stopPropagation: () => {}
  }
};

// Global Environment Binding
const elementsById = new Map();
global.window = global;
global.document = {
  createElement: (tag) => new MockElement(tag),
  getElementById: (id) => {
    if (!elementsById.has(id)) {
      elementsById.set(id, new MockElement('div'));
    }
    return elementsById.get(id);
  },
  querySelectorAll: () => [],
  addEventListener: () => {}
};
global.localStorage = new MockStorage();
global.sessionStorage = new MockStorage();
global.L = mockL;
global.turf = mockTurf;

global.App = {
  map: {
    fitBounds: () => {},
    setView: () => {},
    hasLayer: () => false,
    addLayer: () => {},
    removeLayer: () => {},
    getContainer: () => new MockElement('div'),
    on: () => {},
    off: () => {}
  },
  showToast: () => {},
  updateStats: () => {}
};

global.DrawManager = {
  currentStyle: { color: '#2563eb', weight: 2, fillOpacity: 0.35 },
  generateFeatureId: () => `feat_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
  ensureFeatureIdentity: (l, id) => {
    if (!l.featureProps) l.featureProps = {};
    if (!l.featureProps.id) l.featureProps.id = id || `feat_${Date.now()}`;
    return l.featureProps.id;
  },
  setupLayerInteractions: () => {},
  updateLayerPopup: () => {},
  clearSelection: () => {},
  syncStyleControls: () => {},
  loadFeatureCollection: () => {},
  updateGeomanPathOptions: () => {},
  getAllLayers: () => {
    const layers = [];
    (global.LayerManager?.layers || []).forEach(l => {
      if (l.featureGroup) layers.push(...l.featureGroup.getLayers());
    });
    return layers;
  }
};

global.TableManager = {
  render: () => {},
  drawer: new MockElement('div')
};

global.SelectionManager = {
  selectedIds: new Set(),
  getSelectedFeatures: () => {
    return global.DrawManager.getAllLayers().filter(l => l.featureProps && global.SelectionManager.selectedIds.has(l.featureProps.id));
  }
};

// Load production files
await import('./js/safety.js');
await import('./js/layers.js');
await import('./js/field-calculator.js');
await import('./js/geoprocessing.js');

const GP = global.GeoprocessingManager;
const FC = global.FieldCalculator;
const LM = global.LayerManager;
const SM = global.SafetyManager;

function resetWorkspace() {
  LM.layers = [];
  LM.groups = [];
  LM.activeLayerId = null;
  SelectionManager.selectedIds.clear();
  SM.undoStack = [];
  SM.redoStack = [];
  SM.initialized = true;
  SM.map = global.App.map;
  SM.suspended = false;
  SM.dirty = false;
  SM.lastSignature = '';
}

// =========================================================================
// TEST SUITES: 35 REQUIRED ASSERTIONS
// =========================================================================

test('=== Buffer (緩衝區分析) ===', async (t) => {
  resetWorkspace();

  await t.test('1. 點、線、面緩衝區產生正確 (Point, Line, Polygon)', async () => {
    const ptLayer = LM.createLayer('點圖層', 'Point');
    const pt = L.marker([25.04, 121.51]);
    pt.featureProps = { id: 'p1', name: '台北車站' };
    ptLayer.featureGroup.addLayer(pt);

    const bufLayer = await GP.runBuffer({
      layerId: ptLayer.id,
      distance: 200,
      unit: 'meters',
      outputName: '點緩衝區'
    });

    assert.ok(bufLayer, '緩衝區圖層必須成功建立');
    assert.strictEqual(bufLayer.geometryType, 'Polygon');
    assert.strictEqual(bufLayer.featureGroup.getLayers().length, 1);
    const bufFeat = bufLayer.featureGroup.getLayers()[0];
    assert.strictEqual(bufFeat.featureProps.source_id, 'p1');
    assert.strictEqual(bufFeat.featureProps.buffer_distance, 200);
    assert.strictEqual(bufFeat.featureProps.buffer_unit, 'm');
  });

  await t.test('2. 無效距離（<= 0）防呆攔截拋出錯誤', async () => {
    const ptLayer = LM.layers[0];
    await assert.rejects(
      async () => GP.runBuffer({ layerId: ptLayer.id, distance: 0 }),
      /緩衝距離必須大於 0/
    );
    await assert.rejects(
      async () => GP.runBuffer({ layerId: ptLayer.id, distance: -50 }),
      /緩衝距離必須大於 0/
    );
  });

  await t.test('3. dissolve 開關正常運作 (融合多個重疊緩衝區)', async () => {
    const ptLayer = LM.createLayer('多點圖層', 'Point');
    const p1 = L.marker([25.04, 121.51]);
    p1.featureProps = { id: 'p1' };
    const p2 = L.marker([25.041, 121.511]);
    p2.featureProps = { id: 'p2' };
    ptLayer.featureGroup.addLayer(p1);
    ptLayer.featureGroup.addLayer(p2);

    const dissolvedLayer = await GP.runBuffer({
      layerId: ptLayer.id,
      distance: 500,
      dissolve: true,
      outputName: '融合緩衝區'
    });

    assert.ok(dissolvedLayer);
    assert.strictEqual(dissolvedLayer.featureGroup.getLayers().length, 1);
    assert.strictEqual(dissolvedLayer.featureGroup.getLayers()[0].featureProps.source_count, 2);
  });

  await t.test('4. 空結果或來源無圖元時不建立空圖層', async () => {
    const emptyLayer = LM.createLayer('空圖層', 'Point');
    const prevCount = LM.layers.length;
    await assert.rejects(
      async () => GP.runBuffer({ layerId: emptyLayer.id, distance: 100 }),
      /沒有可進行緩衝區分析的圖元/
    );
    assert.strictEqual(LM.layers.length, prevCount, '圖層總數不得增加');
  });
});

test('=== Clip (裁切) ===', async (t) => {
  resetWorkspace();

  const maskLayer = LM.createLayer('遮罩面圖層', 'Polygon');
  const maskPoly = L.polygon([[23, 120], [26, 120], [26, 122], [23, 122], [23, 120]]);
  maskPoly.featureProps = { id: 'mask_1', name: '全台遮罩' };
  maskLayer.featureGroup.addLayer(maskPoly);

  await t.test('5. 點在面內保留、面外過濾', async () => {
    const ptLayer = LM.createLayer('點來源', 'Point');
    const insidePt = L.marker([24.5, 121.0]); // inside
    insidePt.featureProps = { id: 'in_1', name: '面內點' };
    const outsidePt = L.marker([10.0, 100.0]); // outside
    outsidePt.featureProps = { id: 'out_1', name: '面外點' };
    ptLayer.featureGroup.addLayer(insidePt);
    ptLayer.featureGroup.addLayer(outsidePt);

    const clipped = await GP.runClip({
      sourceLayerId: ptLayer.id,
      clipLayerId: maskLayer.id,
      outputName: '點裁切結果'
    });

    assert.ok(clipped);
    assert.strictEqual(clipped.featureGroup.getLayers().length, 1);
    assert.strictEqual(clipped.featureGroup.getLayers()[0].featureProps.source_id, 'in_1');
  });

  await t.test('6. 線穿越裁切面保留線段，絕不轉成點', async () => {
    const lineLayer = LM.createLayer('線來源', 'Line');
    const line = L.polyline([[22.0, 119.0], [25.0, 121.5]]);
    line.featureProps = { id: 'line_1', name: '穿越線' };
    lineLayer.featureGroup.addLayer(line);

    const clipped = await GP.runClip({
      sourceLayerId: lineLayer.id,
      clipLayerId: maskLayer.id,
      outputName: '線裁切結果'
    });

    assert.ok(clipped);
    assert.strictEqual(clipped.geometryType, 'Line');
    const feats = clipped.featureGroup.getLayers();
    assert.ok(feats.length > 0);
    assert.strictEqual(feats[0].toGeoJSON().geometry.type, 'LineString');
  });

  await t.test('7. 面與面裁切產出正確交集多邊形', async () => {
    const polyLayer = LM.createLayer('面來源', 'Polygon');
    const poly = L.polygon([[24.0, 120.5], [25.5, 120.5], [25.5, 121.5], [24.0, 121.5], [24.0, 120.5]]);
    poly.featureProps = { id: 'poly_1', name: '來源面' };
    polyLayer.featureGroup.addLayer(poly);

    const clipped = await GP.runClip({
      sourceLayerId: polyLayer.id,
      clipLayerId: maskLayer.id,
      outputName: '面裁切結果'
    });

    assert.ok(clipped);
    assert.strictEqual(clipped.geometryType, 'Polygon');
    assert.strictEqual(clipped.featureGroup.getLayers().length, 1);
  });

  await t.test('8. 非面狀裁切圖層被明確拒絕', async () => {
    const ptMask = LM.createLayer('非法遮罩', 'Point');
    const pt = L.marker([24.0, 121.0]);
    ptMask.featureGroup.addLayer(pt);

    const polyLayer = LM.layers.find(l => l.name === '面來源');
    await assert.rejects(
      async () => GP.runClip({ sourceLayerId: polyLayer.id, clipLayerId: ptMask.id }),
      /裁切遮罩圖層必須為面狀圖層/
    );
  });
});

test('=== Intersect (相交運算) ===', async (t) => {
  resetWorkspace();

  const polyA = LM.createLayer('區域A', 'Polygon');
  const pA = L.polygon([[24.0, 120.5], [25.0, 120.5], [25.0, 121.5], [24.0, 121.5], [24.0, 120.5]]);
  pA.featureProps = { id: 'a1', name: '台北分區', code: 'TPE' };
  polyA.featureGroup.addLayer(pA);

  const polyB = LM.createLayer('區域B', 'Polygon');
  const pB = L.polygon([[24.5, 121.0], [25.5, 121.0], [25.5, 122.0], [24.5, 122.0], [24.5, 121.0]]);
  pB.featureProps = { id: 'b1', name: '新北分區', code: 'NTP', zone: 'Urban' };
  polyB.featureGroup.addLayer(pB);

  await t.test('9. 點與面相交', async () => {
    const ptLayer = LM.createLayer('點集', 'Point');
    const pt = L.marker([24.5, 121.0]);
    pt.featureProps = { id: 'pt1', name: '交會點' };
    ptLayer.featureGroup.addLayer(pt);

    const res = await GP.runIntersect({ layerAId: ptLayer.id, layerBId: polyA.id, outputName: '點面相交' });
    assert.ok(res);
    assert.strictEqual(res.featureGroup.getLayers().length, 1);
  });

  await t.test('10. 線與面相交', async () => {
    const lineLayer = LM.createLayer('線集', 'Line');
    const line = L.polyline([[24.2, 120.8], [24.8, 121.2]]);
    line.featureProps = { id: 'ln1', name: '主要道路' };
    lineLayer.featureGroup.addLayer(line);

    const res = await GP.runIntersect({ layerAId: lineLayer.id, layerBId: polyA.id, outputName: '線面相交' });
    assert.ok(res);
    assert.strictEqual(res.featureGroup.getLayers().length, 1);
  });

  await t.test('11. 面與面相交', async () => {
    const res = await GP.runIntersect({ layerAId: polyA.id, layerBId: polyB.id, outputName: '面面相交' });
    assert.ok(res);
    assert.strictEqual(res.featureGroup.getLayers().length, 1);
  });

  await t.test('12. 相同欄位名稱自動附加 A_ 與 B_ 前綴', async () => {
    const res = await GP.runIntersect({ layerAId: polyA.id, layerBId: polyB.id, outputName: '屬性前綴檢測' });
    const props = res.featureGroup.getLayers()[0].featureProps;

    assert.strictEqual(props.A_name, '台北分區');
    assert.strictEqual(props.B_name, '新北分區');
    assert.strictEqual(props.A_code, 'TPE');
    assert.strictEqual(props.B_code, 'NTP');
    assert.strictEqual(props.zone, 'Urban');
    assert.strictEqual(props.source_a_id, 'a1');
    assert.strictEqual(props.source_b_id, 'b1');
  });

  await t.test('13. bbox 空間包圍盒預篩選避免笛卡兒積', async () => {
    const distantPoly = LM.createLayer('遙遠區域', 'Polygon');
    const pDistant = L.polygon([[10.0, 10.0], [11.0, 10.0], [11.0, 11.0], [10.0, 11.0], [10.0, 10.0]]);
    distantPoly.featureGroup.addLayer(pDistant);

    const res = await GP.runIntersect({ layerAId: polyA.id, layerBId: distantPoly.id, outputName: '無交集測試' });
    assert.strictEqual(res, null, '無交集時不建立空圖層');
  });
});

test('=== Merge (合併圖層) ===', async (t) => {
  resetWorkspace();

  const pLayer1 = LM.createLayer('學校點', 'Point');
  const pt1 = L.marker([25.0, 121.5]);
  pt1.featureProps = { id: 's1', name: '台大', students: 30000 };
  pLayer1.featureGroup.addLayer(pt1);

  const pLayer2 = LM.createLayer('醫院點', 'Point');
  const pt2 = L.marker([25.1, 121.6]);
  pt2.featureProps = { id: 'h1', name: '台大醫院', beds: 1500 };
  pLayer2.featureGroup.addLayer(pt2);

  const polyLayer = LM.createLayer('行政區面', 'Polygon');
  const poly = L.polygon([[25, 121], [25.1, 121], [25.1, 121.1], [25, 121.1], [25, 121]]);
  polyLayer.featureGroup.addLayer(poly);

  await t.test('14. 相同幾何類型圖層合併成功', async () => {
    const merged = await GP.runMerge({ layerIds: [pLayer1.id, pLayer2.id], outputName: '公共設施點' });
    assert.ok(merged);
    assert.strictEqual(merged.geometryType, 'Point');
    assert.strictEqual(merged.featureGroup.getLayers().length, 2);
  });

  await t.test('15. 不同幾何家族合併被明確拒絕', async () => {
    await assert.rejects(
      async () => GP.runMerge({ layerIds: [pLayer1.id, polyLayer.id] }),
      /合併圖層僅支援相同幾何家族/
    );
  });

  await t.test('16. 欄位聯集與缺值 null 補值', async () => {
    const merged = await GP.runMerge({ layerIds: [pLayer1.id, pLayer2.id], outputName: '欄位補值檢測' });
    const [f1, f2] = merged.featureGroup.getLayers();

    assert.strictEqual(f1.featureProps.students, 30000);
    assert.strictEqual(f1.featureProps.beds, null, '缺少欄位應自動補值為 null');
    assert.strictEqual(f1.featureProps.source_layer, '學校點');

    assert.strictEqual(f2.featureProps.students, null, '缺少欄位應自動補值為 null');
    assert.strictEqual(f2.featureProps.beds, 1500);
    assert.strictEqual(f2.featureProps.source_layer, '醫院點');
  });
});

test('=== Dissolve (融合) ===', async (t) => {
  resetWorkspace();

  const polyLayer = LM.createLayer('分區面', 'Polygon');
  const p1 = L.polygon([[24.0, 120.0], [24.5, 120.0], [24.5, 120.5], [24.0, 120.5], [24.0, 120.0]]);
  p1.featureProps = { id: 'd1', zone: 'A', name: '分區A-1' };
  const p2 = L.polygon([[24.5, 120.0], [25.0, 120.0], [25.0, 120.5], [24.5, 120.5], [24.5, 120.0]]);
  p2.featureProps = { id: 'd2', zone: 'A', name: '分區A-2' };
  const p3 = L.polygon([[25.0, 120.0], [25.5, 120.0], [25.5, 120.5], [25.0, 120.5], [25.0, 120.0]]);
  p3.featureProps = { id: 'd3', zone: 'B', name: '分區B-1' };

  polyLayer.featureGroup.addLayer(p1);
  polyLayer.featureGroup.addLayer(p2);
  polyLayer.featureGroup.addLayer(p3);

  await t.test('17. 全部融合 (All Dissolve)', async () => {
    const res = await GP.runDissolve({
      layerId: polyLayer.id,
      dissolveAll: true,
      outputName: '全部融合結果'
    });
    assert.ok(res);
    assert.strictEqual(res.featureGroup.getLayers().length, 1);
    const feat = res.featureGroup.getLayers()[0];
    assert.strictEqual(feat.featureProps.source_count, 3);
    assert.strictEqual(feat.featureProps.dissolve_field, 'ALL');
    assert.ok(feat.featureProps.area_m2 > 0);
  });

  await t.test('18. 依指定欄位分組融合 (Group By zone)', async () => {
    const res = await GP.runDissolve({
      layerId: polyLayer.id,
      dissolveField: 'zone',
      outputName: '依分區融合'
    });
    assert.ok(res);
    const layers = res.featureGroup.getLayers();
    assert.strictEqual(layers.length, 2); // Groups 'A' and 'B'
    const groupA = layers.find(l => l.featureProps.dissolve_value === 'A');
    assert.strictEqual(groupA.featureProps.source_count, 2);
  });

  await t.test('19. 單一圖元分組正確輸出', async () => {
    const res = await GP.runDissolve({
      layerId: polyLayer.id,
      dissolveField: 'zone',
      outputName: '單一圖元分組檢驗'
    });
    const groupB = res.featureGroup.getLayers().find(l => l.featureProps.dissolve_value === 'B');
    assert.ok(groupB);
    assert.strictEqual(groupB.featureProps.source_count, 1);
  });

  await t.test('20. Turf union 失敗時產生錯誤摘要且不崩潰', async () => {
    const badLayer = LM.createLayer('異常面', 'Polygon');
    const bp1 = L.polygon([[24, 120], [25, 120], [25, 121], [24, 121], [24, 120]]);
    bp1.featureProps = { id: 'bp1', name: '正常面' };
    const bp2 = L.polygon([[24.5, 120.5], [25.5, 120.5], [25.5, 121.5], [24.5, 121.5], [24.5, 120.5]]);
    bp2.featureProps = { id: 'bp2', name: '拓樸異常面' };
    badLayer.featureGroup.addLayer(bp1);
    badLayer.featureGroup.addLayer(bp2);

    // Mock Turf.union throwing an exception
    const originalUnion = turf.union;
    turf.union = () => { throw new Error('TopologyException: self-intersection'); };

    try {
      const res = await GP.runDissolve({ layerId: badLayer.id, dissolveAll: true, outputName: '容錯融合' });
      assert.ok(res, '運算不應崩潰');
      const errBox = document.getElementById('gp-error-summary');
      assert.ok(errBox.textContent.includes('TopologyException'), '錯誤摘要應記錄例外訊息');
    } finally {
      turf.union = originalUnion;
    }
  });
});

test('=== 選取圖元另存圖層 ===', async (t) => {
  resetWorkspace();

  const layer = LM.createLayer('混和圖元來源', 'any');
  const pt = L.marker([25.0, 121.5]);
  pt.featureProps = { id: 'sel_pt', name: '選取點', style: { color: '#ff0000' } };
  const ln = L.polyline([[25, 121], [25.1, 121.1]]);
  ln.featureProps = { id: 'sel_ln', name: '選取線', style: { color: '#00ff00' } };
  layer.featureGroup.addLayer(pt);
  layer.featureGroup.addLayer(ln);

  await t.test('21. 沒有選取時拒絕執行', () => {
    SelectionManager.selectedIds.clear();
    const res = GP.saveSelectedAsLayer({ outputName: '測試另存' });
    assert.strictEqual(res, null);
  });

  await t.test('22. 同類型選取建立單一圖層', () => {
    SelectionManager.selectedIds.clear();
    SelectionManager.selectedIds.add('sel_pt');

    const res = GP.saveSelectedAsLayer({ outputName: '單選點圖層' });
    assert.ok(res);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].name, '單選點圖層');
    assert.strictEqual(res[0].geometryType, 'Point');
  });

  await t.test('23. 混合幾何自動分流為不同圖層 (Point & Line)', () => {
    SelectionManager.selectedIds.clear();
    SelectionManager.selectedIds.add('sel_pt');
    SelectionManager.selectedIds.add('sel_ln');

    const res = GP.saveSelectedAsLayer({ outputName: '分流輸出' });
    assert.ok(res);
    assert.strictEqual(res.length, 2, '必須分流為 2 個圖層');
    const ptLayer = res.find(l => l.geometryType === 'Point');
    const lnLayer = res.find(l => l.geometryType === 'Line');
    assert.ok(ptLayer && lnLayer);
  });

  await t.test('24. 完整保留樣式與屬性', () => {
    const ptLayer = LM.layers.find(l => l.name === '分流輸出_Point');
    assert.ok(ptLayer);
    const feat = ptLayer.featureGroup.getLayers()[0];
    assert.strictEqual(feat.featureProps.name, '選取點');
    assert.strictEqual(feat.featureProps.style?.color, '#ff0000');
  });
});

test('=== 欄位計算器 (Safe AST Expression Parser) ===', async (t) => {
  resetWorkspace();

  const testLayer = LM.createLayer('數值圖層', 'Point');
  const pt = L.marker([25.04, 121.51]);
  pt.featureProps = { id: 'f1', name: '台北測試', val_a: 20, val_b: 5, tag: ' Alpha ' };
  testLayer.featureGroup.addLayer(pt);

  await t.test('25. 數值四則運算與優先權 (+, -, *, /)', () => {
    const ast = FC.parseAndValidate('[val_a] + [val_b] * 2 - 10 / 2');
    const res = FC.SafeEvaluator.evaluate(ast, { properties: pt.featureProps });
    // 20 + (5 * 2) - (10 / 2) = 20 + 10 - 5 = 25
    assert.strictEqual(res, 25);
  });

  await t.test('26. 文字串接與字串函式 (trim, upper, lower, substring, concat)', () => {
    const ast = FC.parseAndValidate('upper(trim([tag])) + "_" + substr([name], 1, 2)');
    const res = FC.SafeEvaluator.evaluate(ast, { properties: pt.featureProps });
    assert.strictEqual(res, 'ALPHA_台北');
  });

  await t.test('27. 幾何變數計算 ($area_m2, $length_m, $x, $y, $centroid_x)', () => {
    const gv = FC.GeometryUtil.computeVariables(pt);
    const ast = FC.parseAndValidate('round($x + 0.01, 2)');
    const res = FC.SafeEvaluator.evaluate(ast, { geomVars: gv });
    assert.strictEqual(res, 121.52);
  });

  await t.test('28. 除以零保護：回傳 null，絕不產生 Infinity', () => {
    const ast = FC.parseAndValidate('[val_a] / 0');
    const res = FC.SafeEvaluator.evaluate(ast, { properties: pt.featureProps });
    assert.strictEqual(res, null, '除以零必須回傳 null');
    assert.notStrictEqual(res, Infinity);
  });

  await t.test('29. 引用不存在之欄位名稱時拒絕執行', () => {
    const available = new Set(['val_a', 'val_b']);
    assert.throws(
      () => FC.parseAndValidate('[non_existent_field] * 2', available),
      /欄位「non_existent_field」不存在/
    );
  });

  await t.test('30. 靜態原始碼證明：未使用 eval 或 new Function', () => {
    const code = fs.readFileSync(path.resolve('./js/field-calculator.js'), 'utf-8');
    const codeWithoutComments = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    assert.strictEqual(/\beval\s*\(/.test(codeWithoutComments), false, '執行碼不得包含 eval(');
    assert.strictEqual(codeWithoutComments.includes('new Function'), false, '執行碼不得包含 new Function');
    assert.strictEqual(/\bFunction\s*\(/.test(codeWithoutComments), false, '執行碼不得包含 Function(');
  });
});

test('=== 安全、復原與健全性 ===', async (t) => {
  resetWorkspace();

  await t.test('31. 取消運算後不留下半成品輸出圖層', async () => {
    const pLayer = LM.createLayer('基礎圖層', 'Point');
    for (let k = 0; k < 20; k++) {
      pLayer.featureGroup.addLayer(L.marker([24 + k * 0.01, 121]));
    }
    const initialLayers = LM.layers.length;

    // Trigger cancellation during operation
    const runPromise = GP.runBuffer({ layerId: pLayer.id, distance: 100, outputName: '取消測試' });
    GP.cancel();
    const res = await runPromise;
    assert.strictEqual(res, null);
    assert.strictEqual(LM.layers.length, initialLayers);
  });

  await t.test('32. 單一圖元幾何錯誤不影響其他圖元完成', async () => {
    const pLayer = LM.createLayer('混合容錯圖層', 'Point');
    const goodPt = L.marker([25.0, 121.5]);
    goodPt.featureProps = { id: 'good' };
    const badPt = { type: 'Feature', geometry: null, featureProps: { id: 'bad' } }; // corrupt geometry
    pLayer.featureGroup.addLayer(goodPt);
    pLayer.featureGroup.addLayer(badPt);

    const res = await GP.runBuffer({ layerId: pLayer.id, distance: 100, outputName: '容錯緩衝' });
    assert.ok(res);
    assert.strictEqual(res.featureGroup.getLayers().length, 1);
  });

  await t.test('33. 空間處理成功後自動建立 SafetyManager 紀錄', async () => {
    const ptLayer = LM.createLayer('來源層', 'Point');
    ptLayer.featureGroup.addLayer(L.marker([25, 121]));
    SM.commitChange('建立來源層');

    const undoCountBefore = SM.undoStack.length;
    await GP.runBuffer({ layerId: ptLayer.id, distance: 50, outputName: '復原測試層' });
    assert.ok(SM.undoStack.length > undoCountBefore, '必須在 undoStack 建立新快照');
  });

  await t.test('34. Undo 操作可完整復原移除新建立之圖層', async () => {
    const countBeforeUndo = LM.layers.length;
    SM.undo();
    assert.strictEqual(LM.layers.length, countBeforeUndo - 1, 'Undo 必須將新產生的圖層移除');
  });

  await t.test('35. 惡意屬性文字不產生 HTML 元素注入 (XSS 防護)', () => {
    const xssPayload = '<img src=x onerror=alert(1)>';
    const escaped = LM.escapeHtml(xssPayload);
    assert.strictEqual(escaped.includes('<img'), false);
    assert.strictEqual(escaped.includes('&lt;img'), true);

    const targetEl = new MockElement('td');
    SecurityUtils.setText(targetEl, xssPayload);
    assert.strictEqual(targetEl.textContent, xssPayload);
    assert.strictEqual(targetEl.children.length, 0);
  });
});
