export const CRM_NEGOCIO_PORT = Symbol('CrmNegocioPort');

/** Campos de data do negócio que armam automações de gatilho de data na Clint. */
export type CampoDataNegocio =
    'data_agendamento' | 'horario_lembrete_chegada' | 'horario_checagem_comparecimento';

/**
 * Formatos: `data_agendamento` `yyyy-LL-dd`; horários `yyyy-LL-dd'T'HH:mm:ss`
 * (local da clínica); `hora_agendamento` `HH:mm`.
 */
export type CamposNegocio = Partial<Record<CampoDataNegocio | 'hora_agendamento', string>>;

export interface CrmNegocioPort {
    /**
     * Grava campos no negócio pelo id. Não apaga nada: a API REST da Clint
     * ignora "" e null (confirmado ao vivo em 2026-11-12), então quem apaga
     * antes de regravar é a automação da Clint.
     */
    gravarCampos(dealId: string, campos: CamposNegocio): Promise<void>;
}
