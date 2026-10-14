import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {unstable_dev} from 'wrangler';

process.env.WRANGLER_SEND_METRICS='false';
const root=path.resolve('output/stream-diagnostics-20261014');await fs.mkdir(root,{recursive:true});
const evidence=await fs.mkdtemp(path.join(root,'binding-'));
await fs.mkdir('.wrangler',{recursive:true});
const state=await fs.mkdtemp(path.resolve('.wrangler/stream-probe-'));
const report={environment:'LOCAL_WORKERD_REDUCTION',productionWrites:0,retries:0,cases:[],diagnostics:[],status:'RUNNING'};
const original=console.error;let phase='startup',worker;
console.error=(...args)=>{
  const message=args.map(String).join(' ');
  if(message.includes("Can't read from request stream after response has been sent"))report.diagnostics.push({phase,kind:'unread_after_response'});
  original(...args);
};
try{
  worker=await unstable_dev('tools/fixtures/stream-lifecycle.worker.mjs',{config:'tools/fixtures/stream-lifecycle.jsonc',ip:'127.0.0.1',port:0,inspectorPort:0,
    local:true,persistTo:state,envFiles:[],logLevel:'error',
    experimental:{forceLocal:true,disableExperimentalWarning:true,disableDevRegistry:true,showInteractiveDevSession:false,watch:false}});
  for(const mode of ['direct','direct-cancel','object-unread','object-cancel','object-read','buffer-before-object']){
    for(const bytes of [10,49152]){
      phase=mode+'-'+bytes;const before=report.diagnostics.length;
      const response=await fetch(`http://127.0.0.1:${worker.port}/${mode}`,{method:'POST',body:' '.repeat(bytes),redirect:'error',signal:AbortSignal.timeout(10000)});
      assert.equal(response.status,415);assert.equal((await response.json()).error,'json_required');
      await new Promise(resolve=>setTimeout(resolve,100));
      const result={mode,bytes,status:response.status,diagnostics:report.diagnostics.slice(before)};report.cases.push(result);console.log(JSON.stringify(result));
    }
  }
  report.status='OBSERVED';
}catch(error){
  report.status='FAIL';report.failure={name:error.name,code:error.code};process.exitCode=1;
}finally{
  if(worker)await worker.stop();console.error=original;
  await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2)+'\r\n','utf8');
  console.log(JSON.stringify({evidence:path.relative(process.cwd(),evidence),diagnostics:report.diagnostics.length}));
}
