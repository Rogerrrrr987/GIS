/**
 * GeoCanvas GIS Tool - Internationalization (i18n) Test Suite
 *
 * Validates:
 * 1. Dictionary symmetry (100% key parity between zh-TW and en)
 * 2. Key lookup and parameter interpolation (I18n.t)
 * 3. Language switching, localStorage persistence, and event notifications
 * 4. Leaflet Geoman toolbar language coordination
 * 5. DOM translation (textContent, innerHTML, title, placeholder, aria-label, input value)
 * 6. Full coverage of all data-i18n attributes in index.html against dictionaries
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Load I18n module
const I18n = require('./js/i18n.js');

test('=== 1. Dictionary Symmetry & Key Parity ===', async (t) => {
  const zhKeys = Object.keys(I18n.translations['zh-TW']).sort();
  const enKeys = Object.keys(I18n.translations['en']).sort();

  await t.test('zh-TW and en dictionaries must have identical key sets', () => {
    const missingInEn = zhKeys.filter(k => !(k in I18n.translations['en']));
    const missingInZh = enKeys.filter(k => !(k in I18n.translations['zh-TW']));

    assert.deepStrictEqual(missingInEn, [], `Keys present in zh-TW but missing in en: ${missingInEn.join(', ')}`);
    assert.deepStrictEqual(missingInZh, [], `Keys present in en but missing in zh-TW: ${missingInZh.join(', ')}`);
    assert.strictEqual(zhKeys.length, enKeys.length, `Key counts must match (found ${zhKeys.length} keys)`);
  });

  await t.test('All translation values must be non-empty strings', () => {
    ['zh-TW', 'en'].forEach(lang => {
      const dict = I18n.translations[lang];
      for (const [key, val] of Object.entries(dict)) {
        assert.ok(typeof val === 'string' && val.trim().length > 0, `[${lang}] Value for "${key}" must be a non-empty string`);
      }
    });
  });
});

test('=== 2. Parameter Interpolation & Fallback (I18n.t) ===', async (t) => {
  I18n.currentLang = 'zh-TW';

  await t.test('Simple translation lookup in zh-TW', () => {
    assert.strictEqual(I18n.t('common.save'), '保存');
    assert.strictEqual(I18n.t('header.layers'), '圖層');
  });

  await t.test('Simple translation lookup in en', () => {
    I18n.currentLang = 'en';
    assert.strictEqual(I18n.t('common.save'), 'Save');
    assert.strictEqual(I18n.t('header.layers'), 'Layers');
    I18n.currentLang = 'zh-TW';
  });

  await t.test('Parameter interpolation with single parameter', () => {
    I18n.currentLang = 'zh-TW';
    const zh = I18n.t('table.features_badge', { count: 42 });
    assert.strictEqual(zh, '42 個圖元');

    I18n.currentLang = 'en';
    const en = I18n.t('table.features_badge', { count: 42 });
    assert.strictEqual(en, '42 features');
  });

  await t.test('Parameter interpolation with multiple parameters', () => {
    I18n.currentLang = 'zh-TW';
    const zh = I18n.t('statusbar.coords', { lat: '25.040000', lng: '121.510000' });
    assert.strictEqual(zh, '經緯度: 25.040000, 121.510000');

    I18n.currentLang = 'en';
    const en = I18n.t('statusbar.coords', { lat: '25.040000', lng: '121.510000' });
    assert.strictEqual(en, 'Coords: 25.040000, 121.510000');
  });

  await t.test('Fallback to provided default text when key is missing', () => {
    assert.strictEqual(I18n.t('non.existent.key', '預設文字'), '預設文字');
    assert.strictEqual(I18n.t('non.existent.key'), 'non.existent.key');
  });
});

test('=== 3. Language Switching, Persistence & Events ===', async (t) => {
  // Mock localStorage
  const storage = {};
  global.localStorage = {
    getItem(k) { return storage[k] || null; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; },
    clear() { for (const k in storage) delete storage[k]; }
  };

  await t.test('setLanguage switches language and persists to localStorage', () => {
    I18n.setLanguage('en');
    assert.strictEqual(I18n.getLanguage(), 'en');
    assert.strictEqual(storage['geocanvas_lang'], 'en');

    I18n.setLanguage('zh-TW');
    assert.strictEqual(I18n.getLanguage(), 'zh-TW');
    assert.strictEqual(storage['geocanvas_lang'], 'zh-TW');
  });

  await t.test('setLanguage ignores invalid language codes', () => {
    I18n.setLanguage('zh-TW');
    I18n.setLanguage('fr');
    assert.strictEqual(I18n.getLanguage(), 'zh-TW');
  });

  await t.test('onLanguageChange callback is notified upon change', () => {
    let notifiedLang = null;
    I18n.onLanguageChange((lang) => {
      notifiedLang = lang;
    });

    I18n.setLanguage('en');
    assert.strictEqual(notifiedLang, 'en');

    I18n.setLanguage('zh-TW');
    assert.strictEqual(notifiedLang, 'zh-TW');
  });

  await t.test('init restores saved language from localStorage', () => {
    storage['geocanvas_lang'] = 'en';
    I18n.init();
    assert.strictEqual(I18n.getLanguage(), 'en');

    storage['geocanvas_lang'] = 'zh-TW';
    I18n.init();
    assert.strictEqual(I18n.getLanguage(), 'zh-TW');
  });
});

test('=== 4. Leaflet Geoman Language Synchronization ===', async (t) => {
  await t.test('updateGeomanLang sets "zh" for zh-TW and "en" for en', () => {
    let geomanLang = null;
    const mockMap = {
      pm: {
        setLang(l) { geomanLang = l; }
      }
    };

    I18n.currentLang = 'zh-TW';
    I18n.updateGeomanLang(mockMap);
    assert.strictEqual(geomanLang, 'zh');

    I18n.currentLang = 'en';
    I18n.updateGeomanLang(mockMap);
    assert.strictEqual(geomanLang, 'en');
  });
});

test('=== 5. DOM Translation Engine (applyToDOM) ===', async (t) => {
  // Simple Mock DOM
  function createMockElement(tag, attrs = {}) {
    return {
      tagName: tag.toUpperCase(),
      attributes: { ...attrs },
      textContent: '',
      innerHTML: '',
      value: '',
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); }
      },
      getAttribute(k) { return this.attributes[k] || null; },
      setAttribute(k, v) { this.attributes[k] = v; },
      removeAttribute(k) { delete this.attributes[k]; }
    };
  }

  const titleEl = createMockElement('title', { 'data-i18n': 'app.page_title' });
  const spanEl = createMockElement('span', { 'data-i18n': 'header.save_project' });
  const htmlEl = createMockElement('li', { 'data-i18n-html': 'modal.import_kml_note' });
  const btnEl = createMockElement('button', { 'data-i18n-title': 'header.undo' });
  const inputEl = createMockElement('input', { 'data-i18n-placeholder': 'table.search_placeholder', 'data-i18n-value': 'gp.default_buffer_name' });
  const ariaEl = createMockElement('select', { 'data-i18n-aria': 'routing.barrier_radius_aria' });
  const langLabel = createMockElement('span', { id: 'current-lang-label' });
  const btnZh = createMockElement('button', { id: 'lang-btn-zh' });
  const btnEn = createMockElement('button', { id: 'lang-btn-en' });

  const mockRoot = {
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return [titleEl, spanEl];
      if (selector === '[data-i18n-html]') return [htmlEl];
      if (selector === '[data-i18n-title]') return [btnEl];
      if (selector === '[data-i18n-placeholder]') return [inputEl];
      if (selector === '[data-i18n-aria]') return [ariaEl];
      if (selector === '[data-i18n-value]') return [inputEl];
      return [];
    },
    getElementById(id) {
      if (id === 'current-lang-label') return langLabel;
      if (id === 'lang-btn-zh') return btnZh;
      if (id === 'lang-btn-en') return btnEn;
      return null;
    }
  };

  // Mock global document
  global.document = {
    title: '',
    documentElement: { lang: 'zh-TW' }
  };

  await t.test('applyToDOM applies zh-TW translations', () => {
    I18n.currentLang = 'zh-TW';
    I18n.applyToDOM(mockRoot);

    assert.strictEqual(global.document.title, 'GeoCanvas - 簡易 GIS 向量繪製與圖資轉換工具');
    assert.strictEqual(spanEl.textContent, '另存專案');
    assert.ok(htmlEl.innerHTML.includes('Google Earth'));
    assert.strictEqual(btnEl.getAttribute('title'), '復原');
    assert.strictEqual(inputEl.getAttribute('placeholder'), '搜尋名稱、屬性...');
    assert.strictEqual(inputEl.value, '緩衝區');
    assert.strictEqual(ariaEl.getAttribute('aria-label'), '屏障半徑');
    assert.strictEqual(langLabel.textContent, '繁體中文');
    assert.ok(btnZh.classList.contains('active'));
    assert.ok(!btnEn.classList.contains('active'));
  });

  await t.test('applyToDOM applies en translations', () => {
    I18n.currentLang = 'en';
    I18n.applyToDOM(mockRoot);

    assert.strictEqual(global.document.title, 'GeoCanvas - Simple GIS Vector Mapping & Data Conversion');
    assert.strictEqual(spanEl.textContent, 'Save Project');
    assert.ok(htmlEl.innerHTML.includes('Google Earth'));
    assert.strictEqual(btnEl.getAttribute('title'), 'Undo');
    assert.strictEqual(inputEl.getAttribute('placeholder'), 'Search name, attributes...');
    assert.strictEqual(inputEl.value, 'Buffer');
    assert.strictEqual(ariaEl.getAttribute('aria-label'), 'Barrier radius');
    assert.strictEqual(langLabel.textContent, 'English');
    assert.ok(!btnZh.classList.contains('active'));
    assert.ok(btnEn.classList.contains('active'));
  });
});

test('=== 6. index.html Full Data-i18n Coverage ===', async (t) => {
  const htmlContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  // Extract all data-i18n* keys
  const dataI18nRegex = /data-i18n(?:-[a-z]+)?=["']([^"']+)["']/g;
  const usedKeys = new Set();
  let match;
  while ((match = dataI18nRegex.exec(htmlContent)) !== null) {
    usedKeys.add(match[1]);
  }

  await t.test('Every key in index.html must exist in both zh-TW and en dictionaries', () => {
    const missingInZh = [];
    const missingInEn = [];

    usedKeys.forEach(key => {
      if (!(key in I18n.translations['zh-TW'])) missingInZh.push(key);
      if (!(key in I18n.translations['en'])) missingInEn.push(key);
    });

    assert.deepStrictEqual(missingInZh, [], `Keys used in index.html but missing from zh-TW: ${missingInZh.join(', ')}`);
    assert.deepStrictEqual(missingInEn, [], `Keys used in index.html but missing from en: ${missingInEn.join(', ')}`);
    assert.ok(usedKeys.size > 80, `Found ${usedKeys.size} distinct i18n keys in index.html`);
  });
});
