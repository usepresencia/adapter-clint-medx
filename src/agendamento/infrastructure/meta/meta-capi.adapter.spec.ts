import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { MetaCapiAdapter } from './meta-capi.adapter';
import { Telefone } from '../../domain/paciente/telefone';

afterEach(() => vi.restoreAllMocks());

const TELEFONE = Telefone.criar('+55 11 99999-8888');
const CAPTURADO_EM = new Date('2026-09-22T10:00:00.000Z');

const VARS: Record<string, string> = {
    META_PIXEL_ID: 'pixel-123',
    META_CAPI_ACCESS_TOKEN: 'token-abc',
};

function configFalso(vars: Record<string, string> = VARS): ConfigService {
    return { get: (chave: string) => vars[chave] } as ConfigService;
}

function corpoDe(chamada: [any, any]): any {
    return JSON.parse(String(chamada[1].body));
}

describe('notificarConversao', () => {
    it('posta o evento QualifiedLead com telefone com hash e fbc formatado', async () => {
        const spy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('{}', { status: 200 }));

        await new MetaCapiAdapter(configFalso()).notificarConversao(
            TELEFONE,
            'fb.clique.123',
            CAPTURADO_EM,
        );

        const url = String(spy.mock.calls[0]![0]);
        expect(url).toContain('graph.facebook.com');
        expect(url).toContain('/pixel-123/events');
        expect(url).toContain('access_token=token-abc');

        const corpo = corpoDe(spy.mock.calls[0] as [any, any]);
        expect(corpo.data[0].event_name).toBe('QualifiedLead');
        expect(corpo.data[0].user_data.fbc).toBe(`fb.1.${CAPTURADO_EM.getTime()}.fb.clique.123`);

        const hashEsperado = createHash('sha256').update('5511999998888').digest('hex');
        expect(corpo.data[0].user_data.ph).toEqual([hashEsperado]);
    });

    it('lança quando a Meta responde erro', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('{"error":"token inválido"}', { status: 401 }),
        );

        await expect(
            new MetaCapiAdapter(configFalso()).notificarConversao(
                TELEFONE,
                'fb.clique.123',
                CAPTURADO_EM,
            ),
        ).rejects.toThrow(/401/);
    });

    it('lança um erro claro quando as credenciais não estão configuradas', async () => {
        const spy = vi.spyOn(globalThis, 'fetch');

        await expect(
            new MetaCapiAdapter(configFalso({})).notificarConversao(
                TELEFONE,
                'fb.clique.123',
                CAPTURADO_EM,
            ),
        ).rejects.toThrow(/META_PIXEL_ID|META_CAPI_ACCESS_TOKEN/);

        expect(spy).not.toHaveBeenCalled();
    });
});
