import { describe, it, expect, vi } from "vitest";
import {
  envolverComAlertas,
  NOTIFICADOR_SILENCIOSO,
} from "../../../../src/api/infrastructure/observabilidade/alertas.js";
import { criarNotificadorEmail } from "../../../../src/api/infrastructure/observabilidade/notificador-email.js";

const loggerFalso = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe("criarNotificadorEmail", () => {
  it("envia para o destino configurado com assunto prefixado", async () => {
    const enviarEmail = vi.fn(async () => {});
    await criarNotificadorEmail({ enviarEmail, destino: "gestao@clinica.test" }).alertar(
      "job na dead letter",
      { deal_id: "d1" }
    );

    expect(enviarEmail).toHaveBeenCalledWith(
      "gestao@clinica.test",
      "[adapter-clint-medx] job na dead letter",
      expect.stringContaining("d1")
    );
  });
});

describe("NOTIFICADOR_SILENCIOSO", () => {
  it("não faz nada e resolve", async () => {
    await expect(NOTIFICADOR_SILENCIOSO.alertar("x", {})).resolves.toBeUndefined();
  });
});

describe("envolverComAlertas", () => {
  it("repassa info sem alertar", () => {
    const n = { alertar: vi.fn(async () => {}) };
    const base = loggerFalso();
    envolverComAlertas(base, n).info({ deal_id: "d1" }, "tudo certo");

    expect(base.info).toHaveBeenCalledWith({ deal_id: "d1" }, "tudo certo");
    expect(n.alertar).not.toHaveBeenCalled();
  });

  it("não alerta em warn comum", () => {
    const n = { alertar: vi.fn(async () => {}) };
    envolverComAlertas(loggerFalso(), n).warn({ deal_id: "d1" }, "aviso trivial");
    expect(n.alertar).not.toHaveBeenCalled();
  });

  it("alerta em warn marcado com alerta:true e ainda loga", async () => {
    const n = { alertar: vi.fn(async () => {}) };
    const base = loggerFalso();
    envolverComAlertas(base, n).warn({ alerta: true, deal_id: "d1" }, "confirmação recusada");

    await new Promise(resolve => setImmediate(resolve));

    expect(base.warn).toHaveBeenCalled();
    expect(n.alertar).toHaveBeenCalledWith("confirmação recusada", { alerta: true, deal_id: "d1" });
  });

  it("alerta em error marcado com alerta:true", async () => {
    const n = { alertar: vi.fn(async () => {}) };
    envolverComAlertas(loggerFalso(), n).error({ alerta: true }, "dead letter");

    await new Promise(resolve => setImmediate(resolve));

    expect(n.alertar).toHaveBeenCalled();
  });

  it("não deixa a falha do notificador derrubar o log", () => {
    const n = {
      alertar: vi.fn(async () => {
        throw new Error("SMTP fora do ar");
      }),
    };
    const base = loggerFalso();
    expect(() => envolverComAlertas(base, n).warn({ alerta: true }, "x")).not.toThrow();
    expect(base.warn).toHaveBeenCalled();
  });

  it("ignora objetos que não são registros", () => {
    const n = { alertar: vi.fn(async () => {}) };
    expect(() => envolverComAlertas(loggerFalso(), n).warn("string solta")).not.toThrow();
    expect(n.alertar).not.toHaveBeenCalled();
  });
});
