/* Proximity engine: distances, buffers and rings, and "what lies
 * inside" for any list of points. Shared by every profile and knowing none: Premise Lookup (S11) matches CVI
 * endpoints and facilities with it, the Emergency dashboard will match its own layers. Nothing here knows about CVIs or
 * facilities; the CVI rules (endpoints, counts, the intrastate collapse) live in cvi/app/lookup.js.
 *
 * The rules are CVI's run_proximity_query (shiny/R/map_helpers.R), so the results agree with CVI's:
 *   - the distance is geosphere's distHaversine on a sphere of radius 6,378,137 m, computed in the same order, then
 *     multiplied by 1/1000 as CVI does;
 *   - a point lies inside a site's buffer when its distance is at most the buffer (the edge counts);
 *   - a point or site is usable only with both numbers present, a latitude from -90 to 90 and a longitude from -180
 *     to 180; anything else never matches;
 *   - a site's buffer is its own when positive, else the default; its rings are its own band list, else the global
 *     list, else its one buffer; its outer ring is its match radius;
 *   - a match belongs to the smallest ring that holds it.
 *
 * Text is read as R's as.numeric reads it (number(v)): white space around a number is allowed; anything else is
 * missing.
 *
 * EARTH_RADIUS_M                 6378137
 * number(v) -> a number or null
 * usable(lat, lon) -> true when both are numbers within range
 * distanceKm(lat1, lon1, lat2, lon2) -> kilometers, or null when either point is not usable
 * parseRadii(x) -> the positive radii in x (a list, or text split at commas, semicolons and spaces), ascending and
 *   distinct, or null when there are none (CVI's .parse_bands)
 * ringOf(radii, km) -> the smallest radius at least km, else the largest
 * prepareSites(sites, { defaultKm, bands }) -> { sites, skipped, bandsMode }: the usable sites in order, each
 *   { id (1, 2, ...), name, lat, lon, bufferKm (the outer ring), bufferUser (its own positive buffer, else null),
 *   radii, zone, zoneBox }, and the number skipped. A site is { name, lat, long or lon, buffer_km, bands_csv, zone };
 *   bands_csv is its own band list (text or a list); zone a GeoJSON Polygon or MultiPolygon that replaces its circle
 *   (its radii are [0], so a point inside has distance 0 and ring 0, whatever the buffers and bands; its
 *   lat and lon are a point inside it, from zones.js; zoneBox its box, checked before the polygon).
 *   bands: the global band list (null for a single buffer). bandsMode: global bands given, or any site with a band
 *   list written (CVI's rule).
 * inZone(lon, lat, geometry) -> true inside a Polygon or MultiPolygon by the even-odd rule over all of a polygon's
 *   rings (so its holes are outside); a point exactly on an edge may fall either way
 * siteKm(lat, lon, site) -> the point's distance to the site (0 inside a zone, null outside it or when not usable)
 * match(points, sites) -> for each point ({ lat, lon }, or null), its hits in site order: [{ site (index), km }];
 *   a hit is a distance at most the site's bufferKm, or a point inside its zone (km 0)
 *
 * Drawing the buffers, as CVI's build_geodesic_buffers and build_band_annuli (map_helpers.R) draw them:
 * destination(lat, lon, km, bearing) -> [lon, lat], the point km away along a bearing (degrees from north) on the
 *   same sphere (geosphere's destPoint with r = 6,378,137 m), so a circle's vertices lie on the matching edge
 * circle(lat, lon, km, n) -> a closed ring of n + 1 [lon, lat] points (bearings 0 to 360; CVI: n = 360)
 * bandShapes(site, n) -> one GeoJSON Feature per radius of the site, smallest first: the innermost a full disk, each
 *   other one the ring between its radius and the one before (a polygon with a hole), with properties { site (its
 *   id), name, innerKm, outerKm, bandKm }; none for a zone site (its polygon is drawn as it is)
 */
(function (root) {
  'use strict';

  const EARTH_RADIUS_M = 6378137;
  const TO_RAD = Math.PI / 180;
  const KM_PER_METER = 1 / 1000;

  // R's as.numeric on one value: a number stays (NaN becomes missing); text with optional white space around a
  // decimal, exponent, hexadecimal or infinite number is read; anything else is missing.
  function number(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isNaN(v) ? null : v;
    const s = String(v).trim();
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
    if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(s)) return (s[0] === '-' ? -1 : 1) * parseInt(s.replace(/^[+-]/, ''), 16);
    if (/^[+-]?(inf|infinity)$/i.test(s)) return s[0] === '-' ? -Infinity : Infinity;
    return null;
  }
  // True for a latitude and longitude that are both numbers within range.
  const usable = (lat, lon) => lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  // geosphere::distHaversine, step by step (the point first, the site second, as CVI calls distm).
  function distanceKm(lat1, lon1, lat2, lon2) {
    if (!usable(lat1, lon1) || !usable(lat2, lon2)) return null;
    const p1 = lat1 * TO_RAD, l1 = lon1 * TO_RAD, p2 = lat2 * TO_RAD, l2 = lon2 * TO_RAD;
    const dLat = p2 - p1;
    const dLon = l2 - l1;
    const sLat = Math.sin(dLat / 2), sLon = Math.sin(dLon / 2);
    let a = sLat * sLat + Math.cos(p1) * Math.cos(p2) * (sLon * sLon);
    a = Math.min(a, 1);
    const meters = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * EARTH_RADIUS_M;
    return meters * KM_PER_METER;
  }

  // CVI's .parse_bands: every value pasted together, split at commas, semicolons and white space, read as numbers;
  // the finite positive ones, ascending and distinct.
  function parseRadii(x) {
    if (x === null || x === undefined) return null;
    const list = Array.isArray(x) ? x : [x];
    if (list.every(v => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)))) return null;
    const text = list.map(v => (v === null || v === undefined ? 'NA' : String(v))).join(',');
    const v = text.split(/[,;\s]+/).map(number).filter(n => n !== null && Number.isFinite(n) && n > 0);
    if (!v.length) return null;
    return [...new Set(v)].sort((p, q) => p - q);
  }

  // The smallest radius that holds the distance, or the largest radius when none does.
  function ringOf(radii, km) {
    const enclosing = radii.filter(r => r >= km);
    return enclosing.length ? Math.min(...enclosing) : Math.max(...radii);
  }

  // The sites with usable coordinates, each with its ring radii in km; also counts the skipped sites and says
  // whether bands are in use.
  function prepareSites(list, opts) {
    const o = opts || {};
    const defaultKm = number(o.defaultKm);
    const global = parseRadii(o.bands);
    const out = [];
    let skipped = 0;
    let written = false;
    for (const s of list || []) {
      const lat = number(s.lat);
      const lon = number(s.long !== undefined ? s.long : s.lon);
      if (!usable(lat, lon)) {
        skipped++;
        continue;
      }
      const own = number(s.buffer_km);
      const bufferUser = own === null || own <= 0 ? null : own;
      const buffer = bufferUser === null ? defaultKm : bufferUser;
      const text = s.bands_csv === undefined || s.bands_csv === null ? null : s.bands_csv;
      if (text !== null && String(text) !== '') written = true;
      // A zone site matches inside its polygon only: one ring of 0 km, whatever the buffers and bands.
      const zone = s.zone || null;
      const radii = zone ? [0] : parseRadii(text) || global || [buffer];
      out.push({ id: out.length + 1, name: s.name, lat, lon, bufferKm: Math.max(...radii), bufferUser: zone ? null : bufferUser,
        radii, zone, zoneBox: zone ? boxOf(zone) : null });
    }
    return { sites: out, skipped, bandsMode: global !== null || written };
  }

  // The even-odd rule over one ring of [lon, lat] points (closed or not).
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // True when the point lies inside the zone (a Polygon or MultiPolygon), holes counted by the even-odd rule.
  function inZone(lon, lat, g) {
    if (!g || lat === null || lon === null) return false;
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polygons.some(rings => rings.reduce((k, ring) => (inRing(lon, lat, ring) ? !k : k), false));
  }

  // A zone's box [west, south, east, north], so most points are ruled out before the polygon test.
  function boxOf(g) {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    polygons.forEach(rings => rings.forEach(ring => ring.forEach(p => {
      box[0] = Math.min(box[0], p[0]); box[1] = Math.min(box[1], p[1]);
      box[2] = Math.max(box[2], p[0]); box[3] = Math.max(box[3], p[1]);
    })));
    return box;
  }

  // The distance from a point to a site in km; for a zone site, 0 inside the zone and null outside it.
  function siteKm(lat, lon, site) {
    if (site.zone) {
      const b = site.zoneBox;
      if (!usable(lat, lon) || (b && (lon < b[0] || lat < b[1] || lon > b[2] || lat > b[3]))) return null;
      return inZone(lon, lat, site.zone) ? 0 : null;
    }
    return distanceKm(lat, lon, site.lat, site.lon);
  }

  // For each point, the sites whose buffer holds it: [{ site (its index), km }].
  function match(points, sites) {
    return points.map(p => {
      const hits = [];
      if (!p) return hits;
      const lat = number(p.lat), lon = number(p.lon);
      if (!usable(lat, lon)) return hits;
      sites.forEach((s, k) => {
        const km = siteKm(lat, lon, s);
        if (km !== null && km <= s.bufferKm) hits.push({ site: k, km });
      });
      return hits;
    });
  }

  // geosphere::destPoint on a sphere: the start, a bearing and a distance give the end point; its longitude is
  // brought back into -180 to 180.
  function destination(lat, lon, km, bearing) {
    const d = (km * 1000) / EARTH_RADIUS_M;
    const p1 = lat * TO_RAD, l1 = lon * TO_RAD, b = bearing * TO_RAD;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    const lonDeg = ((l2 / TO_RAD + 540) % 360) - 180;
    return [lonDeg, p2 / TO_RAD];
  }

  // A closed ring of points (360 steps by default) at the distance around the center.
  function circle(lat, lon, km, n) {
    const steps = n || 360;
    const ring = [];
    for (let i = 0; i <= steps; i++) ring.push(destination(lat, lon, km, (360 * i) / steps));
    ring[steps] = ring[0].slice();   // closed exactly
    return ring;
  }

  // A site's bands as GeoJSON polygons, each with the next smaller ring cut out; none for a zone site.
  function bandShapes(site, n) {
    if (site.zone) return [];
    const radii = site.radii;
    return radii.map((r, i) => {
      const rings = [circle(site.lat, site.lon, r, n)];
      if (i > 0) rings.push(circle(site.lat, site.lon, radii[i - 1], n).reverse());
      return { type: 'Feature', geometry: { type: 'Polygon', coordinates: rings },
        properties: { site: site.id, name: site.name, innerKm: i > 0 ? radii[i - 1] : 0, outerKm: r, bandKm: r } };
    });
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.proximity = {
    EARTH_RADIUS_M, number, usable, distanceKm, parseRadii, ringOf, prepareSites, inZone, siteKm, match,
    destination, circle, bandShapes
  };
})(typeof window !== 'undefined' ? window : globalThis);
