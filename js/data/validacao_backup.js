// Análise de um arquivo de backup ANTES de qualquer gravação (11.3): "este backup é restaurável neste sistema?".
// Etapas: tamanho → JSON → detectar formato → cabeçalho → integridade (estas interrompem: o conteúdo não é confiável)
//         → normalizar → validação completa do conteúdo (todos os problemas, até um limite). Nada aqui grava dados.
// As mensagens citam tabela, posição, id e nome do campo — nunca o conteúdo dos registros (nomes, telefones, senhas…).
import { detectar } from "./formatos_backup.js";
import { validarConjunto, CODIGOS_ACESSO } from "./esquema_backup.js";

export const LIMITE_BYTES = 30 * 1024 * 1024, MAX_MENSAGENS = 25;
export const AVISO_INCONSISTENTE = "Este backup representa um estado atualmente inconsistente e deve ser utilizado apenas para recuperação/análise.";
const NADA = " Nada foi alterado.";
const ALVO = { clientes: "uma cliente", atendimentos: "um atendimento", servicos: "um serviço" };
const nomeSeguro = (v) => (typeof v === "string" && /^[A-Za-z_][\w]{0,40}$/.test(v) ? v : "(nome inválido)");
const reg = (p) => `registro nº ${p.n}${p.id ? ` (id ${p.id})` : ""}`;

/** Texto de um problema. Público para os testes conferirem cada mensagem. */
export function mensagem(p) {
  switch (p.codigo) {
    case "ARQUIVO_VAZIO": return "O arquivo está vazio." + NADA;
    case "ARQUIVO_GRANDE": return "O arquivo é grande demais (limite de 30 MB)." + NADA;
    case "JSON_INVALIDO": return "O arquivo não é um backup legível: o conteúdo está corrompido ou não está no formato esperado." + NADA;
    case "FORMATO_DESCONHECIDO": return "Este arquivo não é um backup do Salão.gestão reconhecido por esta versão." + NADA;
    case "VERSAO_FORMATO_INVALIDA": return "O campo “versao_formato” do arquivo está ausente ou inválido; não é possível verificar este backup." + NADA;
    case "VERSAO_FORMATO_FUTURA": return `Este backup usa o formato v${p.versao}, mais novo que o suportado por esta versão (v1). Atualize o aplicativo antes de restaurar.` + NADA;
    case "OUTRO_SISTEMA": return "Este backup pertence a outro sistema." + NADA;
    case "CABECALHO_INVALIDO": return `O campo “${p.campo}” do cabeçalho do backup está inválido.` + NADA;
    case "DADOS_DE_VERSAO_FUTURA": return `Este backup foi gerado por uma versão mais nova do aplicativo (${p.campo === "versao_banco" ? "estrutura" : "dados"} v${p.versao}; esta versão usa v${p.atual}). Atualize o aplicativo antes de restaurar.` + NADA;
    case "SEM_TABELAS": return "O arquivo não contém as tabelas de dados de um backup." + NADA;
    case "SEM_CHECKSUM": return "O arquivo não tem checksum (sha256): não é possível verificar a integridade." + NADA;
    case "CHECKSUM_FORMATO": return "O checksum (sha256) do arquivo está em formato inválido." + NADA;
    case "CHECKSUM_DIVERGENTE": return "O arquivo foi alterado ou está corrompido: o checksum SHA-256 não confere." + NADA;
    case "ESTADO_INCONSISTENTE": return "Este arquivo foi exportado de um estado inconsistente e serve apenas para recuperação/análise; ele não pode ser restaurado como um backup normal.";
    case "TABELA_DESCONHECIDA": return `Estrutura inesperada: tabela desconhecida “${nomeSeguro(p.tabela)}”.`;
    case "TABELA_AUSENTE": return `Backup incompleto: falta a tabela “${p.tabela}”.`;
    case "TABELA_MALFORMADA": return `A tabela “${p.tabela}” está malformada.`;
    case "CAMPO_INVALIDO": return `Tabela “${p.tabela}”, ${reg(p)}: campo “${p.campo}” ausente ou inválido.`;
    case "CHAVE_REPETIDA": return `Tabela “${p.tabela}”: os registros nº ${p.outro} e nº ${p.n} têm o mesmo ${p.campo === "chave" ? "nome de configuração" : "identificador (id)"}.`;
    case "RELACAO": return `Tabela “${p.tabela}”, ${reg(p)}: aponta para ${ALVO[p.alvo] || "um registro"} que não está no backup.`;
    case "USUARIO_INCOMPATIVEL":
      if (p.repetido) return `O backup contém dados de usuário incompatíveis com esta versão: os usuários nº ${p.outro} e nº ${p.n} têm o mesmo identificador (id).`;
      return `O backup contém dados de usuário incompatíveis com esta versão: usuário nº ${p.n}${p.id ? ` (id ${p.id})` : ""}, campo “${p.campo}” ${p.proibido ? "não permitido" : "ausente ou inválido"}.`;
    case "USUARIO_REPETIDO": return `O backup contém dados de usuário incompatíveis com esta versão: os usuários nº ${p.outro} e nº ${p.n} têm o mesmo nome de usuário.`;
    case "SENHA_NAO_SUPORTADA": return `O backup contém um formato de senha não suportado por esta versão (usuário nº ${p.n}${p.id ? `, id ${p.id}` : ""}).`;
    case "USUARIOS_VAZIO": return "O backup contém uma tabela de usuários vazia: restaurá-lo deixaria este aparelho sem nenhum acesso.";
    case "SEM_ADMIN_ATIVO": return "O backup não contém nenhum administrador ativo com senha válida: restaurá-lo deixaria este aparelho sem acesso administrativo.";
    case "MAIS": return `… e mais ${p.qtd} problema(s).`;
    default: return "Problema não identificado no backup.";
  }
}

function relatorio(problemas, x = {}) {
  const ok = !problemas.length, erros = problemas.slice(0, MAX_MENSAGENS).map(mensagem);
  if (problemas.length > MAX_MENSAGENS) erros.push(mensagem({ codigo: "MAIS", qtd: problemas.length - MAX_MENSAGENS }));
  const m = x.meta || {};
  return { ok, erros, problemas, codigos: problemas.map((p) => p.codigo), avisos: x.avisos || [], contagens: x.contagens || {},
    criado_em: String(m.criado_em || ""), versao_app: String(m.versao_app || ""), origem: m.origem ? String(m.origem) : "não informada",
    formato: m.formato || null, temUsuarios: !!(ok && x.doc && "usuarios" in x.doc.tabelas), doc: ok ? x.doc : null };
}

/** Analisa um documento já lido. finalidade "restaurar" (padrão) ou "copia" (cópia do estado do próprio aparelho:
 *  as regras de ACESSO não contam como inconsistência). */
export async function analisarDoc(doc, { finalidade = "restaurar" } = {}) {
  const ad = detectar(doc); if (!ad) return relatorio([{ codigo: "FORMATO_DESCONHECIDO" }]);
  const c = ad.cabecalho(doc); if (c) return relatorio([c]);
  const i = await ad.integridade(doc); if (i) return relatorio([i]);
  const { tabelas, meta } = ad.normalizar(doc);
  let { problemas, contagens } = validarConjunto(tabelas);
  if (finalidade === "copia") problemas = problemas.filter((p) => !CODIGOS_ACESSO.includes(p.codigo));
  else if (meta.estado_dados === "inconsistente") problemas.unshift({ codigo: "ESTADO_INCONSISTENTE" });
  const avisos = [];
  if (/^\d+\./.test(String(meta.versao_app || "")) && Number(String(meta.versao_app).split(".")[0]) < 10)
    avisos.push(`Este arquivo informa a versão ${meta.versao_app}. A compatibilidade com backups da série 9.x não foi verificada: ele só pode ser restaurado se passar em todas as validações desta versão.`);
  if (!("usuarios" in tabelas)) avisos.push("Este backup não contém usuários: os usuários deste aparelho serão mantidos.");
  return relatorio(problemas, { avisos, contagens, meta, doc: { ...doc, tabelas } });
}

/** Analisa o texto de um arquivo. Nunca lança. */
export async function analisarTexto(texto) {
  if (!texto) return relatorio([{ codigo: "ARQUIVO_VAZIO" }]);
  if (texto.length > LIMITE_BYTES) return relatorio([{ codigo: "ARQUIVO_GRANDE" }]);
  let doc; try { doc = JSON.parse(String(texto).replace(/^﻿/, "")); } catch (_) { return relatorio([{ codigo: "JSON_INVALIDO" }]); }
  return analisarDoc(doc);
}

/** Analisa um File/Blob: confere o tamanho ANTES de ler o conteúdo. */
export async function analisarArquivo(f) {
  if (!f) return relatorio([{ codigo: "ARQUIVO_VAZIO" }]);
  if (f.size > LIMITE_BYTES) return relatorio([{ codigo: "ARQUIVO_GRANDE" }]);
  return analisarTexto(await f.text());
}
