import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FILA_PORT } from '../../application/ports/fila.port';
import { BullMqFilaAdapter } from './bullmq-fila.adapter';
import { NOME_FILA, OPCOES_JOB } from './fila.constants';
import type { Env } from '../../../config/env.schema';

@Module({
    imports: [
        BullModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService<Env, true>) => ({
                connection: { url: config.get('REDIS_URL', { infer: true }) },
            }),
            inject: [ConfigService],
        }),
        BullModule.registerQueue({ name: NOME_FILA, defaultJobOptions: OPCOES_JOB }),
    ],
    providers: [{ provide: FILA_PORT, useClass: BullMqFilaAdapter }],
    exports: [BullModule, FILA_PORT],
})
export class FilaModule {}
