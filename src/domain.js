import * as parcel from "./games/parcel-panic/ranked.js";
import * as neon from "./games/neon-tactics/ranked.js";

export const API_VERSION=1;
export const MAX_BODY=48*1024;
export const POLICY=Object.freeze({requestsPerDay:10000,identitiesPerDay:500,runsPerDay:1000,identities:2000,tickets:1000,bests:4000,retentionMs:180*86400000,ticketMs:4*3600000});
const games=Object.freeze({"parcel-panic":parcel,"neon-tactics":neon});
export class Failure extends Error {
  constructor(status,code){super(code);this.status=status;this.code=code;}
}
export function definition(game){
  if(!Object.hasOwn(games,game))throw new Failure(404,"unknown_game");
  return games[game].rankingDefinition();
}
export function definitions(){return Object.keys(games).map(definition);}
export function exactObject(value,keys){
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw new Failure(400,"invalid_fields");
  return value;
}
export function id(value){
  if(typeof value!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new Failure(400,"invalid_id");
  return value;
}
export function nickname(value){
  if(typeof value!=="string")throw new Failure(400,"invalid_nickname");
  const text=value.normalize("NFC").trim();
  if([...text].length>16||!/^[\p{L}\p{N} _-]*$/u.test(text))throw new Failure(400,"invalid_nickname");
  return text;
}
export function credential(value){
  if(typeof value!=="string"||!/^Bearer [0-9a-f]{64}$/.test(value))throw new Failure(401,"unauthorized");
  return value.slice(7);
}
export async function digest(value){
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");
}
export function randomCredential(){
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
}
export function submission(value){
  exactObject(value,["playerId","runId","game","rulesVersion","challengeId","nickname","actions"]);
  id(value.playerId);id(value.runId);nickname(value.nickname);
  const d=definition(value.game);
  if(value.rulesVersion!==d.rulesVersion||value.challengeId!==d.challengeId)throw new Failure(409,"rules_changed");
  if(!Array.isArray(value.actions)||value.actions.length>d.maxActions||new TextEncoder().encode(JSON.stringify(value.actions)).length>MAX_BODY)throw new Failure(400,"action_limit");
  return d;
}
export function verified(game,actions){
  let result;
  try{result=games[game].replayRanked(actions);}catch{throw new Failure(422,"illegal_replay");}
  if(!result.won)throw new Failure(422,"challenge_not_completed");
  if(!Number.isSafeInteger(result.score)||result.score<0||result.score>100000||!Array.isArray(result.tieBreak)||result.tieBreak.length>4||result.tieBreak.some(n=>!Number.isSafeInteger(n)||n<0||n>100000))throw new Failure(503,"invalid_rules_result");
  return result;
}
export function compare(a,b){
  if(a.score!==b.score)return b.score-a.score;
  for(let n=0;n<4;n++){const diff=(a.tieBreak[n]??0)-(b.tieBreak[n]??0);if(diff)return diff;}
  return 0;
}
export function publicRecord(row,position){
  return {rank:position,nickname:row.nickname||"익명-"+row.player_id.slice(0,4),score:row.score,tieBreak:[row.tie0,row.tie1,row.tie2,row.tie3],achievedAt:new Date(row.achieved_at).toISOString()};
}
