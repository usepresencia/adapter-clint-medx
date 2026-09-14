import { describe, it, expect, vi, afterEach } from "vitest";
import { criarCrmWebhookClint } from "../../../../src/api/infrastructure/clint/clint-webhook.adapter.js";

afterEach(() => vi.restoreAllMocks());

const OPCOES = {
  urlAgendamento: "https://clint.test/in/agendamento",
  urlNotificacao: "https://clint.test/in/notificacao",
};

function corpoDe(chamada: [any, any]): Record<string, unknown> {
  return JSON.parse(String(chamada[1].body));
}

function espiar() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
}

describe("gravarIdAgendamento", () => {
  it("posta o id na url de agendamento", async () => {
    const spy = espiar();
    await criarCrmWebhookClint(OPCOES).gravarIdAgendamento("deal-1", 1275002478);

    expect(String(spy.mock.calls[0]![0])).toBe(OPCOES.urlAgendamento);
    expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({
      deal_id: "deal-1",
      id_agendamento_medx: 1275002478,
    });
  });

  it("envia content-type json", async () => {
    const spy = espiar();
    await criarCrmWebhookClint(OPCOES).gravarIdAgendamento("deal-1", 1);
    const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
  });
});

describe("notificações", () => {
  it.each([
    ["notificarConfirmacao", "confirmado"],
    ["notificarReagendamento", "reagendamento_solicitado"],
    ["notificarCancelamento", "cancelamento_solicitado"],
  ])("%s posta o evento %s na url de notificação", async (metodo, evento) => {
    const spy = espiar();
    await (criarCrmWebhookClint(OPCOES) as any)[metodo]("deal-1");

    expect(String(spy.mock.calls[0]![0])).toBe(OPCOES.urlNotificacao);
    expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({ deal_id: "deal-1", evento });
  });

  it("inclui o motivo ao notificar conflito", async () => {
    const spy = espiar();
    await criarCrmWebhookClint(OPCOES).notificarConflito("deal-1", "horário alterado");

    expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({
      deal_id: "deal-1",
      evento: "conflito",
      motivo: "horário alterado",
    });
  });
});

describe("falhas", () => {
  it("lança quando o Clint responde erro, para o job tentar de novo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    await expect(
      criarCrmWebhookClint(OPCOES).gravarIdAgendamento("deal-1", 1)
    ).rejects.toThrow(/500/);
  });

  it("propaga falha de rede", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      criarCrmWebhookClint(OPCOES).notificarConfirmacao("deal-1")
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});
