/* Emergency Response rules: pure (no page work), on plain lists, so the unit suite and the R reference
 * (tests/oracle/em_oracle.R) check them directly. Distances and "inside" are the shared engine's (shared/proximity.js:
 * CVI's distance rule on a sphere of 6,378,137 m, the edge counting as inside, a point inside a zone polygon at 0 km).
 *
 * Positives:
 *   readPositives(header, rows, type?) -> { type, positives, dropped, columns, badDates }
 *     header: the file's column names; rows: its data rows (lists of text, as a CSV reader gives them). type: an
 *     emergency type (types.js); without one, the type is picked from the Disease Name column (types.pick).
 *     positives: [{ index (0, 1, ... among the usable rows), line (the file's line number, the header being line 1),
 *       id, name, county, lat, lon, status ({ label, color } or null), statusText, closed, detected (YYYY-MM-DD or
 *       null), disease, species }]. dropped: [{ line, reason }] for rows without a usable latitude and longitude.
 *     columns: the column found for each of lat, lon, id, status, closed, detected, county, disease, species (or null).
 *     badDates: rows whose Detection Date could not be read.
 *     Names: the report ID (AnimalDiseaseReportId) when the row has one, else "Positive 1 (County)" in file order, or
 *     "Positive 1" without a county. A column whose name holds address, location, street or premise is never read,
 *     so no address can reach a name, a label or an export.
 *   statusChoices(type, positives) -> [{ key, label, color, count }]: the type's statuses, then "No status" when a
 *     positive has none (key "none").
 *   defaultTicks(type, positives) -> { statuses: [keys], closed }: zones.applyTo "open": every status, closed
 *     positives without zones; "confirmed": the type's first status only; "all": every status and the closed ones.
 *   targets(positives, ticks) -> the positives that get zones: a ticked status, and not closed unless closed is ticked.
 *   suggestedLayers(type, positives, loaded) -> the layer keys ticked at first: the keys of every bySpecies entry
 *     with a word in a positive's species (any case, at the start of a word), else the type's default list; only
 *     the keys in loaded (the layers whose files are there), in the type's order.
 *
 * Zones:
 *   ringSites(targets, rings) -> prepared sites (proximity.prepareSites): one per positive with zones, its radii the
 *     rings' distances; each site also has positive (the positive's index).
 *   zoneSites(zones) -> prepared sites from a zone file's zones (zones.js read()): each a polygon, matched inside only.
 *   ringLabel(rings, km) -> the label of the smallest ring at least km (the ring a point lies in).
 *
 * Locations too coarse for zone results ("Left out"), checked on each point before the inside list is made:
 *   coarseReason(point) -> null, or why the point is left out: located only to a town (geo_source "google_city", the
 *     platform's rule) or not placed (geo_source "none", which CVI leaves out of its counts); a geocode_precision other than rooftop or street (trimmed and lowercased, as RAD's registry
 *     stores it), a match_status other than Matched, a premises_type other than Street (RAD's
 *     premises_zone_eligible(), core/premises_registry.R). point.precision holds those three values as the file gives
 *     them; a column the file does not have is left out of it and does not count against the point.
 *   precisionRows(header, rows) -> for each row facilities.prepare numbers (its points' ordinal: the file's rows
 *     without blank lines), the precision values of the columns the file has (any case), as point.precision wants.
 *
 * What is inside:
 *   inside(sites, layers, opts) -> { rows, layers, leftOut, total }
 *     layers: [{ key, label, color, points: [{ name, display, lat, lon, county, town, geoSource, precision }] }]
 *     opts: { mode ('rings' or 'zones'), rings (rings mode: the type's rings, for the labels), positives (the
 *       positives the "nearest" line measures from), includeCoarse (true: no point is left out) }.
 *     rows: layer by layer, then site by site, nearest first (then by name): { site, siteName, layer, layerLabel, name, lat,
 *       lon, exactKm, km (R's round(x, 2)), bandKm, zone (the ring's label, or the zone's name), county, town }.
 *     layers: per layer { key, label, color, mode, inside (distinct sites inside any zone), byZone: [{ label, count }] (each
 *       site once, in the smallest ring that holds it, or in each zone polygon that holds it), nearest ({ name, km,
 *       from, county, town } for a layer with nothing inside, null otherwise), leftOut (count), usable (points
 *       checked) }.
 *     leftOut: [{ layer, layerLabel, name, reason, county, town }]. total: distinct sites inside, over every layer.
 *   countLine(layerSummary, unit) -> one line per layer: "Dairies: 1 in the Infection zone, 3 in the Control zone",
 *     or, with nothing inside, "Dairies: none inside. Nearest: Synthetic Dairy 3, 14.2 km from SYN-HPAI-003".
 *
 * The value boxes and the exports:
 *   valueBoxes(read, result) -> { positives: { value, note }, last: { value, reason }, inside: { value, reason } };
 *     a value that cannot be given is null with "Not available: needs ..." as its reason (never shown as zero).
 *   exportRows(read, targets, result, unit) -> { positives, inside, layers, leftOut }: each { columns, rows } for the
 *     CSV files, with no address column.
 * The unit is "km" in this version; the copied count and table rows take it, so miles can be added here alone.
 * The inside rows and counts are copied from site/cvi/app/lookup.js, v1.1 (facilitiesInside, facilityCounts and
 * facilityTable), with the zones' labels and the unit added, and the rows grouped by layer first (the results tab lists
 * them layer by layer); round2 is copied from the same file. */
(function (root) {
  'use strict';
  const P = () => root.WSDA.proximity;
  const T = () => root.WSDA.emergencyTypes;
  const UNITS = { km: { factor: 1, label: 'km' } };

  // Columns read from a positives file, any case; never one whose name holds a word below.
  const COLUMNS = {
    lat: ['case lat', 'lat', 'latitude', 'y'],
    lon: ['case long', 'long', 'lon', 'lng', 'longitude', 'x'],
    id: ['animaldiseasereportid'],
    status: ['case status'],
    detected: ['detection date'],
    county: ['county'],
    disease: ['disease name'],
    species: ['species', 'species group']
  };
  const PRIVATE = /address|location|street|premise/i;
  const TOWN_LEVEL = /^google_city$/i, UNPLACED = /^none$/i;

  // R's round(x, 2): to the nearest hundredth of the number's exact value; an exact half goes to the even hundredth.
  // The exact value is read from its decimal expansion (x * 100 can itself round onto a half: 2.675 is below one).
  function round2(x) {
    if (x === null) return null;
    const exact = Math.abs(x).toFixed(20);
    if (/\.\d\d50*$/.test(exact)) {
      const down = Number(exact.slice(0, exact.indexOf('.') + 3).replace('.', ''));
      return Math.sign(x) * (down % 2 === 0 ? down : down + 1) / 100;
    }
    return Number(x.toFixed(2));
  }
  const text = v => (v === null || v === undefined ? '' : String(v).trim());
  const listOf = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

  // The index of the first column with one of the names (any case), skipping private columns; -1 when none.
  function columnIndex(header, names) {
    const lower = header.map(h => text(h).toLowerCase());
    for (const n of names) {
      const i = lower.indexOf(n);
      if (i >= 0 && !PRIVATE.test(header[i])) return i;
    }
    return -1;
  }

  // A date written YYYY-MM-DD (a time after it is ignored), YYYY/M/D or M/D/YYYY, as YYYY-MM-DD; null otherwise.
  function dateOf(v) {
    const s = text(v);
    let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/.exec(s), y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      if (!m) return null;
      y = +m[3]; mo = +m[1]; d = +m[2];
    }
    const iso = String(y).padStart(4, '0') + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const back = new Date(iso + 'T00:00:00Z');
    return !isNaN(back) && back.toISOString().slice(0, 10) === iso ? iso : null;
  }

  function readPositives(header, rows, type) {
    const col = {};
    for (const k of Object.keys(COLUMNS)) col[k] = columnIndex(header, COLUMNS[k]);
    const cell = (r, k) => col[k] < 0 ? '' : text(r[col[k]]);
    const blank = r => r.every(v => text(v) === '');
    const data = (rows || []).map((r, i) => ({ r, line: i + 2 })).filter(x => !blank(x.r));
    if (!type) type = T().pick(col.disease < 0 ? null : data.map(x => cell(x.r, 'disease'))).type;
    const closedAt = columnIndex(header, [type.closed.column.toLowerCase()]);
    const positives = [], dropped = [];
    let badDates = 0;
    for (const { r, line } of data) {
      const lat = P().number(cell(r, 'lat')), lon = P().number(cell(r, 'lon'));
      if (!P().usable(lat, lon)) {
        dropped.push({ line, reason: 'no usable latitude and longitude' });
        continue;
      }
      const n = positives.length + 1, id = cell(r, 'id'), county = cell(r, 'county');
      const statusText = cell(r, 'status'), status = T().statusOf(type, statusText);
      const detectedText = cell(r, 'detected'), detected = dateOf(detectedText);
      if (detectedText && !detected) badDates++;
      positives.push({ index: positives.length, line, id: id || null,
        name: id || 'Positive ' + n + (county ? ' (' + county + ')' : ''),
        county: county || null, lat, lon, status: status ? { label: status.label, color: status.color } : null,
        statusText: statusText || null, closed: closedAt >= 0 && T().isClosed(type, r[closedAt]),
        detected, disease: cell(r, 'disease') || null, species: cell(r, 'species') || null });
    }
    const columns = {};
    for (const k of Object.keys(COLUMNS)) columns[k] = col[k] < 0 ? null : header[col[k]];
    columns.closed = closedAt < 0 ? null : header[closedAt];
    return { type, positives, dropped, columns, badDates };
  }

  function statusChoices(type, positives) {
    const out = type.statuses.map(s => ({ key: s.label, label: s.label, color: s.color,
      count: positives.filter(p => p.status && p.status.label === s.label).length }));
    const none = positives.filter(p => !p.status).length;
    if (none) out.push({ key: 'none', label: 'No status', color: null, count: none });
    return out;
  }

  function defaultTicks(type, positives) {
    const all = statusChoices(type, positives).map(c => c.key);
    const applyTo = type.zones.applyTo;
    return { statuses: applyTo === 'confirmed' ? [type.statuses[0].label] : all, closed: applyTo === 'all' };
  }

  function targets(positives, ticks) {
    const on = new Set(ticks.statuses);
    return positives.filter(p => on.has(p.status ? p.status.label : 'none') && (!p.closed || ticks.closed));
  }

  function suggestedLayers(type, positives, loaded) {
    const species = positives.map(p => text(p.species).toLowerCase()).filter(Boolean);
    const hasWord = (v, w) => new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(v);
    const hits = type.layers.bySpecies.filter(e => e.words.some(w => species.some(v => hasWord(v, w))));
    const keys = hits.length ? hits.flatMap(e => e.keys) : type.layers.default;
    const have = new Set(loaded || []);
    return [...new Set(keys)].filter(k => have.has(k));
  }

  function ringSites(list, rings) {
    const distances = rings.map(r => r.distance);
    const prepared = P().prepareSites(list.map(p => ({ name: p.name, lat: p.lat, long: p.lon })),
      { defaultKm: Math.max(...distances), bands: distances });
    prepared.sites.forEach((s, k) => { s.positive = list[k].index; });
    return prepared.sites;
  }

  function zoneSites(zones) {
    return P().prepareSites(zones.map(z => ({ name: z.name, lat: z.point[1], long: z.point[0], zone: z.geometry })),
      { defaultKm: 0 }).sites;
  }

  function ringLabel(rings, km) {
    const ring = rings.find(r => km <= r.distance) || rings[rings.length - 1];
    return ring.label;
  }

  function coarseReason(point) {
    if (TOWN_LEVEL.test(text(point.geoSource))) return 'located only to a town';
    if (UNPLACED.test(text(point.geoSource))) return 'not placed';
    const p = point.precision || {};
    if (p.geocode_precision !== undefined) {
      const v = text(p.geocode_precision).toLowerCase();
      if (v !== 'rooftop' && v !== 'street') return v ? 'location precision "' + v + '"' : 'no location precision';
    }
    if (p.match_status !== undefined && text(p.match_status) !== 'Matched') return 'address not matched';
    if (p.premises_type !== undefined && text(p.premises_type) !== 'Street') return 'not a street address';
    return null;
  }

  // RAD's three location-precision columns; a facility file may carry any of them.
  const PRECISION = ['geocode_precision', 'match_status', 'premises_type'];
  // A blank line, as facilities.prepare skips it before numbering its points (copied from shared/facilities.js, v1.1).
  const isBlankLine = r => r.length === 1 && (r[0] == null || r[0] === '');
  function precisionRows(header, rows) {
    const at = PRECISION.map(c => header.findIndex(h => text(h).toLowerCase() === c));
    return (rows || []).filter(r => !isBlankLine(r)).map(r => {
      const out = {};
      PRECISION.forEach((c, k) => { if (at[k] >= 0) out[c] = r[at[k]] === undefined ? '' : r[at[k]]; });
      return out;
    });
  }

  // The same site twice in a layer (one line of the file repeated) is counted once: by its name and place.
  const siteKey = r => r.lat + '\r' + r.lon + '\r' + r.name;

  function inside(sites, layers, opts) {
    const o = opts || {}, PX = P(), zonesMode = o.mode === 'zones';
    const rows = [], leftOut = [], summaries = [];
    const nameOf = p => text(p.display !== undefined ? p.display : p.name);
    for (const l of layers) {
      const usable = [];
      let left = 0;
      for (const p of l.points) {
        const reason = o.includeCoarse ? null : coarseReason(p);
        if (reason) {
          left++;
          leftOut.push({ layer: l.key, layerLabel: l.label, name: nameOf(p), reason, county: p.county || null,
            town: p.town || null });
        } else usable.push(p);
      }
      const found = [];
      sites.forEach(s => {
        const mine = [];
        usable.forEach(p => {
          const km = PX.siteKm(p.lat, p.lon, s);
          if (km === null || km > s.bufferKm) return;
          const bandKm = PX.ringOf(s.radii, km);
          mine.push({ site: s.id, siteName: text(s.name), layer: l.key, layerLabel: l.label, name: nameOf(p),
            lat: p.lat, lon: p.lon, exactKm: km, km: round2(km), bandKm,
            zone: zonesMode ? text(s.name) : ringLabel(o.rings, km), county: p.county || null, town: p.town || null });
        });
        mine.sort((a, b) => a.exactKm - b.exactKm || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        mine.forEach(r => found.push(r));
      });
      found.forEach(r => rows.push(r));
      // Each site once: in the smallest ring that holds it (rings), or in every zone polygon that holds it (zones).
      const byZone = new Map((zonesMode ? sites.map(s => text(s.name)) : o.rings.map(r => r.label)).map(z => [z, new Set()]));
      const best = new Map();
      for (const r of found) {
        const k = siteKey(r);
        if (zonesMode) byZone.get(r.zone).add(k);
        else if (!best.has(k) || r.exactKm < best.get(k).exactKm) best.set(k, r);
      }
      for (const [k, r] of best) byZone.get(r.zone).add(k);
      const insideCount = new Set(found.map(siteKey)).size;
      let nearest = null;
      if (!insideCount) {
        for (const p of usable) for (const from of o.positives || []) {
          const km = PX.distanceKm(p.lat, p.lon, from.lat, from.lon);
          if (km === null) continue;
          const name = nameOf(p);
          if (!nearest || km < nearest.exactKm || (km === nearest.exactKm && name < nearest.name)) {
            nearest = { name, exactKm: km, km: round2(km), from: from.name, county: p.county || null, town: p.town || null };
          }
        }
      }
      summaries.push({ key: l.key, label: l.label, color: l.color, mode: zonesMode ? 'zones' : 'rings', inside: insideCount,
        byZone: [...byZone].map(([label, set]) => ({ label, count: set.size })), nearest, leftOut: left,
        usable: usable.length });
    }
    const total = new Set(rows.map(r => r.layer + '\r' + siteKey(r))).size;
    return { rows, layers: summaries, leftOut, total };
  }

  function countLine(s, unit) {
    const u = UNITS[unit || 'km'];
    if (s.inside) {
      // A ring's label takes "the" ("in the Control zone"); a zone file's names are written as they are.
      const parts = s.byZone.filter(z => z.count).map(z => z.count + ' in ' + (s.mode === 'rings' ? 'the ' : '') + z.label);
      return s.label + ': ' + listOf(parts);
    }
    if (!s.nearest) return s.label + ': none inside' + (s.usable ? '' : ' (no usable locations)');
    return s.label + ': none inside. Nearest: ' + s.nearest.name + ', ' + round2(s.nearest.exactKm * u.factor) + ' ' +
      u.label + ' from ' + s.nearest.from;
  }

  function valueBoxes(read, result) {
    const all = read ? read.positives : [];
    const withZones = read && read.targets ? read.targets.length : null;
    const dates = all.map(p => p.detected).filter(Boolean).sort();
    const last = !read ? { value: null, reason: 'Not available: needs the positives file' }
      : !read.columns.detected ? { value: null, reason: 'Not available: needs Detection Date' }
        : !dates.length ? { value: null, reason: 'Not available: no readable Detection Date' }
          : { value: dates[dates.length - 1], reason: null };
    const insideBox = !result || !result.layers.length
      ? { value: null, reason: 'Not available: needs a facility layer' } : { value: result.total, reason: null };
    return {
      positives: read ? { value: all.length, note: withZones === null ? null : withZones + ' with zones' }
        : { value: null, note: 'Not available: needs the positives file' },
      last,
      inside: insideBox
    };
  }

  function exportRows(read, targetList, result, unit) {
    const u = UNITS[unit || 'km'];
    const km = x => x === null || x === undefined ? null : round2(x * u.factor);
    const withZones = new Set((targetList || []).map(p => p.index));
    const positives = { columns: ['Positive', 'Status', 'Closed', 'Detection Date', 'County', 'Latitude', 'Longitude',
      'Zones'], rows: read.positives.map(p => [p.name, p.status ? p.status.label : (p.statusText || ''),
      p.closed ? 'Yes' : 'No', p.detected || '', p.county || '', p.lat, p.lon, withZones.has(p.index) ? 'Yes' : 'No']) };
    const inside = { columns: ['Positive or zone', 'Layer', 'Site', 'Distance (' + u.label + ')', 'Zone', 'County', 'Town'],
      rows: result.rows.map(r => [r.siteName, r.layerLabel, r.name, km(r.exactKm), r.zone, r.county || '', r.town || '']) };
    const zoneNames = result.layers.length ? result.layers[0].byZone.map(z => z.label) : [];
    const layers = { columns: ['Layer', 'Inside'].concat(zoneNames, ['Nearest', 'Nearest distance (' + u.label + ')',
      'Nearest to', 'Left out']),
    rows: result.layers.map(s => [s.label, s.inside].concat(s.byZone.map(z => z.count),
      [s.nearest ? s.nearest.name : '', s.nearest ? km(s.nearest.exactKm) : '', s.nearest ? s.nearest.from : '', s.leftOut])) };
    const leftOut = { columns: ['Layer', 'Site', 'Reason', 'County', 'Town'],
      rows: result.leftOut.map(x => [x.layerLabel, x.name, x.reason, x.county || '', x.town || '']) };
    return { positives, inside, layers, leftOut };
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.emergencyRules = { readPositives, statusChoices, defaultTicks, targets, suggestedLayers, ringSites,
    zoneSites, ringLabel,
    coarseReason, precisionRows, inside, countLine, valueBoxes, exportRows, round2, dateOf, PRIVATE, COLUMNS, UNITS,
    PRECISION };
})(typeof window !== 'undefined' ? window : globalThis);
