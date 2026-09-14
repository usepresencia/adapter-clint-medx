import { describe, it, expect } from "vitest";
import { criarCatalogoMedx } from "../../../../src/api/infrastructure/medx/medx-catalogo.adapter.js";
import type { MedxClient } from "../../../../src/api/infrastructure/medx/medx-http.client.js";

const PROFISSIONAIS = [
  { IdDoUsuario: 43013640, NomeCompleto: "Leize Ferreira", UsuarioNome: "leize", Ativo: true, Agenda: true, LinkAgendamentoOnline: "" },
];
const TIPOS = [{ IddoDiagnosticoQP: 111, DiagnosticoQP: "Consulta de Rotina", Tempo: 30 }];
const STATUS = ["Agendado", "Confirmado", "Chegou", "Cancelado"];

function clientFalso(status: string[] = STATUS) {
  const chamadas: string[] = [];
  const client: MedxClient = {
    async get<T>(caminho: string): Promise<T> {
      chamadas.push(caminho);
      if (caminho.endsWith("/status")) return status as T;
      if (caminho.endsWith("/tipos")) return TIPOS as T;
      if (caminho.endsWith("/profissionais")) return PROFISSIONAIS as T;
      throw new Error(`caminho inesperado: ${caminho}`);
    },
    post: async <T>() => ({}) as T,
    put: async <T>() => ({}) as T,
  };
  return { client, chamadas };
}

describe("índice de status", () => {
  it("é descoberto, não codificado", async () => {
    const c = criarCatalogoMedx(clientFalso().client);
    await c.carregar();
    expect(c.indiceStatusConfirmado()).toBe(1);
  });

  it("acompanha a reordenação dos rótulos da conta", async () => {
    const c = criarCatalogoMedx(clientFalso(["Agendado", "Chegou", "Cancelado", "Confirmado"]).client);
    await c.carregar();
    expect(c.indiceStatusConfirmado()).toBe(3);
  });

  it("ignora acento e caixa ao procurar o rótulo", async () => {
    const c = criarCatalogoMedx(clientFalso(["Agendado", "CONFIRMADO"]).client);
    await c.carregar();
    expect(c.indiceStatusConfirmado()).toBe(1);
  });

  it("não confunde 'Confirmação Pendente' com 'Confirmado'", async () => {
    const c = criarCatalogoMedx(
      clientFalso(["Agendado", "Confirmação Pendente", "Confirmado", "Cancelado"]).client
    );
    await c.carregar();
    expect(c.indiceStatusConfirmado()).toBe(2);
  });

  it("falha no carregamento quando não existe rótulo de confirmação", async () => {
    const c = criarCatalogoMedx(clientFalso(["Agendado", "Chegou", "Cancelado"]).client);
    await expect(c.carregar()).rejects.toThrow(/Confirmado/);
  });

  it("erra com mensagem clara se consultado antes de carregar", () => {
    expect(() => criarCatalogoMedx(clientFalso().client).indiceStatusConfirmado()).toThrow(/carregar/);
  });
});

describe("resolução de profissional e tipo", () => {
  it("resolve profissional por nome completo", async () => {
    const c = criarCatalogoMedx(clientFalso().client);
    await c.carregar();
    expect(await c.resolverProfissional("Leize Ferreira")).toBe(43013640);
  });

  it("resolve ignorando caixa, acento e espaços", async () => {
    const c = criarCatalogoMedx(clientFalso().client);
    await c.carregar();
    expect(await c.resolverProfissional("  leize ferreira ")).toBe(43013640);
  });

  it("aceita o id numérico direto sem nova consulta", async () => {
    const { client, chamadas } = clientFalso();
    const c = criarCatalogoMedx(client);
    await c.carregar();
    chamadas.length = 0;
    expect(await c.resolverProfissional(43013640)).toBe(43013640);
    expect(chamadas).toHaveLength(0);
  });

  it("resolve tipo devolvendo id, nome e duração", async () => {
    const c = criarCatalogoMedx(clientFalso().client);
    await c.carregar();
    expect(await c.resolverTipoConsulta("Consulta de Rotina")).toEqual({
      id: 111,
      nome: "Consulta de Rotina",
      duracaoMinutos: 30,
    });
  });

  it("erra com mensagem útil quando o profissional não existe", async () => {
    const c = criarCatalogoMedx(clientFalso().client);
    await c.carregar();
    await expect(c.resolverProfissional("Fulano")).rejects.toThrow(/Fulano/);
  });

  it("revalida o cache depois do TTL", async () => {
    let agora = 0;
    const { client, chamadas } = clientFalso();
    const c = criarCatalogoMedx(client, { ttlMs: 1000, agora: () => agora });
    await c.carregar();
    const antes = chamadas.length;
    agora = 2000;
    await c.resolverProfissional("Leize Ferreira");
    expect(chamadas.length).toBeGreaterThan(antes);
  });
});
