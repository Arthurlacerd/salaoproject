import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { ler, arq, pngDims } from "./_app.js";

const m = JSON.parse(ler("manifest.webmanifest")); // lança se não for JSON válido
const BASE = "https://usuario.github.io/salaoproject/manifest.webmanifest"; // como no GitHub Pages (subpasta)

test("manifest: JSON válido com name e short_name (≤ 12 caracteres)", () => {
  assert.equal(m.name, "Salão.gestão");
  assert.ok(m.short_name && [...m.short_name].length <= 12);
});
test("manifest: scope é a pasta do app e start_url está dentro dele", () => {
  assert.equal(m.scope, "./");
  const escopo = new URL(m.scope, BASE).href, inicio = new URL(m.start_url, BASE).href;
  assert.equal(escopo, "https://usuario.github.io/salaoproject/");
  assert.ok(inicio.startsWith(escopo), "start_url fora do scope");
  assert.equal(m.start_url, "./#/hoje");
});
test("manifest: display abre como aplicativo", () => assert.ok(["standalone", "fullscreen", "minimal-ui"].includes(m.display)));
test("manifest: identidade estável da 11.1 — SEM id; identidade = start_url sem # = pasta do app", () => {
  assert.equal("id" in m, false, "não adicionar \"id\" (mudaria a identidade do app instalado)");
  const identidade = new URL(m.start_url, BASE).href.split("#")[0];
  assert.equal(identidade, new URL(m.scope, BASE).href);
});
test("manifest: ícones existem, são PNG e têm o tamanho declarado (192 any, 512 any, 512 maskable)", () => {
  const vistos = [];
  for (const ic of m.icons) {
    assert.ok(!ic.src.startsWith("/") && existsSync(arq(ic.src)), `ícone ausente: ${ic.src}`);
    assert.equal(ic.type, "image/png");
    const d = pngDims(ic.src); assert.ok(d, `${ic.src} não é PNG`);
    assert.equal(`${d[0]}x${d[1]}`, ic.sizes);
    vistos.push(`${ic.sizes}:${ic.purpose}`);
  }
  for (const x of ["192x192:any", "512x512:any", "512x512:maskable"]) assert.ok(vistos.includes(x), `falta ${x}`);
  assert.deepEqual(pngDims("icons/apple-touch-icon.png"), [180, 180]);
});
test("manifest: theme_color igual ao do index.html", () => {
  assert.match(ler("index.html"), new RegExp(`<meta name="theme-color" content="${m.theme_color}">`));
});
