import { describe, it, expect } from 'vitest';
import { MedxCatalogoAdapter } from './medx-catalogo.adapter';
import type { MedxHttpClient } from './medx-http.client';

const PROFISSIONAIS = [
    {
        id: -692937676,
        nome: 'Leize',
        nomeCompleto: 'Leize Nachiesca Schiavini',
        ativo: true,
        agendavel: true,
    },
];
const TIPOS = [{ id: 111, nome: 'Consulta de Rotina', duracaoMinutos: 30 }];
const STATUS = [
    { id: 0, nome: 'Desmarcado' },
    { id: 1, nome: 'Agendado' },
    { id: 2, nome: 'Confirmado' },
    { id: 3, nome: 'Faltou' },
    { id: 5, nome: 'Cancelou' },
    { id: 11, nome: 'Finalizado Atendimento' },
];

function clientFalso(
    opcoes: { status?: Array<{ id: number; nome: string }>; falhas?: number } = {},
) {
    const chamadas: string[] = [];
    let falhasRestantes = opcoes.falhas ?? 0;
    const client = {
        async get<T>(caminho: string): Promise<T> {
            chamadas.push(caminho);
            if (falhasRestantes > 0) {
                falhasRestantes--;
                throw new Error('MedX fora do ar');
            }
            if (caminho === '/api/integration/v1/agenda/catalogos') {
                return {
                    status: opcoes.status ?? STATUS,
                    profissionais: [],
                    tipos: [],
                    setores: [],
                } as T;
            }
            throw new Error(`caminho inesperado: ${caminho}`);
        },
        async listarTodos<T>(caminho: string): Promise<T[]> {
            chamadas.push(caminho);
            if (caminho === '/api/integration/v1/agenda/tipos') return TIPOS as T[];
            if (caminho === '/api/integration/v1/financas/profissionais')
                return PROFISSIONAIS as T[];
            throw new Error(`caminho inesperado: ${caminho}`);
        },
    } as unknown as MedxHttpClient;
    return { client, chamadas };
}

describe('status pelo catálogo v1', () => {
    it('resolve status pelo nome no catálogo v1', async () => {
        const c = new MedxCatalogoAdapter(clientFalso().client);
        expect(await c.indiceStatusAgendado()).toBe(1);
        expect(await c.indiceStatusConfirmado()).toBe(2);
        expect(await c.indiceStatusFinalizado()).toBe(11);
        expect(await c.indicesStatusQueLiberamHorario()).toEqual([0, 5, 3]);
    });

    it('ignora acento e caixa e não confunde "Confirmação Pendente" com "Confirmado"', async () => {
        const c = new MedxCatalogoAdapter(
            clientFalso({
                status: [
                    { id: 7, nome: 'Confirmação Pendente' },
                    { id: 1, nome: 'AGENDADO' },
                    { id: 9, nome: 'confirmado' },
                ],
            }).client,
        );
        expect(await c.indiceStatusConfirmado()).toBe(9);
    });

    it('falha quando não existe rótulo de confirmação', async () => {
        const c = new MedxCatalogoAdapter(
            clientFalso({ status: [{ id: 1, nome: 'Agendado' }] }).client,
        );
        await expect(c.indiceStatusConfirmado()).rejects.toThrow(/Confirmado/);
    });

    it('devolve -1 quando a conta não tem Finalizado Atendimento', async () => {
        const c = new MedxCatalogoAdapter(
            clientFalso({ status: STATUS.filter(s => s.id !== 11) }).client,
        );
        expect(await c.indiceStatusFinalizado()).toBe(-1);
    });
});

describe('carregamento sob demanda', () => {
    it('carrega sob demanda na primeira consulta, sem carregar() prévio', async () => {
        const { client, chamadas } = clientFalso();
        const c = new MedxCatalogoAdapter(client);
        expect(chamadas).toHaveLength(0);
        await c.indiceStatusAgendado();
        expect(chamadas).toContain('/api/integration/v1/agenda/catalogos');
    });

    it('falha de carga não fica em cache: próxima chamada tenta de novo', async () => {
        const c = new MedxCatalogoAdapter(clientFalso({ falhas: 1 }).client);
        await expect(c.indiceStatusAgendado()).rejects.toThrow(/fora do ar/);
        expect(await c.indiceStatusAgendado()).toBe(1);
    });

    it('revalida o cache depois do TTL', async () => {
        let agora = 0;
        const { client, chamadas } = clientFalso();
        const c = new MedxCatalogoAdapter(client);
        c.ttlMs = 1000;
        c.agora = () => agora;
        await c.carregar();
        const antes = chamadas.length;
        agora = 2000;
        await c.resolverProfissional('Leize');
        expect(chamadas.length).toBeGreaterThan(antes);
    });
});

describe('resolução de profissional e tipo', () => {
    it('resolve profissional por nome ou nome completo, ignorando caixa e acento', async () => {
        const c = new MedxCatalogoAdapter(clientFalso().client);
        expect(await c.resolverProfissional('leize')).toBe(-692937676);
        expect(await c.resolverProfissional('  LEIZE nachiesca schiavini ')).toBe(-692937676);
    });

    it('aceita o id numérico direto sem consultar o catálogo', async () => {
        const { client, chamadas } = clientFalso();
        expect(await new MedxCatalogoAdapter(client).resolverProfissional('123')).toBe(123);
        expect(chamadas).toHaveLength(0);
    });

    it('resolve tipo devolvendo id, nome e duração', async () => {
        const c = new MedxCatalogoAdapter(clientFalso().client);
        expect(await c.resolverTipoConsulta('consulta de rotina')).toEqual({
            id: 111,
            nome: 'Consulta de Rotina',
            duracaoMinutos: 30,
        });
    });

    it('erra com mensagem útil quando o profissional não existe', async () => {
        const c = new MedxCatalogoAdapter(clientFalso().client);
        await expect(c.resolverProfissional('Fulano')).rejects.toThrow(/Fulano/);
    });
});
