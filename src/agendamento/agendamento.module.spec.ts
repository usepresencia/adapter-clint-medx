import { describe, it, expect, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ObservabilidadeModule } from '../shared/observabilidade/observabilidade.module';
import { NOTIFICADOR_SILENCIOSO } from '../shared/observabilidade/alerta-logger';

function configFalso(valores: Record<string, string> = {}): ConfigService {
    return { get: (chave: string) => valores[chave] } as ConfigService;
}

describe('escolherNotificador', () => {
    it('usa o silencioso quando SMTP não está configurado', () => {
        expect(ObservabilidadeModule.escolherNotificador(configFalso())).toBe(
            NOTIFICADOR_SILENCIOSO,
        );
    });

    it('usa o silencioso quando falta o destino', () => {
        expect(
            ObservabilidadeModule.escolherNotificador(configFalso({ SMTP_URL: 'smtp://x' })),
        ).toBe(NOTIFICADOR_SILENCIOSO);
    });

    it('monta o notificador de e-mail quando SMTP e destino existem', () => {
        const n = ObservabilidadeModule.escolherNotificador(
            configFalso({ SMTP_URL: 'smtp://x', ALERTA_EMAIL_DESTINO: 'gestao@clinica.test' }),
        );
        expect(n).not.toBe(NOTIFICADOR_SILENCIOSO);
        expect(typeof n.alertar).toBe('function');
    });
});

describe('AgendamentoModule.onModuleInit', () => {
    it('onModuleInit não lança quando o MedX falha', async () => {
        const { AgendamentoModule } = await import('./agendamento.module');
        const avisos: unknown[] = [];
        const modulo = new AgendamentoModule(
            { carregar: async () => Promise.reject(new Error('HTTP 404')) } as never,
            {
                warn: (...args: unknown[]) => avisos.push(args),
                info: () => {},
                error: () => {},
            } as never,
            { agendarRepetitivo: async () => {}, removerRepetitivo: async () => {} } as never,
            { get: () => 'desligado' } as never,
        );
        await expect(modulo.onModuleInit()).resolves.toBeUndefined();
        expect(avisos).toHaveLength(1);
    });
});

describe('agendamento do monitor do MedX', () => {
    async function montar(modo: string) {
        const { AgendamentoModule } = await import('./agendamento.module');
        const fila = {
            agendarRepetitivo: vi.fn(async () => {}),
            removerRepetitivo: vi.fn(async () => {}),
        };
        const modulo = new AgendamentoModule(
            { carregar: async () => {} } as never,
            { warn: () => {}, info: () => {}, error: () => {} } as never,
            fila as never,
            { get: () => modo } as never,
        );
        await modulo.onModuleInit();
        return fila;
    }

    it('modo observar agenda a cada 5 minutos', async () => {
        const fila = await montar('observar');
        expect(fila.agendarRepetitivo).toHaveBeenCalledWith(
            'monitor-medx',
            { tipo: 'monitor-medx', comando: { modo: 'observar' } },
            300_000,
        );
    });

    it('modo desligado remove o agendador', async () => {
        const fila = await montar('desligado');
        expect(fila.removerRepetitivo).toHaveBeenCalledWith('monitor-medx');
        expect(fila.agendarRepetitivo).not.toHaveBeenCalled();
    });
});
