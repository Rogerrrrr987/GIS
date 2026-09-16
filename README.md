# GeoCanvas - 簡易 GIS 向量繪製與圖資轉換工具

一個輕量、現代化、開箱即用的 Web GIS 向量圖資繪製、檢視與格式轉換工作站。

---

## 🚀 快速啟動

### 方法一：Windows 一鍵啟動（推薦，不需安裝 Python）
下載或複製專案後，在專案目錄直接雙擊執行：
- **`run_gis.bat`**

程式會使用 Windows 內建 PowerShell 啟動本機服務，並於預設瀏覽器開啟工具；無須安裝 Python。

### 方法二：指令列啟動（PowerShell）
```bash
cd <GeoCanvas 專案目錄>
powershell -NoProfile -ExecutionPolicy Bypass -File .\run_gis.ps1
```
啟動後瀏覽器會自動開啟 `http://127.0.0.1:8080/index.html`。

> 注意：工具仍會從網路載入 Leaflet 等前端函式庫與底圖；請使用上述本機服務啟動，不建議直接雙擊 `index.html`。

### 執行自動化測試（選用）

若電腦已安裝 Node.js，可直接雙擊 `run_tests.bat`，或在專案目錄執行：

```powershell
.\run_tests.ps1
```

以上方式只執行本機 mock 測試，不會向 OSRM 或 TGOS 傳送資料。

面試展示重點與建議流程請參閱 [`PORTFOLIO.md`](PORTFOLIO.md)。

---

## 🌟 核心功能說明

### 0. 專案安全與工作復原
- 頂部「**專案**」選單可將完整工作狀態另存為 `.gcp.json`，或重新開啟既有專案。
- 工作內容變更後會自動備份於目前瀏覽器；下次啟動時可選擇復原或捨棄。
- 支援最多 60 個操作歷程的全域復原／重做（`Ctrl+Z`、`Ctrl+Y`，`Ctrl+S` 另存專案）。
- 清空與刪除可透過復原救回；有未保存修改時，關閉或重新整理會顯示警告。
- 備份包含圖元、樣式、地圖視角、底圖、路網停靠點與屏障；計算中的路線需重新計算。
- TGOS APIKey 不會寫入瀏覽器工作備份或專案檔。

### 1. 空間幾何繪製與編輯（左側工具列）
- **點 (Marker)**：標註特定經緯度位置。
- **線 (Polyline)**：繪製路徑、管線、路線，自動即時計算長度（公尺/公里）。
- **多邊形 (Polygon)**：繪製任意區域範圍，自動計算面積（平方公尺、平方公里、公頃、坪）與周長。
- **矩形 / 圓形**：快速劃定範圍。
- **高級編輯功能**：
  - **剪裁 (Cut)**：將既有多邊形裁切為兩個獨立多邊形。
  - **編輯頂點 (Edit)**：拖曳、新增、刪除頂點。
  - **拖曳 (Drag)** 與 **旋轉 (Rotate)**：平移或旋轉形狀。
  - **顏色與樣式調整**：即時自訂線框顏色、填充顏色、線寬與透明度。

### 2. 圖資讀取 (Import)
點擊頂部「**匯入圖資**」按鈕，或**直接將檔案拖曳到地圖上**：
- **KML / KMZ**（`.kml`, `.kmz`）：支援 Google Earth Placemark 點、線、多邊形、顏色樣式與 ExtendedData 擴充屬性。
- **Shapefile**（`.zip`）：請將包含 `.shp`, `.shx`, `.dbf`, `.prj` 的檔案壓成 ZIP 檔直接上傳。
- **CSV**（`.csv`, `.txt`）：
  - 自動偵測 `wkt` 或 `geometry` 幾何字串（如 `POINT(...)`, `POLYGON(...)`）。
  - 自動偵測經緯度欄位（如 `latitude/lat/y`, `longitude/lng/x`）。
  - 其餘欄位自動保留為圖元屬性表。
- **GeoJSON**（`.geojson`, `.json`）：標準 GIS 向量格式。

### 3. 圖資輸出 (Export)
點擊頂部「**匯出圖資**」下拉選單：
- **KML**：匯出符合 OGC KML 2.2 標準的檔案，包含幾何坐標、自訂樣式顏色與 ExtendedData 屬性。
- **Shapefile (ZIP)**：一鍵封裝 `.shp`、`.shx`、`.dbf`、`.prj` (WGS84 EPSG:4326) 壓縮包。
- **CSV (WKT + 經緯度)**：匯出包含 WKT（全幾何支援）、經緯度座標及所有自訂屬性之 CSV 檔，加入 UTF-8 BOM 確保 Microsoft Excel 開啟中文不會亂碼。
- **GeoJSON**：標準結構化空間資料。

### 4. 圖層屬性資料表 (Attribute Table)
點擊「**屬性資料表**」可由底部開啟資料表抽屜：
- 表格化檢視目前所有圖元的名稱、幾何類型、度量數據與自訂欄位。
- 支援快速關鍵字搜尋與過濾。
- **定位按鈕**：點擊可將地圖快速縮放聚焦至該圖元。
- **動態新增欄位**：可一鍵為所有圖元擴充全新自訂欄位。
- **即時編輯**：點選任一儲存格即可直接修改數值。

### 5. 多底圖與圖層切換（原生支援內政部國土測繪中心 WMTS）
本工具已正式接入 **內政部國土測繪中心 WMTS 圖磚服務**（`http://maps.nlsc.gov.tw/S_Maps/wmts`）：
- 🇹🇼 **臺灣通用圖 (NLSC EMAP)**：【預設底圖】台灣官方高精度彩色電子地圖，含完整道路、水系、聚落與地名。
- 📷 **國土航照 (NLSC PHOTO2)**：台灣全島高清晰正射影像空照圖。
- 🗂️ **航照混合 (NLSC PHOTO_MIX)**：正射影像航照與通用電子地圖標註之混合圖。
- 🗺️ **街圖**（OpenStreetMap）
- 🛰️ **全球衛星**（ESRI World Imagery）
- ⛰️ **地形圖**（OpenTopoMap）
- 📌 **疊加地籍圖 (NLSC LAND_OPENDATA)**：可隨時一鍵開關透明地籍圖疊加，縮放至第 14 級以上即可檢視真實地號與地籍界線。
- ⚙️ **自訂 WMTS 對話盒**：可即時檢視產生之 WMTS GetTile URL 樣板，並可自由切換預設圖層或套用任何外部 WMTS 圖磚服務。

### 6. 多點路網分析核心能力與安全機制
- **200 點極致效能與 Keyed DOM 更新**：清單渲染採用基於 `point.id` 之 Keyed DOM 補丁機制，原地更新屬性與順序，即使 200 點拖曳排序亦順暢不閃爍；超過 90 點使用本機非阻塞式 2-Opt TSP 最佳化與分段 OSRM 請求合併。
- **自動起終點指定與角色推斷**：匯入未指定角色之點位時，開放模式自動將首點設為起點、末點設為終點、其餘設為停靠點；環狀模式首點設起點、其餘停靠；單點僅設起點。
- **雙向角色衝突解決機制**：替換（Replace）與追加（Append）匯入均支援「保留首項 (keep-first)」與「保留末項 (keep-last)」全域策略，預覽階段嚴格保持原資料不可變（Immutable），確認後才套用。
- **失敗預覽狀態隔離保護**：當 OSRM 計算失敗且設定為「顯示直線預覽」時，系統使用獨立的 `fallbackPreviewRoute` 與橘色虛線 `fallbackPreviewLayer`，絕不覆蓋上一條有效道路路線；直線預覽嚴禁保存至 GIS 圖層。
- **彎曲道路幾何屏障衝突檢驗**：屏障檢驗採用 OSRM 真實道路座標折線（`route.latlngs`）與 Turf 進行空間香交計算，精確標示各屏障影響之旅程路段（Legs）並按行車時序排列。
- **多屏障周邊繞行規劃（支援 >2 屏障）**：支援 1 至 20 個衝突屏障，於屏障周邊 4 方位（$R \times 1.35$）自動產生避障候選點，採循序波束搜尋（Beam Search），並受 16 次 OSRM 請求預算嚴格限制；若周邊道路皆受阻，自動保留原路線並顯示告警。
- **Fail-Closed 隱私授權與傳輸安全**：呼叫外部 OSRM 前必須取得使用者確認，支援記住授權與一鍵清除授權；禁止在專案檔、記錄或控制台輸出敏感金鑰或座標 URL。
- **可靠性網路機制**：HTTP 400 立即拋錯不盲目重試、HTTP 429 解析 `Retry-After`、HTTP 502/503 有界指數退避重試、支援逾時與中止訊號（AbortController）。
- **完整開發驗證測試**：提供不依賴外部網路的 `test_p2.js` 測試套件（8 大測試集），可使用 Node.js 內建測試工具及 mock fetch 執行全數檢驗。

### 7. 常用空間處理工具箱 (Geoprocessing Toolbox) 與欄位計算器 (Field Calculator)
專案原生內建完整 ArcGIS 類空間分析與屬性運算引擎，所有運算均在瀏覽器前端本地完成，不依賴任何外部後端：

- **緩衝區分析 (Buffer)**：
  - 支援點（Point）、線（Polyline）、面（Polygon）幾何。
  - 自訂緩衝距離（公尺 / 公里），內建防呆校驗（距離必須大於 0）。
  - 支援「融合重疊緩衝區 (Dissolve)」選項，一鍵將重疊範圍多邊形融合成單一多邊形。
- **裁切分析 (Clip)**：
  - 嚴格校驗裁切圖層必須為面狀幾何（Polygon / MultiPolygon）。
  - 支援裁切點（保留落於面內之點）、裁切線（保留穿越面內之折線段，絕不退化成點）及裁切面（多邊形交集重疊區域）。
- **相交運算 (Intersect)**：
  - 支援點、線、面圖層間之空間交集運算。
  - 兩圖層重疊之同名欄位自動附加 `A_` 與 `B_` 前綴，避免資料覆蓋。
  - 內建 BBox 空間包圍盒相交預篩選，大幅優化計算效率，避免不必要的 $O(N \times M)$ 笛卡兒積。
- **圖層合併 (Merge)**：
  - 支援相同幾何家族（點與點、線與線、面與面）之圖層合併；跨幾何家族合併時提供明確攔截提示。
  - 屬性欄位採聯集（Union）策略，對應缺少之欄位安全補以 `null`。
- **融合分析 (Dissolve)**：
  - 支援「全部融合 (All Dissolve)」或依據指定屬性欄位進行「分組融合 (Group By)」。
  - 單一圖元幾何拓樸錯誤具備獨立容錯與隔離，並於介面提供詳細錯誤摘要，確保運算不崩潰。
- **選取圖元另存圖層 (Save Selected as Layer)**：
  - 支援自地圖或屬性表選取之圖元一鍵另存為新圖層。
  - 支援混合幾何類型自動分流為不同圖層（如點圖層、線圖層）。
  - 完整保留既有圖元樣式（顏色、線寬、透明度）與屬性資料。
- **安全欄位計算器 (Field Calculator - Safe AST Parser)**：
  - **100% 安全架構**：採用純前端 Tokenizer 與 AST 遞迴下降解析器，**嚴格杜絕 `eval()` 與 `new Function()`**，徹底防止代碼注入。
  - **數值與字串運算**：支援四則運算 `+`, `-`, `*`, `/` 與運算子優先權（含括號）；支援文字串接與字串函式（`upper()`, `lower()`, `trim()`, `concat()`, `substring()`）。
  - **幾何變數即時計算**：支援 `$area_m2`（投影面積平方公尺）、`$length_m`（大地線長度公尺）、`$x`/`$y`（點座標或面質心坐標）、`$centroid_x`/`$centroid_y`。
  - **除以零與缺值保護**：遭遇除以零時自動安全返回 `null`，絕不產生 `Infinity` 或計算崩潰；引用不存在欄位時明確防呆攔截。
  - **10 筆即時預覽**：套用計算前提供前 10 筆運算結果對比預覽；屬性資料表提供「一鍵更新幾何欄位」批次注入常用幾何屬性。
- **安全、復原與健全性保證**：
  - **不原地覆寫原則**：所有空間處理工具一律建立新圖層，嚴禁污染或改動原始圖層。
  - **完整 Undo/Redo 整合**：產生的新圖層自動記錄至 `SafetyManager`，可透過頂部 Undo 或 `Ctrl+Z` 一鍵完整復原與撤除。
  - **非同步與可取消機制**：所有長時間運算均提供進度百分比條，點擊「取消」即時中止且絕不留下半成品圖層。

### 10. 全介面多國語言即時切換 (Internationalization / i18n)
- **頂部語言切換選單**：右上角提供便捷語言切換下拉選單，支援「**繁體中文 (zh-TW)**」與「**English (en)**」無縫切換。
- **純前端零刷新即時響應**：點擊切換後介面立即變更，無須重新載入頁面，工作區與編輯狀態完整保留。
- **全介面 100% 雙語覆蓋**：
  - 頂部工作列（專案、復原/重做、匯入/匯出、圖層、目錄、工具、語言）。
  - 樣式與選取浮動面板（符號樣式、吸附容差、依位置選取）。
  - 圖層管理抽屜與圖層右鍵快顯功能表（縮放至圖層、重新命名、透明度、複製、另存選取、移入/移出群組、刪除）。
  - 本機資料目錄抽屜。
  - 底圖切換浮動選單（臺灣通用圖、國土航照、混合圖、OSM街圖、ESRI衛星、地形圖、地籍圖疊加、自訂 WMTS）。
  - 屬性資料表抽屜與屬性查詢欄（包含/等於/大於/小於、欄位計算器、更新幾何欄位、選取過濾結果）。
  - 底部狀態列（即時坐標經緯度、縮放級別、坐標系統、各類型圖元統計、保存狀態指示器）。
  - 多點路網分析面板（分析點位、起終點/停靠點角色標籤與操作按鈕、屏障半徑、交通模式、路網設定、結果摘要、底部操作列）。
  - TGOS 地址定位面板。
  - 空間處理工具箱（緩衝區、裁切、相交、合併、融合、選取另存新圖層）。
  - 全數對話盒與互動視窗（圖層編輯器、未保存復原確認、檔案匯入與格式提示、匯入前資料檢查、路網點位欄位配對、外部 OSRM 傳輸授權、數值分級、自訂 WMTS 服務設定）。
- **Leaflet-Geoman 繪圖工具列語系同步**：自動調用 `map.pm.setLang('zh')` / `map.pm.setLang('en')`，即時同步幾何繪圖頂點提示與按鈕工具提示。
- **偏好保存**：使用者選擇的語言會自動持久化於瀏覽器 `localStorage` (`geocanvas_lang`)，下次開啟自動套用。

---

## 🔒 安全與隱私 (Security & Privacy)

本專案採純前端架構，無本機後端伺服器與資料庫，但為了提供完整的地理圖資與路網分析體驗，系統在安全與隱私方面落實以下防護與運作原則：

1. **非完全離線版本（依賴外部 CDN 與底圖）**：
   - 專案在啟動與執行時，仍需從外部 CDN（unpkg）載入前端相依函式庫（如 Leaflet、Turf、Lucide 等），並向內政部國土測繪中心（NLSC）或 OpenStreetMap 載入底圖圖磚。若在完全無網路的內網環境執行，需先將圖磚與靜態函式庫下載至本地快取。
2. **OSRM 路由服務隱私授權（Fail-Closed）**：
   - 路網分析之行車路徑計算係使用使用者設定的 OSRM 服務。在使用者於授權對話盒中明確勾選並點擊「同意傳輸」前，系統**絕不會向外部伺服器傳送任何點位座標或分析請求**。
   - 使用者選擇取消授權時，系統即刻中斷作業，Fetch 呼叫次數嚴格為 0。
   - 若勾選「記住此服務授權」，系統僅會記錄通訊協定、主機名稱、連接埠與路徑（Origin Key），**絕不保存任何經緯度座標、地址或查詢參數**。
3. **TGOS 地址定位與憑證安全**：
   - TGOS 臺灣地址定位需透過內政部 TGOS 官方服務完成，查詢時僅向官方 API 傳送必要之 AppID、APIKey 與查詢地址。
   - **AppID**：可由使用者授權保存在此瀏覽器的 `localStorage` 中以便後續使用。
   - **APIKey**：嚴格限定僅保存在目前瀏覽器分頁的 `sessionStorage`，**絕不寫入 localStorage、專案檔案（.gcp.json）、自動備份或任何永久儲存中**。一旦關閉分頁，APIKey 即刻從記憶體抹除。
   - 系統日誌、主控台（Console）與錯誤訊息全面脫敏，絕不印出含有 APIKey 之完整腳本 URL 或認證物件。
4. **一鍵撤銷與憑證清除**：
   - **清除 TGOS 憑證**：TGOS 面板提供「清除 TGOS 憑證」按鈕，點擊後會立即清空 `localStorage` 中的 AppID、`sessionStorage` 中的 APIKey、記憶體中的 API 簽章、介面輸入框，並將頁面動態注入之 TGOS 腳本標籤自 DOM 中徹底移除（已查詢之圖層與點位結果不受影響）。
   - **清除 OSRM 授權**：路網設定面板提供「清除外部服務授權記錄」功能，可隨時撤銷已記住的 OSRM 主機權限。
5. **前端 DOM 與 XSS 防禦機制**：
   - 全系統實作統一的 `SecurityUtils` 工具，對於圖層名稱、圖元屬性、自訂欄位與搜尋關鍵字，全面改採 W3C 標準 DOM API（`document.createElement`、`textContent`）或嚴格字元跳脫（Escape `&`, `<`, `>`, `"`, `'`），徹底杜絕 HTML/JavaScript/SVG 注入風險。
6. **瀏覽器本機儲存（LocalStorage / SessionStorage）限制**：
   - 瀏覽器 `localStorage` 通常具備約 5MB~10MB 配額限制。大量圖元、複雜幾何與歷史復原堆疊均受容量上限約束，建議使用者定期將重要成果透過「專案」選單導出為 `.gcp.json` 專案檔或 Shapefile/GeoJSON 封裝保存。

---

## 📦 第三方依賴版本表 (Third-Party CDN Dependencies)

所有外部 CDN 依賴已全面固定至明確版本，嚴格禁止使用 `@latest` 或浮動版本標籤：

| 套件名稱 | 鎖定版本 | CDN 載入路徑 | 用途說明 |
| :--- | :--- | :--- | :--- |
| **Leaflet CSS** | `1.9.4` | `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css` | 互動式地圖樣式 |
| **Leaflet Geoman CSS** | `2.14.2` | `https://unpkg.com/@geoman-io/leaflet-geoman-free@2.14.2/dist/leaflet-geoman.css` | 幾何向量繪製工具列樣式 |
| **Leaflet JS** | `1.9.4` | `https://unpkg.com/leaflet@1.9.4/dist/leaflet.js` | 核心地圖渲染引擎 |
| **Leaflet Geoman JS** | `2.14.2` | `https://unpkg.com/@geoman-io/leaflet-geoman-free@2.14.2/dist/leaflet-geoman.min.js` | 幾何繪圖與頂點編輯外掛 |
| **Turf.js** | `6.5.0` | `https://unpkg.com/@turf/turf@6.5.0/turf.min.js` | 空間幾何運算、拓樸相交與面積測量 |
| **JSZip** | `3.10.1` | `https://unpkg.com/jszip@3.10.1/dist/jszip.min.js` | KMZ 與 Shapefile ZIP 壓縮包解壓與封裝 |
| **shpjs** | `4.0.4` | `https://unpkg.com/shpjs@4.0.4/dist/shp.js` | Shapefile ZIP 前端讀取與 GeoJSON 轉換 |
| **@mapbox/shp-write** | `0.4.3` | `https://unpkg.com/@mapbox/shp-write@0.4.3/shpwrite.js` | 前端向量幾何匯出為 Shapefile ZIP |
| **@tmcw/togeojson** | `5.8.1` | `https://unpkg.com/@tmcw/togeojson@5.8.1/dist/togeojson.umd.js` | KML / KMZ 轉換為標準 GeoJSON |
| **PapaParse** | `5.4.1` | `https://unpkg.com/papaparse@5.4.1/papaparse.min.js` | CSV 檔案極速解析與結構化導出 |
| **wellknown** | `0.5.0` | `https://unpkg.com/wellknown@0.5.0/wellknown.js` | WKT (Well-Known Text) 雙向轉換 |
| **Lucide Icons** | `1.46.0` | `https://unpkg.com/lucide@1.46.0/dist/umd/lucide.min.js` | 現代化輕量向量圖示庫 |

---

## 🧪 自動化測試套件 (Automated Test Suites)

專案內建四套完全離線、不依賴外部服務、可重複執行的自動化測試腳本：

1. **路網分析核心測試 (`test_p2.js`)**：
   - 8 大測試集：200 點截斷與起終點角色重新正規化、多屏障繞行規劃、分段路由合併、Keyed DOM 原地更新、HTTP 退避重試與直線預覽狀態隔離。
   - 執行指令：`node test_p2.js`
2. **安全、隱私與注入防禦測試 (`test_security.js`)**：
   - 12 項安全檢驗：表格與屬性 DOM XSS 防禦、TGOS APIKey 記憶體隔離（絕不寫入 storage/專案檔）、OSRM 授權拒絕嚴格 0 傳輸、CDN 版本固定化檢驗。
   - 執行指令：`node test_security.js`
3. **空間處理與欄位計算器測試 (`test_geoprocessing.js`)**：
   - 35 項（43 個子測試）全功能檢驗：Buffer（點線面、融合、距離校驗）、Clip（線保持為線、面裁切、防呆）、Intersect（屬性前綴、BBox 篩選）、Merge（幾何家族一致性、欄位聯集）、Dissolve（全選/分組、錯誤隔離）、選取另存圖層（幾何分流、樣式屬性保留）、欄位計算器（AST 解析、零 eval/Function 原始碼證明、除以零 null 保護、四則運算、字串與幾何變數）、取消不留半成品圖層、Undo 完整復原。
   - 執行指令：`node test_geoprocessing.js`
4. **國際化多國語言完整性測試 (`test_i18n.js`)**：
   - 21 項測試：雙語辭典 100% 對稱性校驗、參數插值 (`I18n.t`)、語言切換與 localStorage 偏好保存、`onLanguageChange` 事件派送、Leaflet Geoman 同步、DOM 屬性即時轉換（`data-i18n`、`data-i18n-html`、`data-i18n-title`、`data-i18n-placeholder`、`data-i18n-aria`、`data-i18n-value`、`<title>` 標籤）、`index.html` 全數 i18n 鍵值雙向完整覆蓋驗證。
   - 執行指令：`node test_i18n.js`
