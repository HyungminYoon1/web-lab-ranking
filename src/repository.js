import {POLICY,Failure,compare,publicRecord} from "./domain.js";

export class RankingRepository {
  constructor(storage){
    this.storage=storage;this.sql=storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, digest TEXT NOT NULL, created_at INTEGER NOT NULL, touched_at INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS players_expiry ON players(touched_at)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, game TEXT NOT NULL, rules TEXT NOT NULL, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL, result TEXT)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS tickets_expiry ON tickets(expires_at)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS tickets_player ON tickets(player_id)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS bests (player_id TEXT NOT NULL, game TEXT NOT NULL, rules TEXT NOT NULL, challenge TEXT NOT NULL, nickname TEXT NOT NULL, score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100000), tie0 INTEGER NOT NULL, tie1 INTEGER NOT NULL, tie2 INTEGER NOT NULL, tie3 INTEGER NOT NULL, achieved_at INTEGER NOT NULL, actions TEXT NOT NULL, PRIMARY KEY(player_id,game,rules))");
    this.sql.exec("CREATE INDEX IF NOT EXISTS leaderboard ON bests(game,rules,score DESC,tie0,tie1,tie2,tie3,achieved_at,player_id)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS bests_expiry ON bests(achieved_at)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS daily (day INTEGER PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0, identities INTEGER NOT NULL DEFAULT 0, runs INTEGER NOT NULL DEFAULT 0)");
  }
  rows(query,...bindings){return this.sql.exec(query,...bindings).toArray();}
  first(query,...bindings){return this.rows(query,...bindings)[0];}
  transaction(callback){return this.storage.transactionSync(callback);}
  quota(now,kind="requests"){
    const day=Math.floor(now/86400000),limit={requests:POLICY.requestsPerDay,identities:POLICY.identitiesPerDay,runs:POLICY.runsPerDay}[kind];
    return this.transaction(()=>{
      this.sql.exec("INSERT INTO daily(day) VALUES(?) ON CONFLICT(day) DO NOTHING",day);
      const row=this.first("SELECT requests,identities,runs FROM daily WHERE day=?",day);
      if(row[kind]>=limit)throw new Failure(429,"daily_limit");
      const query={requests:"UPDATE daily SET requests=requests+1 WHERE day=?",identities:"UPDATE daily SET identities=identities+1 WHERE day=?",runs:"UPDATE daily SET runs=runs+1 WHERE day=?"}[kind];
      this.sql.exec(query,day);
    });
  }
  cleanup(now){
    this.transaction(()=>{
      this.sql.exec("DELETE FROM tickets WHERE id IN (SELECT id FROM tickets WHERE expires_at<? LIMIT 100)",now);
      const expired=this.rows("SELECT id FROM players WHERE touched_at<? LIMIT 25",now-POLICY.retentionMs);
      for(const p of expired){this.sql.exec("DELETE FROM tickets WHERE player_id=?",p.id);this.sql.exec("DELETE FROM bests WHERE player_id=?",p.id);this.sql.exec("DELETE FROM players WHERE id=?",p.id);}
      this.sql.exec("DELETE FROM daily WHERE day<?",Math.floor(now/86400000)-7);
    });
  }
  count(table){
    const queries={players:"SELECT COUNT(*) AS n FROM players",tickets:"SELECT COUNT(*) AS n FROM tickets",bests:"SELECT COUNT(*) AS n FROM bests"};
    return this.first(queries[table]).n;
  }
  createPlayer(playerId,hash,now){
    if(this.count("players")>=POLICY.identities)throw new Failure(503,"storage_limit");
    this.quota(now,"identities");
    this.sql.exec("INSERT INTO players(id,digest,created_at,touched_at) VALUES(?,?,?,?)",playerId,hash,now,now);
  }
  player(playerId){return this.first("SELECT * FROM players WHERE id=?",playerId);}
  createTicket(runId,playerId,d,now){
    if(this.count("tickets")>=POLICY.tickets)throw new Failure(503,"storage_limit");
    this.quota(now,"runs");
    this.transaction(()=>{
      // Keep at most three open attempts per identity and game.
      this.sql.exec("DELETE FROM tickets WHERE id IN (SELECT id FROM tickets WHERE player_id=? AND game=? AND result IS NULL ORDER BY expires_at DESC LIMIT -1 OFFSET 2)",playerId,d.game);
      this.sql.exec("INSERT INTO tickets(id,player_id,game,rules,challenge,expires_at) VALUES(?,?,?,?,?,?)",runId,playerId,d.game,d.rulesVersion,d.challengeId,now+POLICY.ticketMs);
      this.sql.exec("UPDATE players SET touched_at=? WHERE id=?",now,playerId);
    });
  }
  ticket(runId){return this.first("SELECT * FROM tickets WHERE id=?",runId);}
  saveBest(playerId,runId,d,name,result,actions,now){
    return this.transaction(()=>{
      const old=this.first("SELECT * FROM bests WHERE player_id=? AND game=? AND rules=?",playerId,d.game,d.rulesVersion);
      if(!old&&this.count("bests")>=POLICY.bests)throw new Failure(503,"storage_limit");
      const prior=old?{score:old.score,tieBreak:[old.tie0,old.tie1,old.tie2,old.tie3]}:null;
      const improved=!prior||compare(result,prior)<0;
      if(improved){
        const ties=Array.from({length:4},(_,i)=>result.tieBreak[i]??0);
        this.sql.exec("INSERT INTO bests(player_id,game,rules,challenge,nickname,score,tie0,tie1,tie2,tie3,achieved_at,actions) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(player_id,game,rules) DO UPDATE SET nickname=excluded.nickname,score=excluded.score,tie0=excluded.tie0,tie1=excluded.tie1,tie2=excluded.tie2,tie3=excluded.tie3,achieved_at=excluded.achieved_at,actions=excluded.actions",playerId,d.game,d.rulesVersion,d.challengeId,name,result.score,...ties,now,JSON.stringify(actions));
      }
      const response={accepted:true,improved,score:result.score,tieBreak:result.tieBreak,summary:result.summary};
      this.sql.exec("UPDATE tickets SET result=? WHERE id=?",JSON.stringify(response),runId);
      this.sql.exec("UPDATE players SET touched_at=? WHERE id=?",now,playerId);
      return response;
    });
  }
  board(d,now){
    const rows=this.rows("SELECT b.player_id,b.nickname,b.score,b.tie0,b.tie1,b.tie2,b.tie3,b.achieved_at FROM bests b JOIN players p ON p.id=b.player_id WHERE b.game=? AND b.rules=? AND p.touched_at>=? ORDER BY b.score DESC,b.tie0,b.tie1,b.tie2,b.tie3,b.achieved_at,b.player_id LIMIT 50",d.game,d.rulesVersion,now-POLICY.retentionMs);
    let rank=0,previous=null;
    return rows.map((r,i)=>{const result={score:r.score,tieBreak:[r.tie0,r.tie1,r.tie2,r.tie3]};if(!previous||compare(result,previous)!==0)rank=i+1;previous=result;return publicRecord(r,rank);});
  }
  deletePlayer(playerId){
    this.transaction(()=>{this.sql.exec("DELETE FROM bests WHERE player_id=?",playerId);this.sql.exec("DELETE FROM tickets WHERE player_id=?",playerId);this.sql.exec("DELETE FROM players WHERE id=?",playerId);});
    return {deleted:true};
  }
}
