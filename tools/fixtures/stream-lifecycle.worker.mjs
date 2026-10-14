import {DurableObject} from 'cloudflare:workers';

// Local-only reduction, not a deployable service. Every probe input is bounded.
async function consume(request){
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  const parts=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>49152){await reader.cancel();throw new Error('Probe body limit');}parts.push(value);}
  const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
export class StreamProbe extends DurableObject {
  constructor(ctx,env){super(ctx,env);}
  async fetch(request){
    const mode=new URL(request.url).pathname;
    if(mode==='/object-read')await consume(request);
    if(mode==='/object-cancel'||mode==='/buffer-before-object')await request.body?.cancel();
    return Response.json({error:'json_required'},{status:415});
  }
}
export default {
  async fetch(request,env){
    const mode=new URL(request.url).pathname;
    if(mode==='/direct')return Response.json({error:'json_required'},{status:415});
    if(mode==='/direct-cancel'){await request.body?.cancel();return Response.json({error:'json_required'},{status:415});}
    if(mode==='/buffer-before-object')request=new Request(request,{body:await consume(request)});
    return env.PROBE.get(env.PROBE.idFromName('stream-probe')).fetch(request);
  }
};
