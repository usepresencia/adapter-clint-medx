import type { Agendamento } from './agendamento';

export const AGENDAMENTO_REPOSITORIO = Symbol('AgendamentoRepositorio');

/**
 * Assíncrona (diferente do projeto Fastify original, que era síncrona sobre
 * better-sqlite3): Prisma não tem API síncrona. Todo chamador precisa `await`.
 */
export interface AgendamentoRepositorio {
    buscarPorDeal(dealId: string): Promise<Agendamento | null>;
    salvar(agendamento: Agendamento): Promise<void>;
}
