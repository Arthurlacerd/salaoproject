// Dados de teste REALISTAS no modelo atual: os mesmos campos que o aplicativo grava desde a 10.1.
import { carregarVersaoGlobal } from "./_app.js";
carregarVersaoGlobal();
const B = await import("../../js/data/backup.js"), U = await import("../../js/data/usuarios.js");
export const SENHA = "senha-de-teste-123";
export const HASH = await U.hashSenha(SENHA); // gerado pelo próprio app (WebCrypto), formato real
const t = "2026-11-01 10:00:00";
export function tabelasValidas() {
  return {
    clientes: [{ id: 1, nome: "Cliente Teste", telefone: "(11) 90000-0000", data_nascimento: null, observacoes: "ção ü 😀", preferencias: "", criado_em: t, atualizado_em: t }],
    servicos: [{ id: 1, nome: "Corte", categoria: "Cabelo", descricao: "", duracao_min: 60, preco_centavos: 5000, ativo: 1, criado_em: t }],
    atendimentos: [{ id: 1, cliente_id: 1, data: "2026-11-20", horario_agendado: "10:00", duracao_min: 60, servico: "Corte", servico_id: 1, valor_centavos: 5000, forma_pagamento: "Pix", observacoes: "", atualizado_em: t, status_atendimento: "Realizado", status_pagamento: "Pago", valor_recebido_centavos: 5000, criado_em: t }],
    pagamentos: [{ id: 1, atendimento_id: 1, tipo: "recebimento", valor_centavos: 5000, forma_pagamento: "Pix", data: "2026-11-20", observacao: "", criado_em: t }],
    despesas: [{ id: 1, descricao: "Produto", categoria: "Outras despesas", data: "2026-11-01", valor_centavos: 1200, forma_pagamento: "Pix", observacoes: "", criado_em: t }],
    auditoria: [{ id: 1, quando: t, acao: "criacao", entidade: "cliente", entidade_id: 1, campo: null, valor_anterior: null, valor_novo: null, resumo: "Cliente cadastrada", usuario: "Admin" }],
    configuracoes_sistema: [{ chave: "nome_sistema", valor: "Salão.gestão" }, { chave: "tema", valor: "claro" }],
    usuarios: [{ id: 1, usuario: "admin", nome: "Admin", perfil: "admin", senha_hash: HASH, ativo: 1, criado_em: t, ultimo_acesso: t }],
  };
}
/** Documento .salaobackup v1 com checksum correto. cab: campos do cabeçalho a sobrescrever (undefined remove o campo). */
export async function docDe(tabelas = tabelasValidas(), cab = {}) {
  const d = { formato: "salao-gestao-backup", sistema: "Salão.gestão", versao_formato: 1, versao_app: "11.3.0", versao_banco: 1, versao_schema: 2, origem: "pwa", criado_em: "2026-11-26T10:00:00", sha256: await B.sha256(B.canonico(tabelas)), tabelas, ...cab };
  for (const k of Object.keys(cab)) if (cab[k] === undefined) delete d[k];
  return d;
}
export const analisar = async (tabelas, cab) => B.validar(JSON.stringify(await docDe(tabelas, cab)));
/** Aplica uma alteração numa cópia das tabelas válidas e analisa. */
export async function com(muda, cab) { const T = tabelasValidas(); muda(T); return analisar(T, cab); }
