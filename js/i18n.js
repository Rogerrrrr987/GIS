/**
 * GeoCanvas GIS Tool - Internationalization (i18n) Module
 *
 * Supports seamless in-place switching between Traditional Chinese (zh-TW) and English (en).
 * Handles DOM attribute auto-translation (data-i18n, data-i18n-title, data-i18n-placeholder, data-i18n-aria),
 * Leaflet-Geoman toolbar language switching, dynamic JS string translation via I18n.t(key, params),
 * and persists user preference in localStorage ('geocanvas_lang').
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.I18n = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'geocanvas_lang';

  const translations = {
    'zh-TW': {
      // General & Common
      'common.ok': '確定',
      'common.cancel': '取消',
      'common.close': '關閉',
      'common.save': '保存',
      'common.delete': '刪除',
      'common.create': '建立',
      'common.apply': '套用',
      'common.clear': '清除',
      'common.import': '匯入',
      'common.export': '匯出',
      'common.search': '搜尋',
      'common.filter': '過濾',
      'common.warning': '警告',
      'common.error': '錯誤',
      'common.info': '提示',
      'common.success': '成功',
      'common.loading': '載入中...',
      'common.meters': '公尺',
      'common.kilometers': '公里',
      'common.features_unit': '個圖元',
      'common.points_unit': '個點位',

      // App Header & Branding
      'app.title': 'GeoCanvas GIS',
      'app.subtitle': 'KML · SHP · CSV 向量繪圖',
      'header.project': '專案',
      'header.project_title': '專案保存、復原與操作紀錄',
      'header.save_project': '另存專案',
      'header.open_project': '開啟專案',
      'header.undo': '復原',
      'header.redo': '重做',
      'header.import_data': '匯入圖資',
      'header.import_data_title': '匯入 KML / SHP / CSV / GeoJSON',
      'header.export_data': '匯出圖資',
      'header.export_kml': 'KML 地球圖資',
      'header.export_shp': 'Shapefile 壓縮包',
      'header.export_csv': 'CSV (WKT + 經緯度)',
      'header.export_geojson': 'GeoJSON 標準資料',
      'header.layers': '圖層',
      'header.layers_title': '開啟/收合圖層面板',
      'header.catalog': '資料目錄',
      'header.catalog_title': '開啟/收合資料目錄',
      'header.tools': '工具',
      'header.tools_title': '分析與其他工具',
      'header.tool_table': '屬性資料表',
      'header.tool_classify': '數值分級',
      'header.tool_geoprocessing': '空間處理工具箱',
      'header.tool_tgos': 'TGOS 地址定位',
      'header.tool_routing': '路網分析',
      'header.tool_topology': '檢查圖層拓樸',
      'header.tool_clear_selection': '清除選取',
      'header.tool_clear_all': '清空所有圖元',
      'header.language': '語言',
      'header.language_title': '切換介面語言 / Switch Language',

      // Style & Selection Panel
      'style.title': '樣式與選取',
      'style.no_selection': '未選取圖元',
      'style.empty_hint': '選取地圖上的圖元後，可調整樣式或進行操作。',
      'style.select_all': '全選',
      'style.select_all_title': '全選所有圖元',
      'style.invert': '反轉',
      'style.invert_title': '反轉選取',
      'style.export_selected': '匯出選取',
      'style.export_format_title': '選取圖元匯出格式',
      'style.delete': '刪除',
      'style.select_by_location': '依位置選取',
      'style.snap': '吸附',
      'style.tolerance': '容差',
      'style.point_symbol': '點符號:',
      'style.point_symbol_title': '設定點位(Marker)的符號',
      'style.sym_default': '預設水滴',
      'style.sym_circle': '圓點',
      'style.sym_square': '方塊',
      'style.sym_star': '星星',
      'style.sym_flag': '旗幟',
      'style.stroke_color': '外框:',
      'style.stroke_color_title': '外框顏色',
      'style.fill_color': '填充:',
      'style.fill_color_title': '填充顏色',
      'style.stroke_width': '線寬:',
      'style.width_none': '無 (0 px)',
      'style.fill_opacity': '透明度:',

      // Layers Panel
      'layers.title': '圖層管理',
      'layers.close_title': '收合圖層面板',
      'layers.add_layer': '新增圖層',
      'layers.add_group': '新增群組',
      'layers.search_placeholder': '搜尋圖層...',
      'layers.rename': '重新命名',
      'layers.duplicate': '複製圖層',
      'layers.delete': '刪除圖層',
      'layers.zoom_to': '縮放至圖層',
      'layers.save_selected_as_new': '另存選取圖元為新圖層',
      'layers.visible_toggle': '切換顯示/隱藏',
      'layers.lock_toggle': '切換圖層鎖定',
      'layers.opacity_title': '圖層透明度',
      'layers.count_badge': '{count} 個圖元',

      // Data Catalog
      'catalog.title': '資料目錄',
      'catalog.close_title': '收合資料目錄',
      'catalog.select_files': '選擇電腦檔案',
      'catalog.recent_files': '最近呼叫',
      'catalog.privacy_note': '為保護隱私，請透過「選擇電腦檔案」授權要匯入的檔案。',
      'catalog.no_files': '尚無最近檔案記錄',

      // Basemap Selector
      'basemap.title': '底圖',
      'basemap.select_title': '選擇底圖',
      'basemap.nlsc_emap': '臺灣通用圖 (NLSC)',
      'basemap.nlsc_photo': '國土航照',
      'basemap.nlsc_mix': '航照混合',
      'basemap.osm': 'OSM街圖',
      'basemap.satellite': 'ESRI衛星',
      'basemap.topo': '地形圖',
      'basemap.cadastral': '疊加地籍圖',
      'basemap.cadastral_title': '疊加國土測繪中心地籍圖 (LAND_OPENDATA)',
      'basemap.custom_wmts': '自訂WMTS',
      'basemap.custom_wmts_title': '檢視與設定 WMTS 服務 URL',

      // Attribute Table Drawer
      'table.title': '圖層屬性資料表',
      'table.search_placeholder': '搜尋名稱、屬性...',
      'table.selected_only': '僅顯示選取',
      'table.select_filtered': '選取過濾結果',
      'table.add_column': '新增屬性欄位',
      'table.field_calculator': '欄位計算器',
      'table.field_calculator_title': '開啟欄位計算器',
      'table.update_geometry': '更新幾何欄位',
      'table.update_geometry_title': '批次建立或更新幾何屬性欄位',
      'table.save_selected': '另存選取圖元',
      'table.save_selected_title': '將目前選取圖元複製另存為新圖層',
      'table.close_drawer': '收合抽屜',
      'table.query_title': '屬性查詢',
      'table.field_a': '欄位 A',
      'table.field_b': '欄位 B（選填）',
      'table.value_a_placeholder': '值 A',
      'table.value_b_placeholder': '值 B',
      'table.contains': '包含',
      'table.equals': '等於',
      'table.not_equals': '不等於',
      'table.greater_than': '大於',
      'table.less_than': '小於',
      'table.apply': '套用',
      'table.clear': '清除',
      'table.col_name': '名稱',
      'table.col_geometry': '幾何類型',
      'table.col_length': '長度 (m)',
      'table.col_area': '面積 (m²)',
      'table.col_actions': '操作',
      'table.locate': '定位',
      'table.empty': '目前圖層無資料',

      // Status Bar
      'statusbar.coords': '經緯度: {lat}, {lng}',
      'statusbar.zoom': '縮放級別: {zoom}',
      'statusbar.feature_count': '圖元總數: {count}',
      'statusbar.saved': '已保存',
      'statusbar.unsaved': '有未保存修改',
      'statusbar.save_title': '點擊另存專案',
      'statusbar.crs': '坐標系統: WGS84 (EPSG:4326)',

      // Routing Panel
      'routing.title': '多點最佳路徑',
      'routing.close_title': '關閉路網分析',
      'routing.status_default': '在地圖上依序加入起點、停靠點與終點。',
      'routing.stops_section': '分析點位',
      'routing.fix_start_end': '將起終點移至首尾',
      'routing.reverse_order': '反轉順序',
      'routing.remove_duplicates': '移除重複點',
      'routing.clear_points': '清空點位',
      'routing.import_points': '匯入點位 (SHP / KML / KMZ / GeoJSON / CSV)',
      'routing.empty_stops': '尚未加入停靠點（點擊地圖或匯入檔案）',
      'routing.undo_point': '撤銷一點',
      'routing.validate_snapping': '道路吸附與可達性檢查',
      'routing.barriers_section': '圓形屏障 (本機避障)',
      'routing.default_radius': '預設半徑:',
      'routing.add_barrier': '新增屏障',
      'routing.empty_barriers': '尚未加入屏障。啟用「新增屏障」後點擊地圖加入。',
      'routing.barrier_note': '屏障採用 Turf 真實圓形多邊形幾何相交檢驗。若衝突可嘗試避障繞行。',
      'routing.attempt_detour': '嘗試屏障避障重新規劃',
      'routing.settings_section': '路網設定與交通模式',
      'routing.mode': '路徑模式',
      'routing.mode_open': '固定起終點（開放路徑）',
      'routing.mode_roundtrip': '環狀路徑（終點回到起點）',
      'routing.lock_start_end': '最佳化時鎖定起點與終點（僅重新排序中途點）',
      'routing.lock_start_end_label': '起終點約束',
      'routing.osrm_url': 'OSRM 服務網址',
      'routing.profile': '交通模式',
      'routing.profile_driving': '汽車（driving）',
      'routing.profile_cycling': '自行車（cycling）',
      'routing.profile_walking': '步行（walking）',
      'routing.fallback_policy': '失敗處理策略',
      'routing.fallback_stop': '停止並顯示錯誤（推薦）',
      'routing.fallback_preview': '顯示不可保存的直線預覽',
      'routing.apply_settings': '套用設定',
      'routing.test_service': '測試服務',
      'routing.clear_consent': '清除授權記錄',
      'routing.clear_consent_title': '清除此瀏覽器記住的外部 OSRM 服務授權記錄',
      'routing.service_untested': '尚未測試',
      'routing.service_ok': '服務正常',
      'routing.service_err': '連線失敗',
      'routing.osrm_hint': '公開示範服務通常僅提供汽車模式；自行車與步行需使用對應設定檔建立的 OSRM 服務。超過 90 點將採分段請求，若服務有限制將清晰提示。',
      'routing.results_section': '分析結果',
      'routing.result_badge': '已生成',
      'routing.empty_results': '尚未計算路徑。請於下方執行計算。',
      'routing.calc_current': '依目前順序計算',
      'routing.calc_current_title': '依目前清單排列順序計算路線',
      'routing.calc_optimize': '最佳化順序計算',
      'routing.calc_optimize_title': '以本機 2-Opt 最佳化停靠順序並計算路線',
      'routing.cancel': '取消',
      'routing.save_route': '保存路線至圖層',
      'routing.save_route_title': '保存路線至工作圖層',
      'routing.clear_all': '全部清除',
      'routing.clear_all_title': '清空所有點位、屏障與分析結果',
      'routing.privacy_footer': '未取得同意前絕不傳送座標；第一次請求前將跳出傳輸確認。',
      'routing.role_start': '起點',
      'routing.role_stop': '停靠點',
      'routing.role_end': '終點',

      // TGOS Locator Panel
      'tgos.title': 'TGOS 地址定位',
      'tgos.close_title': '關閉 TGOS 地址定位',
      'tgos.address_label': '臺灣地址',
      'tgos.address_placeholder': '例如：臺北市中山區松江路469巷4號',
      'tgos.locate_btn': '定位',
      'tgos.cred_summary': 'TGOS API 憑證設定',
      'tgos.app_id_placeholder': 'TGOS AppID',
      'tgos.api_key_placeholder': 'TGOS APIKey',
      'tgos.cred_note': 'AppID 會保存在此瀏覽器；APIKey 僅保留於目前分頁。TGOS 另會驗證申請時登記的 Domain/IP。',
      'tgos.clear_cred': '清除 TGOS 憑證',
      'tgos.status_init': '請先設定 TGOS 憑證，再輸入地址定位。',
      'tgos.add_layer': '加入工作圖層',
      'tgos.add_route': '加入路網停靠點',
      'tgos.privacy_note': '查詢時會將輸入地址、AppID 與 APIKey 傳送至 TGOS 官方服務。',

      // Geoprocessing Panel
      'gp.title': '空間處理工具箱',
      'gp.close_title': '關閉工具箱',
      'gp.tab_buffer': '緩衝區',
      'gp.tab_buffer_title': '緩衝區分析',
      'gp.tab_clip': '裁切',
      'gp.tab_clip_title': '裁切',
      'gp.tab_intersect': '相交',
      'gp.tab_intersect_title': '幾何相交',
      'gp.tab_merge': '合併',
      'gp.tab_merge_title': '合併多圖層',
      'gp.tab_dissolve': '融合',
      'gp.tab_dissolve_title': '圖元融合',
      'gp.tab_save_selected': '選取另存',
      'gp.tab_save_selected_title': '選取另存新圖層',
      'gp.input_layer': '輸入圖層：',
      'gp.buffer_dist': '緩衝距離：',
      'gp.unit': '單位：',
      'gp.unit_meters': '公尺 (m)',
      'gp.unit_kilometers': '公里 (km)',
      'gp.buffer_dissolve': '融合重疊結果 (Dissolve)',
      'gp.selected_only': '僅處理目前選取圖元',
      'gp.output_name': '輸出圖層名稱：',
      'gp.default_buffer_name': '緩衝區',
      'gp.clip_source': '來源圖層 (點/線/面)：',
      'gp.clip_mask': '裁切遮罩圖層 (僅限面圖層)：',
      'gp.clip_selected_only': '僅處理來源選取圖元',
      'gp.default_clip_name': '裁切結果',
      'gp.intersect_a': '圖層 A：',
      'gp.intersect_b': '圖層 B：',
      'gp.hint_intersect': '支援面與面、點與面、線與面。系統自動進行空間 BBox 預篩選，並將重名欄位加上 A_ 與 B_ 前綴。',
      'gp.default_intersect_name': '相交結果',
      'gp.merge_select_label': '勾選要合併的圖層 (需屬同一幾何家族)：',
      'gp.hint_merge': '屬性欄位自動取聯集，缺值自動填補 null。保留 source_layer 與 source_feature_id。',
      'gp.default_merge_name': '合併圖層',
      'gp.dissolve_input': '輸入面圖層 (Polygon)：',
      'gp.dissolve_field': '融合分組欄位：',
      'gp.dissolve_all': '(全部融合，不分組)',
      'gp.hint_dissolve': '依指定屬性融合相鄰或分離之多邊形。支援異常圖元安全隔離與錯誤摘要回報。',
      'gp.default_dissolve_name': '融合結果',
      'gp.save_selected_info': '目前已選取：',
      'gp.save_selected_count': '{count} 個選取圖元',
      'gp.save_selected_hint': '若選取內容包含不同幾何類型，將自動依點、線、面分流為不同圖層，確保相容標準 GIS 圖資格式。',
      'gp.save_output_base': '輸出圖層基礎名稱：',
      'gp.default_save_selected_name': '選取圖元',
      'gp.progress_running': '運算進行中...',
      'gp.cancel': '取消',
      'gp.run_btn': '開始處理',

      // Field Calculator Modal
      'calc.title': '欄位計算器 (Field Calculator)',
      'calc.target_field': '目標欄位：',
      'calc.new_field': '建立新欄位：',
      'calc.new_field_placeholder': '輸入新欄位名稱',
      'calc.scope': '計算範圍：',
      'calc.scope_all': '全部圖元',
      'calc.scope_selected': '目前選取圖元',
      'calc.scope_filtered': '目前過濾結果',
      'calc.available_fields': '可用欄位 (點擊插入)：',
      'calc.geom_vars': '幾何變數：',
      'calc.geom_area_m2': '$area_m2 (面積 m²)',
      'calc.geom_area_ha': '$area_ha (面積公頃)',
      'calc.geom_length_m': '$length_m (長度 m)',
      'calc.geom_length_km': '$length_km (長度 km)',
      'calc.geom_perimeter_m': '$perimeter_m (周長 m)',
      'calc.geom_x': '$x (經度)',
      'calc.geom_y': '$y (緯度)',
      'calc.formula_label': '表達式公式：',
      'calc.formula_placeholder': '例如：[pop] / $area_ha 或 round($area_m2, 1) 或 upper(trim([name])) + \'_標註\'',
      'calc.preview_hint': '請輸入公式並點擊「預覽前 10 筆」進行檢查。',
      'calc.preview_btn': '預覽前 10 筆',
      'calc.col_feat_name': '圖元名稱',
      'calc.col_orig_val': '原數值',
      'calc.col_calc_val': '計算後數值',
      'calc.col_status': '狀態',
      'calc.cancel': '取消',
      'calc.execute': '確認寫入圖層',

      // Modals: WMTS, Layer Editor, Recovery, Import, Consent, Classify
      'modal.layer_editor_add': '新增圖層',
      'modal.layer_editor_edit': '編輯圖層',
      'modal.layer_name': '名稱',
      'modal.geom_type': '幾何類型',
      'modal.geom_any': '混合／不限',
      'modal.geom_point': '點',
      'modal.geom_line': '線',
      'modal.geom_polygon': '面',
      'modal.group': '群組',
      'modal.recovery_title': '發現上次工作備份',
      'modal.recovery_notice': '備份不包含 TGOS APIKey。選擇捨棄後，仍可從先前下載的專案檔開啟資料。',
      'modal.discard_backup': '捨棄備份',
      'modal.restore_session': '復原工作',
      'modal.import_title': '匯入空間圖資檔案',
      'modal.dropzone_text': '點擊此處選取檔案，或將檔案拖曳至此',
      'modal.dropzone_hint': '亦可直接將檔案拖曳至地圖任意位置進行載入',
      'modal.import_preview_title': '匯入前檢查',
      'modal.import_preview_note': '確認後會建立於目前的「工作圖層」。資料會以 WGS84（EPSG:4326）顯示。',
      'modal.confirm_import': '匯入圖資',
      'modal.routing_shp_title': '路網點位檔案匯入檢查',
      'modal.name_field': '名稱欄位',
      'modal.order_field': '順序 / 序號欄位',
      'modal.role_field': '角色欄位 (選填)',
      'modal.import_mode': '加入方式',
      'modal.mode_replace': '取代目前點位',
      'modal.mode_append': '接續目前點位',
      'modal.conflict_strategy_label': '起終點角色衝突處理策略：',
      'modal.conflict_keep_first': '保留第一個起點/終點，其餘降為停靠點',
      'modal.conflict_keep_last': '保留最後一個起點/終點，其餘降為停靠點',
      'modal.overflow_checkbox': '匯入點數超過 200 點上限：同意僅載入前 200 點（若未勾選則取消匯入）',
      'modal.routing_shp_note': '僅匯入 Point / MultiPoint 圖徵；非點幾何（線段/多邊形）將明確略過，絕不靜默轉為中心點。確認前不影響既有點位。',
      'modal.add_to_routing': '加入路網分析',
      'modal.consent_title': '外部服務資料傳輸確認',
      'modal.consent_desc': '系統即將向外部 OSRM 服務發送分析點位的經緯度座標以計算道路路徑。不會傳送任何屬性欄位或本機檔案。',
      'modal.target_service_url': '目標服務網址',
      'modal.transmit_count': '傳送點位數量',
      'modal.remember_consent': '在此瀏覽器記住對此服務網址的授權（不寫入分享專案檔）',
      'modal.consent_approve': '同意並送出',
      'modal.classify_title': '數值分級 (Graduated Colors)',
      'modal.classify_field_label': '請選擇要進行分級的數值欄位：',
      'modal.classify_desc': '系統將依據您選擇的欄位數值，自動採用 等距分級法 (Equal Interval)，將圖元套用 5 階紅色漸層色彩 (由淺至深)。',
      'modal.clear_classify': '清除分級',
      'modal.apply_classify': '套用分級',
      'modal.wmts_title': 'WMTS 圖磚服務設定與檢視',
      'modal.wmts_preset_label': '內政部國土測繪中心 (NLSC) 預設圖層：',
      'modal.wmts_base_url_label': 'WMTS 服務基底網址 (Base URL)：',
      'modal.wmts_template_label': '即時產生之 Leaflet WMTS URL 樣板：',
      'modal.wmts_hint': 'ℹ️ 本工具支援 OGC 標準 WMTS 規範，已原生接入 http://maps.nlsc.gov.tw/S_Maps/wmts，點選右上角底圖按鈕即可切換。您亦可於此處切換不同圖層或套用自訂 WMTS 伺服器。',
      'modal.apply_as_basemap': '套用為當前底圖',
      'app.page_title': 'GeoCanvas - 簡易 GIS 向量繪製與圖資轉換工具',

      // Basemap titles
      'basemap.nlsc_emap_title': '內政部國土測繪中心 臺灣通用版電子地圖 (http://maps.nlsc.gov.tw/S_Maps/wmts)',
      'basemap.nlsc_photo_title': '國土測繪中心 正射影像航照圖 (PHOTO2)',
      'basemap.nlsc_mix_title': '國土測繪中心 航照混合圖 (PHOTO_MIX)',
      'basemap.osm_title': 'OpenStreetMap 標準街圖',
      'basemap.satellite_title': 'ESRI 全球衛星高解析影像',
      'basemap.topo_title': '地形等高線圖',

      // Table additional
      'table.col_measure': '幾何度量',
      'table.col_description': '描述',
      'table.status': '狀態',
      'table.empty_features': '目前地圖上沒有任何圖元。請使用左側工具繪製，或點擊「匯入圖資」。',
      'table.locate_feature': '定位至此圖元',
      'table.delete_feature': '刪除此圖元',
      'table.click_to_edit': '點擊編輯',
      'table.feature_default_name': '圖元 #{id}',
      'table.features_badge': '{count} 個圖元',
      'table.no_match': '找不到符合「{term}」的圖元資料。',

      // Layers additional
      'layers.zoom_to_layer': '縮放至圖層',
      'layers.rename_layer': '重新命名',
      'layers.opacity': '透明度',
      'layers.duplicate_layer': '複製圖層',
      'layers.save_selected_count': '另存選取圖元 ({count} 筆)',
      'layers.save_selected_new': '另存選取圖元為新圖層',
      'layers.no_selection_hint': '未選取任何圖元',
      'layers.move_to_group': '移至群組',
      'layers.remove_from_group': '移出群組',
      'layers.delete_layer': '刪除圖層',
      'layers.no_layers': '尚無圖層',
      'layers.layer_name': '圖層名稱',
      'layers.no_features_to_zoom': '圖層尚無圖元可定位',
      'layers.add_group_title': '新增圖層群組',
      'layers.add_layer_title': '新增圖層',
      'layers.new_group_default': '新增群組',
      'layers.new_layer_default': '新增圖層',

      // Safety
      'safety.backup_failed': '備份失敗',
      'safety.backup_failed_title': '自動備份失敗，點擊立即另存專案',
      'safety.auto_backed_up': '已自動備份',
      'safety.backed_up_title': '尚未另存；瀏覽器備份：{time}。點擊另存專案',
      'safety.unsaved': '尚未保存',
      'safety.unsaved_title': '尚未保存，點擊另存專案',
      'safety.saved': '已保存',
      'safety.saved_title': '專案已保存，點擊另存新副本',

      // Statusbar additional
      'statusbar.feature_count_details': '圖元總數: {count} (點: {points}, 線: {lines}, 面: {polys})',

      // Routing additional
      'routing.barrier_radius_aria': '屏障半徑',
      'routing.radius_50m': '50 公尺',
      'routing.radius_100m': '100 公尺',
      'routing.radius_250m': '250 公尺',
      'routing.radius_500m': '500 公尺',
      'routing.radius_1km': '1 公里',
      'routing.demote_to_stop': '降為停靠點',
      'routing.set_start': '設為起點',
      'routing.set_end': '設為終點',
      'routing.points_count': '{count} 個點位',

      // Geoprocessing additional
      'gp.default_dissolve_name': '融合結果',
      'gp.default_save_selected_name': '選取圖元',

      // Modals additional
      'modal.import_shp_zip': '.zip (SHP壓縮檔)',
      'modal.import_csv_wkt': '.csv (WKT或經緯度)',
      'modal.import_format_notes_title': '格式說明與提示：',
      'modal.import_kml_note': '<strong>KML</strong>: 支援 Google Earth 標準標籤、折線、多邊形與 ExtendedData 欄位。',
      'modal.import_shp_note': '<strong>SHP</strong>: 請將 <code>.shp</code>, <code>.shx</code>, <code>.dbf</code> 封裝為 <code>.zip</code> 上傳。',
      'modal.import_csv_note': '<strong>CSV</strong>: 自動偵測 <code>wkt</code> / <code>geometry</code> 欄位，或經緯度欄位（如 <code>lat, lng, x, y</code>）。',
      'modal.wmts_opt_emap': 'EMAP - 臺灣通用版電子地圖 (彩色)',
      'modal.wmts_opt_photo': 'PHOTO2 - 國土測繪正射影像航照圖',
      'modal.wmts_opt_photo_mix': 'PHOTO_MIX - 正射影像與電子地圖混合圖',
      'modal.wmts_opt_land': 'LAND_OPENDATA - 國土測繪地籍圖 (透明疊加)',
      'modal.wmts_opt_b5000': 'B5000 - 1/5000 圖名圖幅圖'
    },

    'en': {
      // General & Common
      'common.ok': 'OK',
      'common.cancel': 'Cancel',
      'common.close': 'Close',
      'common.save': 'Save',
      'common.delete': 'Delete',
      'common.create': 'Create',
      'common.apply': 'Apply',
      'common.clear': 'Clear',
      'common.import': 'Import',
      'common.export': 'Export',
      'common.search': 'Search',
      'common.filter': 'Filter',
      'common.warning': 'Warning',
      'common.error': 'Error',
      'common.info': 'Info',
      'common.success': 'Success',
      'common.loading': 'Loading...',
      'common.meters': 'meters',
      'common.kilometers': 'km',
      'common.features_unit': 'features',
      'common.points_unit': 'points',

      // App Header & Branding
      'app.title': 'GeoCanvas GIS',
      'app.subtitle': 'KML · SHP · CSV Vector Mapping',
      'header.project': 'Project',
      'header.project_title': 'Project save, restore & operation history',
      'header.save_project': 'Save Project',
      'header.open_project': 'Open Project',
      'header.undo': 'Undo',
      'header.redo': 'Redo',
      'header.import_data': 'Import Data',
      'header.import_data_title': 'Import KML / SHP / CSV / GeoJSON',
      'header.export_data': 'Export Data',
      'header.export_kml': 'KML Data',
      'header.export_shp': 'Shapefile (ZIP)',
      'header.export_csv': 'CSV (WKT + Coords)',
      'header.export_geojson': 'GeoJSON Standard',
      'header.layers': 'Layers',
      'header.layers_title': 'Toggle Layers Panel',
      'header.catalog': 'Catalog',
      'header.catalog_title': 'Toggle Data Catalog',
      'header.tools': 'Tools',
      'header.tools_title': 'Analysis & Other Tools',
      'header.tool_table': 'Attribute Table',
      'header.tool_classify': 'Graduated Colors',
      'header.tool_geoprocessing': 'Geoprocessing Toolbox',
      'header.tool_tgos': 'TGOS Geocoding',
      'header.tool_routing': 'Routing Analysis',
      'header.tool_topology': 'Check Topology',
      'header.tool_clear_selection': 'Clear Selection',
      'header.tool_clear_all': 'Clear All Features',
      'header.language': 'Language',
      'header.language_title': 'Switch Language / 切換語言',

      // Style & Selection Panel
      'style.title': 'Style & Selection',
      'style.no_selection': 'No features selected',
      'style.empty_hint': 'Select a feature on the map to adjust its style or perform operations.',
      'style.select_all': 'Select All',
      'style.select_all_title': 'Select all features',
      'style.invert': 'Invert',
      'style.invert_title': 'Invert selection',
      'style.export_selected': 'Export Selected',
      'style.export_format_title': 'Selected features export format',
      'style.delete': 'Delete',
      'style.select_by_location': 'Select by Location',
      'style.snap': 'Snapping',
      'style.tolerance': 'Tolerance',
      'style.point_symbol': 'Point Symbol:',
      'style.point_symbol_title': 'Set marker symbol',
      'style.sym_default': 'Default Pin',
      'style.sym_circle': 'Circle',
      'style.sym_square': 'Square',
      'style.sym_star': 'Star',
      'style.sym_flag': 'Flag',
      'style.stroke_color': 'Stroke:',
      'style.stroke_color_title': 'Stroke color',
      'style.fill_color': 'Fill:',
      'style.fill_color_title': 'Fill color',
      'style.stroke_width': 'Width:',
      'style.width_none': 'None (0 px)',
      'style.fill_opacity': 'Opacity:',

      // Layers Panel
      'layers.title': 'Layer Manager',
      'layers.close_title': 'Close Layers Panel',
      'layers.add_layer': 'Add Layer',
      'layers.add_group': 'Add Group',
      'layers.search_placeholder': 'Search layers...',
      'layers.rename': 'Rename',
      'layers.duplicate': 'Duplicate Layer',
      'layers.delete': 'Delete Layer',
      'layers.zoom_to': 'Zoom to Layer',
      'layers.save_selected_as_new': 'Save Selected as New Layer',
      'layers.visible_toggle': 'Toggle visibility',
      'layers.lock_toggle': 'Toggle lock',
      'layers.opacity_title': 'Layer opacity',
      'layers.count_badge': '{count} features',

      // Data Catalog
      'catalog.title': 'Data Catalog',
      'catalog.close_title': 'Close Data Catalog',
      'catalog.select_files': 'Select Local Files',
      'catalog.recent_files': 'Recent Files',
      'catalog.privacy_note': 'For privacy, please authorize files to import via "Select Local Files".',
      'catalog.no_files': 'No recent files recorded',

      // Basemap Selector
      'basemap.title': 'Basemap',
      'basemap.select_title': 'Select Basemap',
      'basemap.nlsc_emap': 'Taiwan EMAP (NLSC)',
      'basemap.nlsc_photo': 'Orthophoto (NLSC)',
      'basemap.nlsc_mix': 'Photo Mix (NLSC)',
      'basemap.osm': 'OSM Street',
      'basemap.satellite': 'ESRI Satellite',
      'basemap.topo': 'Topographic',
      'basemap.cadastral': 'Cadastral Overlay',
      'basemap.cadastral_title': 'Overlay Cadastral Map (LAND_OPENDATA)',
      'basemap.custom_wmts': 'Custom WMTS',
      'basemap.custom_wmts_title': 'View & configure WMTS service URL',

      // Attribute Table Drawer
      'table.title': 'Layer Attribute Table',
      'table.search_placeholder': 'Search name, attributes...',
      'table.selected_only': 'Selected only',
      'table.select_filtered': 'Select Filtered',
      'table.add_column': 'Add Column',
      'table.field_calculator': 'Field Calculator',
      'table.field_calculator_title': 'Open Field Calculator',
      'table.update_geometry': 'Update Geometry',
      'table.update_geometry_title': 'Batch create or update geometry attributes',
      'table.save_selected': 'Save Selected',
      'table.save_selected_title': 'Copy and save selected features as new layer',
      'table.close_drawer': 'Close Drawer',
      'table.query_title': 'Attribute Query',
      'table.field_a': 'Field A',
      'table.field_b': 'Field B (Optional)',
      'table.value_a_placeholder': 'Value A',
      'table.value_b_placeholder': 'Value B',
      'table.contains': 'contains',
      'table.equals': 'equals',
      'table.not_equals': 'not equals',
      'table.greater_than': 'greater than',
      'table.less_than': 'less than',
      'table.apply': 'Apply',
      'table.clear': 'Clear',
      'table.col_name': 'Name',
      'table.col_geometry': 'Geometry',
      'table.col_length': 'Length (m)',
      'table.col_area': 'Area (m²)',
      'table.col_actions': 'Actions',
      'table.locate': 'Locate',
      'table.empty': 'No data in current layer',

      // Status Bar
      'statusbar.coords': 'Coords: {lat}, {lng}',
      'statusbar.zoom': 'Zoom: {zoom}',
      'statusbar.feature_count': 'Total Features: {count}',
      'statusbar.saved': 'Saved',
      'statusbar.unsaved': 'Unsaved changes',
      'statusbar.save_title': 'Click to save project',
      'statusbar.crs': 'CRS: WGS84 (EPSG:4326)',

      // Routing Panel
      'routing.title': 'Multipoint Routing',
      'routing.close_title': 'Close Routing Analysis',
      'routing.status_default': 'Add start, stops, and destination sequentially on map.',
      'routing.stops_section': 'Stops',
      'routing.fix_start_end': 'Fix Start/End',
      'routing.reverse_order': 'Reverse Order',
      'routing.remove_duplicates': 'Remove Duplicates',
      'routing.clear_points': 'Clear Points',
      'routing.import_points': 'Import Points (SHP / KML / KMZ / GeoJSON / CSV)',
      'routing.empty_stops': 'No stops added yet (click map or import file)',
      'routing.undo_point': 'Undo Last Point',
      'routing.validate_snapping': 'Check Road Snapping & Reachability',
      'routing.barriers_section': 'Circular Barriers (Local Detour)',
      'routing.default_radius': 'Default Radius:',
      'routing.add_barrier': 'Add Barrier',
      'routing.empty_barriers': 'No barriers added. Enable "Add Barrier" then click map.',
      'routing.barrier_note': 'Barriers use real Turf polygon intersection. Detour can be attempted if conflict occurs.',
      'routing.attempt_detour': 'Attempt Barrier Detour Replan',
      'routing.settings_section': 'Routing Settings & Profile',
      'routing.mode': 'Route Mode',
      'routing.mode_open': 'Open Route (Fixed Start/End)',
      'routing.mode_roundtrip': 'Round Trip (End returns to Start)',
      'routing.lock_start_end': 'Lock start & destination during optimization (only reorder stops)',
      'routing.lock_start_end_label': 'Start/End Constraint',
      'routing.osrm_url': 'OSRM Service URL',
      'routing.profile': 'Travel Profile',
      'routing.profile_driving': 'Driving',
      'routing.profile_cycling': 'Cycling',
      'routing.profile_walking': 'Walking',
      'routing.fallback_policy': 'Failure Policy',
      'routing.fallback_stop': 'Stop and show error (Recommended)',
      'routing.fallback_preview': 'Show non-saveable straight line preview',
      'routing.apply_settings': 'Apply Settings',
      'routing.test_service': 'Test Service',
      'routing.clear_consent': 'Clear Consent',
      'routing.clear_consent_title': 'Clear remembered OSRM service authorization records',
      'routing.service_untested': 'Untested',
      'routing.service_ok': 'Service OK',
      'routing.service_err': 'Connection Failed',
      'routing.osrm_hint': 'Public demo server usually only supports driving. Cycling/walking requires custom OSRM profiles. Over 90 points will use chunked requests.',
      'routing.results_section': 'Analysis Results',
      'routing.result_badge': 'Generated',
      'routing.empty_results': 'No route computed yet. Run calculation below.',
      'routing.calc_current': 'Calculate Route',
      'routing.calc_current_title': 'Calculate route using current order',
      'routing.calc_optimize': 'Optimize & Calculate',
      'routing.calc_optimize_title': 'Calculate route using local 2-Opt optimization',
      'routing.cancel': 'Cancel',
      'routing.save_route': 'Save Route to Layer',
      'routing.save_route_title': 'Save route to current active layer',
      'routing.clear_all': 'Clear All',
      'routing.clear_all_title': 'Clear all stops, barriers, and results',
      'routing.privacy_footer': 'No coordinates are transmitted without prior consent; confirmation dialog appears before first request.',
      'routing.role_start': 'Start',
      'routing.role_stop': 'Stop',
      'routing.role_end': 'End',

      // TGOS Locator Panel
      'tgos.title': 'TGOS Geocoding',
      'tgos.close_title': 'Close TGOS Geocoding',
      'tgos.address_label': 'Taiwan Address',
      'tgos.address_placeholder': 'e.g. No. 4, Ln. 469, Songjiang Rd., Zhongshan Dist., Taipei',
      'tgos.locate_btn': 'Locate',
      'tgos.cred_summary': 'TGOS API Credentials',
      'tgos.app_id_placeholder': 'TGOS AppID',
      'tgos.api_key_placeholder': 'TGOS APIKey',
      'tgos.cred_note': 'AppID is stored in this browser; APIKey remains only in current tab session. TGOS also validates registered Domain/IP.',
      'tgos.clear_cred': 'Clear TGOS Credentials',
      'tgos.status_init': 'Please configure TGOS credentials before locating address.',
      'tgos.add_layer': 'Add to Layer',
      'tgos.add_route': 'Add to Route Stops',
      'tgos.privacy_note': 'Queried address, AppID, and APIKey are sent to official TGOS service.',

      // Geoprocessing Panel
      'gp.title': 'Geoprocessing Toolbox',
      'gp.close_title': 'Close Toolbox',
      'gp.tab_buffer': 'Buffer',
      'gp.tab_buffer_title': 'Buffer Analysis',
      'gp.tab_clip': 'Clip',
      'gp.tab_clip_title': 'Clip',
      'gp.tab_intersect': 'Intersect',
      'gp.tab_intersect_title': 'Geometric Intersection',
      'gp.tab_merge': 'Merge',
      'gp.tab_merge_title': 'Merge Layers',
      'gp.tab_dissolve': 'Dissolve',
      'gp.tab_dissolve_title': 'Feature Dissolve',
      'gp.tab_save_selected': 'Save Selected',
      'gp.tab_save_selected_title': 'Save Selected as New Layer',
      'gp.input_layer': 'Input Layer:',
      'gp.buffer_dist': 'Buffer Distance:',
      'gp.unit': 'Unit:',
      'gp.unit_meters': 'Meters (m)',
      'gp.unit_kilometers': 'Kilometers (km)',
      'gp.buffer_dissolve': 'Dissolve overlapping results',
      'gp.selected_only': 'Selected features only',
      'gp.output_name': 'Output Layer Name:',
      'gp.default_buffer_name': 'Buffer',
      'gp.clip_source': 'Source Layer (Point/Line/Polygon):',
      'gp.clip_mask': 'Clip Mask Layer (Polygon only):',
      'gp.clip_selected_only': 'Selected source features only',
      'gp.default_clip_name': 'Clipped Result',
      'gp.intersect_a': 'Layer A:',
      'gp.intersect_b': 'Layer B:',
      'gp.hint_intersect': 'Supports polygon-polygon, point-polygon, line-polygon. Pre-filters using BBox and prefixes duplicate fields with A_ and B_.',
      'gp.default_intersect_name': 'Intersection Result',
      'gp.merge_select_label': 'Select layers to merge (must be same geometry family):',
      'gp.hint_merge': 'Fields are unioned with null values padded. Retains source_layer and source_feature_id.',
      'gp.default_merge_name': 'Merged Layer',
      'gp.dissolve_input': 'Input Polygon Layer:',
      'gp.dissolve_field': 'Dissolve Field (Group By):',
      'gp.dissolve_all': '(Dissolve all, no grouping)',
      'gp.hint_dissolve': 'Dissolves adjacent or disjoint polygons by attribute. Isolates errors with summary reporting.',
      'gp.default_dissolve_name': 'Dissolved Result',
      'gp.save_selected_info': 'Currently selected:',
      'gp.save_selected_count': '{count} selected features',
      'gp.save_selected_hint': 'Mixed geometry types will automatically be split into separate point, line, and polygon layers.',
      'gp.save_output_base': 'Base Output Name:',
      'gp.default_save_selected_name': 'Selected Features',
      'gp.progress_running': 'Processing in progress...',
      'gp.cancel': 'Cancel',
      'gp.run_btn': 'Run Tool',

      // Field Calculator Modal
      'calc.title': 'Field Calculator',
      'calc.target_field': 'Target Field:',
      'calc.new_field': 'Create New Field:',
      'calc.new_field_placeholder': 'Enter new field name',
      'calc.scope': 'Scope:',
      'calc.scope_all': 'All Features',
      'calc.scope_selected': 'Selected Features',
      'calc.scope_filtered': 'Filtered Results',
      'calc.available_fields': 'Available Fields (Click to insert):',
      'calc.geom_vars': 'Geometry Variables:',
      'calc.geom_area_m2': '$area_m2 (Area m²)',
      'calc.geom_area_ha': '$area_ha (Area ha)',
      'calc.geom_length_m': '$length_m (Length m)',
      'calc.geom_length_km': '$length_km (Length km)',
      'calc.geom_perimeter_m': '$perimeter_m (Perimeter m)',
      'calc.geom_x': '$x (Longitude)',
      'calc.geom_y': '$y (Latitude)',
      'calc.formula_label': 'Expression Formula:',
      'calc.formula_placeholder': 'e.g.: [pop] / $area_ha or round($area_m2, 1) or upper(trim([name])) + \'_label\'',
      'calc.preview_hint': 'Enter formula and click "Preview First 10" to inspect results.',
      'calc.preview_btn': 'Preview First 10',
      'calc.col_feat_name': 'Feature Name',
      'calc.col_orig_val': 'Original Value',
      'calc.col_calc_val': 'Calculated Value',
      'calc.col_status': 'Status',
      'calc.cancel': 'Cancel',
      'calc.execute': 'Apply to Layer',

      // Modals: WMTS, Layer Editor, Recovery, Import, Consent, Classify
      'modal.layer_editor_add': 'Add Layer',
      'modal.layer_editor_edit': 'Edit Layer',
      'modal.layer_name': 'Name',
      'modal.geom_type': 'Geometry Type',
      'modal.geom_any': 'Any / Mixed',
      'modal.geom_point': 'Point',
      'modal.geom_line': 'Line',
      'modal.geom_polygon': 'Polygon',
      'modal.group': 'Group',
      'modal.recovery_title': 'Previous Session Backup Found',
      'modal.recovery_notice': 'Backup excludes TGOS APIKey. If discarded, you can still open previously downloaded project files.',
      'modal.discard_backup': 'Discard Backup',
      'modal.restore_session': 'Restore Session',
      'modal.import_title': 'Import Spatial Data Files',
      'modal.dropzone_text': 'Click here to select files, or drag & drop files here',
      'modal.dropzone_hint': 'You can also drag and drop files directly onto the map to load them',
      'modal.import_preview_title': 'Pre-import Inspection',
      'modal.import_preview_note': 'Once confirmed, data will be added to active layer. Coordinates rendered in WGS84 (EPSG:4326).',
      'modal.confirm_import': 'Import Data',
      'modal.routing_shp_title': 'Routing Point File Import Inspection',
      'modal.name_field': 'Name Field',
      'modal.order_field': 'Order / Sequence Field',
      'modal.role_field': 'Role Field (Optional)',
      'modal.import_mode': 'Import Mode',
      'modal.mode_replace': 'Replace Current Points',
      'modal.mode_append': 'Append to Current Points',
      'modal.conflict_strategy_label': 'Start/End Role Conflict Strategy:',
      'modal.conflict_keep_first': 'Keep first start/end, demote others to stops',
      'modal.conflict_keep_last': 'Keep last start/end, demote others to stops',
      'modal.overflow_checkbox': 'Points exceed 200 maximum limit: consent to load first 200 points only (cancel import if unchecked)',
      'modal.routing_shp_note': 'Only Point / MultiPoint features are imported; non-point features will be skipped and never converted silently. Existing points remain unaffected until confirmed.',
      'modal.add_to_routing': 'Add to Routing',
      'modal.consent_title': 'External Service Data Transmission Confirmation',
      'modal.consent_desc': 'The system will transmit the coordinates of analysis points to the external OSRM service to calculate road paths. No attributes or local files will be sent.',
      'modal.target_service_url': 'Target Service URL',
      'modal.transmit_count': 'Point Count',
      'modal.remember_consent': 'Remember authorization for this service URL in this browser (not saved to shared project)',
      'modal.consent_approve': 'Consent & Submit',
      'modal.classify_title': 'Graduated Colors',
      'modal.classify_field_label': 'Select numeric field to classify:',
      'modal.classify_desc': 'The system will apply 5-class red gradient colors using Equal Interval classification.',
      'modal.clear_classify': 'Clear Classification',
      'modal.apply_classify': 'Apply Classification',
      'modal.wmts_title': 'WMTS Tile Service Settings',
      'modal.wmts_preset_label': 'NLSC Preset Layer:',
      'modal.wmts_base_url_label': 'WMTS Base URL:',
      'modal.wmts_template_label': 'Generated Leaflet WMTS URL Template:',
      'modal.wmts_hint': 'ℹ️ Supports OGC standard WMTS. Pre-configured with NLSC WMTS. Switch basemap from top-right menu or specify custom WMTS servers here.',
      'modal.apply_as_basemap': 'Apply as Basemap',
      'app.page_title': 'GeoCanvas - Simple GIS Vector Mapping & Data Conversion',

      // Basemap titles
      'basemap.nlsc_emap_title': 'NLSC Taiwan Electronic Map (EMAP)',
      'basemap.nlsc_photo_title': 'NLSC Aerial Orthophoto (PHOTO2)',
      'basemap.nlsc_mix_title': 'NLSC Photo & Map Hybrid (PHOTO_MIX)',
      'basemap.osm_title': 'OpenStreetMap Standard Streets',
      'basemap.satellite_title': 'ESRI World Imagery',
      'basemap.topo_title': 'Topographic Map',

      // Table additional
      'table.col_measure': 'Measurement',
      'table.col_description': 'Description',
      'table.status': 'Status',
      'table.empty_features': 'No features on the map. Use the drawing tools on the left or click "Import Data".',
      'table.locate_feature': 'Locate this feature',
      'table.delete_feature': 'Delete this feature',
      'table.click_to_edit': 'Click to edit',
      'table.feature_default_name': 'Feature #{id}',
      'table.features_badge': '{count} features',
      'table.no_match': 'No features matching "{term}".',

      // Layers additional
      'layers.zoom_to_layer': 'Zoom to Layer',
      'layers.rename_layer': 'Rename',
      'layers.opacity': 'Opacity',
      'layers.duplicate_layer': 'Duplicate Layer',
      'layers.save_selected_count': 'Save Selected Features ({count})',
      'layers.save_selected_new': 'Save Selected as New Layer',
      'layers.no_selection_hint': 'No features selected',
      'layers.move_to_group': 'Move to Group',
      'layers.remove_from_group': 'Remove from Group',
      'layers.delete_layer': 'Delete Layer',
      'layers.no_layers': 'No Layers',
      'layers.layer_name': 'Layer Name',
      'layers.no_features_to_zoom': 'Layer has no features to locate',
      'layers.add_group_title': 'Add Layer Group',
      'layers.add_layer_title': 'Add Layer',
      'layers.new_group_default': 'New Group',
      'layers.new_layer_default': 'New Layer',

      // Safety
      'safety.backup_failed': 'Backup Failed',
      'safety.backup_failed_title': 'Auto-backup failed. Click to save project now',
      'safety.auto_backed_up': 'Auto Backed Up',
      'safety.backed_up_title': 'Not saved to file; browser backup: {time}. Click to save project',
      'safety.unsaved': 'Unsaved',
      'safety.unsaved_title': 'Unsaved changes. Click to save project',
      'safety.saved': 'Saved',
      'safety.saved_title': 'Project saved. Click to save a new copy',

      // Statusbar additional
      'statusbar.feature_count_details': 'Total Features: {count} (Points: {points}, Lines: {lines}, Polygons: {polys})',

      // Routing additional
      'routing.barrier_radius_aria': 'Barrier radius',
      'routing.radius_50m': '50 meters',
      'routing.radius_100m': '100 meters',
      'routing.radius_250m': '250 meters',
      'routing.radius_500m': '500 meters',
      'routing.radius_1km': '1 km',
      'routing.demote_to_stop': 'Demote to Stop',
      'routing.set_start': 'Set as Start',
      'routing.set_end': 'Set as End',
      'routing.points_count': '{count} points',

      // Geoprocessing additional
      'gp.default_dissolve_name': 'Dissolve Result',
      'gp.default_save_selected_name': 'Selected Features',

      // Modals additional
      'modal.import_shp_zip': '.zip (SHP Archive)',
      'modal.import_csv_wkt': '.csv (WKT or Lat/Lng)',
      'modal.import_format_notes_title': 'Format Notes & Tips:',
      'modal.import_kml_note': '<strong>KML</strong>: Supports Google Earth standard placemarks, lines, polygons, and ExtendedData fields.',
      'modal.import_shp_note': '<strong>SHP</strong>: Please bundle <code>.shp</code>, <code>.shx</code>, and <code>.dbf</code> into a <code>.zip</code> file.',
      'modal.import_csv_note': '<strong>CSV</strong>: Auto-detects <code>wkt</code> / <code>geometry</code> columns or coordinate fields (such as <code>lat, lng, x, y</code>).',
      'modal.wmts_opt_emap': 'EMAP - Taiwan Electronic Map (Color)',
      'modal.wmts_opt_photo': 'PHOTO2 - Aerial Orthophoto',
      'modal.wmts_opt_photo_mix': 'PHOTO_MIX - Hybrid Orthophoto & Map',
      'modal.wmts_opt_land': 'LAND_OPENDATA - Cadastral Map (Overlay)',
      'modal.wmts_opt_b5000': 'B5000 - 1/5000 Map Sheets'
    }
  };

  const listeners = [];

  const I18n = {
    currentLang: 'zh-TW',
    translations,

    /**
     * Initialize i18n
     */
    init(map) {
      let saved = null;
      try {
        if (typeof localStorage !== 'undefined') {
          saved = localStorage.getItem(STORAGE_KEY);
        }
      } catch (_) {}

      if (saved === 'en' || saved === 'zh-TW') {
        this.currentLang = saved;
      } else {
        // Auto-detect browser language or default to zh-TW
        const nav = typeof navigator !== 'undefined' ? (navigator.language || navigator.userLanguage || '') : '';
        if (nav.toLowerCase().startsWith('en')) {
          this.currentLang = 'en';
        } else {
          this.currentLang = 'zh-TW';
        }
      }

      if (typeof document !== 'undefined') {
        document.documentElement.lang = this.currentLang;
        this.applyToDOM();

        // Bind language toggle button listeners
        const btnZh = document.getElementById('lang-btn-zh');
        const btnEn = document.getElementById('lang-btn-en');
        if (btnZh && !btnZh._i18nBound) {
          btnZh.addEventListener('click', (e) => {
            e.preventDefault();
            this.setLanguage('zh-TW', map);
            document.getElementById('lang-dropdown')?.classList.remove('open');
          });
          btnZh._i18nBound = true;
        }
        if (btnEn && !btnEn._i18nBound) {
          btnEn.addEventListener('click', (e) => {
            e.preventDefault();
            this.setLanguage('en', map);
            document.getElementById('lang-dropdown')?.classList.remove('open');
          });
          btnEn._i18nBound = true;
        }
      }

      if (map) {
        this.updateGeomanLang(map);
      }
    },

    /**
     * Get current language code ('zh-TW' | 'en')
     */
    getLanguage() {
      return this.currentLang;
    },

    /**
     * Translate key with optional parameter substitution
     * e.g. I18n.t('statusbar.feature_count', { count: 10 })
     */
    t(key, paramsOrFallback, params) {
      const dict = this.translations[this.currentLang] || this.translations['zh-TW'];
      let val = dict[key];

      if (val === undefined) {
        // Fallback to zh-TW
        val = this.translations['zh-TW'] ? this.translations['zh-TW'][key] : undefined;
      }

      let actualParams = null;
      if (typeof paramsOrFallback === 'string') {
        if (val === undefined) val = paramsOrFallback;
        actualParams = params;
      } else if (typeof paramsOrFallback === 'object' && paramsOrFallback !== null) {
        actualParams = paramsOrFallback;
      }

      if (val === undefined) return key;

      if (actualParams && typeof val === 'string') {
        return val.replace(/\{(\w+)\}/g, (match, paramName) => {
          return actualParams[paramName] !== undefined ? actualParams[paramName] : match;
        });
      }

      return val;
    },

    /**
     * Set active language and update UI
     */
    setLanguage(lang, map) {
      if (lang !== 'zh-TW' && lang !== 'en') return;
      this.currentLang = lang;

      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, lang);
        }
      } catch (_) {}

      if (typeof document !== 'undefined') {
        document.documentElement.lang = lang;
        this.applyToDOM();
        document.getElementById('lang-dropdown')?.classList.remove('open');
      }

      const activeMap = map || (typeof App !== 'undefined' ? App.map : null);
      if (activeMap) {
        this.updateGeomanLang(activeMap);
      }

      // Notify registered listeners
      listeners.forEach(fn => {
        try { fn(lang); } catch (e) { console.error('I18n listener error:', e); }
      });

      // Dispatch DOM CustomEvent
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
          window.dispatchEvent(new CustomEvent('languagechange', { detail: { language: lang } }));
        } catch (_) {}
      }

      // Update Lucide icons if available
      if (typeof lucide !== 'undefined' && lucide.createIcons) {
        try { lucide.createIcons(); } catch (_) {}
      }
    },

    /**
     * Register a callback to run on language change
     */
    onLanguageChange(callback) {
      if (typeof callback === 'function') {
        listeners.push(callback);
      }
    },

    /**
     * Apply translations to all DOM elements with data-i18n attributes
     */
    applyToDOM(root = (typeof document !== 'undefined' ? document : null)) {
      if (!root) return;

      // 1. textContent
      const textEls = root.querySelectorAll ? root.querySelectorAll('[data-i18n]') : [];
      for (let i = 0; i < textEls.length; i++) {
        const el = textEls[i];
        const key = el.getAttribute('data-i18n');
        if (key) {
          const translated = this.t(key);
          if (translated) {
            if (el.tagName === 'TITLE') {
              if (typeof document !== 'undefined') document.title = translated;
            } else {
              el.textContent = translated;
            }
          }
        }
      }

      // 1.1 HTML content (trusted UI translations with markup)
      const htmlEls = root.querySelectorAll ? root.querySelectorAll('[data-i18n-html]') : [];
      for (let i = 0; i < htmlEls.length; i++) {
        const el = htmlEls[i];
        const key = el.getAttribute('data-i18n-html');
        if (key) {
          const translated = this.t(key);
          if (translated) el.innerHTML = translated;
        }
      }

      // 2. title attribute
      const titleEls = root.querySelectorAll ? root.querySelectorAll('[data-i18n-title]') : [];
      for (let i = 0; i < titleEls.length; i++) {
        const el = titleEls[i];
        const key = el.getAttribute('data-i18n-title');
        if (key) {
          const translated = this.t(key);
          if (translated) el.setAttribute('title', translated);
        }
      }

      // 3. placeholder attribute
      const phEls = root.querySelectorAll ? root.querySelectorAll('[data-i18n-placeholder]') : [];
      for (let i = 0; i < phEls.length; i++) {
        const el = phEls[i];
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) {
          const translated = this.t(key);
          if (translated) el.setAttribute('placeholder', translated);
        }
      }

      // 4. aria-label attribute
      const ariaEls = root.querySelectorAll ? root.querySelectorAll('[data-i18n-aria]') : [];
      for (let i = 0; i < ariaEls.length; i++) {
        const el = ariaEls[i];
        const key = el.getAttribute('data-i18n-aria');
        if (key) {
          const translated = this.t(key);
          if (translated) el.setAttribute('aria-label', translated);
        }
      }

      // 4.1 value attribute for default text inputs
      const valEls = root.querySelectorAll ? root.querySelectorAll('[data-i18n-value]') : [];
      for (let i = 0; i < valEls.length; i++) {
        const el = valEls[i];
        const key = el.getAttribute('data-i18n-value');
        if (key) {
          const translated = this.t(key);
          if (translated) el.value = translated;
        }
      }

      // 5. Update header current language indicator
      const langLabel = root.getElementById ? root.getElementById('current-lang-label') : null;
      if (langLabel) {
        langLabel.textContent = this.currentLang === 'zh-TW' ? '繁體中文' : 'English';
      }

      // 6. Update active class on dropdown buttons
      const btnZh = root.getElementById ? root.getElementById('lang-btn-zh') : null;
      const btnEn = root.getElementById ? root.getElementById('lang-btn-en') : null;
      if (btnZh && btnEn) {
        if (this.currentLang === 'zh-TW') {
          btnZh.classList.add('active');
          btnEn.classList.remove('active');
        } else {
          btnEn.classList.add('active');
          btnZh.classList.remove('active');
        }
      }
    },

    /**
     * Update Leaflet Geoman toolbar and tooltips
     */
    updateGeomanLang(map) {
      if (!map || !map.pm) return;
      const lang = this.currentLang === 'zh-TW' ? 'zh' : 'en';
      try {
        if (typeof map.pm.setLang === 'function') {
          map.pm.setLang(lang);
        }
      } catch (_) {}
    }
  };

  return I18n;
}));
