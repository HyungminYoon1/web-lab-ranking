import {getLevel} from "./levels.js";
export const HISTORY_LIMIT=32,MAX_ENTITIES=16;
export const DIRS=Object.freeze([{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}]);
const same=(a,b)=>a.x===b.x&&a.y===b.y;
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const inside=(level,p)=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.y>=0&&p.x<level.width&&p.y<level.height;
const wall=(level,p)=>level.blocks.some(b=>same(b,p));
const water=(level,p)=>level.water.some(b=>same(b,p));
export function bodies(state){return [...state.units.map(u=>({...u,group:"unit"})),...state.enemies.map(u=>({...u,group:"enemy"})),...state.buildings.map(u=>({...u,group:"city"})),...(state.convoy?[{...state.convoy,group:"convoy"}]:[])].filter(u=>u.hp>0&&!u.escaped);}
const actor=(state,id)=>[...state.units,...state.enemies,...state.buildings,...(state.convoy?[state.convoy]:[])].find(u=>u.id===id);
const occupant=(state,p)=>bodies(state).find(u=>same(u,p));
function hurt(state,id,amount,cause,events,queue){
 const target=actor(state,id);if(!target||target.hp<=0)return;const lost=Math.min(target.hp,amount);target.hp-=lost;events.push({kind:"hit",id,x:target.x,y:target.y,amount:lost,cause});
 if(target.hp<=0){events.push({kind:"death",id,x:target.x,y:target.y,cause});if(target.kind==="bomb"&&!state.exploded.includes(id)){state.exploded.push(id);queue.push({x:target.x,y:target.y,id});}}
}
function explosions(state,events,queue){
 for(let i=0;i<queue.length&&i<MAX_ENTITIES;i++){const blast=queue[i];events.push({kind:"explosion",...blast});for(const d of DIRS){const p={x:blast.x+d.x,y:blast.y+d.y},victim=occupant(state,p);if(victim)hurt(state,victim.id,1,"chain",events,queue);}}
}
function check(state){
 const level=getLevel(state.levelId),power=state.buildings.reduce((n,b)=>n+b.hp,0);
 if(power<level.minCityHp){state.status="failed";state.reason="시설 전력 부족: "+power+"/12";return;}
 if(state.convoy?.hp<=0){state.status="failed";state.reason="수송차가 파괴되었습니다.";return;}
 if((level.allAlive||level.objective?.type==="escape")&&state.units.some(u=>u.hp<=0)){state.status="failed";state.reason="기체 손실";return;}
 if(!state.units.some(u=>u.hp>0)){state.status="failed";state.reason="세 기체가 모두 정지했습니다.";return;}
 const waiting=level.waves.some(w=>w.turn>state.turn)||state.pending.length>0;
 const clear=!waiting&&!state.enemies.some(e=>e.hp>0),o=level.objective;
 const won=!o?clear:o.type==="escort"?state.routeIndex===o.route.length-1:o.type==="escape"?state.units.every(u=>u.escaped):o.type==="hold"?state.held>=o.turns:clear&&state.held>=o.turns;
 if(won){state.status="won";state.reason="목표 달성";}
}
function resolveObjective(state,events){
 const o=getLevel(state.levelId).objective;if(!o||state.status!=="playing")return;
 if(o.type==="escort"){
  const next=o.route[state.routeIndex+1];
  if(next&&state.convoy.hp>0&&state.units.some(u=>u.hp>0&&distance(u,state.convoy)===1)&&!occupant(state,next)){
   const from={x:state.convoy.x,y:state.convoy.y};Object.assign(state.convoy,next);state.routeIndex++;events.push({kind:"move",id:"V",from,to:next});
  }
 }else if(o.type==="hold"||o.type==="master"){
  const held=o.pads.every(p=>state.units.some(u=>u.hp>0&&!u.escaped&&same(u,p)&&(!p.unitId||p.unitId===u.id)));
  state.held=held?state.held+1:0;
 }
}
export function objectiveText(state){
 const o=getLevel(state.levelId).objective;if(!o)return "적 전멸";
 if(o.type==="escort")return "호송 "+state.routeIndex+"/"+(o.route.length-1)+" · V 내구도 "+state.convoy.hp+"/3";
 if(o.type==="escape")return "탈출 "+state.units.filter(u=>u.escaped).length+"/3";
 return "거점 "+state.held+"/"+o.turns+(o.type==="master"?" · 기술 "+state.skills+"/10 · 적 전멸":"");
}
function spawn(state,events){
 const level=getLevel(state.levelId);for(const wave of level.waves)if(wave.turn===state.turn)state.pending.push(...wave.enemies.map(e=>({...e})));
 const remaining=[];for(const enemy of state.pending){
  const positions=[];for(let y=0;y<8;y++)for(let x=0;x<8;x++){const p={x,y};if(!wall(level,p)&&!water(level,p)&&!occupant(state,p))positions.push(p);}
  positions.sort((a,b)=>distance(a,enemy)-distance(b,enemy)||a.y-b.y||a.x-b.x);
  const p=positions[0];if(!p){remaining.push(enemy);continue;}state.enemies.push({...enemy,...p,maxHp:enemy.hp});events.push({kind:"spawn",id:enemy.id,...p});
 }state.pending=remaining;
}
export function createRun(id=1){
 const level=getLevel(id),state={levelId:id,turn:1,ap:level.actionsPerTurn,units:structuredClone(level.units).map(u=>({...u,used:0})),buildings:structuredClone(level.buildings),enemies:[],pending:[],exploded:[],status:"playing",reason:"",actions:0,kills:0,skills:0,held:0,routeIndex:0};
 if(level.objective?.type==="escort")state.convoy={id:"V",...level.objective.route[0],hp:3,maxHp:3};
 spawn(state,[]);return state;
}
export function moveCells(state,unitId){
 const level=getLevel(state.levelId),unit=state.units.find(u=>u.id===unitId&&u.hp>0&&!u.escaped);if(!unit||unit.used>=2||state.ap<=0||state.status!=="playing")return [];
 const queue=[{x:unit.x,y:unit.y,n:0}],seen=new Set([unit.x+","+unit.y]),result=[];
 for(let k=0;k<queue.length;k++){const p=queue[k];if(p.n>=2)continue;for(const d of DIRS){const next={x:p.x+d.x,y:p.y+d.y},key=next.x+","+next.y;if(seen.has(key)||!inside(level,next)||wall(level,next)||water(level,next)||occupant(state,next))continue;seen.add(key);result.push(next);queue.push({...next,n:p.n+1});}}
 return result;
}
function clearLine(state,from,to){
 const level=getLevel(state.levelId);if(from.x!==to.x&&from.y!==to.y)return false;const dx=Math.sign(to.x-from.x),dy=Math.sign(to.y-from.y);let x=from.x+dx,y=from.y+dy;
 while(x!==to.x||y!==to.y){const p={x,y};if(wall(level,p)||occupant(state,p))return false;x+=dx;y+=dy;}return true;
}
function shove(state,id,dir,events,queue,depth=0){
 if(depth>=MAX_ENTITIES)return false;const level=getLevel(state.levelId),target=actor(state,id);if(!target||target.hp<=0)return true;
 const d=DIRS[dir],next={x:target.x+d.x,y:target.y+d.y};
 if(!inside(level,next)||wall(level,next)){hurt(state,id,2,"wall-impact",events,queue);return target.hp<=0;}
 const blocking=occupant(state,next);
 if(blocking?.group==="city"||blocking?.group==="convoy"){hurt(state,id,1,"collision",events,queue);hurt(state,blocking.id,1,"collision",events,queue);return false;}
 if(blocking&&!shove(state,blocking.id,dir,events,queue,depth+1)){hurt(state,id,1,"collision",events,queue);return false;}
 const from={x:target.x,y:target.y};target.x=next.x;target.y=next.y;events.push({kind:"push",id,from,to:next});
 if(water(level,next))hurt(state,id,99,"water",events,queue);return true;
}
export function applyAction(current,command){
 const invalid=reason=>({valid:false,reason,state:structuredClone(current),events:[]});
 if(current.status!=="playing")return invalid("임무가 종료되었습니다.");
 if(!command||!["move","skill"].includes(command.type)||!inside(getLevel(current.levelId),command))return invalid("잘못된 명령입니다.");
 const unit=current.units.find(u=>u.id===command.unitId&&u.hp>0&&!u.escaped);if(!unit||unit.used>=2||current.ap<=0)return invalid("행동 부족 또는 출격 불가");
 if(command.type==="skill"&&current.skills>=getLevel(current.levelId).skillLimit)return invalid("기술 사용 한도");
 const target=occupant(current,command);
 if(command.type==="move"){
  if(!moveCells(current,unit.id).some(p=>same(p,command)))return invalid("두 칸 이내의 비어 있는 경로를 선택하세요.");
 }else{
  if(!target||!["unit","enemy"].includes(target.group)||target.id===unit.id)return invalid("사거리 안의 기체 또는 적을 선택하세요.");
  if(unit.role==="swap"){if(distance(unit,target)>4)return invalid("위치 교환은 네 칸 이내입니다.");}
  else if(target.group!=="enemy"||distance(unit,target)>(unit.role==="ram"?2:4)||!clearLine(current,unit,target))return invalid("같은 직선 위의 적과 막히지 않은 사거리가 필요합니다.");
 }
 const state=structuredClone(current),u=actor(state,unit.id),events=[],queue=[];state.ap--;state.actions++;u.used++;
 if(command.type==="move"){const from={x:u.x,y:u.y};u.x=command.x;u.y=command.y;events.push({kind:"move",id:u.id,from,to:{x:u.x,y:u.y}});}
 else{
  state.skills++;const victim=actor(state,target.id);
  if(u.role==="swap"){const a={x:u.x,y:u.y},b={x:victim.x,y:victim.y};u.x=b.x;u.y=b.y;victim.x=a.x;victim.y=a.y;events.push({kind:"swap",id:u.id,other:victim.id,from:a,to:b});if(target.group==="enemy")hurt(state,victim.id,1,"phase",events,queue);}
  else{
   const dx=Math.sign(victim.x-u.x),dy=Math.sign(victim.y-u.y),forward=dx>0?0:dy>0?1:dx<0?2:3;
   hurt(state,victim.id,1,u.role,events,queue);
   if(victim.hp>0){if(u.role==="ram"){for(let k=0;k<2&&victim.hp>0;k++)if(!shove(state,victim.id,forward,events,queue))break;}
    else shove(state,victim.id,(forward+2)%4,events,queue);}
  }
 }
 explosions(state,events,queue);
 const exits=getLevel(state.levelId).objective?.exits;
 if(exits)for(const unit of state.units)if(unit.hp>0&&!unit.escaped&&exits.some(p=>same(p,unit))){unit.escaped=true;events.push({kind:"escape",id:unit.id});}
 state.kills=state.enemies.filter(e=>e.hp<=0).length;check(state);return {valid:true,reason:"",state,events};
}
function firePlan(state,enemy){
 const level=getLevel(state.levelId),d=DIRS[enemy.dir],cells=[],hits=[];
 if(enemy.kind==="blast"){
  const center={x:enemy.x+d.x*2,y:enemy.y+d.y*2};for(const delta of [{x:0,y:0},...DIRS]){const p={x:center.x+delta.x,y:center.y+delta.y};if(inside(level,p)&&!wall(level,p)){cells.push(p);const victim=occupant(state,p);if(victim&&victim.id!==enemy.id)hits.push(victim.id);}}
 }else{
  for(let k=1;k<=enemy.range;k++){const p={x:enemy.x+d.x*k,y:enemy.y+d.y*k};if(!inside(level,p)||wall(level,p))break;cells.push(p);const victim=occupant(state,p);if(victim){hits.push(victim.id);break;}}
 }
 return {enemyId:enemy.id,kind:enemy.kind,dir:enemy.dir,damage:enemy.damage,cells,hits};
}
function resolve(state){
 const events=[],plans=[],queue=[];const ids=state.enemies.filter(e=>e.hp>0).map(e=>e.id);
 for(const id of ids){const enemy=actor(state,id);if(!enemy||enemy.hp<=0)continue;const plan=firePlan(state,enemy);plans.push(plan);events.push({kind:"attack",...plan,from:{x:enemy.x,y:enemy.y}});for(const hit of plan.hits)hurt(state,hit,plan.damage,"enemy-fire",events,queue);explosions(state,events,queue);queue.length=0;}
 return {events,plans};
}
export function intentPlan(current){
 const state=structuredClone(current),out=resolve(state);return {...out,state,cityLoss:current.buildings.reduce((n,b)=>n+b.hp,0)-state.buildings.reduce((n,b)=>n+b.hp,0),unitLoss:current.units.reduce((n,b)=>n+b.hp,0)-state.units.reduce((n,b)=>n+b.hp,0),enemyKills:state.enemies.filter(e=>e.hp<=0).length-current.enemies.filter(e=>e.hp<=0).length};
}
function aim(state,enemy){
 const cities=state.buildings.filter(b=>b.hp>0).sort((a,b)=>distance(a,enemy)-distance(b,enemy)||a.id.localeCompare(b.id));const target=cities[0];if(!target)return;
 const dx=target.x-enemy.x,dy=target.y-enemy.y;enemy.dir=Math.abs(dx)>Math.abs(dy)?dx>0?0:2:dy>0?1:3;
}
export function endTurn(current){
 if(current.status!=="playing")return {valid:false,state:structuredClone(current),events:[],reason:"임무가 종료되었습니다."};
 const state=structuredClone(current),result=resolve(state);state.kills=state.enemies.filter(e=>e.hp<=0).length;check(state);
 resolveObjective(state,result.events);check(state);
 if(state.status!=="playing")return {valid:true,state,events:result.events};
 const level=getLevel(state.levelId);if(state.turn>=level.maxTurns){state.status="failed";state.reason="작전 시간 "+level.maxTurns+"턴을 넘겼습니다. 아군 오사와 연쇄 폭발을 활용하세요.";return {valid:true,state,events:result.events};}
 state.turn++;state.ap=level.actionsPerTurn;state.units.forEach(u=>{u.used=0;});state.enemies.filter(e=>e.hp>0).forEach(e=>aim(state,e));spawn(state,result.events);check(state);return {valid:true,state,events:result.events};
}
export function previewAction(state,command){const action=applyAction(state,command);return {...action,forecast:action.valid&&action.state.status==="playing"?intentPlan(action.state):null};}
export function previewTurn(state){return endTurn(state);}
export function report(state){
 const level=getLevel(state.levelId),power=state.buildings.reduce((n,b)=>n+b.hp,0),unitHp=state.units.reduce((n,u)=>n+u.hp,0),kills=state.enemies.filter(e=>e.hp<=0).length,total=level.waves.reduce((n,w)=>n+w.enemies.length,0);
 const score=state.status==="won"?Math.max(0,6000-state.turn*220-state.actions*60-(12-power)*180-(10-unitHp)*100+kills*100):0;
 return {won:state.status==="won",turn:state.turn,ap:state.ap,power,minPower:level.minCityHp,unitHp,kills,total,score,grade:score>=4800?"S":score>=3900?"A":"B"};
}
