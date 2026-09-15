import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { LoggerMinimo } from '../../agendamento/application/ports/logger.port';
import {
    NOTIFICADOR_PORT,
    type NotificadorPort,
} from '../../agendamento/application/ports/notificador.port';

export const NOTIFICADOR_SILENCIOSO: NotificadorPort = {
    async alertar(): Promise<void> {},
};

function deveAlertar(objeto: unknown): objeto is Record<string, unknown> {
    return (
        typeof objeto === 'object' &&
        objeto !== null &&
        (objeto as Record<string, unknown>).alerta === true
    );
}

@Injectable()
export class AlertaLogger implements LoggerMinimo {
    constructor(
        @InjectPinoLogger(AlertaLogger.name) private readonly pino: PinoLogger,
        @Inject(NOTIFICADOR_PORT) private readonly notificador: NotificadorPort,
    ) {}

    info(o: unknown, m?: string): void {
        this.pino.info(o, m);
    }

    warn(o: unknown, m?: string): void {
        this.pino.warn(o, m);
        this.alertarSeNecessario(o, m);
    }

    error(o: unknown, m?: string): void {
        this.pino.error(o, m);
        this.alertarSeNecessario(o, m);
    }

    private alertarSeNecessario(objeto: unknown, mensagem?: string): void {
        if (deveAlertar(objeto)) {
            // Um alerta que falha nunca pode derrubar o fluxo que o disparou.
            void Promise.resolve()
                .then(() => this.notificador.alertar(mensagem ?? 'alerta do adapter', objeto))
                .catch(() => {});
        }
    }
}
