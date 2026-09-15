import { describe, it, expect } from 'vitest';
import { parseEnv } from './env.schema';

const base = {
  ADAPTER_SECRET: 'segredo',
  MEDX_INTEGRATION_TOKEN: 'token-medx',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/adapter',
  CLINT_WEBHOOK_AGENDAMENTO_URL: 'https://clint.example/a',
  CLINT_WEBHOOK_NOTIFICACAO_URL: 'https://clint.example/n',
};

describe('parseEnv', () => {
  it('aplica os valores padrão quando as variáveis opcionais faltam', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.MEDX_HOST).toBe('https://integracao-app.medx.med.br');
    expect(env.RETENCAO_DIAS).toBe(90);
    expect(env.ALERTA_EMAIL_ORIGEM).toBe('adapter@localhost');
  });

  it('rejeita configuração sem o segredo do adapter', () => {
    const { ADAPTER_SECRET, ...semSegredo } = base;
    expect(() => parseEnv(semSegredo)).toThrow(/ADAPTER_SECRET/);
  });

  it('converte PORT para número', () => {
    expect(parseEnv({ ...base, PORT: '8080' }).PORT).toBe(8080);
  });

  it('aceita SMTP e Bull Board ausentes, deixando-os indefinidos', () => {
    const env = parseEnv(base);
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.BULLBOARD_USUARIO).toBeUndefined();
  });

  it('rejeita DATABASE_URL ausente', () => {
    const { DATABASE_URL, ...semBanco } = base;
    expect(() => parseEnv(semBanco)).toThrow(/DATABASE_URL/);
  });
});
