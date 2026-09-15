import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { MedxTokenProvider } from './medx-token.provider';

const respostaOk = (token: string) =>
    new Response(
        JSON.stringify({
            accessToken: token,
            tokenType: 'Bearer',
            expiresInSeconds: 900,
            scope: '',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
    );

function configFalso(): ConfigService {
    const valores: Record<string, string> = {
        MEDX_HOST: 'https://medx.test',
        MEDX_INTEGRATION_TOKEN: 'tk',
    };
    return { get: (chave: string) => valores[chave] } as ConfigService;
}

afterEach(() => vi.restoreAllMocks());

describe('MedxTokenProvider', () => {
    it('busca o token na primeira chamada', async () => {
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaOk('jwt-1'));
        const provider = new MedxTokenProvider(configFalso());
        expect(await provider.obterToken()).toBe('jwt-1');
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('posta o IntegrationToken no corpo, no endpoint certo', async () => {
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaOk('jwt-1'));
        const provider = new MedxTokenProvider(configFalso());
        await provider.obterToken();

        expect(String(spy.mock.calls[0]![0])).toBe('https://medx.test/api/integration/token');
        expect(JSON.parse(String(spy.mock.calls[0]![1]!.body))).toEqual({ IntegrationToken: 'tk' });
    });

    it('reaproveita o token dentro da validade', async () => {
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaOk('jwt-1'));
        const provider = new MedxTokenProvider(configFalso());
        await provider.obterToken();
        await provider.obterToken();
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('renova quando faltam menos de 120s para expirar', async () => {
        let agora = 0;
        const spy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(respostaOk('jwt-1'))
            .mockResolvedValueOnce(respostaOk('jwt-2'));

        const provider = new MedxTokenProvider(configFalso());
        provider.agora = () => agora;
        expect(await provider.obterToken()).toBe('jwt-1');
        agora = 800_000; // restam 100s
        expect(await provider.obterToken()).toBe('jwt-2');
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('colapsa chamadas concorrentes numa única requisição', async () => {
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaOk('jwt-1'));
        const provider = new MedxTokenProvider(configFalso());
        await Promise.all([provider.obterToken(), provider.obterToken(), provider.obterToken()]);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('busca de novo depois de invalidar', async () => {
        // Duas Response distintas: reusar uma só via mockResolvedValue quebraria
        // na segunda leitura de .json() ("Body is unusable") — mesmo cuidado já
        // identificado e corrigido no projeto Fastify original.
        const spy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(respostaOk('jwt-1'))
            .mockResolvedValueOnce(respostaOk('jwt-1'));
        const provider = new MedxTokenProvider(configFalso());
        await provider.obterToken();
        provider.invalidar();
        await provider.obterToken();
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('propaga erro quando o token de integração é recusado', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
        const provider = new MedxTokenProvider(configFalso());
        await expect(provider.obterToken()).rejects.toThrow(/401/);
    });
});
