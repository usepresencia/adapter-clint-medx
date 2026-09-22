import { Injectable } from '@nestjs/common';
import { ClintHttpClient } from './clint-http.client';
import type { CrmContatoPort } from '../../application/ports/crm-contato.port';
import type { Telefone } from '../../domain/paciente/telefone';

const DDI_BRASIL = '55';

interface ClintContatosResposta {
    data: Array<{ id: string }>;
}

@Injectable()
export class ClintContatoAdapter implements CrmContatoPort {
    constructor(private readonly client: ClintHttpClient) {}

    async buscarIdPorTelefone(telefone: Telefone): Promise<string | null> {
        const resposta = await this.client.get<ClintContatosResposta>('/v1/contacts', {
            ddi: DDI_BRASIL,
            phone: telefone.nacional,
        });
        return resposta.data[0]?.id ?? null;
    }

    async adicionarTag(contatoId: string, tag: string): Promise<void> {
        await this.client.post(`/v1/contacts/${contatoId}/tags`, [tag]);
    }
}
