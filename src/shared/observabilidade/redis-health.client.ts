import { Injectable, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import type { VerificadorRedis } from './redis-health.port';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';

@Injectable()
export class RedisHealthClient implements VerificadorRedis, OnModuleDestroy {
    private readonly client: IORedis;

    constructor(config: ConfigService<Env, true>) {
        this.client = new IORedis(config.get('REDIS_URL', { infer: true }), {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
        });
    }

    async ping(): Promise<string> {
        return this.client.ping();
    }

    onModuleDestroy(): void {
        this.client.disconnect();
    }
}
