import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  ADAPTER_SECRET: z.string().min(1),
  MEDX_HOST: z.string().url().default("https://integracao-app.medx.med.br"),
  MEDX_INTEGRATION_TOKEN: z.string().min(1),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  DATABASE_PATH: z.string().default("./dados/adapter.sqlite"),
  CLINT_WEBHOOK_AGENDAMENTO_URL: z.string().url(),
  CLINT_WEBHOOK_NOTIFICACAO_URL: z.string().url(),
  RETENCAO_DIAS: z.coerce.number().default(90),
  LOG_LEVEL: z.string().default("info"),
  SMTP_URL: z.string().optional(),
  ALERTA_EMAIL_DESTINO: z.string().optional(),
  ALERTA_EMAIL_ORIGEM: z.string().default("adapter@localhost"),
  BULLBOARD_USUARIO: z.string().optional(),
  BULLBOARD_SENHA: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function carregarEnv(fonte: Record<string, string | undefined>): Env {
  const resultado = schema.safeParse(fonte);
  if (!resultado.success) {
    const campos = resultado.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Configuração de ambiente inválida — ${campos}`);
  }
  return resultado.data;
}
