import {RULES_VERSION} from "./levels.js";
import {createRun,applyAction,endTurn,report} from "./model.js";
export {RULES_VERSION};
export const CHALLENGE_ID="neon-master-16-v2";
const MAX_ACTIONS=20;
export function rankingDefinition(){return {game:"neon-tactics",rulesVersion:RULES_VERSION,challengeId:CHALLENGE_ID,title:"최종 방어선 · 전멸 / 무손실 시설 / 전원 생존 / 거점 4회 / 기술 10회",maxActions:MAX_ACTIONS,levelId:16};}
export function replayRanked(actions){
 if(!Array.isArray(actions)||actions.length>MAX_ACTIONS)throw new Error("Ranked action bounds");
 let state=createRun(16);
 for(const action of actions){
  if(!action||typeof action!=="object"||Array.isArray(action))throw new Error("Invalid action");
  const keys=Object.keys(action);let out;
  if(action.type==="endTurn"){
   if(keys.length!==1)throw new Error("Unexpected endTurn fields");out=endTurn(state);
  }else{
   if(keys.length!==4||keys.some(k=>!["type","unitId","x","y"].includes(k))||!["move","skill"].includes(action.type)||!["R","H","S"].includes(action.unitId)||!Number.isInteger(action.x)||!Number.isInteger(action.y)||action.x<0||action.x>7||action.y<0||action.y>7)throw new Error("Invalid command");
   out=applyAction(state,action);
  }
  if(!out.valid)throw new Error("Illegal ranked command");state=out.state;
 }
 const r=report(state);
 // Tie-break values are ascending: fewer turns/actions/losses wins equal scores.
 return {won:r.won,score:r.score,tieBreak:[r.turn,state.actions,12-r.power,10-r.unitHp],summary:{status:state.status,turn:r.turn,commands:state.actions,power:r.power,unitHp:r.unitHp,kills:r.kills,held:state.held,skills:state.skills}};
}
