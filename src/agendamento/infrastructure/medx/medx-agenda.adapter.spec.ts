import { describe, it, expect } from 'vitest';
import { MedxAgendaAdapter, CONFIRMACAO_LITERAL } from './medx-agenda.adapter';
import type { MedxHttpClient } from './medx-http.client';
import type { MedxAgendamento } from './medx.tipos';

// A doc do MedX documenta PascalCase (Id_do_Agendamento, Vinculado_a...), mas
// a API real observada em produção devolve snake_case minúsculo — tratamos a
// doc como desatualizada e seguimos o comportamento real (confirmado via
// GET /agenda/agendamentos/paciente/{id} ao vivo).
const CRU: MedxAgendamento & { CampoQueNaoModelamos: string } = {
    id_do_Agendamento: 1275002478,
    id_do_Usuario: 43013640,
    inicio: '2026-07-10T14:00:00',
    final: '2026-07-10T14:30:00',
    descricao: 'Consulta de Rotina — Maria Silva',
    status: 0,
    vinculado_a: 30094605,
    id_do_Diagnostico_QP: 111,
    confirmacao: '',
    lastEditDate: '2026-07-09T10:00:00',
    CampoQueNaoModelamos: 'precisa sobreviver ao PUT',
};

function clientFalso(resposta: unknown) {
    const enviados: Array<{ caminho: string; corpo?: unknown; query?: unknown }> = [];
    const client = {
        get: async <T>(caminho: string, query?: unknown) => {
            enviados.push({ caminho, query });
            return resposta as T;
        },
        post: async <T>(caminho: string, corpo: unknown) => {
            enviados.push({ caminho, corpo });
            return resposta as T;
        },
        put: async <T>(caminho: string, corpo: unknown) => {
            enviados.push({ caminho, corpo });
            return 'Agendamento atualizado com sucesso.' as T;
        },
    } as unknown as MedxHttpClient;
    return { client, enviados };
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
    it('devolve o inteiro que o MedX retorna', async () => {
        const { client } = clientFalso(1275002478);
        expect(await new MedxAgendaAdapter(client).criar(CRIACAO, 0)).toBe(1275002478);
    });

    it('mapeia para os nomes exatos da API e nasce com o índice de "Agendado" recebido', async () => {
        const { client, enviados } = clientFalso(1);
        await new MedxAgendaAdapter(client).criar(CRIACAO, 0);

        expect(enviados[0]).toEqual({
            caminho: '/api/integration/agenda/agendamentos',
            corpo: {
                Id_do_Usuario: 43013640,
                Inicio: '2026-07-10T14:00:00',
                Final: '2026-07-10T14:30:00',
                Descricao: 'Consulta de Rotina — Maria Silva',
                Status: 0,
                Vinculado_a: 30094605,
                Id_do_TipoConsulta: 111,
            },
        });
    });

    it('usa o índice de "Agendado" recebido, nunca um valor fixo', async () => {
        const { client, enviados } = clientFalso(1);
        await new MedxAgendaAdapter(client).criar(CRIACAO, 3);

        const corpo = enviados[0]!.corpo as Record<string, unknown>;
        expect(corpo.Status).toBe(3);
    });

    it('rejeita retorno que não é um id válido, sem serializar a resposta na mensagem', async () => {
        const { client } = clientFalso({ Descricao: 'contém nome da paciente' });
        await expect(new MedxAgendaAdapter(client).criar(CRIACAO, 0)).rejects.toThrow(/id/i);
        await expect(new MedxAgendaAdapter(client).criar(CRIACAO, 0)).rejects.not.toThrow(
            /nome da paciente/,
        );
    });

    it('aceita id negativo — confirmado ao vivo que esta conta usa ids negativos', async () => {
        const { client } = clientFalso(-1452025979);
        expect(await new MedxAgendaAdapter(client).criar(CRIACAO, 0)).toBe(-1452025979);
    });

    it('rejeita zero como id (provável sentinela de falha)', async () => {
        const { client } = clientFalso(0);
        await expect(new MedxAgendaAdapter(client).criar(CRIACAO, 0)).rejects.toThrow(/id/i);
    });
});

describe('obter', () => {
    it('desembrulha o array que a API devolve e traduz para o port', async () => {
        const { client } = clientFalso([CRU]);
        const externo = await new MedxAgendaAdapter(client).obter(1275002478);

        expect(externo.id).toBe(1275002478);
        expect(externo.idProfissional).toBe(43013640);
        expect(externo.idPaciente).toBe(30094605);
        expect(externo.inicio).toBe('2026-07-10T14:00:00');
        expect(externo.ultimaEdicao).toBe('2026-07-09T10:00:00');
    });

    it('guarda o payload cru inteiro em bruto', async () => {
        const { client } = clientFalso([CRU]);
        const externo = await new MedxAgendaAdapter(client).obter(1275002478);
        expect((externo.bruto as any).CampoQueNaoModelamos).toBe('precisa sobreviver ao PUT');
    });

    it('erra quando o agendamento não existe', async () => {
        const { client } = clientFalso([]);
        await expect(new MedxAgendaAdapter(client).obter(999)).rejects.toThrow(/999/);
    });
});

describe('confirmar', () => {
    it('envia a string literal exigida e o índice recebido', async () => {
        const { client, enviados } = clientFalso([CRU]);
        const agenda = new MedxAgendaAdapter(client);
        const externo = await agenda.obter(1275002478);
        enviados.length = 0;

        await agenda.confirmar(externo, 1);

        const corpo = enviados[0]!.corpo as Record<string, unknown>;
        expect(enviados[0]!.caminho).toBe('/api/integration/agenda/agendamentos');
        expect(corpo.status).toBe(1);
        expect(corpo.confirmacao).toBe(CONFIRMACAO_LITERAL);
        expect(corpo.confirmacao).toBe('Mensagem Salva com Sucesso');
    });

    it('preserva os campos que o port não modela', async () => {
        const { client, enviados } = clientFalso([CRU]);
        const agenda = new MedxAgendaAdapter(client);
        const externo = await agenda.obter(1275002478);
        enviados.length = 0;

        await agenda.confirmar(externo, 1);

        expect((enviados[0]!.corpo as any).CampoQueNaoModelamos).toBe('precisa sobreviver ao PUT');
    });

    it('envia o objeto completo que o PUT exige', async () => {
        const { client, enviados } = clientFalso([CRU]);
        const agenda = new MedxAgendaAdapter(client);
        const externo = await agenda.obter(1275002478);
        enviados.length = 0;

        await agenda.confirmar(externo, 1);

        const corpo = enviados[0]!.corpo as Record<string, unknown>;
        for (const campo of [
            'id_do_Agendamento',
            'id_do_Usuario',
            'inicio',
            'final',
            'descricao',
            'status',
            'vinculado_a',
            'id_do_Diagnostico_QP',
        ]) {
            expect(corpo).toHaveProperty(campo);
        }
    });
});

describe('consultarDisponibilidade', () => {
    it('combina o dia real (campo data) com a hora de de/ate, ignorando a data-base bugada delas', async () => {
        // Confirmado ao vivo: `de`/`ate` sempre trazem a MESMA data-base (não o
        // dia do slot) — só a hora deles é significativa. Quem informa o dia
        // real é o campo `data`. Exemplo real observado em produção:
        const { client, enviados } = clientFalso([
            {
                data: '2026-09-22T00:00:00',
                de: '2026-09-21T08:00:00+00:00',
                ate: '2026-09-21T09:00:00+00:00',
            },
            {
                data: '2026-09-23T00:00:00',
                de: '2026-09-21T08:00:00+00:00',
                ate: '2026-09-21T09:00:00+00:00',
            },
        ]);

        const slots = await new MedxAgendaAdapter(client).consultarDisponibilidade({
            idProfissional: 43013640,
            inicio: '2026-09-22T00:00:00',
            fim: '2026-09-28T23:59:59',
            duracaoMinutos: 60,
        });

        // proId NÃO é enviado: confirmado ao vivo que qualquer id negativo
        // (o único tipo que esta conta usa para profissional) zera a resposta
        // — é um bug do MedX, não algo que dá pra contornar do nosso lado.
        expect(enviados[0]!.caminho).toBe('/api/integration/agenda/disponibilidade');
        expect(enviados[0]!.query).toEqual({
            inicio: '2026-09-22T00:00:00',
            fim: '2026-09-28T23:59:59',
            intervalo: 60,
        });
        expect(slots).toEqual([
            { inicio: '2026-09-22T08:00:00', fim: '2026-09-22T09:00:00' },
            { inicio: '2026-09-23T08:00:00', fim: '2026-09-23T09:00:00' },
        ]);
    });

    it('devolve lista vazia quando a API não retorna array', async () => {
        const { client } = clientFalso(null);
        expect(
            await new MedxAgendaAdapter(client).consultarDisponibilidade({
                idProfissional: 1,
                inicio: '2026-07-10T00:00:00',
                fim: '2026-07-10T23:59:59',
                duracaoMinutos: 30,
            }),
        ).toEqual([]);
    });
});

describe('listarPorPaciente', () => {
    it('traduz cada item para o port', async () => {
        const { client } = clientFalso([CRU]);
        const lista = await new MedxAgendaAdapter(client).listarPorPaciente(30094605);
        expect(lista).toHaveLength(1);
        expect(lista[0]!.id).toBe(1275002478);
    });

    it('devolve lista vazia quando a API não retorna array', async () => {
        const { client } = clientFalso(null);
        expect(await new MedxAgendaAdapter(client).listarPorPaciente(1)).toEqual([]);
    });
});
