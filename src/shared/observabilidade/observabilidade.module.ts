import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import nodemailer from 'nodemailer';
import { LOGGER_PORT } from '../../agendamento/application/ports/logger.port';
import {
    NOTIFICADOR_PORT,
    type NotificadorPort,
} from '../../agendamento/application/ports/notificador.port';
import { AlertaLogger, NOTIFICADOR_SILENCIOSO } from './alerta-logger';
import { criarNotificadorEmail } from './notificador-email';
import { CAMPOS_REDIGIDOS } from './campos-redigidos';
import type { Env } from '../../config/env.schema';

function escolherNotificador(config: ConfigService<Env, true>): NotificadorPort {
    const smtpUrl = config.get('SMTP_URL', { infer: true });
    const destino = config.get('ALERTA_EMAIL_DESTINO', { infer: true });
    if (!smtpUrl || !destino) {
        return NOTIFICADOR_SILENCIOSO;
    }

    return criarNotificadorEmail({
        destino,
        enviarEmail: async (para, assunto, corpo) => {
            const transporte = nodemailer.createTransport(smtpUrl);
            await transporte.sendMail({
                from: config.get('ALERTA_EMAIL_ORIGEM', { infer: true }),
                to: para,
                subject: assunto,
                text: corpo,
            });
        },
    });
}

@Module({
    imports: [
        PinoLoggerModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService<Env, true>) => ({
                pinoHttp: {
                    level: config.get('LOG_LEVEL', { infer: true }),
                    redact: CAMPOS_REDIGIDOS,
                    base: { servico: 'adapter-clint-medx' },
                    autoLogging: false,
                },
            }),
            inject: [ConfigService],
        }),
    ],
    providers: [
        { provide: NOTIFICADOR_PORT, useFactory: escolherNotificador, inject: [ConfigService] },
        { provide: LOGGER_PORT, useClass: AlertaLogger },
    ],
    exports: [PinoLoggerModule, LOGGER_PORT, NOTIFICADOR_PORT],
})
export class ObservabilidadeModule {
    static escolherNotificador = escolherNotificador; // exposto para teste unitário
}
