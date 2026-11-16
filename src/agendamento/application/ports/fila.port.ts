import type { ComandoAgendamento } from '../agendar-consulta/agendar-consulta.comando';
import type { ComandoResposta } from '../processar-resposta-lembrete/processar-resposta.comando';
import type { ComandoLeadOrigem } from '../processar-lead-origem/processar-lead-origem.comando';
import type { ComandoVendaGanha } from '../processar-venda-ganha/processar-venda-ganha.comando';
import type { ComandoVerificarComparecimento } from '../verificar-comparecimento/verificar-comparecimento.comando';
import type { ComandoRegravarData } from '../regravar-data/regravar-data.comando';
import type { ComandoMonitorar } from '../monitorar-agenda/monitorar-agenda.comando';

export const FILA_PORT = Symbol('FilaPort');

export type JobAdapter =
    | { tipo: 'agendamento'; eventoId: number; comando: ComandoAgendamento }
    | { tipo: 'resposta'; eventoId: number; comando: ComandoResposta }
    | { tipo: 'lead-origem'; eventoId: number; comando: ComandoLeadOrigem }
    | { tipo: 'venda-ganha'; eventoId: number; comando: ComandoVendaGanha }
    | { tipo: 'comparecimento'; eventoId: number; comando: ComandoVerificarComparecimento }
    | { tipo: 'regravar-data'; eventoId: number; comando: ComandoRegravarData }
    | { tipo: 'monitor-medx'; comando: ComandoMonitorar };

/** Job nascido de webhook, antes de o evento ser gravado e ganhar `eventoId`. */
export type JobWebhook = JobAdapter extends infer J
    ? J extends { eventoId: number }
        ? Omit<J, 'eventoId'>
        : never
    : never;

export interface FilaPort {
    add(nome: string, dados: JobAdapter): Promise<{ id?: string }>;
    /** Cria ou atualiza um job que se repete a cada `intervaloMs`. */
    agendarRepetitivo(nome: string, dados: JobAdapter, intervaloMs: number): Promise<void>;
    removerRepetitivo(nome: string): Promise<void>;
}
