// Regras do CONTEÚDO de um backup no modelo atual (11.3). Fonte: o que o próprio aplicativo grava desde a 10.1
// (clientes.js, agenda.js, financeiro.js, servicos.js e usuarios.js — inalterados da 10.1 à 11.2).
// • Campos OBRIGATÓRIOS = os que as telas usam e que todas essas versões sempre gravam.
// • Campos OPCIONAIS, se presentes, precisam ter o tipo certo. Campos extras são mantidos como estão.
// • Nada é convertido ou "consertado": um registro fora das regras faz a validação falhar, com o motivo.
// • As listas fechadas vêm dos próprios módulos (fonte única).
import { STATUS, FORMAS } from "./agenda.js";
import { CATEGORIAS_DESP, FORMAS_DESP } from "./financeiro.js";
import { analisarHash } from "./senha.js";

export const TABELAS_PERMITIDAS = ["clientes", "servicos", "atendimentos", "pagamentos", "despesas", "auditoria", "configuracoes_sistema", "usuarios"];
export const TABELAS_OBRIGATORIAS = ["clientes", "atendimentos", "despesas", "configuracoes_sistema"];
export const STATUS_PAGAMENTO = ["Pendente", "Parcial", "Pago", "Estornado", "Cancelado", "Não informado"]; // agenda.js + financeiro.statusPagamento
export const PERFIS = ["admin", "recepcao", "funcionario"];
/** Regras de ACESSO (só valem para restaurar; não tornam um conjunto de dados "inconsistente"). */
export const CODIGOS_ACESSO = ["USUARIOS_VAZIO", "SEM_ADMIN_ATIVO"];

const id = (v) => Number.isSafeInteger(v) && v > 0;
const texto = (v) => typeof v === "string";
const preenchido = (v) => typeof v === "string" && v.trim().length > 0;
const textoOuNulo = (v) => v === null || typeof v === "string";
const data = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dataOuNulo = (v) => v === null || data(v);
const hora = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const centavos = (v) => Number.isSafeInteger(v) && v >= 0;
const centavosPositivos = (v) => Number.isSafeInteger(v) && v > 0;
const inteiroPositivo = (v) => Number.isSafeInteger(v) && v > 0;
const zeroUm = (v) => v === 0 || v === 1;
const idOuNulo = (v) => v === null || id(v);
const em = (lista) => (v) => lista.includes(v);
/** Nome de usuário exatamente como o login consegue encontrar (o login só tira espaços das pontas e põe em minúsculas). */
export const usuarioValido = (v) => typeof v === "string" && v.length > 0 && v.length <= 120 && v === v.trim().toLowerCase();
const senhaValida = (v) => analisarHash(v).ok;

export const ESQUEMA = {
  clientes: { chave: "id", obrigatorios: { id, nome: preenchido, telefone: texto },
    opcionais: { data_nascimento: dataOuNulo, observacoes: texto, preferencias: texto, criado_em: texto, atualizado_em: texto } },
  servicos: { chave: "id", obrigatorios: { id, nome: preenchido, duracao_min: inteiroPositivo, preco_centavos: centavos, ativo: zeroUm },
    opcionais: { categoria: texto, descricao: texto, criado_em: texto } },
  atendimentos: { chave: "id", obrigatorios: { id, cliente_id: id, data, horario_agendado: hora, servico: preenchido, valor_centavos: centavos,
    valor_recebido_centavos: centavos, forma_pagamento: em(FORMAS), status_atendimento: em(STATUS), status_pagamento: em(STATUS_PAGAMENTO) },
    opcionais: { duracao_min: inteiroPositivo, servico_id: idOuNulo, observacoes: texto, criado_em: texto, atualizado_em: texto } },
  pagamentos: { chave: "id", obrigatorios: { id, atendimento_id: id, tipo: em(["recebimento", "estorno"]), valor_centavos: centavosPositivos, data },
    opcionais: { forma_pagamento: texto, observacao: texto, criado_em: texto } },
  despesas: { chave: "id", obrigatorios: { id, descricao: preenchido, categoria: em(CATEGORIAS_DESP), data, valor_centavos: centavosPositivos, forma_pagamento: em(FORMAS_DESP) },
    opcionais: { observacoes: texto, criado_em: texto } },
  auditoria: { chave: "id", obrigatorios: { id, quando: texto, acao: texto, resumo: texto },
    opcionais: { entidade: texto, usuario: texto, campo: textoOuNulo, valor_anterior: textoOuNulo, valor_novo: textoOuNulo } },
  configuracoes_sistema: { chave: "chave", obrigatorios: { chave: preenchido, valor: texto } },
  usuarios: { chave: "id", obrigatorios: { id, usuario: usuarioValido, nome: preenchido, perfil: em(PERFIS), ativo: zeroUm, senha_hash: senhaValida },
    opcionais: { criado_em: texto, ultimo_acesso: texto }, proibidos: ["senha"] },
};
const RELACOES = [["atendimentos", "cliente_id", "clientes", false], ["pagamentos", "atendimento_id", "atendimentos", false], ["atendimentos", "servico_id", "servicos", true]];
const idSeguro = (v) => (id(v) ? v : undefined); // só ids numéricos aparecem nas mensagens (nunca conteúdo do arquivo)

/** Valida o conjunto de tabelas. Não lança e não grava nada.
 *  Devolve { problemas: [{ codigo, tabela?, n?, id?, campo?, ... }], contagens }. */
export function validarConjunto(T) {
  const problemas = [], contagens = {}, add = (p) => problemas.push(p);
  for (const nome of Object.keys(T)) if (!TABELAS_PERMITIDAS.includes(nome)) add({ codigo: "TABELA_DESCONHECIDA", tabela: nome });
  for (const nome of TABELAS_OBRIGATORIAS) if (!(nome in T)) add({ codigo: "TABELA_AUSENTE", tabela: nome });
  for (const nome of TABELAS_PERMITIDAS) {
    if (!(nome in T)) continue; const l = T[nome];
    if (!Array.isArray(l) || l.some((r) => !r || typeof r !== "object" || Array.isArray(r))) add({ codigo: "TABELA_MALFORMADA", tabela: nome });
    else contagens[nome] = l.length;
  }
  if (problemas.some((p) => p.codigo === "TABELA_MALFORMADA")) return { problemas, contagens }; // registros ilegíveis: não há como seguir

  for (const [nome, regras] of Object.entries(ESQUEMA)) {
    const l = T[nome]; if (!l) continue;
    const vistos = new Map(), codigoCampo = (campo) => (nome !== "usuarios" ? "CAMPO_INVALIDO" : campo === "senha_hash" ? "SENHA_NAO_SUPORTADA" : "USUARIO_INCOMPATIVEL");
    l.forEach((r, i) => {
      const n = i + 1, rid = idSeguro(r.id);
      for (const [campo, ok] of Object.entries(regras.obrigatorios)) if (!(campo in r) || !ok(r[campo])) add({ codigo: codigoCampo(campo), tabela: nome, n, id: rid, campo });
      for (const [campo, ok] of Object.entries(regras.opcionais || {})) if (r[campo] !== undefined && !ok(r[campo])) add({ codigo: codigoCampo(campo), tabela: nome, n, id: rid, campo });
      for (const campo of regras.proibidos || []) if (campo in r) add({ codigo: "USUARIO_INCOMPATIVEL", tabela: nome, n, id: rid, campo, proibido: true });
      const k = r[regras.chave];
      if (k !== undefined && k !== null) { if (vistos.has(k)) add({ codigo: nome === "usuarios" ? "USUARIO_INCOMPATIVEL" : "CHAVE_REPETIDA", tabela: nome, n, outro: vistos.get(k), campo: regras.chave, repetido: true }); else vistos.set(k, n); }
    });
  }
  if (Array.isArray(T.usuarios)) { // o login procura pelo nome de usuário: ele precisa ser único
    const vistos = new Map();
    T.usuarios.forEach((u, i) => { if (typeof u.usuario !== "string") return; if (vistos.has(u.usuario)) add({ codigo: "USUARIO_REPETIDO", tabela: "usuarios", n: i + 1, outro: vistos.get(u.usuario) }); else vistos.set(u.usuario, i + 1); });
  }
  const ids = (nome) => new Set((T[nome] || []).map((r) => r.id).filter(id));
  for (const [nome, campo, alvo, nulavel] of RELACOES) {
    if (!T[nome] || (!nulavel && !T[alvo])) continue; // tabela de destino obrigatória ausente: já reportada, sem cascata de erros
    const destino = ids(alvo);
    T[nome].forEach((r, i) => { const v = r[campo]; if (nulavel && (v === null || v === undefined)) return; if (id(v) && !destino.has(v)) add({ codigo: "RELACAO", tabela: nome, n: i + 1, id: idSeguro(r.id), campo, alvo }); });
  }
  if (Array.isArray(T.usuarios)) { // regras de ACESSO: o backup nunca pode deixar o aparelho sem um administrador que consiga entrar
    if (!T.usuarios.length) add({ codigo: "USUARIOS_VAZIO" });
    else if (!T.usuarios.some((u) => u.perfil === "admin" && u.ativo === 1 && usuarioValido(u.usuario) && senhaValida(u.senha_hash))) add({ codigo: "SEM_ADMIN_ATIVO" });
  }
  return { problemas, contagens };
}
