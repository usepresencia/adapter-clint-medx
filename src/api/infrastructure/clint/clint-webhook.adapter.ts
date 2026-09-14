import type { CrmPort } from "../../application/ports/crm.port.js";

async function postar(url: string, corpo: Record<string, unknown>): Promise<void> {
  const resposta = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });

  if (!resposta.ok) {
    throw new Error(`Webhook de entrada do Clint respondeu HTTP ${resposta.status}`);
  }
}

export function criarCrmWebhookClint(opcoes: {
  urlAgendamento: string;
  urlNotificacao: string;
}): CrmPort {
  const notificar = (dealId: string, evento: string, extra?: Record<string, unknown>) =>
    postar(opcoes.urlNotificacao, { deal_id: dealId, evento, ...extra });

  return {
    gravarIdAgendamento: (dealId, idAgendamento) =>
      postar(opcoes.urlAgendamento, { deal_id: dealId, id_agendamento_medx: idAgendamento }),

    notificarConfirmacao: (dealId) => notificar(dealId, "confirmado"),
    notificarReagendamento: (dealId) => notificar(dealId, "reagendamento_solicitado"),
    notificarCancelamento: (dealId) => notificar(dealId, "cancelamento_solicitado"),
    notificarConflito: (dealId, motivo) => notificar(dealId, "conflito", { motivo }),
  };
}
