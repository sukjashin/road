const fs=require('fs'),vm=require('vm'),assert=require('assert');
const script=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync('road-observations.js','utf8'),ctx);
vm.runInContext("let MODE='icing',DANGER_ROAD_TEMP=-1,DANGER_FRICTION=0.3,HEAT_DANGER_TEMP=35;"+script.slice(script.indexOf('function parseStationLine'),script.indexOf('function drawRoute'))+script.slice(script.indexOf('function buildRiskClusters'),script.indexOf('function buildSparkline')),ctx);
const results=[];
for(const f of vm.runInContext('BUILTIN_OBSERVATIONS',ctx)){
 ctx.input=f.text;const rows=vm.runInContext('parseStationFile(input)',ctx);
 const raw=f.text.split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>x.split(',').map(v=>v.trim()));
 let changed=0,maxJump=0,distance=0,rejected=0;
 for(const p of raw){ctx.line=p.join(',');const row=vm.runInContext('parseStationLine(line)',ctx);if(!row)continue;assert(Math.abs(row.lat-Number(Number(p[8])+'.'+p[9].padStart(4,'0')))<1e-10, JSON.stringify({p:p.slice(8,12),row}));assert(Math.abs(row.lon-Number(Number(p[10])+'.'+p[11].padStart(4,'0')))<1e-10);if(p[9].length<4||p[11].length<4)changed++;}
 const points=vm.runInContext('toRiskPoints(parseStationFile(input))',ctx);
 for(let i=1;i<points.length;i++){ctx.a=points[i-1];ctx.b=points[i];const d=vm.runInContext('haversineKm([a.la,a.lo],[b.la,b.lo])',ctx);ctx.d=d;if(vm.runInContext('isGpsGlitch(a,b,d)',ctx)){rejected++;continue;}distance+=d;maxJump=Math.max(maxJump,d);}
 for(const cluster of vm.runInContext('buildRiskClusters(toRiskPoints(parseStationFile(input)))',ctx)){for(let i=1;i<cluster.length;i++){ctx.a=cluster[i-1];ctx.b=cluster[i];assert(!vm.runInContext('isGpsGlitch(a,b,haversineKm([a.la,a.lo],[b.la,b.lo]))',ctx));}}
 results.push({date:f.date,valid:rows.length,correctedCoordinateRows:changed,distanceKm:+distance.toFixed(2),maxAcceptedStepKm:+maxJump.toFixed(2),rejectedSegments:rejected});
}
ctx.sample=[{t:'2025-01-01 00:00:00',la:35,lo:126,r:'O'},{t:'2025-01-01 00:01:00',la:36,lo:126,r:'O'}];assert.equal(vm.runInContext('buildRiskClusters(sample).length',ctx),2);
const report={checks:{syntax:'pass',coordinatesAgainstZeroPaddedDecimalReference:'9/9',riskClustersExcludeGpsJumps:'pass',syntheticJumpSplit:'pass',browser:'not tested'},files:results};
fs.writeFileSync('verification-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
