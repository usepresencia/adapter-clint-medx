import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../../shared/persistence/prisma.service';
import { MedxTokenProvider } from '../../infrastructure/medx/medx-token.provider';

export const REDIS_HEALTH_CLIENT = Symbol('VerificadorRedis');

// Interface mínima que o health check precisa — implementada pela classe
// concreta `RedisHealthClient` (Task 25, shared/observabilidade/redis-health.client.ts).
// Nomes propositalmente diferentes (interface vs. classe) para não confundir
// os dois arquivos.
export interface VerificadorRedis {
    ping(): Promise<string>;
}

export interface Saude {
    redis: boolean;
    banco: boolean;
    medx: boolean;
}

@Controller('health')
export class HealthController {
    constructor(
        private readonly prisma: PrismaService,
        @Inject(REDIS_HEALTH_CLIENT) private readonly redis: VerificadorRedis,
        private readonly tokens: MedxTokenProvider,
    ) {}

    @Get()
    async verificar(@Res() resposta: Response): Promise<void> {
        const saude: Saude = {
            redis: await this.redis
                .ping()
                .then(() => true)
                .catch(() => false),
            banco: await this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
            medx: await this.tokens
                .obterToken()
                .then(() => true)
                .catch(() => false),
        };
        const tudoOk = saude.redis && saude.banco && saude.medx;
        resposta.status(tudoOk ? 200 : 503).json(saude);
    }
}
