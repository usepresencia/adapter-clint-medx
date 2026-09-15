import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseEnv } from './config/env.schema';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => parseEnv(process.env)] })],
})
export class AppModule {}
