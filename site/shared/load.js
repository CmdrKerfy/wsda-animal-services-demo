/* Shared file intake (F1). Turns whatever the user supplied (a multi-file selection, a folder selection, or a
 * drag-and-drop of files/folders) into one flat list of candidate files, expanding any ZIP bundles with
 * WSDA.zip. Nothing leaves the browser: files are read with the File/Blob API only. Recognition of which
 * dataset each file is happens later (recognize.js); this layer only collects, skips system clutter and
 * reports problems in plain language.
 *
 * Result: { items, ignored, errors, sources }
 *   items:   [{ id, path, name, size, source, read() -> Promise<Uint8Array>, text() -> Promise<string>,
 *              head(n) -> Promise<string> (first n bytes only) }]
 *            id is unique within one result (paths can repeat, e.g. the same name in two archives).
 *            source is 'files', 'folder', 'drop' or 'zip' (with zip: the archive name).
 *   ignored: [{ path, reason }]   system files, nested archives, unsupported or oversize entries
 *   errors:  [{ path, message }]  archives that could not be opened at all */
(function (root) {
  'use strict';
  const Z = () => root.WSDA.zip;
  // Whole-selection limits (each ZIP also has its own limits in zip.js).
  const LIMITS = { maxItems: 1000, maxFileBytes: 512 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024 };
  const decoder = new TextDecoder('utf-8');        // strips a UTF-8 BOM
  const isZipName = n => /\.zip$/i.test(n);
  // Office documents are ZIP files inside; they are listed as files (recognition explains them), never unpacked.
  const isOfficeName = n => /\.(xlsx|xlsm|xltx|docx|pptx|ods|odt|odp)$/i.test(n);
  const mb = n => (n / (1024 * 1024)).toFixed(0) + ' MB';

  // A list item for a plain file, read through the File API.
  function fileItem(file, path, source) {
    return {
      path, name: file.name, size: file.size, source,
      async read() { return new Uint8Array(await file.arrayBuffer()); },
      async text() { return decoder.decode(await file.arrayBuffer()); },
      async head(n) { return decoder.decode(await file.slice(0, n).arrayBuffer()); }   // first n bytes (header rows)
    };
  }

  // Add one supplied file to the list: system files skipped, a ZIP expanded into its entries, an oversize file
  // ignored.
  async function addFile(acc, file, path, source) {
    if (full(acc, path)) return;                       // nothing more is opened or sniffed once the cap is reached
    const sys = Z().systemFileReason(path);
    if (sys) { acc.ignored.push({ path, reason: sys }); return; }
    if (isZipName(file.name) || (!isOfficeName(file.name) && await Z().looksLikeZip(file))) {
      let listing;
      try { listing = await Z().open(file, { label: '"' + path + '"' }); }
      catch (e) { acc.errors.push({ path, message: e.message }); return; }
      acc.sources.push({ kind: 'zip', path, files: listing.entries.length });
      listing.ignored.forEach(x => acc.ignored.push({ path: path + ' › ' + x.path, reason: x.reason }));
      for (const en of listing.entries) {
        const inner = path + ' › ' + en.path;
        if (isZipName(en.name)) {
          acc.ignored.push({ path: inner, reason: 'a ZIP inside a ZIP is not opened; unzip it first' }); continue;
        }
        push(acc, {
          path: inner, name: en.name, size: en.size, source: 'zip', archive: path,
          read: () => en.read(), async text() { return decoder.decode(await en.read()); },
          async head(n) { return decoder.decode(await en.head(n)); }
        });
      }
      return;
    }
    if (file.size > LIMITS.maxFileBytes) {
      acc.ignored.push({ path, reason: `${mb(file.size)}; the per-file limit is ${mb(LIMITS.maxFileBytes)}` }); return;
    }
    push(acc, fileItem(file, path, source));
  }

  // True once the file cap is reached; the first time, an error says the rest were not read.
  function full(acc, path) {
    if (acc.items.length < LIMITS.maxItems) return false;
    if (!acc.capped) {
      acc.capped = true;
      acc.errors.push({ path, message: `More than ${LIMITS.maxItems} files were supplied; the rest were not read.` });
    }
    return true;
  }

  // Add an item within the total size budget, giving it its ID.
  function push(acc, item) {
    if (full(acc, item.path)) return;
    if (acc.bytes + item.size > LIMITS.maxTotalBytes) {
      acc.ignored.push({ path: item.path,
        reason: `the files supplied add up to more than ${mb(LIMITS.maxTotalBytes)}; this one was not read` });
      if (!acc.overBudget) {
        acc.overBudget = true;
        acc.errors.push({ path: item.path,
          message: `The files supplied add up to more than ${mb(LIMITS.maxTotalBytes)}; some were not read.` });
      }
      return;
    }
    acc.bytes += item.size;
    item.id = 'f' + (++acc.seq);
    acc.items.push(item);
  }

  const newAcc = () => ({ items: [], ignored: [], errors: [], sources: [], bytes: 0, seq: 0 });

  /** From an <input type="file" multiple> or <input type="file" webkitdirectory> FileList. */
  async function fromFileList(fileList, source) {
    const acc = newAcc(), files = Array.from(fileList || []);
    if (source === 'folder') acc.sources.push({ kind: 'folder', path: folderName(files), files: files.length });
    for (const f of files) await addFile(acc, f, f.webkitRelativePath || f.name, source || 'files');
    return finish(acc);
  }

  // The selected folder's name, from the first file's relative path.
  function folderName(files) {
    const p = files.length && files[0].webkitRelativePath;
    return p ? p.split('/')[0] : '(empty folder)';
  }

  /** From a drop event's DataTransfer: files and whole folders (read recursively). */
  async function fromDataTransfer(dt) {
    const acc = newAcc();
    // Everything must be taken synchronously, before the first await, or the browser clears the DataTransfer.
    // Top-level files use getAsFile() directly; only folders need the (older) entry API to be walked.
    const dropped = Array.from(dt.items || []).filter(i => i.kind === 'file')
      .map(i => ({ entry: i.webkitGetAsEntry ? i.webkitGetAsEntry() : null, file: i.getAsFile() }));
    for (const d of dropped) {
      if (d.entry && d.entry.isDirectory) {
        acc.sources.push({ kind: 'folder', path: d.entry.name }); await walk(acc, d.entry, '');
      }
      else if (d.file) await addFile(acc, d.file, d.file.name, 'drop');
    }
    return finish(acc);
  }

  const FOLDER_DROP_FAILED = 'This folder could not be read after dropping it. Use "Choose a folder" instead.';
  // Add a dropped folder's files, reading its subfolders in turn.
  async function walk(acc, entry, prefix) {
    const path = prefix + entry.name;
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
      if (file) await addFile(acc, file, path, 'drop');
      else acc.errors.push({ path, message: `"${path}" could not be read. Use "Choose a folder" instead.` });
      return;
    }
    const sys = Z().systemFileReason(path + '/');
    if (sys) { acc.ignored.push({ path, reason: sys }); return; }
    const reader = entry.createReader();
    for (;;) {                                         // readEntries returns batches until an empty one
      if (acc.capped) return;
      let batch;
      try { batch = await new Promise((res, rej) => reader.readEntries(res, rej)); }
      catch (e) { acc.errors.push({ path, message: FOLDER_DROP_FAILED }); return; }
      if (!batch.length) break;
      for (const child of batch) await walk(acc, child, path + '/');
    }
  }

  // The finished result: the folder's file count filled in, the bookkeeping fields removed.
  function finish(acc) {
    const s = acc.sources.find(x => x.kind === 'folder');
    if (s && s.files === undefined) s.files = acc.items.filter(i => i.path.startsWith(s.path + '/')).length;
    delete acc.capped; delete acc.overBudget; delete acc.bytes; delete acc.seq;
    return acc;
  }

  /* Hand-off between tabs (each dashboard in its own tab, reused on the next click). The landing page opens a profile's
   * page in a tab named "wsda-<profile>" and passes the files it found to it in memory; nothing is written to disk or
   * sent anywhere else.
   * Each click makes a new random key and puts it in the page's address ("?handoff=<key>"). The profile page reads it,
   * opens a private channel (MessageChannel) and sends the landing page "wsda-ready" with the key and one end of the
   * channel (no data). The landing page answers only the tab it opened, only for the latest click's key, and only
   * through that channel, so the files reach the document that asked and no other. A reload keeps the address and
   * asks again (same files); a document that later replaces the profile page in that tab does not have the key and
   * gets nothing. The profile page reports on the channel when the files are loaded, or why not, and the
   * landing page reports files it could not read. Both pages say "no-referrer", so the key does not leave
   * in a Referer header.
   * Over http(s) "wsda-ready" is addressed to the page's own origin and checked against it. Pages of one origin can
   * read each other directly anyway (the browser's same-origin rule), so a hosted copy should not share its origin
   * with unrelated pages. Over file:// Chrome reports every page's origin as "null", so "wsda-ready" is addressed to
   * "*"; the key, the window identity and the channel are then the checks.
   *   open(profileId, url, build, onStatus) -> window or null (blocked); build() -> Promise<payload | null> runs once
   *     per call (null: open without files); onStatus({ state: 'failed' | 'loaded' | 'load-failed', message }) is
   *     called for this click only while it is the latest one.
   *   receive(profileId, onFiles) -> false when the page was not opened by the landing page with a key;
   *     onFiles(payload, reply): payload as below, { error } when the landing page could not read the files, or
   *     { empty: true } when nothing was loaded there (build() returned it; the page can say so at once);
   *     reply({ ok, message }) once the files are loaded or have failed.
   *   payload: { banner, datasets: { <dataset id>: { name, path, file: File } } } */
  const tabs = Object.create(null);
  // True when a message comes from this page's own origin ("null" for every page over file://).
  const local = e => root.location.protocol === 'file:' ? e.origin === 'null' : e.origin === root.location.origin;
  // The origin "wsda-ready" is addressed to.
  const target = () => root.location.protocol === 'file:' ? '*' : root.location.origin;
  const KEY_RE = /[?&]handoff=([0-9a-f]{32})(?:&|#|$)/;
  // A new random hand-off key of 32 hex digits.
  function newKey() {
    const a = new Uint8Array(16);
    root.crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }
  let listening = false;

  function open(profileId, url, build, onStatus) {
    const key = newKey();
    const win = root.open(url + (url.indexOf('?') < 0 ? '?' : '&') + 'handoff=' + key, 'wsda-' + profileId);
    if (!win) return null;
    const tab = { win, key, onStatus: onStatus || (() => {}),
      payload: Promise.resolve().then(build).then(p => p || null, e => ({ error: (e && e.message) || String(e) })) };
    tabs[profileId] = tab;
    tab.payload.then(p => { if (p && p.error && tabs[profileId] === tab) tab.onStatus({ state: 'failed', message: p.error }); });
    if (!listening) { listening = true; root.addEventListener('message', answer); }
    return win;
  }

  // Answer a profile page's "wsda-ready": only the tab opened, with the latest key, and only through its channel.
  function answer(e) {
    const d = e.data, t = d && d.type === 'wsda-ready' && typeof d.profile === 'string' ? tabs[d.profile] : null;
    const port = e.ports && e.ports[0];
    if (!t || !port || e.source !== t.win || !local(e) || d.key !== t.key) return;
    const latest = () => tabs[d.profile] === t;
    port.onmessage = m => {
      const r = m.data;
      if (latest() && r && r.type === 'wsda-loaded') t.onStatus({ state: r.ok ? 'loaded' : 'load-failed',
        message: typeof r.message === 'string' ? r.message : '' });
    };
    t.payload.then(p => {
      if (!p || !latest()) { port.close(); return; }
      port.postMessage(Object.assign({ type: 'wsda-files', profile: d.profile }, p));
    });
  }

  function receive(profileId, onFiles) {
    const op = root.opener, m = KEY_RE.exec(root.location.search || '');
    if (!op || !m) return false;
    const ch = new root.MessageChannel();
    let done = false;
    ch.port1.onmessage = e => {
      const d = e.data;
      if (done || !d || d.type !== 'wsda-files' || d.profile !== profileId) return;
      done = true;
      onFiles(d, r => ch.port1.postMessage({ type: 'wsda-loaded', ok: !!(r && r.ok), message: (r && r.message) || '' }));
    };
    try { op.postMessage({ type: 'wsda-ready', profile: profileId, key: m[1] }, target(), [ch.port2]); }
    catch (e) { return false; }
    return true;
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.load = { fromFileList, fromDataTransfer, LIMITS, handoff: { open, receive } };
})(typeof window !== 'undefined' ? window : globalThis);
