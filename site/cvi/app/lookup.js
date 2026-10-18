/* Premise Lookup: which CVI movements touched a list of sites. Port of CVI's
 * run_proximity_query (shiny/R/map_helpers.R), on the shared engine (shared/proximity.js). This file holds the CVI
 * rules: the filters, the endpoint rule, the rows CVI cannot check, the counts and the intrastate collapse; also the
 * tab's other rules (the paste and upload readers, the band check, the run's checks and messages, the
 * value tiles, the matched-CVI table, what the match map draws) and, at the end, the page side that uses them (the
 * Premise Lookup sidebar and results, started by ui.js; the match map is lookupmap.js).
 *
 * query(master, sites, opts) -> CVI's result, field for field (R names in brackets):
 *   master: the loaded master (master.js load(): { header, rows }).
 *   sites: [{ name, lat, long, buffer_km, bands_csv }] as the sites table holds them. In Single mode the caller
 *     leaves bands_csv out (CVI's run_query drops it); in Bands mode it passes opts.bands.
 *   opts: { defaultKm (default_buffer_km), endpoint ('either', 'origin' or 'dest'), filters: { year, quarter,
 *     species }, bands (the global radii, Bands mode only), collapse ('loader' or 'cvi', below) }.
 * Returns { status ('ok', 'no_match', 'empty_sites', 'no_filter_match', 'missing_coord_cols'), hasCvi, skippedSites,
 *   skippedCoords, missingCols, sites (sites_df_used, from proximity.prepareSites), bandsMode, matched (matched_df:
 *   copies of the rows with hitOrigin, hitDest, matchedSites, nearestSiteKm, nearestBandKm), membership ([{ row
 *   (0-based, in the matched rows before the collapse), cvi, site (id), hitOrigin, hitDest, bandKm }]),
 *   siteCvis, siteOrigins, siteDests (per site, in site order), summary { cvis, animals, origins, dests, sitesHit } }.
 *
 * The intrastate collapse before the animal total and the returned rows: CVI's dedupe_intrastate_volume drops every
 * WA-to-WA row identical to an earlier one apart from Movement (collapse 'cvi'). The page's rule elsewhere is
 * "Merge only loader copies" (summary.js dedupeVolume): only the Inbound and Outbound copies the loader
 * makes of one within-state row merge, so two identical rows in the file both count (collapse 'loader', the default
 * and the page's rule, by design). The two differ only when
 * the file repeats a within-state row exactly.
 *
 * Without a CVI column, CVI numbers the movement records (every column but Movement) and counts those; here each
 * record gets "row_" and a number too, but the numbering may differ from CVI's (R sorts the records in its locale's
 * order), so only which rows share a number is CVI's.
 */
(function (root) {
  'use strict';
  const P = () => root.WSDA.proximity;
  const isWa = s => s !== null && s !== undefined && String(s).trim().toUpperCase() === 'WA';
  const COORDS = ['Origin.Lat', 'Origin.Long', 'Dest.Lat', 'Dest.Long'];
  const ADDED = ['hitOrigin', 'hitDest', 'matchedSites', 'nearestSiteKm', 'nearestBandKm'];

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

  // A row's values as one text key, every column but those left out (R's paste of the columns, used for CVI's
  // record numbers and its intrastate collapse). Numbers are written as numbers, so "47.50" and "47.5" agree, as
  // they do once R has read the column as numeric.
  function keyOf(row, columns) {
    return columns.map(c => {
      const v = row[c];
      if (v === null || v === undefined) return 'NA';
      const n = typeof v === 'number' ? v : P().number(v);
      return n !== null && typeof v !== 'boolean' ? String(n) : String(v);
    }).join('\r');
  }

  // CVI's run_proximity_query: the inputs and the result are described at the top of the file.
  function query(master, siteList, opts) {
    const o = opts || {};
    const PX = P();
    const endpoint = o.endpoint || 'either';
    const header = master.header;
    const hasCvi = header.indexOf('CVI') >= 0;
    let rows = master.rows;
    if (!hasCvi) {
      // CVI's synthetic id: one number per movement record (every column but Movement), so the loader's two copies
      // of a within-state row share it.
      const cols = header.filter(h => h !== 'Movement');
      const keys = rows.map(r => keyOf(r, cols));
      const order = [...new Set(keys)].sort();
      const idOf = new Map(order.map((k, i) => [k, 'row_' + (i + 1)]));
      rows = rows.map((r, i) => Object.assign(copy(r), { CVI: idOf.get(keys[i]) }));
    }
    const base = { hasCvi, skippedSites: 0, endpoint };
    const prepared = PX.prepareSites(siteList, { defaultKm: o.defaultKm, bands: o.bands });
    base.skippedSites = prepared.skipped;
    if (!prepared.sites.length) return Object.assign({ status: 'empty_sites' }, base);
    const sites = prepared.sites;
    Object.assign(base, { sites, bandsMode: prepared.bandsMode });

    const f = o.filters || {};
    const yr = new Set(f.year || []), qt = new Set(f.quarter || []), sp = new Set(f.species || []);
    let sub = rows;
    if (yr.size) sub = sub.filter(r => yr.has(r['Reporting.Year']));
    if (qt.size) sub = sub.filter(r => qt.has(r['Reporting.Quarter']));
    if (sp.size) sub = sub.filter(r => sp.has(r['Species.Group']));
    if (!sub.length) return Object.assign({ status: 'no_filter_match' }, base);
    const missingCols = COORDS.filter(c => header.indexOf(c) < 0);
    if (missingCols.length) return Object.assign({ status: 'missing_coord_cols', missingCols }, base);

    // Each endpoint's point; one CVI cannot check is never matched and is counted.
    const point = (r, side) => {
      const lat = PX.number(r[side + '.Lat']), lon = PX.number(r[side + '.Long']);
      return PX.usable(lat, lon) ? { lat, lon } : null;
    };
    const origins = sub.map(r => point(r, 'Origin'));
    const dests = sub.map(r => point(r, 'Dest'));
    const unchecked = new Set();
    sub.forEach((r, i) => {
      const bad = endpoint === 'origin' ? !origins[i] : endpoint === 'dest' ? !dests[i] : !origins[i] && !dests[i];
      if (bad) unchecked.add(r.CVI === undefined ? null : r.CVI);
    });
    base.skippedCoords = unchecked.size;

    // Distances to every site, then the hits the endpoint rule lets count.
    const km = list => list.map(p => sites.map(s => (p ? PX.siteKm(p.lat, p.lon, s) : null)));
    const dOrigin = km(origins), dDest = km(dests);
    const within = (d, k) => d !== null && d <= sites[k].bufferKm;
    const matched = [], picked = [];
    sub.forEach((r, i) => {
      const ho = sites.map((s, k) => endpoint !== 'dest' && within(dOrigin[i][k], k));
      const hd = sites.map((s, k) => endpoint !== 'origin' && within(dDest[i][k], k));
      if (ho.some(Boolean) || hd.some(Boolean)) picked.push({ i, ho, hd });
    });
    if (!picked.length) {
      return Object.assign({ status: 'no_match', matched, membership: [], siteCvis: sites.map(() => 0),
        siteOrigins: sites.map(() => 0), siteDests: sites.map(() => 0),
        summary: { cvis: 0, animals: 0, origins: 0, dests: 0, sitesHit: 0 } }, base);
    }

    // The distance each match is judged by: the endpoint asked for, or the nearer of the two (R's pmin, na.rm).
    const selected = (i, k) => {
      const a = dOrigin[i][k], b = dDest[i][k];
      if (endpoint === 'origin') return a;
      if (endpoint === 'dest') return b;
      return a === null ? b : b === null ? a : Math.min(a, b);
    };
    picked.forEach(({ i, ho, hd }) => {
      const hit = sites.map((s, k) => ho[k] || hd[k]);
      const near = sites.map((s, k) => (hit[k] ? selected(i, k) : null)).filter(d => d !== null);
      matched.push(Object.assign(copy(sub[i]), {
        hitOrigin: ho.some(Boolean), hitDest: hd.some(Boolean),
        matchedSites: sites.filter((s, k) => hit[k]).map(s => s.name).join('; '),
        nearestSiteKm: near.length ? round2(Math.min(...near)) : null, nearestBandKm: null }));
    });

    // One membership row per (matched row, site) hit, site by site (R's which(arr.ind = TRUE) order), with its ring.
    const membership = [];
    sites.forEach((s, k) => {
      picked.forEach(({ i, ho, hd }, m) => {
        if (!ho[k] && !hd[k]) return;
        membership.push({ row: m, cvi: matched[m].CVI === undefined ? null : matched[m].CVI, site: s.id,
          hitOrigin: ho[k], hitDest: hd[k], bandKm: PX.ringOf(s.radii, selected(i, k)) });
      });
    });
    membership.forEach(x => {
      const r = matched[x.row];
      if (r.nearestBandKm === null || x.bandKm < r.nearestBandKm) r.nearestBandKm = x.bandKm;
    });

    // Distinct CVIs, origin points and destination points per site, and in all (usable points only).
    const pointKey = (r, side) => {
      const lat = PX.number(r[side + '.Lat']), lon = PX.number(r[side + '.Long']);
      return PX.usable(lat, lon) ? lat + ',' + lon : null;
    };
    const distinct = list => new Set(list.filter(v => v !== null)).size;
    const siteCvis = [], siteOrigins = [], siteDests = [];
    sites.forEach(s => {
      const mk = membership.filter(x => x.site === s.id);
      siteCvis.push(new Set(mk.map(x => x.cvi)).size);
      siteOrigins.push(distinct(mk.filter(x => x.hitOrigin).map(x => pointKey(matched[x.row], 'Origin'))));
      siteDests.push(distinct(mk.filter(x => x.hitDest).map(x => pointKey(matched[x.row], 'Dest'))));
    });
    const origins_ = distinct(matched.filter(r => r.hitOrigin).map(r => pointKey(r, 'Origin')));
    const dests_ = distinct(matched.filter(r => r.hitDest).map(r => pointKey(r, 'Dest')));

    const kept = collapse(matched, header.concat(hasCvi ? [] : ['CVI']), o.collapse || 'loader');
    const summary = {
      cvis: new Set(matched.map(r => (r.CVI === undefined ? null : r.CVI))).size,
      animals: kept.reduce((t, r) => (r['Total.Animals'] === null ? t : t + r['Total.Animals']), 0),
      origins: origins_, dests: dests_, sitesHit: new Set(membership.map(x => x.site)).size
    };
    return Object.assign({ status: 'ok', matched: kept, membership, siteCvis, siteOrigins, siteDests, summary },
      base);
  }

  // A copy of a row that keeps the loader's hidden file row number (master.js SOURCE_ROW).
  function copy(r) {
    const SRC = root.CVIWA.master.SOURCE_ROW;
    const c = Object.assign({}, r);
    if (r[SRC] !== undefined) Object.defineProperty(c, SRC, { value: r[SRC] });
    return c;
  }

  // The intrastate collapse (see the header): 'cvi' keys on every column but Movement, the added ones included;
  // 'loader' merges only rows from the same file row ("Merge only loader copies").
  function collapse(list, columns, rule) {
    if (rule === 'loader') return root.CVIWA.summary.dedupeVolume(list);
    const cols = columns.filter(c => c !== 'Movement').concat(ADDED);
    const seen = new Set();
    return list.filter(r => {
      const key = keyOf(r, cols);
      const first = !seen.has(key);
      seen.add(key);
      return !(isWa(r['Origin.State']) && isWa(r['Dest.State'])) || first;
    });
  }


  // ── The tab's other rules (CVI's mod_premise_lookup.R), pure ────────────────────────────────────────────────────
  // R's trimws (spaces, tabs and line ends at both ends) and strsplit (a match at the very end adds no empty piece).
  const trimR = s => String(s).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  function splitR(text, re) {
    const parts = String(text).split(re);
    if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
    return parts;
  }
  // A number as R's paste() writes it (format with 15 significant digits: 3, 2.5, 1e+05).
  const numText = x => root.CVIWA.scaling.formatR([x])[0].trim();

  // "Paste rows": one site per line, "name, lat, long" (commas or tabs), then one number for a buffer or two or more
  // for bands. A line with fewer than three parts, or whose latitude or longitude is not a number, counts as skipped
  // (a deliberate difference: CVI leaves the short lines out without counting them; shortLines says
  // how many). Returns { empty, sites, skipped, shortLines }.
  function parsePaste(raw) {
    const text = raw === null || raw === undefined ? '' : String(raw);
    if (trimR(text) === '') return { empty: true, sites: [], skipped: 0, shortLines: 0 };
    const parsed = [];
    let shortLines = 0;
    text.split('\n').map(trimR).filter(l => l !== '').forEach(line => {
      const parts = splitR(line, /[,\t]/).map(trimR);
      if (parts.length < 3) {
        shortLines++;
        return;
      }
      const extra = parts.slice(3).filter(x => x !== '');
      parsed.push({
        name: parts[0],
        lat: P().number(parts[1]),
        long: P().number(parts[2]),
        buffer_km: extra.length === 1 ? P().number(extra[0]) : null,
        bands_csv: extra.length >= 2 ? extra.join(',') : null
      });
    });
    const sites = parsed.filter(x => x.lat !== null && x.long !== null);
    return { empty: false, sites, skipped: parsed.length - sites.length + shortLines, shortLines };
  }
  // The message after a paste: the sites added and the lines skipped, or why nothing was added.
  function pasteMessage(r) {
    if (r.empty) return { level: 'warn', text: 'Paste box is empty.' };
    if (!r.sites.length) {
      return { level: 'err',
        text: 'No valid rows parsed. Expected: name, lat, long [, buffer_km OR band radii like 1, 3, 5]' };
    }
    let text = 'Added ' + r.sites.length + ' site(s).';
    if (r.skipped > 0) text += ' Skipped ' + r.skipped + ' unparseable line(s).';
    return { level: 'ok', text };
  }

  // R's make.names(unique = TRUE), which read.csv applies to the header: an "X" goes in front of a name that does not
  // start with a letter (or "." and no digit), then characters other than letters, digits, "." and "_" become ".",
  // a reserved word gets a "." after it, and a repeated name gets ".1", ".2" and so on.
  const RESERVED = ['if', 'else', 'repeat', 'while', 'function', 'for', 'next', 'break', 'TRUE', 'FALSE', 'NULL',
    'Inf', 'NaN', 'NA', 'NA_integer_', 'NA_real_', 'NA_character_', 'in'];
  function makeNames(names) {
    const made = names.map(n => {
      let s = String(n === null || n === undefined ? '' : n);
      if (!/^([A-Za-z]|\.(?![0-9]))/.test(s)) s = 'X' + s;
      s = s.replace(/[^A-Za-z0-9._]/g, '.');
      if (RESERVED.indexOf(s) >= 0) s += '.';
      return s;
    });
    const seen = new Map();
    return made.map(s => {
      if (!seen.has(s)) { seen.set(s, 0); return s; }
      let k = seen.get(s), t;
      do { k++; t = s + '.' + k; } while (seen.has(t));
      seen.set(s, k);
      seen.set(t, 0);
      return t;
    });
  }

  // "Upload CSV": CVI's read.csv, the columns found by name ignoring case (name, lat, the first of long, lng and lon,
  // the first of buffer_km and buffer), and only the rows with a latitude and a longitude. Returns { sites } or
  // { message } (CVI's notification).
  function parseUpload(text) {
    let parsed = null;
    try { parsed = root.CVIWA.csv.parse(String(text)); } catch (e) { parsed = null; }
    if (!parsed || !parsed.header.length || !parsed.rows.length) {
      return { message: { level: 'err', text: 'Uploaded CSV is empty or unreadable.' } };
    }
    const names = makeNames(parsed.header).map(n => n.toLowerCase());
    const first = list => {
      for (const c of list) {
        const i = names.indexOf(c);
        if (i >= 0) return i;
      }
      return -1;
    };
    const iName = first(['name']), iLat = first(['lat']), iLong = first(['long', 'lng', 'lon']);
    const iBuffer = first(['buffer_km', 'buffer']);
    if (iName < 0 || iLat < 0 || iLong < 0) {
      return { message: { level: 'err', text: 'CSV must include name, lat, long columns.' } };
    }
    const cell = (r, i) => (r[i] === undefined ? null : r[i]);
    const sites = parsed.rows.map(r => ({
      name: cell(r, iName),
      lat: P().number(cell(r, iLat)),
      long: P().number(cell(r, iLong)),
      buffer_km: iBuffer < 0 ? null : P().number(cell(r, iBuffer)),
      bands_csv: null
    })).filter(x => x.lat !== null && x.long !== null);
    if (!sites.length) return { message: { level: 'warn', text: 'No rows in CSV had valid lat/long.' } };
    return { sites, message: { level: 'ok', text: 'Loaded ' + sites.length + ' site(s) from CSV.' } };
  }

  // "Download CSV template": CVI's template as R's write.csv writes it.
  const TEMPLATE_NAME = 'premise_lookup_template.csv';
  const TEMPLATE_CSV = '"name","lat","long","buffer_km"\n"Affected Farm A",46.5,-120.5,3\n' +
    '"Affected Farm B",47,-120,NA\n';

  // ── Address lookup, offline ──
  // CVI's "Find coordinates" (shiny/R/geocode_site.R) looks a typed address up in its geocode cache file, then asks
  // the US Census geocoder and OpenStreetMap's Nominatim over the network. The page does only the first step, in a
  // cache file the user loads (CVI's columns: address, lat, long); nothing is sent anywhere.
  // normalizeAddress: CVI's .normalize_addr: trimmed, surrounding quotes dropped, runs of white space made one space,
  // lower case. A missing cell (R's NA) stays null and never matches.
  function normalizeAddress(x) {
    if (x === null || x === undefined) return null;
    let s = trimR(String(x)).replace(/^["']+|["']+$/g, '');
    s = s.replace(/[ \t\n\v\f\r]+/g, ' ');
    return trimR(s).toLowerCase();
  }
  // A cache file (CVI's read.csv of registry/geocode_cache.csv): { rows: [{ address, key, lat, long }] } in file order,
  // lat and long as numbers or null, or { message } when the file cannot serve (CVI then finds nothing, silently;
  // the page says why when the file is loaded). The three columns are found by CVI's exact names.
  // Blank lines are not rows (R's read.csv skips them); a file holding NUL
  // characters (UTF-16, as some programs save "Unicode text") is refused with that reason; { notes } adds warnings for
  // text that is not UTF-8 (letters shown as "�", so addresses with them may not match) and for a quote mark left open
  // (the rows after it read as one cell).
  function parseGeocodeCache(text, fileName) {
    const raw = String(text);
    if (raw.indexOf('\u0000') >= 0) {
      return { message: { level: 'err', text: fileName + ' is not UTF-8 text (it looks like UTF-16). Save it as "CSV ' +
        'UTF-8" and load it again.' } };
    }
    let parsed = null;
    try { parsed = root.CVIWA.csv.parse(raw); } catch (e) { parsed = null; }
    if (!parsed || !parsed.header.length) {
      return { message: { level: 'err', text: fileName + ' is empty or unreadable.' } };
    }
    const names = makeNames(parsed.header);
    const iAddress = names.indexOf('address'), iLat = names.indexOf('lat'), iLong = names.indexOf('long');
    if (iAddress < 0 || iLat < 0 || iLong < 0) {
      return { message: { level: 'err', text: fileName + ' is not a geocode cache: it needs the columns address, ' +
        'lat and long.' } };
    }
    const cell = (r, i) => (r[i] === undefined ? null : r[i]);
    const blank = r => r.length === 1 && (r[0] === null || r[0] === '');
    const rows = parsed.rows.filter(r => !blank(r)).map(r => ({ address: cell(r, iAddress),
      key: normalizeAddress(cell(r, iAddress)), lat: P().number(cell(r, iLat)), long: P().number(cell(r, iLong)) }));
    if (!rows.length) return { message: { level: 'err', text: fileName + ' has no addresses.' } };
    const notes = [];
    if (raw.indexOf('\uFFFD') >= 0) {
      notes.push({ level: 'warn', text: fileName + ' is not all UTF-8 text: some letters read as "\uFFFD", so addresses ' +
        'with them may not match. Save it as "CSV UTF-8" and load it again.' });
    }
    if ((raw.match(/"/g) || []).length % 2 === 1) {
      notes.push({ level: 'warn', text: fileName + ' has a quote mark that is never closed; the rows after it may have ' +
        'been read as one address.' });
    }
    return { rows, notes };
  }
  // CVI's .coord_ok: both numbers, latitude within -90 to 90 and longitude within -180 to 180.
  const coordOk = (lat, lon) => lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  // CVI's .geocode_from_cache: the first row with the same normalized address and usable coordinates (rows whose
  // coordinates are missing or out of range are passed over), or null. An address that normalizes to nothing never
  // matches.
  function findAddress(cache, address) {
    const key = normalizeAddress(address);
    if (!cache || !key) return null;
    const hit = cache.rows.find(r => r.key === key && coordOk(r.lat, r.long));
    return hit ? { lat: hit.lat, long: hit.long, matchedAddress: hit.address } : null;
  }
  // The largest geocode cache file read (CVI's registry cache is far smaller).
  const GEOCACHE_MAX_BYTES = 32 * 1024 * 1024;
  // R's round(x, 6) for the Latitude and Longitude boxes (CVI's updateNumericInput(..., round(res$lat, 6))).
  const round6 = x => Number(x.toFixed(6));
  // "Find coordinates" (CVI's geocode_find): { lat, long, message } or { message }. cache: parseGeocodeCache's rows, or
  // null while no cache file is loaded. CVI's messages for an empty box and a hit; offline wording in place of CVI's
  // "Could not resolve that address (service unreachable or no match)." (no service is asked).
  function geocodeRule(address, cache) {
    const typed = trimR(address === null || address === undefined ? '' : String(address));
    if (typed === '') return { message: { level: 'warn', text: 'Enter a street address first.' } };
    if (!cache) {
      return { message: { level: 'warn', text: 'Load a geocode cache file to look up addresses, or enter lat/long ' +
        'manually.' } };
    }
    const hit = findAddress(cache, typed);
    if (!hit) {
      return { message: { level: 'warn', text: 'No match for that address in the geocode cache file. Enter lat/long ' +
        'manually.' } };
    }
    const shown = hit.matchedAddress === null ? typed : hit.matchedAddress;
    return { lat: round6(hit.lat), long: round6(hit.long), message: { level: 'ok',
      text: 'Resolved to: ' + shown + '  (source: saved cache). Review, then Add site.' } };
  }

  // "Add a site" (CVI's site_add): both coordinates needed and in range; an unnamed site becomes "Site <n>" (n: the
  // table's rows plus one). input: { name (text), lat, long, buffer (numbers or null) }. Returns { site, message } or
  // { message }.
  function addSiteRule(count, input) {
    const lat = input.lat, lon = input.long;
    if (lat === null || lat === undefined || lon === null || lon === undefined) {
      return { message: { level: 'warn', text: 'Enter a latitude and longitude to add a site.' } };
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { message: { level: 'warn', text: 'Latitude must be -90 to 90 and longitude -180 to 180.' } };
    }
    const typed = trimR(input.name === null || input.name === undefined ? '' : input.name);
    const name = typed !== '' ? typed : 'Site ' + (count + 1);
    const buffer = input.buffer === undefined ? null : input.buffer;
    return { site: { name, lat, long: lon, buffer_km: buffer, bands_csv: null },
      message: { level: 'ok', text: 'Added "' + name + '".' } };
  }

  // A cell edit in the sites table (CVI's sites_table_cell_edit): column 1 the name, 2 the latitude, 3 the longitude,
  // 4 the buffer (Single) or the bands (Bands). The name and the bands are kept as text, the others read as numbers
  // (NA when not one). Returns the field changed.
  const editField = (mode, col) => [null, 'name', 'lat', 'long', mode === 'bands' ? 'bands_csv' : 'buffer_km'][col];
  function editCell(site, field, text) {
    if (field === 'name' || field === 'bands_csv') site[field] = String(text);
    else site[field] = P().number(text);
    return field;
  }

  // The global band radii (CVI's .validate_band_radii): { radii } with a note when they were sorted, or { message }.
  function validateBands(raw) {
    const tokens = splitR(raw === null || raw === undefined ? '' : String(raw), /[,;\s]+/).map(trimR)
      .filter(t => t !== '');
    if (!tokens.length) return { message: { level: 'warn', text: 'Enter at least one band radius (km).' } };
    const v = tokens.map(t => P().number(t));
    if (v.some(x => x === null || x <= 0)) {
      return { message: { level: 'warn', text: 'Band radii must be positive numbers (e.g. 3, 10, 20).' } };
    }
    if (new Set(v).size < v.length) return { message: { level: 'warn', text: 'Band radii must be distinct.' } };
    if (v.length > 3) return { message: { level: 'warn', text: 'Use at most 3 band radii.' } };
    const sorted = v.slice().sort((a, b) => a - b);
    const moved = sorted.some((x, i) => x !== v[i]);
    return { radii: sorted, note: moved
      ? { level: 'info', text: 'Bands sorted ascending: ' + sorted.map(numText).join(' / ') + ' km.' } : null };
  }

  // Run query, before the engine (CVI's run_query observer). input: { master, loading, sites (the table's rows),
  // mode ('single' or 'bands'), defaultKm (the box's value: a number or null), bandsText, endpoint, years, quarters,
  // species, facilitiesOnly }. Returns { messages, args } (args: what query() takes) or { messages, stop: true }.
  // A zone site keeps its zone in either mode; facilitiesOnly (no usable master, facility layers ticked)
  // skips the master's two checks, the rest is the same.
  const MANY_SITES = 200;
  function prepareRun(input) {
    const messages = [];
    const stop = m => ({ messages: messages.concat([m]), stop: true });
    if (input.loading && !input.facilitiesOnly) {
      return stop({ level: 'warn', text: 'The master dataset is still loading — try again in a moment.' });
    }
    if (!input.master && !input.facilitiesOnly) return stop({ level: 'err', text: 'Load a master dataset first.' });
    let sites = input.sites.filter(s => s.lat !== null && s.long !== null);
    if (!sites.length) return stop({ level: 'warn', text: 'Add at least one site with valid lat/long.' });
    if (sites.length > MANY_SITES) {
      messages.push({ level: 'warn',
        text: 'Querying ' + sites.length + ' sites against the full master may take a while.' });
    }
    let bands = null;
    if (input.mode === 'bands') {
      const b = validateBands(input.bandsText);
      if (!b.radii) return stop(b.message);
      if (b.note) messages.push(b.note);
      bands = b.radii;
    } else {
      // Single: a site's own band list would turn the engine to band mode, so it is left out (CVI).
      sites = sites.map(s => (s.zone ? { name: s.name, lat: s.lat, long: s.long, buffer_km: s.buffer_km, zone: s.zone }
        : { name: s.name, lat: s.lat, long: s.long, buffer_km: s.buffer_km }));
      // A deliberate difference: CVI runs with an empty default and matches nothing for sites without a buffer.
      if (input.defaultKm === null || input.defaultKm === undefined || !Number.isFinite(input.defaultKm)) {
        return stop({ level: 'warn', text: 'Enter a default buffer (km).' });
      }
    }
    const opts = {
      defaultKm: input.defaultKm === null || input.defaultKm === undefined ? 3 : input.defaultKm,
      endpoint: input.endpoint || 'either',
      filters: { year: input.years || [], quarter: input.quarters || [], species: input.species || [] },
      bands,
      collapse: 'loader'
    };
    return { messages, args: { sites, opts } };
  }

  // After the engine (CVI's messages, in its order): { messages, keep } where keep is 'store' (show this result),
  // 'clear' (no result) or 'previous' (leave what is shown).
  function afterRun(res) {
    const messages = [];
    if (res.skippedSites > 0) {
      messages.push({ level: 'warn', text: 'Skipped ' + res.skippedSites +
        ' site(s) with out-of-range coordinates (lat -90..90, long -180..180).' });
    }
    if (res.hasCvi === false) {
      messages.push({ level: 'warn', text: 'Master has no CVI column — counts use row identifiers instead.' });
    }
    if (res.status === 'empty_sites') {
      messages.push({ level: 'warn', text: 'No sites with valid coordinates to query.' });
      return { messages, keep: 'previous' };
    }
    if (res.status === 'missing_coord_cols') {
      messages.push({ level: 'err', text: 'Master is missing required coord columns: ' + res.missingCols.join(', ') });
      return { messages, keep: 'previous' };
    }
    if (res.status === 'no_filter_match') {
      messages.push({ level: 'warn', text: 'No CVIs match the current filters.' });
      return { messages, keep: 'clear' };
    }
    if (res.skippedCoords > 0) {
      messages.push({ level: 'warn', text: res.skippedCoords +
        ' CVI(s) could not be checked — invalid coordinates (possible swapped lat/long).' });
    }
    if (res.status === 'no_match') messages.push({ level: 'info', text: 'Query ran — no CVIs matched.' });
    else {
      messages.push({ level: 'ok', text: 'Query matched ' + res.summary.cvis + ' CVI(s) across ' +
        res.summary.sitesHit + ' site(s).' });
    }
    return { messages, keep: 'store' };
  }

  // The five value tiles (CVI's .metric cards): label, value as format(n, big.mark = ","), icon and color.
  function tiles(summary) {
    const f = x => root.CVIWA.scaling.formatR([x])[0].trim();
    return [
      { label: 'CVIs matched', text: f(summary.cvis), icon: 'file-earmark-medical', accent: '#1c5a83' },
      { label: 'Total animals', text: f(summary.animals), icon: 'stack', accent: '#2980b9' },
      { label: 'Distinct origins', text: f(summary.origins), icon: 'geo', accent: '#5d6873' },
      { label: 'Distinct destinations', text: f(summary.dests), icon: 'geo-alt-fill', accent: '#5d6873' },
      { label: 'Sites with matches', text: f(summary.sitesHit), icon: 'crosshair', accent: '#27ae60' }
    ];
  }

  // The matched-CVI table (CVI's result_table): these columns, those the rows have, in this order.
  const TABLE_COLUMNS = ['CVI', 'Reporting.Year', 'Reporting.Quarter', 'Movement', 'Species.Group', 'Species',
    'Total.Animals', 'Origin.City', 'Origin.State', 'Origin.County', 'Dest.City', 'Dest.State', 'Dest.County',
    'matched_sites', 'nearest_site_km'];
  const ROW_FIELD = { matched_sites: 'matchedSites', nearest_site_km: 'nearestSiteKm' };
  function table(res) {
    const rows = (res && res.matched) || [];
    if (!rows.length) return { columns: [], rows: [] };
    const columns = TABLE_COLUMNS.filter(c => c in ROW_FIELD || c in rows[0]);
    return { columns, rows: rows.map(r => columns.map(c => {
      const v = r[ROW_FIELD[c] || c];
      return v === undefined ? null : v;
    })) };
  }

  // What the match map draws (CVI's result_map): the buffer bands colored by their radius among all radii drawn
  // (inner WSDA Gold #fcb614, then a light green #8fc965, then WSDA Light Blue #a7d7e2; CVI draws grays, which are
  // too alike to tell apart), the matched rows' endpoints that fell inside a buffer (origins
  // orange, destinations blue; one point per row, as CVI), the sites on top, and the box to fit: the bands, else the
  // sites. Each endpoint's hover text is CVI's "City, ST" (R's paste0, so a missing value reads "NA").
  // A zone site's polygon is drawn in the inner color (it holds what a Single buffer would); the facilities
  // inside (fac: facilitiesInside's result) are drawn in their layer's color, one dot per facility; legend: what the
  // match map's small legend lists: the sites, origins and destinations drawn, each ring
  // radius with its color, zones, and each facility layer with its count.
  const BAND_COLORS = ['#fcb614', '#8fc965', '#a7d7e2'];
  function mapData(res, fac) {
    const sites = res.sites || [];
    const bands = [].concat(...sites.map(s => P().bandShapes(s)));
    const levels = [...new Set(bands.map(f => f.properties.bandKm))].sort((a, b) => a - b);
    bands.forEach(f => {
      f.properties.color = BAND_COLORS[Math.min(levels.indexOf(f.properties.bandKm), BAND_COLORS.length - 1)];
    });
    const zones = sites.filter(s => s.zone).map(s => ({ type: 'Feature', geometry: s.zone,
      properties: { site: s.id, name: s.name, zone: true, innerKm: 0, outerKm: 0, bandKm: 0, color: BAND_COLORS[0] } }));
    const label = (r, side) => [r[side + '.City'], r[side + '.State']]
      .map(v => (v === null || v === undefined ? 'NA' : String(v))).join(', ');
    const ends = (flag, side) => (res.matched || []).filter(r => r[flag]).map(r => ({
      lat: P().number(r[side + '.Lat']), lon: P().number(r[side + '.Long']), label: label(r, side)
    })).filter(p => p.lat !== null && p.lon !== null);
    const outlines = f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map(p => p[0]));
    const shapes = bands.concat(zones);
    const points = [];
    if (shapes.length) shapes.forEach(f => outlines(f).forEach(ring => ring.forEach(p => points.push(p))));
    else sites.forEach(s => points.push([s.lon, s.lat]));
    // A loop, not Math.min(...list): a detailed zone has more points than a function call can take.
    let bounds = null;
    points.forEach(p => {
      if (!bounds) bounds = [p[0], p[1], p[0], p[1]];
      bounds[0] = Math.min(bounds[0], p[0]); bounds[1] = Math.min(bounds[1], p[1]);
      bounds[2] = Math.max(bounds[2], p[0]); bounds[3] = Math.max(bounds[3], p[1]);
    });
    // One dot per facility, however many buffers hold it.
    const seen = new Set(), facilities = [];
    ((fac && fac.rows) || []).forEach(r => {
      const key = r.layer + '\r' + r.lat + '\r' + r.lon + '\r' + r.name;
      if (seen.has(key)) return;
      seen.add(key);
      facilities.push({ lat: r.lat, lon: r.lon, color: r.color, shape: r.shape,
        label: r.name + ' (' + r.layerLabel + ')' });
    });
    const origins = ends('hitOrigin', 'Origin'), dests = ends('hitDest', 'Dest');
    const legend = {
      sites: sites.length, origins: origins.length, dests: dests.length,
      rings: levels.map((km, i) => ({ km, color: BAND_COLORS[Math.min(i, BAND_COLORS.length - 1)] })),
      zones: zones.length,
      facilities: ((fac && fac.layers) || []).map(l => ({ label: l.label, color: l.color, shape: l.shape,
        n: new Set(fac.rows.filter(r => r.layer === l.key).map(r => r.lat + ',' + r.lon + ',' + r.name)).size }))
        .filter(l => l.n > 0)
    };
    return {
      bands: bands.concat(zones),
      origins,
      dests,
      sites: sites.map(s => ({ lat: s.lat, lon: s.lon, name: s.name === null || s.name === undefined ? '' :
        String(s.name) })),
      facilities,
      legend,
      bounds
    };
  }

  // ── Places, facilities inside ─────────────────────────────────────────────────────────────────────────────────
  // The sites table's Place column: the city (Department of Revenue limits) or census-designated place holding the
  // site (population.placeAt), "Outside city limits" otherwise, and "Outside Washington" for a point outside the
  // state's counties (the population layers cover Washington only).
  function placeText(place, inWashington) {
    if (place) return place.kind === 'cdp' ? place.name + ' CDP' : place.name;
    return inWashington ? 'Outside city limits' : 'Outside Washington';
  }

  // Facilities inside each buffer: for each prepared site (proximity.prepareSites) and each facility
  // layer ({ key, label, color, points: [{ name, display, lat, lon, county, townName }] }, as facilities.select gives
  // them), the points inside the site's buffer or zone: the engine's distance at most the outer ring (the edge
  // counts), the smallest ring that holds it. rows: site by site, layer by layer, nearest first (then by name);
  // distances as R's round(x, 2), as CVI rounds nearest_site_km. counts: per site, per layer and in all, each facility
  // (name and place) once.
  function facilitiesInside(sites, layers) {
    const PX = P();
    const rows = [];
    const counts = sites.map(s => ({ site: s.id, name: s.name, byLayer: {}, total: 0 }));
    const text = v => (v === null || v === undefined ? '' : String(v));
    sites.forEach((s, k) => {
      layers.forEach(l => {
        const found = [];
        l.points.forEach(p => {
          const km = PX.siteKm(p.lat, p.lon, s);
          if (km === null || km > s.bufferKm) return;
          found.push({ site: s.id, siteName: text(s.name), siteLat: s.lat, siteLon: s.lon, zone: !!s.zone,
            layer: l.key, layerLabel: l.label, color: l.color, shape: l.shape,
            name: text(p.display !== undefined ? p.display : p.name),
            lat: p.lat, lon: p.lon, exactKm: km, km: round2(km), bandKm: PX.ringOf(s.radii, km),
            county: p.county || null, town: p.townName ? p.townName : null });
        });
        found.sort((a, b) => a.exactKm - b.exactKm || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        // Counted once per name and place, as the run's line and the PNG count them; the rows keep every line of the
        // file (so a facility listed twice does not give "2" in the panel and "1" in the box).
        const distinct = new Set(found.map(r => r.lat + '\r' + r.lon + '\r' + r.name)).size;
        counts[k].byLayer[l.key] = distinct;
        counts[k].total += distinct;
        found.forEach(x => rows.push(x));   // not rows.push(...found): a call takes about 125,000 at most
      });
    });
    return { rows, counts, layers: layers.map(l => ({ key: l.key, label: l.label, color: l.color, shape: l.shape,
      pngLabel: l.pngLabel || l.label })), total: rows.length };
  }
  // The run's line about the facilities (after CVI's lines).
  // Each facility counted once, however many buffers hold it (the counts table counts per site).
  function facilitiesMessage(fac) {
    if (!fac.total) return { level: 'info', text: 'No facilities of the ticked layers lie inside the buffers or zones.' };
    const k = new Set(fac.rows.map(r => r.layer + '\r' + r.lat + '\r' + r.lon + '\r' + r.name)).size;
    return { level: 'ok', text: 'Found ' + k + ' facilit' + (k === 1 ? 'y' : 'ies') +
      ' inside the buffers or zones of ' + fac.counts.filter(c => c.total > 0).length + ' site(s).' };
  }
  // The counts table above the list: one row per site (its buffer, or "Zone"), one column per layer, and the total.
  function facilityCounts(fac, sites) {
    const km = x => numText(x) + ' km';
    const columns = ['Site', 'Buffer'].concat(fac.layers.map(l => l.label), ['Total']);
    const rows = fac.counts.map((c, k) => {
      const s = sites[k];
      const buffer = s.zone ? 'Zone' : s.radii.length > 1 ? s.radii.map(numText).join(' / ') + ' km' : km(s.bufferKm);
      return [c.name === null || c.name === undefined ? '' : String(c.name), buffer]
        .concat(fac.layers.map(l => c.byLayer[l.key] || 0), [c.total]);
    });
    return { columns, rows };
  }
  // The list of facilities inside, for the page's table (the CSV has more columns: exports.lookupFacilitiesCsv).
  const FACILITY_TABLE_COLUMNS = ['Site', 'Layer', 'Facility', 'Distance (km)', 'Ring (km)', 'County', 'Town'];
  function facilityTable(fac) {
    return { columns: FACILITY_TABLE_COLUMNS, rows: fac.rows.map(r => [r.siteName, r.layerLabel, r.name, r.km,
      r.zone ? null : r.bandKm, r.county, r.town]) };
  }

  // ── The page side ───────────────────────────────────────────────────────────────────────────────────────────────
  // init(host) wires the Premise Lookup sidebar and results of cvi/index.html; host (ui.js): { master() (the loaded
  // master or null), loading() (a file is being read), loadScript(src), geo (the county file), watchFile(input,
  // onFile), facilities() ({ prepared (facilities.prepare), reason(key) } for the facility files the page
  // holds), masterName() (the master's file name, for export_params.json) }. ui.js calls masterChanged() when a master
  // is loaded or cleared, facilitiesChanged() when the facility files change, and shown(on) when the Maps / Premise
  // Lookup switch changes.
  // As CVI's tab: the filters (every year and species group ticked when a master loads; none ticked means all, as
  // CVI's empty pickers), the buffer style, the sites table (add, double-click to edit, select and remove, clear,
  // paste, upload, template), Run query with CVI's messages, the five tiles, the match map and the matched-CVI table.
  // Deliberate differences (docs/DELIBERATE_DIFFERENCES.md): CVI's notifications are shown as lines under the
  // button that caused them; Run query is grayed with its reason while no master, or no premises coordinates, is
  // there; a new master clears the result on screen; an empty default buffer stops the run with a message; an edit
  // keeps the table's page; no "Lookup mode" choice (CVI's Premise Type mode is not built).
  // Also: the Place column; zones from a file (a zone's row: its name editable, its
  // point and "Zone" fixed); the facility layers checked inside each buffer, with Run query open whenever a master
  // with premises coordinates or a ticked facility layer is there (facilities only, with the CVI match's reason, when
  // the master is missing); Pick on map; the facilities-inside card; the match map's legend; the export ZIP (the
  // matched rows as CVI's Export CSV writes them, the facilities inside, export_params.json).

  const SITES_PAGE = 8, TABLE_PAGE = 10;   // CVI's pageLength for the sites and matched-CVI tables
  const SECOND_CLICK_MS = 600;   // two clicks on one cell within this time open it, as a double-click
  const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
  const COORD_REASON = missing => 'Needs the column' + (missing.length > 1 ? 's ' : ' ') +
    missing.join(', ').replace(/, ([^,]*)$/, ' and $1') + ' in the CVI master table.';
  const EMPTY_NOTE = 'Configure your sites and filters in the sidebar and click Run query to see results.';

  function init(host) {
    const doc = root.document, W = root.CVIWA;
    const $ = id => doc.getElementById(id);
    const el = (tag, cls, text) => {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };
    const icon = name => W.icons[name] || '';
    const ps = {
      sites: [], uid: 0, selected: new Set(), sitesPage: 0, mode: 'single',
      years: [], quarters: QUARTERS.slice(), species: [], yearChoices: [], speciesChoices: [], endpoint: 'either',
      result: null, table: { search: '', sortColumn: 0, descending: false, page: 0 },
      map: null, mapFailed: false, mapLoading: false, shown: false,
      fac: { selectedLayers: [], attributes: Object.create(null) }, facInitialized: false, facResult: null,
      facTable: { search: '', sortColumn: 0, descending: false, page: 0 },
      places: 'idle', picking: false, pick: null, runTime: null,
      // The geocode cache file loaded for Find coordinates ({ rows } from parseGeocodeCache, and its name)
      geocache: null, geocacheName: '', geocacheReading: null, geocachePick: 0
    };
    W.lookupState = ps;   // read-only test hook (tests/browser/run_s11_browser.js)

    // Messages: one line per message, as CVI's notifications (ok, info, warn, err).
    // Run query's lines show at the top of the result area, where the eye is after a run, and not under the button
    // (under Run query they were out of view without scrolling, and a copy in both places was redundant).
    function sayRun(messages) {
      say($('lk-run-lines'), messages);
    }
    // Shows status messages ({ level, text }) in a box; the box is hidden when there are none.
    function say(box, messages) {
      box.replaceChildren();
      (messages || []).forEach(m => box.appendChild(el('div', 'status ' + m.level, m.text)));
      box.hidden = !box.children.length;
    }

    // ── Filters ──
    function renderChecks(key, choices, label) {
      const box = $('lk-' + key);
      box.replaceChildren();
      choices.forEach(v => {
        const l = el('label'), cb = el('input');
        cb.type = 'checkbox';
        cb.value = String(v);
        cb.checked = ps[key].indexOf(v) >= 0;
        cb.addEventListener('change', () => {
          ps[key] = cb.checked ? ps[key].concat([v]) : ps[key].filter(x => x !== v);
          $('lk-' + key + '-none').hidden = ps[key].length > 0;
        });
        l.append(cb, doc.createTextNode(' ' + label(v)));
        box.appendChild(l);
      });
      box.hidden = !choices.length;
      $('lk-' + key + '-none').hidden = ps[key].length > 0 || !choices.length;
    }
    // Redraws the year, quarter and species check boxes.
    function renderFilters() {
      renderChecks('years', ps.yearChoices, String);
      renderChecks('quarters', QUARTERS, String);
      renderChecks('species', ps.speciesChoices, String);
    }
    ['years', 'quarters', 'species'].forEach(key => {
      const all = () => (key === 'quarters' ? QUARTERS : key === 'years' ? ps.yearChoices : ps.speciesChoices);
      $('lk-' + key + '-all').addEventListener('click', () => { ps[key] = all().slice(); renderFilters(); });
      $('lk-' + key + '-clear').addEventListener('click', () => { ps[key] = []; renderFilters(); });
    });
    doc.querySelectorAll('input[name=lk-endpoint]').forEach(r => r.addEventListener('change', () => {
      if (r.checked) ps.endpoint = r.value;
    }));

    // ── Buffer ──
    function setMode(mode) {
      ps.mode = mode;
      $('lk-single-block').hidden = mode !== 'single';
      $('lk-bands-block').hidden = mode !== 'bands';
      renderSites();
    }
    doc.querySelectorAll('input[name=lk-mode]').forEach(r => r.addEventListener('change', () => {
      if (r.checked) setMode(r.value);
    }));
    doc.querySelectorAll('.lk-preset').forEach(b => b.addEventListener('click', () => {
      $('lk-default').value = b.getAttribute('data-km');
    }));
    doc.querySelectorAll('.lk-band-preset').forEach(b => b.addEventListener('click', () => {
      $('lk-bands').value = b.getAttribute('data-bands');
    }));

    // ── Sites table ──
    // A site: { uid, name, lat, long, buffer_km, bands_csv }, numbers or null (R's NA), as CVI's sites_state.
    function addSites(list) {
      list.forEach(s => {
        ps.uid++;
        const site = { uid: ps.uid, name: s.name === undefined ? null : s.name, lat: s.lat, long: s.long,
          buffer_km: s.buffer_km === undefined ? null : s.buffer_km,
          bands_csv: s.bands_csv === undefined ? null : s.bands_csv };
        if (s.zone) Object.assign(site, { zone: s.zone, zoneFile: s.zoneFile || '' });
        ps.sites.push(site);
      });
      ps.selected.clear();
      ps.sitesPage = 0;
      renderSites();
    }
    const fourth = () => editField(ps.mode, 4);
    const cellText = v => (v === null || v === undefined ? '' : String(v));
    let focusAfter = null;
    // Rebuilds the sites table (the current page of sites, with their selection and place).
    function renderSites() {
      const box = $('lk-sites');
      const tableEl = el('table', 'lk-sites');
      const head = el('tr');
      const names = ['', 'Site name', 'Lat', 'Long', ps.mode === 'bands' ? 'Bands (km, optional)' : 'Buffer (km, optional)',
        'Place'];
      const classes = ['row-no', 'c-name', 'num', 'num', 'num', 'lk-place'];
      names.forEach((n, j) => head.appendChild(el('th', classes[j], n)));
      const thead = el('thead');
      thead.appendChild(head);
      const body = el('tbody');
      const pages = Math.max(1, Math.ceil(ps.sites.length / SITES_PAGE));
      ps.sitesPage = Math.min(ps.sitesPage, pages - 1);
      const first = ps.sitesPage * SITES_PAGE;
      const shown = ps.sites.slice(first, first + SITES_PAGE);
      if (!shown.length) {
        const tr = el('tr'), td = el('td', 'lk-empty-row', 'No data available in table');
        td.colSpan = 6;
        tr.appendChild(td);
        body.appendChild(tr);
      }
      shown.forEach((site, k) => {
        const tr = el('tr');
        tr.setAttribute('aria-selected', String(ps.selected.has(site.uid)));
        if (ps.selected.has(site.uid)) tr.classList.add('selected');
        const no = el('td', 'row-no num', String(first + k + 1));
        no.tabIndex = 0;
        no.title = 'Select or unselect this site (click or Space)';
        tr.appendChild(no);
        ['name', 'lat', 'long', fourth()].forEach((field, j) => {
          // A zone's point and its "Zone" cell are fixed (the point lies inside the polygon; the polygon is the area).
          const fixed = !!site.zone && j > 0;
          const shown = fixed && j === 3 ? 'Zone (' + site.zoneFile + ')' : cellText(site[field]);
          const td = el('td', j === 0 ? null : fixed ? 'num lk-fixed' : 'num', shown);
          td.tabIndex = 0;
          td.title = fixed ? (j === 3 ? 'A zone from ' + site.zoneFile + ': it matches inside its polygon' :
            'A point inside the zone (fixed)') : (j === 0 ? cellText(site[field]) + ' — ' : '') +
            'Double-click (or Enter) to edit';
          if (!fixed) {
            td.setAttribute('data-field', field);
            td.addEventListener('dblclick', () => startEdit(td, site, field));
            td.addEventListener('keydown', e => {
              if (td.classList.contains('editing')) return;
              if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(td, site, field); }
            });
          }
          tr.appendChild(td);
        });
        const place = el('td', 'lk-place', placeOf(site));
        place.title = place.textContent;
        tr.appendChild(place);
        tr.addEventListener('click', e => {
          if (e.target.closest('td.editing')) return;
          toggle(site.uid);
          secondClick(e, site);
        });
        tr.addEventListener('keydown', e => {
          if (e.key === ' ' && !e.target.closest('td.editing')) { e.preventDefault(); toggle(site.uid); }
        });
        tr.setAttribute('data-uid', String(site.uid));
        body.appendChild(tr);
      });
      tableEl.append(thead, body);
      const info = el('div', 'lk-info', ps.sites.length
        ? 'Showing ' + (first + 1) + ' to ' + (first + shown.length) + ' of ' + ps.sites.length + ' entries'
        : 'Showing 0 to 0 of 0 entries');
      const pager = el('div', 'lk-pager');
      pager.setAttribute('role', 'navigation');
      pager.setAttribute('aria-label', 'Sites table pages');
      const pageButton = (text, p, disabled, current) => {
        const b = el('button', 'dt-page' + (current ? ' current' : ''), text);
        b.type = 'button';
        b.disabled = disabled;
        if (current) b.setAttribute('aria-current', 'page');
        b.addEventListener('click', () => { ps.sitesPage = p; renderSites(); });
        return b;
      };
      if (pages > 1) {
        pager.appendChild(pageButton('Previous', ps.sitesPage - 1, ps.sitesPage === 0));
        W.previews.pageNumbers(ps.sitesPage, pages).forEach(p => {
          pager.appendChild(p === null ? el('span', 'dt-gap', '…') : pageButton(String(p + 1), p, false, p === ps.sitesPage));
        });
        pager.appendChild(pageButton('Next', ps.sitesPage + 1, ps.sitesPage >= pages - 1));
      }
      box.replaceChildren(tableEl, info, pager);
      if (!ps.result && ps.map && ps.picking) drawMap();   // the sites added so far, while picking before a run
      if (focusAfter) {
        const cell = box.querySelector('tr[data-uid="' + focusAfter.uid + '"] td[data-field="' + focusAfter.field + '"]');
        if (cell) cell.focus();
        focusAfter = null;
      }
    }
    // ── Place column ──
    // The city limits and census places load with the side (population.js); until then the column reads "…".
    let inWa = null;
    function placeOf(site) {
      if (site.lat === null || site.long === null || !P().usable(site.lat, site.long)) return '';
      if (ps.places === 'failed') return 'Not available';
      if (ps.places !== 'ready') return '…';
      if (!inWa) {
        const counties = host.geo.counties;
        inWa = root.WSDA.facilities.countyMembership(counties, counties.features.map(f => f.properties.name));
      }
      return placeText(root.WSDA.population.placeAt(site.long, site.lat), inWa.contains(site.long, site.lat));
    }
    // Loads the city limits and census places once, then redraws the sites table.
    function loadPlaces() {
      if (ps.places !== 'idle') return;
      ps.places = 'loading';
      const PN = root.WSDA.population;
      Promise.all([PN.load('cities', { base: '../' }), PN.load('places', { base: '../' })])
        .then(() => { ps.places = 'ready'; })
        .catch(() => { ps.places = 'failed'; })
        .then(() => renderSites());
    }

    // A second click on the same cell within SECOND_CLICK_MS also opens it for editing. Safari sends a double-click
    // only when both clicks are quick and at the same spot; a short pause or a small move of the pointer between them
    // made two single clicks there. The first click selects the row, the second
    // unselects it, as with a double-click.
    let lastClick = null;
    function secondClick(e, site) {
      const td = e.target.closest('td[data-field]');
      const key = td ? site.uid + ' ' + td.getAttribute('data-field') : null;
      const again = key !== null && lastClick && lastClick.key === key && e.timeStamp - lastClick.time <= SECOND_CLICK_MS;
      lastClick = again || key === null ? null : { key, time: e.timeStamp };
      if (again) startEdit(td, site, td.getAttribute('data-field'));
    }
    // Selecting changes the row in place: rebuilding the table between the two clicks of a double-click would put
    // the second click on a new cell, and Safari then sends no double-click (the edit would never open).
    function toggle(uid) {
      if (ps.selected.has(uid)) ps.selected.delete(uid);
      else ps.selected.add(uid);
      const tr = $('lk-sites').querySelector('tr[data-uid="' + uid + '"]');
      if (!tr) return;
      const on = ps.selected.has(uid);
      tr.classList.toggle('selected', on);
      tr.setAttribute('aria-selected', String(on));
    }
    // Opens a text box in a sites table cell to edit that field of the site.
    function startEdit(td, site, field) {
      if (td.classList.contains('editing')) return;
      const input = el('input');
      input.type = 'text';
      input.spellcheck = false;   // no browser spelling service sees what is typed
      input.autocomplete = 'off';
      input.value = cellText(site[field]);
      input.setAttribute('aria-label', 'Edit ' + field);
      td.classList.add('editing');
      td.replaceChildren(input);
      input.focus();
      input.select();
      let done = false;
      const finish = keep => {
        if (done) return;
        done = true;
        if (keep) editCell(site, field, input.value);
        focusAfter = { uid: site.uid, field };
        renderSites();
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        e.stopPropagation();
      });
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('click', e => e.stopPropagation());
    }
    $('lk-remove').addEventListener('click', () => {
      if (!ps.selected.size || !ps.sites.length) return;
      ps.sites = ps.sites.filter(s => !ps.selected.has(s.uid));
      ps.selected.clear();
      ps.sitesPage = 0;
      renderSites();
    });
    $('lk-clear').addEventListener('click', () => {
      ps.sites = [];
      ps.selected.clear();
      ps.sitesPage = 0;
      renderSites();
    });

    // Add a site (CVI's site_add, addSiteRule): the form is emptied after a site is added.
    $('lk-add').addEventListener('click', () => {
      const r = addSiteRule(ps.sites.length, { name: $('lk-new-name').value, lat: P().number($('lk-new-lat').value),
        long: P().number($('lk-new-long').value), buffer: P().number($('lk-new-buffer').value) });
      if (r.site) {
        addSites([r.site]);
        ['lk-new-name', 'lk-new-address', 'lk-new-lat', 'lk-new-long', 'lk-new-buffer'].forEach(id => { $(id).value = ''; });
        say($('lk-geo-msg'), []);
        if (ps.picking) setPicking(false);
      }
      say($('lk-add-msg'), [r.message]);
    });

    // ── Find coordinates (geocodeRule): the loaded geocode cache file only ──
    // A hit fills in Latitude and Longitude for review; the site is added by Add site, as a typed one (CVI's flow).
    $('lk-geo-find').addEventListener('click', () => {
      if (ps.geocacheReading) {
        say($('lk-geo-msg'), [{ level: 'info', text: 'Still reading ' + ps.geocacheReading + '; try again in a moment.' }]);
        return;
      }
      const r = geocodeRule($('lk-new-address').value, ps.geocache);
      if (r.lat !== undefined) {
        $('lk-new-lat').value = String(r.lat);
        $('lk-new-long').value = String(r.long);
      }
      say($('lk-geo-msg'), [r.message]);
    });
    // The geocode cache file: read here, kept for this page; a file that cannot serve leaves the one before in use.
    // A size limit checked before reading, "Reading…" while it loads, and only the latest pick used.
    host.watchFile($('lk-geo-file'), f => {
      const keep = () => (ps.geocache ? ' ' + ps.geocacheName + ' stays in use.' : '');
      const pick = ++ps.geocachePick;
      if (f.size > GEOCACHE_MAX_BYTES) {
        ps.geocacheReading = null;
        say($('lk-geo-msg'), [{ level: 'err', text: f.name + ' is ' + (f.size / 1048576).toFixed(1) + ' MB; the page reads ' +
          'geocode cache files up to ' + GEOCACHE_MAX_BYTES / 1048576 + ' MB.' + keep() }]);
        return;
      }
      ps.geocacheReading = f.name;
      say($('lk-geo-msg'), [{ level: 'info', text: 'Reading ' + f.name + '…' }]);
      const reader = new root.FileReader();
      reader.onload = () => {
        if (pick !== ps.geocachePick) return;   // a later pick replaced this one
        ps.geocacheReading = null;
        const r = parseGeocodeCache(String(reader.result), f.name);
        if (!r.rows) {
          say($('lk-geo-msg'), [{ level: r.message.level, text: r.message.text + keep() }]);
          return;
        }
        ps.geocache = r;
        ps.geocacheName = f.name;
        const passed = r.rows.filter(x => !x.key || !coordOk(x.lat, x.long)).length;
        say($('lk-geo-msg'), [{ level: 'ok', text: 'Loaded ' + r.rows.length + ' address(es) from ' + f.name + '.' +
          (passed ? ' ' + passed + ' without an address or usable coordinates will be passed over.' : '') }]
          .concat(r.notes));
      };
      reader.onerror = () => {
        if (pick !== ps.geocachePick) return;
        ps.geocacheReading = null;
        say($('lk-geo-msg'), [{ level: 'err', text: f.name + ' is empty or unreadable.' + keep() }]);
      };
      reader.readAsText(f);
    });

    // ── Pick on map ──
    // On: the match map shows (with the result, or the sites so far) and a click on it fills in Latitude and
    // Longitude (5 decimals, about a meter), marks the spot and moves to Name; Add site (or the button again, or
    // Escape) ends it. The site itself is added by Add site, with its checks and message, as a typed one.
    function setPicking(on) {
      ps.picking = !!on;
      $('lk-pick').setAttribute('aria-pressed', String(ps.picking));
      ps.pick = null;
      if (ps.map && !ps.mapFailed && W.lookupmap) {
        W.lookupmap.setPicking(ps.map, ps.picking, onPick);
        W.lookupmap.setPick(ps.map, null);
      }
      showCards();
      if (ps.picking) {
        drawMap();
        say($('lk-add-msg'),
          [{ level: 'info', text: 'Click the match map where the site is. Escape or Pick on map ends picking.' }]);
      } else if ($('lk-add-msg').querySelector('.status.info')) say($('lk-add-msg'), []);
    }
    // A click on the match map while picking: the point, rounded to 5 decimals, fills the new site's latitude and
    // longitude.
    function onPick(lon, lat) {
      const wrapped = ((lon + 180) % 360 + 360) % 360 - 180;   // a click on another copy of the world
      const la = Number(lat.toFixed(5)), lo = Number(wrapped.toFixed(5));
      ps.pick = [lo, la];
      $('lk-new-lat').value = String(la);
      $('lk-new-long').value = String(lo);
      W.lookupmap.setPick(ps.map, ps.pick);
      say($('lk-add-msg'), [{ level: 'info', text: 'Picked ' + la + ', ' + lo + '. Name the site, then click Add site.' }]);
      $('lk-new-name').focus();
    }
    $('lk-pick').addEventListener('click', () => setPicking(!ps.picking));
    doc.addEventListener('keydown', e => {
      const inBox = e.target && e.target.closest && e.target.closest('input, textarea, select');
      if (e.key === 'Escape' && ps.picking && ps.shown && !inBox) setPicking(false);
    });

    // Paste and upload (CVI's bulk_apply and upload_csv), and the template.
    $('lk-paste-add').addEventListener('click', () => {
      const r = parsePaste($('lk-paste').value);
      const m = pasteMessage(r);
      if (r.sites.length) {
        addSites(r.sites);
        $('lk-paste').value = '';
      }
      say($('lk-bulk-msg'), [m]);
    });
    host.watchFile($('lk-upload'), f => {   // ui.js: once per pick, the picker emptied so the same file can be chosen again
      const reader = new root.FileReader();
      reader.onload = () => {
        const r = parseUpload(String(reader.result));
        if (r.sites) addSites(r.sites);
        say($('lk-bulk-msg'), [r.message]);
      };
      reader.onerror = () => say($('lk-bulk-msg'), [{ level: 'err', text: 'Uploaded CSV is empty or unreadable.' }]);
      reader.readAsText(f);
    });
    $('lk-template').addEventListener('click', () => {
      const url = root.URL.createObjectURL(new root.Blob([TEMPLATE_CSV], { type: 'text/csv' }));
      const a = el('a');
      a.href = url;
      a.download = TEMPLATE_NAME;
      a.hidden = true;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      root.setTimeout(() => root.URL.revokeObjectURL(url), 60000);
    });

    // Zones from a file (shared/zones.js): each polygon becomes a site, named from the file.
    host.watchFile($('lk-zone-file'), f => {
      say($('lk-zone-msg'), [{ level: 'info', text: 'Reading ' + f.name + '…' }]);
      root.WSDA.zones.read(f).then(r => {
        addSites(r.zones.map(z => ({ name: z.name, lat: z.point[1], long: z.point[0], buffer_km: null, bands_csv: null,
          zone: z.geometry, zoneFile: f.name })));
        const left = [];
        if (r.skipped) left.push(r.skipped
          + (r.skipped === 1 ? ' shape that is not a polygon' : ' shapes that are not polygons'));
        if (r.broken) left.push(r.broken + (r.broken === 1 ? ' polygon' : ' polygons') + ' with unusable coordinates');
        const lines = [{ level: 'ok', text: 'Added ' + r.zones.length + ' zone(s) from ' + f.name + '.' +
          (left.length ? ' Left out ' + left.join(' and ') + '.' : '') }];
        r.notes.forEach(t => lines.push({ level: 'info', text: t }));
        say($('lk-zone-msg'), lines);
      }).catch(e => {
        say($('lk-zone-msg'), [{ level: 'err', text: e && e.name === 'ZoneError' ? e.message
          : f.name + ' could not be read' + (e && e.message ? ': ' + e.message : '.') }]);
      });
    });

    // ── Facility layers: the CVI page's facility files, picked as on the Infrastructure dashboard ──
    const FAC = () => root.WSDA.facilities;
    const facilityFiles = () => (host.facilities ? host.facilities() : null);
    const usableLayers = () => {
      const f = facilityFiles();
      return f ? f.prepared.layers.filter(l => l.usable).map(l => l.key) : [];
    };
    // Redraws the facility layer check list (the facility files' usable layers).
    function renderFacilityList() {
      const f = facilityFiles(), usable = usableLayers();
      $('lk-fac-none').hidden = usable.length > 0;
      const list = $('lk-fac-list');
      if (!f || !usable.length) { list.replaceChildren(); return; }
      root.WSDA.facilityUI.render(list, f.prepared, ps.fac, () => { renderFacilityList(); gateRun(); }, 'lk',
        { reason: f.reason });
    }
    $('lk-fac-all').addEventListener('click', () => { ps.fac.selectedLayers = usableLayers(); renderFacilityList(); gateRun(); });
    $('lk-fac-clear').addEventListener('click', () => { ps.fac.selectedLayers = []; renderFacilityList(); gateRun(); });
    // The ticked layers with their points (attribute filters applied), for a run.
    function checkedLayers() {
      const f = facilityFiles();
      if (!f) return [];
      const on = ps.fac.selectedLayers.filter(k => usableLayers().indexOf(k) >= 0);
      if (!on.length) return [];
      return FAC().select(f.prepared, { layers: on, attributes: ps.fac.attributes }).layers
        .map(l => ({ key: l.key, label: l.liveLabel, pngLabel: l.label, color: l.color, shape: l.shape,
          points: l.points }));
    }
    // The facility files changed: the layer picks are brought in line with them and the list redrawn.
    function facilitiesChanged() {
      const f = facilityFiles();
      if (f) {
        const usable = usableLayers().length > 0;
        const next = FAC().reconcile(f.prepared, ps.fac.selectedLayers, ps.fac.attributes, !ps.facInitialized && usable);
        ps.fac.selectedLayers = next.selectedLayers;
        ps.fac.attributes = next.attributes;
        if (usable) ps.facInitialized = true;
      }
      renderFacilityList();
      gateRun();
    }

    // ── Run query ──
    function gateRun() {
      const m = host.master();
      let reason = null;
      if (host.loading()) reason = 'The master dataset is still loading — try again in a moment.';
      else if (!m) reason = 'Load a master dataset (Master dataset, above) to run a query.';
      else {
        const missing = ['Origin.Lat', 'Origin.Long', 'Dest.Lat', 'Dest.Long'].filter(c => m.header.indexOf(c) < 0);
        if (missing.length) reason = COORD_REASON(missing);
      }
      // With the CVI match grayed, ticked facility layers still run (facilities only).
      const facilitiesOnly = !!reason && !host.loading() && checkedLayers().length > 0;   // not while a master loads
      $('lk-run').disabled = !!reason && !facilitiesOnly;
      $('lk-run-reason').textContent = !reason ? '' : facilitiesOnly
        ? 'The CVI match is grayed: ' + reason + ' Run query checks the facilities only.' : reason;
      $('lk-run-reason').hidden = !reason;
      ps.runReason = reason;
      ps.facilitiesOnly = facilitiesOnly;
      $('lk-empty').textContent = emptyNote();
    }
    // The result area's line before a result: what to do, or why Run query is grayed (the button is at the end of
    // the sidebar, often out of view).
    const emptyNote = () => (ps.runReason && !ps.facilitiesOnly ? 'Run query is grayed: ' + ps.runReason : EMPTY_NOTE);
    // The facilities inside, or a run line saying why they could not be found (so an error here does not end the
    // click with no message and the old result left on screen).
    function facilitiesStep(sites, layers) {
      try {
        return { fac: facilitiesInside(sites, layers), line: null };
      } catch (e) {
        return { fac: null, line: { level: 'err', text: 'Facilities inside failed: ' + (e && e.message ? e.message : e) } };
      }
    }
    $('lk-run').addEventListener('click', () => {
      const layers = checkedLayers();
      const facilitiesOnly = !!ps.runReason && layers.length > 0;
      const plan = prepareRun({
        master: host.master(), loading: host.loading(), sites: ps.sites, mode: ps.mode,
        defaultKm: P().number($('lk-default').value), bandsText: $('lk-bands').value, endpoint: ps.endpoint,
        years: ps.years, quarters: ps.quarters, species: ps.species, facilitiesOnly
      });
      if (plan.stop) { sayRun(plan.messages); return; }
      // Kept with the result shown (the county pages; export_params.json), as copies made now: in Bands mode
      // the run's sites were the table's own rows, so an edit after the run would change them.
      ps.nextRun = { sites: plan.args.sites.map(x => Object.assign({}, x)), layers,
        table: ps.sites.filter(x => x.lat !== null && x.long !== null).map(x => ({ name: x.name, lat: x.lat, long: x.long,
          bands_csv: x.bands_csv === undefined ? null : x.bands_csv, zoneFile: x.zoneFile || null })) };
      if (facilitiesOnly) {
        // No CVI match: the sites prepared as the engine prepares them, then the facilities inside.
        const prepared = P().prepareSites(plan.args.sites, { defaultKm: plan.args.opts.defaultKm, bands: plan.args.opts.bands });
        const lines = plan.messages.slice();
        if (prepared.skipped > 0) {
          lines.push({ level: 'warn', text: 'Skipped ' + prepared.skipped +
            ' site(s) with out-of-range coordinates (lat -90..90, long -180..180).' });
        }
        if (!prepared.sites.length) {
          sayRun(lines.concat([{ level: 'warn', text: 'No sites with valid coordinates to query.' }]));
          return;
        }
        const step = facilitiesStep(prepared.sites, layers);
        if (!step.fac) {
          sayRun(lines.concat([step.line]));
          return;
        }
        const fac = step.fac;
        sayRun(lines.concat([facilitiesMessage(fac)]));
        const res = { status: 'facilities_only', cviNote: 'The CVI match is grayed: ' + ps.runReason +
          ' The facilities inside are below.', sites: prepared.sites,
          bandsMode: prepared.bandsMode, matched: [], skippedSites: prepared.skipped };
        ps.lastRun = res;   // test hook
        showResult(res, fac, plan.args.opts);
        return;
      }
      let res;
      try {
        res = query(host.master(), plan.args.sites, plan.args.opts);
      } catch (e) {
        sayRun(plan.messages.concat([{ level: 'err', text: 'Proximity query failed: ' + e.message }]));
        return;
      }
      const after = afterRun(res);
      // The filters do not apply to facilities: with no CVI matching them, the facilities inside still show, as a
      // facilities-only result.
      const sitesUsable = res.sites && res.sites.length && (after.keep === 'store' || after.keep === 'clear');
      const step = sitesUsable && layers.length ? facilitiesStep(res.sites, layers) : { fac: null, line: null };
      const fac = step.fac;
      sayRun(plan.messages.concat(after.messages, fac ? [facilitiesMessage(fac)] : step.line ? [step.line] : []));
      ps.lastRun = res;   // test hook
      if (after.keep === 'store') showResult(res, fac, plan.args.opts);
      else if (after.keep === 'clear' && fac) {
        showResult({ status: 'facilities_only', cviNote: 'No CVIs match the current filters. The facilities inside are below.',
          sites: res.sites, bandsMode: res.bandsMode, matched: [], skippedSites: res.skippedSites }, fac, plan.args.opts);
      } else if (after.keep === 'clear') showResult(null);
    });

    // ── Results ──
    // The cards under the run's lines: the tiles (or why the CVI match is grayed), the match map (also while
    // picking), the facilities inside (when layers were checked), the matched CVIs and the export.
    function showCards() {
      const res = ps.result;
      $('lk-empty').hidden = !!res;
      $('lk-results').hidden = !res;
      $('lk-map-card').hidden = !res && !ps.picking;
      $('lk-fac-card').hidden = !res || !ps.facResult;
      $('lk-cvi-card').hidden = !res || res.status === 'facilities_only';
      $('lk-export-card').hidden = !res;
    }
    // Shows a run's result (or clears it, with none): keeps it with the run's sites, layers and options, then
    // redraws the cards, tiles, tables and map.
    function showResult(res, fac, opts) {
      ps.result = res;
      ps.runSites = res && ps.nextRun ? ps.nextRun.sites : null;
      ps.runLayers = res && ps.nextRun ? ps.nextRun.layers : null;
      ps.runTable = res && ps.nextRun ? ps.nextRun.table : null;
      ps.facResult = res ? fac || null : null;
      ps.runOpts = res ? opts || null : null;
      ps.runTime = res ? new Date() : null;
      $('lk-empty').textContent = emptyNote();
      showCards();
      if (!res) {
        if (ps.picking) drawMap();
        return;
      }
      sayExport([]);
      gateExport();
      const off = res.status === 'facilities_only';
      $('lk-tiles').hidden = off;
      $('lk-cvi-off').hidden = !off;
      $('lk-cvi-off').textContent = off ? res.cviNote : '';
      if (ps.facResult) renderFacilities();
      if (off) { drawMap(); return; }
      const row = $('lk-tiles');
      row.replaceChildren();
      tiles(res.summary).forEach(t => {
        const card = el('div', 'metric'), ic = el('div', 'metric-icon'), tx = el('div', 'metric-text');
        ic.style.background = t.accent;
        ic.innerHTML = icon(t.icon);
        const value = el('div', 'metric-value', t.text);
        value.title = t.text;
        tx.append(el('div', 'metric-label', t.label), value);
        card.append(ic, tx);
        const cell = el('div');
        cell.appendChild(card);
        row.appendChild(cell);
      });
      ps.table = { search: '', sortColumn: 0, descending: false, page: 0 };
      renderTable();
      drawMap();
    }
    // A one-cell table (CVI's "Note" / "No matches.").
    function noteTable(box, text) {
      const tbl = el('table', 'dt-table'), h = el('tr'), r = el('tr');
      h.appendChild(el('th', null, 'Note'));
      r.appendChild(el('td', null, text));
      const thead = el('thead'), tbody = el('tbody');
      thead.appendChild(h);
      tbody.appendChild(r);
      tbl.append(thead, tbody);
      box.replaceChildren(tbl);
    }
    // The matched CVIs table, or CVI's one-cell note when nothing matched.
    function renderTable() {
      const t = table(ps.result);
      if (!t.rows.length) { noteTable($('lk-table'), 'No matches.'); return; }   // CVI's one-cell table
      dataTable($('lk-table'), t, ps.table, 'Matched CVIs pages');
    }
    // The facilities inside: the counts per site and layer, then the list (searchable, sortable, paged).
    function renderFacilities() {
      const fac = ps.facResult;
      const counts = facilityCounts(fac, ps.result.sites);
      const tbl = el('table', 'lk-fac-counts'), thead = el('thead'), tbody = el('tbody'), head = el('tr');
      counts.columns.forEach((c, j) => head.appendChild(el('th', j > 1 ? 'num' : null, c)));
      thead.appendChild(head);
      counts.rows.forEach(r => {
        const tr = el('tr');
        r.forEach((v, j) => tr.appendChild(el('td', j > 1 ? 'num' : null, String(v))));
        tbody.appendChild(tr);
      });
      tbl.append(thead, tbody);
      const scroll = el('div', 'lk-fac-scroll');   // many layers: the table scrolls sideways inside the card
      scroll.appendChild(tbl);
      $('lk-fac-counts').replaceChildren(scroll);
      ps.facTable = { search: '', sortColumn: 0, descending: false, page: 0 };
      if (!fac.rows.length) { noteTable($('lk-fac-table'), 'No facilities inside the buffers.'); return; }
      dataTable($('lk-fac-table'), facilityTable(fac), ps.facTable, 'Facilities inside pages');
    }
    // A searchable, sortable, paged table (CVI's DT look), as the matched-CVI table; state keeps its search, sort and
    // page.
    function dataTable(box, t, state, pagerLabel) {
      const V = W.previews;
      const numeric = t.columns.map((c, j) => t.rows.every(r => r[j] === null || typeof r[j] === 'number'));
      const wrap = el('div', 'dt');
      const top = el('div', 'dt-top'), searchLabel = el('label', null, 'Search: '), search = el('input');
      search.type = 'search';
      search.spellcheck = false;
      search.autocomplete = 'off';
      search.className = 'dt-search';
      search.value = state.search;
      searchLabel.appendChild(search);
      top.appendChild(searchLabel);
      const scroll = el('div', 'dt-scroll'), tbl = el('table', 'dt-table'), thead = el('thead'), tbody = el('tbody');
      const headRow = el('tr');
      t.columns.forEach((c, j) => {
        const th = el('th', numeric[j] ? 'num' : null), b = el('button', 'dt-sort', c);
        b.type = 'button';
        b.title = 'Sort by ' + c;
        b.addEventListener('click', () => {
          state.descending = state.sortColumn === j ? !state.descending : false;
          state.sortColumn = j;
          state.page = 0;
          draw();
        });
        th.appendChild(b);
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      tbl.append(thead, tbody);
      scroll.appendChild(tbl);
      const info = el('div', 'dt-info'), pager = el('div', 'dt-pager');
      info.setAttribute('role', 'status');
      pager.setAttribute('role', 'navigation');
      pager.setAttribute('aria-label', pagerLabel);
      wrap.append(top, scroll, info, pager);
      search.addEventListener('input', () => { state.search = search.value; state.page = 0; draw(); });
      const pageButton = (text, p, disabled, current) => {
        const b = el('button', 'dt-page' + (current ? ' current' : ''), text);
        b.type = 'button';
        b.disabled = disabled;
        if (current) b.setAttribute('aria-current', 'page');
        b.addEventListener('click', () => { state.page = p; draw(); });
        return b;
      };
      // Redraws the table's rows and pager for the search, sort and page.
      function draw() {
        const matched = V.filterRows(t.rows, state.search, []);
        const sorted = V.sortRows(matched, state.sortColumn, state.descending);
        const pages = Math.max(1, Math.ceil(sorted.length / TABLE_PAGE));
        const p = Math.min(Math.max(0, state.page), pages - 1);
        state.page = p;
        const shown = sorted.slice(p * TABLE_PAGE, (p + 1) * TABLE_PAGE);
        tbody.replaceChildren();
        if (!shown.length) {
          const tr = el('tr'), td = el('td', 'dt-empty', 'No matching records found');
          td.colSpan = t.columns.length;
          tr.appendChild(td);
          tbody.appendChild(tr);
        }
        shown.forEach(r => {
          const tr = el('tr');
          r.forEach((v, j) => tr.appendChild(el('td', numeric[j] ? 'num' : null, V.cellText(v))));
          tbody.appendChild(tr);
        });
        [...headRow.children].forEach((th, j) => {
          const on = state.sortColumn === j;
          th.setAttribute('aria-sort', on ? (state.descending ? 'descending' : 'ascending') : 'none');
          th.classList.toggle('sorted-up', on && !state.descending);
          th.classList.toggle('sorted-down', on && state.descending);
        });
        const n = x => x.toLocaleString('en-US');
        let text = sorted.length ? 'Showing ' + n(p * TABLE_PAGE + 1) + ' to ' + n(p * TABLE_PAGE + shown.length) +
          ' of ' + n(sorted.length) + ' entries' : 'Showing 0 to 0 of 0 entries';
        if (sorted.length !== t.rows.length) text += ' (filtered from ' + n(t.rows.length) + ' total entries)';
        info.textContent = text;
        pager.replaceChildren(pageButton('Previous', p - 1, p === 0));
        V.pageNumbers(p, pages).forEach(q => {
          pager.appendChild(q === null ? el('span', 'dt-gap', '…') : pageButton(String(q + 1), q, false, q === p));
        });
        pager.appendChild(pageButton('Next', p + 1, p >= pages - 1));
      }
      draw();
      box.replaceChildren(wrap);
    }

    // The match map: made at the first result or the first Pick on map (lookupmap.js loaded then), drawn again at
    // every result. Before a result it shows the sites so far, without buffers.
    function mapContent() {
      if (ps.result) return mapData(ps.result, ps.facResult);
      const sites = ps.sites.filter(x => x.lat !== null && x.long !== null && P().usable(x.lat, x.long))
        .map((x, i) => ({ id: i + 1, name: x.name, lat: x.lat, lon: x.long, radii: x.zone ? [0] : [], zone: x.zone || null }));
      return mapData({ sites, matched: [] }, null);
    }
    // Draws the result on the match map, creating the map the first time it is needed.
    function drawMap() {
      if ((!ps.result && !ps.picking) || ps.mapFailed) return;
      if (ps.map) {
        W.lookupmap.draw(ps.map, mapContent());
        pcApply();   // the names follow the new view
        return;
      }
      if (ps.mapLoading) return;
      ps.mapLoading = true;
      const status = $('lookup-status');
      status.hidden = false;
      status.className = 'status info';
      status.textContent = 'Starting map…';
      const failed = what => {
        ps.mapFailed = true;
        status.hidden = false;
        status.className = 'status err';
        status.textContent = typeof what === 'string'
          ? 'The match map could not be loaded (' + what + '). Reload this page to retry. The tiles and the table are unaffected.'
          : 'Map unavailable. The browser could not start or continue drawing the match map. Reload this page to retry.';
        $('lookup-map').style.visibility = 'hidden';
      };
      host.loadScript('app/lookupmap.js').then(() => {
        if (!W.lookupmap) throw new Error('app/lookupmap.js is not readable');
        try {
          ps.map = W.lookupmap.create($('lookup-map'), host.geo, () => {
            if (ps.mapFailed) return;
            status.hidden = true;
            W.lookupmap.setPicking(ps.map, ps.picking, onPick);
            if (ps.pick) W.lookupmap.setPick(ps.map, ps.pick);
            if (ps.result || ps.picking) W.lookupmap.draw(ps.map, mapContent());
            pcApply();   // layers switched on before the map was made
            if (ps.basemap !== W.basemaps.OFFLINE) basemapApply();   // a basemap chosen before the map was made
          }, failed, { legend: $('lookup-legend') });
        } catch (e) { failed(); return; }
        ps.map.notify = msg => {
          const t = $('lookup-toast'), d = el('div', null, msg);
          t.replaceChildren(d);
          root.setTimeout(() => d.remove(), 6000);
        };
      }).catch(e => failed((e && e.message) || String(e)));
    }

    // ── Population context (shared/population.js) ──
    // Premise Lookup's own three switches, apart from the Maps side's, all on when the page opens.
    // A layer's file loads when Premise Lookup is first shown with the switch on, or when it is
    // turned on; if it cannot be loaded, the switch turns off and stays grayed with the message. The match map draws
    // what is on and loaded, with its block in the legend; the branded PNG takes the same at the click (after the
    // files have loaded). Names as on the PNG: every city and place in the counties in view while the result's box is
    // under 100 km across, else places of 10,000 people or more.
    const PN = root.WSDA.population;
    ps.pc = { on: { cities: true, places: true, density: true }, missing: {} };
    // The population layers drawn: those switched on whose files are loaded.
    function pcDrawn() {
      const on = ps.pc.on;
      return { cities: on.cities && !!PN.loaded('cities'), places: on.places && !!PN.loaded('places'),
        density: on.density && !!PN.loaded('density') };
    }
    const pcAny = on => on.cities || on.places || on.density;
    // Sets the population switches from the state; a layer whose file is missing can't be switched on.
    function pcSync() {
      doc.querySelectorAll('#lk-pc-block .lk-pc-on').forEach(b => {
        b.disabled = !!ps.pc.missing[b.dataset.layer];
        b.checked = !!ps.pc.on[b.dataset.layer];
      });
    }
    // The live map's names: { min, counties } for population.names, from the result's box (or Washington's).
    function pcNames() {
      const b = ps.map && ps.map.bounds;
      if (!b) return { min: 10000 };
      const km = P().distanceKm((b[1] + b[3]) / 2, b[0], (b[1] + b[3]) / 2, b[2]);
      if (km === null || km >= W.brandedmaps.PROX_NAMES_KM) return { min: 10000 };
      const counties = host.geo.counties.features.filter(f => {
        const c = root.WSDA.branded.bounds([f]);
        return c.west < b[2] && c.east > b[0] && c.south < b[3] && c.north > b[1];
      });
      return { min: 0, counties };
    }
    // Draws the population layers and their legend on the match map.
    function pcApply() {
      if (!ps.map || ps.mapFailed) return;
      const on = pcDrawn();
      W.map.setPopulation(ps.map, { on, ramp: PN.DEFAULT_RAMP, names: pcNames() });
      W.lookupmap.setPopulationLegend(ps.map, PN.legendEntries(on, PN.DEFAULT_RAMP));
    }
    // Loads the file of one layer switched on; resolves when it is loaded or found missing.
    function pcLoad(layer) {
      return PN.load(layer, { base: '../' }).then(() => {
        if (!ps.pc.on[layer]) return;
        if (!Object.keys(ps.pc.missing).length) $('lk-pc-msg').hidden = true;
        pcApply();
      }, err => {
        if (!ps.pc.on[layer]) return;
        ps.pc.on[layer] = false;
        ps.pc.missing[layer] = true;   // grayed from now on (the message says why)
        pcSync();
        $('lk-pc-msg').textContent = err.message + ' The rest of the map is unaffected.';
        $('lk-pc-msg').hidden = false;
        pcApply();
      });
    }
    // Every layer switched on, loaded (the PNG waits for this, so it draws what the switches say).
    const pcReady = () => Promise.all(PN.LAYERS.filter(l => ps.pc.on[l] && !PN.loaded(l)).map(pcLoad));
    // Switches a population layer on or off, loading its file when it is switched on.
    function pcSet(layer, on) {
      ps.pc.on[layer] = !!on;
      pcSync();
      if (!on) { pcApply(); return; }
      pcLoad(layer);
    }
    $('lk-pc-block').addEventListener('change', e => {
      const l = e.target && e.target.dataset && e.target.dataset.layer;
      if (l) pcSet(l, e.target.checked);
    });
    pcSync();

    // ── The live map's basemap ──
    // The Maps side's list (basemaps.js: the offline county map first, then CVI's groups) and its request gate: a tile
    // basemap is fetched only once chosen, from its own hosts. When its tiles cannot be loaded, the county shapes come
    // back with a message on the live map. The branded PNG keeps its own background (Branded map options).
    const BMS = W.basemaps;
    ps.basemap = BMS.OFFLINE;
    (sel => {
      sel.appendChild(new root.Option(BMS.OFFLINE_NAME, BMS.OFFLINE));
      BMS.groups().forEach(g => {
        const og = doc.createElement('optgroup');
        og.label = g.group;
        g.items.forEach(b => og.appendChild(new root.Option(b.name, b.id)));
        sel.appendChild(og);
      });
      sel.value = BMS.OFFLINE;
    })($('lk-basemap'));
    // Puts the chosen background on the match map, with a notice if its tiles cannot be loaded.
    function basemapApply() {
      if (!ps.map || ps.mapFailed) return;
      const b = BMS.get(ps.basemap);
      ps.map.onBasemapError = got => {
        if (BMS.get(ps.basemap) !== got) return;   // an earlier choice
        const status = $('lookup-status');
        status.className = 'status warn';
        status.textContent = 'Map tiles from ' + got.provider + ' could not be loaded (no internet connection, a blocked ' +
          'network, or the provider is unavailable). The county shapes are shown instead.';
        status.hidden = false;
      };
      ps.map.onBasemapRecovered = got => { if (BMS.get(ps.basemap) === got) $('lookup-status').hidden = true; };
      W.map.setBasemap(ps.map, b);
    }
    $('lk-basemap').addEventListener('change', e => {
      const b = BMS.get(e.target.value);
      ps.basemap = b ? b.id : BMS.OFFLINE;
      $('lk-basemap-note').textContent = BMS.providerLine(b);
      $('lk-basemap-note').hidden = !b;
      if (!ps.mapFailed) $('lookup-status').hidden = true;
      basemapApply();
    });

    // ── The branded proximity PNG (brandedmaps.proximity) ──
    // Drawn from the result on screen and the choices at the click: CVI's "Branded map options" (basemap, facility
    // labels; Streets by default, as CVI's), the page's resolution and Export quality, and the population layers drawn
    // on the match map. Shown by "Preview branded map" and written into the ZIP as premise_proximity_<date>.png.
    // Streets loads its data (geo/streets-wa.js) the first time; a tile background that cannot be loaded, or Streets'
    // data, gives the Default background with a notice (as on the Maps side).
    const BM = () => W.brandedmaps, BR = () => root.WSDA.branded;
    // The branded PNG choices made in the export card.
    function pngChoices() {
      return { background: $('lk-png-background').value, quality: $('lk-png-quality').value,
        resolution: $('lk-png-resolution').value, labels: $('lk-png-labels').checked, counties: $('lk-png-counties').checked,
        population: pcAny(pcDrawn()) ? { on: pcDrawn(), ramp: PN.DEFAULT_RAMP } : null };
    }
    // Shows the quality picker, and where the tiles come from, only for a tile background.
    function syncPngControls() {
      const T = root.WSDA.tiles;
      $('lk-png-quality-field').hidden = !T.BACKGROUNDS[$('lk-png-background').value];
      $('lk-png-background-provider').textContent = T.providerLine($('lk-png-background').value);
      $('lk-png-background-provider').hidden = !$('lk-png-background-provider').textContent;
    }
    $('lk-png-background').addEventListener('change', syncPngControls);
    syncPngControls();
    let streetsLoading = null;
    // Loads the Streets data once (a failed load is tried again next time); resolves to the data or null.
    function loadStreets() {
      if (root.WSDA_STREETS) return Promise.resolve(root.WSDA_STREETS);
      if (!streetsLoading) streetsLoading = host.loadScript('../geo/streets-wa.js').then(() => root.WSDA_STREETS || null, () => null);
      return streetsLoading.then(d => { if (!d) streetsLoading = null; return d; });
    }
    // One page: res and fac the result drawn; area (a county page): { counties, title }.
    function pngBuild(res, fac, choices, background, streets, now, area) {
      const o = ps.runOpts || {};
      const only = res.status === 'facilities_only';
      return BM().proximity({ sites: res.sites, bandsMode: !!res.bandsMode, endpoint: o.endpoint || ps.endpoint,
        summary: only ? null : res.summary, siteCvis: res.siteCvis, siteOrigins: res.siteOrigins, siteDests: res.siteDests,
        matched: res.matched, filters: o.filters || { year: [], quarter: [], species: [] },
        universe: host.master() ? host.master().speciesChoices : [], facilitiesOnly: only, fac,
        labels: choices.labels, counties: host.geo.counties.features, date: now, background, streets,
        population: choices.population, area: area || ps.testArea || null });   // testArea: a test mock-up
    }
    // One page as a picture: { picture: { name, blob, alt }, notices } or { error, notices }. background: the page's
    // (a county page always Streets).
    async function pngPage(res, fac, choices, now, background, area) {
      const t0 = Date.now();
      const notices = [];
      let streets = null;
      if (background === 'vector:streets') {
        streets = await loadStreets();
        if (!streets) {
          notices.push('The Streets background could not be loaded, so the Default background was used.');
          background = 'standard';
        }
      }
      let built = pngBuild(res, fac, choices, background, streets, now, area);
      const dpi = choices.resolution === 'high' ? 300 : 200;
      const size = BR().pixelSize(dpi);
      let under = null;
      const u = built.model.underlay;
      if (u && root.WSDA.tiles.BACKGROUNDS[background]) {
        const got = await root.WSDA.tiles.load(u.key, u.extent, u.box.width * dpi / 72, u.box.height * dpi / 72,
          { zoom: u.zoom, quality: choices.quality });
        if (got) under = { image: got.image, box: u.box, mask: u.mask, how: got.how };
        else {
          notices.push('The ' + root.WSDA.tiles.BACKGROUNDS[background].label + ' background could not be loaded, so the ' +
            'Default background was used.');
          built = pngBuild(res, fac, choices, 'standard', null, now, area);
        }
      }
      const rec = { model: built.model, dpi, notices, underlay: under && { how: under.how } };
      try {
        const blob = under ? await BR().png(BR().svg(built.parts, size, { transparent: true }), size, dpi, under)
          : await BR().png(BR().svg(built.parts, size), size, dpi);
        rec.ms = Date.now() - t0;   // the time to draw, data loading included
        return { picture: { name: built.model.fileName, blob, alt: built.model.title }, notices, rec };
      } catch (e) {
        return { error: built.model.fileName + ': ' + ((e && e.message) || e), notices, rec };
      }
    }
    // County pages: one page per county holding a site, in the order the counties first appear in
    // the sites table: framed on the county with Streets, its sites only, the query (or the facilities inside) run
    // again for them with the run's settings. A site outside Washington's counties has no county page.
    function countyRuns(res) {
      const counties = host.geo.counties.features;
      const groups = new Map();
      (ps.runSites || []).forEach(site => {
        const lat = P().number(site.lat), lon = P().number(site.long);
        if (!P().usable(lat, lon)) return;
        const c = BM().siteCounty({ lat, lon }, counties);
        if (!c) return;
        if (!groups.has(c)) groups.set(c, []);
        groups.get(c).push(site);
      });
      const o = ps.runOpts || {};
      const layers = ps.runLayers || [];
      return [...groups].map(([county, sites]) => {
        let sub;
        if (res.status === 'facilities_only') {
          const prepared = P().prepareSites(sites, { defaultKm: o.defaultKm, bands: o.bands });
          sub = { status: 'facilities_only', sites: prepared.sites, bandsMode: prepared.bandsMode, matched: [] };
        } else {
          sub = query(host.master(), sites, o);
          if (sub.status !== 'ok' && sub.status !== 'no_match') {
            const prepared = P().prepareSites(sites, { defaultKm: o.defaultKm, bands: o.bands });
            sub = { status: 'facilities_only', sites: prepared.sites, bandsMode: prepared.bandsMode, matched: [] };
          }
        }
        const fac = layers.length ? facilitiesInside(sub.sites, layers) : null;
        return { county, res: sub, fac, area: { counties: [county], title: county.toUpperCase() + ' COUNTY' } };
      });
    }
    // The pictures of a click: the usual page, then (with "Also one PNG per county") each county's page, named
    // premise_proximity_<date>_<County>.png. Returns { pictures, notices, errors, counties }.
    async function pngPictures(res, choices, now) {
      const t0 = Date.now();
      const out = { pictures: [], notices: [], errors: [], counties: [] };
      const main = await pngPage(res, ps.facResult, choices, now, choices.background);
      out.notices.push(...main.notices);
      if (main.picture) out.pictures.push(main.picture); else out.errors.push(main.error);
      const recs = [main.rec];
      if (choices.counties) {
        for (const c of countyRuns(res)) {
          const made = await pngPage(c.res, c.fac, choices, now, 'vector:streets', c.area);
          made.notices.forEach(t => { if (out.notices.indexOf(t) < 0) out.notices.push(t); });
          if (made.picture) {
            made.picture.name = made.picture.name.replace(/\.png$/, '_' + c.county.replace(/[^A-Za-z0-9]+/g, '_') + '.png');
            out.pictures.push(made.picture);
            out.counties.push(c.county);
          } else out.errors.push(made.error);
          recs.push(made.rec);
        }
      }
      // Test hooks: the usual page's model, and every page's.
      ps.lastPng = Object.assign({}, main.rec, { ms: Date.now() - t0, pages: recs.map(r => r.model) });
      return out;
    }
    ps.busy = false;
    // Turns Preview and Export off while a picture is drawn, and sets the busy button's label.
    function setBusy(on, button, label) {
      ps.busy = on;
      $('lk-preview').disabled = on;
      $('lk-export').disabled = on;
      if (button) $(button).textContent = label;
    }
    $('lk-preview').addEventListener('click', async () => {
      const res = ps.result;
      if (!res || ps.busy) return;
      setBusy(true, 'lk-preview', 'Drawing…');
      try {
        await pcReady();   // the population layers switched on are drawn
        const made = await pngPictures(res, pngChoices(), new Date());
        const lines = made.notices.map(t => ({ level: 'warn', text: t }));
        made.errors.forEach(e => lines.push({ level: 'err', text: 'Preview failed: ' + e }));
        sayExport(lines);
        if (made.pictures.length) {
          ps.lastPreview = made.pictures[0];   // test hooks
          ps.lastPreviews = made.pictures;
          W.previews.showMap('Branded proximity map preview', made.pictures,
            'This is what the PNG' + (made.pictures.length > 1 ? 's' : '') + ' will look like when exported.');
        }
      } finally {
        setBusy(false, 'lk-preview', 'Preview branded map');
      }
    });

    // ── Export: one ZIP with the files ticked and export_params.json ──
    // The matched rows as CVI's Export CSV writes them (premise_lookup_matches_<date>.csv, CVI's name), the
    // facilities inside (premise_lookup_facilities_<date>.csv), the branded PNG (premise_proximity_<date>.png,
    // CVI's name), export_params.json; the folder and the ZIP named premise_lookup_<date>.
    const EX = () => W.exports;
    function sayExport(lines) { say($('lk-export-msg'), lines); }
    function formatBox(v) { return doc.querySelector('input[name=lk-format][value=' + v + ']'); }
    // Grays the export formats this result cannot give, with the reasons.
    function gateExport() {
      const res = ps.result;
      const noCvi = !res || res.status === 'facilities_only';
      const noFac = !ps.facResult;
      formatBox('matches_csv').disabled = noCvi;
      formatBox('facilities_csv').disabled = noFac;
      const reasons = [];
      if (noCvi) reasons.push('Matched CVIs: this result has no CVI match.');
      if (noFac) reasons.push('Facilities inside: no facility layer was checked in this run.');
      $('lk-export-reason').textContent = reasons.join(' ');
      $('lk-export-reason').hidden = !reasons.length;
    }
    doc.querySelectorAll('input[name=lk-format]').forEach(b => b.addEventListener('change', () => sayExport([])));
    $('lk-export').addEventListener('click', async () => {
      const res = ps.result;
      if (!res || ps.busy) return;
      const formats = ['matches_csv', 'facilities_csv', 'branded_png'].filter(v => formatBox(v).checked &&
        !formatBox(v).disabled);
      if (!formats.length) { sayExport([{ level: 'warn', text: 'Select at least one export format.' }]); return; }
      const now = new Date();
      if (formats.indexOf('branded_png') >= 0) await pcReady();   // the population layers switched on are drawn
      const choices = pngChoices();   // taken at the click
      const day = EX().localDate(now);
      const folder = 'premise_lookup_' + day;
      const files = [];
      const lines = [];
      let cvis = null;
      let countyPages = [];
      if (formats.indexOf('matches_csv') >= 0) {
        const m = EX().lookupMatchesCsv(host.master(), res);
        files.push({ name: 'premise_lookup_matches_' + day + '.csv', data: m.text });
        cvis = res.summary.cvis;
      }
      if (formats.indexOf('facilities_csv') >= 0) {
        files.push({ name: 'premise_lookup_facilities_' + day + '.csv', data: EX().lookupFacilitiesCsv(ps.facResult.rows).text });
      }
      if (formats.indexOf('branded_png') >= 0) {
        setBusy(true, 'lk-export', 'Exporting…');
        try {
          const made = await pngPictures(res, choices, now);
          made.notices.forEach(t => lines.push({ level: 'warn', text: t }));
          for (const pic of made.pictures) files.push({ name: pic.name, data: new Uint8Array(await pic.blob.arrayBuffer()) });
          made.errors.forEach(e => lines.push({ level: 'err', text: 'A branded map could not be drawn (' + e + '); the ' +
            'other files are in the ZIP.' }));
          countyPages = made.counties;
        } finally {
          setBusy(false, 'lk-export', 'Export ZIP');
        }
      }
      const o = ps.runOpts || {};
      let tableAt = 0;
      files.push({ name: 'export_params.json', data: EX().lookupParams({
        masterFile: host.masterName ? host.masterName() : '', mode: o.bands ? 'bands' : 'single',
        defaultKm: o.defaultKm, bands: o.bands || null, endpoint: o.endpoint || ps.endpoint,
        years: (o.filters && o.filters.year) || [], quarters: (o.filters && o.filters.quarter) || [],
        species: (o.filters && o.filters.species) || [],
        // Each site used, with its row of the table as it was at Run query, matched in order (so two rows with one name
        // and point keep their own bands).
        sites: res.sites.map(x => {
          const table = ps.runTable || [];
          let row = {};
          while (tableAt < table.length) {
            const t = table[tableAt++];
            if (t.name === x.name && t.lat === x.lat && t.long === x.lon) { row = t; break; }
          }
          return { name: x.name, lat: x.lat, long: x.lon, buffer_km: x.bufferUser, bands_csv: row.bands_csv || null,
            zoneFile: x.zone ? row.zoneFile || 'a file' : null };
        }),
        layers: ps.facResult ? ps.facResult.layers.map(l => l.label) : [],
        formats, counts: { cvis, facilities: ps.facResult && formats.indexOf('facilities_csv') >= 0 ? ps.facResult.total : null },
        png: choices, population: choices.population ? PN.exportParams(choices.population.on) : null, countyPages
      }, now) });
      const entries = [{ name: folder, dir: true }].concat(files.map(f => ({ name: folder + '/' + f.name, data: f.data })));
      const zipName = folder + '.zip';
      try {
        root.WSDA.sample.download(zipName, root.WSDA.sample.zip(entries, now));
      } catch (e) {
        sayExport(lines.concat([{ level: 'err', text: 'The ZIP could not be made: ' + ((e && e.message) || String(e)) }]));
        return;
      }
      ps.lastExport = { zipName, files: files.map(f => ({ name: f.name, text: typeof f.data === 'string' ? f.data : null,
        bytes: typeof f.data === 'string' ? null : f.data.length })) };   // test hook
      sayExport([{ level: 'ok', text: zipName + ' was handed to your browser to save (usually your Downloads folder).'
        + ' If no file appears, your browser or IT policy blocked the download.' }]
        .concat(lines));
    });

    // ── From ui.js ──
    function masterChanged() {
      const m = host.master();
      ps.yearChoices = m ? m.yearChoices.slice() : [];
      ps.speciesChoices = m ? m.speciesChoices.slice() : [];
      ps.years = ps.yearChoices.slice();   // CVI: every year and species group selected when a master loads
      ps.species = ps.speciesChoices.slice();
      renderFilters();
      gateRun();
      if (ps.result) {
        showResult(null);
        sayRun([]);
      }
    }
    // The tab is shown or hidden: on show the places and population layers load and the map is resized; on
    // hide, picking ends.
    function shown(on) {
      ps.shown = !!on;
      if (on) loadPlaces();
      if (on) pcReady();   // the population layers switched on (all three when the page opens)
      if (on && ps.map && !ps.mapFailed) ps.map.map.resize();
      if (!on && ps.picking) setPicking(false);
    }

    // Test hook (tests/browser/run_s11_browser.js): the sites table filled in one step, as an upload would.
    ps.testSetSites = list => { ps.sites = []; addSites(list); };

    renderFilters();
    renderSites();
    facilitiesChanged();
    return { masterChanged, facilitiesChanged, shown, state: ps };
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.lookup = { query, round2, keyOf, parsePaste, pasteMessage, makeNames, parseUpload, TEMPLATE_NAME,
    TEMPLATE_CSV, addSiteRule, editField, editCell, validateBands, prepareRun, afterRun, tiles, TABLE_COLUMNS, table,
    mapData, BAND_COLORS, MANY_SITES, placeText, facilitiesInside, facilitiesMessage, facilityCounts, facilityTable,
    FACILITY_TABLE_COLUMNS, normalizeAddress, parseGeocodeCache, findAddress, geocodeRule, init };
})(typeof window !== 'undefined' ? window : globalThis);
