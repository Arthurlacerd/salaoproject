// 11.3.2 em Chromium: falhas de leitura tratadas na interface. Cópia local apagada, arquivo ilegível em Manutenção e em Dados
// e telas sem login: mensagem clara, console.error, nenhuma prévia antiga confirmável, campo de arquivo limpo e dados intactos.
// restauracao.js e validacao_backup.js não mudaram: arquivos inválidos continuam bloqueados como antes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, limpar, impressao } from "./_ambiente.js";

let dir, srv, nav;
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);
async function contexto() { const ctx = await nav.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }), page = await ctx.newPage(), log = { console: [], naoTratados: [] };
  page.on("console", (m) => m.type() === "error" && log.console.push(m.text())); page.on("pageerror", (e) => log.naoTratados.push(e.message)); return { ctx, page, log }; }
async function aparelho() { const a = await contexto(); await abrir(a.page, srv.url); await configurarAdmin(a.page); await semear(a.page); return a; }
const ir = async (page, rota, sel) => { await page.goto(srv.url + "#/sobre"); await page.waitForSelector("#vista > *:not(.skeleton)"); await page.goto(srv.url + "#/" + rota); await page.waitForSelector(sel); };
const avisoErro = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll("#alertas .alert.erro")].some((e) => new RegExp(src).test(e.textContent)), re.source, { timeout: 30000 });
const arquivo = (name, buffer) => ({ name, mimeType: "application/octet-stream", buffer });
const ilegivel = () => { window.__text = File.prototype.text; File.prototype.text = () => Promise.reject(new DOMException("arquivo ilegível (simulado)", "NotReadableError")); };
const legivel = () => { File.prototype.text = window.__text; };
const confirmavel = (page) => page.$$eval("#previa #f-imp, #previa [data-restauracao]", (l) => l.length); // prévia (ou bloqueio) ainda na tela
const duasCopias = (page) => page.evaluate(async () => { const B = await import("./js/data/backup.js"); return [(await B.snapshot("automatico")).id, (await B.snapshot("automatico")).id]; });
const apagarCopia = (page, id) => page.evaluate(async (id) => { const D = await import("./js/data/database.js"); await D.transacao(["backups"], "readwrite", (t) => t.backups.apagar(id)); }, id); // ex.: pela retenção, com a lista aberta
const backupValido = async () => { const a = await aparelho(); const t = await a.page.evaluate(async () => (await import("./js/data/backup.js")).exportarTexto()); await a.ctx.close(); return Buffer.from(t); };

for (const [onde, rota, sel, abrirCaixa, raiz] of [["Dados › Cópias automáticas", "dados", "#exportar", false, ""], ["Manutenção › Restaurar dados", "manutencao", "#m-exp", true, "#m-restaurar "]])
  T(`${onde}: restaurar uma cópia que já foi apagada → motivo correto (não "arquivo vazio"), prévia anterior removida, nada alterado`, async () => {
    const { ctx, page, log } = await aparelho(), [a, b] = await duasCopias(page);
    await ir(page, rota, sel); if (abrirCaixa) { await page.click("#m-rest"); await page.waitForSelector(`${raiz}[data-rest="${b}"]`); }
    await page.click(`${raiz}[data-rest="${a}"]`); await page.waitForSelector('#previa [data-restauracao="previa"] #f-imp'); // prévia de uma cópia que existe
    await apagarCopia(page, b); const antes = await impressao(page);
    await page.click(`${raiz}[data-rest="${b}"]`);
    await avisoErro(page, /^Não foi possível abrir a cópia para restaurar \(nada foi alterado\): essa cópia não existe mais neste aparelho/);
    assert.equal(await confirmavel(page), 0, "a prévia da outra cópia saiu da tela; nada de \"arquivo vazio\"");
    assert.doesNotMatch(await page.textContent("#previa"), /arquivo está vazio/);
    assert.deepEqual(await impressao(page), antes, "nada alterado"); assert.ok(log.console.some((t) => /não existe mais/.test(t)), "console.error registrado");
    assert.deepEqual(log.naoTratados, [], "nenhum erro não tratado");
    await ctx.close();
  });

T("Manutenção › Importar backup com arquivo ilegível → mensagem, prévia anterior removida, campo limpo, sem erro não tratado, nada alterado; inválido e válido como antes", async () => {
  const { ctx, page, log } = await aparelho(); await ir(page, "manutencao", "#m-exp");
  const valido = Buffer.from(await page.evaluate(async () => (await import("./js/data/backup.js")).exportarTexto()));
  await page.setInputFiles("#m-arq", arquivo("bom.salaobackup", valido)); await page.waitForSelector('#previa [data-restauracao="previa"] #f-imp');
  const antes = await impressao(page); await page.evaluate(ilegivel);
  await page.setInputFiles("#m-arq", arquivo("ilegivel.salaobackup", valido));
  await avisoErro(page, /^Não foi possível verificar o arquivo \(nada foi alterado\): arquivo ilegível \(simulado\)/);
  assert.equal(await confirmavel(page), 0, "a prévia do arquivo anterior saiu da tela");
  assert.equal(await page.$eval("#m-arq", (i) => i.value), "", "campo limpo: o mesmo arquivo pode ser escolhido de novo");
  assert.ok(log.console.some((t) => /ilegível/.test(t)), "console.error registrado"); assert.deepEqual(log.naoTratados, [], "nenhum erro não tratado");
  await page.evaluate(legivel);
  await page.setInputFiles("#m-arq", arquivo("nao-e-backup.salaobackup", Buffer.from("isto não é json")));
  await page.waitForSelector('#previa [data-restauracao="bloqueada"]'); assert.match(await page.textContent("#previa"), /não é um backup legível/, "inválido: bloqueado como antes");
  await page.setInputFiles("#m-arq", arquivo("bom.salaobackup", valido)); await page.waitForSelector('#previa [data-restauracao="previa"] #f-imp');
  assert.deepEqual(await impressao(page), antes, "nada alterado");
  await ctx.close();
});

T("Manutenção › Restaurar dados › Ou escolha um arquivo: ilegível → mensagem, prévia anterior removida, campo limpo, nada alterado", async () => {
  const { ctx, page, log } = await aparelho(); await ir(page, "manutencao", "#m-exp"); await page.click("#m-rest"); await page.waitForSelector("#m-arq2");
  const valido = Buffer.from(await page.evaluate(async () => (await import("./js/data/backup.js")).exportarTexto()));
  await page.setInputFiles("#m-arq2", arquivo("bom.salaobackup", valido)); await page.waitForSelector('#previa [data-restauracao="previa"] #f-imp');
  const antes = await impressao(page); await page.evaluate(ilegivel);
  await page.setInputFiles("#m-arq2", arquivo("ilegivel.salaobackup", valido));
  await avisoErro(page, /^Não foi possível verificar o arquivo \(nada foi alterado\): arquivo ilegível \(simulado\)/);
  assert.equal(await confirmavel(page), 0); assert.equal(await page.$eval("#m-arq2", (i) => i.value), "", "campo limpo");
  assert.deepEqual(await impressao(page), antes); assert.deepEqual(log.naoTratados, []);
  await ctx.close();
});

T("Dados › Verificar arquivo: leitura falha → mensagem, prévia anterior removida, campo limpo, nada alterado; o arquivo seguinte é verificado normalmente", async () => {
  const { ctx, page, log } = await aparelho(); await ir(page, "dados", "#analisar");
  const valido = Buffer.from(await page.evaluate(async () => (await import("./js/data/backup.js")).exportarTexto()));
  await page.setInputFiles("#arq", arquivo("bom.salaobackup", valido)); await page.click("#analisar"); await page.waitForSelector('#previa [data-restauracao="previa"] #f-imp');
  const antes = await impressao(page); await page.evaluate(ilegivel);
  await page.setInputFiles("#arq", arquivo("ilegivel.salaobackup", valido)); await page.click("#analisar");
  await avisoErro(page, /^Não foi possível verificar o arquivo \(nada foi alterado\): arquivo ilegível \(simulado\)/);
  assert.equal(await confirmavel(page), 0, "a prévia do arquivo anterior saiu da tela"); assert.equal(await page.$eval("#arq", (i) => i.value), "", "campo limpo");
  await page.evaluate(legivel); await page.setInputFiles("#arq", arquivo("bom.salaobackup", valido)); await page.click("#analisar"); await page.waitForSelector('#previa [data-restauracao="previa"] #f-imp');
  assert.deepEqual(await impressao(page), antes); assert.deepEqual(log.naoTratados, []);
  await ctx.close();
});

for (const [tela, preparar, botao] of [
  ["Restaurar backup (primeiro acesso, sem login)", async (page) => { await page.goto(srv.url + "#/restaurar"); }, "#verif"],
  ["Seus dados não foram encontrados (sem login)", async (page) => { await page.evaluate(() => localStorage.setItem("salao_marca", JSON.stringify({ quando: "2026-11-20 10:00:00", clientes: 3 }))); await page.goto(srv.url + "#/"); await page.reload(); }, "#rest"],
]) T(`tela sem login › ${tela}: leitura falha → mensagem na própria tela, prévia anterior removida, campo limpo; nenhum dado gravado`, async () => {
  const valido = await backupValido(), { ctx, page, log } = await contexto(); await abrir(page, srv.url); await preparar(page); await page.waitForSelector(botao);
  await page.setInputFiles("#arq", arquivo("bom.salaobackup", valido)); await page.click(botao); await page.waitForSelector('#previa [data-restauracao="previa"] #f-imp');
  await page.evaluate(ilegivel); await page.setInputFiles("#arq", arquivo("ilegivel.salaobackup", valido)); await page.click(botao);
  await page.waitForSelector('#previa [data-restauracao="erro-leitura"]');
  assert.match(await page.textContent("#previa"), /^Não foi possível verificar o arquivo \(nada foi alterado\): arquivo ilegível \(simulado\)$/);
  assert.equal(await page.$$eval("#previa #f-imp", (l) => l.length), 0, "nenhuma prévia confirmável"); assert.equal(await page.$eval("#arq", (i) => i.value), "", "campo limpo");
  assert.ok(log.console.some((t) => /ilegível/.test(t)), "console.error registrado"); assert.deepEqual(log.naoTratados, [], "nenhum erro não tratado");
  const banco = await page.evaluate(async () => { const D = await import("./js/data/database.js"); const n = {}; for (const t of ["usuarios", "clientes", "atendimentos", "backups"]) n[t] = (await D.ler(t)).length; return n; });
  assert.deepEqual(banco, { usuarios: 0, clientes: 0, atendimentos: 0, backups: 0 }, "nada gravado");
  await page.evaluate(legivel); await page.setInputFiles("#arq", arquivo("bom.salaobackup", valido)); await page.click(botao); await page.waitForSelector('#previa [data-restauracao="previa"] #f-imp');
  await ctx.close();
});
