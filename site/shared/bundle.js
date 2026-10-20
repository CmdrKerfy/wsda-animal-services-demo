/* Optional bundle.json (F1; several dashboards and release fields: AB). A bundle may describe itself in a small
 * JSON file named bundle.json:
 *   { "profiles": ["cvi", "infrastructure"], "label": "Partner – county totals only", "prepared": "2026-09-15",
 *     "coverage": { "from": "2024-01-01", "to": "2025-12-31" }, "files": { "feedlots": "feedlots_2025.csv" },
 *     "release": { "name": "Partner county totals", "version": "3", "date": "2026-10-01" } }
 * Every field is optional. The page shows label, preparation date, coverage and release in a banner ("Partner – county
 * totals only · prepared 2026-09-15 · covers 2024–2025 · release Partner county totals, version 3, 2026-10-01");
 * "files" (dataset id -> file name) ranks recognition claims (recognize.js: the user's pick > bundle.json > columns and
 * names) and never excludes a file. "profiles" lists the dashboards the bundle is meant for (none listed: every
 * dashboard); the older "profile" (one dashboard) is still read as a one-item list. The list and "release" are labels
 * for people, not protection: an unlisted dashboard can still be opened, and nothing is checked against the release. A
 * bundle.json that cannot be read, or a field that is not understood, gives a plain warning and is otherwise ignored:
 * the files themselves still load. Nothing leaves the browser. "synthetic": true marks made-up data (the sample
 * bundles): the dashboards then write "Synthetic sample data" on the pictures and export_params.json they make.
 *
 * read(items) -> Promise<{ found, path, paths, info: { profile, profiles, label, prepared, coverage, release, files,
 *   synthetic },
 *   banner, warnings }>
 *   info.profiles: the listed dashboards, or null when none is named; info.profile: the first of them, or null.
 *   paths: every bundle.json used (identical copies).
 *   items: the loader's items (load.js); every file named bundle.json (any folder, any case) is considered.
 *   Several bundle.json files are used only if their contents are identical; otherwise none is used.
 * listed(info) -> the dashboards a bundle.json lists, or null (also reads an info with only "profile").
 * filesFor(bundle, profile) -> the "files" entries to give recognition, or {} when the bundle lists other
 *   dashboards only (warning added). */
(function (root) {
  'use strict';
  const MAX_BYTES = 64 * 1024, MAX_FILES = 1000, MAX_LABEL = 200, MAX_PROFILES = 20, MAX_VERSION = 40;
  const KNOWN = ['profile', 'profiles', 'label', 'prepared', 'coverage', 'files', 'release', 'synthetic'];
  const RELEASE_KNOWN = ['name', 'version', 'date'];
  const isProfileName = p => typeof p === 'string' && /^[a-z0-9_-]{1,40}$/i.test(p.trim());
  const isBundleName = n => String(n).trim().toLowerCase() === 'bundle.json';

  /** A real calendar date written YYYY-MM-DD. */
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  }
  // Control characters and the invisible marks that reorder text (left-to-right and right-to-left overrides) become
  // spaces, so a label cannot rearrange the banner around it.
  const clean = s => String(s).replace(/[\u0000-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();
  // A rejected entry quoted in a warning, cut so a long one cannot flood the notes.
  const quoted = s => s.length > 60 ? s.slice(0, 59) + '…' : s;

  /** "2024–2025" for whole calendar years, "2024" for one, otherwise "2024-03-01 to 2025-06-30". */
  function coverageText(c) {
    const y1 = c.from.slice(0, 4), y2 = c.to.slice(0, 4);
    if (c.from.slice(5) === '01-01' && c.to.slice(5) === '12-31') return y1 === y2 ? y1 : y1 + '–' + y2;
    return c.from === c.to ? c.from : c.from + ' to ' + c.to;
  }

  /** "Partner county totals, version 3, 2026-10-01": the release fields that are present, in that order. */
  function releaseText(r) {
    return [r.name, r.version ? 'version ' + r.version : null, r.date].filter(Boolean).join(', ');
  }

  // The banner line: the label, preparation date, coverage and release that are present, joined with " · ";
  // null when none is.
  function bannerText(info) {
    const parts = [];
    if (info.label) parts.push(info.label);
    if (info.prepared) parts.push((parts.length ? 'prepared ' : 'Prepared ') + info.prepared);
    if (info.coverage) parts.push((parts.length ? 'covers ' : 'Covers ') + coverageText(info.coverage));
    if (info.release) parts.push((parts.length ? 'release ' : 'Release ') + releaseText(info.release));
    return parts.length ? parts.join(' · ') : null;
  }

  /** The optional "release" entry: display only. Returns the fields that are usable, or null. */
  function parseRelease(r, warnings) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      warnings.push('bundle.json "release" should list "name", "version" and "date" in { }; ignored');
      return null;
    }
    const out = { name: null, version: null, date: null };
    if (!Object.keys(r).length) { warnings.push('bundle.json "release" gives no name, version or date; ignored'); return null; }
    const unknown = Object.keys(r).filter(k => !RELEASE_KNOWN.includes(k));
    if (unknown.length) warnings.push('bundle.json "release" entries not understood and ignored: '
      + unknown.map(k => quoted(clean(k))).join(', '));
    if (r.name !== undefined) {
      if (typeof r.name === 'string' && clean(r.name)) {
        const n = clean(r.name);
        out.name = n.length > MAX_LABEL ? n.slice(0, MAX_LABEL - 1) + '…' : n;
      } else warnings.push('bundle.json "release" "name" is blank or not text; ignored');
    }
    if (r.version !== undefined) {
      const v = typeof r.version === 'number' && isFinite(r.version) ? String(r.version)
        : typeof r.version === 'string' ? clean(r.version) : '';
      if (v && v.length <= MAX_VERSION) out.version = v;
      else warnings.push(
        `bundle.json "release" "version" is not a short text or number (up to ${MAX_VERSION} characters); ignored`);
    }
    if (r.date !== undefined) {
      if (isDate(r.date)) out.date = r.date;
      else warnings.push('bundle.json "release" "date" is not a date written as YYYY-MM-DD; ignored');
    }
    return out.name || out.version || out.date ? out : null;
  }

  /** The optional "profiles" list: the valid dashboard names, lowercased, each once; null when none is usable.
   * single: a valid older "profile", used instead when the list is unusable (the warnings say so). */
  function parseProfiles(list, warnings, single) {
    const instead = single ? `; "profile" ("${single}") was used` : '';
    if (!Array.isArray(list)) {
      warnings.push('bundle.json "profiles" should be a list of dashboard names in [ ]; ignored' + instead);
      return null;
    }
    const names = [], bad = [];
    for (const p of list.slice(0, MAX_PROFILES)) {
      if (!isProfileName(p)) {
        bad.push(quoted(typeof p === 'string' ? clean(p) || '(blank)' : clean(JSON.stringify(p)))); continue;
      }
      const id = p.trim().toLowerCase();
      if (!names.includes(id)) names.push(id);
    }
    if (bad.length) warnings.push('bundle.json "profiles" entries that are not dashboard names were ignored: ' + bad.join(', '));
    if (list.length > MAX_PROFILES) warnings.push(
      `bundle.json "profiles" lists more than ${MAX_PROFILES} entries; the rest were ignored`);
    if (!names.length) {
      warnings.push(single ? 'bundle.json "profiles" names no dashboard' + instead
        : 'bundle.json "profiles" names no dashboard, so the files are checked for every dashboard');
      return null;
    }
    return names;
  }

  /** Validates parsed JSON; returns { info, warnings }. */
  function parse(obj) {
    const info = { profile: null, profiles: null, label: null, prepared: null, coverage: null, release: null,
      files: Object.create(null) };
    const warnings = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { info, warnings: [
      'bundle.json does not describe a bundle (it should be a list of named entries in { }); it was not used'] };
    const unknown = Object.keys(obj).filter(k => !KNOWN.includes(k));
    if (unknown.length) warnings.push('bundle.json entries not understood and ignored: ' + unknown.map(k => quoted(clean(k))).join(', '));
    let single = null;
    if (obj.profile !== undefined) {
      if (isProfileName(obj.profile)) single = obj.profile.trim().toLowerCase();
      else warnings.push('bundle.json "profile" is not a dashboard name; ignored');
    }
    if (obj.profiles !== undefined) info.profiles = parseProfiles(obj.profiles, warnings, single);
    if (single && info.profiles && !info.profiles.includes(single)) {
      warnings.push('bundle.json gives both "profile" and "profiles" and they differ; "profiles" was used');
    }
    if (!info.profiles && single) info.profiles = [single];
    info.profile = info.profiles ? info.profiles[0] : null;
    if (obj.label !== undefined) {
      if (typeof obj.label === 'string' && clean(obj.label)) {
        const l = clean(obj.label);
        info.label = l.length > MAX_LABEL ? l.slice(0, MAX_LABEL - 1) + '…' : l;
      } else warnings.push('bundle.json "label" is not text; ignored');
    }
    if (obj.prepared !== undefined) {
      if (isDate(obj.prepared)) info.prepared = obj.prepared;
      else warnings.push('bundle.json "prepared" is not a date written as YYYY-MM-DD; ignored');
    }
    if (obj.coverage !== undefined) {
      const c = obj.coverage;
      if (c && typeof c === 'object' && isDate(c.from) && isDate(c.to) && c.from <= c.to)
        info.coverage = { from: c.from, to: c.to };
      else warnings.push('bundle.json "coverage" needs "from" and "to" dates written as YYYY-MM-DD, "from" first; ignored');
    }
    if (obj.files !== undefined) {
      const f = obj.files;
      if (f && typeof f === 'object' && !Array.isArray(f)) {
        const bad = [];
        for (const [k, v] of Object.entries(f).slice(0, MAX_FILES)) {
          if (typeof v === 'string' && v.trim() && k.trim()) info.files[k.trim()] = v.trim();
          else bad.push(quoted(clean(k)) || '(blank)');   // cut at 60 characters, as the other notes
        }
        if (bad.length) warnings.push('bundle.json "files" entries without a file name were ignored: ' + bad.join(', '));
        if (Object.keys(f).length > MAX_FILES) warnings.push(
          `bundle.json "files" lists more than ${MAX_FILES} entries; the rest were ignored`);
      } else warnings.push('bundle.json "files" should list dataset names and file names in { }; ignored');
    }
    if (obj.release !== undefined) info.release = parseRelease(obj.release, warnings);
    if (obj.synthetic === true) info.synthetic = true;
    else if (obj.synthetic !== undefined && obj.synthetic !== false) warnings.push('bundle.json "synthetic" should be true or false; ignored');
    return { info, warnings };
  }

  async function read(items) {
    const found = (items || []).filter(i => isBundleName(i.name));
    const out = { found: false, path: null, info: null, banner: null, warnings: [] };
    if (!found.length) return out;
    const texts = [];
    for (const it of found) {
      if (it.size > MAX_BYTES) {
        out.warnings.push(`"${it.path}" is larger than 64 KB, so it is not a bundle description; it was not used`);
        return out;
      }
      try { texts.push((await it.text()).replace(/^﻿/, '')); }
      catch (e) { out.warnings.push(`"${it.path}" could not be read: ${e.message}`); return out; }
    }
    if (texts.some(t => t !== texts[0])) {
      out.warnings.push('more than one bundle.json was supplied and they differ ('
        + found.map(i => '"' + i.path + '"').join(', ') + '); none was used');
      return out;
    }
    let obj;
    try { obj = JSON.parse(texts[0]); }
    catch (e) {
      out.warnings.push(`"${found[0].path}" is not valid JSON, so it was not used; check it in a text editor`);
      return out;
    }
    const p = parse(obj);
    Object.assign(out, { found: true, path: found[0].path, paths: found.map(i => i.path), info: p.info,
      banner: bannerText(p.info), warnings: p.warnings });
    return out;
  }

  // An info object written before "profiles" existed (or by a test) may carry only "profile".
  function listed(info) {
    if (!info) return null;
    if (Array.isArray(info.profiles) && info.profiles.length) return info.profiles;
    return info.profile ? [info.profile] : null;
  }

  function filesFor(bundle, profile, opts) {
    if (!bundle || !bundle.found) return {};
    const list = listed(bundle.info), SHARED = ['cvi', 'infrastructure'];
    if (list && !list.includes(profile.id)) {
      // Explicit switching reuses only descriptors shared by the two available dashboards.
      if (opts && opts.reuseShared && list.some(id => SHARED.includes(id)) && SHARED.includes(profile.id)) {
        const ids = new Set((opts.datasets || profile.datasets)
          .filter(d => d.kind === 'facility' || d.kind === 'manifest' || d.id === 'master').map(d => d.id));
        const files = Object.create(null);
        for (const [id, name] of Object.entries(bundle.info.files)) if (ids.has(id)) files[id] = name;
        return files;
      }
      const w = list.length === 1
        ? `bundle.json says this bundle is for the "${list[0]}" dashboard, so its "files" entries were not used for ${profile.name}`
        : `bundle.json says this bundle is for the ${list.map(id => '"' + id + '"').join(', ')} dashboards, so its "files" entries were not used for ${profile.name}`;
      if (Object.keys(bundle.info.files).length && !bundle.warnings.includes(w)) bundle.warnings.push(w);
      return {};
    }
    return Object.assign(Object.create(null), bundle.info.files);   // no inherited keys: "constructor" is a plain entry
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.bundle = { read, parse, listed, filesFor, bannerText, coverageText, releaseText, isBundleName, MAX_BYTES };
})(typeof window !== 'undefined' ? window : globalThis);
