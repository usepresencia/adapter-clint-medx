import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { FilaPort, JobAdapter } from '../../application/ports/fila.port';
import { NOME_FILA } from './fila.constants';

@Injectable()
export class BullMqFilaAdapter implements FilaPort {
    constructor(@InjectQueue(NOME_FILA) private readonly fila: Queue<JobAdapter>) {}

    async add(nome: string, dados: JobAdapter): Promise<{ id?: string }> {
        const job = await this.fila.add(nome, dados);
        return { id: job.id };
    }

    async agendarRepetitivo(nome: string, dados: JobAdapter, intervaloMs: number): Promise<void> {
        // Uma tentativa só: o próprio agendador repete a rodada no próximo ciclo.
        await this.fila.upsertJobScheduler(
            nome,
            { every: intervaloMs },
            { name: nome, data: dados, opts: { attempts: 1 } },
        );
    }

    async removerRepetitivo(nome: string): Promise<void> {
        await this.fila.removeJobScheduler(nome);
    }
}
