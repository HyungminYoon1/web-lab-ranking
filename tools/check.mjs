import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {definitions} from "../src/domain.js";
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=walk("src").concat(walk("client"),walk("test"),walk("tools"));
for(const file of files){
  if(!/\.m?js$/.test(file))continue;
  const buffer=fs.readFileSync(file),text=new TextDecoder("utf-8",{fatal:true}).decode(buffer);
  if(buffer[0]===0xef&&buffer[1]===0xbb&&buffer[2]===0xbf)throw Error("BOM: "+file);
  if(/(?<!\r)\n/.test(text))throw Error("Line endings: "+file);
  const r=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});if(r.status!==0)throw Error("Syntax: "+file);
  if(/console\.(log|error)|eval\(|new Function\(/.test(text)&&file.startsWith("src"))throw Error("Unsafe runtime output/eval: "+file);
}
const manifest=JSON.parse(fs.readFileSync("src/games/manifest.json","utf8"));
for(const file of manifest.files){
  const actual=crypto.createHash("sha256").update(fs.readFileSync(file.path)).digest("hex");
  if(actual!==file.sha256)throw Error("Game snapshot mismatch: "+file.path);
}
if(definitions().length!==2)throw Error("Only two boards are approved");
const config=JSON.parse(fs.readFileSync("wrangler.jsonc","utf8"));
if(config.observability?.enabled||config.triggers||config.routes||config.assets||config.d1_databases||config.usage_model)throw Error("Unapproved deployment resource");
if(config.migrations[0].new_sqlite_classes[0]!=="RankingObject")throw Error("SQLite-only Free database required");
console.log("CHECK PASS: layers, two snapshots, syntax, encoding and deployment resources");
