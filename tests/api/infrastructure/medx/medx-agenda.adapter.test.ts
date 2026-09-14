import { describe, it, expect } from "vitest";
import {
  criarAgendaMedx,
  CONFIRMACAO_LITERAL,
} from "../../../../src/api/infrastructure/medx/medx-agenda.adapter.js";
import type { MedxClient } from "../../../../src/api/infrastructure/medx/medx-http.client.js";
import type { MedxAgendamento } from "../../../../src/api/infrastructure/medx/medx.tipos.js";

const CRU: MedxAgendamento & { CampoQueNaoModelamos: string } = {
  Id_do_Agendamento: 1275002478,
  Id_do_Usuario: 43013640,
  Inicio: "2026-07-10T14:00:00",
  Final: "2026-07-10T14:30:00",
  Descricao: "Consulta de Rotina — Maria Silva",
  Status: 0,
  Vinculado_a: 30094605,
  Id_do_TipoConsulta: 111,
  Confirmacao: "",
  LastEditDate: "2026-07-09T10:00:00",
  CampoQueNaoModelamos: "precisa sobreviver ao PUT",
};

function clientFalso(resposta: unknown) {
  const enviados: Array<{ caminho: string; corpo?: unknown }> = [];
  const client: MedxClient = {
    get: async <T>(caminho: string) => {
      enviados.push({ caminho });
      return resposta as T;
    },
    post: async <T>(caminho: string, corpo: unknown) => {
      enviados.push({ caminho, corpo });
      return resposta as T;
    },
    put: async <T>(caminho: string, corpo: unknown) => {
      enviados.push({ caminho, corpo });
      return "Agendamento atualizado com sucesso." as T;
    },
  };
  return { client, enviados };
}

const CRIACAO = {
  idProfissional: 43013640,
  idPaciente: 30094605,
  inicio: "2026-07-10T14:00:00",
  fim: "2026-07-10T14:30:00",
  descricao: "Consulta de Rotina — Maria Silva",
  idTipoConsulta: 111,
};

describe("criar", () => {
  it("devolve o inteiro que o MedX retorna", async () => {
    const { client } = clientFalso(1275002478);
    expect(await criarAgendaMedx(client).criar(CRIACAO)).toBe(1275002478);
  });

  it("mapeia para os nomes exatos da API e nasce com Status 0", async () => {
    const { client, enviados } = clientFalso(1);
    await criarAgendaMedx(client).criar(CRIACAO);

    expect(enviados[0]).toEqual({
      caminho: "/api/integration/agenda/agendamentos",
      corpo: {
        Id_do_Usuario: 43013640,
        Inicio: "2026-07-10T14:00:00",
        Final: "2026-07-10T14:30:00",
        Descricao: "Consulta de Rotina — Maria Silva",
        Status: 0,
        Vinculado_a: 30094605,
        Id_do_TipoConsulta: 111,
      },
    });
  });

  it("rejeita retorno que não é um id válido", async () => {
    const { client } = clientFalso("erro qualquer");
    await expect(criarAgendaMedx(client).criar(CRIACAO)).rejects.toThrow(/id/i);
  });
});

describe("obter", () => {
  it("desembrulha o array que a API devolve e traduz para o port", async () => {
    const { client } = clientFalso([CRU]);
    const externo = await criarAgendaMedx(client).obter(1275002478);

    expect(externo.id).toBe(1275002478);
    expect(externo.idProfissional).toBe(43013640);
    expect(externo.idPaciente).toBe(30094605);
    expect(externo.inicio).toBe("2026-07-10T14:00:00");
    expect(externo.ultimaEdicao).toBe("2026-07-09T10:00:00");
  });

  it("guarda o payload cru inteiro em bruto", async () => {
    const { client } = clientFalso([CRU]);
    const externo = await criarAgendaMedx(client).obter(1275002478);
    expect((externo.bruto as any).CampoQueNaoModelamos).toBe("precisa sobreviver ao PUT");
  });

  it("erra quando o agendamento não existe", async () => {
    const { client } = clientFalso([]);
    await expect(criarAgendaMedx(client).obter(999)).rejects.toThrow(/999/);
  });
});

describe("confirmar", () => {
  it("envia a string literal exigida e o índice recebido", async () => {
    const { client, enviados } = clientFalso([CRU]);
    const agenda = criarAgendaMedx(client);
    const externo = await agenda.obter(1275002478);
    enviados.length = 0;

    await agenda.confirmar(externo, 1);

    const corpo = enviados[0]!.corpo as Record<string, unknown>;
    expect(enviados[0]!.caminho).toBe("/api/integration/agenda/agendamentos");
    expect(corpo.Status).toBe(1);
    expect(corpo.Confirmacao).toBe(CONFIRMACAO_LITERAL);
    expect(corpo.Confirmacao).toBe("Mensagem Salva com Sucesso");
  });

  it("preserva os campos que o port não modela", async () => {
    const { client, enviados } = clientFalso([CRU]);
    const agenda = criarAgendaMedx(client);
    const externo = await agenda.obter(1275002478);
    enviados.length = 0;

    await agenda.confirmar(externo, 1);

    expect((enviados[0]!.corpo as any).CampoQueNaoModelamos).toBe("precisa sobreviver ao PUT");
  });

  it("envia o objeto completo que o PUT exige", async () => {
    const { client, enviados } = clientFalso([CRU]);
    const agenda = criarAgendaMedx(client);
    const externo = await agenda.obter(1275002478);
    enviados.length = 0;

    await agenda.confirmar(externo, 1);

    const corpo = enviados[0]!.corpo as Record<string, unknown>;
    for (const campo of [
      "Id_do_Agendamento", "Id_do_Usuario", "Inicio", "Final",
      "Descricao", "Status", "Vinculado_a", "Id_do_TipoConsulta",
    ]) {
      expect(corpo).toHaveProperty(campo);
    }
  });
});

describe("listarPorPaciente", () => {
  it("traduz cada item para o port", async () => {
    const { client } = clientFalso([CRU]);
    const lista = await criarAgendaMedx(client).listarPorPaciente(30094605);
    expect(lista).toHaveLength(1);
    expect(lista[0]!.id).toBe(1275002478);
  });

  it("devolve lista vazia quando a API não retorna array", async () => {
    const { client } = clientFalso(null);
    expect(await criarAgendaMedx(client).listarPorPaciente(1)).toEqual([]);
  });
});
