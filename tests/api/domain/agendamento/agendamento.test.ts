import { describe, it, expect } from "vitest";
import { Agendamento, STATUS_MEDX_AGENDADO } from "../../../../src/api/domain/agendamento/agendamento.js";
import { PeriodoConsulta } from "../../../../src/api/domain/agendamento/periodo-consulta.js";
import { ErroDeDominio } from "../../../../src/api/domain/shared/erros.js";

const PERIODO = PeriodoConsulta.criar("2026-07-10T14:00:00", 30);
const INDICE_CONFIRMADO = 1;

function novo() {
  return Agendamento.iniciar({
    dealId: "deal-1",
    idPacienteMedx: 67890,
    idProfissionalMedx: 43013640,
    periodo: PERIODO,
  });
}

describe("ciclo de vida", () => {
  it("nasce em enviando, sem id do MedX", () => {
    const a = novo();
    expect(a.status).toBe("enviando");
    expect(a.idMedx).toBeNull();
    expect(a.jaFoiCriado).toBe(false);
  });

  it("registra a criação e passa para criado", () => {
    const a = novo();
    a.registrarCriacao(1275002478);
    expect(a.idMedx).toBe(1275002478);
    expect(a.status).toBe("criado");
    expect(a.jaFoiCriado).toBe(true);
  });

  it("reconhece uma tentativa interrompida", () => {
    expect(novo().tentativaInterrompida).toBe(true);
    const a = novo();
    a.registrarCriacao(1);
    expect(a.tentativaInterrompida).toBe(false);
  });

  it("adota um agendamento que já existia no MedX", () => {
    const a = novo();
    a.adotarExistente(999);
    expect(a.idMedx).toBe(999);
    expect(a.status).toBe("criado");
  });

  it("marca falha", () => {
    const a = novo();
    a.marcarFalha();
    expect(a.status).toBe("falhou");
  });

  it("rejeita registrar criação duas vezes", () => {
    const a = novo();
    a.registrarCriacao(1);
    expect(() => a.registrarCriacao(2)).toThrow(ErroDeDominio);
  });
});

describe("avaliarConfirmacao", () => {
  function criado() {
    const a = novo();
    a.registrarCriacao(1275002478);
    return a;
  }

  it("permite quando o estado no MedX bate com o agendado", () => {
    const r = criado().avaliarConfirmacao(
      { status: STATUS_MEDX_AGENDADO, inicio: "2026-07-10T14:00:00" },
      INDICE_CONFIRMADO
    );
    expect(r).toEqual({ permitido: true });
  });

  it("permite quando o MedX já está confirmado (reenvio do paciente)", () => {
    const r = criado().avaliarConfirmacao(
      { status: INDICE_CONFIRMADO, inicio: "2026-07-10T14:00:00" },
      INDICE_CONFIRMADO
    );
    expect(r.permitido).toBe(true);
  });

  it("recusa quando o horário mudou desde o lembrete", () => {
    const r = criado().avaliarConfirmacao(
      { status: STATUS_MEDX_AGENDADO, inicio: "2026-07-11T09:00:00" },
      INDICE_CONFIRMADO
    );
    expect(r).toEqual({ permitido: false, motivo: expect.stringMatching(/horário/i) });
  });

  it("recusa quando a consulta não está mais agendada", () => {
    const r = criado().avaliarConfirmacao(
      { status: 3, inicio: "2026-07-10T14:00:00" },
      INDICE_CONFIRMADO
    );
    expect(r).toEqual({ permitido: false, motivo: expect.stringMatching(/agendada/i) });
  });

  it("recusa quando o agendamento ainda não foi criado no MedX", () => {
    const r = novo().avaliarConfirmacao(
      { status: STATUS_MEDX_AGENDADO, inicio: "2026-07-10T14:00:00" },
      INDICE_CONFIRMADO
    );
    expect(r.permitido).toBe(false);
  });

  it("aceita o mesmo instante expresso em UTC", () => {
    const r = criado().avaliarConfirmacao(
      { status: STATUS_MEDX_AGENDADO, inicio: "2026-07-10T17:00:00Z" },
      INDICE_CONFIRMADO
    );
    expect(r.permitido).toBe(true);
  });
});

describe("confirmar", () => {
  it("passa para confirmado e guarda a última edição", () => {
    const a = novo();
    a.registrarCriacao(1);
    a.confirmar("2026-07-09T10:00:00");
    expect(a.status).toBe("confirmado");
    expect(a.jaFoiConfirmado).toBe(true);
    expect(a.ultimaEdicaoConhecida).toBe("2026-07-09T10:00:00");
  });

  it("recusa confirmar o que nunca foi criado", () => {
    expect(() => novo().confirmar("2026-07-09T10:00:00")).toThrow(ErroDeDominio);
  });

  it("marcarConflito leva para conflito", () => {
    const a = novo();
    a.registrarCriacao(1);
    a.marcarConflito();
    expect(a.status).toBe("conflito");
  });
});

describe("restaurar", () => {
  it("reconstrói o estado vindo da persistência", () => {
    const a = Agendamento.restaurar({
      dealId: "deal-1",
      idPacienteMedx: 67890,
      idProfissionalMedx: 43013640,
      periodo: PERIODO,
      idMedx: 1275002478,
      status: "confirmado",
      ultimaEdicaoConhecida: "2026-07-09T10:00:00",
    });
    expect(a.jaFoiConfirmado).toBe(true);
    expect(a.idMedx).toBe(1275002478);
  });
});
