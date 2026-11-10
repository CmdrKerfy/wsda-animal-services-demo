/* Emergency types: the list the Emergency page reads. Each emergency (HPAI; New World screwworm, as an example) is one
 * small file in site/emergency/types/ that calls WSDA.emergencyTypes.add({ ... }); no page code names an emergency.
 * The fields are explained at the top of types/hpai.js, and "Adding an emergency type" in docs/DEVELOPER_GUIDE.md
 * says how to add one. A field that is missing or of the wrong form stops the type with a message naming the field,
 * so a mistake in a new type file shows as soon as the page or the unit suite loads it.
 *
 * add(type) -> the checked type (a frozen copy); throws a TypeError naming the type and the field
 * problems() -> each type file whose type was refused: { file, message } (2.8), for the page's red notice. files() ->
 *   every type file that called add, refused or not; a type file the page lists that never did could not be read
 * list() -> the types, in the order their files were loaded; the first is the default
 * get(id) -> a type, or null
 * pick(names) -> { type, counts }: the type for a positives file, from the values of its Disease Name column (null or
 *   an empty list when the file has no such column). Each value counts for the first type with a word in it (any
 *   case; a word matches at the start of a word in the value, so "h5" matches "H5N1"); the type with the most values
 *   wins, the earlier type on a tie, and the first type when no value matches. counts: type id -> values matched.
 * statusOf(type, value) -> the status whose words hold the value (any case, spaces trimmed), or null
 * isClosed(type, value) -> true when a value of the type's closed column marks a positive closed (any case)
 * quarantineStatusOf(type, value) -> 'under' or 'released' when a value of the type's quarantine status column is one
 *   of its quarantineValues (any case, spaces trimmed), else null
 * hasWord(textLower, word) -> true when the word starts a word of the text ("h5" in "h5n1", "pig" in "pigeon", but
 *   not "cat" in "bobcat"): the one word rule for disease and species words, used by rules.js too. wordStarts(textLower,
 *   word) -> where it does, [] when nowhere.
 * COLUMN_DEFAULTS: the column names a type gets for a role it does not list (E1a's names for id, detected and
 *   disease), so a file in E1a's form still reads under any type.
 * KINDS: the kinds of animal a type gets when it names none (2.8): one kind, "Animals", counted as "animals"; a type
 *   without a title gets its name in capitals with "RESPONSE MAP".
 * QUARANTINE_VALUES: the quarantine status values a type gets when it names none ("Under quarantine", "Released"). */
(function (root) {
  'use strict';
  const types = [];
  const HEX = /^#[0-9a-f]{6}$/i;
  const APPLY = ['open', 'confirmed'];
  const SOURCES = ['rings', 'file'];
  const UNITS = ['km', 'mi'];
  // The column roles a type may name, and E1a's names used when it names none.
  const COLUMN_DEFAULTS = { id: ['AnimalDiseaseReportId'], detected: ['Detection Date'], disease: ['Disease Name'],
    status: [], quarantine: [], quarantineStatus: [], flockType: [], inventory: [], shown: [] };
  const KINDS = [{ key: 'animals', label: 'Animals', word: 'animals', words: [], nameEach: false }];
  const QUARANTINE_VALUES = { under: ['under quarantine', 'quarantined', 'in quarantine'], released: ['released', 'lifted'] };
  // A column whose name holds one of these words is never read (the same words as rules.js PRIVATE).
  const PRIVATE = /address|location|street|premise/i;

  const words = (v, field, fail) => {
    if (!Array.isArray(v) || !v.length || v.some(w => typeof w !== 'string' || !w.trim())) {
      fail(field, 'a list of one or more words');
    }
    return v.map(w => w.trim().toLowerCase());
  };
  const text = (v, field, fail) => {
    if (typeof v !== 'string' || !v.trim()) fail(field, 'a text');
    return v.trim();
  };
  const color = (v, field, fail) => {
    if (typeof v !== 'string' || !HEX.test(v)) fail(field, 'a color written #rrggbb');
    return v.toLowerCase();
  };
  // Column names, kept as written (matched in any case): a list of words, none naming a column that is never read.
  // empty: an empty list is fine.
  const names = (v, field, fail, empty) => {
    if (empty && Array.isArray(v) && !v.length) return [];
    words(v, field, fail);
    const bad = v.find(n => PRIVATE.test(n));
    if (bad) {
      fail(field, `column names the page may read ("${bad}" names an address, location, street or premise column, ` +
        'which is never read)');
    }
    return v.map(n => n.trim());
  };
  const oneOf = (v, allowed, field, fail) => {
    if (!allowed.includes(v)) fail(field, 'one of ' + allowed.map(a => '"' + a + '"').join(', '));
    return v;
  };

  // The type's fields, checked one by one; the copy keeps only the known fields.
  function check(t) {
    const id = t && typeof t.id === 'string' ? t.id : '(no id)';
    const fail = (field, want) => {
      throw new TypeError(`Emergency type "${id}": "${field}" should be ${want}`);
    };
    if (!t || typeof t !== 'object') throw new TypeError('An emergency type should be a list of fields in { }');
    if (typeof t.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(t.id)) {
      fail('id', 'a short key of lowercase letters, digits and dashes');
    }
    const out = { id: t.id, name: text(t.name, 'name', fail), diseaseWords: words(t.diseaseWords, 'diseaseWords', fail) };
    // The map picture's title: the type's own, else its name in capitals with "RESPONSE MAP".
    out.title = t.title === undefined ? out.name.toUpperCase() + ' RESPONSE MAP' : text(t.title, 'title', fail);
    // The kinds of animal (2.8): each kind's key, label, count word, species words and whether its species are
    // counted each by its own word. Every kind but the last needs a species word; a word in two kinds is refused (the
    // first would always win). 2.7's inventoryWord and countedApart are refused with a word on what replaced them.
    for (const old of ['inventoryWord', 'countedApart']) {
      if (t[old] !== undefined) fail(old, 'left out: the animals are listed in "kinds" (2.8; see the top of types/hpai.js)');
    }
    const kinds = t.kinds === undefined ? KINDS : t.kinds;
    if (!Array.isArray(kinds) || !kinds.length) fail('kinds', 'a list of one or more kinds of animal');
    out.kinds = kinds.map((k, i) => {
      const at = `kinds[${i}]`, last = i === kinds.length - 1;
      if (!k || typeof k !== 'object') fail(at, 'a kind of animal in { }');
      if (typeof k.key !== 'string' || !/^[a-z0-9-]{1,40}$/.test(k.key)) fail(at + '.key', 'a short key of lowercase letters, digits and dashes');
      const label = text(k.label, at + '.label', fail);
      if (k.nameEach !== undefined && typeof k.nameEach !== 'boolean') fail(at + '.nameEach', 'true or false');
      return { key: k.key, label, word: k.word === undefined ? label.toLowerCase() : text(k.word, at + '.word', fail),
        words: last && (k.words === undefined || (Array.isArray(k.words) && !k.words.length)) ? [] : words(k.words, at + '.words', fail),
        nameEach: k.nameEach === true };
    });
    out.kinds.forEach((k, i) => {
      if (out.kinds.findIndex(x => x.key === k.key) !== i) fail(`kinds[${i}].key`, `a key no other kind has ("${k.key}" is used twice)`);
      const j = out.kinds.findIndex((x, n) => n < i && x.words.some(w => k.words.includes(w)));
      if (j >= 0) {
        fail(`kinds[${i}].words`, `words no earlier kind has ("${k.words.find(w => out.kinds[j].words.includes(w))}" is in kinds[${j}], "${out.kinds[j].label}", too)`);
      }
    });

    if (!Array.isArray(t.statuses) || !t.statuses.length) fail('statuses', 'a list of one or more statuses');
    out.statuses = t.statuses.map((s, i) => ({
      label: text(s && s.label, `statuses[${i}].label`, fail),
      words: words(s && s.words, `statuses[${i}].words`, fail),
      color: color(s && s.color, `statuses[${i}].color`, fail)
    }));

    const cols = t.columns === undefined ? {} : t.columns;
    if (!cols || typeof cols !== 'object' || Array.isArray(cols)) fail('columns', 'the column names for each role, in { }');
    const unknown = Object.keys(cols).find(k => !(k in COLUMN_DEFAULTS));
    if (unknown) fail('columns', 'roles among ' + Object.keys(COLUMN_DEFAULTS).join(', ') + ` (not "${unknown}")`);
    out.columns = {};
    for (const k of Object.keys(COLUMN_DEFAULTS)) {
      out.columns[k] = cols[k] === undefined ? COLUMN_DEFAULTS[k].slice() : names(cols[k], `columns.${k}`, fail, true);
    }

    // The closed column: one name or a list of names, first found wins; the checked copy holds a list.
    // The quarantine status column's values: those meaning still under quarantine, and those meaning released.
    const q = t.quarantineValues === undefined ? QUARANTINE_VALUES : t.quarantineValues;
    if (!q || typeof q !== 'object') fail('quarantineValues', 'the values for under quarantine and released, in { }');
    out.quarantineValues = { under: words(q.under, 'quarantineValues.under', fail),
      released: words(q.released, 'quarantineValues.released', fail) };
    const both = out.quarantineValues.under.find(w => out.quarantineValues.released.includes(w));
    if (both) fail('quarantineValues', `different words for under quarantine and released ("${both}" is in both)`);

    const c = t.closed;
    if (!c || typeof c !== 'object') fail('closed', 'a column and its values, in { }');
    if (typeof c.column !== 'string' && !Array.isArray(c.column)) fail('closed.column', 'a column name, or a list of names');
    out.closed = {
      column: names(typeof c.column === 'string' ? [c.column] : c.column, 'closed.column', fail),
      values: words(c.values, 'closed.values', fail),
      dateColumn: c.dateColumn === undefined ? [] : names(c.dateColumn, 'closed.dateColumn', fail, true)
    };

    const z = t.zones;
    if (!z || typeof z !== 'object') fail('zones', 'the zones\' source, rings, use and unit, in { }');
    if (z.applyTo === 'all') {
      fail('zones.applyTo', '"open" or "confirmed" ("all" is no longer used: past positives never get zones)');
    }
    out.zones = {
      source: oneOf(z.source, SOURCES, 'zones.source', fail),
      applyTo: oneOf(z.applyTo, APPLY, 'zones.applyTo', fail),
      unit: oneOf(z.unit, UNITS, 'zones.unit', fail),
      rings: []
    };
    if (!Array.isArray(z.rings)) fail('zones.rings', 'a list of rings (it may be empty when zones.source is "file")');
    if (z.source === 'rings' && !z.rings.length) fail('zones.rings', 'a list of one or more rings when zones.source is "rings"');
    out.zones.rings = z.rings.map((r, i) => {
      const d = r && r.distance;
      if (typeof d !== 'number' || !(d > 0) || d > 500) {
        fail(`zones.rings[${i}].distance`, `a number above 0, at most 500 (in ${z.unit})`);
      }
      return { distance: d, label: text(r.label, `zones.rings[${i}].label`, fail),
        color: color(r.color, `zones.rings[${i}].color`, fail) };
    });
    out.zones.rings.sort((a, b) => a.distance - b.distance);

    const l = t.layers;
    if (!l || typeof l !== 'object') fail('layers', 'the suggested layers, in { }');
    const keys = (v, field) => {
      if (!Array.isArray(v) || v.some(k => typeof k !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(k))) {
        fail(field, 'a list of layer keys (as in the manifest\'s "key" column)');
      }
      return v.slice();
    };
    if (!Array.isArray(l.bySpecies)) fail('layers.bySpecies', 'a list of species words and their layer keys');
    out.layers = {
      bySpecies: l.bySpecies.map((s, i) => ({
        words: words(s && s.words, `layers.bySpecies[${i}].words`, fail),
        keys: keys(s && s.keys, `layers.bySpecies[${i}].keys`)
      })),
      default: keys(l.default, 'layers.default')
    };

    if (!Array.isArray(t.links)) fail('links', 'a list of reference pages (it may be empty)');
    out.links = t.links.map((k, i) => {
      const url = k && k.url;
      if (typeof url !== 'string' || !/^https:\/\/[^\s"<>]+$/.test(url)) fail(`links[${i}].url`, 'an https:// address');
      return { label: text(k.label, `links[${i}].label`, fail), url };
    });
    return out;
  }

  // Deep-freezes a checked type, so the page cannot change it by accident.
  function freeze(o) {
    Object.values(o).forEach(v => { if (v && typeof v === 'object') freeze(v); });
    return Object.freeze(o);
  }

  // The file calling add is the script running (null in Node). A refused type is noted with its message, then the
  // error goes on as before, so the file's script stops.
  const problems = [], files = [];
  function add(t) {
    const file = typeof document !== 'undefined' && document.currentScript ? document.currentScript.getAttribute('src') : null;
    if (file) files.push(file);
    try {
      const checked = check(t);
      if (types.some(x => x.id === checked.id)) throw new TypeError(`Emergency type "${checked.id}" is added twice`);
      types.push(freeze(checked));
      return checked;
    } catch (e) {
      problems.push({ file, message: e.message });
      throw e;
    }
  }

  const list = () => types.slice();
  const problemsOf = () => problems.map(p => ({ ...p }));
  const filesOf = () => files.slice();
  const get = id => types.find(t => t.id === id) || null;

  // Where a word starts a word of the text (both lowercased); hasWord: anywhere.
  const wordStarts = (textLower, word) => {
    const out = [];
    for (let at = textLower.indexOf(word); at >= 0; at = textLower.indexOf(word, at + 1)) {
      if (at === 0 || !/[a-z0-9]/.test(textLower[at - 1])) out.push(at);
    }
    return out;
  };
  const hasWord = (textLower, word) => wordStarts(textLower, word).length > 0;

  function pick(names) {
    const counts = Object.create(null);
    types.forEach(t => { counts[t.id] = 0; });
    for (const raw of names || []) {
      const v = String(raw == null ? '' : raw).trim().toLowerCase();
      if (!v) continue;
      const t = types.find(x => x.diseaseWords.some(w => hasWord(v, w)));
      if (t) counts[t.id]++;
    }
    let best = types[0] || null;
    for (const t of types) if (counts[t.id] > counts[best.id]) best = t;
    return { type: best, counts };
  }

  function statusOf(type, value) {
    const v = String(value == null ? '' : value).trim().toLowerCase();
    if (!v) return null;
    return type.statuses.find(s => s.words.includes(v)) || null;
  }

  function isClosed(type, value) {
    return type.closed.values.includes(String(value == null ? '' : value).trim().toLowerCase());
  }

  function quarantineStatusOf(type, value) {
    const v = String(value == null ? '' : value).trim().toLowerCase();
    if (!v) return null;
    return type.quarantineValues.under.includes(v) ? 'under' : type.quarantineValues.released.includes(v) ? 'released' : null;
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.emergencyTypes = { add, list, get, problems: problemsOf, files: filesOf, pick, statusOf, isClosed, quarantineStatusOf, check, hasWord, wordStarts, COLUMN_DEFAULTS,
    KINDS, QUARANTINE_VALUES };
})(typeof window !== 'undefined' ? window : globalThis);
