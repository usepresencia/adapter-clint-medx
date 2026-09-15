import { describe, it, expect, vi } from 'vitest';
import { HealthController } from './health.controller';

function respostaFalsa() {
    const resposta = { status: vi.fn(), json: vi.fn() } as any;
    resposta.status.mockReturnValue(resposta);
    return resposta;
}

function montar(overrides: Partial<{ banco: boolean; redis: boolean; medx: boolean }> = {}) {
    const prisma = {
        $queryRaw:
            overrides.banco === false
                ? vi.fn(async () => {
                      throw new Error('fora');
                  })
                : vi.fn(async () => [{ ok: 1 }]),
    };
    const redisClient = {
        ping:
            overrides.redis === false
                ? vi.fn(async () => {
                      throw new Error('fora');
                  })
                : vi.fn(async () => 'PONG'),
    };
    const tokens = {
        obterToken:
            overrides.medx === false
                ? vi.fn(async () => {
                      throw new Error('fora');
                  })
                : vi.fn(async () => 'jwt'),
    };

    return { controller: new HealthController(prisma as any, redisClient as any, tokens as any) };
}

describe('GET /health', () => {
    it('responde 200 quando tudo está de pé', async () => {
        const { controller } = montar();
        const resposta = respostaFalsa();
        await controller.verificar(resposta);
        expect(resposta.status).toHaveBeenCalledWith(200);
        expect(resposta.json).toHaveBeenCalledWith({ redis: true, banco: true, medx: true });
    });

    it('responde 503 quando algum componente está fora', async () => {
        const { controller } = montar({ redis: false });
        const resposta = respostaFalsa();
        await controller.verificar(resposta);
        expect(resposta.status).toHaveBeenCalledWith(503);
    });
});
