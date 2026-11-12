import { z } from 'zod';

const schema = z.object({
    PORT: z.coerce.number().default(3000),
    ADAPTER_SECRET: z.string().min(1),
    MEDX_HOST: z.string().url().default('https://integracao-app.medx.med.br'),
    MEDX_INTEGRATION_TOKEN: z.string().min(1),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório (connection string do Postgres)'),
    CLINT_WEBHOOK_AGENDAMENTO_URL: z.string().url(),
    CLINT_WEBHOOK_NOTIFICACAO_URL: z.string().url(),
    CLINT_API_URL: z.string().url().default('https://api.clint.digital'),
    CLINT_API_TOKEN: z.string().min(1),
    CLINT_ORIGEM_RECEPCAO_ID: z.string().uuid().default('c10ccf49-2c9f-41d5-bfa7-c116daa2cc77'),
    CLINT_ETAPA_BOAS_VINDAS_ID: z.string().uuid().default('03900fbe-0a12-462c-9599-2f5a3ff05657'),
    CLINT_ETAPA_ENDOVENOSO_ID: z.string().uuid().default('3a031270-0d91-4b81-aff5-55535b82ced6'),
    CLINT_MOTIVO_PERDA_CANCELAMENTO_ID: z.string().uuid().optional(),
    SITE_ORIGEM_URL: z.string().url().default('https://leize.com.br'),
    META_PIXEL_ID: z.string().optional(),
    META_CAPI_ACCESS_TOKEN: z.string().optional(),
    RETENCAO_DIAS: z.coerce.number().default(90),
    LOG_LEVEL: z.string().default('info'),
    SMTP_URL: z.string().optional(),
    ALERTA_EMAIL_DESTINO: z.string().optional(),
    ALERTA_EMAIL_ORIGEM: z.string().default('adapter@localhost'),
    BULLBOARD_USUARIO: z.string().optional(),
    BULLBOARD_SENHA: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(
    env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Env {
    const resultado = schema.safeParse(env);
    if (!resultado.success) {
        const campos = resultado.error.issues
            .map(i => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
        throw new Error(`Configuração de ambiente inválida — ${campos}`);
    }
    return resultado.data;
}
