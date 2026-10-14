import http from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {MAX_BODY} from '../src/domain.js';

// Development transport only. Business rules, authentication and storage remain
// in the unchanged Worker. Never forward an unfinished/oversized upload to workerd.
export async function createLocalBodyGate({port=8787,forward,allowedOrigin='https://hyungminyoon1.github.io',allowLocal=false,uploadTimeoutMs=10000}={}){
  if(typeof forward!=='function')throw new TypeError('A local forwarder is required');
  const stats={bufferedBytesMax:0,forwardedBytesMax:0,rejected:0},sockets=new Set();
  const server=http.createServer({maxHeaderSize:16384},handle);
  server.maxConnections=64;
  function handle(request,response){
    let size=0,settled=false;const parts=[],abort=new AbortController();
    const timer=setTimeout(()=>reject(408,'request_timeout'),uploadTimeoutMs);timer.unref();
    function reject(status,error){
      if(settled)return;settled=true;parts.length=0;clearTimeout(timer);stats.rejected++;
      // Do not read/discard an unbounded rejected body. This connection cannot be
      // reused because its body is unfinished; Node completes the error response.
      request.read(0);request.pause();
      const payload=JSON.stringify({error}),socket=request.socket;
      response.writeHead(status,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),'Connection':'close','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Vary':'Origin',
        ...(request.headers.origin===allowedOrigin||(allowLocal&&/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(request.headers.origin??''))?{'Access-Control-Allow-Origin':request.headers.origin}:{} )});
      // response.end() on an unread upload makes Node destroySoon(), which can
      // reset TCP before the peer reads 413. Send a complete length-framed reply,
      // half-close the write side, then bound the remaining socket lifetime.
      response.write(payload,()=>{
        socket.end();
        const closeTimer=setTimeout(()=>socket.destroy(),1000);closeTimer.unref();
        socket.once('close',()=>clearTimeout(closeTimer));
      });
    }
    request.on('error',()=>{settled=true;parts.length=0;clearTimeout(timer);abort.abort();});
    request.on('aborted',()=>{settled=true;parts.length=0;clearTimeout(timer);abort.abort();});
    response.on('close',()=>{if(!response.writableFinished)abort.abort();});
    request.on('data',chunk=>{
      if(settled)return;
      size+=chunk.length;
      if(size>MAX_BODY){reject(413,'payload_too_large');return;}
      parts.push(chunk);stats.bufferedBytesMax=Math.max(stats.bufferedBytesMax,size);
    });
    request.on('end',async()=>{
      if(settled)return;settled=true;clearTimeout(timer);
      try{
        const headers=new Headers();
        const hop=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','host','expect']);
        for(const token of (request.headers.connection??'').split(','))hop.add(token.trim().toLowerCase());
        for(const [key,value] of Object.entries(request.headers)){
          if(value!==undefined&&!hop.has(key))headers.set(key,Array.isArray(value)?value.join(', '):value);
        }
        const method=request.method,body=Buffer.concat(parts,size);parts.length=0;
        stats.forwardedBytesMax=Math.max(stats.forwardedBytesMax,size);
        // GET/HEAD body semantics remain those of Fetch; no method rewriting.
        const init={method,headers,signal:abort.signal,...(!['GET','HEAD'].includes(method)?{body}: {})};
        const result=await forward(new Request(new URL(request.url,'http://127.0.0.1'),init));
        // Node Fetch has already decoded gzip/br; do not advertise the old wire
        // encoding/length for that decoded stream.
        const outputHeaders={};for(const [key,value] of result.headers)if(!hop.has(key)&&!['content-encoding','content-length'].includes(key))outputHeaders[key]=value;
        response.writeHead(result.status,outputHeaders);
        if(result.body)await pipeline(Readable.fromWeb(result.body),response);else response.end();
      }catch{
        if(response.destroyed)return;
        if(response.headersSent){response.destroy();return;}
        response.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end('{"error":"service_unavailable"}');
      }
    });
    if(Number(request.headers['content-length']??0)>MAX_BODY)reject(413,'payload_too_large');
  }
  // Do not grant 100-continue to a body whose advertised length is already over
  // the cap. The same guard owns both ordinary and Expect requests.
  server.on('checkContinue',(request,response)=>{
    if(Number(request.headers['content-length']??0)<=MAX_BODY)response.writeContinue();
    handle(request,response);
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,stats,
    stop:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());for(const socket of sockets)socket.destroy();})};
}
