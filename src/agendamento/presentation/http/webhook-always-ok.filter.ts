import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { LOGGER_PORT, type LoggerMinimo } from '../../application/ports/logger.port';
import { Inject } from '@nestjs/common';

const OK = { ok: true } as const;

@Catch()
export class WebhookAlwaysOkFilter implements ExceptionFilter {
    constructor(@Inject(LOGGER_PORT) private readonly logger: LoggerMinimo) {}

    catch(excecao: unknown, host: ArgumentsHost): void {
        const resposta = host.switchToHttp().getResponse<Response>();
        const mensagem = excecao instanceof Error ? excecao.message : String(excecao);
        this.logger.error({ erro: mensagem }, 'erro não tratado no webhook');
        resposta.status(200).json(OK);
    }
}
