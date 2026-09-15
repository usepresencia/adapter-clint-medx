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

function escolherNotificador(config: ConfigService): NotificadorPort {
    const smtpUrl = config.get<string>('SMTP_URL');
    const destino = config.get<string>('ALERTA_EMAIL_DESTINO');
    if (!smtpUrl || !destino) {
        return NOTIFICADOR_SILENCIOSO;
    }

    return criarNotificadorEmail({
        destino,
        enviarEmail: async (para, assunto, corpo) => {
            const transporte = nodemailer.createTransport(smtpUrl);
            await transporte.sendMail({
                from: config.get<string>('ALERTA_EMAIL_ORIGEM'),
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
            useFactory: (config: ConfigService) => ({
                pinoHttp: {
                    level: config.get<string>('LOG_LEVEL'),
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
