import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

test('local transport keeps the exact native runtime used with the bounded entry regression',()=>{
  const packageFile=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(fs.readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
  const expected='1.20261014.1';
  assert.equal(require('workerd').version,expected,'Loaded native runtime must match the verified release');
  assert.equal(packageFile.overrides?.workerd,expected);
  assert.equal(lock.packages['node_modules/workerd'].version,expected);
});

test('the buffered local Worker is not the production deployment entry',()=>{
  const config=JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(config.main,'src/worker.js');
  assert.equal(config.vars.ALLOW_LOCAL,'false');
});
