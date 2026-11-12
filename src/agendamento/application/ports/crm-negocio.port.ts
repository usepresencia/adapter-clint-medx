import type { CampoDataNegocio } from '../../domain/agendamento/campos-data';
import type { Telefone } from '../../domain/paciente/telefone';

export const CRM_NEGOCIO_PORT = Symbol('CrmNegocioPort');

export type { CampoDataNegocio };

/**
 * Campos do negócio que o adapter grava. Formatos: `data_agendamento`
 * `yyyy-LL-dd`; horários `yyyy-LL-dd'T'HH:mm:ss` (local da clínica);
 * `hora_agendamento` `HH:mm`; o resto é texto.
 */
export type CamposNegocio = Partial<
    Record<
        | CampoDataNegocio
        | 'hora_agendamento'
        | 'etapa_lembrete'
        | 'proximo_lembrete'
        | 'tipo_consulta'
        | 'id_agendamento_medx'
        | 'duracao_consulta',
        string
    >
>;

export interface NegocioRecepcao {
    id: string;
    contatoId: string;
    nomeContato: string;
    /** E.164 (`+` + DDI + número), ou `null` sem telefone. */
    telefone: string | null;
    etapaId: string;
    campos: Record<string, string>;
}

export interface ContatoClint {
    id: string;
    nome: string;
    /** E.164, ou `null` sem telefone. */
    telefone: string | null;
}

export interface DadosNovoNegocio {
    contatoId?: string;
    nome: string;
    telefone?: Telefone;
    campos: CamposNegocio;
}

export interface CrmNegocioPort {
    /**
     * Grava campos no negócio pelo id. Não apaga nada: a API REST da Clint
     * ignora "" e null (confirmado ao vivo em 2026-11-12), então quem apaga
     * antes de regravar é a automação da Clint.
     */
    gravarCampos(dealId: string, campos: CamposNegocio): Promise<void>;
    /** Negócios abertos da origem RECEPÇÃO, todas as etapas. */
    listarAbertosRecepcao(): Promise<NegocioRecepcao[]>;
    buscarContatos(filtro: { telefone?: Telefone; nome?: string }): Promise<ContatoClint[]>;
    /** Cria na RECEPÇÃO / BOAS VINDAS (o canal só cria nessa etapa); devolve o id. */
    criarNegocio(dados: DadosNovoNegocio): Promise<string>;
    /** Fecha como perdido com o motivo de cancelamento configurado. */
    encerrarComoPerdido(dealId: string): Promise<void>;
}
