/* Emergency types: the list the Emergency page reads. Each emergency (HPAI now; New World screwworm later) is one
 * small file in site/emergency/types/ that calls WSDA.emergencyTypes.add({ ... }); no page code names an emergency.
 * The fields are explained at the top of types/hpai.js, and "Adding an emergency type" in docs/DEVELOPER_GUIDE.md
 * says how to add one. A field that is missing or of the wrong form stops the type with a message naming the field,
 * so a mistake in a new type file shows as soon as the page or the unit suite loads it.
 *
 * add(type) -> the checked type (a frozen copy); throws a TypeError naming the type and the field
 * list() -> the types, in the order their files were loaded; the first is the default
 * get(id) -> a type, or null
 * pick(names) -> { type, counts }: the type for a positives file, from the values of its Disease Name column (null or
 *   an empty list when the file has no such column). Each value counts for the first type with a word in it (any
 *   case; a word matches at the start of a word in the value, so "h5" matches "H5N1"); the type with the most values
 *   wins, the earlier type on a tie, and the first type when no value matches. counts: type id -> values matched.
 * statusOf(type, value) -> the status whose words hold the value (any case, spaces trimmed), or null
 * isClosed(type, value) -> true when a value of the type's closed column marks a positive closed (any case) */
(function (root) {
  'use strict';
  const types = [];
  const HEX = /^#[0-9a-f]{6}$/i;
  const APPLY = ['open', 'confirmed', 'all'];
  const SOURCES = ['rings', 'file'];
  const UNITS = ['km'];

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

    if (!Array.isArray(t.statuses) || !t.statuses.length) fail('statuses', 'a list of one or more statuses');
    out.statuses = t.statuses.map((s, i) => ({
      label: text(s && s.label, `statuses[${i}].label`, fail),
      words: words(s && s.words, `statuses[${i}].words`, fail),
      color: color(s && s.color, `statuses[${i}].color`, fail)
    }));

    const c = t.closed;
    if (!c || typeof c !== 'object') fail('closed', 'a column and its values, in { }');
    out.closed = { column: text(c.column, 'closed.column', fail), values: words(c.values, 'closed.values', fail) };

    const z = t.zones;
    if (!z || typeof z !== 'object') fail('zones', 'the zones\' source, rings, use and unit, in { }');
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
      if (typeof d !== 'number' || !(d > 0) || d > 500) fail(`zones.rings[${i}].distance`, 'a number above 0, at most 500');
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

  function add(t) {
    const checked = check(t);
    if (types.some(x => x.id === checked.id)) throw new TypeError(`Emergency type "${checked.id}" is added twice`);
    types.push(freeze(checked));
    return checked;
  }

  const list = () => types.slice();
  const get = id => types.find(t => t.id === id) || null;

  // True when a word starts a word of the text (both lowercased).
  const hasWord = (textLower, word) => {
    let at = textLower.indexOf(word);
    while (at >= 0) {
      if (at === 0 || !/[a-z0-9]/.test(textLower[at - 1])) return true;
      at = textLower.indexOf(word, at + 1);
    }
    return false;
  };

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

  root.WSDA = root.WSDA || {};
  root.WSDA.emergencyTypes = { add, list, get, pick, statusOf, isClosed, check };
})(typeof window !== 'undefined' ? window : globalThis);
