// 11.4 em Chromium: registros ANTIGOS com data inválida (gravados direto no banco, como uma versão anterior poderia ter
// deixado) são localizados com a validação do backup, aparecem em Dados e no Diagnóstico, e só são corrigidos por ação
// explícita do administrador, com auditoria. Depois das correções o backup volta a restaurar em outro aparelho.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, limpar } from "./_ambiente.js";

let dir, srv, nav;
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);
const SENHA = "senha-de-teste-123";
async function aparelho() { const ctx = await nav.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR", acceptDownloads: true }), page = await ctx.newPage(); await abrir(page, srv.url); await configurarAdmin(page); const ids = await semear(page); return { ctx, page, ids }; }
const ir = async (page, rota, sel) => { await page.goto(srv.url + "#/sobre"); await page.waitForSelector("#vista > *:not(.skeleton)"); await page.goto(srv.url + "#/" + rota); await page.waitForSelector(sel, { timeout: 30000 }); };
/** Grava direto no banco (sem as funções do app) registros com data inválida — simula dados antigos. */
const plantar = (page, ids) => page.evaluate(async (ids) => {
  const D = await import("./js/data/database.js"), agora = "2026-11-20 10:00:00";
  return D.transacao(["clientes", "atendimentos", "pagamentos", "despesas"], "readwrite", async (t) => ({
    pag: await t.pagamentos.adicionar({ atendimento_id: ids.aid, tipo: "recebimento", valor_centavos: 100, forma_pagamento: "Pix", data: "20277-11-28", observacao: "", criado_em: agora }),
    est: await t.pagamentos.adicionar({ atendimento_id: ids.aid, tipo: "estorno", valor_centavos: 50, forma_pagamento: "Pix", data: "2027-02-31", observacao: "", criado_em: agora }),
    cli: await t.clientes.adicionar({ nome: "Separador Errado", telefone: "(11) 95555-1212", data_nascimento: "1990/05/17", criado_em: agora }),
    at: await t.atendimentos.adicionar({ cliente_id: ids.cid, data: "2027-04-31", horario_agendado: "16:00", duracao_min: 60, servico: "Corte", valor_centavos: 3000, valor_recebido_centavos: 0, forma_pagamento: "Pix", status_atendimento: "Agendado", status_pagamento: "Pendente", criado_em: agora }),
    desp: await t.despesas.adicionar({ descricao: "Despesa antiga", categoria: "Outras despesas", data: "ontem", valor_centavos: 990, forma_pagamento: "Pix", criado_em: agora }),
  }));
}, ids);
const lerReg = (page, store, id) => page.evaluate(async ([s, id]) => (await (await import("./js/data/database.js")).obter(s, id)), [store, id]);
async function responderModal(page, valor, ok = "[data-ok]") { await page.waitForSelector(".modal-scrim #md-campo, .modal-scrim [data-ok]"); if (valor !== undefined) await page.fill("#md-campo", valor); await page.click(`.modal-scrim ${ok}`); }

T("registros antigos inválidos: aviso fixo em Dados, Diagnóstico, revisão sem correção automática, correções com auditoria, backup restaurável", async () => {
  const { ctx, page, ids } = await aparelho(), R = await plantar(page, ids);
  const originais = { pag: await lerReg(page, "pagamentos", R.pag), est: await lerReg(page, "pagamentos", R.est), cli: await lerReg(page, "clientes", R.cli), at: await lerReg(page, "atendimentos", R.at), desp: await lerReg(page, "despesas", R.desp) };
  // 1. exportar em Dados: arquivo marcado e AVISO FIXO que continua depois do redesenho
  await ir(page, "dados", "#exportar"); const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#exportar")]);
  assert.match(dl.suggestedFilename(), /-INCONSISTENTE\.salaobackup$/, "a exportação continua possível e marcada");
  await page.waitForSelector('[data-integridade="inconsistente"]'); await page.waitForTimeout(2500);
  const aviso = await page.textContent('[data-integridade="inconsistente"]');
  assert.match(aviso, /5 registro\(s\) com data inválida/); assert.match(aviso, /INCONSISTENTE/); assert.match(aviso, /Não há cópia restaurável|Última cópia restaurável/);
  await ir(page, "manutencao", "#m-exp"); await ir(page, "dados", "#exportar"); assert.ok(await page.$('[data-integridade="inconsistente"] a[href="#/integridade"]'), "continua em Dados ao voltar, com o caminho para a revisão");
  // 2. Diagnóstico: item de integridade com falha, sem dado pessoal, com link
  await ir(page, "diagnostico", '[data-diag="integridade"]');
  assert.equal(await page.$eval('[data-diag="integridade"]', (e) => e.dataset.estado), "erro");
  const diag = await page.textContent('[data-diag="integridade"]'); assert.match(diag, /5 registro\(s\) com data inválida/); assert.doesNotMatch(diag, /Separador|Despesa antiga|1990/);
  assert.ok(await page.$('[data-diag="integridade"] a[href="#/integridade"]'));
  // 3. revisão: lista os 5, com referências; abrir a tela NÃO altera nada
  await ir(page, "integridade", "[data-invalido]");
  assert.deepEqual((await page.$$eval("[data-invalido]", (l) => l.map((e) => e.dataset.invalido))).sort(), [`atendimentos:${R.at}`, `clientes:${R.cli}`, `despesas:${R.desp}`, `pagamentos:${R.est}`, `pagamentos:${R.pag}`].sort());
  const lpag = await page.textContent(`[data-invalido="pagamentos:${R.pag}"]`); assert.match(lpag, /20277-11-28/); assert.match(lpag, /registrado no sistema em 2026-11-20 10:00:00/); assert.match(lpag, /data do atendimento: 20\/11\/2026/);
  assert.match(await page.textContent(`[data-invalido="clientes:${R.cli}"]`), /sugestão sem perda.*17\/05\/1990.*só com confirmação/);
  for (const [k, s, id] of [["pag", "pagamentos", R.pag], ["est", "pagamentos", R.est], ["cli", "clientes", R.cli], ["at", "atendimentos", R.at], ["desp", "despesas", R.desp]]) assert.deepEqual(await lerReg(page, s, id), originais[k], `nada corrigido automaticamente (${k})`);
  // 4. pagamento: corrigir pela tela (modal + confirmação); só a data muda; auditoria com antes/depois
  const audAntes = await page.evaluate(async () => (await (await import("./js/data/database.js")).ler("auditoria")).length);
  await page.click(`[data-invalido="pagamentos:${R.pag}"] [data-lanc]`); assert.equal(await page.$eval("#md-campo", (i) => [i.type, i.value, i.min, i.max].join("|")), "date||2000-01-01|2100-12-31", "sem valor inventado, com a faixa");
  await responderModal(page, "2026-11-28"); await responderModal(page); await page.waitForSelector(`[data-invalido="pagamentos:${R.pag}"]`, { state: "detached" });
  const pagDepois = await lerReg(page, "pagamentos", R.pag); assert.deepEqual({ ...pagDepois, data: originais.pag.data }, originais.pag, "valor, tipo e o resto do lançamento não mudam"); assert.equal(pagDepois.data, "2026-11-28");
  const aud = await page.evaluate(async (n) => (await (await import("./js/data/database.js")).ler("auditoria")).slice(n), audAntes);
  assert.equal(aud.length, 1); assert.deepEqual([aud[0].acao, aud[0].entidade, aud[0].entidade_id, aud[0].campo, aud[0].valor_anterior, aud[0].valor_novo], ["correcao", "pagamento", R.pag, "data", "20277-11-28", "2026-11-28"]);
  // cancelar no modal não grava nada
  await page.click(`[data-invalido="pagamentos:${R.est}"] [data-lanc]`); await responderModal(page, "2026-11-27", "[data-no]"); assert.deepEqual(await lerReg(page, "pagamentos", R.est), originais.est, "cancelado: nada muda");
  await page.click(`[data-invalido="pagamentos:${R.est}"] [data-lanc]`); await responderModal(page, "2026-11-27"); await responderModal(page); await page.waitForSelector(`[data-invalido="pagamentos:${R.est}"]`, { state: "detached" });
  assert.equal((await lerReg(page, "pagamentos", R.est)).data, "2026-11-27"); assert.equal((await lerReg(page, "pagamentos", R.est)).tipo, "estorno");
  // 5. aniversário: a sugestão vem preenchida mas só vale com confirmação
  await page.click(`[data-invalido="clientes:${R.cli}"] [data-nasc]`); assert.equal(await page.$eval("#md-campo", (i) => i.value), "1990-05-17");
  await responderModal(page); await responderModal(page); await page.waitForSelector(`[data-invalido="clientes:${R.cli}"]`, { state: "detached" });
  assert.equal((await lerReg(page, "clientes", R.cli)).data_nascimento, "1990-05-17");
  // 6. atendimento e despesa: pela edição já existente (o campo exige uma data válida)
  await page.click(`[data-invalido="atendimentos:${R.at}"] a`); await page.waitForSelector("#f-at [data-data-invalida]"); assert.equal(await page.$eval("#data", (i) => i.value), "", "o navegador não mostra a data impossível");
  await page.fill("#data", "2027-04-30"); await page.click('#f-at button[type="submit"]'); await page.waitForFunction(() => /^#\/atendimento\/\d+$/.test(location.hash));
  await ir(page, "integridade", `[data-invalido="despesas:${R.desp}"]`); await page.click(`[data-invalido="despesas:${R.desp}"] a`); await page.waitForSelector("#f-desp [data-data-invalida]");
  await page.fill('#f-desp [name="data"]', "2026-11-19"); await page.click('#f-desp button[type="submit"]'); await page.waitForFunction(() => location.hash === "#/despesas");
  // 7. conferência: consistente; o aviso some de Dados; o backup novo restaura em outro aparelho
  await ir(page, "integridade", '[data-integridade="ok"]'); await ir(page, "dados", "#exportar"); assert.equal(await page.$('[data-integridade="inconsistente"]'), null);
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#exportar")]); assert.doesNotMatch(dl2.suggestedFilename(), /INCONSISTENTE/);
  const arq = await dl2.path(); const B = await nav.newContext(), p2 = await B.newPage(); await abrir(p2, srv.url); await configurarAdmin(p2, { usuario: "outra", senha: "outra-senha-123" });
  await ir(p2, "dados", "#arq"); await p2.setInputFiles("#arq", arq); await p2.click("#analisar"); await p2.waitForSelector('#previa [data-restauracao="previa"]');
  await p2.fill('#f-imp [name="prova_usuario"]', "admin"); await p2.fill('#f-imp [name="prova_senha"]', SENHA); await p2.fill('#f-imp [name="c"]', "SUBSTITUIR"); await p2.click('#f-imp button[type="submit"]');
  await p2.waitForSelector('form#f input[name="senha"]', { timeout: 60000 }); // restaurado: usuários do backup → volta ao login
  assert.deepEqual(await p2.evaluate(async () => (await (await import("./js/data/database.js")).ler("pagamentos")).map((p) => p.data).sort()), ["2026-11-20", "2026-11-27", "2026-11-28"]);
  await B.close(); await ctx.close();
});

T("correção restrita: lançamento válido, cliente com data válida e perfil sem administrador são recusados", async () => {
  const { ctx, page, ids } = await aparelho(); const R = await plantar(page, ids);
  const r = await page.evaluate(async ({ ids, R }) => {
    const Fin = await import("./js/data/financeiro.js"), Cli = await import("./js/data/clientes.js"), D = await import("./js/data/database.js"), U = await import("./js/data/usuarios.js"), out = {};
    const t = async (k, fn) => { try { await fn(); out[k] = "aceito"; } catch (e) { out[k] = e.message; } };
    const valido = (await D.ler("pagamentos")).find((p) => p.data === "2026-11-20").id;
    await t("lançamento válido", () => Fin.corrigirDataLancamento(valido, "2026-11-21"));
    await t("nova data inválida", () => Fin.corrigirDataLancamento(R.pag, "2027-02-30"));
    await t("nova data fora da faixa", () => Fin.corrigirDataLancamento(R.pag, "1999-01-01"));
    await t("cliente com data válida", () => Cli.corrigirNascimento(ids.cid, "1990-01-01"));
    await U.criar({ nome: "Recep Teste", usuario: "recep", perfil: "recepcao", senha: "senha-recep-123" }); U.sair(); await U.entrar("recep", "senha-recep-123");
    await t("recepção corrigindo lançamento", () => Fin.corrigirDataLancamento(R.pag, "2026-11-28"));
    await t("recepção corrigindo aniversário", () => Cli.corrigirNascimento(R.cli, null));
    out.intactos = (await D.obter("pagamentos", R.pag)).data === "20277-11-28" && (await D.obter("clientes", R.cli)).data_nascimento === "1990/05/17" && (await D.obter("pagamentos", valido)).data === "2026-11-20";
    return out;
  }, { ids, R });
  assert.match(r["lançamento válido"], /já tem uma data válida/); assert.match(r["nova data inválida"], /válida/); assert.match(r["nova data fora da faixa"], /entre 01\/01\/2000/);
  assert.match(r["cliente com data válida"], /não é inválida/); assert.match(r["recepção corrigindo lançamento"], /permissão/); assert.match(r["recepção corrigindo aniversário"], /permissão/);
  assert.equal(r.intactos, true);
  await ctx.close();
});

T("retenção real: com o estado inconsistente, 10 cópias automáticas novas não apagam a última cópia consistente", async () => {
  const { ctx, page, ids } = await aparelho();
  const r = await page.evaluate(async () => { const B = await import("./js/data/backup.js"); const boa = await B.snapshot("automatico"); return { boa: boa.id, inconsistente: !!boa.inconsistente }; });
  assert.equal(r.inconsistente, false); await plantar(page, ids);
  const depois = await page.evaluate(async () => { const B = await import("./js/data/backup.js"); for (let i = 0; i < 10; i++) await B.snapshot("automatico"); const l = await B.snapshots(); return { ids: l.map((s) => s.id), inconsistentes: l.filter((s) => s.inconsistente).length, restauravel: (await B.ultimaCopiaRestauravel())?.id }; });
  assert.ok(depois.ids.includes(r.boa), "a cópia consistente continua"); assert.equal(depois.restauravel, r.boa); assert.equal(depois.ids.length, 9, "8 mais recentes + a consistente"); assert.equal(depois.inconsistentes, 8);
  await ir(page, "dados", '[data-integridade="inconsistente"]'); assert.match(await page.textContent('[data-integridade="inconsistente"]'), /Última cópia restaurável neste aparelho/);
  await page.click(`[data-rest="${r.boa}"]`); await page.waitForSelector('#previa [data-restauracao="previa"]'); assert.ok(await page.$("#f-imp"), "a cópia preservada oferece restaurar");
  await ctx.close();
});
