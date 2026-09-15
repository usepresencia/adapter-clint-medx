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
}
