import { describe, it, expect, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';
import { AlertaLogger, NOTIFICADOR_SILENCIOSO } from './alerta-logger';
import { criarNotificadorEmail } from './notificador-email';
import type { NotificadorPort } from '../../agendamento/application/ports/notificador.port';

function pinoFalso(): PinoLogger {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as PinoLogger;
}

describe('criarNotificadorEmail', () => {
    it('envia para o destino configurado com assunto prefixado', async () => {
        const enviarEmail = vi.fn(async () => {});
        await criarNotificadorEmail({ enviarEmail, destino: 'gestao@clinica.test' }).alertar(
            'job na dead letter',
            { deal_id: 'd1' },
        );

        expect(enviarEmail).toHaveBeenCalledWith(
            'gestao@clinica.test',
            '[adapter-clint-medx] job na dead letter',
            expect.stringContaining('d1'),
        );
    });
});

describe('NOTIFICADOR_SILENCIOSO', () => {
    it('não faz nada e resolve', async () => {
        await expect(NOTIFICADOR_SILENCIOSO.alertar('x', {})).resolves.toBeUndefined();
    });
});

describe('AlertaLogger', () => {
    it('repassa info sem alertar', () => {
        const notificador: NotificadorPort = { alertar: vi.fn(async () => {}) };
        const pino = pinoFalso();
        new AlertaLogger(pino, notificador).info({ deal_id: 'd1' }, 'tudo certo');

        expect(pino.info).toHaveBeenCalledWith({ deal_id: 'd1' }, 'tudo certo');
        expect(notificador.alertar).not.toHaveBeenCalled();
    });

    it('não alerta em warn comum', () => {
        const notificador: NotificadorPort = { alertar: vi.fn(async () => {}) };
        new AlertaLogger(pinoFalso(), notificador).warn({ deal_id: 'd1' }, 'aviso trivial');
        expect(notificador.alertar).not.toHaveBeenCalled();
    });

    it('alerta em warn marcado com alerta:true e ainda loga', async () => {
        const notificador: NotificadorPort = { alertar: vi.fn(async () => {}) };
        const pino = pinoFalso();
        new AlertaLogger(pino, notificador).warn(
            { alerta: true, deal_id: 'd1' },
            'confirmação recusada',
        );
        await new Promise(r => setImmediate(r));

        expect(pino.warn).toHaveBeenCalled();
        expect(notificador.alertar).toHaveBeenCalledWith('confirmação recusada', {
            alerta: true,
            deal_id: 'd1',
        });
    });

    it('alerta em error marcado com alerta:true', async () => {
        const notificador: NotificadorPort = { alertar: vi.fn(async () => {}) };
        new AlertaLogger(pinoFalso(), notificador).error({ alerta: true }, 'dead letter');
        await new Promise(r => setImmediate(r));
        expect(notificador.alertar).toHaveBeenCalled();
    });

    it('não deixa a falha do notificador derrubar o log', () => {
        const notificador: NotificadorPort = {
            alertar: vi.fn(async () => {
                throw new Error('SMTP fora do ar');
            }),
        };
        const pino = pinoFalso();
        expect(() => new AlertaLogger(pino, notificador).warn({ alerta: true }, 'x')).not.toThrow();
        expect(pino.warn).toHaveBeenCalled();
    });

    it('ignora objetos que não são registros', () => {
        const notificador: NotificadorPort = { alertar: vi.fn(async () => {}) };
        expect(() => new AlertaLogger(pinoFalso(), notificador).warn('string solta')).not.toThrow();
        expect(notificador.alertar).not.toHaveBeenCalled();
    });
});
