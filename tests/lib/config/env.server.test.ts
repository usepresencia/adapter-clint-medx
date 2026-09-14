import { describe, it, expect } from "vitest";
import { carregarEnv } from "../../../lib/config/env.server.js";

const base = {
  ADAPTER_SECRET: "segredo",
  MEDX_INTEGRATION_TOKEN: "token-medx",
  CLINT_WEBHOOK_AGENDAMENTO_URL: "https://clint.example/a",
  CLINT_WEBHOOK_NOTIFICACAO_URL: "https://clint.example/n",
};

describe("carregarEnv", () => {
  it("aplica os valores padrão quando as variáveis opcionais faltam", () => {
    const env = carregarEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.MEDX_HOST).toBe("https://integracao-app.medx.med.br");
    expect(env.RETENCAO_DIAS).toBe(90);
    expect(env.ALERTA_EMAIL_ORIGEM).toBe("adapter@localhost");
  });

  it("rejeita configuração sem o segredo do adapter", () => {
    const { ADAPTER_SECRET, ...semSegredo } = base;
    expect(() => carregarEnv(semSegredo)).toThrow(/ADAPTER_SECRET/);
  });

  it("converte PORT para número", () => {
    expect(carregarEnv({ ...base, PORT: "8080" }).PORT).toBe(8080);
  });

  it("aceita SMTP e Bull Board ausentes, deixando-os indefinidos", () => {
    const env = carregarEnv(base);
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.BULLBOARD_USUARIO).toBeUndefined();
  });
});
