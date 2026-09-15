import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseEnv } from './config/env.schema';
import { AgendamentoModule } from './agendamento/agendamento.module';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [() => parseEnv(process.env)] }),
        AgendamentoModule,
    ],
})
export class AppModule {}
