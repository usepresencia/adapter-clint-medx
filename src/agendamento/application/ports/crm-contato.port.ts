import type { Telefone } from '../../domain/paciente/telefone';

export const CRM_CONTATO_PORT = Symbol('CrmContatoPort');

export interface ContatoClint {
    id: string;
    nome: string;
    /** E.164, ou `null` sem telefone. */
    telefone: string | null;
}

export interface CrmContatoPort {
    /** Contatos com exatamente este telefone (E.164) ou pelo nome (prefixo, como a Clint busca). */
    buscarContatos(filtro: { telefone?: Telefone; nome?: string }): Promise<ContatoClint[]>;
    /** Id do primeiro contato com o telefone, ou `null`. */
    buscarIdPorTelefone(telefone: Telefone): Promise<string | null>;
    adicionarTag(contatoId: string, tag: string): Promise<void>;
}
