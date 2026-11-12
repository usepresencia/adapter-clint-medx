import { describe, it, expect, vi } from 'vitest';
import { DateTime } from 'luxon';
import { MonitorarAgendaUseCase } from './monitorar-agenda.usecase';
import type { AgendamentoExterno } from '../ports/agenda-medica.port';
import type { NegocioRecepcao } from '../ports/crm-negocio.port';
import type { ResultadoContato } from './resolver-contato';

const BOAS_VINDAS = '03900fbe-0a12-462c-9599-2f5a3ff05657';
const ENDOVENOSO = '3a031270-0d91-4b81-aff5-55535b82ced6';
const POS_CONSULTA = 'dbe32efe-65b2-4f5c-961b-8f1f5eef810e';
const AGORA = '2026-11-12T12:00:00';

function ag(
    id: number,
    inicio: string,
    status = 1,
    extra: Partial<AgendamentoExterno> = {},
): AgendamentoExterno {
    return {
        id,
        idProfissional: -1,
        idPaciente: 500 + Math.abs(id),
        inicio,
        fim: DateTime.fromISO(inicio).plus({ minutes: 10 }).toFormat("yyyy-LL-dd'T'HH:mm:ss"),
        descricao: '',
        status,
        idTipoConsulta: 0,
        confirmacao: '',
        ultimaEdicao: '',
        bruto: { paciente: { id: 500 + Math.abs(id), nome: 'MARIA SILVA' } },
        ...extra,
    };
}

function negocio(
    id: string,
    campos: Record<string, string>,
    extra: Partial<NegocioRecepcao> = {},
): NegocioRecepcao {
    return {
        id,
        contatoId: `c-${id}`,
        nomeContato: 'Maria',
        telefone: '+5545999197847',
        etapaId: BOAS_VINDAS,
        campos,
        ...extra,
    };
}

function montar(opcoes: {
    agendamentos: AgendamentoExterno[];
    negocios?: NegocioRecepcao[];
    contato?: ResultadoContato;
    existe?: boolean;
    falharGravacaoEm?: string;
}) {
    const chamadas: Array<[string, ...unknown[]]> = [];
    const agenda = {
        listarDetalhadosPorPeriodo: vi.fn(async () => opcoes.agendamentos),
        existe: vi.fn(async () => opcoes.existe ?? true),
    };
    const catalogo = {
        indiceStatusAgendado: async () => 1,
        indiceStatusConfirmado: async () => 2,
        indiceStatusEndovenoso: async () => 12,
        indicesStatusCancelamento: async () => [0, 5],
    };
    const crm = {
        listarAbertosRecepcao: vi.fn(async () => opcoes.negocios ?? []),
        gravarCampos: vi.fn(async (dealId: string, campos: unknown) => {
            if (dealId === opcoes.falharGravacaoEm) throw new Error('Clint 500');
            chamadas.push(['gravarCampos', dealId, campos]);
        }),
        criarNegocio: vi.fn(async (dados: unknown) => {
            chamadas.push(['criarNegocio', dados]);
            return { id: 'novo', contatoId: 'c-novo' };
        }),
        moverParaBoasVindas: vi.fn(async (dealId: string) => {
            chamadas.push(['moverParaBoasVindas', dealId]);
        }),
        encerrarComoPerdido: vi.fn(async (dealId: string) => {
            chamadas.push(['encerrarComoPerdido', dealId]);
        }),
    };
    const contatos = {
        adicionarTag: vi.fn(async (contatoId: string, tag: string) => {
            chamadas.push(['adicionarTag', contatoId, tag]);
        }),
    };
    const resolvedor = {
        resolver: vi.fn(async () => opcoes.contato ?? { tipo: 'novo', telefone: null }),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const config = {
        get: (k: string) =>
            ({ CLINT_ETAPA_BOAS_VINDAS_ID: BOAS_VINDAS, CLINT_ETAPA_ENDOVENOSO_ID: ENDOVENOSO })[k],
    };
    const usecase = new MonitorarAgendaUseCase(
        agenda as any,
        catalogo as any,
        crm as any,
        contatos as any,
        resolvedor as any,
        logger,
        config as any,
    );
    usecase.agora = () => DateTime.fromISO(AGORA, { zone: 'America/Sao_Paulo' });
    return { usecase, chamadas, crm, agenda, logger, contatos };
}

const CONTATO: ResultadoContato = {
    tipo: 'contato',
    contato: { id: 'c-1', nome: 'Maria', telefone: '+5545999197847' },
    telefone: null,
};
const vinculado = (id: number, data: string, hora: string, etapa = 'd3_preparacao_consulta') =>
    negocio(`deal${Math.abs(id)}`, {
        id_agendamento_medx: String(id),
        data_agendamento: data,
        hora_agendamento: hora,
        etapa_lembrete: etapa,
    });

describe('MonitorarAgendaUseCase', () => {
    it('agendamento já vinculado e sem mudança não gera escrita', async () => {
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-1, '2026-11-20T10:00:00')],
            negocios: [vinculado(-1, '2026-11-20', '10:00')],
        });
        await usecase.executar('agir');
        expect(chamadas).toEqual([]);
    });

    it('primeira rodada com tudo vinculado não cria nada', async () => {
        const { usecase, crm } = montar({
            agendamentos: [ag(-1, '2026-11-20T10:00:00'), ag(-2, '2026-11-21T10:00:00', 12)],
            negocios: [vinculado(-1, '2026-11-20', '10:00'), vinculado(-2, '2026-11-21', '10:00')],
        });
        const resumo = await usecase.executar('agir');
        expect(crm.criarNegocio).not.toHaveBeenCalled();
        expect(resumo.criados).toBe(0);
    });

    it('consulta nova cria em BOAS VINDAS com d0_boas_vindas, depois datas, depois proximo_lembrete', async () => {
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-7, '2026-11-20T10:00:00')],
            contato: CONTATO,
        });
        const resumo = await usecase.executar('agir');
        expect(chamadas.map(c => c[0])).toEqual([
            'criarNegocio',
            'gravarCampos',
            'moverParaBoasVindas',
            'gravarCampos',
        ]);
        expect(chamadas[0]![1]).toEqual({
            contatoId: 'c-1',
            nome: 'MARIA SILVA',
            campos: {
                id_agendamento_medx: '-7',
                duracao_consulta: '10',
                etapa_lembrete: 'd0_boas_vindas',
            },
        });
        expect(chamadas[1]![2]).toEqual({
            data_agendamento: '2026-11-20',
            hora_agendamento: '10:00',
            horario_lembrete_chegada: '2026-11-20T08:00:00',
            horario_checagem_comparecimento: '2026-11-20T12:00:00',
        });
        expect(chamadas[3]![2]).toEqual({ proximo_lembrete: 'd3' });
        expect(resumo.criados).toBe(1);
    });

    it('endovenoso novo cria sem etapa_lembrete e com tipo_consulta endovenoso', async () => {
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-8, '2026-11-14T09:00:00', 12)],
            contato: CONTATO,
        });
        await usecase.executar('agir');
        expect((chamadas[0]![1] as { campos: Record<string, string> }).campos).toEqual({
            id_agendamento_medx: '-8',
            duracao_consulta: '10',
            tipo_consulta: 'endovenoso',
        });
        expect(chamadas[3]![2]).toEqual({ proximo_lembrete: 'd1' });
    });

    it('assume negócio aberto sem id em vez de criar', async () => {
        const aberto = negocio('aberto', {}, { contatoId: 'c-1' });
        const { usecase, chamadas, crm } = montar({
            agendamentos: [ag(-9, '2026-11-20T10:00:00')],
            negocios: [aberto],
            contato: CONTATO,
        });
        const resumo = await usecase.executar('agir');
        expect(crm.criarNegocio).not.toHaveBeenCalled();
        expect(chamadas[0]).toEqual([
            'gravarCampos',
            'aberto',
            { id_agendamento_medx: '-9', duracao_consulta: '10' },
        ]);
        expect(chamadas.at(-1)).toEqual(['gravarCampos', 'aberto', { proximo_lembrete: 'd3' }]);
        expect(resumo.assumidos).toBe(1);
    });

    it('não assume negócio fora de BOAS VINDAS ou ENDOVENOSO', async () => {
        const antigo = negocio('antigo', {}, { contatoId: 'c-1', etapaId: POS_CONSULTA });
        const { usecase, crm } = montar({
            agendamentos: [ag(-9, '2026-11-20T10:00:00')],
            negocios: [antigo],
            contato: CONTATO,
        });
        await usecase.executar('agir');
        expect(crm.criarNegocio).toHaveBeenCalled();
    });

    it('remarcação regrava as datas futuras sem mexer na etapa', async () => {
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-1, '2026-11-24T10:00:00')],
            negocios: [vinculado(-1, '2026-11-20', '10:00')],
        });
        const resumo = await usecase.executar('agir');
        expect(chamadas).toEqual([
            [
                'gravarCampos',
                'deal1',
                {
                    data_agendamento: '2026-11-24',
                    hora_agendamento: '10:00',
                    horario_lembrete_chegada: '2026-11-24T08:00:00',
                    horario_checagem_comparecimento: '2026-11-24T12:00:00',
                },
            ],
        ]);
        expect(resumo.remarcados).toBe(1);
    });

    it('antecipação que ultrapassa a etapa grava proximo_lembrete', async () => {
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-1, '2026-11-13T10:00:00')],
            negocios: [vinculado(-1, '2026-11-20', '10:00', 'd3_preparacao_consulta')],
        });
        await usecase.executar('agir');
        expect(chamadas.at(-1)).toEqual(['gravarCampos', 'deal1', { proximo_lembrete: 'd1' }]);
    });

    it('cancelado fecha como perdido e marca etapa cancelado', async () => {
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-1, '2026-11-20T10:00:00', 5)],
            negocios: [vinculado(-1, '2026-11-20', '10:00')],
        });
        const resumo = await usecase.executar('agir');
        expect(chamadas).toEqual([
            ['gravarCampos', 'deal1', { etapa_lembrete: 'cancelado' }],
            ['encerrarComoPerdido', 'deal1'],
        ]);
        expect(resumo.cancelados).toBe(1);
    });

    it('some da listagem mas existe no MedX não cancela', async () => {
        const { usecase, chamadas, agenda } = montar({
            agendamentos: [],
            negocios: [vinculado(-1, '2026-11-20', '10:00')],
            existe: true,
        });
        await usecase.executar('agir');
        expect(agenda.existe).toHaveBeenCalledWith(-1);
        expect(chamadas).toEqual([]);
    });

    it('some e não existe mais cancela', async () => {
        const { usecase, chamadas } = montar({
            agendamentos: [],
            negocios: [vinculado(-1, '2026-11-20', '10:00')],
            existe: false,
        });
        await usecase.executar('agir');
        expect(chamadas.at(-1)).toEqual(['encerrarComoPerdido', 'deal1']);
    });

    it('contato ambíguo põe tag nos candidatos e não cria', async () => {
        const { usecase, chamadas, crm } = montar({
            agendamentos: [ag(-3, '2026-11-20T10:00:00')],
            contato: {
                tipo: 'ambiguo',
                candidatos: [
                    { id: 'k', nome: 'Karmen', telefone: null },
                    { id: 's', nome: 'Silvia', telefone: null },
                ],
            },
        });
        await usecase.executar('agir');
        expect(crm.criarNegocio).not.toHaveBeenCalled();
        expect(chamadas).toEqual([
            ['adicionarTag', 'k', 'conferir agendamento MedX'],
            ['adicionarTag', 's', 'conferir agendamento MedX'],
        ]);
    });

    it('sem telefone nos dois sistemas cria com a tag', async () => {
        const { usecase, chamadas } = montar({ agendamentos: [ag(-4, '2026-11-20T10:00:00')] });
        await usecase.executar('agir');
        expect(chamadas.at(-1)).toEqual(['adicionarTag', 'c-novo', 'sem telefone no MedX']);
    });

    it('falha num agendamento não para a rodada', async () => {
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-1, '2026-11-24T10:00:00'), ag(-2, '2026-11-25T10:00:00')],
            negocios: [vinculado(-1, '2026-11-20', '10:00'), vinculado(-2, '2026-11-20', '10:00')],
            falharGravacaoEm: 'deal1',
        });
        const resumo = await usecase.executar('agir');
        expect(resumo.falhas).toBe(1);
        expect(chamadas.some(c => c[1] === 'deal2')).toBe(true);
    });

    it('modo observar não escreve nada', async () => {
        const { usecase, chamadas, logger } = montar({
            agendamentos: [ag(-7, '2026-11-20T10:00:00'), ag(-1, '2026-11-20T10:00:00', 5)],
            negocios: [vinculado(-1, '2026-11-20', '10:00')],
            contato: CONTATO,
        });
        const resumo = await usecase.executar('observar');
        expect(chamadas).toEqual([]);
        expect(resumo).toMatchObject({ criados: 1, cancelados: 1 });
        expect(logger.info).toHaveBeenCalled();
    });
});
