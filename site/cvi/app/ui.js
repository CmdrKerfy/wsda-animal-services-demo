/* Page wiring for the S1 WA State map: master file activation, filters, style controls,
 * 250 ms debounce, legend and status/no-match messages. Defaults follow mod_maps.R.
 * S2a: value boxes above the map and the summary strip below it (summary.js), county spotlight, Reset All Filters
 * and the map screenshot (map.js). Picked values are kept in the order they were picked, as CVI's pickers keep them
 * (the strip's no-match message lists them in that order).
 * S2b: the Period block (periods.js): Single period, Browse over time (slider, Quarter/Year step, Play at three speeds)
 * and Compare two periods (a second map on the right with its own years, quarters and optionally species; legends on
 * both maps; the two cameras linked).
 * S3: the Basemap picker (basemaps.js; the offline county map first and chosen on load), the provider line under it,
 * both Compare maps on the chosen basemap, a message with "Back to offline map" when a basemap cannot load, and Reset
 * All back to the offline map (a deliberate difference: CVI resets to its default CARTO Light). Label style and Boundary
 * style (CVI's Auto / Dark / Light; colors from basemaps.contrast) on both maps, applied live; Reset All sets them to Auto.
 * S4: Map View (WA State, National Flow). Each view keeps its own filters, style, camera and Browse; the sidebar, value
 * boxes, strip and legend show the active view's. The National Flow map (flow.js, flowmap.js) and its two bundled state
 * files are loaded the first time the view is chosen. One Reset All resets both views (and turns Flow's Browse off).
 * S5: Map View's third view, County Focus (CVI's order: WA State, County Focus, National Flow; focus.js, focusmap.js):
 * its own counties, filters, style and camera; its map is made the first time the view is chosen. Picking counties
 * fits the map to them 300 ms after the last pick (CVI's auto-zoom); Clear leaves the camera where it is.
 * S7: the layout switch (Map, Map + charts, Charts) and each view's charts (charts.js, drawn by chartsvg.js), with the
 * Measure picker, the Emerging comparison, values on hover and, on the WA State map, click-to-spotlight from the bars.
 * Data-loading foundation: controls whose data is missing are grayed with the reason (shared feature
 * gating, CVI dataset list), and a master table handed over by the landing page (WSDA.load.handoff) is loaded
 * exactly as if it had been chosen here; its bundle.json banner is shown.
 * S11: the Maps / Premise Lookup switch at the top of the sidebar. Premise Lookup (lookup.js init) has its own
 * sidebar and results and uses the master loaded here; the Maps side is hidden, unchanged, while it is shown. */
(function (root) {
  'use strict';
  const W = root.CVIWA, doc = root.document;
  const $ = id => doc.getElementById(id);
  const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
  const st = {
    master: null, loading: false, species: [], speciesSub: [], years: [], quarters: QUARTERS.slice(),
    direction: ['Inbound', 'Outbound'], mode: 'side_by_side', scaling: 'log', nBins: 5, opacity: '0.6', palette: 'WSDA Default',
    labels: true, lines: true, data: [], amounts: [], liveTooltips: [], legend: null, version: 0, lastMessage: null,
    spotlight: [], spotlightChoices: [], valueBoxes: null, strip: null, helpOpen: {},
    periodMode: 'single', timeStep: 'quarter', timeIndex: 1, speed: 3500, playing: false, dom: { quarter: [], year: [] },
    speciesBEnabled: false, speciesB: [], speciesBSub: [], yearsB: [], quartersB: QUARTERS.slice(), dataB: [], legendB: null,
    basemap: W.basemaps.OFFLINE, labelStyle: 'auto', boundaryStyle: 'auto', view: 'wa',
    cf: W.crossfilter.create(), cfMessage: null,   // MC: the chart filters of each Map View (crossfilter.js)
    movementOn: false, movementCap: W.movement.SHOWN_DEFAULT,   // MC: the movement view on the WA State map (movement.js)
    // CH: "Show counties as" (circles or shaded), the shading's measure, classes and fill opacity (choropleth.js).
    mapStyle: 'circles', shadeMeasure: 'total', shadeClasses: 'natural', fillOpacity: W.choropleth.FILL_OPACITY
  };
  const P = W.periods, FL = W.flow;
  W.state = st;   // read-only test hook (tests/browser/run_s1_browser.js)
  // The National Flow view's own state (CVI's flow_* inputs; labels and lines are its state-label and state-line
  // switches), with its Browse slider and what it drew last (data: flow.lines(), as st.data for the WA map).
  // CH: FLOW_SHADE_DEFAULTS, "Show states as" (lines or shaded), the shading's classes and fill opacity.
  const FLOW_SHADE_DEFAULTS = { flowStyle: 'lines', shadeClasses: 'natural', fillOpacity: '0.8' };
  const fl = Object.assign(FL.resetDefaults(null), FLOW_SHADE_DEFAULTS, {
    timeStep: 'quarter', timeIndex: 1, speed: P.DEFAULT_SPEED, playing: false,
    dom: { quarter: [], year: [] }, data: null, drawn: null, legend: null, valueBoxes: null, strip: null, version: 0 });
  W.flowState = fl;   // read-only test hook (tests/browser/run_s4_browser.js)
  // The County Focus view's own state (CVI's intra_* inputs, focus.resetDefaults): its counties (in pick order, as
  // CVI's picker keeps them), filters and style, and what it built last (focus.build).
  const FO = W.focus;
  const fo = Object.assign(FO.resetDefaults(null), { countyChoices: [], built: null, valueBoxes: null, strip: null, version: 0,
    browse: false, timeStep: 'quarter', timeIndex: 1, speed: P.DEFAULT_SPEED, playing: false, dom: { quarter: [], year: [] } });
  W.focusState = fo;   // read-only test hook (tests/browser/run_s5_browser.js)
  // PC: the population layers' switches (see "Population context" below); here so the legends can read them at once.
  const PN = root.WSDA && root.WSDA.population;
  const pc = { on: { cities: false, places: false, density: false }, missing: {} };
  st.pc = pc;   // test hook

  let mapSt = null, mapFailed = false;
  let lookupPage = null;   // S11: the Premise Lookup side (lookup.js init, at the end of this file)
  $('attrib').textContent = root.CVIWA_GEO.attribution + ' (2023 cartographic boundary file) · Map engine: MapLibre GL JS 5.22.0';

  // ---- generic checklist with All / Clear ------------------------------------------------------------------------
  // onChange gets the ticked values in the order they were ticked (a new tick goes last), as CVI's pickers keep them.
  function renderChecklist(el, choices, selected, onChange) {
    el.textContent = '';
    let order = selected.map(String).filter(v => choices.map(String).indexOf(v) >= 0);
    choices.forEach(c => {
      const lab = doc.createElement('label'), cb = doc.createElement('input');
      cb.type = 'checkbox'; cb.value = String(c); cb.checked = order.indexOf(String(c)) >= 0;
      cb.addEventListener('change', () => {
        order = order.filter(v => v !== cb.value);
        if (cb.checked) order.push(cb.value);
        onChange(order.slice());
      });
      lab.appendChild(cb); lab.appendChild(doc.createTextNode(' ' + c)); el.appendChild(lab);
    });
  }
  const lists = {
    species: { el: () => $('f-species'), choices: () => st.master ? st.master.speciesChoices : [],
      set: v => { st.species = v; refreshSub(); } },
    years: { el: () => $('f-years'), choices: () => st.master ? st.master.yearChoices : [],
      set: v => { st.years = v.map(Number); } },
    quarters: { el: () => $('f-quarters'), choices: () => QUARTERS, set: v => { st.quarters = v; } },
    spotlight: { el: () => $('f-spotlight'), choices: () => st.spotlightChoices, set: v => { st.spotlight = v; } },
    speciesB: { el: () => $('f-species-b'), choices: () => st.master ? st.master.speciesChoices : [],
      set: v => { st.speciesB = v; refreshSubB(); } },
    yearsB: { el: () => $('f-years-b'), choices: () => st.master ? st.master.yearChoices : [],
      set: v => { st.yearsB = v.map(Number); } },
    quartersB: { el: () => $('f-quarters-b'), choices: () => QUARTERS, set: v => { st.quartersB = v; } },
    // National Flow (S4)
    flSpecies: { flow: true, el: () => $('fl-species'), choices: () => st.master ? st.master.speciesChoices : [],
      set: v => { fl.species = v; refreshFlowSub(); } },
    flYears: { flow: true, el: () => $('fl-years'), choices: () => st.master ? st.master.yearChoices : [],
      set: v => { fl.years = v.map(Number); } },
    flQuarters: { flow: true, el: () => $('fl-quarters'), choices: () => QUARTERS, set: v => { fl.quarters = v; } },
    // County Focus (S5): the counties (CVI: WA counties in the data, Clear only), species, years, quarters
    foCounties: { focus: true, el: () => $('fo-counties'), choices: () => fo.countyChoices,
      set: v => { fo.counties = v; focusPicked(); } },
    foSpecies: { focus: true, el: () => $('fo-species'), choices: () => st.master ? st.master.speciesChoices : [],
      set: v => { fo.species = v; refreshFocusSub(); } },
    foYears: { focus: true, el: () => $('fo-years'), choices: () => st.master ? st.master.yearChoices : [],
      set: v => { fo.years = v.map(Number); } },
    foQuarters: { focus: true, el: () => $('fo-quarters'), choices: () => QUARTERS, set: v => { fo.quarters = v; } }
  };
  // After a picker changes: the view it belongs to is updated (recomputed after the 250 ms pause).
  const changed = key => {
    if (lists[key].flow) { updateFlowUI(); scheduleFlow(); } else if (lists[key].focus) scheduleFocus();
    else { updatePeriodUI(); schedule(); }
  };
  // Draws one picker's checklist from its choices and ticks, and keeps its folded header current.
  function renderList(key) {
    const L = lists[key], sel = { species: st.species, years: st.years, quarters: st.quarters, spotlight: st.spotlight,
      speciesB: st.speciesB, yearsB: st.yearsB, quartersB: st.quartersB,
      flSpecies: fl.species, flYears: fl.years, flQuarters: fl.quarters,
      foCounties: fo.counties, foSpecies: fo.species, foYears: fo.years, foQuarters: fo.quarters }[key];
    renderChecklist(L.el(), L.choices(), sel, v => { L.set(v); foldSummary(key); changed(key); });
    foldSummary(key);
  }
  // Species Group and Spotlight Counties fold, closed when the page opens (CVI uses compact
  // dropdown pickers). The header says what is ticked, so the list need not be opened to see it.
  doc.querySelectorAll('.fold-toggle').forEach(b => b.addEventListener('click', () => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open)); $(b.getAttribute('aria-controls')).hidden = !open;
  }));
  // Writes a folded picker's header with what is ticked ("all 5", a few names, or "3 of 9 groups").
  function foldSummary(key) {
    const out = doc.querySelector('[data-fold-sum="' + key + '"]');
    if (!out) return;
    const n = lists[key].choices().length, picked = lists[key].el().querySelectorAll('input:checked');
    const names = Array.from(picked, x => x.value), k = names.length;
    const what = key === 'spotlight' ? 'counties' : 'groups';
    out.textContent = !n ? '' : key === 'spotlight' && !k ? 'none'
      : !k ? 'none (map empty)' : k === n && key !== 'spotlight' ? 'all ' + n
      : k <= 3 ? names.join(', ') : k + ' of ' + n + ' ' + what;
  }
  doc.querySelectorAll('[data-all]').forEach(b => b.addEventListener('click', () => {
    const k = b.getAttribute('data-all'); lists[k].set(lists[k].choices().slice()); renderList(k); changed(k);
  }));
  doc.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => {
    const k = b.getAttribute('data-clear'); lists[k].set([]); renderList(k); changed(k);
  }));

  // "Refine by species": raw Species within the selected group(s); keep still-valid picks (as CVI's mod_maps.R).
  function refreshSub() {
    const m = st.master;
    let choices = [];
    if (m && m.hasSpecies) {
      const g = new Set(st.species);
      choices = [...new Set(m.rows.filter(r => g.has(r['Species.Group'])).map(r => r.Species)
        .filter(s => s !== null && s !== ''))].sort(W.master.collate);
    }
    st.speciesSub = st.speciesSub.filter(s => choices.indexOf(s) >= 0);
    renderChecklist($('f-species-sub'), choices, st.speciesSub, v => { st.speciesSub = v; schedule(); });
  }
  function refreshSubB() {   // the right map's "Refine by species" (CVI's county_species_b_sub), same rules
    const m = st.master;
    let choices = [];
    if (m && m.hasSpecies) {
      const g = new Set(st.speciesB);
      choices = [...new Set(m.rows.filter(r => g.has(r['Species.Group'])).map(r => r.Species)
        .filter(s => s !== null && s !== ''))].sort(W.master.collate);
    }
    st.speciesBSub = st.speciesBSub.filter(s => choices.indexOf(s) >= 0);
    renderChecklist($('f-species-b-sub'), choices, st.speciesBSub, v => { st.speciesBSub = v; schedule(); });
  }
  function refreshFlowSub() {   // the National Flow map's "Refine by species" (CVI's flow_species_sub), same rules
    const m = st.master;
    let choices = [];
    if (m && m.hasSpecies) {
      const g = new Set(fl.species);
      choices = [...new Set(m.rows.filter(r => g.has(r['Species.Group'])).map(r => r.Species)
        .filter(s => s !== null && s !== ''))].sort(W.master.collate);
    }
    fl.speciesSub = fl.speciesSub.filter(s => choices.indexOf(s) >= 0);
    renderChecklist($('fl-species-sub'), choices, fl.speciesSub, v => { fl.speciesSub = v; scheduleFlow(); });
  }
  function refreshFocusSub() {   // the County Focus map's "Refine by species" (CVI's intra_species_sub), same rules
    const m = st.master;
    let choices = [];
    if (m && m.hasSpecies) {
      const g = new Set(fo.species);
      choices = [...new Set(m.rows.filter(r => g.has(r['Species.Group'])).map(r => r.Species)
        .filter(s => s !== null && s !== ''))].sort(W.master.collate);
    }
    fo.speciesSub = fo.speciesSub.filter(s => choices.indexOf(s) >= 0);
    renderChecklist($('fo-species-sub'), choices, fo.speciesSub, v => { fo.speciesSub = v; scheduleFocus(); });
  }

  // ---- master activation ---------------------------------------------------------------------------------------
  function setStatus(cls, text) { const el = $('master-status'); el.className = 'status ' + cls; el.textContent = text; }
  let activeReader = null, loadVersion = 0;
  function clearMaster() {
    st.master = null; st.species = []; st.speciesSub = []; st.years = []; st.spotlight = []; st.spotlightChoices = [];
    st.speciesB = []; st.speciesBSub = []; st.yearsB = []; st.dom = { quarter: [], year: [] };
    fl.species = []; fl.speciesSub = []; fl.years = []; fl.dom = { quarter: [], year: [] };
    fo.counties = []; fo.countyChoices = []; fo.species = []; fo.speciesSub = []; fo.years = [];
    fo.dom = { quarter: [], year: [] };
    stopPlay(); stopFlowPlay(); stopFocusPlay();
    st.lastMessage = null; $('toast').textContent = '';
    renderAll();
    if (timer) root.clearTimeout(timer);
    recompute();
    if (flTimer) root.clearTimeout(flTimer);
    if (flowMap) recomputeFlow();
    if (foTimer) root.clearTimeout(foTimer);
    recomputeFocus();
    if (lookupPage) lookupPage.masterChanged();   // S11: no master (or one loading) on the Premise Lookup side
  }
  // A file picker (input type=file) calls onFile(file) once per pick. A pick is read on its "change" event and, as a
  // backup, on its "input" event and by looking at the picker for a while after it is clicked: in Safari a pick sometimes
  // showed nothing and only a second pick worked, which means no "change" event arrived. Once read, the picker is
  // emptied, so the same file can be chosen again (for example after a read failure); an emptied picker holds nothing to
  // read twice.
  const WATCH_MS = 120000, WATCH_EVERY_MS = 400;
  function watchFile(input, onFile) {
    let watch = null;
    const stop = () => { if (watch) root.clearInterval(watch); watch = null; };
    const take = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      stop();
      input.value = '';
      onFile(f);
    };
    input.addEventListener('change', take);
    input.addEventListener('input', take);
    input.addEventListener('click', () => {
      stop();
      const until = Date.now() + WATCH_MS;
      watch = root.setInterval(() => { if (Date.now() > until) stop(); else take(); }, WATCH_EVERY_MS);
    });
  }
  watchFile($('file-input'), f => {
    showBanner(null);                 // a file chosen here is not the handed-over bundle
    loadFile(f);
  });
  // A load superseded by a newer one (a file chosen here) still answers the landing page, once.
  const SUPERSEDED = 'a file was chosen on the map page while yours were on their way, and that file is kept. Click "Open the CVI map" to send yours again.';
  function loadFile(f, reply) {          // reply({ ok, message }): only for files handed over by the landing page
    let replied = false;
    const done = reply && (r => { if (!replied) { replied = true; reply(r); } });
    const request = ++loadVersion, previousSpecies = st.species.slice(), previousSub = st.speciesSub.slice();
    const previousSpeciesB = st.speciesB.slice(), previousSubB = st.speciesBSub.slice();
    const previousFlSpecies = fl.species.slice(), previousFlSub = fl.speciesSub.slice();
    const previousFoSpecies = fo.species.slice(), previousFoSub = fo.speciesSub.slice();
    if (activeReader && activeReader.readyState === 1) activeReader.abort();
    activeReader = null;
    st.loading = true;
    clearMaster();
    setStatus('info', 'Loading ' + f.name + '… Previous dataset cleared.');
    const reader = new root.FileReader();
    activeReader = reader;
    const current = () => request === loadVersion && activeReader === reader;
    const fail = message => {
      if (!current()) { if (done) done({ ok: false, message: SUPERSEDED }); return; }
      activeReader = null; st.loading = false;
      // Without a master the period radios are grayed, so the page does not stay in Browse or Compare.
      if (st.periodMode !== 'single') setPeriodMode('single', true);
      if (fl.browse) setFlowBrowse(false, true);   // the Browse checkbox is grayed without a master, likewise
      clearMaster();
      setStatus('err', 'Master dataset failed to load (' + f.name + '). ' + message
        + ' No dataset is active. Choose a CSV to retry.');
      if (done) done({ ok: false, message });
    };
    reader.onerror = () => fail('The file could not be read.');
    reader.onabort = () => fail('Reading was canceled.');
    reader.onload = () => {
      if (!current()) { if (done) done({ ok: false, message: SUPERSEDED }); return; }
      let m;
      try { m = W.master.load(String(reader.result)); } catch (e) { m = { ok: false, error: e.message }; }
      if (!m.ok) { fail(m.error); return; }
      activeReader = null; st.loading = false;
      const keep = (cur, all) => { const k = cur.filter(x => all.indexOf(x) >= 0); return k.length ? k : all.slice(); };
      st.species = keep(previousSpecies, m.speciesChoices);
      st.speciesSub = previousSub;
      st.master = m;
      st.masterName = f.name;   // S11: for Premise Lookup's export_params.json
      st.years = m.yearChoices.slice();
      st.spotlightChoices = W.summary.spotlightChoices(m); st.spotlight = [];   // CVI: choices from the data, none picked
      st.cf = W.crossfilter.create(); st.cfMessage = null;   // MC: no chart filters on a new file
      // Period (CVI's master-load observer): the right map's species keep valid picks, its years are all years; the
      // slider's periods come from the data and it moves to the middle (of the current step's periods: CVI sizes it
      // for quarters even when stepping by year); while browsing, that period fills the pickers.
      st.speciesB = keep(previousSpeciesB, m.speciesChoices); st.speciesBSub = previousSubB; st.yearsB = m.yearChoices.slice();
      st.dom = P.domains(m);
      st.timeIndex = P.middle(P.domainFor(st.dom, st.timeStep).length);
      if (st.periodMode === 'browse') applyFrame();
      // National Flow (the same master-load observer): species keep valid picks, all years, its own slider periods
      // (rows with exactly one end in WA, else the file's: flow.domains) and the slider in the middle.
      fl.species = keep(previousFlSpecies, m.speciesChoices); fl.speciesSub = previousFlSub; fl.years = m.yearChoices.slice();
      fl.dom = FL.domains(m);
      fl.timeIndex = P.middle(P.domainFor(fl.dom, fl.timeStep).length);
      if (fl.browse) applyFlowFrame();
      // County Focus (the same observer): the picker's choices are the WA counties in the data, none picked; species
      // keep valid picks, all years.
      fo.species = keep(previousFoSpecies, m.speciesChoices); fo.speciesSub = previousFoSub; fo.years = m.yearChoices.slice();
      fo.countyChoices = FO.countyChoices(m); fo.counties = [];
      // Its Browse steps through the whole master's periods (CVI's .wire_time_slider("intra"); not the picked counties'),
      // the slider in the middle.
      fo.dom = P.domains(m);
      fo.timeIndex = P.middle(P.domainFor(fo.dom, fo.timeStep).length);
      if (fo.browse) applyFocusFrame();
      setStatus('ok', 'Master loaded (' + f.name + '): ' + m.physicalRows.toLocaleString('en-US') + ' rows in the file; ' +
        m.mapRows.toLocaleString('en-US') + ' map rows (each WA-to-WA record is drawn as one inbound and one outbound row).');
      renderAll(); schedule(0); scheduleFlow(0); scheduleFocus(0);
      if (lookupPage) lookupPage.masterChanged();   // S11: the Premise Lookup filters for this master
      if (done) done({ ok: true, message: '' });
    };
    try { reader.readAsText(f); } catch (e) { fail('The file could not be read.'); }
  }
  function renderAll() {
    ['species', 'years', 'quarters', 'spotlight', 'speciesB', 'yearsB', 'quartersB', 'flSpecies', 'flYears', 'flQuarters',
      'foCounties', 'foSpecies', 'foYears', 'foQuarters'].forEach(renderList);
    refreshSub(); refreshSubB(); refreshFlowSub(); refreshFocusSub(); gateControls();
    updatePeriodUI(); updateFlowUI(); updateFocusUI();
    syncMeasure();   // S7: Unique CVIs needs the CVI column
    syncExportGate();   // S7: previews and Export need a master dataset
  }

  // ---- F1: feature gating and files handed over by the landing page ---------------------------------------------
  const F = root.WSDA;
  // Turns controls on or off by the columns the loaded master has (shared feature gating).
  function gateControls() {
    const m = st.master;
    const result = { datasets: m ? [{ id: 'master', status: 'found', header: m.header }] : [] };
    st.features = F.checklist.gate(result, F.profiles.cvi);
    F.checklist.applyGates(doc, st.features);
  }
  function showBanner(text) { const b = $('bundle-banner'); b.textContent = text || ''; b.hidden = !text; }
  // Files arriving after the user chose a file on this page are not used: the newer choice, its status and its banner
  // stay (a slow read on the landing page could otherwise replace it, or report a failure over it).
  const askedAt = loadVersion;
  const waiting = F.load.handoff.receive('cvi', (d, reply) => {
    const m = d.datasets && d.datasets.master;
    st.received = { datasets: Object.keys(d.datasets || {}), banner: d.banner || null };   // test hook
    if (loadVersion !== askedAt) {    // a read failure there was already reported there; otherwise say why nothing loaded
      st.received.superseded = true;
      if (!d.error) reply({ ok: false, message: SUPERSEDED });
      return;
    }
    if (d.error) {                    // the landing page could not read the files
      st.received.error = String(d.error);
      showBanner(null);
      setStatus('err', 'Your files could not be sent from the landing page: ' + d.error + ' No dataset is active. Load your files again there and click "Open the CVI map", or choose a CSV here.');
      return;
    }
    showBanner(typeof d.banner === 'string' ? d.banner : null);
    // S5: the facility layers and the manifest handed over with the master (County Focus's Facility Locations); a new
    // hand-off replaces them, so a layer not sent again is no longer listed as loaded. A direct "Choose File" keeps them.
    const rec = st.received;
    // test hook
    W.setFacilityFiles(d.datasets || {}).then(f => {
      rec.facilities = Object.keys(f.layers).filter(k => f.layers[k]).sort();
    });
    if (m && m.file instanceof root.Blob) loadFile(m.file, reply);
    else reply({ ok: false, message: 'No CVI master table was sent.' });
  });
  // A tab opened from the landing page says it is waiting for its files, and after 10 seconds without any (the
  // landing page had none to send, or was closed or reloaded) says what to do, as Infrastructure does.
  const noFiles = 'No master dataset loaded. No files came from the landing page (it had none to send, or it was ' +
    'closed or reloaded). Load your files there and click "Open the CVI map", or choose a CSV here.';
  if (waiting) {
    setStatus('info', 'No master dataset loaded yet. Waiting for your files from the landing page…');
    root.setTimeout(() => { if (!st.received && loadVersion === askedAt) setStatus('warn', noFiles); }, 10000);
  } else if (/[?&]handoff=/.test(root.location.search)) {
    setStatus('warn', noFiles);
  }

  // ---- other controls ------------------------------------------------------------------------------------------
  doc.querySelectorAll('input[name=direction]').forEach(cb => cb.addEventListener('change', () => {
    st.direction = [...doc.querySelectorAll('input[name=direction]:checked')].map(x => x.value); schedule();
  }));
  doc.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', () => { st.mode = r.value; schedule(); }));
  $('s-scaling').addEventListener('change', e => {
    st.scaling = e.target.value;
    $('bins-field').hidden = !(st.scaling === 'quantile' || st.scaling === 'natural'); schedule();
  });
  $('s-bins').addEventListener('change', e => { st.nBins = Number(e.target.value); schedule(); });
  // The opacity box sets the circles' opacity, or the fill opacity while shaded (each keeps its own value).
  $('s-opacity').addEventListener('change', e => {
    if (isShaded()) st.fillOpacity = e.target.value; else st.opacity = e.target.value;
    schedule();
  });
  const pal = $('s-palette');
  Object.keys(W.palettes.DIRECTION_PALETTES).forEach(n => {
    const o = doc.createElement('option'); o.value = n; o.textContent = n;
    o.selected = n === st.palette; pal.appendChild(o);
  });
  pal.addEventListener('change', e => { st.palette = e.target.value; schedule(); });
  $('s-labels').addEventListener('change', e => {
    st.labels = e.target.checked; liveMaps().forEach(m => W.map.setLabels(m, st.labels));
  });
  $('s-lines').addEventListener('change', e => {
    st.lines = e.target.checked; liveMaps().forEach(m => W.map.setLines(m, st.lines));
  });
  // Basemap (S3): the offline county map first, then CVI's groups. A tile basemap is fetched only once chosen.
  const B = W.basemaps, bmSel = $('s-basemap');
  function fillBasemaps(sel) {   // the offline county map first, then CVI's groups (also the County Focus picker)
    sel.appendChild(new root.Option(B.OFFLINE_NAME, B.OFFLINE));
    B.groups().forEach(g => {
      const og = doc.createElement('optgroup'); og.label = g.group;
      g.items.forEach(b => og.appendChild(new root.Option(b.name, b.id)));
      sel.appendChild(og);
    });
    sel.value = B.OFFLINE;
  }
  fillBasemaps(bmSel);
  function setBasemap(id) {
    const b = B.get(id);
    st.basemap = b ? b.id : B.OFFLINE; bmSel.value = st.basemap;
    $('basemap-note').textContent = B.providerLine(b); $('basemap-note').hidden = !b;
    $('basemap-status').hidden = true;
    shownMaps().forEach(m => W.map.setBasemap(m, b));
    relegend();
  }
  // The maps on screen: the right map only in Compare. Outside Compare it neither follows the camera nor takes a new
  // basemap (no requests for a hidden map); it catches up when Compare is turned on.
  const shownMaps = () => liveMaps().filter(m => m === mapSt || st.periodMode === 'compare');
  const bmOf = m => (m.basemap ? m.basemap.id : B.OFFLINE);
  // Says a tile basemap could not be loaded, if it is still the choice and the map is shown.
  function basemapError(b, m) {
    if (B.get(st.basemap) !== b || (m && shownMaps().indexOf(m) < 0)) return;   // an earlier choice, or a hidden map
    $('basemap-msg').textContent = 'Map tiles from ' + b.provider + ' could not be loaded (no internet connection, a blocked network, or the provider is unavailable). The county shapes are shown instead.';
    $('basemap-status').hidden = false;
    relegend();
  }
  function basemapRecovered(b) {   // tiles arrived after all (slow network): the message goes once no shown map has failed
    if (B.get(st.basemap) === b && shownMaps().every(m => !m.basemapFailed)) $('basemap-status').hidden = true;
    relegend();
  }
  bmSel.addEventListener('change', e => setBasemap(e.target.value));
  // Label style and Boundary style (CVI's choices and help text), on every map, live.
  const lsSel = $('s-label-style'), bsSel = $('s-boundary-style');
  B.LABEL_STYLES.forEach(([v, t]) => lsSel.appendChild(new root.Option(t, v)));
  B.BOUNDARY_STYLES.forEach(([v, t]) => bsSel.appendChild(new root.Option(t, v)));
  // Sets the label and boundary styles in both menus and on every live map.
  function setStyles(label, boundary) {
    st.labelStyle = label; st.boundaryStyle = boundary; lsSel.value = label; bsSel.value = boundary;
    liveMaps().forEach(m => W.map.setContrast(m, label, boundary));
  }
  lsSel.addEventListener('change', e => setStyles(e.target.value, st.boundaryStyle));
  bsSel.addEventListener('change', e => setStyles(st.labelStyle, e.target.value));
  $('basemap-offline').addEventListener('click', () => setBasemap(B.OFFLINE));
  // Neighboring regions (a deliberate addition, not in CVI): one switch per region of the shared list
  // (shared/regions.js), all off when the page opens. A region's counties switch is shown only while the region is on,
  // and goes back to off when the region is turned off. A region's file loads the first time its switch is turned on;
  // if it cannot be loaded the switch turns back off with a message, and nothing else on the map changes. Context only:
  // circles, numbers, the opening view and Fit to Washington stay Washington's. Both Compare maps follow the switches;
  // the right map, hidden outside Compare, catches up when Compare is turned on. Reset All turns every switch off.
  const RG = root.WSDA && root.WSDA.regions;
  // One set of switches (S5: the County Focus map has its own set in its style panel, as its own basemap and labels).
  // o: { list, msg, maps: () => the maps the switches draw on, after: () => called after a change (legends) }.
  function neighborPanel(o) {
    const state = {};   // id -> { on, counties }
    // Builds one region's row: its switch and its counties switch, hidden until the region is on.
    function row(e) {
      const r = doc.createElement('div'); r.className = 'nr-row'; r.dataset.region = e.id;
      const box = (cls, text) => {
        const l = doc.createElement('label'), cb = doc.createElement('input');
        cb.type = 'checkbox'; cb.className = cls; cb.dataset.region = e.id;
        l.appendChild(cb); l.appendChild(doc.createTextNode(' ' + text));
        return l;
      };
      const main = box('nr-on', e.name), sub = box('nr-counties', e.countiesLabel);
      sub.classList.add('nr-sub'); sub.hidden = true;
      // "Idaho counties", not just "Counties"
      sub.querySelector('input').setAttribute('aria-label', e.name + ' ' + e.countiesLabel.toLowerCase());
      r.appendChild(main); r.appendChild(sub);
      return r;
    }
    // Draws one region on the given maps (all of the panel's by default) as its switches say, once its file is loaded.
    function apply(id, maps) {
      const s = state[id], d = RG.loaded(id);
      if (d) (maps || o.maps()).forEach(m => W.map.setNeighbor(m, d, s.on, s.counties));
      o.after();
    }
    const sync = m => { if (RG) RG.list().forEach(e => apply(e.id, [m])); };
    // Turns every region and its counties off and hides the panel's message.
    function off() {
      if (!RG) return;
      RG.list().forEach(e => { if (state[e.id].on || state[e.id].counties) set(e.id, false); });
      o.msg.hidden = true;
    }
    // Turns one region on or off (its counties off either way), loading the region's file the first time.
    function set(id, on) {
      const r = o.list.querySelector('.nr-row[data-region="' + id + '"]');
      const onBox = r.querySelector('.nr-on'), sub = r.querySelector('.nr-sub'), cBox = r.querySelector('.nr-counties');
      state[id] = { on: !!on, counties: false };
      onBox.checked = !!on; cBox.checked = false; sub.hidden = !on;
      if (!on) { apply(id); return; }
      RG.load(id, { base: '../' }).then(() => {
        if (state[id].on) { o.msg.hidden = true; apply(id); }
      }, err => {
        if (!state[id].on) return;
        const hadFocus = r.contains(doc.activeElement);   // the counties box may have focus, and is about to be hidden
        set(id, false);
        if (hadFocus) onBox.focus();
        o.msg.textContent = err.message + ' The rest of the map is unaffected.';
        o.msg.hidden = false;
      });
    }
    if (RG) {
      RG.list().forEach(e => { state[e.id] = { on: false, counties: false }; o.list.appendChild(row(e)); });
      o.list.addEventListener('change', e => {
        const id = e.target.dataset.region;
        if (e.target.classList.contains('nr-on')) set(id, e.target.checked);
        else if (e.target.classList.contains('nr-counties')) { state[id].counties = e.target.checked && state[id].on; apply(id); }
      });
    }
    return { state, apply, sync, off, set };
  }
  const nrWA = neighborPanel({ list: $('nr-list'), msg: $('nr-msg'), maps: () => shownMaps(), after: () => relegend() });
  st.nr = nrWA.state;
  const syncNeighbors = nrWA.sync, neighborsOff = nrWA.off;
  // S5: the County Focus map's own switches (off when the page opens; context only, its circles,
  // facilities, numbers and fit stay Washington's); Reset All turns them off too.
  const nrFocus = neighborPanel({ list: $('fo-nr-list'), msg: $('fo-nr-msg'),
    maps: () => (focusMap && !focusFailed ? [focusMap] : []),
    after: () => renderFocusLegend() });
  fo.nr = nrFocus.state;   // test hook
  $('nr-block').hidden = !RG || !RG.list().length;
  $('fo-nr-block').hidden = !RG || !RG.list().length;
  // Each source's required statement (e.g. Statistics Canada's), in the footer whether or not its region is on, with
  // its license linked where the statement names it.
  if (RG) RG.list().filter(e => e.statement).forEach(e => {
    const p = doc.createElement('p'), lic = e.license, at = lic && lic.url ? e.statement.lastIndexOf(lic.name) : -1;
    p.className = 'nr-statement'; p.dataset.region = e.id;
    p.appendChild(doc.createTextNode(e.name + ' boundaries: ' + (at < 0 ? e.statement : e.statement.slice(0, at))));
    if (at >= 0) {
      const a = doc.createElement('a'); a.href = lic.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = lic.name;
      p.appendChild(a); p.appendChild(doc.createTextNode(e.statement.slice(at + lic.name.length)));
    }
    $('nr-statements').appendChild(p);
  });
  // Fit to Washington returns to the opening view for the map's current size in every period mode: CVI's
  // fixed center and zoom cropped the half-width Compare maps and sat tighter than the opening view on wide ones. In
  // Compare the right map follows. The fit button on each map does the same; the right map's fits itself and the left
  // follows, so it works if the left failed.
  function fitMaps() {
    if (!mapSt || mapFailed) return;
    W.map.fitView(mapSt);
  }
  $('fit-wa').addEventListener('click', fitMaps);
  // Reset All Filters (summary.resetDefaults: CVI's defaults; the spotlight is cleared too, by design).
  $('reset-icon').innerHTML = W.icons['arrow-counterclockwise'];
  $('reset-all').addEventListener('click', () => {
    const d = W.summary.resetDefaults(st.master);
    Object.assign(st, d);
    doc.querySelectorAll('input[name=direction]').forEach(cb => { cb.checked = d.direction.indexOf(cb.value) >= 0; });
    doc.querySelectorAll('input[name=mode]').forEach(r => { r.checked = r.value === d.mode; });
    $('s-scaling').value = d.scaling; $('bins-field').hidden = true; $('s-bins').value = String(d.nBins);
    $('s-opacity').value = d.opacity; $('s-palette').value = d.palette; $('s-labels').checked = d.labels;
    // Period part (periods.resetDefaults, CVI): Single period, the right map's pickers; slider, step and speed kept.
    Object.assign(st, P.resetDefaults(st.master));
    setPeriodMode('single', true);
    $('species-b-on').checked = false;
    if (st.basemap !== B.OFFLINE) setBasemap(B.OFFLINE);
    neighborsOff();   // neighboring regions: every switch off (not in CVI)
    pcOff();   // PC: the three population layers off
    setStyles('auto', 'auto');   // CVI: label and boundary style back to Auto
    resetFlow();   // National Flow (CVI resets every map at once); also turns its Browse off
    resetFocus();   // County Focus (S5): CVI's defaults; Browse off, facilities and its neighboring regions off
    st.cf = W.crossfilter.create(); st.cfMessage = null;   // MC: Reset All clears every chart filter
    st.movementOn = false; st.movementCap = W.movement.SHOWN_DEFAULT; syncMovementControls();   // MC: the movement view off
    // CH: back to the circles, Total animals, Natural breaks and an 80% fill.
    st.mapStyle = 'circles'; st.shadeMeasure = 'total'; st.shadeClasses = 'natural'; st.fillOpacity = CP.FILL_OPACITY;
    syncShadeControls();
    renderChips();
    renderAll();
    liveMaps().forEach(m => W.map.setLabels(m, st.labels));
    schedule(); scheduleFlow();
    toast('All filters reset.', 2000);   // CVI: showNotification("All filters reset.", duration = 2)
  });
  // "?" buttons: the help is in the title (pointer) and, on click, shown as a line of text (keyboard, touch).
  doc.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button.tip[data-help]');
    if (!b) return;
    const k = b.getAttribute('data-help'), note = $('help-' + k);
    st.helpOpen[k] = !st.helpOpen[k];
    b.setAttribute('aria-expanded', String(st.helpOpen[k]));
    if (note) note.hidden = !st.helpOpen[k];
  });
  // The WA map's legend and the Flow map's share one open state, as CVI's single legend panel over whichever map is
  // shown; a legend whose map failed stays closed. Compare's right-map legend keeps its own (S2b).
  const LEGENDS = [['legend-toggle', 'legend-panel'], ['legend-toggle-flow', 'legend-panel-flow'], ['legend-toggle-focus', 'legend-panel-focus']];   // S5: Focus's too
  [['legend-toggle', 'legend-panel'], ['legend-toggle-b', 'legend-panel-b'], ['legend-toggle-flow', 'legend-panel-flow'], ['legend-toggle-focus', 'legend-panel-focus']].forEach(([t, panel]) => $(t).addEventListener('click', () => {
    const open = $(panel).hidden;
    (t === 'legend-toggle-b' ? [[t, panel]] : LEGENDS).forEach(([bt, pn]) => {
      const b = $(bt);
      if (b.disabled && bt !== t) return;
      $(pn).hidden = !open; b.innerHTML = open ? 'Legend &#9650;' : 'Legend &#9660;';
      b.setAttribute('aria-expanded', String(open));
    });
  }));

  // ---- period modes (periods.js; CVI's Period block) ----------------------------------------------------------------
  doc.querySelectorAll('[data-icon]').forEach(e => { e.innerHTML = W.icons[e.getAttribute('data-icon')] || ''; });
  P.SPEEDS.forEach(x => {
    const o = doc.createElement('option'); o.value = String(x.ms); o.textContent = x.label;
    o.selected = x.ms === st.speed; $('time-speed').appendChild(o);
  });
  const periodsNow = () => P.domainFor(st.dom, st.timeStep);
  // A slider position puts its period in the year and quarter pickers (hidden while browsing), as CVI's slider does.
  function applyFrame() {
    const f = P.frame(st.dom, st.timeStep, st.timeIndex);
    if (!f) return;
    st.years = f.years; st.quarters = f.quarters;
    renderList('years'); renderList('quarters');
  }
  // Brings the period controls (slider, labels, mode and step buttons, Play) in line with the state.
  function updatePeriodUI() {
    const n = periodsNow().length, mode = st.periodMode;
    st.timeIndex = P.clamp(st.timeIndex, n);
    const sl = $('time-slider'); sl.max = String(Math.max(1, n)); sl.value = String(st.timeIndex);
    sl.setAttribute('aria-valuetext', P.timeLabel(st.dom, st.timeStep, st.timeIndex));
    $('time-label').textContent = P.timeLabel(st.dom, st.timeStep, st.timeIndex);
    $('period-summary').textContent = P.header(st, st.dom);
    doc.querySelectorAll('input[name=period-mode]').forEach(r => { r.checked = r.value === mode; });
    doc.querySelectorAll('input[name=time-step]').forEach(r => { r.checked = r.value === st.timeStep; });
    $('browse-block').hidden = mode !== 'browse';
    $('pickers-a').hidden = mode === 'browse';
    $('left-head').hidden = mode !== 'compare';
    $('right-block').hidden = mode !== 'compare';
    $('species-b-block').hidden = !st.speciesBEnabled;
    $('compare-refine-note').hidden = !P.refineNote(st);
    $('label-a').textContent = W.summary.periodLabel(st.years, st.quarters);
    $('label-b').textContent = W.summary.periodLabel(st.yearsB, st.quartersB);
    const pb = $('time-play'), icon = st.playing ? 'pause-fill' : 'play-fill', what = st.playing ? 'Pause' : 'Play';
    if (pb.getAttribute('data-shown') !== icon) { pb.innerHTML = W.icons[icon]; pb.setAttribute('data-shown', icon); }
    pb.setAttribute('aria-label', what); pb.title = what;
    pb.disabled = !n;
  }
  // Switches the period mode (stopping Play), lays out the maps for it and recomputes unless quiet.
  function setPeriodMode(mode, quiet) {
    stopPlay();
    st.periodMode = mode;
    if (mode === 'browse') applyFrame();   // entering Browse shows the slider's period
    layoutMaps();
    updatePeriodUI();
    if (!quiet) schedule(mode === 'compare' ? 0 : undefined);
  }
  doc.querySelectorAll('input[name=period-mode]').forEach(r => r.addEventListener('change', () => {
    if (r.checked) setPeriodMode(r.value);
  }));
  doc.querySelectorAll('input[name=time-step]').forEach(r => r.addEventListener('change', () => {
    if (!r.checked) return;
    st.timeStep = r.value; st.timeIndex = P.middle(periodsNow().length);   // CVI: a new step moves to its middle
    applyFrame(); updatePeriodUI(); schedule();
  }));
  $('time-slider').addEventListener('input', e => {
    st.timeIndex = P.clamp(e.target.value, periodsNow().length);
    applyFrame(); updatePeriodUI(); schedule();
  });
  // Play (Shiny's slider animation, loop off): one step per interval; from the last period it starts at the first;
  // after the last period it stops. A new speed applies from the next frame, still playing.
  let playTimer = null;
  function stopPlay() {
    if (playTimer) root.clearInterval(playTimer); playTimer = null;
    if (st.playing) { st.playing = false; updatePeriodUI(); }
  }
  // One Play step: moves to the next period and redraws; Play stops after the last period.
  function tick() {
    const nxt = P.nextIndex(st.timeIndex, periodsNow().length);
    if (nxt === null) { stopPlay(); return; }
    st.timeIndex = nxt; st.frames = (st.frames || 0) + 1;
    if (P.nextIndex(nxt, periodsNow().length) === null) { root.clearInterval(playTimer); playTimer = null; st.playing = false; }
    applyFrame(); updatePeriodUI(); schedule(0);
  }
  function startPlay() {
    const n = periodsNow().length;
    if (!n) return;
    const from = P.playStart(st.timeIndex, n);
    if (from !== st.timeIndex) { st.timeIndex = from; applyFrame(); schedule(0); }
    st.playing = true; playTimer = root.setInterval(tick, st.speed);
    updatePeriodUI();
  }
  $('time-play').addEventListener('click', () => { if (st.playing) stopPlay(); else startPlay(); });
  $('time-speed').addEventListener('change', e => {
    st.speed = Number(e.target.value);
    if (st.playing) { root.clearInterval(playTimer); playTimer = root.setInterval(tick, st.speed); }
  });
  $('species-b-on').addEventListener('change', e => { st.speciesBEnabled = e.target.checked; updatePeriodUI(); schedule(); });

  // Compare: the right map is made the first time it is needed, beside the left (main) map; cameras linked.
  let mapStB = null, mapFailedB = false;
  const liveMaps = () => [mapSt && !mapFailed ? mapSt : null, mapStB && !mapFailedB ? mapStB : null].filter(Boolean);
  // CVI draws its two Compare maps fresh, each fitted to Washington, and keeps the single map's own camera: the left
  // map here is the single map, so it is fitted on the way in and put back where it was on the way out.
  let singleCamera = null;
  function layoutMaps() {
    const on = st.periodMode === 'compare', was = $('maps').classList.contains('compare');
    if (on && !was && mapSt && !mapFailed) singleCamera = W.map.camera(mapSt);
    $('maps').classList.toggle('compare', on);
    $('col-b').hidden = !on; $('head-a').hidden = !on; $('compare-note').hidden = !on;
    if (on && !mapStB) {
      try {
        mapStB = W.map.create($('map-b'), root.CVIWA_GEO, () => {
          if (mapFailedB) return;
          if (mapSt && !mapFailed) W.map.link(mapSt, mapStB);
          if (B.get(st.basemap)) W.map.setBasemap(mapStB, B.get(st.basemap));
          schedule(0);
        }, mapErrorB);
        st.mapHandleB = mapStB;
        syncNeighbors(mapStB);   // neighboring regions as on the left map (drawn when the map is ready)
        W.map.setPopulation(mapStB, pcFor('wa'));   // PC: the population layers as on the left map
        W.map.setContrast(mapStB, st.labelStyle, st.boundaryStyle);
        mapStB.notify = msg => toast(msg, 6000);
        mapStB.onBasemapError = b => basemapError(b, mapStB);
        mapStB.onBasemapRecovered = basemapRecovered;
        mapStB.onFit = () => { if (mapStB.ready && !mapFailedB) W.map.fitView(mapStB); };
      } catch (e) { mapErrorB(); }
    }
    liveMaps().forEach(m => m.map.resize());
    if (on && !was && mapStB && !mapFailedB && mapStB.ready && bmOf(mapStB) !== st.basemap)
      W.map.setBasemap(mapStB, B.get(st.basemap));
    if (on && !was && mapStB && !mapFailedB) syncNeighbors(mapStB);   // switches flipped outside Compare
    if (on !== was && mapSt && !mapFailed && mapSt.ready) {
      if (on) W.map.fitView(mapSt);
      else if (singleCamera) { mapSt.map.jumpTo(singleCamera); singleCamera = null; }
    }
    applyLayout();   // S7: in Compare the charts go under the two maps
  }
  // Marks the right (Compare) map as failed: hides it and its legend and says why.
  function mapErrorB() {
    mapFailedB = true;
    const box = $('map-b-status'); box.hidden = false; box.className = 'status err';
    box.textContent = 'Right map unavailable. The browser could not start or continue drawing it. Reload this page to retry.';
    $('map-b').style.visibility = 'hidden';
    $('legend-panel-b').hidden = true; $('legend-toggle-b').disabled = true;
  }

  // ---- recompute (debounced 250 ms) ----------------------------------------------------------------------------
  let timer = null;
  function schedule(ms) { if (timer) root.clearTimeout(timer); timer = root.setTimeout(recompute, ms === undefined ? 250 : ms); }
  function toast(msg, ms) {
    st.lastMessage = msg;
    const box = $(st.view === 'flow' ? 'flow-toast' : st.view === 'focus' ? 'focus-toast' : 'toast'),
      d = doc.createElement('div');
    d.setAttribute('role', 'status'); d.textContent = msg; box.appendChild(d);
    root.setTimeout(() => d.remove(), ms || 4000);
  }
  // Compare's right map (CVI's county_circle_data_b): its own period and, if ticked, species; everything else shared.
  // The right map takes the chart filters too, but not a species filter while it has its own species.
  function rightRows() {
    const r = W.crossfilter.mapFilters('wa', P.rightFilters(st), st.cf, { ownSpecies: !!st.speciesBEnabled });
    if (!(st.master && r.species.length && r.quarters.length && st.direction.length && r.years.length)) return [];
    return W.aggregate.build(st.master.rows, Object.assign({ direction: st.direction, mode: st.mode, scaling: st.scaling,
      nBins: st.nBins, hasSpecies: st.master.hasSpecies }, r));
  }

  // ---- CH: shaded counties (choropleth.js) --------------------------------------------------------------------------
  // While "Shaded counties" is picked, each county is filled by its animals (both directions ticked: the Combined
  // total) in place of the circles; the movement lines still take over while on. Compare's two maps share one set of
  // classes, worked out from both maps' values, so a color means the same number on each.
  const CP = W.choropleth;
  const COUNTY_NAMES = root.CVIWA_GEO.counties.features.map(f => f.properties.name);
  const isShaded = () => st.mapStyle === 'shaded' && !st.movementOn;
  const shadeDirection = () => CP.rampKey(st.direction);
  // rowsList: each map's circle rows (aggregate.build); rawList: each map's rows as the map draws them
  // (summary.mapRows), for the records of a county without animal counts. Returns { cls, maps: [each map's counties
  // for map.draw] }.
  function shadeMaps(rowsList, rawList) {
    const cls = CP.countyClasses(rowsList, st.shadeMeasure, st.shadeClasses, st.nBins, st.direction);
    const maps = rowsList.map((rows, i) => {
      const values = CP.countyValues(rows, st.shadeMeasure);
      const totals = CP.countyValues(rows, 'total');
      const records = CP.countyRecords(rawList[i]);
      return CP.shade(COUNTY_NAMES, values, cls).map(c => Object.assign(c, { tip: shadeTip(c, totals.get(c.name),
        records.get(c.name)) }));
    });
    return { cls, maps };
  }
  // Each map's rows as it draws them (the right map in Compare with its own filters).
  function waRawRows(right) {
    if (!st.master) return [];
    const r = right ? W.crossfilter.mapFilters('wa', P.rightFilters(st), st.cf, { ownSpecies: !!st.speciesBEnabled })
      : Object.assign({}, waMapFilters(), { rawSpecies: st.speciesSub });
    return W.summary.mapRows(st.master, Object.assign({ direction: st.direction }, r)) || [];
  }
  // The county's hover lines: its name, then its animals (and per square mile), or "No movements" (with its CVI
  // records when it has some but none has an animal count).
  function shadeTip(c, total, records) {
    if (c.none && records) return [c.name, 'No movements', W.scaling.comma(records) + ' CVI ' +
      (records === 1 ? 'record' : 'records') + ', no animal counts'];
    if (c.none) return [c.name, 'No movements'];
    const dir = shadeDirection();
    const lines = [c.name, (dir === 'Combined' ? 'Combined total' : dir) + ': ' + CP.format(total, 'total') + ' animals'];
    if (st.shadeMeasure === 'per_sq_mi') lines.push(CP.format(c.value, 'per_sq_mi') + ' animals per sq mi');
    return lines;
  }
  // The controls follow the switch: Shading classes in place of Circle size scaling (the smooth
  // scalings grayed), Number of bins always shown (more than 5 grayed), Fill opacity in place of Circle
  // opacity, Measure shown; Display Mode and Color palette grayed with their reasons. While the movement lines are
  // on, the switch itself is grayed with its reason and the circles' controls come back; the choice is kept.
  const SHAPE_WHY = 'The movement lines are drawn in place of the circles or shading: turn off "Show lines between ' +
    'WA counties" to choose.';
  // Shows, hides and grays the WA State shading controls for the map style picked.
  function syncShadeControls() {
    const on = isShaded();
    doc.querySelectorAll('input[name=wa-shape]').forEach(r => { r.checked = r.value === st.mapStyle; r.disabled = st.movementOn; });
    $('shape-reason').textContent = SHAPE_WHY;
    $('shape-reason').hidden = !st.movementOn;
    $('measure-field').hidden = !on;
    $('s-measure').value = st.shadeMeasure;
    $('classes-field').hidden = !on;
    $('s-classes').value = st.shadeClasses;
    $('scaling-field').hidden = on;
    $('bins-field').hidden = !(on || st.scaling === 'quantile' || st.scaling === 'natural');
    [...$('s-bins').options].forEach(o => { o.disabled = on && Number(o.value) > CP.MAX_CLASSES; });
    $('bins-reason').hidden = !(on && st.nBins > CP.MAX_CLASSES);
    $('s-opacity-label').textContent = on ? 'Fill opacity' : 'Circle opacity';
    $('s-opacity').value = on ? st.fillOpacity : st.opacity;
    doc.querySelectorAll('input[name=mode]').forEach(r => { r.disabled = on; });
    $('mode-reason').hidden = !on;
    $('s-palette').disabled = on;
    $('palette-reason').hidden = !on;
    syncPcControls();   // population density is grayed over the fill
  }
  doc.querySelectorAll('input[name=wa-shape]').forEach(r => r.addEventListener('change', () => {
    st.mapStyle = r.value;
    syncShadeControls();
    pcApply();
    schedule(0);
  }));
  $('s-measure').addEventListener('change', e => { st.shadeMeasure = e.target.value; schedule(); });
  $('s-classes').addEventListener('change', e => { st.shadeClasses = e.target.value; schedule(); });
  $('s-bins').addEventListener('change', () => syncShadeControls());

  function recompute() {
    timer = null;
    let d = [];
    // MC: a sidebar change can leave a chart filter without rows (dropped, with a message); the map then draws the
    // sidebar's filters with the species and period chart filters folded in (crossfilter.mapFilters).
    if (st.master) reconcileView('wa', W.summary.mapRows(st.master, waSidebar()) || [], waReconcileCtx());
    const fm = waMapFilters();
    // req(): every filter must have at least one value, otherwise nothing is drawn (and no message).
    if (st.master && fm.species.length && fm.quarters.length && st.direction.length && fm.years.length) {
      d = W.aggregate.build(st.master.rows, { species: fm.species, years: fm.years, quarters: fm.quarters, keep: fm.keep,
        direction: st.direction, mode: st.mode, scaling: st.scaling, nBins: st.nBins, rawSpecies: st.speciesSub,
        hasSpecies: st.master.hasSpecies });
      if (!d.length && st.view === 'wa') toast('No records match current county map filters.');
    }
    st.data = d;
    st.amounts = W.scaling.formatR(d.map(r => W.scaling.rRound(r.total_animals)));
    st.liveTooltips = W.aggregate.liveTooltips(d);
    // CH: Compare's right map first (built below too), so both maps share one set of classes.
    const dRight = st.periodMode === 'compare' ? rightRows() : [];
    st.shade = isShaded() ? shadeMaps(st.periodMode === 'compare' ? [d, dRight] : [d],
      st.periodMode === 'compare' ? [waRawRows(false), waRawRows(true)] : [waRawRows(false)]) : null;
    if (mapSt && !mapFailed) {
      W.map.draw(mapSt, d, { palette: st.palette, opacity: st.opacity, amounts: st.amounts, spotlight: st.spotlight,
        shade: st.shade ? { counties: st.shade.maps[0], opacity: st.fillOpacity } : null });
      W.map.setLabels(mapSt, st.labels); W.map.setLines(mapSt, st.lines);
    }
    // MC: the movement view in place of the circles (left map, with the corridor chart's badges).
    st.movement = st.movementOn && st.master ? movementData(movementFilters(fm, st.speciesSub), true) : null;
    if (mapSt && !mapFailed) W.map.setMovement(mapSt, st.movement ? st.movement.view : null);
    st.legend = st.movement ? renderMovementLegend(st.movement, $('legend-panel'))
      : renderLegend(d, $('legend-panel'), mapSt);
    renderMovementNote();
    // Compare: the right map (CVI's county_circle_data_b): its own period and, if ticked, species; everything else
    // shared. Scaled on its own circles, as CVI. The boxes and strip follow the left map, as CVI.
    let dB = [];
    if (st.periodMode === 'compare') {
      const r = W.crossfilter.mapFilters('wa', P.rightFilters(st), st.cf, { ownSpecies: !!st.speciesBEnabled });
      dB = dRight;
      if (mapStB && !mapFailedB) {
        W.map.draw(mapStB, dB, { palette: st.palette, opacity: st.opacity, spotlight: st.spotlight,
          amounts: W.scaling.formatR(dB.map(x => W.scaling.rRound(x.total_animals))),
          shade: st.shade ? { counties: st.shade.maps[1], opacity: st.fillOpacity } : null });
        W.map.setLabels(mapStB, st.labels); W.map.setLines(mapStB, st.lines);
      }
      // MC: the right map's movement, from its own filters (no badges: the charts follow the left map).
      st.movementB = st.movementOn && st.master ? movementData(movementFilters(r, r.rawSpecies), false) : null;
      if (mapStB && !mapFailedB) W.map.setMovement(mapStB, st.movementB ? st.movementB.view : null);
      st.legendB = st.movementB ? renderMovementLegend(st.movementB, $('legend-panel-b'))
        : renderLegend(dB, $('legend-panel-b'), mapStB);
    } else if (st.dataB.length || st.legendB) {
      // Outside Compare the right map is emptied, so coming back never shows an earlier drawing.
      if (mapStB && !mapFailedB)
        W.map.draw(mapStB, [], { palette: st.palette, opacity: st.opacity, spotlight: [], amounts: [], shade: null });
      if (mapStB && !mapFailedB) W.map.setMovement(mapStB, null);
      st.movementB = null;
      st.legendB = renderLegend([], $('legend-panel-b'), mapStB);
    }
    $('compare-refine-note').hidden = !P.refineNote(st);
    st.dataB = dB;
    renderSummaries(d);
    if (st.view === 'wa') { renderCharts(); renderChips(); }   // S7: the charts follow the left map
    st.version++;
  }

  // ---- value boxes and summary strip (summary.js; CVI's value_boxes and filter_summary_strip) --------------------
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  // Makes a "?" button that opens the help note with the same key.
  function tipButton(key, label, help) {
    const b = el('button', 'tip', '?'); b.type = 'button'; b.setAttribute('data-help', key); b.title = help;
    b.setAttribute('aria-label', 'About ' + label); b.setAttribute('aria-expanded', String(!!st.helpOpen[key]));
    b.setAttribute('aria-controls', 'help-' + key);
    return b;
  }
  // Makes the help note a "?" button opens, hidden unless it was left open.
  function helpNote(key, help) {
    const n = el('p', 'help-note', help); n.id = 'help-' + key; n.hidden = !st.helpOpen[key]; return n;
  }
  // Works out the WA State value boxes and summary strip, and paints them while that view is shown.
  function renderSummaries(d) {
    const fm = waMapFilters();
    const f = { species: fm.species, years: fm.years, quarters: fm.quarters, keep: fm.keep, direction: st.direction,
      rawSpecies: st.speciesSub, mode: st.mode };
    st.valueBoxes = W.summary.valueBoxes(st.master ? W.summary.summary(st.master, f) : null);
    // CH: the strip's Mode names the shaded map while it is shaded.
    st.strip = !st.master ? { state: 'none', lines: ['Load a master dataset.'] }
      : W.summary.strip(st.master, Object.assign({}, f, isShaded() ? { mode: 'shaded' } : {}), d);
    if (st.view === 'wa') paintSummaries(st.valueBoxes, st.strip);
  }
  // The value boxes above the map and the strip below it, for the view on screen.
  function paintSummaries(vb, strip) {
    const box = $('value-boxes'); box.textContent = '';
    if (vb.state === 'alert') {
      const a = el('div', 'vb-alert'); a.setAttribute('role', 'note');
      const i = el('span'); i.innerHTML = W.icons[vb.icon];
      a.appendChild(i); a.appendChild(doc.createTextNode(' ' + vb.lines.join(' ')));
      box.appendChild(a);
    } else {
      const row = el('div', 'vb-row');
      let help = null;
      vb.metrics.forEach(m => {
        const card = el('div', 'metric' + (m.zero ? ' metric-zero' : '') + (m.disabled ? ' gated' : ''));
        if (m.disabled) card.setAttribute('aria-disabled', 'true');
        const ic = el('div', 'metric-icon'); ic.style.background = m.accent; ic.innerHTML = W.icons[m.icon];
        const tx = el('div', 'metric-text'), lab = el('div', 'metric-label', m.label);
        if (m.help) { lab.appendChild(tipButton('total', m.label, m.help)); help = helpNote('total', m.help); }
        // A grayed box shows its reason in place of the value, so it keeps the other boxes' size (full text on hover).
        const val = m.disabled ? el('div', 'metric-value metric-reason', m.short) : el('div', 'metric-value', m.text);
        val.title = m.disabled ? m.reason : m.text;
        tx.appendChild(lab); tx.appendChild(val);
        card.appendChild(ic); card.appendChild(tx);
        const cell = el('div'); cell.appendChild(card); row.appendChild(cell);
      });
      box.appendChild(row);
      if (help) { help.style.margin = '-0.25rem auto 0.5rem'; help.style.textAlign = 'center'; box.appendChild(help); }
    }

    const sp = $('summary-strip'); sp.textContent = '';
    // one plain line (the Flow map's, as CVI)
    if (strip.state === 'none' || (strip.state === 'message' && strip.lines.length === 1)) {
      sp.appendChild(el('p', 'strip-msg', strip.lines[0])).style.margin = '0';
    } else {
      if (strip.state === 'summary') {
        const row = el('div', 'strip-items');
        let help = null;
        strip.items.forEach(it => {
          const c = el('div'), b = el('strong', null, it.label); c.appendChild(b); c.appendChild(doc.createTextNode(it.text));
          if (it.help) {
            c.appendChild(tipButton('strip-animals', 'the Animals number', it.help));
            help = helpNote('strip-animals', it.help);
          }
          row.appendChild(c);
        });
        sp.appendChild(row);
        if (help) sp.appendChild(help);
      } else {
        const m = el('div', 'strip-msg'), p1 = el('p'), p2 = el('p', 'detail');
        p1.appendChild(el('strong', null, strip.lines[0]));
        // CVI: "Filter values applied:" and "In your data:" in bold, each value line after a line break.
        strip.lines.slice(1).forEach((l, i) => {
          if (i) p2.appendChild(el('br'));
          if (/:$/.test(l)) p2.appendChild(el('strong', null, l)); else p2.appendChild(doc.createTextNode(l));
        });
        m.appendChild(p1); m.appendChild(p2); sp.appendChild(m);
      }
    }
  }

  // ---- legend (mod_maps.R map_legend_ui, county branch) ----------------------------------------------------------
  // A deliberate difference: each direction swatch shows the circles' color as the map draws it
  // (the palette color at the circle opacity over Washington's land fill, over white on a light tile basemap; at full
  // strength on a dark one, whose near-black or imagery has no single color); the white ring as on the
  // map); while a basemap's style is still loading the county map shows and the swatch already follows the basemap;
  // the size circles are nested (the largest at the back, CVI's tier values to the right), each at the
  // radius the map draws that value (scaling.legendRadii), with no cap. CVI: full-strength swatches and a column of gray
  // circles capped at radius 20.
  // The color under the circles: null on a dark tile basemap (swatch at full strength).
  const legendLand = m => {
    const b = B.get(st.basemap);
    if (b && !(m && m.basemapFailed)) return b.dark ? null : '#ffffff';
    return m && m.nr ? W.map.landColor(m) : W.map.LAND_PAINT['fill-color'];
  };
  const SVG = 'http://www.w3.org/2000/svg';
  // Nested size circles (S1.1): bottom-aligned, the largest at the back; each value beside its circle's top, moved down
  // where two would be closer than GAP. Returns the SVG and, per value, its label, radius and label height.
  function nestedSizes(values, rs) {
    const GAP = 11, R = Math.max(...rs), base = 2 * R + 1, cx = R + 1, lx = 2 * R + 10;
    const order = rs.map((r, i) => i).sort((a, b) => rs[b] - rs[a] || b - a), ys = [];   // equal radii: the larger value higher
    order.forEach((i, k) => { const top = base - 2 * rs[i]; ys[i] = k ? Math.max(top, ys[order[k - 1]] + GAP) : top; });
    const h = Math.ceil(Math.max(base + 1, Math.max(...ys) + 5));
    const svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'lg-sizes'); svg.setAttribute('width', String(lx + 48)); svg.setAttribute('height', String(h));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Circle sizes: ' + values.map(v => W.scaling.comma(v)).join(', ') + ' animals');
    const el = (tag, a) => {
      const e = doc.createElementNS(SVG, tag); Object.keys(a).forEach(k => e.setAttribute(k, String(a[k])));
      svg.appendChild(e); return e;
    };
    order.forEach(i => el('circle', { cx, cy: base - rs[i], r: rs[i], fill: '#888888', 'fill-opacity': 0.15, stroke: '#777777', 'stroke-width': 1 }));
    const labels = rs.map((r, i) => {
      el('polyline', {
        points: cx + ',' + (base - 2 * r) + ' ' + (2 * R + 2) + ',' + (base - 2 * r) + ' ' + (lx - 3) + ',' + ys[i],
        fill: 'none', stroke: '#999999', 'stroke-width': 0.8 });
      const t = el('text', { x: lx, y: ys[i] + 3.5, 'font-size': 10, fill: '#333333' });
      t.textContent = W.scaling.comma(values[i]);
      return { label: t.textContent, radius: r, diameter_px: 2 * r, labelY: ys[i] };
    });
    return { svg, labels };
  }
  // The live legend: the circles' part, then the population layers' block while one is drawn (PC).
  function renderLegend(d, p, m) {   // returns what it drew (test hook), null without circles
    const drew = st.shade ? renderShadeLegend(d, p, m) : renderCircleLegend(d, p, m);
    pcLegend(p, 'wa');
    return drew;
  }
  // CH: the shading's legend (one for both Compare maps): the measure and direction, a swatch per class at the fill
  // opacity over the land as the map shows it, "No movements" with the hatch, and the classes' line.
  function renderShadeLegend(d, p, m) {
    p.textContent = '';
    if (!d.length) { const em = doc.createElement('em'); em.textContent = 'No data loaded'; p.appendChild(em); return null; }
    const lg = CP.legend(st.shade.cls, st.shadeMeasure, shadeDirection(), true);
    const head = doc.createElement('div'); head.style.marginBottom = '4px';
    const strong = doc.createElement('strong'); strong.textContent = CP.MEASURES[st.shadeMeasure].label;
    head.appendChild(strong); head.appendChild(doc.createTextNode(' (' + lg.subtitle + ')')); p.appendChild(head);
    const land = legendLand(m);
    const swatch = (bg, label) => {
      const row = doc.createElement('div'); row.className = 'lg-row';
      const sw = doc.createElement('span'); sw.className = 'lg-shade'; sw.style.background = bg;
      const t = doc.createElement('span'); t.textContent = label;
      row.appendChild(sw); row.appendChild(t); p.appendChild(row);
    };
    const rows = lg.rows.slice().reverse().map(r => {
      const shown = land ? W.palettes.blend(r.color, st.fillOpacity, land) : r.color;
      swatch(shown, r.label);
      return { label: r.label, color: r.color, shown };
    });
    swatch(CP.hatchCss(), lg.none);
    const n = doc.createElement('div'); n.className = 'lg-note'; n.textContent = lg.sizing; p.appendChild(n);
    // The animals in counties the map does not have (both Compare maps' rows).
    const unplaced = CP.unplacedLines(CP.unplaced(st.periodMode === 'compare' ? d.concat(st.dataB || []) : d));
    if (unplaced) {
      const u = doc.createElement('div'); u.className = 'lg-note'; u.textContent = unplaced.join(' '); p.appendChild(u);
    }
    return { shade: true, title: lg.title, subtitle: lg.subtitle, rows, none: lg.none, sizing: lg.sizing, unplaced };
  }
  // Draws the circle map's legend (direction swatches and size circles) into panel p; returns what it shows.
  function renderCircleLegend(d, p, m) {
    p.textContent = '';
    if (!d.length) { const em = doc.createElement('em'); em.textContent = 'No data loaded'; p.appendChild(em); return null; }
    const head = t => {
      const h = doc.createElement('div'); h.style.marginBottom = '4px';
      const s = doc.createElement('strong'); s.textContent = t; h.appendChild(s); return h;
    };
    p.appendChild(head('Direction'));
    const present = new Set(d.map(r => r.direction));
    const dirs = ['Inbound', 'Outbound', 'Total'].filter(x => present.has(x));
    const land = legendLand(m);
    const swatches = dirs.map(x => {
      const row = doc.createElement('div'); row.className = 'lg-row';
      const color = W.palettes.legendColor(st.palette, x),
        shown = land ? W.palettes.blend(color, st.opacity, land) : color.toLowerCase();
      const dot = doc.createElement('span'); dot.className = 'lg-dot'; dot.style.width = dot.style.height = '14px';
      dot.style.background = shown;
      const t = doc.createElement('span'); t.textContent = x; row.appendChild(dot); row.appendChild(t); p.appendChild(row);
      return { direction: x, color, shown, land };
    });
    const tiers = W.scaling.legendRadii(d.map(r => r.total_animals), st.scaling, st.nBins);
    const sizes = [];
    if (tiers) {
      p.appendChild(doc.createElement('hr')).style.margin = '6px 0';
      p.appendChild(head('Circle size'));
      const n = nestedSizes(tiers.values, tiers.radii);
      n.labels.forEach((l, i) => sizes.push(Object.assign(l, { cviRadius: tiers.cviRadii[i] })));
      p.appendChild(n.svg);
      if (st.direction.length > 1 && st.mode !== 'total') {
        const n = doc.createElement('div'); n.style.cssText = 'font-size:0.75rem;color:#777;margin-top:4px;font-style:italic;';
        n.textContent = 'Sizes scaled per direction'; p.appendChild(n);
      }
    }
    return { swatches, sizes, tiers };
  }
  // The swatches follow the land under the circles: redrawn when the basemap, its failure, a neighboring region or a
  // population layer changes it. While the movement view is on, its own legend stays.
  function relegend() {
    if (!st.data) return;
    st.legend = st.movement ? renderMovementLegend(st.movement, $('legend-panel'))
      : renderLegend(st.data, $('legend-panel'), mapSt);
    if (st.periodMode === 'compare') {
      st.legendB = st.movementB ? renderMovementLegend(st.movementB, $('legend-panel-b'))
        : renderLegend(st.dataB, $('legend-panel-b'), mapStB);
    }
  }

  // ---- National Flow (S4; flow.js, flowmap.js) -------------------------------------------------------------------
  // Map View (CVI's .set_active_map): the active button filled with aria-pressed="true"; the sidebar, map, legend, value
  // boxes and strip of that view only. Nothing is recomputed on a switch; each view keeps its camera, filters, styles
  // and Browse. Play stops when the view is switched.
  doc.querySelectorAll('.map-toggle-group [data-view]').forEach(b => b.addEventListener('click', () => setView(b.getAttribute('data-view'))));
  function setView(v) {
    if (v !== 'wa' && v !== 'flow' && v !== 'focus') return;
    doc.querySelectorAll('.map-toggle-group [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === v)));
    if (v === st.view) return;
    stopPlay(); stopFlowPlay(); stopFocusPlay();
    st.view = v;
    const flow = v === 'flow', focus = v === 'focus', wa = v === 'wa';
    $('wa-filters').hidden = !wa; $('wa-style').hidden = !wa; $('maps').hidden = !wa;
    $('flow-filters').hidden = !flow; $('flow-style').hidden = !flow; $('flow-frame').hidden = !flow;
    $('focus-filters').hidden = !focus; $('focus-style').hidden = !focus; $('focus-frame').hidden = !focus;
    $('fit-wa').hidden = !wa; $('fit-focus').hidden = !focus; $('fit-conus').hidden = !flow;
    $('compare-note').hidden = !wa || st.periodMode !== 'compare';
    $('compare-refine-note').hidden = !wa || !P.refineNote(st);
    syncPngControls();   // S9: the PNG background choices follow the view
    syncPcControls();   // PC: grayed on National Flow
    renderMovementNote();   // MC: only on the WA State view
    if (flow) {
      if (!flowMap && !flowFailed) startFlow();
      else if (flowMap && !flowFailed) flowMap.map.resize();
      paintSummaries(fl.valueBoxes || FL.valueBoxes(null),
        fl.strip || (st.master ? FL.strip(flowFilters(), null) : { state: 'none', lines: ['Load a master dataset.'] }));
    } else if (focus) {
      if (!focusMap && !focusFailed) startFocus();
      else if (focusLive()) focusMap.map.resize();
      paintSummaries(fo.valueBoxes || FO.valueBoxes(null), fo.strip || { state: 'none', lines: ['Load a master dataset.'] });
    } else {
      liveMaps().forEach(m => m.map.resize());
      paintSummaries(st.valueBoxes, st.strip);
    }
    applyLayout();   // S7: the new view's own layout choice and charts
    renderChips();   // MC: the new view's chart filters
  }

  // The Flow map and its two bundled state files are loaded the first time the view is chosen.
  let flowMap = null, flowFailed = false, flowGeo = null;
  const FLOW_FILES = ['../geo/us-states.js', '../geo/state-centers.js', '../geo/us-insets.js', 'app/flowmap.js'];
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = doc.createElement('script');
      s.onload = () => { s.remove(); resolve(); };
      s.onerror = () => { s.remove(); reject(new Error(src.replace(/^\.\.\//, ''))); };
      s.src = src; doc.head.appendChild(s);
    });
  }
  // Loads the National Flow view's files the first time it is opened and creates its map.
  function startFlow() {
    const box = $('flow-status'); box.hidden = false; box.className = 'status info'; box.textContent = 'Starting map…';
    flowFailed = 'loading';
    FLOW_FILES.reduce((p, f) => p.then(() => loadScript(f)), Promise.resolve()).then(() => {
      const states = root.WSDA_US_STATES, centers = root.WSDA_STATE_CENTERS;
      if (!states || !states.states || !Array.isArray(states.states.features) || !centers
        || !Array.isArray(centers.centers) || !W.flowmap)
        throw new Error('a state file is not readable');
      flowGeo = { states, centers, insets: root.WSDA_US_INSETS || null };
      flowFailed = false;
      // A map that cannot be made (no WebGL) gets the same message as a lost one; the boxes and strip still compute.
      try {
        flowMap = W.flowmap.create($('flow-map'), flowGeo, () => {
          if (flowFailed) return;
          box.hidden = true; scheduleFlow(0);
        }, flowError);
      } catch (e) { flowError(); recomputeFlow(); return; }
      st.flowHandle = flowMap;   // test hook
      flowMap.notify = msg => toast(msg, 6000);
      W.flowmap.setLabels(flowMap, fl.labels); W.flowmap.setLines(flowMap, fl.lines);
      recomputeFlow();
    }).catch(e => flowError((e && e.message) || String(e)));
  }
  // Marks the National Flow map as failed: hides it, grays its controls and says why.
  function flowError(what) {
    flowFailed = true;
    const box = $('flow-status'); box.hidden = false; box.className = 'status err';
    box.textContent = typeof what === 'string'
      ? 'The National Flow map could not be loaded (' + what + '). Reload this page to retry. The WA State map is unaffected.'
      : 'Map unavailable. The browser could not start or continue drawing the National Flow map. Reload this page to retry.';
    $('flow-map').style.visibility = 'hidden';
    $('legend-panel-flow').hidden = true; $('legend-toggle-flow').disabled = true; $('fit-conus').disabled = true;
    $('fl-labels').disabled = true; $('fl-lines').disabled = true;
    // Without the state files nothing can be computed: the boxes and strip say why (not "No records match …").
    if (!flowGeo) {
      fl.valueBoxes = { state: 'alert', icon: 'info-circle', lines: ['The National Flow map could not be loaded, so there are no Flow numbers. Reload this page to retry.'] };
      fl.strip = { state: 'message', lines: ['The National Flow map could not be loaded.'] };
      if (st.view === 'flow') paintSummaries(fl.valueBoxes, fl.strip);
    }
  }
  const flowLive = () => flowMap && !flowFailed;

  // Flow controls (CVI's choices, labels and defaults).
  const flOpacity = $('fl-opacity'), flMult = $('fl-mult'), flPalette = $('fl-palette'), flSpeed = $('fl-time-speed');
  FL.OPACITIES.forEach(o => flOpacity.appendChild(new root.Option(o.label, o.value)));
  FL.MULTIPLIERS.forEach(o => flMult.appendChild(new root.Option(o.label, o.value)));
  Object.keys(W.palettes.SPECIES_PALETTES).forEach(n => flPalette.appendChild(new root.Option(n, n)));
  P.SPEEDS.forEach(x => flSpeed.appendChild(new root.Option(x.label, String(x.ms))));
  // The controls show the Flow state (on load and after Reset All).
  function syncFlowControls() {
    doc.querySelectorAll('input[name=fl-direction]').forEach(r => { r.checked = r.value === fl.direction; });
    $('fl-combine').checked = fl.combine; $('fl-browse').checked = fl.browse;
    $('fl-scaling').value = fl.scaling; $('fl-bins').value = String(fl.nBins);
    $('fl-bins-field').hidden = !(fl.scaling === 'quantile' || fl.scaling === 'natural');
    flOpacity.value = fl.opacity; flMult.value = fl.multiplier; flPalette.value = fl.palette; flSpeed.value = String(fl.speed);
    $('fl-labels').checked = fl.labels; $('fl-lines').checked = fl.lines;
    // CH: the controls follow "Show states as" (as WA State's): Shading classes in place of Line width scaling, the
    // bins shown (more than 5 grayed), Fill opacity in place of Line opacity; Line width, Color palette and Combine species
    // grayed with their reasons.
    const on = fl.flowStyle === 'shaded';
    doc.querySelectorAll('input[name=fl-shape]').forEach(r => { r.checked = r.value === fl.flowStyle; });
    $('fl-classes-field').hidden = !on;
    $('fl-classes').value = fl.shadeClasses;
    $('fl-scaling-field').hidden = on;
    if (on) $('fl-bins-field').hidden = false;
    [...$('fl-bins').options].forEach(o => { o.disabled = on && Number(o.value) > CP.MAX_CLASSES; });
    $('fl-bins-reason').hidden = !(on && fl.nBins > CP.MAX_CLASSES);
    $('fl-opacity-label').textContent = on ? 'Fill opacity' : 'Line opacity';
    flOpacity.value = on ? fl.fillOpacity : fl.opacity;
    flMult.disabled = on; $('fl-mult-reason').hidden = !on;
    flPalette.disabled = on; $('fl-palette-reason').hidden = !on;
    $('fl-combine').disabled = on; $('fl-combine-reason').hidden = !on;
  }
  syncFlowControls();
  doc.querySelectorAll('input[name=fl-direction]').forEach(r => r.addEventListener('change', () => { if (r.checked) { fl.direction = r.value; scheduleFlow(); } }));
  $('fl-combine').addEventListener('change', e => { fl.combine = e.target.checked; scheduleFlow(); });
  $('fl-scaling').addEventListener('change', e => { fl.scaling = e.target.value; syncFlowControls(); scheduleFlow(); });
  $('fl-bins').addEventListener('change', e => { fl.nBins = Number(e.target.value); syncFlowControls(); scheduleFlow(); });
  flOpacity.addEventListener('change', e => {
    if (fl.flowStyle === 'shaded') fl.fillOpacity = e.target.value; else fl.opacity = e.target.value;
    scheduleFlow();
  });
  doc.querySelectorAll('input[name=fl-shape]').forEach(r => r.addEventListener('change', () => {
    fl.flowStyle = r.value; syncFlowControls(); scheduleFlow(0);
  }));
  $('fl-classes').addEventListener('change', e => { fl.shadeClasses = e.target.value; scheduleFlow(); });
  flMult.addEventListener('change', e => { fl.multiplier = e.target.value; scheduleFlow(); });
  flPalette.addEventListener('change', e => { fl.palette = e.target.value; scheduleFlow(); });
  // State labels and lines: switched live (CVI re-renders for labels; the lines toggle live there too).
  $('fl-labels').addEventListener('change', e => { fl.labels = e.target.checked; if (flowLive()) W.flowmap.setLabels(flowMap, fl.labels); });
  $('fl-lines').addEventListener('change', e => {
    fl.lines = e.target.checked; if (flowLive()) W.flowmap.setLines(flowMap, fl.lines);
  });
  // Fit to Lower 48: back to the opening view (CVI flies to the lower 48's box at zoom 4.01).
  $('fit-conus').addEventListener('click', () => { if (flowLive() && flowMap.ready) W.flowmap.fitView(flowMap); });

  // Browse over time (CVI's .time_slider_filter for the Flow map, through periods.js): its own checkbox, step, speed,
  // slider and Play. A slider position fills the Year and Quarter pickers (hidden while browsing); turning Browse off
  // leaves them on the last period shown (CVI sends nothing then).
  const flPeriods = () => P.domainFor(fl.dom, fl.timeStep);
  // Puts the Flow slider's period into the Flow year and quarter pickers.
  function applyFlowFrame() {
    const f = P.frame(fl.dom, fl.timeStep, fl.timeIndex);
    if (!f) return;
    fl.years = f.years; fl.quarters = f.quarters;
    renderList('flYears'); renderList('flQuarters');
  }
  // Brings the Flow period controls (slider, label, Browse, step, Play) in line with the state.
  function updateFlowUI() {
    const n = flPeriods().length;
    fl.timeIndex = P.clamp(fl.timeIndex, n);
    const sl = $('fl-time-slider'); sl.max = String(Math.max(1, n)); sl.value = String(fl.timeIndex);
    const label = P.timeLabel(fl.dom, fl.timeStep, fl.timeIndex);
    sl.setAttribute('aria-valuetext', label); $('fl-time-label').textContent = label;
    $('fl-browse').checked = fl.browse;
    doc.querySelectorAll('input[name=fl-time-step]').forEach(r => { r.checked = r.value === fl.timeStep; });
    $('fl-browse-block').hidden = !fl.browse;
    $('fl-pickers').hidden = fl.browse;
    const pb = $('fl-time-play'), icon = fl.playing ? 'pause-fill' : 'play-fill', what = fl.playing ? 'Pause' : 'Play';
    if (pb.getAttribute('data-shown') !== icon) { pb.innerHTML = W.icons[icon]; pb.setAttribute('data-shown', icon); }
    pb.setAttribute('aria-label', what); pb.title = what;
    pb.disabled = !n;
  }
  // Turns Flow's Browse on or off (stopping Play) and recomputes unless quiet.
  function setFlowBrowse(on, quiet) {
    stopFlowPlay();
    fl.browse = !!on;
    if (fl.browse) applyFlowFrame();   // entering Browse shows the slider's period
    updateFlowUI();
    if (!quiet) scheduleFlow();
  }
  $('fl-browse').addEventListener('change', e => setFlowBrowse(e.target.checked));
  doc.querySelectorAll('input[name=fl-time-step]').forEach(r => r.addEventListener('change', () => {
    if (!r.checked) return;
    fl.timeStep = r.value; fl.timeIndex = P.middle(flPeriods().length);   // a new step moves to its middle (CVI)
    applyFlowFrame(); updateFlowUI(); scheduleFlow();
  }));
  $('fl-time-slider').addEventListener('input', e => {
    fl.timeIndex = P.clamp(e.target.value, flPeriods().length);
    applyFlowFrame(); updateFlowUI(); scheduleFlow();
  });
  let flPlayTimer = null;
  function stopFlowPlay() {
    if (flPlayTimer) root.clearInterval(flPlayTimer); flPlayTimer = null;
    if (fl.playing) { fl.playing = false; updateFlowUI(); }
  }
  // One Flow Play step: moves to the next period and redraws; Play stops after the last period.
  function flowTick() {
    const nxt = P.nextIndex(fl.timeIndex, flPeriods().length);
    if (nxt === null) { stopFlowPlay(); return; }
    fl.timeIndex = nxt; fl.frames = (fl.frames || 0) + 1;
    if (P.nextIndex(nxt, flPeriods().length) === null) {
      root.clearInterval(flPlayTimer); flPlayTimer = null; fl.playing = false;
    }
    applyFlowFrame(); updateFlowUI(); scheduleFlow(0);
  }
  $('fl-time-play').addEventListener('click', () => {
    if (fl.playing) { stopFlowPlay(); return; }
    const n = flPeriods().length;
    if (!n) return;
    const from = P.playStart(fl.timeIndex, n);
    if (from !== fl.timeIndex) { fl.timeIndex = from; applyFlowFrame(); scheduleFlow(0); }
    fl.playing = true; flPlayTimer = root.setInterval(flowTick, fl.speed);
    updateFlowUI();
  });
  flSpeed.addEventListener('change', e => {   // a new speed applies from the next frame, still playing
    fl.speed = Number(e.target.value);
    if (fl.playing) { root.clearInterval(flPlayTimer); flPlayTimer = root.setInterval(flowTick, fl.speed); }
  });

  // Reset All, Flow part (CVI's reset_filters; flow.resetDefaults): Browse off, its slider, step and speed kept.
  function resetFlow() {
    stopFlowPlay();
    Object.assign(fl, FL.resetDefaults(st.master), FLOW_SHADE_DEFAULTS);
    syncFlowControls(); updateFlowUI();
    if (flowLive()) { W.flowmap.setLabels(flowMap, fl.labels); W.flowmap.setLines(flowMap, fl.lines); }
  }

  // Recompute (debounced 250 ms, as CVI's flow_line_data): the lines, what the map draws, the legend, boxes and strip.
  let flTimer = null;
  function scheduleFlow(ms) {
    if (flTimer) root.clearTimeout(flTimer); flTimer = root.setTimeout(recomputeFlow, ms === undefined ? 250 : ms);
  }
  function flowFilters() {
    return { direction: fl.direction, species: fl.species, speciesSub: fl.speciesSub, years: fl.years, quarters: fl.quarters,
      combine: fl.combine, scaling: fl.scaling, nBins: fl.nBins, palette: fl.palette, multiplier: fl.multiplier,
      opacity: fl.opacity };
  }
  function recomputeFlow() {
    flTimer = null;
    if (!flowGeo) return;   // the view has not been opened yet (or its files could not be loaded: flowError)
    if (st.master) reconcileView('flow', FL.mapRows(st.master, flowFilters()) || [],   // MC, as on the WA map
      { pickerEmpty: !(fl.species.length && fl.quarters.length && fl.years.length && fl.direction) });
    const f = W.crossfilter.mapFilters('flow', flowFilters(), st.cf), ctr = FL.centers(flowGeo.centers);
    // req(): a master, the centers, at least one species, quarter and year, and a direction; otherwise nothing is drawn
    // and nothing said. With all of them and no line: CVI's warning.
    const req = !!(st.master && ctr.size && f.species.length && f.quarters.length && f.years.length && f.direction);
    fl.data = req ? FL.lines(st.master, f, ctr) : null;
    if (req && !fl.data && st.view === 'flow') toast('No records match current flow map filters.', 4000);
    fl.drawn = FL.draw(fl.data, f);
    // CH: shaded states in place of the lines.
    fl.shade = req && fl.flowStyle === 'shaded' ? flowShade(f, ctr, cfState().flow.place) : null;
    if (flowLive()) {
      W.flowmap.draw(flowMap, fl.shade ? null : fl.drawn);
      W.flowmap.setHighlight(flowMap, cfState().flow.place);   // MC: a state picked in a chart
      W.flowmap.setShade(flowMap, fl.shade ? { states: fl.shade.states, opacity: fl.fillOpacity } : null);
    }
    fl.legend = fl.flowStyle === 'shaded' ? renderFlowShadeLegend(fl.shade, f, $('legend-panel-flow'))
      : renderFlowLegend(FL.legend(fl.data, f), $('legend-panel-flow'));
    fl.valueBoxes = FL.valueBoxes(st.master ? FL.summary(st.master, f, ctr) : null);
    fl.strip = st.master ? FL.strip(f, fl.data) : { state: 'none', lines: ['Load a master dataset.'] };
    if (st.view === 'flow') paintSummaries(fl.valueBoxes, fl.strip);
    if (st.view === 'flow') { renderCharts(); renderChips(); }   // S7
    fl.version++;
  }
  // CH: the shaded states: the classes of the states' animals (species added together; flow.lines per species
  // group), each state's class color and hover (its total and each species group's, as CVI's line tooltips), and the
  // states picked in a chart outlined with the others dimmed. Null without a line.
  function flowShade(f, ctr, picked) {
    const lines = FL.lines(st.master, Object.assign({}, f, { combine: false }), ctr);
    if (!lines) return null;
    const cls = CP.stateClasses([lines], fl.shadeClasses, fl.nBins, f.direction);
    const sv = CP.stateValues(lines);
    const pick = new Set(picked || []);
    const states = [...sv.values.keys()].sort().map(code => {
      const v = sv.values.get(code);
      const c = cls.classOf(v);
      const sp = sv.species.get(code).slice().sort((a, b) => b.animals - a.animals);
      const fmt = W.scaling.formatR([v].concat(sp.map(x => x.animals)).map(W.scaling.rRound));
      const tip = '<strong>' + code + '</strong><br/>Total: ' + fmt[0] + ' animals' +
        sp.map((x, i) => '<br/>' + x.group + ': ' + fmt[i + 1]).join('');
      return { code, value: v, cls: c, color: c ? cls.colors[c - 1] : null, none: !c, tip,
        dim: pick.size > 0 && !pick.has(code), picked: pick.has(code) };
    });
    return { cls, states, species: [...new Set(lines.map(a => a.species_group))] };
  }
  // Draws the shaded states' legend into panel p; returns what it shows (null with no data).
  function renderFlowShadeLegend(sh, f, p) {
    p.textContent = '';
    if (!sh) { const em = doc.createElement('em'); em.textContent = 'No data loaded'; p.appendChild(em); return null; }
    const lg = CP.legend(sh.cls, 'total', CP.rampKey(f.direction), true);
    const head = doc.createElement('div'); head.style.marginBottom = '4px';
    const strong = doc.createElement('strong'); strong.textContent = 'Total animals';
    head.appendChild(strong); head.appendChild(doc.createTextNode(' (' + lg.subtitle + ')')); p.appendChild(head);
    const swatch = (bg, label) => {
      const row = doc.createElement('div'); row.className = 'lg-row';
      const sw = doc.createElement('span'); sw.className = 'lg-shade'; sw.style.background = bg;
      const t = doc.createElement('span'); t.textContent = label;
      row.appendChild(sw); row.appendChild(t); p.appendChild(row);
    };
    const rows = lg.rows.slice().reverse().map(r => {
      const shown = W.palettes.blend(r.color, fl.fillOpacity, '#ececec');
      swatch(shown, r.label);
      return { label: r.label, color: r.color, shown };
    });
    swatch('#ececec', lg.none);
    swatch('#ffffff', 'Washington');
    const n = doc.createElement('div'); n.className = 'lg-note';
    n.textContent = 'Species added together: ' + sh.species.join(', ') + '. ' + lg.sizing + '.';
    p.appendChild(n);
    return { shade: true, title: lg.title, subtitle: lg.subtitle, rows, none: lg.none, species: sh.species,
      sizing: lg.sizing };
  }
  // The Flow legend (CVI's map_legend_ui, Flow branch): "Species" swatches, then "Line width" bars.
  function renderFlowLegend(lg, p) {
    p.textContent = '';
    if (!lg) { const em = doc.createElement('em'); em.textContent = 'No data loaded'; p.appendChild(em); return null; }
    const head = t => {
      const h = doc.createElement('div'); h.style.marginBottom = '4px';
      const s = doc.createElement('strong'); s.textContent = t; h.appendChild(s); return h;
    };
    p.appendChild(head('Species'));
    lg.species.forEach(x => {
      const row = doc.createElement('div'); row.className = 'lg-row';
      const sw = doc.createElement('span'); sw.className = 'lg-bar'; sw.style.width = '20px'; sw.style.height = '3px';
      sw.style.background = x.color;
      const t = doc.createElement('span'); t.textContent = x.label; row.appendChild(sw); row.appendChild(t); p.appendChild(row);
    });
    if (lg.widthHeader) {
      p.appendChild(doc.createElement('hr')).style.margin = '6px 0';
      p.appendChild(head('Line width'));
      lg.widths.forEach(w => {
        const row = doc.createElement('div'); row.className = 'lg-row'; row.style.marginBottom = '3px';
        const bar = doc.createElement('span'); bar.className = 'lg-bar'; bar.style.width = '28px';
        bar.style.height = w.px + 'px'; bar.style.background = '#888';
        const t = doc.createElement('span'); t.style.fontSize = '0.75rem'; t.textContent = w.label;
        row.appendChild(bar); row.appendChild(t); p.appendChild(row);
      });
    }
    return lg;
  }

  // ---- County Focus (S5; focus.js, focusmap.js) -------------------------------------------------------------------
  // The County Focus map is made the first time the view is chosen (its renderer, focusmap.js, loaded then); it uses the
  // county outlines the page already has.
  let focusMap = null, focusFailed = false;
  const FOCUS_FILES = ['app/focusmap.js'];
  // Loads the County Focus view's files the first time it is opened and creates its map.
  function startFocus() {
    const box = $('focus-status'); box.hidden = false; box.className = 'status info'; box.textContent = 'Starting map…';
    focusFailed = 'loading';
    FOCUS_FILES.reduce((p, f) => p.then(() => loadScript(f)), Promise.resolve()).then(() => {
      if (!W.focusmap) throw new Error('app/focusmap.js is not readable');
      focusFailed = false;
      try {
        focusMap = W.focusmap.create($('focus-map'), root.CVIWA_GEO, () => {
          if (focusFailed) return;
          box.hidden = true;
          if (fo.counties.length) W.focusmap.fitTo(focusMap, fo.counties);   // picked before the map was ready
          scheduleFocus(0);
        }, focusError);
      } catch (e) { focusError(); return; }
      st.focusHandle = focusMap;   // test hook
      focusMap.notify = msg => toast(msg, 6000);
      focusMap.onFit = fitFocus;
      // The Focus style as set before the map was made (applied once it is ready).
      W.focusmap.setHidden(focusMap, fo.hide); W.focusmap.setOpacity(focusMap, fo.opacity);
      W.focusmap.setGrouped(focusMap, fo.group);
      W.map.setLabels(focusMap, fo.labels); W.map.setLines(focusMap, fo.outlines);
      W.map.setContrast(focusMap, fo.labelStyle, fo.boundaryStyle);
      applyFacilities();
      nrFocus.sync(focusMap);   // regions switched on before the map was made
      W.map.setPopulation(focusMap, pcFor('focus'));   // PC: layers switched on before the map was made
      focusMap.onBasemapError = focusBasemapError;
      focusMap.onBasemapRecovered = b => { if (B.get(fo.basemap) === b && !focusMap.basemapFailed) $('focus-basemap-status').hidden = true; renderFocusLegend(); };
      if (B.get(fo.basemap)) W.map.setBasemap(focusMap, B.get(fo.basemap));
      recomputeFocus();
    }).catch(e => focusError((e && e.message) || String(e)));
  }
  // Marks the County Focus map as failed: hides it, grays its controls and says why.
  function focusError(what) {
    focusFailed = true;
    const box = $('focus-status'); box.hidden = false; box.className = 'status err';
    box.textContent = typeof what === 'string'
      ? 'The County Focus map could not be loaded (' + what + '). Reload this page to retry. The other maps are unaffected.'
      : 'Map unavailable. The browser could not start or continue drawing the County Focus map. Reload this page to retry.';
    $('focus-map').style.visibility = 'hidden';
    $('fit-focus').disabled = true;
    $('legend-panel-focus').hidden = true; $('legend-toggle-focus').disabled = true;   // as the other maps' legends
  }
  const focusLive = () => focusMap && !focusFailed;
  doc.querySelectorAll('input[name=fo-direction]').forEach(r => r.addEventListener('change', () => {
    if (r.checked) { fo.direction = r.value; scheduleFocus(); }
  }));
  doc.querySelectorAll('input[name=fo-mode]').forEach(r => r.addEventListener('change', () => {
    if (r.checked) { fo.mode = r.value; scheduleFocus(); }
  }));
  // Fit to selected counties (and the house button): the selected counties' box with CVI's 0.3 degree pad, fitted to
  // the map's size; without counties the opening view.
  function fitFocus() { if (focusLive() && focusMap.ready) W.focusmap.fitTo(focusMap, fo.counties); }
  $('fit-focus').addEventListener('click', fitFocus);
  // Browse over time (CVI's .time_slider_filter("intra") and .wire_time_slider over the whole master's periods, through
  // periods.js), as the National Flow's: its own checkbox, step, speed, slider and Play; a slider position fills the Year
  // and Quarter pickers (hidden while browsing); turning Browse off leaves them on the last period shown. Play stops when
  // the view is switched.
  const foSpeed = $('fo-time-speed');
  P.SPEEDS.forEach(x => foSpeed.appendChild(new root.Option(x.label, String(x.ms))));
  foSpeed.value = String(fo.speed);
  const foPeriods = () => P.domainFor(fo.dom, fo.timeStep);
  // Puts the County Focus slider's period into its year and quarter pickers.
  function applyFocusFrame() {
    const f = P.frame(fo.dom, fo.timeStep, fo.timeIndex);
    if (!f) return;
    fo.years = f.years; fo.quarters = f.quarters;
    renderList('foYears'); renderList('foQuarters');
  }
  // Brings the County Focus period controls (slider, label, Browse, step, Play) in line with the state.
  function updateFocusUI() {
    const n = foPeriods().length;
    fo.timeIndex = P.clamp(fo.timeIndex, n);
    const sl = $('fo-time-slider'); sl.max = String(Math.max(1, n)); sl.value = String(fo.timeIndex);
    const label = P.timeLabel(fo.dom, fo.timeStep, fo.timeIndex);
    sl.setAttribute('aria-valuetext', label); $('fo-time-label').textContent = label;
    $('fo-browse').checked = fo.browse;
    doc.querySelectorAll('input[name=fo-time-step]').forEach(r => { r.checked = r.value === fo.timeStep; });
    $('fo-browse-block').hidden = !fo.browse;
    $('fo-pickers').hidden = fo.browse;
    foSpeed.value = String(fo.speed);
    const pb = $('fo-time-play'), icon = fo.playing ? 'pause-fill' : 'play-fill', what = fo.playing ? 'Pause' : 'Play';
    if (pb.getAttribute('data-shown') !== icon) { pb.innerHTML = W.icons[icon]; pb.setAttribute('data-shown', icon); }
    pb.setAttribute('aria-label', what); pb.title = what;
    pb.disabled = !n;
  }
  // Turns County Focus's Browse on or off (stopping Play) and recomputes unless quiet.
  function setFocusBrowse(on, quiet) {
    stopFocusPlay();
    fo.browse = !!on;
    if (fo.browse) applyFocusFrame();   // entering Browse shows the slider's period
    updateFocusUI();
    if (!quiet) scheduleFocus();
  }
  $('fo-browse').addEventListener('change', e => setFocusBrowse(e.target.checked));
  doc.querySelectorAll('input[name=fo-time-step]').forEach(r => r.addEventListener('change', () => {
    if (!r.checked) return;
    fo.timeStep = r.value; fo.timeIndex = P.middle(foPeriods().length);   // a new step moves to its middle (CVI)
    applyFocusFrame(); updateFocusUI(); scheduleFocus();
  }));
  $('fo-time-slider').addEventListener('input', e => {
    fo.timeIndex = P.clamp(e.target.value, foPeriods().length);
    applyFocusFrame(); updateFocusUI(); scheduleFocus();
  });
  let foPlayTimer = null;
  function stopFocusPlay() {
    if (foPlayTimer) root.clearInterval(foPlayTimer); foPlayTimer = null;
    if (fo.playing) { fo.playing = false; updateFocusUI(); }
  }
  // One County Focus Play step: moves to the next period and redraws; Play stops after the last period.
  function focusTick() {
    const nxt = P.nextIndex(fo.timeIndex, foPeriods().length);
    if (nxt === null) { stopFocusPlay(); return; }
    fo.timeIndex = nxt; fo.frames = (fo.frames || 0) + 1;
    if (P.nextIndex(nxt, foPeriods().length) === null) {
      root.clearInterval(foPlayTimer); foPlayTimer = null; fo.playing = false;
    }
    applyFocusFrame(); updateFocusUI(); scheduleFocus(0);
  }
  $('fo-time-play').addEventListener('click', () => {
    if (fo.playing) { stopFocusPlay(); return; }
    const n = foPeriods().length;
    if (!n) return;
    const from = P.playStart(fo.timeIndex, n);
    if (from !== fo.timeIndex) { fo.timeIndex = from; applyFocusFrame(); scheduleFocus(0); }
    fo.playing = true; foPlayTimer = root.setInterval(focusTick, fo.speed);
    updateFocusUI();
  });
  foSpeed.addEventListener('change', e => {   // a new speed applies from the next frame, still playing
    fo.speed = Number(e.target.value);
    if (fo.playing) { root.clearInterval(foPlayTimer); foPlayTimer = root.setInterval(focusTick, fo.speed); }
  });
  // Reset All, County Focus part (CVI's reset_filters; focus.resetDefaults): counties cleared and CVI's defaults; the
  // camera stays. Deliberate differences: Browse turned off (its slider, step and speed kept), the
  // facility layers and its neighboring regions switched off, the offline basemap back (CVI: CARTO Light).
  function resetFocus() {
    stopFocusPlay();
    const d = FO.resetDefaults(st.master);
    Object.assign(fo, d, { browse: false });
    doc.querySelectorAll('input[name=fo-direction]').forEach(r => { r.checked = r.value === fo.direction; });
    doc.querySelectorAll('input[name=fo-mode]').forEach(r => { r.checked = r.value === fo.mode; });
    $('fo-scaling').value = fo.scaling; $('fo-bins').value = String(fo.nBins); foBinsShown();
    $('fo-opacity').value = fo.opacity; $('fo-hide').checked = fo.hide; $('fo-group').checked = fo.group;
    if (st.syncPngControls) st.syncPngControls();   // the GIF box follows "Hide CVI circles"
    $('fo-labels').checked = fo.labels; $('fo-outlines').checked = fo.outlines;
    foLs.value = fo.labelStyle; foBs.value = fo.boundaryStyle;
    if (fo.basemap !== B.OFFLINE) setFocusBasemap(B.OFFLINE);
    fo.fac.on = []; fo.fac.attributes = Object.create(null); $('fo-fac-notice').hidden = true; applyFacilities();
    nrFocus.off();
    if (focusLive()) {
      W.focusmap.setHidden(focusMap, fo.hide); W.focusmap.setOpacity(focusMap, fo.opacity);
      W.focusmap.setGrouped(focusMap, fo.group);
      W.map.setLabels(focusMap, fo.labels); W.map.setLines(focusMap, fo.outlines); setFocusStyles();
    }
    updateFocusUI();
    scheduleFocus();
  }
  // Facility Locations (CVI's overlay_layers; facilities.js): the registry from the manifest supplied (or the built-in
  // five), each layer's file as supplied, read once; a layer that cannot be drawn stays in the list, grayed, with why.
  // All switches on the usable layers only; Clear switches all off. Points show only with counties picked (CVI).
  const FAC = W.facilities;
  fo.fac = { reg: FAC.registry(null), layers: {}, on: [], skipped: [], attributes: Object.create(null),
    prepared: FAC.prepare(Object.create(null), null, root.CVIWA_GEO.counties, 0) };
  let facilityLoad = 0;
  const NOT_SUPPLIED = 'Not loaded: open the CVI map from the landing page with this file to show it.';
  // Says why a facility layer file shows no points, or which of its rows were left out ('' when none).
  function facReason(r) {
    if (!r) return NOT_SUPPLIED;
    if (!r.ok) return r.reason === 'unreadable' ? 'This file could not be read.'
      : r.reason === 'no rows' ? 'The file has no rows.'
      : /^no (latitude|longitude) column$/.test(r.reason)
        ? 'No ' + r.reason.slice(3) + ' (Lat, Latitude or y; Long, Lon, Lng, Longitude or x).'
      : r.reason === 'no rows with valid coordinates'
        ? 'No row has valid coordinates within -90..90 latitude and -180..180 longitude. Left out: '
          + (r.outOfRange + r.dropped) + ((r.outOfRange + r.dropped) === 1 ? ' row.' : ' rows.')
      : 'No row has numbers in both coordinate columns.';
    const left = [];
    if (r.dropped) left.push(r.dropped + (r.dropped === 1 ? ' row' : ' rows') + ' without numeric coordinates');
    if (r.outOfRange) left.push(r.outOfRange + (r.outOfRange === 1 ? ' row' : ' rows') + ' outside -90..90 / -180..180');
    return left.length ? 'Left out: ' + left.join('; ') + '.' : '';
  }
  const facUsable = k => !!(fo.fac.layers[k] && fo.fac.layers[k].ok);
  // Rebuilt after every change; preserve() keeps keyboard focus and list scroll positions where they were.
  function renderFacilities() {
    root.WSDA.facilityUI.preserve($('fo-fac-list'), buildFacilityList);
  }
  // Rebuilds the sidebar's facility list: the manifest notes, the layer controls and the count of layers shown.
  function buildFacilityList() {
    const list = $('fo-fac-list'), byKey = new Map(fo.fac.reg.layers.map(l => [l.key, l]));
    list.replaceChildren();
    // CVI warns when a manifest is present but adds no layer (cvi_overlay_manifest_status); the page also names the
    // rows it skipped (a reserved key, more than 500 layers).
    const notes = [];
    if (fo.fac.manifest === 'malformed') notes.push('The facility layer list (manifest) has no "key" and "file" columns, so it added no layers; only the built-in layers are listed.');
    if (fo.fac.manifest === 'unreadable')
      notes.push('The facility layer list (manifest) could not be read; only the built-in layers are listed.');
    (fo.fac.skipped || []).forEach(x => notes.push('Manifest row ' + x.row + ' not used: ' + x.reason + '.'));
    notes.forEach(t => {
      const n = doc.createElement('p'); n.className = 'fac-why fac-note-manifest';
      n.textContent = t; list.appendChild(n);
    });
    const local = { selectedLayers: fo.fac.on, attributes: fo.fac.attributes };
    const controls = doc.createElement('div'); list.append(controls);
    root.WSDA.facilityUI.render(controls, fo.fac.prepared, local, () => {
      fo.fac.on = local.selectedLayers; fo.fac.attributes = local.attributes; applyFacilities();
    }, 'focus', { counts: fo.fac.result && fo.fac.result.counts,
      emptyReason: fo.counties.length ? 'No facilities match the selected focus counties and attributes.' : 'Pick a focus county to show facilities.',
      reason: k => facReason(fo.fac.layers[k]) });
    const usable = fo.fac.reg.layers.filter(l => facUsable(l.key)).length;
    $('fo-fac-sum').textContent = !usable ? 'no layer loaded'
      : fo.fac.on.length ? fo.fac.on.length + ' of ' + usable + ' shown' : 'none shown';
  }
  // Picks the facilities inside the focus counties for the ticked layers and attributes, and draws them.
  function applyFacilities() {
    const geometry = FAC.countyMembership(root.CVIWA_GEO.counties, fo.counties);
    fo.fac.result = FAC.select(fo.fac.prepared, { layers: fo.fac.on, attributes: fo.fac.attributes,
      geometry: p => geometry.contains(p.lon, p.lat) });
    renderFacilities();
    renderNameMarkers();
    if (focusLive()) W.focusmap.setFacilities(focusMap, fo.fac.prepared.layers.filter(l => l.usable).map(l => {
      const selected = fo.fac.result.layers.find(x => x.key === l.key);
      return Object.assign({}, l, { points: selected ? selected.points : [] });
    }), fo.fac.on);
    renderFocusLegend();
  }
  $('fo-fac-all').addEventListener('click', () => {
    fo.fac.on = fo.fac.reg.layers.map(l => l.key).filter(facUsable); renderFacilities(); applyFacilities();
  });
  $('fo-fac-clear').addEventListener('click', () => { fo.fac.on = []; applyFacilities(); });
  // datasets: { <dataset id>: { file: Blob } } as handed over (the manifest under "manifest", each layer under its key).
  // Replaces the facility files of the last call; switches of layers that are still usable stay on.
  W.setFacilityFiles = async function (datasets) {
    const op = ++facilityLoad, d = datasets || {}, files = Object.create(null);
    const text = x => x && x.file instanceof root.Blob ? x.file.text().catch(() => null) : Promise.resolve(undefined);
    const mt = await text(d.manifest), manifest = typeof mt === 'string' ? W.csv.parse(mt) : null, reg = FAC.registry(manifest);
    const rs = await Promise.all(reg.layers.map(async l => {
      const t = await text(d[l.key]);
      if (typeof t === 'string') files[l.key] = W.csv.parse(t);
      return [l.key, t === undefined ? null : t === null ? { ok: false, reason: 'unreadable' } : FAC.parseLayer(files[l.key], l.nameColumn)];
    }));
    if (op !== facilityLoad) return fo.fac;
    const prepared = FAC.prepare(files, manifest, root.CVIWA_GEO.counties, op);
    const next = FAC.reconcile(prepared, fo.fac.on, fo.fac.attributes, false);
    fo.fac = { reg, layers: Object.fromEntries(rs), on: next.selectedLayers, attributes: next.attributes, prepared,
      skipped: reg.skipped,
      manifest: d.manifest ? (typeof mt === 'string' ? (reg.malformed ? 'malformed' : 'ok') : 'unreadable') : 'none' };
    const notice = $('fo-fac-notice'); notice.hidden = !next.cleared.length;
    notice.textContent = next.cleared.length ? 'Cleared unavailable attribute selections: ' + next.cleared.join(', ') : '';
    if (focusLive()) {
      focusMap.clearHover(); if (focusMap.clickPopup) { focusMap.clickPopup.remove(); focusMap.clickPopup = null; }
    }
    applyFacilities();
    if (lookupPage) lookupPage.facilitiesChanged();   // S11: Premise Lookup's facility layers
    return fo.fac;
  };
  renderFacilities();
  // County Focus style (CVI's intra_* style inputs and hide_cvi_circles), on the Focus map only. Its basemap is its own
  // (CVI's intra_basemap), the offline county map first (S3); a basemap that cannot load says so on the Focus map.
  const foBinsShown = () => { $('fo-bins-field').hidden = !(fo.scaling === 'quantile' || fo.scaling === 'natural'); };
  $('fo-scaling').addEventListener('change', e => { fo.scaling = e.target.value; foBinsShown(); scheduleFocus(); });
  $('fo-bins').addEventListener('change', e => { fo.nBins = Number(e.target.value); scheduleFocus(); });
  $('fo-opacity').addEventListener('change', e => {
    fo.opacity = e.target.value; if (focusLive()) W.focusmap.setOpacity(focusMap, fo.opacity); renderFocusLegend();
  });
  $('fo-hide').addEventListener('change', e => {
    fo.hide = e.target.checked;
    if (focusLive()) W.focusmap.setHidden(focusMap, fo.hide);
    renderFocusLegend();
    st.syncPngControls();   // the GIF box is grayed while the circles are hidden
  });
  // "Group nearby premises": CVI's clusters on or off on the live map; the
  // PNG and the GIF keep their own grouping.
  $('fo-group').addEventListener('change', e => {
    fo.group = e.target.checked;
    if (focusLive()) W.focusmap.setGrouped(focusMap, fo.group);
    renderFocusLegend();
  });
  // ---- County Focus legend (CVI's map_legend_ui, County Focus branch) ----
  // CVI's prompts and sections: "Premises role" (both swatches always), "Animals per premises", the cluster examples
  // and note, the activity note. Deliberate differences: the role swatches at the circle opacity over
  // the land under the circles (full strength on a dark basemap), as the WA legend (S1.1); the sizes nested at the radii
  // the map draws (4–24 px, from the circles' own partition: focus.build().legend), no 20 px cap; with Hide CVI circles
  // one line in place of the premises sections; with the premises coordinate columns missing, the strip's reason (CVI:
  // "No data matches current filters.").
  const focusLand = () => {
    const b = B.get(fo.basemap);
    if (b && !(focusMap && focusMap.basemapFailed)) return b.dark ? null : '#ffffff';
    return focusMap && focusMap.nr ? W.map.landColor(focusMap) : W.map.LAND_PAINT['fill-color'];
  };
  // Draws the County Focus legend with its population part; returns what the main part drew.
  function renderFocusLegend() {
    const drew = renderFocusLegendBody();
    pcLegend($('legend-panel-focus'), 'focus');
    return drew;
  }
  // Draws the County Focus legend's main part (facilities, premises roles, sizes, clusters); returns what it shows.
  function renderFocusLegendBody() {
    const p = $('legend-panel-focus');
    p.textContent = '';
    const line = (t, cls) => {
      const e = doc.createElement(cls ? 'div' : 'em'); if (cls) e.className = cls;
      e.textContent = t; p.appendChild(e); return e;
    };
    const head = t => {
      const h = doc.createElement('div'); h.style.marginBottom = '4px';
      const s = doc.createElement('strong'); s.textContent = t; h.appendChild(s); p.appendChild(h);
    };
    const hr = () => { p.appendChild(doc.createElement('hr')).style.margin = '6px 0'; };
    const facilities = fo.fac && fo.fac.result ? fo.fac.result.layers : [];
    if (facilities.length) {
      head('Facility locations');
      facilities.forEach(l => {
        const row = doc.createElement('div'); row.className = 'lg-row';
        const mark = W.facilities.markElement(l, 18);
        const text = doc.createElement('span'); text.textContent = l.liveLabel + ' — ' + l.count;
        row.append(mark, text); p.append(row);
      });
      const shared = W.facilities.sharedNote(facilities);
      if (shared) line(shared, 'lg-note facility-shared-note');
      line('Facilities are unclustered points within the selected focus counties, refined by their attributes. Counts are rows, not deduplicated sites.', 'lg-note'); hr();
    }
    const b = fo.built || { premises: [], missingCoordinates: [] };
    if (!fo.counties.length) {
      line('Pick a focus county in the sidebar to view the map.'); return (fo.legend = { state: 'no-picks' });
    }
    if (b.missingCoordinates.length && fo.strip && fo.strip.lines) {
      line(fo.strip.lines.join(' ')); return (fo.legend = { state: 'no-coordinates' });
    }
    if (!b.premises.length) { line('No data matches current filters.'); return (fo.legend = { state: 'empty' }); }
    if (fo.hide) { line('CVI circles are hidden ("Hide CVI circles" in County Focus Style).'); return (fo.legend = { state: 'hidden' }); }
    head('Premises role');
    const land = focusLand(), op = Number(fo.opacity);
    const swatches = [['Importer — received animals', '#1C9CD9'], ['Exporter — sent animals', '#F0A06E']]
      .map(([label, color]) => {
      const row = doc.createElement('div'); row.className = 'lg-row';
      const shown = land ? W.palettes.blend(color, op, land) : color.toLowerCase();
      const dot = doc.createElement('span'); dot.className = 'lg-dot'; dot.style.width = dot.style.height = '14px'; dot.style.background = shown;
      const t = doc.createElement('span'); t.textContent = label; row.append(dot, t); p.appendChild(row);
      return { label, color, shown, land };
    });
    let sizes = [];
    if (b.legend) {
      hr(); head('Animals per premises');
      const n = nestedSizes(b.legend.values, b.legend.radii);
      sizes = n.labels; p.appendChild(n.svg);
    }
    // The cluster example only while premises are grouped; it says the bubbles keep one size.
    if (fo.group) {
      hr();
      const cl = doc.createElement('div'); cl.className = 'lg-row'; cl.style.gap = '5px';
      [['12', '#1C9CD9'], ['8', '#F0A06E']].forEach(([n, c]) => {
        const e = doc.createElement('span'); e.className = 'lg-cl'; e.style.background = c; e.textContent = n;
        cl.appendChild(e);
      });
      const ct = doc.createElement('span'); ct.className = 'lg-note'; ct.style.color = '#444';
      ct.textContent = 'Numbered bubbles group nearby premises (count shown) and keep one size; zoom in, or untick ' +
        '"Group nearby premises", to see each premises sized.';
      cl.appendChild(ct); p.appendChild(cl);
    }
    hr();
    const note = doc.createElement('div'); note.className = 'lg-note';
    const emph = doc.createElement('em'); emph.textContent = 'at each premises';
    note.append('Counts are activity ', emph, '. A WA-to-WA shipment between two focus counties appears at both its origin and destination premises, so layer totals are not deduplicated shipment volume.');
    p.appendChild(note);
    return (fo.legend = { state: 'legend', swatches, sizes });
  }
  $('fo-labels').addEventListener('change', e => {
    fo.labels = e.target.checked; if (focusLive()) W.map.setLabels(focusMap, fo.labels);
  });
  $('fo-outlines').addEventListener('change', e => {
    fo.outlines = e.target.checked; if (focusLive()) W.map.setLines(focusMap, fo.outlines);
  });
  const foBm = $('fo-basemap'), foLs = $('fo-label-style'), foBs = $('fo-boundary-style');
  fillBasemaps(foBm);
  fo.basemap = B.OFFLINE;
  function setFocusBasemap(id) {
    const b = B.get(id);
    fo.basemap = b ? b.id : B.OFFLINE; foBm.value = fo.basemap;
    $('fo-basemap-note').textContent = B.providerLine(b); $('fo-basemap-note').hidden = !b;
    $('focus-basemap-status').hidden = true;
    if (focusLive()) W.map.setBasemap(focusMap, b);
    renderFocusLegend();   // the swatches follow the land under the circles
  }
  // Says the County Focus tile basemap could not be loaded, if it is still the choice.
  function focusBasemapError(b) {
    if (B.get(fo.basemap) !== b) return;   // an earlier choice
    $('focus-basemap-msg').textContent = 'Map tiles from ' + b.provider + ' could not be loaded (no internet connection, a blocked network, or the provider is unavailable). The county shapes are shown instead.';
    $('focus-basemap-status').hidden = false;
    renderFocusLegend();
  }
  foBm.addEventListener('change', e => setFocusBasemap(e.target.value));
  $('focus-basemap-offline').addEventListener('click', () => setFocusBasemap(B.OFFLINE));
  B.LABEL_STYLES.forEach(([v, t]) => foLs.appendChild(new root.Option(t, v)));
  B.BOUNDARY_STYLES.forEach(([v, t]) => foBs.appendChild(new root.Option(t, v)));
  foLs.value = fo.labelStyle; foBs.value = fo.boundaryStyle;
  const setFocusStyles = () => { if (focusLive()) W.map.setContrast(focusMap, fo.labelStyle, fo.boundaryStyle); };
  foLs.addEventListener('change', e => { fo.labelStyle = e.target.value; setFocusStyles(); });
  foBs.addEventListener('change', e => { fo.boundaryStyle = e.target.value; setFocusStyles(); });
  // CVI's auto-zoom: 300 ms after the last change of the picked counties, while the County Focus view is shown, to the
  // counties picked then; none picked (Clear) leaves the camera where it is.
  let foFitTimer = null;
  function focusPicked() {
    if (foFitTimer) root.clearTimeout(foFitTimer);
    foFitTimer = root.setTimeout(() => {
      foFitTimer = null;
      if (st.view === 'focus' && fo.counties.length && focusLive() && focusMap.ready) {
        W.focusmap.fitTo(focusMap, fo.counties); fo.fits = (fo.fits || 0) + 1;
      }
    }, 300);
  }
  // Recompute (debounced 250 ms, as CVI's intrastate_line_data): the premises, what the map draws, boxes and strip.
  let foTimer = null;
  function scheduleFocus(ms) {
    if (foTimer) root.clearTimeout(foTimer); foTimer = root.setTimeout(recomputeFocus, ms === undefined ? 250 : ms);
  }
  // The County Focus sidebar filters, before the chart filters are folded in.
  function focusOpts() {
    return { counties: fo.counties, direction: fo.direction, mode: fo.mode, species: fo.species, rawSpecies: fo.speciesSub,
      years: fo.years, quarters: fo.quarters, scaling: fo.scaling, nBins: fo.nBins };
  }
  function recomputeFocus() {
    foTimer = null;
    if (st.master) reconcileView('focus', FO.summaryRows(st.master, focusOpts()) || [],   // MC, as on the WA map
      { pickerEmpty: !(fo.species.length && fo.quarters.length && fo.years.length && fo.counties.length) });
    const o = W.crossfilter.mapFilters('focus', focusOpts(), st.cf);
    // req(): a master, at least one species, quarter, year and county; otherwise nothing is drawn and nothing said.
    const req = !!(st.master && o.species.length && o.quarters.length && o.years.length && o.counties.length);
    fo.built = req ? FO.build(st.master, o) : {
      missingCoordinates: st.master ? FO.COORDS.filter(c => st.master.header.indexOf(c) < 0) : [],
      omittedRows: 0, selectedRowIndices: [], premises: [] };
    if (req && !fo.built.premises.length && !fo.built.missingCoordinates.length && !fo.built.omittedRows && st.view === 'focus')
      toast('No records match the selected counties + filters.', 4000);   // CVI's warning
    // MC: the premises a chart picked (a premises, a county or a corridor) are highlighted, the others dimmed.
    const highlight = st.master ? W.crossfilter.focusHighlight(fo.built.premises, st.master.rows, cfState()) : null;
    if (focusLive())
      W.focusmap.draw(focusMap, { premises: fo.built.premises, counties: o.counties, highlight },
        { opacity: fo.opacity });
    if (focusLive()) W.map.setPopulation(focusMap, pcFor('focus'));   // PC: the names follow the picked counties
    applyFacilities();
    fo.valueBoxes = st.master
      ? FO.valueBoxes(req ? FO.summary(st.master, o, fo.built) : null, fo.built.missingCoordinates)
      : FO.valueBoxes(null);
    fo.strip = st.master ? FO.strip(o, fo.built) : { state: 'none', lines: ['Load a master dataset.'] };
    renderFocusLegend();
    if (st.view === 'focus') paintSummaries(fo.valueBoxes, fo.strip);
    if (st.view === 'focus') { renderCharts(); renderChips(); }   // S7
    fo.version++;
  }

  // ---- S7: charts and the layout switch (charts.js, chartsvg.js) ------------------------------------------------
  // A layout switch above the map in place of CVI's "Show charts" drawer: Map, Map + charts (a column beside the map, or
  // under the maps in narrow windows and in Compare) and Charts. Each view keeps its own choice while the tab is open,
  // Map when the page opens (CVI's drawer starts closed); Reset All leaves it. The charts are computed only while shown,
  // from the rows the view's map draws (CVI's .chart_inputs), so they follow Browse frames and, in Compare, the left map.
  // The Measure picker and the Emerging comparison, kept while the tab is open; exact values on hover. On the WA State
  // map a county's bar in "Top counties" or "Emerging vs cooling" adds it to Spotlight Counties or removes it (a click,
  // Enter or Space).
  const CH = W.charts, CS = W.chartsvg;
  let picks = new Map();   // MC: the clickable marks of the charts on screen, by button id (markPick)
  const chipBar = $('chart-filters');   // MC: the chart filters bar (renderChips)
  st.layouts = { wa: 'map', flow: 'map', focus: 'map' };
  st.chartMeasure = 'animals';
  st.chartCompare = 'previous';
  st.charts = null;   // test hook: the charts drawn last ({ view, opts, charts })
  st.chartsVersion = 0;
  const viewArea = $('view-area'), chartGrid = $('chart-grid'), chartTip = $('chart-tip');
  const layoutNow = () => st.layouts[st.view];
  const BELOW_WIDTH = 1200;   // narrower windows put the charts under the maps
  // Arranges the view area for its layout (map, split or charts) and for Compare, and marks the layout button.
  function applyLayout() {
    const layout = layoutNow(), compare = st.view === 'wa' && st.periodMode === 'compare';
    doc.querySelectorAll('.layout-switch [data-layout]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-layout') === layout));
    });
    viewArea.classList.toggle('split', layout === 'split');
    viewArea.classList.toggle('charts', layout === 'charts');
    viewArea.classList.toggle('compare-on', compare);
    viewArea.classList.toggle('below', layout === 'split' && (root.innerWidth < BELOW_WIDTH || compare));
    $('map-area').hidden = layout === 'charts';
    $('chart-panel').hidden = layout === 'map';
    if (layout === 'map') chartTip.hidden = true;
    resizeMaps();
    renderCharts();
  }
  // The maps of the view on screen take their new size (MapLibre follows only the window's size by itself).
  function resizeMaps() {
    if (st.view === 'wa') liveMaps().forEach(m => m.map.resize());
    if (st.view === 'flow' && flowLive()) flowMap.map.resize();
    if (st.view === 'focus' && focusLive()) focusMap.map.resize();
  }
  doc.querySelectorAll('.layout-switch [data-layout]').forEach(b => b.addEventListener('click', () => {
    st.layouts[st.view] = b.getAttribute('data-layout');
    applyLayout();
  }));
  let chartResizeTimer = null;
  root.addEventListener('resize', () => {
    if (chartResizeTimer) root.clearTimeout(chartResizeTimer);
    chartResizeTimer = root.setTimeout(() => {
      chartResizeTimer = null;
      if (layoutNow() !== 'map') applyLayout();
    }, 150);
  });

  // The Measure picker, shown as "Show charts by:": Unique CVIs grayed with the reason when the table has no CVI
  // column.
  const measureSel = $('chart-measure');
  Object.keys(CH.MEASURES).forEach(k => measureSel.appendChild(new root.Option(CH.MEASURES[k].option, k)));
  // Grays the Unique CVIs chart measure, with its reason, when the master cannot give it.
  function syncMeasure() {
    const cvis = CH.measureAvailable(st.master, 'cvis');
    measureSel.querySelector('option[value="cvis"]').disabled = !cvis.ok;
    const reason = $('chart-measure-reason');
    reason.hidden = cvis.ok || !st.master;
    reason.textContent = cvis.ok ? '' : 'Unique CVIs: ' + cvis.reason;
    if (!cvis.ok && st.chartMeasure === 'cvis') st.chartMeasure = 'animals';
    measureSel.value = st.chartMeasure;
  }
  // While the movement view is on, the measure also ranks its lines, so the WA map is drawn again,
  // whatever view is on screen: a view switch recomputes nothing. recompute() draws the charts only
  // on the WA view, so another view's charts are drawn here.
  measureSel.addEventListener('change', e => {
    st.chartMeasure = e.target.value;
    if (st.movementOn) schedule(0);
    if (!(st.view === 'wa' && st.movementOn)) renderCharts();
  });

  // One card per chart of the view, in CVI's order; the Emerging card holds its comparison picker.
  let cardsFor = null;
  // "Show as table": the charts whose table is open, by chart id, kept while the charts are redrawn.
  const tablesOpen = new Set();
  // Builds a chart's "Show as table" table, or its note when the chart is empty.
  function chartTable(c) {
    const t = CH.table(c, st.chartMeasure, st.view), box = doc.createElement('div');
    if (t.empty) {
      box.appendChild(el('p', 'muted', t.empty));
      return box;
    }
    const table = doc.createElement('table'), head = doc.createElement('tr'), body = doc.createElement('tbody');
    table.className = 'chart-data';
    table.appendChild(el('caption', null, t.caption));
    t.head.forEach((h, i) => {
      const th = el('th', t.numeric[i] ? 'num' : null, h);
      th.scope = 'col';
      head.appendChild(th);
    });
    const thead = doc.createElement('thead');
    thead.appendChild(head);
    t.rows.forEach(r => {
      const tr = doc.createElement('tr');
      r.forEach((v, i) => tr.appendChild(el(i === 0 ? 'th' : 'td', t.numeric[i] ? 'num' : null, v)));
      tr.firstChild.scope = 'row';
      body.appendChild(tr);
    });
    table.append(thead, body);
    box.appendChild(table);
    return box;
  }
  // Makes a chart's "Show as table" / "Hide table" button.
  function tableToggle(id) {
    const b = el('button', 'chart-table-toggle', tablesOpen.has(id) ? 'Hide table' : 'Show as table');
    b.type = 'button';
    b.setAttribute('aria-expanded', String(tablesOpen.has(id)));
    b.setAttribute('aria-controls', 'chart-table-' + id);
    b.addEventListener('click', () => {
      if (tablesOpen.has(id)) tablesOpen.delete(id); else tablesOpen.add(id);
      renderCharts();
    });
    return b;
  }
  // Builds the "Compare with" picker on the emerging chart's card.
  function compareTools() {
    const row = el('div', 'chart-tools'), lab = el('label', null, 'Compare with'), sel = doc.createElement('select');
    sel.id = 'chart-compare';
    lab.htmlFor = sel.id;
    sel.title = 'Previous quarter: the two latest quarters with data (CVI\'s comparison). Same quarter last year: the ' +
      'latest quarter against the same quarter one year earlier, which must be among the selected years.';
    [['previous', 'Previous quarter'], ['last_year', 'Same quarter last year']].forEach(([v, t]) => {
      sel.appendChild(new root.Option(t, v));
    });
    sel.value = st.chartCompare;
    sel.addEventListener('change', e => { st.chartCompare = e.target.value; renderCharts(); });
    row.append(lab, sel);
    return row;
  }
  // The charts of the view on screen: CVI's, and on WA State while the movement view is on its corridor chart (MC).
  const chartIds = () => (st.view === 'wa' && st.movementOn ? CH.CHARTS.wa.concat(['corridors']) : CH.CHARTS[st.view]);
  const cardsKey = () => st.view + (st.view === 'wa' && st.movementOn ? '+movement' : '');
  // Creates an empty card for each chart the view shows, with its table tools.
  function buildCards() {
    chartGrid.replaceChildren();
    chartIds().forEach(id => {
      const card = doc.createElement('figure');
      card.className = 'chart-card';
      card.dataset.chart = id;
      if (id === 'emerging') card.appendChild(compareTools());
      card.appendChild(el('div', 'chart-svg'));
      const tools = el('div', 'chart-table-tools links');
      tools.appendChild(tableToggle(id));
      const holder = el('div', 'chart-table');
      holder.id = 'chart-table-' + id;
      holder.hidden = !tablesOpen.has(id);
      card.append(tools, holder);
      chartGrid.appendChild(card);
    });
    cardsFor = cardsKey();
  }
  // The rows of the view's sidebar filters (the charts' rows before chart filters), and on County Focus its premises.
  function chartInput() {
    if (!st.master) return { rows: [] };
    if (st.view === 'wa') return { rows: W.summary.mapRows(st.master, waSidebar()) || [] };
    if (st.view === 'flow') return { rows: FL.mapRows(st.master, flowFilters()) || [] };
    return { rows: FO.summaryRows(st.master, focusOpts()) || [], premises: fo.built ? fo.built.premises : [],
      missingCoordinates: fo.built ? fo.built.missingCoordinates : [] };
  }
  // The Spotlight Counties value a chart's place stands for (a county of the spotlight list under its trimmed name);
  // "Non-WA" (CVI's label for "N/A" and "NA") is never one.
  function spotChoice(label) {
    if (label === 'Non-WA') return null;
    const c = st.spotlightChoices.find(x => String(x).trim() === label);
    return c === undefined ? null : c;
  }
  // MC: each chart counts the sidebar's rows with every chart filter but the one it sets (crossfilter.chartRows); County
  // Focus's top premises are built from the rows of the other chart filters (crossfilter.premisesRule).
  function chartsNow(opts, ids) {
    const input = chartInput(), cf = cfState(), view = st.view;
    return (ids || chartIds()).map(id => {
      if (view === 'wa' && id === 'corridors') {
        return st.movement ? corridorChart(st.movement.counted, Object.assign({}, opts, { view })) : CH.build(id, { rows: [] },
          Object.assign({}, opts, { view }));
      }
      let premises = input.premises;
      const rule = id === 'top_premises' && st.master ? W.crossfilter.premisesRule(cf) : null;
      if (rule) premises = FO.build(st.master, Object.assign(focusOpts(), { keep: rule })).premises;
      return CH.build(id, { rows: W.crossfilter.chartRows(view, input.rows, cf, id), premises,
        missingCoordinates: input.missingCoordinates }, Object.assign({}, opts, { view }));
    });
  }
  // Redraws the view's charts (not while only the map is shown); a focused button keeps its focus.
  function renderCharts() {
    if (layoutNow() === 'map') return;
    const t0 = root.performance.now();
    if (cardsFor !== cardsKey()) buildCards();
    const per = st.view === 'wa' ? st : st.view === 'flow' ? fl : fo;
    const opts = { measure: st.chartMeasure, compare: st.chartCompare, years: per.years.map(String),
      quarters: per.quarters.slice() };
    const charts = chartsNow(opts);
    // A button with keyboard focus keeps it across the redraw.
    const a = doc.activeElement, held = a && a.closest && a.closest('#chart-grid .chart-pick');
    const keep = held ? { chart: held.closest('.chart-card').dataset.chart, id: held.getAttribute('data-pick') } : null;
    const boxOf = c => chartGrid.querySelector('.chart-card[data-chart="' + c.id + '"] .chart-svg');
    const widthOf = c => Math.max(240, Math.floor(boxOf(c).clientWidth));
    picks = new Map();
    const draw = c => {
      boxOf(c).innerHTML = CS.svg(c, { width: widthOf(c), interactive: true, pickOf: markPick, fade: fadeChart,
        noPick: noPickHint, measure: st.chartMeasure, idPrefix: 'chart-' + c.id });
      // The chart's numbers as a table, while its table is open.
      const card = boxOf(c).closest('.chart-card'), holder = card.querySelector('.chart-table');
      const toggle = card.querySelector('.chart-table-toggle'), open = tablesOpen.has(c.id);
      holder.hidden = !open;
      holder.replaceChildren(...(open ? [chartTable(c)] : []));
      toggle.textContent = open ? 'Hide table' : 'Show as table';
      toggle.setAttribute('aria-expanded', String(open));
    };
    charts.forEach(draw);
    // The column's scroll bar can appear (or go) once the charts are drawn; then they are drawn again at the new width.
    charts.filter(c => Number(boxOf(c).firstChild.getAttribute('width')) !== widthOf(c)).forEach(draw);
    if (keep) {
      const again = [...chartGrid.querySelectorAll('.chart-card[data-chart="' + keep.chart + '"] .chart-pick')]
        .find(x => x.getAttribute('data-pick') === keep.id);
      if (again) again.focus();
    }
    st.charts = { view: st.view, opts, charts };
    st.chartsMs = root.performance.now() - t0;   // test hook: how long computing and drawing took
    st.chartsVersion++;
  }
  // Click-to-spotlight (WA State map only): the county is added to Spotlight Counties, or removed; the list, the map
  // (after the usual 250 ms pause) and the charts' highlighting all follow. Since MC the spotlight also filters the
  // other charts.
  function toggleSpot(value) {
    st.spotlight = st.spotlight.indexOf(value) >= 0 ? st.spotlight.filter(v => v !== value) : st.spotlight.concat([value]);
    renderList('spotlight');
    st.cfMessage = null;
    renderCharts();
    renderChips();
    schedule();
  }

  // ---- MC: chart cross-filtering (crossfilter.js) -----------------------------------------------------------------
  // A click on a bar or point toggles a chart filter of the view on screen: species and period filter the
  // map, value boxes and strip like a sidebar pick; a place, corridor or premises highlights it, and every chart is
  // filtered by the others' picks. On WA State a county is the spotlight, as since S7. The chip bar above the map lists
  // them, with a × each and "Clear chart filters"; Reset All and a new file clear them all.
  // The WA State map's sidebar filters (the rows before chart filters).
  function waSidebar() {
    return { species: st.species, years: st.years, quarters: st.quarters, direction: st.direction, rawSpecies: st.speciesSub };
  }
  // What reconcile needs besides the rows on WA State: whether a required picker is empty, and while a corridor is
  // picked, the movement view's rows under the sidebar filters (it ignores Direction).
  function waReconcileCtx() {
    const pickerEmpty = !(st.species.length && st.years.length && st.quarters.length && st.direction.length);
    const pairRows = st.movementOn && st.cf.wa.pair.length
      ? W.movement.rows(st.master, movementFilters(waSidebar(), st.speciesSub)).counted : null;
    return { pickerEmpty, pairRows };
  }
  // The WA State map's species, years and quarters with the species and period chart filters folded in.
  function waMapFilters() {
    return W.crossfilter.mapFilters('wa', { species: st.species, years: st.years, quarters: st.quarters }, st.cf);
  }
  // The chart filters with the WA State places taken from Spotlight Counties, under the labels the charts use.
  function cfState() {
    const places = st.spotlight.map(v => CH.countyLabel(v)).filter(v => v !== null);
    return W.crossfilter.setPlaces(st.cf, 'wa', places);
  }
  const periodModeOf = view => (view === 'wa' ? st.periodMode : view === 'flow' && fl.browse ? 'browse' : 'single');
  // A sidebar change that leaves a chart filter without rows drops it, with a message in the chip bar (and a toast on
  // the view on screen). rows: the view's rows under the sidebar filters alone. more: { pickerEmpty, pairRows }
  // (crossfilter.reconcile).
  function reconcileView(view, rows, more) {
    if (!W.crossfilter.isActive(st.cf, view)) return;
    const ctx = Object.assign({ periodMode: periodModeOf(view), movementOn: !!st.movementOn }, more);
    const r = W.crossfilter.reconcile(view, st.cf, rows, ctx);
    if (!r.dropped.length) return;
    st.cf = r.state;
    st.cfMessage = { view, text: W.crossfilter.dropMessage(view, r.dropped) };
    if (st.view === view) toast(st.cfMessage.text, 6000);
  }
  // The marks of the charts on screen that a click filters by, for chartsvg.js (redrawn with every chart): the
  // button's id (the pick's kind and value), whether it is picked, what a click does, and on WA State the Spotlight
  // Counties value of a county ("Non-WA", or a county not in the list, cannot be clicked).
  function markPick(chart, mark) {
    const pick = W.crossfilter.pickOf(st.view, chart, mark, { periodMode: periodModeOf(st.view) });
    if (!pick) return null;
    let spot = null, on;
    if (pick.kind === 'place' && st.view === 'wa') {
      spot = spotChoice(pick.value);
      if (spot === null) return null;
      on = st.spotlight.indexOf(spot) >= 0;
    } else {
      on = W.crossfilter.isPicked(st.cf, st.view, pick);
    }
    const id = pick.kind + '|' + encodeURIComponent(pick.value);
    picks.set(id, Object.assign({ spot }, pick));
    return { id, on, spot, click: W.crossfilter.hoverText(st.view, pick, on) };
  }
  // Why a chart's marks cannot be clicked, under their hover text (the over-time chart while browsing or comparing).
  function noPickHint(chart) {
    return W.crossfilter.noPickText(st.view, chart, { periodMode: periodModeOf(st.view) });
  }
  // A chart's other marks are faint while values of its own kind are picked (on WA State: while counties are
  // spotlighted, as in S7).
  function fadeChart(chart) {
    const kind = W.crossfilter.ownKind(chart.id, st.view);
    return !!kind && cfState()[st.view][kind].length > 0;
  }
  // Applies a click on a chart mark: a place on WA State spotlights its county, anything else toggles a chart filter.
  function clickPick(id) {
    const pick = picks.get(id);
    if (!pick) return;
    if (pick.kind === 'place' && st.view === 'wa') {
      toggleSpot(pick.spot);
      return;
    }
    st.cf = W.crossfilter.toggle(st.cf, st.view, pick);
    chartFiltersChanged();
  }
  // After a chart filter changes: the chips and charts at once, the map after the usual 250 ms pause.
  function chartFiltersChanged() {
    st.cfMessage = null;
    renderChips();
    renderCharts();
    if (st.view === 'wa') schedule();
    else if (st.view === 'flow') scheduleFlow();
    else scheduleFocus();
  }
  chartGrid.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.chart-pick');
    if (b) clickPick(b.getAttribute('data-pick'));
  });
  chartGrid.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const b = e.target.closest && e.target.closest('.chart-pick');
    if (!b) return;
    e.preventDefault();
    clickPick(b.getAttribute('data-pick'));
  });
  // The chip bar: one chip per kind of the view on screen (crossfilter.chips), the message about a dropped filter.
  function renderChips() {
    const chips = W.crossfilter.chips(cfState(), st.view);
    const msg = st.cfMessage && st.cfMessage.view === st.view ? st.cfMessage.text : null;
    const list = $('chart-filter-chips');
    list.replaceChildren();
    chips.forEach(c => {
      const chip = el('span', 'cf-chip', c.text);
      chip.dataset.kind = c.kind;
      const x = el('button', 'cf-x', '\u00d7');
      x.type = 'button';
      x.dataset.kind = c.kind;
      x.title = 'Remove this chart filter';
      x.setAttribute('aria-label', 'Remove ' + c.text);
      chip.appendChild(x);
      list.appendChild(chip);
    });
    $('chart-filters-clear').hidden = !chips.length;
    $('chart-filters-msg').textContent = msg || '';
    $('chart-filters-msg').hidden = !msg;
    chipBar.hidden = !chips.length && !msg;
    st.chips = chips.map(c => c.text);   // test hook
  }
  // A chip's ×: that kind of filter goes (on WA State the spotlight chip clears Spotlight Counties).
  function removeChartKind(kind) {
    if (kind === 'place' && st.view === 'wa') {
      st.spotlight = [];
      renderList('spotlight');
    } else {
      st.cf = W.crossfilter.removeKind(st.cf, st.view, kind);
    }
    chartFiltersChanged();
  }
  // "Clear chart filters": every chart filter of the view on screen; on WA State also the spotlight, its county filter.
  function clearChartFilters() {
    st.cf = W.crossfilter.clearView(st.cf, st.view);
    if (st.view === 'wa') {
      st.spotlight = [];
      renderList('spotlight');
    }
    chartFiltersChanged();
  }
  // ---- MC: the movement view on the WA State map (movement.js) ---------------------------------------------------
  // Lines between WA counties in place of the circles, from the map's rows (species, refine, years and quarters, and
  // the species and period chart filters; the Direction checkboxes do not split it). "Lines shown" picks how many of
  // the busiest pairs are drawn; every pair touching a spotlighted county is drawn and in full color. While it is on,
  // the WA State charts add the corridor chart, whose first three bars carry badges 1 to 3 on their lines.
  function movementFilters(f, rawSpecies) {
    return { species: f.species, years: f.years, quarters: f.quarters, keep: f.keep, rawSpecies: rawSpecies || [] };
  }
  // The corridor chart of the movement rows (movement between two counties), with the spotlight's rule.
  function corridorChart(counted, opts) {
    const rule = W.crossfilter.movementChartRule(W.crossfilter.setPlaces(st.cf, 'wa', st.spotlight));
    const rows = W.movement.betweenRows(counted);
    return CH.build('corridors', { rows: rule ? rows.filter(rule) : rows }, Object.assign({}, opts, { view: 'wa' }));
  }
  // What the movement view draws for these filters; withBadges: the left map, whose charts give the badges.
  function movementData(filters, withBadges) {
    const MV = W.movement;
    const r = MV.rows(st.master, filters);
    let badges = [];
    if (withBadges) {
      const chart = corridorChart(r.counted, { measure: st.chartMeasure });
      if (!chart.empty) badges = chart.bars.slice(0, 3).map(b => MV.pairKey(...b.label.split('  \u2192  ')));
    }
    const view = MV.mapView(MV.pairs(r.counted), MV.points(r.counted), { cap: st.movementCap, measure: st.chartMeasure,
      scaling: st.scaling,
      nBins: st.nBins, spotlight: st.spotlight, picked: cfState().wa.pair, badges,
      bySpecies: MV.pairs(r.counted, { bySpecies: true }) });
    return { view, counted: r.counted, leftOutText: MV.leftOutText(r.leftOut) };
  }
  // The movement view's legend, in the map's legend panel; returns what it said (test hook).
  function renderMovementLegend(m, p) {
    p.textContent = '';
    const v = m.view;
    const head = el('div');
    head.style.marginBottom = '4px';
    head.appendChild(el('strong', null, 'Movement between WA counties'));
    p.appendChild(head);
    const row = (svg, text) => {
      const r = el('div', 'lg-mv');
      r.innerHTML = svg;
      r.appendChild(el('span', null, text));
      p.appendChild(r);
    };
    // Lines: one sample line as drawn (width, color, arrowhead) for each rank group drawn, with its ranks and the
    // range of the measure that ranks them.
    const ms = CH.MEASURES[v.measure] || CH.MEASURES.animals;
    p.appendChild(el('div', 'lg-mv-note', 'Lines: county pairs ranked by ' + ms.lower + ' ("Show charts by:"), origin to '
      + 'destination (arrowhead); the busiest thicker, darker and on top.'));
    const unit = n => CH.exact(n) + ' ' + (n === 1 ? ms.one : ms.many);
    W.movement.TIER_WIDTH.forEach((width, tier) => {
      const inTier = v.lines.filter(l => l.tier === tier);
      if (!inTier.length) return;
      const ranks = inTier.map(l => l.rank), values = inTier.map(l => l.value);
      const first = Math.min(...ranks), last = Math.max(...ranks), lo = Math.min(...values), hi = Math.max(...values);
      const l = inTier[0];
      const base = 38 - Math.min(14, 0.6 * l.arrow_px);
      const half = Math.min(8, 0.36 * l.arrow_px);
      const svg = '<svg width="40" height="18" aria-hidden="true">'
        + '<line x1="2" y1="9" x2="' + base.toFixed(1) + '" y2="9" stroke="' + l.color + '" stroke-width="'
        + l.width_px.toFixed(1) + '"/>'
        + '<polygon points="' + base.toFixed(1) + ',' + (9 - half).toFixed(1) + ' 38,9 ' + base.toFixed(1) + ','
        + (9 + half).toFixed(1) + '" fill="' + l.color + '"/></svg>';
      const which = W.movement.busiestLabel(first, last);
      row(svg, which + ': ' + (lo === hi ? unit(hi) : CH.exact(lo) + '\u2013' + unit(hi)));
    });
    row('<svg width="40" height="18" aria-hidden="true"><circle cx="20" cy="9" r="7" fill="none" stroke="#7a3e9d" '
      + 'stroke-width="2.5"/></svg>', 'Ring: animals moved within the county');
    if (v.lines.some(l => l.badge)) {
      row('<svg width="40" height="18" aria-hidden="true"><circle cx="20" cy="9" r="8" fill="#245566" stroke="#ffffff" '
        + 'stroke-width="1.5"/><text x="20" y="12.5" fill="#ffffff" font-size="10" font-weight="bold" text-anchor="middle">1</text></svg>',
      'The busiest corridors in the corridor chart (1 to 3)');
    }
    const busiest = Math.min(v.cap, v.pairsBetween);
    const lead = !v.pairsBetween ? 'No movement between two counties here.'
      : cfState().wa.pair.length ? 'The corridor picked in the chart, over the busiest ' + busiest + ' (faded).'
        : st.spotlight.length ? 'Every pair touching ' + st.spotlight.join(' or ') + ' (' + v.shown + ').'
          : 'The busiest ' + busiest + ' of ' + v.pairsBetween + ' county pairs.';
    const text = lead + ' Lines join county centers; they are not travel routes.';
    p.appendChild(el('div', 'lg-mv-note', text));
    pcLegend(p, 'wa');   // PC: the population layers' block while one is drawn
    return { lines: v.lines.length, rings: v.rings.length, text };
  }
  // The line under the map while the movement view is on: why Direction does not split it, and the rows left out.
  function renderMovementNote() {
    const note = $('mv-note');
    const on = st.view === 'wa' && st.movementOn && !!st.movement;
    note.hidden = !on;
    note.textContent = on ? 'Direction does not split this view: a movement within Washington is both a departure and an '
      + 'arrival.' + (st.movement.leftOutText ? ' ' + st.movement.leftOutText : '') : '';
  }
  const mvCap = $('mv-cap');
  W.movement.TOP_CHOICES.forEach(n => mvCap.appendChild(new root.Option('Top ' + n, String(n))));
  // Brings the movement-lines switch and its Top picker in line with the state.
  function syncMovementControls() {
    $('mv-on').checked = st.movementOn;
    mvCap.value = String(st.movementCap);
    $('mv-cap-row').hidden = !st.movementOn;
    if (st.syncPngControls) st.syncPngControls();   // the GIF box is grayed while the movement view is on
  }
  $('mv-on').addEventListener('change', e => {
    st.movementOn = e.target.checked;
    syncMovementControls();
    syncShadeControls();   // CH: the shading switch grayed while the lines are on
    pcApply();
    st.cfMessage = null;
    schedule(0);
  });
  mvCap.addEventListener('change', e => {
    st.movementCap = Number(e.target.value);
    schedule(0);
  });
  syncMovementControls();

  chipBar.addEventListener('click', e => {
    const x = e.target.closest && e.target.closest('.cf-x');
    if (x) removeChartKind(x.dataset.kind);
    else if (e.target.closest && e.target.closest('#chart-filters-clear')) clearChartFilters();
  });
  // Exact values on hover: the mark's text in a box beside the pointer, or beside a focused bar.
  function showTip(target, x, y) {
    chartTip.textContent = target.getAttribute('data-hover');
    const hint = target.getAttribute('data-click');
    if (hint) chartTip.appendChild(el('span', 'hint', hint));
    chartTip.hidden = false;
    const w = chartTip.offsetWidth, h = chartTip.offsetHeight;
    chartTip.style.left = Math.max(4, Math.min(x + 12, root.innerWidth - w - 8)) + 'px';
    chartTip.style.top = (y + 16 + h > root.innerHeight ? y - h - 10 : y + 16) + 'px';
  }
  chartGrid.addEventListener('pointermove', e => {
    const t = e.target.closest && e.target.closest('[data-hover]');
    if (t) showTip(t, e.clientX, e.clientY);
    else chartTip.hidden = true;
  });
  chartGrid.addEventListener('pointerleave', () => { chartTip.hidden = true; });
  chartGrid.addEventListener('focusin', e => {
    const t = e.target.closest && e.target.closest('.chart-spot');
    if (!t) return;
    const r = t.getBoundingClientRect();
    showTip(t, r.left + 24, r.top + r.height / 2);
  });
  chartGrid.addEventListener('focusout', () => { chartTip.hidden = true; });

  // ---- S7: Export & Preview (exports.js, previews.js) ----------------------------------------------------------
  // CVI's section with deliberate differences: the three previews and one ZIP download per
  // Export click, all from the rows the active view's map draws ("Refine by species" applied; National Flow Combined
  // without WA-to-WA rows), CVI's messages, and "Exports this session" in place of CVI's "Recent exports". The
  // charts written are the ones the page shows, with the "Show charts by:" measure and the Emerging
  // comparison picked. Reset All leaves the section's choices, as CVI's.
  const EX = W.exports, PV = W.previews;
  st.exportHistory = [];
  st.lastExport = null;   // test hook: the last export ({ name, entries, written, errors, bytes, result })
  st.lastExportCharts = null;   // test hook (MC): the charts the last export or Preview Charts drew
  st.exporting = false;
  const EXPORT_BUTTONS = ['preview-map', 'preview-table', 'preview-stats', 'preview-charts', 'run-export'];
  // ---- Population context (PC; shared/population.js) ---------------------------------------------------------
  // One set of three switches for WA State (both Compare maps, the movement view) and County Focus, all off when the
  // page opens. A layer's file loads the first time its switch is turned on; if it cannot be loaded, the
  // switch turns back off and stays grayed with the message (a copy of the site without that file). On National
  // Flow the switches are grayed with the reason. The live maps draw what is on and loaded; the branded PNG takes
  // the same at the click (pcInput); Reset All turns all three off. Names: places of 10,000 or more on WA State;
  // every city and place in the picked counties on County Focus (statewide, 10,000 or more, before any is picked).
  const PC_FLOW_REASON = 'Washington-only layers; not shown on the national map.';
  const PC_FILL_REASON = 'Population density cannot be shown over a county fill; switch to Circles.';
  // What the maps draw now: each layer switched on whose file is loaded.
  // CH: population density is not drawn on WA State while its counties are shaded (two fills cannot be told apart).
  function pcDrawn(view) {
    return { cities: pc.on.cities && !!PN.loaded('cities'), places: pc.on.places && !!PN.loaded('places'),
      density: pc.on.density && !!PN.loaded('density') && !((view || st.view) === 'wa' && isShaded()) };
  }
  // True when any population layer in the set given is drawn.
  function pcAny(on) { return on.cities || on.places || on.density; }
  // The population layers a view's maps draw, and which place names: all in the focus counties, else the larger places.
  function pcFor(view) {
    if (!PN) return null;
    const counties = view === 'focus' && fo.counties.length
      ? root.CVIWA_GEO.counties.features.filter(f => fo.counties.indexOf(f.properties.name) >= 0) : null;
    return { on: pcDrawn(view), ramp: PN.DEFAULT_RAMP, names: counties ? { min: 0, counties } : { min: 10000 } };
  }
  // The branded PNG's input: null while nothing is drawn (the S9 picture unchanged), never on National Flow.
  function pcInput() {
    if (!PN || st.view === 'flow' || !pcAny(pcDrawn(st.view))) return null;
    return { on: pcDrawn(st.view), ramp: PN.DEFAULT_RAMP };
  }
  // Redraws the population layers on every live map, and the legends.
  function pcApply() {
    liveMaps().forEach(m => W.map.setPopulation(m, pcFor('wa')));
    if (focusLive()) W.map.setPopulation(focusMap, pcFor('focus'));
    relegend();
    renderFocusLegend();
  }
  // Grays, ticks and explains the population switches for the view on screen.
  function syncPcControls() {
    if (!PN) { $('pc-block').hidden = true; return; }
    const flow = st.view === 'flow';
    const fill = st.view === 'wa' && isShaded();   // CH
    doc.querySelectorAll('#pc-block .pc-on').forEach(b => {
      const l = b.dataset.layer;
      b.disabled = flow || !!pc.missing[l] || (l === 'density' && fill);
      b.checked = !!pc.on[l];
    });
    $('pc-reason').textContent = flow ? PC_FLOW_REASON : PC_FILL_REASON;
    $('pc-reason').hidden = !(flow || fill);
    $('pc-block').classList.toggle('pc-collapsed', flow);   // heading and reason only
  }
  // Turns one population layer on or off, loading its file the first time; a missing file grays its switch.
  function pcSet(layer, on) {
    pc.on[layer] = !!on;
    syncPcControls();
    if (!on) { pcApply(); return; }
    PN.load(layer, { base: '../' }).then(() => {
      if (pc.on[layer]) { if (!Object.keys(pc.missing).length) $('pc-msg').hidden = true; pcApply(); }
    }, err => {
      if (!pc.on[layer]) return;
      pc.on[layer] = false;
      pc.missing[layer] = true;   // grayed from now on: the file is not in this copy of the site (the alert says so)
      syncPcControls();
      $('pc-msg').textContent = err.message + ' The rest of the map is unaffected.';
      $('pc-msg').hidden = false;
      pcApply();
    });
  }
  // Turns every population layer off.
  function pcOff() {
    pc.on = { cities: false, places: false, density: false };
    syncPcControls();
    pcApply();
  }
  $('pc-block').addEventListener('change', e => {
    const l = e.target && e.target.dataset && e.target.dataset.layer;
    if (l) pcSet(l, e.target.checked);
  });
  syncPcControls();
  // The live legend's block (index.html .lg-pc-*): the outline entries and the density classes, as drawn now.
  function pcLegend(p, view) {
    if (!PN || view === 'flow') return;
    const entries = PN.legendEntries(pcDrawn(view), PN.DEFAULT_RAMP);
    if (!entries.length) return;
    p.appendChild(doc.createElement('hr')).style.margin = '6px 0';
    const head = doc.createElement('div'); head.style.marginBottom = '4px';
    const strong = doc.createElement('strong'); strong.textContent = 'Population context'; head.appendChild(strong);
    p.appendChild(head);
    entries.forEach(e => {
      const row = doc.createElement('div'); row.className = 'lg-row lg-pc';
      if (e.type === 'title') { row.className = 'lg-note lg-pc'; row.textContent = e.label; p.appendChild(row); return; }
      const mark = doc.createElement('span');
      if (e.type === 'line') mark.className = 'lg-pc-line' + (e.dash ? ' dashed' : '');
      else { mark.className = 'lg-pc-swatch'; mark.style.background = e.color; mark.style.opacity = String(PN.DENSITY_OPACITY); }
      const t = doc.createElement('span'); t.textContent = e.label;
      row.append(mark, t); p.appendChild(row);
    });
  }

  // Grays the export buttons while no master is loaded or an export is running, and gives the reason.
  function syncExportGate() {
    EXPORT_BUTTONS.forEach(id => {
      const b = $(id);
      b.disabled = !st.master || st.exporting;
      if (!st.master) b.setAttribute('aria-describedby', 'export-gate-reason');
      else b.removeAttribute('aria-describedby');
    });
    let reason = $('export-gate-reason');
    if (!reason) {
      reason = el('p', 'gate-reason');
      reason.id = 'export-gate-reason';
      $('export-section').querySelector('.preview-grid').before(reason);
    }
    reason.textContent = 'Load a master dataset.';
    reason.hidden = !!st.master;
  }

  // The active view's filters in exports.js's terms, the rows its map draws (both copies of a WA-to-WA movement) and
  // its aggregated rows (circles, lines or premises), computed now from the current choices. With a filter left
  // empty the map draws nothing, so there are no rows. MC: the filters are the map's, with the species and period
  // chart filters folded in (crossfilter.mapFilters; places, corridors and premises only highlight, so they take no
  // rows out of the files), and f.chartFilters names every chart filter on (the chip bar's text) for the Stats text,
  // export_params.json and the chart captions.
  function exportInputs() {
    const m = st.master;
    const chartFilters = W.crossfilter.chips(cfState(), st.view).map(c => c.text);
    if (st.view === 'wa') {
      const fm = waMapFilters();
      const f = { species: fm.species, years: fm.years, quarters: fm.quarters, keep: fm.keep, direction: st.direction,
        rawSpecies: st.speciesSub, mode: st.mode, scaling: st.scaling, nBins: st.nBins, chartFilters };
      const ready = f.species.length && f.years.length && f.quarters.length && f.direction.length;
      if (!ready) return { f, rows: [], agg: [], missing: [] };
      const agg = W.aggregate.build(m.rows, Object.assign({}, f, { hasSpecies: m.hasSpecies }));
      // On the shaded map, the animals in counties the map does not have (for the Stats text).
      if (isShaded()) f.unplaced = CP.unplacedLines(CP.unplaced(agg));
      return { f, rows: W.summary.mapRows(m, f) || [], agg, missing: [] };
    }
    if (st.view === 'flow') {
      const f = Object.assign(W.crossfilter.mapFilters('flow', flowFilters(), st.cf), { chartFilters });
      const centers = flowGeo ? FL.centers(flowGeo.centers) : new Map();
      const ready = f.species.length && f.years.length && f.quarters.length && f.direction;
      if (!ready) return { f, rows: [], agg: [], missing: [] };
      return { f, rows: FL.mapRows(m, f) || [], agg: (centers.size && FL.lines(m, f, centers)) || [], missing: [] };
    }
    const f = Object.assign(W.crossfilter.mapFilters('focus', focusOpts(), st.cf), { chartFilters });
    const missing = FO.COORDS.filter(c => m.header.indexOf(c) < 0);
    const ready = f.species.length && f.years.length && f.quarters.length && f.counties.length;
    if (!ready) return { f, rows: [], agg: [], missing };
    const built = FO.build(m, f);
    return { f, rows: FO.summaryRows(m, f) || [], agg: built.premises, missing: built.missingCoordinates };
  }
  // The Map View and chart choices at the moment of a click. An export or Preview Charts uses only these: drawing its
  // pictures takes seconds, and the Map View and "Show charts by:" stay usable meanwhile.
  function clickChoices() {
    const per = st.view === 'wa' ? st : st.view === 'flow' ? fl : fo;
    return { view: st.view, speciesChoices: st.master.speciesChoices,
      opts: { measure: st.chartMeasure, compare: st.chartCompare, years: per.years.map(String), quarters: per.quarters.slice() },
      // S9: the branded map's choices and the PNG settings, also taken at the click.
      branded: brandedChoices(),
      png: { background: st.view === 'flow' ? 'standard' : $('export-background').value, quality: $('export-quality').value,
        resolution: $('export-resolution').value },
      // S10: the GIF's frame interval ("quarter" or "year").
      gifBy: $('export-gif-by').value };
  }
  const pngDpi = (ch, kind) => (ch.png.resolution === 'high' ? 300 : kind === 'map' ? 200 : 150);
  // The branded page's choices at the click: the map's style, and what the screen adds since CVI: the
  // spotlight, the movement view, the chart filters that highlight (named in one line), and in Compare the
  // right map (its rows, period and movement), so both maps are exported.
  // County Focus's facility layers as the map shows them: those switched on, filtered to the focus counties and the
  // attribute picks (fo.fac.result), in the registry's order.
  function focusFacilityLayers() {
    if (!fo.fac || !fo.fac.result) return [];
    return fo.fac.result.layers.filter(l => l.points.length).map(l => ({ key: l.key, label: l.label, color: l.color,
      shape: l.shape,
      points: l.points.map(q => ({ name: q.name, lon: q.lon, lat: q.lat })) }));
  }
  // The neighboring regions switched on for the WA State map, as drawn (NR).
  function brandedRegions() {
    const RGS = root.WSDA.regions;
    if (!RGS) return [];
    return RGS.list().filter(e => st.nr[e.id] && st.nr[e.id].on && RGS.loaded(e.id)).map(e => {
      const d = RGS.loaded(e.id);
      return { id: e.id, outline: d.outline, counties: st.nr[e.id].counties ? d.counties : null, credit: e.credit || null,
        statement: e.statement || null };
    });
  }
  // CH: the shaded map's choices at the click (null while the view draws circles or lines).
  function shadeChoice() {
    if (st.view === 'wa' && isShaded()) {
      return { view: 'wa', measure: st.shadeMeasure, method: st.shadeClasses, nBins: st.nBins, opacity: st.fillOpacity };
    }
    if (st.view === 'flow' && fl.flowStyle === 'shaded') {
      return { view: 'flow', measure: 'total', method: fl.shadeClasses, nBins: fl.nBins, opacity: fl.fillOpacity };
    }
    return null;
  }
  // The classes of the export's shaded map: one set for both Compare maps (the left map's rows and the right's), as
  // on screen; null without shading.
  function shadeClassesAt(inp, ch) {
    const sh = ch.branded.shade;
    if (!sh || !inp.agg || !inp.agg.length) return null;
    if (sh.view === 'flow') return CP.stateClasses([inp.agg], sh.method, sh.nBins, inp.f.direction);
    const rowsList = ch.branded.right ? [inp.agg, ch.branded.right.rows] : [inp.agg];
    return CP.countyClasses(rowsList, sh.measure, sh.method, sh.nBins, inp.f.direction);
  }
  // Gathers the page choices the branded PNG uses (title, styles, spotlight, chart picks, layers, shading).
  function brandedChoices() {
    const cf = JSON.parse(JSON.stringify(cfState()));
    const highlights = W.crossfilter.chips(cf, st.view).filter(c => ['place', 'pair', 'premises'].includes(c.kind))
      .map(c => c.text);
    const out = { title: $('export-title').value, palette: st.palette, opacity: st.opacity, stateLines: fl.lines,
      focusOpacity: fo.opacity, hideCircles: fo.hide, spotlight: st.spotlight.slice(), highlights, cf,
      movement: st.movementOn ? st.movement : null, right: null, regions: brandedRegions(),
      facilities: st.view === 'focus' ? focusFacilityLayers() : [], nameLayers: st.view === 'focus' ? st.nameLayers.slice() : [],
      population: pcInput(), shade: shadeChoice() };
    if (st.view === 'wa' && st.periodMode === 'compare') {
      const r = W.crossfilter.mapFilters('wa', P.rightFilters(st), st.cf, { ownSpecies: !!st.speciesBEnabled });
      out.right = { rows: st.dataB.slice(), f: Object.assign({}, r, { direction: st.direction.slice(), scaling: st.scaling,
        nBins: st.nBins }), movement: st.movementOn ? st.movementB : null };
    }
    return out;
  }
  // The charts an export writes, as PNGs with the caption and footer; a chart that cannot be drawn is
  // listed in errors and the others are kept. Which charts: CVI's export set for the rows the map draws
  // (charts.chartsFor), plus the corridor chart while the movement view is on. MC: each is counted as on the screen
  // (chartsNow: the sidebar's rows with every chart filter but its own), and a chart whose own kind has picks keeps
  // all its bars with the others faint. Everything is taken here, before the first await, so at the click.
  async function exportCharts(inp, ch, now) {
    const input = ch.view === 'focus'
      ? { rows: inp.rows, premises: inp.agg, missingCoordinates: inp.missing } : { rows: inp.rows };
    let ids = CH.chartsFor(ch.view, input, ch.opts, true).map(c => c.id);
    if (ch.view === 'wa' && st.movementOn) ids = ids.concat(['corridors']);
    const shown = chartsNow(ch.opts, ids).filter(c => !c.empty && !(c.cells && !c.cells.length));
    const cf = cfState();
    const pickOf = (chart, mark) => {
      const pick = W.crossfilter.pickOf(ch.view, chart, mark, { periodMode: periodModeOf(ch.view) });
      return pick ? { on: W.crossfilter.isPicked(cf, ch.view, pick) } : null;
    };
    const fade = chart => {
      const kind = W.crossfilter.ownKind(chart.id, ch.view);
      return !!kind && cf[ch.view][kind].length > 0;
    };
    const caption = EX.chartCaption(ch.view, inp.f, ch.speciesChoices);
    const footer = EX.chartFooter(now);
    // test hook
    st.lastExportCharts = { view: ch.view, charts: shown, faded: shown.filter(fade).map(c => c.id), caption, footer };
    const charts = [], errors = [];
    for (const c of shown) {
      const name = CH.fileName(c.id, ch.view);
      try {
        const blob = await CS.png(c, { caption, footer, measure: ch.opts.measure, pickOf, fade, dpi: pngDpi(ch, 'chart') });
        charts.push({ name, blob, alt: c.title + (c.subtitle ? '. ' + c.subtitle : '') });
      } catch (e) {
        errors.push('charts/' + name + ': ' + ((e && e.message) || 'The chart picture could not be drawn.'));
      }
    }
    return { charts, errors };
  }
  // ── The branded map (S9) ──────────────────────────────────────────────────────────────────────────────────
  // The clicked view's branded page, drawn from the export's own numbers (inp: the rows, lines or premises the map
  // draws) and the choices taken at the click, as a PNG at the chosen resolution. CVI's message when there is
  // nothing to draw. Returns { pictures: [{ name, blob, alt }], errors }.
  const BM = W.brandedmaps, BR = root.WSDA.branded;
  const BRANDED_EMPTY = { wa: 'Branded county map: no data matches current filters.',
    flow: 'Branded flow map: no data matches current filters.',
    focus: 'Branded County Focus map: no data matches current filters.' };
  st.lastBranded = null;   // test hook: the models of the last branded pages drawn
  // The branded pages of the click: one, or in Compare the left and the right map ("…_left.png", "…_right.png").
  function brandedBuild(inp, ch, now, background) {
    const b = ch.branded, universe = ch.speciesChoices, counties = root.CVIWA_GEO.counties.features;
    if (!inp.agg || !inp.agg.length) return [];
    if (ch.view === 'wa') {
      const shade = b.shade ? Object.assign({}, b.shade, { cls: shadeClassesAt(inp, ch) }) : null;
      const page = (rows, f, movement) => BM.wa({ rows, f, universe, palette: b.palette, opacity: b.opacity,
        title: b.title, date: now, counties, spotlight: b.spotlight, highlights: b.highlights, movement,
        regions: b.regions, background, population: b.population, shade });
      if (!b.right) return [page(inp.agg, inp.f, b.movement)];
      const out = [page(inp.agg, inp.f, b.movement)];
      if (b.right.rows.length) out.push(page(b.right.rows, b.right.f, b.right.movement));
      out[0].model.fileName = out[0].model.fileName.replace(/\.png$/, '_left.png');
      if (out[1]) out[1].model.fileName = out[1].model.fileName.replace(/\.png$/, '_right.png');
      return out;
    }
    if (ch.view === 'flow') {
      if (!flowGeo) return [];
      const shade = b.shade ? Object.assign({}, b.shade, { cls: shadeClassesAt(inp, ch) }) : null;
      return [BM.flow({ lines: inp.agg, f: Object.assign({}, inp.f, { lines: b.stateLines }), universe, title: b.title,
        date: now, states: flowGeo.states.states.features, highlights: b.highlights, highlight: b.cf.flow.place, shade })];
    }
    const highlight = W.crossfilter.focusHighlight(inp.agg, st.master.rows, b.cf);
    const built = BM.focus({ premises: inp.agg, f: Object.assign({}, inp.f, { opacity: b.focusOpacity,
      hideCircles: b.hideCircles }), universe, title: b.title, date: now, counties, highlights: b.highlights, highlight,
      background, facilities: b.facilities, nameLayers: b.nameLayers, streets: b.streets || null,
      population: b.population });
    return built ? [built] : [];
  }
  // A tile background (tiles.js) is loaded for each page's map box; when it cannot be, every page is drawn on the
  // Default background and a notice says so (a deliberate difference).
  // The Streets data (geo/streets-wa.js, about 2.8 MB) is loaded the first time Streets is picked.
  let streetsLoading = null;
  function loadStreets() {
    if (root.WSDA_STREETS) return Promise.resolve(root.WSDA_STREETS);
    if (!streetsLoading) streetsLoading = loadScript('../geo/streets-wa.js').then(() => root.WSDA_STREETS || null, () => null);
    return streetsLoading.then(d => { if (!d) streetsLoading = null; return d; });
  }
  // Draws the branded PNG pages, loading the Streets background first when it is picked (Default if it cannot load).
  async function brandedPictures(inp, ch, now) {
    const streetNotice = [];
    if (ch.png.background === 'vector:streets') {
      ch.branded.streets = await loadStreets();
      if (!ch.branded.streets) {
        streetNotice.push('The Streets background could not be loaded, so the Default background was used.');
        ch = Object.assign({}, ch, { png: Object.assign({}, ch.png, { background: 'standard' }) });
      }
    }
    let pages = brandedBuild(inp, ch, now, ch.png.background);
    if (!pages.length) return { pictures: [], errors: [BRANDED_EMPTY[ch.view]], notices: streetNotice };
    const dpi = pngDpi(ch, 'map');
    const size = BR.pixelSize(dpi);
    const notices = streetNotice.slice();
    let under = [];
    if (pages.some(p => p.model.underlay) && root.WSDA.tiles.BACKGROUNDS[ch.png.background]) {
      for (const built of pages) {
        const u = built.model.underlay;
        const got = await root.WSDA.tiles.load(u.key, u.extent, u.box.width * dpi / 72, u.box.height * dpi / 72,
          { zoom: u.zoom, quality: ch.png.quality });
        under.push(got ? { image: got.image, box: u.box, mask: u.mask, how: got.how } : null);
      }
      if (under.some(x => !x)) {
        notices.push('The ' + root.WSDA.tiles.BACKGROUNDS[ch.png.background].label + ' background could not be loaded, '
          + 'so the Default background was used.');
        pages = brandedBuild(inp, ch, now, 'standard');
        under = [];
      }
    }
    st.lastBranded = { view: ch.view, models: pages.map(p => p.model), dpi, notices,
      underlay: under.map(x => x && { how: x.how, width: x.image.width, height: x.image.height }) };
    const pictures = [], errors = [];
    for (const [i, built] of pages.entries()) {
      try {
        const blob = under[i] ? await BR.png(BR.svg(built.parts, size, { transparent: true }), size, dpi, under[i])
          : await BR.png(BR.svg(built.parts, size), size, dpi);
        pictures.push({ name: built.model.fileName, blob, alt: built.model.title });
      } catch (e) {
        errors.push(built.model.fileName + ': ' + ((e && e.message) || e));
      }
    }
    return { pictures, errors, notices };
  }

  // The PNG controls follow the view, as CVI's: National Flow offers the Default background only, with a note, and no
  // A public copy offers only the PNG backgrounds cleared for public use (shared/release.js).
  root.WSDA.tiles.prunePickers([$('export-background'), $('lk-png-background')]);
  // Export quality.
  function syncPngControls() {
    const flow = st.view === 'flow';
    $('export-names').hidden = st.view !== 'focus';
    renderNameMarkers();
    const sel = $('export-background');
    // Streets (vector) is County Focus's only, as CVI's.
    const offered = o => (flow ? o.value === 'standard' : o.value !== 'vector:streets' || st.view === 'focus');
    [...sel.options].forEach(o => { o.hidden = !offered(o); o.disabled = !offered(o); });
    if (sel.selectedOptions[0] && sel.selectedOptions[0].disabled) sel.value = 'standard';
    $('export-background-note').hidden = !flow;
    $('export-quality-field').hidden = flow;
    // "Time-series GIF (.gif)": on National Flow as CVI's, and on WA State and County Focus,
    // grayed with the reason while it cannot apply: the movement view on (its lines are ranked per period) or the
    // circles hidden (every frame would be the same). The pick is kept and counts again when the box is free.
    const gif = $('export-gif');
    const why = gifUnavailable();
    $('export-gif-row').hidden = false;
    gif.disabled = !!why;
    $('export-gif-why').textContent = why || '';
    $('export-gif-why').hidden = !why;
    $('export-gif-field').hidden = !(gif.checked && !why);
  }
  // Why the GIF cannot be made on this view now, or null.
  function gifUnavailable() {
    if (st.view === 'wa' && st.movementOn) return GIF_WHY.movement;
    if (st.view === 'focus' && fo.hide) return GIF_WHY.hidden;
    return null;
  }
  const GIF_WHY = {
    movement: 'Not with the movement lines: turn off "Show lines between WA counties" to make the GIF.',
    hidden: 'Not while the CVI circles are hidden: turn off "Hide CVI circles" to make the GIF.'
  };
  $('export-gif').addEventListener('change', syncPngControls);
  st.syncPngControls = syncPngControls;
  syncPngControls();   // the page opens on WA State without a view change: the GIF box set up here
  // "Name markers in PNG" (County Focus): one box per facility layer that has a file, in the registry's order; the
  // picks are kept by layer key while files change. Empty by default, as CVI's.
  if (!st.nameLayers) st.nameLayers = [];
  function renderNameMarkers() {
    const list = $('export-name-list');
    const usable = fo.fac && fo.fac.reg ? fo.fac.reg.layers.filter(l => facUsable(l.key)) : [];
    st.nameLayers = (st.nameLayers || []).filter(k => usable.some(l => l.key === k));
    list.replaceChildren(...usable.map(l => {
      const lab = el('label');
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.value = l.key;
      box.checked = st.nameLayers.includes(l.key);
      lab.append(box, ' ' + l.label);
      return lab;
    }));
    $('export-names-empty').hidden = usable.length > 0;
  }
  $('export-name-list').addEventListener('change', () => {
    st.nameLayers = [...$('export-name-list').querySelectorAll('input:checked')].map(i => i.value);
  });
  $('export-names-all').addEventListener('click', () => {
    st.nameLayers = [...$('export-name-list').querySelectorAll('input')].map(i => i.value);
    renderNameMarkers();
  });
  $('export-names-clear').addEventListener('click', () => { st.nameLayers = []; renderNameMarkers(); });

  // ── The time-series GIF (S10 on National Flow; WA State and County Focus) ──────────────────────────────────────────
  // The frames and every choice are fixed at the click (gifBuild); building, drawing and writing each page (gifFile)
  // shows "GIF frame 3 of 12: 2024-Q3" with a Cancel button, which stops the whole export. Returns { name, prepared }
  // (National Flow), { name, view, fr, input, streets, notices } (the two other views, prepared in gifFile) or
  // { error }.
  const TS = W.timeseries;
  // Test hook: the last GIF's { view, specs, skipped, models, parts (the first and last frames' only), frames, size,
  // scale, obstacles, plainFirst }.
  st.lastGif = null;
  let gifCanceled = false;
  // A tile background stays with the PNG; the GIF is drawn on the Default background.
  const GIF_TILE_NOTICE = 'The time-series GIF uses the Default background (a GIF holds 256 colors per frame, so ' +
    'map tiles would turn blotchy); the branded PNG keeps the background picked.';
  // Works out the GIF frames and file name for the view on screen; returns them, or { error }.
  function gifBuild(inp, ch, now) {
    if (!st.master) return { error: 'master dataset not loaded.' };
    const b = ch.branded;
    const master = st.master;
    if (ch.view === 'flow') {
      if (!flowGeo) return { error: 'master dataset not loaded.' };
      const fr = TS.frames(master, inp.f, ch.gifBy, FL.centers(flowGeo.centers));
      st.lastGif = { view: 'flow', specs: fr.specs.map(x => x.label), skipped: fr.skipped, models: [], frames: null,
        size: null };
      if (!fr.frames.length) return { error: TS.NO_FRAMES };
      const prepared = TS.prepare(fr, { universe: ch.speciesChoices, title: b.title, date: now,
        states: flowGeo.states.states.features, highlights: b.highlights, highlight: b.cf.flow.place,
        stateLines: b.stateLines, shade: b.shade });
      st.lastGif.parts = {};
      return { name: TS.fileName(inp.f), prepared };
    }
    const fr = ch.view === 'wa' ? TS.waFrames(master, inp.f, ch.gifBy) : TS.focusFrames(master, inp.f, ch.gifBy);
    st.lastGif = { view: ch.view, specs: fr.specs.map(x => x.label), skipped: fr.skipped, models: [], frames: null,
      size: null, parts: {} };
    if (!fr.frames.length) return { error: TS.NO_FRAMES };
    const tile = !!root.WSDA.tiles.BACKGROUNDS[ch.png.background];
    const background = tile ? 'standard' : ch.png.background;
    const counties = root.CVIWA_GEO.counties.features;
    // In Compare, inp is the left map's.
    const input = ch.view === 'wa'
      ? { universe: ch.speciesChoices, palette: b.palette, opacity: b.opacity, title: b.title, date: now, counties,
        spotlight: b.spotlight, highlights: b.highlights, regions: b.regions, background, population: b.population,
        shade: b.shade }
      : { universe: ch.speciesChoices, title: b.title, date: now, counties, highlights: b.highlights, background,
        facilities: b.facilities, nameLayers: b.nameLayers, population: b.population,
        frameF: { opacity: b.focusOpacity, hideCircles: b.hideCircles },
        highlightOf: premises => W.crossfilter.focusHighlight(premises, master.rows, b.cf) };
    return { name: TS.fileNameView(ch.view, inp.f), view: ch.view, fr, input, streets: background === 'vector:streets',
      notices: tile ? [GIF_TILE_NOTICE] : [] };
  }
  // WA State and County Focus: the Streets data loaded when picked (else the Default background, with a notice),
  // then the shared scale and the names' places worked out once (TS.prepareView).
  async function gifPrepare(made) {
    if (made.prepared) return;
    if (made.streets) {
      made.input.streets = await loadStreets();
      if (!made.input.streets) {
        made.input.background = 'standard';
        made.notices.push('The Streets background could not be loaded, so the GIF used the Default background.');
      }
    }
    made.prepared = TS.prepareView(made.view, made.fr, made.input);
    st.lastGif.scale = made.prepared.scale || null;
    // Test hook: the first frame drawn as its period's branded PNG (for comparing before and after).
    st.lastGif.plainFirst = () => TS.prepareView(made.view, made.fr, made.input, undefined, TS.CVI_OPTIONS).page(0);
    st.lastGif.obstacles = made.prepared.obstacles ? made.prepared.obstacles.length : 0;
  }
  // Prepares and encodes the GIF behind a progress box with Cancel; returns its name and bytes.
  async function gifFile(made) {
    const box = $('gif-progress');
    gifCanceled = false;
    $('gif-cancel').disabled = false;
    box.hidden = false;
    try {
      if (!made.prepared) {
        $('gif-progress-text').textContent = 'Preparing the GIF frames…';
        await gifPrepare(made);
        if (gifCanceled) throw new TS.CanceledError();
      }
      const last = made.prepared.count - 1;
      const out = await TS.encode(made.prepared, {
        onFrame: (i, n, label) => { $('gif-progress-text').textContent = 'GIF frame ' + i + ' of ' + n + ': ' + label; },
        onPage: (i, page) => {
          st.lastGif.models.push(page.model);
          // The first two pages and the last are kept for the tests (Safari scores frame 1 against frames 1 and 2).
          if (i <= 1 || i === last) st.lastGif.parts[i] = page.parts;
        },
        canceled: () => gifCanceled
      });
      const bytes = new Uint8Array(await out.blob.arrayBuffer());
      // A Cancel clicked while the last frame was written.
      if (gifCanceled) throw new TS.CanceledError();
      st.lastGif.frames = out.frames;
      st.lastGif.size = bytes.length;
      return { name: made.name, bytes };
    } finally {
      box.hidden = true;
      $('gif-progress-text').textContent = '';
    }
  }
  $('gif-cancel').addEventListener('click', () => {
    gifCanceled = true;
    $('gif-cancel').disabled = true;
    $('gif-progress-text').textContent = 'Canceling…';
  });

  // Shows a message in the preview box, or hides the box when there is none.
  function previewMessage(text) {
    const box = $('preview-message');
    box.textContent = text || '';
    box.hidden = !text;
  }
  // The checks CVI makes before every preview: County Focus needs a county.
  function previewBlocked() {
    if (st.view === 'focus' && !fo.counties.length) {
      previewMessage(EX.MESSAGES.focusCountyPreview);
      return true;
    }
    previewMessage('');
    return false;
  }
  $('preview-table').addEventListener('click', () => {
    if (previewBlocked()) return;
    const inp = exportInputs();
    if (!inp.agg.length) { previewMessage(EX.MESSAGES.noDataTable); return; }
    PV.showMapData(EX.mapDataPreview(st.view, inp.agg, inp.f.combine));
  });
  $('preview-stats').addEventListener('click', () => {
    if (previewBlocked()) return;
    const inp = exportInputs();
    if (!inp.rows.length) { previewMessage(EX.MESSAGES.noRowsStats); return; }
    // The change from the previous quarter follows the charts' "Compare with".
    const f = Object.assign({}, inp.f, { compare: st.view === 'flow' ? 'previous' : st.chartCompare });
    PV.showStats(EX.statsPreview(st.view, f, inp.rows, inp.agg, new Date()));
  });
  // Preview Map (S9): the branded PNG the export would write, in a dialog; grayed and "Drawing…" meanwhile.
  $('preview-map').addEventListener('click', async () => {
    if (st.exporting || previewBlocked()) return;
    const inp = exportInputs();
    if (st.view === 'focus' && inp.missing.length) { previewMessage(EX.focusCoordinatesMessage(inp.missing)); return; }
    const b = $('preview-map'), ch = clickChoices();
    st.exporting = true;
    syncExportGate();
    root.WSDA.brand.buttonText(b, 'Drawing…');   // keeps the icon
    try {
      const made = await brandedPictures(inp, ch, new Date());
      st.lastPreviewMap = made.pictures;   // test hook: the pictures shown
      if (made.errors.length || made.notices.length) {
        previewMessage(made.errors.length ? 'Preview failed: ' + made.errors.join('; ') : made.notices.join(' '));
      }
      if (made.pictures.length) PV.showMap('Map preview', made.pictures, 'This is what the PNG will look like when exported.');
    } finally {
      st.exporting = false;
      root.WSDA.brand.buttonText(b, 'Preview Map');   // keeps the icon
      syncExportGate();
    }
  });
  // Preview Charts is grayed and reads "Drawing…" while its pictures are drawn, as Export reads "Exporting…".
  $('preview-charts').addEventListener('click', async () => {
    if (st.exporting || previewBlocked()) return;
    const inp = exportInputs();
    if (!inp.rows.length) { previewMessage(EX.MESSAGES.noRowsCharts); return; }
    const b = $('preview-charts'), ch = clickChoices();
    st.exporting = true;
    syncExportGate();
    root.WSDA.brand.buttonText(b, 'Drawing…');   // keeps the icon
    try {
      const made = await exportCharts(inp, ch, new Date());
      if (made.errors.length) previewMessage('Chart preview failed: ' + made.errors.join('; '));
      if (made.charts.length) PV.showCharts(EX.chartsPreviewTitle(made.charts.length), made.charts, EX.MESSAGES.chartsFooter);
    } finally {
      st.exporting = false;
      root.WSDA.brand.buttonText(b, 'Preview Charts');   // keeps the icon
      syncExportGate();
    }
  });

  // The export result under the Export button: the first line bold; green when every file was written, yellow
  // with what failed (CVI's alert-success and alert-warning).
  function exportMessage(cls, lines) {
    const box = $('export-result');
    box.className = 'status ' + cls;
    box.replaceChildren(...lines.map(l => el('div', null, l)));
    box.hidden = false;
  }
  function renderExportHistory() {
    const list = $('export-history-list');
    list.replaceChildren(...st.exportHistory.map(item => {
      const h = EX.historyLine(item), li = el('li');
      li.title = h.full;
      li.append(el('span', 'when', h.time), ' — ', el('span', null, h.name));
      return li;
    }));
    $('export-history').hidden = !st.exportHistory.length;
  }
  async function runExport() {
    // A grayed box never counts (the GIF while it cannot apply on the view).
    const formats = [...doc.querySelectorAll('input[name=export-format]:checked:not(:disabled)')].map(i => i.value);
    if (!formats.length) { exportMessage('warn', [EX.MESSAGES.noFormat]); return; }
    if (st.view === 'focus' && !fo.counties.length) { exportMessage('warn', [EX.MESSAGES.focusCountyExport]); return; }
    const inp = exportInputs();
    if (st.view === 'focus' && inp.missing.length) {
      exportMessage('err', [EX.focusCoordinatesMessage(inp.missing)]);
      return;
    }
    if (!inp.rows.length) { exportMessage('warn', [EX.MESSAGES.noRowsExport]); return; }
    // Everything the export writes is fixed here, at the click; nothing below reads st.view.
    const now = new Date(), label = $('export-label').value, ch = clickChoices(), view = ch.view;
    const gifMade = formats.includes('branded_gif') ? gifBuild(inp, ch, now) : null;
    // County Focus: every facility layer switched on, in the registry's order.
    const layersOn = view === 'focus' && fo.fac && fo.fac.reg
      ? fo.fac.reg.layers.map(l => l.key).filter(k => fo.fac.on.includes(k)) : [];
    const folder = EX.folderName(view, inp.f, ch.speciesChoices, label, now);
    const parts = {}, errors = [];
    if (formats.includes('csv')) {
      try {
        parts.filteredRows = EX.filteredRowsCsv(st.master, inp.rows);
      } catch (e) {
        errors.push('filtered_rows.csv: ' + ((e && e.message) || e));
      }
    }
    if (formats.includes('summary_csv')) {
      try {
        parts.summaryTable = EX.summaryTableCsv(view, inp.agg, inp.f.combine);
      } catch (e) {
        errors.push('summary_table.csv: ' + ((e && e.message) || e));
      }
    }
    if (formats.includes('charts')) {
      const made = await exportCharts(inp, ch, now);
      parts.charts = await Promise.all(made.charts.map(async c => ({ name: c.name,
        bytes: new Uint8Array(await c.blob.arrayBuffer()) })));
      made.errors.forEach(e => errors.push(e));
    }
    const notices = [];
    if (formats.includes('branded_png')) {
      const made = await brandedPictures(inp, ch, now);
      made.notices.forEach(n => notices.push(n));
      parts.branded = await Promise.all(made.pictures.map(async p => ({ name: p.name,
        bytes: new Uint8Array(await p.blob.arrayBuffer()) })));
      made.errors.forEach(e => errors.push(e));
    }
    // CVI's wording for a GIF that fails ("Time-series GIF: …"); a Cancel ends the export with nothing saved.
    if (gifMade) {
      if (gifMade.error) {
        errors.push('Time-series GIF: ' + gifMade.error);
      } else {
        try {
          parts.gif = await gifFile(gifMade);
          (gifMade.notices || []).forEach(n => notices.push(n));
        } catch (e) {
          if (e instanceof TS.CanceledError) throw e;
          errors.push('Time-series GIF: ' + ((e && e.message) || e));
        }
      }
    }
    parts.params = EX.exportParams(view, inp.f, { label, formats, layersOn, png: ch.png, nameLayers: ch.branded.nameLayers,
      gifBy: ch.gifBy, population: ch.branded.population && PN.exportParams(ch.branded.population.on),
      shade: ch.branded.shade && Object.assign({ cls: shadeClassesAt(inp, ch),
        gifCls: gifMade && gifMade.prepared && !gifMade.error ? gifMade.prepared.shadeCls : null }, ch.branded.shade) }, now);
    const z = EX.zipEntries(folder, parts);
    const name = folder + '.zip';
    const bytes = F.sample.zip(z.entries, now);
    F.sample.download(name, bytes);
    const result = EX.exportResult(name, z.written, errors, notices);
    // Yellow when something was drawn differently from the choices (a background that fell back).
    exportMessage(result.ok && !notices.length ? 'ok' : 'warn', result.lines);
    st.exportHistory = EX.addToHistory(st.exportHistory, name, now);
    renderExportHistory();
    st.lastExport = { name, entries: z.entries.map(e => e.name), written: z.written, errors, bytes, result };
  }
  $('run-export').addEventListener('click', async () => {
    if (st.exporting) return;
    const b = $('run-export');
    st.exporting = true;
    syncExportGate();
    root.WSDA.brand.buttonText(b, 'Exporting…');   // keeps the icon
    try {
      await runExport();
    } catch (e) {
      if (e instanceof TS.CanceledError) exportMessage('warn', ['Export canceled; nothing was saved.']);
      else exportMessage('err', ['Export failed: ' + ((e && e.message) || e)]);
    } finally {
      st.exporting = false;
      root.WSDA.brand.buttonText(b, 'Export');   // keeps the icon
      syncExportGate();
    }
  });

  // Wire the page before starting WebGL, so a renderer failure cannot disable file handling.
  function mapError() {
    mapFailed = true;
    const box = $('map-status'); box.hidden = false; box.className = 'status err';
    box.textContent = 'Map unavailable. The browser could not start or continue drawing the map. Reload this page to retry. If it still fails, report your browser version and whether this is a managed work device.';
    $('map').style.visibility = 'hidden';
    $('legend-panel').hidden = true;
    $('legend-toggle').setAttribute('aria-expanded', 'false');
    ['fit-wa', 'legend-toggle', 's-labels', 's-lines'].forEach(id => { $(id).disabled = true; });
  }
  try {
    mapSt = W.map.create($('map'), root.CVIWA_GEO, () => {
      if (!mapFailed) { $('map-status').hidden = true; schedule(0); }
    }, mapError);
    st.mapHandle = mapSt;   // test hook: MapLibre instance for rendered-feature checks
    mapSt.notify = msg => toast(msg, 6000);   // the screenshot button's message
    mapSt.onBasemapError = b => basemapError(b, mapSt);
    mapSt.onBasemapRecovered = basemapRecovered;
    mapSt.onFit = fitMaps;
  } catch (e) { mapError(); }
  renderAll();
  renderSummaries([]);

  // ---- S11: Maps / Premise Lookup ---------------------------------------------------------------------------------
  // Premise Lookup hides the Maps side (Map View, its sections, the maps, charts, boxes and strip) and shows its own;
  // the Master dataset box stays, shared. Back on Maps, the view on screen is as it was (playing Browse stops).
  st.tool = 'maps';   // test hook
  function setTool(t) {
    if (t !== 'maps' && t !== 'lookup') return;
    doc.querySelectorAll('.tool-switch [data-tool]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-tool') === t));
    });
    if (t === st.tool) return;
    st.tool = t;
    const lookup = t === 'lookup';
    if (lookup) { stopPlay(); stopFlowPlay(); stopFocusPlay(); }
    $('maps-view-block').hidden = lookup;
    $('maps-side').hidden = lookup;
    $('maps-main').hidden = lookup;
    $('lookup-side').hidden = !lookup;
    $('lookup-main').hidden = !lookup;
    if (lookupPage) lookupPage.shown(lookup);
    if (!lookup) resizeMaps();
  }
  doc.querySelectorAll('.tool-switch [data-tool]').forEach(b => b.addEventListener('click', () => {
    setTool(b.getAttribute('data-tool'));
  }));
  // S11: the facility files the page holds (County Focus's, from the hand-off) and the master's file name.
  lookupPage = W.lookup.init({ master: () => st.master, loading: () => st.loading, loadScript, watchFile, geo: root.CVIWA_GEO,
    facilities: () => ({ prepared: fo.fac.prepared, reason: k => facReason(fo.fac.layers[k]) }),
    masterName: () => (st.master ? st.masterName || '' : '') });
})(window);
