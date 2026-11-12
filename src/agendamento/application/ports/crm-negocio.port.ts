export const CRM_NEGOCIO_PORT = Symbol('CrmNegocioPort');

import type { CampoDataNegocio } from '../../domain/agendamento/campos-data';

export type { CampoDataNegocio };

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
