import type { ComandoAgendamento } from '../agendar-consulta/agendar-consulta.comando';
import type { ComandoResposta } from '../processar-resposta-lembrete/processar-resposta.comando';
import type { ComandoLeadOrigem } from '../processar-lead-origem/processar-lead-origem.comando';
import type { ComandoVendaGanha } from '../processar-venda-ganha/processar-venda-ganha.comando';
import type { ComandoVerificarComparecimento } from '../verificar-comparecimento/verificar-comparecimento.comando';

export const FILA_PORT = Symbol('FilaPort');

export type JobAdapter =
    | { tipo: 'agendamento'; eventoId: number; comando: ComandoAgendamento }
    | { tipo: 'resposta'; eventoId: number; comando: ComandoResposta }
    | { tipo: 'lead-origem'; eventoId: number; comando: ComandoLeadOrigem }
    | { tipo: 'venda-ganha'; eventoId: number; comando: ComandoVendaGanha }
    | { tipo: 'comparecimento'; eventoId: number; comando: ComandoVerificarComparecimento };

export interface FilaPort {
    add(nome: string, dados: JobAdapter): Promise<{ id?: string }>;
}
