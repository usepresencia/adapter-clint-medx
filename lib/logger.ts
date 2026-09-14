import pino, { type Logger } from "pino";
import type { Env } from "./config/env.server.js";

export type { Logger };

export interface LoggerMinimo {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const CAMPOS_REDIGIDOS = [
  "cpf", "telefone", "nome", "email", "celular", "data_nascimento",
  "*.cpf", "*.telefone", "*.nome", "*.email", "*.celular", "*.data_nascimento",
  "*.CPF_CGC", "*.Celular", "*.Nome", "*.Email", "*.Nascimento",
  "payload.cpf", "payload.telefone", "payload.nome", "payload.email",
];

export function criarLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: CAMPOS_REDIGIDOS,
    base: { servico: "adapter-clint-medx" },
  });
}
