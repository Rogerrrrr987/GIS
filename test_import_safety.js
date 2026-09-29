const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function context() {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, URL, document: { addEventListener() {}, getElementById() { return null; } } });
  ctx.window = ctx;
  for (const [file, name] of [['io', 'IOManager'], ['app', 'App'], ['draw', 'DrawManager'], ['routing-multipoint', 'RoutingManager']]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', `${file}.js`), 'utf8') + `\n;globalThis.${name} = ${name};`, ctx);
  }
  return ctx;
}
const feature = (coords = [121, 24]) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coords } });
const fc = (features = [feature()]) => ({ type: 'FeatureCollection', features });
const file = (name, text) => ({ name, size: text.length, text: async () => text });

test('Import: valid GeoJSON keeps properties and coordinates unchanged', () => {
  const c = context();
  const data = fc(); data.features[0].properties.name = '<img src=x onerror=alert(1)>';
  assert.equal(JSON.stringify(c.IOManager.parseGeoJSON(JSON.stringify(data))), JSON.stringify(data));
});
for (const [name, data] of [
  ['empty', fc([])], ['null geometry', fc([{ ...feature(), geometry: null }])],
  ['string coordinate', fc([feature(['121', 24])])], ['range', fc([feature([24, 121])])],
  ['non-finite', fc([feature([Infinity, 24])])],
  ['open ring', fc([{ ...feature(), geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } }])],
  ['projected CRS', { ...fc(), crs: { properties: { name: 'EPSG:3826' } } }],
  ['unknown CRS', { ...fc(), crs: { properties: { name: 'LOCAL' } } }]
]) test(`Import: reject ${name} without altering input`, () => {
  const c = context(); const before = JSON.stringify(data);
  assert.throws(() => c.IOManager.validateFeatureCollection(data));
  assert.equal(JSON.stringify(data), before);
});

test('Import: invalid JSON error does not echo sensitive source', () => {
  assert.throws(() => context().IOManager.parseGeoJSON('{SECRET_VALUE'), error => !error.message.includes('SECRET_VALUE'));
});

for (const value of ['', '24garbage', 'Infinity', '0x18', '91']) {
  test(`Import: CSV rejects invalid latitude ${JSON.stringify(value)} and reports row`, () => {
    const c = context();
    c.Papa = { parse: () => ({ data: [{ lat: '24', lon: '121' }, { lat: value, lon: '121' }], meta: { fields: ['lat', 'lon'] }, errors: [] }) };
    assert.throws(() => c.IOManager.parseCSV('fixture'), /資料列 2/);
  });
}
test('Import: valid CSV numeric notation and parser errors', () => {
  const c = context();
  c.Papa = { parse: () => ({ data: [{ lat: '2.4e1', lon: '121.5' }], meta: { fields: ['lat', 'lon'] } }) };
  assert.equal(c.IOManager.parseCSV('').features[0].geometry.coordinates[1], 24);
  c.Papa.parse = () => ({ errors: [{ row: 3 }] });
  assert.throws(() => c.IOManager.parseCSV(''), /結構錯誤/);
});
test('Import: invalid WKT cannot silently fall back to coordinates', () => {
  const c = context();
  c.Papa = { parse: () => ({ data: [{ wkt: 'bad', lat: '24', lon: '121' }], meta: { fields: ['wkt', 'lat', 'lon'] } }) };
  c.wellknown = { parse: () => null };
  assert.throws(() => c.IOManager.parseCSV(''), /無效空間資料/);
});
test('Import: file and geometry resource limits stop before import', async () => {
  const c = context();
  await assert.rejects(c.IOManager.readImportFile({ size: 30 * 1024 * 1024 }), /25 MB/);
  await assert.rejects(c.IOManager.readImportFile({ size: 0 }), /空/);
  c.IOManager.importLimits.features = 1;
  assert.throws(() => c.IOManager.validateFeatureCollection(fc([feature(), feature()])), /20,000/);
  c.IOManager.importLimits.positions = 0;
  assert.throws(() => c.IOManager.validateFeatureCollection(fc()), /500,000/);
});

function zipContext(names) {
  const c = context();
  const files = Object.fromEntries(names.map(name => [name, { name, dir: false, _data: { uncompressedSize: 10 }, async: async () => 'GEOGCS["WGS 84"]' }]));
  c.JSZip = { loadAsync: async () => ({ files }) };
  c.shp = async () => fc();
  return { c, files };
}
test('Import: SHP requires matching .shp and .dbf, not unrelated files', async () => {
  const { c } = zipContext(['roads.shp', 'other.dbf']);
  await assert.rejects(c.IOManager.parseShapefileZip(new ArrayBuffer(8)), /同名 .dbf/);
  const { c: empty } = zipContext(['readme.txt']);
  await assert.rejects(empty.IOManager.parseShapefileZip(new ArrayBuffer(8)), /缺少 .shp/);
});
test('Import: missing PRJ/SHX warns; non-WGS84 output never passes range validation', async () => {
  const { c } = zipContext(['folder/a.SHP', 'folder/a.DBF']);
  const data = await c.IOManager.parseShapefileZip(new ArrayBuffer(8));
  assert.match(c.IOManager.importNotes.get(data).join(' '), /缺少 .prj/);
  assert.match(c.IOManager.importNotes.get(data).join(' '), /缺少 .shx/);
  c.shp = async () => fc([feature([250000, 2700000])]);
  await assert.rejects(c.IOManager.parseShapefileZip(new ArrayBuffer(8)), /範圍/);
});
test('Import: invalid PRJ and oversized ZIP are rejected before parser', async () => {
  const { c, files } = zipContext(['a.shp', 'a.dbf', 'a.prj']);
  files['a.prj'].async = async () => 'unknown projection';
  await assert.rejects(c.IOManager.parseShapefileZip(new ArrayBuffer(8)), /prj 無法辨識/);
  files['a.shp']._data.uncompressedSize = 101 * 1024 * 1024;
  await assert.rejects(c.IOManager.openImportZip(new ArrayBuffer(8)), /100 MB/);
});
test('Import: malformed archive, KML entities and ambiguous KMZ fail closed', async () => {
  const { c } = zipContext(['a.kml', 'b.kml']);
  await assert.rejects(c.IOManager.parseKMZ(new ArrayBuffer(8)), /多個 KML/);
  assert.throws(() => c.IOManager.parseKML('<!DOCTYPE kml><kml/>'), /DTD/);
  c.JSZip.loadAsync = async () => { throw Error('bad archive'); };
  await assert.rejects(c.IOManager.parseKMZ(new ArrayBuffer(8)), /損壞/);
});

function transactionContext(failAt = 0) {
  const c = context();
  const original = { id: 'original', featureGroup: { items: ['existing'] } };
  let changes = 0, adds = 0;
  c.SafetyManager = { suspended: false, recordChange() { if (!this.suspended) changes++; } };
  c.TableManager = { render() {} };
  c.LayerManager = {
    layers: [original], activeLayerId: original.id, render() {},
    getActiveLayer() { return this.layers.find(l => l.id === this.activeLayerId); },
    createLayer() {
      const layer = { id: 'new', featureGroup: { addLayer() { if (++adds === failAt) throw Error('simulated insertion error'); }, getBounds() { return { isValid: () => false }; } } };
      this.layers.unshift(layer); this.activeLayerId = layer.id; c.SafetyManager.recordChange(); return layer;
    }
  };
  c.DrawManager.loadFeatureCollection = () => [{}, {}];
  c.App.showToast = () => {}; c.App.updateStats = () => {};
  c.App.map = { removeLayer() {} };
  return { c, original, changes: () => changes };
}
test('Import: transaction failure removes partial layer, restores active layer and history', () => {
  const { c, original, changes } = transactionContext(2);
  let result;
  c.App.pendingImport = { geojson: fc([feature(), feature()]), filename: 'test', resolve: v => { result = v; } };
  c.App.completePendingImport(true);
  assert.equal(result, false); assert.equal(c.LayerManager.layers.length, 1);
  assert.equal(c.LayerManager.layers[0], original); assert.equal(c.LayerManager.activeLayerId, 'original');
  assert.equal(changes(), 0); assert.equal(c.SafetyManager.suspended, false);
});
test('Import: cancel makes no changes; success creates one undo entry', () => {
  const { c, changes } = transactionContext();
  c.App.pendingImport = { geojson: fc(), filename: 'test', resolve() {} };
  c.App.completePendingImport(false);
  assert.equal(c.LayerManager.layers.length, 1); assert.equal(changes(), 0);
  c.App.pendingImport = { geojson: fc(), filename: 'test', resolve() {} };
  c.App.completePendingImport(true);
  assert.equal(c.LayerManager.layers.length, 2); assert.equal(changes(), 1);
});
test('Import: missing preview fails closed and releases import lock', async () => {
  const { c } = transactionContext();
  assert.equal(await c.App.processSingleFile(file('data.json', JSON.stringify(fc()))), false);
  assert.equal(c.LayerManager.layers.length, 1); assert.equal(c.IOManager.importInProgress, false);
});
test('Import: actual draw preparation does not mutate map if a later feature fails', () => {
  const c = context(); let added = 0;
  c.L = { marker: () => ({}), polyline: () => { throw Error('second feature failed'); } };
  c.LayerManager = { getActiveLayer: () => ({ featureGroup: { addLayer() { added++; } } }) };
  c.DrawManager.ensureFeatureIdentity = () => {}; c.DrawManager.setupLayerInteractions = () => {};
  assert.throws(() => c.DrawManager.loadFeatureCollection(fc([feature(), { ...feature(), geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }])));
  assert.equal(added, 0);
});
test('Import: routing CSV uses shared reader and cancellation preserves existing points', async () => {
  const c = context(); const rm = c.RoutingManager;
  c.document.getElementById = () => ({ classList: { remove() {} } });
  c.Papa = { parse: () => ({ data: [{ lat: '24', lon: '121' }], meta: { fields: ['lat', 'lon'] } }) };
  rm.showFilePreviewModal = () => {};
  const old = [{ id: 'old' }]; rm.points = old;
  await rm.importPointFile(file('test.csv', 'lat,lon\n24,121'));
  assert.equal(rm.pendingFileImport.geojson.features.length, 1);
  assert.equal(c.IOManager.importInProgress, true);
  rm.cancelFileImport();
  assert.equal(rm.points, old); assert.equal(c.IOManager.importInProgress, false);
});
