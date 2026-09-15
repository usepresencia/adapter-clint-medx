import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ClintWebhookAdapter } from './clint-webhook.adapter';

afterEach(() => vi.restoreAllMocks());

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
    it('posta o id na url de agendamento', async () => {
        const spy = espiar();
        await new ClintWebhookAdapter(configFalso()).gravarIdAgendamento('deal-1', 1275002478);

        expect(String(spy.mock.calls[0]![0])).toBe(URLS.CLINT_WEBHOOK_AGENDAMENTO_URL);
        expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({
            deal_id: 'deal-1',
            id_agendamento_medx: 1275002478,
        });
    });

    it('envia content-type json', async () => {
        const spy = espiar();
        await new ClintWebhookAdapter(configFalso()).gravarIdAgendamento('deal-1', 1);
        const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>;
        expect(headers['content-type']).toBe('application/json');
    });
});

describe('notificações', () => {
    it.each([
        ['notificarConfirmacao', 'confirmado'],
        ['notificarReagendamento', 'reagendamento_solicitado'],
        ['notificarCancelamento', 'cancelamento_solicitado'],
    ])('%s posta o evento %s na url de notificação', async (metodo, evento) => {
        const spy = espiar();
        await (new ClintWebhookAdapter(configFalso()) as any)[metodo]('deal-1');

        expect(String(spy.mock.calls[0]![0])).toBe(URLS.CLINT_WEBHOOK_NOTIFICACAO_URL);
        expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({ deal_id: 'deal-1', evento });
    });

    it('inclui o motivo ao notificar conflito', async () => {
        const spy = espiar();
        await new ClintWebhookAdapter(configFalso()).notificarConflito(
            'deal-1',
            'horário alterado',
        );

        expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({
            deal_id: 'deal-1',
            evento: 'conflito',
            motivo: 'horário alterado',
        });
    });
});

describe('falhas', () => {
    it('lança quando o Clint responde erro, para o job tentar de novo', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
        await expect(
            new ClintWebhookAdapter(configFalso()).gravarIdAgendamento('deal-1', 1),
        ).rejects.toThrow(/500/);
    });

    it('propaga falha de rede', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
        await expect(
            new ClintWebhookAdapter(configFalso()).notificarConfirmacao('deal-1'),
        ).rejects.toThrow(/ECONNREFUSED/);
    });
});
