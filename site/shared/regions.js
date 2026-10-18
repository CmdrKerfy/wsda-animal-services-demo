/* Neighboring regions, shared by every profile (it knows no profile): the region list (geo/regions/index.js), each
 * region's file loaded only when it is first asked for (a <script> from the site folder, so file:// and http both work
 * and the page's CSP is unchanged), the map sources and layers for a region, and the keys that place rows across the
 * border. Adding a region needs no code change: its file from build/derive_regions.R (an entry in that script's region
 * and source tables, and in the R file check's sources) and one entry in the list.
 *
 * list() -> the entries of window.WSDA_REGIONS, in list order
 * entry(id) -> one entry, or null
 * load(id, { base }) -> Promise<data>; base: the path from the page to the site folder (e.g. '../'). A file that is
 *   missing or broken rejects, and a later call tries again.
 * loaded(id) -> the region's data once loaded, else null
 * key(code, name, suffixes?) -> 'OR:multnomah': the code, ':', the name trimmed with spaces collapsed, a suffix dropped
 *   (the entry's suffixes, else "County"), lower case. County names repeat across states, so the code is part of it.
 *   A name listed in the entry's aliases (a current name the boundary file does not use, e.g. "Metro Vancouver") gives
 *   the key of the file's name ("BC:greater vancouver").
 * dataset(code, name, featureCollection, { nameProp, idProp, suffixes }) -> a county set for locate() and resolve()
 *   (e.g. Washington's wa-counties.js); fromData(data) does the same for a loaded region.
 * locate(lon, lat, sets?) -> { code, region, county, key, gid } of the county containing the point, or null.
 *   sets: county sets (default: every loaded region).
 * resolve(row, sets?): row { state, county, lon, lat }. Coordinates first; else state/province plus county name. With
 *   a point, whatever else the row gives must agree with it: state/province and county, the state/province alone, or
 *   the county alone (read in the point's region). The result { status, via, match, byPoint, byName }: status 'ok'
 *   (match set), 'mismatch' (the point and what the row states disagree, or a name that is not there: flagged, never
 *   chosen), 'outside' (a point in no region),
 *   'unknown' (no point, and the name is not found), 'none' (neither given). Cartographic boundary files are not meant
 *   for precise boundary relationships, which is why a disagreement is reported rather than settled.
 * mapParts(data, opts) -> { sources, layers } for MapLibre; ids are nr-<id>-land, nr-<id>-counties, nr-<id>-outline
 *   (sources nr_<id>_outline, nr_<id>_counties). opts: { landPaint, linePaint, land, outline, counties } (on/off).
 *   Both sources carry the entry's credit as their attribution, so the map's credit names the source while the region
 *   is drawn, and not otherwise (MapLibre credits only sources in use, and drops a credit contained in another).
 */
(function (root) {
  'use strict';
  const DATA = 'WSDA_REGION_DATA';
  const pending = Object.create(null);

  function list() { return Array.isArray(root.WSDA_REGIONS) ? root.WSDA_REGIONS.slice() : []; }
  function entry(id) { return list().find(r => r.id === id) || null; }
  function byCode(code) { return list().find(r => r.code === String(code).toUpperCase()) || null; }

  // A region's data counts as loaded only when every shape can be drawn: (Multi)Polygon rings of number pairs. MapLibre
  // draws nothing and reports nothing for a shape it cannot read, so a broken file is refused here instead (checked
  // once per data object).
  const checked = new WeakMap();
  const ring = r => Array.isArray(r) && r.length >= 4
    && r.every(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  const drawable = g => {
    const polys = g && Array.isArray(g.coordinates)
      ? (g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : null) : null;
    return !!polys && polys.length > 0 && polys.every(p => Array.isArray(p) && p.length > 0 && p.every(ring));
  };
  function loaded(id) {
    const d = root[DATA] && Object.prototype.hasOwnProperty.call(root[DATA], id) ? root[DATA][id] : null;
    if (!d || typeof d !== 'object') return null;
    if (!checked.has(d)) checked.set(d, d.id === id && !!d.counties && Array.isArray(d.counties.features)
      && d.counties.features.length > 0 && Array.isArray(d.labels) && !!d.outline && drawable(d.outline.geometry)
      && d.counties.features.every(f => !!f && drawable(f.geometry)));
    return checked.get(d) ? d : null;
  }

  // Load a region's boundary file (a script) once; resolves with its data, rejects when it is missing or broken.
  function load(id, opts) {
    const e = entry(id);
    if (!e) return Promise.reject(new Error('No neighboring region "' + id + '" in the list.'));
    if (loaded(id)) return Promise.resolve(loaded(id));
    if (pending[id]) return pending[id];
    const base = (opts && opts.base) || '';
    pending[id] = new Promise((resolve, reject) => {
      const s = root.document.createElement('script');
      const done = err => {
        s.onload = s.onerror = null; s.remove(); delete pending[id];
        const d = loaded(id);
        if (err || !d) reject(new Error('The boundary file for ' + e.name + ' could not be loaded (' + e.file + ').'));
        else resolve(d);
      };
      s.onload = () => done(null);
      s.onerror = () => done(true);
      s.src = base + e.file;
      root.document.head.appendChild(s);
    });
    return pending[id];
  }

  // A county name in lower case, spaces collapsed and the region's suffixes ("County") removed.
  function normalizeName(name, suffixes) {
    let n = String(name === null || name === undefined ? '' : name).trim().replace(/\s+/g, ' ');
    (suffixes || ['County']).forEach(sfx => {
      const words = sfx.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      n = n.replace(new RegExp('\\s+' + words.join('\\s+') + '$', 'i'), '');
    });
    return n.toLowerCase();
  }
  // A county's matching key, "CODE:name", with the region's aliases applied.
  function key(code, name, suffixes) {
    const c = String(code).trim().toUpperCase(), e = byCode(c), sfx = suffixes || (e && e.suffixes);
    const n = normalizeName(name, sfx);
    const alias = e && e.aliases ? Object.keys(e.aliases).find(a => normalizeName(a, sfx) === n) : undefined;
    return c + ':' + (alias === undefined ? n : normalizeName(e.aliases[alias], sfx));
  }

  // ---- county sets and point in polygon -------------------------------------------------------------------------
  // The bounding box of the polygons' outer rings.
  function bboxOf(polys) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    polys.forEach(p => p[0].forEach(([x, y]) => {
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
    }));
    return b;
  }
  const polysOf = g => (g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : []);
  // A county set for matching: each county's name, key, ID, polygons and bounding box.
  function dataset(code, name, fc, opts) {
    const o = opts || {}, nameProp = o.nameProp || 'name', idProp = o.idProp || 'gid';
    const c = String(code).toUpperCase();
    const features = fc.features.map(f => {
      const polys = polysOf(f.geometry), nm = f.properties[nameProp];
      return { name: nm, key: key(c, nm, o.suffixes), gid: f.properties[idProp], polys, bbox: bboxOf(polys) };
    });
    return { code: c, name, features };
  }
  // The county set of a loaded region's data.
  function fromData(d) {
    const e = entry(d.id);
    return dataset(d.code, d.name, d.counties, { suffixes: e ? e.suffixes : undefined });
  }
  function inRing(x, y, ring) {   // ray casting; a point exactly on an edge may go either way
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // True when the point is inside a polygon's outer ring and outside its holes.
  function inPolys(x, y, polys) {
    return polys.some(p => inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h)));
  }
  // The county sets of every loaded region.
  function loadedSets() { return list().map(e => loaded(e.id)).filter(Boolean).map(fromData); }

  // The county holding a point, among the sets (every loaded region by default), or null.
  function locate(lon, lat, sets) {
    const x = Number(lon), y = Number(lat);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    for (const s of sets || loadedSets()) {
      for (const f of s.features) {
        if (x < f.bbox[0] || x > f.bbox[2] || y < f.bbox[1] || y > f.bbox[3]) continue;
        if (inPolys(x, y, f.polys)) return { code: s.code, region: s.name, county: f.name, key: f.key, gid: f.gid };
      }
    }
    return null;
  }

  const blank = v => v === null || v === undefined || /^\s*(|n\/?a|null)\s*$/i.test(String(v));
  // The set a state/province value names: its code or its name, case, spaces and periods ignored ("B.C." = "BC").
  function setFor(state, sets) {
    const t = String(state).trim().replace(/\./g, '').replace(/\s+/g, ' ').toLowerCase();
    return sets.find(s => s.code.toLowerCase() === t || String(s.name).toLowerCase() === t) || null;
  }
  // The county named by a state or province and a county name, or null.
  function byNameOf(state, county, sets) {
    const s = setFor(state, sets);
    if (!s) return null;
    const k = key(s.code, county, (byCode(s.code) || {}).suffixes);
    const f = s.features.find(x => x.key === k);
    return f ? { code: s.code, region: s.name, county: f.name, key: f.key, gid: f.gid } : null;
  }
  // A row's county outside WA, from its coordinates or else its state and county names, with a status:
  // ok, outside, mismatch, unknown or none.
  function resolve(row, sets) {
    const S = sets || loadedSets(), r = row || {};
    const hasPoint = !blank(r.lon) && !blank(r.lat) && Number.isFinite(Number(r.lon)) && Number.isFinite(Number(r.lat));
    const hasState = !blank(r.state), hasCounty = !blank(r.county), hasName = hasState && hasCounty;
    const byPoint = hasPoint ? locate(r.lon, r.lat, S) : null;
    const byName = hasName ? byNameOf(r.state, r.county, S) : null;
    if (hasPoint) {
      if (!byPoint) return { status: 'outside', via: 'coordinates', match: null, byPoint, byName };
      const agrees = hasName ? !!byName && byName.key === byPoint.key
        : hasState ? (setFor(r.state, S) || {}).code === byPoint.code
        : hasCounty ? key(byPoint.code, r.county) === byPoint.key : true;
      if (!agrees) return { status: 'mismatch', via: 'coordinates', match: null, byPoint, byName };
      return { status: 'ok', via: 'coordinates', match: byPoint, byPoint, byName };
    }
    if (!hasName) return { status: 'none', via: null, match: null, byPoint, byName };
    return byName ? { status: 'ok', via: 'name', match: byName, byPoint, byName }
      : { status: 'unknown', via: 'name', match: null, byPoint, byName };
  }

  // ---- map parts -----------------------------------------------------------------------------------------------
  // The map sources and layers (land, county lines, outline) that draw a region.
  function mapParts(d, opts) {
    const o = opts || {}, vis = on => ({ visibility: on ? 'visible' : 'none' });
    const src = { outline: 'nr_' + d.id + '_outline', counties: 'nr_' + d.id + '_counties' };
    const e = entry(d.id), credit = e && e.credit ? { attribution: e.credit } : {};
    const sources = {};
    sources[src.outline] = Object.assign({ type: 'geojson', data: { type: 'FeatureCollection', features: [d.outline] } }, credit);
    sources[src.counties] = Object.assign({ type: 'geojson', data: d.counties }, credit);
    const layers = [
      { id: 'nr-' + d.id + '-land', type: 'fill', source: src.outline, layout: vis(o.land),
        paint: Object.assign({}, o.landPaint) },
      { id: 'nr-' + d.id + '-counties', type: 'line', source: src.counties, layout: vis(o.counties),
        paint: Object.assign({}, o.linePaint) },
      { id: 'nr-' + d.id + '-outline', type: 'line', source: src.outline, layout: vis(o.outline),
        paint: Object.assign({}, o.linePaint) }];
    return { sources, layers };
  }
  const layerIds = id => ['nr-' + id + '-land', 'nr-' + id + '-counties', 'nr-' + id + '-outline'];

  root.WSDA = root.WSDA || {};
  root.WSDA.regions = { list, entry, load, loaded, key, normalizeName, dataset, fromData, locate, resolve, mapParts, layerIds };
})(typeof window !== 'undefined' ? window : globalThis);
