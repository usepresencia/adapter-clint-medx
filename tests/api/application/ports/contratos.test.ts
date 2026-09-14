import { describe, it, expect } from "vitest";
import type { AgendaMedicaPort, AgendamentoExterno } from "../../../../src/api/application/ports/agenda-medica.port.js";
import type { CadastroPacientePort } from "../../../../src/api/application/ports/cadastro-paciente.port.js";
import type { CatalogoClinicoPort } from "../../../../src/api/application/ports/catalogo-clinico.port.js";
import type { CrmPort } from "../../../../src/api/application/ports/crm.port.js";
import type { NotificadorPort } from "../../../../src/api/application/ports/notificador.port.js";

const EXTERNO: AgendamentoExterno = {
  id: 1275002478,
  idProfissional: 43013640,
  idPaciente: 67890,
  inicio: "2026-07-10T14:00:00",
  fim: "2026-07-10T14:30:00",
  descricao: "Consulta",
  status: 0,
  idTipoConsulta: 111,
  confirmacao: "",
  ultimaEdicao: "2026-07-09T10:00:00",
  bruto: {},
};

describe("contratos dos ports", () => {
  it("um dublê satisfaz AgendaMedicaPort", async () => {
    const porta: AgendaMedicaPort = {
      criar: async () => 1,
      obter: async () => EXTERNO,
      listarPorPaciente: async () => [EXTERNO],
      confirmar: async () => {},
    };
    expect(await porta.criar({
      idProfissional: 1, idPaciente: 1, inicio: "x", fim: "y", descricao: "z", idTipoConsulta: 1,
    })).toBe(1);
  });

  it("um dublê satisfaz os demais ports", async () => {
    const cadastro: CadastroPacientePort = {
      vincular: async () => ({ idPaciente: 1, matchConfiavel: true }),
      registrarCpf: async () => {},
    };
    const catalogo: CatalogoClinicoPort = {
      carregar: async () => {},
      resolverProfissional: async () => 1,
      resolverTipoConsulta: async () => ({ id: 1, nome: "Consulta", duracaoMinutos: 30 }),
      indiceStatusConfirmado: () => 1,
    };
    const crm: CrmPort = {
      gravarIdAgendamento: async () => {},
      notificarConfirmacao: async () => {},
      notificarReagendamento: async () => {},
      notificarCancelamento: async () => {},
      notificarConflito: async () => {},
    };
    const notificador: NotificadorPort = { alertar: async () => {} };

    expect(catalogo.indiceStatusConfirmado()).toBe(1);
    expect((await catalogo.resolverTipoConsulta("x")).duracaoMinutos).toBe(30);
    await expect(cadastro.registrarCpf(1, {} as never)).resolves.toBeUndefined();
    await expect(crm.notificarConflito("d", "m")).resolves.toBeUndefined();
    await expect(notificador.alertar("a", {})).resolves.toBeUndefined();
  });
});
