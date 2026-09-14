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
  const statusDo = (id: number): string =>
    (db.prepare("SELECT status FROM eventos_recebidos WHERE id = ?").get(id) as any).status;
  const erroDe = (id: number): string | null =>
    (db.prepare("SELECT erro FROM eventos_recebidos WHERE id = ?").get(id) as any).erro;

  return { deps, eventos, statusDo, erroDe };
}

describe("processarJob", () => {
  it("roteia job de agendamento para o caso de uso certo", async () => {
    const { deps, eventos } = montar();
    const e = eventos.registrar("/x", {});
    await processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any });

    expect(deps.agendarConsulta).toHaveBeenCalled();
    expect(deps.processarResposta).not.toHaveBeenCalled();
  });

  it("roteia job de resposta para o caso de uso certo", async () => {
    const { deps, eventos } = montar();
    const e = eventos.registrar("/x", {});
    await processarJob(deps as any, { tipo: "resposta", eventoId: e.id, comando: {} as any });

    expect(deps.processarResposta).toHaveBeenCalled();
    expect(deps.agendarConsulta).not.toHaveBeenCalled();
  });

  it("marca o evento como processado no sucesso", async () => {
    const { deps, eventos, statusDo } = montar();
    const e = eventos.registrar("/x", {});
    await processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any });
    expect(statusDo(e.id)).toBe("processado");
  });

  it("marca falhou com a mensagem e repropaga para o BullMQ tentar de novo", async () => {
    const { deps, eventos, statusDo, erroDe } = montar();
    deps.agendarConsulta = vi.fn(async () => {
      throw new Error("MedX fora do ar");
    });
    const e = eventos.registrar("/x", {});

    await expect(
      processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any })
    ).rejects.toThrow(/fora do ar/);

    expect(statusDo(e.id)).toBe("falhou");
    expect(erroDe(e.id)).toMatch(/fora do ar/);
  });

  it("repropaga ErroRateLimit para o worker aplicar o Retry-After", async () => {
    const { deps, eventos } = montar();
    deps.agendarConsulta = vi.fn(async () => {
      throw new ErroRateLimit(60);
    });
    const e = eventos.registrar("/x", {});

    await expect(
      processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any })
    ).rejects.toBeInstanceOf(ErroRateLimit);
  });

  it("registra rate limit como aviso, não como erro", async () => {
    const { deps, eventos } = montar();
    deps.agendarConsulta = vi.fn(async () => {
      throw new ErroRateLimit(60);
    });
    const e = eventos.registrar("/x", {});

    await expect(
      processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any })
    ).rejects.toThrow();

    expect(deps.logger.warn).toHaveBeenCalled();
    expect(deps.logger.error).not.toHaveBeenCalled();
  });
});
