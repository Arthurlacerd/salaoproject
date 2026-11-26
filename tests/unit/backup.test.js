// Formato .salaobackup: checksum canônico (o mesmo do json.dumps do Python), validação e política de retenção.
// 11.3: dados de teste realistas (os campos que o app grava); a validação completa está em validacao_backup.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { arq } from "./_app.js";
import { tabelasValidas, docDe, com } from "./_fixtures.js";
const B = await import("../../js/data/backup.js");

test("checksum: JSON canônico idêntico ao json.dumps(sort_keys, separators compactos, ensure_ascii=False) do Python", () => {
  const t = tabelasValidas(), py = execFileSync("python3", ["-c", "import json,sys;print(json.dumps(json.load(sys.stdin),sort_keys=True,separators=(',',':'),ensure_ascii=False),end='')"], { input: JSON.stringify(t) }).toString("utf8");
  assert.equal(B.canonico(t), py);
});
test("validação: backup íntegro é aceito, com contagens", async () => {
  const r = await B.validar(JSON.stringify(await docDe())); assert.equal(r.ok, true, r.erros.join()); assert.equal(r.contagens.clientes, 1);
});
test("validação: qualquer alteração no conteúdo quebra o checksum e nada é importado", async () => {
  const d = await docDe(); d.tabelas.clientes[0].nome = "Alterada"; const r = await B.validar(JSON.stringify(d));
  assert.equal(r.ok, false); assert.match(r.erros[0], /alterado ou está corrompido: o checksum SHA-256 não confere/);
});
test("validação: recusa outro formato, versão de formato futura, JSON corrompido e vazio — com mensagens próprias", async () => {
  assert.equal((await B.validar(JSON.stringify({ formato: "x", tabelas: {} }))).ok, false);
  assert.match((await B.validar(JSON.stringify(await docDe(undefined, { versao_formato: 2 })))).erros[0], /mais novo que o suportado/);
  assert.match((await B.validar(JSON.stringify(await docDe(undefined, { versao_formato: undefined })))).erros[0], /ausente ou inválido/);
  assert.equal((await B.validar("{quebrado")).ok, false); assert.equal((await B.validar("")).ok, false);
});
test("validação: referências órfãs e senha fora do formato protegido são recusadas", async () => {
  assert.match((await com((T) => (T.atendimentos[0].cliente_id = 99))).erros.join(), /aponta para uma cliente que não está no backup/);
  assert.match((await com((T) => (T.usuarios[0].senha_hash = "pbkdf2:sha256:600000$abc$def"))).erros.join(), /formato de senha não suportado/);
  assert.equal((await com((T) => (T.usuarios[0].senha = "texto-puro"))).ok, false);
});
test("cabeçalho 9.x (versão 9, sem origem, tabela configuracoes_sistema): aceito só se válido, sem prometer conversão nem compatibilidade", async () => {
  const r = await B.validar(JSON.stringify(await docDe(undefined, { versao_app: "9.0.0", origem: undefined })));
  assert.equal(r.ok, true, r.erros.join()); assert.equal(r.origem, "não informada");
  assert.match(r.avisos.join(), /não foi verificada/); assert.doesNotMatch(r.avisos.join(), /convertid/);
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
test("retenção: a cópia antes da restauração mais recente nunca é removida (D6: política da 11.2 mantida)", () => {
  const l = [{ id: 1, motivo: "pre_importacao", tamanho: 10 }, ...Array.from({ length: 20 }, (_, i) => ({ id: i + 2, motivo: "automatico", tamanho: 10 }))];
  assert.equal(B.politicaRetencao(l).includes(1), false);
});
