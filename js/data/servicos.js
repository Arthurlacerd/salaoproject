import { transacao, ler, agora, auditar, norm } from "./database.js";
import { exigir } from "./permissoes.js";
export const CATEGORIAS = ["Cabelo", "Unhas", "Estética", "Maquiagem", "Depilação", "Outros"];
export async function listar({ apenasAtivos = false } = {}) { const r = await ler("servicos"); return r.filter((s) => !apenasAtivos || s.ativo).sort((a, b) => norm(a.nome).localeCompare(norm(b.nome))); }
export async function salvar(d) {
  exigir("servicos.gravar");
  const nome = (d.nome || "").trim(); if (nome.length < 2 || nome.length > 120) throw new Error("Informe o nome do serviço.");
  const dur = parseInt(d.duracao_min, 10); if (!(dur >= 5 && dur <= 720)) throw new Error("Duração entre 5 e 720 minutos.");
  if (!(d.preco_centavos >= 0)) throw new Error("Preço inválido.");
  return transacao(["servicos", "auditoria"], "readwrite", async (t) => {
    const outros = await t.servicos.todos();
    if (outros.some((s) => s.id !== d.id && norm(s.nome) === norm(nome))) throw new Error("Já existe um serviço com esse nome.");
    const reg = { nome, categoria: d.categoria || "Outros", descricao: (d.descricao || "").slice(0, 300), duracao_min: dur, preco_centavos: d.preco_centavos, ativo: d.ativo === false ? 0 : 1 };
    if (d.id) { const a = await t.servicos.get(d.id); await t.servicos.salvar({ ...a, ...reg }); await auditar(t, "edicao", "servico", d.id, `Serviço editado: ${nome}`); return d.id; }
    const id = await t.servicos.adicionar({ ...reg, criado_em: agora() }); await auditar(t, "criacao", "servico", id, `Serviço criado: ${nome}`); return id;
  });
}
export async function alternar(id) {
  exigir("servicos.gravar");
  return transacao(["servicos", "auditoria"], "readwrite", async (t) => { const s = await t.servicos.get(id); s.ativo = s.ativo ? 0 : 1; await t.servicos.salvar(s); await auditar(t, "edicao", "servico", id, `Serviço ${s.ativo ? "ativado" : "desativado"}: ${s.nome}`); });
}
