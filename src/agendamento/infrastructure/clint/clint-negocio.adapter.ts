import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
    CamposNegocio,
    ContatoClint,
    CrmNegocioPort,
    DadosNovoNegocio,
    NegocioRecepcao,
} from '../../application/ports/crm-negocio.port';
import type { Telefone } from '../../domain/paciente/telefone';
import { ClintHttpClient } from './clint-http.client';

const LIMITE_PAGINA = 1000;
const MAX_PAGINAS = 50;

interface ContatoApi {
    id: string;
    name: string | null;
    phone: string | null;
    ddi: string | null;
}

interface NegocioApi {
    id: string;
    contact: ContatoApi;
    stage_id: string;
    created_at: string;
    fields: Record<string, unknown> | null;
}

interface Pagina<T> {
    data?: T[];
    hasNext?: boolean;
}

function e164(contato: ContatoApi): string | null {
    const numero = (contato.phone ?? '').replace(/\D/g, '');
    if (!numero) return null;
    const ddi = (contato.ddi ?? '').replace(/\D/g, '');
    return `+${ddi}${numero}`;
}

function soTexto(campos: Record<string, unknown> | null): Record<string, string> {
    const resultado: Record<string, string> = {};
    for (const [chave, valor] of Object.entries(campos ?? {})) {
        if (typeof valor === 'string' || typeof valor === 'number')
            resultado[chave] = String(valor);
    }
    return resultado;
}

/** Negócios e contatos pela API REST da Clint. */
@Injectable()
export class ClintNegocioAdapter implements CrmNegocioPort {
    constructor(
        private readonly client: ClintHttpClient,
        private readonly config: ConfigService,
    ) {}

    async gravarCampos(dealId: string, campos: CamposNegocio): Promise<void> {
        await this.client.post(`/v1/deals/${dealId}`, { fields: campos });
    }

    async listarAbertosRecepcao(): Promise<NegocioRecepcao[]> {
        const negocios = await this.listarTodos<NegocioApi>('/v1/deals', {
            origin_id: this.config.get<string>('CLINT_ORIGEM_RECEPCAO_ID'),
            status: 'OPEN',
        });
        return negocios.map(n => ({
            id: n.id,
            contatoId: n.contact.id,
            nomeContato: n.contact.name ?? '',
            telefone: e164(n.contact),
            etapaId: n.stage_id,
            criadoEm: n.created_at,
            campos: soTexto(n.fields),
        }));
    }

    async buscarContatos(filtro: { telefone?: Telefone; nome?: string }): Promise<ContatoClint[]> {
        // Telefone: os dígitos do E.164 sem o `+` acham brasileiros e
        // estrangeiros (confirmado ao vivo); confere o resultado pelo E.164
        // completo, porque a busca pode trazer o mesmo número com outro DDI.
        const query = filtro.telefone
            ? { phone: filtro.telefone.e164.slice(1) }
            : { name: filtro.nome };
        const contatos = (await this.listarTodos<ContatoApi>('/v1/contacts', query)).map(c => ({
            id: c.id,
            nome: c.name ?? '',
            telefone: e164(c),
        }));
        return filtro.telefone
            ? contatos.filter(c => c.telefone === filtro.telefone!.e164)
            : contatos;
    }

    async criarNegocio(dados: DadosNovoNegocio): Promise<{ id: string; contatoId: string | null }> {
        const corpo: Record<string, unknown> = {
            origin_id: this.config.get<string>('CLINT_ORIGEM_RECEPCAO_ID'),
            // Nasce em AGENDAMENTO: criar direto em BOAS VINDAS não dispara o
            // D0 Boas Vindas (confirmado ao vivo); quem dispara é a mudança de
            // etapa feita por `moverParaBoasVindas`.
            stage_id: this.config.get<string>('CLINT_ETAPA_CRIACAO_ID'),
        };
        if (dados.contatoId) {
            corpo.contact_id = dados.contatoId;
        } else {
            corpo.name = dados.nome;
            if (dados.telefone) corpo.phone = dados.telefone.e164.slice(1);
        }
        corpo.fields = dados.campos;

        const resposta = await this.client.post<{
            data?: { id?: string; contact?: { id?: string } };
        }>('/v1/deals', corpo);
        const id = resposta?.data?.id;
        if (!id) throw new Error('Clint não devolveu o id do negócio criado');
        return { id, contatoId: resposta.data?.contact?.id ?? null };
    }

    async moverParaBoasVindas(dealId: string): Promise<void> {
        await this.client.post(`/v1/deals/${dealId}`, {
            stage_id: this.config.get<string>('CLINT_ETAPA_BOAS_VINDAS_ID'),
        });
    }

    async encerrarComoPerdido(dealId: string): Promise<void> {
        const motivo = this.config.get<string>('CLINT_MOTIVO_PERDA_CANCELAMENTO_ID');
        if (!motivo) {
            throw new Error(
                'CLINT_MOTIVO_PERDA_CANCELAMENTO_ID não configurado — não dá para encerrar como perdido',
            );
        }
        await this.client.post(`/v1/deals/${dealId}`, { status: 'LOST', lost_status_id: motivo });
    }

    private async listarTodos<T>(
        caminho: string,
        filtros: Record<string, string | undefined>,
    ): Promise<T[]> {
        const itens: T[] = [];
        for (let page = 1; page <= MAX_PAGINAS; page++) {
            const pagina = await this.client.get<Pagina<T>>(caminho, {
                ...filtros,
                limit: LIMITE_PAGINA,
                page,
            });
            itens.push(...(pagina?.data ?? []));
            if (!pagina?.hasNext) return itens;
        }
        throw new Error(`Clint passou de ${MAX_PAGINAS} páginas em ${caminho}`);
    }
}
