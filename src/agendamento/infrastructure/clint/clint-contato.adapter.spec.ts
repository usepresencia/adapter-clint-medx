import { describe, it, expect, vi } from 'vitest';
import { ClintContatoAdapter } from './clint-contato.adapter';
import { Telefone } from '../../domain/paciente/telefone';
import type { ClintHttpClient } from './clint-http.client';

const TELEFONE = Telefone.criar('+55 11 99999-8888');

function clientFalso(resposta: unknown) {
    const get = vi.fn(async () => resposta);
    const post = vi.fn(async () => undefined);
    return { client: { get, post } as unknown as ClintHttpClient, get, post };
}

describe('buscarIdPorTelefone', () => {
    it('filtra por ddi 55 e o telefone nacional, devolve o id do primeiro contato', async () => {
        const { client, get } = clientFalso({ data: [{ id: 'contato-1' }] });
        const id = await new ClintContatoAdapter(client).buscarIdPorTelefone(TELEFONE);

        expect(get).toHaveBeenCalledWith('/v1/contacts', { ddi: '55', phone: '11999998888' });
        expect(id).toBe('contato-1');
    });

    it('devolve null quando não encontra nenhum contato', async () => {
        const { client } = clientFalso({ data: [] });
        const id = await new ClintContatoAdapter(client).buscarIdPorTelefone(TELEFONE);
        expect(id).toBeNull();
    });
});

describe('adicionarTag', () => {
    it('posta um array com o nome da tag no endpoint de tags do contato', async () => {
        const { client, post } = clientFalso(undefined);
        await new ClintContatoAdapter(client).adicionarTag('contato-1', 'Google');

        expect(post).toHaveBeenCalledWith('/v1/contacts/contato-1/tags', ['Google']);
    });
});
