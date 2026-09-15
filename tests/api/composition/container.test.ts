import { describe, it, expect, vi } from "vitest";
import { escolherNotificador } from "../../../src/api/composition/container.js";
import { NOTIFICADOR_SILENCIOSO } from "../../../src/api/infrastructure/observabilidade/alertas.js";

const base = {
  ALERTA_EMAIL_ORIGEM: "adapter@localhost",
} as any;

describe("escolherNotificador", () => {
  it("usa o silencioso quando SMTP não está configurado", () => {
    expect(escolherNotificador(base)).toBe(NOTIFICADOR_SILENCIOSO);
  });

  it("usa o silencioso quando falta o destino", () => {
    expect(escolherNotificador({ ...base, SMTP_URL: "smtp://x" })).toBe(NOTIFICADOR_SILENCIOSO);
  });

  it("monta o notificador de e-mail quando SMTP e destino existem", () => {
    const n = escolherNotificador({
      ...base,
      SMTP_URL: "smtp://x",
      ALERTA_EMAIL_DESTINO: "gestao@clinica.test",
    });
    expect(n).not.toBe(NOTIFICADOR_SILENCIOSO);
    expect(typeof n.alertar).toBe("function");
  });
});
