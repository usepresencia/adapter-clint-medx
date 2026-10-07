import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ClintWebhookAdapter } from './clint-webhook.adapter';
import { Telefone } from '../../domain/paciente/telefone';

afterEach(() => vi.restoreAllMocks());

const TELEFONE = Telefone.criar('+55 45 98838-3189');

const URLS: Record<string, string> = {
    CLINT_WEBHOOK_AGENDAMENTO_URL: 'https://clint.test/in/agendamento',
    CLINT_WEBHOOK_NOTIFICACAO_URL: 'https://clint.test/in/notificacao',
};

function configFalso(): ConfigService {
    return { get: (chave: string) => URLS[chave] } as ConfigService;
}

function corpoDe(chamada: [any, any]): Record<string, unknown> {
    return JSON.parse(String(chamada[1].body));
}

function espiar() {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
}

describe('gravarIdAgendamento', () => {
    it('posta o id, o telefone, a data e a hora no formato HH:mm na url de agendamento', async () => {
        const spy = espiar();
        await new ClintWebhookAdapter(configFalso()).gravarIdAgendamento(
            'deal-1',
            1275002478,
            TELEFONE,
            '2026-07-10T14:00:00',
        );

        expect(String(spy.mock.calls[0]![0])).toBe(URLS.CLINT_WEBHOOK_AGENDAMENTO_URL);
        expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({
            deal_id: 'deal-1',
            id_agendamento_medx: 1275002478,
            telefone: '+5545988383189',
            data_agendamento: '2026-07-10',
            hora_agendamento: '14:00',
        });
    });

    it('envia content-type json', async () => {
        const spy = espiar();
        await new ClintWebhookAdapter(configFalso()).gravarIdAgendamento(
            'deal-1',
            1,
            TELEFONE,
            '2026-07-10T14:00:00',
        );
        const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>;
        expect(headers['content-type']).toBe('application/json');
    });
});

describe('notificações', () => {
    // O webhook de entrada do Clint identifica o negócio por email, telefone
    // ou instagram (confirmado ao vivo) — nunca só pelo deal_id.
    it.each([
        ['notificarConfirmacao', 'confirmado'],
        ['notificarReagendamento', 'reagendamento_solicitado'],
        ['notificarCancelamento', 'cancelamento_solicitado'],
    ])('%s posta o evento %s com telefone na url de notificação', async (metodo, evento) => {
        const spy = espiar();
        await (new ClintWebhookAdapter(configFalso()) as any)[metodo]('deal-1', TELEFONE);

        expect(String(spy.mock.calls[0]![0])).toBe(URLS.CLINT_WEBHOOK_NOTIFICACAO_URL);
        expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({
            deal_id: 'deal-1',
            evento,
            telefone: '+5545988383189',
        });
    });

    it('inclui o motivo ao notificar conflito', async () => {
        const spy = espiar();
        await new ClintWebhookAdapter(configFalso()).notificarConflito(
            'deal-1',
            'horário alterado',
            TELEFONE,
        );

        expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({
            deal_id: 'deal-1',
            evento: 'conflito',
            motivo: 'horário alterado',
            telefone: '+5545988383189',
        });
    });
});

describe('falhas', () => {
    it('lança quando o Clint responde erro, para o job tentar de novo', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
        await expect(
            new ClintWebhookAdapter(configFalso()).gravarIdAgendamento(
                'deal-1',
                1,
                TELEFONE,
                '2026-07-10T14:00:00',
            ),
        ).rejects.toThrow(/500/);
    });

    it('propaga falha de rede', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
        await expect(
            new ClintWebhookAdapter(configFalso()).notificarConfirmacao('deal-1', TELEFONE),
        ).rejects.toThrow(/ECONNREFUSED/);
    });
});
