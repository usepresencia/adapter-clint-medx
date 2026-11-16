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
        status,
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
        criadoEm: '2026-11-01T00:00:00Z',
        campos,
        ...extra,
    };
}

function montar(opcoes: {
    agendamentos: AgendamentoExterno[];
    negocios?: NegocioRecepcao[];
    contato?: ResultadoContato;
    existe?: boolean;
    foraDaJanela?: AgendamentoExterno[];
    falharGravacaoEm?: string;
}) {
    const chamadas: Array<[string, ...unknown[]]> = [];
    const agenda = {
        listarDetalhadosPorPeriodo: vi.fn(async () => opcoes.agendamentos),
        obterSeExistir: vi.fn(async (id: number) =>
            opcoes.existe === false ? null : (opcoes.foraDaJanela?.find(a => a.id === id) ?? null),
        ),
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
    const etapas = {
        criacao: 'b088f0ab-75d4-40df-80b5-53117d0f49aa',
        boasVindas: BOAS_VINDAS,
        endovenoso: ENDOVENOSO,
    };
    let agora = AGORA;
    const relogio = { agora: () => DateTime.fromISO(agora, { zone: 'America/Sao_Paulo' }) };
    const usecase = new MonitorarAgendaUseCase(
        agenda as any,
        catalogo as any,
        crm as any,
        contatos as any,
        resolvedor as any,
        logger,
        etapas,
        relogio,
    );
    return {
        usecase,
        chamadas,
        crm,
        agenda,
        logger,
        contatos,
        definirAgora: (v: string) => (agora = v),
    };
}

const CONTATO: ResultadoContato = {
    tipo: 'contato',
    contato: { id: 'c-1', nome: 'Maria', telefone: '+5545999197847' },
    telefone: null,
    nomeConfere: true,
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

    it('consulta nova grava etapa e proximo_lembrete sem nenhuma data', async () => {
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-7, '2026-11-20T10:00:00')],
            contato: CONTATO,
        });
        const resumo = await usecase.executar('agir');
        expect(chamadas.map(c => c[0])).toEqual([
            'criarNegocio',
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
        expect(chamadas[2]![2]).toEqual({ proximo_lembrete: 'd3' });
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
        expect(chamadas[2]![2]).toEqual({ proximo_lembrete: 'd1' });
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
        expect(JSON.stringify(chamadas)).not.toContain('data_agendamento');
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

    it('remarcação com etapa alcançável regrava as datas na mesma rodada', async () => {
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
                    horario_lembrete_chegada: '2026-11-24T08:00:00',
                    horario_checagem_comparecimento: '2026-11-24T12:00:00',
                },
            ],
            [
                'gravarCampos',
                'deal1',
                { data_agendamento: '2026-11-24', hora_agendamento: '10:00' },
            ],
        ]);
        expect(resumo.remarcados).toBe(1);
    });

    it('data_agendamento é a última chamada', async () => {
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-1, '2026-11-24T10:00:00')],
            negocios: [vinculado(-1, '2026-11-20', '10:00')],
        });
        await usecase.executar('agir');
        const campoDasChamadas = chamadas.map(c => Object.keys(c[2] as object));
        expect(campoDasChamadas.length).toBeGreaterThan(1);
        expect(campoDasChamadas.at(-1)).toContain('data_agendamento');
        expect(campoDasChamadas.slice(0, -1).flat()).not.toContain('data_agendamento');
    });

    it('remarcação com etapa ultrapassada grava só proximo_lembrete', async () => {
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-1, '2026-11-13T10:00:00')],
            negocios: [vinculado(-1, '2026-11-20', '10:00', 'd3_preparacao_consulta')],
        });
        await usecase.executar('agir');
        expect(chamadas).toEqual([['gravarCampos', 'deal1', { proximo_lembrete: 'd1' }]]);
    });

    it('rodada seguinte, com a etapa gravada pela automação, grava as datas', async () => {
        const criadoSemDatas = negocio('deal7', {
            id_agendamento_medx: '-7',
            etapa_lembrete: 'd3_preparacao_consulta',
            proximo_lembrete: 'd3',
        });
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-7, '2026-11-20T10:00:00')],
            negocios: [criadoSemDatas],
        });
        const resumo = await usecase.executar('agir');
        expect(chamadas.map(c => Object.keys(c[2] as object))).toEqual([
            ['horario_lembrete_chegada', 'horario_checagem_comparecimento'],
            ['data_agendamento', 'hora_agendamento'],
        ]);
        expect(resumo.remarcados).toBe(0);
    });

    it('enquanto a automação não gravou a etapa, não grava nenhuma data', async () => {
        const esperando = negocio('deal7', {
            id_agendamento_medx: '-7',
            etapa_lembrete: 'd0_boas_vindas',
            proximo_lembrete: 'd3',
        });
        const { usecase, chamadas, logger } = montar({
            agendamentos: [ag(-7, '2026-11-20T10:00:00')],
            negocios: [esperando],
        });
        const resumo = await usecase.executar('agir');
        expect(chamadas).toEqual([]);
        expect(logger.warn).not.toHaveBeenCalled();
        expect(resumo.remarcados).toBe(0);
    });

    it('data apagada pela automação com a etapa à frente é regravada sem proximo_lembrete', async () => {
        const semData = negocio('deal7', {
            id_agendamento_medx: '-7',
            etapa_lembrete: 'd0_chegada',
        });
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-7, '2026-11-12T15:00:00')],
            negocios: [semData],
        });
        await usecase.executar('agir');
        expect(JSON.stringify(chamadas)).not.toContain('proximo_lembrete');
        expect(chamadas.at(-1)).toEqual([
            'gravarCampos',
            'deal7',
            { data_agendamento: '2026-11-12', hora_agendamento: '15:00' },
        ]);
    });

    it('bloqueio a menos de 60 min do gatilho alerta e põe a tag', async () => {
        // agora = 12-nov 12:00; D1 da consulta de 13-nov dispara 12:45
        const preso = negocio('deal7', {
            id_agendamento_medx: '-7',
            etapa_lembrete: 'd0_boas_vindas',
            proximo_lembrete: 'd1',
        });
        const { usecase, chamadas, logger } = montar({
            agendamentos: [ag(-7, '2026-11-13T10:00:00')],
            negocios: [preso],
        });
        await usecase.executar('agir');
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ alerta: true, id_agendamento: -7 }),
            expect.any(String),
        );
        expect(chamadas).toEqual([['adicionarTag', 'c-deal7', 'conferir agendamento MedX']]);
    });

    it('depois do gatilho do passo esperado não alerta nem marca (D1 sai 30 min após a entrada)', async () => {
        // consulta de 13-nov: o D1 disparou 12-nov 12:45; agora são 13:00
        const preso = negocio('deal7', {
            id_agendamento_medx: '-7',
            etapa_lembrete: 'd0_boas_vindas',
            proximo_lembrete: 'd1',
        });
        const { usecase, chamadas, logger, definirAgora } = montar({
            agendamentos: [ag(-7, '2026-11-13T10:00:00')],
            negocios: [preso],
        });
        definirAgora('2026-11-12T13:00:00');
        await usecase.executar('agir');
        expect(logger.warn).not.toHaveBeenCalled();
        expect(chamadas).toEqual([]);
    });

    it('limite de requisições no início da rodada encerra sem erro e sem alerta', async () => {
        const { usecase, agenda, logger, chamadas } = montar({ agendamentos: [] });
        agenda.listarDetalhadosPorPeriodo.mockRejectedValue(
            Object.assign(new Error('429'), { name: 'ErroRateLimit' }),
        );
        const resumo = await usecase.executar('agir');
        expect(resumo.falhas).toBe(0);
        expect(chamadas).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(
            expect.not.objectContaining({ alerta: true }),
            expect.stringContaining('limite de requisições'),
        );
    });

    it('outro erro no início da rodada continua subindo', async () => {
        const { usecase, agenda } = montar({ agendamentos: [] });
        agenda.listarDetalhadosPorPeriodo.mockRejectedValue(new Error('MedX 500'));
        await expect(usecase.executar('agir')).rejects.toThrow('MedX 500');
    });

    it('contato cujo negócio mais novo não tem o id do MedX alerta e põe a tag', async () => {
        // a automação de data roda no negócio mais recente: sem id, a checagem manda payload vazio
        const antigo = negocio(
            'deal1',
            { id_agendamento_medx: '-1', etapa_lembrete: 'd3_preparacao_consulta' },
            { contatoId: 'c-dup', criadoEm: '2026-11-10T10:00:00Z' },
        );
        const novo = negocio('deal2', {}, { contatoId: 'c-dup', criadoEm: '2026-11-12T09:00:00Z' });
        const { usecase, chamadas, logger } = montar({
            agendamentos: [],
            negocios: [antigo, novo],
        });
        await usecase.executar('agir');
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ alerta: true, contato: 'c-dup' }),
            expect.any(String),
        );
        expect(chamadas).toEqual([['adicionarTag', 'c-dup', 'conferir agendamento MedX']]);
    });

    it('contato com dois negócios em que o mais novo já tem o id não alerta', async () => {
        const antigo = negocio(
            'deal1',
            {},
            { contatoId: 'c-dup', criadoEm: '2026-11-10T10:00:00Z' },
        );
        const novo = negocio(
            'deal2',
            { id_agendamento_medx: '-2', etapa_lembrete: 'd3_preparacao_consulta' },
            { contatoId: 'c-dup', criadoEm: '2026-11-12T09:00:00Z' },
        );
        const { usecase, chamadas, logger } = montar({
            agendamentos: [],
            negocios: [antigo, novo],
        });
        await usecase.executar('agir');
        expect(logger.warn).not.toHaveBeenCalled();
        expect(chamadas).toEqual([]);
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

    it('some da listagem porque foi remarcado para depois da janela: regrava as datas', async () => {
        const { usecase, chamadas, agenda } = montar({
            agendamentos: [],
            negocios: [vinculado(-1, '2026-11-20', '10:00')],
            foraDaJanela: [ag(-1, '2026-12-20T10:00:00')],
        });
        await usecase.executar('agir');
        expect(agenda.obterSeExistir).toHaveBeenCalledWith(-1);
        expect(chamadas.at(-1)).toEqual([
            'gravarCampos',
            'deal1',
            { data_agendamento: '2026-12-20', hora_agendamento: '10:00' },
        ]);
        expect(chamadas.some(c => c[0] === 'encerrarComoPerdido')).toBe(false);
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
                porTelefone: true,
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

    it('ambíguo só pelo nome não marca ninguém', async () => {
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-3, '2026-11-20T10:00:00')],
            contato: {
                tipo: 'ambiguo',
                porTelefone: false,
                candidatos: [{ id: 'k', nome: 'Maria Souza', telefone: null }],
            },
        });
        await usecase.executar('agir');
        expect(chamadas).toEqual([]);
    });

    it('limite de requisições do MedX encerra a rodada sem marcar o resto como falha', async () => {
        const { usecase, crm } = montar({
            agendamentos: [ag(-7, '2026-11-20T10:00:00'), ag(-8, '2026-11-21T10:00:00')],
            contato: CONTATO,
        });
        const limite = Object.assign(new Error('Rate limit do MedX atingido'), {
            name: 'ErroRateLimit',
        });
        crm.criarNegocio.mockRejectedValueOnce(limite);
        const resumo = await usecase.executar('agir');
        expect(crm.criarNegocio).toHaveBeenCalledTimes(1);
        expect(resumo.falhas).toBe(1);
    });

    it('passa o telefone do agendamento (sms) ao resolver o contato', async () => {
        const { usecase } = montar({
            agendamentos: [
                ag(-7, '2026-11-20T10:00:00', 1, {
                    bruto: { sms: '45999197847', paciente: { nome: 'MARIA SILVA' } },
                }),
            ],
            contato: CONTATO,
        });
        const resolver = (usecase as any).resolvedor.resolver;
        await usecase.executar('agir');
        expect(resolver).toHaveBeenCalledWith(
            { idPaciente: 507, nome: 'MARIA SILVA', telefone: '45999197847' },
            expect.anything(),
        );
    });

    it('com dois negócios abertos sem id, assume o da etapa que combina com o tipo', async () => {
        const doEndovenoso = negocio('endo', {}, { contatoId: 'c-1', etapaId: ENDOVENOSO });
        const daConsulta = negocio('consulta', {}, { contatoId: 'c-1', etapaId: BOAS_VINDAS });
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-9, '2026-11-20T10:00:00')],
            negocios: [doEndovenoso, daConsulta],
            contato: CONTATO,
        });
        await usecase.executar('agir');
        expect(chamadas[0]![1]).toBe('consulta');
    });

    it('dois agendamentos do mesmo contato na mesma rodada não assumem o mesmo negócio', async () => {
        const aberto = negocio('aberto', {}, { contatoId: 'c-1' });
        const { usecase, crm } = montar({
            agendamentos: [ag(-9, '2026-11-20T10:00:00'), ag(-10, '2026-11-27T10:00:00')],
            negocios: [aberto],
            contato: CONTATO,
        });
        const resumo = await usecase.executar('agir');
        expect(resumo.assumidos).toBe(1);
        expect(crm.criarNegocio).toHaveBeenCalledTimes(1);
    });

    it('agendamento de hoje que já passou e sem negócio é ignorado', async () => {
        const { usecase, crm } = montar({
            agendamentos: [ag(-11, '2026-11-12T09:00:00')],
            contato: CONTATO,
        });
        const resumo = await usecase.executar('agir');
        expect(crm.criarNegocio).not.toHaveBeenCalled();
        expect(resumo.ignorados).toBe(1);
    });

    it('termina a criação de um negócio que ficou parado em AGENDAMENTO', async () => {
        const parado = negocio(
            'parado',
            { id_agendamento_medx: '-12', etapa_lembrete: 'd0_boas_vindas' },
            { etapaId: 'b088f0ab-75d4-40df-80b5-53117d0f49aa' },
        );
        const { usecase, chamadas } = montar({
            agendamentos: [ag(-12, '2026-11-20T10:00:00')],
            negocios: [parado],
        });
        await usecase.executar('agir');
        expect(chamadas.map(c => c[0])).toEqual(['moverParaBoasVindas', 'gravarCampos']);
        expect(chamadas.at(-1)).toEqual(['gravarCampos', 'parado', { proximo_lembrete: 'd3' }]);
    });

    it('contato com negócio novo ainda sem id em AGENDAMENTO fica para a próxima rodada', async () => {
        const pendente = negocio(
            'pendente',
            {},
            { contatoId: 'c-1', etapaId: 'b088f0ab-75d4-40df-80b5-53117d0f49aa' },
        );
        const { usecase, crm } = montar({
            agendamentos: [ag(-13, '2026-11-20T10:00:00')],
            negocios: [pendente],
            contato: CONTATO,
        });
        await usecase.executar('agir');
        expect(crm.criarNegocio).not.toHaveBeenCalled();
    });

    it('telefone de um contato só, com nome diferente, cria negócio novo em vez de assumir o dele', async () => {
        const daMae = negocio('mae', {}, { contatoId: 'c-1' });
        const { usecase, crm } = montar({
            agendamentos: [ag(-14, '2026-11-20T10:00:00')],
            negocios: [daMae],
            contato: { ...CONTATO, nomeConfere: false } as ResultadoContato,
        });
        await usecase.executar('agir');
        expect(crm.criarNegocio).toHaveBeenCalledWith(
            expect.objectContaining({ contatoId: 'c-1' }),
        );
    });
});
