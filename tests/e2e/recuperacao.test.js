// Saída de emergência no boot: banco de versão incompatível => tela de recuperação, sem loop de recarga e sem tocar nos dados.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, servidor, navegador, limpar } from "./_ambiente.js";

let dir, srv, nav;
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });

test("banco de versão mais nova que o código: tela de recuperação, botão funciona e não há loop", { skip: semNavegador }, async () => {
  const page = await (await nav.newContext()).newPage();
  await page.goto(srv.url + "manifest.webmanifest"); // mesma origem, sem o app: cria um banco "do futuro" (perfil descartável)
  await page.evaluate(() => new Promise((ok) => { const r = indexedDB.open("salao_gestao", 7); r.onsuccess = () => { r.result.close(); ok(); }; }));
  let navs = 0; page.on("framenavigated", (f) => f === page.mainFrame() && navs++);
  await page.goto(srv.url); await page.waitForSelector("#rec-atual");
  assert.match(await page.textContent("main"), /Nenhum dado foi apagado/);
  await Promise.all([page.waitForEvent("framenavigated"), page.click("#rec-atual")]); await page.waitForSelector("#rec-atual");
  const antes = navs; await page.waitForTimeout(3000);
  assert.equal(navs, antes, "nenhuma recarga automática (sem loop)"); assert.ok(!page.url().includes("recuperar"), "marca removida da barra de endereço");
  const v = await page.evaluate(async () => (await indexedDB.databases()).find((d) => d.name === "salao_gestao").version); assert.equal(v, 7, "banco intacto (nenhum downgrade)");
});
