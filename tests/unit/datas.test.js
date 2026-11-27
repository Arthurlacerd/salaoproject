// 11.3.1: horários e datas exibidos no fuso de quem usa o app (America/Sao_Paulo), sem mudar o que é gravado.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { carregarVersaoGlobal } from "./_app.js";
process.env.TZ = "America/Sao_Paulo"; // fuso de produção (este processo de teste só)
carregarVersaoGlobal();
const { dataHoraBackup } = await import("../../js/ui/util.js");
const Cli = await import("../../js/data/clientes.js");

test("\"Gerado em\": o app (origem pwa, 10.1–11.3) grava em UTC sem o \"Z\" → exibido na hora local", () => {
  assert.equal(new Date("2026-11-27T12:00:00Z").getTimezoneOffset(), 180, "fuso de teste: UTC−3");
  assert.equal(dataHoraBackup("2026-11-27T20:58:00", "pwa"), "27/11/2026 17:58", "gerado às 17:58 em São Paulo");
  assert.equal(dataHoraBackup("2026-11-28T01:30:00", "pwa"), "27/11/2026 22:30", "depois das 21h a data UTC já é o dia seguinte");
  assert.equal(dataHoraBackup("2026-01-01T02:00:00", "pwa"), "31/12/2025 23:00", "virada de ano");
});
test("\"Gerado em\": outras origens (ex.: 9.x) e formatos que não são do app aparecem como estão; vazio = não informado", () => {
  assert.equal(dataHoraBackup("2025-05-01T14:03:22.123456", "servidor"), "01/05/2025 14:03");
  assert.equal(dataHoraBackup("2025-05-01T14:03:22", undefined), "01/05/2025 14:03");
  assert.equal(dataHoraBackup("2026-11-27 10:00:00", "pwa"), "27/11/2026 10:00");
  for (const v of ["", null, undefined]) assert.equal(dataHoraBackup(v, "pwa"), "não informado");
  assert.equal(dataHoraBackup("ontem", "pwa"), "ontem");
});

const cliente = { id: 1, nome: "Cliente Teste", telefone: "(11) 90000-0000", criado_em: "2026-10-01 10:00:00" };
const at = (data, status = "Agendado") => ({ id: data + status, cliente_id: 1, data, horario_agendado: "21:30", duracao_min: 60, status_atendimento: status, valor_recebido_centavos: 0 });
const as = (iso, fn) => { mock.timers.enable({ apis: ["Date"], now: new Date(iso) }); try { return fn(); } finally { mock.timers.reset(); } };

test("\"Próximo atendimento\" de HOJE não some depois das 21h (São Paulo)", () => {
  for (const hora of ["2026-11-27T21:10:00-03:00", "2026-11-27T23:59:00-03:00"]) as(hora, () => {
    assert.equal(new Date().toISOString().slice(0, 10), "2026-11-28", "neste horário a data UTC já é o dia seguinte (a causa do problema)");
    assert.equal(Cli.perfil(cliente, [at("2026-11-27")]).proximo, "2026-11-27", hora);
  });
});
test("\"Próximo atendimento\": regras de sempre — hoje e futuros contam; passados, cancelados e realizados não", () => as("2026-11-27T15:00:00-03:00", () => {
  assert.equal(Cli.perfil(cliente, [at("2026-11-27")]).proximo, "2026-11-27");
  assert.equal(Cli.perfil(cliente, [at("2026-11-26"), at("2026-12-03"), at("2026-11-30")]).proximo, "2026-11-30");
  assert.equal(Cli.perfil(cliente, [at("2026-11-26"), at("2026-11-28", "Cancelado"), at("2026-11-29", "Realizado")]).proximo, null);
  assert.equal(Cli.perfil(cliente, [at("2026-11-28", "Confirmado")]).proximo, "2026-11-28");
}));
