# GeoCanvas 必要檔案清單

此目錄是後續維護的主要工作版本，不依賴 Python。

## 執行核心

- `index.html`：主介面與第三方前端函式庫載入。
- `css/style.css`：全站、地圖與路網分析介面樣式。
- `run_gis.bat`：Windows 雙擊啟動入口。
- `run_gis.ps1`：使用 Windows PowerShell 內建功能提供本機 HTTP 服務。
- `run_tests.bat`：Windows 雙擊執行完整離線測試。
- `run_tests.ps1`：依序執行四套 Node.js 自動化測試並於失敗時停止。

## JavaScript 模組

- `js/app.js`：應用初始化與整體介面控制。
- `js/draw.js`：圖元繪製與編輯。
- `js/io.js`：KML、SHP、CSV 與 GeoJSON 匯入匯出。
- `js/table.js`：屬性資料表。
- `js/layers.js`：圖層管理。
- `js/catalog.js`：本機資料目錄與最近呼叫記錄。
- `js/measure.js`：距離與面積量測。
- `js/tgos-address.js`：TGOS 地址定位、TWD97/WGS84 轉換與定位結果管理。
- `js/routing-multipoint.js`：多點路網、OSRM、屏障、SHP/KML 點位匯入。
- `js/safety.js`：專案存取、自動備份、異常復原、Undo/Redo 與未保存提醒。
- `js/geoprocessing.js`：常用空間處理工具箱（緩衝區、裁切、相交、合併、融合、選取另存新圖層）。
- `js/field-calculator.js`：安全 AST 欄位計算器、幾何屬性批次更新與即時預覽。
- `js/i18n.js`：多國語言國際化模組（繁體中文 / 英文即時切換、DOM 屬性轉換、Leaflet Geoman 同步、localStorage 偏好保存）。

## 開發驗證測試

- `test_p2.js`：路網分析核心測試套件（使用 Node.js 內建模組及 mock fetch，僅供開發驗證，非正式啟動依賴）。
- `test_security.js`：安全與敏感資料保護測試套件（XSS 防護、APIKey 隔離、OSRM 授權 Fail-Closed、CDN 固定版本）。
- `test_geoprocessing.js`：空間處理工具箱與欄位計算器測試套件（43 項全功能離線驗證）。
- `test_i18n.js`：國際化完整性測試套件（辭典對稱性、參數插值、語言切換、DOM 即時渲染與 100% 介面覆蓋率）。

## 已排除的舊檔

- `run.py`、`test_verification.py`、`__pycache__`：Python 舊啟動與測試檔。
- `sample_data/`：內建範例已從主工作版本移除。
- `js/routing.js`：已由 `routing-multipoint.js` 取代。
- `data/`：原目錄為空，無執行依賴。
