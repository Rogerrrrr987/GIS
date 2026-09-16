/**
 * GeoCanvas GIS Tool - Layer Manager (ArcGIS style tree)
 */

window.LayerManager = {
  panel: null,
  treeContainer: null,
  layers: [], // Array of layer objects
  groups: [], // Array of group objects
  activeLayerId: null,
  contextMenu: null,
  contextLayerId: null,
  draggedNodeId: null, // For drag & drop reordering

  escapeHTML(value) {
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
  },

  escapeHtml(value) {
    return this.escapeHTML(value);
  },

  createContextMenuItem(icon, label, onClick, isDanger = false) {
    const item = document.createElement('div');
    item.className = `context-menu-item${isDanger ? ' danger' : ''}`;
    const i = document.createElement('i');
    i.setAttribute('data-lucide', icon);
    i.style.cssText = 'width: 14px; height: 14px;';
    const span = document.createElement('span');
    span.textContent = ' ' + label;
    item.append(i, span);
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideContextMenu();
      onClick();
    });
    return item;
  },

  init() {
    this.panel = document.getElementById('layer-panel');
    this.treeContainer = document.getElementById('layer-tree-container');

    document.getElementById('btn-toggle-layers')?.addEventListener('click', () => this.togglePanel());
    document.getElementById('btn-close-layers')?.addEventListener('click', () => this.hidePanel());
    document.getElementById('btn-add-layer')?.addEventListener('click', () => this.promptCreateLayer());
    document.getElementById('btn-add-group')?.addEventListener('click', () => this.promptCreateGroup());
    document.getElementById('layer-search-input')?.addEventListener('input', (e) => this.render(e.target.value));
    document.getElementById('btn-cancel-layer-editor')?.addEventListener('click', () => this.closeEditor());
    document.getElementById('btn-save-layer-editor')?.addEventListener('click', () => this.submitEditor());
    document.getElementById('btn-close-layer-editor')?.addEventListener('click', () => this.closeEditor());

    this.createContextMenu();

    // Close context menu on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu') && !e.target.closest('.btn-layer-more')) {
        this.hideContextMenu();
      }
    });
  },

  createContextMenu() {
    this.contextMenu = document.createElement('div');
    this.contextMenu.className = 'context-menu';
    document.body.appendChild(this.contextMenu);
  },

  showContextMenu(e, layerId) {
    e.preventDefault();
    e.stopPropagation();
    this.contextLayerId = layerId;
    const layer = this.getLayer(layerId);
    if (!layer) return;

    this.contextMenu.replaceChildren();

    this.contextMenu.appendChild(this.createContextMenuItem('maximize', typeof I18n !== 'undefined' ? I18n.t('layers.zoom_to_layer', '縮放至圖層') : '縮放至圖層', () => this.zoomToLayer(layerId)));
    this.contextMenu.appendChild(this.createContextMenuItem('edit-2', typeof I18n !== 'undefined' ? I18n.t('layers.rename_layer', '重新命名') : '重新命名', () => this.startInlineRenameLayer(layerId)));
    const opLabel = typeof I18n !== 'undefined' ? I18n.t('layers.opacity', '透明度') : '透明度';
    this.contextMenu.appendChild(this.createContextMenuItem('blend', `${opLabel} (${Math.round(layer.opacity * 100)}%)`, () => this.promptOpacity(layerId)));
    this.contextMenu.appendChild(this.createContextMenuItem('copy', typeof I18n !== 'undefined' ? I18n.t('layers.duplicate_layer', '複製圖層') : '複製圖層', () => this.duplicateLayer(layerId)));

    const selectedFeatures = typeof SelectionManager !== 'undefined' ? SelectionManager.getSelectedFeatures() : [];
    const hasSelection = selectedFeatures.length > 0;
    const saveSelectedText = hasSelection
      ? (typeof I18n !== 'undefined' ? I18n.t('layers.save_selected_count', { count: selectedFeatures.length }) : `另存選取圖元 (${selectedFeatures.length} 筆)`)
      : (typeof I18n !== 'undefined' ? I18n.t('layers.save_selected_new', '另存選取圖元為新圖層') : '另存選取圖元為新圖層');
    const saveSelectedItem = this.createContextMenuItem('file-plus', saveSelectedText, () => {
      if (!hasSelection) {
        App?.showToast('目前未選取任何圖元', 'warning');
        return;
      }
      if (typeof GeoprocessingManager !== 'undefined') {
        GeoprocessingManager.promptSaveSelected();
      }
    });
    if (!hasSelection) {
      saveSelectedItem.style.opacity = '0.45';
      saveSelectedItem.style.cursor = 'not-allowed';
      saveSelectedItem.title = typeof I18n !== 'undefined' ? I18n.t('layers.no_selection_hint', '未選取任何圖元') : '未選取任何圖元';
    }
    this.contextMenu.appendChild(saveSelectedItem);

    if (this.groups.length) {
      const divider = document.createElement('div');
      divider.className = 'context-menu-divider';
      const heading = document.createElement('div');
      heading.style.cssText = 'padding:4px 10px;color:#64748b;font-size:.72rem';
      heading.textContent = typeof I18n !== 'undefined' ? I18n.t('layers.move_to_group', '移至群組') : '移至群組';
      this.contextMenu.append(divider, heading);

      this.groups.forEach(group => {
        this.contextMenu.appendChild(this.createContextMenuItem('folder-input', group.name, () => this.assignLayerToGroup(layerId, group.id)));
      });

      if (layer.groupId) {
        this.contextMenu.appendChild(this.createContextMenuItem('folder-x', typeof I18n !== 'undefined' ? I18n.t('layers.remove_from_group', '移出群組') : '移出群組', () => this.assignLayerToGroup(layerId, null)));
      }
    }

    const dividerEnd = document.createElement('div');
    dividerEnd.className = 'context-menu-divider';
    const deleteLabel = typeof I18n !== 'undefined' ? I18n.t('layers.delete_layer', '刪除圖層') : '刪除圖層';
    const deleteItem = this.createContextMenuItem('trash-2', deleteLabel, () => this.deleteLayer(layerId), true);
    this.contextMenu.append(dividerEnd, deleteItem);

    if (typeof lucide !== 'undefined') lucide.createIcons({ root: this.contextMenu });

    // Position menu
    let x = e.clientX;
    let y = e.clientY;
    
    this.contextMenu.classList.add('active');
    
    // Adjust if goes out of screen
    const rect = this.contextMenu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 5;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 5;
    
    this.contextMenu.style.left = `${x}px`;
    this.contextMenu.style.top = `${y}px`;
  },

  hideContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.classList.remove('active');
    }
  },

  // --- Core State Management ---

  generateId() {
    return 'layer_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  },

  generateGroupId() {
    return 'group_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  },

  createLayer(name, geometryType = 'any', groupId = null) {
    const safeGeometryType = ['any', 'Point', 'Line', 'Polygon'].includes(geometryType) ? geometryType : 'any';
    const safeGroupId = groupId && this.groups.some(group => group.id === groupId) ? groupId : null;
    const newLayer = {
      id: this.generateId(),
      name: String(name || '未命名圖層'),
      geometryType: safeGeometryType,
      visible: true,
      locked: false,
      opacity: 1.0,
      source: 'manual',
      groupId: safeGroupId,
      featureGroup: L.featureGroup()
    };
    
    // Add to map by default
    newLayer.featureGroup.addTo(App.map);
    
    this.layers.unshift(newLayer); // Add to top
    if (!this.activeLayerId) this.activeLayerId = newLayer.id;
    
    this.render();
    SafetyManager?.recordChange(`新增圖層: ${newLayer.name}`);
    return newLayer;
  },

  getLayer(id) {
    return this.layers.find(l => l.id === id);
  },

  getActiveLayer() {
    let layer = this.getLayer(this.activeLayerId);
    if (!layer && this.layers.length > 0) {
      layer = this.layers[0];
      this.activeLayerId = layer.id;
    }
    return layer;
  },

  setActiveLayer(id) {
    if (this.getLayer(id)) {
      this.activeLayerId = id;
      this.render();
    }
  },

  deleteLayer(id) {
    const layer = this.getLayer(id);
    if (!layer) return;
    
    if (layer.locked) {
      App.showToast('圖層已鎖定，無法刪除', 'error');
      return;
    }

    if (!confirm(`確定要刪除圖層「${layer.name}」及其所有圖元嗎？`)) return;

    // Remove from map
    if (App.map.hasLayer(layer.featureGroup)) {
      App.map.removeLayer(layer.featureGroup);
    }
    
    this.layers = this.layers.filter(l => l.id !== id);
    if (this.activeLayerId === id) this.activeLayerId = null;
    
    this.hideContextMenu();
    this.render();
    App.updateStats();
    TableManager?.render();
    SafetyManager?.recordChange(`刪除圖層: ${layer.name}`);
  },

  toggleVisibility(id) {
    const layer = this.getLayer(id);
    if (!layer) return;
    
    layer.visible = !layer.visible;
    if (layer.visible) {
      if (!App.map.hasLayer(layer.featureGroup)) App.map.addLayer(layer.featureGroup);
    } else {
      if (App.map.hasLayer(layer.featureGroup)) App.map.removeLayer(layer.featureGroup);
    }
    
    this.render();
    SafetyManager?.recordChange(`${layer.visible ? '顯示' : '隱藏'}圖層: ${layer.name}`);
  },

  toggleLock(id) {
    const layer = this.getLayer(id);
    if (!layer) return;
    layer.locked = !layer.locked;
    
    layer.featureGroup.eachLayer(feature => DrawManager.syncFeatureLock(feature, layer.locked));
    
    this.render();
    SafetyManager?.recordChange(`${layer.locked ? '鎖定' : '解除鎖定'}圖層: ${layer.name}`);
  },

  startInlineRenameLayer(id) {
    this.hideContextMenu();
    const layer = this.getLayer(id);
    if (!layer || !this.treeContainer) return;

    const row = Array.from(this.treeContainer.querySelectorAll('.layer-row'))
      .find(candidate => candidate.dataset.layerId === id);
    const label = row?.querySelector('.layer-row-label');
    if (!row || !label) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-inline-name-input';
    input.value = layer.name || '';
    input.maxLength = 120;
    input.setAttribute('aria-label', typeof I18n !== 'undefined' ? I18n.t('layers.layer_name', '圖層名稱') : '圖層名稱');

    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const clean = input.value.trim();
      const changed = save && clean && clean !== layer.name;
      if (changed) {
        const oldName = layer.name;
        layer.name = clean;
        SafetyManager?.recordChange(`重新命名圖層：${oldName} → ${clean}`);
      }
      this.render();
    };

    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true), { once: true });

    label.replaceWith(input);
    input.focus();
    input.select();
  },

  promptOpacity(id) {
    this.hideContextMenu();
    const layer = this.getLayer(id);
    if (!layer) return;
    const opacityStr = prompt('請輸入透明度 (0 - 100):', Math.round(layer.opacity * 100));
    const opacity = parseInt(opacityStr, 10);
    if (!isNaN(opacity) && opacity >= 0 && opacity <= 100) {
      layer.opacity = opacity / 100;
      
      this.applyLayerOpacity(layer);
      
      this.render();
      SafetyManager?.recordChange(`調整圖層透明度: ${layer.name}`);
    }
  },

  zoomToLayer(id) {
    this.hideContextMenu();
    const layer = this.getLayer(id);
    if (!layer || layer.featureGroup.getLayers().length === 0) {
      App.showToast('圖層尚無圖元可定位', 'info');
      return;
    }
    if (!layer.visible) this.toggleVisibility(id);
    const bounds = layer.featureGroup.getBounds();
    if (bounds.isValid()) {
      App.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  },

  promptCreateLayer() {
    this.openEditor('layer');
  },

  promptCreateGroup() {
    this.openEditor('group');
  },

  openEditor(mode) {
    const modal = document.getElementById('layer-editor-modal');
    if (!modal) return;
    modal.dataset.mode = mode;
    document.getElementById('layer-editor-title').textContent = mode === 'group'
      ? (typeof I18n !== 'undefined' ? I18n.t('layers.add_group_title', '新增圖層群組') : '新增圖層群組')
      : (typeof I18n !== 'undefined' ? I18n.t('layers.add_layer_title', '新增圖層') : '新增圖層');
    document.getElementById('layer-editor-name').value = mode === 'group'
      ? (typeof I18n !== 'undefined' ? I18n.t('layers.new_group_default', '新增群組') : '新增群組')
      : (typeof I18n !== 'undefined' ? I18n.t('layers.new_layer_default', '新增圖層') : '新增圖層');
    document.getElementById('layer-editor-options').hidden = mode === 'group';
    const groupSelect = document.getElementById('layer-editor-group');
    // Category A: Static dropdown default option template
    groupSelect.innerHTML = '<option value="">不加入群組</option>';
    this.groups.forEach(group => groupSelect.add(new Option(group.name, group.id)));
    modal.classList.add('active');
    setTimeout(() => document.getElementById('layer-editor-name')?.focus(), 0);
  },

  closeEditor() {
    document.getElementById('layer-editor-modal')?.classList.remove('active');
  },

  submitEditor() {
    const modal = document.getElementById('layer-editor-modal');
    const name = document.getElementById('layer-editor-name')?.value.trim();
    if (!name) {
      App.showToast('請輸入名稱', 'warning');
      return;
    }
    if (modal.dataset.mode === 'group') {
      this.createGroup(name);
    } else {
      const geometryType = document.getElementById('layer-editor-geometry')?.value || 'any';
      const groupId = document.getElementById('layer-editor-group')?.value || null;
      const layer = this.createLayer(name, geometryType, groupId);
      this.setActiveLayer(layer.id);
    }
    this.closeEditor();
  },

  createGroup(name, id = null) {
    const group = { id: id || this.generateGroupId(), name: String(name), collapsed: false };
    this.groups.push(group);
    this.render();
    SafetyManager?.recordChange(`新增圖層群組: ${group.name}`);
    return group;
  },

  toggleGroup(id) {
    const group = this.groups.find(item => item.id === id);
    if (!group) return;
    group.collapsed = !group.collapsed;
    this.render(document.getElementById('layer-search-input')?.value || '');
  },

  deleteGroup(id) {
    const group = this.groups.find(item => item.id === id);
    if (!group) return;
    if (!confirm(`確定移除群組「${group.name}」嗎？圖層會保留。`)) return;
    this.layers.forEach(layer => { if (layer.groupId === id) layer.groupId = null; });
    this.groups = this.groups.filter(item => item.id !== id);
    this.render();
    SafetyManager?.recordChange(`移除圖層群組: ${group.name}`);
  },

  assignLayerToGroup(layerId, groupId) {
    this.hideContextMenu();
    const layer = this.getLayer(layerId);
    if (!layer || (groupId && !this.groups.some(group => group.id === groupId))) return;
    layer.groupId = groupId || null;
    this.render();
    SafetyManager?.recordChange(`${groupId ? '移動' : '移出'}圖層群組: ${layer.name}`);
  },

  duplicateLayer(id) {
    this.hideContextMenu();
    const source = this.getLayer(id);
    if (!source) return;
    const copy = this.createLayer(`${source.name} - 複本`, source.geometryType, source.groupId);
    copy.opacity = source.opacity;
    copy.source = 'duplicate';
    source.featureGroup.eachLayer(feature => {
      if (feature instanceof L.Circle) {
        const clone = L.circle(feature.getLatLng(), {
          radius: feature.getRadius(),
          ...feature.options
        });
        clone.featureProps = JSON.parse(JSON.stringify(feature.featureProps || {}));
        delete clone.featureProps.id;
        DrawManager.ensureFeatureIdentity(clone);
        clone.gisLayerId = copy.id;
        DrawManager.setupLayerInteractions(clone);
        copy.featureGroup.addLayer(clone);
        return;
      }
      const record = feature.toGeoJSON?.();
      if (!record) return;
      record.properties = JSON.parse(JSON.stringify(feature.featureProps || {}));
      delete record.properties.id;
      const previous = this.activeLayerId;
      this.activeLayerId = copy.id;
      DrawManager.loadFeatureCollection({ type: 'FeatureCollection', features: [record] }, false);
      this.activeLayerId = previous;
    });
    this.activeLayerId = copy.id;
    this.applyLayerOpacity(copy);
    this.render();
    App.updateStats();
    TableManager.render();
    SafetyManager?.recordChange(`複製圖層: ${source.name}`);
  },

  applyLayerOpacity(layer) {
    if (!layer) return;
    layer.featureGroup.eachLayer(feature => {
      if (feature.setOpacity && !feature.setStyle) {
        feature.setOpacity(layer.opacity);
        return;
      }
      if (!feature.setStyle) return;
      const style = feature.featureProps?.style || {};
      feature.setStyle({
        opacity: (style.opacity ?? 0.9) * layer.opacity,
        fillOpacity: (style.fillOpacity ?? 0.35) * layer.opacity
      });
    });
  },

  // --- Rendering ---

  escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag])
    );
  },

  togglePanel() {
    this.panel?.classList.toggle('is-hidden');
  },
  hidePanel() {
    this.panel?.classList.add('is-hidden');
  },

  render(filterText = '') {
    if (!this.treeContainer) return;
    // Category A: Clear container before render
    this.treeContainer.innerHTML = '';
    
    if (this.layers.length === 0 && this.groups.length === 0) {
      const emptyText = typeof I18n !== 'undefined' ? I18n.t('layers.no_layers', '尚無圖層') : '尚無圖層';
      this.treeContainer.innerHTML = `<div style="padding: 16px; color: #64748b; text-align: center; font-size: 0.85rem;">${emptyText}</div>`;
      return;
    }

    const ft = filterText.toLowerCase();

    const appendLayer = (layer, index, grouped = false) => {
      if (ft && !layer.name.toLowerCase().includes(ft)) return;

      const node = document.createElement('div');
      node.className = 'layer-tree-node';
      
      const count = layer.featureGroup.getLayers().length;
      const isVisible = layer.visible;
      const isLocked = layer.locked;
      const isActive = layer.id === this.activeLayerId;
      
      let geometryIcon = 'hexagon';
      if (layer.geometryType === 'Point') geometryIcon = 'map-pin';
      if (layer.geometryType === 'Line') geometryIcon = 'minus';
      if (layer.geometryType === 'Polygon') geometryIcon = 'square';

      const row = document.createElement('div');
      row.className = `layer-row ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''}`;
      row.dataset.layerId = layer.id;
      if (grouped) row.style.paddingLeft = '22px';
      row.draggable = true; // For reordering
      
      // Click to set active
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return; // Ignore button clicks
        this.setActiveLayer(layer.id);
      });

      // HTML Structure via Safe DOM APIs (No string concatenation into onclick or innerHTML)
      const visBtn = document.createElement('button');
      visBtn.className = 'icon-button';
      visBtn.style.padding = '2px';
      visBtn.title = isVisible ? '隱藏' : '顯示';
      visBtn.innerHTML = `<i data-lucide="${isVisible ? 'eye' : 'eye-off'}" style="width: 14px; height: 14px; color: ${isVisible ? '#334155' : '#94a3b8'};"></i>`;
      visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleVisibility(layer.id);
      });

      const iconDiv = document.createElement('div');
      iconDiv.className = 'layer-row-icon';
      iconDiv.title = `幾何類型: ${layer.geometryType}`;
      iconDiv.innerHTML = `<i data-lucide="${geometryIcon}" style="width: 12px; height: 12px; color: #64748b;"></i>`;

      const labelDiv = document.createElement('div');
      labelDiv.className = 'layer-row-label';
      labelDiv.title = layer.name || '';
      labelDiv.textContent = layer.name || '';
      const countSpan = document.createElement('span');
      countSpan.className = 'layer-row-count';
      countSpan.textContent = ` (${count})`;
      labelDiv.appendChild(countSpan);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'layer-actions';

      const lockBtn = document.createElement('button');
      lockBtn.className = 'icon-button';
      lockBtn.style.padding = '2px';
      lockBtn.title = isLocked ? '解除鎖定' : '鎖定';
      lockBtn.innerHTML = `<i data-lucide="${isLocked ? 'lock' : 'unlock'}" style="width: 12px; height: 12px; color: ${isLocked ? '#dc2626' : '#94a3b8'};"></i>`;
      lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleLock(layer.id);
      });

      const moreBtn = document.createElement('button');
      moreBtn.className = 'icon-button btn-layer-more';
      moreBtn.style.padding = '2px';
      moreBtn.title = '更多選項';
      moreBtn.innerHTML = '<i data-lucide="more-vertical" style="width: 14px; height: 14px;"></i>';
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showContextMenu(e, layer.id);
      });

      actionsDiv.append(lockBtn, moreBtn);
      row.append(visBtn, iconDiv, labelDiv, actionsDiv);
      
      // Drag & Drop logic for reordering
      row.addEventListener('dragstart', (e) => {
        this.draggedNodeId = layer.id;
        e.dataTransfer.effectAllowed = 'move';
        row.style.opacity = '0.5';
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.style.borderTop = '2px solid #3b82f6';
      });
      row.addEventListener('dragleave', () => {
        row.style.borderTop = '';
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.style.borderTop = '';
        if (this.draggedNodeId && this.draggedNodeId !== layer.id) {
          this.reorderLayer(this.draggedNodeId, layer.id);
        }
      });
      row.addEventListener('dragend', () => {
        row.style.opacity = '1';
        this.draggedNodeId = null;
      });

      node.appendChild(row);
      this.treeContainer.appendChild(node);
    };

    this.groups.forEach(group => {
      const children = this.layers.filter(layer => layer.groupId === group.id);
      if (ft && !group.name.toLowerCase().includes(ft) && !children.some(layer => layer.name.toLowerCase().includes(ft))) return;
      const header = document.createElement('div');
      header.className = 'layer-group-row';
      header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 8px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;font-weight:700;font-size:.82rem;';

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'icon-button';
      toggleBtn.title = group.collapsed ? '展開' : '收合';
      toggleBtn.innerHTML = `<i data-lucide="${group.collapsed ? 'chevron-right' : 'chevron-down'}" style="width:13px;height:13px"></i>`;
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleGroup(group.id);
      });

      const folderIcon = document.createElement('i');
      folderIcon.setAttribute('data-lucide', 'folder');
      folderIcon.style.cssText = 'width:14px;height:14px;color:#64748b';

      const titleSpan = document.createElement('span');
      titleSpan.style.flex = '1';
      titleSpan.title = group.name || '';
      titleSpan.textContent = `${group.name || ''} (${children.length})`;

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-button';
      delBtn.title = '移除群組';
      delBtn.innerHTML = '<i data-lucide="x" style="width:13px;height:13px"></i>';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteGroup(group.id);
      });

      header.append(toggleBtn, folderIcon, titleSpan, delBtn);
      this.treeContainer.appendChild(header);
      if (!group.collapsed || ft) children.forEach(layer => appendLayer(layer, this.layers.indexOf(layer), true));
    });

    const ungrouped = this.layers.filter(layer => !layer.groupId || !this.groups.some(group => group.id === layer.groupId));
    if (this.groups.length && ungrouped.length) {
      const label = document.createElement('div');
      label.style.cssText = 'padding:5px 10px;color:#64748b;font-size:.72rem;font-weight:700;border-bottom:1px solid #e2e8f0';
      label.textContent = `未分組 (${ungrouped.length})`;
      this.treeContainer.appendChild(label);
    }
    ungrouped.forEach(layer => appendLayer(layer, this.layers.indexOf(layer), false));

    if (typeof lucide !== 'undefined') lucide.createIcons({ root: this.treeContainer });
  },

  reorderLayer(draggedId, targetId) {
    const draggedIdx = this.layers.findIndex(l => l.id === draggedId);
    const targetIdx = this.layers.findIndex(l => l.id === targetId);
    if (draggedIdx > -1 && targetIdx > -1) {
      const [draggedLayer] = this.layers.splice(draggedIdx, 1);
      // Insert at new position
      this.layers.splice(targetIdx, 0, draggedLayer);
      this.updateMapZIndex();
      this.render();
      SafetyManager?.recordChange(`調整圖層排序`);
    }
  },

  updateMapZIndex() {
    // Leaflet vector layers Z-index can be controlled by bringing to front/back.
    // Layers array is top-to-bottom in UI, so index 0 is on top.
    // We reverse iterate to bring to front so index 0 ends up on very top.
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      if (App.map.hasLayer(layer.featureGroup)) {
        layer.featureGroup.bringToFront();
      }
    }
  },
  
  clearAll() {
    this.layers.forEach(l => {
      if (App.map.hasLayer(l.featureGroup)) {
        App.map.removeLayer(l.featureGroup);
      }
    });
    this.layers = [];
    this.groups = [];
    this.activeLayerId = null;
    this.render();
  }
};
