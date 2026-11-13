// The Emergency dashboard's own answers for an HPAI table, for test_zone_rules.py to compare the zones tool with:
// each row's detection date, map point and active or closed on a date (rules.js readPositives and isPast), the
// report's figures on that date (report.js figures), the dashboard's circle around a point (proximity.js circle) and
// the HPAI type's kinds of animal (types/hpai.js).
// Usage: node dashboard_rules.js <table.csv> <date YYYY-MM-DD> <today YYYY-MM-DD>   (prints JSON)
const fs = require('fs'), path = require('path');
const SITE = path.resolve(__dirname, '..', '..', '..', 'site');
for (const f of ['shared/zip.js', 'shared/load.js', 'shared/recognize.js', 'shared/zones.js', 'shared/proximity.js',
  'emergency/message-icons.js', 'emergency/types.js', 'emergency/types/hpai.js', 'emergency/types/nws.js', 'emergency/rules.js', 'emergency/report.js']) {
  require(path.join(SITE, f));
}
globalThis.window = globalThis.window || globalThis;
require(path.join(SITE, 'geo', 'wa-counties.js'));
const { recognize: R, emergencyTypes: T, emergencyRules: E, emergencyReport: RP, proximity: PX } = globalThis.WSDA;

const [file, date, today] = process.argv.slice(2);
const rows = R.parseCsv(fs.readFileSync(file, 'utf8')).filter(r => !(r.length === 1 && r[0] === ''));
const hpai = T.list().find(t => t.id === 'hpai');
const read = E.readPositives(rows[0], rows.slice(1), hpai, today);
const all = read.positives.concat(read.dropped).sort((a, b) => a.line - b.line);
const f = RP.figures(read, date, globalThis.CVIWA_GEO.counties.features);
console.log(JSON.stringify({
  rows: all.map(p => ({ line: p.line, detected: p.detected, mapped: p.lat !== null, closed: E.isPast(p, date),
    key: p.lat !== null ? p.lat.toFixed(5) + ',' + p.lon.toFixed(5) : null, reason: p.reason || null })),
  figures: { cases: f.cases, later: f.later, undated: f.undated, noPoint: f.noPoint, active: f.active,
    countiesAffected: f.countiesAffected, zones: f.zones, twice: f.twice },
  circle: PX.circle(47.25, -121.5, 10, 360),
  kinds: hpai.kinds.map(k => ({ key: k.key, words: k.words })),
  caseWords: hpai.report.cases
}));
