import type { Telefone } from '../../domain/paciente/telefone';

export const CRM_CONTATO_PORT = Symbol('CrmContatoPort');

export interface CrmContatoPort {
    /** Retorna o id do contato no Clint pelo telefone, ou `null` se não encontrar. */
    buscarIdPorTelefone(telefone: Telefone): Promise<string | null>;
    adicionarTag(contatoId: string, tag: string): Promise<void>;
}
