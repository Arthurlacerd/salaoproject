// 11.4 em Chromium: 11.3.2 (código real, do git) com registros de data inválida → atualização para a atual pela tela →
// correção pelo administrador → retorno para a 11.3.2 pela tela. A 11.3.2 lê tudo: banco, registros corrigidos, cópias
// locais e o backup gerados pela versão atual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, versaoGit, refExiste, servidor, navegador, abrir, configurarAdmin, semear, limpar, estadoDados, VERSAO } from "./_ambiente.js";

const REF = process.env.SALAO_REF_11_3_2 || "b67c23d8bff9a68f48270280525a6cdf69fb7f74";
test(`11.3.2 → ${VERSAO} → correções → retorno para 11.3.2: tudo legível e consistente na 11.3.2`, { skip: semNavegador || (!refExiste(REF) && "referência 11.3.2 ausente neste clone"), timeout: 600000 }, async () => {
  const dAnt = versaoGit(REF), dAtual = versaoAtual(), srv = await servidor(dAnt), nav = await navegador();
  try {
    const ctx = await nav.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }), page = await ctx.newPage(), erros = []; page.on("pageerror", (e) => erros.push(e.message));
    await abrir(page, srv.url); await configurarAdmin(page); const ids = await semear(page);
    assert.equal(await page.evaluate(() => globalThis.SALAO_VERSAO.versao), "11.3.2");
    const R = await page.evaluate(async (ids) => { const D = await import("./js/data/database.js"); return D.transacao(["clientes", "pagamentos"], "readwrite", async (t) => ({
      pag: await t.pagamentos.adicionar({ atendimento_id: ids.aid, tipo: "recebimento", valor_centavos: 100, forma_pagamento: "Pix", data: "20277-11-28", observacao: "", criado_em: "2026-11-20 10:00:00" }),
      cli: await t.clientes.adicionar({ nome: "Separador Errado", telefone: "(11) 95555-1212", data_nascimento: "1990/05/17", criado_em: "2026-11-20 10:00:00" }) })); }, ids);
    assert.equal(await page.evaluate(async () => (await (await import("./js/data/backup.js")).criarValidado()).consistente), false, "na 11.3.2 o estado está inconsistente");
    // ---- atualização pela tela ----
    srv.publicar(dAtual);
    assert.equal(await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); const w = reg.installing || reg.waiting; if (!w) return "nada";
      return new Promise((ok) => { const f = () => (w.state === "redundant" || w.state === "installed") && ok(w.state); w.addEventListener("statechange", f); f(); }); }), "installed");
    await page.waitForSelector("#update-banner:not([hidden]) #botao-atualizar", { timeout: 10000 });
    await Promise.all([page.waitForEvent("framenavigated", { timeout: 60000 }), page.click("#botao-atualizar")]);
    await page.waitForFunction((v) => globalThis.SALAO_VERSAO?.versao === v, VERSAO, { timeout: 30000 }); await page.waitForSelector("#vista");
    // ---- na versão atual: revisão + correções do administrador; backup e cópia gerados pela versão atual ----
    await page.goto(srv.url + "#/integridade"); await page.waitForSelector(`[data-invalido="pagamentos:${R.pag}"]`);
    const atual = await page.evaluate(async ({ R }) => { const Fin = await import("./js/data/financeiro.js"), Cli = await import("./js/data/clientes.js"), B = await import("./js/data/backup.js");
      await Fin.corrigirDataLancamento(R.pag, "2026-11-28"); await Cli.corrigirNascimento(R.cli, "1990-05-17");
      const v = await B.criarValidado(), copia = await B.snapshot("automatico"); return { consistente: v.consistente, texto: await B.exportarTexto(), copia: copia.id }; }, { R });
    assert.equal(atual.consistente, true, "corrigido: consistente na versão atual");
    const e1 = await estadoDados(page);
    // ---- retorno para a 11.3.2 pela tela ----
    await page.goto(srv.url + "#/manutencao"); await page.waitForSelector('[data-voltar="11.3.2"]'); await page.click('[data-voltar="11.3.2"]');
    await Promise.all([page.waitForEvent("framenavigated", { timeout: 60000 }), page.click(".modal [data-ok]")]);
    await page.waitForFunction(() => globalThis.SALAO_VERSAO?.versao === "11.3.2", null, { timeout: 30000 }); await page.waitForSelector("#vista");
    const e2 = await estadoDados(page); assert.equal(e2.versao, "11.3.2");
    for (const k of ["clientes", "atendimentos", "pagamentos", "despesas", "usuarios", "servicos", "cliente", "atendimento", "schema", "migracoes"]) assert.deepEqual(e2[k], e1[k], `preservado no retorno: ${k}`);
    const r = await page.evaluate(async ({ R, ids, texto, copia }) => {
      const D = await import("./js/data/database.js"), B = await import("./js/data/backup.js"), Ag = await import("./js/data/agenda.js"), Cli = await import("./js/data/clientes.js"), Fin = await import("./js/data/financeiro.js");
      const pg = await D.obter("pagamentos", R.pag), cl = await D.obter("clientes", R.cli), at = await Ag.obter(ids.aid);
      return { pag: [pg.data, pg.valor_centavos, pg.tipo], cli: cl.data_nascimento, at: at && at.cliente_nome, pagamentosDoAtendimento: (await Fin.pagamentosDe(ids.aid)).length, clientes: (await Cli.listar()).length,
        consistente: (await B.criarValidado()).consistente, backupDaAtual: (await B.validar(texto)).ok, copiaDaAtual: (await B.validar(await B.snapshotTexto(copia))).ok,
        recebidoNoMes: (await Fin.resumo("2026-11-01", "2026-11-30")).recebido, auditoria: (await D.ler("auditoria")).filter((a) => a.acao === "correcao").map((a) => a.campo) };
    }, { R, ids, texto: atual.texto, copia: atual.copia });
    assert.deepEqual(r.pag, ["2026-11-28", 100, "recebimento"], "lançamento corrigido legível na 11.3.2, valor e tipo intactos");
    assert.equal(r.cli, "1990-05-17"); assert.ok(r.at, "atendimento acessível"); assert.equal(r.pagamentosDoAtendimento, 2); assert.equal(r.clientes, 2);
    assert.equal(r.consistente, true, "a 11.3.2 vê os dados como consistentes"); assert.equal(r.backupDaAtual, true, `a 11.3.2 aceita o backup gerado pela ${VERSAO}`); assert.equal(r.copiaDaAtual, true, `a 11.3.2 aceita a cópia local gravada pela ${VERSAO}`);
    assert.equal(r.recebidoNoMes, 5000 + 100, "o lançamento corrigido entra no Financeiro do mês"); assert.deepEqual(r.auditoria.sort(), ["data", "data_nascimento"], "a auditoria das correções continua lá");
    for (const rota of ["hoje", "agenda", "clientes", "financeiro", `atendimento/${ids.aid}`, "dados"]) { await page.goto(srv.url + "#/" + rota); await page.waitForSelector("#vista > *:not(.skeleton)"); }
    assert.deepEqual(erros, [], "nenhum erro de página na 11.3.2");
    await ctx.close();
  } finally { await nav.close(); await srv.fechar(); limpar(dAnt, dAtual); }
});
