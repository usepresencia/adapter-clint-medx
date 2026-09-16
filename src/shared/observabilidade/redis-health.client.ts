import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import type { VerificadorRedis } from './redis-health.port';

@Injectable()
export class RedisHealthClient implements VerificadorRedis, OnModuleDestroy {
    private readonly client: IORedis;

    constructor(config: ConfigService) {
        this.client = new IORedis(config.get<string>('REDIS_URL')!, {
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
