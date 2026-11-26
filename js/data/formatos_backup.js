// Formatos de arquivo de backup reconhecidos e seus adaptadores (11.3).
// Fluxo: detectar formato → adaptador (cabeçalho e integridade PRÓPRIOS do formato) → normalizar para o modelo atual
//        → validação comum (validacao_backup.js) → restauração (restauracao.js).
// Hoje existe UM adaptador: "salaobackup-v1" — o formato gerado por este aplicativo desde a 10.1 (inalterado na 11.3).
// A compatibilidade com backups da série 9.x NÃO está comprovada (não há código-fonte nem arquivo real 9.x). Quando houver
// evidência, um "adaptador_9x" entra em ADAPTADORES, com detecção, integridade e normalização próprias — sem mexer no
// adaptador moderno nem na validação comum.
import { INFO, VERSAO_BANCO, VERSAO_SCHEMA } from "./database.js";

export const FORMATO = "salao-gestao-backup", VERSAO_FORMATO = 1;

/** JSON canônico: chaves ordenadas, sem espaços, Unicode sem escape. Igual ao
 *  json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False) do Python (conferido nos testes). */
export function canonico(v) {
  if (Array.isArray(v)) return "[" + v.map(canonico).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonico(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
export async function sha256(texto) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }

const objeto = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Formato atual (.salaobackup v1). Cada etapa devolve um problema ({ codigo, ... }) ou null. */
export const adaptadorV1 = {
  id: "salaobackup-v1",
  reconhece: (doc) => objeto(doc) && doc.formato === FORMATO,
  cabecalho(doc) {
    if (!Number.isInteger(doc.versao_formato) || doc.versao_formato < 1) return { codigo: "VERSAO_FORMATO_INVALIDA" };
    if (doc.versao_formato > VERSAO_FORMATO) return { codigo: "VERSAO_FORMATO_FUTURA", versao: doc.versao_formato };
    if (doc.sistema != null && doc.sistema !== INFO.sistema) return { codigo: "OUTRO_SISTEMA" };
    for (const [campo, atual] of [["versao_banco", VERSAO_BANCO], ["versao_schema", VERSAO_SCHEMA]]) {
      if (doc[campo] == null) continue;
      if (!Number.isInteger(doc[campo]) || doc[campo] < 1) return { codigo: "CABECALHO_INVALIDO", campo };
      if (doc[campo] > atual) return { codigo: "DADOS_DE_VERSAO_FUTURA", campo, versao: doc[campo], atual };
    }
    if (!objeto(doc.tabelas)) return { codigo: "SEM_TABELAS" };
    if (doc.sha256 == null) return { codigo: "SEM_CHECKSUM" };
    if (typeof doc.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(doc.sha256)) return { codigo: "CHECKSUM_FORMATO" };
    return null;
  },
  async integridade(doc) { return (await sha256(canonico(doc.tabelas))) === doc.sha256 ? null : { codigo: "CHECKSUM_DIVERGENTE" }; },
  /** v1 já está no modelo atual: os registros seguem COMO ESTÃO (nada é convertido). */
  normalizar(doc) {
    return { tabelas: doc.tabelas, meta: { formato: "salaobackup-v1", versao_app: doc.versao_app, criado_em: doc.criado_em, origem: doc.origem,
      versao_banco: doc.versao_banco, versao_schema: doc.versao_schema, estado_dados: doc.estado_dados } };
  },
};

/** Adaptadores em ordem de detecção. Futuro: adaptador_9x (somente com evidência real). */
export const ADAPTADORES = [adaptadorV1];
export function detectar(doc) { return ADAPTADORES.find((a) => a.reconhece(doc)) || null; }
