#!/usr/bin/env node
'use strict';
if (process.argv.includes('--activity')) { activityReference();
} else if (process.argv.includes('--facilities')) { sharedFacilities();
} else if (process.argv.includes('--entryflow')) {
  entryFlow().catch(e => { console.error(e.stack); process.exitCode = 2; });
} else {
// Day-1 reference gate: independent fixtures vs unchanged CVI module; page evidence is separate.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'../..'), OUT=path.join(ROOT,'local-test-artifacts/s6/day1');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=n=>JSON.parse(fs.readFileSync(path.join(OUT,n),'utf8'));
const ref=read('reference.json'),inputs=read('inputs.json'),geo=read('geometry.json');
let passed=0,failed=0;const failures=[];
function check(ok,name){if(ok)passed++;else{failed++;failures.push(name);}}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const list=v=>v==null?[]:Array.isArray(v)?v:[v];
check(ref.meta.synthetic&&inputs.synthetic,'synthetic-only reference');
check(sha(path.join(OUT,'inputs.json'))===ref.meta.inputs_sha256,'fresh input manifest');
check(sha(path.join(ROOT,'tests/oracle/s6_facilities_oracle.R'))===ref.meta.oracle_sha256,'fresh oracle source');
for(const [name,hash]of Object.entries(inputs.files))check(sha(path.join(OUT,name))===hash,'input '+name);
for(const [name,hash]of Object.entries(ref.meta.source_hashes))check(sha(path.join(ROOT,'../CVI_Traceability/shiny',name))===hash,'unchanged source '+name);
for(const[t,h]of Object.entries(inputs.tiers))check(sha(path.join(ROOT,'local-test-artifacts/f1/tiers',t,t==='partner'?'partner_county_totals.csv':'CVI_Consolidated_Master.csv'))===h,'unchanged '+t+' tier master');
check(sha(path.join(ROOT,'site/geo/wa-counties.js'))===inputs.geometrySha256,'fresh WA geometry');
check(ref.meta.empty_root&&fs.readdirSync(path.join(OUT,'empty_cvi_root')).length===0,'isolated module root empty');
const auto=list(ref.schema.auto);
for(const name of ['two','thirty','Species200','Operation.Type','a.b.1','a.b.2','a.b','X__proto__','constructor',
  'lowerBool','titleBool','spacedBool','upperNan'])check(auto.includes(name),'auto includes '+name);
for(const name of ['one','thirtyone','Species201','numeric','logical','allNA','withNA','owner','phone','email','Address','County','location','Notes','name','RowID','geo_source',
  'nanNum','infinityNum','hexNum','hexFloat'])check(!auto.includes(name),'auto excludes '+name);
check(equal(list(ref.schema.factor_cols),['Kind']),'factor recognized, numeric/logical excluded');
for(const name of ['numeric','logical','allNA'])check(!list(ref.schema.types[name]).includes('character'),'R type inference '+name);
check(list(ref.schema.choices.thirty).length===30,'ordinary cap 30');
check(list(ref.schema.choices.Species200).length===200,'species cap 200');
check(equal(Object.keys(ref.choices.explicit),['numeric','thirtyone','Species201']),'explicit whitelist screens personal names and permits numbers/high cardinality');
check(list(ref.choices.explicit.Species201).length===201,'explicit 201 choices');
check(equal(list(ref.choices.schema['Operation.Type']),['Bovine','Bovine, Other','Caprine','Equine','Vet/Clinic']),'token separators only pipe/semicolon');
const R=Array.from({length:201},(_,i)=>'R'+(i+1));
const expected={all:R,county:R,county_zero:[],tokens_or:R.filter((_,i)=>i%4<2),
 tokens_and:R.filter((_,i)=>i%4===0),literal_comma:R.filter((_,i)=>i%4===2),literal_slash:R.filter((_,i)=>i%4===3),
 explicit_numeric:R,stale_pick:[],disabled_pick:R,reenabled_pick:R.filter((_,i)=>i%2===0),no_layers:R,all_again:R};
check(equal(Object.keys(ref.cases),Object.keys(expected)),'complete 13-case ledger');
for(const[name,ids]of Object.entries(expected)) {
 const c=ref.cases[name];check(equal(list(c.ids.schema),ids),'module schema row IDs '+name);
 if(name==='explicit_numeric')check(equal(list(c.ids.explicit),['R2','R5']),'explicit AND row IDs');
 for(const key of ['schema','explicit','precision','missing'])check(list(c.ids[key]).length===c.counts[key],'filtered count equals row IDs '+name+'/'+key);
 if(c.widget.error){check(false,'source widget error '+name+': '+c.widget.error);continue;}
 const sources=list(c.widget.x.sources),layers=list(c.widget.x.layers);
 const cardValues=[...(c.boxes.html||'').matchAll(/class="metric-value"[^>]*>([^<]+)</g)].map(m=>Number(m[1].replace(/,/g,'')));
 check(equal(cardValues,list(c.selected).map(k=>c.counts[k])),'rendered cards equal filtered counts '+name);
 if(!list(c.selected).length)check(c.boxes.html.includes('Select facility layers to see counts.'),'no-layers source prompt');
 check(c.strip.html.includes(list(c.selected).length+' facility layers shown'),'rendered source strip '+name);
 for(const key of list(c.selected)) {
  const src=sources.find(s=>s.id==='fac_overlay_src_'+key),n=c.counts[key];
  check(!!src===(n>0),'source zero-result distinction '+name+'/'+key);
  if(!src)continue;
  check(list(src.data.features).length===n,'widget row/count agreement '+name+'/'+key);
  check(src.cluster===true&&src.clusterRadius===40&&src.clusterMaxZoom===22,'cluster parameters '+name+'/'+key);
  for(const f of list(src.data.features))check(equal(Object.keys(f.properties).sort(),['ref_display','ref_name']),'minimal source payload '+name+'/'+key);
  const marker=layers.find(l=>l.id==='fac_overlay_marker_'+key),cluster=layers.find(l=>l.id==='fac_overlay_clusters_'+key);
  check(marker?.paint['circle-radius']===7&&marker.paint['circle-opacity']===.95&&marker.paint['circle-stroke-width']===2,'individual style '+name+'/'+key);
  check(equal(cluster?.paint['circle-radius'],['step',['get','point_count'],14,10,18,50,24,200,32]),'cluster radius steps '+name+'/'+key);
 }
 // Descending row counts, with registry order for ties.
 const keys=list(c.selected).filter(k=>c.counts[k]>0).sort((a,b)=>c.counts[b]-c.counts[a]);
 const actual=sources.filter(s=>s.id.startsWith('fac_overlay_src_')).map(s=>s.id.slice(16));
 check(equal(actual,keys),'sparse layers on top '+name);
}
require(path.join(ROOT,'site/shared/facilities.js'));
const F=globalThis.CVIWA.facilities;
let geometryChecks=0;
geo.groups.forEach((g,gi)=>{
 const member=F.countyMembership(g.counties,g.counties.features.map(f=>f.properties.name));
 g.points.forEach((p,i)=>{
  const hits=member.countiesAt(p.lon,p.lat),r=list(ref.geometry[gi].matches[i]);
  check(equal(hits,r),'GEOS union '+gi+'/'+p.name);geometryChecks++;
  check((hits[0]??null)===ref.geometry[gi].first[i],'first-hit tag '+gi+'/'+p.name);
  if(p.expected)check(equal(hits,p.expected),'hand geometry '+p.name);
 });
});
const precision=ref.precision.rows;
check(equal(precision.map(r=>r.RowID),['P1','P2','P3','P4','P5','P6','P7','P9']),'source loader keeps none, zero and out-of-range; omits nonnumeric');
check(precision[2].geo_source==='existing'&&precision[3].geo_source===null,'source blank default and NA retained');
check(list(ref.precision.default_missing).every(v=>v==='existing'),'missing precision default existing');
const precisionSource=list(ref.cases.all.widget.x.sources).find(s=>s.id==='fac_overlay_src_precision');
const displays=list(precisionSource.data.features).map(f=>f.properties.ref_display);
check(displays[0]==='Town A (town-level location)'&&displays[1]==='Town B (town-level location)','case-insensitive town qualifier');
check(displays[2]==='Blank precision'&&displays[3]===null&&displays[4]==='None at real point'&&displays[5]==='Zero point','source precision display, including NA and zero');
check(ref.precision.png.n_unplaced===3,'PNG excludes none/zero/range separately from live behavior');
check(ref.replacement.unchanged_signature&&equal(list(ref.replacement.before),list(ref.replacement.after)),'source same-size stale cache reproduced');
check(equal(list(ref.replacement.raw_values),['Gamma','Delta']),'replacement raw content actually changed');
check(!list(ref.reset).some(m=>m.id==='fac_county'||m.id.startsWith('facfilt_')),'source reset omission reproduced');
const results={passed,failed,failures,geometryChecks,moduleCases:Object.keys(ref.cases).length,
 referenceSha256:sha(path.join(OUT,'reference.json')),scope:'day-1 source/reference gate only; does not establish production filters, page/routing behavior or browser performance'};
fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(results,null,2)+'\n');
for(const f of failures)console.error(f);
console.log(`S6 day-1 Node: ${passed} passed, ${failed} failed; ${geometryChecks} geometry probes; ${results.moduleCases} module cases`);
process.exitCode=failed?1:0;

}
async function entryFlow() {
  const fs = require('fs'), path = require('path'), crypto = require('crypto');
  const ROOT = path.resolve(__dirname, '../..'), OUT = path.join(ROOT, 'local-test-artifacts/s6/day2');
  for (const f of ['shared/zip.js', 'shared/load.js', 'shared/recognize.js', 'shared/bundle.js', 'shared/checklist.js',
    'shared/sample.js', 'shared/guide.js', 'shared/facility-datasets.js', 'cvi/datasets.js', 'infrastructure/datasets.js', 'infrastructure/sample.js']) require(path.join(ROOT, 'site', f));
  const W = globalThis.WSDA, C = W.profiles.cvi, I = W.profiles.infrastructure;
  let passed = 0, failed = 0; const failures = [];
  const check = (ok, name) => { if (ok) passed++; else { failed++; failures.push(name); } };
  const files = names => names.map(n => new File([fs.readFileSync(path.join(OUT, 'fixtures', n))], path.basename(n)));
  const panel = () => W.checklist.create({ container: { innerHTML: '', addEventListener() {} }, profile: C });
  const load = names => W.load.fromFileList(files(names), 'files');
  check(I.datasets.filter(d => d.required).length === 0, 'Infrastructure requires no master');
  check(C.datasets[0].required, 'CVI master remains required');
  check(I.expandManifest === C.expandManifest, 'one shared manifest implementation');
  check(C.datasets.filter(d => d.kind === 'facility').map(d => d.id).join() === 'slaughterhouses,fairgrounds,markets,feedlots,restricted', 'stable CVI facility IDs');
  const p = panel(); await p.show(await load(['unknown.csv', 'cvi/bundle.json', 'unrelated.json']));
  check(p.state.result.datasets.find(d => d.id === 'feedlots').status === 'found', 'CVI-labeled mapping found');
  await p.setProfile(I, { reuseShared: true });
  check(p.state.result.datasets.find(d => d.id === 'feedlots').status === 'found', 'explicit Infrastructure switch reuses mapping');
  check(!p.state.result.files.find(f => f.name === 'unrelated.json').dataset, 'unrelated file unused');
  await p.assign('f1', 'markets');
  check(p.state.result.datasets.find(d => d.id === 'markets').status === 'found', 'user override outranks bundle');
  const gen = p.state.gen;
  await p.setProfile(C, { reuseShared: true });
  check(p.state.assign.f1 === 'markets' && p.state.result.datasets.find(d => d.id === 'markets').status === 'found', 'switch back preserves user mapping');
  check(await p.assign('f1', 'feedlots', gen) === false, 'old profile control rejected');
  await p.assign('f1', '');
  check(p.state.result.datasets.find(d => d.id === 'feedlots').status === 'found', 'undo restores original bundle mapping');
  await p.setProfile(I);
  check(p.state.result.datasets.find(d => d.id === 'feedlots').status === 'missing', 'implicit mismatch does not reuse mapping');
  const b = p.state.bundle, warnings = JSON.stringify(b.warnings);
  const reusable = W.bundle.filesFor(b, I, { reuseShared: true });
  check(Object.keys(reusable).join() === 'feedlots', 'unknown mapping IDs withheld');
  check(JSON.stringify(b.warnings) === warnings && b.info.profile === 'cvi', 'explicit reuse does not mutate bundle or warnings');
  for (const n of ['invalid.csv', 'empty_points.csv']) {
    const c = panel(); await c.show(await load([n])); await c.assign('f1', 'feedlots'); await c.setProfile(I, { reuseShared: true });
    check(c.state.features.find(f => f.id === 'facility-files').on, n + ': header permits omission explanation');
    check(!c.state.features.find(f => f.id === 'cvi-activity').on, n + ': optional master gated');
  }
  const m = panel(); await m.show(await load(['sample/facility_overlays_manifest.csv'])); await m.setProfile(I);
  check(!m.state.features.find(f => f.id === 'facility-files').on, 'manifest alone cannot open');
  const conflict = panel(); await conflict.show(await load(['unknown.csv', 'unknown.csv', 'cvi/bundle.json']));
  await conflict.setProfile(I, { reuseShared: true });
  check(!conflict.state.features.find(f => f.id === 'facility-files').on && conflict.state.result.datasets.find(d => d.id === 'feedlots').status === 'conflict', 'conflicting facility files stay gated');
  await conflict.choose('feedlots', 'f2');
  check(conflict.state.features.find(f => f.id === 'facility-files').on, 'explicit conflict choice enables Infrastructure');
  await conflict.setProfile(C, { reuseShared: true });
  check(conflict.state.choices.feedlots === 'f2' && conflict.state.result.datasets.find(d => d.id === 'feedlots').fileId === 'f2', 'conflict choice survives dashboard switch');
  const sample = W.samples.infrastructure;
  check(Buffer.from(W.sample.zip(sample.entries())).equals(fs.readFileSync(path.join(OUT, 'fixtures', sample.fileName))), 'sample ZIP matches dedicated generator');
  const listing = await W.zip.open(new Blob([W.sample.zip(sample.entries())]));
  check(listing.entries.length === 8 && !listing.entries.some(e => /master/i.test(e.name)), 'facility-only archive with eight files');
  const intake = await W.load.fromFileList([new File([W.sample.zip(sample.entries())], sample.fileName)], 'files');
  const sPanel = W.checklist.create({ container: { innerHTML: '', addEventListener() {} }, profile: I }); await sPanel.show(intake);
  check(sPanel.state.result.datasets.filter(d => d.kind === 'facility' && d.status === 'found').length === 6, 'sample recognizes built-ins and manifest extra');
  check(!sPanel.state.features.find(f => f.id === 'cvi-activity').on, 'sample explains absent CVI activity');
  check(W.guide.html(I, { sample: true }).includes('no CVI master'), 'guide sample describes facility-only scope');
  // A dashboard switch while bundle reading is pending must reject obsolete work and preserve bundle metadata.
  let release; const slow = panel(); const input = await load(['unknown.csv', 'cvi/bundle.json']);
  const original = input.items[1].text; input.items[1].text = () => new Promise(r => { release = () => original().then(r); });
  const showing = slow.show(input), switching = slow.setProfile(I, { reuseShared: true }); release(); await Promise.all([showing, switching]);
  check(slow.state.profile.id === 'infrastructure' && slow.state.bundle.info.profile === 'cvi' && slow.state.result.datasets.find(d => d.id === 'feedlots').status === 'found', 'pending bundle/profile generation guard');
  const baseline = JSON.parse(fs.readFileSync(path.join(OUT, 'baseline.json')));
  // site/shared/sample.js is no longer pinned by its hash: its ZIP writer later gained an optional entry date
  // (default unchanged). Its output is checked instead: "sample ZIP matches dedicated generator" above, and the sample
  // bundle byte-identical in the F1 unit run.
  for (const [name, hash] of Object.entries(baseline).filter(([n]) => n.includes('/tiers/') || n.includes('day4-owner') || n === 'site/cvi/sample.js'))
    check(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, name))).digest('hex') === hash, 'preserved bytes ' + name);
  fs.writeFileSync(path.join(OUT, 'unit_results.json'), JSON.stringify({ passed, failed, failures }, null, 2) + '\n');
  for (const failure of failures) console.error(failure);
  console.log('S6 entry-flow Node: ' + passed + ' passed, ' + failed + ' failed'); process.exitCode = failed ? 1 : 0;
}

function sharedFacilities() {
  const fs=require('fs'),path=require('path'),vm=require('vm');
  const ROOT=path.resolve(__dirname,'../..'),D=path.join(ROOT,'local-test-artifacts/s6/day1'),OUT=path.join(ROOT,'local-test-artifacts/s6/day3');
  fs.mkdirSync(OUT,{recursive:true});
  require(path.join(ROOT,'site/cvi/app/csv.js'));require(path.join(ROOT,'site/shared/facilities.js'));
  const F=globalThis.WSDA.facilities,C=globalThis.CVIWA.csv;
  const g={window:{}};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'site/geo/wa-counties.js'),'utf8'),g);
  const counties=g.window.CVIWA_GEO.counties,ref=JSON.parse(fs.readFileSync(path.join(D,'reference.json')));
  const parse=n=>C.parse(fs.readFileSync(path.join(D,n),'utf8'));
  const manifest=parse('facility_overlays_manifest.csv'),files=Object.create(null);
  F.registry(manifest).layers.forEach(l=>{if(fs.existsSync(path.join(D,l.file)))files[l.key]=parse(l.file);});
  const p=F.prepare(files,manifest,counties,'first');let passed=0,failed=0;const failures=[];
  const check=(v,n)=>{if(v)passed++;else{failed++;failures.push(n);}};
  const arr=v=>v==null?[]:Array.isArray(v)?v:[v];
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  // Points keep only their filter columns, so a test row is found again from its file by the point's ordinal
  // (its position among the file's non-blank rows).
  const rowId=(key,point)=>{
    const file=files[key];
    const rows=file.rows.filter(r=>!(r.length===1&&(r[0]==null||r[0]==='')));
    return rows[point.ordinal][file.header.indexOf('RowID')];
  };
  const schema=p.layers.find(l=>l.key==='schema');
  check(equal(Object.keys(schema.choices),arr(ref.schema.auto)),'automatic columns vs independent R');
  for(const key of ['schema','explicit']) {
    const l=p.layers.find(l=>l.key===key);
    for(const [col,choices] of Object.entries(ref.choices[key])) check(equal(l.choices[col],arr(choices)),'R choices '+key+'/'+col);
  }
  // Input values explicitly reproduce the independent module case grid.
  const cases={all:{},county:{county:['Pierce']},county_zero:{county:['King']},
    tokens_or:{attributes:{schema:{'Operation.Type':['Bovine','Caprine']}}},
    tokens_and:{attributes:{schema:{'Operation.Type':['Bovine','Caprine'],two:['Alpha']}}},
    literal_comma:{attributes:{schema:{'Operation.Type':['Bovine, Other']}}},
    literal_slash:{attributes:{schema:{'Operation.Type':['Vet/Clinic']}}},
    explicit_numeric:{attributes:{explicit:{numeric:['1'],Species201:['s1','s4']}}},
    stale_pick:{attributes:{schema:{two:['not supplied']}}},disabled_pick:{attributes:{schema:{two:['Alpha']}}},
    reenabled_pick:{attributes:{schema:{two:['Alpha']}}},no_layers:{layers:[]},all_again:{}};
  // Compare each selected layer with the reference's actual module-selected row set.
  for(const [name,c] of Object.entries(cases)) {
    const r=ref.cases[name],layers=arr(r.selected);
    const result=F.select(p,{layers,attributes:c.attributes,geometry:point=>!c.county||c.county.includes(point.county)});
    for(const l of result.layers) {
      const ids=l.points.map(x=>rowId(l.key,x)), expected=arr(r.ids[l.key]).filter(id => l.key !== 'precision' || id !== 'P9');check(equal(ids,expected),'module rows '+name+'/'+l.key);
      check(l.count===expected.length,'module count '+name+'/'+l.key);
    }
  }
  const precision=p.layers.find(l=>l.key==='precision');
  check(equal(precision.points.map(x=>rowId('precision',x)),['P1','P2','P3','P4','P5','P6','P7']),'precision valid range omission');
  check(precision.points[0].display==='Town A (town-level location)'&&precision.points[1].display==='Town B (town-level location)','case insensitive town qualifier');
  check(precision.points[3].display==='NA precision'&&precision.points[3].geoSource==='existing','accepted NA precision difference');
  check(precision.points[4].geoSource==='none'&&precision.points[5].lon===0,'none and zero retained');
  check(precision.outOfRange===1&&precision.dropped===2,'omission counts');
  const make=text=>F.prepare({feedlots:C.parse(text)},null,counties,'new');
  const first=make('name,lat,long,Kind\nA,47.25,-122.35,Alpha\nB,47.25,-122.35,Beta\n');
  const next=make('name,lat,long,Kind\nA,47.25,-122.35,Gamma\nB,47.25,-122.35,Delta\n');
  const numeric=F.prepare({numeric:C.parse('name,lat,long,Amount\nA,47,-122,2\nB,47,-122,\nC,47,-122,NA\n')},C.parse('key,file,filter_cols\nnumeric,x.csv,Amount\n'),counties,9);
  check(equal(numeric.layers.find(l=>l.key==='numeric').choices.Amount,['2']),'numeric whitelist omits blank/NA cells');
  const prior={feedlots:{Kind:['Alpha']}};
  const rec=F.reconcile(next,['feedlots'],prior,false);
  check(equal(next.layers.find(l=>l.key==='feedlots').choices.Kind,['Delta','Gamma']),'same-size rebuilt choices');
  check(rec.cleared.length===1&&!rec.attributes.feedlots.Kind.length&&prior.feedlots.Kind[0]==='Alpha','clear invalid picks without cross-consumer mutation');
  check(F.reconcile(next,[],{},false).selectedLayers.length===0,'replacement does not rerun initial selection');
  // Row identity belongs to one file revision: rows loaded again get new IDs, so a stale popup or reply cannot match them.
  const text='name,lat,long,Kind\nA,47.25,-122.35,Alpha\nB,47.25,-122.35,Beta\n',ids=revision=>F.prepare({feedlots:C.parse(text)},null,counties,revision).layers.flatMap(l=>l.points.map(x=>x.id));
  const firstIds=new Set(ids(1)),nextIds=ids(2);
  check(nextIds.length===2&&nextIds.every(id=>!firstIds.has(id)),'row identity is new for each file revision');
  // A layer switched off keeps its picks for later (reconcile carries them over), shows no rows while off, and
  // the picks apply again when it is switched back on. This replaces a check that could not fail.
  const kept=F.reconcile(first,[],prior,false);
  check(equal(kept.attributes.feedlots.Kind,['Alpha'])&&!kept.cleared.length,'switched-off layer keeps its valid picks');
  const off=F.select(first,{layers:kept.selectedLayers,attributes:kept.attributes});
  check(off.layers.length===0&&off.rowIds.length===0,'switched-off layer shows no rows');
  check(F.select(first,{layers:['feedlots'],attributes:kept.attributes}).counts.feedlots===1,'reenabled picks restored');
  // Picks of a layer whose new file is not usable are dropped and named.
  const unusable=make('name,Kind\nA,Alpha\n');
  const dropped=F.reconcile(unusable,['feedlots'],prior,false);
  check(dropped.selectedLayers.length===0&&Object.keys(dropped.attributes).length===0,'unusable layer: switch and picks dropped');
  check(equal(dropped.cleared,['Feedlots / Kind (layer not usable with these files)']),'unusable layer: dropped picks named',dropped.cleared);
  const ugly=F.prepare({odd:C.parse('name,lat,long,owner,phone,Kind,constructor\nA,47,-122,Person,123,A,Z\nB,47,-122,Other,456,B,Y\n')},C.parse('key,file,filter_cols\nodd,x.csv,owner|phone|Kind|constructor\n'),counties,8);
  const u=ugly.layers.find(l=>l.key==='odd');check(equal(Object.keys(u.choices),['Kind','constructor']),'explicit screen and arbitrary keys');
  check(F.select(ugly,{layers:['odd'],attributes:{odd:{constructor:['Y']}}}).counts.odd===1,'prototype-like column filter');
  check(F.select(first,{layers:['feedlots'],geometry:point=>point.lon<0}).counts.feedlots===2,'synthetic future geometry predicate');
  for(const l of p.layers.filter(l=>l.usable))for(const point of l.points)check(p.byId.get(point.id)===point,'stable row lookup '+point.id);
  // Points hold only the filter columns' values; personal and other supplied columns are not kept.
  for(const l of p.layers.filter(l=>l.usable)) {
    const columns=JSON.stringify(Object.keys(l.choices));
    check(l.points.every(point=>JSON.stringify(Object.keys(point.values))===columns),'only filter columns kept '+l.key);
  }
  check(schema.points.every(point=>!('owner' in point.values)&&!('RowID' in point.values)),'screened and identifier cells not kept');
  // Column types as R's read.csv gives them, for every column of the schema file (CVI's loader, day-1 reference).
  const rType=c=>{const t=arr(c)[0];return t==='integer'?'numeric':t;};
  for(const [h,type] of Object.entries(schema.types)) {
    if(ref.schema.types[h]!==undefined)check(type===rType(ref.schema.types[h]),'R column type '+h,[type,ref.schema.types[h]]);
  }
  for(const [h,type] of Object.entries({lowerBool:'character',titleBool:'character',spacedBool:'character',
    nanNum:'numeric',upperNan:'character',infinityNum:'numeric',hexNum:'numeric',hexFloat:'numeric'})) {
    check(rType(ref.schema.types[h])===type&&schema.types[h]===type,'R reference case '+h);
  }
  // The name fallback ("a column with name in it") skips screened columns: no person's name as the title.
  const named=text=>F.prepare({feedlots:C.parse(text)},null,counties,'names').layers.find(l=>l.key==='feedlots').points[0].name;
  check(named('Owner.Name,lat,long\nPerson,47,-122\n')==='','screened name fallback skipped');
  check(named('Owner.Name,Site.Name,lat,long\nPerson,Barn,47,-122\n')==='Barn','unscreened name fallback used');
  // geo_source is trimmed, as CVI's loader does; blank after trimming is "existing". The values are quoted because
  // the shared CSV reader already trims unquoted fields.
  const flagged=make('name,lat,long,geo_source\nA,47.25,-122.35," google_city "\nB,47.25,-122.35,"  "\n').layers.find(l=>l.key==='feedlots');
  check(flagged.points[0].geoSource==='google_city'&&flagged.points[0].display==='A (town-level location)','trimmed town-level flag');
  check(flagged.points[1].geoSource==='existing','blank flag after trimming is existing');
  require(path.join(ROOT,'site/shared/facilitymap.js'));
  const FM=globalThis.WSDA.facilitymap;
  const selected=F.select(p,{layers:['schema','explicit','precision']});
  for(const l of selected.layers)for(const feature of FM.collection(l).features)check(equal(Object.keys(feature.properties),['row_id','ref_name','ref_display']),'minimal payload '+feature.properties.row_id);
  check(new Set(p.layers.flatMap(l=>l.points.map(x=>x.id))).size===p.byId.size,'collision-free identity');
  fs.writeFileSync(path.join(OUT,'unit_results.json'),JSON.stringify({passed,failed,failures},null,2)+'\n');
  failures.forEach(n=>console.error('FAIL '+n));console.log(`S6 shared facilities Node: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
}

function activityReference() {
 const fs=require('fs'),path=require('path'),crypto=require('crypto'),ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'local-test-artifacts/s6/day5');
 for(const file of ['csv','master','scaling','aggregate','palettes'])require(path.join(ROOT,'site/cvi/app',file+'.js'));
 require(path.join(ROOT,'site/shared/facilities.js'));require(path.join(ROOT,'site/shared/facilitymap.js'));
 const C=globalThis.CVIWA,F=globalThis.WSDA.facilities,FM=globalThis.WSDA.facilitymap,ref=JSON.parse(fs.readFileSync(path.join(OUT,'activity_reference.json')));
 const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),arr=v=>v==null?[]:Array.isArray(v)?v:[v];let passed=0,failed=0;const failures=[];
 const check=(v,n)=>{if(v)passed++;else{failed++;failures.push(n);}};
 check(ref.meta.synthetic&&ref.meta.oracle_sha256===sha(path.join(ROOT,'tests/oracle/s6_facilities_oracle.R')),'fresh synthetic full-module activity reference');
 for(const [f,h]of Object.entries(ref.meta.sources))check(sha(path.join(ROOT,'../CVI_Traceability/shiny',f))===h,'source hash '+f);
 const masters={};for(const tier of ['full','partner','public']){const file=path.join(ROOT,'local-test-artifacts/f1/tiers',tier,tier==='partner'?'partner_county_totals.csv':'CVI_Consolidated_Master.csv');check(sha(file)===ref.meta.tiers[tier],'unchanged tier '+tier);masters[tier]=C.master.load(fs.readFileSync(file,'utf8'));}
 for(const [name,r]of Object.entries(ref.cases)) {
  const m=masters[r.tier],d=C.aggregate.build(m.rows,{species:arr(r.species),years:arr(r.years),quarters:arr(r.quarters),rawSpecies:arr(r.raw),direction:['Inbound','Outbound'],mode:'side_by_side',scaling:r.scaling,nBins:r.nBins,hasSpecies:m.hasSpecies});
  const expected=arr(r.data);check(d.length===expected.length,'module circle count '+name);
  d.forEach((v,i)=>{const e=expected[i];for(const key of ['county','direction','lat','lon','total_animals','radius_px'])check(typeof v[key]==='number'?Math.abs(v[key]-e[key])<1e-7:v[key]===e[key],name+'/'+i+'/'+key);});
  if(r.widget){const src=arr(r.widget.x.sources).find(s=>s.id==='circles_source');check(!!src,'module actual widget circles '+name);if(src){const feats=arr(src.data.features);check(feats.length===d.length,'module widget point count '+name);for(const f of feats){const e=d.find(v=>v.county===f.properties.county&&v.direction===f.properties.direction);check(!!e&&Math.abs(e.radius_px-f.properties.radius_px)<1e-7&&Math.abs(e.lon-f.geometry.coordinates[0])<1e-7,'module widget radius/anchor '+name);}}}
 }
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 check(same(ref.cases['full/unfiltered'].data,ref.cases['full/facility_county'].data)&&same(ref.cases['full/unfiltered'].data,ref.cases['full/facility_refine'].data),'module facility filters independent of activity');
 // A future consumer uses the shared contract with its own synthetic geometry only.
 const prepared=F.prepare({feedlots:C.csv.parse('name,lat,long,Kind,owner\nA,47,-122,Alpha,Hidden\nB,48,-121,Beta,Hidden\nC,invalid,-120,Alpha,Hidden\n')},null,{type:'FeatureCollection',features:[]},'consumer1');
 const before=JSON.stringify(prepared.layers.map(l=>[l.key,l.choices]));
 const a=F.select(prepared,{layers:['feedlots'],attributes:{feedlots:{Kind:['Alpha']}},geometry:p=>p.lat<47.5}),b=F.select(prepared,{layers:['feedlots'],geometry:p=>p.lat>47.5});
 check(a.counts.feedlots===1&&b.counts.feedlots===1&&a.rowIds[0]!==b.rowIds[0],'independent synthetic consumer geometry/counts');
 check(prepared.layers.find(l=>l.key==='feedlots').dropped===1,'consumer omission evidence');
 check(!Object.keys(prepared.layers.find(l=>l.key==='feedlots').choices).includes('owner'),'future consumer screened fields');
 check(before===JSON.stringify(prepared.layers.map(l=>[l.key,l.choices])),'consumer selection does not mutate prepared choices');
 check(same(Object.keys(FM.collection(a.layers[0]).features[0].properties),['row_id','ref_name','ref_display']),'consumer minimal map payload');
 fs.writeFileSync(path.join(OUT,'activity_unit_results.json'),JSON.stringify({passed,failed,failures,cases:Object.keys(ref.cases).length,syntheticFutureConsumer:true},null,2)+'\n');
 failures.forEach(n=>console.error('FAIL '+n));console.log(`S6 activity/future consumer Node: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
}
