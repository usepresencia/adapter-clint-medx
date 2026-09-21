import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ClintHttpClient } from './clint-http.client';

afterEach(() => vi.restoreAllMocks());

const VARS: Record<string, string> = {
    CLINT_API_URL: 'https://api.clint.test',
    CLINT_API_TOKEN: 'token-de-teste',
};

function configFalso(): ConfigService {
    return { get: (chave: string) => VARS[chave] } as ConfigService;
}

describe('get', () => {
    it('monta a url com query string e envia o header api-token', async () => {
        const spy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));

        const resultado = await new ClintHttpClient(configFalso()).get<{ data: unknown[] }>(
            '/v1/contacts',
            { ddi: '55', phone: '11999998888' },
        );

        expect(String(spy.mock.calls[0]![0])).toBe(
            'https://api.clint.test/v1/contacts?ddi=55&phone=11999998888',
        );
        const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>;
        expect(headers['api-token']).toBe('token-de-teste');
        expect(resultado).toEqual({ data: [] });
    });

    it('omite parâmetros de query undefined', async () => {
        const spy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('{}', { status: 200 }));

        await new ClintHttpClient(configFalso()).get('/v1/contacts', {
            ddi: '55',
            phone: undefined,
        });

        expect(String(spy.mock.calls[0]![0])).toBe('https://api.clint.test/v1/contacts?ddi=55');
    });
});

describe('post', () => {
    it('envia o corpo como json e trata resposta 204 sem corpo', async () => {
        const spy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(null, { status: 204 }));

        const resultado = await new ClintHttpClient(configFalso()).post(
            '/v1/contacts/contato-1/tags',
            ['Google'],
        );

        const chamada = spy.mock.calls[0]!;
        expect(String(chamada[0])).toBe('https://api.clint.test/v1/contacts/contato-1/tags');
        expect(chamada[1]!.method).toBe('POST');
        expect(String(chamada[1]!.body)).toBe('["Google"]');
        const headers = chamada[1]!.headers as Record<string, string>;
        expect(headers['api-token']).toBe('token-de-teste');
        expect(headers['content-type']).toBe('application/json');
        expect(resultado).toBeUndefined();
    });
});

describe('falhas', () => {
    it('lança quando o Clint responde erro', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
        await expect(new ClintHttpClient(configFalso()).get('/v1/contacts')).rejects.toThrow(/500/);
    });

    it('propaga falha de rede', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
        await expect(new ClintHttpClient(configFalso()).get('/v1/contacts')).rejects.toThrow(
            /ECONNREFUSED/,
        );
    });
});
