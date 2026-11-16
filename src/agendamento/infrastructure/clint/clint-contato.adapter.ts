import { Injectable } from '@nestjs/common';
import { ClintHttpClient } from './clint-http.client';
import { listarTodasAsPaginas } from './clint.paginacao';
import { e164, type ContatoApi } from './clint.tipos';
import type { ContatoClint, CrmContatoPort } from '../../application/ports/crm-contato.port';
import type { Telefone } from '../../domain/paciente/telefone';

@Injectable()
export class ClintContatoAdapter implements CrmContatoPort {
    constructor(private readonly client: ClintHttpClient) {}

    async buscarContatos(filtro: { telefone?: Telefone; nome?: string }): Promise<ContatoClint[]> {
        // Telefone: os dígitos do E.164 sem o `+` acham brasileiros e
        // estrangeiros (confirmado ao vivo); confere o resultado pelo E.164
        // completo, porque a busca pode trazer o mesmo número com outro DDI.
        const query = filtro.telefone
            ? { phone: filtro.telefone.e164.slice(1) }
            : { name: filtro.nome };
        const contatos = (
            await listarTodasAsPaginas<ContatoApi>(this.client, '/v1/contacts', query)
        ).map(c => ({ id: c.id, nome: c.name ?? '', telefone: e164(c) }));
        return filtro.telefone
            ? contatos.filter(c => c.telefone === filtro.telefone!.e164)
            : contatos;
    }

    async buscarIdPorTelefone(telefone: Telefone): Promise<string | null> {
        return (await this.buscarContatos({ telefone }))[0]?.id ?? null;
    }

    async adicionarTag(contatoId: string, tag: string): Promise<void> {
        await this.client.post(`/v1/contacts/${contatoId}/tags`, [tag]);
    }
}
