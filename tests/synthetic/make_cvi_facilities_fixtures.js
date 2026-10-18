#!/usr/bin/env node
'use strict';
// S6 synthetic inputs only. No production files or earlier tier artifacts are written.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..'), OUT = path.join(ROOT, 'local-test-artifacts/s6/day1');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function generate() {
  fs.mkdirSync(OUT, { recursive: true });
  const files = {};
  function write(name, content) { fs.writeFileSync(path.join(OUT, name), content); files[name] = sha(path.join(OUT, name)); }
  const csv = (header, rows) => [header, ...rows].map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n') + '\n';
  const header = ['RowID','name','lat','long','one','two','thirty','thirtyone','Species200','Species201',
    'numeric','logical','allNA','withNA',
    // R type cases: read.csv reads the first three as text and the next five, but not upperNan, as numbers.
    'lowerBool','titleBool','spacedBool','nanNum','upperNan','infinityNum','hexNum','hexFloat',
    'Operation.Type','a-b','a b','a.b','__proto__','constructor',
    'owner','phone','email','Address','County','location','Notes','geo_source'];
  const rows = Array.from({ length: 201 }, (_, i) => [
    'R' + (i+1), 'Synthetic ' + (i+1), 47.25, -122.35, 'single', i%2 ? 'Beta' : 'Alpha',
    'v'+i%30, 'v'+i%31, 's'+i%200, 's'+i, i%3, i%2 ? 'TRUE':'FALSE', 'NA', i%3 ? 'A':'NA',
    i%2 ? 'true':'false', i%2 ? 'True':'False', i%2 ? ' TRUE':'FALSE ', ['NaN','1','nan'][i%3], i%2 ? 'NAN':'1',
    ['Infinity','-INFINITY','2'][i%3], i%2 ? '0x1A':'-0x10', i%2 ? '0x1p3':'0x.8',
    ['Bovine|Caprine','Bovine;Equine','Bovine, Other','Vet/Clinic'][i%4],
    i%2 ? 'A':'B', i%2 ? 'C':'D', i%2 ? 'E':'F', i%2 ? 'G':'H', i%2 ? 'I':'J',
    'Synthetic owner '+i%2, 'Synthetic phone '+i%2, 'Synthetic email '+i%2,
    'Synthetic address '+i%2, i%2 ? 'King':'Pierce', 'Synthetic location '+i%2, 'Synthetic note '+i%2, 'existing']);
  write('schema.csv', csv(header, rows));
  write('precision.csv', csv(['RowID','name','latitude','longitude','geo_source','Kind'], [
    ['P1','Town A',47.25,-122.35,'google_city','A'], ['P2','Town B',47.25,-122.35,'GOOGLE_CITY','B'],
    ['P3','Blank precision',47.25,-122.35,'','A'], ['P4','NA precision',47.25,-122.35,'NA','B'],
    ['P5','None at real point',47.25,-122.35,'none','A'], ['P6','Zero point',0,0,'none','B'],
    ['P7','Other flag',47.25,-122.35,'manual','A'], ['P8','Bad latitude','bad',-122.35,'existing','B'],
    ['P9','Out of range',91,-122.35,'existing','A'], ['P10','Missing longitude',47.25,'','existing','B']]));
  write('missing_name_precision.csv', csv(['RowID','lat','long','Kind'], [['M1',47.25,-122.35,'A'],['M2',47.3,-122.4,'B']]));
  write('replacement.csv', csv(header, rows.map(r => { const n = [...r]; n[5] = r[5] === 'Alpha' ? 'Gamma':'Delta'; return n; })));
  write('facility_overlays_manifest.csv', csv(['key','file','name_col','label','filter_cols'], [
    ['schema','schema.csv','name','Synthetic schema',''],
    ['explicit','schema.csv','name','Synthetic whitelist','numeric;thirtyone|Species201,owner,email,Notes,missing'],
    ['precision','precision.csv','name','Synthetic precision',''],
    ['missing','missing_name_precision.csv','name','Synthetic missing fields','']]));
  const box = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(ROOT,'site/geo/wa-counties.js'),'utf8'), box);
  const geo = box.window.CVIWA_GEO, points = geo.labels.map(p => ({name:'label '+p.name, lon:p.lon, lat:p.lat}));
  for (const f of geo.counties.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) for (const r of p) {
      points.push({name:'vertex '+f.properties.name,lon:r[0][0],lat:r[0][1]});
      const b = r.find(v => v[0] !== r[0][0] || v[1] !== r[0][1]), a = r[0];
      const dx=b[0]-a[0], dy=b[1]-a[1], len=Math.hypot(dx,dy);
      for (const s of [-1,1]) points.push({name:'edge-side '+f.properties.name+'/'+s,
        lon:(a[0]+b[0])/2-s*dy/len*1e-7,lat:(a[1]+b[1])/2+s*dx/len*1e-7});
    }
  }
  points.push({name:'outside WA',lon:-122.7,lat:45.5},{name:'zero',lon:0,lat:0},
    {name:'Whidbey bbox false positive',lon:-122.4,lat:48.1},{name:'Everett',lon:-122.2,lat:47.98});
  const square = (x,y,n) => [[x,y],[x+n,y],[x+n,y+n],[x,y+n],[x,y]];
  const feature = (name,type,coordinates) => ({type:'Feature',properties:{name},geometry:{type,coordinates}});
  const artificial = {type:'FeatureCollection',features:[feature('Hole','Polygon',[square(-120,46,2),square(-119.5,46.5,1)]),
    feature('Adjacent','Polygon',[square(-118,46,1)]),feature('Islands','MultiPolygon',[[square(-123,46,.5)],[square(-123,48,.5)]])]};
  const special = [['hole interior',-119,47,[]],['hole edge',-119.5,47,['Hole']],['shared edge',-118,46.5,['Hole','Adjacent']],
    ['shared vertex',-118,46,['Hole','Adjacent']],['island one',-122.75,46.25,['Islands']],['island two',-122.75,48.25,['Islands']],
    ['between islands',-122.75,47,[]],['outer edge',-120,47,['Hole']]].map(([name,lon,lat,expected])=>({name,lon,lat,expected}));
  write('geometry.json', JSON.stringify({synthetic:true,groups:[{name:'bundled WA',counties:geo.counties,points},
    {name:'holes islands edges',counties:artificial,points:special}]}));
  write('inputs.json', JSON.stringify({synthetic:true,files, geometrySha256:sha(path.join(ROOT,'site/geo/wa-counties.js')),
    tiers:Object.fromEntries(['full','partner','public'].map(t=>[t,sha(path.join(ROOT,'local-test-artifacts/f1/tiers',t,
      t==='partner'?'partner_county_totals.csv':'CVI_Consolidated_Master.csv'))]))},null,2)+'\n');
  console.log(`S6 day-1 fixtures: 201 schema rows, 10 precision rows, ${points.length+special.length} geometry points`);
}
function generateEntry() {
  const out = path.join(ROOT, 'local-test-artifacts/s6/day2/fixtures');
  fs.mkdirSync(out, { recursive: true });
  require(path.join(ROOT, 'site/shared/zip.js'));
  require(path.join(ROOT, 'site/shared/sample.js'));
  require(path.join(ROOT, 'site/infrastructure/sample.js'));
  const sample = globalThis.WSDA.samples.infrastructure;
  const entries = sample.entries();
  const folder = path.join(out, 'sample'); fs.mkdirSync(folder, { recursive: true });
  for (const e of entries) fs.writeFileSync(path.join(folder, e.name), e.data);
  fs.writeFileSync(path.join(out, sample.fileName), globalThis.WSDA.sample.zip(entries));
  fs.writeFileSync(path.join(out, 'unknown.csv'), 'name,lat,long\nSynthetic unclear,47.25,-122.35\n');
  fs.writeFileSync(path.join(out, 'invalid.csv'), 'name,lat,long\nSynthetic invalid,bad,missing\n');
  fs.writeFileSync(path.join(out, 'empty_points.csv'), 'name,lat,long\n');
  fs.writeFileSync(path.join(out, 'broken_master.csv'), 'Species.Group,Total.Animals\nCattle,bad\n');
  fs.writeFileSync(path.join(out, 'unrelated.json'), '{"synthetic":true}\n');
  for (const hint of ['cvi', 'infrastructure', 'emergency', 'unknown']) {
    const dir = path.join(out, hint); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bundle.json'), JSON.stringify({ profile: hint,
      files: { feedlots: 'unknown.csv', unrelated: 'unrelated.json' } }) + '\n');
  }
  fs.writeFileSync(path.join(out, 'digests.json'), JSON.stringify(Object.fromEntries(entries.map(e => [e.name,
    crypto.createHash('sha256').update(e.data).digest('hex')])), null, 2) + '\n');
  console.log('S6 entry fixtures: facility-only ZIP/folder, four hints, unclear/invalid/empty/optional-master/unrelated files');
}
if (require.main === module) process.argv.includes('--entryflow') ? generateEntry() : generate();
module.exports = { generate, generateEntry };
