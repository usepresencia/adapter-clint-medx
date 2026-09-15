import { describe, it, expect, vi } from 'vitest';
import { WebhooksController } from './webhooks.controller';

function montar() {
    const eventos = {
        registrar: vi.fn(async (endpoint: string, payload: unknown) => ({
            id: 1,
            marcarInvalido: vi.fn(),
            marcarFalha: vi.fn(),
            associarJob: vi.fn(),
        })),
        salvar: vi.fn(async () => {}),
    };
    const fila = { add: vi.fn(async () => ({ id: 'job-1' })) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const config = {
        get: (chave: string) => (chave === 'ADAPTER_SECRET' ? 'segredo-certo' : undefined),
    };

    const controller = new WebhooksController(
        fila as any,
        eventos as any,
        logger as any,
        config as any,
    );
    return { eventos, fila, logger, controller };
}

const AGENDAMENTO = {
    deal_id: '8feade82-d77b-4e8b-9d35-fd43e972b5c8',
    nome: 'Maria Silva',
    telefone: '+5511999998888',
    data_nascimento: '1990-05-20',
    data_hora: '2026-07-10T14:00:00-03:00',
    profissional: 'Leize Ferreira',
    tipo_consulta: 'Consulta de Rotina',
};

describe('WebhooksController.agendamento', () => {
    it('recusa sem o segredo certo, mas ainda responde ok', async () => {
        const { controller, fila } = montar();
        const r = await controller.agendamento('errado', AGENDAMENTO);
        expect(r).toEqual({ ok: true });
        expect(fila.add).not.toHaveBeenCalled();
    });

    it('grava o evento e enfileira com o segredo certo', async () => {
        const { controller, eventos, fila } = montar();
        const r = await controller.agendamento('segredo-certo', AGENDAMENTO);
        expect(r).toEqual({ ok: true });
        expect(eventos.registrar).toHaveBeenCalled();
        expect(fila.add).toHaveBeenCalledTimes(1);
    });

    it('marca inválido e não enfileira quando falta campo obrigatório', async () => {
        const { controller, fila } = montar();
        const { telefone, ...semTelefone } = AGENDAMENTO;
        const r = await controller.agendamento('segredo-certo', semTelefone);
        expect(r).toEqual({ ok: true });
        expect(fila.add).not.toHaveBeenCalled();
    });
});
