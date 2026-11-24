import { sessao } from "./database.js";
// Permissões aplicadas na CAMADA DE DADOS (e também na navegação). Em app 100% local isto protege contra uso casual;
// quem controla o aparelho e domina as ferramentas do navegador pode contorná-lo (veja a documentação).
const PERFIS = {
  admin: "*",
  recepcao: ["clientes.ler", "clientes.gravar", "agenda.ler", "agenda.gravar", "pagamentos.gravar", "servicos.ler"],
  funcionario: ["clientes.ler", "agenda.ler", "agenda.andamento"],
};
export function pode(perm, perfil = sessao.usuario?.perfil) {
  const p = PERFIS[perfil]; if (!p) return false; return p === "*" || p.includes(perm);
}
export function exigir(perm) { if (!pode(perm)) throw new Error("Seu perfil não tem permissão para esta ação."); }
