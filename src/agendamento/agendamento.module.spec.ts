import { describe, it, expect } from 'vitest';
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
