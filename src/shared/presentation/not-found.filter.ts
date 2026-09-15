import { ArgumentsHost, Catch, ExceptionFilter, Inject, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LOGGER_PORT, type LoggerMinimo } from '../../agendamento/application/ports/logger.port';

const OK = { ok: true } as const;

@Catch(NotFoundException)
export class NotFoundFilter implements ExceptionFilter {
    constructor(@Inject(LOGGER_PORT) private readonly logger: LoggerMinimo) {}

    catch(excecao: NotFoundException, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const requisicao = ctx.getRequest<Request>();
        const resposta = ctx.getResponse<Response>();

        if (requisicao.originalUrl.startsWith('/webhooks/')) {
            this.logger.warn(
                { alerta: true, metodo: requisicao.method, url: requisicao.originalUrl },
                'webhook chegou em rota inexistente — conferir a configuração no Clint',
            );
            resposta.status(200).json(OK);
            return;
        }

        // Qualquer outro 404 continua sendo um 404 de verdade.
        const corpo = excecao.getResponse();
        resposta.status(404).json(typeof corpo === 'string' ? { message: corpo } : corpo);
    }
}
