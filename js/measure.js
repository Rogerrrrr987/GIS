/**
 * GeoCanvas GIS Tool - Measurement & Geometry Calculations
 */

const MeasureUtil = {
  /**
   * Format length into readable string (m or km)
   */
  formatLength(meters) {
    if (meters < 1000) {
      return `${meters.toFixed(1)} 公尺 (m)`;
    }
    return `${(meters / 1000).toFixed(3)} 公里 (km)`;
  },

  /**
   * Format area into readable string (m², km², 公頃, 坪)
   */
  formatArea(sqMeters) {
    const ping = (sqMeters / 3.305785).toFixed(1);
    const ha = (sqMeters / 10000).toFixed(3);
    if (sqMeters < 10000) {
      return `${sqMeters.toFixed(1)} 平方公尺 (${ping} 坪)`;
    }
    return `${(sqMeters / 1000000).toFixed(4)} 平方公里 (${ha} 公頃 / ${ping} 坪)`;
  },

  /**
   * Format coordinates
   */
  formatCoords(lat, lng) {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  },

  /**
   * Calculate total length of polyline from Leaflet LatLng array (meters)
   * Uses Leaflet's built-in distanceTo which implements Haversine.
   * @param {Array} latlngs Array of L.LatLng objects
   */
  calculateLength(latlngs) {
    if (!latlngs || latlngs.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < latlngs.length - 1; i++) {
      total += latlngs[i].distanceTo(latlngs[i + 1]);
    }
    return total;
  },

  /**
   * Calculate polygon area from Leaflet LatLng array (square meters)
   * Converts to GeoJSON and delegates to Turf.js for accurate geodesic area.
   * @param {Array} latlngs Array of L.LatLng objects (outer ring)
   */
  calculateArea(latlngs) {
    if (!latlngs || latlngs.length < 3) return 0;
    try {
      const coords = latlngs.map(p => [p.lng, p.lat]);
      // Ensure ring is closed
      if (coords[0][0] !== coords[coords.length - 1][0] ||
          coords[0][1] !== coords[coords.length - 1][1]) {
        coords.push(coords[0]);
      }
      return turf.area(turf.polygon([coords]));
    } catch (e) {
      console.warn('Area calculation error:', e);
      return 0;
    }
  }
};

if (typeof window !== 'undefined') window.MeasureUtil = MeasureUtil;
if (typeof global !== 'undefined') global.MeasureUtil = MeasureUtil;

