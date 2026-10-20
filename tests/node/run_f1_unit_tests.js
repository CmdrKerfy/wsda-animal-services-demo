#!/usr/bin/env node
'use strict';
// F1 unit tests (Node >= 22, no packages): the shared ZIP reader, file intake and recognition (site/shared/zip.js,
// load.js, recognize.js, bundle.js, checklist.js) and the CVI dataset list (site/cvi/datasets.js) run unchanged in
// Node, which provides Blob, File and DecompressionStream. Also the guide (guide.js) and the sample bundle
// (shared/sample.js, cvi/sample.js): one generator for the fixture, the Full tier and the download. Regenerates the fixtures (tests/synthetic/make_bundles.js), on macOS also reads ZIPs
// made by the system `zip` and `ditto` tools, and compares recognition of every tier bundle (as ZIP and as folder)
// and negative case with the hand-written oracle tests/synthetic/f1_checklist_matrix.json.
// Usage (repository root): node tests/node/run_f1_unit_tests.js
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
require(path.join(ROOT, 'site', 'shared', 'zip.js'));
require(path.join(ROOT, 'site', 'shared', 'load.js'));
require(path.join(ROOT, 'site', 'shared', 'recognize.js'));
require(path.join(ROOT, 'site', 'shared', 'bundle.js'));
require(path.join(ROOT, 'site', 'shared', 'checklist.js'));
require(path.join(ROOT, 'site', 'shared', 'sample.js'));
require(path.join(ROOT, 'site', 'shared', 'guide.js'));
require(path.join(ROOT, 'site', 'cvi', 'datasets.js'));
require(path.join(ROOT, 'site', 'cvi', 'sample.js'));
const { zip: Z, load: L, recognize: R, bundle: B, checklist: C } = globalThis.WSDA;
const CVI = globalThis.WSDA.profiles.cvi;
const gen = require(path.join(ROOT, 'tests', 'synthetic', 'make_bundles.js'));

let pass = 0, fail = 0; const failures = [];
const check = (ok, name, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 400) : '')); } };
const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const syn = f => fs.readFileSync(path.join(ROOT, 'tests', 'synthetic', f));
const blobOf = (buf, name) => new File([buf], name || 'x.zip');
async function throwsZip(fn, re, name) {
  try { await fn(); check(false, name + ' (expected an error)'); }
  catch (e) { check(e instanceof Z.ZipError && re.test(e.message), name, e.message); }
}

(async () => {
  // Determinism and CRC
  const dir = gen.writeCheckpoint();
  const hash = d => fs.readdirSync(d).filter(f => f.endsWith('.zip')).sort().map(f => f + crypto.createHash('sha256').update(fs.readFileSync(path.join(d, f))).digest('hex')).join();
  const h1 = hash(dir); gen.writeCheckpoint(); check(h1 === hash(dir), 'generator is deterministic');
  check(Z.crc32(Buffer.from('123456789')) === 0xCBF43926, 'CRC-32 check value');
  const small = syn('cvi_master_small.csv'), wa = syn('cvi_master_wa39.csv');
  const cp = f => blobOf(fs.readFileSync(path.join(dir, f)), f);

  // Round trips
  for (const f of ['stored.zip', 'deflate.zip']) {
    const { entries, ignored } = await Z.open(cp(f));
    const byName = Object.fromEntries(entries.map(e => [e.name, e]));
    check(ignored.length === 0, f + ': nothing ignored', ignored);
    check(same(await byName['cvi_master_small.csv'].read(), small), f + ': small fixture round-trips');
    check(same(await byName['cvi_master_wa39.csv'].read(), wa), f + ': WA fixture round-trips');
    check(entries.every(e => e.method === (f === 'stored.zip' ? 0 : 8)), f + ': method');
  }
  {
    const { entries } = await Z.open(cp('deflate.zip'));
    const bj = JSON.parse(new TextDecoder().decode(await entries.find(e => e.name === 'bundle.json').read()));
    check(bj.profile === 'cvi' && bj.coverage.to === '2025-12-31', 'bundle.json readable from ZIP');
  }
  {
    const { entries, ignored } = await Z.open(cp('finder_style.zip'));
    check(entries.map(e => e.path).join('|') === 'CVI bundle/cvi_master_wa39.csv|CVI bundle/Données – petit.csv', 'Finder style: folder entries dropped, UTF-8 names', entries.map(e => e.path));
    check(same(await entries[0].read(), wa) && same(await entries[1].read(), small), 'Finder style: data descriptors read');
    check(ignored.length === 2 && ignored.every(x => /macOS/.test(x.reason)), 'Finder style: .DS_Store and __MACOSX ignored', ignored);
  }
  check((await Z.open(cp('empty.zip'))).entries.length === 0, 'empty ZIP: no entries, no error');
  {
    const { entries, ignored } = await Z.open(cp('encrypted_entry.zip'));
    check(entries.length === 1 && ignored.length === 1 && /password-protected/.test(ignored[0].reason), 'encrypted entry skipped with reason', ignored);
  }
  {
    const { entries, ignored } = await Z.open(cp('unsupported_method.zip'));
    check(entries.length === 1 && /BZIP2/.test(ignored[0].reason), 'unsupported method skipped with reason', ignored);
  }

  // Damaged and wrong inputs
  await throwsZip(async () => (await Z.open(cp('bad_crc.zip'))).entries[0].read(), /integrity check/, 'bad CRC detected');
  await throwsZip(() => Z.open(cp('truncated.zip')), /incomplete or damaged/, 'truncated ZIP rejected');
  {
    let msgs = [];
    for (const e of (await Z.open(cp('garbled_data.zip'))).entries) { try { await e.read(); } catch (x) { msgs.push(x.message); } }
    check(msgs.length >= 1 && msgs.every(m => /damaged/.test(m)), 'garbled deflate data detected', msgs);
  }
  await throwsZip(() => Z.open(cp('not_really.zip')), /is not a ZIP file/, 'CSV renamed .zip rejected');
  await throwsZip(() => Z.open(blobOf(Buffer.from('PK'))), /not a ZIP file \(too short\)/, 'tiny file rejected');
  {   // entry whose declared size is smaller than its real content (zip-bomb style lie), told consistently in the
      // directory and the local header so that the inflate size guard itself is what stops it
    const b = Buffer.from(fs.readFileSync(path.join(dir, 'deflate.zip')));
    const cenOff = b.readUInt32LE(b.length - 22 + 16);
    b.writeUInt32LE(100, cenOff + 24); b.writeUInt32LE(100, 22);
    await throwsZip(async () => (await Z.open(blobOf(b))).entries[0].read(), /larger than the archive says/, 'understated size stops decompression');
  }

  // Limits
  await throwsZip(() => Z.open(cp('deflate.zip'), { limits: { maxEntries: 2 } }), /lists 3 files; the limit is 2/, 'entry-count limit');
  await throwsZip(() => Z.open(cp('deflate.zip'), { limits: { maxArchiveBytes: 1000 } }), /the limit is/, 'archive size limit');
  await throwsZip(() => Z.open(cp('stored.zip'), { limits: { maxTotalBytes: wa.length } }), /expands to more than/, 'total size limit');
  {
    const { entries, ignored } = await Z.open(cp('stored.zip'), { limits: { maxEntryBytes: small.length } });
    check(entries.length === 1 && /per-file limit/.test(ignored[0].reason), 'per-file size limit skips the file', ignored);
  }

  // File intake (load.js) with File objects
  {
    const r = await L.fromFileList([cp('deflate.zip'), new File([small], 'loose.csv')], 'files');
    check(r.items.length === 4 && r.errors.length === 0, 'intake: ZIP expanded plus loose file', r.items.map(i => i.path));
    check(r.items.filter(i => i.source === 'zip').every(i => i.archive === 'deflate.zip'), 'intake: archive recorded');
    check((await r.items.find(i => i.name === 'loose.csv').text()) === small.toString('utf8'), 'intake: loose text');
    check((await r.items.find(i => i.name === 'cvi_master_wa39.csv').text()) === wa.toString('utf8'), 'intake: ZIP entry text');
  }
  {
    const r = await L.fromFileList([cp('nested_zip.zip')], 'files');
    check(r.items.length === 1 && /ZIP inside a ZIP/.test(r.ignored[0].reason), 'intake: nested ZIP not opened', r.ignored);
  }
  {
    const r = await L.fromFileList([cp('truncated.zip'), cp('not_really.zip'), cp('stored.zip')], 'files');
    check(r.errors.length === 2 && r.items.length === 2, 'intake: bad archives reported, good one still loads', r.errors);
  }
  {
    const r = await L.fromFileList([new File(['x'], 'renamed.csv'), new File([fs.readFileSync(path.join(dir, 'stored.zip'))], 'bundle.dat')], 'files');
    check(r.items.length === 3, 'intake: ZIP recognized by content when not named .zip', r.items.map(i => i.path));
  }
  {
    const r = await L.fromFileList([], 'folder');
    check(r.items.length === 0 && r.sources[0].path === '(empty folder)', 'intake: empty folder');
  }

  // ZIPs made by real tools (macOS only)
  if (process.platform === 'darwin') {
    const tools = path.join(gen.OUT, 'checkpoint', 'tools'); fs.mkdirSync(tools, { recursive: true });
    const src = path.join(dir, 'folder');
    const made = [];
    try { execFileSync('zip', ['-r', '-q', '-X', path.join(tools, 'zip_cli.zip'), 'CVI data'], { cwd: src }); made.push('zip_cli.zip'); } catch (e) { /* zip missing */ }
    try { execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', 'CVI data', path.join(tools, 'ditto_finder.zip')], { cwd: src }); made.push('ditto_finder.zip'); } catch (e) { /* ditto missing */ }
    for (const f of made) {
      const r = await L.fromFileList([blobOf(fs.readFileSync(path.join(tools, f)), f)], 'files');
      const names = r.items.map(i => i.path.split(' › ')[1]).sort();
      check(names.join('|') === 'CVI data/cvi_master_wa39.csv|CVI data/facilities/cvi_master_small.csv', f + ': CSV files found', names);
      check(r.ignored.some(x => /ZIP inside a ZIP/.test(x.reason)) && r.ignored.some(x => /system file/.test(x.reason)), f + ': nested ZIP and system files skipped', r.ignored);
      const wa2 = r.items.find(i => i.name === 'cvi_master_wa39.csv'), sm2 = r.items.find(i => i.name === 'cvi_master_small.csv');
      check(same(await wa2.read(), wa) && same(await sm2.read(), small), f + ': contents round-trip');
    }
    check(made.length === 2, 'both macOS tools available', made);
  }

  // ---- Tier bundles, recognition and the checklist-matrix oracle -----------------------------------------------
  {
    const tiersDir = gen.writeTiers(), negDir = gen.writeNegative(); gen.writeSample();   // not writeAll(): keeps checkpoint/tools for the browser test
    const h = d => { const out = []; (function w(p) { for (const f of fs.readdirSync(p).sort()) { const q = path.join(p, f); if (fs.statSync(q).isDirectory()) w(q); else out.push(path.relative(d, q) + crypto.createHash('sha256').update(fs.readFileSync(q)).digest('hex')); } })(d); return out.join(); };
    const t1 = h(tiersDir) + h(negDir); gen.writeTiers(); gen.writeNegative();
    check(t1 === h(tiersDir) + h(negDir), 'tier and negative bundles are deterministic');
    // The tier ZIPs are published as demo samples; unzip tools must give readable files.
    for (const tier of ['full', 'partner', 'public']) {
      const zb = fs.readFileSync(path.join(tiersDir, tier + '.zip')), n = zb.readUInt16LE(zb.length - 12);
      let p = zb.readUInt32LE(zb.length - 6), ok = true;
      for (let i = 0; i < n; i++) {
        const dir = zb.toString('utf8', p + 46, p + 46 + zb.readUInt16LE(p + 28)).endsWith('/');
        ok = ok && zb[p + 5] === 0 && zb.readUInt32LE(p + 38) === (dir ? 0x10 : 0);
        p += 46 + zb.readUInt16LE(p + 28) + zb.readUInt16LE(p + 30) + zb.readUInt16LE(p + 32);
      }
      check(ok, tier + '.zip: entries made by MS-DOS (no Unix mode bits), folder attribute on folders');
      if (process.platform === 'darwin') {
        const x = path.join(gen.OUT, 'tier-extract'); fs.rmSync(x, { recursive: true, force: true });
        let got;
        try {
          execFileSync('unzip', ['-q', path.join(tiersDir, tier + '.zip'), '-d', x]);
          const files = []; (function w(q) { for (const f of fs.readdirSync(q)) { const r = path.join(q, f); if (fs.statSync(r).isDirectory()) w(r); else files.push(r); } })(x);
          got = files.length === fs.readdirSync(path.join(tiersDir, tier)).length
            && files.every(f => (fs.statSync(f).mode & 0o444) === 0o444 && same(fs.readFileSync(f), fs.readFileSync(path.join(tiersDir, tier, path.basename(f)))));
        } catch (e) { got = String(e.message).slice(0, 200); }
        try { execFileSync('chmod', ['-R', 'u+rwX', x]); } catch (e) { /* best effort */ }
        fs.rmSync(x, { recursive: true, force: true });
        check(got === true, tier + '.zip: unzip extracts readable files identical to the tier folder', got);
      }
    }
  }
  {   // Master variants keep the fixture's rows and cells exactly; only the chosen columns differ.
    const src = R.parseCsv(wa.toString('utf8'));
    const col = (rows, name) => { const i = rows[0].indexOf(name); return rows.slice(1).map(r => r[i]); };
    const tierMaster = (t, f) => R.parseCsv(fs.readFileSync(path.join(gen.OUT, 'tiers', t, f), 'utf8'));
    const full = tierMaster('full', 'CVI_Consolidated_Master.csv'), partner = tierMaster('partner', 'partner_county_totals.csv'), pub = tierMaster('public', 'CVI_Consolidated_Master.csv');
    check(full[0].length === 23 && partner[0].length === 13 && pub[0].length === 14, 'tier master column counts (23 / 13 / 14)', [full[0].length, partner[0].length, pub[0].length]);
    check(partner[0].join() === CVI.datasets[0].columns.slice().sort((a, b) => src[0].indexOf(a) - src[0].indexOf(b)).join(), 'Partner master = the 13 required columns');
    check(!pub[0].includes('CVI') && pub[0].includes('Species') && !pub[0].some(c => /City|^Origin\.Lat|entity/.test(c)), 'Public master: county-level columns + Species only', pub[0]);
    let same3 = true;
    for (const t of [full, partner, pub]) {
      if (t.length !== src.length) same3 = false;
      for (const c of t[0]) if (src[0].includes(c) && col(t, c).join('\u0001') !== col(src, c).join('\u0001')) same3 = false;
    }
    check(same3 && src.length === 1501, 'tier masters: same 1,500 rows and identical cells in shared columns');
  }
  {   // CSV header reading
    check(JSON.stringify(R.parseCsv('﻿"a,b","c""d",e\r\n1,2,3\r\n')) === JSON.stringify([['a,b', 'c"d', 'e'], ['1', '2', '3']]), 'parseCsv: BOM, quotes, CRLF');
    const big = 'Species.Group,X\n' + 'Cattle,1\n'.repeat(20000);
    const it = (await L.fromFileList([new File([big], 'big.csv')], 'files')).items[0];
    let full = 0; const t0 = it.text; it.text = async () => { full++; return t0(); };
    check((await R.readHeader(it)).join() === 'Species.Group,X' && full === 0, 'readHeader: large file read from its first bytes only');
    const wide = Array.from({ length: 9000 }, (_, i) => 'column_' + i).join(',') + '\n1\n';
    const it2 = (await L.fromFileList([new File([wide], 'wide.csv')], 'files')).items[0];
    check((await R.readHeader(it2)).length === 9000, 'readHeader: header longer than 64 KB read in full');
    check((await R.readHeader({ name: 'q.csv', size: 30, text: async () => '"Name","Lat"\n"x\ny",1\n' })).join() === 'Name,Lat', 'readHeader: quoted header');
  }
  {   // CVI manifest rules (map_helpers.R .read_overlay_manifest)
    const rows = R.parseCsv([' Key ,FILE,name_col,label,live_label,group,enabled',
      'markets,my_markets.csv,Market Name,Mkts,Livestock Mkts,,',
      'a,a.csv,NA,,,,TRUE', '#x,x.csv,,,,,', ',blank_key.csv,,,,,', 'b,,,,,,', 'c,c.csv,,,,,no', 'd,d.csv,,,,,F',
      'a,a2.csv,Nm,A two,,G,', 'master,m.csv,,,,,'].join('\n'));
    const e = CVI.expandManifest(rows);
    check(JSON.stringify(e.overrides.markets) === JSON.stringify({ file: 'my_markets.csv', nameColumn: 'Market Name', name: 'Livestock Mkts', group: 'Other' }), 'manifest: built-in key overrides that layer', e.overrides);
    check(e.added.length === 1 && e.added[0].id === 'a' && e.added[0].file === 'a2.csv' && e.added[0].name === 'A two' && e.added[0].group === 'G', 'manifest: skips blank/#/disabled rows, repeated key replaces', e.added);
    check(e.skipped.length === 1 && /reserved/.test(e.skipped[0].reason), 'manifest: reserved dataset id refused', e.skipped);
    check(CVI.expandManifest(R.parseCsv('name,file\nx,y.csv\n')).added.length === 0, 'manifest: no key column -> nothing added');
    const e2 = CVI.expandManifest(R.parseCsv('key,file\nz,z.csv\n'));
    check(e2.added[0].name === 'z' && e2.added[0].nameColumn === 'name' && e2.added[0].group === 'Other', 'manifest: defaults (label = key, name_col = name, group = Other)');
  }

  const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'synthetic', 'f1_checklist_matrix.json'), 'utf8'));
  function folderFiles(dir) {
    const out = [];
    (function w(p, rel) {
      for (const f of fs.readdirSync(p).sort()) {
        const q = path.join(p, f), r = rel + '/' + f;
        if (fs.statSync(q).isDirectory()) w(q, r);
        else { const file = new File([fs.readFileSync(q)], f); Object.defineProperty(file, 'webkitRelativePath', { value: r }); out.push(file); }
      }
    })(dir, path.basename(dir));
    return out;
  }
  const loadSource = src => {
    const p = path.join(gen.OUT, src);
    return src.endsWith('.zip') ? L.fromFileList([blobOf(fs.readFileSync(p), path.basename(p))], 'files') : L.fromFileList(folderFiles(p), 'folder');
  };
  const viewDataset = d => d.status === 'found' ? d.path.split(/\/| › /).pop() : d.status === 'conflict' ? { conflict: d.options.map(o => o.path.split(/\/| › /).pop()).sort() } : 'missing';
  const viewFile = f => f.status === 'used' || f.status === 'conflict' ? f.status + ':' + f.dataset : f.status === 'bundle' ? 'bundle' : 'not-used:' + f.reason;
  const fileOk = (exp, got) => exp.startsWith('not-used:') ? got.startsWith('not-used:') && got.includes(exp.slice(9)) : exp === got;
  let featureCases = 0;
  for (const [name, c] of Object.entries(matrix.cases)) {
    for (const src of c.source) {
      const tag = `matrix ${name} [${src}]`;
      const r = await loadSource(src);
      check(c.loadError ? r.errors.some(e => e.message.includes(c.loadError)) : r.errors.length === 0, tag + ': load errors', r.errors);
      const opts = {}, idOf = n => (r.items.find(i => i.name === n) || {}).id;
      const bundle = await B.read(r.items);          // the real bundle.json, read as the page reads it
      opts.files = B.filesFor(bundle, CVI);
      const expB = c.bundle || { banner: null, warnings: [] };
      check(bundle.banner === expB.banner, tag + ': bundle.json banner', bundle.banner);
      check(bundle.warnings.length === expB.warnings.length && expB.warnings.every((w, k) => bundle.warnings[k].includes(w)), tag + ': bundle.json warnings', bundle.warnings);
      if (c.options && c.options.assign) opts.assign = Object.fromEntries(Object.entries(c.options.assign).map(([k, v]) => [idOf(k), v]));
      if (c.options && c.options.choices) opts.choices = Object.fromEntries(Object.entries(c.options.choices).map(([k, v]) => [k, idOf(v)]));
      const res = await R.recognize(r.items, CVI, opts);
      const ids = res.datasets.map(d => d.id);
      check(Object.keys(c.datasets).every(id => ids.includes(id)), tag + ': expected datasets exist', ids);
      const badDs = res.datasets.filter(d => JSON.stringify(viewDataset(d)) !== JSON.stringify(c.datasets[d.id] === undefined ? 'missing' : c.datasets[d.id]));
      check(!badDs.length, tag + ': datasets found / missing / conflict', badDs.map(d => [d.id, viewDataset(d)]));
      const got = Object.fromEntries(res.files.map(f => [f.name, viewFile(f)]));
      // Compared as a list with repeats, so two files with one name cannot hide each other.
      check(res.files.map(f => f.name).sort().join('|') === Object.keys(c.files).sort().join('|'), tag + ': file list complete (each name once)', res.files.map(f => f.name));
      check(new Set(res.files.map(f => f.id)).size === res.files.length, tag + ': every file has its own id');
      const badF = Object.keys(c.files).filter(k => !(k in got) || !fileOk(c.files[k], got[k]));
      check(!badF.length, tag + ': each file used / not used with reason', badF.map(k => [k, got[k]]));
      if (c.via) { const badV = Object.entries(c.via).filter(([k, v]) => (res.files.find(f => f.name === k) || {}).via !== v); check(!badV.length, tag + ': recognized via', badV); }
      const expW = c.fileWarnings || {};
      const badW = res.files.filter(f => expW[f.name] ? !(f.warning || '').includes(expW[f.name]) : f.warning !== null);
      check(!badW.length, tag + ': warnings on files', badW.map(f => [f.name, f.warning]));
      if (c.missingUseful) for (const [id, exp] of Object.entries(c.missingUseful)) {
        const d = res.datasets.find(x => x.id === id);
        check(d && JSON.stringify(d.missingUseful.map(u => u.columns[0])) === JSON.stringify(exp), tag + ': missing optional columns of ' + id, d && d.missingUseful.map(u => u.columns[0]));
      }
      if (c.candidates) { const badC = Object.entries(c.candidates).filter(([k, v]) => JSON.stringify((res.files.find(f => f.name === k) || {}).candidates) !== JSON.stringify(v)); check(!badC.length, tag + ': picker candidates', badC); }
      check(res.files.every(f => (f.candidates !== null) === (f.status === 'not-used' && /choose/i.test(f.reason || ''))), tag + ': picker offered exactly for unclear files', res.files.filter(f => f.candidates));
      if (c.layers) { const badL = Object.entries(c.layers).filter(([k, e]) => JSON.stringify((res.files.find(f => f.name === k) || {}).layers) !== JSON.stringify(e)); check(!badL.length, tag + ': change-layer options', badL.map(([k]) => [k, (res.files.find(f => f.name === k) || {}).layers])); }
      check(res.files.every(f => !f.candidates || JSON.stringify(f.candidates) === JSON.stringify(f.layers)), tag + ': an unclear file\'s choices are its layers');
      if (c.manifestAdded) check(res.manifest && JSON.stringify(res.manifest.added) === JSON.stringify(c.manifestAdded), tag + ': manifest layers added', res.manifest);
      if (c.datasetNames) check(Object.entries(c.datasetNames).every(([id, n]) => (res.datasets.find(d => d.id === id) || {}).name === n), tag + ': manifest layer labels');
      check(JSON.stringify(res.needsChoice.map(n => n.dataset)) === JSON.stringify(Object.keys(c.datasets).filter(k => c.datasets[k] && c.datasets[k].conflict)), tag + ': choices requested');
      if (c.features) {
        featureCases++;
        const g = C.gate(res, CVI);
        // County Focus: its two features, listed here rather than in the matrix file:
        // the map needs the master only, as the WA map; the premises need the four coordinate columns, which of these
        // cases' masters only the Full tier's has.
        const focusPremises = { full: 'on', full_pick_overrides_name: 'on', duplicate_master: 'off:choose', wrong_file: 'off:CVI master table',
          corrupt_zip: 'off:CVI master table', empty_folder: 'off:CVI master table' }[name] || 'off:Origin.Lat';
        const features = Object.assign({}, c.features, { 'focus-map': c.features['wa-map'], 'focus-premises': focusPremises });
        check(g.map(f => f.id).join() === Object.keys(features).join(), tag + ': features listed', g.map(f => f.id));
        const badG = g.filter(f => { const e = features[f.id] || ''; return e === 'on' ? !f.on : !(e.startsWith('off:') && !f.on && f.reason.includes(e.slice(4))); });
        check(!badG.length, tag + ': features on / off with reason', badG);
        const html = C.panelHtml({ profile: CVI, load: r, bundle, result: res, features: g, assign: opts.assign || {}, choices: opts.choices || {}, pickable: {}, choosable: {} });
        check(g.every(f => html.includes(`data-feature="${f.id}" data-on="${f.on ? 1 : 0}"`)) && res.datasets.every(d => html.includes(`data-dataset="${d.id}" data-status="${d.status}"`)), tag + ': panel shows every dataset and feature with its status');
      }
    }
  }
  check(Object.values(matrix.cases).every(c => !(c.options && c.options.files)), 'oracle: no case uses the files stand-in any more (bundle.json is read)');
  check(featureCases === Object.values(matrix.cases).reduce((n, c) => n + c.source.length, 0), 'oracle: every matrix run carries feature expectations', featureCases);
  // ---- bundle.json (bundle.js) and the checklist panel (checklist.js) -------------------------------------------
  {
    const item = (text, p) => ({ path: p || 'bundle.json', name: (p || 'bundle.json').split('/').pop(), size: Buffer.byteLength(text), text: async () => text });
    const ok = await B.read([item(JSON.stringify({ profile: 'CVI', label: '  Partner\t–  county  ', prepared: '2026-09-15', coverage: { from: '2024-03-01', to: '2025-06-30' }, files: { feedlots: ' f.csv ' } }))]);
    check(ok.found && ok.info.profile === 'cvi' && ok.info.label === 'Partner – county' && ok.info.files.feedlots === 'f.csv' && ok.warnings.length === 0, 'bundle: fields read and tidied', ok);
    check(ok.banner === 'Partner – county · prepared 2026-09-15 · covers 2024-03-01 to 2025-06-30', 'bundle: banner with partial-year coverage', ok.banner);
    check(B.bannerText({ prepared: '2026-01-02', coverage: { from: '2025-01-01', to: '2025-12-31' } }) === 'Prepared 2026-01-02 · covers 2025' && B.bannerText({}) === null, 'bundle: banner without label; no banner without fields');
    const odd = B.parse({ profile: 'no spaces allowed', label: 5, prepared: '2026-02-30', coverage: { from: '2025-01-01', to: '2024-12-31' }, lable: 'x', files: { master: 5, '': 'a.csv' } });
    check(odd.warnings.length === 6 && /not understood.*lable/.test(odd.warnings[0]) && odd.info.prepared === null && odd.info.coverage === null && !Object.keys(odd.info.files).length, 'bundle: each bad field ignored with a warning', odd.warnings);
    check(B.parse([1, 2]).warnings.length === 1 && B.parse(null).warnings.length === 1, 'bundle: non-object JSON refused');
    const two = await B.read([item('{"label":"A"}', 'x/bundle.json'), item('{"label":"B"}', 'y/bundle.json')]);
    check(!two.found && /differ/.test(two.warnings[0]), 'bundle: two different bundle.json files -> none used', two.warnings);
    const same2 = await B.read([item('{"label":"A"}', 'x/bundle.json'), item('{"label":"A"}', 'y/Bundle.JSON')]);
    check(same2.found && same2.banner === 'A', 'bundle: identical copies (any case) are used');
    const big = await B.read([{ path: 'bundle.json', name: 'bundle.json', size: 70000, text: async () => { throw new Error('should not be read'); } }]);
    check(!big.found && /larger than 64 KB/.test(big.warnings[0]), 'bundle: over 64 KB not read', big.warnings);
    check(!(await B.read([item('{}', 'notes.json')])).found, 'bundle: only files named bundle.json are read');
    // "synthetic": true marks the sample bundles (their pictures and export_params.json say so); anything else is ignored.
    const syn = await B.read([item('{"label":"S","synthetic":true}')]), plain = await B.read([item('{"label":"S"}')]);
    const notTrue = await B.read([item('{"label":"S","synthetic":"yes"}')]);
    check(syn.info.synthetic === true && !syn.warnings.length && !plain.info.synthetic && !notTrue.info.synthetic
      && notTrue.warnings.some(w => /"synthetic" should be true or false/.test(w)), 'bundle: "synthetic" read only as true', [syn.info, notTrue.warnings]);
    const other = await B.read([item('{"profile":"emergency","files":{"master":"m.csv"}}')]);
    check(JSON.stringify(B.filesFor(other, CVI)) === '{}' && /emergency/.test(other.warnings[0]), 'bundle: another profile\'s files entries are not used', other.warnings);
    const none = await B.read([item('{"files":{"master":"m.csv"}}')]);
    check(B.filesFor(none, CVI).master === 'm.csv', 'bundle: entries used when no profile is named');
  }
  {   // Panel: user text is escaped; picker and chooser show their options and the user's current pick
    const evil = '<img src=x onerror=alert(1)>.csv';
    const f1 = new File(['name,lat,long\n'], evil), f2 = new File([syn('cvi_master_small.csv')], 'a.csv'), f3 = new File([syn('cvi_master_small.csv')], 'b.csv');
    const bj = new File([JSON.stringify({ label: '<b>x</b>' })], 'bundle.json');
    const r = await L.fromFileList([f1, f2, f3, bj], 'files');
    const bundle = await B.read(r.items), res = await R.recognize(r.items, CVI);
    const v = { profile: CVI, load: r, bundle, result: res, features: C.gate(res, CVI), assign: {}, choices: {}, gen: 1 };
    const html = C.panelHtml(v);
    check(!/<img|<b>/.test(html) && html.includes('&lt;img src=x onerror=alert(1)&gt;.csv'), 'panel: file names escaped');
    check(bundle.banner === '<b>x</b>', 'panel: banner keeps text as text (painted with textContent)');
    check(html.includes(`data-pick="${r.items[0].id}" data-gen="1" data-lazy="1"`) && JSON.stringify(C.layerOptions(res, r.items[0].id, {}).map(o => o.value)) === '["markets","feedlots","restricted"]',
      'panel: picker offers the candidate layers (filled in when opened)');
    check(html.includes('data-choose="master"') && html.includes(`<option value="${r.items[1].id}">`) && html.includes(`<option value="${r.items[2].id}">`), 'panel: chooser offers both files');
    check(/data-feature="wa-map" data-on="0"/.test(html) && /Choose which file is the CVI master table/.test(html), 'panel: conflict turns the feature off with the reason');
    v.assign = { [r.items[0].id]: 'feedlots' };
    v.result = await R.recognize(r.items, CVI, { assign: v.assign });
    check(new RegExp(`data-pick="${r.items[0].id}"[^]*?<option value="feedlots" selected>`).test(C.panelHtml(v)), 'panel: picker shows the user\'s pick');
  }
  // ---- Hostile archives, limits, header reading, file identity, load race ---------------------------------------
  {
    const hz = f => blobOf(fs.readFileSync(path.join(dir, 'hostile_' + f + '.zip')), f + '.zip');
    await throwsZip(async () => (await Z.open(hz('local_mismatch'))).entries[0].read(), /local header does not match/, 'hostile: local name differs from directory');
    await throwsZip(() => Z.open(hz('aliased')), /share the same data/, 'hostile: two entries share one payload');
    await throwsZip(() => Z.open(hz('truncated_name')), /directory entry 1 is incomplete/, 'hostile: name runs past the directory');
    await throwsZip(() => Z.open(hz('split_disk')), /spanned ZIP/, 'hostile: spanned archive refused');
    await throwsZip(() => Z.open(hz('outside_data')), /points outside the file data/, 'hostile: entry data overlaps the directory');
    { const r = await Z.open(hz('overstated_size')); check(r.entries.length === 0 && /declares more data/.test(r.ignored[0].reason), 'hostile: impossible declared size skipped before any allocation', r.ignored); }
    { const r = await Z.open(hz('duplicate_path')); check(r.entries.length === 1 && /appears twice/.test(r.ignored[0].reason) && Buffer.from(await r.entries[0].read()).toString().includes('1,2'), 'hostile: duplicate path keeps the first copy only', r.ignored); }
    check((await Z.open(hz('cp437_name'))).entries[0].path === 'é.csv', 'legacy (no UTF-8 flag) name decoded as code page 437');
    { const r = await Z.open(hz('bad_utf8_name')); check(r.entries.length === 0 && /not valid UTF-8/.test(r.ignored[0].reason), 'name flagged UTF-8 but invalid: skipped with reason', r.ignored); }
    // Memory grows with real output: inflating never asks for the declared size up front.
    const Old = Uint8Array; let biggest = 0;
    globalThis.Uint8Array = new Proxy(Old, { construct(t, a) { if (typeof a[0] === 'number') biggest = Math.max(biggest, a[0]); return Reflect.construct(t, a); } });
    try { await (await Z.open(cp('deflate.zip'))).entries[1].read(); } finally { globalThis.Uint8Array = Old; }
    check(biggest <= wa.length, 'inflate allocates no more than the real output', biggest);
  }
  {   // Header-only reading, also inside ZIPs
    const r = await L.fromFileList([cp('large_deflate.zip')], 'files'), it = r.items[0];
    let full = 0; const t0 = it.read; it.read = () => { full++; return t0(); }; it.text = async () => { full++; return ''; };
    const h = await R.readHeader(it);
    check(h[0] === 'CVI' && h.length === 15 && full === 0, 'ZIP entry header read without inflating the whole entry', [h.length, full]);
    const wideItem = (await L.fromFileList([new File([fs.readFileSync(path.join(gen.OUT, 'negative', 'wrong_file', 'wide_header.csv'))], 'w.csv')], 'files')).items[0];
    let fullW = 0; wideItem.text = async () => { fullW++; return ''; };
    try { await R.readHeader(wideItem); check(false, 'header over 1 MB refused'); } catch (e) { check(/longer than 1 MB/.test(e.message) && fullW === 0, 'header over 1 MB refused without a whole-file read', e.message); }
  }
  {   // Whole-selection limits: cap stops before sniffing; total bytes budget across files
    let sniff = 0; const old = Z.looksLikeZip; Z.looksLikeZip = async f => { sniff++; return old(f); };
    const r = await L.fromFileList(Array.from({ length: 1003 }, (_, i) => new File(['x'], 'f' + i + '.csv')), 'files');
    Z.looksLikeZip = old;
    check(r.items.length === 1000 && sniff === 1000 && r.errors.length === 1, 'file cap: files past the limit are not opened or sniffed', [r.items.length, sniff]);
    const fake = (n, size) => ({ name: n, size, slice: () => new Blob(['xxxx']), arrayBuffer: async () => new ArrayBuffer(0) });
    const r2 = await L.fromFileList([fake('a.csv', 512 * 1048576), fake('b.csv', 512 * 1048576), fake('c.csv', 1)], 'files');
    check(r2.items.length === 2 && /add up to more than/.test(r2.ignored[0].reason) && r2.errors.length === 1, 'selection budget: 1 GB in total across files', [r2.items.map(i => i.name), r2.errors]);
  }
  {   // Same file name in two subfolders: distinct ids, and the conflict choice picks the right one
    const r = await loadSource('negative/same_name');
    const res = await R.recognize(r.items, CVI);
    const opts = res.needsChoice[0] && res.needsChoice[0].options;
    check(opts && opts.length === 2 && opts[0].id !== opts[1].id, 'same name twice: two distinct choices', opts);
    const b = opts.find(o => /\/b\//.test(o.path));
    const res2 = await R.recognize(r.items, CVI, { choices: { master: b.id } });
    check(res2.datasets[0].path === b.path && res2.datasets[0].missingUseful.length === 4, 'same name twice: the chosen copy is used', res2.datasets[0].path);
  }
  {   // A master whose required column is written twice is not used (the CVI page refuses it); its reason says why
    const req = CVI.datasets[0].columns.filter(c => typeof c === 'string');
    const head = req.concat([req[0]]).join(',');
    const r = await L.fromFileList([new File([head + '\n' + req.map(() => '1').concat(['1']).join(',') + '\n'], 'CVI_Consolidated_Master.csv')], 'files');
    const res = await R.recognize(r.items, CVI), f = res.files[0];
    check(res.datasets[0].status === 'missing' && f.status === 'not-used' && f.reason === 'it is the CVI master table but has the column ' + req[0] + ' more than once; keep one copy of it',
      'repeated required column: the master is not used, with the reason', f.reason);
    const once = await L.fromFileList([new File([req.concat(['Extra', 'Extra']).join(',') + '\n'], 'CVI_Consolidated_Master.csv')], 'files');
    check((await R.recognize(once.items, CVI)).datasets[0].status === 'found', 'repeated other column: the master is still used');
  }
  {   // Manifest limits and file names with folders; R's leading-character rule for name columns
    const big = 'key,file\n' + Array.from({ length: 600 }, (_, i) => `k${i},f${i}.csv`).join('\n');
    const e = CVI.expandManifest(R.parseCsv(big));
    check(e.added.length === 500 && /more than 500/.test(e.skipped[0].reason), 'manifest: at most 500 layers', e.skipped);
    const man = new File(['key,file,name_col\nextra,sub/custom.csv,123 Name\n'], 'facility_overlays_manifest.csv');
    const lay = new File(['X123.Name,Lat,Long\n'], 'custom.csv'); Object.defineProperty(lay, 'webkitRelativePath', { value: 'data/sub/custom.csv' });
    Object.defineProperty(man, 'webkitRelativePath', { value: 'data/facility_overlays_manifest.csv' });
    const res = await R.recognize((await L.fromFileList([man, lay], 'folder')).items, CVI);
    check((res.datasets.find(d => d.id === 'extra') || {}).status === 'found', 'manifest file name with a folder is matched');
    const huge = { id: 'h', path: 'facility_overlays_manifest.csv', name: 'facility_overlays_manifest.csv', size: 2 * 1048576,
      head: async () => 'key,file\n', text: async () => { throw new Error('should not be read'); } };
    const res2 = await R.recognize([huge], CVI);
    check(res2.manifest && /larger than 1 MB/.test(res2.manifest.error), 'manifest over 1 MB is not read', res2.manifest);
  }
  // ---- Edge cases: built-in property names, competing files, load races, clearing, panel size ------------------
  {
    const item = (id, name, text) => ({ id, name, path: name, source: 'files', size: Buffer.byteLength(text), head: async () => text, text: async () => text });
    const load = items => ({ items, ignored: [], errors: [], sources: [] });
    const panel = () => { const c = { innerHTML: '' }; const banner = {}; return { c, banner, api: C.create({ container: c, banner, profile: CVI }) }; };
    const tick = () => new Promise(r => setImmediate(r));
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {   // keys named like built-in properties
      const p = panel(); let err = null;
      try { await p.api.show(load([item('m', 'facility_overlays_manifest.csv', `key,file\n${key},a.csv\n`), item('a', 'a.csv', 'name,lat,long\n')])); } catch (e) { err = e; }
      const d = p.api.state.result && p.api.state.result.datasets.find(x => x.id === key);
      check(!err && !p.api.state.busy && d && d.status === 'found' && /Additional facility layer/.test(p.c.innerHTML), 'manifest key "' + key + '" shown as a layer, panel finishes', [err && err.message, p.api.state.busy, d && d.status]);
    }
    {   // A choice for a layer whose key is "__proto__" is kept (a plain object would drop it silently)
      const p = panel();
      await p.api.show(load([item('m', 'facility_overlays_manifest.csv', 'key,file\n__proto__,a.csv\n'), item('a', 'a.csv', 'name,lat,long\n'), item('b', 'b.csv', 'name,lat,long\n')]));
      await p.api.assign('a', '__proto__'); await p.api.assign('b', '__proto__');
      const before = p.api.state.result.datasets.find(d => d.id === '__proto__').status;
      await p.api.choose('__proto__', 'b');
      const d = p.api.state.result.datasets.find(x => x.id === '__proto__');
      check(before === 'conflict' && d.status === 'found' && d.fileId === 'b', 'choice for a "__proto__" layer kept', [before, d.status, d.fileId]);
    }
    {   // The same in bundle.json "files"
      const b = await B.read([item('b', 'bundle.json', '{"files":{"__proto__":"a.csv","constructor":"b.csv"}}')]);
      const f = B.filesFor(b, CVI);
      check(Object.keys(f).sort().join() === '__proto__,constructor' && f.constructor === 'b.csv', 'bundle.json entries named like built-in properties kept as plain entries', Object.keys(f));
    }
    {   // Conflict options follow recognition (third file joins the choice)
      const p = panel();
      await p.api.show(load([item('a', 'wa_state_feedlots.csv', 'name,lat,long\n'), item('b', 'b.csv', 'name,lat,long\n'), item('c', 'c.csv', 'name,lat,long\n')]));
      await p.api.assign('b', 'feedlots'); await p.api.assign('a', 'feedlots'); await p.api.assign('c', 'feedlots');
      const sel = /<select data-choose="feedlots"[^]*?<\/select>/.exec(p.c.innerHTML);
      check(sel && ['a', 'b', 'c'].every(id => sel[0].includes(`value="${id}"`)), 'chooser offers every file now competing', sel && sel[0]);
      await p.api.choose('feedlots', 'c');
      const sel2 = /<select data-choose="feedlots"[^]*?<\/select>/.exec(p.c.innerHTML);
      check(sel2 && /value="c" selected/.test(sel2[0]) && ['a', 'b'].every(id => sel2[0].includes(`value="${id}"`)), 'after a choice the other files stay offered');
    }
    {   // Manifest re-choice refreshes a file's layers
      const p = panel();
      await p.api.show(load([item('m1', 'one.csv', 'key,file\nextra_one,one_layer.csv\n'), item('m2', 'two.csv', 'key,file\nextra_two,two_layer.csv\n'), item('f', 'facility.csv', 'name,lat,long\n')]));
      await p.api.choose('manifest', 'm1'); await p.api.choose('manifest', 'm2');
      const opts = C.layerOptions(p.api.state.result, 'f', p.api.state.assign).map(o => o.value);
      check(opts.includes('extra_two') && !opts.includes('extra_one'), 'layer options follow the chosen manifest', opts);
    }
    {   // A new load removes old controls at once, a pick from an old generation is refused, and a pick made
        // while bundle.json is still being read waits for it (banner and mapping survive)
      const p = panel();
      await p.api.show(load([item('f1', 'wa_state_feedlots.csv', 'name,lat,long\n')]));
      const oldGen = p.api.state.gen;
      let release; const bj = item('f2', 'bundle.json', ''); bj.text = () => new Promise(r => { release = r; });
      const next = p.api.show(load([item('f1', 'wa_state_public_livestock_markets.csv', 'name,lat,long\n'), bj]));
      await tick();
      check(!/<select/.test(p.c.innerHTML), 'previous dropdowns removed as soon as a new load starts');
      check(await p.api.assign('f1', 'restricted', oldGen) === false && !Object.keys(p.api.state.assign).length, 'a pick from the previous load is refused');
      const during = p.api.assign('f1', 'restricted');            // a pick in the new load before bundle.json is read
      release('{"label":"NEW","files":{"feedlots":"wa_state_public_livestock_markets.csv"}}');
      await next; await during;
      const f = p.api.state.result.files.find(x => x.id === 'f1');
      check(p.banner.textContent === 'NEW' && p.api.state.bundle && p.api.state.bundle.found && f.dataset === 'restricted' && f.via === 'your choice' && !p.api.state.busy,
        'bundle.json read in full despite an early pick; the pick still outranks it', [p.banner.textContent, f.dataset, f.via, p.api.state.busy]);
    }
    {   // Clearing while recognition is pending ends idle
      const p = panel(); let release; const slow = item('a', 'wa_state_feedlots.csv', 'name,lat,long\n'); slow.head = () => new Promise(r => { release = r; });
      const running = p.api.show(load([slow])); await tick(); await p.api.clear(); release('name,lat,long\n'); await running;
      check(p.api.state.busy === false && p.api.state.load === null && p.c.innerHTML === '', 'clear during recognition leaves the checklist idle and empty', [p.api.state.busy]);
    }
    {   // If drawing the panel fails, the checklist still ends idle and says so plainly
      let html = ''; const c = { get innerHTML() { return html; }, set innerHTML(v) { if (/<table/.test(v)) throw new Error('drawing failed'); html = v; } };
      const api = C.create({ container: c, profile: CVI }); let threw = null;
      try { await api.show(load([item('a', 'x.csv', 'a,b\n')])); } catch (e) { threw = e; }
      check(!threw && api.state.busy === false && api.state.version === 1 && /could not be checked: drawing failed/.test(html), 'a drawing failure ends idle with a plain message', [threw && threw.message, api.state.busy, html]);
    }
    {   // Header and manifest reads once per load; panel size bounded for many files x many layers
      let heads = 0, texts = 0;
      const it2 = (id, name, text) => ({ id, name, path: name, source: 'files', size: Buffer.byteLength(text), head: async () => { heads++; return text; }, text: async () => { texts++; return text; } });
      const rows = 'key,file\n' + Array.from({ length: 500 }, (_, i) => `extra${i},layer${i}.csv`).join('\n');
      const items = [it2('m', 'facility_overlays_manifest.csv', rows), ...Array.from({ length: 999 }, (_, i) => it2('f' + i, 'unknown' + i + '.csv', 'name,lat,long\n'))];
      const p = panel(); await p.api.show(load(items));
      const h1 = heads, bytes = Buffer.byteLength(p.c.innerHTML), options = (p.c.innerHTML.match(/<option/g) || []).length;
      const t0 = Date.now(); await p.api.assign('f0', 'feedlots'); const pickMs = Date.now() - t0;
      check(h1 === 1000 && heads === 1000 && texts === 1, 'headers and the manifest read once per load, not again on a pick', [h1, heads, texts]);
      check(bytes < 2 * 1048576 && options < 3000, '999 files x 500 layers -> panel under 2 MB and under 3,000 options', [bytes, options]);
      check(C.layerOptions(p.api.state.result, 'f1', p.api.state.assign).length === 503, 'every layer still offered when a dropdown is opened');
      console.log(`  panel sizes: ${(bytes / 1048576).toFixed(2)} MB, ${options} options, one pick ${pickMs} ms`);
    }
    {   // Identical bundle.json copies
      const r = await L.fromFileList([Object.defineProperty(new File(['{"label":"A"}'], 'bundle.json'), 'webkitRelativePath', { value: 'a/bundle.json' }),
        Object.defineProperty(new File(['{"label":"A"}'], 'bundle.json'), 'webkitRelativePath', { value: 'b/bundle.json' })], 'folder');
      const p = panel(); await p.api.show(r);
      check(/identical copy of a\/bundle\.json, which is used/i.test(p.c.innerHTML) && !/see the notes below/.test(p.c.innerHTML), 'second identical bundle.json labeled as a copy');
    }
  }
  {   // Landing page: an older, slower load finishing last must not replace a newer one
    const vm = require('vm'), nodes = new Map(), pending = [];
    const node = () => ({ textContent: '', innerHTML: '', className: '', hidden: false, classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(t, fn) { this[t] = fn; }, appendChild() {}, prepend() {}, setAttribute() {}, querySelector: () => node() });
    const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
    const win = { addEventListener() {}, WSDA: { load: { fromFileList: () => new Promise(res => pending.push(res)) } } };
    const ctx = vm.createContext({ window: win, document: { getElementById: get, addEventListener() {}, createElement: node, querySelectorAll: () => [] }, TextDecoder, TextEncoder });
    // shared/brand.js as well: the landing page's buttons take their icon and words through it.
    for (const f of ['shared/brand.js', 'shared/facility-datasets.js', 'shared/recognize.js', 'shared/bundle.js', 'shared/checklist.js', 'shared/sample.js', 'shared/guide.js', 'cvi/datasets.js', 'cvi/sample.js', 'infrastructure/datasets.js', 'infrastructure/sample.js', 'landing.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', f), 'utf8'), ctx);
    const result = p => ({ items: [{ id: 'f1', path: p, name: p, source: 'files', size: 9, text: async () => 'a,b\n1,2\n' }], ignored: [], errors: [], sources: [] });
    const tick = () => new Promise(r => setImmediate(r));
    get('files-input').change({ target: { files: [], value: '' } }); get('files-input').change({ target: { files: [], value: '' } });
    pending[1](result('new.csv')); for (let k = 0; k < 20; k++) await tick(); pending[0](result('old.csv')); for (let k = 0; k < 20; k++) await tick();
    check(win.WSDA.landing.state.result.items[0].path === 'new.csv' && /new\.csv/.test(get('load-results').innerHTML), 'landing: newest selection wins over a slower older one');

    // Routing by bundle.json "profile" and the next step after the checklist (pure functions of the landing page)
    const { nextStep, route, PROFILES } = win.WSDA.landing;
    check(PROFILES.map(p => p.id + ':' + p.available).join() === 'cvi:true,emergency:false,infrastructure:true', 'landing: CVI available, Emergency in preparation');
    const bj = profile => ({ found: true, info: { profile }, banner: null, warnings: [] });
    check(route(null).profile === null && route(null).note === null && route(bj(null)).note === null, 'route: no bundle.json or no profile: no note');
    check(route(bj('cvi')).profile.id === 'cvi' && route(bj('cvi')).note === null, 'route: profile "cvi" goes to CVI');
    check(route(bj('emergency')).profile.id === 'emergency' && /Emergency Response, which is in preparation\. Your files were checked against CVI Traceability\./.test(route(bj('emergency')).note), 'route: Emergency is in preparation', route(bj('emergency')));
    check(route(bj('foo')).profile === null && /"foo", which this site does not have/.test(route(bj('foo')).note), 'route: unknown profile reported', route(bj('foo')));
    const cvi = globalThis.WSDA.profiles.cvi, loadOf = n => ({ items: Array.from({ length: n }, (_, i) => ({ id: 'f' + i })) });
    const cl = (status, header, bundle) => {
      const result = { datasets: [{ id: 'master', name: 'CVI master table', status, header: header || [] }] };
      return { result, features: C.gate(result, cvi), bundle: bundle || null };
    };
    const req = cvi.datasets[0].columns;
    check(nextStep(null, cl('found', req)) === null && nextStep(loadOf(0), cl('missing')) === null && nextStep(loadOf(1), { result: null }) === null, 'next step: nothing loaded or not checked: no next step');
    const COORDS = ['Origin.Lat', 'Origin.Long', 'Dest.Lat', 'Dest.Long'];   // S5: County Focus premises
    let n = nextStep(loadOf(1), cl('found', req.concat(['Species', 'CVI'], COORDS)));
    check(n.kind === 'ok' && n.open === 'cvi' && n.text === 'Next: open the CVI map. Your files have what it needs.' && n.notes.length === 0, 'next step: master found: open the CVI map', n);
    n = nextStep(loadOf(1), cl('found', req));
    check(n.open === 'cvi' && n.notes.join() === 'Not available with these files: Refine by species (needs the column Species in the CVI master table); Unique CVIs in current view (needs the column CVI in the CVI master table); County Focus premises (needs the columns Origin.Lat, Origin.Long, Dest.Lat and Dest.Long in the CVI master table).', 'next step: features off are listed', n);
    n = nextStep(loadOf(2), cl('conflict', req));
    check(n.kind === 'warn' && n.open === null && n.text === 'Next: choose which file is the CVI master table in Datasets below. Then you can open the CVI map.', 'next step: conflict: choose first', n);
    n = nextStep(loadOf(1), cl('missing'));
    check(n.kind === 'warn' && n.open === null && n.text === 'The CVI map needs the CVI master table (CVI_Consolidated_Master.csv), and none of your files is it. Add that file, then choose all your files again, together.', 'next step: master missing: says what is missing', n);
    // A file that looks like the master but lacks a column is named in the headline with its reason.
    const nearCl = cl('missing');
    nearCl.result.files = [{ name: 'CVI_Consolidated_Master.csv', status: 'not-used',
      reason: 'it looks like the CVI master table but is missing the column Dest.County.Long' }];
    n = nextStep(loadOf(1), nearCl);
    check(n.kind === 'warn' && n.open === null && n.guide === true && n.text === 'The CVI map needs the CVI master table (CVI_Consolidated_Master.csv). CVI_Consolidated_Master.csv looks like the CVI master table but is missing the column Dest.County.Long. Ask for a copy with every column listed under "What data does this need?", then choose all your files again, together.', 'next step: a near-miss master is named with its reason', n);
    // A master with a required column written twice is named with what to fix (the CVI page refuses it).
    const twiceCl = cl('missing');
    twiceCl.result.files = [{ name: 'CVI_Consolidated_Master.csv', status: 'not-used',
      reason: 'it is the CVI master table but has the column Total.Animals more than once; keep one copy of it' }];
    n = nextStep(loadOf(1), twiceCl);
    check(n.kind === 'warn' && n.open === null && n.guide === false && n.text === 'The CVI map needs the CVI master table (CVI_Consolidated_Master.csv). CVI_Consolidated_Master.csv is the CVI master table but has the column Total.Animals more than once; keep one copy of it, then choose all your files again, together.', 'next step: a master with a repeated required column says to keep one copy', n);
    n = nextStep(loadOf(1), cl('found', req.concat(['Species']), bj('emergency')));
    check(n.open === 'cvi' && /in preparation/.test(n.notes[0]), 'next step: an Emergency bundle with a CVI master: note, and CVI can still be opened', n);
    // "What data does this need?" is linked whenever something is missing, not for a choice to make
    const g = (st, h) => nextStep(loadOf(st === 'conflict' ? 2 : 1), cl(st, h)).guide;
    check(g('missing') === true && g('found', req) === true && g('found', req.concat(['Species'])) === true && g('found', req.concat(['Species', 'CVI'])) === true
      && g('found', req.concat(['Species', 'CVI'], COORDS)) === false && g('conflict', req) === false,
      'next step: the guide is linked when the master or a feature\'s columns are missing, not when all is there or a choice is needed');

    // AB: a bundle.json listing several dashboards; each card's readiness (pure functions of the landing page)
    const { readiness } = win.WSDA.landing;
    const bl = profiles => ({ found: true, info: { profile: profiles[0], profiles }, banner: null, warnings: [] });
    let rt = route(bl(['emergency', 'infrastructure', 'cvi']));
    check(rt.profile.id === 'infrastructure' && rt.note === null && String(rt.listed) === 'emergency,infrastructure,cvi', 'AB route: the first available listed dashboard gets the checklist', rt);
    rt = route(bl(['foo', 'emergency']));
    check(rt.profile.id === 'emergency' && /Emergency Response, which is in preparation/.test(rt.note), 'AB route: only a dashboard in preparation is listed: noted', rt);
    rt = route(bl(['foo', 'bar']));
    check(rt.profile === null && /for "foo" and "bar", which this site does not have/.test(rt.note), 'AB route: unknown dashboards named in the note', rt);
    check(String(route(bj('cvi')).listed) === 'cvi' && route(null).listed === null, 'AB route: the older "profile" is a one-item list');
    const P = id => PROFILES.find(p => p.id === id), INF = P('infrastructure').list;
    const feat = (st, h) => cl(st, h).features;
    let rd = readiness(P('cvi'), feat('found', req.concat(['Species', 'CVI'], COORDS)), false);
    check(rd.kind === 'ready' && rd.open && rd.text === 'Ready.', 'AB readiness: every feature on: "Ready."', rd);
    rd = readiness(P('cvi'), feat('found', req.concat(['Species', 'CVI'])), false);
    check(rd.kind === 'partial' && rd.open && rd.text === 'Ready; off with these files: County Focus premises.', 'AB readiness: opens, with the features that are off', rd);
    rd = readiness(P('cvi'), feat('missing'), false);
    check(rd.kind === 'needs' && !rd.open && rd.text === 'Needs: the CVI master table (CVI_Consolidated_Master.csv).', 'AB readiness: the missing file named', rd);
    rd = readiness(P('cvi'), feat('conflict', req), true);
    const rd2 = readiness(P('cvi'), feat('conflict', req), false);
    check(rd.kind === 'choose' && !rd.open && rd.text === 'Choose a file in Datasets below.' && rd2.text === 'Choose a file first: click the button below to check.',
      'AB readiness: a choice to make, worded for the selected card and for another card', [rd, rd2]);
    rd = readiness(P('infrastructure'), C.gate({ datasets: [] }, INF), false);
    check(rd.kind === 'needs' && /^Needs: at least one recognized facility file/.test(rd.text), 'AB readiness: Infrastructure without a facility file', rd);
    // Two files claiming a dataset that switches no feature off (a facility layer) still ask for the choice
    const allOn = feat('found', req.concat(['Species', 'CVI'], COORDS)), pend = { needsChoice: [{ dataset: 'feedlots', name: 'Feedlots', options: [] }] };
    rd = readiness(P('cvi'), allOn, false, pend);
    const rdSel = readiness(P('cvi'), allOn, true, pend);
    check(rd.kind === 'choose' && !rd.open && rd.text === 'Choose a file first (the Feedlots): click the button below to check.'
      && rdSel.kind === 'choose' && rdSel.text === 'Choose a file in Datasets below for the Feedlots.' && readiness(P('cvi'), allOn, false, { needsChoice: [] }).kind === 'ready',
      'AB readiness: a choice on a facility layer: the other card checks first, the selected card says where', [rd, rdSel]);
    rt = route(bl(['foo', 'emergency']));
    check(/Emergency Response, which is in preparation, and for "foo", which this site does not have\. Your files were checked/.test(rt.note), 'AB route: unknown ids named beside a dashboard in preparation', rt);
  }

  {   // The hand-off protocol (load.js) with fake windows and channels, over file:// and http
    const vm = require('vm'), src = fs.readFileSync(path.join(ROOT, 'site', 'shared', 'load.js'), 'utf8');
    const flush = async () => { for (let k = 0; k < 10; k++) await new Promise(r => setImmediate(r)); };
    const port = () => ({ closed: false, onmessage: null, postMessage(d) { if (this.peer.onmessage) this.peer.onmessage({ data: d }); }, close() { this.closed = true; } });
    function channel() { const a = port(), b = port(); a.peer = b; b.peer = a; return { port1: a, port2: b }; }
    for (const protocol of ['file:', 'http:']) {
      const origin = protocol === 'file:' ? 'null' : 'http://127.0.0.1:8765', P = protocol.slice(0, -1) + ': ';
      // Landing side: open() and its answers
      const tab = { closed: false }, listeners = [];
      const lroot = { location: { protocol, origin, search: '' }, crypto: globalThis.crypto, addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
        open: (u, name) => { tab.url = u; tab.name = name; return tab; } };
      vm.runInNewContext(src, { window: lroot, TextDecoder });
      const H = lroot.WSDA.load.handoff, key = () => (/[?&]handoff=([0-9a-f]{32})$/.exec(tab.url) || [])[1];
      // A dashboard document asking for its files: returns what reaches it on its own channel end
      const ask = (data, o) => {
        const ch = channel(), got = []; ch.port1.onmessage = e => got.push(e.data);
        listeners.forEach(fn => fn({ data, source: (o && o.source) || tab, origin: (o && o.origin) || origin, ports: o && o.noPort ? [] : [ch.port2] }));
        return { got, port: ch.port1, ack: r => ch.port1.postMessage(Object.assign({ type: 'wsda-loaded' }, r)) };
      };
      const statuses = [];
      H.open('cvi', 'cvi/index.html', async () => ({ banner: 'B1', datasets: { master: { name: 'm.csv' } } }), s => statuses.push(s));
      const k1 = key();
      check(tab.name === 'wsda-cvi' && !!k1, P + 'hand-off: the tab is named wsda-cvi and its address carries a random key', tab.url);
      const tries = [ask({ type: 'wsda-ready', profile: 'cvi' }), ask({ type: 'wsda-ready', profile: 'cvi', key: 'f'.repeat(32) }),
        ask({ type: 'wsda-ready', profile: 'cvi', key: k1 }, { noPort: true }), ask({ type: 'wsda-ready', profile: 'cvi', key: k1 }, { source: {} }),
        ask({ type: 'wsda-ready', profile: 'cvi', key: k1 }, { origin: 'http://127.0.0.1:8766' })];
      await flush();
      check(tries.every(t => t.got.length === 0), P + 'no answer without the key (a later document in the tab), with a wrong key, without a channel, from another window or origin');
      let a = ask({ type: 'wsda-ready', profile: 'cvi', key: k1 }); await flush();
      check(a.got.length === 1 && a.got[0].type === 'wsda-files' && a.got[0].banner === 'B1' && a.got[0].datasets.master.name === 'm.csv', P + 'hand-off: the files go through the channel of the document that has the key', a.got);
      check(statuses.length === 0, P + 'nothing is reported before the dashboard says it has loaded the files', statuses);
      a.ack({ ok: true }); a.ack({ ok: false, message: 'bad rows' });
      check(statuses.map(s => s.state + ':' + s.message).join() === 'loaded:,load-failed:bad rows', P + 'the dashboard\'s report reaches the landing page (loaded / could not load)', statuses);
      const again = ask({ type: 'wsda-ready', profile: 'cvi', key: k1 }); await flush();
      check(again.got.length === 1 && again.got[0].banner === 'B1', P + 'hand-off: a reload (same address, same key) gets the same files again');
      // A newer click: the old key and the old channel no longer count; an older pending payload is not sent
      let release; statuses.length = 0;
      H.open('cvi', 'cvi/index.html', () => new Promise(r => { release = r; }), s => statuses.push(s));
      const k2 = key(), pend = ask({ type: 'wsda-ready', profile: 'cvi', key: k2 });
      H.open('cvi', 'cvi/index.html', async () => ({ banner: 'B3', datasets: {} }), s => statuses.push(s));
      const k3 = key(), old = ask({ type: 'wsda-ready', profile: 'cvi', key: k1 }), cur = ask({ type: 'wsda-ready', profile: 'cvi', key: k3 });
      await flush(); release({ banner: 'B2', datasets: {} }); await flush(); a.ack({ ok: true });
      check(k1 !== k2 && k2 !== k3 && old.got.length === 0 && pend.got.length === 0 && pend.port.peer.closed && cur.got.length === 1 && cur.got[0].banner === 'B3' && statuses.length === 0,
        P + 'hand-off: each click has a new key; older keys, pending payloads and reports are ignored', { old: old.got, pend: pend.got, cur: cur.got, statuses });
      // Files that cannot be read, and a click with nothing to send
      statuses.length = 0;
      H.open('cvi', 'cvi/index.html', async () => { throw new Error('"m.csv" failed its integrity check; the ZIP may be damaged.'); }, s => statuses.push(s));
      a = ask({ type: 'wsda-ready', profile: 'cvi', key: key() }); await flush();
      check(statuses.length === 1 && statuses[0].state === 'failed' && /integrity check/.test(statuses[0].message) && a.got.length === 1 && /integrity check/.test(a.got[0].error) && !a.got[0].datasets,
        P + 'a read failure is reported on the landing page and sent to the dashboard instead of files', { statuses, got: a.got });
      H.open('cvi', 'cvi/index.html', () => null);
      a = ask({ type: 'wsda-ready', profile: 'cvi', key: key() }); await flush();
      check(a.got.length === 0 && a.port.peer.closed, P + 'hand-off: nothing to send (card button without data): no answer, channel closed');
      H.open('cvi', 'cvi/index.html', () => ({ empty: true }));
      a = ask({ type: 'wsda-ready', profile: 'cvi', key: key() }); await flush();
      check(a.got.length === 1 && a.got[0].type === 'wsda-files' && a.got[0].empty === true && !a.got[0].datasets,
        P + 'hand-off: nothing loaded on the landing page: the dashboard is told at once', a.got);

      // Dashboard side: receive()
      const opener = { posted: [], postMessage(d, t, ports) { this.posted.push({ d, t, ports }); } };
      const dash = (search, op) => { const root = { location: { protocol, origin, search }, opener: op, MessageChannel: channel, addEventListener() {} };
        vm.runInNewContext(src, { window: root, TextDecoder }); return root.WSDA.load.handoff; };
      const kk = 'a1'.repeat(16), files = [];
      check(dash('?handoff=' + kk, null).receive('cvi', () => {}) === false && dash('', opener).receive('cvi', () => {}) === false && dash('?handoff=xyz', opener).receive('cvi', () => {}) === false && opener.posted.length === 0,
        P + 'receive: nothing asked without an opener or without a valid key (direct visit)');
      check(dash('?handoff=' + kk, opener).receive('cvi', (d, reply) => { files.push(d); reply({ ok: true }); }) === true, P + 'receive: asks when opened with a key');
      const r0 = opener.posted[0], back = r0 && r0.ports && r0.ports[0], acks = [];
      check(r0 && r0.d.type === 'wsda-ready' && r0.d.profile === 'cvi' && r0.d.key === kk && r0.t === (protocol === 'file:' ? '*' : origin) && !!back && Object.keys(r0.d).length === 3,
        P + 'receive: "wsda-ready" carries the key and a channel, no data; addressed to "*" over file://, the own origin over http', r0 && { d: r0.d, t: r0.t });
      back.onmessage = e => acks.push(e.data);
      back.postMessage({ type: 'wsda-files', profile: 'emergency', datasets: {} }); back.postMessage({ type: 'other', profile: 'cvi' });
      back.postMessage({ type: 'wsda-files', profile: 'cvi', banner: 'B', datasets: {} }); back.postMessage({ type: 'wsda-files', profile: 'cvi', banner: 'B2', datasets: {} });
      check(files.length === 1 && files[0].banner === 'B' && acks.length === 1 && acks[0].type === 'wsda-loaded' && acks[0].ok === true,
        P + 'receive: one files message for this profile is accepted and its load reported back', { files, acks });
    }
  }

  // ---- "What data does this need?" (guide.js) and the downloadable sample bundle (sample.js) ---------------------
  {
    const G = globalThis.WSDA.guide, SW = globalThis.WSDA.sample, SC = globalThis.WSDA.samples.cvi;
    // One generator: the committed WA fixture, the Full tier and the download all come from site/cvi/sample.js.
    check(same(SC.masterWa39(gen.LABELS), wa), 'sample: the site generator writes cvi_master_wa39.csv byte for byte');
    check(crypto.createHash('sha256').update(wa).digest('hex') === '8847a63960213a8d1840476dc4b5c8445455d91764576b71b9dddf8a19a8d13d', 'sample: WA fixture SHA-256 as expected');
    const z1 = gen.sampleZip(), z2 = gen.sampleZip(), zf = fs.readFileSync(path.join(gen.OUT, 'sample', SC.fileName));
    check(same(z1, z2) && same(z1, zf), 'sample: the ZIP is deterministic and equals the file written for the browser test');
    const { entries, ignored } = await Z.open(blobOf(z1, SC.fileName));
    const fullDir = path.join(gen.OUT, 'tiers', 'full'), fullNames = fs.readdirSync(fullDir).sort();
    check(ignored.length === 0 && entries.every(e => e.method === 0 && e.path.startsWith('CVI sample bundle (synthetic)/')), 'sample: stored entries in one folder, nothing skipped', ignored);
    check(entries.map(e => e.name).sort().join() === fullNames.join(), 'sample: the same file names as the Full tier', entries.map(e => e.name));
    let identical = 0;
    for (const e of entries) if (same(await e.read(), fs.readFileSync(path.join(fullDir, e.name)))) identical++;
    check(identical === fullNames.length && fullNames.length === 10, 'sample: every file byte-identical to the Full tier', { identical, of: fullNames.length });
    // ZIP writer: header fields readers and unzip tools rely on
    const tz = SW.zip([{ name: 'd', dir: true }, { name: 'd/é – ü.csv', data: 'a,b\n1,2\n' }, { name: 'empty.csv', data: new Uint8Array(0) }]);
    const tb = Buffer.from(tz), cen = tb.readUInt32LE(tb.length - 6);
    const t = await Z.open(blobOf(tb));
    check(t.entries.map(e => e.path).join('|') === 'd/é – ü.csv|empty.csv' && new TextDecoder().decode(await t.entries[0].read()) === 'a,b\n1,2\n' && (await t.entries[1].read()).length === 0,
      'zip writer: UTF-8 names, contents and an empty file round-trip; the folder entry is not a file', t.entries.map(e => e.path));
    check(tb.readUInt16LE(cen + 4) === 20 && tb.readUInt16LE(cen + 8) === 0x800 && tb.readUInt32LE(cen + 38) === 0x10 && tb.readUInt16LE(tb.length - 12) === 3,
      'zip writer: made by MS-DOS (no Unix permissions), UTF-8 flag, folder attribute, entry count');
    if (process.platform === 'darwin') {   // the system unzip and ditto (Archive Utility's engine) extract the sample
      // Extracted outside sample/; permissions restored before removal (an archive with Unix headers and no mode bits
      // makes unzip create folders nobody can open: the reason the writer marks entries as MS-DOS-made).
      const x = path.join(gen.OUT, 'sample-extract');
      const clean = () => { if (fs.existsSync(x)) { try { execFileSync('chmod', ['-R', 'u+rwX', x]); } catch (e) { /* best effort */ } fs.rmSync(x, { recursive: true, force: true }); } };
      clean(); fs.mkdirSync(x, { recursive: true });
      const zp = path.join(gen.OUT, 'sample', SC.fileName), got = {};
      try { execFileSync('unzip', ['-tq', zp]); got.unzipTest = true; } catch (e) { got.unzipTest = String(e.message).slice(0, 200); }
      for (const [tool, args] of [['unzip', ['-q', zp, '-d', path.join(x, 'unzip')]], ['ditto', ['-x', '-k', zp, path.join(x, 'ditto')]]]) {
        try {
          execFileSync(tool, args);
          const d = path.join(x, tool, 'CVI sample bundle (synthetic)');
          got[tool] = fullNames.every(f => same(fs.readFileSync(path.join(d, f)), fs.readFileSync(path.join(fullDir, f))) && (fs.statSync(path.join(d, f)).mode & 0o444) === 0o444);
        } catch (e) { got[tool] = String(e.message).slice(0, 200); }
      }
      check(got.unzipTest === true && got.unzip === true && got.ditto === true, 'sample: unzip -t passes; unzip and ditto extract readable files identical to the Full tier', got);
      clean();
    }

    // Guide model, generated from the CVI dataset list
    const m = G.model(CVI);
    check(m.datasets.map(d => d.id).join() === CVI.datasets.map(d => d.id).join() && m.datasets.every((d, i) => d.file === CVI.datasets[i].file && d.about === CVI.datasets[i].about && d.about),
      'guide: every dataset, in list order, with its recommended file name and description');
    check(m.datasets.filter(d => d.required).map(d => d.id).join() === 'master' && m.datasets[0].columns.join() === CVI.datasets[0].columns.join(), 'guide: master required, with its 13 columns');
    const mu = m.datasets[0].unlocks;
    check(mu[0] === 'WA State map' && mu[1] === 'Refine by species, with the "Species" column' && mu[2] === 'Summary boxes and strip'
      && mu[3] === 'Unique CVIs in current view, with the "CVI" column' && mu[4] === 'Spotlight Counties' && mu[5] === 'Browse over time and Compare two periods'
      && mu[6] === 'National Flow map'   // added by the same rule as S2a and S2b (master only)
      // County Focus: the map (master only), its premises (four coordinate columns), and what City, farm
      // ids and CVI add there (no longer "later version").
      && mu[7] === 'County Focus map' && mu[8] === 'County Focus premises, with the "Origin.Lat", "Origin.Long", "Dest.Lat" and "Dest.Long" columns'
      && mu.includes('Certificate numbers in the County Focus hover and CVI table, with the "CVI" column')
      && mu.includes('Place names of County Focus premises, with the "Origin.City" and "Dest.City" columns')
      && mu.includes('County Focus premises grouped by farm, with the "farm_entity_id_origin" and "farm_entity_id_dest" columns')
      && !mu.some(u => /later version/.test(u)) && mu.length === 12,
      'guide: what the master turns on, now and in later versions, with the columns needed', mu);
    const fac = m.datasets.filter(d => d.kind === 'facility');
    check(fac.length === 5 && fac.every(d => d.columns.length === 2 && /latitude/.test(d.columns[0]) && /longitude/.test(d.columns[1]) && !d.exact[0] && /file name says which layer/.test(d.note) && /County Focus.*Infrastructure/.test(d.unlocks[0])),
      'guide: facility layers: coordinates, identified by file name, used by County Focus and Infrastructure', fac.map(d => d.columns));
    check(m.datasets.find(d => d.id === 'manifest').columns.join() === 'key,file', 'guide: manifest columns');
    // The bundle.json example is valid: bundle.js reads it without a warning and names a real dataset.
    const ex = await B.read([{ id: 'b', name: 'bundle.json', path: 'bundle.json', size: 300, text: async () => JSON.stringify(m.bundleExample) }]);
    check(ex.found && ex.warnings.length === 0 && ex.info.profile === 'cvi' && Object.keys(ex.info.files).every(k => CVI.datasets.some(d => d.id === k)) && /prepared 2026-09-15/.test(ex.banner),
      'guide: the bundle.json example is read by bundle.js without warnings', ex);
    const hc = G.html(CVI, { sample: true });
    // The five facility layers share one row (same columns and uses),
    // listing each layer and its file; the part is a fold, closed until opened.
    const rowIds = (hc.match(/<tr data-guide-dataset="[^"]+"/g) || []).map(t => t.slice(24, -1));
    check(rowIds.join() === 'master,facility-layers,manifest' && /data-sample="cvi"/.test(hc) && !/data-sample=/.test(G.html(CVI, {})),
      'guide: one row per dataset, the facility layers in one row; the download button only with a sample', rowIds);
    const layerRow = (/<tr data-guide-dataset="facility-layers"[\s\S]*?<\/tr>/.exec(hc) || [''])[0];
    check(/data-guide-layers="slaughterhouses fairgrounds markets feedlots restricted"/.test(layerRow) &&
      CVI.datasets.filter(d => d.kind === 'facility').every(d => layerRow.indexOf(d.name + ': <code>' + d.file.replace(/_/g, '_<wbr>') + '</code>') >= 0) &&
      (hc.match(/file name says which layer/g) || []).length === 1 && /Facility layers \(5\)/.test(layerRow) && m.datasets[0].exact.every(Boolean),
    'guide: the facility row names each layer and its file, the facility note once; master columns are exact names', layerRow.slice(0, 300));
    check(/^<details class="guide-part" data-guide-part="cvi"><summary><h3 id="guide-cvi"/.test(hc) && !/<details class="guide-part"[^>]* open/.test(hc) &&
      /<\/details>$/.test(hc), 'guide: the CVI part in a fold, closed until opened');
    // Text is escaped even though it comes from the site's own list; a list without required data says so.
    const evil = { id: 'x"><img src=x onerror=alert(1)>', name: '<b>N</b>', features: [{ id: 'f', name: '<i>F</i>', needs: [{ dataset: 'd' }] }],
      datasets: [{ id: 'd<', name: '<script>1</script>', file: 'a<b>.csv', required: false, kind: 'table', columns: ['<c>', { label: '"q"&' }], about: '<svg onload=1>' }] };
    const he = G.html(evil, { sample: true });
    check(!/<(img|script|svg|b|i|c)[ >]/.test(he) && /&lt;script&gt;/.test(he) && /Every file is optional/.test(he), 'guide: every text escaped; no required dataset: "Every file is optional"', he.slice(0, 300));
  }

  // ---- AB: one all-in-one bundle for every dashboard ----------------------------------------------------------------
  {
    require(path.join(ROOT, 'site', 'infrastructure', 'datasets.js'));
    const INF = globalThis.WSDA.profiles.infrastructure, G = globalThis.WSDA.guide, SW = globalThis.WSDA.sample;
    const item = (text, p) => ({ path: p || 'bundle.json', name: (p || 'bundle.json').split('/').pop(), size: Buffer.byteLength(text), text: async () => text });
    const P = o => B.parse(o);

    // bundle.json "profiles"
    let r = P({ profiles: ['CVI', ' infrastructure ', 'cvi'] });
    check(String(r.info.profiles) === 'cvi,infrastructure' && r.info.profile === 'cvi' && r.warnings.length === 0, 'AB bundle: "profiles" read, lowercased, each once; "profile" is the first', r);
    r = P({ profiles: ['cvi', 'no spaces', 5, ''] });
    check(String(r.info.profiles) === 'cvi' && r.warnings.length === 1 && /not dashboard names were ignored: no spaces, 5, \(blank\)/.test(r.warnings[0]), 'AB bundle: entries that are not names reported', r.warnings);
    r = P({ profiles: [] });
    check(r.info.profiles === null && r.info.profile === null && /names no dashboard, so the files are checked for every dashboard/.test(r.warnings[0]), 'AB bundle: an empty list means every dashboard, with a note', r);
    r = P({ profiles: 'cvi' });
    check(r.info.profiles === null && /should be a list of dashboard names/.test(r.warnings[0]), 'AB bundle: "profiles" that is not a list is ignored', r.warnings);
    r = P({ profile: 'emergency', profiles: ['cvi', 'infrastructure'] });
    check(String(r.info.profiles) === 'cvi,infrastructure' && r.warnings.length === 1 && /both "profile" and "profiles" and they differ; "profiles" was used/.test(r.warnings[0]), 'AB bundle: "profile" and "profiles" disagree: "profiles" wins, with a warning', r);
    r = P({ profile: 'infrastructure', profiles: ['cvi', 'infrastructure'] });
    check(r.warnings.length === 0 && r.info.profile === 'cvi', 'AB bundle: "profile" inside "profiles": no warning');
    r = P({ profile: 'Infrastructure' });
    check(String(r.info.profiles) === 'infrastructure' && r.info.profile === 'infrastructure', 'AB bundle: the older "profile" alone is a one-item list');
    r = P({ profiles: Array.from({ length: 25 }, (_, i) => 'p' + i) });
    check((r.info.profiles || []).length === 20 && /more than 20 entries/.test(r.warnings[0]), 'AB bundle: at most 20 dashboards read', r.warnings);
    check(String(B.listed({ profile: 'cvi' })) === 'cvi' && String(B.listed({ profiles: ['a', 'b'] })) === 'a,b' && B.listed({ profile: null, profiles: [] }) === null && B.listed(null) === null,
      'AB bundle: listed() reads either field');

    // bundle.json "release": display only
    r = P({ label: 'A', prepared: '2026-09-15', coverage: { from: '2024-01-01', to: '2025-12-31' }, release: { name: ' Partner\tcounty totals ', version: 3, date: '2026-10-01' } });
    check(r.warnings.length === 0 && r.info.release.name === 'Partner county totals' && r.info.release.version === '3' && r.info.release.date === '2026-10-01', 'AB release: fields read and tidied (a number version becomes text)', r);
    check(B.bannerText(r.info) === 'A · prepared 2026-09-15 · covers 2024–2025 · release Partner county totals, version 3, 2026-10-01', 'AB release: shown at the end of the banner', B.bannerText(r.info));
    check(B.bannerText(P({ release: { version: '2' } }).info) === 'Release version 2' && B.bannerText(P({ release: { name: 'X', date: '2026-01-02' } }).info) === 'Release X, 2026-01-02',
      'AB release: alone, or with only some fields');
    r = P({ release: { name: 5, version: 'x'.repeat(41), date: '2026-02-30', level: 'internal' } });
    check(r.info.release === null && r.warnings.length === 4 && /not understood and ignored: level/.test(r.warnings[0]) && /"name" is blank or not text/.test(r.warnings[1])
      && /"version" is not a short text or number/.test(r.warnings[2]) && /"date" is not a date/.test(r.warnings[3]), 'AB release: each bad field reported; nothing usable means no release', r.warnings);
    check(P({ release: 'v3' }).info.release === null && /should list "name", "version" and "date"/.test(P({ release: [1] }).warnings[0]), 'AB release: not an object: ignored with a warning');
    check(P({ release: { name: '<b>R</b>' } }).info.release.name === '<b>R</b>', 'AB release: text kept as text by the parser');
    // An unusable "profiles" beside a valid "profile": the warning says the older field was used
    r = P({ profile: 'cvi', profiles: [] });
    check(String(r.info.profiles) === 'cvi' && r.warnings.length === 1 && r.warnings[0] === 'bundle.json "profiles" names no dashboard; "profile" ("cvi") was used',
      'AB bundle: an empty "profiles" with a valid "profile": that one is used, and the note says so', r.warnings);
    r = P({ profile: 'cvi', profiles: ['bad name'] });
    check(String(r.info.profiles) === 'cvi' && r.warnings.length === 2 && r.warnings[1] === 'bundle.json "profiles" names no dashboard; "profile" ("cvi") was used',
      'AB bundle: only bad names in "profiles" with a valid "profile": the same', r.warnings);
    r = P({ profile: 'cvi', profiles: 'cvi,infrastructure' });
    check(String(r.info.profiles) === 'cvi' && /should be a list of dashboard names in \[ \]; ignored; "profile" \("cvi"\) was used$/.test(r.warnings[0]),
      'AB bundle: "profiles" not a list, with a valid "profile": the same', r.warnings);
    // A long rejected entry is quoted cut short
    r = P({ profiles: ['x'.repeat(5000)], release: { name: 'R', ['k'.repeat(5000)]: 1 } });
    check(r.warnings.length === 3 && r.warnings.every(w => w.length < 300) && r.warnings.some(w => /x{59}…/.test(w)) && r.warnings.some(w => /k{59}…/.test(w)),
      'AB bundle: rejected entries quoted at most 60 characters', r.warnings.map(w => w.length));
    // The same for an unknown top-level entry and a "files" entry without a file name
    r = P({ ['u'.repeat(50000)]: 1, files: { ['f'.repeat(50000)]: '' } });
    check(r.warnings.length === 2 && r.warnings.every(w => w.length < 300) && r.warnings.some(w => /u{59}…/.test(w)) && r.warnings.some(w => /f{59}…/.test(w)),
      'AB bundle: unknown and nameless entries quoted at most 60 characters', r.warnings.map(w => w.length));
    // Marks that reorder text become spaces; an empty "release" is noted
    r = P({ label: 'A\u202EB\u2066C', release: { name: 'R\u200FS' } });
    check(r.info.label === 'A B C' && r.info.release.name === 'R S', 'AB bundle: right-to-left and isolate marks removed from the label and release', [r.info.label, r.info.release]);
    r = P({ release: {} });
    check(r.info.release === null && r.warnings[0] === 'bundle.json "release" gives no name, version or date; ignored', 'AB release: an empty "release" is noted', r.warnings);
    check(P({ release: { name: 'R' } }).info.files && Object.keys(P({ release: { name: 'R' } }).info).join() === 'profile,profiles,label,prepared,coverage,release,files',
      'AB release: changes nothing else in the bundle description');

    // "files" entries and the listed dashboards
    const two = await B.read([item('{"profiles":["cvi","infrastructure"],"files":{"feedlots":"f.csv","master":"m.csv"}}')]);
    check(B.filesFor(two, CVI).master === 'm.csv' && B.filesFor(two, INF).feedlots === 'f.csv' && two.warnings.length === 0, 'AB files: used for every listed dashboard');
    const em = await B.read([item('{"profiles":["cvi","emergency"],"files":{"feedlots":"f.csv","master":"m.csv","other":"o.csv"}}')]);
    check(JSON.stringify(B.filesFor(em, INF)) === '{}' && /for the "cvi", "emergency" dashboards, so its "files" entries were not used for Infrastructure/.test(em.warnings[0]), 'AB files: an unlisted dashboard gets none, with a warning', em.warnings);
    const shared = B.filesFor(em, INF, { reuseShared: true, datasets: INF.datasets });
    check(Object.keys(shared).sort().join() === 'feedlots,master', 'AB files: switching to an unlisted dashboard reuses only the shared entries', shared);

    // The all-in-one sample: one generator, the Full tier's bytes, two folders
    const all = gen.allInOne(), z1 = gen.allInOneZip(), z2 = gen.allInOneZip();
    const zf = fs.readFileSync(path.join(gen.OUT, 'sample', all.fileName));
    check(all.fileName === 'WSDA_sample_all_dashboards_synthetic.zip' && same(z1, z2) && same(z1, zf), 'AB sample: deterministic, and equal to the file written for the browser test');
    check(JSON.parse(all.bundleJson).synthetic === true, 'AB sample: its bundle.json marks it synthetic (said on its pictures)');
    const opened = await Z.open(blobOf(z1, all.fileName));
    const fullDir = path.join(gen.OUT, 'tiers', 'full');
    const csvs = opened.entries.filter(e => e.name !== 'bundle.json');
    let identical = 0;
    for (const e of csvs) if (same(await e.read(), fs.readFileSync(path.join(fullDir, e.name)))) identical++;
    check(opened.ignored.length === 0 && opened.entries.length === 10 && identical === 9 && csvs.length === 9, 'AB sample: nine data files, each byte-identical to the Full tier\'s, and a bundle.json', { identical, n: opened.entries.length });
    check(opened.entries.filter(e => /\/cvi\//.test(e.path)).map(e => e.name).join() === 'CVI_Consolidated_Master.csv'
      && opened.entries.filter(e => /\/facilities\//.test(e.path)).length === 8
      && opened.entries.every(e => e.path.startsWith('WSDA_sample_all_dashboards_synthetic/')), 'AB sample: the master in cvi/, the eight facility files in facilities/', opened.entries.map(e => e.path));
    const ab = await B.read(opened.entries.filter(e => e.name === 'bundle.json').map(e => ({ path: e.path, name: e.name, size: e.size, text: async () => new TextDecoder().decode(await e.read()) })));
    check(ab.found && ab.warnings.length === 0 && String(ab.info.profiles) === 'cvi,infrastructure'
      && ab.banner === 'All dashboards – synthetic sample bundle · prepared 2026-09-15 · covers 2024–2025 · release Synthetic sample, version 1, 2026-09-15',
      'AB sample: its bundle.json lists both dashboards and a release, with no warning', ab);
    check(fs.readFileSync(path.join(fullDir, 'bundle.json'), 'utf8').includes('"profile": "cvi"') && !fs.readFileSync(path.join(fullDir, 'bundle.json'), 'utf8').includes('profiles'),
      'AB sample: the Full tier\'s own bundle.json is unchanged');

    // checkFor: another dashboard's readiness, exactly as switching to it gives
    const loadAll = await L.fromFileList([new File([z1], all.fileName)], 'files');
    const panelOf = () => C.create({ container: { innerHTML: '' }, profile: CVI });
    const api = panelOf();
    await api.show(loadAll);
    const cviOn = api.state.features.every(f => f.on);
    const viaCheck = await api.checkFor(INF);
    const viaSwitch = panelOf(); await viaSwitch.show(loadAll); await viaSwitch.setProfile(INF, { reuseShared: true });
    const view = res => JSON.stringify(res.datasets.map(d => [d.id, d.status, d.fileId || null]));
    check(cviOn && viaCheck && view(viaCheck.result) === view(viaSwitch.state.result) && JSON.stringify(viaCheck.features) === JSON.stringify(viaSwitch.state.features),
      'AB checkFor: the all-in-one sample: CVI fully on, and Infrastructure as switching to it gives', [cviOn, viaCheck && viaCheck.features]);
    check(!!viaCheck && viaCheck.features.find(f => f.id === 'facility-files').on && api.state.profile === CVI && !!api.state.result,
      'AB checkFor: Infrastructure ready; the panel stays on CVI', viaCheck && viaCheck.features);
    // A pick made while checkFor runs makes its answer stale (null), so an older answer cannot open a dashboard.
    const pending = api.checkFor(INF);
    await api.assign(loadAll.items[1].id, 'feedlots');
    check(await pending === null, 'AB checkFor: a newer pick makes a running check return nothing');
    const busy = panelOf(); const showing = busy.show(loadAll);
    check(await busy.checkFor(INF) === null, 'AB checkFor: nothing while the files are first checked'); await showing;
    // While a pick is checked, the earlier result still exists: the busy guard returns at once, before any work (it
    // never reads the other dashboard's list), and the checks at the end would refuse the answer anyway
    const assigning = busy.assign(loadAll.items[1].id, 'feedlots');
    const midway = busy.state.busy && !!busy.state.result;
    let touched = false;
    const watched = Object.create(INF, { datasets: { get() { touched = true; return INF.datasets; } } });
    check(midway && await busy.checkFor(watched) === null && !touched, 'AB checkFor: nothing, and no work, while a pick is checked, although the earlier result exists', [midway, touched]); await assigning;
    // The banner, release included, is painted as text: a banner element that refuses HTML
    const bannerEl = { hidden: true, textContent: '', set innerHTML(v) { throw new Error('the banner was painted as HTML'); } };
    const relLoad = await L.fromFileList([new File([JSON.stringify({ label: '<b>L</b>', release: { name: '<i>R</i>' } })], 'bundle.json')], 'files');
    const relApi = C.create({ container: { innerHTML: '' }, banner: bannerEl, profile: CVI });
    await relApi.show(relLoad);
    check(bannerEl.textContent === '<b>L</b> · release <i>R</i>' && !bannerEl.hidden, 'AB release: the banner is painted as text', bannerEl.textContent);
    // The user's picks carry over, as on a switch: a facility file picked as another layer stays that layer.
    const pickApi = panelOf(); await pickApi.show(loadAll);
    const feedFile = pickApi.state.result.files.find(f => f.dataset === 'feedlots');
    await pickApi.assign(feedFile.id, 'fairgrounds');
    const picked = await pickApi.checkFor(INF);
    check(!!picked && picked.result.files.find(f => f.id === feedFile.id).dataset === 'fairgrounds', 'AB checkFor: the user\'s picks are used for the other dashboard', picked && picked.result.files.find(f => f.id === feedFile.id));

    // A bundle for CVI only that names a facility file: the other dashboard reuses that shared mapping, as a switch does
    const odd = await L.fromFileList([new File(['name,lat,long\nSynthetic Feedlot,47.25,-122.35\n'], 'odd.csv'),
      new File(['{ "profile": "cvi", "files": { "feedlots": "odd.csv" } }'], 'bundle.json')], 'files');
    const oddApi = panelOf(); await oddApi.show(odd);
    const oddCheck = await oddApi.checkFor(INF);
    const oddSwitch = panelOf(); await oddSwitch.show(odd); await oddSwitch.setProfile(INF, { reuseShared: true });
    const oddFile = res => res.files.find(f => f.path === 'odd.csv');
    check(!!oddCheck && oddFile(oddCheck.result).dataset === 'feedlots' && oddFile(oddCheck.result).via === 'bundle.json' && view(oddCheck.result) === view(oddSwitch.state.result),
      'AB checkFor: a CVI bundle\'s facility mapping is reused for Infrastructure, as a switch reuses it', oddCheck && oddFile(oddCheck.result));

    // The guide's all-in-one part
    const hg = G.allInOneHtml();
    check(/<h3 id="guide-all"[^>]*>One bundle for every dashboard<\/h3>/.test(hg) && /data-guide-curator/.test(hg) &&
      /^<details class="guide-part" data-guide-part="all">/.test(hg) && /data-sample="all"/.test(G.sampleHtml()),
    'AB guide: the part in a fold with the curator\'s details; the one sample button');
    const curator = (/<details class="guide-bundle" data-guide-curator>[\s\S]*?<\/details>/.exec(hg) || [''])[0];
    check(/<p class="guide-safety"><strong>This viewer does not make a bundle safe to share<\/strong> \(see "For people preparing bundles" below\)\.<\/p>/.test(hg)
      && /prepared outside the viewer, under the release-profile rules/.test(curator) && /labels, not protection/.test(curator) &&
      /Partner Data Viewer/.test(curator), 'AB guide: the safety note one line, its full text and the Partner Data Viewer line in the curators\' fold');
    check(/cvi\/[\s\S]*CVI_Consolidated_Master\.csv[\s\S]*facilities\/[\s\S]*emergency\//.test(hg) && /Do not put a ZIP inside the ZIP/.test(hg), 'AB guide: the folder layout and its points');
    const ex = await B.read([item(JSON.stringify(G.ALL_EXAMPLE))]);
    check(ex.found && ex.warnings.length === 0 && String(ex.info.profiles) === 'cvi,infrastructure' && /release Example, version 1, 2026-10-13$/.test(ex.banner),
      'AB guide: its bundle.json example reads without a warning', ex);
    const gc = { innerHTML: '', addEventListener() {} };
    G.create({ container: gc, profiles: [{ id: 'cvi', name: 'CVI', list: CVI, sample: { build: async () => null } }], allInOne: { build: async () => null } });
    check(gc.innerHTML.indexOf('id="guide-all"') > 0 && gc.innerHTML.indexOf('id="guide-all"') < gc.innerHTML.indexOf('id="guide-cvi"'), 'AB guide: the part comes first in the section');
    check((gc.innerHTML.match(/data-sample="/g) || []).length === 1 && /data-sample="all"/.test(gc.innerHTML) &&
      gc.innerHTML.indexOf('data-sample="all"') < gc.innerHTML.indexOf('id="guide-all"'), 'guide: one sample button, the all-in-one, at the top of the section');
    const gn = { innerHTML: '', addEventListener() {} };
    G.create({ container: gn, profiles: [{ id: 'cvi', name: 'CVI', list: CVI }] });
    check(!/guide-all/.test(gn.innerHTML), 'AB guide: without an all-in-one sample, no part');
  }

  console.log(`  ${featureCases} matrix runs checked for feature gating`);

  // The synthetic tables collected in one folder (test-tables/), read by the suites and handy for trying the pages by
  // hand, refreshed from the tiers written above. A rebuild keeps files it does not make: a stand-in for a person's
  // own copy must survive it.
  const tables = require('../synthetic/make_test_tables.js');
  fs.mkdirSync(tables.OUT, { recursive: true });
  const ownerCopy = path.join(tables.OUT, 'owner_copy_check.csv');
  fs.writeFileSync(ownerCopy, 'name\nkept\n');
  tables.make();
  check(fs.existsSync(ownerCopy) && fs.readFileSync(ownerCopy, 'utf8') === 'name\nkept\n', 'test-tables/: a file the rebuild does not make is kept');
  fs.rmSync(ownerCopy, { force: true });
  check(fs.existsSync(path.join(tables.OUT, 'infrastructure_synthetic.zip'))
    && fs.readdirSync(path.join(tables.OUT, 'infrastructure_synthetic')).length === 8,
    'test-tables/: the Infrastructure sample ZIP and its eight unzipped files are written');
  const allDir = path.join(tables.OUT, 'WSDA_sample_all_dashboards_synthetic');
  check(fs.existsSync(path.join(tables.OUT, 'WSDA_sample_all_dashboards_synthetic.zip')) && fs.readdirSync(path.join(allDir, 'facilities')).length === 8
    && fs.existsSync(path.join(allDir, 'cvi', 'CVI_Consolidated_Master.csv')) && fs.existsSync(path.join(allDir, 'bundle.json')),
    'test-tables/: the all-in-one sample ZIP and its folder (cvi/, facilities/, bundle.json) are written');
  console.log('  test-tables/ refreshed');

  console.log(`F1 unit tests: ${pass} passed, ${fail} failed`);
  failures.forEach(f => console.log('  FAIL ' + f));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
