// COMPATIBILIDADE OBRIGATÓRIA (11.3): backups gerados pelo PRÓPRIO código das versões publicadas que temos como evidência
// (10.1.0, 11.0.0, 11.1.0 e 11.2.0 — extraídas do git e executadas no Chromium) continuam restaurando na versão atual,
// com login funcionando e dados idênticos. É a proteção principal contra uma validação rígida demais.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, versaoGit, refExiste, servidor, navegador, abrir, configurarAdmin, semear, limpar, entrarUI, VERSAO } from "./_ambiente.js";

const VERSOES = [["10.1.0", "f07d811c1d2e25bb7af057e1d8f54a93a31cadf4"], ["11.0.0", "a3b731e2beb7efb357c468e988fbda4d2df4ac1a"], ["11.1.0", "b8061f2adda083ff76476e10196960105a4b6813"], ["11.2.0", "20218e20e782e241ad96b7912cccf0ef6b831bc8"]];
const ADMIN = { usuario: "admin", senha: "senha-de-teste-123" };
let nav, dAtual, srvAtual;
before(async () => { if (semNavegador) return; nav = await navegador(); dAtual = versaoAtual(); srvAtual = await servidor(dAtual); });
after(async () => { if (semNavegador) return; await nav.close(); await srvAtual.fechar(); limpar(dAtual); });

/** Gera, com o código da própria versão antiga, um backup com dados variados (todas as tabelas e vários campos). */
async function backupDaVersao(ref, versao) {
  const dir = versaoGit(ref), srv = await servidor(dir), ctx = await nav.newContext(), page = await ctx.newPage();
  try {
    await abrir(page, srv.url); await configurarAdmin(page); await semear(page);
    return await page.evaluate(async (versao) => {
      if (globalThis.SALAO_VERSAO.versao !== versao) throw new Error(`versão servida ${globalThis.SALAO_VERSAO.versao} ≠ ${versao}`);
      const Cli = await import("./js/data/clientes.js"), Srv = await import("./js/data/servicos.js"), Agd = await import("./js/data/agenda.js"), Fin = await import("./js/data/financeiro.js"), U = await import("./js/data/usuarios.js"), B = await import("./js/data/backup.js");
      await Srv.salvar({ nome: "Manicure", categoria: "Unhas", duracao_min: 45, preco_centavos: 4500, ativo: true });
      const c2 = await Cli.salvar({ nome: "Joana Exemplo", telefone: "(21) 97777-1234", data_nascimento: "1990-05-17", observacoes: "Prefere manhã" });
      const a2 = await Agd.salvar({ cliente_id: c2, data: "2026-11-21", horario_agendado: "14:30", duracao_min: 45, servico: "Manicure", valor_centavos: 4500, forma_pagamento: "Dinheiro" });
      await Fin.registrarPagamento(a2, "recebimento", 4500, "Dinheiro", "2026-11-21"); await Fin.registrarPagamento(a2, "estorno", 1000, "Dinheiro", "2026-11-22");
      await Agd.mudarStatus(a2, "Confirmado");
      const a3 = await Agd.salvar({ cliente_id: c2, data: "2026-11-25", horario_agendado: "09:00", servico: "Escova", valor_centavos: 3000, forma_pagamento: "A combinar" }); await Agd.mudarStatus(a3, "Cancelado");
      // os outros dois pontos que gravam pagamentos: valor recebido ao agendar ("A combinar" vira "Outro") e "receber saldo"
      const a4 = await Agd.salvar({ cliente_id: c2, data: "2026-11-26", horario_agendado: "16:00", servico: "Corte", valor_centavos: 6000, forma_pagamento: "A combinar" }, 2000); await Fin.receberSaldo(a4);
      await Fin.salvarDespesa({ descricao: "Aluguel", categoria: "Aluguel", data: "2026-11-05", valor_centavos: 150000, forma_pagamento: "Boleto" });
      await U.criar({ nome: "Recepção", usuario: "recep", perfil: "recepcao", senha: "senha-recep-789" });
      return B.exportarTexto();
    }, versao);
  } finally { await ctx.close(); await srv.fechar(); limpar(dir); }
}

for (const [versao, ref] of VERSOES) test(`backup gerado pela ${versao} restaura na ${VERSAO}: validação, prova de acesso, login e dados idênticos`, { skip: semNavegador || (!refExiste(ref) && `referência ${ref} (${versao}) ausente neste clone`) }, async () => {
  const texto = await backupDaVersao(ref, versao), x = JSON.parse(texto).tabelas;
  assert.equal(JSON.parse(texto).versao_app, versao);
  assert.equal(x.pagamentos.length, 5, "pagamentos dos três pontos que gravam pagamentos");
  assert.ok(x.pagamentos.every((p) => typeof p.forma_pagamento === "string" && p.forma_pagamento.trim()), `a ${versao} grava a forma em todo pagamento (evidência do M1): ${x.pagamentos.map((p) => p.forma_pagamento)}`);
  const ctx = await nav.newContext(), page = await ctx.newPage();
  try {
    await abrir(page, srvAtual.url); await configurarAdmin(page, { usuario: "dono.novo", senha: "outra-senha-000" }); // aparelho atual, com outro administrador
    const r = await page.evaluate(async ([texto, prova]) => {
      const R = await import("./js/data/restauracao.js"), rel = await R.analisarTexto(texto);
      if (!rel.ok) return { erros: rel.erros };
      const res = await R.restaurar(rel, { prova }); return { ok: true, contagens: res.contagens, tabelas: (await (await import("./js/data/backup.js")).montar()).tabelas };
    }, [texto, ADMIN]);
    assert.equal(r.ok, true, `backup da ${versao} recusado: ${(r.erros || []).join(" | ")}`);
    const { auditoria: a1, ...t } = r.tabelas, { auditoria: a0, ...esperado } = x;
    assert.deepEqual(t, esperado, "todas as tabelas idênticas às do backup"); assert.equal(a1.length, a0.length + 1, "+1 registro: a restauração");
    await page.reload(); await entrarUI(page, ADMIN.usuario, ADMIN.senha); // login com o administrador do backup
    for (const rota of ["agenda", "financeiro", "clientes"]) { await page.goto(srvAtual.url + "#/" + rota); await page.waitForSelector("#vista > *:not(.skeleton)"); assert.equal(await page.$("#vista .alert.erro"), null, `#/${rota} abre sem erro`); }
  } finally { await ctx.close(); }
});
