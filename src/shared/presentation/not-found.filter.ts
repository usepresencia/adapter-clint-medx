import { ArgumentsHost, Catch, Inject } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import type { Request, Response } from 'express';
import { LOGGER_PORT, type LoggerMinimo } from '../../agendamento/application/ports/logger.port';

const OK = { ok: true } as const;

/**
 * Filtro global (registrado em main.ts, não escopado a nenhum controller) que
 * garante 200 para QUALQUER falha em `/webhooks/*` — inclusive as que nunca
 * chegam ao `WebhookAlwaysOkFilter` escopado ao controller, porque acontecem
 * antes do Nest decidir qual rota corresponde (ex.: corpo JSON malformado,
 * rejeitado pelo body-parser do Express antes da "zona de exceção" da rota).
 *
 * Fora de `/webhooks/*`, delega para o comportamento padrão do Nest via
 * `BaseExceptionFilter` (inclusive o formato usual de 404) — nunca mascarar
 * 404s legítimos em outras rotas.
 */
@Catch()
export class NotFoundFilter extends BaseExceptionFilter {
    constructor(
        httpAdapterHost: HttpAdapterHost,
        @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
    ) {
        super(httpAdapterHost.httpAdapter);
    }

    catch(excecao: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const requisicao = ctx.getRequest<Request>();

        if (requisicao.originalUrl?.startsWith('/webhooks/')) {
            const resposta = ctx.getResponse<Response>();
            const mensagem = excecao instanceof Error ? excecao.message : String(excecao);
            this.logger.warn(
                {
                    alerta: true,
                    metodo: requisicao.method,
                    url: requisicao.originalUrl,
                    erro: mensagem,
                },
                'erro não tratado antes da rota corresponder — webhook mascarado como 200',
            );
            resposta.status(200).json(OK);
            return;
        }

        // Qualquer outro erro fora de /webhooks continua com o comportamento
        // padrão do Nest (404 de verdade, 500 de verdade, etc.).
        super.catch(excecao, host);
    }
}
