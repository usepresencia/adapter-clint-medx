import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { MedxHttpClient } from './medx-http.client';
import { MedxTokenProvider } from './medx-token.provider';
import { ErroRateLimit, ErroMedx } from './medx.erros';

afterEach(() => vi.restoreAllMocks());

function configFalso(): ConfigService {
    return { get: () => 'https://medx.test' } as ConfigService;
}

function tokensFalsos(): MedxTokenProvider & { foiInvalidado: () => boolean } {
    let invalidado = false;
    return {
        obterToken: async () => (invalidado ? 'jwt-novo' : 'jwt-1'),
        invalidar: () => {
            invalidado = true;
        },
        foiInvalidado: () => invalidado,
    } as unknown as MedxTokenProvider & { foiInvalidado: () => boolean };
}

const json = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), {
        status,
        headers: { 'content-type': 'application/json' },
    });

function cliente() {
    const tokens = tokensFalsos();
    return { client: new MedxHttpClient(configFalso(), tokens), tokens };
}

describe('MedxHttpClient', () => {
    it('envia o Bearer token no header', async () => {
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));
        await cliente().client.get('/api/integration/agenda/status');

        const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>;
        expect(headers['authorization']).toBe('Bearer jwt-1');
    });

    it('monta a query string ignorando valores indefinidos', async () => {
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));
        await cliente().client.get('/x', { inicio: '2026-07-10', idUsuario: 12, setor: undefined });

        expect(String(spy.mock.calls[0]![0])).toBe(
            'https://medx.test/x?inicio=2026-07-10&idUsuario=12',
        );
    });

    it('converte 429 em ErroRateLimit lendo o Retry-After', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('', { status: 429, headers: { 'retry-after': '60' } }),
        );
        await expect(cliente().client.get('/x')).rejects.toMatchObject({ esperarSegundos: 60 });
        await expect(cliente().client.get('/x')).rejects.toBeInstanceOf(ErroRateLimit);
    });

    it('usa 60 segundos quando o 429 não traz Retry-After', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 429 }));
        await expect(cliente().client.get('/x')).rejects.toMatchObject({ esperarSegundos: 60 });
    });

    it('renova o token uma vez ao receber 401 e repete a chamada', async () => {
        const spy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response('', { status: 401 }))
            .mockResolvedValueOnce(json({ ok: true }));

        const { client, tokens } = cliente();
        await expect(client.get('/x')).resolves.toEqual({ ok: true });
        expect(tokens.foiInvalidado()).toBe(true);
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('não repete indefinidamente quando o 401 persiste', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
        await expect(cliente().client.get('/x')).rejects.toBeInstanceOf(ErroMedx);
    });

    it('resolve para número quando o corpo é o inteiro do POST de agendamento', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('1275002478', { status: 200, headers: { 'content-type': 'text/plain' } }),
        );
        await expect(cliente().client.post('/x', {})).resolves.toBe(1275002478);
    });

    it('resolve para string quando o corpo é uma mensagem de texto', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('Agendamento atualizado com sucesso.', { status: 200 }),
        );
        await expect(cliente().client.put('/x', {})).resolves.toBe(
            'Agendamento atualizado com sucesso.',
        );
    });
});
