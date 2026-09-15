import { describe, it, expect, vi } from "vitest";
import { processarJob } from "../../../../src/api/infrastructure/fila/processador.js";
import { LIMITER, OPCOES_JOB } from "../../../../src/api/infrastructure/fila/fila.js";
import { ErroRateLimit } from "../../../../src/api/infrastructure/medx/medx.erros.js";
import { abrirBanco } from "../../../../src/api/infrastructure/persistencia/sqlite/conexao.js";
import { criarEventoRepositorio } from "../../../../src/api/infrastructure/persistencia/sqlite/evento.sqlite-repositorio.js";

describe("política da fila", () => {
  it("respeita o teto de 30 req/min do MedX com margem", () => {
    expect(LIMITER.max).toBeLessThan(30);
    expect(LIMITER.duration).toBe(60_000);
  });

  it("usa backoff exponencial com pelo menos 5 tentativas", () => {
    expect(OPCOES_JOB.attempts).toBeGreaterThanOrEqual(5);
    expect(OPCOES_JOB.backoff.type).toBe("exponential");
  });

  it("não descarta jobs que falharam, para permitir inspeção", () => {
    expect(OPCOES_JOB.removeOnFail).toBe(false);
  });
});

function montar() {
  const db = abrirBanco(":memory:");
  const eventos = criarEventoRepositorio(db);
  const deps = {
    eventos,
    agendarConsulta: vi.fn(async () => {}),
    processarResposta: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const worker = { rateLimit: vi.fn(async () => {}) };
  const statusDo = (id: number): string =>
    (db.prepare("SELECT status FROM eventos_recebidos WHERE id = ?").get(id) as any).status;
  const erroDe = (id: number): string | null =>
    (db.prepare("SELECT erro FROM eventos_recebidos WHERE id = ?").get(id) as any).erro;

  return { deps, worker, eventos, statusDo, erroDe };
}

describe("processarJob", () => {
  it("roteia job de agendamento para o caso de uso certo", async () => {
    const { deps, worker, eventos } = montar();
    const e = eventos.registrar("/x", {});
    await processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any }, worker as any);

    expect(deps.agendarConsulta).toHaveBeenCalled();
    expect(deps.processarResposta).not.toHaveBeenCalled();
  });

  it("roteia job de resposta para o caso de uso certo", async () => {
    const { deps, worker, eventos } = montar();
    const e = eventos.registrar("/x", {});
    await processarJob(deps as any, { tipo: "resposta", eventoId: e.id, comando: {} as any }, worker as any);

    expect(deps.processarResposta).toHaveBeenCalled();
    expect(deps.agendarConsulta).not.toHaveBeenCalled();
  });

  it("marca o evento como processado no sucesso", async () => {
    const { deps, worker, eventos, statusDo } = montar();
    const e = eventos.registrar("/x", {});
    await processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any }, worker as any);
    expect(statusDo(e.id)).toBe("processado");
  });

  it("marca falhou com a mensagem e repropaga para o BullMQ tentar de novo", async () => {
    const { deps, worker, eventos, statusDo, erroDe } = montar();
    deps.agendarConsulta = vi.fn(async () => {
      throw new Error("MedX fora do ar");
    });
    const e = eventos.registrar("/x", {});

    await expect(
      processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any }, worker as any)
    ).rejects.toThrow(/fora do ar/);

    expect(statusDo(e.id)).toBe("falhou");
    expect(erroDe(e.id)).toMatch(/fora do ar/);
  });

  it("em ErroRateLimit, aplica o rate limit no worker e NÃO conta como falha do job", async () => {
    const { deps, worker, eventos, statusDo, erroDe } = montar();
    deps.agendarConsulta = vi.fn(async () => {
      throw new ErroRateLimit(60);
    });
    const e = eventos.registrar("/x", {});

    await expect(
      processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any }, worker as any)
    ).rejects.toThrow();

    // worker.rateLimit é chamado com os milissegundos corretos (60s -> 60000ms).
    expect(worker.rateLimit).toHaveBeenCalledWith(60_000);

    // Não é uma falha real: o evento não é marcado como falhou nem grava erro,
    // para não poluir a auditoria com algo que vai ser reprocessado sem contar tentativa.
    expect(statusDo(e.id)).not.toBe("falhou");
    expect(erroDe(e.id)).toBeNull();
  });

  it("registra rate limit como aviso, não como erro", async () => {
    const { deps, worker, eventos } = montar();
    deps.agendarConsulta = vi.fn(async () => {
      throw new ErroRateLimit(60);
    });
    const e = eventos.registrar("/x", {});

    await expect(
      processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any }, worker as any)
    ).rejects.toThrow();

    expect(deps.logger.warn).toHaveBeenCalled();
    expect(deps.logger.error).not.toHaveBeenCalled();
  });
});
