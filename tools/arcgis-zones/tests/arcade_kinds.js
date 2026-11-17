// The public dashboard's counting rules (the Arcade file in the ArcGIS build folder): its own kindsOf, its word lists
// and its placeholders, run here with stand-ins for the Arcade functions it uses, so test_zone_rules.py can check it
// reads each species as the zones tool does. Arcade is close enough to JavaScript for these lines.
// Usage: node arcade_kinds.js <the .arcade.txt file> '<JSON list of species>'   (prints JSON: each one's kinds, and
// the file's word lists, weak words and placeholders)
const fs = require('fs');
const [file, list] = process.argv.slice(2);
const src = fs.readFileSync(file, 'utf8');
const take = re => { const m = src.match(re); if (!m) throw new Error('not found in the Arcade file: ' + re); return m[0]; };
const code = [
  take(/^var KINDS = \{[\s\S]*?^\};$/m),
  take(/^var WEAK = .*$/m),
  take(/^var BLANK_SPECIES = .*$/m),
  take(/^var LETTERS = .*$/m),
  take(/^function yes\(b\) .*$/m),
  take(/^function kindsOf\(species\) \{[\s\S]*?^\}$/m)
].join('\n');
const Lower = s => String(s).toLowerCase(), Text = v => String(v), Count = x => x.length, Mid = (s, a, n) => s.substr(a, n);
const DefaultValue = (v, d) => (v === null || v === undefined || v === '' ? d : v), Find = (a, s) => s.indexOf(a);
const IIf = (c, a, b) => (c ? a : b), Concatenate = (a, sep) => a.join(sep), Includes = (a, v) => a.includes(v);
const Split = (s, sep, limit, removeEmpty) => s.split(sep).filter(x => !removeEmpty || x !== '');
const Replace = (s, a, b) => s.split(a).join(b), Left = (s, n) => s.slice(0, n), Trim = s => s.trim();
const kindsOf = new Function('Lower', 'Text', 'Count', 'Mid', 'DefaultValue', 'Find', 'IIf', 'Concatenate', 'Includes',
  'Split', 'Replace', 'Left', 'Trim', code + '\nreturn { kindsOf, KINDS, WEAK, BLANK_SPECIES };')(Lower, Text, Count, Mid,
  DefaultValue, Find, IIf, Concatenate, Includes, Split, Replace, Left, Trim);
const out = JSON.parse(list).map(sp => {
  const f = kindsOf.kindsOf(sp);
  return { kinds: ['birds', 'cattle', 'other'].filter(k => f[k]), mixed: f.mixed };
});
console.log(JSON.stringify({ read: out, kinds: kindsOf.KINDS, weak: kindsOf.WEAK, blank: kindsOf.BLANK_SPECIES }));
