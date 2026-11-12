import { describe, it, expect } from 'vitest';
import { MedxAgendaAdapter } from './medx-agenda.adapter';
import type { MedxHttpClient } from './medx-http.client';
import type { MedxAgendaDetalhe } from './medx.tipos';

const DETALHE: MedxAgendaDetalhe = {
    id: -1646861682,
    inicio: '2026-11-12T10:10:00-03:00',
    fim: '2026-11-12T10:20:00-03:00',
    profissional: { id: -692937676, nome: 'Leize' },
    paciente: { id: 30094605, nome: 'Maria Silva' },
    tipo: { id: 111, nome: 'Consulta' },
    procedimentoId: null,
    status: { id: 2, nome: 'Confirmado' },
    descricao: 'Consulta — Maria Silva',
    confirmacao: '',
    sms: '44999999999',
    chegada: null,
    atendidoEm: null,
    saiuEm: null,
    atualizadoEm: '2026-11-11T10:12:00-03:00',
    versao: 'v-abc',
};

type Chamada = {
    metodo: string;
    caminho: string;
    corpo?: unknown;
    query?: Record<string, unknown>;
};

function clientFalso(opcoes: {
    get?: unknown;
    paginas?: (q: Record<string, unknown>) => unknown[];
    post?: unknown;
}) {
    const chamadas: Chamada[] = [];
    const client = {
        get: async <T>(caminho: string, query?: Record<string, unknown>) => {
            chamadas.push({ metodo: 'get', caminho, query });
            return opcoes.get as T;
        },
        listarTodos: async <T>(caminho: string, query?: Record<string, unknown>) => {
            chamadas.push({ metodo: 'listarTodos', caminho, query });
            return (opcoes.paginas?.(query ?? {}) ?? []) as T[];
        },
        post: async <T>(caminho: string, corpo: unknown) => {
            chamadas.push({ metodo: 'post', caminho, corpo });
            return opcoes.post as T;
        },
        executarOperacao: async <T>(caminho: string, corpo: unknown) => {
            chamadas.push({ metodo: 'executarOperacao', caminho, corpo });
            return opcoes.post as T;
        },
    } as unknown as MedxHttpClient;
    return { client, chamadas };
}

const CRIACAO = {
    idProfissional: 43013640,
    idPaciente: 30094605,
    inicio: '2026-07-10T14:00:00',
    fim: '2026-07-10T14:30:00',
    descricao: 'Consulta de Rotina — Maria Silva',
    idTipoConsulta: 111,
};

describe('criar', () => {
    it('criar usa cadastros/criar_agendamento com a descrição e devolve o id', async () => {
        const { client, chamadas } = clientFalso({
            post: { dados: { id: -123, recurso: 'agendamento' } },
        });

        const id = await new MedxAgendaAdapter(client).criar(CRIACAO);

        expect(id).toBe(-123);
        expect(chamadas[0]).toEqual({
            metodo: 'executarOperacao',
            caminho: '/api/integration/v1/agenda/cadastros',
            corpo: {
                acao: 'criar_agendamento',
                agendamento: {
                    profissionalId: 43013640,
                    pacienteId: 30094605,
                    tipoId: 111,
                    inicio: '2026-07-10T14:00:00',
                    fim: '2026-07-10T14:30:00',
                    descricao: 'Consulta de Rotina — Maria Silva',
                },
            },
        });
    });

    it('rejeita id zero sem serializar a resposta na mensagem', async () => {
        const { client } = clientFalso({
            post: { agendamento: { id: 0, descricao: 'Maria Silva' } },
        });
        const erro = await new MedxAgendaAdapter(client).criar(CRIACAO).catch(e => e as Error);
        expect(erro.message).toMatch(/id de agendamento válido/);
        expect(erro.message).not.toMatch(/Maria/);
    });
});

describe('confirmar', () => {
    it('confirmar reenvia todos os campos do detalhe com versao e status confirmado', async () => {
        const { client, chamadas } = clientFalso({ get: DETALHE, post: {} });
        const agenda = new MedxAgendaAdapter(client);
        const externo = await agenda.obter(-1646861682);
        chamadas.length = 0;

        await agenda.confirmar(externo, 2);

        expect(chamadas[0]).toEqual({
            metodo: 'executarOperacao',
            caminho: '/api/integration/v1/agenda/cadastros',
            corpo: {
                acao: 'atualizar_agendamento',
                agendamento: {
                    id: -1646861682,
                    profissionalId: -692937676,
                    pacienteId: 30094605,
                    tipoId: 111,
                    procedimentoId: null,
                    inicio: '2026-11-12T10:10:00-03:00',
                    fim: '2026-11-12T10:20:00-03:00',
                    status: 2,
                    descricao: 'Consulta — Maria Silva',
                    confirmacao: 'Mensagem Salva com Sucesso',
                    sms: '44999999999',
                    chegada: null,
                    atendidoEm: null,
                    saiuEm: null,
                    versao: 'v-abc',
                },
            },
        });
    });
});

describe('obter', () => {
    it('obter traduz o detalhe v1 e guarda o bruto com versao', async () => {
        const { client, chamadas } = clientFalso({ get: DETALHE });
        const externo = await new MedxAgendaAdapter(client).obter(-1646861682);

        expect(chamadas[0]!.caminho).toBe(
            '/api/integration/v1/agenda/agendamentos/-1646861682/detalhes',
        );
        expect(externo).toMatchObject({
            id: -1646861682,
            idProfissional: -692937676,
            idPaciente: 30094605,
            inicio: '2026-11-12T10:10:00',
            fim: '2026-11-12T10:20:00',
            status: 2,
            idTipoConsulta: 111,
            ultimaEdicao: '2026-11-11T10:12:00-03:00',
        });
        expect((externo.bruto as MedxAgendaDetalhe).versao).toBe('v-abc');
    });

    it('obter aceita paciente e tipo nulos', async () => {
        const { client } = clientFalso({ get: { ...DETALHE, paciente: null, tipo: null } });
        const externo = await new MedxAgendaAdapter(client).obter(1);
        expect(externo.idPaciente).toBe(0);
        expect(externo.idTipoConsulta).toBe(0);
    });

    it('erra quando o agendamento não existe', async () => {
        const { client } = clientFalso({ get: undefined });
        await expect(new MedxAgendaAdapter(client).obter(1)).rejects.toThrow(/não encontrado/);
    });
});

describe('confirmar sem profissional ou paciente', () => {
    it('rejeita antes de chamar o MedX quando o detalhe não tem profissional ou paciente', async () => {
        for (const faltando of [{ profissional: null }, { paciente: null }]) {
            const { client, chamadas } = clientFalso({
                get: { ...DETALHE, ...faltando },
                post: {},
            });
            const agenda = new MedxAgendaAdapter(client);
            const externo = await agenda.obter(-1646861682);
            chamadas.length = 0;

            await expect(agenda.confirmar(externo, 2)).rejects.toThrow(
                /sem profissional ou paciente/,
            );
            expect(chamadas).toHaveLength(0);
        }
    });
});

describe('listarPorPaciente', () => {
    it('usa a rota v1 paginada e traduz cada item', async () => {
        const { client, chamadas } = clientFalso({ paginas: () => [DETALHE] });
        const lista = await new MedxAgendaAdapter(client).listarPorPaciente(30094605);
        expect(chamadas[0]).toMatchObject({
            metodo: 'listarTodos',
            caminho: '/api/integration/v1/agenda/agendamentos/paciente/30094605',
        });
        expect(lista[0]!.inicio).toBe('2026-11-12T10:10:00');
    });
});

describe('listarPorPeriodo', () => {
    it('listarPorPeriodo divide 45 dias em duas janelas de no máximo 31 dias sem duplicar', async () => {
        const fronteira = {
            ...DETALHE,
            id: 9,
            inicio: '2026-12-02T09:00:00-03:00',
            fim: '2026-12-02T09:10:00-03:00',
        };
        const { client, chamadas } = clientFalso({ paginas: () => [fronteira] });

        const ocupacao = await new MedxAgendaAdapter(client).listarPorPeriodo(
            '2026-11-01T00:00:00',
            '2026-12-16T00:00:00',
        );

        expect(chamadas).toHaveLength(2);
        expect(chamadas[0]!.caminho).toBe('/api/integration/v1/agenda/agendamentos/detalhes');
        expect(chamadas[0]!.query).toEqual({
            Inicio: '2026-11-01T00:00:00',
            Fim: '2026-12-02T00:00:00',
        });
        expect(chamadas[1]!.query).toEqual({
            Inicio: '2026-12-02T00:00:00',
            Fim: '2026-12-16T00:00:00',
        });
        expect(ocupacao).toEqual([
            {
                idProfissional: -692937676,
                inicio: '2026-12-02T09:00:00',
                fim: '2026-12-02T09:10:00',
                status: 2,
            },
        ]);
    });

    it('uma janela curta faz uma chamada só', async () => {
        const { client, chamadas } = clientFalso({ paginas: () => [] });
        await new MedxAgendaAdapter(client).listarPorPeriodo(
            '2026-11-12T00:00:00',
            '2026-11-12T23:59:59',
        );
        expect(chamadas).toHaveLength(1);
        expect(chamadas[0]!.query).toEqual({
            Inicio: '2026-11-12T00:00:00',
            Fim: '2026-11-12T23:59:59',
        });
    });
});

describe('consultarDisponibilidade', () => {
    it('consultarDisponibilidade envia ProfissionalId (obrigatório na v1) e normaliza o offset', async () => {
        const { client, chamadas } = clientFalso({
            get: {
                horarios: [
                    { inicio: '2026-11-20T09:00:00-03:00', fim: '2026-11-20T09:30:00-03:00' },
                ],
            },
        });

        const slots = await new MedxAgendaAdapter(client).consultarDisponibilidade({
            idProfissional: -692937676,
            inicio: '2026-11-20T00:00:00',
            fim: '2026-11-21T00:00:00',
            duracaoMinutos: 30,
        });

        expect(chamadas[0]!.caminho).toBe('/api/integration/v1/agenda/disponibilidade');
        expect(chamadas[0]!.query).toEqual({
            ProfissionalId: -692937676,
            Inicio: '2026-11-20T00:00:00',
            Fim: '2026-11-21T00:00:00',
            DuracaoMinutos: 30,
        });
        expect(slots).toEqual([{ inicio: '2026-11-20T09:00:00', fim: '2026-11-20T09:30:00' }]);
    });

    it('divide a disponibilidade em janelas de no máximo 14 dias', async () => {
        const { client, chamadas } = clientFalso({
            get: {
                horarios: [
                    { inicio: '2026-11-20T09:00:00-03:00', fim: '2026-11-20T09:30:00-03:00' },
                ],
            },
        });

        const slots = await new MedxAgendaAdapter(client).consultarDisponibilidade({
            idProfissional: -692937676,
            inicio: '2026-11-16T00:00:00',
            fim: '2026-12-06T00:00:00',
            duracaoMinutos: 30,
        });

        expect(chamadas.map(c => [c.query!.Inicio, c.query!.Fim])).toEqual([
            ['2026-11-16T00:00:00', '2026-11-30T00:00:00'],
            ['2026-11-30T00:00:00', '2026-12-06T00:00:00'],
        ]);
        expect(slots).toHaveLength(2);
    });

    it('devolve lista vazia quando a resposta não traz horarios', async () => {
        const { client } = clientFalso({ get: {} });
        const slots = await new MedxAgendaAdapter(client).consultarDisponibilidade({
            idProfissional: 1,
            inicio: '2026-11-20T00:00:00',
            fim: '2026-11-21T00:00:00',
            duracaoMinutos: 30,
        });
        expect(slots).toEqual([]);
    });
});
