import type { ComandoAgendamento } from '../agendar-consulta/agendar-consulta.comando';
import type { ComandoResposta } from '../processar-resposta-lembrete/processar-resposta.comando';

export const FILA_PORT = Symbol('FilaPort');

export type JobAdapter =
    | { tipo: 'agendamento'; eventoId: number; comando: ComandoAgendamento }
    | { tipo: 'resposta'; eventoId: number; comando: ComandoResposta };

export interface FilaPort {
    add(nome: string, dados: JobAdapter): Promise<{ id?: string }>;
}
