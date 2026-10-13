import {API_VERSION,POLICY,Failure,definition,definitions,exactObject,id,credential,digest,randomCredential,nickname,submission,verified} from "./domain.js";

export class RankingService {
  constructor(repository,options={}){
    this.repository=repository;this.clock=options.clock??(()=>Date.now());this.randomId=options.randomId??(()=>crypto.randomUUID());
    this.cache=new Map();this.lastCleanup=0;
  }
  prepare(){
    const now=this.clock();this.repository.quota(now);
    if(now-this.lastCleanup>=60000){this.repository.cleanup(now);this.lastCleanup=now;this.cache.clear();}
    return now;
  }
  health(){return {status:"ok",apiVersion:API_VERSION,games:definitions()};}
  async authenticate(playerId,authorization){
    id(playerId);const hash=await digest(credential(authorization)),p=this.repository.player(playerId);
    if(!p||p.digest!==hash)throw new Failure(401,"unauthorized");
    if(p.touched_at<this.clock()-POLICY.retentionMs)throw new Failure(401,"expired_identity");
    return p;
  }
  async createIdentity(body){
    exactObject(body,[]);const now=this.prepare(),playerId=this.randomId(),token=randomCredential();
    this.repository.createPlayer(playerId,await digest(token),now);
    return {playerId,token,retentionDays:180};
  }
  async start(body,authorization){
    exactObject(body,["playerId","game","rulesVersion","challengeId"]);
    const d=definition(body.game);
    if(body.rulesVersion!==d.rulesVersion||body.challengeId!==d.challengeId)throw new Failure(409,"rules_changed");
    this.prepare();await this.authenticate(body.playerId,authorization);const now=this.clock();
    const runId=this.randomId();this.repository.createTicket(runId,body.playerId,d,now);
    return {runId,definition:d,expiresAt:new Date(now+POLICY.ticketMs).toISOString()};
  }
  async submit(body,authorization){
    const d=submission(body);this.prepare();await this.authenticate(body.playerId,authorization);const now=this.clock();
    const ticket=this.repository.ticket(body.runId);
    if(!ticket||ticket.player_id!==body.playerId)throw new Failure(404,"unknown_attempt");
    if(ticket.game!==d.game||ticket.rules!==d.rulesVersion||ticket.challenge!==d.challengeId)throw new Failure(409,"rules_changed");
    if(ticket.expires_at<=now)throw new Failure(410,"attempt_expired");
    // Return the original response for a network retry, never reuse a ticket for another result.
    if(ticket.result)return JSON.parse(ticket.result);
    const result=verified(d.game,body.actions);
    const saved=this.repository.saveBest(body.playerId,body.runId,d,nickname(body.nickname),result,body.actions,now);
    this.cache.delete(d.game);return saved;
  }
  board(game){
    const d=definition(game),now=this.prepare(),cached=this.cache.get(game);
    if(cached&&cached.expires>now)return cached.response;
    const response={definition:d,entries:this.repository.board(d,now),retentionDays:180};
    this.cache.set(game,{expires:now+30000,response});return response;
  }
  async remove(body,authorization){
    exactObject(body,["playerId"]);this.prepare();await this.authenticate(body.playerId,authorization);
    const result=this.repository.deletePlayer(body.playerId);this.cache.clear();return result;
  }
}
