import { test } from "node:test";
import assert from "node:assert/strict";
import { nuxt2State } from "../app/domain/nuxt2";

test("état Nuxt 2 lu sans exécuter le script", () => {
  const html = `<div></div><script>window.__NUXT__=(function(a,b,c,d){return {layout:"default",data:[{refs:[{code:"OD_154_20",name:a,path:"af\\u002F65\\u002Fx.jpg",on:!0,off:!1,n:-1.5,u:void 0,list:[b,c],"q-k":'it\\'s'}]}],fetch:{},state:{x:d}}}("Reinette",1,null,{y:"}("}));</script>`;
  const s = nuxt2State(html) as any;
  assert.ok(s);
  const ref = s.data[0].refs[0];
  assert.equal(ref.code, "OD_154_20");
  assert.equal(ref.name, "Reinette");
  assert.equal(ref.path, "af/65/x.jpg");
  assert.equal(ref.on, true);
  assert.equal(ref.off, false);
  assert.equal(ref.n, -1.5);
  assert.deepEqual(ref.list, [1, null]);
  assert.equal(ref["q-k"], "it's");
  assert.deepEqual(s.state.x, { y: "}(" });
});

test("état absent ou illisible", () => {
  assert.equal(nuxt2State("<html></html>"), null);
  assert.equal(nuxt2State("<script>window.__NUXT__=(function(a){return {x:</script>"), null);
});
