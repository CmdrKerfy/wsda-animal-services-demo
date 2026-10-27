/* Landing page (F1): profile cards, then the user's files through the shared loader and the data checklist
 * (bundle.json banner, datasets found / missing, features on / off, what each file is used as), then a clear next
 * step: "Open the CVI map" when its data is found, otherwise what is missing.
 * Each dashboard opens in its own tab, reused on the next click, and receives the files it uses in memory
 * (WSDA.load.handoff). Routing: bundle.json "profiles" (or the older "profile") lists
 * the dashboards the bundle is for; the first available one gets the checklist. CVI and Infrastructure each have a
 * selected checklist; a bundle for a dashboard in preparation, or for one this site does not have, is reported in
 * the next step and on the cards.
 * All-in-one bundles (AB): once files are loaded, every available card shows its readiness from
 * the one load ("Ready.", "Ready; off with these files: …", "Needs: …", "Choose a file …"), worked out as switching
 * to it would (checklist.checkFor). A ready card opens its dashboard with one click, without switching the checklist;
 * one tab per click, never several at once (browsers allow one new tab per click). The list in bundle.json is
 * advice, not a lock: an unlisted dashboard says "Not listed in this bundle." and can still be opened.
 * "What data does this need?" (shared/guide.js) is a section of this page, linked from the cards, the intro
 * and the next step whenever data is missing; it offers the all-in-one synthetic sample for every dashboard as a
 * download (AB; the only sample button: the per-dashboard samples remain for the tests and the
 * Infrastructure dashboard's own loader). The sample is built from the county label points, so geo/wa-counties.js
 * is read only when it is first asked for.
 * Kept short: the guide's parts are folded until used (a link to
 * one opens it), the checklist's tables are folded under a one-line result (open when something needs attention),
 * one sample button (the all-in-one sample), shorter wording, and the CVI card says what the CVI page has.
 * Emergency Response (a preview): its card reads "(preview)"; loose files (no bundle.json list) with a found
 * positives file are checked for it first (recognized as the Emergency dashboard would, checklist.checkFor), before
 * the rule that sends facility files without a master to Infrastructure. Its zone files (GeoJSON, KML) travel with
 * the other files.
 * A new profile adds a folder, a dataset list and an entry in PROFILES. */
(function (root) {
  'use strict';
  const L = root.WSDA.load, W = root.WSDA;
  let geo = null;
  // Load geo/wa-counties.js once, when the sample first needs it.
  const needGeo = () => root.CVIWA_GEO ? Promise.resolve() : geo || (geo = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'geo/wa-counties.js'; s.onload = res;
    s.onerror = () => { geo = null; s.remove(); rej(new Error('The county file geo/wa-counties.js could not be read.')); };
    document.head.appendChild(s);
  }));
  const PROFILES = [
    { id: 'cvi', name: 'CVI Traceability', available: true, url: 'cvi/index.html', open: 'Open the CVI map', map: 'the CVI map',
      mapFeature: 'wa-map', list: root.WSDA.profiles.cvi,
      about: 'Animal movements on certificates of veterinary inspection (CVI): WA State and National Flow maps, County ' +
        'Focus, Premise Lookup, charts and exports.' },
    { id: 'emergency', name: 'Emergency Response', preview: true, available: true, url: 'emergency/index.html',
      open: 'Open Emergency Response', map: 'Emergency Response', mapFeature: 'positives',
      list: root.WSDA.profiles.emergency,
      about: 'HPAI positives on a map, their zones, the sites inside them and the CVI movements that touch them.' },
    { id: 'infrastructure', name: 'Infrastructure', available: true, url: 'infrastructure/index.html',
      open: 'Open Infrastructure', map: 'Infrastructure', mapFeature: 'facility-files', list: root.WSDA.profiles.infrastructure,
      about: 'Facility layers on a map, with filters, details and exports. No CVI master needed.' }
  ];
  // The all-in-one sample (AB): the Full tier's files in cvi/ and facilities/ folders, for every dashboard.
  const ALL_IN_ONE = { build: async () => {
    await needGeo();
    const all = root.WSDA.sample.allDashboards(root.CVIWA_GEO.labels);
    return { fileName: all.fileName, bytes: root.WSDA.sample.zip(all.entries) };
  } };
  let CHECKED = PROFILES[0];
  // ready: each other card's readiness, by profile id, for the checklist version in readyKey (AB).
  const state = { version: 0, loading: false, result: null, op: 0, opened: null, selected: 'cvi', switchNote: null,
    ready: Object.create(null), readyKey: null, cards: { next: null, checking: false } };
  const $ = id => document.getElementById(id);
  const plural = (n, w) => n.toLocaleString('en-US') + ' ' + w + (n === 1 ? '' : 's');
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  const listOf = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

  /** The dashboards a bundle.json lists: { profile, note, listed } (pure). profile: the first available one listed;
   * when none is available, the first one this site knows (in preparation) with a note; listed: the ids, or null. */
  function route(bundle) {
    const list = bundle && bundle.found ? root.WSDA.bundle.listed(bundle.info) : null;
    if (!list) return { profile: null, note: null, listed: null };
    const available = list.map(id => PROFILES.find(x => x.id === id && x.available)).find(Boolean);
    if (available) return { profile: available, note: null, listed: list };
    const p = list.map(id => PROFILES.find(x => x.id === id)).find(Boolean);
    if (!p) return { profile: null, listed: list, note: `bundle.json says this bundle is for ${listOf(list.map(id => '"' + id + '"'))}, which this site does not have. Your files were checked against ${CHECKED.name}.` };
    const unknown = list.filter(id => !PROFILES.some(x => x.id === id)).map(id => '"' + id + '"');
    const others = unknown.length ? `, and for ${listOf(unknown)}, which this site does not have` : '';
    return { profile: p, listed: list, note: `bundle.json says this bundle is for ${p.name}, which is in preparation${others}. Your files were checked against ${CHECKED.name}.` };
  }

  /** A card's readiness from its dashboard's features (pure): { kind, open, text }. kind: 'ready', 'partial' (opens,
   * some features off), 'choose' (two files claim one dataset) or 'needs'. selected: the card whose checklist is
   * shown below (its choices are made there). The same rule as the next step: the dashboard's main feature decides,
   * except that two files claiming any dataset (result.needsChoice; a facility layer switches no feature off) ask
   * for the choice first: the other card's button then checks the files for it, so the choice can be made below. */
  function readiness(p, features, selected, result) {
    const map = features.find(f => f.id === p.mapFeature);
    const choices = result && result.needsChoice ? result.needsChoice : [];
    if (map && map.on && choices.length) {
      const names = listOf(choices.map(c => c.name));
      return selected ? { kind: 'choose', open: true, text: 'Choose a file in Datasets below for the ' + names + '.' }
        : { kind: 'choose', open: false, text: 'Choose a file first (the ' + names + '): click the button below to check.' };
    }
    if (map && map.on) {
      const off = features.filter(f => !f.on).map(f => f.name);
      if (off.length) return { kind: 'partial', open: true, text: 'Ready; off with these files: ' + off.join(', ') + '.' };
      return { kind: 'ready', open: true, text: 'Ready.' };
    }
    const reason = map ? map.reason : 'needs data that was not found';
    if (/^choose /.test(reason)) {
      return { kind: 'choose', open: false,
        text: selected ? 'Choose a file in Datasets below.' : 'Choose a file first: click the button below to check.' };
    }
    return { kind: 'needs', open: false, text: 'Needs: ' + reason.replace(/^needs /, '') + '.' };
  }

  /** What to do after the checklist (pure): null when there is nothing to say (nothing loaded, or the files could not
   * be checked: the status line says why), otherwise { kind, text, notes, open, guide } where open is the profile to
   * open and guide says whether to link "What data does this need?" (something is missing). */
  function nextStep(load, cl) {
    if (!load || !load.items.length || !cl || !cl.result || !cl.features) return null;
    const p = PROFILES.find(x => x.id === (cl.profile && cl.profile.id)) || CHECKED, notes = [], r = route(cl.bundle);
    if (state.switchNote) notes.push(state.switchNote);
    if (r.note) notes.push(r.note);
    const map = cl.features.find(f => f.id === p.mapFeature);
    if (map && map.on) {
      const off = cl.features.filter(f => !f.on);
      if (off.length) notes.push('Not available with these files: ' + off.map(f => `${f.name} (${f.reason})`).join('; ') + '.');
      return { kind: 'ok', text: `Next: open ${p.map}. Your files have what it needs.`, notes, open: p.id,
        guide: off.length > 0 };
    }
    const reason = map ? map.reason : 'needs data that was not found';
    // The manifest is named only when one is among the files.
    const manifest = cl.result.datasets.some(d => d.kind === 'manifest' && d.status === 'found');
    if (p.id === 'infrastructure' && !/^choose /.test(reason)) return { kind: 'warn',
      text: 'Next: add or assign at least one facility file.' + (manifest ? ' A manifest lists layers but supplies no points.' : ''),
      notes, open: null, guide: true };
    // Some reasons already say where to choose.
    const where = / in Datasets below$/.test(reason) ? '' : ' in Datasets below';
    if (/^choose /.test(reason)) return { kind: 'warn', text: `Next: ${reason}${where}. Then you can open ${p.map}.`,
      notes, open: null, guide: false };
    notes.unshift('Your files below show what each one was recognized as, and why a file was not used.');
    // A loaded file that looks like a missing dataset but lacks columns is named with its reason, instead of "none
    // of your files is it".
    const missingNames = cl.result.datasets.filter(d => d.status === 'missing').map(d => d.name);
    const near = (cl.result.files || []).find(f => f.status === 'not-used' && f.reason &&
      missingNames.some(name => f.reason.startsWith('it looks like the ' + name + ' ') ||
        f.reason.startsWith('it is named like the ' + name + ' ') || f.reason.startsWith('it is the ' + name + ' ')));
    if (near && / more than once; /.test(near.reason)) return { kind: 'warn',
      text: `${cap(p.map)} ${reason}. ${near.name} ${near.reason.replace(/^it /, '')}, then choose all your files ` +
        'again, together.', notes, open: null, guide: false };
    if (near) return { kind: 'warn',
      text: `${cap(p.map)} ${reason}. ${near.name} ${near.reason.replace(/^it /, '')}. Ask for a copy with every ` +
        'column listed under "What data does this need?", then choose all your files again, together.',
      notes, open: null, guide: true };
    return { kind: 'warn',
      text: `${cap(p.map)} ${reason}, and none of your files is it. Add that file, then choose all your files again, together.`,
      notes, open: null, guide: true };
  }

  // ---- cards ------------------------------------------------------------------------------------------------------
  // A card for each profile: its name, description, readiness line, open button and guide link.
  function renderCards() {
    const box = $('profiles');
    box.textContent = '';
    for (const p of PROFILES) {
      const card = document.createElement('section');
      card.className = 'card' + (p.available ? '' : ' soon');
      card.setAttribute('data-profile', p.id);
      const h = document.createElement('h3'); h.textContent = p.name + (p.preview ? ' (preview)' : ''); card.appendChild(h);
      const t = document.createElement('p'); t.className = 'card-about'; t.textContent = p.about; card.appendChild(t);
      const note = document.createElement('p'); note.className = 'card-note'; note.hidden = true; card.appendChild(note);
      if (p.available) {
        const ready = document.createElement('p'); ready.className = 'card-ready'; ready.hidden = true;
        ready.setAttribute('role', 'status'); card.appendChild(ready);
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn';
        b.innerHTML = W.brand.iconHtml('box-arrow-up-right'); W.brand.buttonText(b, p.open);   // opens a new tab
        b.setAttribute('data-open', p.id); card.appendChild(b);
        const m = document.createElement('span'); m.className = 'muted card-open-help';
        m.textContent = 'Opens in a new tab.'; card.appendChild(m);
        if (p.list) {
          const g = document.createElement('p'); g.className = 'muted';
          const a = document.createElement('a'); a.href = '#guide-' + p.id; a.textContent = 'What data does this need?';
          a.setAttribute('data-guide-link', p.id); g.appendChild(a); card.appendChild(g);
        }
      } else {
        const s = document.createElement('span'); s.className = 'soon-badge'; s.textContent = 'In preparation';
        card.appendChild(s);
      }
      box.appendChild(card);
    }
  }

  // next: the next step (null while files are checked). The button and the line beside it say what a click does:
  // open the dashboard, recheck the loaded files for another dashboard, or nothing yet (Infrastructure opens only
  // with a usable facility file once files are loaded; the CVI map opens without files instead).
  // A card other than the selected one opens its dashboard directly when its readiness (for the current checklist
  // version) says it can; otherwise its button checks the loaded files for it, as before (AB).
  function paintCards(cl, next, checking) {
    state.cards = { next, checking };
    const loaded = !!(cl && cl.load && cl.load.items.length);
    const r = route(loaded ? cl.bundle : null);
    for (const card of document.querySelectorAll('#profiles .card')) {
      const id = card.getAttribute('data-profile'), note = card.querySelector('.card-note');
      const listed = !!(r.listed && r.listed.includes(id));
      card.classList.toggle('selected', state.selected === id);
      const button = card.querySelector('button[data-open]'), profile = PROFILES.find(p => p.id === id);
      if (button) {
        const other = loaded && state.selected !== id;
        const ready = other ? state.ready[id] : null;
        const direct = !checking && !!ready && ready.readiness.open && ready.version === cl.version;
        const recheck = other && !direct;
        const blocked = !checking && loaded && !other && id === 'infrastructure' && !(next && next.open === id);
        W.brand.buttonText(button, recheck ? 'Check files for ' + profile.name : profile.open);   // keeps the icon
        button.setAttribute('data-blocked', blocked ? '1' : '');
        button.setAttribute('data-direct', direct ? '1' : '');
        const withFiles = direct || (!other && !checking && !!next && next.open === id);
        card.querySelector('.card-open-help').textContent = withFiles ? 'Opens in a new tab with your files.'
          : recheck ? 'Checks the loaded files for this dashboard.'
          : blocked ? 'Not available with these files: see the next step below.' : 'Opens in a new tab.';
        paintReadiness(card.querySelector('.card-ready'), profile, cl, loaded, checking, other ? ready : null);
      }
      card.setAttribute('aria-label', card.querySelector('h3').textContent
        + (state.selected === id ? ' (selected checklist)' : ''));
      card.classList.toggle('routed', listed);
      // Loose files (no bundle.json list): the card of the dashboard they are checked for is outlined instead.
      card.classList.toggle('checked-for', loaded && !r.listed && state.selected === id);
      const unlisted = loaded && !!r.listed && !listed && !!profile.available;
      note.hidden = !listed && !unlisted;
      note.classList.toggle('unlisted', unlisted);
      note.textContent = listed ? (profile.available ? 'Your bundle.json says the files are for this dashboard.'
        : 'Listed in this bundle; in preparation, so it cannot be opened yet.') : unlisted ? 'Not listed in this bundle.' : '';
    }
  }

  // The readiness line under a card's description: "Load your data below first." before files are loaded (the
  // dashboard would open empty), "Checking…" while they are
  // (and while another card's answer for the current files is worked out: an older answer is never shown), nothing
  // when the files could not be checked (the status line says why). The text is rewritten only when it changes, so a
  // screen reader does not repeat it on every repaint.
  function paintReadiness(el, profile, cl, loaded, checking, ready) {
    let v = null;
    if (!loaded) v = checking ? null : { kind: 'empty', text: 'Load your data below first.' };
    else if (checking) v = { kind: 'checking', text: 'Checking…' };
    else if (loaded && !cl.result) v = null;
    else if (loaded && state.selected === profile.id && cl.features) v = readiness(profile, cl.features, true, cl.result);
    else if (loaded && ready && ready.version === cl.version) v = ready.readiness;
    else if (loaded) v = { kind: 'checking', text: 'Checking…' };
    el.hidden = !v;
    const text = v ? v.text : '', kind = v ? v.kind : '';
    if (el.textContent !== text) el.textContent = text;
    if (el.getAttribute('data-ready') !== kind) el.setAttribute('data-ready', kind);
  }

  // Disable every open button while files are checked, and the ones marked blocked.
  function syncButtons(checking) {
    for (const b of document.querySelectorAll('button[data-open]')) b.disabled = checking || b.getAttribute('data-blocked') === '1';
  }

  // Works out every other available card's readiness once per checklist version and selected dashboard, then
  // repaints the cards. A newer load, pick or switch starts over; a dashboard that cannot be checked here keeps its
  // "Check files for …" button.
  async function refreshReady() {
    const cl = checklist.state;
    if (state.loading || cl.busy || !cl.load || !cl.load.items.length || !cl.result) return;
    const version = cl.version, key = version + ':' + CHECKED.id;
    if (state.readyKey === key) return;
    state.readyKey = key; state.ready = Object.create(null);
    for (const p of PROFILES) {
      if (!p.available || p === CHECKED) continue;
      let r = null;
      try { r = await checklist.checkFor(p.list); } catch (e) { r = null; }
      if (state.readyKey !== key) return;
      state.ready[p.id] = r ? { version: r.version, check: r, readiness: readiness(p, r.features, false, r.result) }
        : { version, check: null,
          readiness: { kind: 'needs', open: false, text: 'Could not be checked here: click the button below.' } };
    }
    paintCards(checklist.state, state.cards.next, state.cards.checking);
    syncButtons(state.cards.checking);
  }

  // ---- next step --------------------------------------------------------------------------------------------------
  // While files are read or rechecked (a choice in Datasets) nothing can be opened: the buttons are disabled and the
  // next step says the files are being checked, so an earlier "Open" cannot send an outdated result.
  function paintNext() {
    const cl = checklist.state, box = $('next-step'), checking = state.loading || cl.busy;
    const n = checking ? null : nextStep(cl.load, cl);
    paintCards(cl, n, checking);
    syncButtons(checking);
    if (!checking) refreshReady();
    $('dashboard-select').disabled = state.loading;
    state.opened = null;              // a new load or choice: an earlier click's report no longer applies
    $('next-opened').hidden = true;
    if (checking && !state.loading && cl.load && cl.load.items.length) {
      box.hidden = false; box.className = 'next info'; box.setAttribute('data-kind', 'checking');
      $('next-text').textContent = 'Checking your files again… The next step appears here when that is done.';
      $('next-notes').hidden = true; $('next-open').hidden = true; $('next-open-help').hidden = true;
      $('next-guide').hidden = true;
      return;
    }
    if (!n) { box.hidden = true; return; }
    box.hidden = false; box.className = 'next ' + n.kind; box.setAttribute('data-kind', n.kind);
    $('next-text').textContent = n.text;
    const notes = $('next-notes'); notes.textContent = '';
    for (const t of n.notes) { const li = document.createElement('li'); li.textContent = t; notes.appendChild(li); }
    notes.hidden = !n.notes.length;
    $('next-guide').hidden = !n.guide;
    const guideLink = $('next-guide').querySelector && $('next-guide').querySelector('a');
    if (guideLink) guideLink.href = '#guide-' + CHECKED.id;
    const p = PROFILES.find(x => x.id === n.open);
    $('next-open').hidden = !p; $('next-open-help').hidden = !p;
    if (p) { W.brand.buttonText($('next-open'), p.open); $('next-open').setAttribute('data-open', p.id); }
  }

  // The files a dashboard's features use, taken now (a later load or choice does not change what this click sends).
  function payloadFor(p, cl) {
    const res = cl.result, items = new Map(cl.load.items.map(i => [i.id, i])), banner = (cl.bundle && cl.bundle.banner) || null;
    const synthetic = !!(cl.bundle && cl.bundle.info && cl.bundle.info.synthetic);   // the sample: marked on its pictures
    const used = new Set(p.list.features.flatMap(f => f.needs.map(n => n.dataset))), kinds = p.list.handoffKinds || [];
    // Also every found dataset of the kinds the profile names (CVI: facility layers and the manifest, S5).
    const found = res.datasets.filter(d => (used.has(d.id) || kinds.includes(d.kind)) && d.status === 'found'
      && items.has(d.fileId));
    return async () => {
      const datasets = Object.create(null);
      for (const d of found) {
        const it = items.get(d.fileId);
        const type = d.kind === 'zone' ? 'application/octet-stream' : 'text/csv';   // a zone file is GeoJSON or KML
        datasets[d.id] = { name: it.name, path: it.path, file: new File([await it.read()], it.name, { type }) };
      }
      return { banner, datasets, synthetic };
    };
  }

  // A message under the next step about the latest click on an open button.
  function say(kind, text) {
    const msg = $('next-opened'); msg.hidden = false; msg.className = 'status ' + kind; msg.textContent = text;
  }

  // Success is reported only when the dashboard says it has loaded the files; a file that cannot be read, here or
  // there, is reported with what to do.
  function report(opened, p, s) {
    if (state.opened !== opened) return;               // a later click, load or choice
    if (s.state === 'loaded') say('ok', `${cap(p.map)} is open in its own tab with your files. If you load other files here, click "${p.open}" again to send them.`);
    else if (s.state === 'failed') say('err', `Your files could not be sent to ${p.map}: ${s.message} Choose all your files again, together (a new copy if one is damaged), then click "${p.open}".`);
    else say('err', `${cap(p.map)} could not load your files: ${s.message}`);
  }

  // Open a dashboard's tab, with the files when its readiness allows; returns the window, or null.
  function openProfile(id) {
    const p = PROFILES.find(x => x.id === id && x.available);
    const cl = checklist.state;
    if (!p || state.loading || cl.busy) return null;
    let payload = null;
    if (p !== CHECKED && cl.load && cl.load.items.length) {
      // A ready card opens directly with its own recognition (AB); any other card checks the files for it first.
      const r = state.ready[p.id];
      if (!(r && r.check && r.readiness.open && r.version === cl.version)) { selectProfile(id, true); return null; }
      payload = payloadFor(p, { result: r.check.result, load: cl.load, bundle: cl.bundle });
    } else {
      const n = nextStep(cl.load, cl), ready = n && n.open === p.id;
      if (p.id === 'infrastructure' && cl.load && cl.load.items.length && !ready) return null;
      if (ready) payload = payloadFor(p, cl);
    }
    const ready = !!payload;
    const opened = { id: p.id, withFiles: ready };
    // With nothing loaded here the dashboard is told so at once ({ empty: true }); with files that it cannot use, it
    // gets none and says what it needs.
    const none = !(cl.load && cl.load.items.length);
    const win = L.handoff.open(p.id, p.url, ready ? payload : none ? () => ({ empty: true }) : () => null,
      s => report(opened, p, s));
    if (!win) {
      const blockedText = 'The browser blocked the new tab. Allow pop-ups for this page, then click the button again.';
      if (!$('next-step').hidden) say('err', blockedText);
      // Also under the card's button, where it shows before any files are loaded.
      const help = document.querySelector(`#profiles .card[data-profile="${p.id}"] .card-open-help`);
      if (help) help.textContent = blockedText;
      return null;
    }
    state.opened = opened;
    if (ready) say('info', `Opening ${p.map} and sending your files…`);
    return win;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button[data-open]');
    if (b) openProfile(b.getAttribute('data-open'));
  });

  // Check the loaded files for another dashboard (explicit: the user's own switch, which keeps their choices).
  async function selectProfile(id, explicit) {
    const p = PROFILES.find(x => x.id === id && x.available);
    if (!p) return false;
    const op = ++state.op;
    CHECKED = p; state.selected = p.id; $('dashboard-select').value = p.id;
    state.switchNote = explicit
      ? 'Checking the same files for ' + p.name + ', with your choices kept. Open dashboards keep their own files.'
      : null;
    $('dashboard-note').textContent = state.switchNote || 'Checking files for ' + p.name + '…';
    state.loading = true; paintNext();
    const ok = await checklist.setProfile(p.list, { reuseShared: !!explicit });
    if (op !== state.op) return false;
    state.loading = false; state.version++; paintNext(); return ok;
  }
  $('dashboard-select').addEventListener('change', e => selectProfile(e.target.value, true));

  // ---- loading ----------------------------------------------------------------------------------------------------
  renderCards();
  const guide = root.WSDA.guide.create({ container: $('guide-section'), profiles: PROFILES, allInOne: ALL_IN_ONE });
  const checklist = root.WSDA.checklist.create({ container: $('load-results'), banner: $('bundle-banner'), profile: CHECKED.list,
    onUpdate: () => paintNext(), fold: true });
  // A link to a part of the guide (a card's, the intro's, the next step's) opens that part's fold, then the browser
  // scrolls to it as usual; so does a page opened with such an address.
  const openGuideFor = hash => {
    const m = /^#guide-(.+)$/.exec(hash || '');
    if (m) guide.open(m[1]);
  };
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href^="#guide-"]');
    if (a) openGuideFor(a.getAttribute('href'));
  });
  const hashNow = () => (root.location ? root.location.hash : '');
  if (root.addEventListener) root.addEventListener('hashchange', () => openGuideFor(hashNow()));
  openGuideFor(hashNow());
  paintNext();   // the cards' first lines ("Load your data below first.") before anything is loaded

  // Only the most recent selection may publish its result: an older, slower load finishing later is discarded.
  async function run(collect) {
    const op = ++state.op;
    state.loading = true; state.switchNote = null;
    state.ready = Object.create(null); state.readyKey = null;   // the other cards' answers were for the previous files
    setStatus('info', 'Reading files…');
    checklist.clear();                // the previous checklist and banner go at once
    let result = null, error = null;
    try { result = await collect(); } catch (e) { error = e; }
    if (op !== state.op) return;
    if (error) {
      state.result = null; setStatus('err', 'The files could not be read: ' + error.message); await checklist.clear();
    }
    else {
      state.result = result; status(result);
      if (result.items.length) setStatus('info', 'Checking which datasets these files are…');
      await checklist.show(result);
      if (op !== state.op) return;
      const r = route(checklist.state.bundle);
      const found = checklist.state.result && checklist.state.result.datasets || [];
      const positives = !(r.profile && r.profile.available) && !r.note && await hasPositives();
      if (op !== state.op) return;
      const id = r.profile && r.profile.available ? r.profile.id
        : positives ? 'emergency'
        : !r.note && !found.some(d => d.id === 'master' && d.status === 'found')
          && (found.some(d => d.kind === 'facility' && (d.status === 'found' || d.status === 'conflict'))
            || (checklist.state.result?.files || []).some(f => f.candidates?.length || f.layers?.length))
          ? 'infrastructure' : 'cvi';
      CHECKED = PROFILES.find(p => p.id === id); state.selected = id; $('dashboard-select').value = id;
      await checklist.setProfile(CHECKED.list);
      if (op !== state.op) return;
      $('dashboard-note').textContent = route(checklist.state.bundle).note
        || 'Checked for ' + CHECKED.name + '. Pick another dashboard to check the same files for it.';
      status(result);
    }
    state.loading = false; state.version++;
    paintNext();
  }

  // True when the loaded files hold a positives file for Emergency Response (found, or two files to choose from),
  // recognized as that dashboard would recognize them.
  async function hasPositives() {
    const em = PROFILES.find(p => p.id === 'emergency' && p.available);
    if (!em) return false;
    const r = await checklist.checkFor(em.list);
    return !!(r && r.result.datasets.some(d => d.id === 'positives' && (d.status === 'found' || d.status === 'conflict')));
  }

  // Set the status line under the file inputs.
  function setStatus(kind, text) { const s = $('load-status'); s.className = 'status ' + kind; s.textContent = text; }

  // The status line for a load: its errors, or how many files were received and skipped.
  function status(r) {
    const n = r.items.length;
    if (r.errors.length) setStatus('err', r.errors.map(e => e.message).join(' '));
    else if (!n) setStatus('warn', 'No usable files were found'
      + (r.ignored.length ? ' (' + plural(r.ignored.length, 'file') + ' skipped, listed below).' : '.'));
    else setStatus('ok', plural(n, 'file') + ' received' + (r.ignored.length ? '; ' + r.ignored.length + ' skipped.' : '.'));
  }

  $('files-input').addEventListener('change', e => {
    const fl = e.target.files; run(() => L.fromFileList(fl, 'files')).then(() => { e.target.value = ''; });
  });
  $('folder-input').addEventListener('change', e => {
    const fl = e.target.files; run(() => L.fromFileList(fl, 'folder')).then(() => { e.target.value = ''; });
  });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', e => { e.preventDefault(); const dt = e.dataTransfer; run(() => L.fromDataTransfer(dt)); });
  // From the keyboard the drop area opens the file chooser (it can be reached with Tab).
  drop.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    $('files-input').click();
  });
  // A file dropped anywhere else must not navigate the browser away from the page.
  ['dragover', 'drop'].forEach(t => root.addEventListener(t, e => e.preventDefault()));

  root.WSDA.landing = { state, checklist, guide, nextStep, route, readiness, openProfile, selectProfile, payloadFor,
    PROFILES, ALL_IN_ONE };
})(window);
