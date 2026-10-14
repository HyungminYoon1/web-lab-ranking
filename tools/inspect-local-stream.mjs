import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
import {startLocalDev} from './local-dev.mjs';

// Local diagnosis: do not suppress native logs, retry requests or expose bodies,
// credentials or raw exception messages. A short idle window attributes late logs.
process.env.WRANGLER_SEND_METRICS='false';
const require=createRequire(import.meta.url),origin='https://hyungminyoon1.github.io';
const {values}=parseArgs({options:{'assert-clean':{type:'boolean',default:false},cycles:{type:'string',default:'1'}}});
const cycles=Number(values.cycles);assert.ok(Number.isInteger(cycles)&&cycles>=1&&cycles<=20,'Bounded local cycles');
const root=path.resolve('output/stream-diagnostics-20261014');await fs.mkdir(root,{recursive:true});
const evidence=await fs.mkdtemp(path.join(root,'observe-'));
const report={node:process.version,workerd:require('workerd').version,productionWrites:0,retries:0,cycles,cases:[],diagnostics:[],status:'RUNNING'};
const originals={error:console.error,warn:console.warn};let phase='startup',server;
for(const level of ['error','warn'])console[level]=(...args)=>{
  const message=args.map(String).join(' ');
  if(message.includes("Can't read from request stream after response has been sent"))report.diagnostics.push({phase,kind:'unread_after_response',level});
  else if(message.includes('Network connection lost'))report.diagnostics.push({phase,kind:'network_connection_lost',level});
  else if(/Uncaught|Failed to drain|Error inside ProxyWorker/.test(message))report.diagnostics.push({phase,kind:'other_runtime_error',level});
  originals[level](...args);
};
const waitForDiagnostics=()=>new Promise(resolve=>setTimeout(resolve,100));
const cases=[
  {name:'valid-json',body:'{}',status:201},
  {name:'invalid-json',body:'{',status:400,error:'invalid_json'},
  {name:'empty-json',body:'',status:400},
  {name:'missing-content-type',body:new Uint8Array([123,125]),contentType:null,status:415,error:'json_required'},
  {name:'unknown-field',body:'{"extra":true}',status:400,error:'invalid_fields'},
  {name:'foreign-origin',body:'{}',origin:'https://untrusted.example',status:403,error:'origin_denied'},
  {name:'missing-origin',body:'{}',origin:null,status:403,error:'origin_required'},
  {name:'unknown-route',path:'/missing',body:'{}',status:404,error:'not_found'},
  {name:'wrong-method',method:'PUT',body:'{}',status:405,error:'method_not_allowed'},
  {name:'plain-small',body:'text/plain',contentType:'text/plain',status:415,error:'json_required'},
  {name:'plain-at-cap',body:' '.repeat(49152),contentType:'text/plain',status:415,error:'json_required'},
  {name:'json-at-cap',body:'{}'+' '.repeat(49150),status:201},
  {name:'json-over-cap',body:' '.repeat(49153),status:413,error:'payload_too_large'}
];
const own=new Set();
async function send(item){
  const response=await fetch(server.url+(item.path??'/v1/identities'),{method:item.method??'POST',redirect:'error',
    headers:{...(item.origin===null?{}:{Origin:item.origin??origin}),...(item.contentType===null?{}:{'Content-Type':item.contentType??'application/json'}),...(item.token?{Authorization:'Bearer '+item.token}:{})},
    body:item.body,signal:AbortSignal.timeout(10000)});
  const data=await response.json();
  if(response.status===201&&data.playerId&&data.token)own.add(data);
  assert.equal(response.status,item.status,'Expected HTTP status for '+item.name);
  if(item.error)assert.equal(data.error,item.error);
  return {data,status:response.status};
}
async function remove(identity){
  const result=await send({name:'cleanup',method:'DELETE',path:'/v1/identity',body:JSON.stringify({playerId:identity.playerId}),token:identity.token,status:200});
  assert.equal(result.data.deleted,true);own.delete(identity);
}
try{
  server=await startLocalDev({port:0,persistTo:path.join(evidence,'state'),watch:false,logLevel:'error'});
  for(let cycle=0;cycle<cycles;cycle++){
   for(const item of cases){
    phase=cycle+':'+item.name;const before=report.diagnostics.length;
    const result=await send(item);
    // Immediate valid POST, no diagnostic waiting/retry before the follow-up.
    const next=await send({name:'followup',body:'{}',status:201});await remove(next.data);
    if(own.has(result.data))await remove(result.data);
    await waitForDiagnostics();
    const row={cycle,name:item.name,bytes:Buffer.byteLength(item.body),status:result.status,followup:next.status,diagnostics:report.diagnostics.slice(before)};
    report.cases.push(row);if(cycle===0||row.diagnostics.length)console.log(JSON.stringify(row));
   }
   console.log(JSON.stringify({completedCycle:cycle+1,checkedFlows:report.cases.length,diagnostics:report.diagnostics.length}));
  }
  phase='idle';await waitForDiagnostics();assert.equal(own.size,0);
  if(values['assert-clean'])assert.equal(report.diagnostics.length,0,'Rejected local requests must not leave uncaught native stream errors');
  report.status=values['assert-clean']?'PASS':'OBSERVED';
}catch(error){report.status='FAIL';report.failure={name:error.name,code:error.code};process.exitCode=1;}
finally{
  phase='cleanup';for(const identity of own){try{await remove(identity);}catch{report.cleanupFailed=true;process.exitCode=1;}}
  if(server)await server.stop();
  console.error=originals.error;console.warn=originals.warn;
  if(values['assert-clean']&&report.diagnostics.length){report.status='FAIL';process.exitCode=1;}
  if(report.status==='PASS'||report.status==='OBSERVED'){
    try{
      // Read counts only from this run's newly created, now stopped local DB.
      // Never open existing development state or inspect credential/payload rows.
      const directory=path.join(evidence,'state/v3/do/web-lab-ranking-RankingObject');
      const files=(await fs.readdir(directory)).filter(file=>/^[0-9a-f]{64}\.sqlite$/.test(file));
      assert.equal(files.length,1,'Exactly one local test object');
      const {DatabaseSync}=await import('node:sqlite');const database=new DatabaseSync(path.join(directory,files[0]),{readOnly:true});
      try{
        report.remainingRows=Object.fromEntries(['players','tickets','bests'].map(table=>[table,database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
        assert.deepEqual(report.remainingRows,{players:0,tickets:0,bests:0});
      }finally{database.close();}
    }catch(error){report.status='FAIL';report.failure={stage:'local-cleanup-counts',name:error.name,code:error.code};process.exitCode=1;}
  }
  await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2)+'\r\n','utf8');
  console.log(JSON.stringify({status:report.status,cases:report.cases.length,diagnostics:report.diagnostics,remainingRows:report.remainingRows,productionWrites:0,evidence:path.relative(process.cwd(),evidence)}));
}
