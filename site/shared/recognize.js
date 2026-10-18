/* Dataset recognition (F1). Decides which of the user's files is which dataset of a profile's dataset list
 * (e.g. site/cvi/datasets.js), using only the files' header rows. Nothing leaves the browser.
 *
 * Order, for each CSV file:
 *   0. The user's own pick in the page (opts.assign: file path -> dataset id, from the
 *      "which layer is this file?" picker for unclear files), when the file has the dataset's columns.
 *   1. bundle.json "files" entry (dataset id -> file name), when given: that file is that dataset if it has the
 *      dataset's columns.
 *   2. Columns: the datasets whose required columns are all present.
 *   3. Tie-break by recommended file name (case-insensitive), then by the dataset's own name column (facility
 *      layers). Facility layers share generic columns, so an unclear name leaves the file "not used" with a plain
 *      reason.
 * A manifest dataset, once found, is expanded by the profile (extra facility layers) and
 * recognition runs again over the expanded list. Two files claiming one dataset are a conflict the user resolves
 * (opts.choices: dataset id -> file id). A user's pick outranks bundle.json, which outranks columns and names;
 * a bundle.json entry naming an unsuitable file never blocks another file.
 * Files are identified by the loader's item id (paths can repeat). Header rows are read from the first bytes of
 * a file only (at most 1 MB); UTF-16 files and semicolon/tab-separated files get a plain "save as CSV" reason.
 *
 * recognize(items, profile, { assign, files, choices, cache }) -> Promise<{ datasets, files, needsChoice, manifest }>
 *   assign: file id -> dataset id (the user's picks);  files: dataset id -> file name (bundle.json)
 *   cache: optional Map kept by the caller for one load, so reruns (picks, choices) do not read files again.
 *   Only own keys of these objects count (a dataset id such as "constructor" never matches an inherited property).
 *   A bundle.json entry naming an unknown dataset, or a dataset whose columns the file lacks, is reported on that file
 *   (warning, or the reason if nothing else fits) and the file is still recognized by columns and names.
 *   datasets: [{ id, name, required, kind, group, fromManifest, status: 'found'|'missing'|'conflict', path, fileId,
 *                item, header, missingUseful, options: [{ id, path }] }]
 *             options: the equally ranked files competing for the dataset (also kept after the user's choice, so the
 *             page can offer them again).
 *   files:    [{ id, path, name, status: 'used'|'not-used'|'conflict'|'bundle', dataset, reason, warning, via, candidates,
 *                layers }]
 *             candidates: dataset ids the page may offer in its picker when the file could be several datasets.
 *             layers: facility layer ids the file could be (its columns fit); the page's "change layer" dropdown
 *             offers them when there is more than one. */
(function (root) {
  'use strict';
  const HEAD_BYTES = 64 * 1024, MAX_HEADER_BYTES = 1024 * 1024, MAX_MANIFEST_BYTES = 1024 * 1024;

  /** RFC 4180 CSV: quoted fields (embedded commas, quotes, newlines), CRLF or LF, UTF-8 BOM dropped, unquoted
   * fields trimmed. Returns rows of strings; stops after maxRows when given. */
  function parseCsv(text, maxRows) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [], n = text.length;
    let row = [], i = 0;
    if (!n) return rows;
    while (i <= n) {
      let cell;
      if (text[i] === '"') {
        let buf = ''; i++;
        while (i < n) {
          if (text[i] === '"') { if (text[i + 1] === '"') { buf += '"'; i += 2; continue; } i++; break; }
          buf += text[i++];
        }
        while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') buf += text[i++];
        cell = buf;
      } else {
        let j = i;
        while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++;
        cell = text.slice(i, j).trim(); i = j;
      }
      row.push(cell);
      if (i >= n) { rows.push(row); break; }
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '\r' && text[i + 1] === '\n') i++;
      i++; rows.push(row); row = [];
      if (maxRows && rows.length >= maxRows) break;
      if (i >= n) break;
    }
    return rows;
  }

  /** End of the first CSV record (index of its line break outside quotes), or -1. */
  function firstRecordEnd(text) {
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') q = !q;
      else if (!q && (c === '\n' || c === '\r')) return i;
    }
    return -1;
  }

  const lower = s => String(s).trim().toLowerCase();
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
  const extOf = name => { const m = /\.([^./]+)$/.exec(name); return m ? m[1].toLowerCase() : ''; };
  // R's make.names() form, case-insensitive: read.csv turns "USDA Slaughter Facility" into USDA.Slaughter.Facility
  // and "123 Name" into X123.Name. Not modeled: R's reserved words and locale letters (non-ASCII become ".").
  const rName = s => { const r = lower(s).replace(/[^a-z0-9._]/g, '.'); return /^([a-z]|\.(?![0-9]))/.test(r) ? r : 'x' + r; };
  const listOf = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

  // The header column a column spec names (a name, or the first of its anyOf spellings found), or null.
  function findColumn(header, spec) {
    if (typeof spec === 'string') return header.indexOf(spec) >= 0 ? spec : null;
    for (const a of spec.anyOf) {
      const hit = header.find(h => (spec.caseless ? h.toLowerCase() : h) === a); if (hit !== undefined) return hit;
    }
    return null;
  }
  const specLabel = s => typeof s === 'string' ? s : s.label;
  const missingColumns = (header, ds) => ds.columns.filter(c => findColumn(header, c) === null).map(specLabel);
  const hasNameColumn = (header, col) => header.some(h => rName(h) === rName(col));
  // True when a file's name, its path or the end of its path is the given file name (case ignored).
  function fileMatches(rec, value) {
    const v = lower(value);
    if (!v) return false;
    const p = lower(rec.path).replace(/ › /g, '/');
    return lower(rec.name) === v || p === v || p.endsWith('/' + v);
  }

  class HeaderError extends Error {}

  /** The header row, read from the first 64 KB (then up to 1 MB) of the file, never the whole file. */
  async function readHeader(item) {
    const read = n => item.head ? item.head(n) : item.text().then(t => t.slice(0, n));
    let text = await read(HEAD_BYTES), end = firstRecordEnd(text);
    if (end < 0 && item.size > HEAD_BYTES) { text = await read(MAX_HEADER_BYTES); end = firstRecordEnd(text); }
    if (end < 0 && item.size > MAX_HEADER_BYTES) throw new HeaderError(
      'its first row is longer than 1 MB, so it is not a table this page can read');
    const line = end < 0 ? text : text.slice(0, end);
    if (line.indexOf('\u0000') >= 0 || line.startsWith('\uFFFD\uFFFD')) {   // NUL bytes, or a UTF-16 byte-order mark
      throw new HeaderError('it is saved as UTF-16 ("Unicode text"); save it as "CSV UTF-8" or plain CSV');
    }
    const first = parseCsv(line, 1)[0] || [];
    if (first.length === 1) {
      const sep = line.indexOf('\t') >= 0 ? 'tabs' : line.indexOf(';') >= 0 ? 'semicolons' : null;
      if (sep) throw new HeaderError(`its columns are separated by ${sep}; save it as a comma-separated CSV file`);
    }
    return first.length === 1 && first[0] === '' ? [] : first;
  }

  /** Classifies one supplied file before matching. */
  async function inspect(item, profile, k) {
    const rec = { item, id: item.id || 'r' + k, path: item.path, name: item.name, status: 'not-used', dataset: null,
      reason: null, header: null };
    const ext = extOf(item.name);
    if (lower(item.name) === 'bundle.json') { rec.status = 'bundle'; return rec; }
    if (ext === 'csv') {
      if (!item.size) { rec.reason = 'the file is empty'; return rec; }
      try { rec.header = await readHeader(item); }
      catch (e) { rec.reason = e instanceof HeaderError ? e.message : 'the file could not be read: ' + e.message; return rec; }
      if (!rec.header.length) rec.reason = 'the file has no header row';
      return rec;
    }
    // Stub for later profiles: GeoJSON map layers are read by the Emergency profile, not yet available.
    if (ext === 'geojson') rec.reason = `GeoJSON map layers are not used by the ${profile.name} dashboard`;
    else if (ext === 'json') rec.reason =
      `only bundle.json is read; other JSON files are not used by the ${profile.name} dashboard`;
    else if (ext === 'xlsx' || ext === 'xls') rec.reason = 'Excel workbooks are not read; save the sheet as a CSV file';
    else rec.reason = 'not a CSV file';
    return rec;
  }

  // A reason for a file that nearly fits a dataset (named like it, or with most of its columns), or null.
  function nearMiss(rec, dsList) {
    for (const ds of dsList) {
      const miss = missingColumns(rec.header, ds);
      if (!miss.length) continue;
      if (ds.kind === 'facility') {
        if (fileMatches(rec, ds.file)) return `it is named like the ${ds.name} file but has no ${listOf(miss)}`;
        continue;
      }
      const present = ds.columns.length - miss.length;
      if (fileMatches(rec, ds.file) || (ds.columns.length >= 4 && present * 2 >= ds.columns.length))
        return `it looks like the ${ds.name} but is missing ${miss.length === 1 ? 'the column' : 'the columns'} ${listOf(miss)}`;
    }
    return null;
  }

  const MAX_NAMED = 5;          // file names spelled out in an "unclear" reason; the picker lists every layer
  // The reason for a file that fits several datasets; for facility layers, the file names that would settle it.
  function unclear(cands) {
    const fac = cands.filter(d => d.kind === 'facility');
    if (fac.length === cands.length) {
      const shown = fac.slice(0, MAX_NAMED).map(d => `${d.file} (${d.name})`);
      const names = fac.length > MAX_NAMED ? shown.join(', ') + ` or one of ${fac.length - MAX_NAMED} more`
        : listOf(shown).replace(/ and ([^,]*)$/, ' or $1');
      return 'it looks like a facility layer, but its name does not say which one. Choose the layer, rename it to ' +
        names + ', or name it in bundle.json';
    }
    return `it matches more than one dataset (${listOf(cands.map(d => d.name))}); choose which, or name it in bundle.json`;
  }

  /** One matching pass over the CSV records for a given dataset list. Mutates the records; returns dataset results. */
  const RANK = { 'your choice': 2, 'bundle.json': 1 };
  // A claim's rank: the user's pick, then bundle.json, then columns and names.
  const rankOf = r => RANK[r.via] || 0;

  /** Facility layers a file could be: those whose columns it has, narrowed to the ones whose own name column it has
   * when there are any (the same narrowing as for unclear files). Offered by the page's "change layer" dropdown. */
  function facilityLayers(header, dsList) {
    const fit = dsList.filter(d => d.kind === 'facility' && !missingColumns(header, d).length);
    const byCol = fit.filter(d => d.nameColumn && hasNameColumn(header, d.nameColumn));
    return (byCol.length ? byCol : fit).map(d => d.id);
  }

  // The matching pass described above RANK.
  function assign(recs, dsList, picks, mapping, choices, profile) {
    const csv = recs.filter(r => r.header && r.header.length);
    const claims = new Map(dsList.map(d => [d.id, []]));
    const claim = (rec, ds) => {      // the layer a file is used as is always among its layers
      if (ds.kind === 'facility' && !rec.layers.includes(ds.id))
        rec.layers = dsList.filter(d => d.id === ds.id || rec.layers.includes(d.id)).map(d => d.id);
      claims.get(ds.id).push(rec);
    };
    for (const rec of csv) {
      rec.status = 'not-used'; rec.dataset = null; rec.reason = null; rec.via = null; rec.candidates = null;
      rec.layers = facilityLayers(rec.header, dsList);
      rec.warning = null;
      const pickedId = own(picks, rec.id);
      if (pickedId) {
        const ds = dsList.find(d => d.id === pickedId);
        const miss = ds ? missingColumns(rec.header, ds) : [];
        if (ds && !miss.length) { rec.via = 'your choice'; claim(rec, ds); continue; }
        if (ds) { rec.reason = `you chose the ${ds.name}, but it has no ${listOf(miss)}`; continue; }
      }
      // bundle.json entry: used when it fits; otherwise reported and the file is still recognized below.
      const mappedId = Object.keys(mapping).find(id => fileMatches(rec, mapping[id]));
      let mapIssue = null;
      if (mappedId) {
        const ds = dsList.find(d => d.id === mappedId);
        const miss = ds ? missingColumns(rec.header, ds) : null;
        if (ds && !miss.length) { rec.via = 'bundle.json'; claim(rec, ds); continue; }
        mapIssue = ds ? `bundle.json names it as the ${ds.name}, but it has no ${listOf(miss)}`
          : `bundle.json names it as "${mappedId}", which is not a ${profile.name} dataset`;
      }
      let pick = dsList.filter(d => !missingColumns(rec.header, d).length);
      if (!pick.length) {
        rec.reason = mapIssue || nearMiss(rec, dsList) || `its columns do not match any ${profile.name} dataset`;
        continue;
      }
      rec.warning = mapIssue;
      // Facility layers are recognized by generic coordinate columns that any table with coordinates also has; a file
      // with every column of a table dataset is that table, whatever its extra columns or name. It gets no
      // "change layer" dropdown; the user's pick and bundle.json (above) still outrank this.
      if (pick.length > 1 && pick.some(d => d.kind === 'table')) {
        pick = pick.filter(d => d.kind !== 'facility'); rec.layers = [];
      }
      if (pick.length > 1) {
        const byName = pick.filter(d => fileMatches(rec, d.file));
        if (byName.length) { pick = byName; rec.via = 'name'; }
      }
      if (pick.length > 1) {
        const byCol = pick.filter(d => d.nameColumn && hasNameColumn(rec.header, d.nameColumn));
        if (byCol.length === 1) { pick = byCol; rec.via = 'name column'; }
        else if (byCol.length > 1) pick = byCol;
      }
      if (pick.length !== 1) { rec.via = null; rec.reason = unclear(pick); rec.candidates = pick.map(d => d.id); continue; }
      if (mapIssue) rec.warning = mapIssue + `; it was recognized as the ${pick[0].name} instead`;
      rec.via = rec.via || 'columns';
      claim(rec, pick[0]);
    }

    return dsList.map(ds => {
      const c = claims.get(ds.id);
      const out = { id: ds.id, name: ds.name, required: ds.required, kind: ds.kind, group: ds.group || null,
        fromManifest: !!ds.fromManifest, file: ds.file, status: 'missing', path: null, fileId: null, item: null, header: null,
        missingUseful: [], options: [] };
      let winner = null;
      const topRank = Math.max(-1, ...c.map(rankOf)), top = c.filter(r => rankOf(r) === topRank);
      if (top.length === 1) winner = top[0];
      else if (top.length > 1 && own(choices, ds.id)) winner = top.find(r => r.id === own(choices, ds.id)) || null;
      for (const r of c) if (r !== winner && !(top.length > 1 && !winner && top.includes(r))) {
        const w = winner || top[0];
        r.reason = rankOf(w) > rankOf(r)
          ? (w.via === 'your choice' ? `you chose "${w.name}" as the ${ds.name}`
            : `bundle.json names "${w.name}" as the ${ds.name}`)
          : `another file was chosen as the ${ds.name}`;
      }
      if (winner) {
        winner.status = 'used'; winner.dataset = ds.id; winner.reason = null;
        Object.assign(out, { status: 'found', path: winner.path, fileId: winner.id, item: winner.item, header: winner.header,
          missingUseful: (ds.useful || []).filter(u => u.columns.some(col => winner.header.indexOf(col) < 0)) });
      } else if (top.length > 1) {
        for (const r of top) {
          r.status = 'conflict'; r.dataset = ds.id; r.reason = `more than one file could be the ${ds.name}; choose one`;
        }
        out.status = 'conflict';
      }
      if (top.length > 1) out.options = top.map(r => ({ id: r.id, path: r.path }));
      return out;
    });
  }

  // The profile's datasets with the manifest's overrides applied and its added layers after them.
  function effectiveList(profile, expansion) {
    const list = profile.datasets.map(d => Object.assign({}, d));
    if (!expansion) return list;
    for (const d of list) {
      const o = expansion.overrides[d.id];
      if (o) Object.assign(d, { file: o.file, nameColumn: o.nameColumn, name: o.name, group: o.group });
    }
    return list.concat(expansion.added);
  }

  async function recognize(items, profile, opts) {
    opts = opts || {};
    const picks = opts.assign || {}, mapping = opts.files || {}, choices = opts.choices || {}, cache = opts.cache || null;
    const recs = [];
    for (let k = 0; k < items.length; k++) {
      const key = 'inspect:' + (items[k].id || 'r' + k);
      let base = cache && cache.get(key);
      if (!base) {
        const r = await inspect(items[k], profile, k); base = { status: r.status, reason: r.reason, header: r.header };
        if (cache) cache.set(key, base);
      }
      recs.push({ item: items[k], id: items[k].id || 'r' + k, path: items[k].path, name: items[k].name, dataset: null,
        status: base.status, reason: base.reason, header: base.header });
    }

    let datasets = assign(recs, effectiveList(profile, null), picks, mapping, choices, profile);
    let manifest = null;
    const man = datasets.find(d => d.kind === 'manifest' && d.status === 'found');
    if (man && profile.expandManifest) {
      let rows = null;
      if (man.item.size > MAX_MANIFEST_BYTES) manifest = { path: man.path,
        error: 'the manifest is larger than 1 MB, so its extra layers were not added' };
      else {
        const key = 'manifest:' + man.fileId;
        try { rows = (cache && cache.get(key)) || parseCsv(await man.item.text()); if (cache) cache.set(key, rows); }
        catch (e) { manifest = { path: man.path, error: e.message }; }
      }
      if (rows) {
        const exp = profile.expandManifest(rows);
        manifest = { path: man.path, added: exp.added.map(d => d.id), overridden: Object.keys(exp.overrides),
          skipped: exp.skipped, notes: exp.notes || [] };
        datasets = assign(recs, effectiveList(profile, exp), picks, mapping, choices, profile);
      }
    }
    const files = recs.map(r => ({ id: r.id, path: r.path, name: r.name, status: r.status, dataset: r.dataset, reason: r.reason,
      warning: r.warning || null, via: r.via || null, candidates: r.candidates || null, layers: r.layers || [] }));
    const needsChoice = datasets.filter(d => d.status === 'conflict')
      .map(d => ({ dataset: d.id, name: d.name, options: d.options }));
    return { profile: profile.id, datasets, files, needsChoice, manifest };
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.recognize = { recognize, parseCsv, readHeader, HEAD_BYTES };
})(typeof window !== 'undefined' ? window : globalThis);
