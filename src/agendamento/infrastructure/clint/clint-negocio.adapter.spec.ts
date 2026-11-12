import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ClintNegocioAdapter } from './clint-negocio.adapter';
import type { ClintHttpClient } from './clint-http.client';
import { Telefone } from '../../domain/paciente/telefone';

const ORIGEM = 'c10ccf49-2c9f-41d5-bfa7-c116daa2cc77';
const BOAS_VINDAS = '03900fbe-0a12-462c-9599-2f5a3ff05657';

type Chamada = {
    metodo: string;
    caminho: string;
    corpo?: unknown;
    query?: Record<string, unknown>;
};

function montar(opcoes: { get?: (c: Chamada) => unknown; falha?: Error; motivo?: string } = {}) {
    const chamadas: Chamada[] = [];
    const client = {
        get: async <T>(caminho: string, query?: Record<string, unknown>) => {
            const c = { metodo: 'get', caminho, query };
            chamadas.push(c);
            return opcoes.get?.(c) as T;
        },
        post: async <T>(caminho: string, corpo: unknown) => {
            if (opcoes.falha) throw opcoes.falha;
            chamadas.push({ metodo: 'post', caminho, corpo });
            return { status: 201, data: { id: 'novo-deal' } } as T;
        },
    } as unknown as ClintHttpClient;
    const valores: Record<string, string | undefined> = {
        CLINT_ORIGEM_RECEPCAO_ID: ORIGEM,
        CLINT_ETAPA_BOAS_VINDAS_ID: BOAS_VINDAS,
        CLINT_MOTIVO_PERDA_CANCELAMENTO_ID: opcoes.motivo,
    };
    const config = { get: (k: string) => valores[k] } as ConfigService;
    return { adapter: new ClintNegocioAdapter(client, config), chamadas };
}

describe('ClintNegocioAdapter', () => {
    it('grava os campos no negócio pelo id', async () => {
        const { adapter, chamadas } = montar();
        await adapter.gravarCampos('d1', {
            data_agendamento: '2026-11-13',
            hora_agendamento: '15:00',
        });
        expect(chamadas).toEqual([
            {
                metodo: 'post',
                caminho: '/v1/deals/d1',
                corpo: { fields: { data_agendamento: '2026-11-13', hora_agendamento: '15:00' } },
            },
        ]);
    });

    it('propaga erro HTTP da Clint', async () => {
        const { adapter } = montar({ falha: new Error('Clint respondeu HTTP 400 em /v1/deals/x') });
        await expect(adapter.gravarCampos('x', { data_agendamento: '2026-11-13' })).rejects.toThrow(
            /HTTP 400/,
        );
    });

    it('lista todas as páginas de negócios abertos da RECEPÇÃO', async () => {
        const deal = (id: string) => ({
            id,
            contact: { id: `c-${id}`, name: 'Karmen 💓💓', phone: '44999365902', ddi: '55' },
            stage_id: BOAS_VINDAS,
            fields: { id_agendamento_medx: '-1', etapa_lembrete: 'd1_preparando_chegada' },
        });
        const { adapter, chamadas } = montar({
            get: c =>
                c.query!.page === 1
                    ? { data: [deal('a')], hasNext: true }
                    : { data: [deal('b')], hasNext: false },
        });

        const lista = await adapter.listarAbertosRecepcao();

        expect(lista.map(n => n.id)).toEqual(['a', 'b']);
        expect(lista[0]).toEqual({
            id: 'a',
            contatoId: 'c-a',
            nomeContato: 'Karmen 💓💓',
            telefone: '+5544999365902',
            etapaId: BOAS_VINDAS,
            campos: { id_agendamento_medx: '-1', etapa_lembrete: 'd1_preparando_chegada' },
        });
        expect(chamadas[0]).toMatchObject({
            caminho: '/v1/deals',
            query: { origin_id: ORIGEM, status: 'OPEN', page: 1 },
        });
    });

    it('busca contatos pelo telefone completo e pelo nome', async () => {
        const { adapter, chamadas } = montar({
            get: () => ({
                data: [{ id: 'c1', name: 'Cris', phone: '983111455', ddi: '595' }],
                hasNext: false,
            }),
        });

        const porTelefone = await adapter.buscarContatos({
            telefone: Telefone.criar('+595983111455'),
        });
        await adapter.buscarContatos({ nome: 'CRISTIANE' });

        expect(porTelefone).toEqual([{ id: 'c1', nome: 'Cris', telefone: '+595983111455' }]);
        expect(chamadas[0]!.query).toMatchObject({ phone: '595983111455' });
        expect(chamadas[1]!.query).toMatchObject({ name: 'CRISTIANE' });
    });

    it('busca telefone do Paraguai e confere o DDI 595', async () => {
        const { adapter } = montar({
            get: () => ({
                data: [
                    { id: 'py', name: 'Cris', phone: '983111455', ddi: '595' },
                    { id: 'br', name: 'Outro', phone: '983111455', ddi: '55' },
                ],
                hasNext: false,
            }),
        });
        const achados = await adapter.buscarContatos({ telefone: Telefone.criar('+595983111455') });
        expect(achados.map(c => c.id)).toEqual(['py']);
    });

    it('criarNegocio usa contato existente e etapa BOAS VINDAS', async () => {
        const { adapter, chamadas } = montar();
        const id = await adapter.criarNegocio({
            contatoId: 'c1',
            nome: 'Maria',
            campos: { id_agendamento_medx: '-5' },
        });
        expect(id).toBe('novo-deal');
        expect(chamadas[0]).toEqual({
            metodo: 'post',
            caminho: '/v1/deals',
            corpo: {
                origin_id: ORIGEM,
                stage_id: BOAS_VINDAS,
                contact_id: 'c1',
                fields: { id_agendamento_medx: '-5' },
            },
        });
    });

    it('criarNegocio sem contato manda nome e telefone', async () => {
        const { adapter, chamadas } = montar();
        await adapter.criarNegocio({
            nome: 'Maria Silva',
            telefone: Telefone.criar('45999197847'),
            campos: {},
        });
        expect(chamadas[0]!.corpo).toEqual({
            origin_id: ORIGEM,
            stage_id: BOAS_VINDAS,
            name: 'Maria Silva',
            phone: '5545999197847',
            fields: {},
        });
    });

    it('encerrarComoPerdido manda LOST com o motivo', async () => {
        const { adapter, chamadas } = montar({ motivo: 'motivo-1' });
        await adapter.encerrarComoPerdido('d1');
        expect(chamadas[0]).toEqual({
            metodo: 'post',
            caminho: '/v1/deals/d1',
            corpo: { status: 'LOST', lost_status_id: 'motivo-1' },
        });
    });

    it('encerrarComoPerdido sem motivo configurado falha claro', async () => {
        const { adapter } = montar();
        await expect(adapter.encerrarComoPerdido('d1')).rejects.toThrow(
            /CLINT_MOTIVO_PERDA_CANCELAMENTO_ID/,
        );
    });
});
