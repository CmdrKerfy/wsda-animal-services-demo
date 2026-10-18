/* "What data does this need?" Generated from each profile's dataset list (site/<profile>/datasets.js):
 * for every dataset its name, the recommended file name, required or optional, what it is (about), the columns that
 * identify it, and what it turns on (features, and later versions' uses of optional columns); then the optional
 * bundle.json, and a download of the profile's synthetic sample bundle when it has one (a
 * section of the landing page, linked from the next step and the cards). Text comes from the site's own files and is
 * still escaped. Nothing leaves the browser.
 *
 * model(profile) -> { id, name, datasets: [{ id, name, file, required, kind, about, columns, exact, unlocks, note }],
 *   bundleExample }
 *   pure; columns are display labels, exact[i] says whether columns[i] is a column name (otherwise a description of the
 *   spellings accepted); unlocks are sentences; note is shown once for all datasets that share it.
 * html(profile, opts) -> HTML of one profile's part, in a fold (closed until opened or linked to); the facility
 *   layers, which share their columns, in one row; opts.sample: true adds the download button.
 * allInOneHtml() -> HTML of the part "One bundle for every dashboard" (AB), in a fold: the
 *   all-in-one sample's download button, a one-line safety note and, for people preparing bundles, the full safety
 *   note, the folder layout and a bundle.json example with "profiles" and "release".
 * create({ container, profiles: [{ list, name, available }], allInOne?: { build } }) -> { state, open(id) }   writes
 *   the section and wires the download button (data-sample="all"); open(id) opens a part's fold ("all", or a
 *   profile id) so a link to it shows it. state: { downloads, last: { id, ok, text } }
 * Kept short on the landing page: every part folded until used, one sample button (the
 * all-in-one sample, for every dashboard), shorter wording. */
(function (root) {
  'use strict';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const listOf = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  const label = c => typeof c === 'string' ? c : c.label;
  // A button's icon, when the page has the icons (the Node suites build the guide without them).
  const icon = name => (root.WSDA && root.WSDA.brand && root.WSDA.brand.iconHtml ? root.WSDA.brand.iconHtml(name) : '');
  const size = n => n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const colWord = cols => 'the ' + listOf(cols.map(c => '"' + c + '"')) + (cols.length === 1 ? ' column' : ' columns');

  function model(profile) {
    const featureName = id => (profile.features.find(f => f.id === id) || { name: id }).name;
    const datasets = profile.datasets.map(d => {
      const unlocks = [];
      for (const f of profile.features) for (const n of f.needs) {
        if (n.dataset !== d.id) continue;
        unlocks.push(n.columns ? `${f.name}, with ${colWord(n.columns)}` : f.name);
      }
      for (const u of d.useful || []) {
        if (u.feature && !profile.features.some(f => f.id === u.feature
          && f.needs.some(n => n.dataset === d.id && n.columns)))
          unlocks.push(`${featureName(u.feature)}, with ${colWord(u.columns)}`);
        if (u.with) unlocks.push(`${u.with}, with ${colWord(u.columns)}`);
        if (u.later) unlocks.push(`${u.later}, with ${colWord(u.columns)}`);
      }
      if (d.later) unlocks.push(d.later);
      const note = d.kind === 'facility'
        ? 'Facility layers have the same kind of columns, so the file name says which layer it is: use the recommended name, name the file in bundle.json, or choose its layer in Datasets after loading.'
        : d.kind === 'manifest' ? 'Each layer it lists is then expected as its own file, named as in the list.' : '';
      return { id: d.id, name: d.name, file: d.file, required: !!d.required, kind: d.kind, about: d.about || '',
        columns: d.columns.map(label), exact: d.columns.map(c => typeof c === 'string'), unlocks, note };
    });
    const fac = profile.datasets.find(d => d.kind === 'facility');
    const bundleExample = { profile: profile.id, label: profile.id === 'infrastructure' ? 'Synthetic facilities only' : 'Partner – county totals only', prepared: '2026-09-15',
      coverage: { from: '2024-01-01', to: '2025-12-31' } };
    if (fac) bundleExample.files = { [fac.id]: fac.id + '_2025.csv' };
    return { id: profile.id, name: profile.name, datasets, bundleExample };
  }

  // The table's rows: one per dataset, except the facility layers (the same columns and uses), which share one row
  // listing each layer and its file.
  function rows(m) {
    const out = [];
    for (const d of m.datasets) {
      const last = out[out.length - 1];
      if (d.kind === 'facility' && last && last.facility) { last.layers.push(d); continue; }
      out.push(d.kind === 'facility' ? { facility: true, layers: [d], d } : { facility: false, d });
    }
    return out;
  }
  function html(profile, opts) {
    const m = model(profile), id = esc(m.id);
    let h = `<details class="guide-part" data-guide-part="${id}"><summary><h3 id="guide-${id}" tabindex="-1">${esc(m.name)}</h3></summary>`;
    const req = m.datasets.filter(d => d.required).map(d => d.name);
    h += `<p>${esc(req.length ? `Needs the ${listOf(req)}; everything else is optional and switches on more.` : profile.dataNote || 'Every file is optional.')}` +
      ' Extra columns are ignored.</p>';
    h += `<div class="table-wrap"><table class="guide-table" data-guide-profile="${id}"><thead><tr><th>Dataset</th><th>Recommended file name</th>` +
      '<th>What it is</th><th>Columns it must have</th><th>What it turns on</th></tr></thead><tbody>';
    const fileName = f => esc(f).replace(/_/g, '_<wbr>');             // long file names break after underscores
    const notes = [];                                                  // each note once, under the table
    const cells = d => `<td>${d.columns.map((c, i) => d.exact[i] ? `<code>${esc(c)}</code>` : esc(c)).join(', ')}</td>` +
      `<td>${d.unlocks.length ? '<ul>' + d.unlocks.map(u => `<li>${esc(u)}</li>`).join('') + '</ul>' : ''}</td>`;
    for (const r of rows(m)) {
      const d = r.d;
      if (d.note && !r.facility) {
        const n = notes.find(x => x.note === d.note);
        if (n) n.names.push(d.name); else notes.push({ note: d.note, names: [d.name] });
      }
      if (r.facility) {
        const names = r.layers.map(x => x.name);
        h += `<tr data-guide-dataset="facility-layers" data-guide-layers="${esc(r.layers.map(x => x.id).join(' '))}">` +
          `<td>Facility layers (${r.layers.length}) <span class="req">optional</span></td>` +
          `<td><ul>${r.layers.map(x => `<li>${esc(x.name)}: <code>${fileName(x.file)}</code></li>`).join('')}</ul></td>` +
          `<td>${esc('One file per layer (' + listOf(names.map(n => n.toLowerCase())) + '), one row per facility with its location.')} ` +
          `${esc(d.note)}</td>${cells(d)}</tr>`;
        continue;
      }
      h += `<tr data-guide-dataset="${esc(d.id)}"><td>${esc(d.name)} <span class="req">${d.required ? 'required' : 'optional'}</span></td>` +
        `<td><code>${fileName(d.file)}</code></td><td>${esc(d.about)}</td>${cells(d)}</tr>`;
    }
    h += '</tbody></table></div>';
    for (const n of notes) h += `<p class="guide-note"><strong>${esc(listOf(n.names))}:</strong> ${esc(n.note)}</p>`;
    const ids = m.datasets.map(d => `${d.id} (${d.name})`);
    h += `<details class="guide-bundle"><summary>Optional: a <code>bundle.json</code> file describing the bundle</summary>` +
      '<p>A small file named <code>bundle.json</code> among your files can say which dashboard they are for, give a label, ' +
      'the date they were prepared and the period they cover (shown in a banner), and say which file is which dataset ' +
      `when the names differ from the recommended ones. Every part is optional. Dataset names to use under "files": ${esc(listOf(ids))}.</p>` +
      `<pre>${esc(JSON.stringify(m.bundleExample, null, 2))}</pre></details>`;
    if (opts && opts.sample) {
      h += `<div class="guide-sample"><button type="button" class="btn" data-sample="${id}">${icon('download')}Download a sample bundle (ZIP)</button>` +
        ' <span class="muted">' + esc(profile.sampleNote || 'Made-up data in the shapes above: every dataset listed, and a bundle.json. Load it under "Load your data" to see every feature switched on. Not real records.') + '</span>' +
        `<div class="status" role="status" data-sample-status="${id}" hidden></div></div>`;
    }
    return h + '</details>';
  }

  const LAYOUT = [
    'WSDA_Animal_Services_2026-10.zip',
    '└── WSDA_Animal_Services_2026-10/',
    '    ├── bundle.json                          label, dates, dashboards, release',
    '    ├── cvi/',
    '    │   └── CVI_Consolidated_Master.csv      the CVI map; CVI activity on Infrastructure',
    '    ├── facilities/                          shared by the CVI map and Infrastructure',
    '    │   ├── usda_wa_slaughter_facilities.csv',
    '    │   ├── wa_state_fairs.csv',
    '    │   ├── wa_state_feedlots.csv',
    '    │   ├── wa_state_public_livestock_markets.csv',
    '    │   ├── wa_state_restricted_holding_facilities.csv',
    '    │   ├── facility_overlays_manifest.csv   adds layers beyond the five',
    '    │   └── (each layer the manifest lists)',
    '    └── emergency/                           later, with the Emergency dashboard'
  ].join('\n');
  const ALL_EXAMPLE = { label: 'Example bundle – October 2026', prepared: '2026-10-13',
    coverage: { from: '2019-01-01', to: '2026-09-30' }, profiles: ['cvi', 'infrastructure'],
    release: { name: 'Example', version: '1', date: '2026-10-13' } };
  const LAYOUT_POINTS = [
    'Folders are for people. Each file is recognized by its own name and columns, so folders can be renamed or left out.',
    'Shared data goes in once: the facility layers sit in one folder, and every dashboard uses the same copy.',
    'Maps of counties, states, neighboring regions, streets and population come with the site, not in a bundle.',
    'Do not put a ZIP inside the ZIP: it is skipped (unzip it first).',
    'A bundle for fewer dashboards, or for a limited audience, uses the same layout with fewer files. A missing file switches off only the features that need it, with the reason.',
    '"profiles" lists the dashboards the bundle is meant for; leave it out to mean every dashboard. It is a label: a dashboard that is not listed still opens when its files are there.',
    '"release" (optional) gives the release profile\'s name, version and date. The page shows them in the banner and checks nothing against them.'
  ];

  // The safety note in full (in the fold for people preparing bundles; one line outside it).
  const SAFETY = 'This viewer does not make a bundle safe to share. It shows whatever files it is given. A bundle for a ' +
    'limited audience must be prepared outside the viewer, under the release-profile rules: the most an audience may ' +
    'receive is set centrally, new columns are refused until classified, and a user can only narrow it. The "profiles" ' +
    'and "release" entries in bundle.json are labels, not protection. Partner tables also have their own tool, the ' +
    'Partner Data Viewer; nothing here changes it.';
  function allInOneHtml() {
    let h = '<details class="guide-part" data-guide-part="all"><summary><h3 id="guide-all" tabindex="-1">One bundle for every ' +
      'dashboard</h3></summary>';
    h += '<p>One ZIP or folder can hold every dashboard\'s files. Load it once: each card then says whether its ' +
      'dashboard is ready to open.</p>';
    h += '<p class="guide-safety"><strong>This viewer does not make a bundle safe to share</strong> (see "For people ' +
      'preparing bundles" below).</p>';
    h += '<details class="guide-bundle" data-guide-curator><summary>For people preparing bundles: folder layout and bundle.json</summary>' +
      `<p>${esc(SAFETY)}</p>` +
      `<pre class="guide-layout">${esc(LAYOUT)}</pre><ul>${LAYOUT_POINTS.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` +
      `<p>A bundle.json for this layout:</p><pre>${esc(JSON.stringify(ALL_EXAMPLE, null, 2))}</pre></details>`;
    return h + '</details>';
  }
  // The one sample button: the all-in-one sample, at the top of the section.
  function sampleHtml() {
    return '<div class="guide-sample"><button type="button" class="btn" data-sample="all">' + icon('download') +
      'Download a sample bundle (ZIP)</button> <span class="muted">Made-up data for every dashboard, with a ' +
      'bundle.json. Load it under "Load your data" to try every feature. Not real records.</span>' +
      '<div class="status" role="status" data-sample-status="all" hidden></div></div>';
  }

  function create(opts) {
    const c = opts.container, state = { downloads: 0, last: null };
    let h = '<h2 id="guide">What data does this need?</h2>' +
      '<p class="muted">Each dashboard works with the files you have; a feature whose data is missing is switched off, ' +
      'with the reason. Files are CSV, with the column names in the first row.</p>';
    if (opts.allInOne) h += sampleHtml() + allInOneHtml();
    for (const p of opts.profiles) {
      if (p.list) h += html(p.list, {});
      else h += `<p class="muted guide-soon"><strong data-guide-soon="${esc(p.id)}">${esc(p.name)}</strong>: in preparation; ` +
        'its data list comes with the dashboard.</p>';
    }
    c.innerHTML = h;
    // Opens a part's fold (a link to it, from a card, the intro or the next step, shows it open).
    const open = id => {
      const part = c.querySelector(`details[data-guide-part="${CSS.escape(id)}"]`);
      if (part) part.open = true;
      return part;
    };
    c.addEventListener('click', async e => {
      const b = e.target.closest && e.target.closest('button[data-sample]');
      if (!b || b.disabled) return;
      const id = b.getAttribute('data-sample');
      const p = id === 'all' && opts.allInOne ? { id, sample: opts.allInOne } : null;
      const st = c.querySelector(`[data-sample-status="${CSS.escape(id)}"]`);
      if (!p) return;
      const say = (kind, text) => {
        st.hidden = false; st.className = 'status ' + kind; st.textContent = text;
        state.last = { id, ok: kind === 'ok', text };
      };
      b.disabled = true; say('info', 'Making the sample bundle…');
      try {
        const out = await p.sample.build();
        root.WSDA.sample.download(out.fileName, out.bytes);
        state.downloads++;
        say('ok', `Your browser is saving ${out.fileName} (${size(out.bytes.length)} of made-up data). Load it under "Load your data" above.`
          + ' If no file appears, your browser or IT policy blocked the download.');
      } catch (err) {
        say('err', 'The sample bundle could not be made: ' + (err && err.message || err) + ' Reload the page and try again.');
      } finally { b.disabled = false; }
    });
    return { state, open };
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.guide = { model, rows, html, allInOneHtml, sampleHtml, create, ALL_EXAMPLE, SAFETY };
})(typeof window !== 'undefined' ? window : globalThis);
