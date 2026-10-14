import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {unstable_dev} from 'wrangler';
import {createLocalBodyGate} from './local-body-gate.mjs';

export async function startLocalDev({port=8787,persistTo='.wrangler/state',watch=true,logLevel='warn',allowLocal=false}={}){
  const config=JSON.parse(await fs.readFile('wrangler.jsonc','utf8'));
  const worker=await unstable_dev('tools/local-worker-entry.mjs',{config:'wrangler.jsonc',ip:'127.0.0.1',port:0,inspectorPort:0,
    local:true,persistTo,envFiles:[],logLevel,vars:{...config.vars,ALLOW_LOCAL:allowLocal?'true':'false'},
    experimental:{forceLocal:true,disableExperimentalWarning:true,disableDevRegistry:true,showInteractiveDevSession:false,watch}});
  let gate;
  try{
    gate=await createLocalBodyGate({port,allowedOrigin:config.vars.ALLOWED_ORIGIN,allowLocal,forward:request=>{
      const url=new URL(request.url);url.port=String(worker.port);url.hostname='127.0.0.1';url.protocol='http:';
      return fetch(new Request(url,request));
    }});
  }catch(error){await worker.stop();throw error;}
  return {...gate,stop:async()=>{await gate.stop();await worker.stop();}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  process.env.WRANGLER_SEND_METRICS='false';
  const {values}=parseArgs({options:{port:{type:'string',default:'8787'},'allow-local':{type:'boolean',default:false}}});
  const port=Number(values.port);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Use a valid loopback port');
  const server=await startLocalDev({port,persistTo:path.resolve('.wrangler/state'),allowLocal:values['allow-local']});
  console.log(`Local ranking: ${server.url} (49,152-byte limit; local database only)`);
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;await server.stop();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
