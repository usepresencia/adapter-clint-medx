export const ETAPAS_RECEPCAO = Symbol('EtapasRecepcao');

/** Ids das etapas da RECEPÇÃO na Clint que o monitor distingue. */
export interface EtapasRecepcao {
    /** Onde o negócio nasce (AGENDAMENTO). */
    criacao: string;
    boasVindas: string;
    endovenoso: string;
}
