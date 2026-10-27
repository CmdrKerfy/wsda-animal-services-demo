/* Emergency Response rules: pure (no page work), on plain lists, so the unit suite and the R reference
 * (tests/oracle/em_oracle.R) check them directly. Distances and "inside" are the shared engine's (shared/proximity.js:
 * CVI's distance rule on a sphere of 6,378,137 m, the edge counting as inside, a point inside a zone polygon at 0 km).
 *
 * Positives:
 *   readPositives(header, rows, type?) -> { type, positives, dropped, columns, badDates, badCloseDates,
 *     badReleaseDates }
 *     header: the file's column names; rows: its data rows (lists of text, as a CSV reader gives them). type: an
 *     emergency type (types.js); without one, the type is picked (types.pick) from the values of every disease
 *     column the loaded types name (their columns.disease) that the file has.
 *     The type names the columns read for the ID, the detection date, the disease, the status, the quarantine release,
 *     the flock type, the inventory and the columns shown (its columns field), and the closed column and closed date
 *     (its closed field); the latitude, longitude, county and species are read by the names in COLUMNS whatever the
 *     type.
 *     positives: [{ index (0, 1, ... among the usable rows), line (the file's line number, the header being line 1),
 *       id, name, county, lat, lon, status ({ label, color } or null), statusText, closed, closedDate, quarantine,
 *       detected (dates as YYYY-MM-DD or null), disease, species, flockType, inventoryText (as written), inventory
 *       (a number, or null when blank or unreadable), size (the flock size class), shown ([[column, value]] in the
 *       type's order) }].
 *     The detection date is the first of the type's detected columns with a value in that row (the agreed HPAI
 *     table: Confirmed Diagnosis, else Date Reported). A file with none of the type's status columns gives every
 *     positive the type's first status (the agreed HPAI table has no testing status: every row is confirmed); with
 *     one, a value that is not one of the type's statuses gives none, as before.
 *     dropped: the rows without a usable latitude and longitude ("not mapped"): each with the same fields as a
 *       positive (index, lat and lon null; named by its ID, else "Line 9 (County)") and a reason: "no coordinates",
 *       "no latitude", "no longitude", "latitude and longitude look swapped" (unusable as written, in Washington the
 *       other way round; never swapped by the page) or "coordinates not readable".
 *     columns: the column found for each of lat, lon, id, status, closed, closedDate, quarantine, flockType,
 *       inventory, detected (the first found), county, disease, species (or null), and shown (a list).
 *     badDates, badCloseDates, badReleaseDates: rows whose detection date, closed date or quarantine release date
 *       could not be read. A positive with an unreadable closed date is past by its closed column alone.
 *     Names: the ID (Case ID, or AnimalDiseaseReportId in E1a's form) when the row has one, else "Positive 1
 *     (County)" in file order, or "Positive 1" without a county. A column whose name holds address, location, street
 *     or premise is never read, so no address can reach a name, a label or an export.
 *   statusChoices(type, positives) -> [{ key, label, color, count }]: the type's statuses, then "No status" when a
 *     positive has none (key "none").
 *   defaultTicks(type, positives) -> { statuses: [keys], pastShown }: zones.applyTo "open": every status;
 *     "confirmed": the type's first status only. Past positives are hidden at first (pastShown false).
 *   targets(positives, ticks, win?) -> the positives that get zones: a ticked status, inside the window, and current
 *     on its end date. A past positive never gets zones.
 *   suggestedLayers(type, positives, loaded) -> the layer keys ticked at first: the keys of every bySpecies entry
 *     with a word in a positive's species (any case, at the start of a word), else the type's default list; only
 *     the keys in loaded (the layers whose files are there), in the type's order.
 *
 * The window, the groups and the play (dates as YYYY-MM-DD; a window is { start, end }, either may be blank):
 *   windowOf(positives) -> the earliest and latest readable detection dates, or null.
 *   inWindow(p, win) -> detected between start and end, both counting; a positive without a readable date is inside
 *     whatever the window.
 *   isPast(p, end) -> past on the end date: its closed date on or before it; without a readable closed date, its
 *     closed column says closed. stillQuarantined(read, p, end) -> past, in a file with a quarantine column, and its
 *     release blank or after the end date.
 *   groups(read, win) -> { current, past, stillQuarantined, undated, outside, notMapped }: the positives inside the
 *     window by group (undated: those of them without a readable date; outside: detected outside the window).
 *     groupOf(p, end) -> "Current", "Past" or "Not mapped".
 *   playSteps(win) -> { by: 'week' or 'month', steps: [{ start, end, label }] }: epi weeks (Sunday to Saturday,
 *     "Week of Oct 4, 2026"), or calendar months ("Month of Oct 2026") when the window holds more than 26 weeks;
 *     each step ends on its Saturday or the month's last day, the last on the window's end. Worked out with
 *     Date.UTC, never local time. weekOf(date) -> its Sunday; dayLabel(date) -> "Oct 4, 2026".
 *   overTime(read, win, steps) -> { by, columns: [{ start, end, label, current, past, outside }], notMapped, undated }:
 *     the chart's counts, one column per step of the file's play (steps), the mapped dated positives by the step
 *     they were detected in: current or past on the window's end date, or outside the window.
 *
 * The report's numbers:
 *   inventoryOf(text) -> a whole number (thousands commas allowed), or null; never zero for a blank.
 *   sizeClass(n) -> "Small" under 100, "Medium" 100 to 1,000, "Large" over 1,000, or null.
 *   numbersLine(read, list) -> "4 commercial, 67 backyard, 4.1M birds" (the flock type with the most animals first;
 *     the type's inventoryWord, then its countedApart words: "1.2M birds, 3,550 cattle"; "; 2 without an inventory"
 *     when some are blank), or null. inventoryWordOf(type, p) -> the word p's animals are counted under. bigNumber(n) -> "4.1M",
 *     or "18,535" under a million.
 *   notMappedLine(dropped) -> "2 not mapped: no coordinates", or null.
 *   details(read, p) -> [[column, value]] shown in the hover and positives.csv: the flock type, the shown columns,
 *     the inventory as written and "Flock size".
 *
 * Zones (ring distances in the unit shown, "km" or "mi"; toKm(d, unit) is the one conversion, 1 mile = 1.609344 km,
 * and fromKm(km, unit) turns an exact km into the unit shown):
 *   ringSites(targets, rings, unit?) -> prepared sites (proximity.prepareSites): one per positive with zones, its
 *     radii the rings' distances in km; each site also has positive (the positive's index).
 *   zoneSites(zones) -> prepared sites from a zone file's zones (zones.js read()): each a polygon, matched inside only.
 *   ringLabel(rings, km, unit?) -> the label of the smallest ring at least km (the ring a point lies in).
 *   daysSince(sites, list, asOf) -> for each site and each of its rings, the latest detection among the dated
 *     positives in list inside it, and the days from it to asOf: [{ site, name, positive, rings: [{ km, latest,
 *     days }], latest, days (the outer ring's) }]. byQuiet(rows) -> the longest-quiet zone last.
 *   zoneRows(days, { zonesMode, rings, unit, asOf }) -> { columns, rows } for the "Zones" list and zones.csv: one row
 *     per positive with zones (its outer ring) or per zone-file zone, the longest-quiet last.
 *   zonesGeoJson(parts, opts) -> a FeatureCollection (RFC 7946: longitude and latitude, no crs, six decimals,
 *     exteriors counterclockwise and holes clockwise): a whole 360-step circle per ring per positive, and each zone
 *     file zone as read, never merged; properties name (as zones.csv's "Zone", so the file reopens named here and
 *     in a GIS), zone, positive, group, distance, unit, days_since_last_positive, as_of. A ring's direction is read by shared/zones.js signedArea (positive when counterclockwise).
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
 *     opts: { mode ('rings' or 'zones'), rings (rings mode: the rings, for the labels), unit (the rings' unit, km by
 *       default), positives (the positives the "nearest" line measures from), includeCoarse (true: no point is left
 *       out) }.
 *     rows: layer by layer, then site by site, nearest first (then by name): { site, siteName, layer, layerLabel, name, lat,
 *       lon, exactKm, km (R's round(x, 2)), bandKm, zone (the ring's label, or the zone's name), county, town }.
 *     layers: per layer { key, label, color, mode, inside (distinct sites inside any zone), byZone: [{ label, count }] (each
 *       site once, in the smallest ring that holds it, or in each zone polygon that holds it), nearest ({ name, km,
 *       from, county, town } for a layer with nothing inside, null otherwise), leftOut (count), usable (points
 *       checked) }.
 *     leftOut: [{ layer, layerLabel, name, reason, county, town }]. total: distinct sites inside, over every layer.
 *   countLine(layerSummary, unit?) -> one line per layer: "Dairies: 1 in the Infection zone, 3 in the Control zone",
 *     or, with nothing inside, "Dairies: none inside. Nearest: Synthetic Dairy 3, 14.2 km from SYN-HPAI-003" (the
 *     distance in the unit, km by default).
 *
 * The value boxes and the exports:
 *   valueBoxes(read, result, win?) -> { positives: { value, note, lines }, past: { value, reason, note, quarantined },
 *     last: { value, reason, note }, inside: { value, reason } }; a value that cannot be given is null with "Not
 *     available: needs ..." as its reason (never shown as zero). Each count is said once: the positives' value
 *     counts the current positives inside the window, its note "5 with zones" only when that differs; the past box
 *     counts the past positives inside it, its note "2 still under quarantine" (or "none under quarantine"); lines
 *     holds the not-mapped line, "2 dates not readable" (detection, closed and release dates together), "1 without
 *     a date" and "Animals at the current positives: ..." (the numbers line), each when it applies; the last
 *     positive is the latest inside the window, its note "As of Oct 5, 2026" (the window's end). Without a window
 *     (no readable detection date) the current positives are those not past by their closed column, the past box is
 *     not available and only the not-mapped and unreadable-dates lines are added.
 *   exportRows(read, targets, result, unit?, win?) -> { positives, inside, layers, leftOut }: each { columns, rows }
 *     for the CSV files, with no address column; positives.csv lists the positives inside the window and the rows
 *     not mapped, each with its group, the details and a note ("Still under quarantine", or "Not mapped: ..."). The
 *     distances in the unit (km by default).
 * The inside rows and counts are copied from site/cvi/app/lookup.js, v1.1 (facilitiesInside, facilityCounts and
 * facilityTable), with the zones' labels and the unit added, and the rows grouped by layer first (the results tab lists
 * them layer by layer); round2 is copied from the same file. */
(function (root) {
  'use strict';
  const P = () => root.WSDA.proximity;
  const T = () => root.WSDA.emergencyTypes;
  // Ring distances are kept in the unit shown and turned into km by toKm alone; shown distances come from the exact km.
  const KM_PER_MILE = 1.609344;
  const UNITS = { km: { label: 'km' }, mi: { label: 'mi' } };
  const toKm = (d, unit) => (unit === 'mi' ? d * KM_PER_MILE : d);
  const fromKm = (km, unit) => (unit === 'mi' ? km / KM_PER_MILE : km);
  // Washington's box, a little wide, used only to say a pair looks swapped.
  const WA = { south: 45.5, north: 49.1, west: -124.9, east: -116.9 };

  // Columns read from a positives file whatever the type, any case (the type names the others); never one whose
  // name holds a word below.
  const COLUMNS = {
    lat: ['case lat', 'lat', 'latitude', 'y'],
    lon: ['case long', 'long', 'lon', 'lng', 'longitude', 'x'],
    county: ['county'],
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
  // True when a word starts a word of the text (both lowercased), as types.js matches disease words.
  const hasWord = (v, w) => new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(v);
  const listOf = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

  // The index of the first column with one of the names (any case), skipping private columns; -1 when none.
  function columnIndex(header, names) {
    const lower = header.map(h => text(h).toLowerCase());
    for (const n of names) {
      const i = lower.indexOf(n.toLowerCase());
      if (i >= 0 && !PRIVATE.test(header[i])) return i;
    }
    return -1;
  }

  // A date written YYYY-MM-DD, YYYY/M/D or M/D/YYYY (a time after any of them is ignored, as Excel and ArcGIS write
  // "10/15/2026 0:00"), as YYYY-MM-DD; null otherwise.
  function dateOf(v) {
    const s = text(v);
    let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/.exec(s), y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T].*)?$/.exec(s);
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
    const cell = (r, i) => i < 0 ? '' : text(r[i]);
    const blank = r => r.every(v => text(v) === '');
    const data = (rows || []).map((r, i) => ({ r, line: i + 2 })).filter(x => !blank(x.r));
    // The type: picked from the values of every disease column the loaded types name that the file has.
    if (!type) {
      const diseaseNames = T().list().flatMap(t => t.columns.disease);
      const at = [...new Set(diseaseNames.map(n => columnIndex(header, [n])).filter(i => i >= 0))];
      type = T().pick(at.length ? at.flatMap(i => data.map(x => cell(x.r, i))) : null).type;
    }
    const names = type.columns;
    Object.assign(col, { id: columnIndex(header, names.id), status: columnIndex(header, names.status),
      disease: columnIndex(header, names.disease), quarantine: columnIndex(header, names.quarantine),
      closed: columnIndex(header, type.closed.column), closedDate: columnIndex(header, type.closed.dateColumn),
      flockType: columnIndex(header, names.flockType), inventory: columnIndex(header, names.inventory) });
    // Every detection-date column the file has, in the type's order of preference; and the columns shown.
    const each = list => [...new Set(list.map(n => columnIndex(header, [n])).filter(i => i >= 0))];
    const detectedAt = each(names.detected), shownAt = each(names.shown);
    const firstStatus = type.statuses[0];
    const positives = [], dropped = [];
    let badDates = 0, badCloseDates = 0, badReleaseDates = 0;
    for (const { r, line } of data) {
      const latText = cell(r, col.lat), lonText = cell(r, col.lon);
      const lat = P().number(latText), lon = P().number(lonText);
      const mapped = P().usable(lat, lon);
      const id = cell(r, col.id), county = cell(r, col.county);
      const statusText = cell(r, col.status);
      const status = col.status < 0 ? firstStatus : T().statusOf(type, statusText);
      const detectedText = detectedAt.map(i => cell(r, i)).find(v => v) || '', detected = dateOf(detectedText);
      if (detectedText && !detected) badDates++;
      const closedText = cell(r, col.closedDate), closedDate = dateOf(closedText);
      if (closedText && !closedDate) badCloseDates++;
      const releaseText = cell(r, col.quarantine), release = dateOf(releaseText);
      if (releaseText && !release) badReleaseDates++;
      const inventoryText = cell(r, col.inventory), inventory = inventoryOf(inventoryText);
      const p = { index: null, line, id: id || null, name: null, county: county || null, lat: null, lon: null,
        status: status ? { label: status.label, color: status.color } : null,
        statusText: statusText || null, closed: col.closed >= 0 && T().isClosed(type, r[col.closed]),
        closedDate, quarantine: release,
        detected, disease: cell(r, col.disease) || null, species: cell(r, col.species) || null,
        flockType: cell(r, col.flockType) || null, inventoryText: inventoryText || null, inventory,
        size: sizeClass(inventory), shown: shownAt.map(i => [header[i], cell(r, i)]) };
      if (mapped) {
        const n = positives.length + 1;
        positives.push(Object.assign(p, { index: positives.length, lat, lon,
          name: id || 'Positive ' + n + (county ? ' (' + county + ')' : '') }));
      } else {
        dropped.push(Object.assign(p, { name: id || 'Line ' + line + (county ? ' (' + county + ')' : ''),
          reason: notMappedReason(latText, lonText, lat, lon) }));
      }
    }
    const columns = {};
    for (const k of Object.keys(col)) columns[k] = col[k] < 0 ? null : header[col[k]];
    columns.detected = detectedAt.length ? header[detectedAt[0]] : null;
    columns.shown = shownAt.map(i => header[i]);
    return { type, positives, dropped, columns, badDates, badCloseDates, badReleaseDates };
  }

  // Why a row could not be mapped. A pair that is unusable as written but would fall in Washington the other way
  // round is reported as swapped; the page never swaps it itself.
  function notMappedReason(latText, lonText, lat, lon) {
    if (!latText && !lonText) return 'no coordinates';
    if (!latText) return 'no latitude';
    if (!lonText) return 'no longitude';
    if (lat !== null && lon !== null && lon >= WA.south && lon <= WA.north && lat >= WA.west && lat <= WA.east) {
      return 'latitude and longitude look swapped';
    }
    return 'coordinates not readable';
  }

  // A whole number of animals, written with or without thousands commas ("1,250,000"); null when blank or unreadable,
  // never zero.
  function inventoryOf(v) {
    const s = text(v);
    if (!/^\d+$/.test(s) && !/^\d{1,3}(,\d{3})+$/.test(s)) return null;
    return Number(s.replace(/,/g, ''));
  }

  // The flock size class, as the agency's HPAI update defines it: Small under 100, Medium 100 to 1,000, Large over
  // 1,000; null without an inventory.
  function sizeClass(n) {
    if (n === null || n === undefined) return null;
    return n < 100 ? 'Small' : n <= 1000 ? 'Medium' : 'Large';
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
    return { statuses: applyTo === 'confirmed' ? [type.statuses[0].label] : all, pastShown: false };
  }

  function targets(positives, ticks, win) {
    const on = new Set(ticks.statuses), end = win ? win.end : null;
    return positives.filter(p => on.has(p.status ? p.status.label : 'none') && inWindow(p, win) && !isPast(p, end));
  }

  function suggestedLayers(type, positives, loaded) {
    const species = positives.map(p => text(p.species).toLowerCase()).filter(Boolean);
    const hits = type.layers.bySpecies.filter(e => e.words.some(w => species.some(v => hasWord(v, w))));
    const keys = hits.length ? hits.flatMap(e => e.keys) : type.layers.default;
    const have = new Set(loaded || []);
    return [...new Set(keys)].filter(k => have.has(k));
  }

  // ---- The window, the groups and the play -------------------------------------------------------------------

  // The earliest and the latest readable detection date, or null when no positive has one.
  function windowOf(positives) {
    const dates = positives.map(p => p.detected).filter(Boolean).sort();
    return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null;
  }

  // Inside the window: detected between its start and end (both counting); a positive without a readable date is
  // shown whatever the window. A blank start or end does not limit.
  function inWindow(p, win) {
    if (!win || !p.detected) return true;
    return (!win.start || p.detected >= win.start) && (!win.end || p.detected <= win.end);
  }

  // Past on the end date: its closed date (the end of surveillance) on or before it; without a readable closed
  // date, its closed column says closed. With no end date, any closed date makes it past.
  function isPast(p, end) {
    if (p.closedDate) return !end || p.closedDate <= end;
    return p.closed;
  }

  // A past positive whose quarantine release is blank or after the end date, in a file with a quarantine column.
  function stillQuarantined(read, p, end) {
    if (!read.columns.quarantine || !isPast(p, end)) return false;
    return !p.quarantine || (!!end && p.quarantine > end);
  }

  function groups(read, win) {
    const end = win ? win.end : null;
    const out = { current: [], past: [], stillQuarantined: [], undated: [], outside: [], notMapped: read.dropped };
    for (const p of read.positives) {
      if (!inWindow(p, win)) {
        out.outside.push(p);
        continue;
      }
      if (!p.detected) out.undated.push(p);
      if (isPast(p, end)) {
        out.past.push(p);
        if (stillQuarantined(read, p, end)) out.stillQuarantined.push(p);
      } else out.current.push(p);
    }
    return out;
  }

  // A positive's group on the end date: "Current", "Past", or "Not mapped" for a row without usable coordinates.
  const groupOf = (p, end) => (p.index === null ? 'Not mapped' : isPast(p, end) ? 'Past' : 'Current');

  // Dates: YYYY-MM-DD in and out, worked out in UTC (never the computer's own time zone).
  const DAY_MS = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const msOf = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const isoOf = ms => new Date(ms).toISOString().slice(0, 10);
  const addDays = (iso, n) => isoOf(msOf(iso) + n * DAY_MS);
  const daysBetween = (from, to) => Math.round((msOf(to) - msOf(from)) / DAY_MS);
  // The Sunday that starts the date's epi week (Sunday to Saturday).
  const weekOf = iso => addDays(iso, -new Date(msOf(iso)).getUTCDay());
  // "Oct 4, 2026"
  const dayLabel = iso => MONTHS[+iso.slice(5, 7) - 1] + ' ' + +iso.slice(8, 10) + ', ' + iso.slice(0, 4);
  // More than this many epi weeks in the window: the play and the chart step by calendar month.
  const MAX_WEEKS = 26;

  // The play's steps over the window: { by: 'week' or 'month', steps: [{ start, end, label }] }. Each step's end
  // is its Saturday (or the month's last day), except the last, which stops on the window's end itself.
  function playSteps(win) {
    if (!win || !win.start || !win.end || win.start > win.end) return { by: null, steps: [] };
    const first = weekOf(win.start), last = weekOf(win.end);
    const weeks = daysBetween(first, last) / 7 + 1;
    const steps = [];
    if (weeks <= MAX_WEEKS) {
      for (let sunday = first; sunday <= last; sunday = addDays(sunday, 7)) {
        const saturday = addDays(sunday, 6);
        steps.push({ start: sunday, end: saturday < win.end ? saturday : win.end, label: 'Week of ' + dayLabel(sunday) });
      }
      return { by: 'week', steps };
    }
    let y = +win.start.slice(0, 4), m = +win.start.slice(5, 7);
    const lastMonth = win.end.slice(0, 7);
    for (;;) {
      const start = String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-01';
      const monthEnd = isoOf(Date.UTC(y, m, 0));
      steps.push({ start, end: monthEnd < win.end ? monthEnd : win.end, label: 'Month of ' + MONTHS[m - 1] + ' ' + y });
      if (start.slice(0, 7) === lastMonth) break;
      if (++m > 12) { m = 1; y++; }
    }
    return { by: 'month', steps };
  }

  // Positives over time (the chart): the mapped positives with a readable detection date, counted in the step they
  // were detected in. steps: playSteps over the file's whole span, so the columns stay put while the window moves.
  // Each column counts its current and past positives on the window's end date (detected inside the window) and those
  // outside the window (detected before its start or after its end). The rows not mapped and the positives without a
  // date are not counted; their numbers are given for the note under the chart.
  function overTime(read, win, steps) {
    const end = win ? win.end : null;
    const columns = (steps ? steps.steps : []).map(s => ({ start: s.start, end: s.end, label: s.label,
      current: 0, past: 0, outside: 0 }));
    const positives = read ? read.positives : [];
    for (const p of positives) {
      if (!p.detected) continue;
      const c = columns.find(x => p.detected >= x.start && p.detected <= x.end);
      if (!c) continue;   // only when the steps are not the file's own
      if (!inWindow(p, win)) c.outside++;
      else if (isPast(p, end)) c.past++;
      else c.current++;
    }
    return { by: steps ? steps.by : null, columns, notMapped: read ? read.dropped.length : 0,
      undated: positives.filter(p => !p.detected).length };
  }

  // ---- The report's numbers ------------------------------------------------------------------------------------

  // 4133418 -> "4.1M"; under a million with thousands commas ("18,535").
  function bigNumber(n) {
    if (n >= 1e6) return Math.round(n / 1e5) / 10 + 'M';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // The word a positive's animals are counted under: the first of the type's countedApart entries with a word in its
  // species ("cattle"), else the type's inventoryWord ("birds").
  function inventoryWordOf(type, p) {
    const species = text(p.species).toLowerCase();
    const apart = species ? type.countedApart.find(a => a.species.some(w => hasWord(species, w))) : null;
    return apart ? apart.word : type.inventoryWord;
  }

  // One line counting the positives by flock type and adding up their animals: "4 commercial, 67 backyard, 4.1M
  // birds", with the type's countedApart animals added up apart ("1.2M birds, 3,550 cattle"). The flock type with
  // the most animals comes first; the inventoryWord's total, then each countedApart word in the type's order, each
  // only when one of its positives has an inventory. A blank inventory is left out of the totals and named ("2
  // without an inventory"), never counted as zero. Null when the file has neither column, or for no positives.
  function numbersLine(read, list) {
    const hasType = !!read.columns.flockType, hasInventory = !!read.columns.inventory;
    if (!list.length || (!hasType && !hasInventory)) return null;
    const parts = [];
    if (hasType) {
      const kinds = new Map();
      for (const p of list) {
        const key = text(p.flockType).toLowerCase();
        const k = kinds.get(key) || { key, count: 0, animals: 0 };
        k.count++;
        k.animals += p.inventory || 0;
        kinds.set(key, k);
      }
      const order = [...kinds.values()].sort((a, b) => (a.key === '') - (b.key === '') || b.animals - a.animals ||
        b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      order.forEach(k => parts.push(k.count + ' ' + (k.key || 'without a type')));
    }
    let line = '';
    if (hasInventory) {
      const known = list.filter(p => p.inventory !== null);
      const totals = new Map([read.type.inventoryWord].concat(read.type.countedApart.map(a => a.word)).map(w => [w, null]));
      for (const p of known) {
        const w = inventoryWordOf(read.type, p);
        totals.set(w, (totals.get(w) || 0) + p.inventory);
      }
      totals.forEach((n, w) => { if (n !== null) parts.push(bigNumber(n) + ' ' + w); });
      line = parts.join(', ');
      const missing = list.length - known.length;
      if (missing) line += (line ? '; ' : '') + missing + ' without an inventory';
    } else line = parts.join(', ');
    return line;
  }

  // The rows without usable coordinates, counted by reason: "2 not mapped: no coordinates", or with several reasons
  // "3 not mapped: 2 no coordinates, 1 latitude and longitude look swapped". Null when every row is mapped.
  function notMappedLine(dropped) {
    if (!dropped.length) return null;
    const by = new Map();
    dropped.forEach(d => by.set(d.reason, (by.get(d.reason) || 0) + 1));
    const reasons = [...by];
    if (reasons.length === 1) return dropped.length + ' not mapped: ' + reasons[0][0];
    return dropped.length + ' not mapped: ' + reasons.map(([r, n]) => n + ' ' + r).join(', ');
  }

  // What the hover and positives.csv show beside a positive, in this order: the flock type, the shown columns, the
  // inventory as written and the flock size class (the last two when the file has an inventory column).
  function details(read, p) {
    const out = [];
    if (read.columns.flockType) out.push([read.columns.flockType, p.flockType || '']);
    p.shown.forEach(pair => out.push(pair));
    if (read.columns.inventory) {
      out.push([read.columns.inventory, p.inventoryText || '']);
      out.push(['Flock size', p.size || '']);
    }
    return out;
  }

  // ---- Days since the last positive, per zone ------------------------------------------------------------------

  // For each prepared site (ringSites or zoneSites), each of its rings: the latest detection among the dated
  // positives inside it (the edge counting; inside a zone file's polygon by proximity.inZone), and the days from
  // it to the as-of date. list: the positives that count (those detected inside the window, whatever their group).
  // -> [{ site, name, positive (a ring site's positive index, else null), rings: [{ km, latest, days }], latest, days
  // (the outer ring's) }]; latest and days are null when no dated positive is inside.
  function daysSince(sites, list, asOf) {
    const dated = list.filter(p => p.detected && (!asOf || p.detected <= asOf));
    return sites.map(s => {
      const rings = s.radii.map(km => {
        let latest = null;
        for (const p of dated) {
          const d = P().siteKm(p.lat, p.lon, s);
          if (d !== null && d <= km && (!latest || p.detected > latest)) latest = p.detected;
        }
        return { km, latest, days: latest && asOf ? daysBetween(latest, asOf) : null };
      });
      const outer = rings[rings.length - 1];
      return { site: s.id, name: text(s.name), positive: s.positive === undefined ? null : s.positive, rings,
        latest: outer.latest, days: outer.days };
    });
  }

  // The "Zones" list's order: the most recent positive first, the longest-quiet zone last, a zone with no dated
  // positive after them all; then by name.
  function byQuiet(rows) {
    const key = r => (r.days === null ? Infinity : r.days);
    return rows.slice().sort((a, b) => key(a) - key(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  // The "Zones" list and zones.csv: one row per positive with zones (its outer ring: "Control zone (10 km) around
  // SYN-HPAI-001") or per zone-file zone (its name), the longest-quiet last. days: daysSince's rows; o: { zonesMode,
  // rings (distances in unit), unit, asOf }. A zone-file zone has no positive, ring, distance or unit.
  function zoneRows(days, o) {
    const unit = o.unit || 'km', outer = !o.zonesMode && o.rings && o.rings.length ? o.rings[o.rings.length - 1] : null;
    const shown = d => String(Number(d.toFixed(2)));
    const columns = ['Zone', 'Positive', 'Ring', 'Distance', 'Unit', 'Last positive', 'Days since the last positive', 'As of'];
    const rows = byQuiet(days).map(z => (outer
      ? [outer.label + ' (' + shown(outer.distance) + ' ' + UNITS[unit].label + ') around ' + z.name, z.name, outer.label,
        outer.distance, UNITS[unit].label, z.latest || '', z.days === null ? '' : z.days, o.asOf || '']
      : [z.name, '', '', '', '', z.latest || '', z.days === null ? '' : z.days, o.asOf || '']));
    return { columns, rows };
  }

  // ---- The zones as GeoJSON (RFC 7946) ---------------------------------------------------------------------------

  const round6 = x => Number(x.toFixed(6));
  // A ring written to RFC 7946: counterclockwise (ccw true) or clockwise, six decimals, closed.
  function writeRing(ring, ccw) {
    const r = (root.WSDA.zones.signedArea(ring) > 0) === ccw ? ring.slice() : ring.slice().reverse();
    const out = r.map(pt => [round6(pt[0]), round6(pt[1])]);
    const a = out[0], b = out[out.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push(a.slice());
    return out;
  }
  // A Polygon or MultiPolygon with each exterior counterclockwise and each hole clockwise.
  function writeGeometry(g) {
    const polygon = rings => rings.map((ring, i) => writeRing(ring, i === 0));
    return g.type === 'Polygon' ? { type: 'Polygon', coordinates: polygon(g.coordinates) }
      : { type: 'MultiPolygon', coordinates: g.coordinates.map(polygon) };
  }

  // One feature per zone drawn: a whole circle per ring per positive (360 steps, as CVI draws them), and each zone
  // file zone as read. No merging. parts: { rings: [{ sites (ringSites), group ('Current' or 'Past') }], zones
  // (zoneSites, or none) }; opts: { rings (the ring list, distances in unit), unit, asOf, positives (those that count
  // for days since) }. Properties: name ("Infection zone (3 km) around SYN-HPAI-001", or the zone file zone's name: the
  // property shared/zones.js reads a zone's name from), zone, positive, group, distance, unit, days_since_last_positive,
  // as_of; never an address, location, street or premise.
  function zonesGeoJson(parts, opts) {
    const o = opts || {}, features = [];
    const feature = (geometry, props) => features.push({ type: 'Feature', properties: props, geometry });
    for (const part of parts.rings || []) {
      const days = daysSince(part.sites, o.positives || [], o.asOf);
      part.sites.forEach((s, k) => o.rings.forEach((ring, i) => {
        const km = toKm(ring.distance, o.unit);
        const at = days[k].rings.find(x => x.km === km);
        feature(writeGeometry({ type: 'Polygon', coordinates: [P().circle(s.lat, s.lon, km, 360)] }), {
          name: ring.label + ' (' + String(Number(ring.distance.toFixed(2))) + ' ' + UNITS[o.unit || 'km'].label + ') around ' + text(s.name),
          zone: ring.label, positive: text(s.name), group: part.group, distance: ring.distance, unit: o.unit || 'km',
          days_since_last_positive: at ? at.days : null, as_of: o.asOf || null });
      }));
    }
    const zones = parts.zones || [];
    const zoneDays = daysSince(zones, o.positives || [], o.asOf);
    zones.forEach((s, k) => feature(writeGeometry(s.zone), { name: text(s.name), zone: text(s.name), positive: null, group: null,
      distance: null, unit: null, days_since_last_positive: zoneDays[k].days, as_of: o.asOf || null }));
    return { type: 'FeatureCollection', features };
  }

  function ringSites(list, rings, unit) {
    const distances = rings.map(r => toKm(r.distance, unit));
    const prepared = P().prepareSites(list.map(p => ({ name: p.name, lat: p.lat, long: p.lon })),
      { defaultKm: Math.max(...distances), bands: distances });
    prepared.sites.forEach((s, k) => { s.positive = list[k].index; });
    return prepared.sites;
  }

  function zoneSites(zones) {
    return P().prepareSites(zones.map(z => ({ name: z.name, lat: z.point[1], long: z.point[0], zone: z.geometry })),
      { defaultKm: 0 }).sites;
  }

  function ringLabel(rings, km, unit) {
    const ring = rings.find(r => km <= toKm(r.distance, unit)) || rings[rings.length - 1];
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
            zone: zonesMode ? text(s.name) : ringLabel(o.rings, km, o.unit), county: p.county || null, town: p.town || null });
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
    const u = unit || 'km';
    if (s.inside) {
      // A ring's label takes "the" ("in the Control zone"); a zone file's names are written as they are.
      const parts = s.byZone.filter(z => z.count).map(z => z.count + ' in ' + (s.mode === 'rings' ? 'the ' : '') + z.label);
      return s.label + ': ' + listOf(parts);
    }
    if (!s.nearest) return s.label + ': none inside' + (s.usable ? '' : ' (no usable locations)');
    return s.label + ': none inside. Nearest: ' + s.nearest.name + ', ' + round2(fromKm(s.nearest.exactKm, u)) + ' ' +
      UNITS[u].label + ' from ' + s.nearest.from;
  }

  // win: the date window ({ start, end }); without one (no readable detection date), the current positives are those
  // not past by their closed column, and only the not-mapped and unreadable-dates lines are added.
  function valueBoxes(read, result, win) {
    const g = read && win ? groups(read, win) : null;
    const all = !read ? [] : g ? g.current : read.positives.filter(p => !isPast(p, null));
    const withZones = read && read.targets ? read.targets.length : null;
    const counted = !read ? [] : g ? g.current.concat(g.past) : read.positives;
    const dates = counted.map(p => p.detected).filter(Boolean).sort();
    const last = !read ? { value: null, reason: 'Not available: needs the positives file' }
      : !read.columns.detected ? { value: null, reason: 'Not available: needs ' + read.type.columns.detected[0] }
        : !dates.length ? { value: null, reason: 'Not available: no readable ' + read.columns.detected }
          : { value: dates[dates.length - 1], reason: null };
    if (g && last.value && win.end) last.note = 'As of ' + dayLabel(win.end);
    const insideBox = !result || !result.layers.length
      ? { value: null, reason: 'Not available: needs a facility layer' } : { value: result.total, reason: null };
    const lines = [];
    if (read) {
      const notMapped = notMappedLine(read.dropped);
      if (notMapped) lines.push(notMapped);
      const bad = (read.badDates || 0) + (read.badCloseDates || 0) + (read.badReleaseDates || 0);
      if (bad) lines.push(bad.toLocaleString('en-US') + (bad === 1 ? ' date' : ' dates') + ' not readable');
    }
    if (g) {
      if (g.undated.length) lines.push(g.undated.length.toLocaleString('en-US') + ' without a date');
      const numbers = numbersLine(read, g.current);
      if (numbers) lines.push('Animals at the current positives: ' + numbers);
    }
    const quarantined = g ? g.stillQuarantined.length : 0;
    const past = !read ? { value: null, reason: 'Not available: needs the positives file' }
      : !g ? { value: null, reason: last.value === null ? last.reason : 'Not available: needs dates' }
        : { value: g.past.length, reason: null, quarantined,
          note: !g.past.length ? null : quarantined ? quarantined.toLocaleString('en-US') + ' still under quarantine' : 'none under quarantine' };
    return {
      positives: read ? { value: all.length, note: withZones === null || withZones === all.length ? null : withZones + ' with zones', lines }
        : { value: null, note: 'Not available: needs the positives file', lines },
      past,
      last,
      inside: insideBox
    };
  }

  // win: the date window; the positives inside it are listed (with the rows not mapped), each with its group on the
  // window's end date.
  function exportRows(read, targetList, result, unit, win) {
    const u = unit || 'km';
    const km = x => x === null || x === undefined ? null : round2(fromKm(x, u));
    const withZones = new Set((targetList || []).map(p => p.index));
    const end = win ? win.end : null;
    const listed = read.positives.filter(p => inWindow(p, win)).concat(read.dropped);
    const extra = listed.length ? details(read, listed[0]).map(pair => pair[0]) : [];
    const note = p => p.index === null ? 'Not mapped: ' + p.reason
      : stillQuarantined(read, p, end) ? 'Still under quarantine' : '';
    const positives = { columns: ['Positive', 'Group', 'Status', 'Closed', 'Close Date', 'Quarantine Release',
      'Detection Date', 'County', 'Latitude', 'Longitude', 'Zones'].concat(extra, ['Note']),
    rows: listed.map(p => [p.name, groupOf(p, end), p.status ? p.status.label : (p.statusText || ''),
      p.closed ? 'Yes' : 'No', p.closedDate || '', p.quarantine || '', p.detected || '', p.county || '',
      p.lat === null ? '' : p.lat, p.lon === null ? '' : p.lon, withZones.has(p.index) ? 'Yes' : 'No']
      .concat(details(read, p).map(pair => pair[1]), [note(p)])) };
    const inside = { columns: ['Positive or zone', 'Layer', 'Site', 'Distance (' + UNITS[u].label + ')', 'Zone', 'County', 'Town'],
      rows: result.rows.map(r => [r.siteName, r.layerLabel, r.name, km(r.exactKm), r.zone, r.county || '', r.town || '']) };
    const zoneNames = result.layers.length ? result.layers[0].byZone.map(z => z.label) : [];
    const layers = { columns: ['Layer', 'Inside'].concat(zoneNames, ['Nearest', 'Nearest distance (' + UNITS[u].label + ')',
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
    PRECISION, toKm, fromKm, KM_PER_MILE, inventoryOf, sizeClass, windowOf, inWindow, isPast, stillQuarantined, groups,
    groupOf, weekOf, dayLabel, playSteps, MAX_WEEKS, overTime, bigNumber, inventoryWordOf, numbersLine, notMappedLine, details, daysSince, byQuiet,
    zoneRows,
    zonesGeoJson };
})(typeof window !== 'undefined' ? window : globalThis);
