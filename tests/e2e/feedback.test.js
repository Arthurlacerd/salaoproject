// 11.3.1 em Chromium (perfis descartáveis, fuso de São Paulo): falhas que eram silenciosas, andamento ao entrar e ao
// reabrir, aviso de tamanho do backup (24 MB / ~28 MB / 30 MB+), "Gerado em" na hora local e "próximo atendimento".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, limpar, impressao } from "./_ambiente.js";

let dir, srv, nav;
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);
const ADMIN = { usuario: "admin", senha: "senha-de-teste-123" }, MB = 1048576;
const contexto = () => nav.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" });
async function aparelho() { const ctx = await contexto(), page = await ctx.newPage(); await abrir(page, srv.url); await configurarAdmin(page); await semear(page); return { ctx, page }; }
const ir = async (page, rota, sel) => { await page.goto(srv.url + "#/sobre"); await page.waitForSelector("#vista > *:not(.skeleton)"); await page.goto(srv.url + "#/" + rota); await page.waitForSelector(sel); };
const baixados = (page) => { const l = []; page.on("download", (d) => l.push(d)); return l; };
const avisoErro = (page, re) => page.waitForFunction((src) => [...document.querySelectorAll("#alertas .alert.erro")].some((e) => new RegExp(src).test(e.textContent)), re.source, { timeout: 30000 });
const limparAvisos = (page) => page.$$eval("#alertas .alert", (l) => l.forEach((e) => e.remove()));
const lenta = () => { const o = crypto.subtle.digest.bind(crypto.subtle); crypto.subtle.digest = (...a) => new Promise((ok) => setTimeout(ok, 700)).then(() => o(...a)); }; // cópia do dia demorada

T("Exportar backup com falha: mensagem clara, nada baixado, dados intactos; sem falha, exporta como antes", async () => {
  const { ctx, page } = await aparelho(), dls = baixados(page);
  await ir(page, "dados", "#exportar"); const antes = await impressao(page), ls = await page.evaluate(() => localStorage.getItem("salao_ultimo_download"));
  await page.evaluate(() => { window.__digest = crypto.subtle.digest.bind(crypto.subtle); crypto.subtle.digest = () => Promise.reject(new DOMException("falha simulada", "OperationError")); });
  await page.click("#exportar"); await avisoErro(page, /Não foi possível gerar o backup \(nenhum dado foi alterado\): falha simulada/);
  assert.equal(dls.length, 0, "nenhum arquivo baixado"); assert.equal(await page.$eval("#exportar", (b) => b.disabled), false, "o botão volta");
  await page.evaluate(() => { crypto.subtle.digest = window.__digest; });
  assert.deepEqual(await impressao(page), antes, "nada alterado"); assert.equal(await page.evaluate(() => localStorage.getItem("salao_ultimo_download")), ls);
  await limparAvisos(page); // sem falha: o comportamento de sempre (arquivo baixado, tela atualizada, nenhum aviso de tamanho)
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#exportar")]);
  assert.match(dl.suggestedFilename(), /^salao-gestao-backup-.*\.salaobackup$/);
  await page.waitForFunction((ls) => localStorage.getItem("salao_ultimo_download") !== ls && document.querySelector("#exportar") && !document.querySelector("#exportar").disabled, ls);
  await page.waitForTimeout(500);
  assert.doesNotMatch(await page.textContent("#alertas"), /limite de 30 MB|Não foi possível/, "backup pequeno: sem aviso de tamanho e sem erro");
  assert.equal(await page.$$eval("[data-tamanho-backup]", (l) => l.length), 0, "backup pequeno: nenhum alerta de tamanho na tela");
  await ctx.close();
});

T("Baixar cópia: cópia que não existe mais → mensagem clara (Dados e Manutenção), sem arquivo \"undefined\"; cópia existente baixa normalmente", async () => {
  const { ctx, page } = await aparelho(), dls = baixados(page);
  for (const [rota, sel] of [["dados", "#exportar"], ["manutencao", "#m-exp"]]) {
    const id = await page.evaluate(async () => (await (await import("./js/data/backup.js")).snapshot("automatico")).id);
    await ir(page, rota, sel);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click(`[data-snap="${id}"]`)]);
    assert.equal(JSON.parse(readFileSync(await dl.path(), "utf8")).formato, "salao-gestao-backup", `${rota}: a cópia baixada é um backup`);
    await page.evaluate(async (id) => { const D = await import("./js/data/database.js"); await D.transacao(["backups"], "readwrite", (t) => t.backups.apagar(id)); }, id); // removida (ex.: pela retenção)
    const n = dls.length; await page.click(`[data-snap="${id}"]`);
    await avisoErro(page, /Não foi possível baixar a cópia: essa cópia não existe mais neste aparelho/);
    await page.waitForTimeout(400); assert.equal(dls.length, n, `${rota}: nenhum arquivo baixado`);
    await limparAvisos(page);
  }
  await ctx.close();
});

T("Importar CSV: falha ao gravar → mensagem, nenhuma cliente importada e botão volta; falha ao ler o arquivo → mensagem; sem falha, importa como antes", async () => {
  const { ctx, page } = await aparelho(), csv = Buffer.from("nome;telefone\nAna do CSV;(11) 95555-0001\nBia do CSV;(11) 95555-0002\n");
  const clientes = () => page.evaluate(async () => (await (await import("./js/data/database.js")).ler("clientes")).length);
  await ir(page, "dados", "#analisar"); const n0 = await clientes();
  await page.setInputFiles("#arq", { name: "clientes.csv", mimeType: "text/csv", buffer: csv }); await page.click("#analisar"); await page.waitForSelector("#ok-csv");
  await page.evaluate(() => { const add = IDBObjectStore.prototype.add; window.__add = add; IDBObjectStore.prototype.add = function (...a) { if (this.name === "clientes") throw new DOMException("disco cheio (simulado)", "QuotaExceededError"); return add.apply(this, a); }; });
  await page.click("#ok-csv"); await avisoErro(page, /A importação falhou e nenhuma cliente foi importada: disco cheio \(simulado\)/);
  await page.evaluate(() => { IDBObjectStore.prototype.add = window.__add; });
  assert.equal(await clientes(), n0, "nenhuma cliente importada"); assert.equal(await page.$eval("#ok-csv", (b) => b.disabled), false, "o botão volta");
  await page.click("#ok-csv"); await page.waitForURL(/#\/clientes$/); assert.equal(await clientes(), n0 + 2, "sem falha: importa como antes");
  await ir(page, "dados", "#analisar"); await page.evaluate(() => { File.prototype.text = () => Promise.reject(new DOMException("arquivo ilegível (simulado)", "NotReadableError")); });
  await page.setInputFiles("#arq", { name: "outro.csv", mimeType: "text/csv", buffer: csv }); await page.click("#analisar");
  await avisoErro(page, /Não foi possível verificar o arquivo \(nada foi alterado\): arquivo ilegível/);
  await ctx.close();
});

T("Entrar: botão desabilitado com \"Entrando… preparando a cópia do dia\", segundo envio ignorado e uma única cópia; senha errada → botão volta com a mensagem", async () => {
  const { ctx, page } = await aparelho(), bt = 'form#f button[type="submit"]';
  await page.evaluate(async () => (await import("./js/data/usuarios.js")).sair()); await page.goto(srv.url + "#/"); await page.reload(); await page.waitForSelector('form#f input[name="senha"]');
  await page.fill('input[name="usuario"]', ADMIN.usuario); await page.fill('input[name="senha"]', "senha-errada-000"); await page.click(bt);
  await page.waitForSelector(".login-erro"); assert.match(await page.textContent(".login-erro"), /incorretos/);
  assert.deepEqual(await page.$eval(bt, (b) => [b.disabled, b.textContent]), [false, "Entrar"], "senha errada: o botão volta ao normal");
  const automaticas = () => page.evaluate(async () => (await (await import("./js/data/backup.js")).snapshots()).filter((s) => s.motivo === "automatico").length);
  const antes = await automaticas(); await page.evaluate(lenta);
  await page.fill('input[name="senha"]', ADMIN.senha); await page.click(bt);
  await page.waitForFunction((s) => document.querySelector(s)?.textContent === "Entrando… preparando a cópia do dia", bt, { timeout: 30000 });
  assert.equal(await page.$eval(bt, (b) => b.disabled), true, "botão desabilitado durante a cópia do dia");
  await page.$eval("form#f", (f) => f.requestSubmit()).catch(() => {}); // segundo envio (Enter / toque duplo): ignorado
  await page.waitForSelector("#vista > *:not(.skeleton)", { timeout: 60000 });
  assert.equal(await automaticas(), antes + 1, "uma única cópia do dia");
  await ctx.close();
});

T("Primeiro acesso: botão desabilitado com \"Criando o acesso…\" e segundo envio ignorado (um único acesso criado); erro → botão volta", async () => {
  const ctx = await contexto(), page = await ctx.newPage(), bt = 'form#f button[type="submit"]'; await abrir(page, srv.url); await page.waitForSelector('input[name="salao"]');
  await page.fill('input[name="salao"]', "Salão"); await page.fill('input[name="nome"]', "A"); await page.fill('input[name="usuario"]', "admin"); await page.fill('input[name="senha"]', "senha-de-teste-123");
  await page.click(bt); await page.waitForSelector(".login-erro"); assert.match(await page.textContent(".login-erro"), /Informe seu nome/);
  assert.deepEqual(await page.$eval(bt, (b) => [b.disabled, b.textContent]), [false, "Criar e entrar"], "erro: o botão volta ao normal");
  await page.evaluate(() => { const o = crypto.subtle.deriveBits.bind(crypto.subtle); crypto.subtle.deriveBits = (...a) => new Promise((ok) => setTimeout(ok, 700)).then(() => o(...a)); }); // senha demorada
  await page.fill('input[name="nome"]', "Admin Teste"); await page.click(bt);
  await page.waitForFunction((s) => document.querySelector(s)?.textContent === "Criando o acesso…", bt, { timeout: 30000 });
  assert.equal(await page.$eval(bt, (b) => b.disabled), true, "botão desabilitado enquanto cria o acesso");
  await page.$eval("form#f", (f) => f.requestSubmit()).catch(() => {}); // segundo envio: ignorado
  await page.waitForSelector("#vista > *:not(.skeleton)", { timeout: 60000 });
  assert.equal(await page.evaluate(async () => (await (await import("./js/data/database.js")).ler("usuarios")).length), 1, "um único acesso criado");
  await ctx.close();
});

T("Reabrir o app com sessão ativa: mostra \"Entrando…\" e a mensagem da cópia do dia em vez de tela em branco", async () => {
  const { ctx, page } = await aparelho(); // sessão ativa, com dados e ainda sem a cópia do dia
  await ctx.addInitScript(lenta); await page.reload();
  await page.waitForFunction(() => document.body.textContent.includes("Entrando… preparando a cópia do dia"), null, { timeout: 30000 });
  assert.equal(await page.textContent("h1"), "Entrando…");
  await page.waitForSelector("#vista > *:not(.skeleton)", { timeout: 60000 });
  await ctx.close();
});

T("aviso de tamanho: abaixo de 24 MB sem alerta; 24 MB alerta; ~28 MB forte; 30 MB ou mais ultrapassou o limite — Dados, Manutenção e Diagnóstico; a exportação nunca é bloqueada", async () => {
  const { ctx, page } = await aparelho();
  const base = await page.evaluate(async () => (await (await import("./js/data/backup.js")).exportarTexto()).length);
  const crescer = (alvo) => page.evaluate(async ([alvo, base]) => { // só para o teste: 1 cliente com observação grande + nova cópia
    const D = await import("./js/data/database.js"), B = await import("./js/data/backup.js");
    await D.transacao(["clientes"], "readwrite", (t) => t.clientes.salvar({ id: 999999, nome: "Cliente Grande", telefone: "(11) 90000-9999", observacoes: "x".repeat(alvo - base - 400), criado_em: "2026-11-01 10:00:00", atualizado_em: "2026-11-01 10:00:00" }));
    return (await B.snapshot("automatico")).tamanho; }, [alvo, base]);
  const estado = async () => {
    await ir(page, "dados", "#exportar"); const dados = await page.$eval("[data-tamanho-backup]", (e) => [e.dataset.tamanhoBackup, e.textContent]).catch(() => null);
    await ir(page, "manutencao", "#m-exp"); const man = await page.$eval("[data-tamanho-backup]", (e) => e.dataset.tamanhoBackup).catch(() => null);
    const d = await page.evaluate(async () => (await (await import("./js/data/diagnostico.js")).executar()).itens.find((i) => i.id === "backup"));
    return { dados, man, diag: [d.estado, d.texto] };
  };
  await page.evaluate(async () => (await import("./js/data/backup.js")).snapshot("automatico"));
  let e = await estado(); assert.deepEqual([e.dados, e.man, e.diag[0]], [null, null, "ok"], "backup normal: nenhum aviso"); assert.match(e.diag[1], /Última cópia: .* de 30 MB/);
  let t = await crescer(Math.round(24.3 * MB)); assert.ok(t >= 24 * MB && t < 27 * MB, String(t));
  e = await estado(); assert.equal(e.dados[0], "aviso"); assert.match(e.dados[1], /perto do limite de 30 MB que a restauração aceita/); assert.equal(e.man, "aviso"); assert.equal(e.diag[0], "aviso");
  await ir(page, "dados", "#exportar"); const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#exportar")]); assert.ok(dl, "exportação não bloqueada");
  await page.waitForFunction(() => document.querySelector("#alertas").textContent.includes("perto do limite de 30 MB")); await limparAvisos(page);
  t = await crescer(Math.round(28.2 * MB)); assert.ok(t >= 27 * MB && t < 30 * MB, String(t));
  e = await estado(); assert.equal(e.dados[0], "forte"); assert.match(e.dados[1], /muito perto do limite de 30 MB/); assert.equal(e.man, "forte"); assert.equal(e.diag[0], "aviso");
  t = await crescer(Math.round(31 * MB)); assert.ok(t >= 30 * MB, String(t));
  e = await estado(); assert.equal(e.dados[0], "acima"); assert.match(e.dados[1], /ultrapassou o limite de 30 MB da restauração: ele não pode ser restaurado por este aplicativo/);
  assert.equal(e.man, "acima"); assert.equal(e.diag[0], "erro"); assert.match(e.diag[1], /ultrapassou o limite/);
  await ir(page, "dados", "#exportar"); const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#exportar")]); assert.ok(dl2, "30 MB+: a exportação continua");
  await avisoErro(page, /ultrapassou o limite de 30 MB da restauração/);
  await ctx.close();
});

T("\"Gerado em\" da prévia na hora local: backup gerado às 17:58 em São Paulo aparece como 27/11/2026 17:58 (o arquivo continua em UTC)", async () => {
  const ctx = await contexto(), page = await ctx.newPage(); await page.clock.install({ time: new Date("2026-11-27T17:58:00-03:00") });
  await abrir(page, srv.url); await configurarAdmin(page); await semear(page);
  const txt = await page.evaluate(async () => (await import("./js/data/backup.js")).exportarTexto());
  assert.equal(JSON.parse(txt).criado_em.slice(0, 16), "2026-11-27T20:58", "o arquivo não mudou: hora em UTC");
  await ir(page, "dados", "#arq"); await page.setInputFiles("#arq", { name: "b.salaobackup", mimeType: "application/octet-stream", buffer: Buffer.from(txt) });
  await page.click("#analisar"); await page.waitForSelector('[data-restauracao="previa"]');
  assert.match((await page.textContent('[data-restauracao="previa"] dl')).replace(/\s+/g, " "), /Gerado em ?27\/11\/2026 17:58/);
  await ctx.close();
});

T("\"Próximo atendimento\" depois das 21h: cliente com atendimento hoje às 21:30 não conta como \"sem visita\" às 21:10", async () => {
  const ctx = await contexto(), page = await ctx.newPage(); await page.clock.install({ time: new Date("2026-11-27T15:00:00-03:00") });
  await abrir(page, srv.url); await configurarAdmin(page);
  await page.evaluate(async () => { const Cli = await import("./js/data/clientes.js"), Ag = await import("./js/data/agenda.js");
    const c = await Cli.salvar({ nome: "Cliente da Noite", telefone: "(11) 97777-1111" });
    const a = await Ag.salvar({ cliente_id: c, data: "2026-10-15", horario_agendado: "10:00", duracao_min: 60, servico: "Corte", valor_centavos: 5000, forma_pagamento: "Pix" }); await Ag.mudarStatus(a, "Realizado"); // última visita há 43 dias
    await Ag.salvar({ cliente_id: c, data: "2026-11-27", horario_agendado: "21:30", duracao_min: 60, servico: "Corte", valor_centavos: 5000, forma_pagamento: "Pix" }); });
  const semVisita = async () => { await ir(page, "hoje", ".mini-stats"); return page.$$eval(".mini-stats > div", (l) => +l.find((x) => /Sem visita/.test(x.textContent)).querySelector("strong").textContent); };
  assert.equal(await semVisita(), 0, "15:00");
  await page.clock.setSystemTime(new Date("2026-11-27T21:10:00-03:00"));
  assert.equal(await semVisita(), 0, "21:10: o atendimento de hoje continua sendo o próximo");
  await ctx.close();
});
