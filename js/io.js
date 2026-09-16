/**
 * GeoCanvas GIS Tool - Data Import & Export Engine
 * Supports KML, SHP (ZIP), CSV (WKT & Lat/Lng), and GeoJSON
 */

const IOManager = {
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
    return geojson;
  },

  /**
   * Parse KMZ (zipped KML) from an ArrayBuffer to GeoJSON FeatureCollection
   */
  async parseKMZ(arrayBuffer) {
    if (typeof JSZip === 'undefined') {
      throw new Error('系統缺少 JSZip 函式庫，無法解析 KMZ 檔案！');
    }
    try {
      const zip = await JSZip.loadAsync(arrayBuffer);
      const kmlEntry = Object.values(zip.files).find(f => /\.kml$/i.test(f.name) && !f.dir);
      if (!kmlEntry) {
        throw new Error('KMZ 壓縮檔內未找到有效的 .kml 文件！');
      }
      const kmlText = await kmlEntry.async('string');
      return this.parseKML(kmlText);
    } catch (err) {
      console.error('KMZ 解析錯誤:', err);
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
        return {
          type: 'FeatureCollection',
          features: mergedFeatures
        };
      }
      return result;
    } catch (err) {
      console.error('SHP 解析錯誤:', err);
      throw new Error(`Shapefile ZIP 解析失敗: ${err.message || '請確認壓縮檔內含有 .shp 與 .dbf 等檔案'}`);
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

    parsed.data.forEach((row, idx) => {
      let geometry = null;

      // 1. Try WKT
      if (wktCol && row[wktCol]) {
        try {
          geometry = wellknown.parse(row[wktCol].trim());
        } catch (e) {
          console.warn(`第 ${idx + 1} 列 WKT 解析失敗:`, row[wktCol]);
        }
      }

      // 2. Try Lat / Lon
      if (!geometry && latCol && lonCol) {
        const latVal = parseFloat(row[latCol]);
        const lonVal = parseFloat(row[lonCol]);
        if (!isNaN(latVal) && !isNaN(lonVal) && Math.abs(latVal) <= 90 && Math.abs(lonVal) <= 180) {
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
      }
    });

    if (features.length === 0) {
      throw new Error('未在 CSV 中偵測到可用的空間資料！請確認含有 WKT 欄位（如 wkt/geometry）或經緯度欄位（如 lat/lon/x/y）。');
    }

    return {
      type: 'FeatureCollection',
      features: features
    };
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
        return data;
      } else if (data.type === 'Feature') {
        return { type: 'FeatureCollection', features: [data] };
      } else if (data.type && data.coordinates) {
        // Geometry object
        return {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: data, properties: { name: '已匯入圖元' } }]
        };
      }
      throw new Error('檔案非有效的 GeoJSON 格式！');
    } catch (e) {
      throw new Error(`GeoJSON 解析失敗: ${e.message}`);
    }
  }
};
