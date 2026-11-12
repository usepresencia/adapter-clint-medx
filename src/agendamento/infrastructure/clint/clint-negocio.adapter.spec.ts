import { describe, it, expect } from 'vitest';
import { ClintNegocioAdapter } from './clint-negocio.adapter';
import type { ClintHttpClient } from './clint-http.client';

function clientFalso(falha?: Error) {
    const enviados: Array<{ caminho: string; corpo: unknown }> = [];
    const client = {
        post: async <T>(caminho: string, corpo: unknown) => {
            if (falha) throw falha;
            enviados.push({ caminho, corpo });
            return {} as T;
        },
    } as unknown as ClintHttpClient;
    return { client, enviados };
}

describe('ClintNegocioAdapter', () => {
    it('grava os campos no negócio pelo id', async () => {
        const { client, enviados } = clientFalso();

        await new ClintNegocioAdapter(client).gravarCampos('521e2bf6-1ce0-4cf0-91d9-ea2dc7627eb1', {
            data_agendamento: '2026-11-13',
            hora_agendamento: '15:00',
        });

        expect(enviados).toEqual([
            {
                caminho: '/v1/deals/521e2bf6-1ce0-4cf0-91d9-ea2dc7627eb1',
                corpo: { fields: { data_agendamento: '2026-11-13', hora_agendamento: '15:00' } },
            },
        ]);
    });

    it('propaga erro HTTP da Clint', async () => {
        const { client } = clientFalso(new Error('Clint respondeu HTTP 400 em /v1/deals/x'));
        await expect(
            new ClintNegocioAdapter(client).gravarCampos('x', { data_agendamento: '2026-11-13' }),
        ).rejects.toThrow(/HTTP 400/);
    });
});
