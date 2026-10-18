/* Zone files: polygons a user loads to match against in place of a
 * site's circle, such as an imported control area or premises footprints. Read in the browser the F1 way: the file is
 * recognized from its name and first bytes, read here, and never sent anywhere. Shared by every profile and knowing
 * none: Premise Lookup (S11) turns each zone into a site (proximity.js tests points against it), the Emergency
 * dashboard will reuse it.
 *
 * Formats:
 *   - GeoJSON (.geojson, .json): a FeatureCollection, a Feature or a bare geometry; Polygon and MultiPolygon shapes
 *     (also inside a GeometryCollection, at most 20 levels deep); other shapes are left out and counted. A "crs" member
 *     other than longitude and latitude (CRS84, EPSG 4326 or 4269) is refused.
 *   - KML (.kml): Placemarks with a Polygon (also inside a MultiGeometry), read with the browser's own XML reader
 *     (DOMParser); an outer boundary and its inner boundaries (holes).
 *   - Zipped shapefile (.zip): each .shp in the archive with its .dbf (the names) and .prj. The .prj must say
 *     longitude and latitude on WGS 84 or NAD 83 (a geographic system without a projection; ESRI, OGC and WKT2
 *     wording, NAD 83 realizations such as 2011 included); any other coordinate system, or no .prj, is refused with a
 *     message, since converting one needs a projection library. Polygon shapes (types 5, 15 and 25); a shape's rings
 *     are grouped as the shapefile rule says: a clockwise ring is an outline, a counterclockwise ring a hole of the
 *     smallest outline larger than it that holds most of its corners (so a hole touching its outline, or nested rings,
 *     are grouped right).
 * A .kmz (a zipped KML) is refused with a message saying to unzip it, also when renamed .zip.
 *
 * Damaged and very large files are refused with a message, never left to fail later: files
 * over 64 MB are refused before they are read; zones and points are counted while reading, so the limits stop the
 * reading; a .shp entry over 16 MB is refused before it is unpacked; damaged headers, record lengths and part starts
 * are checked; any other error while reading says the file looks damaged.
 *
 * A polygon is used only when its outline is a ring of at least three distinct points with a nonzero area, in
 * longitude and latitude ranges, and every hole is a usable ring too (a polygon with a broken hole is left out, since
 * dropping the hole would count its area as inside). Left-out shapes are counted: skipped (not polygons: points,
 * lines, empty shapes, records deleted in the .dbf) and broken (polygons with unusable coordinates).
 *
 * A zone: { name, geometry (GeoJSON Polygon or MultiPolygon, [lon, lat] points, each ring closed), point ([lon, lat],
 * a point inside the zone, see pointInside), vertices }. A zone's name is its "name" property (any case; else the
 * first property whose name holds "name"; in a .dbf, else the first text field), or "Zone n".
 *
 * read(file) -> Promise<{ format, zones, skipped, broken, notes }>: file is a File or Blob with a name. Rejects with a
 *   ZoneError whose message is for the user (the file's name in quotes).
 * readGeoJson(text, name), readKml(text, name, parseXml?), readShapefile(entries, name, ignored?) -> the same, for
 *   tests; parseXml(text) returns an XML Document (default: the browser's DOMParser); entries are zip.js entries,
 *   ignored the entries zip.js left out ({ path, reason }).
 * formatOf(name, head) -> 'geojson', 'kml', 'zip', 'kmz' or null, from the name, else the first bytes (head).
 * readDbf(bytes, cpg, limit) -> { fields, records } or null when the header is damaged (for tests); at most limit records.
 * pointInside(geometry) -> [lon, lat], 6 decimals: the centroid of the largest polygon when it lies inside the zone,
 *   else the middle of the widest inside span along one of several latitudes; the sums are taken relative to the
 *   outline's first point, so small footprints keep their precision.
 * LIMITS: at most 1,000 zones and 500,000 points per file, files up to 64 MB, a .shp up to 16 MB; in a zipped
 * shapefile also a .prj or .cpg up to 64 KB and a .dbf up to 32 MB, checked before they are unpacked.
 */
(function (root) {
  'use strict';

  const LIMITS = { maxZones: 1000, maxVertices: 500000, maxBytes: 64 * 1024 * 1024, maxShpBytes: 16 * 1024 * 1024,
    maxPrjBytes: 64 * 1024, maxDbfBytes: 32 * 1024 * 1024,
    maxDepth: 20 };
  const DEG = 'longitude and latitude (WGS 84 or NAD 83)';

  class ZoneError extends Error { constructor(message) { super(message); this.name = 'ZoneError'; } }
  const q = name => '"' + name + '"';
  const n = x => x.toLocaleString('en-US');
  const plural = (k, one, many) => k + ' ' + (k === 1 ? one : many);
  const mb = bytes => (bytes / (1024 * 1024)).toFixed(1) + ' MB';

  // ── Recognizing the file ───────────────────────────────────────────────────────────────────────────────────────
  function formatOf(name, head) {
    const s = String(name || '').toLowerCase();
    if (/\.(geo)?json$/.test(s)) return 'geojson';
    if (/\.kml$/.test(s)) return 'kml';
    if (/\.kmz$/.test(s)) return 'kmz';
    if (/\.zip$/.test(s)) return 'zip';
    if (!head || !head.length) return null;
    if (head[0] === 0x50 && head[1] === 0x4b) return 'zip';   // "PK"
    const text = new TextDecoder().decode(head).replace(/^﻿/, '').trimStart();
    if (text[0] === '{') return 'geojson';
    if (/^<(\?xml[^>]*>\s*)?<kml\b/i.test(text) || /<kml\b/i.test(text.slice(0, 400))) return 'kml';
    return null;
  }

  async function read(file) {
    const name = file && file.name ? file.name : 'zone file';
    if (file.size > LIMITS.maxBytes) {
      throw new ZoneError(q(name) + ' is ' + mb(file.size) + '; the page reads zone files up to ' + mb(LIMITS.maxBytes) +
        ' (about 500,000 outline points). Simplify the shapes or split the file, and load it again.');
    }
    const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
    const format = formatOf(name, head);
    if (format === 'kmz') {
      throw new ZoneError(q(name) + ' is a KMZ (a zipped KML). Unzip it and load the .kml file inside.');
    }
    if (!format) {
      throw new ZoneError(q(name) + ' is not a zone file the page reads: use GeoJSON (.geojson or .json), KML (.kml) ' +
        'or a zipped shapefile (.zip).');
    }
    try {
      if (format === 'zip') {
        let archive;
        try {
          archive = await root.WSDA.zip.open(file);
        } catch (e) {
          throw new ZoneError(q(name) + ' could not be opened as a ZIP file' + (e && e.message ? ': ' + e.message : '.'));
        }
        return await readShapefile(archive.entries || archive, name, archive.ignored || []);
      }
      const text = await file.text();
      return format === 'geojson' ? readGeoJson(text, name) : readKml(text, name);
    } catch (e) {
      if (e && e.name === 'ZoneError') throw e;
      // Anything else is a file the readers did not foresee: say so plainly.
      throw new ZoneError(q(name) + ' could not be read: the file looks damaged' +
        (e && e.message ? ' (' + e.message + ')' : '') + '.');
    }
  }

  // ── Shapes ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // The signed area of a ring by the shoelace formula (positive when counterclockwise with y up), taken relative to
  // its first point so small rings far from 0, 0 keep their precision.
  function signedArea(ring) {
    if (!ring.length) return 0;
    const x0 = ring[0][0], y0 = ring[0][1];
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += ((ring[j][0] - x0) - (ring[i][0] - x0)) * ((ring[j][1] - y0) + (ring[i][1] - y0));
    }
    return a / 2;
  }

  // A ring: at least three distinct points with numbers in longitude and latitude ranges and a nonzero area, closed
  // (the first point repeated at the end). Returns the closed ring, or null when it is not a usable ring. tally counts
  // the points read, so the point limit stops a file while it is read.
  function cleanRing(points, name, tally) {
    if (!Array.isArray(points)) return null;
    const ring = [];
    for (const p of points) {
      if (!Array.isArray(p) || p.length < 2) return null;
      const x = p[0], y = p[1];
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      if (Math.abs(x) > 180 || Math.abs(y) > 90) {
        throw new ZoneError(q(name) + ' has coordinates outside longitude and latitude ranges (for example ' +
          x + ', ' + y + '). Zone files must be in ' + DEG + '.');
      }
      ring.push([x, y]);
    }
    if (tally) countPoints(tally, ring.length, name);
    const first = ring[0], last = ring[ring.length - 1];
    if (ring.length && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first.slice());
    const distinct = new Set(ring.map(p => p[0] + ',' + p[1]));
    return distinct.size >= 3 && hasArea(ring) ? ring : null;
  }
  // A ring encloses an area when its area is more than rounding noise against its size (points on one line give an
  // area of about 1e-17 of the box's, a 3 m triangle about 0.4).
  function hasArea(ring) {
    let w = 0, h = 0;
    ring.forEach(p => { w = Math.max(w, Math.abs(p[0] - ring[0][0])); h = Math.max(h, Math.abs(p[1] - ring[0][1])); });
    const size = Math.max(w, h);
    return size > 0 && Math.abs(signedArea(ring)) > 1e-9 * size * size;
  }
  // A polygon's rings (outline first); null when its outline or any hole is not a usable ring.
  function cleanPolygon(rings, name, tally) {
    if (!Array.isArray(rings) || !rings.length) return null;
    const clean = rings.map(r => cleanRing(r, name, tally));
    return clean.every(Boolean) ? clean : null;
  }
  // One polygon as a GeoJSON Polygon, several as a MultiPolygon; null for none.
  function geometryOf(polygons) {
    if (!polygons.length) return null;
    return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons };
  }

  // The limits, counted while reading.
  const newTally = () => ({ zones: 0, points: 0 });
  // Count k more outline points, refusing the file once it passes the point limit.
  function countPoints(tally, k, name) {
    tally.points += k;
    if (tally.points > LIMITS.maxVertices) {
      throw new ZoneError(q(name) + ' has more than ' + n(LIMITS.maxVertices) + ' points in its outlines; the page reads ' +
        'at most ' + n(LIMITS.maxVertices) + '. Simplify the shapes and load it again.');
    }
  }
  // Count one more zone, refusing the file once it passes the zone limit.
  function countZone(tally, name) {
    tally.zones++;
    if (tally.zones > LIMITS.maxZones) {
      throw new ZoneError(q(name) + ' has more than ' + n(LIMITS.maxZones) + ' polygons; the page reads at most ' +
        n(LIMITS.maxZones) + ' zones from one file.');
    }
  }

  // True when the point is inside one ring (ray casting).
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const polygonsOf = g => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
  // True when the point is inside the zone, holes counted by the even-odd rule.
  const inGeometry = (x, y, g) => polygonsOf(g).some(rings => rings.reduce((k, r) => (inRing(x, y, r) ? !k : k), false));

  // A point inside the zone, for the sites table and the map's site dot. The centroid of the largest polygon's
  // outline, its sums taken relative to the outline's first point; when the rounded centroid is not inside the zone
  // (a bent shape, or a hole there), the middle of the widest inside span along the centroid's latitude, then along
  // latitudes spread over the polygon's height, whichever first gives a rounded point inside.
  const round6 = v => Math.round(v * 1e6) / 1e6;
  function pointInside(g) {
    let best = null, bestArea = -1;
    for (const rings of polygonsOf(g)) {
      const a = Math.abs(signedArea(rings[0]));
      if (a > bestArea) { bestArea = a; best = rings; }
    }
    const outline = best[0];
    const x0 = outline[0][0], y0 = outline[0][1];
    let cx = 0, cy = 0, a2 = 0;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const xj = outline[j][0] - x0, yj = outline[j][1] - y0, xi = outline[i][0] - x0, yi = outline[i][1] - y0;
      const f = xj * yi - xi * yj;
      a2 += f;
      cx += (xj + xi) * f;
      cy += (yj + yi) * f;
    }
    const inside = p => inGeometry(p[0], p[1], g);
    // A plain loop: Math.min(...list) stops past about 125,000 points.
    let south = Infinity, north = -Infinity;
    for (const q of outline) {
      if (q[1] < south) south = q[1];
      if (q[1] > north) north = q[1];
    }
    const lats = [];
    if (a2 !== 0) {
      const c = [round6(x0 + cx / (3 * a2)), round6(y0 + cy / (3 * a2))];
      if (inside(c)) return c;
      lats.push(y0 + cy / (3 * a2));
    }
    [0.5, 0.25, 0.75, 0.375, 0.625, 0.125, 0.875].forEach(f => lats.push(south + f * (north - south)));
    let fallback = null;
    for (const y of lats) {
      const xs = [];
      best.forEach(ring => {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const yi = ring[i][1], yj = ring[j][1];
          if ((yi > y) !== (yj > y)) xs.push(ring[i][0] + (y - yi) * (ring[j][0] - ring[i][0]) / (yj - yi));
        }
      });
      xs.sort((p, r) => p - r);
      let span = null;
      for (let i = 0; i + 1 < xs.length; i += 2) {
        if (!span || xs[i + 1] - xs[i] > span[1] - span[0]) span = [xs[i], xs[i + 1]];
      }
      if (!span) continue;
      const p = [round6((span[0] + span[1]) / 2), round6(y)];
      if (inside(p)) return p;
      if (!fallback) fallback = [(span[0] + span[1]) / 2, y];
    }
    // Smaller than the 6-decimal grid (about 0.1 m): the point unrounded.
    return fallback || [outline[0][0], outline[0][1]];
  }

  // The result: zones with their point and vertex count (the limits were counted while reading).
  function finish(format, list, counts, name, notes) {
    if (!list.length) {
      const left = [];
      if (counts.skipped) left.push(plural(counts.skipped, 'shape that is not a polygon', 'shapes that are not polygons'));
      if (counts.broken) left.push(plural(counts.broken, 'polygon with unusable coordinates', 'polygons with unusable coordinates'));
      throw new ZoneError('No polygons in ' + q(name) + (left.length ? ' (' + left.join(' and ') + ' left out)' : '') +
        '. Zones need Polygon or MultiPolygon shapes.');
    }
    const zones = list.map((z, i) => {
      const k = polygonsOf(z.geometry).reduce((t, rings) => t + rings.reduce((u, r) => u + r.length, 0), 0);
      const label = z.name === null || z.name === undefined || String(z.name).trim() === '' ? 'Zone ' + (i + 1)
        : String(z.name).trim();
      return { name: label, geometry: z.geometry, point: pointInside(z.geometry), vertices: k };
    });
    return { format, zones, skipped: counts.skipped, broken: counts.broken, notes: notes || [] };
  }

  // A feature's name: "name" in any case, else the first property whose name holds "name".
  function nameOf(props) {
    if (!props || typeof props !== 'object') return null;
    const keys = Object.keys(props);
    const k = keys.find(x => x.toLowerCase() === 'name') || keys.find(x => /name/i.test(x));
    const v = k === undefined ? null : props[k];
    return v === null || v === undefined || typeof v === 'object' ? null : String(v);
  }

  // ── GeoJSON ────────────────────────────────────────────────────────────────────────────────────────────────────
  const LONLAT_CRS = /(CRS84|EPSG:+4326|EPSG:+4269|EPSG::4326|EPSG::4269)$/i;
  function readGeoJson(text, name) {
    let doc;
    try {
      doc = JSON.parse(String(text).replace(/^﻿/, ''));
    } catch (e) {
      throw new ZoneError(q(name) + ' could not be read as GeoJSON (' + e.message + ').');
    }
    if (!doc || typeof doc !== 'object' || typeof doc.type !== 'string') {
      throw new ZoneError(q(name) + ' is not GeoJSON: it has no "type".');
    }
    const crs = doc.crs && doc.crs.properties && doc.crs.properties.name;
    if (crs && !LONLAT_CRS.test(String(crs))) {
      throw new ZoneError(q(name) + ' is in the coordinate system ' + crs + '. Save it in ' + DEG + ' and load it again; ' +
        'the page cannot convert coordinate systems.');
    }
    const features = doc.type === 'FeatureCollection' ? (Array.isArray(doc.features) ? doc.features : [])
      : doc.type === 'Feature' ? [doc] : [{ type: 'Feature', properties: null, geometry: doc }];
    const list = [], counts = { skipped: 0, broken: 0 }, tally = newTally();
    features.forEach(f => {
      const polygons = [];
      let polygonsSeen = 0;
      const collect = (g, depth) => {
        if (!g || typeof g !== 'object' || depth > LIMITS.maxDepth) return;
        if (g.type === 'Polygon') {
          polygonsSeen++;
          const p = cleanPolygon(g.coordinates, name, tally);
          if (p) polygons.push(p);
        } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
          g.coordinates.forEach(c => {
            polygonsSeen++;
            const p = cleanPolygon(c, name, tally);
            if (p) polygons.push(p);
          });
        } else if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
          g.geometries.forEach(x => collect(x, depth + 1));
        }
      };
      collect(f && f.geometry, 0);
      const geometry = geometryOf(polygons);
      if (geometry) {
        countZone(tally, name);
        list.push({ name: nameOf(f && f.properties), geometry });
      } else if (polygonsSeen) counts.broken++;
      else counts.skipped++;
    });
    return finish('geojson', list, counts, name);
  }

  // ── KML ────────────────────────────────────────────────────────────────────────────────────────────────────────
  // Elements by their local name, whatever the namespace (KML 2.2 files declare one, older ones may not).
  const byName = (node, local) => Array.from(node.getElementsByTagNameNS('*', local));
  const childByName = (node, local) => Array.from(node.children || []).filter(c => c.localName === local);
  // A KML boundary's ring, cleaned; null when it has no coordinates or is not a usable ring.
  function kmlRing(boundary, name, tally) {
    const coords = byName(boundary, 'coordinates')[0];
    if (!coords) return null;
    const points = coords.textContent.trim().split(/\s+/).filter(Boolean).map(t => t.split(',').map(Number));
    return cleanRing(points.map(p => [p[0], p[1]]), name, tally);
  }
  function readKml(text, name, parseXml) {
    const parse = parseXml || (t => new root.DOMParser().parseFromString(t, 'application/xml'));
    let doc;
    try {
      doc = parse(String(text).replace(/^﻿/, ''));
    } catch (e) {
      doc = null;
    }
    if (!doc || byName(doc, 'parsererror').length || !doc.documentElement || doc.documentElement.localName !== 'kml') {
      throw new ZoneError(q(name) + ' could not be read as KML (the file is not well-formed XML with a <kml> root).');
    }
    const list = [], counts = { skipped: 0, broken: 0 }, tally = newTally();
    byName(doc, 'Placemark').forEach(pm => {
      const polygons = [];
      const found = byName(pm, 'Polygon');
      found.forEach(poly => {
        const outer = childByName(poly, 'outerBoundaryIs')[0];
        const outline = outer ? kmlRing(outer, name, tally) : null;
        const holes = childByName(poly, 'innerBoundaryIs').map(b => kmlRing(b, name, tally));
        if (outline && holes.every(Boolean)) polygons.push([outline].concat(holes));
      });
      const geometry = geometryOf(polygons);
      const nm = childByName(pm, 'name')[0];
      if (geometry) {
        countZone(tally, name);
        list.push({ name: nm ? nm.textContent : null, geometry });
      } else if (found.length) counts.broken++;
      else counts.skipped++;
    });
    return finish('kml', list, counts, name);
  }

  // ── Zipped shapefile ───────────────────────────────────────────────────────────────────────────────────────────
  // The .prj's coordinate system: { ok } or { reason } (for the message). ESRI and OGC WKT1 (GEOGCS) and WKT2
  // (GEOGCRS, GEODCRS, GEOGRAPHICCRS), the datum or the datum ensemble named WGS 84 or NAD 83 in any of their usual
  // spellings, NAD 83 realizations (HARN, CORS96, NSRS2007, 2011) included.
  const WGS84 = /WGS[ _]?(19)?84|World[ _]Geodetic[ _]System[ _]1984/i;
  const NAD83 = /North[ _]American[ _](Datum[ _])?1983|NAD[ _]?(19)?83/i;
  function checkPrj(text) {
    const t = String(text || '').trim();
    if (!t) return { reason: 'has no .prj file, so its coordinate system is unknown' };
    if (/^\s*(PROJCS|PROJCRS|PROJECTEDCRS)\s*\[/i.test(t) || /PROJECTION\s*\[/i.test(t)) {
      const m = t.match(/^\s*PROJ(?:CS|CRS|ECTEDCRS)\s*\[\s*"([^"]*)"/i);
      return { reason: 'is in a projected coordinate system' + (m ? ' (' + m[1] + ')' : '') };
    }
    if (!/^\s*(GEOGCS|GEOGCRS|GEODCRS|GEOGRAPHICCRS)\s*\[/i.test(t)) return { reason: 'has a .prj the page does not recognize' };
    const datum = (t.match(/(?:DATUM|ENSEMBLE)\s*\[\s*"([^"]*)"/i) || [])[1] || '';
    if (WGS84.test(datum) || NAD83.test(datum)) return { ok: true };
    return { reason: 'uses the datum ' + (datum || 'named in its .prj') + ', not WGS 84 or NAD 83' };
  }

  // Text from a .dbf field: UTF-8 when valid (an incomplete character cut at the field's end is dropped first), else
  // as the .cpg says, else Windows-1252.
  function trimUtf8(b) {
    let end = b.length, k = end - 1, cont = 0;
    while (k >= 0 && (b[k] & 0xc0) === 0x80 && cont < 3) { k--; cont++; }
    if (k >= 0 && b[k] >= 0xc0) {
      const need = b[k] >= 0xf0 ? 3 : b[k] >= 0xe0 ? 2 : 1;
      if (cont < need) end = k;
    }
    return b.subarray(0, end);
  }
  // dBASE field values: { fields, records } (a deleted record is null); null when the header is damaged. limit: the
  // most records to read (the .shp's shape count; only those are ever used).
  function readDbf(bytes, cpg, limit) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 33) return null;
    const declared = v.getUint32(4, true), headerLength = v.getUint16(8, true), recordLength = v.getUint16(10, true);
    const fields = [];
    for (let p = 32; p + 32 <= headerLength && p + 32 <= bytes.length && bytes[p] !== 0x0d; p += 32) {
      let end = p;
      while (end < p + 11 && bytes[end] !== 0) end++;
      fields.push({ name: String.fromCharCode(...bytes.subarray(p, end)), type: String.fromCharCode(bytes[p + 11]),
        length: bytes[p + 16] });
    }
    const width = 1 + fields.reduce((t, f) => t + f.length, 0);
    if (headerLength > bytes.length || recordLength < width) return null;
    // At most the records the bytes hold (and none for a record length of 0), whatever the header declares.
    let count = recordLength > 0 ? Math.min(declared, Math.floor((bytes.length - headerLength) / recordLength)) : 0;
    if (typeof limit === 'number') count = Math.min(count, limit);
    const latin = /1252|latin|8859/i.test(cpg || '');
    const decode = b => {
      if (!latin) {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(trimUtf8(b)); } catch (e) { /* not UTF-8 */ }
      }
      return new TextDecoder('windows-1252').decode(b);
    };
    const records = [];
    for (let r = 0; r < count; r++) {
      const start = headerLength + r * recordLength;
      const rec = Object.create(null);   // a field may have any name, "__proto__" among them
      let at = start + 1;   // the first byte marks a deleted record
      fields.forEach(f => {
        rec[f.name] = decode(bytes.subarray(at, at + f.length)).trim();
        at += f.length;
      });
      records.push(bytes[start] === 0x2a ? null : rec);
    }
    return { fields, records };
  }

  // The polygons of one shape record: clockwise rings are outlines, counterclockwise rings holes. A hole belongs to the
  // smallest outline larger than it that holds most of its corners: not by its first corner
  // alone, which may touch the outline, nor by its middle, which may lie on an island inside the hole. A hole no
  // outline holds becomes an outline itself. A record with an unusable ring is left out whole (null).
  function shapePolygons(rings, name, tally) {
    const clean = rings.map(r => cleanRing(r, name, tally));
    if (!clean.every(Boolean)) return null;
    const boxOf = r => {
      const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      for (const c of r) {
        if (c[0] < b.x0) b.x0 = c[0];
        if (c[0] > b.x1) b.x1 = c[0];
        if (c[1] < b.y0) b.y0 = c[1];
        if (c[1] > b.y1) b.y1 = c[1];
      }
      return b;
    };
    const outlines = clean.filter(r => signedArea(r) < 0).map(r => ({ rings: [r], area: -signedArea(r), box: boxOf(r) }));
    clean.filter(r => signedArea(r) > 0).forEach(hole => {
      const area = signedArea(hole), all = hole.slice(0, -1), hb = boxOf(hole);
      // The vote over at most 31 corners spread evenly around the hole, and only outlines whose box meets the hole's
      // (every corner against every outline froze the reader on a detailed hole).
      const step = Math.max(1, Math.ceil(all.length / 31));
      const corners = all.filter((c, k) => k % step === 0);
      const meets = o => o.box.x0 <= hb.x1 && o.box.x1 >= hb.x0 && o.box.y0 <= hb.y1 && o.box.y1 >= hb.y0;
      const holds = o => meets(o) && corners.filter(c => inRing(c[0], c[1], o.rings[0])).length * 2 > corners.length;
      const owners = outlines.filter(o => o.area > area && holds(o)).sort((a, b) => a.area - b.area);
      if (owners.length) owners[0].rings.push(hole);
      else outlines.push({ rings: [hole.slice().reverse()], area: signedArea(hole), box: hb });
    });
    return outlines.map(o => o.rings);
  }
  // The rings of each record of a .shp, in record order (null for an empty record); a damaged file throws a
  // ZoneError.
  function readShp(bytes, name, tally) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 100 || v.getInt32(0, false) !== 9994) {
      throw new ZoneError(q(name) + ' has a .shp that is not a shapefile (its header is damaged).');
    }
    const type = v.getInt32(32, true);
    if ([5, 15, 25].indexOf(type) < 0) {
      const kinds = { 0: 'no shapes', 1: 'points', 3: 'lines', 8: 'points', 11: 'points', 13: 'lines', 18: 'points',
        21: 'points', 23: 'lines', 28: 'points', 31: 'patches' };
      throw new ZoneError('No polygons in ' + q(name) + ': its shapefile holds ' + (kinds[type] || 'shapes of type ' + type) +
        '. Zones need polygons.');
    }
    // The records end where the header says the file ends (bytes after it are ignored).
    const fileEnd = Math.min(bytes.length, Math.max(100, v.getInt32(24, false) * 2));
    const damaged = what => new ZoneError(q(name) + ' has a damaged .shp: ' + what + '.');
    const shapes = [];
    let p = 100;
    while (p + 8 <= fileEnd) {
      const length = v.getInt32(p + 4, false) * 2;
      const c = p + 8;
      if (length < 4 || c + length > fileEnd) throw damaged('a record runs past the end of the file');
      const t = v.getInt32(c, true);
      if (t === 0) shapes.push(null);
      else {
        if (length < 44) throw damaged('a shape is too short for its header (record ' + (shapes.length + 1) + ')');
        const parts = v.getInt32(c + 36, true), points = v.getInt32(c + 40, true);
        const at = c + 44 + 4 * parts;
        if (parts < 1 || points < 3 || parts > points || at + 16 * points > c + length) {
          throw damaged('a shape\'s counts do not fit its record (record ' + (shapes.length + 1) + ')');
        }
        const starts = [];
        for (let k = 0; k < parts; k++) starts.push(v.getInt32(c + 44 + 4 * k, true));
        if (starts[0] !== 0 || starts.some((s, k) => k > 0 && s <= starts[k - 1]) || starts[parts - 1] >= points) {
          throw damaged('its parts are out of order (record ' + (shapes.length + 1) + ')');
        }
        starts.push(points);
        const rings = [];
        for (let k = 0; k < parts; k++) {
          const ring = [];
          for (let i = starts[k]; i < starts[k + 1]; i++) ring.push([v.getFloat64(at + 16 * i, true),
            v.getFloat64(at + 16 * i + 8, true)]);
          rings.push(ring);
        }
        shapes.push(rings);
      }
      p = c + length;
    }
    return shapes;
  }
  async function readShapefile(entries, name, ignored) {
    const live = e => !/(^|\/)(__MACOSX\/|\._)/.test(e.path || e.name);
    const files = (entries || []).filter(live);
    const lower = e => String(e.path || e.name).toLowerCase();
    const left = (ignored || []).filter(live);
    const shps = files.filter(e => /\.shp$/.test(lower(e)));
    if (!shps.length) {
      const kml = files.find(e => /\.kml$/.test(lower(e)));
      if (kml) {
        throw new ZoneError(q(name) + ' holds a KML file (' + (kml.path || kml.name) + '), not a shapefile: it may be a ' +
          'KMZ renamed .zip. Unzip it and load the .kml file inside.');
      }
      const lost = left.find(e => /\.shp$/i.test(e.path));
      throw new ZoneError(q(name) + ' holds no shapefile (.shp)' + (lost ? ': ' + lost.path + ' could not be unpacked (' +
        lost.reason + ')' : '') + '. A zipped shapefile needs its .shp, .dbf and .prj files.');
    }
    const list = [], counts = { skipped: 0, broken: 0 }, tally = newTally();
    const notes = [];
    for (const shp of shps) {
      const base = lower(shp).replace(/\.shp$/, '');
      const part = ext => files.find(e => lower(e) === base + ext);
      const label = (shp.path || shp.name).replace(/^.*\//, '');
      // The side files' sizes from the archive's directory, before they are unpacked (only the .shp was
      // checked, so a small archive could unpack a .prj of hundreds of megabytes).
      const tooBig = (entry, max, what) => {
        if (entry && entry.size > max) {
          throw new ZoneError('The shapefile ' + q(label) + ' in ' + q(name) + ' has a ' + what + ' of ' + mb(entry.size) +
            ', more than the ' + mb(max) + ' the page reads; the file looks damaged.');
        }
      };
      const prj = part('.prj');
      tooBig(prj, LIMITS.maxPrjBytes, '.prj');
      tooBig(part('.cpg'), LIMITS.maxPrjBytes, '.cpg');
      tooBig(part('.dbf'), LIMITS.maxDbfBytes, '.dbf');
      const check = checkPrj(prj ? new TextDecoder().decode(await prj.read()) : '');
      if (!check.ok) {
        const lost = !prj && left.find(e => e.path.toLowerCase() === base + '.prj');
        throw new ZoneError('The shapefile ' + q(label) + ' in ' + q(name) + ' ' + (lost ? 'has a .prj the page could ' +
          'not unpack (' + lost.reason + ')' : check.reason) + '. Save it in ' + DEG + ' and load it again; the page ' +
          'cannot convert coordinate systems.');
      }
      if (shp.size > LIMITS.maxShpBytes) {
        throw new ZoneError('The shapefile ' + q(label) + ' in ' + q(name) + ' is ' + mb(shp.size) + '; the page reads ' +
          'shapefiles up to ' + mb(LIMITS.maxShpBytes) + ' (about 500,000 outline points). Simplify the shapes and ' +
          'load it again.');
      }
      const shapes = readShp(await shp.read(), name, tally);
      const dbfEntry = part('.dbf'), cpgEntry = part('.cpg');
      let dbf = null;
      if (dbfEntry) {
        dbf = readDbf(await dbfEntry.read(), cpgEntry ? new TextDecoder().decode(await cpgEntry.read()) : '',
          shapes.length);
        if (!dbf) throw new ZoneError('The shapefile ' + q(label) + ' in ' + q(name) + ' has a damaged .dbf (its header ' +
          'does not match its records).');
      } else notes.push('The shapefile ' + q(label) + ' has no .dbf, so its zones are numbered.');
      let field = null;
      if (dbf) {
        field = dbf.fields.find(f => f.name.toLowerCase() === 'name') || dbf.fields.find(f => /name/i.test(f.name)) ||
          dbf.fields.find(f => f.type === 'C') || null;
      }
      shapes.forEach((rings, i) => {
        const rec = dbf ? dbf.records[i] : undefined;
        if (rec === null || !rings) { counts.skipped++; return; }   // deleted in the .dbf, or a record without a shape
        const polygons = shapePolygons(rings, name, tally);
        const geometry = polygons ? geometryOf(polygons) : null;
        if (!geometry) { counts.broken++; return; }
        countZone(tally, name);
        list.push({ name: field && rec ? rec[field.name] : null, geometry });
      });
    }
    return finish('shapefile', list, counts, name, notes);
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.zones = { read, readGeoJson, readKml, readShapefile, formatOf, pointInside, checkPrj, signedArea, readDbf,
    ZoneError, LIMITS };
})(typeof window !== 'undefined' ? window : globalThis);
