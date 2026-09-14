import { describe, it, expect, vi } from "vitest";
import { criarAgendarConsulta } from "../../../../src/api/application/agendar-consulta/agendar-consulta.usecase.js";
import { abrirBanco } from "../../../../src/api/infrastructure/persistencia/sqlite/conexao.js";
import { criarAgendamentoRepositorio } from "../../../../src/api/infrastructure/persistencia/sqlite/agendamento.sqlite-repositorio.js";
import { criarCorrelacaoPacienteRepositorio } from "../../../../src/api/infrastructure/persistencia/sqlite/correlacao-paciente.sqlite-repositorio.js";
import { Agendamento } from "../../../../src/api/domain/agendamento/agendamento.js";
import { PeriodoConsulta } from "../../../../src/api/domain/agendamento/periodo-consulta.js";
import { Telefone } from "../../../../src/api/domain/paciente/telefone.js";
import type { AgendamentoExterno } from "../../../../src/api/application/ports/agenda-medica.port.js";

const COMANDO = {
  dealId: "deal-1",
  nome: "Maria Silva",
  telefone: "+55 11 99999-8888",
  dataNascimento: "1990-05-20",
  dataHora: "2026-07-10T14:00:00",
  profissional: "Leize Ferreira",
  tipoConsulta: "Consulta de Rotina",
  cpf: "529.982.247-25",
};

function externo(parcial: Partial<AgendamentoExterno> = {}): AgendamentoExterno {
  return {
    id: 999,
    idProfissional: 43013640,
    idPaciente: 67890,
    inicio: "2026-07-10T14:00:00",
    fim: "2026-07-10T14:30:00",
    descricao: "",
    status: 0,
    idTipoConsulta: 111,
    confirmacao: "",
    ultimaEdicao: "2026-07-09T10:00:00",
    bruto: {},
    ...parcial,
  };
}

function montar() {
  const db = abrirBanco(":memory:");
  const agendamentos = criarAgendamentoRepositorio(db);
  const correlacoes = criarCorrelacaoPacienteRepositorio(db);

  const deps = {
    agendamentos,
    correlacoes,
    cadastro: {
      vincular: vi.fn(async () => ({ idPaciente: 67890, matchConfiavel: true })),
      registrarCpf: vi.fn(async () => {}),
    },
    agenda: {
      criar: vi.fn(async () => 1275002478),
      obter: vi.fn(async () => externo()),
      listarPorPaciente: vi.fn(async () => [] as AgendamentoExterno[]),
      confirmar: vi.fn(async () => {}),
    },
    catalogo: {
      carregar: vi.fn(async () => {}),
      resolverProfissional: vi.fn(async () => 43013640),
      resolverTipoConsulta: vi.fn(async () => ({ id: 111, nome: "Consulta de Rotina", duracaoMinutos: 30 })),
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

  return { deps, agendamentos, correlacoes, executar: criarAgendarConsulta(deps as any) };
}

describe("caminho feliz", () => {
  it("cria o agendamento com início, fim e descrição corretos", async () => {
    const { deps, executar } = montar();
    await executar(COMANDO);

    expect(deps.agenda.criar).toHaveBeenCalledWith({
      idProfissional: 43013640,
      idPaciente: 67890,
      inicio: "2026-07-10T14:00:00",
      fim: "2026-07-10T14:30:00",
      descricao: "Consulta de Rotina — Maria Silva",
      idTipoConsulta: 111,
    });
  });

  it("devolve o id ao CRM", async () => {
    const { deps, executar } = montar();
    await executar(COMANDO);
    expect(deps.crm.gravarIdAgendamento).toHaveBeenCalledWith("deal-1", 1275002478);
  });

  it("persiste o agendamento como criado", async () => {
    const { executar, agendamentos } = montar();
    await executar(COMANDO);
    const salvo = agendamentos.buscarPorDeal("deal-1")!;
    expect(salvo.status).toBe("criado");
    expect(salvo.idMedx).toBe(1275002478);
  });

  it("converte o horário para o fuso da clínica", async () => {
    const { deps, executar } = montar();
    await executar({ ...COMANDO, dataHora: "2026-07-10T17:00:00Z" });
    expect(deps.agenda.criar).toHaveBeenCalledWith(
      expect.objectContaining({ inicio: "2026-07-10T14:00:00" })
    );
  });
});

describe("idempotência", () => {
  it("não chama o MedX duas vezes para o mesmo deal_id", async () => {
    const { deps, executar } = montar();
    await executar(COMANDO);
    await executar(COMANDO);
    expect(deps.agenda.criar).toHaveBeenCalledTimes(1);
  });

  it("grava a intenção antes de chamar o MedX", async () => {
    const { deps, agendamentos } = montar();
    const observado: string[] = [];
    deps.agenda.criar = vi.fn(async () => {
      observado.push(agendamentos.buscarPorDeal("deal-1")!.status);
      return 1275002478;
    });

    await criarAgendarConsulta(deps as any)(COMANDO);
    expect(observado).toEqual(["enviando"]);
  });

  it("adota o agendamento órfão de uma tentativa interrompida", async () => {
    const { deps, agendamentos } = montar();
    agendamentos.salvar(
      Agendamento.iniciar({
        dealId: "deal-1",
        idPacienteMedx: 67890,
        idProfissionalMedx: 43013640,
        periodo: PeriodoConsulta.criar("2026-07-10T14:00:00", 30),
      })
    );
    deps.agenda.listarPorPaciente = vi.fn(async () => [externo({ id: 555 })]);

    await criarAgendarConsulta(deps as any)(COMANDO);

    expect(deps.agenda.criar).not.toHaveBeenCalled();
    expect(deps.crm.gravarIdAgendamento).toHaveBeenCalledWith("deal-1", 555);
  });

  it("cria normalmente quando não há órfão correspondente", async () => {
    const { deps, agendamentos } = montar();
    agendamentos.salvar(
      Agendamento.iniciar({
        dealId: "deal-1",
        idPacienteMedx: 67890,
        idProfissionalMedx: 43013640,
        periodo: PeriodoConsulta.criar("2026-07-10T14:00:00", 30),
      })
    );
    deps.agenda.listarPorPaciente = vi.fn(async () => [externo({ inicio: "2026-07-11T09:00:00" })]);

    await criarAgendarConsulta(deps as any)(COMANDO);
    expect(deps.agenda.criar).toHaveBeenCalled();
  });
});

describe("identidade do paciente", () => {
  it("reaproveita a correlação em cache sem chamar o vínculo de novo", async () => {
    const { deps, executar } = montar();
    await executar(COMANDO);
    await executar({ ...COMANDO, dealId: "deal-2" });
    expect(deps.cadastro.vincular).toHaveBeenCalledTimes(1);
  });

  it("envia o telefone como value object para o port", async () => {
    const { deps, executar } = montar();
    await executar(COMANDO);
    const enviado = (deps.cadastro.vincular as any).mock.calls[0][0];
    expect(enviado.telefone).toBeInstanceOf(Telefone);
    expect(enviado.telefone.nacional).toBe("11999998888");
  });

  it("registra match duvidoso com alerta, sem interromper o agendamento", async () => {
    const { deps, correlacoes } = montar();
    deps.cadastro.vincular = vi.fn(async () => ({ idPaciente: 67890, matchConfiavel: false }));

    await criarAgendarConsulta(deps as any)(COMANDO);

    expect(correlacoes.buscarPorTelefone(Telefone.criar("11999998888"))!.exigeRevisao).toBe(true);
    expect(deps.crm.gravarIdAgendamento).toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ alerta: true }),
      expect.any(String)
    );
  });
});

describe("CPF", () => {
  it("enriquece a ficha quando o CPF é válido", async () => {
    const { deps, executar } = montar();
    await executar(COMANDO);
    expect(deps.cadastro.registrarCpf).toHaveBeenCalledWith(67890, expect.anything());
  });

  it("ignora CPF inválido sem quebrar o agendamento", async () => {
    const { deps } = montar();
    await criarAgendarConsulta(deps as any)({ ...COMANDO, cpf: "11111111111" });
    expect(deps.cadastro.registrarCpf).not.toHaveBeenCalled();
    expect(deps.crm.gravarIdAgendamento).toHaveBeenCalled();
  });

  it("não chama registrarCpf quando o CPF não veio", async () => {
    const { deps } = montar();
    const { cpf, ...semCpf } = COMANDO;
    await criarAgendarConsulta(deps as any)(semCpf);
    expect(deps.cadastro.registrarCpf).not.toHaveBeenCalled();
  });

  it("falha ao gravar o CPF não derruba o agendamento", async () => {
    const { deps } = montar();
    deps.cadastro.registrarCpf = vi.fn(async () => {
      throw new Error("MedX recusou o CPF");
    });
    await expect(criarAgendarConsulta(deps as any)(COMANDO)).resolves.toBeUndefined();
    expect(deps.crm.gravarIdAgendamento).toHaveBeenCalled();
  });
});

describe("falhas", () => {
  it("marca falhou e propaga quando o MedX recusa a criação", async () => {
    const { deps, agendamentos } = montar();
    deps.agenda.criar = vi.fn(async () => {
      throw new Error("MedX fora do ar");
    });

    await expect(criarAgendarConsulta(deps as any)(COMANDO)).rejects.toThrow(/fora do ar/);
    expect(agendamentos.buscarPorDeal("deal-1")!.status).toBe("falhou");
  });

  it("propaga telefone inválido como erro de domínio", async () => {
    const { executar } = montar();
    await expect(executar({ ...COMANDO, telefone: "123" })).rejects.toThrow(/DDD/);
  });
});
