// 11.3.1: valores com ponto de milhar digitados nas TELAS (Chromium): atendimento (valor e já recebido), recebimento,
// estorno, serviço e despesa. Antes, "1.500" era gravado como R$ 1,50.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, limpar } from "./_ambiente.js";

let dir, srv, nav, page, atId;
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador();
  page = await (await nav.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" })).newPage(); await abrir(page, srv.url); await configurarAdmin(page); await semear(page); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);
const ler = (store) => page.evaluate(async (s) => (await import("./js/data/database.js")).ler(s), store);
const ir = async (rota, sel) => { await page.goto(srv.url + "#/sobre"); await page.waitForSelector("#vista > *:not(.skeleton)"); await page.goto(srv.url + "#/" + rota); await page.waitForSelector(sel); };
const ate = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000 });

T("serviço: preço \"1.500\" é gravado como R$ 1.500,00 e aparece assim na lista", async () => {
  await ir("servico/novo", "#f-srv");
  await page.fill('#f-srv [name="nome"]', "Mechas Valor Alto"); await page.fill('#f-srv [name="duracao_min"]', "120"); await page.fill('#f-srv [name="preco"]', "1.500");
  await page.click('#f-srv [type="submit"]'); await page.waitForURL(/#\/servicos$/);
  const s = (await ler("servicos")).find((x) => x.nome === "Mechas Valor Alto"); assert.equal(s.preco_centavos, 150000);
  await page.waitForSelector("#vista > *:not(.skeleton)"); assert.match((await page.textContent("#vista")).replace(/\s+/g, " "), /Mechas Valor Alto.*R\$ 1\.500,00/);
});

T("atendimento: valor \"3.000\" e valor já recebido \"1.500\" pela tela", async () => {
  await ir("atendimento/novo", "#f-at");
  const cli = await page.$eval('#cliente-existente option[value]:not([value=""])', (o) => o.value); await page.selectOption("#cliente-existente", cli);
  await page.fill("#data", "2026-12-10"); await page.fill("#inicio", "15:00"); await page.fill("#servico", "Mechas Valor Alto"); await page.press("#servico", "Tab");
  await page.fill("#duracao", "120"); await page.fill("#valor", "3.000"); await page.selectOption("#forma", "Pix"); await page.selectOption("#stpg", "Parcial");
  await page.waitForSelector("#campo-rec:not([hidden])"); await page.fill("#valor-rec", "1.500");
  await page.click('#f-at [type="submit"]'); await ate(() => location.hash.startsWith("#/agenda"));
  const a = (await ler("atendimentos")).find((x) => x.data === "2026-12-10"); atId = a.id;
  assert.equal(a.valor_centavos, 300000, "valor do atendimento"); assert.equal(a.valor_recebido_centavos, 150000, "já recebido ao agendar");
  const p = (await ler("pagamentos")).filter((x) => x.atendimento_id === atId); assert.deepEqual(p.map((x) => [x.tipo, x.valor_centavos]), [["recebimento", 150000]]);
});

T("recebimento \"1.000\" e estorno \"1.200\" pela tela de pagamento", async () => {
  await ir(`atendimento/${atId}/pagamento`, "#f-pg");
  await page.selectOption('#f-pg [name="tipo"]', "recebimento"); await page.fill('#f-pg [name="valor"]', "1.000");
  await page.click('#f-pg [type="submit"]'); await ate((id) => location.hash === `#/atendimento/${id}`, atId);
  await ir(`atendimento/${atId}/pagamento`, "#f-pg");
  await page.selectOption('#f-pg [name="tipo"]', "estorno"); await page.fill('#f-pg [name="valor"]', "1.200");
  await page.click('#f-pg [type="submit"]'); await ate((id) => location.hash === `#/atendimento/${id}`, atId);
  const p = (await ler("pagamentos")).filter((x) => x.atendimento_id === atId).map((x) => [x.tipo, x.valor_centavos]);
  assert.deepEqual(p, [["recebimento", 150000], ["recebimento", 100000], ["estorno", 120000]]);
  const a = (await ler("atendimentos")).find((x) => x.id === atId); assert.equal(a.valor_recebido_centavos, 130000, "1.500 + 1.000 − 1.200");
  await page.waitForSelector("#vista > *:not(.skeleton)"); assert.match((await page.textContent("#vista")).replace(/\s+/g, " "), /R\$ 3\.000,00/);
});

T("despesa: \"1.500\" e \"1.500,50\" pela tela, gravadas e listadas corretamente", async () => {
  for (const [desc, valor, centavos, mostra] of [["Aluguel Valor Alto", "1.500", 150000, "R$ 1.500,00"], ["Reforma Valor Alto", "1.500,50", 150050, "R$ 1.500,50"]]) {
    await ir("despesas", "#f-desp");
    await page.fill('#f-desp [name="descricao"]', desc); await page.fill('#f-desp [name="valor"]', valor); await page.click('#f-desp [type="submit"]');
    await ate((d) => [...document.querySelectorAll("#vista *")].some((e) => e.children.length === 0 && e.textContent.includes(d)), desc);
    const d = (await ler("despesas")).find((x) => x.descricao === desc); assert.equal(d.valor_centavos, centavos, desc);
    assert.ok((await page.textContent("#vista")).replace(/\s+/g, " ").includes(mostra), `${desc}: lista mostra ${mostra}`);
  }
});

T("o backup com esses valores continua válido e consistente (nada fora das regras da 11.3)", async () => {
  const r = await page.evaluate(async () => { const B = await import("./js/data/backup.js"); const c = await B.criarValidado(); return { consistente: c.consistente, erros: c.rel.erros }; });
  assert.equal(r.consistente, true, r.erros.join(" | "));
});
