import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { parseEnv } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const env = parseEnv(process.env);
  const app = await NestFactory.create(AppModule);
  await app.listen(env.PORT, '0.0.0.0');
  console.log(`adapter no ar na porta ${env.PORT}`);
}

void bootstrap();
