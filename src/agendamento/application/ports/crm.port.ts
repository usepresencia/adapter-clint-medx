import type { Telefone } from '../../domain/paciente/telefone';

export const CRM_PORT = Symbol('CrmPort');

export interface CrmPort {
    /**
     * O webhook de entrada do Clint identifica o negócio por email, telefone
     * ou instagram — nunca só pelo deal_id — por isso todo método aqui exige
     * o telefone do paciente (confirmado ao vivo).
     */
    /** `inicio` no formato `yyyy-LL-ddTHH:mm:ss` (horário local da clínica, sem timezone). */
    gravarIdAgendamento(
        dealId: string,
        idAgendamento: number,
        telefone: Telefone,
        inicio: string,
    ): Promise<void>;
    notificarConfirmacao(dealId: string, telefone: Telefone): Promise<void>;
    notificarReagendamento(dealId: string, telefone: Telefone): Promise<void>;
    notificarCancelamento(dealId: string, telefone: Telefone): Promise<void>;
    notificarConflito(dealId: string, motivo: string, telefone: Telefone): Promise<void>;
    notificarComparecimento(dealId: string, telefone: Telefone): Promise<void>;
    notificarNaoComparecimento(dealId: string, telefone: Telefone): Promise<void>;
}
