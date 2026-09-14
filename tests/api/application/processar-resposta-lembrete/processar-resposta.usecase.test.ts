import { describe, it, expect, vi } from "vitest";
import { criarProcessarResposta } from "../../../../src/api/application/processar-resposta-lembrete/processar-resposta.usecase.js";
import { abrirBanco } from "../../../../src/api/infrastructure/persistencia/sqlite/conexao.js";
import { criarAgendamentoRepositorio } from "../../../../src/api/infrastructure/persistencia/sqlite/agendamento.sqlite-repositorio.js";
import { Agendamento } from "../../../../src/api/domain/agendamento/agendamento.js";
import { PeriodoConsulta } from "../../../../src/api/domain/agendamento/periodo-consulta.js";
import type { AgendamentoExterno } from "../../../../src/api/application/ports/agenda-medica.port.js";

function externo(parcial: Partial<AgendamentoExterno> = {}): AgendamentoExterno {
  return {
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
    ...parcial,
  };
}

function montar(noMedx: AgendamentoExterno = externo(), comRegistro = true) {
  const db = abrirBanco(":memory:");
  const agendamentos = criarAgendamentoRepositorio(db);

  if (comRegistro) {
    const a = Agendamento.iniciar({
      dealId: "deal-1",
      idPacienteMedx: 67890,
      idProfissionalMedx: 43013640,
      periodo: PeriodoConsulta.criar("2026-07-10T14:00:00", 30),
    });
    a.registrarCriacao(1275002478);
    agendamentos.salvar(a);
  }

  const deps = {
    agendamentos,
    agenda: {
      criar: vi.fn(async () => 0),
      obter: vi.fn(async () => noMedx),
      listarPorPaciente: vi.fn(async () => [] as AgendamentoExterno[]),
      confirmar: vi.fn(async () => {}),
    },
    catalogo: {
      carregar: vi.fn(async () => {}),
      resolverProfissional: vi.fn(async () => 0),
      resolverTipoConsulta: vi.fn(async () => ({ id: 0, nome: "", duracaoMinutos: 30 })),
      indiceStatusConfirmado: () => 1,
    },
    crm: {
      gravarIdAgendamento: vi.fn(async () => {}),
      notificarConfirmacao: vi.fn(async () => {}),
      notificarReagendamento: vi.fn(async () => {}),
      notificarCancelamento: vi.fn(async () => {}),
      notificarConflito: vi.fn(async () => {}),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  return { deps, agendamentos, executar: criarProcessarResposta(deps as any) };
}

const CONFIRMAR = { dealId: "deal-1", idAgendamentoMedx: 1275002478, resposta: "confirmar" };

describe("confirmar", () => {
  it("chama o port com o índice descoberto", async () => {
    const { deps, executar } = montar();
    await executar(CONFIRMAR);
    expect(deps.agenda.confirmar).toHaveBeenCalledWith(expect.objectContaining({ id: 1275002478 }), 1);
  });

  it("avisa o CRM da confirmação", async () => {
    const { deps, executar } = montar();
    await executar(CONFIRMAR);
    expect(deps.crm.notificarConfirmacao).toHaveBeenCalledWith("deal-1");
  });

  it("persiste como confirmado com a última edição", async () => {
    const { executar, agendamentos } = montar();
    await executar(CONFIRMAR);
    const salvo = agendamentos.buscarPorDeal("deal-1")!;
    expect(salvo.status).toBe("confirmado");
    expect(salvo.ultimaEdicaoConhecida).toBe("2026-07-09T10:00:00");
  });

  it("aceita reenvio quando o MedX já está confirmado", async () => {
    const { deps, executar } = montar(externo({ status: 1 }));
    await executar(CONFIRMAR);
    expect(deps.agenda.confirmar).toHaveBeenCalled();
  });

  it("é idempotente: não reescreve o que já confirmamos", async () => {
    const { deps, executar, agendamentos } = montar();
    await executar(CONFIRMAR);
    (deps.agenda.confirmar as any).mockClear();
    await executar(CONFIRMAR);
    expect(deps.agenda.confirmar).not.toHaveBeenCalled();
    expect(agendamentos.buscarPorDeal("deal-1")!.status).toBe("confirmado");
  });

  it("normaliza a resposta com caixa diferente", async () => {
    const { deps, executar } = montar();
    await executar({ ...CONFIRMAR, resposta: "CONFIRMAR" });
    expect(deps.agenda.confirmar).toHaveBeenCalled();
  });
});

describe("recusas", () => {
  it("recusa quando o horário mudou desde o lembrete", async () => {
    const { deps, executar, agendamentos } = montar(externo({ inicio: "2026-07-11T09:00:00" }));
    await executar(CONFIRMAR);

    expect(deps.agenda.confirmar).not.toHaveBeenCalled();
    expect(deps.crm.notificarConflito).toHaveBeenCalledWith("deal-1", expect.stringMatching(/horário/i));
    expect(agendamentos.buscarPorDeal("deal-1")!.status).toBe("conflito");
  });

  it("recusa quando a consulta não está mais agendada", async () => {
    const { deps, executar } = montar(externo({ status: 3 }));
    await executar(CONFIRMAR);
    expect(deps.agenda.confirmar).not.toHaveBeenCalled();
    expect(deps.crm.notificarConflito).toHaveBeenCalled();
  });

  it("alerta ao recusar", async () => {
    const { deps, executar } = montar(externo({ status: 3 }));
    await executar(CONFIRMAR);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ alerta: true }),
      expect.any(String)
    );
  });

  it("recusa quando o adapter não conhece o agendamento", async () => {
    const { deps, executar } = montar(externo(), false);
    await executar(CONFIRMAR);
    expect(deps.agenda.confirmar).not.toHaveBeenCalled();
    expect(deps.crm.notificarConflito).toHaveBeenCalled();
  });

  it("rejeita resposta fora das três opções", async () => {
    const { executar } = montar();
    await expect(executar({ ...CONFIRMAR, resposta: "talvez" })).rejects.toThrow(/talvez/);
  });
});

describe("reagendar e cancelar", () => {
  it.each([
    ["reagendar", "notificarReagendamento"],
    ["cancelar", "notificarCancelamento"],
  ])("%s só avisa o CRM, sem tocar no MedX", async (resposta, metodo) => {
    const { deps, executar } = montar();
    await executar({ ...CONFIRMAR, resposta });

    expect(deps.agenda.obter).not.toHaveBeenCalled();
    expect(deps.agenda.confirmar).not.toHaveBeenCalled();
    expect((deps.crm as any)[metodo]).toHaveBeenCalledWith("deal-1");
  });
});
