/**
 * GeoCanvas GIS Tool - Attribute Table Manager
 */

const TableManager = {
  isOpen: false,
  searchTerm: '',
  query: null,

  init() {
    this.drawer = document.getElementById('attribute-drawer');
    this.tableBody = document.getElementById('attribute-table-body');
    this.tableHeader = document.getElementById('attribute-table-header');
    this.featureCountBadge = document.getElementById('drawer-feature-count');
    this.searchInput = document.getElementById('table-search-input');

    if (this.searchInput) {
      this.searchInput.addEventListener('input', (e) => {
        this.searchTerm = e.target.value.toLowerCase().trim();
        this.render();
      });
    }
    document.getElementById('table-selected-only')?.addEventListener('change', () => this.render());
  },

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  },

  open() {
    this.isOpen = true;
    if (this.drawer) this.drawer.classList.add('open');
    this.render();
  },

  close() {
    this.isOpen = false;
    if (this.drawer) this.drawer.classList.remove('open');
  },

  /**
   * Render table columns and rows from GIS features
   */
  render() {
    if (!this.drawer) return;
    const layers = DrawManager.getAllLayers();
    layers.forEach(layer => DrawManager.ensureFeatureIdentity(layer));
    const count = layers.length;

    if (this.featureCountBadge) {
      this.featureCountBadge.textContent = typeof I18n !== 'undefined' ? I18n.t('table.features_badge', { count }) : `${count} 個圖元`;
    }

    const esc = (val) => (window.SecurityUtils ? window.SecurityUtils.escapeHtml(val) : DrawManager.escapeHtml(val));

    if (count === 0) {
      // Category A: Pure static templates without dynamic user data
      const statusTitle = typeof I18n !== 'undefined' ? I18n.t('table.status', '狀態') : '狀態';
      const emptyFeaturesText = typeof I18n !== 'undefined' ? I18n.t('table.empty_features', '目前地圖上沒有任何圖元。請使用左側工具繪製，或點擊「匯入圖資」。') : '目前地圖上沒有任何圖元。請使用左側工具繪製，或點擊「匯入圖資」。';
      this.tableHeader.innerHTML = `<tr><th>${esc(statusTitle)}</th></tr>`;
      this.tableBody.innerHTML = `<tr><td style="text-align: center; color: #94a3b8; padding: 24px;">${esc(emptyFeaturesText)}</td></tr>`;
      return;
    }

    // 1. Gather all unique property keys
    const propKeys = new Set(['name', 'geom_type', 'measure', 'description']);
    layers.forEach(layer => {
      const props = layer.featureProps || {};
      Object.keys(props).forEach(k => {
        if (!['name', 'description', 'style', 'id', '_measure'].includes(k)) {
          propKeys.add(k);
        }
      });
    });

    const columns = Array.from(propKeys);
    this.refreshQueryFields(columns.filter(column => !['geom_type', 'measure'].includes(column)));

    // 2. Render Header
    const actionsTitle = typeof I18n !== 'undefined' ? I18n.t('table.col_actions', '操作') : '操作';
    let headerHtml = `<tr>
      <th style="width: 70px; text-align: center;">${esc(actionsTitle)}</th>
      <th style="width: 50px; text-align: center;">#</th>`;
    
    columns.forEach(col => {
      let label = col;
      if (col === 'name') label = typeof I18n !== 'undefined' ? I18n.t('table.col_name', '名稱') : '名稱';
      else if (col === 'geom_type') label = typeof I18n !== 'undefined' ? I18n.t('table.col_geometry', '幾何類型') : '幾何類型';
      else if (col === 'measure') label = typeof I18n !== 'undefined' ? I18n.t('table.col_measure', '幾何度量') : '幾何度量';
      else if (col === 'description') label = typeof I18n !== 'undefined' ? I18n.t('table.col_description', '描述') : '描述';
      headerHtml += `<th>${esc(label)}</th>`;
    });
    headerHtml += `</tr>`;
    // Category B: Header containing properly escaped column labels
    this.tableHeader.innerHTML = headerHtml;

    // 3. Render Rows
    let rowsHtml = '';
    let displayedCount = 0;
    const locateTitle = typeof I18n !== 'undefined' ? I18n.t('table.locate_feature', '定位至此圖元') : '定位至此圖元';
    const deleteTitle = typeof I18n !== 'undefined' ? I18n.t('table.delete_feature', '刪除此圖元') : '刪除此圖元';
    const editTitle = typeof I18n !== 'undefined' ? I18n.t('table.click_to_edit', '點擊編輯') : '點擊編輯';

    layers.forEach((layer, index) => {
      const props = layer.featureProps || {};
      const geomType = DrawManager.getLayerGeomType(layer);
      const measureText = DrawManager.getLayerMeasurementText(layer);

      if (document.getElementById('table-selected-only')?.checked && !SelectionManager.selectedIds.has(props.id)) return;
      if (this.query && !this.matchesQuery(props, this.query)) return;

      // Filtering
      if (this.searchTerm) {
        const textToSearch = [
          props.name || '',
          props.description || '',
          geomType,
          ...Object.values(props)
        ].join(' ').toLowerCase();

        if (!textToSearch.includes(this.searchTerm)) {
          return;
        }
      }

      displayedCount++;
      const isSelected = window.SelectionManager ? SelectionManager.selectedIds.has(props.id) : (DrawManager.selectedLayer === layer);
      const defaultName = typeof I18n !== 'undefined' ? I18n.t('table.feature_default_name', { id: index + 1 }) : `圖元 #${index + 1}`;

      rowsHtml += `<tr class="${isSelected ? 'selected' : ''}" data-feature-id="${esc(props.id)}" data-layer-id="${layer._leaflet_id}" onclick="TableManager.onRowClick(event, ${layer._leaflet_id})">
        <td style="text-align: center;">
          <button class="table-action-btn" title="${esc(locateTitle)}" onclick="TableManager.zoomToLayer(${layer._leaflet_id})">
            <i data-lucide="crosshair"></i>
          </button>
          <button class="table-action-btn" title="${esc(deleteTitle)}" onclick="TableManager.deleteLayer(${layer._leaflet_id})">
            <i data-lucide="trash-2" style="color: #ef4444;"></i>
          </button>
        </td>
        <td style="text-align: center; color: #64748b;">${index + 1}</td>`;

      columns.forEach(col => {
        let val = '';
        if (col === 'geom_type') {
          val = `<span class="dropdown-tag">${esc(geomType)}</span>`;
        } else if (col === 'measure') {
          val = `<span style="color: #0284c7; font-weight: 500;">${esc(measureText)}</span>`;
        } else if (col === 'name') {
          val = `<span style="font-weight: 600;">${esc(props.name || defaultName)}</span>`;
        } else if (col === 'description') {
          val = esc(props.description || '');
        } else {
          val = esc(props[col] !== undefined ? props[col] : '');
        }

        // Make editable if not geom_type or measure
        if (col !== 'geom_type' && col !== 'measure') {
          rowsHtml += `<td title="${esc(editTitle)}" style="cursor: pointer;" data-field="${esc(col)}" onclick="TableManager.editCell(${layer._leaflet_id}, this.dataset.field, this)">${val}</td>`;
        } else {
          rowsHtml += `<td>${val}</td>`;
        }
      });

      rowsHtml += `</tr>`;
    });

    if (displayedCount === 0 && this.searchTerm) {
      // Safe DOM API: Search term rendered purely via textContent, completely preventing HTML injection
      this.tableBody.innerHTML = '';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = columns.length + 2;
      td.style.cssText = 'text-align: center; color: #94a3b8; padding: 20px;';
      td.textContent = typeof I18n !== 'undefined' ? I18n.t('table.no_match', { term: this.searchTerm }) : `找不到符合「${this.searchTerm}」的圖元資料。`;
      tr.appendChild(td);
      this.tableBody.appendChild(tr);
      return;
    }

    // Category B: InnerHTML containing strictly escaped feature properties
    this.tableBody.innerHTML = rowsHtml;

    // Refresh icons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons({ root: this.tableBody });
    }
  },

  /**
   * Select currently filtered/displayed rows
   */
  selectFiltered() {
    if (!window.SelectionManager) return;
    const rows = this.tableBody.querySelectorAll('tr[data-feature-id]');
    
    // If not holding ctrl, we should probably clear selection first.
    // To make it additive, we just add. Let's make it additive.
    let added = 0;
    rows.forEach(row => {
       const id = row.dataset.featureId;
       if (id) {
          SelectionManager.selectedIds.add(id);
          added++;
       }
    });
    
    SelectionManager.render();
    if (added > 0) {
       App.showToast(`已選取 ${added} 個符合條件的圖元`, 'success');
    } else {
       App.showToast('沒有符合條件的圖元', 'info');
    }
  },

  /**
   * Highlight rows based on SelectionManager
   */
  highlightSelectedRows() {
    if (!window.SelectionManager) return;
    const selectedIds = SelectionManager.selectedIds;
    const rows = this.tableBody.querySelectorAll('tr[data-feature-id]');
    rows.forEach(row => {
       const id = row.dataset.featureId;
       if (id && selectedIds.has(id)) {
          row.classList.add('selected');
       } else {
          row.classList.remove('selected');
       }
    });
  },

  /**
   * Handle Row Click
   */
  onRowClick(e, layerId) {
    if (e.target.tagName.toLowerCase() === 'button' || e.target.closest('button')) return;
    if (e.target.dataset.field) return; // Ignore editable cell clicks

    const layer = DrawManager.getLayerById(layerId);
    if (!layer) return;

    if (window.SelectionManager) {
      SelectionManager.toggleSelection(layer, e);
    }
  },

  /**
   * Zoom map to layer
   */
  zoomToLayer(layerId) {
    const layer = DrawManager.getLayerById(layerId);
    if (!layer) return;

    if (layer.getBounds) {
      window.map.fitBounds(layer.getBounds(), { padding: [50, 50], maxZoom: 17 });
    } else if (layer.getLatLng) {
      window.map.setView(layer.getLatLng(), Math.max(window.map.getZoom(), 16));
    }

    if (window.SelectionManager) {
      SelectionManager.selectedIds.clear();
      SelectionManager.toggleSelection(layer);
    }
    this.render();
  },

  /**
   * Delete layer from table
   */
  deleteLayer(layerId) {
    const layer = DrawManager.getLayerById(layerId);
    if (!layer) return;
    if (DrawManager.isLayerLocked(layer)) {
      App.showToast('圖層已鎖定，無法刪除圖元', 'error');
      return;
    }
    if (confirm('確定要刪除此圖元嗎？')) {
      DrawManager.removeLayer(layer);
      this.render();
      App.showToast('已刪除圖元', 'info');
    }
  },

  /**
   * Edit cell value directly
   */
  editCell(layerId, key, cellEl) {
    const layer = DrawManager.getLayerById(layerId);
    if (!layer) return;
    if (DrawManager.isLayerLocked(layer)) {
      App.showToast('圖層已鎖定，無法編輯屬性', 'error');
      return;
    }
    if (!layer.featureProps) layer.featureProps = {};

    const currentVal = layer.featureProps[key] !== undefined ? layer.featureProps[key] : '';
    const newVal = prompt(`請輸入欄位【${key}】的新數值:`, currentVal);

    if (newVal !== null && newVal !== currentVal) {
      layer.featureProps[key] = newVal;
      DrawManager.updateLayerPopup(layer);
      this.render();
      App.showToast(`已更新「${key}」屬性`, 'success');
      SafetyManager?.recordChange(`更新屬性 ${key}`);
    }
  },

  /**
   * Add a new attribute column across all features
   */
  addNewColumn() {
    const colName = prompt('請輸入要新增的自訂屬性欄位名稱（例如：用途, 地號, 負責人）:');
    if (!colName || !colName.trim()) return;

    const cleanName = colName.trim();
    const layers = DrawManager.getAllLayers();
    if (layers.length === 0) {
      App.showToast('地圖上尚無圖元可新增屬性！', 'warning');
      return;
    }

    let changed = 0;
    layers.forEach(layer => {
      if (DrawManager.isLayerLocked(layer)) return;
      if (!layer.featureProps) layer.featureProps = {};
      if (layer.featureProps[cleanName] === undefined) {
        layer.featureProps[cleanName] = '';
        changed++;
      }
    });

    this.render();
    App.showToast(`已在 ${changed} 個未鎖定圖元新增欄位「${cleanName}」`, 'success');
    if (changed) SafetyManager?.recordChange(`新增欄位 ${cleanName}`);
  },

  refreshQueryFields(columns) {
    ['query-field-a', 'query-field-b'].forEach(id => {
      const select = document.getElementById(id);
      if (!select) return;
      const current = select.value;
      const placeholder = id.endsWith('-b') ? '欄位 B（選填）' : '欄位 A';
      select.replaceChildren(new Option(placeholder, ''));
      columns.forEach(column => select.add(new Option(column, column)));
      if (columns.includes(current)) select.value = current;
    });
  },

  readCondition(suffix) {
    return {
      field: document.getElementById(`query-field-${suffix}`)?.value || '',
      operator: document.getElementById(`query-operator-${suffix}`)?.value || 'contains',
      value: document.getElementById(`query-value-${suffix}`)?.value ?? ''
    };
  },

  conditionMatches(props, condition) {
    if (!condition.field) return null;
    const actual = props[condition.field] ?? '';
    const expected = condition.value;
    if (condition.operator === 'contains') return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    if (condition.operator === 'eq') return String(actual) === String(expected);
    if (condition.operator === 'neq') return String(actual) !== String(expected);
    const a = Number(actual);
    const b = Number(expected);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return condition.operator === 'gt' ? a > b : a < b;
  },

  matchesQuery(props, query) {
    const first = this.conditionMatches(props, query.a);
    const second = this.conditionMatches(props, query.b);
    if (first === null) return true;
    if (second === null) return first;
    return query.join === 'or' ? first || second : first && second;
  },

  applyQuery() {
    const a = this.readCondition('a');
    const b = this.readCondition('b');
    if (!a.field) {
      App.showToast('請先選擇欄位 A', 'warning');
      return;
    }
    this.query = { a, b, join: document.getElementById('query-join')?.value || 'and' };
    this.render();
  },

  clearQuery() {
    this.query = null;
    ['query-field-a', 'query-field-b', 'query-value-a', 'query-value-b'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.value = '';
    });
    this.render();
  }
};

if (typeof window !== 'undefined') window.TableManager = TableManager;
if (typeof global !== 'undefined') global.TableManager = TableManager;

