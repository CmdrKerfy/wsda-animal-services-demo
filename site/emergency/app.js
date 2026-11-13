/* Emergency Response: the page. Files are chosen here or sent by the landing page in memory (the per-click hand-off);
 * the shared checklist says what each file is (datasets.js). The positives, the facility layers, a zone file and the
 * CVI master are read into the rules (rules.js), and the page draws what the rules give.
 *
 * What it draws: the value boxes and the lines under them; then, under the "Map | Overview | Report" switch, either the map
 * (map.js), its legend and the two result tabs ("Inside the zones": the "Zones" list, one fold per layer, the "nearest"
 * line, the rows not mapped; "CVI movements": CVI's own Premise Lookup match, lookup.js query, loaded unchanged, over
 * the zones), or the Overview (its three boxes, "Columns by", "Positives over time" from chart.js, the bars by county
 * and by layer, the counties and positives tables), or the Report (2.9: the update's pages, report-view.js, from the
 * whole file on the report's date, beside the form; or its "Figures", page 1's figures on screen, report-figures.js).
 * Each new set of files opens on the Map, every fold closed.
 *
 * The sidebar's five folds: Load your data; Positives and zones (the type, the status ticks, the "Animals" ticks and
 * "Refine by species", the time views "On a day" and "Between dates" with the play, "Show closed positives", the rings
 * and km | miles, "Rings | Zones | Both", a zone file, an added point, "Draw a zone" with draw.js); Layers to check
 * (the shared list with "Filter by attributes"); More options (basemap, neighboring regions, population, locations
 * known only roughly); Export & Preview (the ZIP of CSV files written with CVI's CSV writer, exports.js, with
 * zones.geojson and export_params.json; the map picture drawn by branded.js, with its Preview in CVI's window,
 * previews.js).
 *
 * Copied from site/infrastructure/app.js, v1.1: the loading (run, publish, answerHub, the hand-off and the sample
 * download), the facility files' preparation, the basemap, neighboring regions and population context controls, the
 * "?" handler; from site/infrastructure/app.js, v2.0: the map picture's background, quality and tile loading; from
 * site/cvi/app/ui.js, v2.0: the chart's hover box (showTip). Each piece keeps its shape so a later fix to the
 * original can be carried over.
 *
 * Two reads of the positives file: state.readAll, the whole file, read by the loaded-file line, the suggested layers,
 * the file's window, the animal ticks and their counts, "Refine by species" and the names a drawn zone may not take;
 * state.read, the kinds of animal ticked and the species picked (rules.js byAnimals), read by everything else. Neither is
 * written into after it is made: what the page works out from them (the positives with zones, the results) is kept
 * in state beside them. */
(function (root) {
  'use strict';
  const W = root.WSDA, profile = W.profiles.emergency, $ = id => document.getElementById(id);
  const C = root.CVIWA, M = C.map, B = C.basemaps, F = W.facilities, PN = W.population;
  const E = W.emergencyRules, T = W.emergencyTypes, EM = W.emergencyMap, Z = W.zones;
  const Lk = C.lookup, X = C.exports;
  // A type file with a slip is not used (2.8): the page says so in red over the sidebar's folds, naming the file and,
  // when types.js refused its type, the field (types.js problems). A type file index.html lists that never reached
  // types.js could not be read at all. Shown first, so it stands whatever the rest of the page then does.
  (function typeProblems() {
    const said = T.problems().map(p => 'The emergency type file "' + (p.file || 'types/') + '" was not used. ' + p.message + '.');
    const reached = T.files();
    document.querySelectorAll('script[src^="types/"]').forEach(s => {
      const file = s.getAttribute('src');
      if (!reached.includes(file)) {
        said.push('The emergency type file "' + file + '" could not be read: a typing slip in it, such as quotes made curly'
          + ' or a missing comma or bracket, or the file is missing.');
      }
    });
    if (!said.length) return;
    const box = $('em-type-problems');
    box.replaceChildren(...said.map(t => {
      const p = document.createElement('p');
      p.textContent = t;
      return p;
    }));
    // Where to read how: the how-to page (changing-kinds.html), also as plain text beside it.
    const how = document.createElement('p'), a = document.createElement('a');
    a.href = 'changing-kinds.html'; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Changing the kinds of animals';
    how.append(a, ' (also as CHANGING_THE_KINDS_OF_ANIMALS.txt in site/emergency) says how to find and fix it.');
    box.append(how);
    box.hidden = false;
  })();
  const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
  const TABLE_ROWS = 50;   // rows shown per table; the CSV ZIP holds them all
  const state = {
    op: 0, version: 0, loading: false, republish: false, datasets: Object.create(null), source: null, banner: null,
    synthetic: false, handoffFiles: null, bundle: null,
    type: T.list()[0], typePicked: false, positivesFile: null, read: null, ticks: null, rings: null, animals: [], species: [],
    unit: 'km', unitPicked: false, ringBase: null, pastRings: false,
    fileWindow: null, window: null, steps: { by: null, steps: [] }, stepAt: 0, picked: null, playing: false, playTimer: null,
    opening: null, views: null, viewKind: 'day', chartSteps: { by: null, steps: [] }, today: null,
    days: null,
    zoneFile: null, show: 'rings', points: [], pointsAdded: 0, picking: false,
    drawn: [], drawnCount: 0, drawShape: 'freehand', zonesVersion: 0, ringGuide: false,
    prepared: null, precision: Object.create(null), attributes: Object.create(null),
    layers: Object.create(null), selectedLayers: [], includeCoarse: false, result: null, targets: [],
    nameLayers: ['positives'],   // 2.4: the names on the map picture ("Name markers in PNG"), the positives' by default
    basemap: '', neighbors: Object.create(null), population: { on: { cities: false, places: false, density: false }, missing: {} },
    populationFor: null,   // the positives file the population layers were last turned on for (its path, name and size)
    tab: 'inside', view: 'map', fitNext: false, columnsBy: 'status',
    reportDate: null,   // 2.9: the Report's date, picked on the page (today until then)
    reportText: null,   // 2.9: the Report form's words and choices (report-form.js), for the type loaded
    reportTexts: Object.create(null),   // 2.9: each other type's report text, kept by its id while another is loaded
    reportMode: 'fill',   // 2.9: the Report view's "Figures | Fill in", Fill in until Figures is picked
    master: null, masterReason: '', cvi: { years: [], quarters: QUARTERS.slice(), species: [], rawSpecies: [], end: 'either' }, cviRes: null,
    cviKey: null,
    cviOn: false   // 2.6: the tick "CVI movements", off at every load
  };
  let pendingReply = null;
  W.emergencyIcons.fill();   // the time views' pin and span (icons.js)

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
        // With every type file left out (the red notice says why), no file can be read: said so, not the error.
        say('load-status', 'err', !T.list().length ? 'The files could not be applied: no emergency type could be read (see the red notice above).'
          : 'The files could not be applied: ' + e.message);
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
    state.populationFor = null;
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
    setSum('load-summary', ready ? what : '');
    if (ready && !failed && !notes.length) $('load-fold').open = false;
    // Each new set of files opens on the Map, as CVI opens on its maps: the zones and layers chosen there feed the Overview.
    // Figures' county or month picked and its map's look start again too.
    state.view = 'map';
    W.emergencyReportFigures.reset();
    renderAsOf();
    state.fitNext = true;
    // The population layers are on after each load of a positives file, so a lone positive does not open on empty
    // gray land (2.4). Only a new positives file turns them on: adding a facility layer or a zone file to the same one
    // keeps the layers as the user left them.
    const positivesKey = ready ? [datasets.positives.path || '', datasets.positives.name, datasets.positives.file.size].join('|') : null;
    if (ready && positivesKey !== state.populationFor) {
      ['cities', 'places', 'density'].forEach(l => { if (!state.population.missing[l]) pcSet(l, true); });
    }
    state.populationFor = positivesKey;
    syncControls();
    compute();
    answerHub(ready, ready ? '' : 'No positives file could be loaded.');
    return ready;
  }

  // Every usable facility layer through the shared select with the attribute picks (only the matching points), in
  // the rules' shape (rules.js layersOf); the ticks then say which of them are checked.
  const layersNow = () => E.layersOf(F.select(state.prepared, {
    layers: state.prepared.layers.filter(l => l.usable).map(l => l.key), attributes: state.attributes }), state.precision);

  // Read the found files into the rules: the positives, the facility layers (as Infrastructure prepares them), the
  // zone file. Returns notes about files that could not be used.
  async function readAll(datasets, op, conflicts) {
    const notes = [];
    // The positives, with the type picked from their Disease Name (unless the user picked one).
    state.positivesFile = null;
    state.read = null;
    state.readAll = null;
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
    state.precision = precision;
    state.attributes = Object.create(null);   // 2.8: the attribute picks, cleared at each load
    state.closeFolds = true;                  // and the layers' filter folds closed (renderLayers)
    state.layers = layersNow();
    const usable = Object.keys(state.layers);
    state.selectedLayers = E.suggestedLayers(state.type, state.readAll ? state.readAll.positives : [], usable);
    state.layerOrder = layerOrderOf(state.selectedLayers);
    // A zone file that came with the files is read; it replaces the rings at once when the type's zones come from a
    // file (zones.source "file"), else one tick does it.
    clearZoneFile();
    const zone = Object.values(datasets).find(d => d.kind === 'zone');
    if (zone) await readZoneFile(zone.file, 'bundle');
    // The CVI master (optional): read as the CVI page reads it; every year, quarter and species group ticked.
    state.master = null;
    state.masterReason = '';
    state.cviKey = null;
    state.cviOn = false;
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
        species: state.master.speciesChoices.slice(), rawSpecies: [], end: 'either' };
    }
    // 2.8: "Refine by species" closed with none ticked, the movement's end Either, at each load (as the animal ticks).
    $('cvi-refine').open = false;
    $('cvi-refine-search').value = '';
    document.querySelector('input[name="cvi-end"][value="either"]').checked = true;
    return notes;
  }

  // The positives read with the current type; the ticks, the rings and the unit start from the type's defaults (a
  // unit picked on the page is kept), and the window spans every readable detection. Every kind of animal is ticked
  // again (2.7): state.readAll is the whole file, state.read the kinds ticked, which every view reads.
  function readPositives() {
    const f = state.positivesFile;
    stopPlay();
    state.readAll = f ? E.readPositives(f.header, f.rows, state.type, todayIso()) : null;
    state.animals = state.readAll ? E.animalKindsOf(state.readAll).map(k => k.key) : [];
    state.species = [];   // "Refine by species" (2.8): none ticked, every species of the kinds ticked
    $('em-refine').open = false;   // and closed with its search box empty, as the CVI tab's
    $('em-refine-search').value = '';
    state.columnsBy = 'status';   // the Overview's "Columns by" (2.8): Status again at each load
    state.read = state.readAll ? E.byAnimals(state.readAll, state.animals, state.species) : null;
    state.ticks = state.read ? E.defaultTicks(state.type, state.readAll.positives) : null;
    if (!state.unitPicked) state.unit = state.type.zones.unit;
    state.ringBase = { unit: state.type.zones.unit, distances: state.type.zones.rings.map(r => r.distance) };
    state.rings = state.type.zones.rings.map(r => Object.assign({}, r));
    state.rings = ringsIn(state.unit);
    state.fileWindow = state.readAll ? E.windowOf(state.readAll.positives) : null;
    openViews();
  }

  // The "as of" lines: the bundle's label and date, then one line per loaded file.
  function renderAsOf() {
    const list = $('asof-lines'), lines = [];
    const b = state.bundle;
    if (b && (b.label || b.prepared)) lines.push([b.label, b.prepared ? 'as of ' + b.prepared : null].filter(Boolean).join(', '));
    for (const [id, d] of Object.entries(state.datasets)) {
      let what = '';
      if (id === 'positives' && state.readAll) {
        const last = E.valueBoxes(state.readAll, null).last.value;
        what = plural(state.readAll.positives.length, 'positive', 'positives') + (last ? ', as of ' + last + ' (latest detection)' : '');
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
    // A new set of files picks its type again: a type picked for the earlier files does not carry over.
    state.typePicked = false;
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
    // A zone file sent with the files is used when the new type's zones come from a file (one chosen here stays).
    if (state.zoneFile && state.zoneFile.source !== 'page') {
      state.show = state.type.zones.source === 'file' ? (state.show === 'both' ? 'both' : 'zones') : E.showOf(state.show, [], state.drawn);
    }
    readPositives();
    state.selectedLayers = E.suggestedLayers(state.type, state.readAll ? state.readAll.positives : [], Object.keys(state.layers));
    state.layerOrder = layerOrderOf(state.selectedLayers);
    syncControls();
    compute();
  });
  // The type's "?": the reference links (each opens an outside site in a new tab) and the "examples" note. A click
  // on it opens the fold, so the note is in view.
  const EXAMPLES = 'Statuses, zones and suggested layers are examples until WSDA staff confirm them.';
  // Said when a positive is closed by its status without a close date: it closes on its release date (2.5); with
  // neither date, or with a release date after today, the page cannot place it in time (rules.js closedDayNotKnown).
  const BY_RELEASE = 'A positive closed by its status, with no readable close date, closes on its quarantine release date.';
  const NO_CLOSE_DAY = 'A positive closed by its status, with no readable close or release date, shows as closed on every'
    + ' day: the page cannot tell when it closed.';
  const LATER_RELEASE = 'A positive closed by its status, with a release date after today, shows as closed on every day:'
    + ' that date cannot be when it closed.';
  function syncTypeHelp() {
    const t = state.type;
    const read = state.read;
    const byStatus = read ? read.positives.filter(p => p.closed && !p.closedDate) : [];
    const byRelease = byStatus.some(p => p.quarantine && !p.releaseAfterToday);
    const noDay = byStatus.some(p => !p.quarantine), later = byStatus.some(p => p.releaseAfterToday);
    const said = EXAMPLES + (byRelease ? ' ' + BY_RELEASE : '') + (noDay ? ' ' + NO_CLOSE_DAY : '')
      + (later ? ' ' + LATER_RELEASE : '');
    $('help-em-type-text').textContent = said + ' Reference pages:';
    $('em-type-links').replaceChildren(...t.links.map(l => {
      const li = document.createElement('li'), a = document.createElement('a');
      a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = l.label;
      li.append(a);
      return li;
    }));
    const tip = document.querySelector('button.tip[data-help="em-type"]');
    tip.title = said + ' Reference pages: ' + t.links.map(l => l.label).join('; ') + '.';
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

  // The status tick boxes ("Zones around"), with each status's color and count: only the statuses the file has, and
  // none when the file has no status column (every positive then takes the type's first status). Then "Show closed
  // positives" and its folded "Closed zones" (the tick On a day only; 2.5).
  function renderStatuses() {
    const box = $('em-statuses');
    box.replaceChildren();
    $('em-statuses-field').hidden = !state.read || !state.read.columns.status;
    const past = $('em-past');
    past.disabled = !state.read || !state.read.positives.some(p => p.closedDate || p.closed);
    past.checked = !!state.ticks && state.ticks.pastShown;
    $('em-past-fold').hidden = !closedShown() || past.disabled;
    $('em-past-rings').checked = state.pastRings;
    $('em-past-rings').disabled = shown() === 'zones';
    if (!state.read) { box.disabled = true; return; }
    box.disabled = false;
    for (const c of E.statusChoices(state.type, state.read.positives).filter(x => x.count)) {
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
  }
  // "Animals" (2.7): one tick per kind among the file's positives, with its mark's shape and count, below "Zones
  // around"; none with one kind. The kinds and counts are the whole file's, its rows not mapped too; a positive naming
  // two kinds counts under both (2.8). An unticked kind's positives leave every view (rules.js byAnimals); unticking
  // every kind says to tick one. With species ticked in "Refine by species" (2.8), the white tag names them instead of
  // the kinds: "Harbor seal only", "Chicken, Turkey and Duck only", "Chicken, Turkey, Duck and 2 more only",
  // '"Cattle, Chicken" only'.
  const fileRows = () => state.readAll.positives.concat(state.readAll.dropped || []);
  const noAnimals = () => !!state.readAll && E.animalKindsOf(state.readAll).length > 1 && !state.animals.length;
  // A species naming a comma is quoted, as the line under the boxes quotes it: '"Cattle, Chicken" and Chicken'.
  const speciesWords = list => {
    const names = list.map(x => (x.includes(',') ? '"' + x + '"' : x));
    return names.length <= 3 ? listOf(names) : names.slice(0, 3).join(', ') + ' and ' + (names.length - 3) + ' more';
  };
  const animalsOnly = () => (!state.readAll ? null : state.species.length ? speciesWords(state.species)
    : E.animalsOnly(state.type, fileRows(), state.animals));
  // The read after a change of the ticks or the species picked: the views take in the positives shown.
  function refilter() {
    state.read = E.byAnimals(state.readAll, state.animals, state.species);
    state.fitNext = true;
    renderStatuses();
    renderBadges();
    compute();
  }
  function renderAnimals() {
    const box = $('em-animals'), all = state.readAll;
    const kinds = all ? E.animalKindsOf(all) : [];
    box.replaceChildren();
    $('em-animals-field').hidden = kinds.length < 2;
    $('em-animals-msg').hidden = !noAnimals();
    if (kinds.length < 2) { renderRefine(); return; }   // the species list goes too (a file with one kind after two)
    for (const k of kinds) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = k.key; input.checked = state.animals.includes(k.key);
      input.addEventListener('change', () => {
        stopPlay();
        state.animals = Array.from(box.querySelectorAll('input:checked')).map(i => i.value);
        $('em-animals-msg').hidden = !noAnimals();
        // A species picked under a kind now unticked drops out (one under another kind still ticked stays).
        const offered = new Set(E.speciesList(all, state.animals).flatMap(g => g.species.map(x => x.name)));
        state.species = state.species.filter(x => offered.has(x));
        refilter();
        renderRefine();
      });
      const n = fileRows().filter(p => E.kindKeysOf(state.type, p).includes(k.key)).length;
      label.append(input, animalMark(k.shape), document.createTextNode(k.label + ' (' + n.toLocaleString('en-US') + ')'));
      box.append(label);
    }
    renderRefine();
  }
  // "Refine by species" (2.8, as CVI's; closed at each load): under the "Animals" ticks, every species of the kinds
  // ticked under its kind's mark and name, each with its positives and animals (rules.js speciesList, the whole
  // file's). None ticked: every species of the kinds ticked; ticked: only those, everywhere. A species naming two
  // kinds is listed under each, its two ticks one pick. Past 30 species a search box narrows the list (the picks kept).
  const SPECIES_SEARCH = 30;
  function renderRefine() {
    const fold = $('em-refine'), list = $('em-refine-list'), all = state.readAll;
    const groups = all && E.animalKindsOf(all).length > 1 ? E.speciesList(all, state.animals) : [];
    const names = [...new Set(groups.flatMap(g => g.species.map(x => x.name)))];
    fold.hidden = !names.length;
    $('em-refine-sum').textContent = state.species.length ? ' (' + state.species.length + ' ticked)' : '';
    const search = $('em-refine-search');
    search.hidden = names.length <= SPECIES_SEARCH;
    if (search.hidden) search.value = '';
    const find = search.value.trim().toLowerCase();
    list.replaceChildren();
    for (const g of groups) {
      const shown = g.species.filter(x => !find || x.name.toLowerCase().includes(find));
      if (!shown.length) continue;
      const head = el('div', 'refine-kind');   // a heading over the species, not a sentence
      head.append(animalMark(g.shape), document.createTextNode(g.label));
      const box = el('div', 'checklist');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', g.label + ': species');
      for (const x of shown) {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'checkbox'; input.value = x.name; input.checked = state.species.includes(x.name);
        input.addEventListener('change', () => {
          stopPlay();
          state.species = input.checked ? state.species.concat(x.name) : state.species.filter(y => y !== x.name);
          refilter();
          renderRefine();
        });
        label.append(input, document.createTextNode(x.name + ' \u2014 ' + x.text));
        box.append(label);
      }
      list.append(head, box);
    }
    if (find && !list.children.length) list.append(el('p', 'help-note', 'No species matches "' + search.value.trim() + '".'));
  }
  $('em-refine-search').addEventListener('input', renderRefine);
  // Closed positives are hidden at first On a day (always drawn Between dates); shown, they are faded and hollow, and
  // "Draw their rings" (in "Closed zones") draws their rings gray and dashed. They never get zones that count.
  $('em-past').addEventListener('change', () => {
    if (!state.ticks) return;
    state.ticks.pastShown = $('em-past').checked;
    $('em-past-fold').hidden = !closedShown();
    state.fitNext = true;   // the view takes them in, or lets them go
    compute();
  });
  $('em-past-rings').addEventListener('change', () => {
    state.pastRings = $('em-past-rings').checked;
    state.fitNext = true;
    compute();
  });

  // ---- The two time views and the play (2.5) ------------------------------------------------------------------
  // "On a day" (the pin): one date, every positive active on it whatever its detection date (the window from the
  // file's first detection to the day); "Between dates" (the span): every positive detected between two dates, active
  // and closed, both always drawn. After a load the page opens On a day on today, and Between dates from the first
  // detection to today (rules.js openingViews); each view keeps its own dates when the switch goes back and forth.
  // state.window is the view shown (rules.js dayView or rangeView), so every rule that takes a window takes it.
  // state.today is a test hook: a fixed "today" (YYYY-MM-DD) for the suites (the Chrome suite sets
  // WSDA_EMERGENCY_TODAY before the page loads), else the computer's own date.
  function todayIso() {
    if (state.today || root.WSDA_EMERGENCY_TODAY) return state.today || root.WSDA_EMERGENCY_TODAY;
    const d = new Date(), two = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }
  // After a load: the opening views, the chart's columns (to today) and the play's steps.
  function openViews() {
    const today = todayIso();
    state.opening = E.openingViews(state.fileWindow, today);
    state.views = state.opening ? { day: state.opening.day, range: state.opening.range } : null;
    state.viewKind = 'day';
    state.window = state.views ? state.views.day : null;
    state.chartSteps = E.playSteps(E.chartSpan(state.fileWindow, today));
    state.picked = null;   // no chart column is picked
    setSteps();
  }
  // The play's steps for the view as it now is (rules.js viewSteps); the step shown is the view's last.
  function setSteps() {
    state.steps = E.viewSteps(state.chartSteps, state.window);
    syncStep();
  }
  // The view shown changed: kept as that view's dates, the steps worked out again, the view fitted once.
  function showWindow(next) {
    state.window = next;
    state.views[state.viewKind] = next;
    $('em-window-msg').hidden = true;
    setSteps();
    state.fitNext = true;
    renderWindow();
    compute();
  }
  function renderWindow() {
    const fw = state.fileWindow, win = state.window;
    $('em-window-field').hidden = !fw;
    renderBadges();
    if (!fw) return;
    const day = state.viewKind === 'day', last = todayIso() > fw.end ? todayIso() : fw.end;
    $('em-view-day').setAttribute('aria-pressed', String(day));
    $('em-view-range').setAttribute('aria-pressed', String(!day));
    $('em-day-row').hidden = !day;
    $('em-range-row').hidden = day;
    // "Show closed positives" in On a day only: Between dates always draws the closed positives.
    $('em-past-label').hidden = !day;
    $('em-past-fold').hidden = !closedShown() || $('em-past').disabled;
    $('em-day').max = last;
    $('em-day').value = state.views.day.end;
    for (const [id, key] of [['em-from', 'start'], ['em-to', 'end']]) {
      const input = $(id);
      input.min = fw.start;
      input.max = last;
      input.value = state.views.range[key];
    }
    if (win) renderPlay();
  }
  // The badge at the map's top center and above the Overview: the pin and the day, or the span and the two dates;
  // with a kind of animal left out (2.7), a white tag after them ("Cattle only").
  function renderBadges() {
    const win = state.read ? state.window : null, only = animalsOnly();
    for (const id of ['em-badge', 'ov-badge']) {
      const b = $(id);
      b.hidden = !win;
      if (!win) continue;
      b.innerHTML = W.emergencyIcons.svg(win.view === 'range' ? 'span' : 'pin') + '<span>' + E.viewBadge(win) + '</span>';
      if (only) b.append(el('span', 'only-tag', only + ' only'));
    }
  }
  // The closed positives are drawn: always Between dates; On a day when "Show closed positives" is ticked.
  const closedShown = () => !!state.ticks && (state.viewKind === 'range' || state.ticks.pastShown);
  function setView(kind) {
    if (!state.views || kind === state.viewKind) return;
    stopPlay();
    state.viewKind = kind;
    state.picked = null;
    showWindow(state.views[kind]);
  }
  $('em-view-day').addEventListener('click', () => setView('day'));
  $('em-view-range').addEventListener('click', () => setView('range'));
  // The day typed; a cleared box goes back to today.
  function setDay(value) {
    if (!state.fileWindow) return;
    stopPlay();
    state.picked = null;
    showWindow(E.dayView(state.fileWindow, value || state.opening.day.end));
  }
  $('em-day').addEventListener('change', () => setDay($('em-day').value));
  // A date of Between dates typed; a cleared box goes back to its opening date.
  function setWindow(key, value) {
    if (!state.fileWindow) return;
    stopPlay();
    const range = state.views.range;
    const next = E.rangeView(key === 'start' ? value || state.opening.range.start : range.start,
      key === 'end' ? value || state.opening.range.end : range.end);
    if (next.start > next.end) {
      const msg = $('em-window-msg');
      msg.hidden = false;
      msg.textContent = 'The first date needs to be on or before the second.';
      renderWindow();
      return;
    }
    state.picked = null;
    showWindow(next);
  }
  $('em-from').addEventListener('change', () => setWindow('start', $('em-from').value));
  $('em-to').addEventListener('change', () => setWindow('end', $('em-to').value));

  // The play: the view's steps (rules.js viewSteps: the chart's weeks, or months over more than 26 weeks), one step a
  // second. On a day it moves the day from the file's first week to the day picked: the outbreak as it stood each
  // week. Between dates it grows the range from its first date to its second, one step at a time. It stops at the
  // end (no loop) and pauses on Pause, on the slider, on a date box or on the switch. While it plays, the CVI
  // movements wait and the view stays still (the map would jump each second); it fits once when the play stops.
  const PLAY_MS = 1000;
  function renderPlay() {
    const s = state.steps, n = s.steps.length;
    const button = $('em-play'), slider = $('em-step');
    button.textContent = state.playing ? 'Pause' : s.by === 'month' ? 'Play by month' : 'Play by week';
    button.setAttribute('aria-pressed', String(state.playing));
    button.disabled = n < 2;
    slider.disabled = n < 2;
    slider.max = String(Math.max(0, n - 1));
    slider.value = String(state.stepAt);
    slider.setAttribute('aria-label', s.by === 'month' ? 'Month of' : 'Week of');
    // Where the step is: "Sep 5, 2026 · week 8 of 12" On a day, "Up to Sep 5, 2026 · week 8 of 12" Between dates.
    const said = n ? (state.viewKind === 'range' ? 'Up to ' : '') + E.dayLabel(state.window.end) + ' · ' + s.by + ' ' +
      (state.stepAt + 1) + ' of ' + n : '';
    $('em-step-label').textContent = said;
    slider.setAttribute('aria-valuetext', said);
  }
  // The step whose end is the first on or after the view's end.
  function syncStep() {
    const steps = state.steps.steps, i = state.window ? steps.findIndex(x => x.end >= state.window.end) : -1;
    state.stepAt = i < 0 ? Math.max(0, steps.length - 1) : i;
  }
  // A step of the play or the slider: the view's end moves to the step's end; its steps stay as they were set.
  function goStep(i) {
    const step = state.steps.steps[i];
    if (!step) return;
    state.stepAt = i;
    state.picked = null;   // the slider or the play moves the day's line; no chart column stays picked
    state.window = Object.assign({}, state.window, { end: step.end });
    state.views[state.viewKind] = state.window;
    $('em-window-msg').hidden = true;
    renderWindow();
    compute();
  }
  function advance() {
    if (!state.playing) return;
    goStep(state.stepAt + 1);
    state.stepMs = state.computeMs;   // test hook: this step's redraw (the stop's own, with the CVI movements, comes after)
    if (state.stepAt >= state.steps.steps.length - 1) { stopPlay(true); return; }
    state.playTimer = root.setTimeout(advance, PLAY_MS);
  }
  function startPlay() {
    const steps = state.steps.steps;
    if (steps.length < 2) return;
    if (state.stepAt >= steps.length - 1) state.stepAt = -1;   // from the first step
    state.playing = true;
    advance();
  }
  // Stops the play. With redraw (the Pause button, the play's end) the CVI movements are worked out for the date
  // shown: the map's CVI premises come back, or the tab; every other caller redraws everything itself right after.
  function stopPlay(redraw) {
    if (!state.playing) return;
    root.clearTimeout(state.playTimer);
    state.playing = false;
    state.playTimer = null;
    renderPlay();
    if (redraw && cviOn()) compute();
    else if (redraw && state.tab === 'cvi') renderCvi();
    fitShown();
  }
  // Fits the view to what is drawn now, or when the Map is next shown.
  function fitShown() {
    state.fitNext = true;
    if (state.view !== 'map' || !state.map || !state.map.ready || state.map.failed) return;
    EM.fit(state.map);
    state.fitNext = false;
  }
  $('em-play').addEventListener('click', () => (state.playing ? stopPlay(true) : startPlay()));
  // The slider's value is read before the play stops (stopping redraws the slider at the step shown).
  let slideTimer = null;
  $('em-step').addEventListener('input', () => {
    const i = Number($('em-step').value);
    slidAt = Date.now();
    state.sliding = true;   // 2.6: the map's CVI premises wait until the slider rests
    root.clearTimeout(slideTimer);
    slideTimer = root.setTimeout(() => { slideTimer = null; state.sliding = false; if (cviOn()) compute(); }, PEOPLE_IDLE_MS);
    stopPlay();
    goStep(i);
  });

  // ---- The rings and the km | miles switch ---------------------------------------------------------------------
  // The rings' distances in a unit: the distances as last typed (or the type's) in their own unit, else turned from
  // them exactly (rules.js toKm and fromKm), so switching back and forth never moves a ring. The boxes show two
  // decimals; the exact distance is kept.
  function ringsIn(unit) {
    const b = state.ringBase;
    return state.rings.map((r, k) => Object.assign({}, r, { distance: unit === b.unit ? b.distances[k]
      : E.fromKm(E.toKm(b.distances[k], b.unit), unit) }));
  }
  const unitWord = unit => (unit === 'mi' ? 'miles' : 'km');
  const shownDistance = d => String(Number(d.toFixed(2)));
  // A ring's distance as the legend and the hover show it: "1.86 mi".
  const ringDistance = r => shownDistance(r.distance) + ' ' + E.UNITS[state.unit].label;
  function syncUnit() {
    for (const u of ['km', 'mi']) $('em-unit-' + u).setAttribute('aria-pressed', String(state.unit === u));
  }
  function setUnit(unit) {
    if (unit === state.unit) return;
    state.unit = unit;
    state.unitPicked = true;
    if (state.rings) state.rings = ringsIn(unit);
    $('em-rings-msg').hidden = true;
    syncUnit();
    if (state.rings) renderRings();
    compute();
    syncShapes();
    renderDrawn();
    draw.refresh();
  }
  document.querySelectorAll('.unit-switch [data-unit]').forEach(b => b.addEventListener('click', () => setUnit(b.dataset.unit)));

  // The rings: one distance box per ring of the type, labeled with the ring's name.
  function renderRings() {
    const box = $('em-rings');
    box.replaceChildren();
    state.rings.forEach((r, k) => {
      const row = document.createElement('div'), label = document.createElement('label'), input = document.createElement('input');
      row.className = 'ring-row';
      input.type = 'number'; input.min = '0.1'; input.max = '500'; input.step = 'any'; input.id = 'em-ring-' + k;
      input.value = shownDistance(r.distance);
      label.htmlFor = input.id;
      label.textContent = r.label;
      input.addEventListener('change', () => setRing(k, input.value));
      row.append(label, input);
      box.append(row);
    });
    $('em-rings-field').hidden = !state.rings.length;
  }
  // A ring's new distance, in the unit shown: a number above 0 and at most 500, and the rings kept in order (inner
  // smaller). The typed distances become the ones the unit switch turns from.
  function setRing(k, value) {
    const v = Number(value), msg = $('em-rings-msg');
    const next = state.rings.map((r, i) => i === k ? Object.assign({}, r, { distance: v }) : r);
    const ok = Number.isFinite(v) && v > 0 && v <= 500 && next.every((r, i) => i === 0 || r.distance > next[i - 1].distance);
    if (!ok) {
      msg.hidden = false;
      msg.textContent = 'Each ring needs a distance above 0 and at most 500 ' + unitWord(state.unit) +
        ', larger than the ring inside it.';
      $('em-ring-' + k).value = shownDistance(state.rings[k].distance);
      return;
    }
    msg.hidden = true;
    state.rings = next;
    state.ringBase = { unit: state.unit, distances: next.map(r => r.distance) };
    compute();
  }

  // ---- The zone set: a zone file's zones and the zones drawn on the map ------------------------------------------
  // One set (rules.js zoneSet: the file's zones first), shown by the switch "Rings | Zones | Both" (3b): in the rings'
  // place, with them, or not at all (rules.js showOf: Rings while no zone exists). zonesVersion counts every change of
  // its shapes (the Overview's people are kept for it).
  const fileZones = () => (state.zoneFile ? state.zoneFile.zones : []);
  const allZones = () => E.zoneSet(fileZones(), state.drawn);
  const shown = () => E.showOf(state.show, fileZones(), state.drawn);
  // The fold's summary and the positives box's note: "zones from a file", "2 drawn zones", "1 zone from a file and 2
  // drawn".
  function zonesWords() {
    const f = fileZones().length, d = state.drawn.length;
    if (!d) return 'zones from a file';
    return f ? plural(f, 'zone from a file', 'zones from a file') + ' and ' + d + ' drawn' : plural(d, 'drawn zone', 'drawn zones');
  }
  // The zone file gone (a new set of files, or one that could not be read): the drawn zones stay shown if they were.
  function clearZoneFile() {
    state.zoneFile = null;
    state.show = E.showAfter('file cleared', { show: state.show, fileZones: [], drawn: state.drawn });
    state.zonesVersion++;
  }

  // ---- Use a zone file -----------------------------------------------------------------------------------------
  // A zone file read with shared/zones.js (GeoJSON, KML or a zipped shapefile, in longitude and latitude); from the
  // landing page's bundle or chosen here, shown as the switch "Rings | Zones | Both" says.
  async function readZoneFile(file, source) {
    try {
      const r = await Z.read(file);
      if (!r.zones.length) throw new Error('"' + file.name + '" holds no polygon zones.');
      state.zoneFile = { name: file.name, zones: r.zones, source };
      state.zonesVersion++;
      // Chosen here, or sent with the files for a type whose zones come from a file: shown at once (on Rings, Zones;
      // rules.js showAfter). Otherwise sent with the files: shown when the drawn zones already were.
      state.show = source === 'page' || state.type.zones.source === 'file'
        ? E.showAfter('file', { show: state.show, fileZones: r.zones, drawn: state.drawn }) : E.showOf(state.show, [], state.drawn);
      const left = r.skipped + r.broken;
      // A name a drawn zone has too (a reopened Export's zones.geojson): the counts are kept by name, so it is said.
      const twice = r.zones.map(z => z.name).filter(n => state.drawn.some(d => d.name === n));
      say('em-zone-status', twice.length ? 'warn' : 'ok', file.name + ': ' + plural(r.zones.length, 'zone', 'zones') + ' read'
        + (left ? '; ' + plural(left, 'shape', 'shapes') + ' left out (not usable polygons)' : '') + '.'
        + (twice.length ? ' A drawn zone has the same name (' + listOf(twice) + '): remove or rename the drawn one.' : ''));
    } catch (e) {
      clearZoneFile();
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
  document.querySelectorAll('#em-show [data-show]').forEach(b => b.addEventListener('click', () => {
    if (b.disabled || state.show === b.dataset.show) return;
    state.show = b.dataset.show;
    syncControls();
    state.fitNext = true;
    compute();
  }));

  // ---- Add a point on the map (Premise Lookup's Pick on map) ------------------------------------------------------
  // A picked point gets rings like a positive (no status, never closed); listed with a name box and a remove button.
  // Its first name, "Added point n", counts every point added, so a removed point's name is not given again.
  const POINT_NAME_MAX = 60;
  function setPicking(on) {
    state.picking = !!on;
    if (state.picking && draw.mode()) { draw.cancel(); draw.done(); }
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
  // The shared list, as Infrastructure's (shared/facility-ui.js render, 2.8): the layers under their group headings,
  // each ticked layer's number of sites after its filters and its fold "Filter by attributes" (one ticked list per
  // column; any value ticked in a column matches, every column must match, none ticked means no limit). A layer whose
  // file was not supplied is not listed; one that could not be used is grayed, with the reason. The type's
  // suggestions are ticked first. One fold is open at a time, and every fold is closed after a load.
  function renderLayers() {
    const box = $('em-layers');
    const listed = state.prepared ? state.prepared.layers.filter(l => l.usable || l.reason !== 'file not supplied') : [];
    if (!listed.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Load facility files to check them.';
      box.replaceChildren(p);
    } else {
      const counts = Object.fromEntries(Object.values(state.layers).map(l => [l.key, l.points.length]));
      W.facilityUI.render(box, { layers: listed }, state, layersChanged, 'em-fac',
        { counts, emptyReason: 'No sites match the filters ticked.' });
    }
    if (state.closeFolds) box.querySelectorAll('details.facility-filters[open]').forEach(d => { d.open = false; });
    state.closeFolds = false;
    // The tick "CVI movements" (2.6), once a CVI master is read; All and Clear leave it as it is.
    $('em-cvi-field').hidden = !state.master;
    $('em-cvi').checked = state.cviOn;
    renderNameMarkers();
  }
  // The layers' order in the legend, the picture's key and "Name markers in PNG" (2.8): as the load ticks them (the
  // type's suggestions first), then the rest in the files' order; kept through every click, so the legend never jumps.
  function layerOrderOf(ticked) {
    return ticked.concat(Object.keys(state.layers).filter(k => !ticked.includes(k)));
  }
  // A tick or a filter changed in the list: the ticks kept in that order, each layer's sites through its filters
  // again (layersNow), then every view.
  function layersChanged() {
    state.selectedLayers = (state.layerOrder || []).filter(k => state.selectedLayers.includes(k));
    state.layers = layersNow();
    renderLayers();
    compute();
  }
  // Opening a layer's filters closes the one open before (several open made the list too long to use).
  $('em-layers').addEventListener('toggle', e => {
    const fold = e.target;
    if (!fold.open || !fold.classList.contains('facility-filters')) return;
    $('em-layers').querySelectorAll('details.facility-filters[open]').forEach(d => { if (d !== fold) d.open = false; });
  }, true);
  // A layer with a value ticked in its filters: its sites that do not match are left out of everything (2.8).
  const isFiltered = key => Object.values(state.attributes[key] || {}).some(v => v.length);
  // A layer's filters in words for the Export, as the fold names them: "Type: Broilers, Layers; Grade: Grade A".
  const filtersText = key => Object.entries(state.attributes[key] || {}).filter(([, v]) => v.length)
    .map(([h, v]) => F.pretty(h) + ': ' + v.join(', ')).join('; ');
  // export_params.json's layer_filters (its writer takes flat values, CVI's exports.js jsonValue): each ticked layer
  // filtered, "Commercial Poultry (Type: Layers)", else "none".
  function layerFilters() {
    const out = state.selectedLayers.filter(k => state.layers[k] && isFiltered(k))
      .map(k => state.layers[k].label + ' (' + filtersText(k) + ')');
    return out.length ? out : 'none';
  }
  $('em-cvi').addEventListener('change', () => {
    state.cviOn = $('em-cvi').checked;
    compute();
  });
  $('em-layers-all').addEventListener('click', () => {
    state.selectedLayers = (state.layerOrder || []).slice();
    renderLayers();
    compute();
  });
  $('em-layers-clear').addEventListener('click', () => {
    state.selectedLayers = [];
    renderLayers();
    compute();
  });

  // The switch "Rings | Zones | Both" (3b; Zones and Both grayed until a zone exists), the rings' boxes hidden on
  // Zones, and the closed positives' rings with them.
  function syncZoneTick() {
    const now = shown(), none = !allZones().length;
    document.querySelectorAll('#em-show [data-show]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.show === now));
      b.disabled = none && b.dataset.show !== 'rings';
      b.title = b.disabled ? 'Load a zone file or draw a zone first.' : '';
    });
    $('em-rings-field').hidden = now === 'zones' || !state.rings || !state.rings.length;
    $('em-past-rings').disabled = now === 'zones';
  }
  // Every control from the state, after a new load, a type change or a new zone file.
  function syncControls() {
    $('em-type').value = state.type.id;
    syncTypeHelp();
    renderStatuses();
    renderAnimals();
    renderWindow();
    syncUnit();
    if (state.rings) renderRings();
    syncZoneTick();
    renderPoints();
    renderDrawn();
    renderLayers();
  }

  // A sidebar fold's summary whose line breaks only between whole items ("5 with zones, 5 past, 1 without a date").
  function setSum(id, text) {
    const box = $(id), parts = String(text || '').split(/(, | and )/);
    box.replaceChildren(...parts.map((t, i) => i % 2 ? document.createTextNode(t) : el('span', 'item', t)));
  }

  // ---- The results: rules, map, boxes, legend --------------------------------------------------------------------
  const NO_STATUS = '#636363';
  // The CVI premises' colors on the map and in its legend: the map picture's (branded.js), an origin's and a destination's.
  const CVI_COLORS = { origin: W.emergencyBranded.CVI_ORIGIN, dest: W.emergencyBranded.CVI_DEST };
  // The positives and the added points the zones are drawn around, as the rules take them: a ticked status, inside
  // the window and current on its end date.
  function zonePositives() {
    const read = state.read;
    const list = read ? E.targets(read.positives, state.ticks, state.window) : [];
    const added = state.points.map((p, k) => ({ index: 'added-' + k, name: p.name, lat: p.lat, lon: p.lon, status: null,
      closed: false, added: true }));
    return list.concat(added);
  }
  const windowEnd = () => (state.window ? state.window.end : null);

  function compute() {
    const started = root.performance.now();
    const read = state.read, targets = zonePositives(), unit = state.unit;
    state.targets = targets.filter(p => !p.added);   // the positives with zones, for the boxes and the Export
    // What shows (3b): the rings, the zones in their place, or both (the ring sites first, rules.js bothSites).
    const show = shown(), zonesMode = show === 'zones';
    const g = read ? E.groups(read, state.window) : null;
    const ringPart = !zonesMode && state.rings ? E.ringSites(targets, state.rings, unit) : [];
    const sites = show === 'zones' ? E.zoneSites(allZones()) : show === 'both' ? E.bothSites(ringPart, E.zoneSites(allZones())) : ringPart;
    // Past positives' rings: drawn only, when asked for, at the current distances; they never add rows or counts.
    const pastSites = g && !zonesMode && state.rings && closedShown() && state.pastRings && g.past.length
      ? E.ringSites(g.past, state.rings, unit) : [];
    const layers = state.selectedLayers.map(k => state.layers[k]).filter(Boolean);
    state.result = sites.length || layers.length ? E.inside(sites, layers, { mode: show,
      rings: state.rings, unit, positives: targets, includeCoarse: state.includeCoarse }) : null;
    // Days since the last positive: every positive detected inside the window counts, whatever its group.
    const counted = g ? g.current.concat(g.past) : [];
    state.days = { zonesMode, show, asOf: windowEnd(), sites: E.daysSince(sites, counted, windowEnd()),
      past: E.daysSince(pastSites, counted, windowEnd()) };
    state.zoneParts = { zonesMode, show, sites, ringCount: ringPart.length, pastSites, counted };   // for zones.geojson and the map picture
    // The legend before the map: the map's fit keeps the legend's width clear, so it must be shown first.
    state.cviKey = null;   // the zones or files changed: the CVI movements are worked out again when shown
    const cvi = cviMarks();
    legendArgs = [show, g, pastSites.length > 0, cvi];
    renderLegend(...legendArgs);
    drawMap(sites, pastSites, show, ringPart.length, targets, layers, cvi);
    renderBoxes();
    if (!read || state.view !== 'overview') renderChart();   // on the Overview it is drawn with the rest (renderView)
    renderTabs();
    renderInside();
    if (state.tab === 'cvi') renderCvi();
    // The fold's summary says its settings; the counts are in the boxes above the map (each said once).
    const sum = [];
    if (read) {
      const ringsWords = !state.rings || !state.rings.length ? 'no rings'
        : listOf(state.rings.map(r => shownDistance(r.distance))).replace(/ /g, '\u00a0') + '\u00a0' + E.UNITS[state.unit].label + ' rings';
      sum.push(zonesMode ? zonesWords() : show === 'both' ? ringsWords + ', ' + zonesWords() : ringsWords);
      if (animalsOnly()) sum.push(animalsOnly().toLowerCase() + ' only');
      else if (noAnimals()) sum.push('no animals ticked');
      if (g.past.length) sum.push(closedShown() ? 'closed shown' : 'closed hidden');
      const noStatus = read.columns.status ? read.positives.filter(p => !p.status && E.inWindow(p, state.window)).length : 0;
      if (noStatus) sum.push(noStatus.toLocaleString('en-US') + ' without a status');
    }
    setSum('positives-sum', sum.join(', '));
    setSum('layers-sum', (layers.length ? [plural(layers.length, 'layer', 'layers')] : []).concat(cviOn() ? ['CVI movements'] : []).join(', '));
    $('em-zero').hidden = !!read;
    // The switch shows once a positives file is read; without one the page is the map.
    $('em-view').hidden = !read;
    renderView();
    state.computeMs = root.performance.now() - started;   // test hook: one redraw's time
  }

  // A zone's line in the hover: "12 days" (since the last positive, said once in the hover's last line), or "no
  // dated positive inside".
  const daysText = days => (days === null ? 'no dated positive inside' : plural(days, 'day', 'days'));
  // A positive's hover: its name (the heading); its status (when the file has a status column) and detection date;
  // its group when past; then the details (flock type, the shown columns, the inventory and the flock size).
  function positiveLabel(p) {
    const read = state.read, end = windowEnd();
    const second = [];
    if (read.columns.status || !p.status) second.push(p.status ? p.status.label : 'no status');
    second.push(p.detected ? 'detected ' + E.dayLabel(p.detected) : 'no detection date');
    const line = second.join(' · ');
    const lines = [p.name, line.charAt(0).toUpperCase() + line.slice(1)];
    if (E.isPast(p, end)) {
      lines.push({ under: 'Closed, still under quarantine', unknown: 'Closed, quarantine not known' }[E.quarantineOf(read, p, end)] || 'Closed');
    }
    const more = E.details(read, p).filter(d => d[1]).map(([column, value]) => column === read.columns.inventory
      ? value + ' ' + E.inventoryWordOf(read.type, p) : column === 'Flock size' ? 'flock size ' + value : value);
    return lines.concat(more.length ? [more.join(' · ')] : []).join('\n');
  }

  // The map's data: the zones (with their hover lines), the past rings, the positives, and the ticked layers' sites,
  // inside highlighted and the others faded.
  function drawMap(sites, pastSites, show, ringCount, targets, layers, cvi) {
    const days = state.days, tips = [], zonesMode = show === 'zones';
    // The rings' shapes (the first ringCount sites), then the zones' (3b: in Both, the rest).
    const ringZones = zonesMode ? [] : EM.zoneFeatures(sites.slice(0, ringCount), state.rings || [], null, state.unit);
    const polygons = show === 'rings' ? [] : EM.polygonFeatures(allZones(), '#cb181d');
    const zones = ringZones.concat(polygons);
    // A ring's hover lines, under its positive's name: the ring under the pointer and the larger rings around the
    // same positive (a point in the Infection zone is also in the Control zone), each with its days since the last
    // positive. A zone's (2.6): its name as the heading, its days since, then drawn or from the file and its area.
    const zoneTips = (s, d) => [{ km: 0, head: s.name, text: daysText(d.days) },
      { km: 0.001, head: s.name, text: (s.source === 'drawn' ? 'Drawn' : 'From the file') + ' \u00b7 ' + E.areaText(s.areaM2) }];
    const ringTips = (f, list, past) => state.rings.slice(f.properties.ring).map((r, k) => ({ km: E.toKm(r.distance, state.unit),
      head: f.properties.name + (past ? ' (closed)' : ''),
      text: r.label + ' (' + ringDistance(r) + '): ' + daysText(list[f.properties.site].rings[f.properties.ring + k].days) }));
    ringZones.forEach(f => {
      f.properties.zid = tips.length;
      tips.push(ringTips(f, days.sites, false));
    });
    polygons.forEach((f, i) => {
      f.properties.zid = tips.length;
      tips.push(zoneTips(sites[ringCount + i], days.sites[ringCount + i]));
    });
    const pastZones = EM.zoneFeatures(pastSites, state.rings || [], null, state.unit);
    pastZones.forEach(f => {
      f.properties.zid = tips.length;
      tips.push(ringTips(f, days.past, true));
    });
    // While a zone is drawn with the zones in the rings' place (Zones), the rings stay on the map as a guide (2.6):
    // drawn only, with no hover lines (none shows while drawing), never counted or exported. In Both they show already.
    const guide = zonesMode && state.ringGuide && state.rings
      ? EM.zoneFeatures(E.ringSites(targets, state.rings, state.unit), state.rings, null, state.unit) : [];
    const withZones = new Set(targets.map(p => p.index)), read = state.read, end = windowEnd();
    const shown = read ? read.positives.filter(p => E.inWindow(p, state.window) && (closedShown() || !E.isPast(p, end))) : [];
    // A premises detected more than once (2.9): the cases at one map point (the same coordinates to 5
    // decimals, as the Report view counts them), active or closed, whatever the dates shown: a badge on the mark with
    // how many, and a box in its hover naming each case with its dates, the earliest first.
    const atPoint = new Map(), pointOf = p => p.lat.toFixed(5) + ',' + p.lon.toFixed(5);
    for (const p of read ? read.positives : []) {
      if (!atPoint.has(pointOf(p))) atPoint.set(pointOf(p), []);
      atPoint.get(pointOf(p)).push(p);
    }
    const shared = {};
    for (const [at, list] of atPoint) {
      if (list.length < 2) continue;
      const ended = p => p.closedDate || (p.closed && p.quarantine && !p.releaseAfterToday ? p.quarantine : null);
      shared[at] = { head: list.length + ' cases at this map point:', lines: list.slice().sort((a, b) => (a.detected || '9') < (b.detected || '9') ? -1 : 1).map(p =>
        p.name + ': ' + (p.detected ? 'detected ' + E.dayLabel(p.detected) : 'no detection date') + ', ' +
        (E.isPast(p, end) ? 'closed' + (ended(p) ? ' ' + E.dayLabel(ended(p)) : '') : 'active')) };
    }
    const positives = shown.map(p => ({ lat: p.lat, lon: p.lon, label: positiveLabel(p),
      color: p.status ? p.status.color : NO_STATUS, past: E.isPast(p, end), withZones: withZones.has(p.index),
      shape: E.animalShapeOf(read.type, p), shapes: E.animalShapesOf(read.type, p),
      shared: (atPoint.get(pointOf(p)) || []).length, sharedAt: shared[pointOf(p)] ? pointOf(p) : '' }))
      .concat(state.points.map(p => ({ lat: p.lat, lon: p.lon, label: p.name, color: NO_STATUS, past: false, withZones: true })));
    const r = state.result, insideKeys = new Set(), inside = [], outside = [];
    if (r) {
      for (const row of r.rows) {
        const key = E.layerSiteKey(row.layer, row);
        if (insideKeys.has(key)) continue;
        insideKeys.add(key);
        const l = state.layers[row.layer];
        inside.push({ lat: row.lat, lon: row.lon, shape: l.shape, color: l.color,
          // A site matched to a zone polygon says it is inside the zone (3b), not "0 km from" it.
          label: row.name + '\n' + l.label + ' · ' + (row.inZone ? 'inside ' + row.siteName : E.round2(E.fromKm(row.exactKm, state.unit)) + ' ' +
            E.UNITS[state.unit].label + ' from ' + row.siteName) });
      }
    }
    for (const l of layers) {
      for (const p of l.points) {
        const name = p.display !== undefined ? String(p.display) : String(p.name);
        if (insideKeys.has(E.layerSiteKey(l.key, { lat: p.lat, lon: p.lon, name }))) continue;
        outside.push({ lat: p.lat, lon: p.lon, shape: l.shape, color: l.color, label: name + '\n' + l.label });
      }
    }
    // The view (2.4): the zones, the past zones drawn and every positive shown (the past ones when shown).
    const bounds = EM.viewBounds(zones, pastZones, positives);
    const tipFoot = days.asOf ? 'Days since the last positive inside each zone, as of ' + E.dayLabel(days.asOf) : '';
    // The map is hidden while the Overview shows: a fit then waits until the Map is shown again. The play's steps ask
    // for no fit, so the view stays still while it plays; it fits once when the play stops (stopPlay).
    const fit = state.fitNext && state.view === 'map';
    EM.draw(state.map, { zones: zones.concat(guide), pastZones, zoneTips: tips, tipFoot, positives, inside, outside, cvi, bounds, shared }, fit);
    if (fit) state.fitNext = false;
    state.mapData = { zones: zones.length, guide: guide.length, pastZones: pastZones.length, positives: positives.length, shared: Object.keys(shared).length,
      past: positives.filter(p => p.past).length, inside: inside.length, outside: outside.length, cvi: cvi.length };   // test hook
  }

  // The four value boxes of the view (rules.js boxesOf): On a day Active, Closed, Last positive and Sites inside;
  // Between dates Detected (its bar of active and closed), Active, Closed and Sites inside. A value that cannot be given
  // says what it needs, never zero. Active and Closed carry the map's marks, solid and hollow; Closed notes those still
  // under quarantine; the other lines
  // (the rows not mapped, the unreadable dates, the positives without a date, those closed on a day not known) go in
  // one line under the boxes, in the
  // warning color (the animals are the Overview's box since 2.3). The "Last positive"
  // box gives the date as the page writes dates ("Oct 2, 2026"), its note the window's end ("As of Oct 5, 2026").
  function renderBoxes() {
    const v = E.valueBoxes(state.read, state.result && state.result.layers.length ? state.result : null, state.window,
      todayIso(), state.targets);
    const set = (id, value, note) => {
      const card = $(id);
      card.classList.toggle('na', value === null);
      card.querySelector('strong').textContent = value === null ? note : typeof value === 'number' ? value.toLocaleString('en-US') : value;
      card.querySelector('.card-note').textContent = value === null ? '' : note || '';
    };
    set('box-positives', v.positives.value, v.positives.value !== null && shown() === 'zones' ? zonesWords() : v.positives.note);
    set('box-past', v.past.value, v.past.value === null ? v.past.reason : v.past.note);
    set('box-detected', v.detected.value, v.detected.value === null ? v.detected.reason : '');
    for (const id of ['box-detected', 'box-positives', 'box-past', 'box-last', 'box-inside']) {
      $(id).hidden = !v.order.includes(id.slice(4) === 'positives' ? 'positives' : id.slice(4));
    }
    // The marks before the numbers, as on the map: solid for active, hollow for closed.
    const mark = (id, kind) => { if ($(id).classList.contains('na')) return; $(id).querySelector('strong').prepend(el('span', 'ts-mark ' + kind)); };
    mark('box-positives', 'solid');
    mark('box-past', 'hollow');
    // Detected: a bar split active and closed, then both counts with their marks.
    if (v.detected.value !== null && v.order.includes('detected')) {
      const d = v.detected, bar = el('span', 'ts-bar'), share = d.value ? Math.round(100 * d.active / d.value) : 0;
      const solid = el('i'), hollow = el('b');
      solid.style.width = share + '%';
      hollow.style.width = (100 - share) + '%';
      bar.append(solid);
      if (d.closed) bar.append(hollow);
      $('box-detected').querySelector('.card-note').replaceChildren(bar, el('span', 'ts-mark solid'), d.active.toLocaleString('en-US') + ' active \u00a0',
        el('span', 'ts-mark hollow'), d.closed.toLocaleString('en-US') + ' closed');
    }
    $('box-past').classList.toggle('quar', !!v.past.quarantined);
    // Some quarantines not known (2.4): the icon striped gold, half the cue of the solid gold for still under quarantine.
    $('box-past').classList.toggle('unk', !!v.past.notKnown);
    // The number still under quarantine in bold and the warning color, and "n not known" in bold; the rest of the note
    // as the other boxes' notes.
    if (v.past.quarantined || v.past.notKnown) {
      const nodes = [];
      let rest = v.past.note;
      if (v.past.quarantined) {
        const n = rest.match(/^[\d,]+/)[0];
        nodes.push(el('b', '', n));
        rest = rest.slice(n.length);
      }
      if (v.past.notKnown) {
        const k = rest.lastIndexOf(', ') + 2;
        nodes.push(rest.slice(0, k), el('b', '', rest.slice(k)));
      } else nodes.push(rest);
      $('box-past').querySelector('.card-note').replaceChildren(...nodes);
    }
    set('box-last', v.last.value === null ? null : E.dayLabel(v.last.value), noAnimals() ? 'Tick at least one kind of animal'
      : v.last.value === null ? v.last.reason : v.last.note || '');
    set('box-inside', v.inside.value, v.inside.reason);
    const strip = $('em-box-lines'), lines = v.positives.value === null ? [] : v.positives.lines;
    strip.replaceChildren();
    // The line naming species no kind names (rules.js unlistedLine) has a "?" saying where the kinds are changed (2.8).
    const unlistedNote = $('help-em-unlisted');
    let unlisted = false;
    lines.forEach((l, i) => {
      if (i) strip.append(el('span', 'sep', ' · '));
      strip.append(el('span', 'warn', l));
      if (!l.includes(' with a species not listed: ')) return;
      unlisted = true;
      const tip = el('button', 'tip', '?');
      tip.type = 'button';
      tip.dataset.help = 'em-unlisted';
      tip.setAttribute('aria-controls', 'help-em-unlisted');
      tip.setAttribute('aria-label', 'About species not listed');
      tip.setAttribute('aria-expanded', String(!unlistedNote.hidden));
      tip.title = unlistedNote.textContent;
      strip.append(tip);
    });
    if (!unlisted) unlistedNote.hidden = true;
    strip.hidden = !lines.length;
  }

  // ---- The chart "Positives over time" (chart.js) ---------------------------------------------------------------
  // The file's positives by the week or month they were detected in, from the first detection to today (rules.js
  // chartSpan and overTime): active in the type's first status color, closed hollow and faded as on the map, those
  // after the day (On a day) or outside the dates (Between dates) gray. The day's line or the dates' band in WSDA blue
  // (2.5). A click on a column, or Enter on it, moves the day to the column's last day, or makes the dates that week
  // or month (rules.js pickColumn); the picked column again goes back to the view's opening dates. In the Overview's
  // "Over time" (2.3), drawn at its panel's width while the Overview shows; the section is hidden without a readable
  // date.
  const CH = W.emergencyChart;
  const OUTSIDE = '#d9d9d9', CHART_HEIGHT = { narrow: 260, wide: 300 };
  // The Overview's "Columns by: Status · Animal" (2.8) over "Over time" and "By county", offered with two kinds of
  // animal or more ticked. By animal, a column or bar counts the positives of each kind, active and closed together,
  // a positive whose species names more than one kind once, under "Several kinds" (rules.js chartKinds). Each kind
  // keeps its color whatever is ticked: by its place in the type, WSDA's dark blue, evergreen, eggplant, gold,
  // blue-green and dark brown, kept clear of the status reds (a seventh kind or later shares the last, as it shares
  // the last mark); "Several kinds" hatched, dark gray lines on white, clear of every kind and of the gray.
  const KIND_COLORS = ['#1c5a83', '#4a8b2c', '#522348', '#fcb614', '#0094aa', '#382513'], SEVERAL_INK = '#4d4d4d';
  const byAnimalOffered = () => !!state.readAll && E.animalKindsOf(state.readAll).length > 1 && state.animals.length > 1;
  const byAnimal = () => state.columnsBy === 'animal' && byAnimalOffered();
  // The parts by animal: { kind (its key), label (in the hover: "2 with birds"), name (in the key), fill, hatch }.
  const kindSeries = () => E.chartKinds(state.read, state.animals).map(k => ({ kind: k.key, label: 'with ' + k.label.toLowerCase(),
    name: k.label, fill: k.key === E.SEVERAL ? SEVERAL_INK : KIND_COLORS[Math.min(k.index, KIND_COLORS.length - 1)],
    hatch: k.key === E.SEVERAL }));
  function renderColumnsBy() {
    const box = $('ov-by'), animal = byAnimal();
    box.hidden = !byAnimalOffered();
    box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.by === (animal ? 'animal' : 'status'))));
  }
  document.querySelectorAll('#ov-by button').forEach(b => b.addEventListener('click', () => {
    if (state.columnsBy === b.dataset.by) return;
    state.columnsBy = b.dataset.by;
    renderOverview();
  }));
  function renderChart() {
    const box = $('em-chart'), tip = $('em-chart-tip');
    const none = !state.read || !state.chartSteps.steps.length || !state.window;
    $('ov-s-time').hidden = none;
    state.chart = none ? null : E.overTime(state.read, state.window, state.chartSteps);   // test hook
    tip.hidden = true;
    if (!state.chart) { box.replaceChildren(); return; }
    const t = state.chart, notCounted = [];
    $('em-chart-sum').textContent = t.by === 'month' ? 'by month' : 'by week';
    if (t.notMapped) notCounted.push(t.notMapped.toLocaleString('en-US') + ' not mapped');
    if (t.undated) notCounted.push(t.undated.toLocaleString('en-US') + ' without a date');
    $('em-chart-note').hidden = !notCounted.length;
    $('em-chart-note').textContent = notCounted.length ? 'Not counted: ' + notCounted.join(', ') : '';
    if (state.view !== 'overview') return;
    const color = state.type.statuses[0].color, day = state.viewKind === 'day', win = state.window;
    // By status: active, closed, then outside; by animal (2.8): each kind's part, then outside.
    const kinds = byAnimal() ? kindSeries() : null;
    const series = (kinds ? kinds.map(s => Object.assign({ key: 'kind\r' + s.kind }, s))
      : [{ key: 'current', label: 'active', name: 'Active', fill: color },
        { key: 'past', label: 'closed', name: 'Closed', outline: true, stroke: color, opacity: 0.55 }])
      .concat([{ key: 'outside', label: day ? 'after the day' : 'outside the dates', name: day ? 'After the day' : 'Outside the dates', fill: OUTSIDE }]);
    const valuesOf = c => (kinds ? Object.assign({ outside: c.outside }, ...kinds.map(s => ({ ['kind\r' + s.kind]: c.kinds[s.kind] || 0 })))
      : { current: c.current, past: c.past, outside: c.outside });
    const tick = c => (t.by === 'month' ? c.label.replace(/^Month of /, '') : c.label.replace(/^Week of /, '').replace(/, \d{4}$/, ''));
    const columns = t.columns.map((c, i) => ({ label: c.label, tick: tick(c), picked: i === state.picked,
      values: valuesOf(c),
      click: i === state.picked ? 'Click again for the opening dates'
        : day ? 'Click to move the day to ' + E.dayLabel(c.end) : 'Click to see the ' + (t.by === 'month' ? 'month' : 'week') + ' alone' }));
    // The line inside the day's column, by the day's place in it; the band over the dates' columns.
    const colAt = iso => t.columns.findIndex(c => iso >= c.start && iso <= c.end);
    const spanDays = c => (Date.parse(c.end) - Date.parse(c.start)) / 864e5 + 1;
    let mark = null;
    if (day) {
      const k = colAt(win.end);
      if (k >= 0) mark = { kind: 'line', col: k, at: ((Date.parse(win.end) - Date.parse(t.columns[k].start)) / 864e5 + 1) / spanDays(t.columns[k]) };
    } else {
      const from = win.start < t.columns[0].start ? 0 : colAt(win.start), to = colAt(win.end);
      if (from >= 0 && to >= 0) mark = { kind: 'band', from, to };
    }
    state.chartMark = mark;   // test hook
    const focused = box.contains(document.activeElement);
    box.innerHTML = CH.columns({ title: 'Positives over time, ' + (t.by === 'month' ? 'by month' : 'by week') + (kinds ? ', by animal' : ''),
      none: 'no positives', series, columns, mark }, { width: box.clientWidth,
      height: box.clientWidth < 600 ? CHART_HEIGHT.narrow : CHART_HEIGHT.wide });
    if (focused) box.querySelector('.chart-col[tabindex="0"]').focus();
  }
  // The hover box beside the pointer, or beside a focused column (copied from site/cvi/app/ui.js, v2.0, showTip).
  function showTip(target, x, y) {
    const tip = $('em-chart-tip');
    tip.textContent = target.getAttribute('data-hover');
    const hint = target.getAttribute('data-click');
    if (hint) tip.appendChild(el('span', 'hint', hint));
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(4, Math.min(x + 12, root.innerWidth - w - 8)) + 'px';
    tip.style.top = (y + 16 + h > root.innerHeight ? y - h - 10 : y + 16) + 'px';
  }
  // A column moves the day to its last day (On a day) or makes the dates that column (Between dates);
  // the picked column again goes back to the view's opening dates, with no column picked. The map's view
  // follows (on the Overview, when the Map is next shown).
  function pickColumn(i) {
    stopPlay();
    const column = state.chartSteps.steps[i];
    if (!column) return;
    if (i === state.picked) {
      state.picked = null;
      showWindow(state.opening[state.viewKind]);
      return;
    }
    state.picked = i;
    // The first column starts on its Sunday or the 1st, which may be before the file's first detection: the first
    // date box starts no earlier than its own first date (the counts are the same).
    const from = state.fileWindow.start;
    showWindow(E.pickColumn(state.window, column.start < from ? Object.assign({}, column, { start: from }) : column));
  }
  const chartBox = $('em-chart'), colOf = e => e.target.closest && e.target.closest('.chart-col');
  chartBox.addEventListener('click', e => { const c = colOf(e); if (c) pickColumn(Number(c.getAttribute('data-col'))); });
  chartBox.addEventListener('pointermove', e => { const c = colOf(e); if (c) showTip(c, e.clientX, e.clientY); else $('em-chart-tip').hidden = true; });
  chartBox.addEventListener('pointerleave', () => { $('em-chart-tip').hidden = true; });
  chartBox.addEventListener('focusin', e => {
    const c = colOf(e);
    if (!c) return;
    const r = c.getBoundingClientRect();
    showTip(c, r.left + r.width / 2, r.top + 24);
  });
  chartBox.addEventListener('focusout', () => { $('em-chart-tip').hidden = true; });
  // The box is placed in the window, so it would stay put while the page scrolls.
  root.addEventListener('scroll', () => { $('em-chart-tip').hidden = true; }, { passive: true });
  // The keyboard: one stop (the picked column); the arrow keys, Home and End move along the columns, Enter or Space
  // picks one.
  chartBox.addEventListener('keydown', e => {
    const c = colOf(e);
    if (!c) return;
    const all = Array.from(chartBox.querySelectorAll('.chart-col')), i = Number(c.getAttribute('data-col'));
    const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: all.length - 1 }[e.key];
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickColumn(i); return; }
    if (to === undefined || !all[to]) return;
    e.preventDefault();
    c.setAttribute('tabindex', '-1');
    all[to].setAttribute('tabindex', '0');
    all[to].focus();
  });
  // The bars' hover box: a bar's count.
  for (const id of ['ov-county-chart', 'ov-layer-chart']) {
    $(id).addEventListener('pointermove', e => {
      const m = e.target.closest && e.target.closest('.chart-mark');
      if (m) showTip(m, e.clientX, e.clientY); else $('em-chart-tip').hidden = true;
    });
    $(id).addEventListener('pointerleave', () => { $('em-chart-tip').hidden = true; });
  }
  // The Overview's charts drawn again at their new widths.
  let chartFrame = 0;
  root.addEventListener('resize', () => {
    if (state.view !== 'overview') return;
    root.cancelAnimationFrame(chartFrame);
    chartFrame = root.requestAnimationFrame(renderOverview);
  });

  // ---- The Map | Overview | Report switch and the Overview (2.3) ---------------------------------------------------
  // Report (2.9) shows for a type with report words (types/hpai.js report); the print styles take the page only while
  // it is the view shown (body.rp-on).
  function renderView() {
    const reportOn = !!(state.readAll && state.type.report);
    $('show-report').hidden = !reportOn;
    $('ov-to-figures').hidden = !reportOn;
    if (!state.read || (state.view === 'report' && !reportOn)) state.view = 'map';
    for (const v of ['map', 'overview', 'report']) {
      $('show-' + v).setAttribute('aria-pressed', String(state.view === v));
      $('view-' + v).hidden = state.view !== v;
    }
    document.body.classList.toggle('rp-on', state.view === 'report');
    if (state.view === 'overview') renderOverview();
    if (state.view === 'report') renderReport();
  }
  function showView(v) {
    if (v === state.view) return;
    state.view = v;
    renderView();
    // The map was hidden: MapLibre takes its size again by itself (it watches its frame, a moment later); a fit asked
    // for meanwhile is made now, at the map's own size.
    if (v === 'map' && state.fitNext) {
      if (state.map.map) state.map.map.resize();
      compute();
    }
  }
  document.querySelectorAll('#em-view [data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  // ---- The Report view (2.9, E2): the update's pages from the whole file on the report's date (report-view.js) ----
  // The date is today until one is picked; a row detected after it is left out, so a past month's update reads as it did then. The update counts
  // every row of the file, whatever the "Animals" ticks and the time views, so the note says when they leave some out
  // elsewhere on the page.
  const RV = W.emergencyReportView, RF = W.emergencyReportForm, RFG = W.emergencyReportFigures;
  // The form's report text (report-form.js) is kept while files of the same type are loaded again. Another type takes
  // its own (its own words when new), and the text typed for the first is kept, so loading another type's file and
  // coming back loses nothing typed; USDA's pictures, kept on the page only, go with the type they were added for.
  function reportText() {
    const id = state.type.id;
    if (!state.reportText || state.reportText.type !== id) {
      if (state.reportText) { state.reportTexts[state.reportText.type] = state.reportText; RF.clearPictures(); }
      state.reportText = state.reportTexts[id] || RF.fresh(state.type);
    }
    return state.reportText;
  }
  function renderReport() {
    const date = state.reportDate || todayIso(), text = reportText();
    $('rp-date').value = date;
    figuresFrame();
    const r = RV.draw($('rp-preview'), { read: state.readAll, type: state.type, date, counties: root.CVIWA_GEO.counties.features,
      labels: root.CVIWA_GEO.labels, choices: RF.choices(text, state.type, RF.pictures()) });
    RF.show(document, state.type, text, r.figures, date, r);
    $('rp-arcgis').hidden = !text.p2;
    $('rp-count').textContent = plural(r.pages, 'page', 'pages') + ', as they print';
    const notes = [];
    if (r.figures.later) notes.push(plural(r.figures.later, 'row', 'rows') + ' detected after ' + W.emergencyReport.dateLong(date) + ' left out.');
    if (state.read.positives.length + state.read.dropped.length < state.readAll.positives.length + state.readAll.dropped.length) {
      notes.push('The update counts every kind of animal, whatever the "Animals" ticks.');
    }
    $('rp-note').textContent = notes.join(' ');
    $('rp-note').hidden = !notes.length;
    renderFigures(date);
  }
  // "Figures | Fill in" (2.9): Figures, page 1's figures on screen (report-figures.js), in place of the form and the
  // pages. The pages are still drawn, out of sight (body.rp-fig, index.html), so printing from Figures prints the
  // update, never the Figures. The switch is set before the pages are drawn, so they are measured where they show.
  function figuresFrame() {
    const fig = state.reportMode === 'figures';
    $('rp-show-figures').setAttribute('aria-pressed', String(fig));
    $('rp-show-fill').setAttribute('aria-pressed', String(!fig));
    $('rp-figures').hidden = !fig;
    document.body.classList.toggle('rp-fig', fig);
  }
  function renderFigures(date) {
    if (state.reportMode !== 'figures') return;
    $('rp-fig-date').value = date;
    RFG.draw($('rp-fig-body'), { read: state.readAll, type: state.type, date, counties: root.CVIWA_GEO.counties.features,
      labels: root.CVIWA_GEO.labels });
  }
  const showMode = mode => {
    state.reportMode = mode;
    renderReport();
  };
  $('rp-show-figures').addEventListener('click', () => { if (state.reportMode !== 'figures') showMode('figures'); });
  $('rp-show-fill').addEventListener('click', () => { if (state.reportMode !== 'fill') showMode('fill'); });
  RFG.wire($('rp-figures'));
  // The Overview's link: the update's figures, in the Report view's Figures.
  $('ov-to-figures').addEventListener('click', () => {
    state.reportMode = 'figures';
    showView('report');
  });
  // A choice draws the pages at once; typed words a moment after the typing stops.
  let reportSoon = 0;
  RF.wire(document, reportText, soon => {
    root.clearTimeout(reportSoon);
    if (soon) reportSoon = root.setTimeout(renderReport, 250);
    else renderReport();
  }, todayIso);
  // The form's date and Figures' are one date: either moves both.
  for (const id of ['rp-date', 'rp-fig-date']) {
    $(id).addEventListener('change', () => {
      const v = $(id).value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;   // a date being typed, or cleared: the last one stays
      state.reportDate = v;
      renderReport();
    });
  }
  // "Save report text" downloads the form's words and choices (report-form.js toFile; nothing from the table), named
  // for the report ("HPAI update 2026-09-01 report text.json"); "Load last month's" fills the form from one, the numbers
  // staying this table's, and a report loaded is a draft until "Ready to send" is ticked again.
  const fileNote = (how, words) => {
    $('rp-file-note').textContent = words;
    $('rp-file-note').className = 'rp-file-note' + (how === 'warn' ? ' warn' : '');
    $('rp-file-note').hidden = !words;
  };
  $('rp-save').addEventListener('click', () => {
    const date = state.reportDate || todayIso(), name = RV.title(state.type, date) + ' report text.json';
    savePng(name, new Blob([RF.toFile(reportText(), state.type, date, todayIso())], { type: 'application/json' }));
    fileNote('', 'Saved as "' + name + '" in your downloads. Keep it on the R drive for next month.');
  });
  // "Save for ArcGIS" (2.9, type once, use in both): page 2's figures and the update's sentences as one row in the
  // ArcGIS monthly table's columns (report-form.js arcgisFile), to overwrite that table with.
  $('rp-arcgis').addEventListener('click', () => {
    const date = state.reportDate || todayIso(), last = RV.last, name = 'hpai-monthly-figures.csv';
    const got = RF.arcgisFile(reportText(), state.type, date, last && last.words);
    savePng(name, new Blob([got.csv], { type: 'text/csv' }));
    fileNote(got.blanks ? 'warn' : '', 'Saved "' + name + '": page 2\'s figures and the status, livestock and milk testing sentences, in the ArcGIS ' +
      'monthly table\'s columns. Overwrite that table with it.' + (got.blanks ? ' ' + plural(got.blanks, 'figure is', 'figures are') +
      ' not filled: blank in the file, so ArcGIS shows them blank until typed. A blank is better than last month\'s number.' : ''));
  });
  $('rp-load').addEventListener('click', () => $('rp-load-file').click());
  $('rp-load-file').addEventListener('change', async () => {
    const file = $('rp-load-file').files[0];
    $('rp-load-file').value = '';
    if (!file) return;
    if (file.size > 1e6) { fileNote('warn', '"' + file.name + '" is too big to be a report text saved from this page.'); return; }
    const date = state.reportDate || todayIso(), got = RF.fromFile(await file.text(), state.type, date);
    if (got.error) { fileNote('warn', '"' + file.name + '": ' + got.error); return; }
    state.reportText = got.text;
    // Page 2's numbers, dates and pictures start empty for another report date (its figures kept to compare with).
    if (got.cleared) RF.clearPictures();
    renderReport();
    const D = W.emergencyReport.dateLong;
    fileNote(got.notes.length ? 'warn' : '', 'Loaded "' + file.name + '"' + (got.reportDate ? ', the report text of ' + D(got.reportDate) : '') +
      '. The numbers are this table\'s.' + (got.cleared ? ' Page 2\'s numbers, dates and pictures are left empty for ' + D(date) +
        ': type this month\'s; last month\'s are kept to check them against.' + (got.reportDate ? ' To go on with that report ' +
        'instead, set the report date to ' + D(got.reportDate) + ' and load the file again.' : '') : '') + (got.notes.length ? ' ' + got.notes.join(' ') : ''));
  });
  // The print window's title names the PDF ("HPAI update 2026-09-01.pdf"); the page's own title comes back after.
  $('rp-print').addEventListener('click', () => {
    const was = document.title;
    document.title = RV.title(state.type, state.reportDate || todayIso());
    root.addEventListener('afterprint', () => { document.title = was; }, { once: true });
    root.print();
  });
  root.addEventListener('resize', () => {
    if (state.view !== 'report') return;
    RV.fit($('rp-preview'));
    if (state.reportMode === 'figures') RFG.refit();
  });
  // The pages measured again once the brand font is in (the fallback font's lines are a different length).
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (state.view === 'report') renderReport(); });

  // The 2020 Census tracts for the people estimate: the population density layer's file (shared/population.js),
  // loaded the first time the Overview needs it and decoded once. While it loads the people box says so.
  const tracts = { list: null, year: null, loading: false, failed: false };
  function tractsData(data) {
    tracts.list = data.tracts.map(t => ({ geoid: t.geoid, pop: t.pop, coordinates: PN.geometry(t).coordinates }));
    tracts.year = data.year || null;
  }
  function overviewTracts() {
    if (tracts.list || tracts.loading || tracts.failed) return tracts;
    const have = PN.loaded('density');
    if (have) { tractsData(have); return tracts; }
    tracts.loading = true;
    PN.load('density', { base: '../' }).then(data => {
      tracts.loading = false;
      tractsData(data);
      if (state.view === 'overview') renderOverview();
    }, () => {
      tracts.loading = false;
      tracts.failed = true;
      if (state.view === 'overview') renderOverview();
    });
    return tracts;
  }
  // The people inside the zones drawn on the map (the current positives' and added points' rings, or the zone
  // set's zones; never the past zones), worked out again only when the zones change. While the play runs or the
  // slider moves, the zones change at every step: the people are worked out once it stops (PEOPLE_IDLE_MS after the
  // last move), "Working out…" meanwhile, so a step never waits on them.
  const PEOPLE_IDLE_MS = 250;
  let peopleMemo = { zones: null, key: null, value: null }, peopleTimer = null, slidAt = 0;
  const moving = () => state.playing || Date.now() - slidAt < PEOPLE_IDLE_MS;
  function peopleLater() {
    root.clearTimeout(peopleTimer);
    peopleTimer = root.setTimeout(() => { peopleTimer = null; if (state.view === 'overview') renderOverview(); }, PEOPLE_IDLE_MS);
  }
  function peopleNow() {
    const zp = state.zoneParts, t = overviewTracts();
    if (!t.list) return { value: null, waiting: t.loading };
    const zones = zp.show !== 'rings' ? state.zonesVersion : null;   // the zone set's shapes (an edit counts them again)
    const key = zp.sites.map(x => x.lat + ',' + x.lon + ',' + x.bufferKm).join(';');
    if (peopleMemo.zones !== zones || peopleMemo.key !== key) {
      if (moving()) { peopleLater(); return { value: null, waiting: true }; }
      peopleMemo = { zones, key, value: E.peopleInside(zp.sites, t.list, { year: t.year, counties: root.CVIWA_GEO.counties.features }) };
    }
    return { value: peopleMemo.value };
  }

  // A value box of the Overview: its number (or what it needs) and its note.
  function setOverviewBox(id, b, number) {
    const card = $(id), strong = card.querySelector('strong');
    card.classList.toggle('na', b.value === null);
    if (b.value === null) strong.textContent = b.reason;
    else if (number) strong.replaceChildren(...number);
    else strong.textContent = typeof b.value === 'number' ? b.value.toLocaleString('en-US') : b.value;
    card.querySelector('.card-note').textContent = b.value === null ? '' : b.note || '';
  }
  // The colors of a zone file's zones in the layer bars (the map draws them all in one red).
  const ZONE_COLORS = ['#cb181d', '#fd8d3c', '#6a51a3', '#2171b5', '#238b45', '#737373'];
  function renderOverview() {
    if (!state.read || state.view !== 'overview') return;
    const read = state.read, win = state.window, counties = root.CVIWA_GEO.counties.features;
    const people = peopleNow();
    const rows = E.countyRows(read, win, counties);
    const boxes = E.overviewBoxes(read, win, counties, people.value);
    if (people.waiting) boxes.people = { value: null, reason: 'Working out…', note: null };
    else if (tracts.failed) boxes.people = { value: null, reason: 'Not available: the Census tracts could not be loaded', note: null };
    renderColumnsBy();
    const kinds = byAnimal() ? kindSeries() : null;
    const bars = E.overviewBars(rows, state.result, kinds ? kinds.map(s => s.kind) : null), positives = E.positiveRows(read, win, counties);
    state.overview = { boxes, people: people.value, rows, bars, positives, columnsBy: kinds ? 'animal' : 'status' };   // test hook
    // The counties box's name by the view: "Counties with an active positive", or "Counties with a positive detected".
    const range = state.viewKind === 'range';
    $('ov-counties-words').textContent = range ? 'Counties with a positive' : 'Counties with an active';
    $('ov-counties-last').textContent = range ? 'detected' : 'positive';
    $('ov-time-help').textContent = range ? 'One column per week, to today. The band is the dates; click a column to see that week alone.'
      : 'One column per week, to today. The line is the day; click a column to move the day to its end.';
    setOverviewBox('ov-box-counties', boxes.counties);
    setOverviewBox('ov-box-animals', boxes.animals);
    // "~" for "about": the "~" hidden from screen readers, which hear "about".
    const tilde = el('span', null, '~');
    tilde.setAttribute('aria-hidden', 'true');
    setOverviewBox('ov-box-people', boxes.people, boxes.people.value === null ? null
      : [tilde, el('span', 'sr-only', 'about '), document.createTextNode(boxes.people.value.toLocaleString('en-US'))]);
    renderChart();
    // The bars by county: active solid in the type's first status color, closed hollow, as in the time chart.
    const color = state.type.statuses[0].color, countyBox = $('ov-county-chart'), layerBox = $('ov-layer-chart');
    // A part's key: a layer's ring or zone kept apart by its kind (3b: a zone named as a ring), a county's as it is.
    const partKey = x => (x.ring === undefined ? '' : x.ring ? 'ring\r' : 'zone\r') + x.key;
    const valuesOf = r => ({ label: r.label, values: Object.fromEntries(r.parts.map(x => [partKey(x), x.value])), total: r.total });
    const noneText = state.viewKind === 'range' ? 'No positives detected between these dates.' : 'No positives by this day.';
    if (!rows.length) countyBox.replaceChildren(el('p', 'muted', noneText));
    else {
      // By animal (2.8), the kinds' parts, with the key always (as the time chart's).
      countyBox.innerHTML = CH.bars({ title: kinds ? 'Positives by county, by animal' : 'Positives by county', rows: bars.counties.map(valuesOf),
        key: !!kinds, series: kinds ? kinds.map(s => Object.assign({ key: s.kind }, s))
          : [{ key: 'current', label: 'active', name: 'Active', fill: color },
            { key: 'past', label: 'closed', name: 'Closed', outline: true, stroke: color }] }, { width: countyBox.clientWidth });
    }
    // The bars by layer: one part per ring (in its color) and per zone (Both, 3b: the rings' parts first, the zones in
    // the colors the rings do not use).
    if (!bars.layers.length) layerBox.replaceChildren(el('p', 'muted', 'Not available: needs a facility layer'));
    else {
      const parts = bars.layers[0].parts, rings = parts.filter(x => x.ring).length;
      const ringColors = rings ? (state.rings || []).map(r => r.color) : [];
      // With every color a ring's (a type of six rings), the zones in the last, gray.
      const free = ZONE_COLORS.filter(c => !ringColors.includes(c));
      const zoneFill = k => (free.length ? free[k % free.length] : ZONE_COLORS[ZONE_COLORS.length - 1]);
      const series = parts.map((x, i) => ({ key: partKey(x), name: x.key, label: 'in ' + (x.ring ? 'the ' : '') + x.key,
        fill: x.ring ? ringColors[i] || ZONE_COLORS[0] : zoneFill(i - rings) }));
      // The key always, so a zone file's one zone is named too.
      layerBox.innerHTML = CH.bars({ title: 'Sites inside the zones by layer', series, key: true, rows: bars.layers.map(valuesOf) },
        { width: layerBox.clientWidth });
    }
    // The two tables; the animals' text under its heading at the right, as the numbers are.
    const none = () => [el('p', 'muted', noneText)];
    const ct = tableOf(['County', 'Active', 'Closed', 'Total', 'Animals (active)'],
      rows.map(r => [r.county, r.current, r.past, r.total, r.animalsText]));
    ct[0].querySelectorAll('tr').forEach(tr => { if (tr.children.length === 5) tr.lastChild.classList.add('num'); });
    $('ov-counties-table').replaceChildren(...(rows.length ? ct : none()));
    $('ov-positives-table').replaceChildren(...(positives.rows.length ? tableOf(positives.columns, positives.rows) : none()));
  }

  // The legend: the positives by status, the past positives and their rings when shown, the rings or zones, the
  // ticked layers, then the population layers drawn (as Infrastructure's legend shows them). Its last arguments are
  // kept, so a population switch redraws it without working the results out again.
  let legendArgs = null;
  // A shape of the animals' rows: white inside, a gray edge, the size of a legend dot.
  function animalMark(shape) {
    const s = el('span', 'lg-animal');
    s.dataset.shape = shape;
    s.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="' + F.markPath(shape, 7, 7, 5.5) +
      '" fill="#ffffff" stroke="#444444" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    return s;
  }
  function renderLegend(show, g, pastRings, cvi) {
    const box = $('em-legend-content'), lines = [];
    const line = (mark, text) => { const p = document.createElement('p'); p.append(mark, document.createTextNode(text)); lines.push(p); };
    const swatch = (cls, color, fill) => {
      const s = document.createElement('span');
      s.className = cls; s.style.borderColor = color; s.style.backgroundColor = fill;
      return s;
    };
    if (state.read) {
      const shown = g.current.concat(closedShown() ? g.past : []);
      for (const c of E.statusChoices(state.type, shown).filter(x => x.count)) {
        line(swatch('lg-dot', c.color || NO_STATUS, c.color || NO_STATUS), c.label);
      }
      if (closedShown() && g.past.length) line(swatch('lg-dot', NO_STATUS, '#ffffff'), 'Closed (hollow, faded)');
    }
    // The rings' rows (Rings and Both, 3b), then the zone file's row (its zone's name, or "n zones") and the drawn
    // zones' row, dashed (2.6; Zones and Both).
    if (show !== 'zones' && state.rings && state.read) {
      state.rings.forEach(r => line(swatch('lg-ring', r.color, 'transparent'), r.label + ' (' + ringDistance(r) + ')'));
    }
    if (show !== 'rings') {
      const z = fileZones(), d = state.drawn;
      if (z.length) line(swatch('lg-ring', '#cb181d', 'rgba(203, 24, 29, 0.16)'), z.length === 1 ? z[0].name : plural(z.length, 'zone', 'zones'));
      if (d.length) {
        const s = swatch('lg-ring', '#cb181d', 'rgba(203, 24, 29, 0.16)');
        s.classList.add('dashed');
        line(s, d.length === 1 ? d[0].name + ' (drawn)' : plural(d.length, 'drawn zone', 'drawn zones'));
      }
    }
    if (pastRings) line(el('span', 'lg-past-ring'), 'Closed zones (dashed)');
    // The animals by the marks' shapes (2.4), for the kinds among the positives drawn.
    const kinds = state.read ? E.animalKeys(state.type, g.current.concat(closedShown() ? g.past : [])) : [];
    if (kinds.length) {
      const head = el('p', 'lg-pc-head');
      head.append(el('strong', '', 'Animals'));
      lines.push(head);
    }
    for (const k of kinds) line(animalMark(k.shape), k.legend);
    // The CVI premises drawn (2.6, with the tick on): hollow, an origin's and a destination's color (before the
    // layers, as in the map picture's key); none while they wait or when none is in a zone.
    const ends = (cvi || []).map(q => q.end);
    if (ends.length) {
      const head = el('p', 'lg-pc-head');
      head.append(el('strong', '', 'CVI premises'));
      lines.push(head);
      // Species picked under "Refine by species" (2.8): a funnel before each row, as before a filtered layer.
      const cviMark = color => {
        const mark = document.createDocumentFragment();
        mark.append(swatch('lg-dot', color, '#ffffff'));
        if (cviRefined()) mark.append(funnelMark());
        return mark;
      };
      if (ends.includes('origin')) line(cviMark(CVI_COLORS.origin), 'Origin in a zone');
      if (ends.includes('dest')) line(cviMark(CVI_COLORS.dest), 'Destination in a zone');
    }
    // A filtered layer has a funnel before its name (2.8), said once under the layers.
    const filtered = state.selectedLayers.filter(k => state.layers[k] && isFiltered(k));
    for (const k of state.selectedLayers) {
      const l = state.layers[k];
      if (!l) continue;
      const mark = document.createDocumentFragment();
      mark.append(F.markElement(l.layer, 14));
      if (filtered.includes(k)) mark.append(funnelMark());
      line(mark, l.label);
    }
    if (filtered.length || (ends.length && cviRefined())) line(funnelMark(), 'Filtered: some sites left out');
    const pc = PN.legendEntries(pcDrawn(), PN.DEFAULT_RAMP);
    if (pc.length) {
      const head = el('p', 'lg-pc-head');
      head.append(el('strong', '', 'Population context'));
      lines.push(head);
    }
    for (const e of pc) {
      if (e.type === 'title') { lines.push(el('p', 'legend-note', e.label)); continue; }
      const mark = el('span', e.type === 'line' ? 'lg-pc-line' + (e.dash ? ' dashed' : '') : 'lg-pc-swatch');
      if (e.type !== 'line') {
        mark.style.backgroundColor = e.color;
        mark.style.opacity = String(PN.DENSITY_OPACITY);
      }
      line(mark, e.label);
    }
    box.replaceChildren(...lines);
    $('em-legend').hidden = !lines.length;
  }

  // The funnel of a filtered layer, as the map picture's key draws it (branded.js FUNNEL).
  function funnelMark() {
    const s = document.createElement('span');
    s.className = 'lg-funnel';
    s.setAttribute('role', 'img'); s.setAttribute('aria-label', 'filtered');
    s.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="' + W.emergencyBranded.FUNNEL
      + '" fill="#555555"/></svg>';
    return s;
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
    columns.forEach((c, j) => head.append(el('th', rows.some(r => typeof r[j] === 'number') ? 'num' : null, c)));
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
  // A count line with its layer's name in bold ("Dairies: 1 in the Infection zone"); with a zone file and sites in
  // more than one zone, the count and the number of zones ("Dairies: 2 in 2 zones"), the table naming each zone.
  function countLine(s) {
    const zones = s.mode === 'zones' && s.inside ? s.byZone.filter(z => z.count) : [];
    const line = zones.length > 1 ? s.label + ': ' + s.inside + ' in ' + zones.length + ' zones' :
      E.countLine(s, state.unit, isFiltered(s.key) && !state.layers[s.key].points.length);
    const at = line.indexOf(': ');
    const frag = document.createDocumentFragment();
    frag.append(el('strong', null, line.slice(0, at)), document.createTextNode(line.slice(at)));
    return frag;
  }

  // The "Zones" list: one row per positive with zones (its outer ring) or per zone-file zone, with its last positive
  // and the days since, the longest-quiet zone last (the rows of zones.csv).
  const zoneTable = () => E.zoneRows(state.days.sites, { zonesMode: state.days.zonesMode, rings: state.rings,
    unit: state.unit, asOf: state.days.asOf });
  function zonesList() {
    const d = state.days;
    if (!d || !d.sites.length) return null;
    const fold = el('details', 'em-layer em-zones-list'), sum = el('summary');
    fold.open = true;
    // Ring zones are named by their positive, the ring said once in the header ("in each positive's Infection
    // zone (6 km)"); zone-file zones by their own names. The dates written out.
    const t = zoneTable(), first = t.rows[0];
    const ring = d.show === 'rings' && first && first[1]
      ? first[2] + ' (' + Number(first[3].toFixed(2)) + ' ' + first[4] + ')' : null;
    sum.append(el('strong', null, 'Zones'), document.createTextNode(': days since the last positive' +
      (ring ? ' in each positive\'s ' + ring : '') + (d.asOf ? ', as of ' + E.dayLabel(d.asOf) : '')));
    // A zone with no dated positive inside (a positive without a date) says so, rather than empty cells.
    const table = tableOf([ring ? 'Positive' : 'Zone', 'Last positive', 'Days since'],
      t.rows.map(r => [ring ? r[1] : r[0], r[5] ? E.dayLabel(r[5]) : 'no date', r[5] ? r[6] : 'unknown']));
    // A column with no value in any row is left out by tableOf, so the cells are found by their headings.
    const heads = [...table[0].querySelectorAll('th')].map(th => th.textContent);
    const dateAt = heads.indexOf('Last positive'), daysAt = heads.indexOf('Days since');
    for (const tr of table[0].querySelectorAll('tbody tr')) {
      const date = tr.children[dateAt], days = tr.children[daysAt];
      if (date) {
        date.className = 'date';
        if (date.textContent) date.dataset.label = 'Last positive';
      }
      if (days && /^\d+$/.test(days.textContent)) {
        days.append(el('span', 'narrow-only', days.textContent === '1' ? ' day' : ' days'));
      }
    }
    table[0].classList.add('stack-narrow');
    fold.append(sum, ...table);
    return fold;
  }
  // The rows of the positives file that could not be mapped, folded, with the reason.
  function notMappedList() {
    const dropped = state.read.dropped;
    if (!dropped.length) return null;
    const fold = el('details', 'em-leftout em-notmapped'), sum = el('summary');
    sum.append(el('strong', null, 'Not mapped'), document.createTextNode(': ' +
      plural(dropped.length, 'positive', 'positives') + ' without usable coordinates'));
    const table = tableOf(['Positive', 'County', 'Detected', 'Reason'],
      dropped.map(p => [p.name, p.county, p.detected ? E.dayLabel(p.detected) : '', p.reason]));
    // On a narrow screen each cell after the name says its column.
    const heads = [...table[0].querySelectorAll('th')].map(th => th.textContent);
    for (const tr of table[0].querySelectorAll('tbody tr')) {
      [...tr.children].forEach((td, j) => { if (j && td.textContent) td.dataset.label = heads[j]; });
    }
    table[0].classList.add('stack-narrow');
    fold.append(sum, ...table);
    return fold;
  }

  // "Inside the zones": the "Zones" list and the rows not mapped; then per ticked layer a fold, its count line as the
  // header and its sites nearest first; a layer with nothing inside gets its one line with the nearest site; then
  // the sites left out, folded.
  function renderInside() {
    const box = $('tab-inside'), r = state.result;
    box.replaceChildren();
    if (!state.read) { box.append(el('p', 'muted', 'Load a positives file to see what lies inside its zones.')); return; }
    // With no kind ticked the message comes first; a drawn zone or a zone file's zone is still listed with its sites.
    if (noAnimals()) {
      box.append(el('p', 'muted', 'Tick at least one kind of animal.'));
      if (!state.days || !state.days.sites.length) return;
    }
    for (const part of [zonesList(), notMappedList()]) if (part) box.append(part);
    if (!r || !r.layers.length) {
      box.append(el('p', 'muted', 'Tick a layer under "Layers to check" to see its sites inside the zones.'));
      return;
    }
    const km = 'Distance (' + E.UNITS[state.unit].label + ')';
    const shownKm = x => E.round2(E.fromKm(x.exactKm, state.unit));
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
      // Zones: a site is inside a polygon (no distance), and the zone is the site it was matched to. Both (3b): a
      // zone's rows (rules.js inside's inZone) with no distance, under "Positive or zone".
      const zoneRow = x => x.inZone;
      d.append(sum, ...(s.mode === 'zones'
        ? tableOf(['Site', 'Zone', 'County', 'Town'], rows.map(x => [x.name, x.zone, x.county, x.town]))
        : tableOf(['Site', km, 'Zone', s.mode === 'both' ? 'Positive or zone' : 'Positive', 'County', 'Town'],
          rows.map(x => [x.name, zoneRow(x) ? '' : shownKm(x), x.zone, x.siteName, x.county, x.town]))));
      box.append(d);
    }
    if (r.leftOut.length) {
      const d = el('details', 'em-leftout'), sum = el('summary');
      // The reasons stay in the table's Reason column.
      sum.append(el('strong', null, 'Left out'), document.createTextNode(': ' +
        plural(r.leftOut.length, 'site', 'sites') + ' located only roughly'));
      d.append(sum, ...tableOf(['Layer', 'Site', 'Reason', 'County', 'Town'],
        r.leftOut.map(x => [x.layerLabel, x.name, x.reason, x.county, x.town])));
      box.append(d);
    } else if (state.includeCoarse) {
      box.append(el('p', 'muted', 'Locations known only roughly are included (More options).'));
    }
  }

  // ---- CVI movements ---------------------------------------------------------------------------------------------
  // The zones as Premise Lookup's sites: one per positive with zones and added point (its rings as the bands), the
  // zone set's polygons, or both (3b; a zone site matches inside its polygon only, whatever the bands); then CVI's
  // query with the years, quarters and species groups ticked, the movement's end picked (2.8, Either at each load) and
  // the master's rows narrowed to the species picked under "Refine by species" (2.8, rules.js cviRows). The map, the
  // tab, the map picture and the Export all read this one result.
  // 2.6: the CVI movements count only with the tick "CVI movements" on (off at every load), a master read and a
  // positives file: the map, the picture and the Export then show them.
  const cviOn = () => !!(state.cviOn && state.master && state.read);
  // The CVI query's result for the map: worked out once per change; none with a filter left empty. While the play
  // runs or the slider moves (state.sliding, until PEOPLE_IDLE_MS after its last move) the query over the whole
  // master waits, as the tab's does; the play's stop and the slider's rest draw the map once more with them.
  function cviResult() {
    const c = state.cvi;
    if (!cviOn() || state.playing || state.sliding || !c.years.length || !c.quarters.length || !c.species.length) return null;
    if (state.cviKey === null) { state.cviRes = cviQuery(); state.cviKey = state.version; }
    return state.cviRes;
  }
  // The CVI premises the map draws (with the tick on): each matched movement's origin or destination inside a zone,
  // a spot that is both drawn as two rings, the destination's around the origin's. The hover says its place and its
  // CVIs' numbers as the CVI movements table writes them, so its rows can be found there (the first three, then how
  // many more).
  const CVI_IDS_SHOWN = 3;
  function cviMarks() {
    const res = cviResult(), ends = E.cviEnds(res ? res.matched : []);
    const ids = s => s.ids.slice(0, CVI_IDS_SHOWN).join(', ') + (s.ids.length > CVI_IDS_SHOWN ? ' and ' + (s.ids.length - CVI_IDS_SHOWN) + ' more' : '');
    const label = (end, s) => 'CVI premises\n' + end + ' in a zone' + (s.place ? ' \u00b7 ' + s.place : '') + '\n' +
      plural(s.cvis, 'CVI', 'CVIs') + ': ' + ids(s);
    const origins = new Set(ends.origins.map(s => s.lat + ',' + s.lon));
    return ends.origins.map(s => ({ lat: s.lat, lon: s.lon, color: CVI_COLORS.origin, r: 10, end: 'origin', label: label('Origin', s) }))
      .concat(ends.dests.map(s => ({ lat: s.lat, lon: s.lon, color: CVI_COLORS.dest, r: origins.has(s.lat + ',' + s.lon) ? 14 : 10,
        end: 'dest', label: label('Destination', s) })));
  }
  function cviQuery() {
    const show = shown(), zonesMode = show === 'zones', c = state.cvi;
    const polygons = show === 'rings' ? [] : allZones().map(z => ({ name: z.name, lat: z.point[1], long: z.point[0], zone: z.geometry }));
    const sites = (zonesMode ? [] : zonePositives().map(p => ({ name: p.name, lat: p.lat, long: p.lon }))).concat(polygons);
    const distances = (state.rings || []).map(r => E.toKm(r.distance, state.unit));
    const opts = { endpoint: E.cviEndOf(c.end).key, filters: { year: c.years, quarter: c.quarters, species: c.species } };
    if (zonesMode) opts.defaultKm = 0;
    else Object.assign(opts, { defaultKm: Math.max(...distances), bands: distances });
    return Lk.query(E.cviRows(state.master, c.rawSpecies), sites, opts);
  }
  // Species are picked under "Refine by species" (and the master has a Species column): the legend puts a funnel
  // before the CVI premises, as before a filtered layer; the map picture's key does not.
  const cviRefined = () => !!(state.master && state.master.hasSpecies && state.cvi.rawSpecies.length);
  // A ticked list of the CVI tab's filters; none ticked shows no movement.
  function renderFilter(id, values, picked, key) {
    const box = $(id), legend = box.querySelector('legend');
    box.replaceChildren(legend);
    values.forEach(v => {
      const label = el('label'), input = el('input');
      input.type = 'checkbox'; input.value = String(v); input.checked = picked.includes(v);
      input.addEventListener('change', () => {
        state.cvi[key] = values.filter(x => box.querySelector('input[value="' + CSS.escape(String(x)) + '"]').checked);
        // A species picked under "Refine by species" whose group is no longer ticked drops out (CVI's rule).
        if (key === 'species') {
          const offered = E.cviSpeciesIn(state.master, state.cvi.species);
          state.cvi.rawSpecies = state.cvi.rawSpecies.filter(x => offered.includes(x));
        }
        compute();   // the map's CVI premises and the tab
      });
      label.append(input, document.createTextNode(' ' + v));
      box.append(label);
    });
  }
  // "Refine by species" in the CVI movements tab (2.8, as CVI's; closed at each load): the raw species within the
  // groups ticked (rules.js cviSpeciesIn), none ticked meaning every species of those groups. Past 30 species a search
  // box narrows the list (the picks kept). Hidden for a master without a Species column.
  function renderCviRefine() {
    const list = $('cvi-refine-list'), c = state.cvi;
    const names = E.cviSpeciesIn(state.master, c.species);
    $('cvi-refine').hidden = !names.length;
    $('cvi-refine-sum').textContent = c.rawSpecies.length ? ' \u00b7 ' + c.rawSpecies.length + ' of ' + plural(names.length, 'species', 'species') : '';
    const search = $('cvi-refine-search');
    search.hidden = names.length <= SPECIES_SEARCH;
    if (search.hidden) search.value = '';
    const find = search.value.trim().toLowerCase();
    list.replaceChildren(list.querySelector('legend'));
    for (const name of names.filter(x => !find || x.toLowerCase().includes(find))) {
      const label = el('label'), input = el('input');
      input.type = 'checkbox'; input.value = name; input.checked = c.rawSpecies.includes(name);
      input.addEventListener('change', () => {
        const next = input.checked ? c.rawSpecies.concat(name) : c.rawSpecies.filter(x => x !== name);
        c.rawSpecies = names.filter(x => next.includes(x));   // in the list's order
        compute();   // the map's CVI premises and the tab
      });
      label.append(input, document.createTextNode(' ' + name));
      list.append(label);
    }
    if (find && list.children.length === 1) list.append(el('p', 'help-note', 'No species matches "' + search.value.trim() + '".'));
  }
  $('cvi-refine-search').addEventListener('input', renderCviRefine);
  // "Movement's end in a zone" (2.8, as Premise Lookup's "Match endpoint"): Either, Origin or Destination.
  document.querySelectorAll('input[name="cvi-end"]').forEach(r => r.addEventListener('change', () => {
    if (!r.checked) return;
    state.cvi.end = r.value;
    compute();   // the map's CVI premises and the tab
  }));
  function renderCvi() {
    const gate = $('cvi-gate'), body = $('cvi-body');
    const reason = !state.datasets.master ? 'CVI movements need a CVI master (CVI_Consolidated_Master.csv): load it under "Load your data".'
      : !state.master ? 'The CVI master could not be read: ' + state.masterReason
        : !state.read ? 'Load a positives file first.'
          : !state.cviOn ? 'CVI movements are off: tick "CVI movements" under "Layers to check" to include them.' : null;
    gate.hidden = !reason;
    gate.textContent = reason || '';
    body.hidden = !!reason;
    if (reason) { state.cviRes = null; return; }
    const m = state.master, c = state.cvi;
    renderFilter('cvi-years', m.yearChoices, c.years, 'years');
    renderFilter('cvi-quarters', QUARTERS, c.quarters, 'quarters');
    renderFilter('cvi-species', m.speciesChoices, c.species, 'species');
    renderCviRefine();
    const end = E.cviEndOf(c.end);
    document.querySelector('input[name="cvi-end"][value="' + end.key + '"]').checked = true;
    const out = $('cvi-result');
    out.replaceChildren();
    // While the play runs, CVI's query over the whole master waits, so each step stays quick.
    if (state.playing) {
      out.append(el('p', 'muted', 'The CVI movements are worked out when the play stops.'));
      return;
    }
    if (!c.years.length || !c.quarters.length || !c.species.length) {
      state.cviRes = null;
      out.append(el('p', 'muted', 'Tick at least one year, quarter and species group.'));
      return;
    }
    if (state.cviKey === null) { state.cviRes = cviQuery(); state.cviKey = state.version; }
    const res = state.cviRes;
    const these = cviRefined() ? 'these years, quarters, species groups and species' : 'these years, quarters and species groups';
    const said = {
      empty_sites: 'No zones to check: tick a status under "Positives and zones", add a point or use a zone file.',
      no_filter_match: 'No movement in the CVI master has ' + these + '.',
      missing_coord_cols: 'CVI movements need the columns ' + listOf(['Origin.Lat', 'Origin.Long', 'Dest.Lat', 'Dest.Long']) +
        ' in the CVI master.',
      no_match: 'No CVI movement ' + end.words + ' with ' + these + '.'
    };
    if (res.status !== 'ok') { out.append(el('p', 'result-line', said[res.status] || res.status)); return; }
    const sm = res.summary, n = x => x.toLocaleString('en-US');
    const line = el('p', 'result-line');
    // The ends counted: with Origin only the origins inside, with Destination only the destinations.
    const counted = (end.key === 'dest' ? [] : [plural(sm.origins, 'origin', 'origins')])
      .concat(end.key === 'origin' ? [] : [plural(sm.dests, 'destination', 'destinations')]);
    line.append(el('strong', null, plural(sm.cvis, 'CVI', 'CVIs')), document.createTextNode(', ' + n(sm.animals) +
      ' animals, ' + end.words + ': ' + counted.join(' and ') + ' inside.'));
    out.append(line);
    const where = (r, side) => [r[side + '.County'], r[side + '.State']].filter(v => v !== null && v !== undefined && v !== '').join(', ');
    // CVI's query gives the nearest distance in km, rounded to 0.01; in miles it is turned from that value.
    const nearest = r => (r.nearestSiteKm === null || r.nearestSiteKm === undefined ? null
      : state.unit === 'km' ? r.nearestSiteKm : E.round2(E.fromKm(r.nearestSiteKm, state.unit)));
    out.append(...tableOf(['CVI', 'Year', 'Quarter', 'Species group', 'Animals', 'From', 'To', 'Zones',
      'Nearest (' + E.UNITS[state.unit].label + ')'],
    res.matched.map(r => [r.CVI, r['Reporting.Year'] === null ? '' : String(r['Reporting.Year']), r['Reporting.Quarter'], r['Species.Group'], r['Total.Animals'],
      where(r, 'Origin'), where(r, 'Dest'), r.matchedSites, nearest(r)])));
  }

  // ---- Export ----------------------------------------------------------------------------------------------------
  // One ZIP: positives.csv, counties.csv (the Overview's counties table, 2.3), inside_the_zones.csv, layers.csv,
  // left_out.csv, zones.csv (the "Zones" list),
  // zones.geojson (every zone drawn, rules.js zonesGeoJson), cvi_movements.csv (with a master; CVI's matched rows
  // without any column whose name holds address, location, street or premise) and export_params.json; text columns
  // with CVI's formula guard. The folder and the ZIP are named YYYY-MM-DD_Emergency, or YYYY-MM-DD_<name> with an
  // "Optional Filename" (2.4, CVI's rule).
  function csvOf(table) {
    const types = {};
    table.columns.forEach((c, j) => {
      const v = table.rows.map(r => r[j]).find(x => x !== null && x !== undefined && x !== '');
      types[c] = typeof v === 'number' ? 'double' : 'character';
    });
    const rows = table.rows.map(r => Object.fromEntries(table.columns.map((c, j) => [c, r[j] === '' ? null : r[j]])));
    return X.csv(table.columns, rows, types, true);
  }
  // zones.geojson: every zone drawn, as rules.js zonesGeoJson writes it: the current positives' rings, the points
  // added on the map, the past positives' rings when drawn, and the drawn zones; or the zone set's zones (a zone file's
  // and the drawn ones); or (Both, 3b) the rings and the zone set's zones.
  const isAdded = s => String(s.positive).indexOf('added-') === 0;
  function zonesGeoJson() {
    const zp = state.zoneParts, ringSites = zp.sites.slice(0, zp.ringCount);
    // With the rings only, the drawn zones are written too (2.6), so the file keeps them (they are not stored).
    const parts = zp.zonesMode ? { zones: zp.sites } : { rings: [{ sites: ringSites.filter(s => !isAdded(s)), group: 'Active' },
      { sites: ringSites.filter(isAdded), group: 'Added point' }, { sites: zp.pastSites, group: 'Closed' }],
    zones: zp.show === 'both' ? zp.sites.slice(zp.ringCount) : state.drawn.length ? E.zoneSites(state.drawn) : [] };
    return E.zonesGeoJson(parts, { rings: state.rings || [], unit: state.unit, asOf: windowEnd(), positives: zp.counted });
  }
  // export_params.json's zones: "zone file zones.geojson", "zones zones.geojson and 2 drawn", "zones 2 drawn zones".
  const zonesParam = () => (state.drawn.length ? 'zones ' + E.zonesNamed(state.zoneFile ? state.zoneFile.name : null, state.drawn.length)
    : 'zone file ' + state.zoneFile.name);
  $('em-export').addEventListener('click', () => {
    const now = new Date(), folder = X.localDate(now) + '_' + (EB.safeLabel($('em-png-label').value) || 'Emergency');
    if (!state.read) { say('em-export-result', 'warn', 'Load a positives file before exporting.'); return; }
    if (noAnimals()) { say('em-export-result', 'warn', 'Tick at least one kind of animal.'); return; }
    const r = state.result || { rows: [], layers: [], leftOut: [] };
    const t = E.exportRows(state.read, state.targets, r, state.unit, state.window);
    const entries = [{ name: folder + '/', dir: true }], written = [];
    const add = (name, text) => { entries.push({ name: folder + '/' + name, data: text }); written.push(name); };
    add('positives.csv', csvOf(t.positives));
    add('counties.csv', csvOf(E.countyTable(state.read, E.countyRows(state.read, state.window, root.CVIWA_GEO.counties.features))));
    add('inside_the_zones.csv', csvOf(t.inside));
    // Each layer's filters in words (2.8), where the map and its picture draw a funnel.
    add('layers.csv', csvOf({ columns: t.layers.columns.concat(['Filters']),
      rows: t.layers.rows.map((row, i) => row.concat([filtersText(r.layers[i].key)])) }));
    add('left_out.csv', csvOf(t.leftOut));
    add('zones.csv', csvOf(zoneTable()));
    add('zones.geojson', JSON.stringify(zonesGeoJson()) + '\n');
    if (cviOn()) {
      if (state.cviKey === null) { state.cviRes = cviQuery(); state.cviKey = state.version; }
      const header = state.master.header.filter(h => !E.PRIVATE.test(h));
      add('cvi_movements.csv', X.lookupMatchesCsv({ header, rows: state.master.rows }, state.cviRes).text);
    }
    const show = shown(), zonesMode = show === 'zones';
    const ringsParam = () => 'rings ' + (state.rings || []).map(x => x.label + ' ' + ringDistance(x)).join(', ');
    const params = {
      tool: 'emergency_response',
      emergency_type: state.type.name,
      positives_file: state.datasets.positives ? state.datasets.positives.name : '',
      zones: zonesMode ? zonesParam() : show === 'both' ? ringsParam() + '; ' + zonesParam() : ringsParam(),
      ...E.drawnParams(state.drawn, show),
      statuses_with_zones: state.ticks.statuses.map(k => k === 'none' ? 'No status' : k),
      ...E.viewParams(state.window),
      as_of: windowEnd(),
      unit: state.unit,
      closed_shown: closedShown(),
      closed_rings_drawn: closedShown() && state.pastRings && !zonesMode,
      added_points: state.points.map(p => p.name + ' (' + p.lat + ', ' + p.lon + ')'),
      layers_checked: state.selectedLayers.map(k => state.layers[k] ? state.layers[k].label : k),
      layer_filters: layerFilters(),
      locations_known_only_roughly: state.includeCoarse ? 'included' : 'left out',
      cvi_master: state.datasets.master ? state.datasets.master.name : null,
      cvi_movements: state.master ? (cviOn() ? 'included' : 'off') : null,
      cvi_years: cviOn() ? state.cvi.years : null,
      cvi_quarters: cviOn() ? state.cvi.quarters : null,
      cvi_species_groups: cviOn() ? state.cvi.species : null,
      cvi_species: cviOn() ? (cviRefined() ? state.cvi.rawSpecies.slice() : 'every species of the groups ticked') : null,
      cvi_end: cviOn() ? E.cviEndOf(state.cvi.end).label.toLowerCase() : null,
      animals_shown: E.animalKindsOf(state.readAll).filter(k => state.animals.includes(k.key)).map(k => k.label),
      species_shown: state.species.length ? state.species.slice() : 'every species of the kinds shown',
      positives: state.read.positives.length,
      sites_inside: r.total || 0,
      distances: (state.unit === 'mi' ? 'miles (1 mile = 1.609344 km)' : 'km') + ', on a sphere of 6,378,137 m (CVI\'s rule)',
      export_label: $('em-png-label').value.trim(),
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

  // ---- The map picture (PNG) -------------------------------------------------------------------------------------
  // The branded page of the map as shown (branded.js, a copy of Premise Lookup's): 11 x 8.5 in, downloaded alone as
  // emergency_<type>_YYYY-MM-DD.png. Its options are in "Export & Preview": the background (Default, a tile background
  // loaded from its provider, or Streets from geo/streets-wa.js, loaded the first time it is used; with Default and a
  // notice when one cannot be), the tiles' quality, the resolution (200 or 300 dpi), and (2.4) "Name markers in PNG",
  // "Optional Filename" and "Optional Map Title". "Preview Map" shows the picture the button would save in CVI's
  // window. While the play runs, the picture shows the date shown.
  const EB = W.emergencyBranded, BR = W.branded;
  // A public copy offers only the PNG backgrounds cleared for public use (shared/release.js).
  root.WSDA.tiles.prunePickers([$('em-png-background')]);
  // The quality picker, and where the tiles come from, only for a tile background.
  function syncPngControls() {
    const T = root.WSDA.tiles;
    $('em-png-quality-field').hidden = !T.BACKGROUNDS[$('em-png-background').value];
    $('em-png-provider').textContent = T.providerLine($('em-png-background').value);
    $('em-png-provider').hidden = !$('em-png-provider').textContent;
  }
  $('em-png-background').addEventListener('change', syncPngControls);
  syncPngControls();
  // "Name markers in PNG": "Positives" (ticked by default), then each checked layer (not ticked by default), in the
  // layers' order; the picks kept by key while layers change (as CVI's), a layer no longer checked dropped.
  function renderNameMarkers() {
    const shown = [{ key: 'positives', label: 'Positives' }].concat(Object.values(state.layers)
      .filter(l => state.selectedLayers.includes(l.key)).map(l => ({ key: l.key, label: l.label })));
    state.nameLayers = state.nameLayers.filter(k => shown.some(x => x.key === k));
    $('em-name-list').replaceChildren(...shown.map(x => {
      const label = document.createElement('label'), box = document.createElement('input');
      box.type = 'checkbox'; box.value = x.key; box.checked = state.nameLayers.includes(x.key);
      label.append(box, document.createTextNode(' ' + x.label));
      return label;
    }));
  }
  $('em-name-list').addEventListener('change', () => {
    state.nameLayers = [...$('em-name-list').querySelectorAll('input:checked')].map(i => i.value);
  });
  $('em-names-all').addEventListener('click', () => {
    state.nameLayers = [...$('em-name-list').querySelectorAll('input')].map(i => i.value);
    renderNameMarkers();
  });
  $('em-names-clear').addEventListener('click', () => { state.nameLayers = []; renderNameMarkers(); });
  renderNameMarkers();
  // The choices at the click.
  function pngChoices() {
    return { background: $('em-png-background').value, quality: $('em-png-quality').value,
      resolution: $('em-png-resolution').value, nameLayers: state.nameLayers.slice(), title: $('em-png-title').value,
      label: $('em-png-label').value };
  }
  // Copied from site/cvi/app/ui.js (lines 1197 to 1204, v2.3) and lookup.js (lines 1957 to 1963): a script loaded
  // when first needed; the Streets data loaded once (a failed load is tried again next time), resolving to the data
  // or null.
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.onload = () => { s.remove(); resolve(); };
      s.onerror = () => { s.remove(); reject(new Error(src.replace(/^\.\.\//, ''))); };
      s.src = src; document.head.appendChild(s);
    });
  }
  let streetsLoading = null;
  function loadStreets() {
    if (root.WSDA_STREETS) return Promise.resolve(root.WSDA_STREETS);
    if (!streetsLoading) streetsLoading = loadScript('../geo/streets-wa.js').then(() => root.WSDA_STREETS || null, () => null);
    return streetsLoading.then(d => { if (!d) streetsLoading = null; return d; });
  }
  // The page's input: the positives shown, the zones drawn and the sites inside, as on the map; ch the choices.
  function pngInput(ch, background, streets, now) {
    const read = state.read, end = windowEnd(), zp = state.zoneParts;
    const shown = read.positives.filter(p => E.inWindow(p, state.window) && (closedShown() || !E.isPast(p, end)));
    if (cviOn() && state.cviKey === null) { state.cviRes = cviQuery(); state.cviKey = state.version; }
    const res = cviOn() && state.cviRes && state.cviRes.summary ? state.cviRes : null;
    // The CVI tab's years: a run of years as "2025–2026", else listed.
    const years = state.cvi.years.slice().sort((a, b) => a - b);
    const run = years.length > 1 && years.every((y, i) => i === 0 || Number(y) === Number(years[i - 1]) + 1);
    const yearsText = !years.length ? null : run ? years[0] + '–' + years[years.length - 1] : years.join(', ');
    const layers = {};
    state.selectedLayers.forEach(k => {
      const l = state.layers[k];
      if (l) layers[k] = { label: l.label, pngLabel: l.layer && l.layer.label, color: l.color, shape: l.shape,
        filtered: isFiltered(k) };
    });
    return { type: state.type, positives: shown.map(p => ({ name: p.name, lat: p.lat, lon: p.lon,
      color: p.status ? p.status.color : NO_STATUS, status: p.status ? p.status.label : 'No status', past: E.isPast(p, end),
      shape: E.animalShapeOf(read.type, p), shapes: E.animalShapesOf(read.type, p) })), animals: E.animalKeys(read.type, shown),
    added: state.points.map(p => ({ name: p.name, lat: p.lat, lon: p.lon })), sites: zp.sites,
    pastSites: zp.pastSites, zonesMode: zp.zonesMode, show: zp.show,
    zoneName: zp.show !== 'rings' ? E.zonesNamed(state.zoneFile ? state.zoneFile.name : null, state.drawn.length) : null,
    rings: state.rings || [], unit: state.unit, result: state.result, layers, days: state.days.sites,
    window: state.window, current: E.groups(read, state.window).current.length,
    detected: E.valueBoxes(read, null, state.window).detected.value,
    cvi: res ? { cvis: res.summary.cvis, animals: res.summary.animals, matched: res.matched || [], years: yearsText,
      end: E.cviEndOf(state.cvi.end).key } : null, counties: root.CVIWA_GEO.counties.features, date: now,
    background, streets, nameLayers: ch.nameLayers, title: ch.title, label: ch.label, synthetic: !!state.synthetic,
    animalsOnly: animalsOnly() ? 'Positives: ' + animalsOnly().toLowerCase() + ' only' : null };
  }
  // The picture: a tile background or Streets loaded first when one is picked; when it cannot be, the Default
  // background and a notice (as Infrastructure's and Premise Lookup's).
  async function pngPicture(ch, now) {
    const dpi = BR.DPI[ch.resolution] || BR.DPI.standard;
    const notices = [];
    let background = ch.background, streets = null;
    if (background === 'vector:streets') {
      streets = await loadStreets();
      if (!streets) {
        notices.push('The Streets background could not be loaded, so the Default background was used.');
        background = 'standard';
      }
    }
    let built = EB.page(pngInput(ch, background, streets, now));
    const size = BR.pixelSize(dpi);
    let under = null;
    const u = built.model.underlay;
    if (u && root.WSDA.tiles.BACKGROUNDS[ch.background]) {
      const got = await root.WSDA.tiles.load(u.key, u.extent, u.box.width * dpi / 72, u.box.height * dpi / 72,
        { zoom: u.zoom, quality: ch.quality });
      if (got) under = { image: got.image, box: u.box, mask: u.mask, how: got.how };
      else {
        notices.push('The ' + root.WSDA.tiles.BACKGROUNDS[ch.background].label + ' background could not be loaded, so ' +
          'the Default background was used.');
        built = EB.page(pngInput(ch, 'standard', null, now));
      }
    }
    const markup = BR.svg(built.parts, size, { transparent: !!under });
    const blob = under ? await BR.png(markup, size, dpi, under) : await BR.png(markup, size, dpi);
    return { blob, model: built.model, notices, dpi, size, underlay: under && { how: under.how } };
  }
  // A picture handed to the browser to save, as a PNG file.
  function savePng(name, blob) {
    const url = root.URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.hidden = true;
    document.body.appendChild(a); a.click(); a.remove();
    root.setTimeout(() => root.URL.revokeObjectURL(url), 60000);
  }
  // "Map picture (PNG)" saves the picture, "Preview Map" shows it in CVI's window ("Map preview"); while one is drawn
  // both are grayed and the one clicked reads "Drawing…".
  let drawingPng = false;
  async function drawPicture(button, done) {
    if (drawingPng) return;
    if (!state.read) { say('em-export-result', 'warn', 'Load a positives file before making a map picture.'); return; }
    if (noAnimals()) { say('em-export-result', 'warn', 'Tick at least one kind of animal.'); return; }
    const ch = pngChoices();
    const label = button.lastChild.textContent;
    drawingPng = true;
    $('em-png').disabled = $('em-preview').disabled = true;
    button.lastChild.textContent = 'Drawing…';
    try {
      done(await pngPicture(ch, new Date()));
    } catch (e) {
      say('em-export-result', 'err', 'The map picture could not be made: ' + ((e && e.message) || e));
    } finally {
      drawingPng = false;
      $('em-png').disabled = $('em-preview').disabled = false;
      button.lastChild.textContent = label;
    }
  }
  $('em-png').addEventListener('click', () => drawPicture($('em-png'), made => {
    savePng(made.model.fileName, made.blob);
    state.lastPng = { model: made.model, dpi: made.dpi, size: made.size, notices: made.notices, underlay: made.underlay,
      bytes: made.blob.size };   // test hook
    say('em-export-result', made.notices.length ? 'warn' : 'ok',
      'Saved ' + made.model.fileName + ': handed to your browser to save, usually your Downloads folder. If no file ' +
      'appears, your browser or IT policy blocked the download.' + (made.notices.length ? ' ' + made.notices.join(' ') : ''));
  }));
  $('em-preview').addEventListener('click', () => drawPicture($('em-preview'), made => {
    state.lastPreview = { model: made.model, dpi: made.dpi, notices: made.notices, bytes: made.blob.size };   // test hook
    if (made.notices.length) say('em-export-result', 'warn', made.notices.join(' '));
    else $('em-export-result').hidden = true;
    C.previews.showMap('Map preview', [{ name: made.model.fileName, blob: made.blob, alt: made.model.title }],
      'This is what the PNG will look like when exported.');
  }));

  // ---- The map and More options (copied from Infrastructure) -----------------------------------------------------
  state.prepared = F.prepare(Object.create(null), null, root.CVIWA_GEO.counties, 0);
  state.map = EM.create('em-map', root.CVIWA_GEO, () => compute(),
    () => say('em-zero', 'err', 'The map could not be drawn. Reload the page to try again.'));
  state.map.notify = msg => say('screenshot-status', 'info', msg);
  state.map.shotName = 'Emergency';   // the camera picture's name
  // The fit keeps the legend clear when it is over the map (on a phone it sits above it). Open, at its full width: the
  // population layers' rows come in after the fit and would widen it.
  state.map.legendWidth = () => {
    const lg = $('em-legend'), css = root.getComputedStyle(lg);
    if (lg.hidden || css.position !== 'absolute') return 0;
    return (lg.open ? Math.max(lg.offsetWidth, parseFloat(css.maxWidth) || 0) : lg.offsetWidth) + 8;
  };
  // The home button fits what is shown (the shared button keeps its own name elsewhere).
  const home = $('em-map').querySelector('.map-fit');
  if (home) { home.title = 'Fit to the positives shown'; home.setAttribute('aria-label', 'Fit to the positives shown'); }
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

  // ---- Draw a zone (2.6) -----------------------------------------------------------------------------------------
  // The fold under "Add a point on the map": the shape switch (Freehand | Rectangle | Square | Circle, the size box in
  // the unit shown for the square and the circle), "Draw on map" (while drawing a filled "Drawing", with Finish, Undo corner and Cancel beside it),
  // then the drawn zones, each with its name box, Edit and Remove, and its area and shape under them. Drawing and "Add
  // a point on the map" never run together. A finished zone joins the zone set; on Rings the switch goes to Both
  // (rules.js showAfter); once no zone is left it goes back to Rings. Nothing is stored: while drawn
  // zones exist the browser asks before the page is left.
  const MODE_TEXT = { freehand: 'Click the map for each corner.', rectangle: 'Click two opposite corners.',
    square: 'Click where the middle goes.', circle: 'Click where the middle goes.', edit: 'Drag a corner, or a side\u2019s middle to add a corner.' };
  // The square's size (the circle's radius) from its box, or null with the reason said.
  function squareSize() {
    const r = E.readSize($('dz-size-in').value);
    if (r.reason) { say('dz-status', 'err', r.reason); return null; }
    return r.size;
  }
  const draw = W.emergencyDraw.create(state.map, {
    unit: () => state.unit, size: squareSize, finished: addDrawn, edited: editDrawn, changed: drawChanged,
    say: (kind, text) => say('dz-status', kind, text), label: $('dz-label'), badge: $('dz-badge'), startButton: $('dz-start')
  });
  // The fold's buttons by the mode: "Drawing" with its tools (Finish and Undo corner for freehand only).
  function drawChanged(mode) {
    const drawing = !!mode && mode !== 'edit';
    $('dz-start').setAttribute('aria-pressed', String(drawing));
    $('dz-start-text').textContent = drawing ? 'Drawing' : 'Draw on map';
    $('dz-tools').hidden = !drawing;
    $('dz-finish').hidden = $('dz-undo').hidden = mode !== 'freehand';
    if (mode) say('dz-status', 'info', MODE_TEXT[mode]);
    else if ($('dz-status').classList.contains('info')) $('dz-status').hidden = true;
    renderDrawn();
    // The rings as a guide while drawing, when the zones are in their place (drawMap).
    if (drawing !== state.ringGuide) {
      state.ringGuide = drawing;
      if (shown() === 'zones' && state.rings) compute();
    }
  }
  // A change of the zone set: the switch (rules.js showAfter: 'drawn', 'edited' or 'removed'), the list, the results.
  function zonesChanged(change) {
    state.zonesVersion++;
    state.show = E.showAfter(change, { show: state.show, fileZones: fileZones(), drawn: state.drawn });
    syncZoneTick();
    renderDrawn();
    compute();
  }
  // A finished shape as a drawn zone, "Drawn zone n" (rules.js drawnZone and drawnName); false when it cannot be one.
  function addDrawn(corners, shape) {
    if (state.drawn.length >= E.DRAW.maxZones) {
      say('dz-status', 'warn', 'Up to ' + E.DRAW.maxZones + ' drawn zones: remove one to draw another.');
      return false;
    }
    const n = E.drawnName(state.drawnCount, allZones().map(z => z.name));
    const zone = E.drawnZone(corners, n.name, shape);
    if (!zone) { say('dz-status', 'warn', W.emergencyDraw.CROSS + '.'); return false; }
    state.drawnCount = n.count;
    state.drawn.push(zone);
    say('dz-status', 'ok', zone.name + ': ' + E.areaText(E.areaM2(zone.geometry)) + '.');
    zonesChanged('drawn');
    return true;
  }
  // A drag that ended: the zone with its new corners (rules.js editedZone), changed in place so the list and the
  // drawing still know it as the zone being edited; null when it cannot be one.
  function editDrawn(zone, corners) {
    const k = state.drawn.indexOf(zone), z = k < 0 ? null : E.editedZone(zone, corners);
    if (!z) return null;
    Object.assign(zone, z);
    zonesChanged('edited');
    return zone;
  }
  // The list: a name box (rules.js zoneName: a name another zone has is refused, an emptied box gives the first name
  // back), Edit (Done while editing; none for a circle, 3b: remove it and place it again) and Remove, then the area
  // and the shape ("Square, 6.0 km across", "Circle, 3.0 km radius", "6 corners").
  function renderDrawn() {
    const editing = draw.editing();
    $('dz-list').replaceChildren(...state.drawn.map(z => {
      const li = document.createElement('li'), input = document.createElement('input'), edit = document.createElement('button'),
        remove = document.createElement('button'), about = document.createElement('span');
      input.type = 'text'; input.className = 'em-point-name'; input.value = z.name; input.maxLength = E.DRAW.nameMax;
      input.setAttribute('aria-label', 'Name of ' + z.first);
      input.addEventListener('change', () => {
        const n = E.zoneName(input.value, z, allZones().filter(o => o !== z).map(o => o.name),
          { ring: (state.rings || []).map(r => r.label), positive: (state.readAll ? state.readAll.positives.map(p => p.name) : []).concat(state.points.map(p => p.name)) });
        const holder = { zone: 'Another zone', ring: 'A ring', positive: 'A positive' }[n.by];
        if (n.taken) say('dz-status', 'warn', holder + ' is named "' + input.value.replace(/\s+/g, ' ').trim() + '": the name stays ' + z.name + '.');
        else $('dz-status').hidden = true;
        z.name = n.name;
        input.value = z.name;
        if (draw.editing() === z) draw.refresh();   // the badge "Editing …" with the new name
        edit.setAttribute('aria-label', 'Edit ' + z.name);
        remove.setAttribute('aria-label', 'Remove ' + z.name);
        compute();
      });
      edit.type = remove.type = 'button';
      edit.className = remove.className = 'btn';
      edit.textContent = editing === z ? 'Done' : 'Edit';
      edit.setAttribute('aria-pressed', String(editing === z));
      edit.setAttribute('aria-label', (editing === z ? 'Done editing ' : 'Edit ') + z.name);
      edit.addEventListener('click', () => {
        if (draw.editing() === z) { draw.done(); return; }
        if (state.picking) setPicking(false);
        draw.edit(z);
      });
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + z.name);
      remove.addEventListener('click', () => {
        if (draw.editing() === z) draw.done();
        state.drawn.splice(state.drawn.indexOf(z), 1);
        $('dz-status').hidden = true;
        zonesChanged('removed');
      });
      about.className = 'dz-area';
      about.textContent = E.areaText(E.areaM2(z.geometry)) + ' \u00b7 ' + E.shapeText(z, state.unit);
      li.append(...(z.shape && z.shape.kind === 'circle' ? [input, remove, about] : [input, edit, remove, about]));
      return li;
    }));
    const full = state.drawn.length >= E.DRAW.maxZones;
    $('dz-start').disabled = full && !draw.mode();
    $('dz-start').title = full ? 'Up to ' + E.DRAW.maxZones + ' drawn zones: remove one to draw another.' : '';
  }
  // The shape switch (one picked, kept until changed) and the size box of the square (each way) and the circle (its
  // radius), labeled in the unit shown.
  function syncShapes() {
    document.querySelectorAll('#dz-shapes [data-shape]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.shape === state.drawShape)));
    $('dz-size').hidden = state.drawShape !== 'square' && state.drawShape !== 'circle';
    $('dz-size-unit').textContent = E.UNITS[state.unit].label + (state.drawShape === 'circle' ? ' radius' : ' each way');
  }
  document.querySelectorAll('#dz-shapes [data-shape]').forEach(b => b.addEventListener('click', () => {
    state.drawShape = b.dataset.shape;
    syncShapes();
    if (draw.mode() && draw.mode() !== 'edit') draw.start(state.drawShape);
  }));
  $('dz-size-in').addEventListener('change', () => { if (squareSize() !== null) $('dz-status').hidden = !draw.mode(); draw.refresh(); });
  $('dz-start').addEventListener('click', () => {
    if (draw.mode() && draw.mode() !== 'edit') { draw.cancel(); return; }
    if (state.picking) setPicking(false);
    draw.done();
    draw.start(state.drawShape);
  });
  $('dz-finish').addEventListener('click', () => draw.finish());
  $('dz-undo').addEventListener('click', () => draw.undo());
  $('dz-cancel').addEventListener('click', () => draw.cancel());
  syncShapes();
  // The browser's own "Leave this page?" while drawn zones exist (they are not stored).
  root.addEventListener('beforeunload', e => {
    if (!state.drawn.length) return;
    e.preventDefault();
    e.returnValue = '';
  });

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

  // Population context (shared/population.js): three switches, off when the page opens and turned on after each load
  // of files (2.4); a layer's file loads the first time its switch is turned on, and a file that cannot be loaded
  // leaves its switch grayed with the message.
  // The population layers switched on whose files have loaded: the ones drawn (and in the legend).
  function pcDrawn() {
    const on = state.population.on;
    return { cities: on.cities && !!PN.loaded('cities'), places: on.places && !!PN.loaded('places'),
      density: on.density && !!PN.loaded('density') };
  }
  function pcSync() {
    const pop = state.population;
    document.querySelectorAll('#pc-block .pc-on').forEach(b => {
      b.disabled = !!pop.missing[b.dataset.layer];
      b.checked = !!pop.on[b.dataset.layer];
    });
    M.setPopulation(state.map, { on: pcDrawn(), ramp: PN.DEFAULT_RAMP, names: { min: 10000 } });
    if (legendArgs) renderLegend(...legendArgs);
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

  syncControls();
  root.WSDA.emergency = { state, checklist, sample, run, compute, draw };

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
