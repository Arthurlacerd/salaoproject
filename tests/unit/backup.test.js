// Formato .salaobackup: checksum canônico (compatível com o Python do 9.x), validação e política de retenção.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { carregarVersaoGlobal, arq } from "./_app.js";
carregarVersaoGlobal();
const B = await import("../../js/data/backup.js");

const TAB = () => ({
  clientes: [{ id: 1, nome: "Cliente Teste", telefone: "(11) 90000-0000", observacoes: "ção ü 😀" }],
  servicos: [{ id: 1, nome: "Corte", duracao_min: 60, valor_centavos: 5000 }],
  atendimentos: [{ id: 1, cliente_id: 1, data: "2026-11-20", horario_agendado: "10:00", valor_centavos: 5000, servico: "Corte" }],
  pagamentos: [{ id: 1, atendimento_id: 1, tipo: "recebimento", valor_centavos: 5000, data: "2026-11-20" }],
  despesas: [{ id: 1, descricao: "Produto", data: "2026-11-01", valor_centavos: 1200, categoria: "Outras despesas" }],
  auditoria: [], configuracoes_sistema: [{ chave: "nome_sistema", valor: "Salão.gestão" }],
  usuarios: [{ id: 1, usuario: "admin", nome: "Admin", perfil: "admin", ativo: 1, senha_hash: "pbkdf2$150000$c2Fs$aGFzaA==" }],
});
async function doc(tabelas = TAB(), extra = {}) { return { formato: B.FORMATO, sistema: "Salão.gestão", versao_formato: 1, versao_app: "11.2.0", origem: "pwa", criado_em: "2026-11-26T10:00:00", sha256: await B.sha256(B.canonico(tabelas)), tabelas, ...extra }; }

test("checksum: JSON canônico idêntico ao json.dumps(sort_keys, separators compactos, ensure_ascii=False) do Python", () => {
  const t = TAB(), py = execFileSync("python3", ["-c", "import json,sys;print(json.dumps(json.load(sys.stdin),sort_keys=True,separators=(',',':'),ensure_ascii=False),end='')"], { input: JSON.stringify(t) }).toString("utf8");
  assert.equal(B.canonico(t), py);
});
test("validação: backup íntegro é aceito, com contagens", async () => {
  const r = await B.validar(JSON.stringify(await doc())); assert.equal(r.ok, true, r.erros.join()); assert.equal(r.contagens.clientes, 1);
});
test("validação: qualquer alteração no conteúdo quebra o checksum e nada é importado", async () => {
  const d = await doc(); d.tabelas.clientes[0].nome = "Alterada"; const r = await B.validar(JSON.stringify(d));
  assert.equal(r.ok, false); assert.match(r.erros[0], /integridade/);
});
test("validação: recusa outro formato, versão de formato futura, JSON corrompido e vazio", async () => {
  assert.equal((await B.validar(JSON.stringify({ formato: "x", tabelas: {} }))).ok, false);
  assert.match((await B.validar(JSON.stringify(await doc(TAB(), { versao_formato: 2 })))).erros[0], /mais nova/);
  assert.equal((await B.validar("{quebrado")).ok, false); assert.equal((await B.validar("")).ok, false);
});
test("validação: referências órfãs e senha fora do formato protegido são recusadas", async () => {
  const t = TAB(); t.atendimentos[0].cliente_id = 99; assert.match((await B.validar(JSON.stringify(await doc(t)))).erros.join(), /clientes que não estão/);
  const u = TAB(); u.usuarios[0].senha_hash = "pbkdf2:sha256:600000$abc$def"; assert.match((await B.validar(JSON.stringify(await doc(u)))).erros.join(), /usuarios/);
  const s = TAB(); s.usuarios[0].senha = "texto-puro"; assert.equal((await B.validar(JSON.stringify(await doc(s)))).ok, false);
});
test("9.x: tabela configuracoes_sistema, origem ausente e versão 9 → aceito, sem prometer conversão", async () => {
  const d = await doc(TAB(), { versao_app: "9.0.0" }); delete d.origem; const r = await B.validar(JSON.stringify(d));
  assert.equal(r.ok, true, r.erros.join()); assert.equal(r.origem, "servidor 9.x");
  assert.match(r.avisos.join(), /importados como estão/); assert.doesNotMatch(r.avisos.join(), /convertid/);
});
test("9.x real: fixture tests/fixtures/backup-9x.salaobackup (se existir) é validado sem erros", { skip: !existsSync(arq("tests/fixtures/backup-9x.salaobackup")) && "sem fixture 9.x real no repositório (veja tests/fixtures/LEIA-ME.md)" }, async () => {
  const r = await B.validar(readFileSync(arq("tests/fixtures/backup-9x.salaobackup"), "utf8")); assert.equal(r.ok, true, r.erros.join(" | "));
});
test("retenção: mantém as 8 mais recentes + a última de cada tipo de segurança", () => {
  const l = [{ id: 1, motivo: "pre_atualizacao", tamanho: 10 }, ...Array.from({ length: 12 }, (_, i) => ({ id: i + 2, motivo: "automatico", tamanho: 10 }))];
  const apagar = B.politicaRetencao(l); assert.equal(apagar.includes(1), false, "preserva o último pre_atualizacao"); assert.deepEqual(apagar.sort((a, b) => a - b), [2, 3, 4, 5]);
});
test("retenção: limite de tamanho apaga as mais antigas, nunca abaixo de 2 nem a mais recente", () => {
  const MB = 1024 * 1024, l = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, motivo: "automatico", tamanho: 15 * MB }));
  assert.deepEqual(B.politicaRetencao(l).sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.deepEqual(B.politicaRetencao([{ id: 1, motivo: "automatico", tamanho: 90 * MB }, { id: 2, motivo: "automatico", tamanho: 90 * MB }]), []);
});
