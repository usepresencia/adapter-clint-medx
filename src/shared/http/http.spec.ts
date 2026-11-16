import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchComTimeout, lerCorpo, montarUrl } from './http';

afterEach(() => vi.restoreAllMocks());

describe('fetchComTimeout', () => {
    it('aborta a chamada que não responde e diz de qual caminho, sem a query', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(
            (_url, init) =>
                new Promise((_resolve, rejeitar) => {
                    init!.signal!.addEventListener('abort', () => rejeitar(init!.signal!.reason));
                }),
        );

        await expect(
            fetchComTimeout('https://x.test/v1/deals?access_token=segredo', {}, 10),
        ).rejects.toThrow(/timeout.*\/v1\/deals/i);
        await expect(
            fetchComTimeout('https://x.test/v1/deals?access_token=segredo', {}, 10),
        ).rejects.not.toThrow(/segredo/);
    });

    it('repassa a resposta quando chega a tempo', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
        const resposta = await fetchComTimeout('https://x.test/a', { method: 'POST' }, 1000);
        expect(await resposta.text()).toBe('ok');
    });

    it('propaga erros que não são timeout sem mexer neles', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('rede caiu'));
        await expect(fetchComTimeout('https://x.test/a', {}, 1000)).rejects.toThrow('rede caiu');
    });
});

describe('montarUrl', () => {
    it('omite undefined e codifica os valores', () => {
        expect(montarUrl('https://h', '/p', { a: 'b c', z: undefined, n: 1 })).toBe(
            'https://h/p?a=b%20c&n=1',
        );
        expect(montarUrl('https://h', '/p')).toBe('https://h/p');
    });
});

describe('lerCorpo', () => {
    it('devolve undefined para corpo vazio, JSON quando é JSON e o texto quando não é', async () => {
        expect(await lerCorpo(new Response(''))).toBeUndefined();
        expect(await lerCorpo(new Response('{"a":1}'))).toEqual({ a: 1 });
        expect(await lerCorpo(new Response('Mensagem Salva'))).toBe('Mensagem Salva');
    });
});
