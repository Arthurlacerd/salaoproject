// 11.4: regra ÚNICA de datas (js/data/datas.js) — gravação, CSV, parâmetros da URL e esquema do backup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { carregarVersaoGlobal, arq } from "./_app.js";
carregarVersaoGlobal();
const D = await import("../../js/data/datas.js");
const E = await import("../../js/data/esquema_backup.js");
const Ag = await import("../../js/data/agenda.js");
const Cli = await import("../../js/data/clientes.js");

// A regra do esquema do backup como estava na 11.3.2 (cópia congelada): a 11.4 não pode aceitar nem recusar nada diferente.
const DIAS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], bis = (a) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
const regra1132 = (v) => { const m = typeof v === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); if (!m) return false; const mes = +m[2], dia = +m[3]; return mes >= 1 && mes <= 12 && dia >= 1 && dia <= (mes === 2 && bis(+m[1]) ? 29 : DIAS[mes - 1]); };
const p2 = (n) => String(n).padStart(2, "0");

test("estrutura: casos da auditoria", () => {
  for (const v of ["2027-02-31", "2027-04-31", "2027-02-29", "2027-13-01", "2027-00-10", "2027-01-00", "2027-01-32", "20277-11-28", "112026-11-28", "ontem", "1990/05/17", "31/02/2027", "", " 2027-01-01", "2027-1-01", null, undefined, 20270101, "2027-01-01T00:00"])
    assert.equal(D.dataValida(v), false, String(v));
  for (const v of ["2024-02-29", "2000-02-29", "1900-02-28", "2027-04-30", "2027-12-31", "2027-01-01", "1990-05-17", "0001-01-01"]) assert.equal(D.dataValida(v), true, v);
  assert.equal(D.dataValida("1900-02-29"), false, "1900 não é bissexto"); assert.equal(D.dataValida("2100-02-29"), false, "2100 não é bissexto");
  assert.equal(D.dataValida("2000-02-29"), true, "2000 é bissexto (divisível por 400)");
});
test("nada é normalizado: a data impossível é recusada, não transformada", () => {
  assert.equal(Number.isNaN(Date.parse("2027-02-31")), false, "o motivo: Date.parse aceita e vira 03/03");
  assert.equal(D.validarData("2027-02-31", "operacao"), "Informe uma data válida (dia, mês e ano com 4 dígitos).");
  assert.equal(D.paraInterna("31/02/2027"), "2027-02-31", "a conversão do CSV só reordena; quem decide é dataValida");
  assert.equal(D.dataValida(D.paraInterna("31/02/2027")), false);
});
test("faixas de negócio: operação 2000–2100, nascimento 1900–hoje; só quando comFaixa", () => {
  for (const [v, ok] of [["1999-12-31", false], ["2000-01-01", true], ["2100-12-31", true], ["2101-01-01", false], ["2026-11-28", true]]) assert.equal(D.validarData(v, "operacao") === null, ok, v);
  for (const [v, ok] of [["1899-12-31", false], ["1900-01-01", true], ["1990-05-17", true], [D.hojeLocal(), true], ["2999-01-01", false]]) assert.equal(D.validarData(v, "nascimento") === null, ok, v);
  assert.match(D.validarData("2101-01-01", "operacao"), /entre 01\/01\/2000 e 31\/12\/2100 \(informada: 01\/01\/2101\)/);
  assert.equal(D.validarData("1850-03-10", "nascimento", { comFaixa: false }), null, "valor histórico válido e não alterado não é bloqueado pela faixa");
  assert.equal(D.validarData("1850-02-30", "nascimento", { comFaixa: false }) !== null, true, "mas a estrutura vale sempre");
  assert.deepEqual(D.faixa("operacao"), { min: "2000-01-01", max: "2100-12-31" });
  assert.equal(D.faixa("nascimento").max, D.hojeLocal());
});
test("CSV: DD/MM/AAAA e AAAA-MM-DD convertidos só por componentes; outros formatos recusados", () => {
  assert.equal(D.paraInterna("17/05/1990"), "1990-05-17"); assert.equal(D.paraInterna("1990-05-17"), "1990-05-17"); assert.equal(D.paraInterna(" 29/02/2024 "), "2024-02-29");
  for (const v of ["1990/05/17", "17-05-1990", "17/5/1990", "ontem", "", "17/05/90"]) assert.equal(D.paraInterna(v), null, v);
});
test("sugestão sem perda: só troca de separador que gere data válida", () => {
  assert.equal(D.sugestaoSemPerda("1990/05/17"), "1990-05-17"); assert.equal(D.sugestaoSemPerda("1990.05.17"), "1990-05-17");
  for (const v of ["1990/02/31", "20277-11-28", "2027-02-31", "ontem", "17/05/1990", null]) assert.equal(D.sugestaoSemPerda(v), null, String(v));
});
test("EQUIVALÊNCIA com o esquema do backup: mesma resposta que a regra da 11.3.2 em todo o espaço testado", () => {
  const casos = [];
  for (const a of ["0000", "0001", "1899", "1900", "1990", "1996", "2000", "2023", "2024", "2027", "2100", "2400", "9999"]) for (let m = 0; m <= 13; m++) for (let d = 0; d <= 32; d++) casos.push(`${a}-${p2(m)}-${p2(d)}`);
  casos.push("20277-11-28", "112026-11-28", "ontem", "1990/05/17", "", "2027-1-1", "２０２７-01-01");
  for (const v of casos) assert.equal(D.dataValida(v), regra1132(v), v);
  // e pelo próprio esquema do backup (validarConjunto): um atendimento com cada data é aceito exatamente quando dataValida aceita
  const base = { clientes: [{ id: 1, nome: "A", telefone: "1" }], despesas: [], configuracoes_sistema: [] };
  for (const v of ["2027-02-31", "2027-02-28", "2024-02-29", "2023-02-29", "20277-11-28", "ontem", "1990/05/17", "2000-01-01"]) {
    const at = { id: 1, cliente_id: 1, data: v, horario_agendado: "10:00", servico: "Corte", valor_centavos: 100, valor_recebido_centavos: 0, forma_pagamento: Ag.FORMAS[0], status_atendimento: "Agendado", status_pagamento: "Pendente" };
    const probs = E.validarConjunto({ ...base, atendimentos: [at] }).problemas.filter((p) => p.campo === "data");
    assert.equal(probs.length === 0, D.dataValida(v), v);
  }
});
test("gravação usa a MESMA regra estrutural: Ag.validar e Cli.validar", () => {
  const at = (data) => Ag.validar({ cliente_id: 1, data, horario_agendado: "10:00", servico: "Corte", valor_centavos: 100, forma_pagamento: Ag.FORMAS[0] });
  const cl = (data_nascimento) => Cli.validar({ nome: "Ana Teste", telefone: "(11) 90000-0000", data_nascimento });
  for (const v of ["2027-02-31", "2027-04-31", "2027-02-29", "20277-11-28", "ontem", "1990/05/17", "2027-02-28", "2024-02-29"]) {
    assert.equal(at(v) === null, D.dataValida(v), "agendamento " + v); assert.equal(cl(v) === null, D.dataValida(v), "aniversário " + v);
  }
  assert.equal(cl(""), null, "aniversário vazio = sem data"); assert.equal(cl(null), null);
});
test("independe do fuso: São Paulo, Lisboa e Tóquio dão o mesmo resultado (inclusive no CSV)", () => {
  const script = `import(${JSON.stringify("file://" + arq("js/data/datas.js"))}).then((D) => { const v = ["17/05/1990","15/07/1990","17/01/1990","29/02/2024","31/02/1990","1990-02-31","1990/05/17"];
    process.stdout.write(JSON.stringify(v.map((x) => { const i = D.paraInterna(x); return [x, i, i ? D.validarData(i, "nascimento") : "formato não aceito"]; }))); });`;
  const saidas = ["America/Sao_Paulo", "Europe/Lisbon", "Asia/Tokyo"].map((tz) => execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: tz } }).toString());
  assert.equal(saidas[1], saidas[0], "Lisboa = São Paulo"); assert.equal(saidas[2], saidas[0], "Tóquio = São Paulo");
  const r = Object.fromEntries(JSON.parse(saidas[0]).map(([x, , e]) => [x, e === null]));
  assert.deepEqual(r, { "17/05/1990": true, "15/07/1990": true, "17/01/1990": true, "29/02/2024": true, "31/02/1990": false, "1990-02-31": false, "1990/05/17": false });
});
test("fonte única: nenhum código de gravação usa Date.parse/toISOString para validar data", async () => {
  const { readFileSync } = await import("node:fs");
  const codigo = (f) => readFileSync(arq(f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); // sem comentários
  for (const f of ["js/data/agenda.js", "js/data/financeiro.js", "js/data/clientes.js", "js/data/datas.js", "js/data/esquema_backup.js"]) assert.doesNotMatch(codigo(f), /Date\.parse|toISOString/, f);
  assert.doesNotMatch(readFileSync(arq("js/data/backup.js"), "utf8").match(/export async function analisarCSV[\s\S]*?\n}\n/)[0], /new Date|toISOString/, "CSV sem fuso");
});
