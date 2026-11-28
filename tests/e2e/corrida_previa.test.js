// 11.3.2 em Chromium: corrida de prévia — "a última escolha de arquivo/cópia sempre vence". Uma leitura antiga que termina
// depois (inclusive DENTRO de mostrarPrevia()) não desenha, não apaga a prévia atual, não mexe no formulário e não mostra
// erro; confirmar restaura o conteúdo da última escolha. Só a interface mudou: restauracao.js e validacao_backup.js não.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, limpar } from "./_ambiente.js";

let dir, srv, nav;
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);
const ADMIN = { usuario: "admin", senha: "senha-de-teste-123" };
const MARIA = "Maria Teste da Silva", BRUNA = "Bruna do Backup B", CARLA = "Carla do Estado Atual", SO_B = [BRUNA, MARIA].sort();

async function contexto() {
  const ctx = await nav.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }), page = await ctx.newPage(), log = { avisos: [], naoTratados: [] };
  page.on("console", (m) => m.type() === "warning" && log.avisos.push(m.text())); page.on("pageerror", (e) => log.naoTratados.push(e.message));
  return { ctx, page, log };
}
/** Aparelho com backups A (1 cliente) e B (2 clientes), cópias locais iguais a eles e o estado atual com 3 clientes:
 *  depois de confirmar, as clientes mostram o que foi restaurado (B = Maria e Bruna; A = só Maria; nada = as 3). */
async function aparelho() {
  const a = await contexto(); await abrir(a.page, srv.url); await configurarAdmin(a.page); await semear(a.page);
  const r = await a.page.evaluate(async ([BRUNA, CARLA]) => { const B = await import("./js/data/backup.js"), Cli = await import("./js/data/clientes.js");
    const A = await B.exportarTexto(), copiaA = (await B.snapshot("automatico")).id;
    await Cli.salvar({ nome: BRUNA, telefone: "(11) 97777-2222" }); const Bt = await B.exportarTexto(), copiaB = (await B.snapshot("automatico")).id;
    await Cli.salvar({ nome: CARLA, telefone: "(11) 96666-3333" }); return { A, B: Bt, copiaA, copiaB }; }, [BRUNA, CARLA]);
  return { ...a, A: Buffer.from(r.A), B: Buffer.from(r.B), copiaA: r.copiaA, copiaB: r.copiaB };
}
const ir = async (page, rota, sel) => { await page.goto(srv.url + "#/sobre"); await page.waitForSelector("#vista > *:not(.skeleton)"); await page.goto(srv.url + "#/" + rota); await page.waitForSelector(sel); };
const arq = (name, buffer) => ({ name, mimeType: name.endsWith(".csv") ? "text/csv" : "application/octet-stream", buffer: Buffer.from(buffer) });
/** Leitura do arquivo atrasada (e, se pedido, com falha) para nomes que começam com o prefixo: [[prefixo, ms, falhar]]. */
const atrasarLeitura = (page, regras) => page.evaluate((regras) => { const o = window.__textOriginal || (window.__textOriginal = File.prototype.text);
  File.prototype.text = function () { const v = o.call(this), r = regras.find(([p]) => this.name.startsWith(p)); if (!r) return v;
    return new Promise((ok, erro) => setTimeout(() => (r[2] ? erro(new DOMException("arquivo ilegível (simulado)", "NotReadableError")) : ok(v)), r[1])); }; }, regras);
/** A n-ésima conta SHA-256 a partir de agora demora ms. Na leitura, a 1ª é a integridade do backup; a 2ª já acontece
 *  dentro de mostrarPrevia() (conferência do estado atual, antes de desenhar). */
const atrasarSha = (page, n, ms) => page.evaluate(([n, ms]) => { const o = window.__digestOriginal || (window.__digestOriginal = crypto.subtle.digest.bind(crypto.subtle)); let k = 0;
  window.__lentaComecou = false; crypto.subtle.digest = (...a) => (++k === n ? ((window.__lentaComecou = true), new Promise((ok) => setTimeout(ok, ms)).then(() => o(...a))) : o(...a)); }, [n, ms]);
const lentaComecou = (page) => page.waitForFunction(() => window.__lentaComecou === true, null, { timeout: 20000 });
/** Grava cada prévia desenhada a partir de agora: prova que a da escolha antiga nunca aparece depois da nova escolha. */
const gravar = (page) => page.evaluate(() => { window.__previas = []; if (window.__obs) return;
  window.__obs = new MutationObserver(() => { const p = document.querySelector("#previa"), t = p ? p.innerText.replace(/\s+/g, " ").trim() : ""; if (/Prévia/.test(t) && window.__previas.at(-1) !== t) window.__previas.push(t); });
  window.__obs.observe(document.body, { childList: true, subtree: true, characterData: true }); });
const previas = (page) => page.evaluate(() => window.__previas);
const previa = async (page) => (await page.textContent("#previa")).replace(/\s+/g, " ");
const ate = (page, re) => page.waitForFunction((src) => new RegExp(src, "i").test((document.querySelector("#previa")?.innerText || "").replace(/\s+/g, " ")), re.source, { timeout: 30000 });
const B_ULTIMO = /Prévia da restauração — B-ultimo\.salaobackup/;
async function soB(page, marca = /B-ultimo\.salaobackup/) { // depois que A termina: a prévia continua sendo B, A nunca reapareceu, um só formulário
  await page.waitForTimeout(3500);
  assert.match(await previa(page), marca, "a prévia final é a de B");
  const p = await previas(page); assert.ok(p.length >= 1 && p.every((t) => marca.test(t)), `só a prévia de B foi desenhada depois da escolha de B: ${JSON.stringify(p.map((t) => t.slice(0, 60)))}`);
  assert.equal(await page.$$eval("#alertas .alert.erro, #previa [data-restauracao='erro-leitura']", (l) => l.length), 0, "nenhum erro na tela");
}
/** Confirma a prévia que está na tela (SUBSTITUIR + administrador do backup) e devolve as clientes do aparelho depois. */
async function confirmar(page) {
  assert.equal(await page.$$eval("#previa #f-imp", (l) => l.length), 1, "exatamente um formulário confirmável");
  await page.fill('#f-imp [name="prova_usuario"]', ADMIN.usuario); await page.fill('#f-imp [name="prova_senha"]', ADMIN.senha); await page.fill('#f-imp [name="c"]', "SUBSTITUIR");
  await page.click('#f-imp [type="submit"]'); await page.waitForTimeout(3000); await page.waitForSelector('form#f input[name="senha"]', { timeout: 30000 }); // os usuários do backup entram no lugar: volta ao login
  return page.evaluate(async () => (await (await import("./js/data/database.js")).ler("clientes")).map((c) => c.nome).sort());
}

// ---------- os 4 cenários obrigatórios (Manutenção › Importar backup) ----------
T("A lento + B rápido: B aparece, A termina depois e NÃO substitui B; confirmar restaura B", async () => {
  const { ctx, page, log, A, B } = await aparelho(); await ir(page, "manutencao", "#m-exp"); await atrasarLeitura(page, [["A", 2500]]);
  await page.setInputFiles("#m-arq", arq("A-antigo.salaobackup", A)); await page.waitForTimeout(100); await gravar(page);
  await page.setInputFiles("#m-arq", arq("B-ultimo.salaobackup", B)); await ate(page, B_ULTIMO); await soB(page);
  assert.ok(log.avisos.some((t) => /substituída por uma escolha mais recente/.test(t)), "o resultado de A foi descartado (registrado no console)");
  assert.deepEqual(await confirmar(page), SO_B, "conteúdo restaurado = B"); assert.deepEqual(log.naoTratados, []);
  await ctx.close();
});

T("A rápido + B lento (A termina antes da escolha de B): A aparece e B o substitui normalmente; A deixa de ser confirmável na hora; confirmar restaura B", async () => {
  const { ctx, page, log, A, B } = await aparelho(); await ir(page, "manutencao", "#m-exp"); await atrasarLeitura(page, [["B", 2500]]);
  await page.setInputFiles("#m-arq", arq("A-antigo.salaobackup", A)); await ate(page, /Prévia da restauração — A-antigo/); await gravar(page);
  await page.setInputFiles("#m-arq", arq("B-ultimo.salaobackup", B));
  assert.equal(await page.$$eval("#previa #f-imp", (l) => l.length), 0, "ao escolher B, a prévia de A sai da tela na hora");
  await ate(page, B_ULTIMO); await soB(page);
  assert.deepEqual(await confirmar(page), SO_B, "conteúdo restaurado = B"); assert.deepEqual(log.naoTratados, []);
  await ctx.close();
});

T("A rápido + B lento (A termina primeiro, mas depois da escolha de B): A é descartado, B aparece; confirmar restaura B", async () => {
  const { ctx, page, log, A, B } = await aparelho(); await ir(page, "manutencao", "#m-exp"); await atrasarLeitura(page, [["A", 800], ["B", 2500]]);
  await page.setInputFiles("#m-arq", arq("A-antigo.salaobackup", A)); await page.waitForTimeout(100); await gravar(page);
  await page.setInputFiles("#m-arq", arq("B-ultimo.salaobackup", B)); await ate(page, B_ULTIMO); await soB(page);
  assert.deepEqual(await confirmar(page), SO_B, "conteúdo restaurado = B"); assert.deepEqual(log.naoTratados, []);
  await ctx.close();
});

T("lentidão DENTRO de mostrarPrevia(): A já está montando a prévia quando B é escolhido; B vence e confirmar restaura B", async () => {
  const { ctx, page, log, A, B } = await aparelho(); await ir(page, "manutencao", "#m-exp"); await atrasarSha(page, 2, 3000);
  await page.setInputFiles("#m-arq", arq("A-antigo.salaobackup", A)); await lentaComecou(page);
  assert.match(await previa(page), /Verificando o arquivo…/, "A já passou pela análise e está dentro de mostrarPrevia(), ainda sem desenhar");
  await gravar(page); await page.setInputFiles("#m-arq", arq("B-ultimo.salaobackup", B)); await ate(page, B_ULTIMO); await soB(page);
  assert.deepEqual(await confirmar(page), SO_B, "conteúdo restaurado = B"); assert.deepEqual(log.naoTratados, []);
  await ctx.close();
});

T("erro atrasado: A demora e falha depois que B já montou a prévia — B fica, sem erro na tela, formulário intacto; confirmar restaura B", async () => {
  const { ctx, page, log, A, B } = await aparelho(); await ir(page, "manutencao", "#m-exp"); await atrasarLeitura(page, [["A", 2500, true]]);
  await page.setInputFiles("#m-arq", arq("A-antigo.salaobackup", A)); await page.waitForTimeout(100); await gravar(page);
  await page.setInputFiles("#m-arq", arq("B-ultimo.salaobackup", B)); await ate(page, B_ULTIMO); await soB(page);
  assert.equal(await page.$eval('#f-imp [type="submit"]', (b) => b.disabled), false, "o formulário de B continua utilizável");
  assert.ok(log.avisos.some((t) => /substituída por uma escolha mais recente/.test(t) && /ilegível/.test(t)), "o erro de A só foi registrado no console");
  assert.deepEqual(await confirmar(page), SO_B, "conteúdo restaurado = B"); assert.deepEqual(log.naoTratados, []);
  await ctx.close();
});

// ---------- a mesma proteção nos outros fluxos ----------
T("Dados › Verificar arquivo: A lento + B rápido → B; confirmar restaura B", async () => {
  const { ctx, page, log, A, B } = await aparelho(); await ir(page, "dados", "#analisar"); await atrasarLeitura(page, [["A", 2500]]);
  await page.setInputFiles("#arq", arq("A-antigo.salaobackup", A)); await page.click("#analisar"); await page.waitForTimeout(100); await gravar(page);
  await page.setInputFiles("#arq", arq("B-ultimo.salaobackup", B)); await page.click("#analisar"); await ate(page, B_ULTIMO); await soB(page);
  assert.deepEqual(await confirmar(page), SO_B, "conteúdo restaurado = B"); assert.deepEqual(log.naoTratados, []);
  await ctx.close();
});

T("Dados › CSV: A lento + B rápido → prévia e importação de B; backup lento × CSV rápido → fica a prévia do CSV", async () => {
  const { ctx, page, log, A } = await aparelho(); await ir(page, "dados", "#analisar"); await atrasarLeitura(page, [["A", 2500]]);
  const csvA = "nome;telefone\nClara do CSV A;(11) 95555-0001\n", csvB = "nome;telefone\nDora do CSV B;(11) 95555-0002\nElisa do CSV B;(11) 95555-0003\n";
  await page.setInputFiles("#arq", arq("A-antigo.csv", csvA)); await page.click("#analisar"); await page.waitForTimeout(100); await gravar(page);
  await page.setInputFiles("#arq", arq("B-ultimo.csv", csvB)); await page.click("#analisar"); await ate(page, /Importar 2 cliente/); await soB(page, /Importar 2 cliente\(s\)/i);
  await page.click("#ok-csv"); await page.waitForURL(/#\/clientes$/);
  const nomes = await page.evaluate(async () => (await (await import("./js/data/database.js")).ler("clientes")).map((c) => c.nome));
  assert.ok(nomes.includes("Dora do CSV B") && nomes.includes("Elisa do CSV B") && !nomes.includes("Clara do CSV A"), "importadas as clientes de B, não as de A");
  await ir(page, "dados", "#analisar"); await atrasarLeitura(page, [["A", 2500]]);
  await page.setInputFiles("#arq", arq("A-antigo.salaobackup", A)); await page.click("#analisar"); await page.waitForTimeout(100); await gravar(page);
  await page.setInputFiles("#arq", arq("B-ultimo2.csv", "nome;telefone\nFabi do CSV B2;(11) 95555-0004\n")); await page.click("#analisar"); await ate(page, /Prévia — clientes \(CSV\)/);
  await soB(page, /Prévia — clientes \(CSV\)/); assert.doesNotMatch(await previa(page), /Prévia da restauração/); assert.deepEqual(log.naoTratados, []);
  await ctx.close();
});

T("Dados › Restaurar cópia: cópia A lenta + cópia B rápida → B; confirmar restaura B", async () => {
  const { ctx, page, log, copiaA, copiaB } = await aparelho(); await ir(page, "dados", "#exportar"); await atrasarSha(page, 1, 3000); // 1ª conta: integridade da cópia A
  await page.click(`[data-rest="${copiaA}"]`); await lentaComecou(page); await gravar(page);
  await page.click(`[data-rest="${copiaB}"]`); await ate(page, /clientes\s*2 no arquivo/); await soB(page, /clientes\s*2 no arquivo/i);
  assert.deepEqual(await confirmar(page), SO_B, "conteúdo restaurado = cópia B"); assert.deepEqual(log.naoTratados, []);
  await ctx.close();
});

T("Manutenção › Restaurar dados: cópia A (lenta dentro de mostrarPrevia) + arquivo B → B; confirmar restaura B", async () => {
  const { ctx, page, log, B, copiaA } = await aparelho(); await ir(page, "manutencao", "#m-exp"); await page.click("#m-rest"); await page.waitForSelector(`#m-restaurar [data-rest="${copiaA}"]`);
  await atrasarSha(page, 2, 3000); await page.click(`#m-restaurar [data-rest="${copiaA}"]`); await lentaComecou(page); await gravar(page);
  await page.setInputFiles("#m-arq2", arq("B-ultimo.salaobackup", B)); await ate(page, B_ULTIMO); await soB(page);
  assert.deepEqual(await confirmar(page), SO_B, "conteúdo restaurado = B"); assert.deepEqual(log.naoTratados, []);
  await ctx.close();
});

for (const [tela, preparar, botao] of [
  ["Restaurar backup (primeiro acesso)", async (page) => { await page.goto(srv.url + "#/restaurar"); }, "#verif"],
  ["Seus dados não foram encontrados", async (page) => { await page.evaluate(() => localStorage.setItem("salao_marca", JSON.stringify({ quando: "2026-11-20 10:00:00", clientes: 3 }))); await page.goto(srv.url + "#/"); await page.reload(); }, "#rest"],
]) T(`tela sem login › ${tela}: A lento + B rápido → B; confirmar restaura B`, async () => {
  const origem = await aparelho(); await origem.ctx.close(); // backups vindos de outro aparelho
  const { ctx, page, log } = await contexto(); await abrir(page, srv.url); await preparar(page); await page.waitForSelector(botao); await atrasarLeitura(page, [["A", 2500]]);
  await page.setInputFiles("#arq", arq("A-antigo.salaobackup", origem.A)); await page.click(botao); await page.waitForTimeout(100); await gravar(page);
  await page.setInputFiles("#arq", arq("B-ultimo.salaobackup", origem.B)); await page.click(botao); await ate(page, B_ULTIMO); await soB(page);
  assert.deepEqual(await confirmar(page), SO_B, "conteúdo restaurado = B"); assert.deepEqual(log.naoTratados, []);
  await ctx.close();
});
