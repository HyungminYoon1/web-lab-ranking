import {DatabaseSync} from "node:sqlite";
export function storage(){
  const database=new DatabaseSync(":memory:");
  return {
    sql:{exec(query,...args){
      const statement=database.prepare(query),rows=statement.columns().length?statement.all(...args):(statement.run(...args),[]);
      return {toArray:()=>rows};
    }},
    transactionSync(callback){
      database.exec("BEGIN");try{const out=callback();database.exec("COMMIT");return out;}catch(error){database.exec("ROLLBACK");throw error;}
    },
    close(){database.close();}
  };
}
