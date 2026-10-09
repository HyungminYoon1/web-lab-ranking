import {DurableObject} from "cloudflare:workers";
import {RankingRepository} from "./repository.js";
import {RankingService} from "./service.js";
import {route} from "./controller.js";

export class RankingObject extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    this.service=new RankingService(new RankingRepository(ctx.storage));
  }
  fetch(request){return route(request,this.service);}
}

function allowed(origin,env){
  return origin===env.ALLOWED_ORIGIN||(env.ALLOW_LOCAL==="true"&&/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin??""));
}
function decorate(response,origin){
  const headers=new Headers(response.headers);
  headers.set("Cache-Control","no-store");
  headers.set("X-Content-Type-Options","nosniff");
  headers.set("Referrer-Policy","no-referrer");
  headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");
  headers.set("Vary","Origin");
  if(origin){headers.set("Access-Control-Allow-Origin",origin);headers.set("Access-Control-Allow-Methods","GET, POST, DELETE, OPTIONS");headers.set("Access-Control-Allow-Headers","Content-Type, Authorization");headers.set("Access-Control-Max-Age","600");}
  return new Response(response.body,{status:response.status,headers});
}
export default {
  async fetch(request,env){
    const origin=request.headers.get("Origin"),path=new URL(request.url).pathname;
    if(origin&&!allowed(origin,env))return decorate(Response.json({error:"origin_denied"},{status:403}),null);
    if(request.method==="OPTIONS")return decorate(new Response(null,{status:origin&&allowed(origin,env)?204:403}),allowed(origin,env)?origin:null);
    if(env.RANKING_ENABLED!=="true")return decorate(Response.json({error:"ranking_paused"},{status:503}),origin);
    if(!origin&&path!=="/health"&&!path.startsWith("/v1/boards/"))return decorate(Response.json({error:"origin_required"},{status:403}),null);
    if(!["GET","POST","DELETE"].includes(request.method))return decorate(Response.json({error:"method_not_allowed"},{status:405}),origin);
    try{
      const stub=env.RANKING.get(env.RANKING.idFromName("public-ranking-v1"));
      return decorate(await stub.fetch(request),origin);
    }catch{return decorate(Response.json({error:"service_unavailable"},{status:503}),origin);}
  }
};
