/* Emergency Response: the page. Files are chosen here or sent by the landing page in memory (the per-click hand-off);
 * the shared checklist says what each file is (datasets.js). The positives, the facility layers and a zone file are
 * then read into the rules (rules.js), and the page draws what the rules give: the map (map.js), the value boxes, the
 * legend and the results tabs ("Inside the zones": one fold per layer, the "nearest" line, the left-out list; "CVI
 * movements": CVI's own Premise Lookup match, lookup.js query, loaded unchanged, over the zones), and the Export (a
 * ZIP of CSV files written with CVI's CSV writer and its formula guard, exports.js, and export_params.json).
 *
 * The sidebar has four folds: Load your data; Positives and zones (the type picker and its "?" in the fold's header,
 * the status tick boxes, the rings, "Use a zone file" (a zone file that comes with the files replaces the rings at
 * once only when the type's zones come from a file), "Add a point on the map"); Layers to check (the type's
 * suggestions ticked first); More options (basemap, neighboring regions, population, locations known only roughly).
 * After a clean load every fold is closed, so the map and the boxes are what shows first.
 *
 * Copied from site/infrastructure/app.js, v1.1: the loading (run, publish, answerHub, the hand-off and the sample
 * download), the facility files' preparation, the basemap, neighboring regions and population context controls, the
 * "?" handler. Each piece keeps its shape so a later fix to the original can be carried over. */
(function (root) {
  'use strict';
  const W = root.WSDA, profile = W.profiles.emergency, $ = id => document.getElementById(id);
  const C = root.CVIWA, M = C.map, B = C.basemaps, F = W.facilities, PN = W.population;
  const E = W.emergencyRules, T = W.emergencyTypes, EM = W.emergencyMap, Z = W.zones;
  const Lk = C.lookup, X = C.exports;
  const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
  const TABLE_ROWS = 50;   // rows shown per table; the CSV ZIP holds them all
  const state = {
    op: 0, version: 0, loading: false, republish: false, datasets: Object.create(null), source: null, banner: null,
    synthetic: false, handoffFiles: null, bundle: null,
    type: T.list()[0], typePicked: false, positivesFile: null, read: null, ticks: null, rings: null,
    zoneFile: null, useZones: false, points: [], pointsAdded: 0, picking: false,
    prepared: null, layers: Object.create(null), selectedLayers: [], includeCoarse: false, result: null,
    basemap: '', neighbors: Object.create(null), population: { on: { cities: false, places: false, density: false }, missing: {} },
    tab: 'inside', fitNext: false,
    master: null, masterReason: '', cvi: { years: [], quarters: QUARTERS.slice(), species: [] }, cviRes: null, cviKey: null
  };
  let pendingReply = null;

  // Show a status message of a kind (ok, info, warn, err) in the element with that id.
  function say(id, kind, text) {
    const el = $(id);
    el.hidden = false; el.className = 'status ' + kind; el.textContent = text;
  }
  const plural = (n, one, many) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : many);
  const listOf = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

  // ---- Loading -----------------------------------------------------------------------------------------------
  // A checklist change made while files are being applied is applied right after them, never dropped. The page
  // shows no banner: the bundle's label and date are the first of the "as of" lines.
  const checklist = W.checklist.create({ container: $('load-results'), banner: null, profile, fold: true,
    onUpdate: () => {
      if (checklist.state.busy) return;
      if (state.loading) state.republish = true;
      else publish(++state.op);
    } });

  // The synthetic sample download inside "Load your data".
  const sample = { downloads: 0 };
  document.querySelector('[data-sample=emergency]').addEventListener('click', e => {
    const b = e.currentTarget, fileName = W.samples.emergency.fileName;
    b.disabled = true;
    try {
      W.sample.download(fileName, W.sample.zip(W.samples.emergency.entries()));
      sample.downloads++;
      say('sample-status', 'ok', 'Your browser is saving ' + fileName + '. Load it under "Load your data" above.'
        + ' If no file appears, your browser or IT policy blocked the download.');
    } catch (err) {
      say('sample-status', 'err', 'The sample could not be made: ' + (err && err.message || err)
        + ' Reload the page and try again.');
    } finally {
      b.disabled = false;
    }
  });

  // Tell the landing page, once, whether the files it sent were loaded.
  function answerHub(ok, message) {
    if (!pendingReply) return;
    pendingReply({ ok, message });
    pendingReply = null;
  }

  // Applies the checklist's current result. Every way out ends the loading state; a checklist change that
  // arrived meanwhile is then applied as a new step.
  async function publish(op) {
    state.loading = true;
    try {
      return await apply(op);
    } catch (e) {
      if (op === state.op) {
        say('load-status', 'err', 'The files could not be applied: ' + e.message);
        answerHub(false, e.message);
      }
      return false;
    } finally {
      if (op === state.op) {
        state.loading = false;
        if (state.republish) {
          state.republish = false;
          publish(++state.op);
        }
      }
    }
  }

  // After a load that could not be read or checked: no files are kept, and the status says why.
  function clearLoaded(op, message, hubMessage) {
    if (op !== state.op) return;
    state.datasets = Object.create(null);
    state.version++;
    $('load-fold').open = true;
    $('load-summary').textContent = '';
    say('load-status', 'err', message);
    answerHub(false, hubMessage || message);
  }

  // What is loaded, in a few words: "positives, 4 facility files, a zone file and a CVI master".
  function loadedText(datasets) {
    const all = Object.values(datasets), parts = [];
    const facilities = all.filter(d => d.kind === 'facility').length;
    if (datasets.positives) parts.push('positives');
    if (facilities) parts.push(plural(facilities, 'facility file', 'facility files'));
    if (all.some(d => d.kind === 'zone')) parts.push('a zone file');
    if (datasets.master) parts.push('a CVI master');
    return listOf(parts);
  }

  // Keep the checklist's found files in the page, read them into the rules; true when the positives file is there.
  async function apply(op) {
    const cl = checklist.state;
    // A check still running publishes when it ends.
    if (cl.busy || !cl.load) return false;
    if (!cl.result) {
      clearLoaded(op, cl.error || 'The files could not be checked.');
      return false;
    }
    const datasets = Object.create(null), errors = [];
    const items = new Map(cl.load.items.map(i => [i.id, i]));
    for (const d of cl.result.datasets.filter(d => d.status === 'found')) {
      const it = items.get(d.fileId);
      try {
        // Files from the landing page keep their original names and paths, not the transport names.
        const original = state.source === 'hub' && state.handoffFiles && state.handoffFiles[d.id];
        const bytes = await it.read();
        const name = original ? original.name : it.name;
        const type = d.kind === 'zone' ? 'application/octet-stream' : 'text/csv';
        datasets[d.id] = { name, path: original ? original.path : it.path, file: new File([bytes], name, { type }),
          kind: d.kind };
      } catch (e) {
        errors.push(d.name + ': ' + e.message);
      }
    }
    if (op !== state.op) return false;
    const conflicts = new Set(cl.result.datasets.filter(d => d.status === 'conflict').map(d => d.id));
    const notes = await readAll(datasets, op, conflicts);
    if (op !== state.op) return false;
    state.datasets = datasets;
    state.bundle = cl.bundle && cl.bundle.found ? cl.bundle.info : (state.banner ? { label: state.banner } : null);
    state.version++;
    const ready = !!datasets.positives;
    const failed = errors.length || cl.load.errors.length;
    const what = loadedText(datasets);
    say('entry-status', ready ? 'ok' : 'warn', ready ? 'Loaded in this tab: ' + what + '.'
      : 'Add the positives file (a CSV with latitude, longitude and a status or closed column).');
    say('load-status', failed ? 'err' : ready ? 'ok' : 'warn',
      [...cl.load.errors.map(e => e.message), ...errors, ...notes].join(' ')
        || (ready ? 'Files loaded.' : 'No positives file loaded. Check Datasets below.'));
    // A clean load folds the loader away; its summary says what is loaded.
    $('load-summary').textContent = ready ? what : '';
    if (ready && !failed && !notes.length) $('load-fold').open = false;
    renderAsOf();
    state.fitNext = true;
    syncControls();
    compute();
    answerHub(ready, ready ? '' : 'No positives file could be loaded.');
    return ready;
  }

  // Read the found files into the rules: the positives, the facility layers (as Infrastructure prepares them), the
  // zone file. Returns notes about files that could not be used.
  async function readAll(datasets, op, conflicts) {
    const notes = [];
    // The positives, with the type picked from their Disease Name (unless the user picked one).
    state.positivesFile = null;
    state.read = null;
    if (datasets.positives) {
      const text = await datasets.positives.file.text();
      if (C.csv.notUtf8(text)) notes.push(C.csv.notUtf8Note(datasets.positives.name));
      const parsed = C.csv.parse(text);
      state.positivesFile = { header: parsed.header, rows: parsed.rows, name: datasets.positives.name };
      if (!state.typePicked) state.type = E.readPositives(parsed.header, parsed.rows, null).type;
      readPositives();
    }
    // The facility layers and the manifest, as Infrastructure prepares them; each point's precision columns too.
    const files = Object.create(null), precision = Object.create(null);
    let manifest = null;
    for (const [id, d] of Object.entries(datasets)) {
      if (d.kind !== 'facility' && id !== 'manifest') continue;
      const text = await d.file.text();
      if (C.csv.notUtf8(text)) notes.push(C.csv.notUtf8Note(d.file.name || id));
      const parsed = C.csv.parse(text);
      if (d.kind === 'facility') {
        files[id] = parsed;
        precision[id] = E.precisionRows(parsed.header, parsed.rows);
      } else manifest = parsed;
    }
    if (op !== state.op) return notes;
    const prepared = F.prepare(files, manifest, root.CVIWA_GEO.counties, state.version + 1);
    for (const l of prepared.layers) {
      if (!l.usable && conflicts && conflicts.has(l.key)) {
        l.reason = 'More than one file fits this layer: choose one under Datasets in "Load your data".';
      }
    }
    state.prepared = prepared;
    state.layers = Object.create(null);
    for (const l of prepared.layers.filter(x => x.usable)) {
      const prec = precision[l.key] || [];
      state.layers[l.key] = { key: l.key, label: l.liveLabel, color: l.color, shape: l.shape, layer: l,
        points: l.points.map(p => ({ name: p.name, display: p.display, lat: p.lat, lon: p.lon, county: p.county,
          town: p.townName || null, geoSource: p.geoSource, precision: prec[p.ordinal] || {} })) };
    }
    const usable = Object.keys(state.layers);
    state.selectedLayers = E.suggestedLayers(state.type, state.read ? state.read.positives : [], usable);
    // A zone file that came with the files is read; it replaces the rings at once when the type's zones come from a
    // file (zones.source "file"), else one tick does it.
    state.zoneFile = null;
    state.useZones = false;
    const zone = Object.values(datasets).find(d => d.kind === 'zone');
    if (zone) await readZoneFile(zone.file, 'bundle');
    // The CVI master (optional): read as the CVI page reads it; every year, quarter and species group ticked.
    state.master = null;
    state.masterReason = '';
    state.cviKey = null;
    if (datasets.master) {
      try {
        const m = C.master.load(await datasets.master.file.text());
        if (m.ok) state.master = m; else state.masterReason = m.error;
      } catch (e) {
        state.masterReason = e.message;
      }
    }
    if (state.master) {
      state.cvi = { years: state.master.yearChoices.slice(), quarters: QUARTERS.slice(),
        species: state.master.speciesChoices.slice() };
    }
    return notes;
  }

  // The positives read with the current type; the ticks and rings start from the type's defaults.
  function readPositives() {
    const f = state.positivesFile;
    state.read = f ? E.readPositives(f.header, f.rows, state.type) : null;
    state.ticks = state.read ? E.defaultTicks(state.type, state.read.positives) : null;
    state.rings = state.type.zones.rings.map(r => Object.assign({}, r));
  }

  // The "as of" lines: the bundle's label and date, then one line per loaded file.
  function renderAsOf() {
    const list = $('asof-lines'), lines = [];
    const b = state.bundle;
    if (b && (b.label || b.prepared)) lines.push([b.label, b.prepared ? 'as of ' + b.prepared : null].filter(Boolean).join(', '));
    for (const [id, d] of Object.entries(state.datasets)) {
      let what = '';
      if (id === 'positives' && state.read) {
        const last = E.valueBoxes(state.read, null).last.value;
        what = plural(state.read.positives.length, 'positive', 'positives') + (last ? ', as of ' + last + ' (latest detection)' : '');
      } else if (d.kind === 'facility') {
        const l = state.layers[id];
        what = l ? (l.label + ': ' + plural(l.points.length, 'site', 'sites')) : 'not usable';
      } else if (d.kind === 'zone') what = state.zoneFile ? plural(state.zoneFile.zones.length, 'zone', 'zones') : 'zone file';
      else if (id === 'manifest') what = 'list of facility layers';
      else if (id === 'master') what = 'CVI master';
      lines.push(d.name + ': ' + what);
    }
    list.replaceChildren(...lines.map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
    list.hidden = !lines.length;
  }

  // Read a new set of files (chosen here, or sent by the landing page) and check them.
  async function run(collect, payload) {
    const op = ++state.op;
    state.loading = true;
    state.banner = payload && payload.banner || null;
    state.source = payload ? 'hub' : 'direct';
    state.handoffFiles = payload && payload.datasets || null;
    say('load-status', 'info', 'Reading files…');
    $('entry-status').hidden = true;
    await checklist.clear();
    let load;
    try {
      load = await collect();
    } catch (e) {
      if (op !== state.op) return false;
      clearLoaded(op, 'The files could not be read: ' + e.message, e.message);
      if (op === state.op) {
        state.loading = false;
        state.republish = false;
      }
      return false;
    }
    if (op !== state.op) return false;
    await checklist.show(load);
    if (op !== state.op) return false;
    const bundle = checklist.state.bundle;
    // Made-up data (a bundle.json marked "synthetic", here or on the landing page).
    state.synthetic = payload ? payload.synthetic === true : !!(bundle && bundle.found && bundle.info.synthetic);
    if (payload) {
      // The landing page's mapping of facility layers outranks recognition by file name here.
      for (const [index, [id]] of Object.entries(payload.datasets || {}).entries()) {
        const item = load.items[index];
        const descriptor = checklist.state.result && checklist.state.result.datasets.find(d => d.id === id);
        if (item && descriptor && descriptor.kind === 'facility') await checklist.assign(item.id, id);
        if (op !== state.op) return false;
      }
    }
    // publish() reads the checklist as it is now, so changes made during the steps above are included.
    state.republish = false;
    return publish(op);
  }

  $('files-input').addEventListener('change', e => {
    const files = e.target.files;
    pendingReply = null;
    run(() => W.load.fromFileList(files, 'files')).then(() => { e.target.value = ''; });
  });
  $('folder-input').addEventListener('change', e => {
    const files = e.target.files;
    pendingReply = null;
    run(() => W.load.fromFileList(files, 'folder')).then(() => { e.target.value = ''; });
  });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    const dt = e.dataTransfer;
    pendingReply = null;
    run(() => W.load.fromDataTransfer(dt));
  });
  // From the keyboard the drop area opens the file chooser (it can be reached with Tab).
  drop.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    $('files-input').click();
  });
  ['dragover', 'drop'].forEach(t => root.addEventListener(t, e => e.preventDefault()));
  // Dragging files over the page opens a folded loader, so the drop zone is there to drop on.
  document.addEventListener('dragenter', e => {
    const types = e.dataTransfer ? Array.from(e.dataTransfer.types || []) : [];
    if (types.includes('Files')) $('load-fold').open = true;
  });

  // ---- Positives and zones -------------------------------------------------------------------------------------
  T.list().forEach(t => $('em-type').append(new Option(t.name, t.id)));
  // The type picker sits in the fold's header: choosing a type there does not open or close the fold.
  ['click', 'keydown'].forEach(ev => $('em-type').addEventListener(ev, e => {
    if (ev === 'click' || e.key === ' ' || e.key === 'Enter') e.stopPropagation();
  }));
  $('em-type').addEventListener('change', () => {
    state.type = T.get($('em-type').value);
    state.typePicked = true;
    readPositives();
    state.selectedLayers = E.suggestedLayers(state.type, state.read ? state.read.positives : [], Object.keys(state.layers));
    syncControls();
    compute();
  });
  // The type's "?": the reference links (each opens an outside site in a new tab) and the "examples" note. A click
  // on it opens the fold, so the note is in view.
  const EXAMPLES = 'Statuses, zones and suggested layers are examples until WSDA staff confirm them.';
  function syncTypeHelp() {
    const t = state.type;
    $('help-em-type-text').textContent = EXAMPLES + ' Reference pages:';
    $('em-type-links').replaceChildren(...t.links.map(l => {
      const li = document.createElement('li'), a = document.createElement('a');
      a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = l.label;
      li.append(a);
      return li;
    }));
    const tip = document.querySelector('button.tip[data-help="em-type"]');
    tip.title = EXAMPLES + ' Reference pages: ' + t.links.map(l => l.label).join('; ') + '.';
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button.tip[data-help]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const note = $('help-' + b.dataset.help);
    if (!note) return;
    note.hidden = !note.hidden;
    b.setAttribute('aria-expanded', String(!note.hidden));
    const fold = b.closest('details');
    if (fold && !note.hidden) fold.open = true;
  }, true);

  // The status tick boxes ("Zones around"), with each status's color and count, and "Closed positives too".
  function renderStatuses() {
    const box = $('em-statuses');
    box.replaceChildren();
    if (!state.read) { box.disabled = true; return; }
    box.disabled = false;
    for (const c of E.statusChoices(state.type, state.read.positives)) {
      const label = document.createElement('label'), input = document.createElement('input'), dot = document.createElement('span');
      input.type = 'checkbox'; input.value = c.key; input.checked = state.ticks.statuses.includes(c.key);
      input.addEventListener('change', () => {
        state.ticks.statuses = Array.from(box.querySelectorAll('input:checked')).map(i => i.value);
        compute();
      });
      dot.className = 'lg-swatch';
      dot.style.borderColor = c.color || '#636363';
      dot.style.backgroundColor = c.color || '#ffffff';
      label.append(input, dot, document.createTextNode(c.label + ' (' + c.count + ')'));
      box.append(label);
    }
    $('em-closed').checked = state.ticks.closed;
    $('em-closed').disabled = !state.read.positives.some(p => p.closed);
  }
  $('em-closed').addEventListener('change', () => {
    if (!state.ticks) return;
    state.ticks.closed = $('em-closed').checked;
    compute();
  });

  // The rings: one distance box per ring of the type, labeled with the ring's name.
  function renderRings() {
    const box = $('em-rings');
    box.replaceChildren();
    state.rings.forEach((r, k) => {
      const row = document.createElement('div'), label = document.createElement('label'), input = document.createElement('input');
      row.className = 'ring-row';
      input.type = 'number'; input.min = '0.1'; input.max = '500'; input.step = 'any'; input.id = 'em-ring-' + k;
      input.value = String(r.distance);
      label.htmlFor = input.id;
      label.textContent = r.label;
      input.addEventListener('change', () => setRing(k, input.value));
      row.append(label, input);
      box.append(row);
    });
    $('em-rings-field').hidden = !state.rings.length;
  }
  // A ring's new distance: a number above 0 and at most 500, and the rings kept in order (inner smaller).
  function setRing(k, value) {
    const v = Number(value), msg = $('em-rings-msg');
    const next = state.rings.map((r, i) => i === k ? Object.assign({}, r, { distance: v }) : r);
    const ok = Number.isFinite(v) && v > 0 && v <= 500 && next.every((r, i) => i === 0 || r.distance > next[i - 1].distance);
    if (!ok) {
      msg.hidden = false;
      msg.textContent = 'Each ring needs a distance above 0 and at most 500 km, larger than the ring inside it.';
      $('em-ring-' + k).value = String(state.rings[k].distance);
      return;
    }
    msg.hidden = true;
    state.rings = next;
    compute();
  }

  // ---- Use a zone file -----------------------------------------------------------------------------------------
  // A zone file read with shared/zones.js (GeoJSON, KML or a zipped shapefile, in longitude and latitude); from the
  // landing page's bundle or chosen here. Its zones replace the rings while "Use the file's zones" is ticked.
  async function readZoneFile(file, source) {
    try {
      const r = await Z.read(file);
      if (!r.zones.length) throw new Error('"' + file.name + '" holds no polygon zones.');
      state.zoneFile = { name: file.name, zones: r.zones, source };
      // Chosen here: used at once. Sent with the files: used when the type's zones come from a file.
      state.useZones = source === 'page' || state.type.zones.source === 'file';
      const left = r.skipped + r.broken;
      say('em-zone-status', 'ok', file.name + ': ' + plural(r.zones.length, 'zone', 'zones') + ' read'
        + (left ? '; ' + plural(left, 'shape', 'shapes') + ' left out (not usable polygons)' : '') + '.');
    } catch (e) {
      state.zoneFile = null;
      state.useZones = false;
      say('em-zone-status', 'err', e.message);
    }
  }
  $('em-zone-file').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    await readZoneFile(f, 'page');
    e.target.value = '';
    renderAsOf();
    syncControls();
    state.fitNext = true;
    compute();
  });
  $('em-use-zones').addEventListener('change', () => {
    state.useZones = $('em-use-zones').checked && !!state.zoneFile;
    syncControls();
    state.fitNext = true;
    compute();
  });

  // ---- Add a point on the map (Premise Lookup's Pick on map) ------------------------------------------------------
  // A picked point gets rings like a positive (no status, never closed); listed with a name box and a remove button.
  // Its first name, "Added point n", counts every point added, so a removed point's name is not given again.
  const POINT_NAME_MAX = 60;
  function setPicking(on) {
    state.picking = !!on;
    $('em-pick').setAttribute('aria-pressed', String(state.picking));
    EM.setPicking(state.map, state.picking, (lon, lat) => {
      const n = ++state.pointsAdded;
      state.points.push({ name: 'Added point ' + n, first: 'Added point ' + n, lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) });
      EM.setPick(state.map, [lon, lat]);
      setPicking(false);
      say('em-pick-status', 'ok', 'Added point ' + n + ' at ' + lat.toFixed(5) + ', ' + lon.toFixed(5) + '.');
      renderPoints();
      compute();
    });
    if (state.picking) say('em-pick-status', 'info', 'Click the map where the point is.');
  }
  $('em-pick').addEventListener('click', () => setPicking(!state.picking));
  // The name box: the typed name is used on the map, in the results and in the export once the box is left (or Enter
  // is pressed); an emptied box goes back to the point's first name.
  function renderPoints() {
    $('em-points').replaceChildren(...state.points.map((p, k) => {
      const li = document.createElement('li'), input = document.createElement('input'), where = document.createElement('span'),
        b = document.createElement('button');
      input.type = 'text'; input.className = 'em-point-name'; input.value = p.name; input.maxLength = POINT_NAME_MAX;
      input.setAttribute('aria-label', 'Name of ' + p.first);
      input.addEventListener('change', () => {
        const typed = input.value.replace(/\s+/g, ' ').trim().slice(0, POINT_NAME_MAX);
        p.name = typed || p.first;
        input.value = p.name;
        b.setAttribute('aria-label', 'Remove ' + p.name);
        compute();
      });
      where.className = 'muted';
      where.textContent = p.lat.toFixed(4) + ', ' + p.lon.toFixed(4);
      b.type = 'button'; b.textContent = 'Remove'; b.setAttribute('aria-label', 'Remove ' + p.name);
      b.addEventListener('click', () => {
        state.points.splice(k, 1);
        if (!state.points.length) EM.setPick(state.map, null);
        renderPoints();
        compute();
      });
      li.append(input, b, where);
      return li;
    }));
  }

  // ---- Layers to check -----------------------------------------------------------------------------------------
  // Every usable facility layer, with its mark and number of sites; the type's suggestions ticked first.
  function renderLayers() {
    const box = $('em-layers');
    box.replaceChildren();
    const usable = Object.values(state.layers);
    if (!usable.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Load facility files to check them.';
      box.append(p);
    }
    for (const l of usable) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = l.key; input.checked = state.selectedLayers.includes(l.key);
      input.addEventListener('change', () => {
        state.selectedLayers = Array.from(box.querySelectorAll('input:checked')).map(i => i.value);
        compute();
      });
      label.append(input, F.markElement(l.layer, 16), document.createTextNode(l.label + ' (' + l.points.length + ')'));
      box.append(label);
    }
    // Layers that could not be used, grayed, with the reason.
    for (const l of (state.prepared ? state.prepared.layers : []).filter(x => !x.usable && x.reason !== 'file not supplied')) {
      const label = document.createElement('label');
      label.className = 'unusable';
      label.textContent = l.liveLabel + ': ' + l.reason;
      box.append(label);
    }
  }
  $('em-layers-all').addEventListener('click', () => {
    state.selectedLayers = Object.keys(state.layers);
    renderLayers();
    compute();
  });
  $('em-layers-clear').addEventListener('click', () => {
    state.selectedLayers = [];
    renderLayers();
    compute();
  });

  // Every control from the state, after a new load, a type change or a new zone file.
  function syncControls() {
    $('em-type').value = state.type.id;
    syncTypeHelp();
    renderStatuses();
    if (state.rings) renderRings();
    $('em-use-zones').disabled = !state.zoneFile;
    $('em-use-zones').checked = state.useZones;
    $('em-rings-field').hidden = state.useZones || !state.rings || !state.rings.length;
    renderPoints();
    renderLayers();
  }

  // ---- The results: rules, map, boxes, legend --------------------------------------------------------------------
  const NO_STATUS = '#636363';
  // The positives and the added points the zones are drawn around, as the rules take them.
  function zonePositives() {
    const read = state.read;
    const list = read ? E.targets(read.positives, state.ticks) : [];
    const added = state.points.map((p, k) => ({ index: 'added-' + k, name: p.name, lat: p.lat, lon: p.lon, status: null,
      closed: false, added: true }));
    return list.concat(added);
  }

  function compute() {
    const read = state.read, targets = zonePositives();
    if (read) read.targets = targets.filter(p => !p.added);
    const zonesMode = state.useZones && !!state.zoneFile;
    const sites = zonesMode ? E.zoneSites(state.zoneFile.zones) : state.rings ? E.ringSites(targets, state.rings) : [];
    const layers = state.selectedLayers.map(k => state.layers[k]).filter(Boolean);
    state.result = sites.length || layers.length ? E.inside(sites, layers, { mode: zonesMode ? 'zones' : 'rings',
      rings: state.rings, positives: targets, includeCoarse: state.includeCoarse }) : null;
    drawMap(sites, zonesMode, targets, layers);
    renderBoxes();
    renderLegend(zonesMode);
    renderTabs();
    renderInside();
    state.cviKey = null;   // the zones or files changed: the CVI movements are worked out again when shown
    if (state.tab === 'cvi') renderCvi();
    const n = targets.length;
    $('positives-sum').textContent = !read ? '' : zonesMode ? 'zones from a file' : n.toLocaleString('en-US') + ' with zones';
    $('layers-sum').textContent = layers.length ? plural(layers.length, 'layer', 'layers') : '';
    $('em-zero').hidden = !!read;
  }

  // The map's data: the zones, the positives, and the ticked layers' sites, inside highlighted and the others faded.
  function drawMap(sites, zonesMode, targets, layers) {
    const zones = zonesMode ? EM.polygonFeatures(state.zoneFile.zones, '#cb181d') : EM.zoneFeatures(sites, state.rings);
    const withZones = new Set(targets.map(p => p.index));
    const positives = (state.read ? state.read.positives : []).map(p => ({ lat: p.lat, lon: p.lon,
      label: [p.name, p.status ? p.status.label : 'no status', p.detected, p.closed ? 'closed' : null].filter(Boolean).join(' · '),
      color: p.status ? p.status.color : NO_STATUS, closed: p.closed, withZones: withZones.has(p.index) }))
      .concat(state.points.map(p => ({ lat: p.lat, lon: p.lon, label: p.name, color: NO_STATUS, closed: false, withZones: true })));
    const r = state.result, insideKeys = new Set(), inside = [], outside = [];
    if (r) {
      for (const row of r.rows) {
        const key = row.layer + '\r' + row.lat + '\r' + row.lon + '\r' + row.name;
        if (insideKeys.has(key)) continue;
        insideKeys.add(key);
        const l = state.layers[row.layer];
        inside.push({ lat: row.lat, lon: row.lon, shape: l.shape, color: l.color,
          label: row.name + ' (' + l.label + ') · ' + E.round2(row.exactKm) + ' km from ' + row.siteName });
      }
    }
    for (const l of layers) {
      for (const p of l.points) {
        const name = p.display !== undefined ? String(p.display) : String(p.name);
        if (insideKeys.has(l.key + '\r' + p.lat + '\r' + p.lon + '\r' + name)) continue;
        outside.push({ lat: p.lat, lon: p.lon, shape: l.shape, color: l.color, label: name + ' (' + l.label + ')' });
      }
    }
    // The view: the zones' box (the rings, or the file's polygons); the positives' box when there are no zones.
    let bounds = null;
    const grow = (lon, lat) => {
      if (!bounds) bounds = [lon, lat, lon, lat];
      bounds = [Math.min(bounds[0], lon), Math.min(bounds[1], lat), Math.max(bounds[2], lon), Math.max(bounds[3], lat)];
    };
    zones.forEach(f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
      .forEach(poly => poly[0].forEach(([lon, lat]) => grow(lon, lat))));
    if (!bounds) positives.forEach(p => grow(p.lon, p.lat));
    EM.draw(state.map, { zones, positives, inside, outside, bounds }, state.fitNext);
    state.fitNext = false;
    state.mapData = { zones: zones.length, positives: positives.length, inside: inside.length, outside: outside.length };   // test hook
  }

  // The three value boxes; a value that cannot be given says what it needs, never zero.
  function renderBoxes() {
    const v = E.valueBoxes(state.read, state.result && state.result.layers.length ? state.result : null);
    const set = (id, value, note) => {
      const card = $(id);
      card.classList.toggle('na', value === null);
      card.querySelector('strong').textContent = value === null ? note : typeof value === 'number' ? value.toLocaleString('en-US') : value;
      card.querySelector('.card-note').textContent = value === null ? '' : note || '';
    };
    const fromFile = state.useZones && !!state.zoneFile;
    set('box-positives', v.positives.value, v.positives.value !== null && fromFile ? 'zones from a file' : v.positives.note);
    set('box-last', v.last.value, v.last.reason);
    set('box-inside', v.inside.value, v.inside.reason);
  }

  // The legend: the positives by status, the rings or zones, the ticked layers.
  function renderLegend(zonesMode) {
    const box = $('em-legend-content'), lines = [];
    const line = (mark, text) => { const p = document.createElement('p'); p.append(mark, document.createTextNode(text)); lines.push(p); };
    const swatch = (cls, color, fill) => {
      const s = document.createElement('span');
      s.className = cls; s.style.borderColor = color; s.style.backgroundColor = fill;
      return s;
    };
    if (state.read) {
      for (const c of E.statusChoices(state.type, state.read.positives).filter(x => x.count)) {
        line(swatch('lg-dot', c.color || NO_STATUS, c.color || NO_STATUS), c.label);
      }
      if (state.read.positives.some(p => p.closed)) line(swatch('lg-dot', NO_STATUS, '#ffffff'), 'Closed (hollow)');
    }
    if (zonesMode) {
      const z = state.zoneFile.zones;
      line(swatch('lg-ring', '#cb181d', 'rgba(203, 24, 29, 0.16)'), z.length === 1 ? z[0].name : plural(z.length, 'zone', 'zones'));
    }
    else if (state.rings && state.read) {
      state.rings.forEach(r => line(swatch('lg-ring', r.color, 'transparent'), r.label + ' (' + r.distance + ' km)'));
    }
    for (const k of state.selectedLayers) {
      const l = state.layers[k];
      if (l) line(F.markElement(l.layer, 14), l.label);
    }
    box.replaceChildren(...lines);
    $('em-legend').hidden = !lines.length;
  }

  // ---- The results tabs ------------------------------------------------------------------------------------------
  function renderTabs() {
    for (const t of ['inside', 'cvi']) {
      $('show-' + t).setAttribute('aria-pressed', String(state.tab === t));
      $('tab-' + t).hidden = state.tab !== t;
    }
  }
  document.querySelectorAll('.tool-switch [data-tab]').forEach(b => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    renderTabs();
    if (state.tab === 'cvi') renderCvi();
  }));

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  // A table of at most TABLE_ROWS rows, with a line saying how many more the CSV ZIP holds. A column with no value in
  // any row (a town column the files do not have) is left out here; the CSV keeps it.
  function tableOf(allColumns, allRows) {
    const blank = v => v === null || v === undefined || v === '';
    const keep = allColumns.map((c, j) => j === 0 || allRows.some(r => !blank(r[j])));
    const columns = allColumns.filter((c, j) => keep[j]), rows = allRows.map(r => r.filter((v, j) => keep[j]));
    const wrap = el('div', 'table-wrap'), t = el('table'), head = el('tr');
    columns.forEach(c => head.append(el('th', null, c)));
    const thead = el('thead'), body = el('tbody');
    thead.append(head);
    rows.slice(0, TABLE_ROWS).forEach(r => {
      const tr = el('tr');
      r.forEach(v => tr.append(el('td', typeof v === 'number' ? 'num' : null, v === null || v === undefined ? '' :
        typeof v === 'number' ? v.toLocaleString('en-US') : String(v))));
      body.append(tr);
    });
    t.append(thead, body);
    wrap.append(t);
    const out = [wrap];
    if (rows.length > TABLE_ROWS) {
      out.push(el('p', 'more', 'Showing the first ' + TABLE_ROWS + ' of ' + rows.length.toLocaleString('en-US') +
        '; the CSV ZIP holds them all.'));
    }
    return out;
  }
  // A count line with its layer's name in bold ("Dairies: 1 in the Infection zone").
  function countLine(s) {
    const line = E.countLine(s), at = line.indexOf(': ');
    const frag = document.createDocumentFragment();
    frag.append(el('strong', null, line.slice(0, at)), document.createTextNode(line.slice(at)));
    return frag;
  }

  // "Inside the zones": per ticked layer a fold, its count line as the header and its sites nearest first; a layer
  // with nothing inside gets its one line with the nearest site; then the sites left out, folded.
  function renderInside() {
    const box = $('tab-inside'), r = state.result;
    box.replaceChildren();
    if (!state.read) { box.append(el('p', 'muted', 'Load a positives file to see what lies inside its zones.')); return; }
    if (!r || !r.layers.length) {
      box.append(el('p', 'muted', 'Tick a layer under "Layers to check" to see its sites inside the zones.'));
      return;
    }
    const km = 'Distance (' + E.UNITS.km.label + ')';
    for (const s of r.layers) {
      if (!s.inside) {
        const p = el('p', 'result-line');
        p.append(countLine(s));
        box.append(p);
        continue;
      }
      const rows = r.rows.filter(x => x.layer === s.key)
        .sort((a, b) => a.exactKm - b.exactKm || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const d = el('details', 'em-layer'), sum = el('summary');
      d.open = true;
      d.dataset.layer = s.key;
      sum.append(countLine(s));
      // Zones from a file: a site is inside a polygon (no distance), and the zone is the site it was matched to.
      d.append(sum, ...(s.mode === 'zones'
        ? tableOf(['Site', 'Zone', 'County', 'Town'], rows.map(x => [x.name, x.zone, x.county, x.town]))
        : tableOf(['Site', km, 'Zone', 'Positive', 'County', 'Town'],
          rows.map(x => [x.name, x.km, x.zone, x.siteName, x.county, x.town]))));
      box.append(d);
    }
    if (r.leftOut.length) {
      const d = el('details', 'em-leftout'), sum = el('summary');
      sum.textContent = 'Left out: ' + plural(r.leftOut.length, 'site', 'sites') + ' located only roughly (' +
        listOf([...new Set(r.leftOut.map(x => x.reason))]) + ')';
      d.append(sum, ...tableOf(['Layer', 'Site', 'Reason', 'County', 'Town'],
        r.leftOut.map(x => [x.layerLabel, x.name, x.reason, x.county, x.town])));
      box.append(d);
    } else if (state.includeCoarse) {
      box.append(el('p', 'muted', 'Locations known only roughly are included (More options).'));
    }
  }

  // ---- CVI movements ---------------------------------------------------------------------------------------------
  // The zones as Premise Lookup's sites: one per positive with zones and added point (its rings as the bands), or the
  // zone file's polygons; then CVI's query, every endpoint counting, with the years, quarters and species ticked.
  function cviQuery() {
    const zonesMode = state.useZones && !!state.zoneFile, c = state.cvi;
    const sites = zonesMode
      ? state.zoneFile.zones.map(z => ({ name: z.name, lat: z.point[1], long: z.point[0], zone: z.geometry }))
      : zonePositives().map(p => ({ name: p.name, lat: p.lat, long: p.lon }));
    const distances = (state.rings || []).map(r => r.distance);
    const opts = { endpoint: 'either', filters: { year: c.years, quarter: c.quarters, species: c.species } };
    if (zonesMode) opts.defaultKm = 0;
    else Object.assign(opts, { defaultKm: Math.max(...distances), bands: distances });
    return Lk.query(state.master, sites, opts);
  }
  // A ticked list of the CVI tab's filters; none ticked shows no movement.
  function renderFilter(id, values, picked, key) {
    const box = $(id), legend = box.querySelector('legend');
    box.replaceChildren(legend);
    values.forEach(v => {
      const label = el('label'), input = el('input');
      input.type = 'checkbox'; input.value = String(v); input.checked = picked.includes(v);
      input.addEventListener('change', () => {
        state.cvi[key] = values.filter(x => box.querySelector('input[value="' + CSS.escape(String(x)) + '"]').checked);
        state.cviKey = null;
        renderCvi();
      });
      label.append(input, document.createTextNode(' ' + v));
      box.append(label);
    });
  }
  function renderCvi() {
    const gate = $('cvi-gate'), body = $('cvi-body');
    const reason = !state.datasets.master ? 'CVI movements need a CVI master (CVI_Consolidated_Master.csv): load it under "Load your data".'
      : !state.master ? 'The CVI master could not be read: ' + state.masterReason
        : !state.read ? 'Load a positives file first.' : null;
    gate.hidden = !reason;
    gate.textContent = reason || '';
    body.hidden = !!reason;
    if (reason) { state.cviRes = null; return; }
    const m = state.master, c = state.cvi;
    renderFilter('cvi-years', m.yearChoices, c.years, 'years');
    renderFilter('cvi-quarters', QUARTERS, c.quarters, 'quarters');
    renderFilter('cvi-species', m.speciesChoices, c.species, 'species');
    const out = $('cvi-result');
    out.replaceChildren();
    if (!c.years.length || !c.quarters.length || !c.species.length) {
      state.cviRes = null;
      out.append(el('p', 'muted', 'Tick at least one year, quarter and species group.'));
      return;
    }
    if (state.cviKey === null) { state.cviRes = cviQuery(); state.cviKey = state.version; }
    const res = state.cviRes;
    const said = {
      empty_sites: 'No zones to check: tick a status under "Positives and zones", add a point or use a zone file.',
      no_filter_match: 'No movement in the CVI master has these years, quarters and species groups.',
      missing_coord_cols: 'CVI movements need the columns ' + listOf(['Origin.Lat', 'Origin.Long', 'Dest.Lat', 'Dest.Long']) +
        ' in the CVI master.',
      no_match: 'No CVI movement left from or arrived inside the zones with these years, quarters and species groups.'
    };
    if (res.status !== 'ok') { out.append(el('p', 'result-line', said[res.status] || res.status)); return; }
    const sm = res.summary, n = x => x.toLocaleString('en-US');
    const line = el('p', 'result-line');
    line.append(el('strong', null, plural(sm.cvis, 'CVI', 'CVIs')), document.createTextNode(', ' + n(sm.animals) +
      ' animals, left from or arrived inside the zones: ' + plural(sm.origins, 'origin', 'origins') + ' and ' +
      plural(sm.dests, 'destination', 'destinations') + ' inside.'));
    out.append(line);
    const where = (r, side) => [r[side + '.County'], r[side + '.State']].filter(v => v !== null && v !== undefined && v !== '').join(', ');
    out.append(...tableOf(['CVI', 'Year', 'Quarter', 'Species group', 'Animals', 'From', 'To', 'Zones', 'Nearest (km)'],
      res.matched.map(r => [r.CVI, r['Reporting.Year'] === null ? '' : String(r['Reporting.Year']), r['Reporting.Quarter'], r['Species.Group'], r['Total.Animals'],
        where(r, 'Origin'), where(r, 'Dest'), r.matchedSites, r.nearestSiteKm])));
  }

  // ---- Export ----------------------------------------------------------------------------------------------------
  // One ZIP: positives.csv, inside_the_zones.csv, layers.csv, left_out.csv, cvi_movements.csv (with a master; CVI's
  // matched rows without any column whose name holds address, location, street or premise) and export_params.json;
  // text columns with CVI's formula guard. The folder and the ZIP are named YYYY-MM-DD_Emergency.
  function csvOf(table) {
    const types = {};
    table.columns.forEach((c, j) => {
      const v = table.rows.map(r => r[j]).find(x => x !== null && x !== undefined && x !== '');
      types[c] = typeof v === 'number' ? 'double' : 'character';
    });
    const rows = table.rows.map(r => Object.fromEntries(table.columns.map((c, j) => [c, r[j] === '' ? null : r[j]])));
    return X.csv(table.columns, rows, types, true);
  }
  $('em-export').addEventListener('click', () => {
    const now = new Date(), folder = X.localDate(now) + '_Emergency';
    if (!state.read) { say('em-export-result', 'warn', 'Load a positives file before exporting.'); return; }
    const r = state.result || { rows: [], layers: [], leftOut: [] };
    const t = E.exportRows(state.read, state.read.targets || [], r, 'km');
    const entries = [{ name: folder + '/', dir: true }], written = [];
    const add = (name, text) => { entries.push({ name: folder + '/' + name, data: text }); written.push(name); };
    add('positives.csv', csvOf(t.positives));
    add('inside_the_zones.csv', csvOf(t.inside));
    add('layers.csv', csvOf(t.layers));
    add('left_out.csv', csvOf(t.leftOut));
    if (state.master && state.read) {
      if (state.cviKey === null) { state.cviRes = cviQuery(); state.cviKey = state.version; }
      const header = state.master.header.filter(h => !E.PRIVATE.test(h));
      add('cvi_movements.csv', X.lookupMatchesCsv({ header, rows: state.master.rows }, state.cviRes).text);
    }
    const zonesMode = state.useZones && !!state.zoneFile;
    const params = {
      tool: 'emergency_response',
      emergency_type: state.type.name,
      positives_file: state.datasets.positives ? state.datasets.positives.name : '',
      zones: zonesMode ? 'zone file ' + state.zoneFile.name : 'rings ' + state.rings.map(x => x.label + ' ' + x.distance + ' km').join(', '),
      statuses_with_zones: state.ticks.statuses.map(k => k === 'none' ? 'No status' : k),
      closed_with_zones: state.ticks.closed,
      added_points: state.points.map(p => p.name + ' (' + p.lat + ', ' + p.lon + ')'),
      layers_checked: state.selectedLayers.map(k => state.layers[k] ? state.layers[k].label : k),
      locations_known_only_roughly: state.includeCoarse ? 'included' : 'left out',
      cvi_master: state.datasets.master ? state.datasets.master.name : null,
      cvi_years: state.master ? state.cvi.years : null,
      cvi_quarters: state.master ? state.cvi.quarters : null,
      cvi_species_groups: state.master ? state.cvi.species : null,
      positives: state.read.positives.length,
      sites_inside: r.total || 0,
      distances: 'km, on a sphere of 6,378,137 m (CVI\'s rule)',
      exported_at: X.localTime(now)
    };
    if (state.synthetic) params.data_note = X.SYNTHETIC_NOTE;
    add('export_params.json', X.jsonObject(params));
    try {
      W.sample.download(folder + '.zip', W.sample.zip(entries, now));
      const res = X.exportResult(folder + '.zip', written, [], []);
      say('em-export-result', 'ok', res.lines[0] + ' Files: ' + written.join(', ') + '.');
      state.exported = (state.exported || 0) + 1;   // test hook
      state.lastExport = entries;                   // test hook
    } catch (e) {
      say('em-export-result', 'err', 'The export could not be made: ' + e.message);
    }
  });

  // ---- The map and More options (copied from Infrastructure) -----------------------------------------------------
  state.prepared = F.prepare(Object.create(null), null, root.CVIWA_GEO.counties, 0);
  state.map = EM.create('em-map', root.CVIWA_GEO, () => compute(),
    () => say('em-zero', 'err', 'The map could not be drawn. Reload the page to try again.'));
  state.map.notify = msg => say('screenshot-status', 'info', msg);
  state.map.shotName = 'Emergency';   // the camera picture's name
  // After a basemap change: redraw, and say so when the basemap failed and the offline map is shown.
  function basemapChanged() {
    compute();
    const failed = state.map.basemapFailed;
    $('basemap-status').hidden = !failed;
    if (failed) {
      $('basemap-status').querySelector('span').textContent =
        'The selected basemap could not load. The offline county map is shown; the positives and zones remain.';
    }
  }
  state.map.onBasemapError = basemapChanged;
  state.map.onBasemapRecovered = basemapChanged;
  state.map.map.on('style.load', () => { if (state.map.ready) basemapChanged(); });

  B.LIST.forEach(b => {
    let group = $('em-basemap').querySelector('optgroup[label="' + b.group + '"]');
    if (!group) {
      group = document.createElement('optgroup');
      group.label = b.group;
      $('em-basemap').append(group);
    }
    group.append(new Option(b.name, b.id));
  });
  $('em-basemap').prepend(new Option('Offline county map', ''));
  $('em-basemap').value = '';   // the picker opens on the offline map it draws
  // Switch the map to a basemap (empty: the offline county map) and show its note.
  function setBasemap(value) {
    $('basemap-status').hidden = true;
    state.basemap = value;
    $('em-basemap').value = value;
    const b = B.get(value);
    $('basemap-note').textContent = b ? B.providerLine(b) : 'Offline county map: no provider requests.';
    M.setBasemap(state.map, b);
    compute();
  }
  $('em-basemap').addEventListener('change', () => setBasemap($('em-basemap').value));
  $('offline-back').addEventListener('click', () => setBasemap(''));
  $('basemap-note').textContent = 'Offline county map: no provider requests.';

  // Neighboring regions: context outlines only, off when the page opens; counties hidden until the region is on.
  W.regions.list().forEach(e => {
    const row = document.createElement('div'), label = document.createElement('label'), on = document.createElement('input');
    row.className = 'nr-row';
    const sub = document.createElement('label'), counties = document.createElement('input');
    on.type = counties.type = 'checkbox';
    on.className = 'nr-on'; counties.className = 'nr-counties';
    on.dataset.region = counties.dataset.region = e.id;
    sub.className = 'nr-sub'; sub.hidden = true;
    label.append(on, document.createTextNode(' ' + e.name));
    sub.append(counties, document.createTextNode(' ' + e.countiesLabel));
    row.append(label, sub);
    $('neighbor-controls').append(row);
    state.neighbors[e.id] = { on: false, counties: false };
    const apply = () => {
      const d = W.regions.loaded(e.id), s = state.neighbors[e.id];
      if (d) M.setNeighbor(state.map, d, s.on, s.counties);
      compute();
    };
    on.addEventListener('change', () => {
      const s = state.neighbors[e.id];
      s.on = on.checked; s.counties = false; counties.checked = false; sub.hidden = !s.on;
      if (!s.on) { apply(); return; }
      W.regions.load(e.id, { base: '../' }).then(() => {
        if (state.neighbors[e.id].on) { $('neighbor-status').hidden = true; apply(); }
      }, err => {
        if (!state.neighbors[e.id].on) return;
        state.neighbors[e.id] = { on: false, counties: false };
        on.checked = false; counties.checked = false; sub.hidden = true;
        apply();
        say('neighbor-status', 'warn', err.message + ' The rest of the map is unaffected.');
      });
    });
    counties.addEventListener('change', () => {
      state.neighbors[e.id].counties = counties.checked && state.neighbors[e.id].on;
      apply();
    });
  });

  // Population context (shared/population.js): three switches, all off when the page opens; a layer's file loads the
  // first time its switch is turned on, and a file that cannot be loaded leaves its switch grayed with the message.
  function pcSync() {
    const pop = state.population;
    document.querySelectorAll('#pc-block .pc-on').forEach(b => {
      b.disabled = !!pop.missing[b.dataset.layer];
      b.checked = !!pop.on[b.dataset.layer];
    });
    const on = { cities: pop.on.cities && !!PN.loaded('cities'), places: pop.on.places && !!PN.loaded('places'),
      density: pop.on.density && !!PN.loaded('density') };
    M.setPopulation(state.map, { on, ramp: PN.DEFAULT_RAMP, names: { min: 10000 } });
  }
  function pcSet(layer, on) {
    const pop = state.population;
    pop.on[layer] = !!on;
    if (!on) { pcSync(); return; }
    PN.load(layer, { base: '../' }).then(() => {
      if (!pop.on[layer]) return;
      $('pc-msg').hidden = !Object.keys(pop.missing).length;
      pcSync();
    }, err => {
      if (!pop.on[layer]) return;
      pop.on[layer] = false;
      pop.missing[layer] = true;
      say('pc-msg', 'err', err.message + ' The rest of the map is unaffected.');
      pcSync();
    });
  }
  $('pc-block').addEventListener('change', e => {
    const l = e.target && e.target.dataset && e.target.dataset.layer;
    if (l) pcSet(l, e.target.checked);
  });

  // Locations known only roughly (located only to a town, or a location precision, match or premises type RAD does
  // not use for zones) are left out of the zone results unless this is ticked.
  $('em-coarse').addEventListener('change', () => {
    state.includeCoarse = $('em-coarse').checked;
    compute();
  });

  // On a narrow screen the legend starts folded, so it does not cover the map.
  if (root.innerWidth < 768) $('em-legend').open = false;
  syncControls();
  root.WSDA.emergency = { state, checklist, sample, run, compute };

  // Files from the landing page arrive in memory through the per-click hand-off; a local choice made first wins.
  let sentNothing = false;   // opened from the landing page with nothing loaded there
  const waiting = W.load.handoff.receive(profile.id, (payload, reply) => {
    if (payload.empty) {
      if (state.op > 0) return;
      sentNothing = true;
      say('load-status', 'warn', 'Nothing has been loaded on the landing page yet. Load your files there and click ' +
        'Open Emergency Response, or load files here.');
      return;
    }
    if (state.op > 0) {
      reply({ ok: false, message: 'Files were chosen in Emergency Response while files from the landing page were on their way; the local files are kept. Click Open Emergency Response again to resend.' });
      return;
    }
    pendingReply = reply;
    if (payload.error) {
      say('load-status', 'err', 'Files could not be sent from the landing page: ' + payload.error
        + ' Load files here or open Emergency Response from the landing page again.');
      reply({ ok: false, message: payload.error });
      pendingReply = null;
      return;
    }
    const supplied = Object.values(payload.datasets || {});
    const files = supplied.map(d => new File([d.file], d.name, { type: d.file.type || 'text/csv' }));
    run(async () => {
      const load = await W.load.fromFileList(files, 'files');
      load.items.forEach((item, index) => { item.path = supplied[index].path; });
      return load;
    }, payload);
  });
  const hubMessage = 'Files are kept in memory only. If the landing page is closed or unavailable, load files here or open Emergency Response from the landing page again.';
  if (waiting) {
    say('load-status', 'info', 'Waiting for files from the landing page…');
    root.setTimeout(() => {
      if (!state.version && !state.loading && !sentNothing) say('load-status', 'warn', hubMessage);
    }, 10000);
  } else if (/[?&]handoff=/.test(root.location.search)) {
    say('load-status', 'warn', hubMessage);
  }
})(window);
