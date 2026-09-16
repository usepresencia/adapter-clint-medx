import type { EventoRecebido } from './evento-recebido';

export interface EventoRepositorio {
    /** Grava o payload bruto e devolve o evento já com id. */
    registrar(endpoint: string, payload: unknown): Promise<EventoRecebido>;
    salvar(evento: EventoRecebido): Promise<void>;
    /** Remove eventos mais antigos que a retenção; devolve quantos saíram. */
    expurgar(dias: number): Promise<number>;
    /** Reconstrói a entidade de um evento já gravado, para o worker atualizar seu estado. */
    buscarPorId(id: number): Promise<EventoRecebido>;
}
