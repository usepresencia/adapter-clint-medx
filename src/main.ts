import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppModule } from './app.module';
import { parseEnv } from './config/env.schema';
import { NotFoundFilter } from './shared/presentation/not-found.filter';
import { LOGGER_PORT, type LoggerMinimo } from './agendamento/application/ports/logger.port';
import { EVENTO_REPOSITORIO } from './shared/persistence/persistence.module';
import type { EventoRepositorio } from './agendamento/domain/evento/evento.repositorio';
import { registrarPainelFila } from './agendamento/presentation/http/painel-fila';
import { NOME_FILA } from './agendamento/infrastructure/fila/fila.constants';

async function bootstrap(): Promise<void> {
    const env = parseEnv(process.env);
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
    app.useLogger(app.get(Logger));

    const logger = app.get<LoggerMinimo>(LOGGER_PORT);
    app.useGlobalFilters(new NotFoundFilter(logger));

    const fila = app.get<Queue>(getQueueToken(NOME_FILA));
    const painelAtivo = registrarPainelFila(app, fila, {
        usuario: env.BULLBOARD_USUARIO,
        senha: env.BULLBOARD_SENHA,
    });
    logger.info(
        { painel: painelAtivo },
        painelAtivo
            ? 'Bull Board disponível em /admin/filas'
            : 'Bull Board desativado — defina BULLBOARD_USUARIO e BULLBOARD_SENHA para habilitar',
    );

    const eventos = app.get<EventoRepositorio>(EVENTO_REPOSITORIO);
    const expurgoDiario = setInterval(
        () => {
            void eventos.expurgar(env.RETENCAO_DIAS).then(removidos => {
                if (removidos > 0) logger.info({ removidos }, 'expurgo de eventos antigos');
            });
        },
        24 * 60 * 60 * 1000,
    );
    expurgoDiario.unref();

    await app.listen(env.PORT, '0.0.0.0');
    logger.info({ porta: env.PORT }, 'adapter no ar');

    async function encerrar(sinal: string): Promise<void> {
        logger.info({ sinal }, 'encerrando');
        clearInterval(expurgoDiario);
        await app.close();
        process.exit(0);
    }

    process.on('SIGTERM', () => void encerrar('SIGTERM'));
    process.on('SIGINT', () => void encerrar('SIGINT'));
}

void bootstrap();
