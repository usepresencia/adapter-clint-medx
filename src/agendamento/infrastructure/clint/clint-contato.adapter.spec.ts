import { describe, it, expect, vi } from 'vitest';
import { ClintContatoAdapter } from './clint-contato.adapter';
import { Telefone } from '../../domain/paciente/telefone';
import type { ClintHttpClient } from './clint-http.client';

const TELEFONE = Telefone.criar('+55 11 99999-8888');

function clientFalso(resposta: unknown) {
    const get = vi.fn(async (_caminho: string, _query?: unknown) => resposta);
    const post = vi.fn(async () => undefined);
    return { client: { get, post } as unknown as ClintHttpClient, get, post };
}

describe('buscarContatos', () => {
    it('busca pelo telefone completo e pelo nome', async () => {
        const { client, get } = clientFalso({
            data: [{ id: 'c1', name: 'Cris', phone: '983111455', ddi: '595' }],
            hasNext: false,
        });
        const adapter = new ClintContatoAdapter(client);

        const porTelefone = await adapter.buscarContatos({
            telefone: Telefone.criar('+595983111455'),
        });
        await adapter.buscarContatos({ nome: 'CRISTIANE' });

        expect(porTelefone).toEqual([{ id: 'c1', nome: 'Cris', telefone: '+595983111455' }]);
        expect(get.mock.calls[0]![1]).toMatchObject({ phone: '595983111455' });
        expect(get.mock.calls[1]![1]).toMatchObject({ name: 'CRISTIANE' });
    });

    it('busca telefone do Paraguai e confere o DDI 595', async () => {
        const { client } = clientFalso({
            data: [
                { id: 'py', name: 'Cris', phone: '983111455', ddi: '595' },
                { id: 'br', name: 'Outro', phone: '983111455', ddi: '55' },
            ],
            hasNext: false,
        });
        const achados = await new ClintContatoAdapter(client).buscarContatos({
            telefone: Telefone.criar('+595983111455'),
        });
        expect(achados.map(c => c.id)).toEqual(['py']);
    });
});

describe('buscarIdPorTelefone', () => {
    it('devolve o id do contato que tem exatamente o telefone', async () => {
        const { client, get } = clientFalso({
            data: [{ id: 'contato-1', name: 'Maria', phone: '11999998888', ddi: '55' }],
        });
        const id = await new ClintContatoAdapter(client).buscarIdPorTelefone(TELEFONE);

        expect(get.mock.calls[0]![1]).toMatchObject({ phone: '5511999998888' });
        expect(id).toBe('contato-1');
    });

    it('ignora o mesmo número com outro DDI', async () => {
        const { client } = clientFalso({
            data: [{ id: 'py', name: 'X', phone: '11999998888', ddi: '595' }],
        });
        expect(await new ClintContatoAdapter(client).buscarIdPorTelefone(TELEFONE)).toBeNull();
    });

    it('devolve null quando não encontra nenhum contato', async () => {
        const { client } = clientFalso({ data: [] });
        expect(await new ClintContatoAdapter(client).buscarIdPorTelefone(TELEFONE)).toBeNull();
    });
});

describe('adicionarTag', () => {
    it('posta um array com o nome da tag no endpoint de tags do contato', async () => {
        const { client, post } = clientFalso(undefined);
        await new ClintContatoAdapter(client).adicionarTag('contato-1', 'Google');

        expect(post).toHaveBeenCalledWith('/v1/contacts/contato-1/tags', ['Google']);
    });
});
