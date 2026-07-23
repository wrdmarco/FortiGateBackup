import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("FortiGate-wizard toont exact de actieve stap en opent na opslaan de nieuwe FortiGate",async()=>{
  const wizard=await readFile("components/fortigate-wizard.tsx","utf8");
  for(let step=0;step<5;step+=1)assert.match(wizard,new RegExp(`step===${step}\\?\"grid gap-[45]\":\"hidden\"`));
  assert.match(wizard,/router\.replace\(destination\)/);
  assert.match(wizard,/`\/customers\/\$\{state\.customerId\}\/fortigates\/\$\{state\.deviceId\}`/);
  assert.doesNotMatch(wizard,/window\.location\.href/);
});
