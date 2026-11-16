import { describe, it, expect, vi } from 'vitest';
import { BullMqFilaAdapter } from './bullmq-fila.adapter';

describe('BullMqFilaAdapter', () => {
    it('agendarRepetitivo usa um agendador da fila com o intervalo pedido', async () => {
        const fila = { upsertJobScheduler: vi.fn(async () => ({})), removeJobScheduler: vi.fn() };
        const dados = { tipo: 'monitor-medx', comando: { modo: 'agir' } } as const;
        await new BullMqFilaAdapter(fila as any).agendarRepetitivo('monitor-medx', dados, 300_000);
        expect(fila.upsertJobScheduler).toHaveBeenCalledWith(
            'monitor-medx',
            { every: 300_000 },
            { name: 'monitor-medx', data: dados, opts: { attempts: 1 } },
        );
    });

    it('removerRepetitivo apaga o agendador', async () => {
        const fila = { upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn(async () => true) };
        await new BullMqFilaAdapter(fila as any).removerRepetitivo('monitor-medx');
        expect(fila.removeJobScheduler).toHaveBeenCalledWith('monitor-medx');
    });
});
