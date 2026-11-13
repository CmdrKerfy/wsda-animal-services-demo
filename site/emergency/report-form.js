/* Emergency Response, the Report view's form (2.9, E2): the parts of the update staff type or choose, beside the pages
 * (report-view.js draws them). The numbers from the loaded file are never fields: the form holds words and choices
 * only, and each fold's heading says how it stands ("Matches the data", "Automatic", or an orange "Check").
 *
 * The report text is one plain object, what "Save report text" keeps month to month:
 *   type        the emergency type's id
 *   status      null (the approved wording that fits the data), 'free', 'active' or 'own'; own, staff's own sentence
 *   milk        an index into the type's milk stages, or 'own'; milkOwn { stage, text }
 *   suspected   the livestock card's "suspected cases are being tested"
 *   mapLook     'dots' or 'counties'; note, a line under Washington's figures (for a known gap)
 *   iconStyle   'filled' or 'outline', the key messages' icons
 *   messages    the key messages in the order printed: [{ headline, icon (a name from message-icons.js), text,
 *               link { label, url }, highlight }] (the livestock card from the data comes after them); aside, the
 *               messages set aside: kept in the file, not printed
 *   heading     the line under the title; hotline { ask, name, number }, online { label, url } and alternate, the
 *               foot of every page
 *   ready       "Ready to send": until it is ticked every page carries a DRAFT mark; a report text loaded is a draft
 *   p2          page 2 (2.9; null for a type without page 2 words): nat, wild and tests, the boxes typed from USDA and
 *               WADDL each month as words (FIELDS below), WADDL's sentence and categories, testingLists and resources
 *               (each list's links), call (the "Report sick birds" box's parts); USDA's three pictures are never in it
 *   past        page 2's figures of the latest reports saved ([{ date, values }], the latest first), to compare with
 *
 * USDA's pictures are kept on the page only (pictures(), clearPictures()); "Load last month's" for another report
 * date leaves page 2's numbers, dates and pictures empty, its figures kept in past for the checks.
 *
 * WSDA.emergencyReportForm:
 *   fresh(type) -> a new report text from the type's report words.
 *   choices(text, type, pics) -> what report-view.js draw takes as choices (pics: pictures(), for page 2's maps).
 *   checks(text, type, f, date, cards, pics) -> each fold's heading and warnings, pure (for the unit suite); a tag is
 *     { words, how ('ok', 'warn' or '') }:
 *       date { tag }; status { tag, statusWarn, milkWarn, dataLine, picked }; data { tag, auto };
 *       messages { tag, warns (a list a message), lines (each message's lines on its card, null for one not printed),
 *         pairs (a hint for a card much longer than the one beside it), pages (where the messages print) };
 *       nat { tag } and wild { tag } (page 2's folds) with page2 (page2Checks'); boxes { tag, warns }; checking (the
 *       folds' names that say "Check").
 *     cards are report-view.js draw's (left out: no lines, hints or pages); pics, how many of USDA's pictures are added.
 *   page2Checks(text, date, pics) -> page 2's boxes checked: { why (a box's line, by "part.key"), flocks, flocksLine,
 *     compared (what the numbers are compared with), nat and wild { tag, checks, blanks } }.
 *   arcgisFile(text, type, date, words) -> { csv, blanks }: "Save for ArcGIS", one row in the ArcGIS monthly table's
 *     columns (ARC_COLS); words are report-view.js draw's.
 *   toFile(text, type, date, today) -> the saved report text, as the file's words (JSON; nothing from the table).
 *   fromFile(words, type, date) -> { text, notes, saved, reportDate, cleared } or { error }: a saved report text read
 *     back, each field checked (a value that is not one the page knows is left at the update's own, and named in
 *     notes); date, the report's date on the page (cleared: page 2's figures left empty, the file being for another).
 *   dateOf(words), numOf(words, kind): a typed date as YYYY-MM-DD ('' not a date) and a typed number (NaN not one).
 *   wire(doc, get, changed, today) ties the form's fields to the text get() returns; changed(soon) after each change
 *     (soon: typed words, drawn again after a pause); today() the date a pasted picture is dated by.
 *   show(doc, type, text, f, date, drawn) puts the text and the checks into the form (a field being typed in is left
 *     as it is); the key messages' list is drawn again only after a message is added, removed, set aside, put back,
 *     moved or given another icon, or for another report text. */
(function (root) {
  'use strict';
  const RP = root.WSDA.emergencyReport, MI = root.WSDA.emergencyMessageIcons;
  const many = (n, one, more) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : more);
  const trim = v => String(v === null || v === undefined ? '' : v).trim();
  const OK = 'ok', WARN = 'warn';

  const message = m => ({ headline: trim(m && m.headline), icon: m && MI.has(m.icon) ? m.icon : 'information', text: trim(m && m.text),
    link: { label: trim(m && m.link && m.link.label), url: trim(m && m.link && m.link.url) }, highlight: !!(m && m.highlight) });
  function fresh(type) {
    const rp = type.report, hot = rp.hotline || {}, online = rp.online || {};
    return { type: type.id, status: null, own: '', milk: 0, milkOwn: { stage: '', text: '' }, suspected: false, mapLook: 'dots', note: '',
      iconStyle: 'filled', messages: (rp.messages || []).map(message), aside: [], heading: trim(rp.note),
      hotline: { ask: trim(hot.ask), name: trim(hot.name), number: trim(hot.number) }, online: { label: trim(online.label), url: trim(online.url) },
      alternate: trim(rp.alternate), ready: false, p2: rp.page2 ? freshPage2(rp.page2) : null, past: [] };
  }

  // ---- Page 2 (2.9): the figures typed from USDA and WADDL each month, the "Report sick birds" box, the lists ----
  // Each typed box: where it goes in text.p2 (part and key), its label, its kind ('int' a whole number, 'num' a number,
  // 'date', 'url' an address, 'text' words), and what it is checked against: grows (a total that never goes down: lower
  // than last month's is a check), same (the source named when the same number two reports running is a check), within
  // (a last-30-days number above its total is a check), asOf (an "as of" date more than 31 days old is a check), none
  // (the tick for "no detections reported"); csv, its column in the ArcGIS monthly table (hpai-monthly-figures.csv).
  const SINCE = 'A number since the outbreak began never goes down.';
  const FIELDS = [
    { part: 'nat', key: 'asOf', label: 'As of', kind: 'date', asOf: 'USDA', csv: 'us_as_of' },
    { part: 'nat', key: 'source', label: 'Data source (address)', kind: 'url' },
    { part: 'nat', key: 'birds', label: 'Birds affected (millions)', kind: 'num', grows: SINCE, same: 'USDA', csv: 'us_birds_m' },
    { part: 'nat', key: 'states', label: 'States', kind: 'int', grows: SINCE, csv: 'us_states' },
    { part: 'nat', key: 'commercial', label: 'Commercial flocks', kind: 'int', grows: SINCE, same: 'USDA', csv: 'us_commercial' },
    { part: 'nat', key: 'backyard', label: 'Backyard flocks', kind: 'int', grows: SINCE, same: 'USDA', csv: 'us_backyard' },
    { part: 'nat', key: 'territories', label: 'Territories', kind: 'int', grows: SINCE, csv: 'us_territories' },
    { part: 'nat', key: 'c30', label: 'Commercial flocks', kind: 'int', within: ['commercial', 'commercial flocks'], csv: 'us_30d_commercial' },
    { part: 'nat', key: 'b30', label: 'Backyard flocks', kind: 'int', within: ['backyard', 'backyard flocks'], csv: 'us_30d_backyard' },
    { part: 'nat', key: 'birds30', label: 'Birds affected (millions)', kind: 'num', within: ['birds', 'million birds'], csv: 'us_30d_birds_m' },
    { part: 'nat', key: 'regional30', label: 'Regional confirmations', kind: 'int', csv: 'us_30d_regional' },
    { part: 'nat', key: 'lastFlock', label: 'Last reported detection', kind: 'date', csv: 'us_last_flock' },
    { part: 'nat', key: 'lvStates', label: 'States affected', kind: 'int', csv: 'us_lv_states' },
    { part: 'nat', key: 'lvCases', label: 'Confirmed cases', kind: 'int', csv: 'us_lv_cases' },
    { part: 'nat', key: 'lvRegional', label: 'Regional confirmations', kind: 'int', csv: 'us_lv_regional' },
    { part: 'nat', key: 'lastLivestock', label: 'Last new confirmed case', kind: 'date', csv: 'us_last_livestock' },
    { part: 'nat', key: 'lvSource', label: 'Livestock data source', kind: 'url' },
    { part: 'nat', key: 'sequencing', label: 'Testing and sequencing page', kind: 'url' },
    { part: 'wild', key: 'since', label: 'Wild birds since 2021', kind: 'int', grows: 'A number since 2021 never goes down.', same: 'USDA', csv: 'wild_since_2021' },
    { part: 'wild', key: 'window', label: 'Samples collected (dates)', kind: 'text', csv: 'wild_window' },
    { part: 'wild', key: 'd30', label: 'Wild birds, last 30 days', kind: 'int', none: 'd30None', csv: 'wild_birds_30d' },
    { part: 'wild', key: 'm30', label: 'Wild mammals, last 30 days', kind: 'int', none: 'm30None', csv: 'wild_mammals_30d' },
    { part: 'tests', key: 'asOf', label: 'As of', kind: 'date', asOf: 'WADDL' },
    { part: 'tests', key: 'total', label: 'PCR tests', kind: 'int', grows: 'A count of tests run never goes down.', same: 'WADDL', csv: 'waddl_tests' }
  ];
  const FIELD = Object.fromEntries(FIELDS.map(f => [f.part + '.' + f.key, f]));
  // The month's figures (cleared by "Load last month's" for another report date): the numbers, the dates and the
  // samples' dates; the addresses, WADDL's sentence, the categories' names, the box and the lists are kept.
  const figure = f => f.kind !== 'url';
  const PICS = [['flocks', 'Domestic flocks'], ['livestock', 'Domestic livestock'], ['wild', 'Wild birds']];
  const links = list => list.map(l => ({ label: trim(l.label), url: trim(l.url) }));
  function freshPage2(p) {
    const nat = {}, wild = { d30None: false, m30None: false };
    for (const f of FIELDS) if (f.part !== 'tests') (f.part === 'nat' ? nat : wild)[f.key] = '';
    Object.assign(nat, { source: p.national.source, lvSource: p.national.livestock, sequencing: p.national.sequencing });
    return { nat, wild, tests: { asOf: '', total: '', intro: p.testing.intro, cats: p.testing.categories.map(name => ({ name, n: '' })) },
      testingLists: p.testing.lists.map(g => links(g.links)), call: p.call.map(c => ({ headline: c.headline, text: c.text, label: c.link.label, url: c.link.url })),
      resources: p.resources.map(g => links(g.links)) };
  }
  // A typed number, as a number: commas allowed ("1,032"); a whole number for 'int'. null when empty, NaN when not a
  // number.
  function numOf(v, kind) {
    const s = trim(v).replace(/,/g, '');
    if (!s) return null;
    return (kind === 'int' ? /^\d+$/ : /^(\d+(\.\d+)?|\.\d+)$/).test(s) ? +s : NaN;
  }
  // A typed date, as YYYY-MM-DD: "September 1, 2026", "Sep 1, 2026", "9/1/2026" or "2026-09-01". null when empty, ''
  // when not a date.
  const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function dateOf(v) {
    const s = trim(v);
    if (!s) return null;
    let y, m, d, x;
    if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [y, m, d] = [+x[1], +x[2], +x[3]];
    else if ((x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [y, m, d] = [+x[3], +x[1], +x[2]];
    else if ((x = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) {
      const word = x[1].toLowerCase(), i = MONTH_NAMES.findIndex(n => n === word || (word.length >= 3 && n.startsWith(word)));
      if (i < 0) return '';
      [y, m, d] = [+x[3], i + 1, +x[2]];
    } else return '';
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return '';
    return t.toISOString().slice(0, 10);
  }
  // An address a list's link opens with: http, https or mailto.
  const opensLink = url => /^(https?:\/\/|mailto:)[^\s<>"]+$/i.test(url);
  const valueOf = (p2, f) => p2[f.part][f.key];
  const noneTicked = (p2, f) => !!(f.none && p2[f.part][f.none]);
  // The month's figures as kept in the saved report text to compare with next month: { "nat.birds": "208.33", ...,
  // cats: { name: n } }, the words as typed.
  const kept = f => f.kind === 'int' || f.kind === 'num';
  function figuresOf(p2) {
    const out = {};
    for (const f of FIELDS) if (kept(f)) out[f.part + '.' + f.key] = trim(valueOf(p2, f));
    out.cats = Object.fromEntries(p2.tests.cats.filter(c => trim(c.name)).map(c => [trim(c.name), trim(c.n)]));
    return out;
  }
  // The reports to compare with: the kept months before the report's date, the latest first.
  const pastBefore = (text, date) => (text.past || []).filter(p => p.date < date).sort((a, b) => (a.date < b.date ? 1 : -1));

  // Each of page 2's boxes checked (pure, for the unit suite): why (a box's line, by "part.key", or "cat.i" for a
  // category's number, "list.g.i" for a link of WADDL's lists), the counts, and each fold's heading. A check never
  // changes a value: it asks staff to look again. pics: how many of USDA's three pictures are added.
  function page2Checks(text, date, pics) {
    const p2 = text.p2, why = {}, blank = { nat: 0, wild: 0 }, flagged = { nat: 0, wild: 0 };
    const fold = f => (f.part === 'nat' ? 'nat' : 'wild');
    const fmt = (v, kind) => kind === 'int' ? v.toLocaleString('en-US') : String(v);
    const D = RP.dateLong, [last, prev] = pastBefore(text, date);
    const flag = (at, words, k) => { why[at] = words; flagged[k]++; };
    for (const f of FIELDS) {
      const at = f.part + '.' + f.key, v = trim(valueOf(p2, f)), k = fold(f);
      if (f.kind === 'url') {
        if (v && !opensLink(v)) flag(at, 'This address does not start with https://, so it would not open. Copy it from the browser\'s address bar.', k);
        continue;
      }
      if (noneTicked(p2, f)) continue;
      if (!v) {
        blank[k]++;
        if (f.asOf) why[at] = 'Not filled. Type the date on ' + f.asOf + '\'s page.';
        continue;
      }
      if (f.kind === 'date') {
        const iso = dateOf(v);
        if (iso === '') flag(at, '"' + v + '" is not a date. Type it as September 1, 2026 or 9/1/2026.', k);
        else if (iso > date) flag(at, D(iso) + ' is after the report\'s date (' + D(date) + ').', k);
        else if (f.asOf && RP.daysBetween(iso, date) > 31) {
          flag(at, D(iso) + ' is ' + RP.daysBetween(iso, date) + ' days before the report\'s date. Is it ' + f.asOf + '\'s latest?', k);
        }
        continue;
      }
      if (f.kind === 'text') continue;
      const n = numOf(v, f.kind);
      if (Number.isNaN(n)) {
        flag(at, '"' + v + '" is not a number. Type it as ' + (f.part === 'tests' ? 'WADDL' : 'USDA') + ' shows it, e.g. ' +
          (f.kind === 'int' ? '1032' : '0.15') + '.', k);
        continue;
      }
      if (f.within) {
        const total = numOf(p2.nat[f.within[0]], FIELD['nat.' + f.within[0]].kind);
        if (total === null) flag(at, fmt(n, f.kind) + ' in the last 30 days, and the total since the outbreak began is not filled: the two cannot be compared.', k);
        else if (!Number.isNaN(total) && n > total) {
          flag(at, fmt(n, f.kind) + ' in the last 30 days is more than the ' + fmt(total, f.kind) + ' ' + f.within[1] + ' since the outbreak began.', k);
        }
        continue;
      }
      const then = r => (r ? numOf(r.values[at], f.kind) : null), a = then(last), b = then(prev);
      if (f.grows && a !== null && !Number.isNaN(a) && n < a) {
        flag(at, fmt(n, f.kind) + ' is lower than last month\'s ' + fmt(a, f.kind) + '. ' + f.grows, k);
      } else if (f.same && a !== null && b !== null && n === a && n === b) {
        flag(at, fmt(n, f.kind) + ', the same as the last two reports (' + D(prev.date).replace(/, \d{4}$/, '') + ' and ' +
          D(last.date).replace(/, \d{4}$/, '') + '). Still current on ' + f.same + '\'s page?', k);
      }
    }
    // WADDL's categories: a number each ("not filled" when empty), the same total rules as the others.
    p2.tests.cats.forEach((c, i) => {
      if (!trim(c.name) && !trim(c.n)) return;
      const n = numOf(c.n, 'int');
      if (n === null) blank.wild++;
      else if (Number.isNaN(n)) flag('cat.' + i, '"' + trim(c.n) + '" is not a number. Type the tests as WADDL shows them, e.g. 2937.', 'wild');
      else if (!trim(c.name)) flag('cat.' + i, 'This category has a number but no name.', 'wild');
    });
    p2.testingLists.forEach((g, gi) => g.forEach((l, i) => {
      if (trim(l.url) && !opensLink(trim(l.url))) flag('list.' + gi + '.' + i, 'This address would not open: it prints as words only.', 'wild');
      else if (!trim(l.url) && trim(l.label)) flag('list.' + gi + '.' + i, 'The link has words but no address: it prints as words only.', 'wild');
    }));
    const missing = PICS.length - (pics || 0);
    const tagOf = (n, b, p) => {
      const parts = [n ? n + ' to check' : '', b ? b + ' not filled' : '', p ? p + (p === 1 ? ' picture' : ' pictures') : ''].filter(Boolean);
      return parts.length ? { words: parts.join(' · '), how: WARN } : { words: 'All filled', how: OK };
    };
    const c = numOf(p2.nat.commercial, 'int'), y = numOf(p2.nat.backyard, 'int');
    const flocks = c === null || y === null || Number.isNaN(c) || Number.isNaN(y) ? null : c + y;
    return {
      why, flocks,
      flocksLine: 'Flocks in all: ' + (flocks === null ? 'not filled' : flocks.toLocaleString('en-US')) + ' (added up, never typed)',
      compared: last ? 'Compared with: the report text of ' + D(last.date) + (text.pastLoaded ? ' (loaded)' : '') + '.'
        : 'Compared with: nothing loaded, so "lower than last month" and "the same two reports running" are not checked. Load last month\'s report text to check them.',
      nat: { tag: tagOf(flagged.nat, blank.nat, missing), checks: flagged.nat, blanks: blank.nat, pictures: missing },
      wild: { tag: tagOf(flagged.wild, blank.wild, 0), checks: flagged.wild, blanks: blank.wild }
    };
  }
  // Page 2's words for the pages (report-view.js draws them): each typed value as it prints (a number with its commas,
  // a date in words, as typed when it is neither), or null for "not filled".
  function page2Choices(p2, rp, pics) {
    const shown = f => {
      const v = trim(valueOf(p2, f));
      if (!v) return null;
      if (f.kind === 'date') { const iso = dateOf(v); return iso ? RP.dateLong(iso) : v; }
      const n = f.kind === 'int' || f.kind === 'num' ? numOf(v, f.kind) : NaN;
      return Number.isNaN(n) || n === null ? v : f.kind === 'int' ? n.toLocaleString('en-US') : v.replace(/,/g, '');
    };
    const part = name => Object.fromEntries(FIELDS.filter(f => f.part === name).map(f => [f.key, shown(f)]));
    const nat = part('nat'), wild = part('wild'), tests = part('tests');
    const sum = (a, b) => {
      const x = numOf(p2.nat[a], 'int'), y = numOf(p2.nat[b], 'int');
      return x === null || y === null || Number.isNaN(x) || Number.isNaN(y) ? null : (x + y).toLocaleString('en-US');
    };
    nat.flocks = sum('commercial', 'backyard');
    nat.flocks30 = sum('c30', 'b30');
    for (const k of ['source', 'lvSource', 'sequencing']) nat[k] = opensLink(trim(p2.nat[k])) ? trim(p2.nat[k]) : null;
    wild.d30None = !!p2.wild.d30None;
    wild.m30None = !!p2.wild.m30None;
    wild.source = rp.page2.wild.source;
    const linkOf = l => ({ label: trim(l.label) || trim(l.url), url: opensLink(trim(l.url)) ? trim(l.url) : null });
    const listsOf = (named, lists) => named.map((g, i) => ({ name: g.name, links: (lists[i] || []).filter(l => trim(l.label) || trim(l.url)).map(linkOf) }));
    return {
      nat, wild,
      tests: Object.assign(tests, { intro: trim(p2.tests.intro), since: rp.page2.testing.since,
        cats: p2.tests.cats.filter(c => trim(c.name) || trim(c.n)).map(c => {
          const n = numOf(c.n, 'int');
          return { name: trim(c.name), n: n === null ? null : Number.isNaN(n) ? trim(c.n) : n, value: n === null || Number.isNaN(n) ? 0 : n };
        }) }),
      maps: Object.fromEntries(PICS.map(([k]) => [k, pics && pics[k] ? pics[k].url : null])),
      call: p2.call.map(c => ({ headline: trim(c.headline), text: trim(c.text), link: trim(c.label) || trim(c.url) ? linkOf(c) : null })),
      testingLists: listsOf(rp.page2.testing.lists, p2.testingLists),
      resources: listsOf(rp.page2.resources, p2.resources)
    };
  }

  // ---- "Save for ArcGIS" (type once, use in both): one row in the ArcGIS monthly table's columns ----
  // The columns of the ArcGIS dashboard's monthly table, hpai-monthly-figures.csv; the status, livestock and milk testing sentences as
  // the pages print them (words, report-view.js draw's); page 2's figures as they print, a box not filled left blank (a
  // blank in ArcGIS is better than last month's number). Returns { csv, blanks (the figures left blank) }.
  const ARC_COLS = ['report_date', 'wa_status', 'wa_livestock', 'wa_milk_stage', 'us_as_of', 'us_birds_m', 'us_flocks', 'us_commercial',
    'us_backyard', 'us_states', 'us_territories', 'us_30d_commercial', 'us_30d_backyard', 'us_30d_birds_m', 'us_30d_regional', 'us_lv_states',
    'us_lv_cases', 'us_lv_regional', 'us_last_flock', 'us_last_livestock', 'wild_window', 'wild_since_2021', 'wild_birds_30d',
    'wild_mammals_30d', 'waddl_tests', 'waddl_since'];
  const NO_DETECTIONS = 'No detections reported';
  function arcgisFile(text, type, date, words) {
    const ch = page2Choices(text.p2, type.report, null), row = { report_date: RP.dateLong(date), waddl_since: type.report.page2.testing.since };
    row.wa_status = words && words.status || '';
    row.wa_livestock = words && words.livestock ? words.livestock.text : '';
    row.wa_milk_stage = words && words.livestock ? words.livestock.stage : '';
    for (const f of FIELDS) {
      if (!f.csv) continue;
      const v = noneTicked(text.p2, f) ? NO_DETECTIONS : ch[f.part][f.key];
      // In the table a number is plain (no commas), as ArcGIS reads it.
      row[f.csv] = v === null ? '' : (f.kind === 'int' || f.kind === 'num') && /^[\d,.]+$/.test(v) ? v.replace(/,/g, '') : v;
    }
    row.us_flocks = ch.nat.flocks === null ? '' : ch.nat.flocks.replace(/,/g, '');
    // A cell starting with =, +, -, @, a tab or a carriage return would open as a spreadsheet formula: a single quote
    // before it keeps it words.
    const cell = v => {
      const w = /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
      return /[",\r\n]/.test(w) || w !== v ? '"' + w.replace(/"/g, '""') + '"' : w;
    };
    const blanks = ARC_COLS.filter(k => !row[k]).length;
    return { csv: ARC_COLS.join(',') + '\r\n' + ARC_COLS.map(k => cell(String(row[k] || ''))).join(',') + '\r\n', blanks };
  }
  // A link prints as a link only with an address the browser opens (http or https); otherwise its words print alone.
  const opens = url => /^https?:\/\/[^\s<>"]+$/i.test(url);
  const empty = m => !trim(m.headline) && !trim(m.text);

  function milkOf(text, type) {
    const stages = type.report.milk || [];
    if (text.milk === 'own') return { stage: trim(text.milkOwn.stage), text: trim(text.milkOwn.text) };
    return stages[text.milk] || stages[0] || { stage: '', text: '' };
  }
  function choices(text, type, pics) {
    return { page2: text.p2 && type.report.page2 ? page2Choices(text.p2, type.report, pics) : null, status: text.status || undefined, own: text.own, milk: milkOf(text, type), suspected: !!text.suspected,
      mapLook: text.mapLook === 'counties' ? 'counties' : 'dots', note: trim(text.note), iconStyle: text.iconStyle === 'outline' ? 'outline' : 'filled',
      // An empty message is left off the pages; a link with neither words nor an address is none.
      messages: text.messages.filter(m => !empty(m)).map(m => {
        const label = trim(m.link.label), url = trim(m.link.url);
        return { headline: trim(m.headline), icon: m.icon, text: trim(m.text), highlight: !!m.highlight,
          link: !label && !url ? null : { label: label || url, url: opens(url) ? url : null } };
      }),
      // The title's line and every page's foot; the DRAFT mark until "Ready to send".
      page: { note: trim(text.heading), hotline: { ask: trim(text.hotline.ask), name: trim(text.hotline.name), number: trim(text.hotline.number) },
        online: { label: trim(text.online.label) || trim(text.online.url), url: opens(trim(text.online.url)) ? trim(text.online.url) : null },
        alternate: trim(text.alternate) },
      draft: !text.ready };
  }
  // The cards as they printed (report-view.js draw's cards): each message's lines, a hint for a card much longer than
  // the one beside it (twice as long and at least four lines more: the short one is left with an empty bottom), and the
  // pages the messages print on. A hint, not a "Check": the pages are right either way.
  const pagesWords = ps => ps.length === 1 ? 'page ' + ps[0] : ps.length === 2 ? 'pages ' + ps[0] + ' and ' + ps[1]
    : 'pages ' + ps[0] + ' to ' + ps[ps.length - 1];
  function layoutOf(text, cards) {
    const printed = [];   // a printed message's index among the form's messages
    text.messages.forEach((m, i) => { if (!empty(m)) printed.push(i); });
    const lines = text.messages.map(() => null), pairs = text.messages.map(() => '');
    const at = c => c.m === 'lv' ? null : printed[c.m];
    for (const c of cards) if (at(c) !== null && at(c) !== undefined) lines[at(c)] = c.lines;
    for (const c of cards) {
      const i = at(c), other = cards.find(o => o !== c && o.row === c.row);
      if (i === null || i === undefined || !other) continue;
      if (c.lines >= 2 * other.lines && c.lines - other.lines >= 4) {
        pairs[i] = 'Message ' + (i + 1) + ' runs about ' + c.lines + ' lines, the card beside it ' + other.lines + ' (' +
          (other.m === 'lv' ? 'the livestock card' : 'message ' + (at(other) + 1)) + '): shorten it, or move the messages so the long ones sit together.';
      }
    }
    const ps = [...new Set(cards.filter(c => c.m !== 'lv').map(c => c.page))];
    return { lines, pairs, pages: ps };
  }

  // ---- The saved report text ----
  // One small file: the kind and version first, so a file that is not one is told apart; nothing from the table.
  const KIND = 'WSDA Emergency Response report text', VERSION = 1, LONGEST = 5000, MOST = 60;
  // Page 2's figures are kept for the report's date and, to compare with next month, the month before's (past: the two
  // latest reports' figures, this one first).
  const KEEP_PAST = 2;
  function toFile(text, type, date, today) {
    const keep = {};
    for (const k of Object.keys(fresh(type))) if (k !== 'type') keep[k] = text[k];
    if (text.p2) {
      keep.past = [{ date, values: figuresOf(text.p2) }].concat((text.past || []).filter(p => p.date !== date))
        .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, KEEP_PAST);
    }
    return JSON.stringify({ kind: KIND, version: VERSION, type: type.id, reportDate: date, saved: today, text: keep }, null, 2) + '\n';
  }
  // Page 2 read back from a saved report text: each value checked as words (the update's own kept, or left empty, when
  // it is not), the lists and categories as lists. The month's figures are left empty unless the file is for the
  // report's date (same), so last month's number never prints as this month's; they are kept in past to compare with.
  function readPage2(got, t, notes, words1, same) {
    if (!got || typeof got !== 'object') return t;
    for (const f of FIELDS) {
      const from = got[f.part] && typeof got[f.part] === 'object' ? got[f.part][f.key] : undefined;
      if (figure(f) && !same) continue;
      t[f.part][f.key] = words1(from, 'Page 2\'s "' + f.label + '"', t[f.part][f.key]);
    }
    if (same && got.wild && typeof got.wild === 'object') for (const k of ['d30None', 'm30None']) t.wild[k] = got.wild[k] === true;
    const tests = got.tests && typeof got.tests === 'object' ? got.tests : {};
    t.tests.intro = words1(tests.intro, 'WADDL\'s sentence', t.tests.intro);
    if (Array.isArray(tests.cats)) {
      t.tests.cats = tests.cats.slice(0, MOST).filter(c => c && typeof c === 'object').map((c, i) => ({
        name: words1(c.name, 'Category ' + (i + 1) + '\'s name', ''), n: same ? words1(c.n, 'Category ' + (i + 1) + '\'s tests', '') : '' }));
    } else if (tests.cats !== undefined) notes.push('WADDL\'s categories were not a list: the update\'s own kept.');
    const linkList = (list, at) => list.slice(0, MOST).filter(l => l && typeof l === 'object')
      .map((l, i) => ({ label: words1(l.label, at + ', link ' + (i + 1) + '\'s words', ''), url: words1(l.url, at + ', link ' + (i + 1) + '\'s address', '') }));
    for (const k of ['testingLists', 'resources']) {
      if (got[k] === undefined) continue;
      if (!Array.isArray(got[k])) { notes.push((k === 'resources' ? 'The resources lists' : 'WADDL\'s lists') + ' were not a list: the update\'s own kept.'); continue; }
      t[k] = t[k].map((own, g) => Array.isArray(got[k][g]) ? linkList(got[k][g], (k === 'resources' ? 'Resources list ' : 'WADDL\'s list ') + (g + 1)) : own);
    }
    if (Array.isArray(got.call)) {
      t.call = t.call.map((own, i) => {
        const c = got.call[i] && typeof got.call[i] === 'object' ? got.call[i] : {}, at = '"Report sick birds" part ' + (i + 1);
        return { headline: words1(c.headline, at + '\'s headline', own.headline), text: words1(c.text, at + '\'s words', own.text),
          label: words1(c.label, at + '\'s link words', own.label), url: words1(c.url, at + '\'s address', own.url) };
      });
    }
    return t;
  }
  // The months kept to compare with: a date and its figures as words, each checked.
  function readPast(list, notes) {
    if (list === undefined) return [];
    if (!Array.isArray(list)) { notes.push('Last month\'s figures were not a list: nothing to compare with.'); return []; }
    const keys = FIELDS.filter(kept).map(f => f.part + '.' + f.key);
    return list.slice(0, KEEP_PAST).filter(p => p && typeof p === 'object' && typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) &&
      p.values && typeof p.values === 'object').map(p => {
      const values = {};
      for (const k of keys) if (typeof p.values[k] === 'string') values[k] = p.values[k].slice(0, 40);
      values.cats = {};
      if (p.values.cats && typeof p.values.cats === 'object') {
        for (const [k, v] of Object.entries(p.values.cats).slice(0, MOST)) if (typeof v === 'string') values.cats[k.slice(0, 200)] = v.slice(0, 40);
      }
      return { date: p.date, values };
    });
  }
  // date: the report's date on the page (a file for that date keeps page 2's figures too).
  function fromFile(words, type, date) {
    let o;
    try { o = JSON.parse(words); } catch (e) { o = null; }
    if (!o || typeof o !== 'object' || o.kind !== KIND || !Number.isInteger(o.version) || o.version < 1) {
      return { error: 'This file is not a report text saved from this page.' };
    }
    if (o.version > VERSION) return { error: 'This report text was saved by a newer version of the page: open it there.' };
    if (o.type !== type.id) return { error: 'This report text is for another emergency type (' + String(o.type).slice(0, 40) + '), not ' + type.name + '.' };
    const t = fresh(type), got = o.text && typeof o.text === 'object' ? o.text : {}, notes = [];
    const words1 = (v, at, fallback) => {
      if (v === undefined) return fallback;
      if (typeof v !== 'string') { notes.push(at + ' was not words: ' + (fallback ? 'the update\'s own kept.' : 'left empty.')); return fallback; }
      return v.slice(0, LONGEST);
    };
    // A choice: one of the page's (list, each with the words the form shows it by), else the update's own.
    const one = (v, list, at, fallback) => {
      if (v === undefined) return fallback;
      if (list.some(([k]) => k === v)) return v;
      notes.push(at + ' is not one this page knows: ' + list.find(([k]) => k === fallback)[1] + ' instead.');
      return fallback;
    };
    const messages = (list, at, whole) => {
      if (list === undefined) return null;
      if (!Array.isArray(list)) { notes.push(whole + ' were not a list: ' + (at === 'Message' ? 'the update\'s own kept.' : 'none kept.')); return null; }
      return list.slice(0, MOST).filter(m => m && typeof m === 'object').map((m, i) => {
        const out = message({ headline: words1(m.headline, at + ' ' + (i + 1) + '\'s headline', ''), text: words1(m.text, at + ' ' + (i + 1) + '\'s words', ''),
          icon: m.icon, highlight: m.highlight === true,
          link: m.link && typeof m.link === 'object' ? { label: words1(m.link.label, at + ' ' + (i + 1) + '\'s link words', ''),
            url: words1(m.link.url, at + ' ' + (i + 1) + '\'s address', '') } : null });
        if (m.icon !== undefined && m.icon !== out.icon) notes.push(at + ' ' + (i + 1) + '\'s icon is not one of the page\'s: Information instead.');
        return out;
      });
    };
    t.status = one(got.status, [[null, 'the wording that fits the data'], ['free', 'the "free" wording'], ['active', 'the "active" wording'],
      ['own', 'your own']], 'The status choice', null);
    t.own = words1(got.own, 'The status sentence', '');
    const stages = (type.report.milk || []).length;
    if (got.milk === 'own' || (Number.isInteger(got.milk) && got.milk >= 0 && got.milk < stages)) t.milk = got.milk;
    else if (got.milk !== undefined) notes.push('The milk testing stage saved is not one of this page\'s: "' + ((type.report.milk || [])[0] || {}).stage + '" instead.');
    const mo = got.milkOwn && typeof got.milkOwn === 'object' ? got.milkOwn : {};
    t.milkOwn = { stage: words1(mo.stage, 'The milk stage of your own', ''), text: words1(mo.text, 'The milk stage\'s sentence', '') };
    t.suspected = got.suspected === true;
    t.mapLook = one(got.mapLook, [['dots', 'Soft dots'], ['counties', 'Counties shaded']], 'The map\'s look', 'dots');
    t.note = words1(got.note, 'The note', '');
    t.iconStyle = one(got.iconStyle, [['filled', 'Filled'], ['outline', 'Outline']], 'The icon style', 'filled');
    t.messages = messages(got.messages, 'Message', 'The key messages') || t.messages;
    t.aside = messages(got.aside, 'Set-aside message', 'The messages set aside') || [];
    t.heading = words1(got.heading, 'The line under the title', t.heading);
    for (const [k, at] of [['ask', 'The hotline\'s question'], ['name', 'The hotline\'s name'], ['number', 'The hotline\'s number']]) {
      t.hotline[k] = words1(got.hotline && got.hotline[k], at, t.hotline[k]);
    }
    t.online = { label: words1(got.online && got.online.label, 'The "report online" words', t.online.label),
      url: words1(got.online && got.online.url, 'The "report online" address', t.online.url) };
    t.alternate = words1(got.alternate, 'The alternate-format line', t.alternate);
    const dayOf = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    const reportDate = dayOf(o.reportDate), same = !!(date && reportDate === date);
    if (t.p2) {
      t.p2 = readPage2(got.p2, t.p2, notes, words1, same);
      t.past = readPast(got.past, notes);
      t.pastLoaded = true;
    }
    return { text: t, notes, saved: dayOf(o.saved), reportDate, cleared: !!t.p2 && !same };
  }

  function messageWarns(m, i) {
    const out = [], url = trim(m.link.url);
    if (empty(m)) out.push('Message ' + (i + 1) + ' is empty, so it is left off the pages: write it, or remove it.');
    if (url && !opens(url)) out.push('This address does not start with https:// (or http://), so it would not open: it prints as words only. Copy it from the browser\'s address bar.');
    if (!url && trim(m.link.label)) out.push('The link has words but no address: it prints as words only.');
    return out;
  }

  // The status sentence is checked against the active flocks (report.js statusFits); the milk testing stage gets a
  // reminder while the livestock kind has active cases; staff's own sentence is not checked, the data's line beside it.
  function checks(text, type, f, date, cards, pics) {
    const rp = type.report, words = k => rp.cases[k.key] || [k.label.toLowerCase() + ' case', k.label.toLowerCase() + ' cases'];
    const when = RP.dateLong(date);
    const picked = text.status || (f.flocks.active ? 'active' : 'free');
    const dataLine = 'From the data on ' + when + ': ' + f.kinds.map(k => many(k.active, 'active ' + words(k)[0], 'active ' + words(k)[1]))
      .join(', ') + '; surveillance areas around ' + many(f.zones.active, 'case', 'cases') + '.';
    let statusWarn = '';
    if (picked === 'own') {
      if (!trim(text.own)) statusWarn = 'Write the sentence, or pick an approved wording.';
    } else if (RP.statusFits(picked, f) === false) {
      statusWarn = picked === 'free'
        ? 'The data has ' + many(f.flocks.active, 'active ' + words(f.kinds[0])[0], 'active ' + words(f.kinds[0])[1]) + ' on ' + when +
          ': this wording says there are none. Pick the other wording, or write your own.'
        : 'The data has no active ' + words(f.kinds[0])[1] + ' on ' + when + ': this wording says there are some. Pick the other wording, or write your own.';
    }
    const lk = rp.livestock && f.kinds.find(k => k.key === rp.livestock);
    let milkWarn = '';
    if (lk && lk.active) milkWarn = many(lk.active, 'active ' + words(lk)[0], 'active ' + words(lk)[1]) + ' on ' + when + ': check the milk testing stage.';
    if (lk && text.milk === 'own' && (!trim(text.milkOwn.stage) || !trim(text.milkOwn.text))) milkWarn = (milkWarn ? milkWarn + ' ' : '') + 'Write the stage and its sentence.';
    const statusTag = statusWarn || milkWarn ? { words: 'Check', how: WARN }
      : picked === 'own' ? { words: 'Your own wording', how: '' } : { words: 'Matches the data', how: OK };
    const fl = f.flocks;
    const auto = 'Filled in from the file, never typed: ' + many(fl.commercial, 'commercial flock', 'commercial flocks') + ', ' +
      many(fl.backyard, 'backyard flock', 'backyard flocks') + ', ' + f.birds.toLocaleString('en-US') + ' ' + type.kinds[0].label.toLowerCase() +
      ' affected, ' + many(f.countiesAffected, 'county', 'counties') + '; the cases by county; ' +
      many(f.thisYear.length, 'detection', 'detections') + ' in ' + f.year + '; the map.';
    const out = {
      date: { tag: { words: when, how: '' } },
      status: { tag: statusTag, statusWarn, milkWarn, dataLine, picked },
      data: { tag: { words: 'Automatic', how: OK }, auto },
      boxes: (() => {
        const warns = [];
        if (!trim(text.hotline.number)) warns.push('The hotline has no number: the foot prints without one.');
        if (trim(text.online.url) && !opens(trim(text.online.url))) warns.push('The address after "report online at" does not start with https:// (or http://), so it would not open: it prints as words only.');
        if (!trim(text.online.url)) warns.push('"Report online at" has no address: it prints as words only.');
        // Page 2's box and the resources lists: an address that would not open prints as words only.
        if (text.p2) {
          text.p2.call.forEach((c, i) => {
            if (trim(c.url) && !opens(trim(c.url))) warns.push('The "Report sick birds" box, part ' + (i + 1) + ': its address does not start with https://, so it would not open.');
          });
          (type.report.page2 ? type.report.page2.resources : []).forEach((g, gi) => (text.p2.resources[gi] || []).forEach((l, i) => {
            if (trim(l.url) && !opensLink(trim(l.url))) warns.push(g.name + ', link ' + (i + 1) + ' ("' + trim(l.label).slice(0, 40) + '"): its address would not open, so it prints as words only.');
          }));
        }
        return { warns, tag: warns.length ? { words: 'Check', how: WARN } : { words: 'Kept month to month', how: '' } };
      })(),
      messages: (() => {
        const warns = text.messages.map(messageWarns), n = warns.filter(w => w.length).length;
        return Object.assign(layoutOf(text, cards || []), { warns, tag: n ? { words: 'Check: ' + many(n, 'message', 'messages'), how: WARN }
          : { words: text.messages.length ? many(text.messages.length, 'message', 'messages') : 'No messages', how: '' } });
      })()
    };
    // Page 2's folds (2.9): each box checked, the counts in the heading.
    if (text.p2) {
      out.page2 = page2Checks(text, date, pics);
      out.nat = { tag: out.page2.nat.tag };
      out.wild = { tag: out.page2.wild.tag };
    }
    // The folds that say "Check", for the line beside "Ready to send".
    const NAMES = { status: 'Washington: the status', messages: 'Key messages', nat: 'National (USDA)', wild: 'Wild birds and testing (WADDL)',
      boxes: 'Boxes and resources' };
    out.checking = Object.keys(NAMES).filter(k => out[k] && out[k].tag.how === WARN).map(k => NAMES[k]);
    return out;
  }

  // ---- The form on the page ----
  const ids = doc => id => doc.getElementById(id);
  // A box of words as tall as its words (a shown one: a hidden one, or one in a closed fold, has no height yet; it
  // grows when its fold opens).
  const grow = el => { if (!el.offsetParent) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };
  const TEXTS = ['rp-own', 'rp-milk-text', 'rp-note-in', 'rp-heading', 'rp-alternate'];
  // The boxes' fields: each id and where its words go in the report text.
  const BOXES = [['rp-heading', ['heading']], ['rp-hot-ask', ['hotline', 'ask']], ['rp-hot-name', ['hotline', 'name']],
    ['rp-hot-number', ['hotline', 'number']], ['rp-online-label', ['online', 'label']], ['rp-online-url', ['online', 'url']],
    ['rp-alternate', ['alternate']]];
  const growAll = doc => {
    for (const id of TEXTS) grow(doc.getElementById(id));
    doc.querySelectorAll('#rp-msgs textarea, #rp-wild textarea, #rp-p2-boxes textarea').forEach(grow);
  };
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---- The key messages' list ----
  // Drawn again only when its shape changes (list.dirty) or for another report text (list.of), so a box being typed in
  // keeps its place. One icon list is open at a time (list.picking, the message's index); list.focus is the control
  // to give the focus back to after a drawing; list.removed the last message removed, for "Undo".
  const list = { of: null, dirty: true, picking: -1, focus: null, removed: null };
  function messageHtml(m, i, n, style) {
    const at = 'rp-m' + i + '-', no = i + 1;
    const btn = (act, words, label, off) => '<button type="button" class="mini" data-act="' + act + '" aria-label="' + label + '" title="' + label + '"' +
      (off ? ' disabled' : '') + '>' + words + '</button>';
    let h = '<div class="rp-msg' + (m.highlight ? ' hl' : '') + '" data-i="' + i + '"><div class="top"><span>Message ' + no + '</span><span class="sp"></span>' +
      '<label class="radio" title="Shade this card on the page"><input type="checkbox" data-f="highlight"' + (m.highlight ? ' checked' : '') +
      '><span>Highlight</span></label>' +
      btn('up', '&uarr;', 'Move message ' + no + ' up', i === 0) + btn('down', '&darr;', 'Move message ' + no + ' down', i === n - 1) +
      '<button type="button" class="mini wide" data-act="aside" title="Keep it in the saved report text, off the pages">Set aside</button>' +
      btn('remove', '&times;', 'Remove message ' + no) + '</div>' +
      '<label for="' + at + 'headline">Headline</label><input type="text" id="' + at + 'headline" data-f="headline" value="' + esc(m.headline) + '">' +
      '<span class="lab" id="' + at + 'icon-l">Icon</span><button type="button" class="rp-icon-btn" data-act="pick" aria-expanded="' +
      (list.picking === i) + '" aria-labelledby="' + at + 'icon-l ' + at + 'icon-n">' + MI.svg(m.icon, style, 20) +
      '<span id="' + at + 'icon-n">' + esc(MI.ICONS[m.icon] ? MI.ICONS[m.icon].label : m.icon) + '</span><span class="caret" aria-hidden="true">&#9662;</span></button>';
    if (list.picking === i) {
      h += '<div class="rp-picker" role="group" aria-label="Icons for message ' + no + '">' + MI.groups().map(g => '<div class="g"><b>' + esc(g.name) +
        '</b><div class="grid">' + g.icons.map(ic => '<button type="button" data-act="icon" data-key="' + ic.key + '" aria-pressed="' + (ic.key === m.icon) +
        '" aria-label="' + esc(ic.label) + '" title="' + esc(ic.label) + '">' + MI.svg(ic.key, style, 22) + '</button>').join('') + '</div></div>').join('') + '</div>';
    }
    h += '<label for="' + at + 'text">Words</label><textarea id="' + at + 'text" data-f="text">' + esc(m.text) + '</textarea>' +
      '<div class="row2"><div><label for="' + at + 'label">Link words (optional)</label><input type="text" id="' + at + 'label" data-f="label" value="' +
      esc(m.link.label) + '"></div><div><label for="' + at + 'url">Address</label><input type="text" id="' + at + 'url" data-f="url" placeholder="https://..." value="' +
      esc(m.link.url) + '"></div></div><p class="lines" data-lines></p><div class="pair" data-pair role="status" hidden></div>' +
      '<div class="warning" data-warn role="status" hidden></div></div>';
    return h;
  }
  function drawList(doc, text) {
    const box = doc.getElementById('rp-msgs'), n = text.messages.length;
    box.innerHTML = text.messages.map((m, i) => messageHtml(m, i, n, text.iconStyle)).join('');
    const aside = doc.getElementById('rp-aside');
    aside.hidden = !text.aside.length;
    aside.innerHTML = text.aside.length ? '<b>Set aside</b> (kept in the saved report text, not printed)<ul>' + text.aside.map((m, j) =>
      '<li>' + MI.svg(m.icon, text.iconStyle, 16) + '<span>' + esc(trim(m.headline) || trim(m.text).slice(0, 60) || 'An empty message') +
      '</span><button type="button" class="mini wide" data-back="' + j + '">Put back</button></li>').join('') + '</ul>' : '';
    list.of = text;
    list.dirty = false;
    if (list.focus) {
      const el = doc.querySelector(list.focus);
      if (el) el.focus();
      list.focus = null;
    }
  }
  function wireList(doc, get, changed) {
    const box = doc.getElementById('rp-msgs'), redraw = focus => { list.dirty = true; list.focus = focus; changed(false); };
    const at = el => { const m = el.closest('.rp-msg'); return m ? +m.dataset.i : -1; };
    box.addEventListener('input', e => {
      const i = at(e.target), f = e.target.dataset.f, m = get().messages[i];
      if (!m || !f) return;
      if (f === 'label' || f === 'url') m.link[f] = e.target.value;
      else if (f === 'highlight') return;   // a tick: its change below
      else m[f] = e.target.value;
      if (e.target.tagName === 'TEXTAREA') grow(e.target);
      changed(true);
    });
    box.addEventListener('change', e => {
      if (e.target.dataset.f !== 'highlight') return;
      const m = get().messages[at(e.target)];
      if (m) {
        m.highlight = e.target.checked;
        e.target.closest('.rp-msg').classList.toggle('hl', m.highlight);
        changed(false);
      }
    });
    box.addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const ms = get().messages, i = at(b), sel = (j, act) => '#rp-msgs .rp-msg[data-i="' + j + '"] [data-act="' + act + '"]';
      if (b.dataset.act === 'up' || b.dataset.act === 'down') {
        const j = b.dataset.act === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= ms.length) return;
        [ms[i], ms[j]] = [ms[j], ms[i]];
        list.picking = -1;
        redraw(sel(j, j === 0 || j === ms.length - 1 ? (j === 0 ? 'down' : 'up') : b.dataset.act));
      } else if (b.dataset.act === 'aside') {
        get().aside.push(ms.splice(i, 1)[0]);
        list.picking = -1;
        redraw('#rp-aside [data-back="' + (get().aside.length - 1) + '"]');
      } else if (b.dataset.act === 'remove') {
        list.removed = { m: ms.splice(i, 1)[0], i };
        list.picking = -1;
        redraw(ms.length ? sel(Math.min(i, ms.length - 1), 'remove') : '#rp-msg-undo');
      } else if (b.dataset.act === 'pick') {
        list.picking = list.picking === i ? -1 : i;
        redraw(list.picking === i ? '#rp-msgs .rp-picker [aria-pressed="true"]' : sel(i, 'pick'));
      } else if (b.dataset.act === 'icon') {
        ms[i].icon = b.dataset.key;
        list.picking = -1;
        redraw(sel(i, 'pick'));
      }
    });
    // Escape closes the icon list, back on its button.
    box.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || list.picking < 0 || !e.target.closest('.rp-picker')) return;
      const i = list.picking;
      list.picking = -1;
      redraw('#rp-msgs .rp-msg[data-i="' + i + '"] [data-act="pick"]');
    });
    // "Put back": a message set aside goes back at the end of the list.
    doc.getElementById('rp-aside').addEventListener('click', e => {
      const b = e.target.closest('button[data-back]'), t = get();
      if (!b || !t.aside[+b.dataset.back]) return;
      t.messages.push(t.aside.splice(+b.dataset.back, 1)[0]);
      list.picking = -1;
      redraw('#rp-m' + (t.messages.length - 1) + '-headline');
    });
    doc.getElementById('rp-msg-add').addEventListener('click', () => {
      const ms = get().messages;
      ms.push(message({ icon: 'information' }));
      list.removed = null;
      list.picking = -1;
      redraw('#rp-m' + (ms.length - 1) + '-headline');
    });
    doc.getElementById('rp-msg-undo').addEventListener('click', () => {
      if (!list.removed) return;
      const ms = get().messages, i = Math.min(list.removed.i, ms.length);
      ms.splice(i, 0, list.removed.m);
      list.removed = null;
      redraw('#rp-m' + i + '-headline');
    });
    doc.querySelectorAll('input[name="rp-icons"]').forEach(r => r.addEventListener('change', () => {
      get().iconStyle = r.value;
      list.dirty = true;
      changed(false);
    }));
  }

  // ---- Page 2's folds on the page (2.9) ----
  // National (USDA) and Wild birds and testing (WADDL) are made from FIELDS once for the type, and the box and the
  // resources lists go into "Boxes and resources". Each box has its line under it (data-why) for its check. The
  // categories and the link lists are drawn again only when their shape changes (p2list.dirty) or for another report
  // text, as the key messages are.
  const p2list = { of: null, dirty: true, focus: null };
  const fieldHtml = (f, label) => {
    const id = 'rp-p2-' + f.part + '-' + f.key;
    return '<div class="rp-p2f"><label for="' + id + '">' + esc(label || f.label) + '</label><input type="text" id="' + id + '" data-p2="' + f.part + '.' + f.key + '"' +
      (f.kind === 'date' ? ' placeholder="mm/dd/yyyy"' : f.kind === 'url' ? ' placeholder="https://..."' : '') +
      (f.kind === 'int' || f.kind === 'num' ? ' inputmode="decimal"' : '') + '><div class="why" data-why="' + f.part + '.' + f.key + '" role="status" hidden></div></div>';
  };
  const rowOf = (part, keys, labels) => '<div class="row2">' + keys.map(k => fieldHtml(FIELD[part + '.' + k], labels && labels[k])).join('') + '</div>';
  const fieldset = (legend, inner) => '<fieldset><legend>' + esc(legend) + '</legend>' + inner + '</fieldset>';
  function build(doc, type) {
    const p = type.report.page2, nat = doc.getElementById('rp-nat');
    if (nat.dataset.built === type.id) return;
    nat.dataset.built = type.id;
    nat.innerHTML = '<p class="rp-cmp" id="rp-p2-cmp"></p>' + rowOf('nat', ['asOf', 'source']) +
      fieldset('Since the outbreak began', rowOf('nat', ['birds', 'states', 'commercial', 'backyard', 'territories']) + '<div class="auto" id="rp-p2-flocks"></div>') +
      fieldset('Domestic flocks, last 30 days', rowOf('nat', ['c30', 'b30', 'birds30', 'regional30', 'lastFlock'])) +
      fieldset('Domestic livestock, last 30 days', rowOf('nat', ['lvStates', 'lvCases', 'lvRegional', 'lastLivestock']) + rowOf('nat', ['lvSource', 'sequencing'])) +
      fieldset('USDA\'s maps, last 30 days', '<div id="rp-pics"></div><input type="file" id="rp-pic-file" accept="image/*" hidden>' +
        '<p class="hint">A picture of each map from USDA\'s page (a screenshot). Pictures are not kept in the saved report text: each month starts without them.</p>');
    const tick = (key, words) => '<label class="radio"><input type="checkbox" id="rp-p2-wild-' + key + '" data-p2tick="wild.' + key + '"><span>' + words + '</span></label>';
    const listEditor = (name, at) => fieldset(name, '<div class="rp-linkhead" aria-hidden="true"><span>Words</span><span>Address</span></div><div data-list="' + at + '"></div>' +
      '<button type="button" class="btn rp-add" data-list-add="' + at + '">+ Add a link</button>');
    doc.getElementById('rp-wild').innerHTML = fieldset('Washington: wild birds and wild mammals', rowOf('wild', ['since', 'window', 'd30', 'm30']) +
      tick('d30None', 'No wild bird detections reported in the last 30 days') + tick('m30None', 'No wild mammal detections reported in the last 30 days')) +
      fieldset('Testing (WADDL)', rowOf('tests', ['asOf', 'total'], { total: 'PCR tests since ' + p.testing.since }) +
        '<label for="rp-p2-intro">WADDL\'s sentence</label><textarea id="rp-p2-intro"></textarea>' +
        '<span class="lab">Tests by category</span><div id="rp-cats"></div><button type="button" class="btn rp-add" id="rp-cat-add">+ Add a category</button>' +
        '<p class="hint">Printed largest first, "Not specified" last in gray. The bars are not added up into the total: WADDL gives each.</p>') +
      p.testing.lists.map((g, i) => listEditor(g.name, 'testingLists.' + i)).join('');
    doc.getElementById('rp-p2-boxes').innerHTML = fieldset('"Report sick birds" box', p.call.map((c, i) => {
      const at = 'rp-p2-call' + i + '-';
      return '<div class="rp-msg"><div class="top"><span>Part ' + (i + 1) + '</span></div>' +
        '<label for="' + at + 'headline">Headline</label><input type="text" id="' + at + 'headline" data-call="' + i + '.headline">' +
        '<label for="' + at + 'text">Words</label><textarea id="' + at + 'text" data-call="' + i + '.text"></textarea>' +
        '<div class="row2"><div><label for="' + at + 'label">Link words</label><input type="text" id="' + at + 'label" data-call="' + i + '.label"></div>' +
        '<div><label for="' + at + 'url">Address</label><input type="text" id="' + at + 'url" data-call="' + i + '.url" placeholder="https://..."></div></div>' +
        (i === 0 ? '<p class="hint">The hotline\'s name and number follow, from above.</p>' : '') + '</div>';
    }).join('')) + fieldset('Resources', p.resources.map((g, i) => '<div class="rp-sub"><span class="lab">' + esc(g.name) + '</span>' +
      '<div class="rp-linkhead" aria-hidden="true"><span>Words</span><span>Address</span></div><div data-list="resources.' + i + '"></div>' +
      '<button type="button" class="btn rp-add" data-list-add="resources.' + i + '">+ Add a link</button></div>').join('') +
      '<p class="hint">The lists\' headings stay as they are. An address that would not open says "Check".</p>');
    p2list.dirty = true;
    pics.dirty = true;
  }
  function drawP2Lists(doc, text) {
    const p2 = text.p2, btn = (act, words, label, off) => '<button type="button" class="mini" data-act="' + act + '" aria-label="' + label + '" title="' + label + '"' +
      (off ? ' disabled' : '') + '>' + words + '</button>';
    doc.getElementById('rp-cats').innerHTML = p2.tests.cats.map((c, i) => '<div class="rp-cat" data-i="' + i + '"><input type="text" data-k="name" aria-label="Category ' +
      (i + 1) + '" value="' + esc(c.name) + '"><input type="text" data-k="n" inputmode="numeric" aria-label="Category ' + (i + 1) + ': tests" value="' + esc(c.n) + '">' +
      btn('remove', '&times;', 'Remove category ' + (i + 1)) + '</div><div class="why" data-why="cat.' + i + '" role="status" hidden></div>').join('');
    doc.querySelectorAll('#rp-form [data-list]').forEach(box => {
      const [k, g] = box.dataset.list.split('.'), list = p2[k][+g], wordsOf = k === 'testingLists' ? 'list.' + g + '.' : null;
      box.innerHTML = list.map((l, i) => '<div class="rp-link" data-i="' + i + '"><input type="text" data-k="label" aria-label="Link ' + (i + 1) + ': words" value="' +
        esc(l.label) + '"><input type="text" data-k="url" aria-label="Link ' + (i + 1) + ': address" placeholder="https://..." value="' + esc(l.url) + '">' +
        btn('up', '&uarr;', 'Move link ' + (i + 1) + ' up', i === 0) + btn('down', '&darr;', 'Move link ' + (i + 1) + ' down', i === list.length - 1) +
        btn('remove', '&times;', 'Remove link ' + (i + 1)) + '</div>' + (wordsOf ? '<div class="why" data-why="' + wordsOf + i + '" role="status" hidden></div>' : '')).join('');
    });
    p2list.of = text;
    p2list.dirty = false;
    if (p2list.focus) {
      const el = doc.querySelector(p2list.focus);
      if (el) el.focus();
      p2list.focus = null;
    }
  }

  // ---- USDA's three pictures (2.9): picked as a file, or a snip pasted on the slot ----
  // Kept on the page only (never in the saved report text): pics[key] { url (a data: address, as the page's rules take
  // pictures), name, pasted, when }. A slot clicked waits for a paste (waiting, its key; its dashed edge); a paste with
  // no picture on the clipboard says so (notes[key]). Each slot is drawn again only when its picture changes.
  const pics = { flocks: null, livestock: null, wild: null, waiting: null, notes: {}, dirty: true, picking: null };
  const BIGGEST = 10 * 1024 * 1024;
  const picture = () => Object.fromEntries(PICS.map(([k]) => [k, pics[k]]));
  const pictureCount = () => PICS.filter(([k]) => pics[k]).length;
  function clearPictures() {
    for (const [k] of PICS) pics[k] = null;
    pics.notes = {};
    pics.dirty = true;
  }
  function slotHtml(key, name) {
    const p = pics[key];
    return '<b>' + esc(name) + '</b>' + (p ? '<img src="' + esc(p.url) + '" alt="USDA\'s map: ' + esc(name) + '"><span class="from">' +
      esc(p.pasted ? 'Pasted picture, ' + RP.dateLong(p.when) : p.name) + '</span>' : '') + '<span class="none" data-st></span>' +
      '<button type="button" class="btn" data-pic-act="add">' + (p ? 'Change' : 'Add USDA\'s picture') + '</button>' +
      (p ? '<button type="button" class="mini wide" data-pic-act="remove">Remove</button>' : '') + '<span class="paste" data-paste></span>';
  }
  function drawSlots(doc) {
    const box = doc.getElementById('rp-pics');
    if (pics.dirty || box.children.length !== PICS.length) {
      const focus = doc.activeElement && doc.activeElement.closest && doc.activeElement.closest('.rp-slot');
      box.innerHTML = PICS.map(([k, name]) => '<div class="rp-slot" tabindex="0" data-pic="' + k + '" role="group" aria-label="' + esc(name) +
        ': USDA\'s picture. Click here, then paste a snip with Ctrl+V">' + slotHtml(k, name) + '</div>').join('');
      pics.dirty = false;
      if (focus) { const el = box.querySelector('[data-pic="' + focus.dataset.pic + '"]'); if (el) el.focus(); }
    }
    // The words that change while staff click and paste, set in place so a button being clicked stays.
    box.querySelectorAll('.rp-slot').forEach(s => {
      const k = s.dataset.pic, wait = pics.waiting === k, note = pics.notes[k] || '', has = !!pics[k];
      s.classList.toggle('wait', wait);
      const st = s.querySelector('[data-st]'), paste = s.querySelector('[data-paste]');
      st.textContent = note || (has ? '' : wait ? 'Ready: press Ctrl+V to paste' : 'No picture yet');
      st.className = 'none' + (!note && wait && !has ? ' ready' : '');
      st.hidden = !st.textContent;
      paste.textContent = wait && has && !note ? 'Ready: press Ctrl+V to paste' : 'or click this box and paste a snip (Ctrl+V)';
      paste.hidden = wait && !has && !note;
    });
  }
  // A picture file read as a data: address; a file that is not a picture, or one too big, is refused with its reason.
  function readPicture(doc, key, file, pasted, today, changed) {
    if (!file || !/^image\//.test(file.type)) {
      pics.notes[key] = pasted ? 'The clipboard holds no picture' + (file ? '' : ' (it has words)') + '. Snip USDA\'s map first: on Windows, Win+Shift+S.'
        : '"' + (file ? file.name : '') + '" is not a picture. Pick a PNG or JPG screenshot of USDA\'s map.';
      drawSlots(doc);
      return;
    }
    if (file.size > BIGGEST) {
      pics.notes[key] = 'That picture is too big (over 10 MB). Snip only the map.';
      drawSlots(doc);
      return;
    }
    const reader = new root.FileReader();
    reader.onload = () => {
      pics[key] = { url: reader.result, name: file.name || '', pasted, when: today() };
      pics.notes[key] = '';
      pics.dirty = true;
      changed(false);
    };
    reader.readAsDataURL(file);
  }

  function wirePage2(doc, get, changed, today) {
    const p2 = () => get().p2, redraw = focus => { p2list.dirty = true; p2list.focus = focus; changed(false); };
    const folds = ['rp-f-nat', 'rp-f-wild', 'rp-p2-boxes'].map(id => doc.getElementById(id));
    // Typed boxes: each by its data attribute; the categories and the lists by their row.
    const typed = e => {
      const el = e.target, t = p2();
      if (!t) return;
      if (el.dataset.p2) { const [part, key] = el.dataset.p2.split('.'); t[part][key] = el.value; }
      else if (el.id === 'rp-p2-intro') t.tests.intro = el.value;
      else if (el.dataset.call) { const [i, key] = el.dataset.call.split('.'); t.call[+i][key] = el.value; }
      else if (el.dataset.k && el.closest('.rp-cat')) t.tests.cats[+el.closest('.rp-cat').dataset.i][el.dataset.k] = el.value;
      else if (el.dataset.k && el.closest('[data-list]')) {
        const [k, g] = el.closest('[data-list]').dataset.list.split('.');
        t[k][+g][+el.closest('.rp-link').dataset.i][el.dataset.k] = el.value;
      } else return;
      if (el.tagName === 'TEXTAREA') grow(el);
      changed(true);
    };
    const ticked = e => {
      const el = e.target;
      if (!el.dataset.p2tick || !p2()) return;
      const [part, key] = el.dataset.p2tick.split('.');
      p2()[part][key] = el.checked;
      changed(false);
    };
    const clicked = e => {
      const t = p2(), b = e.target.closest('button');
      if (!t || !b) return;
      if (b.id === 'rp-cat-add') {
        t.tests.cats.push({ name: '', n: '' });
        redraw('#rp-cats .rp-cat[data-i="' + (t.tests.cats.length - 1) + '"] [data-k="name"]');
      } else if (b.dataset.listAdd) {
        const [k, g] = b.dataset.listAdd.split('.');
        t[k][+g].push({ label: '', url: '' });
        redraw('[data-list="' + b.dataset.listAdd + '"] .rp-link[data-i="' + (t[k][+g].length - 1) + '"] [data-k="label"]');
      } else if (b.dataset.act && b.closest('.rp-cat')) {
        const i = +b.closest('.rp-cat').dataset.i;
        t.tests.cats.splice(i, 1);
        redraw(t.tests.cats.length ? '#rp-cats .rp-cat[data-i="' + Math.min(i, t.tests.cats.length - 1) + '"] [data-act="remove"]' : '#rp-cat-add');
      } else if (b.dataset.act && b.closest('[data-list]')) {
        const at = b.closest('[data-list]').dataset.list, [k, g] = at.split('.'), list = t[k][+g], i = +b.closest('.rp-link').dataset.i;
        const sel = (j, act) => '[data-list="' + at + '"] .rp-link[data-i="' + j + '"] [data-act="' + act + '"]';
        if (b.dataset.act === 'remove') {
          list.splice(i, 1);
          redraw(list.length ? sel(Math.min(i, list.length - 1), 'remove') : '[data-list-add="' + at + '"]');
        } else {
          const j = b.dataset.act === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= list.length) return;
          [list[i], list[j]] = [list[j], list[i]];
          redraw(sel(j, j === 0 ? 'down' : j === list.length - 1 ? 'up' : b.dataset.act));
        }
      }
    };
    for (const f of folds) {
      f.addEventListener('input', typed);
      f.addEventListener('change', ticked);
      f.addEventListener('click', clicked);
    }
    // The pictures: "Add USDA's picture" picks a file; a click on the slot makes it wait for a paste; Remove.
    const slots = doc.getElementById('rp-f-nat'), file = () => doc.getElementById('rp-pic-file');
    slots.addEventListener('click', e => {
      const slot = e.target.closest('.rp-slot'), b = e.target.closest('button[data-pic-act]');
      if (!slot) return;
      if (b && b.dataset.picAct === 'add') { pics.picking = slot.dataset.pic; file().click(); }
      else if (b && b.dataset.picAct === 'remove') {
        pics[slot.dataset.pic] = null;
        pics.dirty = true;
        changed(false);
      } else slot.focus();
    });
    slots.addEventListener('change', e => {
      if (e.target.id !== 'rp-pic-file') return;
      const f = e.target.files[0], key = pics.picking;
      e.target.value = '';
      if (f && key) readPicture(doc, key, f, false, today, changed);
    });
    // Only the slot itself waits for a paste: a press on its button changes nothing, so the button stays where the
    // mouse is and its click is not lost.
    slots.addEventListener('focusin', e => {
      const slot = e.target.closest('.rp-slot');
      if (!slot || e.target !== slot || pics.waiting === slot.dataset.pic) return;
      pics.waiting = slot.dataset.pic;
      drawSlots(doc);
    });
    slots.addEventListener('focusout', e => {
      const slot = e.target.closest('.rp-slot');
      if (!slot || (e.relatedTarget && slot.contains(e.relatedTarget))) return;
      pics.waiting = null;
      pics.notes[slot.dataset.pic] = '';
      drawSlots(doc);
    });
    // A paste goes to the slot waiting, or else to the slot holding the focus.
    doc.addEventListener('paste', e => {
      const at = doc.activeElement && doc.activeElement.closest && doc.activeElement.closest('.rp-slot');
      const key = pics.waiting || (at ? at.dataset.pic : null);
      if (!key || !p2()) return;
      e.preventDefault();
      const items = [...((e.clipboardData && e.clipboardData.items) || [])];
      const item = items.find(i => i.kind === 'file' && /^image\//.test(i.type));
      readPicture(doc, key, item ? item.getAsFile() : items.find(i => i.kind === 'file') ? items.find(i => i.kind === 'file').getAsFile() : null, true, today, changed);
    });
  }
  function showPage2(doc, type, text, c) {
    const has = !!(text.p2 && type.report.page2);
    for (const id of ['rp-f-nat', 'rp-f-wild', 'rp-p2-boxes']) doc.getElementById(id).hidden = !has;
    if (!has) return;
    build(doc, type);
    const put = (el, v) => { if (doc.activeElement !== el && el.value !== v) el.value = v; };
    const p2 = text.p2, k = c.page2;
    doc.querySelectorAll('#rp-form [data-p2]').forEach(el => { const [part, key] = el.dataset.p2.split('.'); put(el, p2[part][key]); });
    doc.querySelectorAll('#rp-form [data-p2tick]').forEach(el => {
      const [part, key] = el.dataset.p2tick.split('.');
      el.checked = !!p2[part][key];
      const box = doc.getElementById('rp-p2-wild-' + key.replace('None', ''));
      box.disabled = el.checked;
      if (el.checked) box.value = '';
    });
    put(doc.getElementById('rp-p2-intro'), p2.tests.intro);
    doc.querySelectorAll('#rp-form [data-call]').forEach(el => { const [i, key] = el.dataset.call.split('.'); put(el, p2.call[+i][key]); });
    if (p2list.dirty || p2list.of !== text) drawP2Lists(doc, text);
    doc.querySelectorAll('#rp-cats .rp-cat').forEach(row => {
      const cat = p2.tests.cats[+row.dataset.i];
      if (cat) row.querySelectorAll('input').forEach(el => put(el, cat[el.dataset.k]));
    });
    // Each box's check: its line under it and its orange edge.
    doc.querySelectorAll('#rp-form [data-why]').forEach(el => {
      const words = k.why[el.dataset.why] || '', box = el.previousElementSibling;
      el.textContent = words;
      el.hidden = !words;
      (box && (box.classList.contains('rp-cat') || box.classList.contains('rp-link')) ? box : el.closest('.rp-p2f') || el).classList.toggle('chk', !!words);
    });
    const tag = (id, t) => { const el = doc.getElementById(id); el.textContent = t.words; el.className = 'tag' + (t.how ? ' ' + t.how : ''); };
    tag('rp-t-nat', k.nat.tag);
    tag('rp-t-wild', k.wild.tag);
    doc.getElementById('rp-p2-cmp').textContent = k.compared;
    doc.getElementById('rp-p2-flocks').textContent = k.flocksLine;
    drawSlots(doc);
  }

  function wire(doc, get, changed, today) {
    const $ = ids(doc);
    wirePage2(doc, get, changed, today || (() => new Date().toISOString().slice(0, 10)));
    doc.querySelectorAll('input[name="rp-status"]').forEach(r => r.addEventListener('change', () => {
      get().status = r.value;
      changed(false);
    }));
    $('rp-own').addEventListener('input', () => { get().own = $('rp-own').value; changed(true); });
    $('rp-milk').addEventListener('change', () => {
      const v = $('rp-milk').value;
      get().milk = v === 'own' ? 'own' : +v;
      changed(false);
    });
    $('rp-milk-stage').addEventListener('input', () => { get().milkOwn.stage = $('rp-milk-stage').value; changed(true); });
    $('rp-milk-text').addEventListener('input', () => { get().milkOwn.text = $('rp-milk-text').value; changed(true); });
    $('rp-suspected').addEventListener('change', () => { get().suspected = $('rp-suspected').checked; changed(false); });
    doc.querySelectorAll('input[name="rp-map"]').forEach(r => r.addEventListener('change', () => {
      get().mapLook = r.value;
      changed(false);
    }));
    $('rp-note-in').addEventListener('input', () => { get().note = $('rp-note-in').value; changed(true); });
    for (const [id, at] of BOXES) $(id).addEventListener('input', () => {
      const t = get();
      if (at.length === 1) t[at[0]] = $(id).value; else t[at[0]][at[1]] = $(id).value;
      changed(true);
    });
    $('rp-ready').addEventListener('change', () => { get().ready = $('rp-ready').checked; changed(false); });
    for (const id of TEXTS) $(id).addEventListener('input', () => grow($(id)));
    wireList(doc, get, changed);
    doc.querySelectorAll('.rp-fold').forEach(d => d.addEventListener('toggle', () => growAll(doc)));
    doc.defaultView.addEventListener('resize', () => growAll(doc));   // a narrower box needs more lines
  }

  function show(doc, type, text, f, date, drawn) {
    const $ = ids(doc), rp = type.report, c = checks(text, type, f, date, drawn && drawn.cards, pictureCount());
    const put = (el, v) => { if (doc.activeElement !== el && el.value !== v) el.value = v; };
    const tag = (id, t) => { const el = $(id); el.textContent = t.words; el.className = 'tag' + (t.how ? ' ' + t.how : ''); };
    const warn = (id, words) => { $(id).textContent = words; $(id).hidden = !words; };
    tag('rp-t-date', c.date.tag);
    tag('rp-t-status', c.status.tag);
    tag('rp-t-data', c.data.tag);
    $('rp-data-line').textContent = c.status.dataLine;
    $('rp-w-free').textContent = '"' + rp.status.free + '"';
    $('rp-w-active').textContent = '"' + rp.status.active + '"';
    doc.querySelectorAll('input[name="rp-status"]').forEach(r => { r.checked = r.value === c.status.picked; });
    $('rp-own').hidden = c.status.picked !== 'own';
    put($('rp-own'), text.own);
    warn('rp-status-warn', c.status.statusWarn);
    // The milk testing stage and "suspected" go with the livestock card: shown only for a type with one.
    $('rp-livestock').hidden = !rp.livestock;
    const sel = $('rp-milk'), stages = rp.milk || [];
    if (sel.options.length !== stages.length + 1) {
      sel.replaceChildren(...stages.map((m, i) => new root.Option(m.stage, String(i))), new root.Option('Write my own', 'own'));
    }
    sel.value = text.milk === 'own' ? 'own' : String(stages[text.milk] ? text.milk : 0);
    $('rp-milk-own').hidden = text.milk !== 'own';
    put($('rp-milk-stage'), text.milkOwn.stage);
    put($('rp-milk-text'), text.milkOwn.text);
    warn('rp-milk-warn', c.status.milkWarn);
    $('rp-suspected').checked = !!text.suspected;
    $('rp-data-auto').textContent = c.data.auto;
    doc.querySelectorAll('input[name="rp-map"]').forEach(r => { r.checked = r.value === (text.mapLook === 'counties' ? 'counties' : 'dots'); });
    put($('rp-note-in'), text.note);
    // The key messages: the list drawn again when its shape changed; each message's warnings; "Undo" while there is
    // a message to put back.
    tag('rp-t-msgs', c.messages.tag);
    if (list.of !== text) { list.picking = -1; list.removed = null; }
    $('rp-msg-undo').hidden = !list.removed;
    if (list.removed) $('rp-msg-undo').textContent = 'Undo: put message ' + (list.removed.i + 1) + ' back';
    if (list.dirty || list.of !== text) drawList(doc, text);
    doc.querySelectorAll('#rp-msgs .rp-msg').forEach((el, i) => {
      const w = el.querySelector('[data-warn]'), words = (c.messages.warns[i] || []).join(' ');
      w.textContent = words;
      w.hidden = !words;
      const n = c.messages.lines[i], p = el.querySelector('[data-pair]');
      el.querySelector('[data-lines]').textContent = n === null ? '' : 'About ' + many(n, 'line', 'lines') + ' on the card.';
      p.textContent = c.messages.pairs[i];
      p.hidden = !c.messages.pairs[i];
    });
    // The boxes, and "Ready to send" with the folds that still say "Check".
    tag('rp-t-boxes', c.boxes.tag);
    for (const [id, at] of BOXES) put($(id), at.length === 1 ? text[at[0]] : text[at[0]][at[1]]);
    warn('rp-boxes-warn', c.boxes.warns.join(' '));
    $('rp-ready').checked = !!text.ready;
    $('rp-ready-note').textContent = text.ready ? (c.checking.length ? 'Still to check: ' + c.checking.join(', ') + '.' : '')
      : 'Every page says DRAFT until this is ticked.' + (c.checking.length ? ' Still to check: ' + c.checking.join(', ') + '.' : '');
    $('rp-ready-note').className = 'rp-ready-note' + (c.checking.length ? ' warn' : '');
    const ps = c.messages.pages;
    $('rp-msgs-where').textContent = ps.length ? 'The key messages print on ' + pagesWords(ps) + ' (' + many(drawn ? drawn.pages : 0, 'page', 'pages') + ' in all).' : '';
    doc.querySelectorAll('input[name="rp-icons"]').forEach(r => { r.checked = r.value === (text.iconStyle === 'outline' ? 'outline' : 'filled'); });
    doc.querySelectorAll('[data-icon-sample]').forEach(el => { el.innerHTML = MI.svg('shield-check', el.dataset.iconSample, 18); });
    showPage2(doc, type, text, c);
    growAll(doc);
    return c;
  }

  root.WSDA.emergencyReportForm = { fresh, choices, checks, page2Checks, arcgisFile, toFile, fromFile, wire, show, pictures: picture,
    clearPictures, dateOf, numOf, FIELDS, ARC_COLS };
})(typeof window !== 'undefined' ? window : globalThis);
