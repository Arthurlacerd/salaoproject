// tools/construir_pwa.py: aprova o repositório e REPROVA (código ≠ 0) cada tipo de problema, numa cópia temporária.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync, appendFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RAIZ } from "./_app.js";

const SCRIPT = path.join(RAIZ, "tools/construir_pwa.py");
const rodar = (raiz, ...a) => spawnSync("python3", [SCRIPT, "--raiz", raiz, ...a], { encoding: "utf8" });
function copia() {
  const d = mkdtempSync(path.join(tmpdir(), "salao-build-"));
  for (const f of ["index.html", "manifest.webmanifest", "sw.js", "css", "js", "icons", "fonts", "docs"]) try { cpSync(path.join(RAIZ, f), path.join(d, f), { recursive: true }); } catch (_) {}
  return d;
}
function caso(nome, mexer, espera) {
  test(`build reprova: ${nome}`, () => {
    const d = copia(); try { mexer(d); const r = rodar(d, "--verificar"); assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, espera); } finally { rmSync(d, { recursive: true, force: true }); }
  });
}
const editar = (d, f, fn) => writeFileSync(path.join(d, f), fn(readFileSync(path.join(d, f), "utf8")));

test("build aprova o repositório (--verificar, código 0) e não altera nada", () => {
  const antes = readFileSync(path.join(RAIZ, "js/versao.js"), "utf8"), r = rodar(RAIZ, "--verificar");
  assert.equal(r.status, 0, r.stdout); assert.equal(readFileSync(path.join(RAIZ, "js/versao.js"), "utf8"), antes);
});
caso("arquivo novo fora da lista de cache", (d) => writeFileSync(path.join(d, "js/novo.js"), "export const x = 1;\n"), /fora da lista de cache/);
caso("arquivo listado mas inexistente", (d) => unlinkSync(path.join(d, "js/charts.js")), /lista “js\/charts\.js”, que não existe/);
caso("arquivo alterado sem rodar o build (hash)", (d) => appendFileSync(path.join(d, "css/ds11.css"), "\n/* mudou */\n"), /hash diferente: css\/ds11\.css/);
caso("manifest inválido", (d) => writeFileSync(path.join(d, "manifest.webmanifest"), "{ quebrado"), /não é JSON válido/);
caso("manifest com id (identidade mudaria)", (d) => editar(d, "manifest.webmanifest", (t) => t.replace('"lang"', '"id": "./",\n  "lang"')), /“id” presente/);
caso("manifest sem ícone 512", (d) => editar(d, "manifest.webmanifest", (t) => JSON.stringify({ ...JSON.parse(t), icons: JSON.parse(t).icons.filter((i) => i.sizes !== "512x512") })), /falta ícone 512x512/);
caso("ícone que não é PNG", (d) => writeFileSync(path.join(d, "icons/icon-192.png"), "não sou png"), /não é um PNG válido/);
caso("service worker acessando o IndexedDB", (d) => appendFileSync(path.join(d, "sw.js"), "\nindexedDB.deleteDatabase('salao_gestao');\n"), /NÃO pode acessar o IndexedDB/);
caso("service worker que ativa sozinho", (d) => appendFileSync(path.join(d, "sw.js"), "\nself.addEventListener('install', () => self.skipWaiting());\n"), /skipWaiting fora do pedido/);
caso("banco em versao.js diferente das migrations", (d) => editar(d, "js/versao.js", (t) => t.replace('"banco": 1', '"banco": 2')), /mudar o banco exige migration/);
caso("caminho absoluto (quebra a subpasta do GitHub Pages)", (d) => editar(d, "index.html", (t) => t.replace('href="css/style.css"', 'href="/css/style.css"')), /caminho absoluto/);
caso("import JS para arquivo inexistente", (d) => editar(d, "js/app.js", (t) => 'import "./data/nao-existe.js";\n' + t), /nao-existe\.js/);

test("build no modo GERA corrige a lista e os hashes; depois --verificar aprova", () => {
  const d = copia(); try {
    writeFileSync(path.join(d, "js/novo.js"), "export const x = 1;\n"); appendFileSync(path.join(d, "css/ds11.css"), "\n");
    assert.equal(rodar(d).status, 0); const r = rodar(d, "--verificar"); assert.equal(r.status, 0, r.stdout);
    assert.match(readFileSync(path.join(d, "js/versao.js"), "utf8"), /"js\/novo\.js"/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
