import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import basicAuth from 'express-basic-auth';

const CAMINHO = '/admin/filas';

/**
 * Sobe o painel apenas com credenciais definidas. Sem elas a rota não existe:
 * expor a fila sem autenticação vazaria deal_id e o conteúdo dos jobs.
 */
export function registrarPainelFila(
    app: INestApplication,
    fila: Queue,
    credenciais: { usuario?: string; senha?: string },
): boolean {
    const { usuario, senha } = credenciais;
    if (!usuario || !senha) return false;

    const painel = new ExpressAdapter();
    createBullBoard({ queues: [new BullMQAdapter(fila)], serverAdapter: painel });
    painel.setBasePath(CAMINHO);

    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use(
        CAMINHO,
        basicAuth({ users: { [usuario]: senha }, challenge: true, realm: 'adapter' }),
        painel.getRouter(),
    );

    return true;
}
