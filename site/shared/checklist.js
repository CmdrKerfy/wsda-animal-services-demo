/* Data checklist panel and feature gating (F1). Shows, for one profile, which datasets were found in the user's
 * files, which are missing, which file feeds which dataset, and which features that switches on or off, with a
 * plain reason for everything that is off or not used. Two choices are made in the panel and recognition is run
 * again (recognize.js, header rows only):
 *   - conflict chooser: two files claim one dataset -> "Which file is the …?" (choices: dataset id -> file id);
 *   - "which layer is this file?" picker: for a file recognizable only as "a
 *     facility layer", the layers it could be (assign: file id -> dataset id). The user's pick outranks bundle.json,
 *     which outranks columns and names. The same dropdown is also offered as
 *     "change layer" on every facility file that could be more than one layer, so a file placed by its name or by
 *     bundle.json can be re-pointed; its first option keeps or restores the automatic result.
 * Also shows the bundle.json banner (bundle.js). Every text from the user's files is escaped; nothing leaves the
 * browser.
 *
 * Safeguards: dropdown options come from the latest recognition only (never cached); user-controlled ids
 * live in objects without inherited keys; a new load removes the previous panel at once and every dropdown carries
 * its load's generation, so an old control cannot change a newer load; a pick made while bundle.json is still being
 * read waits for it; layer options are filled in when a dropdown is opened (many files x many layers would otherwise
 * mean hundreds of thousands of <option> elements); file headers and the manifest are read once per load.
 *
 * gate(result, profile) -> [{ id, name, on, reason }]   pure; result from recognize()
 * layerOptions(result, fileId, assign) -> [{ value, text }] or null: the layers the file's dropdown offers
 * create({ container, banner, profile, onUpdate?, fold? }) -> { show(loadResult), assign(fileId, datasetId, gen?),
 *   choose(datasetId, fileId, gen?), clear(), setProfile(profile, opts?), checkFor(profile), state }
 *   fold (the landing page): the summary line names the dashboard, and the Datasets,
 *   Features and Your files tables sit in a fold under it, closed when everything was found and open when something
 *   needs attention (a choice, a missing required dataset, a skipped file, a note); a fold the user opens or closes
 *   stays so until new files are loaded.
 *   state: { load, bundle, result, features, assign, choices, version, busy, gen }
 *   onUpdate(state) is called whenever the panel has been redrawn (new load, pick, choice or clear; the
 *   landing page's next step follows the checklist).
 *   checkFor(other) -> Promise<{ profile, result, features, version } | null>: what the same files give for another
 *   dashboard (AB: the landing page's readiness on every card), recognized exactly as switching to it would
 *   (setProfile with reuseShared: the user's picks and the bundle's shared mappings), without changing the panel.
 *   null while the files are being checked, or when a newer load, pick or choice has come in since.
 * applyGates(scope, features): grays every element marked data-feature="<id>" whose feature is off: its controls
 *   are disabled, a <details> cannot be opened, and its [data-gate-reason] element shows why (CVI page). */
(function (root) {
  'use strict';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const listOf = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  const size = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
  const dict = () => Object.create(null);
  // Sentence case for notes, but file names keep their own case ("bundle.json names it …").
  const cap = n => /^bundle\.json/i.test(n) ? n : n.charAt(0).toUpperCase() + n.slice(1);
  const VIA = { columns: 'recognized by its columns', name: 'recognized by its file name',
    'name column': 'recognized by its name column',
    'bundle.json': 'named in bundle.json', 'your choice': 'your choice' };

  /** Each feature is on only if every dataset it needs is found (not in conflict) with the columns it needs. */
  function gate(result, profile) {
    const byId = new Map(((result && result.datasets) || []).map(d => [d.id, d]));
    return profile.features.map(f => {
      const out = { id: f.id, name: f.name, on: true, reason: null };
      if (f.anyKind) {
        const candidates = ((result && result.datasets) || []).filter(d => d.kind === f.anyKind);
        if (!candidates.some(d => d.status === 'found')) return Object.assign(out, { on: false,
          reason: candidates.some(d => d.status === 'conflict') ? 'choose a facility file in Datasets below'
            : 'needs at least one recognized facility file (a manifest supplies no points)' });
      }
      for (const need of f.needs) {
        const d = byId.get(need.dataset), spec = profile.datasets.find(x => x.id === need.dataset) || {};
        const name = (d && d.name) || spec.name || need.dataset;
        if (!d || d.status === 'missing') return Object.assign(out, { on: false,
          reason: `needs the ${name}` + (spec.file ? ` (${spec.file})` : '') });
        if (d.status === 'conflict') return Object.assign(out, { on: false, reason: `choose which file is the ${name}` });
        const miss = (need.columns || []).filter(c => d.header.indexOf(c) < 0);
        if (miss.length) return Object.assign(out, { on: false,
          reason: `needs ${miss.length === 1 ? 'the column' : 'the columns'} ${listOf(miss)} in the ${name}` });
      }
      return out;
    });
  }

  /** One-line summary and its tone for the top of the panel. */
  function summary(result, features) {
    const conflicts = result.datasets.filter(d => d.status === 'conflict');
    if (conflicts.length) return { kind: 'warn',
      text: 'Choose which file is the ' + listOf(conflicts.map(d => d.name)) + ' (see Datasets below).' };
    const missing = result.datasets.filter(d => d.required && d.status !== 'found');
    const on = features.filter(f => f.on).length;
    if (missing.length) return { kind: 'warn', text: 'The ' + listOf(missing.map(d => d.name))
      + (missing.length === 1 ? ' was' : ' were') + ' not found, so the features that need '
      + (missing.length === 1 ? 'it' : 'them') + ' are off. ' + on + ' of ' + features.length
      + ' features available.' };
    return { kind: 'ok', text: (result.datasets.some(d => d.required) ? 'All required data found. '
      : 'No individual dataset is required; see feature availability below. ') + on + ' of ' + features.length
      + ' features available.' };
  }

  // A <select> with a placeholder option first; a lazy one gets its other options when it is opened (fill()).
  function select(attr, key, label, placeholder, options, value, gen, lazy) {
    let h = `<select ${attr}="${esc(key)}" data-gen="${gen}"${lazy ? ' data-lazy="1"' : ''} aria-label="${esc(label)}"><option value="">${esc(placeholder)}</option>`;
    for (const o of options)
      h += `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.text)}</option>`;
    return h + '</select>';
  }

  /** Layers a file's dropdown offers: an unclear file's candidates, or every layer it could be when there is more
   * than one ("change layer"), or its layers when the user has picked one (so the pick can be changed). */
  function layerOptions(result, fileId, assign) {
    const f = result.files.find(x => x.id === fileId);
    if (!f) return null;
    const ids = f.candidates || (f.layers.length > 1 || own(assign, fileId) ? f.layers : null);
    if (!ids || !ids.length) return null;
    const names = new Map(result.datasets.map(d => [d.id, d.name]));
    return ids.map(id => ({ value: id, text: names.get(id) || id }));
  }

  /** Whether the checked files need the user's attention (the folded panel then opens): a choice to make, a
   * required dataset missing, a file skipped or a note. */
  function needsAttention(v) {
    const sm = summary(v.result, v.features);
    const m = v.result.manifest;
    return sm.kind !== 'ok' || v.result.files.some(f => f.candidates) || v.load.ignored.length > 0 ||
      (v.bundle ? v.bundle.warnings.length : 0) > 0 || !!(m && (m.error || (m.skipped && m.skipped.length) || (m.notes && m.notes.length)));
  }

  /** The panel's HTML (pure). v: { profile, load, bundle, result, features, assign, choices, gen, fold, open } (fold:
   * the tables in a fold, open when v.open, else when they need attention). */
  function panelHtml(v) {
    const { profile, load, result, features } = v, gen = v.gen || 0;
    const dsById = new Map(result.datasets.map(d => [d.id, d])), fileById = new Map(result.files.map(f => [f.id, f]));
    const neededFor = id => profile.features.filter(f => f.needs.some(n => n.dataset === id)).map(f => f.name);
    const sm = summary(result, features);
    let h = `<div id="checklist-summary" class="status ${sm.kind}" role="status">${esc((v.fold ? profile.name + ': ' : '') + sm.text)}</div>`;
    if (v.fold) {
      const open = v.open === null || v.open === undefined ? needsAttention(v) : v.open;
      h += `<details id="checklist-details"${open ? ' open' : ''}><summary>Details: datasets, features and your files</summary>`;
    }

    // Datasets
    h += '<h3>Datasets</h3><div class="table-wrap"><table id="datasets-table"><thead><tr><th>Dataset</th><th>Status</th><th>File</th><th>Notes</th></tr></thead><tbody>';
    for (const d of result.datasets) {
      const spec = profile.datasets.find(x => x.id === d.id) || {};
      const name = d.fromManifest ? 'Additional facility layer: ' + d.name : d.name;
      const status = d.status === 'found' ? 'Found' : d.status === 'conflict' ? 'Choose a file'
        : d.required ? 'Missing (required)' : 'Not supplied (optional)';
      const notes = [];
      let file;
      const chosen = d.status === 'found' && own(v.choices, d.id) === d.fileId;
      if (d.options.length > 1) {
        file = select('data-choose', d.id, `Which file is the ${d.name}?`, 'Choose a file…',
          d.options.map(o => ({ value: o.id, text: o.path })), chosen ? d.fileId : '', gen);
        if (chosen) notes.push('your choice');
      } else if (d.status === 'found') file = esc(d.path);
      else file = `<span class="muted">expected name: ${esc(d.file || spec.file || '')}</span>`;
      if (d.status === 'found' && !chosen) { const f = fileById.get(d.fileId); if (f && VIA[f.via]) notes.push(VIA[f.via]); }
      const nf = neededFor(d.id);
      if (nf.length) notes.push('needed for: ' + nf.join(', '));
      if (d.status === 'found') for (const u of d.missingUseful) {
        const miss = u.columns.filter(c => d.header.indexOf(c) < 0);
        const what = [
          u.feature ? ((profile.features.find(f => f.id === u.feature) || {}).name || u.feature) + ' is off' : null,
          u.without, u.later]
          .filter(Boolean).join('; ');
        notes.push(`without ${miss.length === 1 ? 'the column' : 'the columns'} ${listOf(miss)}: ${what}`);
      }
      const later = spec.later || (d.fromManifest || d.kind === 'facility'
        ? (profile.datasets.find(x => x.kind === 'facility') || {}).later : null);
      if (later) notes.push('used by: ' + later);
      h += `<tr data-dataset="${esc(d.id)}" data-status="${esc(d.status)}"><td>${esc(name)}${d.required ? ' <span class="req">required</span>' : ''}</td>` +
        `<td class="st-${esc(d.status)}">${esc(status)}</td><td>${file}</td><td>${notes.map(n => esc(cap(n))).join('<br>')}</td></tr>`;
    }
    h += '</tbody></table></div>';

    // Features
    h += '<h3>Features</h3><div class="table-wrap"><table id="features-table"><thead><tr><th>Feature</th><th>Available</th><th>Why</th></tr></thead><tbody>';
    for (const f of features) {
      h += `<tr data-feature="${esc(f.id)}" data-on="${f.on ? 1 : 0}"><td>${esc(f.name)}</td><td class="${f.on ? 'st-found' : 'st-missing'}">${f.on ? 'Yes' : 'No'}</td>` +
        `<td>${f.on ? '' : esc(cap(f.reason))}</td></tr>`;
    }
    h += '</tbody></table></div>';

    // Every file received, and what it is used as
    if (load.items.length) {
      h += '<h3>Your files</h3><div class="table-wrap"><table id="items-table"><thead><tr><th>File</th><th>From</th><th class="num">Size</th><th>Used as</th><th>Notes</th></tr></thead><tbody>';
      for (const it of load.items) {
        const f = fileById.get(it.id) || { status: 'not-used', reason: null, warning: null, candidates: null, layers: [] };
        const picked = own(v.assign, it.id);
        let used, note = f.reason || '';
        if (f.candidates || f.layers.length > 1 || picked) {
          // Unclear file: "Which layer is this file?"; recognized facility file: "change layer" (first option = automatic).
          // Only the current pick is written here; the other layers are added when the dropdown is opened.
          // A pick is shown as selected only while the file is really used as that layer; a pick that did not fit, or
          // that competes with another file, shows what actually happened (the Notes say why).
          const applied = picked && f.status === 'used' && f.dataset === picked;
          const auto = applied ? 'Undo my choice'
            : picked ? (f.status === 'conflict' ? 'Your choice: choose in Datasets above'
              : 'Not used (your choice did not fit)')
            : f.candidates ? 'Which layer is this file?'
            : f.status === 'used' ? (dsById.get(f.dataset) || { name: f.dataset }).name + ' (automatic)' : 'Not used (automatic)';
          used = select('data-pick', it.id, `Which layer is ${it.name}?`, auto,
            applied ? [{ value: picked, text: (dsById.get(picked) || { name: picked }).name }] : [],
            applied ? picked : '', gen, true);
          if (f.status === 'used' && picked) note = 'your choice';
        } else if (f.status === 'used') used = esc((dsById.get(f.dataset) || { name: f.dataset }).name);
        else if (f.status === 'bundle') {
          used = 'Bundle description (bundle.json)';
          const b = v.bundle;
          note = b && b.found && b.path === it.path ? '' : b && b.found && (b.paths || []).includes(it.path)
            ? `identical copy of ${b.path}, which is used` : 'not used; see the notes below';
        }
        else if (f.status === 'conflict') used = 'Choose in Datasets above';
        else used = 'Not used';
        h += `<tr data-file="${esc(it.id)}" data-status="${esc(f.status)}"><td>${esc(it.path)}</td><td>${esc(it.source === 'zip' ? 'ZIP: ' + it.archive : it.source)}</td>` +
          `<td class="num">${size(it.size)}</td><td>${used}</td><td>${[note, f.warning].filter(Boolean).map(n => esc(cap(n))).join('<br>')}</td></tr>`;
      }
      h += '</tbody></table></div>';
    }
    if (load.ignored.length) {
      h += '<table id="ignored-table"><thead><tr><th>Skipped</th><th>Reason</th></tr></thead><tbody>';
      for (const x of load.ignored) h += `<tr><td>${esc(x.path)}</td><td>${esc(x.reason)}</td></tr>`;
      h += '</tbody></table>';
    }

    // Notes: bundle.json problems, manifest results
    const notes = (v.bundle ? v.bundle.warnings : []).slice();
    const m = result.manifest;
    if (m && m.error) notes.push(`${m.path}: ${m.error}`);
    if (m && m.skipped) for (const s of m.skipped) notes.push(`${m.path}, row ${s.row}: ${s.reason}`);
    if (m && m.notes) for (const s of m.notes) notes.push(`${m.path}, row ${s.row}: ${s.reason}`);
    if (notes.length) h += '<ul id="checklist-notes">' + notes.map(n => `<li>${esc(cap(n))}</li>`).join('') + '</ul>';
    return h + (v.fold ? '</details>' : '');
  }

  function create(opts) {
    const R = root.WSDA.recognize, B = root.WSDA.bundle, c = opts.container;
    let profile = opts.profile, reuseShared = false, sharedDatasets = profile.datasets;
    // detailsOpen: the user's own open or close of the folded panel (null: as needsAttention() says).
    const st = { load: null, bundle: null, result: null, features: null, error: null, assign: dict(), choices: dict(),
      version: 0, busy: false, op: 0, gen: 0, cache: null, bundleReady: null, profile, mappingWarnings: [],
      detailsOpen: null, autoOpened: false };

    // Show the bundle.json banner, or hide it when there is none.
    function paintBanner() {
      const b = opts.banner;
      if (!b) return;
      const text = st.bundle && st.bundle.banner;
      b.textContent = text || ''; b.hidden = !text;
    }

    // Replace the panel with one status message (nothing for empty text).
    function paintMessage(kind, text) {
      c.innerHTML = text ? `<div class="status ${kind}">${esc(text)}</div>` : ''; paintBanner();
    }

    // The folded panel's state: the user's own choice, else open while the files need attention, and kept open once
    // it has opened for these files (a choice that settles the problem does not close it under the user's pointer).
    function foldOpen() {
      if (st.detailsOpen !== null) return st.detailsOpen;
      if (checklistNeeds()) st.autoOpened = true;
      return !!st.autoOpened;
    }
    // Whether the current files need the user's attention.
    const checklistNeeds = () => needsAttention({ result: st.result, features: st.features, load: st.load, bundle: st.bundle });
    // Redraw the panel from the state, keeping focus on the dropdown that had it.
    function paint() {
      if (!st.result) { paintMessage('err', st.error); return; }
      const doc = root.document, active = doc && c.contains && c.contains(doc.activeElement) ? doc.activeElement : null;
      const key = active && (active.getAttribute('data-pick') !== null ? ['data-pick', active.getAttribute('data-pick')]
        : active.getAttribute('data-choose') !== null ? ['data-choose', active.getAttribute('data-choose')] : null);
      c.innerHTML = panelHtml({ profile, load: st.load,
        bundle: st.bundle && Object.assign({}, st.bundle, { warnings: [...st.bundle.warnings, ...st.mappingWarnings] }),
        result: st.result, features: st.features,
        assign: st.assign, choices: st.choices, gen: st.gen, fold: !!opts.fold, open: foldOpen() });
      paintBanner();
      if (key) {
        const el = Array.from(c.querySelectorAll('select[' + key[0] + ']'))
          .find(x => x.getAttribute(key[0]) === key[1]);
        if (el) el.focus();
      }
    }

    // Only the latest request (new load, pick, choice or clear) may publish; every published request ends idle.
    async function refresh(op) {
      st.busy = true;
      if (opts.onUpdate) opts.onUpdate(st);           // at the start too: the page shows "checking" at once
      let res = null, err = null;
      try {
        await st.bundleReady;                         // a pick made while bundle.json is read waits for it
        if (op !== st.op) return false;
        const displayBundle = st.bundle && Object.assign({}, st.bundle, { warnings: st.bundle.warnings.slice() });
        const files = B.filesFor(displayBundle, profile, { reuseShared, datasets: sharedDatasets });
        const mappingWarnings = displayBundle ? displayBundle.warnings.filter(w => !st.bundle.warnings.includes(w)) : [];
        res = await R.recognize(st.load.items, profile, { assign: st.assign, choices: st.choices, files, cache: st.cache });
        if (op === st.op) st.mappingWarnings = mappingWarnings;
      } catch (e) { err = e; }
      if (op !== st.op) return false;
      try {
        if (err) throw err;
        st.result = res; st.features = gate(res, profile); st.error = null;
        paint();
      } catch (e) {
        st.result = null; st.features = null; st.error = 'The files could not be checked: ' + e.message;
        paint();
      }
      st.busy = false; st.version++;
      if (opts.onUpdate) opts.onUpdate(st);
      return true;
    }

    // Check a new load: the previous panel and picks go at once, then bundle.json is read and recognition runs.
    async function show(load) {
      const op = ++st.op; ++st.gen;
      reuseShared = false; sharedDatasets = profile.datasets;
      Object.assign(st, { load, bundle: null, result: null, features: null, error: null, assign: dict(), choices: dict(),
        cache: new Map(), bundleReady: null, mappingWarnings: [], detailsOpen: null, autoOpened: false });
      // The previous panel goes at once: its dropdowns belong to other files.
      paintMessage('info', load && load.items.length ? 'Checking which datasets these files are…' : '');
      if (!load) { st.busy = false; st.version++; if (opts.onUpdate) opts.onUpdate(st); return true; }
      st.busy = true;
      st.bundleReady = B.read(load.items).then(b => { if (st.load === load) st.bundle = b; },
        e => {
          if (st.load === load) st.bundle = { found: false, path: null, info: null, banner: null,
            warnings: ['bundle.json could not be read: ' + e.message] };
        });
      return refresh(op);
    }

    // True while there is a load and gen, when given, is the latest generation.
    const current = gen => st.load && (gen === undefined || gen === st.gen);
    // Use a file as the picked layer (no dataset: undo the pick), then check again.
    function assign(fileId, datasetId, gen) {
      if (!current(gen)) return Promise.resolve(false);
      if (datasetId) st.assign[fileId] = datasetId; else delete st.assign[fileId];
      return refresh(++st.op);
    }
    // Choose the file for a dataset two files claim (no file: undo the choice), then check again.
    function choose(datasetId, fileId, gen) {
      if (!current(gen)) return Promise.resolve(false);
      if (fileId) st.choices[datasetId] = fileId; else delete st.choices[datasetId];
      return refresh(++st.op);
    }
    const clear = () => show(null);
    async function checkFor(other) {
      if (!st.load || !st.result || st.busy) return null;
      const version = st.version, load = st.load;
      await st.bundleReady;
      const shared = [...other.datasets, ...st.result.datasets];
      const displayBundle = st.bundle && Object.assign({}, st.bundle, { warnings: st.bundle.warnings.slice() });
      const files = B.filesFor(displayBundle, other, { reuseShared: true, datasets: shared });
      const res = await R.recognize(load.items, other, { assign: st.assign, choices: st.choices, files, cache: st.cache });
      if (version !== st.version || load !== st.load || st.busy) return null;   // a newer load, pick or choice
      return { profile: other, result: res, features: gate(res, other), version };
    }
    // Switch the panel to another dashboard and check the same files for it.
    function setProfile(next, options) {
      sharedDatasets = [...next.datasets, ...(st.result ? st.result.datasets : [])];
      profile = next; st.profile = next; reuseShared = !!(options && options.reuseShared);
      ++st.gen; st.result = null; st.features = null; st.error = null;
      if (!st.load) {
        paintMessage('info', ''); st.version++; if (opts.onUpdate) opts.onUpdate(st); return Promise.resolve(true);
      }
      paintMessage('info', 'Checking files for ' + profile.name + '…');
      return refresh(++st.op);
    }

    // Fills a layer dropdown with its options when it is opened (focus by keyboard, pointer or touch).
    function fill(sel) {
      if (!sel || !sel.getAttribute || sel.getAttribute('data-lazy') !== '1') return;
      if (Number(sel.getAttribute('data-gen')) !== st.gen || !st.result) return;
      const id = sel.getAttribute('data-pick'), list = layerOptions(st.result, id, st.assign) || [], keep = sel.value;
      const have = new Set(Array.from(sel.options).map(o => o.value));
      for (const o of list) if (!have.has(o.value)) {
        const el = root.document.createElement('option');
        el.value = o.value; el.textContent = o.text; sel.appendChild(el);
      }
      sel.value = keep; sel.removeAttribute('data-lazy');
    }
    if (c.addEventListener) {
      ['focusin', 'mousedown', 'pointerdown', 'touchstart'].forEach(t => c.addEventListener(t, e => fill(e.target), true));
      // The user's open or close of the folded panel is kept across redraws: a click on its summary (the mouse, or
      // Enter or Space on it) is about to flip it.
      c.addEventListener('click', e => {
        const sum = e.target && e.target.closest && e.target.closest('#checklist-details > summary');
        if (sum) st.detailsOpen = !sum.parentElement.open;
      });
      c.addEventListener('change', e => {
        const t = e.target, gen = t.getAttribute && Number(t.getAttribute('data-gen'));
        const pick = t.getAttribute && t.getAttribute('data-pick'), ch = t.getAttribute && t.getAttribute('data-choose');
        if (pick !== null && pick !== undefined) assign(pick, t.value, gen);
        else if (ch !== null && ch !== undefined) choose(ch, t.value, gen);
      });
    }

    return { show, assign, choose, clear, setProfile, checkFor, state: st };
  }

  function applyGates(scope, features) {
    for (const f of features) {
      for (const el of Array.from(scope.querySelectorAll('[data-feature]'))
        .filter(x => x.getAttribute('data-feature') === f.id)) {
        el.classList.toggle('gated', !f.on);
        if (f.on) el.removeAttribute('aria-disabled'); else el.setAttribute('aria-disabled', 'true');
        el.querySelectorAll('input, select, button:not(.tip)').forEach(x => { x.disabled = !f.on; });   // help "?" stays usable
        const why = el.querySelector('[data-gate-reason]');
        if (why) { why.textContent = f.on ? '' : cap(f.reason) + '.'; why.hidden = f.on; }
        for (const d of el.tagName === 'DETAILS' ? [el] : Array.from(el.querySelectorAll('details'))) {
          if (!f.on) d.open = false;
          if (!d.hasAttribute('data-gate-hooked')) {
            d.setAttribute('data-gate-hooked', '');
            d.addEventListener('toggle', () => { if (d.open && el.classList.contains('gated')) d.open = false; });
          }
        }
      }
    }
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.checklist = { gate, summary, needsAttention, panelHtml, layerOptions, create, applyGates };
})(typeof window !== 'undefined' ? window : globalThis);
