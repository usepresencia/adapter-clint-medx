export interface ComandoResposta {
    dealId: string;
    idAgendamentoMedx: number;
    /** Valor cru vindo do CRM; o value object RespostaLembrete valida e normaliza. */
    resposta: string;
}
