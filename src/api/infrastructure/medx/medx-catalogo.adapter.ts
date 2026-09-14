import type {
  CatalogoClinicoPort,
  TipoConsultaResolvido,
} from "../../application/ports/catalogo-clinico.port.js";
import type { MedxClient } from "./medx-http.client.js";
import type { MedxProfissional, MedxTipoAgendamento } from "./medx.tipos.js";

const TTL_PADRAO_MS = 6 * 60 * 60 * 1000;

function chave(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function criarCatalogoMedx(
  client: MedxClient,
  opcoes?: { ttlMs?: number; agora?: () => number }
): CatalogoClinicoPort {
  const ttl = opcoes?.ttlMs ?? TTL_PADRAO_MS;
  const agora = opcoes?.agora ?? Date.now;

  let profissionais: MedxProfissional[] = [];
  let tipos: MedxTipoAgendamento[] = [];
  let indiceConfirmado = -1;
  let carregadoEm = -Infinity;

  async function carregar(): Promise<void> {
    const [p, t, s] = await Promise.all([
      client.get<MedxProfissional[]>("/api/integration/financas/profissionais"),
      client.get<MedxTipoAgendamento[]>("/api/integration/agenda/tipos"),
      client.get<string[]>("/api/integration/agenda/status"),
    ]);

    profissionais = p;
    tipos = t;
    indiceConfirmado = s.findIndex((rotulo) => chave(rotulo).startsWith("confirm"));

    if (indiceConfirmado < 0) {
      throw new Error(
        `Nenhum rótulo de status corresponde a "Confirmado" nesta conta do MedX. ` +
          `Rótulos recebidos: ${JSON.stringify(s)}`
      );
    }

    carregadoEm = agora();
  }

  async function garantirCache(): Promise<void> {
    if (agora() - carregadoEm >= ttl) await carregar();
  }

  return {
    carregar,

    async resolverProfissional(valor: string | number): Promise<number> {
      if (typeof valor === "number") return valor;
      if (/^\d+$/.test(valor.trim())) return Number(valor.trim());

      await garantirCache();
      const alvo = chave(valor);
      const achado = profissionais.find(
        (p) => chave(p.NomeCompleto) === alvo || chave(p.UsuarioNome) === alvo
      );

      if (!achado) {
        throw new Error(`Profissional não encontrado no MedX: "${valor}"`);
      }
      return achado.IdDoUsuario;
    },

    async resolverTipoConsulta(valor: string | number): Promise<TipoConsultaResolvido> {
      await garantirCache();

      const ehNumero = typeof valor === "number" || /^\d+$/.test(String(valor).trim());
      const achado = ehNumero
        ? tipos.find((t) => t.IddoDiagnosticoQP === Number(valor))
        : tipos.find((t) => chave(t.DiagnosticoQP) === chave(String(valor)));

      if (!achado) {
        throw new Error(`Tipo de consulta não encontrado no MedX: "${valor}"`);
      }

      return {
        id: achado.IddoDiagnosticoQP,
        nome: achado.DiagnosticoQP,
        duracaoMinutos: achado.Tempo,
      };
    },

    indiceStatusConfirmado(): number {
      if (indiceConfirmado < 0) {
        throw new Error("Catálogo do MedX não foi inicializado — chame carregar() antes");
      }
      return indiceConfirmado;
    },
  };
}
