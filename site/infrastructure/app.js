/* Infrastructure: facility files loaded in this tab, with optional CVI activity from a master file.
 * Uses the shared facility engine and the CVI map, scaling and palette helpers; all state is local to this tab. */
(function (root) {
  'use strict';
  const W = root.WSDA, profile = W.profiles.infrastructure, $ = id => document.getElementById(id);
  const F = W.facilities, C = root.CVIWA, M = C.map, B = C.basemaps, PN = W.population;
  const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

  // CVI activity starts off: both directions, Side-by-side, log scaling, 5 bins, 0.6 opacity, WSDA Default.
  const activityDefaults = () => ({
    on: false, species: [], years: [], quarters: QUARTERS.slice(), rawSpecies: [],
    direction: ['Inbound', 'Outbound'], mode: 'side_by_side', scaling: 'log', nBins: 5, opacity: 0.6,
    palette: 'WSDA Default'
  });
  const state = {
    op: 0, version: 0, loading: false, republish: false, datasets: Object.create(null), source: null, banner: null,
    activity: activityDefaults(), master: null,
    basemap: '', labelStyle: 'auto', boundaryStyle: 'auto', neighbors: Object.create(null),
    selectedLayers: [], attributes: Object.create(null), counties: [], initialized: false, facilityFiles: 0,
    population: { on: { cities: false, places: false, density: false }, missing: {} }   // PC switches
  };
  let masterInitialized = false;
  let pendingReply = null;

  // Show a status message of a kind (ok, info, warn, err) in the element with that id.
  function say(id, kind, text) {
    const el = $(id);
    el.hidden = false; el.className = 'status ' + kind; el.textContent = text;
  }

  // A ticked list like the CVI page's pickers. onChange gets the ticked values in choice order.
  function renderChecks(id, values, picks, onChange) {
    const list = $(id);
    W.facilityUI.preserve(list, () => {
      list.replaceChildren();
      values.forEach((v, k) => {
        const label = document.createElement('label'), box = document.createElement('input');
        box.type = 'checkbox'; box.id = id + '-' + k; box.value = String(v); box.checked = picks.includes(v);
        box.addEventListener('change', () => onChange(values.filter((x, i) => $(id + '-' + i).checked)));
        label.append(box, document.createTextNode(' ' + v));
        list.append(label);
      });
    });
  }

  // ---- CVI activity ------------------------------------------------------------------------------------------
  const activityLists = {
    species: { id: 'activity-species', choices: () => state.master ? state.master.speciesChoices : [] },
    years: { id: 'activity-years', choices: () => state.master ? state.master.yearChoices : [] },
    quarters: { id: 'activity-quarters', choices: () => QUARTERS }
  };
  // Redraw one of the CVI activity lists (species, years or quarters).
  function renderActivityList(key) {
    const L = activityLists[key];
    renderChecks(L.id, L.choices(), state.activity[key], values => {
      state.activity[key] = values;
      if (key === 'species') rawChoices();
      redraw();
    });
  }
  document.querySelectorAll('[data-activity-all], [data-activity-clear]').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.activityAll || b.dataset.activityClear;
    state.activity[key] = 'activityAll' in b.dataset ? activityLists[key].choices().slice() : [];
    renderActivityList(key);
    if (key === 'species') rawChoices();
    redraw();
  }));

  // "Refine by species" lists the raw Species of every ticked Species Group, as CVI's mod_maps.R does.
  function rawChoices() {
    const a = state.activity, m = state.master;
    const usable = !!(m && m.hasSpecies);
    const values = usable
      ? [...new Set(m.rows.filter(r => a.species.includes(r['Species.Group'])).map(r => r.Species)
        .filter(v => v !== null && v !== ''))].sort(C.master.collate)
      : [];
    a.rawSpecies = a.rawSpecies.filter(v => values.includes(v));
    renderChecks('activity-raw', values, a.rawSpecies, picked => { state.activity.rawSpecies = picked; redraw(); });
    $('activity-raw').disabled = !usable;
    $('activity-raw-reason').hidden = usable;
    $('activity-raw-reason').textContent = usable ? '' : 'Raw refine needs the Species column.';
  }

  // Set the CVI activity controls from the state; they are off without a master file.
  function syncActivity() {
    const a = state.activity, m = state.master;
    $('activity-on').disabled = !m;
    $('activity-on').checked = a.on && !!m;
    $('activity-controls').hidden = !a.on || !m;
    Object.keys(activityLists).forEach(renderActivityList);
    rawChoices();
    for (const key of ['scaling', 'bins', 'opacity', 'palette']) {
      $('activity-' + key).value = String(key === 'bins' ? a.nBins : a[key]);
    }
    $('activity-bins-field').hidden = !['quantile', 'natural'].includes(a.scaling);
  }

  // An optional master unlocks CVI activity only; a missing or failed master never affects facilities.
  async function prepareMaster(datasets, op) {
    let m = null, reason = 'Needs a usable master dataset.';
    if (datasets.master) {
      try {
        const parsed = C.master.load(await datasets.master.file.text());
        if (parsed.ok) m = parsed; else reason = parsed.error;
      } catch (e) {
        reason = 'The optional master could not be read: ' + e.message;
      }
    }
    if (op !== state.op) return false;
    const a = state.activity, cleared = [];
    if (m) {
      // First master: everything selected. Later masters keep the selections that are still available.
      for (const [key, available] of [['species', m.speciesChoices], ['years', m.yearChoices]]) {
        const next = masterInitialized ? a[key].filter(v => available.includes(v)) : available.slice();
        if (masterInitialized && next.length !== a[key].length) cleared.push(key);
        a[key] = next;
      }
      masterInitialized = true;
    } else {
      a.on = false; a.species = []; a.years = []; a.rawSpecies = [];
      masterInitialized = false;
    }
    state.master = m;
    const previousRaw = a.rawSpecies.slice();
    syncActivity();
    if (previousRaw.length !== a.rawSpecies.length) cleared.push('raw species');
    $('activity-reason').textContent = m ? 'Master loaded. Facility filters do not restrict CVI activity.' : reason;
    if (cleared.length) $('activity-reason').textContent += ' Cleared unavailable CVI selections: ' + cleared.join(', ') + '.';
    return true;
  }

  // The CVI activity circles' data and drawing options, from the master file and the activity choices.
  function drawActivity() {
    const a = state.activity, m = state.master;
    state.activityData = a.on && m ? C.aggregate.build(m.rows, Object.assign({}, a, { hasSpecies: m.hasSpecies })) : [];
    state.map.activityData = state.activityData;
    state.map.activityOptions = {
      palette: a.palette, opacity: a.opacity,
      amounts: C.scaling.formatR(state.activityData.map(r => C.scaling.rRound(r.total_animals)))
    };
    $('activity-status').hidden = !a.on || !m || !!state.activityData.length;
    if (a.on && m && !state.activityData.length) {
      say('activity-status', 'info', 'No CVI activity matches the selected species, years and quarters. Facility layers are unaffected.');
    }
  }

  // Direction swatches drawn as the map draws the circles, then nested size circles (largest at the back).
  function activityLegend(container) {
    const a = state.activity, d = state.activityData || [];
    state.activityLegend = null;
    if (!a.on || !state.master) return;
    const heading = document.createElement('strong');
    heading.textContent = 'CVI activity';
    container.append(heading);
    if (!d.length) {
      const p = document.createElement('p');
      p.textContent = 'No CVI activity matches the selected species, years and quarters.';
      container.append(p);
      return;
    }
    const b = B.get(state.basemap);
    const land = b && !state.map.basemapFailed ? (b.dark ? null : '#ffffff') : M.landColor(state.map);
    state.activityLegend = { swatches: [], tiers: C.scaling.legendRadii(d.map(r => r.total_animals), a.scaling, a.nBins) };
    for (const dir of ['Inbound', 'Outbound'].filter(x => d.some(r => r.direction === x))) {
      const p = document.createElement('p'), dot = document.createElement('span');
      const color = C.palettes.circleColor(a.palette, dir);
      const shown = land ? C.palettes.blend(color, a.opacity, land) : color.toLowerCase();
      dot.className = 'lg-dot'; dot.style.backgroundColor = shown;
      p.append(dot, document.createTextNode(dir));
      container.append(p);
      state.activityLegend.swatches.push({ direction: dir, color, shown, land });
    }
    const tiers = state.activityLegend.tiers;
    if (tiers) container.append(sizeLegend(tiers));
    const note = document.createElement('p');
    note.textContent = 'Sizes scaled per direction. Facility filters do not filter CVI circles.';
    container.append(note);
  }

  // The circle size legend as SVG: one circle per size tier, largest behind, each label beside its top.
  function sizeLegend(tiers) {
    const NS = 'http://www.w3.org/2000/svg', rs = tiers.radii, R = Math.max(...rs), base = 2 * R + 1, ys = [];
    const order = rs.map((r, i) => i).sort((x, y) => rs[y] - rs[x] || y - x);
    // Labels sit beside the circles' tops, at least 11 px apart.
    order.forEach((i, k) => { const top = base - 2 * rs[i]; ys[i] = k ? Math.max(top, ys[order[k - 1]] + 11) : top; });
    const el = (name, attrs) => {
      const e = document.createElementNS(NS, name);
      Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, String(v)));
      return e;
    };
    const labels = tiers.values.map(v => C.scaling.comma(v));
    // Sized to its content (about 6 px per character at 10 px), so the legend never scrolls sideways.
    const width = Math.ceil(2 * R + 12 + 6 * Math.max(...labels.map(t => t.length)));
    const svg = el('svg', { width, height: Math.ceil(Math.max(base + 1, ...ys.map(y => y + 5))),
      role: 'img', 'aria-label': 'Circle sizes in animals' });
    order.forEach(i => svg.append(el('circle', { cx: R + 1, cy: base - rs[i], r: rs[i], fill: '#b0b0b0', stroke: '#555' })));
    labels.forEach((t, i) => {
      const text = el('text', { x: 2 * R + 10, y: ys[i] + 3.5, 'font-size': 10, fill: '#333' });
      text.textContent = t;
      svg.append(text);
    });
    return svg;
  }

  // ---- Map, counts and legend --------------------------------------------------------------------------------
  state.prepared = F.prepare(Object.create(null), null, root.CVIWA_GEO.counties, 0);
  state.map = W.facilitymap.create('facility-map', root.CVIWA_GEO, () => redraw(),
    () => say('facility-zero', 'err', 'The map could not be drawn. Reload the page to try again.'));
  M.setLines(state.map, true);

  const countyNames = root.CVIWA_GEO.counties.features.map(f => f.properties.name).sort();
  // Redraw the county filter list.
  function renderCounties() {
    renderChecks('facility-counties', countyNames, state.counties, picked => { state.counties = picked; redraw(); });
  }
  renderCounties();
  $('clear-counties').addEventListener('click', () => { state.counties = []; renderCounties(); redraw(); });
  // "Show: All · Clear" for the facility layers, as in County Focus.
  $('infrastructure-layers-all').addEventListener('click', () => {
    state.selectedLayers = state.prepared.layers.filter(l => l.usable).map(l => l.key);
    redraw();
  });
  $('infrastructure-layers-clear').addEventListener('click', () => { state.selectedLayers = []; redraw(); });

  // Apply the layer, attribute and county choices, then redraw the map, the facility list and the counts.
  function redraw() {
    const t0 = performance.now(), picks = new Set(state.counties);
    state.result = F.select(state.prepared, {
      layers: state.selectedLayers, attributes: state.attributes,
      geometry: p => !picks.size || picks.has(p.county)
    });
    drawActivity();
    W.facilitymap.draw(state.map, state.result);
    W.facilityUI.render($('facility-controls'), state.prepared, state, redraw, 'infrastructure');

    const noFiles = !state.facilityFiles;
    const cards = $('facility-cards');
    cards.replaceChildren();
    for (const l of state.result.layers) {
      const c = document.createElement('div'), n = document.createElement('strong'), label = document.createElement('span');
      c.className = 'count-card';
      n.textContent = l.count.toLocaleString('en-US');
      // The layer's own mark beside its name, as on the map.
      label.className = 'count-card-label';
      label.append(W.facilities.markElement(l, 18), document.createTextNode(l.liveLabel));
      c.append(n, label);
      cards.append(c);
    }
    if (!state.result.layers.length) {
      cards.textContent = noFiles ? 'Load facility files to see counts.' : 'Select facility layers to see counts.';
    }
    $('facility-strip').textContent = 'Infrastructure · ' + state.result.layers.length + ' facility layers shown · CVI activity '
      + (state.activity.on && state.master ? 'on' : 'off');
    const total = state.result.layers.reduce((n, l) => n + l.count, 0);
    $('facility-zero').hidden = total > 0;
    if (!total) {
      say('facility-zero', 'warn', noFiles
        ? 'Load facility files to explore the map: use "Load your data" above.'
        : state.result.layers.length
          ? 'No facilities match the selected counties and attributes. Selected usable layers remain available and show 0.'
          : 'Select facility layers to see counts. Missing or unusable files are explained under Facility Locations.');
    }

    const legend = $('facility-legend-content');
    legend.replaceChildren();
    state.result.layers.forEach(l => {
      const line = document.createElement('p'), name = document.createElement('span');
      line.className = 'lg-line';
      name.textContent = l.liveLabel;
      line.append(W.facilities.markElement(l, 18), name);
      legend.append(line);
    });
    // Past 60 layers two layers can share a mark; the legend names them.
    const shared = W.facilities.sharedNote(state.result.layers);
    if (shared) {
      const p = document.createElement('p');
      p.className = 'legend-note facility-shared-note';
      p.textContent = shared;
      legend.append(p);
    }
    const note = document.createElement('p');
    note.className = 'legend-note';
    note.textContent = 'Cluster numbers count facility points, including coincident locations. Hover for up to 15 names. Cluster clicks have no action.';
    legend.append(note);
    activityLegend(legend);
    pcLegend(legend);
    renderNameMarkers();
    syncCoverage();
    pcSync();
    state.renderMs = performance.now() - t0;
  }

  // conflicts: IDs of the layers that two or more files claim in the checklist.
  async function prepareDatasets(datasets, op, conflicts) {
    const files = Object.create(null);
    let manifest = null;
    for (const [id, d] of Object.entries(datasets)) {
      if (d.kind === 'facility') files[id] = C.csv.parse(await d.file.text());
      else if (id === 'manifest') manifest = C.csv.parse(await d.file.text());
    }
    if (op !== state.op) return false;
    const prepared = F.prepare(files, manifest, root.CVIWA_GEO.counties, state.version + 1);
    for (const l of prepared.layers) {
      if (!l.usable && conflicts && conflicts.has(l.key)) {
        l.reason = 'More than one file fits this layer: choose one under Datasets in "Load your data".';
      }
    }
    // All usable layers are selected once per fresh page; later files keep valid picks and add no layers.
    const usable = prepared.layers.some(l => l.usable);
    const next = F.reconcile(prepared, state.selectedLayers, state.attributes, !state.initialized && usable);
    if (usable) state.initialized = true;
    state.prepared = prepared;
    state.selectedLayers = next.selectedLayers;
    state.attributes = next.attributes;
    state.facilityFiles = Object.keys(files).length;
    $('selection-notice').hidden = !next.cleared.length;
    if (next.cleared.length) say('selection-notice', 'warn', 'Cleared unavailable attribute selections: ' + next.cleared.join(', '));
    redraw();
    return true;
  }

  // ---- Map Style ---------------------------------------------------------------------------------------------
  state.map.notify = msg => say('screenshot-status', 'info', msg);
  // After a basemap change: redraw, and say so when the basemap failed and the offline map is shown.
  function basemapChanged() {
    redraw();
    const failed = state.map.basemapFailed;
    $('basemap-status').hidden = !failed;
    if (failed) {
      $('basemap-status').querySelector('span').textContent =
        'The selected basemap could not load. The offline county map is shown; facilities and CVI activity remain available.';
    }
  }
  state.map.onBasemapError = basemapChanged;
  state.map.onBasemapRecovered = basemapChanged;
  state.map.map.on('style.load', () => { if (state.map.ready) basemapChanged(); });

  $('activity-on').addEventListener('change', () => {
    state.activity.on = $('activity-on').checked && !!state.master;
    syncActivity();
    redraw();
  });
  for (let n = 3; n <= 10; n++) $('activity-bins').append(new Option(String(n), String(n)));
  Object.keys(C.palettes.DIRECTION_PALETTES).forEach(v => $('activity-palette').append(new Option(v, v)));
  for (const [id, key] of [['activity-scaling', 'scaling'], ['activity-bins', 'nBins'], ['activity-opacity', 'opacity'], ['activity-palette', 'palette']]) {
    $(id).addEventListener('change', () => {
      state.activity[key] = ['nBins', 'opacity'].includes(key) ? Number($(id).value) : $(id).value;
      $('activity-bins-field').hidden = !['quantile', 'natural'].includes(state.activity.scaling);
      redraw();
    });
  }

  B.LIST.forEach(b => {
    let group = $('infra-basemap').querySelector('optgroup[label="' + b.group + '"]');
    if (!group) {
      group = document.createElement('optgroup');
      group.label = b.group;
      $('infra-basemap').append(group);
    }
    group.append(new Option(b.name, b.id));
  });
  $('infra-basemap').prepend(new Option('Offline county map', ''));
  $('infra-basemap').value = '';   // the picker opens on the offline map it draws
  // Switch the map to a basemap (empty: the offline county map) and show its note.
  function setBasemap(value) {
    $('basemap-status').hidden = true;
    state.basemap = value;
    $('infra-basemap').value = value;
    const b = B.get(value);
    $('basemap-note').textContent = b ? (b.note || 'Tiles load only from the selected provider.')
      : 'Offline county map: no provider requests.';
    M.setBasemap(state.map, b);
    redraw();
  }
  $('infra-basemap').addEventListener('change', () => setBasemap($('infra-basemap').value));
  $('offline-back').addEventListener('click', () => setBasemap(''));
  for (const [id, key] of [['label-style', 'labelStyle'], ['boundary-style', 'boundaryStyle']]) {
    $(id).addEventListener('change', () => {
      state[key] = $(id).value;
      M.setContrast(state.map, state.labelStyle, state.boundaryStyle);
      redraw();
    });
  }
  $('infra-labels').addEventListener('change', () => M.setLabels(state.map, $('infra-labels').checked));
  $('infra-lines').addEventListener('change', () => M.setLines(state.map, $('infra-lines').checked));
  $('fit-wa').addEventListener('click', () => M.fitView(state.map));

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
      redraw();
    };
    on.addEventListener('change', () => {
      const s = state.neighbors[e.id];
      s.on = on.checked; s.counties = false; counties.checked = false; sub.hidden = !s.on;
      if (!s.on) { apply(); return; }
      W.regions.load(e.id, { base: '../' }).then(() => {
        if (state.neighbors[e.id].on) { $('neighbor-status').hidden = true; apply(); }
      }, err => {
        // Reads the current state, so a failure arriving after Reset All or a re-enable is handled correctly.
        if (!state.neighbors[e.id].on) return;
        const hadFocus = row.contains(document.activeElement);
        state.neighbors[e.id] = { on: false, counties: false };
        on.checked = false; counties.checked = false; sub.hidden = true;
        apply();
        if (hadFocus) on.focus();
        say('neighbor-status', 'warn', err.message + ' The rest of the map is unaffected.');
      });
    });
    counties.addEventListener('change', () => {
      state.neighbors[e.id].counties = counties.checked && state.neighbors[e.id].on;
      apply();
    });
  });

  // Population context (PC; shared/population.js): three switches, all off when the page opens. A layer's file loads
  // the first time its switch is turned on; if it cannot be loaded, the switch turns back off and stays grayed with the
  // message (a copy of the site without that file). Density is grayed while the PNG's Density (choropleth) view
  // applies, since that view fills the counties itself; the pick is kept and comes back with Locations (as the PNG map
  // style's Density choice does). The live map draws what is on, loaded and not grayed; the PNG takes the same at the
  // click. Names: places of 10,000 or more statewide, every city and place in the picked counties. Function
  // declarations, so redraw() can call them before this section has run.
  function pcDrawn() {
    const on = state.population.on;
    return { cities: on.cities && !!PN.loaded('cities'), places: on.places && !!PN.loaded('places'),
      density: on.density && !!PN.loaded('density') && coverageNow() !== 'density' };
  }
  // The population layers for the PNG ({ on, ramp }), or null when none is drawn.
  function pcInput() {
    const on = pcDrawn();
    return on.cities || on.places || on.density ? { on, ramp: PN.DEFAULT_RAMP } : null;
  }
  // Set the population switches from the state: grayed for a missing file, and Density while the PNG shades
  // the counties.
  function pcSync() {
    const pop = state.population;
    const fill = coverageNow() === 'density';
    document.querySelectorAll('#pc-block .pc-on').forEach(b => {
      const l = b.dataset.layer;
      b.disabled = !!pop.missing[l] || (l === 'density' && fill);
      b.checked = !!pop.on[l];
    });
    $('pc-reason').textContent = 'Population density cannot be shown over a county fill; switch to Locations.';
    $('pc-reason').hidden = !fill;
    if (!state.map) return;
    const picked = new Set(state.counties);
    const counties = picked.size ? root.CVIWA_GEO.counties.features.filter(f => picked.has(f.properties.name)) : null;
    M.setPopulation(state.map, { on: pcDrawn(), ramp: PN.DEFAULT_RAMP,
      names: counties ? { min: 0, counties } : { min: 10000 } });
  }
  // Turn a population layer on or off, loading its file the first time.
  function pcSet(layer, on) {
    const pop = state.population;
    pop.on[layer] = !!on;
    if (!on) { redraw(); return; }
    PN.load(layer, { base: '../' }).then(() => {
      if (!pop.on[layer]) return;
      if (!Object.keys(pop.missing).length) $('pc-msg').hidden = true;
      redraw();
    }, err => {
      if (!pop.on[layer]) return;
      pop.on[layer] = false;
      pop.missing[layer] = true;   // grayed from now on (the alert says why)
      say('pc-msg', 'err', err.message + ' The rest of the map is unaffected.');
      redraw();
    });
  }
  $('pc-block').addEventListener('change', e => {
    const l = e.target && e.target.dataset && e.target.dataset.layer;
    if (l) pcSet(l, e.target.checked);
  });
  // The live legend's block: the outline entries and the density classes, as drawn now.
  function pcLegend(container) {
    const entries = PN.legendEntries(pcDrawn(), PN.DEFAULT_RAMP);
    if (!entries.length) return;
    const head = document.createElement('p');
    head.className = 'lg-pc-head';
    const strong = document.createElement('strong');
    strong.textContent = 'Population context';
    head.append(strong);
    container.append(head);
    for (const e of entries) {
      const line = document.createElement('p');
      if (e.type === 'title') {
        line.className = 'legend-note lg-pc';
        line.textContent = e.label;
        container.append(line);
        continue;
      }
      line.className = 'lg-line lg-pc';
      const mark = document.createElement('span');
      if (e.type === 'line') {
        mark.className = 'lg-pc-line' + (e.dash ? ' dashed' : '');
      } else {
        mark.className = 'lg-pc-swatch';
        mark.style.backgroundColor = e.color;
        mark.style.opacity = String(PN.DENSITY_OPACITY);
      }
      const name = document.createElement('span');
      name.textContent = e.label;
      line.append(mark, name);
      container.append(line);
    }
  }

  // Reset All: local only. Clears picks, layers, activity, styles and neighbors; keeps the camera and folds,
  // and does not run the once-only initial layer selection again.
  function reset() {
    state.counties = [];
    renderCounties();
    state.selectedLayers = [];
    state.attributes = Object.create(null);
    state.activity = activityDefaults();
    if (state.master) {
      state.activity.species = state.master.speciesChoices.slice();
      state.activity.years = state.master.yearChoices.slice();
    }
    syncActivity();
    state.labelStyle = state.boundaryStyle = 'auto';
    $('label-style').value = $('boundary-style').value = 'auto';
    M.setContrast(state.map, 'auto', 'auto');
    $('infra-labels').checked = $('infra-lines').checked = true;
    M.setLabels(state.map, true);
    M.setLines(state.map, true);
    for (const e of W.regions.list()) {
      state.neighbors[e.id] = { on: false, counties: false };
      const d = W.regions.loaded(e.id);
      if (d) M.setNeighbor(state.map, d, false, false);
    }
    $('neighbor-controls').querySelectorAll('input').forEach(i => { i.checked = false; });
    $('neighbor-controls').querySelectorAll('.nr-sub').forEach(i => { i.hidden = true; });
    $('neighbor-status').hidden = true;
    state.population.on = { cities: false, places: false, density: false };   // PC: the three layers off
    $('pc-msg').hidden = Object.keys(state.population.missing).length === 0;
    $('selection-notice').hidden = true;
    if (state.map.clickPopup) { state.map.clickPopup.remove(); state.map.clickPopup = null; }
    state.map.clearHover();
    setBasemap('');
    redraw();
  }
  $('reset-icon').innerHTML = C.icons['arrow-counterclockwise'];
  $('reset-all').addEventListener('click', reset);
  syncActivity();

  // ---- Loading -----------------------------------------------------------------------------------------------
  // A checklist change made while files are being applied is applied right after them, never dropped.
  const checklist = W.checklist.create({ container: $('load-results'), banner: $('bundle-banner'), profile,
    onUpdate: () => {
      if (checklist.state.busy) return;
      if (state.loading) state.republish = true;
      else publish(++state.op);
    } });
  // The synthetic sample download inside "Load your data" (the full guide stays on the hub).
  const sample = { downloads: 0 };
  document.querySelector('[data-sample=infrastructure]').addEventListener('click', e => {
    const b = e.currentTarget, fileName = W.samples.infrastructure.fileName;
    b.disabled = true;
    try {
      W.sample.download(fileName, W.sample.zip(W.samples.infrastructure.entries()));
      sample.downloads++;
      say('sample-status', 'ok', 'Your browser is saving ' + fileName + '. Load it under "Load your data" above.');
    } catch (err) {
      say('sample-status', 'err', 'The sample could not be made: ' + (err && err.message || err)
        + ' Reload the page and try again.');
    } finally {
      b.disabled = false;
    }
  });

  // Tell the hub, once, whether the files it sent were loaded.
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

  // After a load that could not be read or checked: no files are kept, and the status says why. The hub
  // adds its own lead-in, so it may get a shorter message.
  async function clearLoaded(op, message, hubMessage) {
    await prepareMaster(Object.create(null), op);
    await prepareDatasets(Object.create(null), op, null);
    if (op !== state.op) return;
    state.datasets = Object.create(null);
    state.version++;
    $('load-fold').open = true;
    $('load-summary').textContent = '';
    say('load-status', 'err', message);
    answerHub(false, hubMessage || message);
  }

  // Load the checklist's found files into the page (the CVI master and the facility layers) and report;
  // true when at least one facility file is loaded.
  async function apply(op) {
    const cl = checklist.state;
    // A check still running publishes when it ends.
    if (cl.busy || !cl.load) return false;
    if (!cl.result) {
      await clearLoaded(op, cl.error || 'The files could not be checked.');
      return false;
    }
    const conflicts = new Set(cl.result.datasets.filter(d => d.status === 'conflict').map(d => d.id));
    const datasets = Object.create(null), errors = [];
    const items = new Map(cl.load.items.map(i => [i.id, i]));
    for (const d of cl.result.datasets.filter(d => d.status === 'found')) {
      const it = items.get(d.fileId);
      try {
        // Files from the hub keep their original names and paths, not the transport names.
        const original = state.source === 'hub' && state.handoffFiles && state.handoffFiles[d.id];
        const bytes = await it.read();
        const name = original ? original.name : it.name;
        datasets[d.id] = { name, path: original ? original.path : it.path,
          file: new File([bytes], name, { type: 'text/csv' }), kind: d.kind };
      } catch (e) {
        errors.push(d.name + ': ' + e.message);
      }
    }
    if (op !== state.op) return false;
    await prepareMaster(datasets, op);
    if (op !== state.op) return false;
    await prepareDatasets(datasets, op, conflicts);
    if (op !== state.op) return false;
    state.datasets = datasets;
    state.version++;
    const facilities = Object.values(datasets).filter(d => d.kind === 'facility').length;
    const ready = facilities > 0;
    const failed = errors.length || cl.load.errors.length;
    say('entry-status', ready ? 'ok' : 'warn', ready
      ? facilities + ' facility file' + (facilities === 1 ? '' : 's')
        + ' loaded in this tab. Headers recognized; usable points and omitted rows are shown under Facility Locations.'
      : 'Add or assign at least one facility file. A manifest supplies no points.');
    say('load-status', failed ? 'err' : ready ? 'ok' : 'warn',
      [...cl.load.errors.map(e => e.message), ...errors].join(' ')
        || (ready ? 'Files loaded. Optional CVI activity '
          + (datasets.master ? 'has a master file.' : 'is unavailable without a master file.')
          : 'No recognized facility file loaded. Check Datasets below.'));
    // A clean load folds the loader away so the map is in view; its summary says what is loaded.
    $('load-summary').textContent = ready ? ' · ' + facilities + ' facility file' + (facilities === 1 ? '' : 's')
      + (datasets.master ? ' and a master' : '') + ' loaded' : '';
    if (ready && !failed) $('load-fold').open = false;
    if (state.banner) { $('bundle-banner').textContent = state.banner; $('bundle-banner').hidden = false; }
    answerHub(ready, ready ? '' : 'No recognized facility file could be loaded.');
    return ready;
  }

  // Read a new set of files (chosen here, or sent by the hub) and check them.
  async function run(collect, payload) {
    const op = ++state.op;
    if (state.map.clickPopup) { state.map.clickPopup.remove(); state.map.clickPopup = null; }
    state.map.clearHover();
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
      await clearLoaded(op, 'The files could not be read: ' + e.message, e.message);
      if (op === state.op) {
        state.loading = false;
        state.republish = false;
      }
      return false;
    }
    if (op !== state.op) return false;
    await checklist.show(load);
    if (op !== state.op) return false;
    // Choosing Infrastructure directly is explicit; reuse only recognized shared mappings from a CVI hint (a
    // bundle.json that lists CVI and not Infrastructure; one that lists both maps its files here as they are).
    const bundle = checklist.state.bundle, listed = bundle && bundle.found ? W.bundle.listed(bundle.info) : null;
    if (listed && listed.includes('cvi') && !listed.includes('infrastructure')) {
      await checklist.setProfile(profile, { reuseShared: true });
      if (op !== state.op) return false;
      say('load-status', 'info', 'Checking these CVI-labeled files for Infrastructure; relevant mappings are reused.');
    }
    if (payload) {
      // The hub's resolved mapping outranks local filename recognition. Physical item IDs
      // distinguish duplicate filenames without exposing transport names in the checklist.
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
  // Dragging files over the page opens a folded loader, so the drop zone is there to drop on. Other drags
  // (text, links) leave it as it is.
  document.addEventListener('dragenter', e => {
    const types = e.dataTransfer ? Array.from(e.dataTransfer.types || []) : [];
    if (types.includes('Files')) $('load-fold').open = true;
  });

  // ---- Export & Preview (S9) -------------------------------------------------------------------------------------
  // CVI's Facilities PNG: Branded or Report, Density or Locations, drawn by the page (infrastructure/branded.js) from
  // the layers, county and attribute filters and CVI activity shown, with every choice taken at the click.
  const IB = W.infrastructureBranded, BR = W.branded, PV = C.previews;
  Object.entries(IB.RAMP_LABELS).forEach(([v, label]) => $('export-ramp').append(new Option(label, v)));
  // A public copy offers only the PNG backgrounds cleared for public use (shared/release.js).
  root.WSDA.tiles.prunePickers([$('export-background')]);
  const radio = name => document.querySelector('input[name="' + name + '"]:checked').value;
  document.querySelectorAll('input[name="coverage"]').forEach(r => r.addEventListener('change', () => {
    state.coverage = r.value;
    redraw();   // syncCoverage, and the population density switch (grayed over the Density view)
  }));
  syncCoverage();
  // The "?" buttons show their help under the control, as on the CVI page: every one on the page (the population
  // and CVI activity ones too, which sit outside the Export section), its open state told to assistive technology.
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button.tip[data-help]');
    if (!b) return;
    e.preventDefault();
    const note = $('help-' + b.dataset.help);
    if (!note) return;
    note.hidden = !note.hidden;
    b.setAttribute('aria-expanded', String(!note.hidden));
  });

  // "Name markers in PNG": one box per usable layer, in the registry's order; picks kept by layer key, none by
  // default (CVI's).
  if (!state.nameLayers) state.nameLayers = [];
  // The name marker boxes, one per usable layer; picks of layers no longer usable are dropped.
  function renderNameMarkers() {
    const usable = state.prepared.layers.filter(l => l.usable);
    state.nameLayers = (state.nameLayers || []).filter(k => usable.some(l => l.key === k));
    $('export-name-list').replaceChildren(...usable.map(l => {
      const label = document.createElement('label'), box = document.createElement('input');
      box.type = 'checkbox';
      box.value = l.key;
      box.checked = state.nameLayers.includes(l.key);
      label.append(box, document.createTextNode(' ' + l.label));
      return label;
    }));
    $('export-names-empty').hidden = usable.length > 0;
  }
  $('export-name-list').addEventListener('change', () => {
    state.nameLayers = [...$('export-name-list').querySelectorAll('input:checked')].map(i => i.value);
  });
  $('export-names-all').addEventListener('click', () => {
    state.nameLayers = [...$('export-name-list').querySelectorAll('input')].map(i => i.value);
    renderNameMarkers();
  });
  $('export-names-clear').addEventListener('click', () => { state.nameLayers = []; renderNameMarkers(); });

  // Density applies with one facility layer shown and CVI activity off; otherwise its choice is grayed with the
  // reason and the PNG uses Locations. The user's pick (state.coverage) comes back when Density can apply again.
  // A function declaration, so redraw() can call it before this section has run.
  function densityCan() {
    const layers = state.result ? state.result.layers : [];
    const activityOn = state.activity.on && !!state.master && !!(state.activityData && state.activityData.length);
    return W.infrastructureBranded.densityApplies(layers, activityOn);
  }
  // The PNG's view as it will be drawn: the pick, or Locations while Density cannot apply.
  function coverageNow() {
    return densityCan() && (state.coverage || 'density') === 'density' ? 'density' : 'locations';
  }
  // Set the PNG view choice: Density only while it can apply, otherwise Locations.
  function syncCoverage() {
    const boxes = document.querySelectorAll('input[name="coverage"]');
    const can = densityCan();
    const pick = state.coverage || 'density';
    boxes.forEach(b => {
      if (b.value === 'density') b.disabled = !can;
      b.checked = b.value === (can ? pick : 'locations');
    });
    $('coverage-reason').hidden = can;
    $('ramp-field').hidden = !can || pick !== 'density';
  }

  // The choices at the click.
  function exportChoices() {
    const a = state.activity, m = state.master;
    const on = a.on && !!m && !!(state.activityData && state.activityData.length);
    return {
      label: $('export-label').value, title: $('export-title').value, chrome: radio('output-style'),
      view: radio('coverage'), ramp: $('export-ramp').value, background: $('export-background').value,
      quality: $('export-quality').value, resolution: $('export-resolution').value, nameLayers: state.nameLayers.slice(),
      layers: state.result.layers, picked: state.counties.slice(),
      activity: on ? { rows: state.activityData, universe: m.speciesChoices, palette: a.palette, opacity: a.opacity,
        f: { species: a.species.slice(), years: a.years.slice(), quarters: a.quarters.slice(), scaling: a.scaling,
          nBins: a.nBins } } : null,
      period: m ? { years: a.years.slice(), quarters: a.quarters.slice() } : null,
      // Copied, as every choice here, so a change during the export does not reach it.
      attributes: JSON.parse(JSON.stringify(state.attributes || {})), labelStyle: state.labelStyle,
      boundaryStyle: state.boundaryStyle, population: pcInput()
    };
  }
  // The Facilities PNG's page for the choices taken at the click.
  function pageOf(ch, now, background) {
    return IB.facilities({ layers: ch.layers, counties: root.CVIWA_GEO.counties.features, picked: ch.picked,
      view: ch.view, ramp: ch.ramp, chrome: ch.chrome, nameLayers: ch.nameLayers, activity: ch.activity,
      period: ch.period, title: ch.title, date: now, background, labelStyle: ch.labelStyle,
      boundaryStyle: ch.boundaryStyle, population: ch.population });
  }
  // The picture: a tile background loaded first when one is picked; when it cannot be, the Default background and a
  // notice (a deliberate difference).
  async function picture(ch, now) {
    const dpi = BR.DPI[ch.resolution] || BR.DPI.standard;
    let built = pageOf(ch, now, ch.background);
    const notices = built.model.notice ? [built.model.notice] : [];
    const size = BR.pixelSize(dpi, built.page);
    let under = null;
    const u = built.model.underlay;
    if (u && root.WSDA.tiles.BACKGROUNDS[ch.background]) {
      const got = await root.WSDA.tiles.load(u.key, u.extent, u.box.width * dpi / 72, u.box.height * dpi / 72,
        { zoom: u.zoom, quality: ch.quality });
      if (got) {
        under = { image: got.image, box: u.box, mask: u.mask, pageWidth: u.pageWidth, how: got.how };
      } else {
        notices.push('The ' + root.WSDA.tiles.BACKGROUNDS[ch.background].label + ' background could not be loaded, ' +
          'so the Default background was used.');
        built = pageOf(ch, now, 'standard');
      }
    }
    const markup = BR.svg(built.parts, size, { page: built.page, transparent: !!under });
    const blob = under ? await BR.png(markup, size, dpi, under) : await BR.png(markup, size, dpi);
    state.lastFacilitiesPng = { model: built.model, dpi, size, notices,
      underlay: under && { how: under.how, width: under.image.width, height: under.image.height } };
    return { blob, model: built.model, notices, dpi };
  }
  // Show the message above the preview, or hide it for empty text.
  function previewMessage(kind, text) {
    const box = $('preview-message');
    box.className = 'status ' + kind;
    box.textContent = text || '';
    box.hidden = !text;
  }
  // CVI needs at least one facility layer.
  function blocked(words) {
    if (state.result.layers.length) return false;
    previewMessage('warn', 'Select at least one facility layer ' + words + '.');
    return true;
  }
  let drawing = false;
  // While a preview or export is drawn, gray both buttons and say on the clicked one what is happening.
  function busy(on, button, text) {
    drawing = on;
    $('preview-facilities').disabled = $('run-export').disabled = on;
    button.textContent = text;
  }
  $('preview-facilities').addEventListener('click', async () => {
    if (drawing || blocked('before previewing')) return;
    previewMessage('warn', '');
    const ch = exportChoices();
    busy(true, $('preview-facilities'), 'Drawing…');
    try {
      const made = await picture(ch, new Date());
      state.lastPreview = made;   // test hook: the picture shown
      if (made.notices.length) previewMessage('info', made.notices.join(' '));
      PV.showMap('Map preview', [{ name: made.model.fileName, blob: made.blob, alt: made.model.title }],
        'This is what the PNG will look like when exported.');
    } catch (e) {
      previewMessage('err', 'Preview failed: ' + ((e && e.message) || e));
    } finally {
      busy(false, $('preview-facilities'), 'Preview');
    }
  });

  // export_params.json: what was exported and every choice (CVI's Facilities export writes none).
  const localTime = d => {
    const two = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' +
      two(d.getMinutes()) + ':' + two(d.getSeconds());
  };
  // The export's export_params.json: the choices and counts behind the PNG.
  function exportParams(ch, model, now) {
    const a = ch.activity;
    return {
      map: 'facilities', facility_layers: ch.layers.map(l => l.key), facility_counts: model.layers.map(l => ({
        layer: l.key, mapped: l.count, unplaced: l.unplaced })), counties: ch.picked,
      attribute_filters: ch.attributes, output_style: ch.chrome, png_coverage_view: ch.view,
      coverage_drawn: model.coverage, density_map_color: ch.ramp, png_background: model.background,
      export_quality: ch.quality, png_resolution: ch.resolution, overlay_labels_on_png: ch.nameLayers.join(', '),
      cvi_activity: a ? { species: a.f.species, years: a.f.years, quarters: a.f.quarters, scaling: a.f.scaling,
        n_bins: a.f.nBins, opacity: a.opacity, palette: a.palette } : null,
      population_context: PN.exportParams(ch.population ? ch.population.on : null),
      map_title: model.title, export_label: ch.label.trim(), exported_at: localTime(now)
    };
  }
  $('run-export').addEventListener('click', async () => {
    if (drawing || blocked('to export')) return;
    previewMessage('warn', '');
    const ch = exportChoices();
    const now = new Date();
    busy(true, $('run-export'), 'Exporting…');
    const result = $('export-result');
    try {
      const made = await picture(ch, now);
      const folder = IB.folderName(ch.label, now);
      const params = exportParams(ch, made.model, now);
      const entries = [{ name: folder, dir: true },
        { name: folder + '/' + made.model.fileName, data: new Uint8Array(await made.blob.arrayBuffer()) },
        { name: folder + '/export_params.json', data: JSON.stringify(params, null, 2) + '\n' }];
      const bytes = W.sample.zip(entries, now);
      state.lastExport = { name: folder + '.zip', bytes, params, png: entries[1].data };   // test hook
      W.sample.download(folder + '.zip', bytes);
      const lines = ['Facilities PNG exported.', 'Saved as ' + folder + '.zip: ' + made.model.fileName +
        ', export_params.json.'].concat(made.notices);
      result.className = 'status ' + (made.notices.length ? 'warn' : 'ok');
      result.replaceChildren(...lines.map(t => { const d = document.createElement('div'); d.textContent = t; return d; }));
      result.hidden = false;
    } catch (e) {
      result.className = 'status err';
      result.textContent = 'Branded Facilities map: ' + ((e && e.message) || e);
      result.hidden = false;
    } finally {
      busy(false, $('run-export'), 'Export');
    }
  });

  root.WSDA.infrastructure = { state, checklist, sample, run, redraw, reset };

  // Files from the hub arrive in memory through the per-click handoff; a direct local choice made first wins.
  const waiting = W.load.handoff.receive(profile.id, (payload, reply) => {
    if (state.op > 0) {
      reply({ ok: false, message: 'Files were chosen in Infrastructure while files from the landing page were on their way; the local files are kept. Click Open Infrastructure again to resend.' });
      return;
    }
    pendingReply = reply;
    if (payload.error) {
      say('load-status', 'err', 'Files could not be sent from the landing page: ' + payload.error
        + ' Load files here or open Infrastructure from the landing page again.');
      reply({ ok: false, message: payload.error });
      pendingReply = null;
      return;
    }
    const supplied = Object.values(payload.datasets || {});
    const files = supplied.map(d => new File([d.file], d.name, { type: 'text/csv' }));
    run(async () => {
      const load = await W.load.fromFileList(files, 'files');
      load.items.forEach((item, index) => { item.path = supplied[index].path; });
      return load;
    }, payload);
  });
  const hubMessage = 'Files are kept in memory only. If the landing page is closed or unavailable, load files here or open Infrastructure from the landing page again.';
  if (waiting) {
    say('load-status', 'info', 'Waiting for files from the landing page…');
    root.setTimeout(() => { if (!state.version && !state.loading) say('load-status', 'warn', hubMessage); }, 10000);
  } else if (/[?&]handoff=/.test(root.location.search)) {
    say('load-status', 'warn', hubMessage);
  }
})(window);
