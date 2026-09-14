import { describe, it, expect } from "vitest";
import { EventoRecebido } from "../../../../src/api/domain/evento/evento-recebido.js";

function novo() {
  return EventoRecebido.restaurar({
    id: 1,
    endpoint: "/webhooks/clint/agendamento",
    status: "recebido",
    erro: null,
    jobId: null,
  });
}

describe("EventoRecebido", () => {
  it("nasce recebido", () => {
    expect(novo().status).toBe("recebido");
  });

  it("marca processado", () => {
    const e = novo();
    e.marcarProcessado();
    expect(e.status).toBe("processado");
    expect(e.erro).toBeNull();
  });

  it("marca inválido guardando o motivo", () => {
    const e = novo();
    e.marcarInvalido("telefone ausente");
    expect(e.status).toBe("invalido");
    expect(e.erro).toBe("telefone ausente");
  });

  it("marca falha guardando o erro", () => {
    const e = novo();
    e.marcarFalha("MedX fora do ar");
    expect(e.status).toBe("falhou");
    expect(e.erro).toBe("MedX fora do ar");
  });

  it("associa o job da fila", () => {
    const e = novo();
    e.associarJob("job-1");
    expect(e.jobId).toBe("job-1");
  });

  it("limpa o erro ao reprocessar com sucesso", () => {
    const e = novo();
    e.marcarFalha("erro anterior");
    e.marcarProcessado();
    expect(e.erro).toBeNull();
  });
});
