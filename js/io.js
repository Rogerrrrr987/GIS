/**
 * GeoCanvas GIS Tool - Data Import & Export Engine
 * Supports KML, SHP (ZIP), CSV (WKT & Lat/Lng), and GeoJSON
 */

const IOManager = {
  importLimits: { fileBytes: 25 * 1024 * 1024, expandedBytes: 100 * 1024 * 1024, entries: 500, features: 20000, positions: 500000 },
  importNotes: new WeakMap(),
  importInProgress: false,

  async readImportFile(file) {
    if (!file || !Number.isFinite(file.size) || file.size <= 0) throw new Error('檔案為空或無法讀取。');
    if (file.size > this.importLimits.fileBytes) throw new Error('檔案超過 25 MB 安全上限，請先分割資料。');
    const ext = file.name.split('.').pop().toLowerCase();
    let geojson;
    if (ext === 'zip') geojson = await this.parseShapefileZip(await file.arrayBuffer());
    else if (ext === 'kmz') geojson = await this.parseKMZ(await file.arrayBuffer());
    else if (ext === 'kml') geojson = this.parseKML(await file.text());
    else if (ext === 'csv' || ext === 'txt') geojson = this.parseCSV(await file.text());
    else if (ext === 'json' || ext === 'geojson') geojson = this.parseGeoJSON(await file.text());
    else throw new Error('不支援的格式，請選擇 KML、KMZ、SHP ZIP、CSV 或 GeoJSON。');
    this.validateFeatureCollection(geojson);
    const warnings = [...(this.importNotes.get(geojson) || [])];
    if (geojson.features.length > 2000) warnings.push('超過 2,000 個圖徵，繪製可能需要較長時間；建議分割資料。');
    const crsLabel = warnings.some(note => note.includes('缺少 .prj')) ? '來源坐標系統未確認（缺少 .prj）' : null;
    return { geojson, warnings, crsLabel, fileBytes: file.size, ext };
  },

  validateFeatureCollection(fc) {
    if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features) || !fc.features.length) throw new Error('沒有可匯入的圖徵，不會建立空圖層。');
    if (fc.features.length > this.importLimits.features) throw new Error('圖徵超過 20,000 筆安全上限，請分割資料。');
    const crs = fc.crs?.properties?.name || fc.crs?.name;
    if (crs && !/(?:EPSG(?::|\/0\/)4326$|CRS84$)/i.test(String(crs))) throw new Error('資料宣告的坐標系統不是 WGS84，請先轉換為 EPSG:4326；系統不會猜測投影。');
    let positions = 0;
    const position = p => {
      if (!Array.isArray(p) || p.length < 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) throw new Error('坐標無效或超出經緯度範圍；請檢查欄位順序與投影。');
      if (++positions > this.importLimits.positions) throw new Error('坐標節點超過 500,000 個安全上限，請簡化或分割資料。');
    };
    const line = (coords, min) => {
      if (!Array.isArray(coords) || coords.length < min) throw new Error('幾何坐標數量不足。');
      coords.forEach(position);
    };
    const polygon = coords => {
      if (!Array.isArray(coords) || !coords.length) throw new Error('多邊形沒有有效環。');
      coords.forEach(ring => {
        line(ring, 4);
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) throw new Error('多邊形環未閉合，請修復原始資料。');
      });
    };
    const geometry = (g, depth = 0) => {
      if (!g || depth > 16) throw new Error('空幾何或幾何巢狀層數過多。');
      const c = g.coordinates;
      switch (g.type) {
        case 'Point': position(c); break;
        case 'MultiPoint': line(c, 1); break;
        case 'LineString': line(c, 2); break;
        case 'Polygon': polygon(c); break;
        case 'MultiLineString':
        case 'MultiPolygon':
          if (!Array.isArray(c) || !c.length) throw new Error('空的多重幾何。');
          c.forEach(part => g.type === 'MultiPolygon' ? polygon(part) : line(part, 2)); break;
        case 'GeometryCollection':
          if (!Array.isArray(g.geometries) || !g.geometries.length) throw new Error('空的幾何集合。');
          g.geometries.forEach(part => geometry(part, depth + 1)); break;
        default: throw new Error('不支援或缺少幾何類型。');
      }
    };
    fc.features.forEach((f, i) => {
      try {
        if (f?.type !== 'Feature' || (f.properties != null && (typeof f.properties !== 'object' || Array.isArray(f.properties)))) throw new Error('圖徵或屬性結構錯誤。');
        geometry(f.geometry);
      } catch (error) { throw new Error(`第 ${i + 1} 個圖徵：${error.message}`); }
    });
    return fc;
  },

  async openImportZip(buffer) {
    if (buffer.byteLength > this.importLimits.fileBytes) throw new Error('ZIP 超過 25 MB 安全上限。');
    let zip;
    try { zip = await JSZip.loadAsync(buffer); }
    catch (_) { throw new Error('壓縮檔損壞或格式不正確，請重新壓縮。'); }
    const files = Object.values(zip.files).filter(entry => !entry.dir);
    if (!files.length || files.length > this.importLimits.entries) throw new Error('壓縮檔為空或超過 500 個檔案安全上限。');
    let total = 0;
    for (const entry of files) {
      // JSZip 3.x stores central-directory sizes on compressed entries, before inflation.
      const size = entry._data?.uncompressedSize;
      if (!Number.isFinite(size) || size < 0) throw new Error('無法確認解壓縮大小，已停止匯入。');
      total += size;
      if (total > this.importLimits.expandedBytes) throw new Error('解壓縮內容超過 100 MB 安全上限，請分割檔案。');
    }
    return { zip, files };
  },
  /**
   * Helper: Trigger browser file download
   */
  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },

  /**
   * Helper: Download text file with optional BOM (essential for Excel CSV UTF-8)
   */
  downloadText(text, filename, mimeType = 'text/plain', addBom = false) {
    const parts = addBom ? ['\uFEFF', text] : [text];
    const blob = new Blob(parts, { type: `${mimeType};charset=utf-8` });
    this.downloadBlob(blob, filename);
  },

  /**
   * Convert Hex Color (#RRGGBB) + Opacity (0~1) to KML Color format (AABBGGRR)
   */
  hexToKmlColor(hex = '#3b82f6', opacity = 0.8) {
    let cleanHex = hex.replace('#', '');
    if (cleanHex.length === 3) {
      cleanHex = cleanHex.split('').map(c => c + c).join('');
    }
    const r = cleanHex.substring(0, 2);
    const g = cleanHex.substring(2, 4);
    const b = cleanHex.substring(4, 6);
    const a = Math.round(opacity * 255).toString(16).padStart(2, '0');
    return `${a}${b}${g}${r}`.toLowerCase();
  },

  /**
   * Escape XML entities
   */
  escapeXml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  },

  // =========================================================================
  // KML IMPORT & EXPORT
  // =========================================================================

  /**
   * Export FeatureCollection to KML 2.2
   */
  exportKML(featureCollection, filename = 'geocanvas_export.kml') {
    if (!featureCollection || !featureCollection.features || featureCollection.features.length === 0) {
      throw new Error('目前沒有可匯出的圖元資料！');
    }

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<kml xmlns="http://www.opengis.net/kml/2.2">\n`;
    xml += `  <Document>\n`;
    xml += `    <name>${this.escapeXml(filename.replace(/\.kml$/i, ''))}</name>\n`;
    xml += `    <description>Exported from GeoCanvas GIS Tool</description>\n`;

    // Write Styles and Placemarks
    featureCollection.features.forEach((feature, index) => {
      const props = feature.properties || {};
      const style = props.style || {};
      const strokeColor = this.hexToKmlColor(style.color || '#2563eb', 1.0);
      const fillColor = this.hexToKmlColor(style.fillColor || style.color || '#3b82f6', style.fillOpacity !== undefined ? style.fillOpacity : 0.4);
      const strokeWidth = style.weight || 3;
      const styleId = `style_feat_${index}`;

      // Style definition
      xml += `    <Style id="${styleId}">\n`;
      xml += `      <LineStyle>\n`;
      xml += `        <color>${strokeColor}</color>\n`;
      xml += `        <width>${strokeWidth}</width>\n`;
      xml += `      </LineStyle>\n`;
      xml += `      <PolyStyle>\n`;
      xml += `        <color>${fillColor}</color>\n`;
      xml += `        <fill>1</fill>\n`;
      xml += `        <outline>1</outline>\n`;
      xml += `      </PolyStyle>\n`;
      xml += `    </Style>\n`;

      // Placemark
      xml += `    <Placemark>\n`;
      xml += `      <name>${this.escapeXml(props.name || `圖元 #${index + 1}`)}</name>\n`;
      if (props.description) {
        xml += `      <description>${this.escapeXml(props.description)}</description>\n`;
      }
      xml += `      <styleUrl>#${styleId}</styleUrl>\n`;

      // ExtendedData for properties
      const customKeys = Object.keys(props).filter(k => !['name', 'description', 'style', 'id', '_measure'].includes(k));
      if (customKeys.length > 0) {
        xml += `      <ExtendedData>\n`;
        customKeys.forEach(k => {
          xml += `        <Data name="${this.escapeXml(k)}">\n`;
          xml += `          <value>${this.escapeXml(props[k])}</value>\n`;
          xml += `        </Data>\n`;
        });
        xml += `      </ExtendedData>\n`;
      }

      // Geometry
      const geom = feature.geometry;
      if (geom) {
        if (geom.type === 'Point') {
          xml += `      <Point>\n`;
          xml += `        <coordinates>${geom.coordinates[0]},${geom.coordinates[1]},0</coordinates>\n`;
          xml += `      </Point>\n`;
        } else if (geom.type === 'LineString') {
          xml += `      <LineString>\n`;
          xml += `        <tessellate>1</tessellate>\n`;
          const coordsStr = geom.coordinates.map(c => `${c[0]},${c[1]},0`).join(' ');
          xml += `        <coordinates>${coordsStr}</coordinates>\n`;
          xml += `      </LineString>\n`;
        } else if (geom.type === 'Polygon') {
          xml += `      <Polygon>\n`;
          xml += `        <tessellate>1</tessellate>\n`;
          // Outer boundary
          if (geom.coordinates[0]) {
            xml += `        <outerBoundaryIs>\n`;
            xml += `          <LinearRing>\n`;
            const coordsStr = geom.coordinates[0].map(c => `${c[0]},${c[1]},0`).join(' ');
            xml += `            <coordinates>${coordsStr}</coordinates>\n`;
            xml += `          </LinearRing>\n`;
            xml += `        </outerBoundaryIs>\n`;
          }
          // Inner holes (if any)
          for (let h = 1; h < geom.coordinates.length; h++) {
            xml += `        <innerBoundaryIs>\n`;
            xml += `          <LinearRing>\n`;
            const holeStr = geom.coordinates[h].map(c => `${c[0]},${c[1]},0`).join(' ');
            xml += `            <coordinates>${holeStr}</coordinates>\n`;
            xml += `          </LinearRing>\n`;
            xml += `        </innerBoundaryIs>\n`;
          }
          xml += `      </Polygon>\n`;
        }
      }

      xml += `    </Placemark>\n`;
    });

    xml += `  </Document>\n`;
    xml += `</kml>\n`;

    this.downloadText(xml, filename, 'application/vnd.google-earth.kml+xml');
  },

  /**
   * Parse KML string or DOM to GeoJSON FeatureCollection
   */
  parseKML(kmlText) {
    if (/<!DOCTYPE|<!ENTITY/i.test(kmlText)) throw new Error('KML 含有不支援的 DTD／實體宣告，已停止解析。');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(kmlText, 'text/xml');
    
    // Check for parse error
    const parserError = xmlDoc.getElementsByTagName('parsererror');
    if (parserError.length > 0) {
      throw new Error('KML 格式解析失敗，檔案內容可能不完整或格式錯誤！');
    }

    const geojson = toGeoJSON.kml(xmlDoc);
    // Enrich feature properties
    geojson.features.forEach((feat, i) => {
      if (!feat.properties) feat.properties = {};
      if (!feat.properties.name) {
        feat.properties.name = feat.properties.title || `KML 圖元 #${i + 1}`;
      }
    });
    return this.validateFeatureCollection(geojson);
  },

  /**
   * Parse KMZ (zipped KML) from an ArrayBuffer to GeoJSON FeatureCollection
   */
  async parseKMZ(arrayBuffer) {
    if (typeof JSZip === 'undefined') {
      throw new Error('系統缺少 JSZip 函式庫，無法解析 KMZ 檔案！');
    }
    try {
      const { files } = await this.openImportZip(arrayBuffer);
      const candidates = files.filter(f => /\.kml$/i.test(f.name));
      const kmlEntry = candidates.find(f => /^doc\.kml$/i.test(f.name)) || candidates[0];
      if (candidates.length > 1 && !candidates.some(f => /^doc\.kml$/i.test(f.name))) throw new Error('KMZ 含多個 KML 且沒有根目錄 doc.kml，請明確選擇並匯出單一 KML。');
      if (!kmlEntry) {
        throw new Error('KMZ 壓縮檔內未找到有效的 .kml 文件！');
      }
      const kmlText = await kmlEntry.async('string');
      return this.parseKML(kmlText);
    } catch (err) {
      throw new Error(`KMZ 解析失敗: ${err.message || '檔案可能損壞或非標準 KMZ'}`);
    }
  },

  // =========================================================================
  // SHAPEFILE (SHP) IMPORT & EXPORT
  // =========================================================================

  /**
   * Import SHP from a ZIP file (ArrayBuffer)
   */
  async parseShapefileZip(arrayBuffer) {

    try {
      const { files } = await this.openImportZip(arrayBuffer);
      const shapes = files.filter(f => /\.shp$/i.test(f.name));
      if (!shapes.length) throw new Error('ZIP 缺少 .shp 主檔，請選擇包含 Shapefile 的壓縮檔。');
      const names = new Map(files.map(f => [f.name.toLowerCase(), f]));
      const warnings = [];
      for (const shape of shapes) {
        const stem = shape.name.slice(0, -4).toLowerCase();
        if (!names.has(`${stem}.dbf`)) throw new Error(`「${shape.name}」缺少同名 .dbf 屬性檔，請重新匯出完整 Shapefile。`);
        if (!names.has(`${stem}.shx`)) warnings.push(`「${shape.name}」缺少 .shx 索引；解析器可順序讀取，但建議提供完整檔案。`);
        const prj = names.get(`${stem}.prj`);
        if (!prj) warnings.push(`「${shape.name}」缺少 .prj，來源坐標系統不明；僅在確認原始資料為 WGS84 經緯度時繼續。`);
        else {
          const text = (await prj.async('string')).trim();
          if (!/^(?:GEOGCS|PROJCS|GEODCRS|GEOGCRS|PROJCRS)\s*\[/i.test(text)) throw new Error(`「${shape.name}」的 .prj 無法辨識，請重新匯出投影資訊。`);
          warnings.push(`「${shape.name}」依 .prj 由 SHP 解析器處理坐標轉換；匯入後請核對位置。`);
        }
      }
      const result = await shp(arrayBuffer);
      // shp() can return a single GeoJSON or an array of GeoJSONs (multi-layer)
      if (Array.isArray(result)) {
        // Merge all layers into one FeatureCollection
        const mergedFeatures = [];
        result.forEach(layer => {
          if (layer.features) {
            mergedFeatures.push(...layer.features);
          }
        });
        const merged = {
          type: 'FeatureCollection',
          features: mergedFeatures
        };
        this.importNotes.set(merged, warnings);
        return this.validateFeatureCollection(merged);
      }
      this.importNotes.set(result, warnings);
      return this.validateFeatureCollection(result);
    } catch (err) {
      throw new Error(`Shapefile ZIP 解析失敗: ${String(err.message || '請重新匯出完整檔案').slice(0, 240)}`);
    }
  },

  /**
   * Export FeatureCollection to Shapefile ZIP
   */
  exportShapefileZip(featureCollection, filename = 'geocanvas_shapefile.zip') {
    if (!featureCollection || !featureCollection.features || featureCollection.features.length === 0) {
      throw new Error('目前沒有可匯出的圖元資料！');
    }

    // Sanitize feature properties for DBF format (DBF field names <= 10 chars, ASCII)
    const sanitizedFeatures = featureCollection.features.map((feat, idx) => {
      const origProps = feat.properties || {};
      const newProps = {};

      // standard properties
      newProps['id'] = idx + 1;
      newProps['name'] = String(origProps.name || `Feat_${idx + 1}`).substring(0, 50);
      if (origProps.description) {
        newProps['desc'] = String(origProps.description).substring(0, 100);
      }

      // custom properties
      let counter = 1;
      for (const [k, v] of Object.entries(origProps)) {
        if (['name', 'description', 'style', 'id', '_measure'].includes(k)) continue;
        let dbfKey = k.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 10);
        if (!dbfKey || newProps[dbfKey]) {
          dbfKey = `col_${counter++}`;
        }
        newProps[dbfKey] = typeof v === 'object' ? JSON.stringify(v).substring(0, 100) : String(v).substring(0, 100);
      }

      return {
        type: 'Feature',
        geometry: feat.geometry,
        properties: newProps
      };
    });

    const exportCollection = {
      type: 'FeatureCollection',
      features: sanitizedFeatures
    };

    const zipOptions = {
      folder: filename.replace(/\.zip$/i, ''),
      types: {
        point: 'points',
        polygon: 'polygons',
        line: 'lines'
      }
    };

    try {
      shpwrite.download(exportCollection, zipOptions);
    } catch (err) {
      console.error('Shapefile 匯出失敗:', err);
      throw new Error(`Shapefile 匯出失敗: ${err.message}`);
    }
  },

  // =========================================================================
  // CSV IMPORT & EXPORT
  // =========================================================================

  /**
   * Export FeatureCollection to CSV (includes WKT and Lat/Lng)
   */
  exportCSV(featureCollection, filename = 'geocanvas_export.csv') {
    if (!featureCollection || !featureCollection.features || featureCollection.features.length === 0) {
      throw new Error('目前沒有可匯出的圖元資料！');
    }

    const rows = [];
    const allCustomKeys = new Set();

    // First collect all custom keys
    featureCollection.features.forEach(f => {
      if (f.properties) {
        Object.keys(f.properties).forEach(k => {
          if (!['style', '_measure'].includes(k)) {
            allCustomKeys.add(k);
          }
        });
      }
    });

    featureCollection.features.forEach((feature, idx) => {
      const geom = feature.geometry;
      const props = feature.properties || {};

      // Stringify geometry to WKT
      let wktStr = '';
      if (geom) {
        try {
          wktStr = wellknown.stringify(geom);
        } catch (e) {
          console.warn('WKT stringify failed:', e);
        }
      }

      // Lat & Lng coordinates for quick display
      let lat = '';
      let lng = '';
      if (geom) {
        if (geom.type === 'Point') {
          lng = geom.coordinates[0];
          lat = geom.coordinates[1];
        } else {
          try {
            const centroid = turf.centroid(feature);
            lng = centroid.geometry.coordinates[0].toFixed(6);
            lat = centroid.geometry.coordinates[1].toFixed(6);
          } catch (e) {}
        }
      }

      const row = {
        id: idx + 1,
        name: props.name || `圖元 #${idx + 1}`,
        geom_type: geom ? geom.type : 'Unknown',
        latitude: lat,
        longitude: lng,
        wkt: wktStr,
        description: props.description || ''
      };

      allCustomKeys.forEach(key => {
        if (!['id', 'name', 'geom_type', 'latitude', 'longitude', 'wkt', 'description'].includes(key)) {
          row[key] = props[key] !== undefined ? props[key] : '';
        }
      });

      rows.push(row);
    });

    const csvContent = Papa.unparse(rows);

    // Always add UTF-8 BOM so Excel opens Chinese text flawlessly!
    this.downloadText(csvContent, filename, 'text/csv', true);
  },

  /**
   * Parse CSV content into FeatureCollection
   * Auto detects WKT or Latitude/Longitude columns
   */
  parseCSV(csvText) {

    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true
    });
    if (parsed.errors?.length) throw new Error(`CSV 結構錯誤（資料列 ${(parsed.errors[0].row ?? 0) + 1}），請檢查引號及欄位數量。`);

    if (!parsed.data || parsed.data.length === 0) {
      throw new Error('CSV 檔案內無有效資料列！');
    }

    const fields = parsed.meta.fields || Object.keys(parsed.data[0]);
    
    // Find WKT column
    const wktCol = fields.find(f => /^(wkt|geometry|geom|the_geom|shape)$/i.test(f.trim()));

    // Find Latitude & Longitude columns
    const latCol = fields.find(f => /^(lat|latitude|y|y_coord|緯度|纬度)$/i.test(f.trim()));
    const lonCol = fields.find(f => /^(lon|lng|long|longitude|x|x_coord|經度|经度)$/i.test(f.trim()));

    const features = [];
    const invalidRows = [];

    parsed.data.forEach((row, idx) => {
      let geometry = null;

      // 1. Try WKT
      if (wktCol && row[wktCol]) {
        try {
          geometry = wellknown.parse(row[wktCol].trim());
        } catch (e) {
          // Do not log raw properties or coordinate strings.
        }
        if (!geometry) { invalidRows.push(idx + 1); return; }
      }

      // 2. Try Lat / Lon
      if (!geometry && latCol && lonCol) {
        const strictNumber = value => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value ?? '').trim()) ? Number(value) : NaN;
        const latVal = strictNumber(row[latCol]);
        const lonVal = strictNumber(row[lonCol]);
        if (Number.isFinite(latVal) && Number.isFinite(lonVal) && Math.abs(latVal) <= 90 && Math.abs(lonVal) <= 180) {
          geometry = {
            type: 'Point',
            coordinates: [lonVal, latVal]
          };
        }
      }

      if (geometry) {
        // Collect attributes
        const properties = {};
        for (const [k, v] of Object.entries(row)) {
          if (k !== wktCol) {
            properties[k] = v;
          }
        }
        if (!properties.name) {
          properties.name = properties.title || `CSV 記錄 #${idx + 1}`;
        }
        features.push({
          type: 'Feature',
          geometry: geometry,
          properties: properties
        });
      } else invalidRows.push(idx + 1);
    });

    if (invalidRows.length) throw new Error(`CSV 有 ${invalidRows.length} 筆無效空間資料（資料列 ${invalidRows.slice(0, 10).join('、')}${invalidRows.length > 10 ? '…' : ''}）。請檢查空值、數字、WKT、經緯度欄位及範圍；未匯入任何資料。`);

    if (features.length === 0) {
      throw new Error('未在 CSV 中偵測到可用的空間資料！請確認含有 WKT 欄位（如 wkt/geometry）或經緯度欄位（如 lat/lon/x/y）。');
    }

    return this.validateFeatureCollection({
      type: 'FeatureCollection',
      features: features
    });
  },

  // =========================================================================
  // GEOJSON IMPORT & EXPORT
  // =========================================================================

  /**
   * Export GeoJSON
   */
  exportGeoJSON(featureCollection, filename = 'geocanvas_export.geojson') {
    if (!featureCollection || !featureCollection.features || featureCollection.features.length === 0) {
      throw new Error('目前沒有可匯出的圖元資料！');
    }
    const jsonStr = JSON.stringify(featureCollection, null, 2);
    this.downloadText(jsonStr, filename, 'application/geo+json');
  },

  /**
   * Parse GeoJSON
   */
  parseGeoJSON(jsonText) {
    try {
      const data = JSON.parse(jsonText);
      if (data.type === 'FeatureCollection') {
        return this.validateFeatureCollection(data);
      } else if (data.type === 'Feature') {
        return this.validateFeatureCollection({ type: 'FeatureCollection', features: [data], crs: data.crs });
      } else if (data.type && data.coordinates) {
        // Geometry object
        return this.validateFeatureCollection({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: data, properties: { name: '已匯入圖元' } }]
        });
      }
      throw new Error('檔案非有效的 GeoJSON 格式！');
    } catch (e) {
      throw new Error(e instanceof SyntaxError ? 'GeoJSON JSON 語法錯誤，請檢查檔案是否完整。' : `GeoJSON 解析失敗: ${e.message}`);
    }
  }
};
