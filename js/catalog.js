/**
 * GeoCanvas GIS Tool - Local data catalog
 * Browser security requires the user to choose local files explicitly.
 */

const CatalogManager = {
  storageKey: 'geocanvas.catalog.recentFiles',
  panel: null,
  recentList: null,
  fileInput: null,

  init() {
    this.panel = document.getElementById('catalog-panel');
    this.recentList = document.getElementById('catalog-recent-files');
    this.fileInput = document.getElementById('catalog-file-input');

    document.getElementById('btn-toggle-catalog')?.addEventListener('click', () => this.toggle());
    document.getElementById('btn-close-catalog')?.addEventListener('click', () => this.hide());
    document.getElementById('btn-catalog-add-file')?.addEventListener('click', () => this.fileInput?.click());
    this.fileInput?.addEventListener('change', async event => {
      const files = Array.from(event.target.files || []);
      if (files.length) {
        await App.processFiles(files);
        const sourceLabel = typeof I18n !== 'undefined' ? I18n.t('catalog.source_local', '本機檔案') : '本機檔案';
        files.forEach(file => this.addRecent(file.name, sourceLabel));
      }
      event.target.value = '';
    });

    this.renderRecent();
    this.syncVisibilityState();
  },

  toggle() {
    const isNowOpen = Boolean(this.panel?.classList.contains('is-hidden'));
    this.setOpen(isNowOpen);
    if (isNowOpen && typeof PanelManager !== 'undefined' && PanelManager.activePanel) {
      PanelManager.close(PanelManager.activePanel);
    }
  },

  hide() {
    this.setOpen(false);
  },

  setOpen(isOpen) {
    if (!this.panel) return;
    this.panel.classList.toggle('is-hidden', !isOpen);
    this.syncVisibilityState();
  },

  syncVisibilityState() {
    if (!this.panel) return;
    const isHidden = this.panel.classList.contains('is-hidden');
    this.panel.setAttribute('aria-hidden', String(isHidden));
    this.panel.inert = isHidden;
    document.getElementById('btn-toggle-catalog')?.setAttribute('aria-expanded', String(!isHidden));
  },

  getRecent() {
    try {
      const entries = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
      const recent = Array.isArray(entries) ? entries.filter(item => item.source !== '內建範例') : [];
      if (recent.length !== entries.length) localStorage.setItem(this.storageKey, JSON.stringify(recent));
      return recent;
    } catch {
      return [];
    }
  },

  addRecent(name, source) {
    const next = [{ name, source, openedAt: Date.now() }, ...this.getRecent().filter(item => item.name !== name)].slice(0, 8);
    try { localStorage.setItem(this.storageKey, JSON.stringify(next)); } catch { }
    this.renderRecent();
  },

  renderRecent() {
    if (!this.recentList) return;
    this.recentList.replaceChildren();
    const recent = this.getRecent();
    if (!recent.length) {
      const empty = document.createElement('p');
      empty.className = 'catalog-empty';
      empty.textContent = typeof I18n !== 'undefined'
        ? I18n.t('catalog.empty_hint', '尚未呼叫任何資料。選擇電腦檔案後會顯示於此。')
        : '尚未呼叫任何資料。選擇電腦檔案後會顯示於此。';
      this.recentList.appendChild(empty);
      return;
    }

    recent.forEach(entry => {
      const button = document.createElement('button');
      button.className = 'catalog-file';
      button.title = typeof I18n !== 'undefined'
        ? I18n.t('catalog.reselect_file', { name: entry.name })
        : `重新選擇「${entry.name}」`;
      // Category A: Static HTML skeleton without dynamic interpolation; values inserted via textContent below
      button.innerHTML = '<i data-lucide="history"></i><span><strong></strong><small></small></span>';
      button.querySelector('strong').textContent = entry.name;
      const isLocal = entry.source === '本機檔案' || entry.source === 'Local File' || !entry.source;
      const displaySource = isLocal
        ? (typeof I18n !== 'undefined' ? I18n.t('catalog.source_local', '本機檔案') : '本機檔案')
        : entry.source;
      button.querySelector('small').textContent = displaySource;
      button.addEventListener('click', () => this.fileInput?.click());
      this.recentList.appendChild(button);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons({ root: this.recentList });
  }
};
