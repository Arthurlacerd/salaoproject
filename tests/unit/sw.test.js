import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { ler, arq, versaoDe } from "./_app.js";

const V = versaoDe(), sw = ler("sw.js");
const codigo = sw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1"); // sem comentários

test("service worker: carrega a versão de js/versao.js e usa cache salao-static-v<versão>", () => {
  assert.match(codigo, /importScripts\("js\/versao\.js"\)/);
  assert.match(codigo, /PREFIXO = "salao-static-v", CACHE = PREFIXO \+ V\.versao/);
  assert.equal(V.versao, "11.2.0");
});
test("service worker: todos os arquivos do cache existem e não há arquivo do app fora da lista", () => {
  for (const f of ["index.html", "sw.js", ...V.arquivos]) assert.ok(existsSync(arq(f)), `listado mas inexistente: ${f}`);
  assert.equal(new Set(V.arquivos).size, V.arquivos.length, "lista com repetição");
});
test("service worker: integridade — SHA-256 de cada arquivo confere (exceto versao.js, conferido por conteúdo)", () => {
  const esperados = ["index.html", "sw.js", ...V.arquivos].filter((f) => f !== "js/versao.js");
  assert.deepEqual(Object.keys(V.integridade).sort(), esperados.sort());
  for (const [f, h] of Object.entries(V.integridade)) assert.equal(createHash("sha256").update(readFileSync(arq(f))).digest("hex"), h, `hash de ${f}`);
  assert.match(codigo, /V\.integridade && V\.integridade\[u\]/);
  assert.match(codigo, /JSON\.stringify\(v\) !== JSON\.stringify\(V\)/, "versao.js deve ser conferido por conteúdo");
});
test("service worker: nunca acessa nem apaga o IndexedDB", () => {
  assert.doesNotMatch(codigo, /indexedDB|deleteDatabase|IDB/);
});
test("service worker: fallback offline de navegação para index.html e ativação só a pedido da página", () => {
  assert.match(codigo, /r\.mode === "navigate" \? await c\.match\("index\.html"\)/);
  assert.match(codigo, /if \(d === "pular-espera"\) \{ self\.skipWaiting\(\)/);
  assert.equal((codigo.match(/skipWaiting\(/g) || []).length, 1);
});
test("service worker: respostas do cache com Cache-Control no-cache (o cache de memória não mistura versões)", () => {
  assert.match(codigo, /h\.set\("Cache-Control", "no-cache"\)/); assert.match(codigo, /return hit \? semReuso\(hit\) : fetch\(r\)/);
});
test("service worker: versão fixada só se compatível; ?recuperar=1 desafixa", () => {
  assert.match(codigo, /Number\(v\.banco\) === Number\(V\.banco\) && Number\(v\.schema \|\| 0\) >= Number\(V\.schema \|\| 0\)/);
  assert.match(codigo, /u\.searchParams\.has\("recuperar"\)/);
});
test("service worker: instalação grava só depois de validar TODOS os arquivos (sem versão parcial)", () => {
  const i = codigo.indexOf('addEventListener("install"'), trecho = codigo.slice(i, codigo.indexOf('addEventListener("activate"'));
  assert.ok(trecho.indexOf("prontos.push") < trecho.indexOf("c.put"), "precisa validar tudo antes de gravar");
  assert.match(trecho, /catch \(err\) \{\s*if \(\(await textoMeta\("instalando"\)\) === V\.versao\) \{ await caches\.delete\(CACHE\)/, "na falha, só apaga o cache criado por esta instalação");
  assert.match(trecho, /caches\.has\(CACHE\)\) && \(await textoMeta\("instalando"\)\) !== V\.versao/, "versão já instalada nunca é sobrescrita");
});
