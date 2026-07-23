import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("navigatie geeft snel toegankelijke laadfeedback zonder layoutverschuiving",async()=>{
  const component=await readFile("components/navigation-progress.tsx","utf8");
  const layout=await readFile("app/layout.tsx","utf8");
  const loading=await readFile("app/loading.tsx","utf8");
  assert.match(layout,/<NavigationProgress/);
  assert.match(component,/aria-live="polite"/);
  assert.match(component,/Gegevens ophalen/);
  assert.match(component,/setTimeout\(\(\)=>setPending\(true\),120\)/);
  assert.match(loading,/Pagina wordt geladen/);
  assert.doesNotMatch(component,/window\.location\s*=/);
});
