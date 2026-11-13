/* Emergency Response, the HPAI update's figures (2.9, E2): pure, on the read rules.js gives (readPositives), so the
 * unit suite and the R reference (tests/oracle/em_oracle.R) check them directly. The Report view's printed pages and
 * its "Figures" read only these, so the two always agree.
 *
 * The update counts differently from the rest of the page (the agency's own counting for the update; the original PDF the
 * source of truth when in doubt):
 *   - every row is a case, mapped or not: a row without a map point counts in the totals and in the county its County
 *     column names, and is left off only the map; a row with neither a point nor a County is "county not given";
 *   - a row detected after the report's date is left out (so a past month's update reads as it did then); a row
 *     without a readable detection date counts in every total, in no month and no year;
 *   - active or closed on the report's date as the page (rules.js isPast);
 *   - the flocks are the rows of the type's first kind (birds for HPAI), split by Flock/Herd Type (commercial,
 *     backyard, any other word as written, blank "without a type"); the other kinds are counted apart ("2 dairy
 *     herds"); a row naming two kinds is a case of each, its animals in neither (as rules.js animalTotals);
 *   - the animals affected are added up by kind over the rows counted, a blank inventory left out and counted, never
 *     zero.
 *
 *   figures(read, date, counties) -> {
 *     date, year, rows (the rows counted), later (left out: detected after the date), undated, noPoint,
 *     cases, active, flocks { total, commercial, backyard, others: [[word, n]], untyped, active,
 *       birds { commercial, backyard, rest } (the flocks' animals by type; a two-kind row's in none, a blank left out) },
 *     kinds: [{ key, label, cases, active, animals, missing }] (the type's order; every kind, with or without cases),
 *     birds (the first kind's animals), mixed { cases, animals },
 *     counties: [{ county, cases, active, flocks, washington }] (the most cases first, then by name; "county not
 *       given" and names that are not Washington counties last), countiesAffected (Washington's counties among them),
 *     thisYear: [{ detected, county, size, flockType, species, active }] (detected in the date's year, oldest first),
 *     listed: every row counted in the same shape, with lon, lat (null without a point) and flock (a row of the first
 *       kind); oldest first, the undated last,
 *     last (the latest detection date, or null), daysSince (from it to the date, or null),
 *     byMonth: [{ month (YYYY-MM), commercial, backyard, other }] (the first month with a detection to the date's
 *       month; other: every row that is not a commercial or backyard flock),
 *     zones { active (the active rows with a map point: each has zones), counties },
 *     twice { premises, rows } (map points with more than one row: a premises detected more than once) }
 *   COUNTY_NOT_GIVEN, SIZE_LINE: the words the pages print.
 *   statusFits(choice, f) -> true when the status wording picked fits the data, false when it does not, null for "own"
 *     (staff's own words, not checked). The sentence is about domestic flocks ("free of highly pathogenic avian
 *     influenza in domestic flocks"), so it is checked against the active flocks: "free" none, "active" one or more; an
 *     active herd or other animal is the livestock sentence's.
 *   daysBetween(a, b) -> whole days from a to b (YYYY-MM-DD, worked out with Date.UTC).
 *   spread(f, counties) -> the printed map's dots: [{ county, lon, lat, active }], one per case of a Washington county,
 *     inside the county but never at the case's point, the same at every drawing (the update is public).
 *   wording(f, type, choices, countyCount) -> page 1's words: { since, banner { active, headline, line }, tiles [{ label,
 *     value, sub, active }], also (the other kinds, named only when there are any), source, zones, livestock { highlight,
 *     headline, text, stage, stageText, others } or null, status }; from the figures, the type's report words and staff's
 *     choices (status, own, milk, suspected).
 *   dateLong, dateShort, dateTable, short: the page's ways of writing a date ("September 1, 2026", "Sep 1, 2026",
 *     "9/1/26") and a big number ("4.13M"); monthName ("October 2022").
 *   Figures (the update's figures on screen, report-figures.js): picked(f, pick) what its table lists for a county or
 *     a month clicked; places(f) the map's places (the rows with a point, one per point); hover.tile, .county, .month,
 *     .split and .place the hovers' words, each figure's number and how it is counted.
 */
(function (root) {
  'use strict';
  const E = root.WSDA.emergencyRules;
  const COUNTY_NOT_GIVEN = 'county not given';
  const SIZE_LINE = 'Small under 100 · Medium 100 to 999 · Large 1,000 or more';
  const text = v => (v === null || v === undefined ? '' : String(v).trim());

  const utc = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);

  // A row's county: the County column (rules.js countyOf: any capitals, with or without "County"), else the county of
  // its point (or the nearest within 2 km); a row with neither is "county not given".
  function countyFor(p, counties) {
    if (p.lat === null || p.lat === undefined) return text(p.county) ? E.countyOf(p, counties) : COUNTY_NOT_GIVEN;
    return E.countyOf(p, counties);
  }

  // The months from the first to the last, as YYYY-MM.
  function monthsBetween(first, last) {
    const out = [];
    let y = +first.slice(0, 4), m = +first.slice(5, 7);
    const endY = +last.slice(0, 4), endM = +last.slice(5, 7);
    while (y < endY || (y === endY && m <= endM)) {
      out.push(y + '-' + String(m).padStart(2, '0'));
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }

  function figures(read, date, counties) {
    const type = read.type, kinds = type.kinds, first = kinds[0].key;
    const all = read.positives.concat(read.dropped || []);
    const rows = all.filter(p => !p.detected || p.detected <= date);
    const washington = new Set((counties || []).map(f => f.properties.name));
    const isActive = p => !E.isPast(p, date);
    const year = date.slice(0, 4);

    // The kinds, the flocks and the animals.
    const byKind = kinds.map(k => ({ key: k.key, label: k.label, cases: 0, active: 0, animals: 0, missing: 0 }));
    const flocks = { total: 0, commercial: 0, backyard: 0, others: new Map(), untyped: 0, active: 0 };
    const flockBirds = { commercial: 0, backyard: 0, rest: 0 };
    const mixed = { cases: 0, animals: 0 };
    const flockTypeOf = p => text(p.flockType).toLowerCase();
    for (const p of rows) {
      const k = E.kindOf(type, p), active = isActive(p);
      k.indices.forEach(i => {
        byKind[i].cases++;
        if (active) byKind[i].active++;
      });
      if (k.mixed) {
        mixed.cases++;
        if (p.inventory !== null) mixed.animals += p.inventory;
      } else if (p.inventory === null) byKind[k.index].missing++;
      else byKind[k.index].animals += p.inventory;
      if (!E.kindKeysOf(type, p).includes(first)) continue;
      flocks.total++;
      if (active) flocks.active++;
      const t = flockTypeOf(p);
      if (!k.mixed && p.inventory !== null) flockBirds[t === 'commercial' || t === 'backyard' ? t : 'rest'] += p.inventory;
      if (t === 'commercial') flocks.commercial++;
      else if (t === 'backyard') flocks.backyard++;
      else if (t === '') flocks.untyped++;
      else flocks.others.set(text(p.flockType), (flocks.others.get(text(p.flockType)) || 0) + 1);
    }

    // The counties.
    const byCounty = new Map();
    for (const p of rows) {
      const name = countyFor(p, counties);
      const c = byCounty.get(name) || { county: name, cases: 0, active: 0, flocks: 0, washington: washington.has(name) };
      c.cases++;
      if (isActive(p)) c.active++;
      if (E.kindKeysOf(type, p).includes(first)) c.flocks++;
      byCounty.set(name, c);
    }
    const countyList = [...byCounty.values()].sort((a, b) => (b.washington - a.washington) || b.cases - a.cases ||
      (a.county < b.county ? -1 : a.county > b.county ? 1 : 0));

    // The dates: this year's detections, the last detection, the months.
    const dated = rows.filter(p => p.detected);
    const tableRow = p => ({ detected: p.detected, county: countyFor(p, counties), size: p.size, flockType: text(p.flockType),
      species: text(p.species), active: isActive(p) });
    const byDate = (a, b) => a.detected.localeCompare(b.detected) || a.line - b.line;
    const thisYear = dated.filter(p => p.detected.slice(0, 4) === year).sort(byDate).map(tableRow);
    // Every row counted as the table lists it, oldest first and the undated last, with its point when it has one and
    // whether it is a flock (Figures: a month's cases, the map's places).
    const noPoint = p => p.lat === null || p.lat === undefined;
    const listed = dated.slice().sort(byDate).concat(rows.filter(p => !p.detected).sort((a, b) => a.line - b.line)).map(p => Object.assign(tableRow(p), {
      lon: noPoint(p) ? null : p.lon, lat: noPoint(p) ? null : p.lat, flock: E.kindKeysOf(type, p).includes(first) }));
    const last = dated.length ? dated.map(p => p.detected).sort().pop() : null;
    const firstDay = dated.length ? dated.map(p => p.detected).sort()[0] : null;
    const months = firstDay ? monthsBetween(firstDay, date) : [];
    const byMonth = months.map(month => ({ month, commercial: 0, backyard: 0, other: 0 }));
    const at = new Map(months.map((m, i) => [m, i]));
    for (const p of dated) {
      const row = byMonth[at.get(p.detected.slice(0, 7))];
      if (!row) continue;   // a month outside the first detection to the report's date: in none
      const t = E.kindKeysOf(type, p).includes(first) ? flockTypeOf(p) : '';
      if (t === 'commercial') row.commercial++;
      else if (t === 'backyard') row.backyard++;
      else row.other++;
    }

    // The zones (the active rows with a map point) and the premises detected more than once (the same point).
    const zoned = rows.filter(p => p.lat !== null && p.lat !== undefined && isActive(p));
    const points = new Map();
    rows.filter(p => p.lat !== null && p.lat !== undefined).forEach(p => {
      const key = p.lat.toFixed(5) + ',' + p.lon.toFixed(5);
      points.set(key, (points.get(key) || 0) + 1);
    });
    const repeated = [...points.values()].filter(n => n > 1);

    return {
      date, year, rows, later: all.length - rows.length, undated: rows.length - dated.length,
      noPoint: rows.filter(p => p.lat === null || p.lat === undefined).length,
      cases: rows.length, active: rows.filter(isActive).length,
      flocks: { total: flocks.total, commercial: flocks.commercial, backyard: flocks.backyard,
        others: [...flocks.others].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)), untyped: flocks.untyped,
        active: flocks.active, birds: flockBirds },
      kinds: byKind, birds: byKind[0].animals, mixed,
      counties: countyList, countiesAffected: countyList.filter(c => c.washington).length,
      thisYear, listed, last, daysSince: last ? daysBetween(last, date) : null, byMonth,
      zones: { active: zoned.length, counties: new Set(zoned.map(p => countyFor(p, counties))).size },
      twice: { premises: repeated.length, rows: repeated.reduce((s, n) => s + n, 0) }
    };
  }

  function statusFits(choice, f) {
    if (choice === 'free') return f.flocks.active === 0;
    if (choice === 'active') return f.flocks.active > 0;
    return null;
  }

  // ---- The printed map's dots (never at a real place) ----
  // One dot per case of a Washington county, at a spread spot inside the county, never the case's own point: a row
  // without a point shows too, and no premises can be found from the printed page. The spots are the same at every
  // drawing (a fixed run of numbers started from the county's name); each is the farthest of six tries from the
  // county's dots before it, so they spread out. A county's active cases are its first dots.
  function inside(pt, poly) {
    let c = false;
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
      }
    }
    return c;
  }
  function spread(f, counties) {
    const byName = new Map((counties || []).map(x => [x.properties.name, x]));
    const out = [];
    for (const c of f.counties) {
      const feature = c.washington ? byName.get(c.county) : null;
      if (!feature) continue;
      const g = feature.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      const all = polys.flat(2);
      const x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
      const y0 = Math.min(...all.map(p => p[1])), y1 = Math.max(...all.map(p => p[1]));
      const k = Math.cos((y0 + y1) / 2 * Math.PI / 180) ** 2;   // a degree of longitude is shorter than one of latitude
      let seed = 1;
      for (const ch of c.county) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const mine = [];
      for (let i = 0; i < c.cases; i++) {
        let best = null, far = -1;
        for (let t = 0, got = 0; got < 6 && t < 600; t++) {
          const p = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)];
          if (!polys.some(poly => inside(p, poly))) continue;
          got++;
          const d = mine.reduce((m, q) => Math.min(m, (q[0] - p[0]) ** 2 * k + (q[1] - p[1]) ** 2), Infinity);
          if (d > far) { best = p; far = d; }
        }
        if (!best) best = polys[0][0][0];   // a county too thin to hit: its outline's first corner
        mine.push(best);
        out.push({ county: c.county, lon: best[0], lat: best[1], active: i < c.active });
      }
    }
    return out;
  }

  // ---- The page's words ----
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December'];
  const dateLong = iso => MONTHS[+iso.slice(5, 7) - 1] + ' ' + +iso.slice(8, 10) + ', ' + iso.slice(0, 4);
  const dateShort = iso => MONTHS[+iso.slice(5, 7) - 1].slice(0, 3) + ' ' + +iso.slice(8, 10) + ', ' + iso.slice(0, 4);
  const dateTable = iso => +iso.slice(5, 7) + '/' + +iso.slice(8, 10) + '/' + iso.slice(2, 4);
  // 4,133,418 as 4.13M, 66,540 as 66,540: the tiles' short numbers.
  const short = v => v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M' : v.toLocaleString('en-US');
  const many = (v, one, more) => v.toLocaleString('en-US') + ' ' + (v === 1 ? one : more);

  // The sentences and tiles of page 1, from the figures, the type's report words (types/hpai.js report) and what staff
  // chose (choices: status 'free', 'active', 'own' with own, or null for the wording that fits the data; milk, a stage
  // of report.milk; suspected, true when suspected livestock cases are being tested). countyCount: Washington's
  // counties (39).
  function wording(f, type, choices, countyCount) {
    const rp = type.report, ch = choices || {};
    const since = f.byMonth.length ? f.byMonth[0].month.slice(0, 4) : f.year;
    const caseOf = (k, v) => {
      const w = rp.cases[k.key] || [k.label.toLowerCase() + ' case', k.label.toLowerCase() + ' cases'];
      return many(v, w[0], w[1]);
    };
    const split = f.kinds.filter(k => k.active).map(k => caseOf(k, k.active)).join(' · ');
    const status = ch.status === 'own' ? text(ch.own) : rp.status[ch.status || (f.flocks.active ? 'active' : 'free')];
    const lastLine = f.last ? 'Last detection ' + dateShort(f.last) + ', ' +
      (f.daysSince === 0 ? 'the day of this update' : many(f.daysSince, 'day', 'days') + ' ago') + '.'
      : f.cases ? 'No detection date in the table yet.' : 'No detection yet.';
    const banner = {
      active: f.active > 0,
      headline: f.active ? many(f.active, 'active detection', 'active detections') + ': ' + split +
        (f.flocks.active ? '' : '; none in ' + rp.flocks) : 'No active detections in ' + rp.flocks,
      line: (status ? status + ' ' : '') + lastLine
    };
    const missing = f.kinds[0].missing, rest = f.flocks.others.reduce((s, o) => s + o[1], 0) + f.flocks.untyped;
    const tiles = [
      { label: 'Active now', value: f.active.toLocaleString('en-US'), sub: f.active ? split : 'no surveillance areas', active: f.active > 0 },
      { label: 'This year', value: f.thisYear.length.toLocaleString('en-US'), sub: 'detections in ' + f.year },
      { label: 'Flocks since ' + since, value: f.flocks.total.toLocaleString('en-US'),
        sub: f.flocks.commercial + ' commercial · ' + f.flocks.backyard + ' backyard' + (rest ? ' · ' + rest + ' other' : '') },
      { label: f.kinds[0].label + ' affected', value: short(f.birds),
        sub: (f.birds >= 1e6 ? f.birds.toLocaleString('en-US') + ' ' : '') + 'since ' + since + (missing ? ', ' + missing + ' without a count' : '') },
      { label: 'Counties', value: f.countiesAffected.toLocaleString('en-US'), sub: 'of ' + countyCount + ', since ' + since },
      { label: 'Last detection', value: f.last ? dateShort(f.last).replace(', ' + f.year, '') : 'None',
        sub: f.last ? (f.daysSince === 0 ? 'the day of this update' : many(f.daysSince, 'day', 'days') + ' ago') : '' }
    ];
    // The other kinds, named apart only when there are any, and the rows naming more than one kind.
    const also = f.kinds.slice(1).filter(k => k.cases).map(k => caseOf(k, k.cases) +
      (k.animals ? ' (' + many(k.animals, type.kinds.find(x => x.key === k.key).word, type.kinds.find(x => x.key === k.key).word) + ')' : ''));
    if (f.mixed.cases) also.push(many(f.mixed.cases, 'case', 'cases') + ' naming more than one kind of animal');
    const source = 'Source: ' + rp.source + ', as of ' + dateLong(f.date) + '. Every row is a case, mapped or not, since the' +
      ' start of the outbreak in ' + since + '.' + (f.undated ? ' ' + many(f.undated, 'case', 'cases') + ' without a detection date: in the totals only.' : '');
    const zones = f.zones.active ? 'Surveillance areas are active around ' + many(f.zones.active, 'case', 'cases') + ' in ' +
      many(f.zones.counties, 'county', 'counties') + '.' : 'There are no currently active surveillance areas.';
    // The livestock card: the livestock kind's active cases on the date, its total since the start beside
    // it; "suspected" staff's tick; the other farm animals a line of their own when there are any.
    let livestock = null;
    const lk = f.kinds.find(k => k.key === rp.livestock);
    if (lk) {
      const milk = ch.milk || rp.milk[0];
      const sinceText = lk.cases ? ' (' + many(lk.cases, 'case', 'cases') + ' since ' + since + ')' : '';
      const others = f.kinds.filter(k => k.key !== lk.key && k.key !== f.kinds[0].key && k.cases)
        .map(k => k.label + ': ' + many(k.cases, 'case', 'cases') + ' since ' + since + ', ' + (k.active ? k.active + ' active' : 'none active') + '.');
      livestock = {
        highlight: lk.active > 0 || !!ch.suspected,
        headline: lk.active ? many(lk.active, 'active livestock case', 'active livestock cases') + ' in Washington'
          : ch.suspected ? 'Suspected livestock cases in Washington' : 'No livestock cases in Washington',
        text: lk.active ? 'There ' + (lk.active === 1 ? 'is ' : 'are ') + many(lk.active, 'active confirmed livestock case', 'active confirmed livestock cases') +
            ' in Washington state' + sinceText + '.'
          : 'There are ' + (lk.cases ? 'no active confirmed' : 'no confirmed') + (ch.suspected
            ? ' livestock cases in Washington state; suspected cases are being tested' : ' or suspected livestock cases in Washington state') + sinceText + '.',
        stage: milk.stage, stageText: milk.text, others
      };
    }
    return { since, banner, tiles, also, source, zones, livestock, status };
  }

  // ---- Figures: the update's figures on screen (2.9, the fallback for the ArcGIS Dashboard; internal) ----
  // The same figures as the printed pages; what Figures adds is said here, so the unit suite checks it as it does the
  // pages.
  const monthName = ym => MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4);
  const countyWord = c => c === COUNTY_NOT_GIVEN ? 'Not given' : c;
  const pct = (a, b) => Math.round(a / ((a + b) || 1) * 100);

  // What the table lists for a pick: none (this year's detections), a county ({ county }: its cases this year) or a
  // month ({ month: 'YYYY-MM' }: the cases detected in it, whatever the year). of: how many this year's table holds
  // without the pick, or null for a month of another year.
  function picked(f, pick) {
    if (pick && pick.month) {
      return { heading: 'Detections', chip: monthName(pick.month),
        rows: f.listed.filter(r => r.detected && r.detected.slice(0, 7) === pick.month),
        of: pick.month.slice(0, 4) === f.year ? f.thisYear.length : null,
        none: 'No detections in ' + monthName(pick.month) + '.' };
    }
    if (pick && pick.county) {
      return { heading: f.year + ' detections', chip: countyWord(pick.county), rows: f.thisYear.filter(r => r.county === pick.county),
        of: f.thisYear.length, none: 'No detections in ' + f.year + ' in ' + countyWord(pick.county) + ' so far.' };
    }
    return { heading: f.year + ' detections', chip: null, rows: f.thisYear, of: f.thisYear.length, none: 'No detections in ' + f.year + ' so far.' };
  }

  // The map's places: the rows with a map point, one place per point (5 decimals, as the premises detected more than
  // once), active when any of its cases is; the closed places first, so an active one is drawn over them.
  function places(f) {
    const at = new Map();
    for (const r of f.listed) {
      if (r.lat === null) continue;
      const key = r.lat.toFixed(5) + ',' + r.lon.toFixed(5);
      if (!at.has(key)) at.set(key, { lon: r.lon, lat: r.lat, active: false, cases: [] });
      const place = at.get(key);
      place.cases.push(r);
      if (r.active) place.active = true;
    }
    const all = [...at.values()];
    return all.filter(p => !p.active).concat(all.filter(p => p.active));
  }

  // The hovers' words: { head, text, lines }, plain text (the page writes head in bold, then ": " and text, then each
  // line under it). Each says the figure's number and how the update counts it.
  // tile(f, type, w, i, countyCount): the tile w.tiles[i]; county(f, c, on): a row of f.counties, on when it is the
  // pick; month(f, m, on): a row of f.byMonth; split(f, type, 'flocks' or 'animals'): a bar of "Commercial and
  // backyard"; place(p): one of places(f).
  const hover = {
    tile(f, type, w, i, countyCount) {
      const since = w.since, word = type.kinds[0].word, label = type.kinds[0].label;
      const fl = f.flocks, rest = f.counties.filter(c => !c.washington);
      switch (i) {
        case 0: return { head: 'Active now', text: f.active.toLocaleString('en-US'), lines: [
          w.tiles[0].sub,
          'A case is active until its Close Date, or its Quarantine Release when its status says closed; counted on ' + dateShort(f.date) + '.',
          'Every kind of animal, mapped or not. ' + w.zones] };
        case 1: return { head: 'This year', text: many(f.thisYear.length, 'detection', 'detections') + ' in ' + f.year, lines: [
          'Detected (Confirmed Diagnosis, else Date Reported) in ' + f.year + ', on or before ' + dateShort(f.date) + '; listed in the table below.']
          .concat(f.undated ? [many(f.undated, 'case', 'cases') + ' without a detection date: in no year.'] : []) };
        case 2: return { head: w.tiles[2].label, text: fl.total.toLocaleString('en-US'), lines: [
          [fl.commercial + ' commercial', fl.backyard + ' backyard'].concat(fl.others.map(([t, n]) => n + ' ' + t),
            fl.untyped ? [fl.untyped + ' without a type'] : []).join(', ') + ', by Flock/Herd Type.',
          'Every row of ' + word + ' is a flock; herds and other animals are not.']
          .concat(f.twice.premises ? [many(f.twice.premises, 'premises', 'premises') + ' detected more than once (the same map point): each detection counts.'] : []) };
        case 3: return { head: label + ' affected', text: f.birds.toLocaleString('en-US'), lines: [
          'Flock/Herd Inventory added up over the rows of ' + word + ' since ' + since + '.']
          .concat(f.kinds[0].missing ? [many(f.kinds[0].missing, 'row', 'rows') + ' without a count left out, never counted as zero.'] : [],
            f.mixed.cases ? [many(f.mixed.cases, 'row naming', 'rows naming') + ' more than one kind of animal: in no kind\'s total.'] : []) };
        case 4: return { head: 'Counties', text: f.countiesAffected + ' of ' + countyCount, lines: [
          'Washington\'s counties with a case since ' + since + '.',
          'A case\'s county is its County column, else the county of its map point (or the nearest within 2 km).']
          .concat(rest.length ? ['Not among them: ' + rest.map(c => c.county === COUNTY_NOT_GIVEN ? many(c.cases, 'case', 'cases') + ' with no county and no map point'
            : c.county + ' (not a Washington county)').join('; ') + '.'] : []) };
        default: return { head: 'Last detection', text: f.last ? dateLong(f.last) : 'none', lines: f.last ? [
          'The latest detection on or before ' + dateShort(f.date) + ', ' + (f.daysSince === 0 ? 'the day of this update.' : many(f.daysSince, 'day', 'days') + ' before it.')] : [] };
      }
    },
    county(f, c, on) {
      const inYear = f.thisYear.filter(r => r.county === c.county).length;
      const since = f.byMonth.length ? f.byMonth[0].month.slice(0, 4) : f.year;
      return { head: countyWord(c.county), text: many(c.cases, 'case', 'cases') + ' since ' + since + ', ' + inYear + ' in ' + f.year +
        (c.active ? ', ' + c.active + ' active' : ''), lines: (c.county === COUNTY_NOT_GIVEN ? ['No county and no map point in the table.']
        : c.washington ? [] : ['Not a Washington county (as the table writes it).'])
        .concat([on ? 'Listed below; click again to show every county.' : 'Click to list its ' + f.year + ' cases.']) };
    },
    month(f, m, on) {
      const n = m.commercial + m.backyard + m.other;
      const what = m.commercial + ' commercial, ' + m.backyard + ' backyard' + (m.other ? ', ' + m.other + ' other' : '');
      return { head: monthName(m.month), text: many(n, 'detection', 'detections'), lines: [what +
        (on ? ' · listed below; click again to show ' + f.year + '\'s' : n ? ' · click to list them' : '')] };
    },
    split(f, type, which) {
      const fl = f.flocks, fb = fl.birds;
      if (which === 'flocks') {
        const p = pct(fl.commercial, fl.backyard);
        return { head: 'Flocks', text: (fl.commercial + fl.backyard).toLocaleString('en-US') + ' commercial or backyard', lines: [
          'Commercial ' + fl.commercial + ' (' + p + '%), backyard ' + fl.backyard + ' (' + (100 - p) + '%), by Flock/Herd Type.']
          .concat(fl.others.length || fl.untyped ? ['Other types and rows without a type are not in the bar.'] : []) };
      }
      const p = pct(fb.commercial, fb.backyard);
      return { head: type.kinds[0].label + ' affected', text: (fb.commercial + fb.backyard).toLocaleString('en-US') + ' in commercial or backyard flocks', lines: [
        'Commercial ' + fb.commercial.toLocaleString('en-US') + ' (' + p + '%), backyard ' + fb.backyard.toLocaleString('en-US') + ' (' + (100 - p) + '%).',
        'Flock/Herd Inventory added up by Flock/Herd Type; a blank left out.'] };
    },
    place(p) {
      const n = p.cases.length, act = p.cases.filter(r => r.active).length;
      const line = r => [r.detected ? 'Detected ' + dateShort(r.detected) : 'No detection date', r.flockType,
        r.flock ? (r.size ? r.size + ' flock' : '') : r.species,
        n > 1 ? (r.active ? 'active' : 'closed') : ''].filter(Boolean).join(' · ');
      const shown = p.cases.slice(0, 6).map(line).concat(n > 6 ? ['and ' + (n - 6) + ' more'] : []);
      return { head: n === 1 ? (p.active ? 'Active case' : 'Closed case') : many(n, 'case', 'cases') + ' at this place' + (act ? ', ' + act + ' active' : ''),
        text: '', lines: shown.concat([countyWord(p.cases[0].county) + ' · its place in the table: internal only, never printed.']) };
    }
  };

  root.WSDA.emergencyReport = { figures, statusFits, daysBetween, spread, inside, wording, dateLong, dateShort, dateTable, short,
    picked, places, hover, monthName, COUNTY_NOT_GIVEN, SIZE_LINE };
})(typeof window !== 'undefined' ? window : globalThis);
