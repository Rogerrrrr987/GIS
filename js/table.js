/**
 * GeoCanvas GIS Tool - Attribute Table Manager
 */

const TableManager = {
  isOpen: false,
  searchTerm: '',
  query: null,
  selectedOnly: false,
  currentPage: 1,
  pageSize: 500,
  totalPages: 1,
  layerPrefs: {}, // { [layerId]: { sortCol: null, sortDir: 'none', colWidths: {} } }
  lastClickedIndex: null,
  pagedFeatures: [],
  filteredFeatures: [],
  lastTriggerElement: null,

  init() {
    this.drawer = document.getElementById('attribute-drawer');
    if (this.drawer) {
      this.drawer.inert = true;
      this.drawer.setAttribute('inert', '');
      this.drawer.setAttribute('aria-hidden', 'true');
    }
    this.tableBody = document.getElementById('attribute-table-body');
    this.tableHeader = document.getElementById('attribute-table-header');
    this.featureCountBadge = document.getElementById('drawer-feature-count');
    this.matchedCountBadge = document.getElementById('drawer-matched-count');
    this.searchInput = document.getElementById('table-search-input');
    this.clearSearchBtn = document.getElementById('btn-clear-table-search');
    this.selectedOnlyCheckbox = document.getElementById('table-selected-only');
    this.layerSelect = document.getElementById('table-layer-select');
    this.paginationEl = document.getElementById('table-pagination');
    this.pageInfoEl = document.getElementById('table-page-info');

    if (this.searchInput) {
      this.searchInput.addEventListener('input', (e) => {
        this.searchTerm = e.target.value.toLowerCase().trim();
        if (this.clearSearchBtn) {
          this.clearSearchBtn.style.display = this.searchTerm ? 'inline-flex' : 'none';
        }
        this.currentPage = 1;
        this.render();
      });
    }

    if (this.clearSearchBtn) {
      this.clearSearchBtn.addEventListener('click', () => {
        if (this.searchInput) {
          this.searchInput.value = '';
          this.searchTerm = '';
          this.clearSearchBtn.style.display = 'none';
          this.currentPage = 1;
          this.render();
        }
      });
    }

    if (this.selectedOnlyCheckbox) {
      this.selectedOnlyCheckbox.addEventListener('change', () => {
        this.selectedOnly = this.selectedOnlyCheckbox.checked;
        this.currentPage = 1;
        this.render();
      });
    }

    if (this.layerSelect) {
      this.layerSelect.addEventListener('change', (e) => {
        if (window.LayerManager) {
          LayerManager.setActiveLayer(e.target.value);
        }
      });
    }

    document.getElementById('btn-toggle-table-query')?.addEventListener('click', () => {
      const queryBar = document.getElementById('attribute-query-bar');
      if (queryBar) {
        const isHidden = queryBar.style.display === 'none' || !queryBar.style.display;
        queryBar.style.display = isHidden ? 'flex' : 'none';
      }
    });

    document.getElementById('btn-clear-table-filters')?.addEventListener('click', () => {
      this.clearAllFilters();
    });

    document.getElementById('btn-table-prev-page')?.addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.render();
      }
    });

    document.getElementById('btn-table-next-page')?.addEventListener('click', () => {
      if (this.currentPage < this.totalPages) {
        this.currentPage++;
        this.render();
      }
    });

    document.getElementById('btn-table-select-filtered')?.addEventListener('click', () => {
      this.selectFiltered();
    });

    document.getElementById('btn-table-add-column')?.addEventListener('click', () => {
      this.addNewColumn();
    });

    document.getElementById('btn-close-drawer')?.addEventListener('click', () => {
      this.close();
    });
  },

  getPrefs(layerId) {
    if (!this.layerPrefs[layerId]) {
      this.layerPrefs[layerId] = { sortCol: null, sortDir: 'none', colWidths: {} };
    }
    return this.layerPrefs[layerId];
  },

  getActiveLayer() {
    if (typeof window !== 'undefined' && window.LayerManager?.getActiveLayer) {
      return LayerManager.getActiveLayer();
    }
    if (typeof global !== 'undefined' && global.LayerManager?.getActiveLayer) {
      return global.LayerManager.getActiveLayer();
    }
    return null;
  },

  updateLayerSelector(activeId) {
    if (!this.layerSelect) return;
    const layers = window.LayerManager?.layers || [];
    this.layerSelect.innerHTML = '';
    layers.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name;
      if (l.id === activeId) opt.selected = true;
      this.layerSelect.appendChild(opt);
    });
    if (activeId) this.layerSelect.value = activeId;
  },

  toggle(triggerEl) {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(triggerEl);
    }
  },

  open(triggerEl) {
    if (triggerEl && typeof triggerEl.focus === 'function') {
      this.lastTriggerElement = triggerEl;
    } else if (typeof document !== 'undefined' && document.activeElement && document.activeElement !== document.body && (!this.drawer || !this.drawer.contains(document.activeElement))) {
      this.lastTriggerElement = document.activeElement;
    }
    this.isOpen = true;
    if (this.drawer) {
      this.drawer.classList.add('open');
      this.drawer.inert = false;
      this.drawer.removeAttribute('inert');
      this.drawer.setAttribute('aria-hidden', 'false');
    }
    this.render();
  },

  close() {
    this.isOpen = false;
    if (this.drawer) {
      this.drawer.classList.remove('open');
      this.drawer.inert = true;
      this.drawer.setAttribute('inert', '');
      this.drawer.setAttribute('aria-hidden', 'true');
    }
    let target = (this.lastTriggerElement && typeof this.lastTriggerElement.focus === 'function' && (typeof document === 'undefined' || !document.contains || document.contains(this.lastTriggerElement)))
      ? this.lastTriggerElement
      : (typeof document !== 'undefined' ? (document.getElementById('btn-toggle-table') || document.getElementById('tools-dropdown-btn')) : null);

    if (target && target.closest && target.closest('.dropdown') && !target.closest('.dropdown').classList.contains('open')) {
      const dropdownToggle = target.closest('.dropdown').querySelector('#tools-dropdown-btn, .btn, button');
      if (dropdownToggle && typeof dropdownToggle.focus === 'function') {
        target = dropdownToggle;
      }
    }

    if (target && typeof target.focus === 'function') {
      try {
        target.focus();
      } catch (_) {}
    }
  },

  escapeHtml(val) {
    if (typeof window !== 'undefined' && window.SecurityUtils?.escapeHtml) {
      return window.SecurityUtils.escapeHtml(val);
    }
    if (typeof global !== 'undefined' && global.SecurityUtils?.escapeHtml) {
      return global.SecurityUtils.escapeHtml(val);
    }
    return String(val ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);
  },

  getFeatureValue(layer, col) {
    if (!layer) return '';
    const props = layer.featureProps || {};
    if (col === 'name') {
      return props.name || '';
    }
    if (col === 'geom_type') {
      return typeof DrawManager !== 'undefined' && DrawManager.getLayerGeomType ? DrawManager.getLayerGeomType(layer) : '';
    }
    if (col === 'measure') {
      return typeof DrawManager !== 'undefined' && DrawManager.getLayerMeasurementText ? DrawManager.getLayerMeasurementText(layer) : '';
    }
    if (col === 'description') {
      return props.description || '';
    }
    return props[col] !== undefined ? props[col] : '';
  },

  formatCellValue(val) {
    if (val === null || val === undefined || val === '') {
      return '<span class="attr-null-dash">—</span>';
    }
    return this.escapeHtml(val);
  },

  /**
   * Render table columns and rows for active layer
   */
  render() {
    if (!this.drawer && typeof document !== 'undefined') {
      this.drawer = document.getElementById('attribute-drawer');
      this.tableBody = document.getElementById('attribute-table-body');
      this.tableHeader = document.getElementById('attribute-table-header');
      this.featureCountBadge = document.getElementById('drawer-feature-count');
      this.matchedCountBadge = document.getElementById('drawer-matched-count');
      this.layerSelect = document.getElementById('table-layer-select');
      this.paginationEl = document.getElementById('table-pagination');
      this.pageInfoEl = document.getElementById('table-page-info');
    }
    if (!this.drawer) return;

    const activeLayer = this.getActiveLayer();
    const activeLayerId = activeLayer ? activeLayer.id : null;
    this.updateLayerSelector(activeLayerId);

    const esc = (s) => this.escapeHtml(s);

    let allLayers = [];
    if (activeLayer?.featureGroup && typeof activeLayer.featureGroup.getLayers === 'function') {
      allLayers = activeLayer.featureGroup.getLayers();
    }
    if (allLayers.length === 0 && typeof DrawManager !== 'undefined' && typeof DrawManager.getAllLayers === 'function') {
      const dmAll = DrawManager.getAllLayers();
      if (dmAll && dmAll.length > 0) {
        allLayers = dmAll;
      }
    }

    if (!activeLayer && allLayers.length === 0) {
      const statusTitle = typeof I18n !== 'undefined' && I18n.t ? I18n.t('table.status', '狀態') : '狀態';
      const emptyText = typeof I18n !== 'undefined' && I18n.t ? I18n.t('table.no_active_layer', '目前尚無作用中圖層。請新增圖層或匯入圖資。') : '目前尚無作用中圖層。請新增圖層或匯入圖資。';
      if (this.tableHeader) this.tableHeader.innerHTML = `<tr><th>${esc(statusTitle)}</th></tr>`;
      if (this.tableBody) this.tableBody.innerHTML = `<tr><td style="text-align: center; color: #94a3b8; padding: 24px;">${esc(emptyText)}</td></tr>`;
      if (this.featureCountBadge) this.featureCountBadge.textContent = '0 個圖元';
      if (this.matchedCountBadge) this.matchedCountBadge.textContent = '';
      if (this.paginationEl) this.paginationEl.style.display = 'none';
      return;
    }

    allLayers.forEach(layer => {
      if (typeof DrawManager !== 'undefined' && DrawManager.ensureFeatureIdentity) {
        DrawManager.ensureFeatureIdentity(layer);
      }
    });
    const totalCount = allLayers.length;

    if (this.featureCountBadge) {
      this.featureCountBadge.textContent = typeof I18n !== 'undefined'
        ? I18n.t('table.features_badge', { count: totalCount })
        : `${totalCount} 個圖元`;
    }

    if (totalCount === 0) {
      this.filteredFeatures = [];
      this.pagedFeatures = [];
      if (this.tableHeader) {
        this.tableHeader.replaceChildren();
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.textContent = typeof I18n !== 'undefined' ? I18n.t('table.col_name', '名稱') : '名稱';
        tr.appendChild(th);
        this.tableHeader.appendChild(tr);
      }
      if (this.tableBody) {
        this.tableBody.replaceChildren();
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.style.cssText = 'text-align: center; color: #94a3b8; padding: 24px;';
        td.textContent = typeof I18n !== 'undefined' ? I18n.t('table.empty_features', '目前圖層沒有任何圖元。請使用左側工具繪製，或點擊「匯入圖資」。') : '目前圖層沒有任何圖元。請使用左側工具繪製，或點擊「匯入圖資」。';
        tr.appendChild(td);
        this.tableBody.appendChild(tr);
      }
      if (this.matchedCountBadge) this.matchedCountBadge.textContent = '';
      if (this.paginationEl) this.paginationEl.style.display = 'none';
      return;
    }

    // 1. Gather all unique property keys
    const propKeys = new Set(['name', 'geom_type', 'measure', 'description']);
    allLayers.forEach(layer => {
      const props = layer.featureProps || {};
      Object.keys(props).forEach(k => {
        if (!['name', 'description', 'style', 'id', '_measure'].includes(k)) {
          propKeys.add(k);
        }
      });
    });

    const columns = Array.from(propKeys);
    this.refreshQueryFields(columns.filter(column => !['geom_type', 'measure'].includes(column)));

    // 2. Filtering
    const selectedOnly = document.getElementById('table-selected-only')?.checked;
    const filteredLayers = allLayers.filter(layer => {
      const props = layer.featureProps || {};
      const geomType = typeof DrawManager !== 'undefined' && DrawManager.getLayerGeomType ? DrawManager.getLayerGeomType(layer) : '';

      if (selectedOnly && window.SelectionManager && !SelectionManager.selectedIds.has(props.id)) return false;
      if (this.query && !this.matchesQuery(props, this.query)) return false;

      if (this.searchTerm) {
        const textToSearch = [
          props.name || '',
          props.description || '',
          geomType,
          ...Object.values(props)
        ].join(' ').toLowerCase();

        if (!textToSearch.includes(this.searchTerm)) {
          return false;
        }
      }
      return true;
    });

    // 3. Sorting
    const prefs = this.getPrefs(activeLayerId);
    if (prefs.sortCol && prefs.sortDir !== 'none') {
      const col = prefs.sortCol;
      const dir = prefs.sortDir;
      filteredLayers.sort((a, b) => {
        let valA = this.getFeatureValue(a, col);
        let valB = this.getFeatureValue(b, col);
        if (valA === null || valA === undefined || valA === '') return 1;
        if (valB === null || valB === undefined || valB === '') return -1;
        const numA = Number(valA);
        const numB = Number(valB);
        let cmp = 0;
        if (Number.isFinite(numA) && Number.isFinite(numB)) {
          cmp = numA - numB;
        } else {
          cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
        }
        return dir === 'desc' ? -cmp : cmp;
      });
    }

    const displayedCount = filteredLayers.length;
    this.filteredFeatures = filteredLayers;

    if (this.matchedCountBadge) {
      this.matchedCountBadge.textContent = typeof I18n !== 'undefined'
        ? I18n.t('table.matched_count', { count: displayedCount, total: totalCount })
        : `顯示 ${displayedCount} / ${totalCount} 筆`;
    }

    // 4. Pagination
    if (displayedCount > this.pageSize) {
      this.totalPages = Math.ceil(displayedCount / this.pageSize);
      if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
      if (this.currentPage < 1) this.currentPage = 1;
      const start = (this.currentPage - 1) * this.pageSize;
      this.pagedFeatures = filteredLayers.slice(start, start + this.pageSize);
      if (this.paginationEl) this.paginationEl.style.display = 'inline-flex';
      if (this.pageInfoEl) {
        this.pageInfoEl.textContent = typeof I18n !== 'undefined'
          ? I18n.t('table.page_info', { page: this.currentPage, totalPages: this.totalPages })
          : `${this.currentPage} / ${this.totalPages}`;
      }
    } else {
      this.totalPages = 1;
      this.currentPage = 1;
      this.pagedFeatures = filteredLayers;
      if (this.paginationEl) this.paginationEl.style.display = 'none';
    }

    // 5. Render Header safely via DOM APIs (no inline event handlers)
    const actionsTitle = typeof I18n !== 'undefined' ? I18n.t('table.col_actions', '操作') : '操作';
    if (this.tableHeader) {
      this.tableHeader.replaceChildren();
      const tr = document.createElement('tr');

      const actionsTh = document.createElement('th');
      actionsTh.style.cssText = 'width: 70px; min-width: 70px; text-align: center;';
      actionsTh.textContent = actionsTitle;
      tr.appendChild(actionsTh);

      const indexTh = document.createElement('th');
      indexTh.style.cssText = 'width: 50px; min-width: 50px; text-align: center;';
      indexTh.textContent = '#';
      tr.appendChild(indexTh);

      columns.forEach(col => {
        let label = col;
        if (col === 'name') label = typeof I18n !== 'undefined' ? I18n.t('table.col_name', '名稱') : '名稱';
        else if (col === 'geom_type') label = typeof I18n !== 'undefined' ? I18n.t('table.col_geometry', '幾何類型') : '幾何類型';
        else if (col === 'measure') label = typeof I18n !== 'undefined' ? I18n.t('table.col_measure', '幾何度量') : '幾何度量';
        else if (col === 'description') label = typeof I18n !== 'undefined' ? I18n.t('table.col_description', '描述') : '描述';

        const th = document.createElement('th');
        th.className = 'sortable-th';
        th.dataset.col = col;
        if (prefs.colWidths && prefs.colWidths[col]) {
          th.style.width = `${prefs.colWidths[col]}px`;
          th.style.minWidth = `${prefs.colWidths[col]}px`;
        }

        const thContent = document.createElement('div');
        thContent.className = 'th-content';
        thContent.addEventListener('click', () => {
          this.sortColumn(col);
        });

        const thTitle = document.createElement('span');
        thTitle.className = 'th-title';
        thTitle.textContent = label;
        thContent.appendChild(thTitle);

        const isSorted = prefs.sortCol === col;
        const sortDir = isSorted ? prefs.sortDir : 'none';
        const sortIcon = document.createElement('i');
        if (sortDir === 'asc') {
          sortIcon.setAttribute('data-lucide', 'arrow-up');
          sortIcon.className = 'sort-indicator active';
          sortIcon.style.cssText = 'width: 12px; height: 12px; color: #2563eb;';
        } else if (sortDir === 'desc') {
          sortIcon.setAttribute('data-lucide', 'arrow-down');
          sortIcon.className = 'sort-indicator active';
          sortIcon.style.cssText = 'width: 12px; height: 12px; color: #2563eb;';
        } else {
          sortIcon.setAttribute('data-lucide', 'arrow-up-down');
          sortIcon.className = 'sort-indicator neutral';
          sortIcon.style.cssText = 'width: 12px; height: 12px; opacity: 0.35;';
        }
        thContent.appendChild(sortIcon);
        th.appendChild(thContent);

        const resizer = document.createElement('span');
        resizer.className = 'th-resizer';
        resizer.dataset.col = col;
        th.appendChild(resizer);

        tr.appendChild(th);
      });

      this.tableHeader.appendChild(tr);
      this.bindResizers(activeLayerId);
      if (typeof lucide !== 'undefined') lucide.createIcons({ root: this.tableHeader });
    }

    // 6. Render Rows safely via DOM APIs (no inline event handlers)
    if (displayedCount === 0) {
      this.filteredFeatures = [];
      this.pagedFeatures = [];
      if (this.tableBody) {
        this.tableBody.replaceChildren();
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = columns.length + 2;
        td.style.cssText = 'text-align: center; color: #94a3b8; padding: 24px;';
        if (this.searchTerm) {
          td.textContent = typeof I18n !== 'undefined' && I18n.t
            ? I18n.t('table.no_match', { term: this.searchTerm })
            : `找不到符合「${this.searchTerm}」的圖元資料。`;
        } else {
          td.textContent = typeof I18n !== 'undefined' && I18n.t
            ? I18n.t('table.no_match_filter', '找不到符合條件的圖元資料。')
            : `找不到符合條件的圖元資料。`;
        }
        tr.appendChild(td);
        this.tableBody.appendChild(tr);
      }
      return;
    }

    const locateTitle = typeof I18n !== 'undefined' ? I18n.t('table.locate_feature', '定位至此圖元') : '定位至此圖元';
    const deleteTitle = typeof I18n !== 'undefined' ? I18n.t('table.delete_feature', '刪除此圖元') : '刪除此圖元';
    const editTitle = typeof I18n !== 'undefined' ? I18n.t('table.click_to_edit', '點擊編輯') : '點擊編輯';
    const offset = (this.currentPage - 1) * this.pageSize;

    if (this.tableBody) {
      this.tableBody.replaceChildren();
      const frag = document.createDocumentFragment();

      this.pagedFeatures.forEach((layer, idx) => {
        const globalIndex = offset + idx;
        const props = layer.featureProps || {};
        const geomType = typeof DrawManager !== 'undefined' && DrawManager.getLayerGeomType ? DrawManager.getLayerGeomType(layer) : '';
        const measureText = typeof DrawManager !== 'undefined' && DrawManager.getLayerMeasurementText ? DrawManager.getLayerMeasurementText(layer) : '';
        const isSelected = window.SelectionManager ? SelectionManager.selectedIds.has(props.id) : (typeof DrawManager !== 'undefined' && DrawManager.selectedLayer === layer);
        const defaultName = typeof I18n !== 'undefined' ? I18n.t('table.feature_default_name', { id: globalIndex + 1 }) : `圖元 #${globalIndex + 1}`;
        const leafletId = layer._leaflet_id || idx;

        const tr = document.createElement('tr');
        if (isSelected) tr.classList.add('selected');
        tr.dataset.featureId = String(props.id || '');
        tr.dataset.layerId = String(leafletId);
        tr.dataset.rowIndex = String(idx);

        tr.addEventListener('click', (e) => {
          this.onRowClick(e, leafletId, props.id, idx);
        });
        tr.addEventListener('dblclick', (e) => {
          this.onRowDblClick(e, leafletId);
        });

        // Actions TD
        const tdActions = document.createElement('td');
        tdActions.style.textAlign = 'center';

        const btnLocate = document.createElement('button');
        btnLocate.type = 'button';
        btnLocate.className = 'table-action-btn';
        btnLocate.title = locateTitle;
        btnLocate.setAttribute('aria-label', locateTitle);
        btnLocate.innerHTML = '<i data-lucide="crosshair"></i>';
        btnLocate.addEventListener('click', (e) => {
          e.stopPropagation();
          this.zoomToLayer(leafletId);
        });

        const btnDelete = document.createElement('button');
        btnDelete.type = 'button';
        btnDelete.className = 'table-action-btn';
        btnDelete.title = deleteTitle;
        btnDelete.setAttribute('aria-label', deleteTitle);
        btnDelete.innerHTML = '<i data-lucide="trash-2" style="color: #ef4444;"></i>';
        btnDelete.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteLayer(leafletId);
        });

        tdActions.append(btnLocate, btnDelete);
        tr.appendChild(tdActions);

        // Index TD
        const tdIndex = document.createElement('td');
        tdIndex.style.cssText = 'text-align: center; color: #64748b;';
        tdIndex.textContent = String(globalIndex + 1);
        tr.appendChild(tdIndex);

        // Columns TDs
        columns.forEach(col => {
          const td = document.createElement('td');
          if (col === 'geom_type') {
            const span = document.createElement('span');
            span.className = 'dropdown-tag';
            span.textContent = geomType || (typeof I18n !== 'undefined' ? I18n.t('common.unknown', '未知') : '未知');
            td.appendChild(span);
          } else if (col === 'measure') {
            if (measureText) {
              const span = document.createElement('span');
              span.style.cssText = 'color: #0284c7; font-weight: 500;';
              span.textContent = measureText;
              td.appendChild(span);
            } else {
              const span = document.createElement('span');
              span.className = 'attr-null-dash';
              span.textContent = '—';
              td.appendChild(span);
            }
          } else if (col === 'name') {
            const rawName = props.name;
            if (rawName) {
              const span = document.createElement('span');
              span.style.fontWeight = '600';
              span.textContent = rawName;
              td.appendChild(span);
            } else {
              const span = document.createElement('span');
              span.style.cssText = 'color: #94a3b8; font-style: italic;';
              span.textContent = defaultName;
              td.appendChild(span);
            }
          } else if (col === 'description') {
            this.renderCellContent(td, props.description);
          } else {
            this.renderCellContent(td, props[col]);
          }

          if (col !== 'geom_type' && col !== 'measure') {
            td.title = editTitle;
            td.style.cursor = 'pointer';
            td.dataset.field = col;
            td.addEventListener('click', (e) => {
              e.stopPropagation();
              this.editCell(leafletId, col, td);
            });
          }
          tr.appendChild(td);
        });

        frag.appendChild(tr);
      });

      this.tableBody.appendChild(frag);
      if (typeof lucide !== 'undefined') {
        lucide.createIcons({ root: this.tableBody });
      }
    }

    if (typeof lucide !== 'undefined') {
      lucide.createIcons({ root: this.drawer });
    }
  },

  formatCellValue(val) {
    if (val === null || val === undefined || val === '') {
      return '<span class="attr-null-dash">—</span>';
    }
    return String(val);
  },

  renderCellContent(td, val) {
    if (val === null || val === undefined || val === '') {
      const span = document.createElement('span');
      span.className = 'attr-null-dash';
      span.textContent = '—';
      td.appendChild(span);
    } else {
      td.textContent = String(val);
    }
  },

  bindResizers(activeLayerId) {
    if (!this.tableHeader) return;
    const resizers = this.tableHeader.querySelectorAll('.th-resizer');
    resizers.forEach(resizer => {
      const col = resizer.dataset.col;
      const th = resizer.parentElement;
      if (!th || !col) return;

      resizer.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const startX = e.pageX;
        const startWidth = th.offsetWidth;

        const onMouseMove = (moveEvent) => {
          const newWidth = Math.max(45, startWidth + (moveEvent.pageX - startX));
          th.style.width = `${newWidth}px`;
          th.style.minWidth = `${newWidth}px`;
        };

        const onMouseUp = (upEvent) => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          const finalWidth = Math.max(45, startWidth + (upEvent.pageX - startX));
          const prefs = this.getPrefs(activeLayerId);
          if (!prefs.colWidths) prefs.colWidths = {};
          prefs.colWidths[col] = finalWidth;
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    });
  },

  sortColumn(col) {
    const activeLayer = this.getActiveLayer();
    if (!activeLayer) return;
    const prefs = this.getPrefs(activeLayer.id);
    if (prefs.sortCol !== col) {
      prefs.sortCol = col;
      prefs.sortDir = 'asc';
    } else if (prefs.sortDir === 'asc') {
      prefs.sortDir = 'desc';
    } else {
      prefs.sortCol = null;
      prefs.sortDir = 'none';
    }
    this.render();
  },

  onRowClick(e, layerLeafletId, featureId, rowIndex) {
    if (e.target.closest('button') || e.target.classList.contains('th-resizer')) return;
    if (e.target.dataset.field) return;

    const layer = typeof DrawManager !== 'undefined' && DrawManager.getLayerById ? DrawManager.getLayerById(layerLeafletId) : null;
    if (!layer || !window.SelectionManager) return;

    if (e.shiftKey && this.lastClickedIndex !== null) {
      const start = Math.min(this.lastClickedIndex, rowIndex);
      const end = Math.max(this.lastClickedIndex, rowIndex);
      if (!e.ctrlKey && !e.metaKey) {
        SelectionManager.selectedIds.clear();
      }
      for (let i = start; i <= end; i++) {
        const item = this.pagedFeatures[i];
        if (item?.featureProps?.id) {
          SelectionManager.selectedIds.add(item.featureProps.id);
        }
      }
      SelectionManager.render();
    } else if (e.ctrlKey || e.metaKey) {
      SelectionManager.toggleSelection(layer, e);
      this.lastClickedIndex = rowIndex;
    } else {
      SelectionManager.selectedIds.clear();
      SelectionManager.selectedIds.add(featureId);
      this.lastClickedIndex = rowIndex;
      SelectionManager.render();
    }
  },

  onRowDblClick(e, layerLeafletId) {
    if (e.target.closest('button')) return;
    this.zoomToLayer(layerLeafletId);
  },

  zoomToLayer(layerId) {
    const layer = typeof DrawManager !== 'undefined' && DrawManager.getLayerById ? DrawManager.getLayerById(layerId) : null;
    if (!layer) return;

    const map = window.App?.map || window.map;
    if (map) {
      if (layer.getBounds) {
        map.fitBounds(layer.getBounds(), { padding: [50, 50], maxZoom: 17 });
      } else if (layer.getLatLng) {
        map.setView(layer.getLatLng(), Math.max(map.getZoom ? map.getZoom() : 16, 16));
      }
    }

    if (window.SelectionManager) {
      SelectionManager.selectedIds.clear();
      SelectionManager.toggleSelection(layer);
    }
    this.highlightSelectedRows();
  },

  async deleteLayer(layerId) {
    const layer = typeof DrawManager !== 'undefined' && DrawManager.getLayerById ? DrawManager.getLayerById(layerId) : null;
    if (!layer) return;
    if (typeof DrawManager !== 'undefined' && DrawManager.isLayerLocked && DrawManager.isLayerLocked(layer)) {
      App?.showToast(typeof I18n !== 'undefined' ? I18n.t('layers.locked_delete_feature_error') : '圖層已鎖定，無法刪除圖元', 'error');
      return;
    }
    const confirmMsg = typeof I18n !== 'undefined'
      ? I18n.t('table.delete_feature_confirm', '確定要刪除此圖元嗎？刪除後可使用復原救回。')
      : '確定要刪除此圖元嗎？刪除後可使用復原救回。';
    const confirmed = App?.confirm ? await App.confirm(confirmMsg, { isDanger: true }) : true;
    if (confirmed) {
      if (typeof DrawManager !== 'undefined' && DrawManager.removeLayer) {
        DrawManager.removeLayer(layer);
      }
      this.render();
      App?.showToast(typeof I18n !== 'undefined' ? I18n.t('table.feature_deleted') : '已刪除圖元', 'info');
    }
  },

  async editCell(layerId, key, cellEl) {
    const layer = typeof DrawManager !== 'undefined' && DrawManager.getLayerById ? DrawManager.getLayerById(layerId) : null;
    if (!layer) return;
    if (typeof DrawManager !== 'undefined' && DrawManager.isLayerLocked && DrawManager.isLayerLocked(layer)) {
      App?.showToast(typeof I18n !== 'undefined' ? I18n.t('layers.locked_edit_error') : '圖層已鎖定，無法編輯屬性', 'error');
      return;
    }
    if (!layer.featureProps) layer.featureProps = {};

    const currentVal = layer.featureProps[key] !== undefined ? layer.featureProps[key] : '';
    const title = typeof I18n !== 'undefined' ? I18n.t('table.edit_cell_title', '編輯屬性數值') : '編輯屬性數值';
    const label = typeof I18n !== 'undefined' ? I18n.t('table.edit_cell_label', { col: key }) : `請輸入欄位【${key}】的新數值:`;

    let newVal;
    if (App?.promptInput) {
      newVal = await App.promptInput(title, label, currentVal);
    }

    if (newVal === null || newVal === undefined) return;
    if (newVal !== currentVal) {
      layer.featureProps[key] = newVal;
      if (typeof DrawManager !== 'undefined' && DrawManager.updateLayerPopup) {
        DrawManager.updateLayerPopup(layer);
      }
      this.render();
      App?.showToast(typeof I18n !== 'undefined' ? I18n.t('table.cell_updated', { key }) : `已更新「${key}」屬性`, 'success');
      SafetyManager?.recordChange(`更新屬性 ${key}`);
    }
  },

  async addNewColumn() {
    const activeLayer = this.getActiveLayer();
    const title = typeof I18n !== 'undefined' ? I18n.t('table.add_col_title', '新增屬性欄位') : '新增屬性欄位';
    const label = typeof I18n !== 'undefined' ? I18n.t('table.add_col_label', '請輸入自訂欄位名稱:') : '請輸入自訂欄位名稱:';
    let colName;
    if (App?.promptInput) {
      colName = await App.promptInput(title, label, '', {
        validate: (val) => {
          if (!val || !val.trim()) {
            return typeof I18n !== 'undefined' ? I18n.t('common.required', '此欄位為必填') : '此欄位為必填';
          }
          return null;
        }
      });
    }
    if (!colName || !colName.trim()) return;

    const cleanName = colName.trim();
    const layers = activeLayer?.featureGroup && typeof activeLayer.featureGroup.getLayers === 'function'
      ? activeLayer.featureGroup.getLayers()
      : (typeof DrawManager !== 'undefined' ? DrawManager.getAllLayers() : []);
    if (layers.length === 0) {
      App?.showToast(typeof I18n !== 'undefined' ? I18n.t('table.no_features_to_add_col') : '目前圖層尚無圖元可新增屬性！', 'warning');
      return;
    }

    let changed = 0;
    layers.forEach(layer => {
      if (typeof DrawManager !== 'undefined' && DrawManager.isLayerLocked && DrawManager.isLayerLocked(layer)) return;
      if (!layer.featureProps) layer.featureProps = {};
      if (layer.featureProps[cleanName] === undefined) {
        layer.featureProps[cleanName] = '';
        changed++;
      }
    });

    this.render();
    App?.showToast(typeof I18n !== 'undefined' ? I18n.t('table.column_added', { count: changed, name: cleanName }) : `已在 ${changed} 個圖元新增欄位「${cleanName}」`, 'success');
    if (changed) SafetyManager?.recordChange(`新增欄位 ${cleanName}`);
  },

  clearAllFilters() {
    this.searchTerm = '';
    if (this.searchInput) this.searchInput.value = '';
    if (this.clearSearchBtn) this.clearSearchBtn.style.display = 'none';
    if (this.selectedOnlyCheckbox) {
      this.selectedOnlyCheckbox.checked = false;
      this.selectedOnly = false;
    }
    this.query = null;
    ['query-field-a', 'query-field-b', 'query-value-a', 'query-value-b'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    this.currentPage = 1;
    this.render();
  },

  selectFiltered() {
    if (!window.SelectionManager) return;
    const targets = this.filteredFeatures || [];
    let added = 0;
    targets.forEach(layer => {
      const id = layer?.featureProps?.id;
      if (id) {
        SelectionManager.selectedIds.add(id);
        added++;
      }
    });
    SelectionManager.render();
    this.highlightSelectedRows();
    if (added > 0) {
      App?.showToast(typeof I18n !== 'undefined' ? I18n.t('table.selected_filtered_toast', { count: added }) : `已選取 ${added} 個符合條件的圖元`, 'success');
    } else {
      App?.showToast(typeof I18n !== 'undefined' ? I18n.t('table.no_matching_features') : '沒有符合條件的圖元', 'info');
    }
  },

  highlightSelectedRows() {
    if (!window.SelectionManager || !this.tableBody) return;
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

  refreshQueryFields(columns) {
    ['query-field-a', 'query-field-b'].forEach(id => {
      const select = document.getElementById(id);
      if (!select) return;
      const current = select.value;
      const placeholder = id.endsWith('-b')
        ? (typeof I18n !== 'undefined' && I18n.t ? I18n.t('table.field_b', '欄位 B（選填）') : '欄位 B（選填）')
        : (typeof I18n !== 'undefined' && I18n.t ? I18n.t('table.field_a', '欄位 A') : '欄位 A');
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
      App?.showToast('請先選擇欄位 A', 'warning');
      return;
    }
    this.query = { a, b, join: document.getElementById('query-join')?.value || 'and' };
    this.currentPage = 1;
    this.render();
  },

  clearQuery() {
    this.query = null;
    ['query-field-a', 'query-field-b', 'query-value-a', 'query-value-b'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.value = '';
    });
    this.currentPage = 1;
    this.render();
  }
};

if (typeof window !== 'undefined') window.TableManager = TableManager;
if (typeof global !== 'undefined') global.TableManager = TableManager;

