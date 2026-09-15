# Migração do adapter Clint ↔ MedX para NestJS — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar o adapter Clint↔MedX de Fastify+SQLite+DI manual para NestJS+Prisma+PostgreSQL+`@nestjs/bullmq`, seguindo as convenções do projeto de referência `api-agendaflow`, preservando 100% da lógica de `domain/`/`application/` já revisada.

**Architecture:** Mesma arquitetura DDD em camadas (domain/application/infrastructure/presentation), agora expressa com módulos e DI do Nest em vez de composition root manual. `domain/` não muda uma linha. `application/` vira classes `@Injectable()`. `infrastructure/` ganha repositórios Prisma e wrapping `@Injectable()` dos adapters MedX/Clint/fila. `presentation/` vira controllers Nest.

**Tech Stack:** Node 22 · NestJS 11 (`@nestjs/platform-express`) · Prisma + PostgreSQL · `@nestjs/bullmq` + Redis · `nestjs-pino` · Zod (validação de webhook) · Luxon · Vitest

**Spec:** `docs/superpowers/specs/2026-09-15-migracao-nestjs-design.md`

## Global Constraints

- **Node 22 LTS.** NestJS 11 com `@nestjs/platform-express` (não Fastify — decisão da migração).
- **Módulo CommonJS, não ESM.** Diferente do projeto atual (`"type": "module"`, imports com `.js`), o Nest usa `"module": "commonjs"`. **Todo import relativo perde a extensão `.js`** ao ser portado (`from "../shared/erros.js"` vira `from "../shared/erros"` ou, preferencialmente, o alias `@/...`).
- **Path alias `@/* → src/*`** é permitido nesta migração (ver spec Seção 3 — a proibição original de aliases não se aplica mais, pois o build do Nest resolve isso corretamente).
- **Persistência: Prisma + PostgreSQL.** Campos `inicio` e `ultimaEdicao` são `String` no schema Prisma, **nunca** `DateTime` — evita que o Prisma reconverta a string de horário local da clínica (sem timezone) para um `Date` do JS dependente do timezone do container. Ver spec Seção 5.
- **Logger: `nestjs-pino`, nunca o `Logger` nativo do Nest.** Preserva `CAMPOS_REDIGIDOS` (redação de CPF/telefone/nome/e-mail — exigência LGPD já revisada).
- **Fila: `@nestjs/bullmq`.** `AdapterProcessor extends WorkerHost`; um `429` do MedX usa `this.worker.rateLimit(ms)` + `throw Worker.RateLimitError()` — não conta como tentativa consumida (fix já validado no projeto atual).
- **DI por `Symbol()` token** para toda interface de port/repositório, ligada em `PersistenceModule`/módulos de infraestrutura via `useClass`/`useValue`.
- **Validação HTTP dos webhooks continua em Zod** (`schemas.ts`), não `class-validator` — os schemas já refletem o contrato do Clint e passaram por revisão.
- **Garantia "sempre 200" nos webhooks do Clint**: try/catch dentro do controller, retornando `{ ok: true }` em qualquer caminho — nunca via filtro de exceção global (que se aplicaria a toda a API, mascarando 404s legítimos de outras rotas).
- **Sem prefixo global `/api/v1`.** Rotas continuam `/webhooks/clint/agendamento`, `/webhooks/clint/resposta-lembrete`, `/health`, `/admin/filas`.
- **String literal `"Mensagem Salva com Sucesso"`** continua vivendo só em `medx-agenda.adapter.ts`.
- **Índice numérico de Status nunca é codificado** (exceto `STATUS_MEDX_AGENDADO = 0`, documentado como valor de nascimento local do domínio, não índice do MedX) — `indiceStatusConfirmado()` é sempre descoberto em runtime.
- **Rate limit do MedX:** 30 req/min por conta — `LIMITER = { max: 25, duration: 60_000 }`. Troca de token: 10 req/min por IP, cache em memória do processo (ver spec Seção 12, nota sobre múltiplas réplicas).
- **JWT do MedX expira em ~900s; renovar 120s antes** (`MARGEM_RENOVACAO_MS = 120_000`).
- **Timezone `America/Sao_Paulo`**, via `PeriodoConsulta`/Luxon — comportamento inalterado.
- **Logs nunca contêm CPF, telefone, nome ou e-mail.** Correlação por `deal_id`/`Id_do_Agendamento`.
- **Idioma:** código, nomes de função, comentários e mensagens de commit em português; nomes de camada/decorators em inglês (convenção Nest).
- **Testes:** Vitest (mantido). `domain/`/`application/` continuam instanciando classes diretamente com `vi.fn()` nos ports — sem `Test.createTestingModule`. `presentation/` ganha suíte e2e real (`Test.createTestingModule` + supertest) — desvio deliberado do `api-agendaflow`, que não tem e2e, dada a criticidade da garantia "sempre 200".
- Este plano assume um **projeto Nest novo, no mesmo repositório**, substituindo `src/`, `lib/`, `Dockerfile`, `docker-compose.yml`, `package.json` do projeto Fastify atual. O histórico git e os specs em `docs/` são preservados.

## Estrutura de arquivos

```
src/
  main.ts
  app.module.ts
  config/
    env.schema.ts
  agendamento/
    domain/
      shared/erros.ts
      paciente/telefone.ts
      paciente/cpf.ts
      paciente/correlacao-paciente.ts
      paciente/correlacao-paciente.repositorio.ts
      agendamento/periodo-consulta.ts
      agendamento/resposta-lembrete.ts
      agendamento/agendamento.ts
      agendamento/agendamento.repositorio.ts
      evento/evento-recebido.ts
      evento/evento.repositorio.ts
    application/
      ports/
        agenda-medica.port.ts
        cadastro-paciente.port.ts
        catalogo-clinico.port.ts
        crm.port.ts
        notificador.port.ts
        fila.port.ts
        logger.port.ts
      agendar-consulta/
        agendar-consulta.comando.ts
        agendar-consulta.usecase.ts
      processar-resposta-lembrete/
        processar-resposta.comando.ts
        processar-resposta.usecase.ts
    infrastructure/
      persistencia/prisma/
        agendamento.prisma-repositorio.ts
        correlacao-paciente.prisma-repositorio.ts
        evento.prisma-repositorio.ts
      medx/
        medx.erros.ts
        medx.tipos.ts
        medx-token.provider.ts
        medx-http.client.ts
        medx-catalogo.adapter.ts
        medx-cadastro-paciente.adapter.ts
        medx-agenda.adapter.ts
      clint/
        clint-webhook.adapter.ts
      fila/
        fila.constants.ts
        fila.module.ts
        adapter.processor.ts
        bullmq-fila.adapter.ts
    presentation/
      http/
        schemas.ts
        webhooks.controller.ts
        health.controller.ts
        webhook-not-found.filter.ts
        painel-fila.ts
    agendamento.module.ts
  shared/
    persistence/
      prisma.service.ts
      persistence.module.ts
    observabilidade/
      logger.module.ts
      alerta-logger.ts
      notificador-email.ts

prisma/
  schema.prisma

test/
  webhooks.e2e-spec.ts

tests unitários: co-localizados como *.spec.ts, ao lado do arquivo testado
                 (convenção do api-agendaflow) — troca de tests/ espelhado
                 para *.spec.ts ao lado do código
```

---

### Task 1: Bootstrap do projeto NestJS

**Files:**
- Create: `package.json` (substitui o atual), `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`
- Create: `src/main.ts`, `src/app.module.ts`
- Create: `src/config/env.schema.ts`
- Test: `src/config/env.schema.spec.ts`

**Interfaces:**
- Consumes: nada
- Produces: `parseEnv(env?: NodeJS.ProcessEnv): Env` e o tipo `Env` com os mesmos 15 campos do projeto atual (`PORT`, `ADAPTER_SECRET`, `MEDX_HOST`, `MEDX_INTEGRATION_TOKEN`, `REDIS_URL`, `DATABASE_URL` — renomeado de `DATABASE_PATH`, agora é a connection string do Postgres —, `CLINT_WEBHOOK_AGENDAMENTO_URL`, `CLINT_WEBHOOK_NOTIFICACAO_URL`, `RETENCAO_DIAS`, `LOG_LEVEL`, `SMTP_URL?`, `ALERTA_EMAIL_DESTINO?`, `ALERTA_EMAIL_ORIGEM`, `BULLBOARD_USUARIO?`, `BULLBOARD_SENHA?`)

- [ ] **Step 1: Remover os arquivos do projeto Fastify anterior**

```bash
cd /Users/cesarpisa/Projects/dra-leize
git rm -r src lib tests Dockerfile docker-compose.yml vitest.config.ts .env.example
```

Não remova `docs/`, `scripts/descoberta.ts` (será adaptado na Task 27), `.git/`, `.gitignore`.

- [ ] **Step 2: Instalar as dependências**

```bash
npm install @nestjs/common@^11 @nestjs/core@^11 @nestjs/platform-express@^11 \
  @nestjs/config@^4 @nestjs/bullmq@^11 bullmq@^6 ioredis@^6 \
  nestjs-pino@^4 pino-http@^10 pino@^10 \
  @prisma/client@^7 luxon@^3 nodemailer@^10 zod@^4 \
  @bull-board/api@^9 @bull-board/express@^9 express-basic-auth@^1 \
  reflect-metadata@^0.2 rxjs@^7

npm install -D @nestjs/cli@^11 @nestjs/schematics@^11 @nestjs/testing@^11 \
  prisma@^7 typescript@^5 @types/node@^22 @types/express@^5 \
  @types/luxon@^3 @types/nodemailer@^8 @types/supertest@^6 \
  vitest@^4 @vitest/coverage-v8@^4 supertest@^7 tsx@^4 vite-tsconfig-paths@^5
```

Nota: `@bull-board/fastify` (usado hoje) vira `@bull-board/express`, já que o adapter HTTP muda para Express.

- [ ] **Step 3: `package.json` — scripts e metadados**

```bash
npm pkg set name="adapter-clint-medx"
npm pkg delete main directories
npm pkg set private=true
npm pkg set scripts.build="nest build"
npm pkg set scripts.start="node dist/main.js"
npm pkg set scripts.start:dev="nest start --watch"
npm pkg set scripts.prisma:generate="prisma generate"
npm pkg set scripts.prisma:migrate="prisma migrate dev"
npm pkg set scripts.prisma:deploy="prisma migrate deploy"
npm pkg set scripts.test="vitest run --passWithNoTests"
npm pkg set scripts.test:watch="vitest"
npm pkg set scripts.test:e2e="vitest run --config vitest.e2e.config.ts --passWithNoTests"
npm pkg set scripts.lint="eslint src/"
npm pkg set scripts.format="prettier --write \"**/*.{ts,js,json,md,yml,yaml}\""
npm pkg set scripts.format:check="prettier --check \"src/**/*.{ts,js,json,md}\""
npm pkg set scripts.descoberta="tsx scripts/descoberta.ts"
```

- [ ] **Step 4: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test", "**/*.spec.ts"]
}
```

- [ ] **Step 5: `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*.spec.ts", "**/*.e2e-spec.ts"]
}
```

- [ ] **Step 6: `nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 7: Escrever o teste que falha — `src/config/env.schema.spec.ts`**

```ts
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
```

- [ ] **Step 8: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/config/env.schema.spec.ts`
Expected: FAIL — `src/config/env.schema.ts` não existe.

- [ ] **Step 9: Implementar `src/config/env.schema.ts`**

```ts
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
  RETENCAO_DIAS: z.coerce.number().default(90),
  LOG_LEVEL: z.string().default('info'),
  SMTP_URL: z.string().optional(),
  ALERTA_EMAIL_DESTINO: z.string().optional(),
  ALERTA_EMAIL_ORIGEM: z.string().default('adapter@localhost'),
  BULLBOARD_USUARIO: z.string().optional(),
  BULLBOARD_SENHA: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Env {
  const resultado = schema.safeParse(env);
  if (!resultado.success) {
    const campos = resultado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração de ambiente inválida — ${campos}`);
  }
  return resultado.data;
}
```

- [ ] **Step 10: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/config/env.schema.spec.ts`
Expected: PASS — 5 testes.

- [ ] **Step 11: `src/app.module.ts` — esqueleto mínimo**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseEnv } from './config/env.schema';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [() => parseEnv(process.env)] }),
  ],
})
export class AppModule {}
```

Este módulo ganha os imports de `PersistenceModule`, `LoggerModule`, `AgendamentoModule` nas
tasks seguintes — por ora só o `ConfigModule` para o build passar.

- [ ] **Step 12: `src/main.ts` — bootstrap mínimo**

```ts
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
```

Este arquivo é reescrito por completo na Task 25 (logger, shutdown hooks, expurgo diário).
Por ora só garante que `npm run build` funciona.

- [ ] **Step 13: Confirmar que o projeto compila**

Run: `npx tsc --noEmit -p tsconfig.build.json`
Expected: sem erros.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat: bootstrap do projeto NestJS com validação de ambiente"
```

---

### Task 2: Qualidade de código — ESLint, Prettier, EditorConfig, commitlint, husky

**Files:**
- Create: `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `.editorconfig`, `commitlint.config.js`, `.husky/pre-commit`
- Modify: `package.json` (devDependencies + `lint-staged` key + `prepare` script)

**Interfaces:**
- Consumes: nada
- Produces: nada (tooling, sem API de código)

- [ ] **Step 1: Instalar as dependências de qualidade de código**

```bash
npm install -D eslint@^9 @eslint/js@^9 typescript-eslint@^8 \
  eslint-plugin-prettier@^5 eslint-config-prettier@^10 globals@^16 \
  prettier@^3 husky@^9 lint-staged@^16 \
  @commitlint/cli@^20 @commitlint/config-conventional@^20
```

- [ ] **Step 2: `eslint.config.mjs`**

```js
// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', '**/*.spec.ts', 'dist/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prettier/prettier': ['error', { endOfLine: 'lf' }],
    },
  },
);
```

- [ ] **Step 3: `.prettierrc` e `.prettierignore`**

`.prettierrc`:
```json
{
  "semi": true,
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 4,
  "trailingComma": "all",
  "arrowParens": "avoid",
  "endOfLine": "auto"
}
```

`.prettierignore`:
```
node_modules
build
dist
coverage
.env
docs
```

- [ ] **Step 4: `.editorconfig`**

```ini
root = true

[*]
indent_style = space
indent_size = 4
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 5: `commitlint.config.js`**

```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message) => !/^[a-z]+(\([\w-]+\))?:/.test(message)],
  rules: {
    'subject-case': [0, 'never'],
  },
};
```

- [ ] **Step 6: husky + lint-staged**

```bash
npx husky init
```

Edite `.husky/pre-commit` para conter:
```
npx lint-staged
```

```bash
npm pkg set lint-staged.**/*.{ts,js,json,md,yml,yaml}="prettier --write"
npm pkg set scripts.prepare="husky"
```

- [ ] **Step 7: Rodar lint e format no projeto atual (só o que existe até agora)**

Run: `npm run lint && npm run format:check`
Expected: sem erros (só `src/config/env.schema.ts`, `src/app.module.ts`, `src/main.ts`
existem até aqui).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: configuração de lint, format e commit hooks"
```

---

### Task 3: Domínio — erro base, Telefone e Cpf

**Files:**
- Create: `src/agendamento/domain/shared/erros.ts`
- Create: `src/agendamento/domain/paciente/telefone.ts`
- Create: `src/agendamento/domain/paciente/cpf.ts`
- Test: `src/agendamento/domain/paciente/telefone.spec.ts`
- Test: `src/agendamento/domain/paciente/cpf.spec.ts`

**Interfaces:**
- Consumes: nada
- Produces: `class ErroDeDominio extends Error`; `class Telefone` (`static criar`, `e164`,
  `nacional`, `igual`); `class Cpf` (`static criar`, `static tentarCriar`, `digitos`)

Conteúdo idêntico ao já revisado no projeto Fastify — só muda o caminho e a extensão dos
imports (sem `.js`, módulo agora é CommonJS).

- [ ] **Step 1: Copiar os testes, ajustando os imports**

`src/agendamento/domain/paciente/telefone.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Telefone } from './telefone';
import { ErroDeDominio } from '../shared/erros';

describe('Telefone.criar', () => {
  it.each([
    ['+55 11 99999-8888', '+5511999998888', '11999998888'],
    ['5511999998888', '+5511999998888', '11999998888'],
    ['11999998888', '+5511999998888', '11999998888'],
    ['(11) 99999-8888', '+5511999998888', '11999998888'],
  ])('normaliza %s', (entrada, e164, nacional) => {
    const t = Telefone.criar(entrada);
    expect(t.e164).toBe(e164);
    expect(t.nacional).toBe(nacional);
  });

  it('preserva fixos de 8 dígitos sem inventar o nono', () => {
    expect(Telefone.criar('1133334444').nacional).toBe('1133334444');
  });

  it.each(['99998888', '', '123'])('rejeita %s por não ter DDD', (entrada) => {
    expect(() => Telefone.criar(entrada)).toThrow(ErroDeDominio);
  });

  it('considera iguais dois telefones escritos de formas diferentes', () => {
    expect(Telefone.criar('+55 11 99999-8888').igual(Telefone.criar('11999998888'))).toBe(true);
  });

  it('distingue telefones diferentes', () => {
    expect(Telefone.criar('11999998888').igual(Telefone.criar('11999998887'))).toBe(false);
  });
});
```

`src/agendamento/domain/paciente/cpf.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Cpf } from './cpf';
import { ErroDeDominio } from '../shared/erros';

const VALIDO = '529.982.247-25';

describe('Cpf.criar', () => {
  it('remove a pontuação', () => {
    expect(Cpf.criar(VALIDO).digitos).toBe('52998224725');
  });

  it('aceita já sem pontuação', () => {
    expect(Cpf.criar('52998224725').digitos).toBe('52998224725');
  });

  it('rejeita dígito verificador errado', () => {
    expect(() => Cpf.criar('52998224724')).toThrow(ErroDeDominio);
  });

  it('rejeita quantidade de dígitos diferente de 11', () => {
    expect(() => Cpf.criar('529982247')).toThrow(ErroDeDominio);
  });

  it.each(['00000000000', '11111111111', '99999999999'])(
    'rejeita a sequência repetida %s',
    (entrada) => {
      expect(() => Cpf.criar(entrada)).toThrow(ErroDeDominio);
    },
  );
});

describe('Cpf.tentarCriar', () => {
  it('devolve null para ausente', () => {
    expect(Cpf.tentarCriar(undefined)).toBeNull();
    expect(Cpf.tentarCriar(null)).toBeNull();
    expect(Cpf.tentarCriar('')).toBeNull();
  });

  it('devolve null para inválido em vez de lançar', () => {
    expect(Cpf.tentarCriar('52998224724')).toBeNull();
  });

  it('devolve o Cpf quando válido', () => {
    expect(Cpf.tentarCriar(VALIDO)?.digitos).toBe('52998224725');
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/agendamento/domain/paciente`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar `src/agendamento/domain/shared/erros.ts`**

```ts
export class ErroDeDominio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDeDominio';
  }
}
```

- [ ] **Step 4: Implementar `src/agendamento/domain/paciente/telefone.ts`**

```ts
import { ErroDeDominio } from '../shared/erros';

export class Telefone {
  private constructor(
    readonly e164: string,
    readonly nacional: string,
  ) {}

  static criar(bruto: string): Telefone {
    let digitos = (bruto ?? '').replace(/\D/g, '');

    if (digitos.startsWith('55') && digitos.length >= 12) {
      digitos = digitos.slice(2);
    }

    if (digitos.length < 10 || digitos.length > 11) {
      throw new ErroDeDominio(
        `Telefone sem DDD reconhecível: ${digitos.length} dígitos após normalização`,
      );
    }

    return new Telefone(`+55${digitos}`, digitos);
  }

  igual(outro: Telefone): boolean {
    return this.e164 === outro.e164;
  }
}
```

- [ ] **Step 5: Implementar `src/agendamento/domain/paciente/cpf.ts`**

```ts
import { ErroDeDominio } from '../shared/erros';

function digitoVerificador(digitos: string, peso: number): number {
  let soma = 0;
  for (let i = 0; i < peso - 1; i++) {
    soma += Number(digitos[i]) * (peso - i);
  }
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

export class Cpf {
  private constructor(readonly digitos: string) {}

  static criar(bruto: string): Cpf {
    const digitos = (bruto ?? '').replace(/\D/g, '');

    if (digitos.length !== 11) {
      throw new ErroDeDominio(`CPF deve ter 11 dígitos, recebeu ${digitos.length}`);
    }

    if (/^(\d)\1{10}$/.test(digitos)) {
      throw new ErroDeDominio('CPF com todos os dígitos iguais é inválido');
    }

    if (
      digitoVerificador(digitos, 10) !== Number(digitos[9]) ||
      digitoVerificador(digitos, 11) !== Number(digitos[10])
    ) {
      throw new ErroDeDominio('CPF com dígito verificador inválido');
    }

    return new Cpf(digitos);
  }

  static tentarCriar(bruto: string | undefined | null): Cpf | null {
    if (!bruto) return null;
    try {
      return Cpf.criar(bruto);
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/agendamento/domain/paciente`
Expected: PASS — 19 testes (9 de `Telefone`, 10 de `Cpf`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: value objects Telefone e Cpf no novo projeto NestJS"
```

---

### Task 4: Domínio — PeriodoConsulta e RespostaLembrete

**Files:**
- Create: `src/agendamento/domain/agendamento/periodo-consulta.ts`
- Create: `src/agendamento/domain/agendamento/resposta-lembrete.ts`
- Test: `src/agendamento/domain/agendamento/periodo-consulta.spec.ts`
- Test: `src/agendamento/domain/agendamento/resposta-lembrete.spec.ts`

**Interfaces:**
- Consumes: `ErroDeDominio` (Task 3)
- Produces: `FUSO_CLINICA`, `class PeriodoConsulta` (`static criar`, `inicio`, `fim`,
  `duracaoMinutos`, `comecaEm`); `type ValorResposta`, `VALORES_RESPOSTA`, `class
  RespostaLembrete` (`static criar`, `valor`, `exigeEscritaNoMedx`, `exigeAtendimentoHumano`)

Conteúdo idêntico ao já revisado — só muda caminho/extensão de import.

- [ ] **Step 1: Instalar luxon (se ainda não instalado nesta etapa)**

Run: `npm ls luxon` — se já instalado (Task 1), pule este passo.

- [ ] **Step 2: Copiar os testes**

`src/agendamento/domain/agendamento/periodo-consulta.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PeriodoConsulta } from './periodo-consulta';
import { ErroDeDominio } from '../shared/erros';

describe('PeriodoConsulta.criar', () => {
  it('converte UTC para o horário local da clínica', () => {
    expect(PeriodoConsulta.criar('2026-07-10T17:00:00Z', 30).inicio).toBe('2026-07-10T14:00:00');
  });

  it('mantém a hora quando o offset já é o de São Paulo', () => {
    expect(PeriodoConsulta.criar('2026-07-10T14:00:00-03:00', 30).inicio).toBe(
      '2026-07-10T14:00:00',
    );
  });

  it('trata string sem offset como já sendo horário da clínica', () => {
    expect(PeriodoConsulta.criar('2026-07-10T14:00:00', 30).inicio).toBe('2026-07-10T14:00:00');
  });

  it('calcula o fim somando a duração', () => {
    expect(PeriodoConsulta.criar('2026-07-10T14:00:00', 30).fim).toBe('2026-07-10T14:30:00');
  });

  it('atravessa a virada do dia', () => {
    expect(PeriodoConsulta.criar('2026-07-10T23:45:00', 30).fim).toBe('2026-07-11T00:15:00');
  });

  it('rejeita data inválida', () => {
    expect(() => PeriodoConsulta.criar('não é data', 30)).toThrow(ErroDeDominio);
  });

  it.each([0, -15])('rejeita duração de %i minutos', (duracao) => {
    expect(() => PeriodoConsulta.criar('2026-07-10T14:00:00', duracao)).toThrow(ErroDeDominio);
  });
});

describe('comecaEm', () => {
  it('ignora diferença de precisão de segundos fracionários', () => {
    expect(
      PeriodoConsulta.criar('2026-07-10T14:00:00', 30).comecaEm('2026-07-10T14:00:00.000'),
    ).toBe(true);
  });

  it('reconhece o mesmo instante expresso em UTC', () => {
    expect(PeriodoConsulta.criar('2026-07-10T14:00:00', 30).comecaEm('2026-07-10T17:00:00Z')).toBe(
      true,
    );
  });

  it('distingue horários diferentes', () => {
    expect(
      PeriodoConsulta.criar('2026-07-10T14:00:00', 30).comecaEm('2026-07-10T15:00:00'),
    ).toBe(false);
  });

  it('devolve false para data ilegível em vez de estourar', () => {
    expect(PeriodoConsulta.criar('2026-07-10T14:00:00', 30).comecaEm('lixo')).toBe(false);
  });
});
```

`src/agendamento/domain/agendamento/resposta-lembrete.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { RespostaLembrete, VALORES_RESPOSTA } from './resposta-lembrete';
import { ErroDeDominio } from '../shared/erros';

describe('RespostaLembrete.criar', () => {
  it.each(VALORES_RESPOSTA)('aceita %s', (valor) => {
    expect(RespostaLembrete.criar(valor).valor).toBe(valor);
  });

  it('normaliza caixa e espaços', () => {
    expect(RespostaLembrete.criar('  CONFIRMAR ').valor).toBe('confirmar');
  });

  it.each(['talvez', '', 'sim'])('rejeita %s', (entrada) => {
    expect(() => RespostaLembrete.criar(entrada)).toThrow(ErroDeDominio);
  });
});

describe('consequências da resposta', () => {
  it('só confirmar escreve no MedX', () => {
    expect(RespostaLembrete.criar('confirmar').exigeEscritaNoMedx).toBe(true);
    expect(RespostaLembrete.criar('reagendar').exigeEscritaNoMedx).toBe(false);
    expect(RespostaLembrete.criar('cancelar').exigeEscritaNoMedx).toBe(false);
  });

  it('reagendar e cancelar vão para a secretária', () => {
    expect(RespostaLembrete.criar('reagendar').exigeAtendimentoHumano).toBe(true);
    expect(RespostaLembrete.criar('cancelar').exigeAtendimentoHumano).toBe(true);
    expect(RespostaLembrete.criar('confirmar').exigeAtendimentoHumano).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/agendamento/domain/agendamento/periodo-consulta.spec.ts src/agendamento/domain/agendamento/resposta-lembrete.spec.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 4: Implementar `src/agendamento/domain/agendamento/periodo-consulta.ts`**

```ts
import { DateTime } from 'luxon';
import { ErroDeDominio } from '../shared/erros';

export const FUSO_CLINICA = 'America/Sao_Paulo';
const FORMATO_MEDX = "yyyy-LL-dd'T'HH:mm:ss";

function interpretar(valor: string): DateTime | null {
  const temOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(valor);
  const dt = temOffset
    ? DateTime.fromISO(valor, { setZone: true }).setZone(FUSO_CLINICA)
    : DateTime.fromISO(valor, { zone: FUSO_CLINICA });

  return dt.isValid ? dt : null;
}

export class PeriodoConsulta {
  private constructor(
    readonly inicio: string,
    readonly fim: string,
    readonly duracaoMinutos: number,
  ) {}

  static criar(inicioIso: string, duracaoMinutos: number): PeriodoConsulta {
    if (!Number.isFinite(duracaoMinutos) || duracaoMinutos <= 0) {
      throw new ErroDeDominio(`Duração da consulta deve ser positiva, recebeu ${duracaoMinutos}`);
    }

    const dt = interpretar(inicioIso);
    if (!dt) {
      throw new ErroDeDominio(`Início da consulta é uma data inválida: ${inicioIso}`);
    }

    return new PeriodoConsulta(
      dt.toFormat(FORMATO_MEDX),
      dt.plus({ minutes: duracaoMinutos }).toFormat(FORMATO_MEDX),
      duracaoMinutos,
    );
  }

  comecaEm(outroInicioIso: string): boolean {
    const outro = interpretar(outroInicioIso);
    return outro !== null && outro.toFormat(FORMATO_MEDX) === this.inicio;
  }
}
```

- [ ] **Step 5: Implementar `src/agendamento/domain/agendamento/resposta-lembrete.ts`**

```ts
import { ErroDeDominio } from '../shared/erros';

export type ValorResposta = 'confirmar' | 'reagendar' | 'cancelar';

export const VALORES_RESPOSTA: readonly ValorResposta[] = ['confirmar', 'reagendar', 'cancelar'];

export class RespostaLembrete {
  private constructor(readonly valor: ValorResposta) {}

  static criar(bruto: string): RespostaLembrete {
    const normalizado = (bruto ?? '').trim().toLowerCase();

    if (!VALORES_RESPOSTA.includes(normalizado as ValorResposta)) {
      throw new ErroDeDominio(
        `Resposta de lembrete desconhecida: "${bruto}". Esperado uma de ${VALORES_RESPOSTA.join(', ')}`,
      );
    }

    return new RespostaLembrete(normalizado as ValorResposta);
  }

  get exigeEscritaNoMedx(): boolean {
    return this.valor === 'confirmar';
  }

  get exigeAtendimentoHumano(): boolean {
    return !this.exigeEscritaNoMedx;
  }
}
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/agendamento/domain/agendamento/periodo-consulta.spec.ts src/agendamento/domain/agendamento/resposta-lembrete.spec.ts`
Expected: PASS — 12 testes de `PeriodoConsulta`, 9 de `RespostaLembrete`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: value objects PeriodoConsulta e RespostaLembrete"
```

---

### Task 5: Domínio — entidade Agendamento e seu repositório

**Files:**
- Create: `src/agendamento/domain/agendamento/agendamento.ts`
- Create: `src/agendamento/domain/agendamento/agendamento.repositorio.ts`
- Test: `src/agendamento/domain/agendamento/agendamento.spec.ts`

**Interfaces:**
- Consumes: `PeriodoConsulta` (Task 4), `ErroDeDominio` (Task 3)
- Produces: `type StatusAgendamento`, `STATUS_MEDX_AGENDADO = 0`, `interface EstadoExterno`,
  `type AvaliacaoConfirmacao`, `class Agendamento` (`static iniciar`, `static restaurar`,
  getters `idMedx`/`status`/`ultimaEdicaoConhecida`/`jaFoiCriado`/`jaFoiConfirmado`/
  `tentativaInterrompida`, métodos `registrarCriacao`/`adotarExistente`/`marcarFalha`/
  `marcarConflito`/`avaliarConfirmacao`/`confirmar`), `interface AgendamentoRepositorio`

Conteúdo idêntico ao já revisado — **incluindo o fix de `tentativaInterrompida`** aplicado
na revisão final do projeto atual (considera `status === "falhou"` além de `"enviando"`,
para não duplicar consulta num retry após falha de rede pós-gravação no MedX).

- [ ] **Step 1: Copiar o teste**

`src/agendamento/domain/agendamento/agendamento.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Agendamento, STATUS_MEDX_AGENDADO } from './agendamento';
import { PeriodoConsulta } from './periodo-consulta';
import { ErroDeDominio } from '../shared/erros';

const PERIODO = PeriodoConsulta.criar('2026-07-10T14:00:00', 30);
const INDICE_CONFIRMADO = 1;

function novo() {
  return Agendamento.iniciar({
    dealId: 'deal-1',
    idPacienteMedx: 67890,
    idProfissionalMedx: 43013640,
    periodo: PERIODO,
  });
}

describe('ciclo de vida', () => {
  it('nasce em enviando, sem id do MedX', () => {
    const a = novo();
    expect(a.status).toBe('enviando');
    expect(a.idMedx).toBeNull();
    expect(a.jaFoiCriado).toBe(false);
  });

  it('registra a criação e passa para criado', () => {
    const a = novo();
    a.registrarCriacao(1275002478);
    expect(a.idMedx).toBe(1275002478);
    expect(a.status).toBe('criado');
    expect(a.jaFoiCriado).toBe(true);
  });

  it('reconhece uma tentativa interrompida', () => {
    expect(novo().tentativaInterrompida).toBe(true);
    const a = novo();
    a.registrarCriacao(1);
    expect(a.tentativaInterrompida).toBe(false);
  });

  it('reconhece uma tentativa interrompida também após marcarFalha sem idMedx', () => {
    const a = novo();
    a.marcarFalha();
    expect(a.status).toBe('falhou');
    expect(a.idMedx).toBeNull();
    expect(a.tentativaInterrompida).toBe(true);
  });

  it('adota um agendamento que já existia no MedX', () => {
    const a = novo();
    a.adotarExistente(999);
    expect(a.idMedx).toBe(999);
    expect(a.status).toBe('criado');
  });

  it('marca falha', () => {
    const a = novo();
    a.marcarFalha();
    expect(a.status).toBe('falhou');
  });

  it('rejeita registrar criação duas vezes', () => {
    const a = novo();
    a.registrarCriacao(1);
    expect(() => a.registrarCriacao(2)).toThrow(ErroDeDominio);
  });
});

describe('avaliarConfirmacao', () => {
  function criado() {
    const a = novo();
    a.registrarCriacao(1275002478);
    return a;
  }

  it('permite quando o estado no MedX bate com o agendado', () => {
    const r = criado().avaliarConfirmacao(
      { status: STATUS_MEDX_AGENDADO, inicio: '2026-07-10T14:00:00' },
      INDICE_CONFIRMADO,
    );
    expect(r).toEqual({ permitido: true });
  });

  it('permite quando o MedX já está confirmado (reenvio do paciente)', () => {
    const r = criado().avaliarConfirmacao(
      { status: INDICE_CONFIRMADO, inicio: '2026-07-10T14:00:00' },
      INDICE_CONFIRMADO,
    );
    expect(r.permitido).toBe(true);
  });

  it('recusa quando o horário mudou desde o lembrete', () => {
    const r = criado().avaliarConfirmacao(
      { status: STATUS_MEDX_AGENDADO, inicio: '2026-07-11T09:00:00' },
      INDICE_CONFIRMADO,
    );
    expect(r).toEqual({ permitido: false, motivo: expect.stringMatching(/horário/i) });
  });

  it('recusa quando a consulta não está mais agendada', () => {
    const r = criado().avaliarConfirmacao(
      { status: 3, inicio: '2026-07-10T14:00:00' },
      INDICE_CONFIRMADO,
    );
    expect(r).toEqual({ permitido: false, motivo: expect.stringMatching(/agendada/i) });
  });

  it('recusa quando o agendamento ainda não foi criado no MedX', () => {
    const r = novo().avaliarConfirmacao(
      { status: STATUS_MEDX_AGENDADO, inicio: '2026-07-10T14:00:00' },
      INDICE_CONFIRMADO,
    );
    expect(r.permitido).toBe(false);
  });

  it('aceita o mesmo instante expresso em UTC', () => {
    const r = criado().avaliarConfirmacao(
      { status: STATUS_MEDX_AGENDADO, inicio: '2026-07-10T17:00:00Z' },
      INDICE_CONFIRMADO,
    );
    expect(r.permitido).toBe(true);
  });
});

describe('confirmar', () => {
  it('passa para confirmado e guarda a última edição', () => {
    const a = novo();
    a.registrarCriacao(1);
    a.confirmar('2026-07-09T10:00:00');
    expect(a.status).toBe('confirmado');
    expect(a.jaFoiConfirmado).toBe(true);
    expect(a.ultimaEdicaoConhecida).toBe('2026-07-09T10:00:00');
  });

  it('recusa confirmar o que nunca foi criado', () => {
    expect(() => novo().confirmar('2026-07-09T10:00:00')).toThrow(ErroDeDominio);
  });

  it('marcarConflito leva para conflito', () => {
    const a = novo();
    a.registrarCriacao(1);
    a.marcarConflito();
    expect(a.status).toBe('conflito');
  });
});

describe('restaurar', () => {
  it('reconstrói o estado vindo da persistência', () => {
    const a = Agendamento.restaurar({
      dealId: 'deal-1',
      idPacienteMedx: 67890,
      idProfissionalMedx: 43013640,
      periodo: PERIODO,
      idMedx: 1275002478,
      status: 'confirmado',
      ultimaEdicaoConhecida: '2026-07-09T10:00:00',
    });
    expect(a.jaFoiConfirmado).toBe(true);
    expect(a.idMedx).toBe(1275002478);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/domain/agendamento/agendamento.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/domain/agendamento/agendamento.ts`**

```ts
import { ErroDeDominio } from '../shared/erros';
import type { PeriodoConsulta } from './periodo-consulta';

export type StatusAgendamento = 'enviando' | 'criado' | 'confirmado' | 'conflito' | 'falhou';

/** Índice do primeiro rótulo do MedX ("Agendado"): um agendamento nasce não confirmado. */
export const STATUS_MEDX_AGENDADO = 0;

export interface EstadoExterno {
  status: number;
  inicio: string;
}

export type AvaliacaoConfirmacao = { permitido: true } | { permitido: false; motivo: string };

interface DadosBase {
  dealId: string;
  idPacienteMedx: number;
  idProfissionalMedx: number;
  periodo: PeriodoConsulta;
}

export class Agendamento {
  private constructor(
    readonly dealId: string,
    readonly idPacienteMedx: number,
    readonly idProfissionalMedx: number,
    readonly periodo: PeriodoConsulta,
    private idMedxInterno: number | null,
    private statusInterno: StatusAgendamento,
    private ultimaEdicaoInterna: string | null,
  ) {}

  static iniciar(dados: DadosBase): Agendamento {
    return new Agendamento(
      dados.dealId,
      dados.idPacienteMedx,
      dados.idProfissionalMedx,
      dados.periodo,
      null,
      'enviando',
      null,
    );
  }

  static restaurar(
    dados: DadosBase & {
      idMedx: number | null;
      status: StatusAgendamento;
      ultimaEdicaoConhecida: string | null;
    },
  ): Agendamento {
    return new Agendamento(
      dados.dealId,
      dados.idPacienteMedx,
      dados.idProfissionalMedx,
      dados.periodo,
      dados.idMedx,
      dados.status,
      dados.ultimaEdicaoConhecida,
    );
  }

  get idMedx(): number | null {
    return this.idMedxInterno;
  }

  get status(): StatusAgendamento {
    return this.statusInterno;
  }

  get ultimaEdicaoConhecida(): string | null {
    return this.ultimaEdicaoInterna;
  }

  get jaFoiCriado(): boolean {
    return this.idMedxInterno !== null;
  }

  get jaFoiConfirmado(): boolean {
    return this.statusInterno === 'confirmado';
  }

  /** Houve uma tentativa de criação que não chegou a registrar o id — pode haver órfão no MedX. */
  get tentativaInterrompida(): boolean {
    return (
      this.idMedxInterno === null &&
      (this.statusInterno === 'enviando' || this.statusInterno === 'falhou')
    );
  }

  registrarCriacao(idMedx: number): void {
    if (this.jaFoiCriado) {
      throw new ErroDeDominio(`Agendamento ${this.dealId} já tem o id ${this.idMedxInterno} no MedX`);
    }
    this.idMedxInterno = idMedx;
    this.statusInterno = 'criado';
  }

  adotarExistente(idMedx: number): void {
    this.registrarCriacao(idMedx);
  }

  marcarFalha(): void {
    this.statusInterno = 'falhou';
  }

  marcarConflito(): void {
    this.statusInterno = 'conflito';
  }

  avaliarConfirmacao(externo: EstadoExterno, indiceConfirmado: number): AvaliacaoConfirmacao {
    if (!this.jaFoiCriado) {
      return { permitido: false, motivo: 'agendamento ainda não foi criado no MedX' };
    }

    if (externo.status !== STATUS_MEDX_AGENDADO && externo.status !== indiceConfirmado) {
      return { permitido: false, motivo: 'consulta não está mais agendada no MedX' };
    }

    if (!this.periodo.comecaEm(externo.inicio)) {
      return { permitido: false, motivo: 'horário da consulta foi alterado desde o lembrete' };
    }

    return { permitido: true };
  }

  confirmar(ultimaEdicao: string): void {
    if (!this.jaFoiCriado) {
      throw new ErroDeDominio(
        `Não é possível confirmar o agendamento ${this.dealId}: ele ainda não existe no MedX`,
      );
    }
    this.statusInterno = 'confirmado';
    this.ultimaEdicaoInterna = ultimaEdicao;
  }
}
```

- [ ] **Step 4: Implementar `src/agendamento/domain/agendamento/agendamento.repositorio.ts`**

```ts
import type { Agendamento } from './agendamento';

/**
 * Assíncrona (diferente do projeto Fastify original, que era síncrona sobre
 * better-sqlite3): Prisma não tem API síncrona. Todo chamador precisa `await`.
 */
export interface AgendamentoRepositorio {
  buscarPorDeal(dealId: string): Promise<Agendamento | null>;
  salvar(agendamento: Agendamento): Promise<void>;
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/domain/agendamento/agendamento.spec.ts`
Expected: PASS — 17 testes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: entidade Agendamento com a regra de recusa de confirmação"
```

---

### Task 6: Domínio — CorrelacaoPaciente, EventoRecebido e seus repositórios

**Files:**
- Create: `src/agendamento/domain/paciente/correlacao-paciente.ts`
- Create: `src/agendamento/domain/paciente/correlacao-paciente.repositorio.ts`
- Create: `src/agendamento/domain/evento/evento-recebido.ts`
- Create: `src/agendamento/domain/evento/evento.repositorio.ts`
- Test: `src/agendamento/domain/paciente/correlacao-paciente.spec.ts`
- Test: `src/agendamento/domain/evento/evento-recebido.spec.ts`

**Interfaces:**
- Consumes: `Telefone` (Task 3)
- Produces: `class CorrelacaoPaciente` (`static criar`, `static restaurar`, `telefone`,
  `idPacienteMedx`, `matchConfiavel`, `idContatoClint`, `exigeRevisao`); `interface
  CorrelacaoPacienteRepositorio`; `type StatusEvento`, `class EventoRecebido` (`static
  restaurar`, `id`, `endpoint`, `status`, `erro`, `jobId`, `marcarProcessado`,
  `marcarInvalido`, `marcarFalha`, `associarJob`); `interface EventoRepositorio`
  (`registrar`, `salvar`, `expurgar`, `registrarExistente`)

Conteúdo idêntico ao já revisado — incluindo `registrarExistente` (adicionado na revisão
do projeto atual para o worker recarregar o evento por id). **As duas interfaces de
repositório desta task são assíncronas**, pelo mesmo motivo de `AgendamentoRepositorio`
(Task 5): Prisma não tem API síncrona.

- [ ] **Step 1: Copiar os testes**

`src/agendamento/domain/paciente/correlacao-paciente.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { CorrelacaoPaciente } from './correlacao-paciente';
import { Telefone } from './telefone';

const TELEFONE = Telefone.criar('11999998888');

describe('CorrelacaoPaciente', () => {
  it('exige revisão quando o match não é confiável', () => {
    const c = CorrelacaoPaciente.criar({
      telefone: TELEFONE,
      idPacienteMedx: 67890,
      matchConfiavel: false,
      idContatoClint: null,
    });
    expect(c.exigeRevisao).toBe(true);
  });

  it('não exige revisão quando o match é confiável', () => {
    const c = CorrelacaoPaciente.criar({
      telefone: TELEFONE,
      idPacienteMedx: 67890,
      matchConfiavel: true,
      idContatoClint: 'c1',
    });
    expect(c.exigeRevisao).toBe(false);
    expect(c.idContatoClint).toBe('c1');
  });

  it('restaura preservando o telefone como value object', () => {
    const c = CorrelacaoPaciente.restaurar({
      telefone: TELEFONE,
      idPacienteMedx: 1,
      matchConfiavel: true,
      idContatoClint: null,
    });
    expect(c.telefone.igual(TELEFONE)).toBe(true);
  });
});
```

`src/agendamento/domain/evento/evento-recebido.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EventoRecebido } from './evento-recebido';

function novo() {
  return EventoRecebido.restaurar({
    id: 1,
    endpoint: '/webhooks/clint/agendamento',
    status: 'recebido',
    erro: null,
    jobId: null,
  });
}

describe('EventoRecebido', () => {
  it('nasce recebido', () => {
    expect(novo().status).toBe('recebido');
  });

  it('marca processado', () => {
    const e = novo();
    e.marcarProcessado();
    expect(e.status).toBe('processado');
    expect(e.erro).toBeNull();
  });

  it('marca inválido guardando o motivo', () => {
    const e = novo();
    e.marcarInvalido('telefone ausente');
    expect(e.status).toBe('invalido');
    expect(e.erro).toBe('telefone ausente');
  });

  it('marca falha guardando o erro', () => {
    const e = novo();
    e.marcarFalha('MedX fora do ar');
    expect(e.status).toBe('falhou');
    expect(e.erro).toBe('MedX fora do ar');
  });

  it('associa o job da fila', () => {
    const e = novo();
    e.associarJob('job-1');
    expect(e.jobId).toBe('job-1');
  });

  it('limpa o erro ao reprocessar com sucesso', () => {
    const e = novo();
    e.marcarFalha('erro anterior');
    e.marcarProcessado();
    expect(e.erro).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/agendamento/domain/paciente/correlacao-paciente.spec.ts src/agendamento/domain/evento/evento-recebido.spec.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar `src/agendamento/domain/paciente/correlacao-paciente.ts`**

```ts
import type { Telefone } from './telefone';

interface Dados {
  telefone: Telefone;
  idPacienteMedx: number;
  matchConfiavel: boolean;
  idContatoClint: string | null;
}

export class CorrelacaoPaciente {
  private constructor(
    readonly telefone: Telefone,
    readonly idPacienteMedx: number,
    readonly matchConfiavel: boolean,
    readonly idContatoClint: string | null,
  ) {}

  static criar(dados: Dados): CorrelacaoPaciente {
    return new CorrelacaoPaciente(
      dados.telefone,
      dados.idPacienteMedx,
      dados.matchConfiavel,
      dados.idContatoClint,
    );
  }

  static restaurar(dados: Dados): CorrelacaoPaciente {
    return CorrelacaoPaciente.criar(dados);
  }

  /** Match duvidoso significa risco de ter agendado para o paciente errado. */
  get exigeRevisao(): boolean {
    return !this.matchConfiavel;
  }
}
```

- [ ] **Step 4: Implementar `src/agendamento/domain/paciente/correlacao-paciente.repositorio.ts`**

```ts
import type { Telefone } from './telefone';
import type { CorrelacaoPaciente } from './correlacao-paciente';

export interface CorrelacaoPacienteRepositorio {
  buscarPorTelefone(telefone: Telefone): Promise<CorrelacaoPaciente | null>;
  salvar(correlacao: CorrelacaoPaciente): Promise<void>;
}
```

- [ ] **Step 5: Implementar `src/agendamento/domain/evento/evento-recebido.ts`**

```ts
export type StatusEvento = 'recebido' | 'processado' | 'invalido' | 'falhou';

interface Dados {
  id: number;
  endpoint: string;
  status: StatusEvento;
  erro: string | null;
  jobId: string | null;
}

export class EventoRecebido {
  private constructor(
    readonly id: number,
    readonly endpoint: string,
    private statusInterno: StatusEvento,
    private erroInterno: string | null,
    private jobIdInterno: string | null,
  ) {}

  static restaurar(dados: Dados): EventoRecebido {
    return new EventoRecebido(dados.id, dados.endpoint, dados.status, dados.erro, dados.jobId);
  }

  get status(): StatusEvento {
    return this.statusInterno;
  }

  get erro(): string | null {
    return this.erroInterno;
  }

  get jobId(): string | null {
    return this.jobIdInterno;
  }

  marcarProcessado(): void {
    this.statusInterno = 'processado';
    this.erroInterno = null;
  }

  marcarInvalido(motivo: string): void {
    this.statusInterno = 'invalido';
    this.erroInterno = motivo;
  }

  marcarFalha(erro: string): void {
    this.statusInterno = 'falhou';
    this.erroInterno = erro;
  }

  associarJob(jobId: string): void {
    this.jobIdInterno = jobId;
  }
}
```

- [ ] **Step 6: Implementar `src/agendamento/domain/evento/evento.repositorio.ts`**

```ts
import type { EventoRecebido } from './evento-recebido';

export interface EventoRepositorio {
  /** Grava o payload bruto e devolve o evento já com id. */
  registrar(endpoint: string, payload: unknown): Promise<EventoRecebido>;
  salvar(evento: EventoRecebido): Promise<void>;
  /** Remove eventos mais antigos que a retenção; devolve quantos saíram. */
  expurgar(dias: number): Promise<number>;
  /** Reconstrói a entidade de um evento já gravado, para o worker atualizar seu estado. */
  registrarExistente(id: number): Promise<EventoRecebido>;
}
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/agendamento/domain`
Expected: PASS — todos os testes de domínio (48 no total: 9 Telefone + 10 Cpf + 12
PeriodoConsulta + 9 RespostaLembrete + 17 Agendamento... na verdade rode a suíte inteira de
`domain` e confira que tudo passa; não conte manualmente).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: entidades de correlação de paciente e evento recebido"
```

---

### Task 7: Application — os ports (com Symbol tokens de DI)

**Files:**
- Create: `src/agendamento/application/ports/agenda-medica.port.ts`
- Create: `src/agendamento/application/ports/cadastro-paciente.port.ts`
- Create: `src/agendamento/application/ports/catalogo-clinico.port.ts`
- Create: `src/agendamento/application/ports/crm.port.ts`
- Create: `src/agendamento/application/ports/notificador.port.ts`
- Create: `src/agendamento/application/ports/logger.port.ts`
- Create: `src/agendamento/application/agendar-consulta/agendar-consulta.comando.ts`
- Create: `src/agendamento/application/processar-resposta-lembrete/processar-resposta.comando.ts`
- Create: `src/agendamento/application/ports/fila.port.ts`
- Test: `src/agendamento/application/ports/contratos.spec.ts`

**Interfaces:**
- Consumes: `Cpf`, `Telefone` (Task 3)
- Produces: as mesmas interfaces do projeto atual (`AgendamentoExterno`,
  `DadosCriacaoAgendamento`, `AgendaMedicaPort`, `DadosVinculo`, `CadastroPacientePort`,
  `CatalogoClinicoPort`, `CrmPort`, `NotificadorPort`, `JobAdapter`, `FilaPort`,
  `ComandoAgendamento`, `ComandoResposta`) **mais** um `Symbol()` token exportado ao lado
  de cada interface de port, e a nova interface `LoggerMinimo` + token `LOGGER_PORT`
  (antes vivia em `lib/logger.ts`, que não existe mais nesta estrutura — a interface em si
  não muda).

Este é o único ponto onde a migração introduz algo que o projeto Fastify não tinha: o
`Symbol()` de cada port, para a DI do Nest resolver a implementação concreta.

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/application/ports/contratos.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { AgendaMedicaPort, AgendamentoExterno } from './agenda-medica.port';
import type { CadastroPacientePort } from './cadastro-paciente.port';
import type { CatalogoClinicoPort } from './catalogo-clinico.port';
import type { CrmPort } from './crm.port';
import type { NotificadorPort } from './notificador.port';
import { AGENDA_MEDICA_PORT } from './agenda-medica.port';
import { CADASTRO_PACIENTE_PORT } from './cadastro-paciente.port';
import { CATALOGO_CLINICO_PORT } from './catalogo-clinico.port';
import { CRM_PORT } from './crm.port';
import { NOTIFICADOR_PORT } from './notificador.port';
import { LOGGER_PORT } from './logger.port';
import { FILA_PORT } from './fila.port';

const EXTERNO: AgendamentoExterno = {
  id: 1275002478,
  idProfissional: 43013640,
  idPaciente: 67890,
  inicio: '2026-07-10T14:00:00',
  fim: '2026-07-10T14:30:00',
  descricao: 'Consulta',
  status: 0,
  idTipoConsulta: 111,
  confirmacao: '',
  ultimaEdicao: '2026-07-09T10:00:00',
  bruto: {},
};

describe('contratos dos ports', () => {
  it('um dublê satisfaz AgendaMedicaPort', async () => {
    const porta: AgendaMedicaPort = {
      criar: async () => 1,
      obter: async () => EXTERNO,
      listarPorPaciente: async () => [EXTERNO],
      confirmar: async () => {},
    };
    expect(
      await porta.criar({
        idProfissional: 1,
        idPaciente: 1,
        inicio: 'x',
        fim: 'y',
        descricao: 'z',
        idTipoConsulta: 1,
      }),
    ).toBe(1);
  });

  it('um dublê satisfaz os demais ports', async () => {
    const cadastro: CadastroPacientePort = {
      vincular: async () => ({ idPaciente: 1, matchConfiavel: true }),
      registrarCpf: async () => {},
    };
    const catalogo: CatalogoClinicoPort = {
      carregar: async () => {},
      resolverProfissional: async () => 1,
      resolverTipoConsulta: async () => ({ id: 1, nome: 'Consulta', duracaoMinutos: 30 }),
      indiceStatusConfirmado: () => 1,
    };
    const crm: CrmPort = {
      gravarIdAgendamento: async () => {},
      notificarConfirmacao: async () => {},
      notificarReagendamento: async () => {},
      notificarCancelamento: async () => {},
      notificarConflito: async () => {},
    };
    const notificador: NotificadorPort = { alertar: async () => {} };

    expect(catalogo.indiceStatusConfirmado()).toBe(1);
    expect((await catalogo.resolverTipoConsulta('x')).duracaoMinutos).toBe(30);
    await expect(cadastro.registrarCpf(1, {} as never)).resolves.toBeUndefined();
    await expect(crm.notificarConflito('d', 'm')).resolves.toBeUndefined();
    await expect(notificador.alertar('a', {})).resolves.toBeUndefined();
  });

  it('todos os tokens de DI são símbolos distintos', () => {
    const tokens = [
      AGENDA_MEDICA_PORT,
      CADASTRO_PACIENTE_PORT,
      CATALOGO_CLINICO_PORT,
      CRM_PORT,
      NOTIFICADOR_PORT,
      LOGGER_PORT,
      FILA_PORT,
    ];
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/application/ports/contratos.spec.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar `src/agendamento/application/ports/agenda-medica.port.ts`**

```ts
export const AGENDA_MEDICA_PORT = Symbol('AgendaMedicaPort');

export interface AgendamentoExterno {
  id: number;
  idProfissional: number;
  idPaciente: number;
  inicio: string;
  fim: string;
  descricao: string;
  status: number;
  idTipoConsulta: number;
  confirmacao: string;
  ultimaEdicao: string;
  /**
   * Payload original do sistema externo. O adapter usa isto para reconstruir uma
   * atualização completa sem perder campos que este port não modela.
   */
  bruto: unknown;
}

export interface DadosCriacaoAgendamento {
  idProfissional: number;
  idPaciente: number;
  inicio: string;
  fim: string;
  descricao: string;
  idTipoConsulta: number;
}

export interface AgendaMedicaPort {
  criar(dados: DadosCriacaoAgendamento): Promise<number>;
  obter(id: number): Promise<AgendamentoExterno>;
  listarPorPaciente(idPaciente: number): Promise<AgendamentoExterno[]>;
  confirmar(agendamento: AgendamentoExterno, indiceStatusConfirmado: number): Promise<void>;
}
```

- [ ] **Step 4: Implementar `src/agendamento/application/ports/cadastro-paciente.port.ts`**

```ts
import type { Cpf } from '../../domain/paciente/cpf';
import type { Telefone } from '../../domain/paciente/telefone';

export const CADASTRO_PACIENTE_PORT = Symbol('CadastroPacientePort');

export interface DadosVinculo {
  nome: string;
  telefone: Telefone;
  dataNascimento: string;
  email?: string;
  sexo?: 'M' | 'F';
}

export interface CadastroPacientePort {
  vincular(dados: DadosVinculo): Promise<{ idPaciente: number; matchConfiavel: boolean }>;
  registrarCpf(idPaciente: number, cpf: Cpf): Promise<void>;
}
```

- [ ] **Step 5: Implementar `src/agendamento/application/ports/catalogo-clinico.port.ts`**

```ts
export const CATALOGO_CLINICO_PORT = Symbol('CatalogoClinicoPort');

export interface TipoConsultaResolvido {
  id: number;
  nome: string;
  duracaoMinutos: number;
}

export interface CatalogoClinicoPort {
  /** Carrega as tabelas de apoio. Falha se o rótulo de confirmação não existir na conta. */
  carregar(): Promise<void>;
  resolverProfissional(valor: string | number): Promise<number>;
  resolverTipoConsulta(valor: string | number): Promise<TipoConsultaResolvido>;
  indiceStatusConfirmado(): number;
}
```

- [ ] **Step 6: Implementar `src/agendamento/application/ports/crm.port.ts`, `notificador.port.ts` e `logger.port.ts`**

`crm.port.ts`:
```ts
export const CRM_PORT = Symbol('CrmPort');

export interface CrmPort {
  gravarIdAgendamento(dealId: string, idAgendamento: number): Promise<void>;
  notificarConfirmacao(dealId: string): Promise<void>;
  notificarReagendamento(dealId: string): Promise<void>;
  notificarCancelamento(dealId: string): Promise<void>;
  notificarConflito(dealId: string, motivo: string): Promise<void>;
}
```

`notificador.port.ts`:
```ts
export const NOTIFICADOR_PORT = Symbol('NotificadorPort');

export interface NotificadorPort {
  alertar(assunto: string, detalhes: Record<string, unknown>): Promise<void>;
}
```

`logger.port.ts`:
```ts
export const LOGGER_PORT = Symbol('LoggerMinimo');

export interface LoggerMinimo {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}
```

- [ ] **Step 7: Criar os dois comandos e o port da fila**

`src/agendamento/application/agendar-consulta/agendar-consulta.comando.ts`:
```ts
export interface ComandoAgendamento {
  dealId: string;
  nome: string;
  telefone: string;
  dataNascimento: string;
  dataHora: string;
  profissional: string | number;
  tipoConsulta: string | number;
  cpf?: string;
  email?: string;
  sexo?: 'M' | 'F';
}
```

`src/agendamento/application/processar-resposta-lembrete/processar-resposta.comando.ts`:
```ts
export interface ComandoResposta {
  dealId: string;
  idAgendamentoMedx: number;
  /** Valor cru vindo do CRM; o value object RespostaLembrete valida e normaliza. */
  resposta: string;
}
```

`src/agendamento/application/ports/fila.port.ts`:
```ts
import type { ComandoAgendamento } from '../agendar-consulta/agendar-consulta.comando';
import type { ComandoResposta } from '../processar-resposta-lembrete/processar-resposta.comando';

export const FILA_PORT = Symbol('FilaPort');

export type JobAdapter =
  | { tipo: 'agendamento'; eventoId: number; comando: ComandoAgendamento }
  | { tipo: 'resposta'; eventoId: number; comando: ComandoResposta };

export interface FilaPort {
  add(nome: string, dados: JobAdapter): Promise<{ id?: string }>;
}
```

- [ ] **Step 8: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/application/ports/contratos.spec.ts`
Expected: PASS — 3 testes.

- [ ] **Step 9: Confirmar que o projeto inteiro ainda compila**

Run: `npx tsc --noEmit -p tsconfig.build.json`
Expected: sem erros.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: ports da camada de aplicação com Symbol tokens de DI"
```

---

### Task 8: Infraestrutura — schema Prisma e `PrismaService`

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/shared/persistence/prisma.service.ts`
- Create: `.env` (local, não versionado) e `.env.example` com `DATABASE_URL` de exemplo
- Test: `src/shared/persistence/prisma.service.spec.ts`

**Interfaces:**
- Consumes: nada
- Produces: `class PrismaService extends PrismaClient implements OnModuleInit,
  OnModuleDestroy` — conecta no `onModuleInit`, desconecta no `onModuleDestroy`.

Um Postgres local (ou em container) é necessário a partir desta task para
`prisma migrate dev`/testes de repositório. Assuma que existe um Postgres acessível via
`DATABASE_URL` (subir com `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres
-e POSTGRES_DB=adapter postgres:16-alpine` se não houver um já rodando localmente).

- [ ] **Step 1: `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model EventoRecebido {
  id           Int      @id @default(autoincrement())
  endpoint     String
  payloadBruto Json     @map("payload_bruto")
  recebidoEm   DateTime @default(now()) @map("recebido_em")
  status       String
  jobId        String?  @map("job_id")
  erro         String?

  @@index([recebidoEm])
  @@map("eventos_recebidos")
}

model PacienteCorrelacao {
  telefoneE164   String   @id @map("telefone_e164")
  medxIdCliente  Int      @map("medx_id_cliente")
  clintContactId String?  @map("clint_contact_id")
  matchConfiavel Boolean  @map("match_confiavel")
  criadoEm       DateTime @default(now()) @map("criado_em")

  @@map("pacientes_correlacao")
}

// inicio/ultimaEdicao são String, NÃO DateTime — ver Global Constraints e spec Seção 5:
// PeriodoConsulta produz uma string sem timezone representando horário local da clínica;
// DateTime->Date do JS reintroduziria dependência do timezone do container.
model Agendamento {
  dealId            String   @id @map("deal_id")
  medxIdAgendamento Int?     @map("medx_id_agendamento")
  medxIdCliente     Int      @map("medx_id_cliente")
  medxIdUsuario     Int      @map("medx_id_usuario")
  inicio            String
  duracaoMinutos    Int      @map("duracao_minutos")
  ultimaEdicao      String?  @map("ultima_edicao")
  status            String
  criadoEm          DateTime @default(now()) @map("criado_em")
  atualizadoEm      DateTime @updatedAt @map("atualizado_em")

  @@index([medxIdAgendamento])
  @@map("agendamentos")
}
```

- [ ] **Step 2: `.env` local e `.env.example` mínimo (expandido na Task 26)**

`.env` (não commitar — confirme que `.gitignore` já ignora `.env`):
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/adapter"
```

`.env.example` (versionado, criado agora com só esta variável — as demais entram na Task 26):
```
DATABASE_URL="postgresql://user:password@localhost:5432/adapter"
```

- [ ] **Step 3: Gerar o client e rodar a primeira migration**

```bash
npx prisma generate
npx prisma migrate dev --name inicial
```

Expected: cria `prisma/migrations/<timestamp>_inicial/migration.sql` com as três tabelas.

- [ ] **Step 4: Escrever o teste que falha**

`src/shared/persistence/prisma.service.spec.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('conecta e permite uma query simples', async () => {
    const prisma = new PrismaService();
    await prisma.onModuleInit();
    const resultado: unknown = await prisma.$queryRaw`SELECT 1 as ok`;
    expect(resultado).toEqual([{ ok: 1 }]);
    await prisma.onModuleDestroy();
  });

  it('as três tabelas existem', async () => {
    const prisma = new PrismaService();
    await prisma.onModuleInit();
    const tabelas: Array<{ table_name: string }> = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `;
    const nomes = tabelas.map((t) => t.table_name);
    expect(nomes).toContain('eventos_recebidos');
    expect(nomes).toContain('pacientes_correlacao');
    expect(nomes).toContain('agendamentos');
    await prisma.onModuleDestroy();
  });
});
```

- [ ] **Step 5: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/shared/persistence/prisma.service.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 6: Implementar `src/shared/persistence/prisma.service.ts`**

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

- [ ] **Step 7: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/shared/persistence/prisma.service.spec.ts`
Expected: PASS — 2 testes (exige o Postgres local acessível via `DATABASE_URL`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: schema Prisma e PrismaService"
```

---

### Task 9: Infraestrutura — `PersistenceModule` e repositório Prisma de Agendamento

**Files:**
- Create: `src/shared/persistence/persistence.module.ts`
- Create: `src/agendamento/infrastructure/persistencia/prisma/agendamento.prisma-repositorio.ts`
- Test: `src/agendamento/infrastructure/persistencia/prisma/agendamento.prisma-repositorio.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 8), `AgendamentoRepositorio` (Task 5, agora assíncrona)
- Produces: `AGENDAMENTO_REPOSITORIO` (Symbol, exportado de `persistence.module.ts`),
  `class AgendamentoPrismaRepositorio implements AgendamentoRepositorio`,
  `class PersistenceModule` (`@Global()`) — ganha mais providers nas Tasks 10 e 11.

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/infrastructure/persistencia/prisma/agendamento.prisma-repositorio.spec.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import { AgendamentoPrismaRepositorio } from './agendamento.prisma-repositorio';
import { Agendamento } from '../../../domain/agendamento/agendamento';
import { PeriodoConsulta } from '../../../domain/agendamento/periodo-consulta';

const PERIODO = PeriodoConsulta.criar('2026-07-10T14:00:00', 30);

function novoAgendamento() {
  return Agendamento.iniciar({
    dealId: 'deal-1',
    idPacienteMedx: 67890,
    idProfissionalMedx: 43013640,
    periodo: PERIODO,
  });
}

describe('AgendamentoPrismaRepositorio', () => {
  const prisma = new PrismaService();
  const repo = new AgendamentoPrismaRepositorio(prisma);

  beforeEach(async () => {
    await prisma.onModuleInit();
    await prisma.agendamento.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('devolve null para deal desconhecido', async () => {
    expect(await repo.buscarPorDeal('x')).toBeNull();
  });

  it('salva e restaura preservando o estado', async () => {
    const a = novoAgendamento();
    a.registrarCriacao(1275002478);
    a.confirmar('2026-07-09T10:00:00');
    await repo.salvar(a);

    const lido = (await repo.buscarPorDeal('deal-1'))!;
    expect(lido.idMedx).toBe(1275002478);
    expect(lido.status).toBe('confirmado');
    expect(lido.ultimaEdicaoConhecida).toBe('2026-07-09T10:00:00');
    expect(lido.idPacienteMedx).toBe(67890);
  });

  it('restaura o período com a duração original', async () => {
    await repo.salvar(novoAgendamento());
    const lido = (await repo.buscarPorDeal('deal-1'))!;
    expect(lido.periodo.inicio).toBe('2026-07-10T14:00:00');
    expect(lido.periodo.fim).toBe('2026-07-10T14:30:00');
  });

  it('salvar duas vezes atualiza em vez de duplicar', async () => {
    const a = novoAgendamento();
    await repo.salvar(a);
    a.registrarCriacao(99);
    await expect(repo.salvar(a)).resolves.not.toThrow();
    expect((await repo.buscarPorDeal('deal-1'))!.idMedx).toBe(99);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/infrastructure/persistencia/prisma/agendamento.prisma-repositorio.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/infrastructure/persistencia/prisma/agendamento.prisma-repositorio.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import { Agendamento, type StatusAgendamento } from '../../../domain/agendamento/agendamento';
import { PeriodoConsulta } from '../../../domain/agendamento/periodo-consulta';
import type { AgendamentoRepositorio } from '../../../domain/agendamento/agendamento.repositorio';

@Injectable()
export class AgendamentoPrismaRepositorio implements AgendamentoRepositorio {
  constructor(private readonly prisma: PrismaService) {}

  async buscarPorDeal(dealId: string): Promise<Agendamento | null> {
    const l = await this.prisma.agendamento.findUnique({ where: { dealId } });
    if (!l) return null;

    return Agendamento.restaurar({
      dealId: l.dealId,
      idPacienteMedx: l.medxIdCliente,
      idProfissionalMedx: l.medxIdUsuario,
      periodo: PeriodoConsulta.criar(l.inicio, l.duracaoMinutos),
      idMedx: l.medxIdAgendamento,
      status: l.status as StatusAgendamento,
      ultimaEdicaoConhecida: l.ultimaEdicao,
    });
  }

  async salvar(a: Agendamento): Promise<void> {
    await this.prisma.agendamento.upsert({
      where: { dealId: a.dealId },
      create: {
        dealId: a.dealId,
        medxIdAgendamento: a.idMedx,
        medxIdCliente: a.idPacienteMedx,
        medxIdUsuario: a.idProfissionalMedx,
        inicio: a.periodo.inicio,
        duracaoMinutos: a.periodo.duracaoMinutos,
        ultimaEdicao: a.ultimaEdicaoConhecida,
        status: a.status,
      },
      update: {
        medxIdAgendamento: a.idMedx,
        ultimaEdicao: a.ultimaEdicaoConhecida,
        status: a.status,
      },
    });
  }
}
```

- [ ] **Step 4: Implementar `src/shared/persistence/persistence.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AgendamentoPrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/agendamento.prisma-repositorio';

export const AGENDAMENTO_REPOSITORIO = Symbol('AgendamentoRepositorio');

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: AGENDAMENTO_REPOSITORIO, useClass: AgendamentoPrismaRepositorio },
  ],
  exports: [PrismaService, AGENDAMENTO_REPOSITORIO],
})
export class PersistenceModule {}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/infrastructure/persistencia/prisma/agendamento.prisma-repositorio.spec.ts`
Expected: PASS — 4 testes (exige Postgres local).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: PersistenceModule e repositório Prisma de Agendamento"
```

---

### Task 10: Infraestrutura — repositório Prisma de CorrelacaoPaciente

**Files:**
- Create: `src/agendamento/infrastructure/persistencia/prisma/correlacao-paciente.prisma-repositorio.ts`
- Modify: `src/shared/persistence/persistence.module.ts` (adiciona o provider, aditivo)
- Test: `src/agendamento/infrastructure/persistencia/prisma/correlacao-paciente.prisma-repositorio.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 8), `CorrelacaoPacienteRepositorio` (Task 6)
- Produces: `CORRELACAO_PACIENTE_REPOSITORIO` (Symbol), `class
  CorrelacaoPacientePrismaRepositorio implements CorrelacaoPacienteRepositorio`

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/infrastructure/persistencia/prisma/correlacao-paciente.prisma-repositorio.spec.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import { CorrelacaoPacientePrismaRepositorio } from './correlacao-paciente.prisma-repositorio';
import { CorrelacaoPaciente } from '../../../domain/paciente/correlacao-paciente';
import { Telefone } from '../../../domain/paciente/telefone';

const TELEFONE = Telefone.criar('11999998888');

describe('CorrelacaoPacientePrismaRepositorio', () => {
  const prisma = new PrismaService();
  const repo = new CorrelacaoPacientePrismaRepositorio(prisma);

  beforeEach(async () => {
    await prisma.onModuleInit();
    await prisma.pacienteCorrelacao.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('devolve null para telefone desconhecido', async () => {
    expect(await repo.buscarPorTelefone(TELEFONE)).toBeNull();
  });

  it('salva e recupera pelo value object Telefone', async () => {
    await repo.salvar(
      CorrelacaoPaciente.criar({
        telefone: TELEFONE,
        idPacienteMedx: 67890,
        matchConfiavel: false,
        idContatoClint: 'c1',
      }),
    );

    const lido = (await repo.buscarPorTelefone(Telefone.criar('+55 11 99999-8888')))!;
    expect(lido.idPacienteMedx).toBe(67890);
    expect(lido.exigeRevisao).toBe(true);
    expect(lido.idContatoClint).toBe('c1');
  });

  it('salvar duas vezes para o mesmo telefone atualiza em vez de duplicar', async () => {
    await repo.salvar(
      CorrelacaoPaciente.criar({
        telefone: TELEFONE,
        idPacienteMedx: 1,
        matchConfiavel: true,
        idContatoClint: null,
      }),
    );
    await repo.salvar(
      CorrelacaoPaciente.criar({
        telefone: TELEFONE,
        idPacienteMedx: 2,
        matchConfiavel: true,
        idContatoClint: null,
      }),
    );
    const lido = (await repo.buscarPorTelefone(TELEFONE))!;
    expect(lido.idPacienteMedx).toBe(2);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/infrastructure/persistencia/prisma/correlacao-paciente.prisma-repositorio.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/infrastructure/persistencia/prisma/correlacao-paciente.prisma-repositorio.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import { CorrelacaoPaciente } from '../../../domain/paciente/correlacao-paciente';
import { Telefone } from '../../../domain/paciente/telefone';
import type { CorrelacaoPacienteRepositorio } from '../../../domain/paciente/correlacao-paciente.repositorio';

@Injectable()
export class CorrelacaoPacientePrismaRepositorio implements CorrelacaoPacienteRepositorio {
  constructor(private readonly prisma: PrismaService) {}

  async buscarPorTelefone(telefone: Telefone): Promise<CorrelacaoPaciente | null> {
    const l = await this.prisma.pacienteCorrelacao.findUnique({
      where: { telefoneE164: telefone.e164 },
    });
    if (!l) return null;

    return CorrelacaoPaciente.restaurar({
      telefone: Telefone.criar(l.telefoneE164),
      idPacienteMedx: l.medxIdCliente,
      matchConfiavel: l.matchConfiavel,
      idContatoClint: l.clintContactId,
    });
  }

  async salvar(c: CorrelacaoPaciente): Promise<void> {
    await this.prisma.pacienteCorrelacao.upsert({
      where: { telefoneE164: c.telefone.e164 },
      create: {
        telefoneE164: c.telefone.e164,
        medxIdCliente: c.idPacienteMedx,
        clintContactId: c.idContatoClint,
        matchConfiavel: c.matchConfiavel,
      },
      update: {
        medxIdCliente: c.idPacienteMedx,
        clintContactId: c.idContatoClint,
        matchConfiavel: c.matchConfiavel,
      },
    });
  }
}
```

- [ ] **Step 4: Modificar `src/shared/persistence/persistence.module.ts` (aditivo)**

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AgendamentoPrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/agendamento.prisma-repositorio';
import { CorrelacaoPacientePrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/correlacao-paciente.prisma-repositorio';

export const AGENDAMENTO_REPOSITORIO = Symbol('AgendamentoRepositorio');
export const CORRELACAO_PACIENTE_REPOSITORIO = Symbol('CorrelacaoPacienteRepositorio');

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: AGENDAMENTO_REPOSITORIO, useClass: AgendamentoPrismaRepositorio },
    { provide: CORRELACAO_PACIENTE_REPOSITORIO, useClass: CorrelacaoPacientePrismaRepositorio },
  ],
  exports: [PrismaService, AGENDAMENTO_REPOSITORIO, CORRELACAO_PACIENTE_REPOSITORIO],
})
export class PersistenceModule {}
```

Confirme que o único trecho alterado em relação à Task 9 é a adição do import, do
`Symbol`, do provider e da entrada em `exports` — nada removido.

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/infrastructure/persistencia/prisma/correlacao-paciente.prisma-repositorio.spec.ts`
Expected: PASS — 3 testes.

- [ ] **Step 6: Rodar o repositório de Agendamento de novo para confirmar que a modificação do módulo não quebrou nada**

Run: `npx vitest run src/agendamento/infrastructure/persistencia/prisma`
Expected: PASS — 7 testes (4 de Agendamento + 3 de CorrelacaoPaciente).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: repositório Prisma de CorrelacaoPaciente"
```

---

### Task 11: Infraestrutura — repositório Prisma de Evento

**Files:**
- Create: `src/agendamento/infrastructure/persistencia/prisma/evento.prisma-repositorio.ts`
- Modify: `src/shared/persistence/persistence.module.ts` (adiciona o provider, aditivo)
- Test: `src/agendamento/infrastructure/persistencia/prisma/evento.prisma-repositorio.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 8), `EventoRepositorio` (Task 6)
- Produces: `EVENTO_REPOSITORIO` (Symbol), `class EventoPrismaRepositorio implements
  EventoRepositorio`

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/infrastructure/persistencia/prisma/evento.prisma-repositorio.spec.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import { EventoPrismaRepositorio } from './evento.prisma-repositorio';

describe('EventoPrismaRepositorio', () => {
  const prisma = new PrismaService();
  const repo = new EventoPrismaRepositorio(prisma);

  beforeEach(async () => {
    await prisma.onModuleInit();
    await prisma.eventoRecebido.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('registra devolvendo a entidade com id', async () => {
    const e = await repo.registrar('/webhooks/clint/agendamento', { deal_id: 'd1' });
    expect(e.id).toBeGreaterThan(0);
    expect(e.status).toBe('recebido');
  });

  it('persiste a transição para falhou com o erro', async () => {
    const e = await repo.registrar('/x', {});
    e.marcarFalha('MedX fora do ar');
    await repo.salvar(e);

    const linha = await prisma.eventoRecebido.findUniqueOrThrow({ where: { id: e.id } });
    expect(linha.status).toBe('falhou');
    expect(linha.erro).toBe('MedX fora do ar');
  });

  it('expurga eventos mais antigos que a retenção', async () => {
    const antigo = new Date();
    antigo.setDate(antigo.getDate() - 100);
    await prisma.eventoRecebido.create({
      data: { endpoint: '/x', payloadBruto: {}, status: 'processado', recebidoEm: antigo },
    });
    await repo.registrar('/x', {});
    expect(await repo.expurgar(90)).toBe(1);
  });

  it('grava o job associado', async () => {
    const e = await repo.registrar('/x', {});
    e.associarJob('job-1');
    await repo.salvar(e);

    const linha = await prisma.eventoRecebido.findUniqueOrThrow({ where: { id: e.id } });
    expect(linha.jobId).toBe('job-1');
  });

  it('reconstrói um evento existente por id', async () => {
    const e = await repo.registrar('/x', {});
    const outro = await repo.registrarExistente(e.id);
    expect(outro.id).toBe(e.id);
    expect(outro.status).toBe('recebido');
  });

  it('lança quando o evento não existe', async () => {
    await expect(repo.registrarExistente(999999)).rejects.toThrow(/999999/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/infrastructure/persistencia/prisma/evento.prisma-repositorio.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/infrastructure/persistencia/prisma/evento.prisma-repositorio.ts`**

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import { EventoRecebido, type StatusEvento } from '../../../domain/evento/evento-recebido';
import type { EventoRepositorio } from '../../../domain/evento/evento.repositorio';

@Injectable()
export class EventoPrismaRepositorio implements EventoRepositorio {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(endpoint: string, payload: unknown): Promise<EventoRecebido> {
    const criado = await this.prisma.eventoRecebido.create({
      data: {
        endpoint,
        payloadBruto: payload as Prisma.InputJsonValue,
        status: 'recebido',
      },
    });

    return EventoRecebido.restaurar({
      id: criado.id,
      endpoint,
      status: 'recebido' as StatusEvento,
      erro: null,
      jobId: null,
    });
  }

  async salvar(evento: EventoRecebido): Promise<void> {
    await this.prisma.eventoRecebido.update({
      where: { id: evento.id },
      data: { status: evento.status, erro: evento.erro, jobId: evento.jobId },
    });
  }

  async expurgar(dias: number): Promise<number> {
    const limite = new Date();
    limite.setDate(limite.getDate() - dias);
    const resultado = await this.prisma.eventoRecebido.deleteMany({
      where: { recebidoEm: { lt: limite } },
    });
    return resultado.count;
  }

  async registrarExistente(id: number): Promise<EventoRecebido> {
    const l = await this.prisma.eventoRecebido.findUnique({ where: { id } });
    if (!l) {
      throw new Error(`Evento ${id} não encontrado`);
    }
    return EventoRecebido.restaurar({
      id: l.id,
      endpoint: l.endpoint,
      status: l.status as StatusEvento,
      erro: l.erro,
      jobId: l.jobId,
    });
  }
}
```

- [ ] **Step 4: Modificar `src/shared/persistence/persistence.module.ts` (aditivo)**

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AgendamentoPrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/agendamento.prisma-repositorio';
import { CorrelacaoPacientePrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/correlacao-paciente.prisma-repositorio';
import { EventoPrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/evento.prisma-repositorio';

export const AGENDAMENTO_REPOSITORIO = Symbol('AgendamentoRepositorio');
export const CORRELACAO_PACIENTE_REPOSITORIO = Symbol('CorrelacaoPacienteRepositorio');
export const EVENTO_REPOSITORIO = Symbol('EventoRepositorio');

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: AGENDAMENTO_REPOSITORIO, useClass: AgendamentoPrismaRepositorio },
    { provide: CORRELACAO_PACIENTE_REPOSITORIO, useClass: CorrelacaoPacientePrismaRepositorio },
    { provide: EVENTO_REPOSITORIO, useClass: EventoPrismaRepositorio },
  ],
  exports: [
    PrismaService,
    AGENDAMENTO_REPOSITORIO,
    CORRELACAO_PACIENTE_REPOSITORIO,
    EVENTO_REPOSITORIO,
  ],
})
export class PersistenceModule {}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/infrastructure/persistencia/prisma/evento.prisma-repositorio.spec.ts`
Expected: PASS — 6 testes.

- [ ] **Step 6: Rodar toda a suíte de persistência**

Run: `npx vitest run src/agendamento/infrastructure/persistencia`
Expected: PASS — 13 testes (4 Agendamento + 3 CorrelacaoPaciente + 6 Evento).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: repositório Prisma de Evento e PersistenceModule completo"
```

---

### Task 12: Infraestrutura MedX — erros, tipos e `MedxTokenProvider`

**Files:**
- Create: `src/agendamento/infrastructure/medx/medx.erros.ts`
- Create: `src/agendamento/infrastructure/medx/medx.tipos.ts`
- Create: `src/agendamento/infrastructure/medx/medx-token.provider.ts`
- Test: `src/agendamento/infrastructure/medx/medx-token.provider.spec.ts`

**Interfaces:**
- Consumes: `@nestjs/config` (`ConfigService`)
- Produces: `class ErroMedx extends Error` (`status`), `class ErroRateLimit extends
  ErroMedx` (`esperarSegundos`); tipos crus `MedxProfissional`, `MedxTipoAgendamento`,
  `MedxAgendamento`, `MedxVinculoResposta`; `class MedxTokenProvider` (`@Injectable()`,
  `obterToken()`, `invalidar()`, propriedade pública `agora: () => number` para testes
  controlarem o relógio sem precisar de injeção — produção usa `Date.now`).

`MedxTokenProvider` substitui a fábrica `criarTokenProvider(opcoes)` do projeto Fastify: a
lógica interna (renovação 120s antes de expirar, colapso de chamadas concorrentes) é
idêntica, só migra de closures para campos de instância, e lê `MEDX_HOST`/
`MEDX_INTEGRATION_TOKEN` via `ConfigService` em vez de receber via `opcoes`.

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/infrastructure/medx/medx-token.provider.spec.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { MedxTokenProvider } from './medx-token.provider';

const respostaOk = (token: string) =>
  new Response(
    JSON.stringify({ accessToken: token, tokenType: 'Bearer', expiresInSeconds: 900, scope: '' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

function configFalso(): ConfigService {
  const valores: Record<string, string> = {
    MEDX_HOST: 'https://medx.test',
    MEDX_INTEGRATION_TOKEN: 'tk',
  };
  return { get: (chave: string) => valores[chave] } as ConfigService;
}

afterEach(() => vi.restoreAllMocks());

describe('MedxTokenProvider', () => {
  it('busca o token na primeira chamada', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaOk('jwt-1'));
    const provider = new MedxTokenProvider(configFalso());
    expect(await provider.obterToken()).toBe('jwt-1');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('posta o IntegrationToken no corpo, no endpoint certo', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaOk('jwt-1'));
    const provider = new MedxTokenProvider(configFalso());
    await provider.obterToken();

    expect(String(spy.mock.calls[0]![0])).toBe('https://medx.test/api/integration/token');
    expect(JSON.parse(String(spy.mock.calls[0]![1]!.body))).toEqual({ IntegrationToken: 'tk' });
  });

  it('reaproveita o token dentro da validade', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaOk('jwt-1'));
    const provider = new MedxTokenProvider(configFalso());
    await provider.obterToken();
    await provider.obterToken();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('renova quando faltam menos de 120s para expirar', async () => {
    let agora = 0;
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(respostaOk('jwt-1'))
      .mockResolvedValueOnce(respostaOk('jwt-2'));

    const provider = new MedxTokenProvider(configFalso());
    provider.agora = () => agora;
    expect(await provider.obterToken()).toBe('jwt-1');
    agora = 800_000; // restam 100s
    expect(await provider.obterToken()).toBe('jwt-2');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('colapsa chamadas concorrentes numa única requisição', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respostaOk('jwt-1'));
    const provider = new MedxTokenProvider(configFalso());
    await Promise.all([provider.obterToken(), provider.obterToken(), provider.obterToken()]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('busca de novo depois de invalidar', async () => {
    // Duas Response distintas: reusar uma só via mockResolvedValue quebraria
    // na segunda leitura de .json() ("Body is unusable") — mesmo cuidado já
    // identificado e corrigido no projeto Fastify original.
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(respostaOk('jwt-1'))
      .mockResolvedValueOnce(respostaOk('jwt-1'));
    const provider = new MedxTokenProvider(configFalso());
    await provider.obterToken();
    provider.invalidar();
    await provider.obterToken();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('propaga erro quando o token de integração é recusado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    const provider = new MedxTokenProvider(configFalso());
    await expect(provider.obterToken()).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/infrastructure/medx/medx-token.provider.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/infrastructure/medx/medx.erros.ts`**

```ts
export class ErroMedx extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroMedx';
  }
}

export class ErroRateLimit extends ErroMedx {
  constructor(readonly esperarSegundos: number) {
    super(429, `Rate limit do MedX atingido; aguardar ${esperarSegundos}s`);
    this.name = 'ErroRateLimit';
  }
}
```

- [ ] **Step 4: Implementar `src/agendamento/infrastructure/medx/medx.tipos.ts`**

```ts
export interface MedxProfissional {
  IdDoUsuario: number;
  NomeCompleto: string;
  UsuarioNome: string;
  Ativo: boolean;
  Agenda: boolean;
  LinkAgendamentoOnline: string;
}

export interface MedxTipoAgendamento {
  IddoDiagnosticoQP: number;
  DiagnosticoQP: string;
  Tempo: number;
}

export interface MedxAgendamento {
  Id_do_Agendamento: number;
  Id_do_Usuario: number;
  Inicio: string;
  Final: string;
  Descricao: string;
  Status: number;
  Vinculado_a: number;
  Id_do_TipoConsulta: number;
  Confirmacao: string;
  LastEditDate: string;
  Nome?: string;
  SMS?: string;
}

export interface MedxVinculoResposta {
  Id: string;
  Match: boolean;
}
```

- [ ] **Step 5: Implementar `src/agendamento/infrastructure/medx/medx-token.provider.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const MARGEM_RENOVACAO_MS = 120_000;

@Injectable()
export class MedxTokenProvider {
  /** Sobrescrito em testes para controlar o relógio; produção usa Date.now. */
  agora: () => number = Date.now;

  private token: string | null = null;
  private expiraEm = 0;
  private emVoo: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  async obterToken(): Promise<string> {
    if (this.token && this.agora() < this.expiraEm - MARGEM_RENOVACAO_MS) {
      return this.token;
    }
    // A troca de token é limitada a 10 req/min por IP: chamadas concorrentes
    // compartilham a mesma requisição em voo.
    this.emVoo ??= this.buscar().finally(() => {
      this.emVoo = null;
    });
    return this.emVoo;
  }

  invalidar(): void {
    this.token = null;
    this.expiraEm = 0;
  }

  private async buscar(): Promise<string> {
    const host = this.config.get<string>('MEDX_HOST');
    const integrationToken = this.config.get<string>('MEDX_INTEGRATION_TOKEN');

    const resposta = await fetch(`${host}/api/integration/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ IntegrationToken: integrationToken }),
    });

    if (!resposta.ok) {
      throw new Error(`Falha ao trocar o token de integração: HTTP ${resposta.status}`);
    }

    const dados = (await resposta.json()) as { accessToken: string; expiresInSeconds: number };
    this.token = dados.accessToken;
    this.expiraEm = this.agora() + dados.expiresInSeconds * 1000;
    return this.token;
  }
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/infrastructure/medx/medx-token.provider.spec.ts`
Expected: PASS — 7 testes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: MedxTokenProvider como serviço injetável"
```

---

### Task 13: Infraestrutura MedX — `MedxHttpClient`

**Files:**
- Create: `src/agendamento/infrastructure/medx/medx-http.client.ts`
- Test: `src/agendamento/infrastructure/medx/medx-http.client.spec.ts`

**Interfaces:**
- Consumes: `MedxTokenProvider` (Task 12), `ErroMedx`/`ErroRateLimit` (Task 12),
  `ConfigService`
- Produces: `type Query`, `class MedxHttpClient` (`@Injectable()`, `get`/`post`/`put`)

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/infrastructure/medx/medx-http.client.spec.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { MedxHttpClient } from './medx-http.client';
import { MedxTokenProvider } from './medx-token.provider';
import { ErroRateLimit, ErroMedx } from './medx.erros';

afterEach(() => vi.restoreAllMocks());

function configFalso(): ConfigService {
  return { get: () => 'https://medx.test' } as ConfigService;
}

function tokensFalsos(): MedxTokenProvider & { foiInvalidado: () => boolean } {
  let invalidado = false;
  return {
    obterToken: async () => (invalidado ? 'jwt-novo' : 'jwt-1'),
    invalidar: () => {
      invalidado = true;
    },
    foiInvalidado: () => invalidado,
  } as unknown as MedxTokenProvider & { foiInvalidado: () => boolean };
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

function cliente() {
  const tokens = tokensFalsos();
  return { client: new MedxHttpClient(configFalso(), tokens), tokens };
}

describe('MedxHttpClient', () => {
  it('envia o Bearer token no header', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));
    await cliente().client.get('/api/integration/agenda/status');

    const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer jwt-1');
  });

  it('monta a query string ignorando valores indefinidos', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));
    await cliente().client.get('/x', { inicio: '2026-07-10', idUsuario: 12, setor: undefined });

    expect(String(spy.mock.calls[0]![0])).toBe('https://medx.test/x?inicio=2026-07-10&idUsuario=12');
  });

  it('converte 429 em ErroRateLimit lendo o Retry-After', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 429, headers: { 'retry-after': '60' } }),
    );
    await expect(cliente().client.get('/x')).rejects.toMatchObject({ esperarSegundos: 60 });
    await expect(cliente().client.get('/x')).rejects.toBeInstanceOf(ErroRateLimit);
  });

  it('usa 60 segundos quando o 429 não traz Retry-After', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 429 }));
    await expect(cliente().client.get('/x')).rejects.toMatchObject({ esperarSegundos: 60 });
  });

  it('renova o token uma vez ao receber 401 e repete a chamada', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(json({ ok: true }));

    const { client, tokens } = cliente();
    await expect(client.get('/x')).resolves.toEqual({ ok: true });
    expect(tokens.foiInvalidado()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('não repete indefinidamente quando o 401 persiste', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    await expect(cliente().client.get('/x')).rejects.toBeInstanceOf(ErroMedx);
  });

  it('resolve para número quando o corpo é o inteiro do POST de agendamento', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('1275002478', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    await expect(cliente().client.post('/x', {})).resolves.toBe(1275002478);
  });

  it('resolve para string quando o corpo é uma mensagem de texto', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Agendamento atualizado com sucesso.', { status: 200 }),
    );
    await expect(cliente().client.put('/x', {})).resolves.toBe('Agendamento atualizado com sucesso.');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/infrastructure/medx/medx-http.client.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/infrastructure/medx/medx-http.client.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MedxTokenProvider } from './medx-token.provider';
import { ErroMedx, ErroRateLimit } from './medx.erros';

export type Query = Record<string, string | number | undefined>;

function montarUrl(host: string, caminho: string, query?: Query): string {
  if (!query) return `${host}${caminho}`;

  const partes = Object.entries(query)
    .filter(([, valor]) => valor !== undefined)
    .map(([chave, valor]) => `${encodeURIComponent(chave)}=${encodeURIComponent(String(valor))}`);

  return partes.length ? `${host}${caminho}?${partes.join('&')}` : `${host}${caminho}`;
}

/** A API devolve ora JSON, ora um inteiro puro, ora uma frase. Todos são respostas válidas. */
async function lerCorpo<T>(resposta: Response): Promise<T> {
  const texto = await resposta.text();
  if (texto === '') return undefined as T;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return texto as T;
  }
}

@Injectable()
export class MedxHttpClient {
  constructor(
    private readonly config: ConfigService,
    private readonly tokens: MedxTokenProvider,
  ) {}

  get<T>(caminho: string, query?: Query): Promise<T> {
    return this.chamar<T>('GET', caminho, query);
  }

  post<T>(caminho: string, corpo: unknown): Promise<T> {
    return this.chamar<T>('POST', caminho, undefined, corpo);
  }

  put<T>(caminho: string, corpo: unknown): Promise<T> {
    return this.chamar<T>('PUT', caminho, undefined, corpo);
  }

  private async chamar<T>(
    metodo: string,
    caminho: string,
    query?: Query,
    corpo?: unknown,
    jaRenovou = false,
  ): Promise<T> {
    const host = this.config.get<string>('MEDX_HOST');
    const token = await this.tokens.obterToken();

    const resposta = await fetch(montarUrl(host!, caminho, query), {
      method: metodo,
      headers: {
        authorization: `Bearer ${token}`,
        ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    });

    if (resposta.status === 429) {
      const cabecalho = resposta.headers.get('retry-after');
      const segundos = cabecalho ? Number(cabecalho) : 60;
      throw new ErroRateLimit(Number.isFinite(segundos) ? segundos : 60);
    }

    if (resposta.status === 401 && !jaRenovou) {
      this.tokens.invalidar();
      return this.chamar<T>(metodo, caminho, query, corpo, true);
    }

    if (!resposta.ok) {
      throw new ErroMedx(resposta.status, `MedX respondeu HTTP ${resposta.status} em ${caminho}`);
    }

    return lerCorpo<T>(resposta);
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/infrastructure/medx/medx-http.client.spec.ts`
Expected: PASS — 8 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: MedxHttpClient como serviço injetável"
```

---

### Task 14: Infraestrutura MedX — `MedxCatalogoAdapter`

**Files:**
- Create: `src/agendamento/infrastructure/medx/medx-catalogo.adapter.ts`
- Test: `src/agendamento/infrastructure/medx/medx-catalogo.adapter.spec.ts`

**Interfaces:**
- Consumes: `MedxHttpClient` (Task 13), tipos (Task 12), `CatalogoClinicoPort` (Task 7)
- Produces: `class MedxCatalogoAdapter implements CatalogoClinicoPort` (`@Injectable()`,
  propriedades públicas `ttlMs`/`agora` para controle em teste)

**Atenção:** a descoberta do índice de "Confirmado" usa **igualdade exata** pós-
normalização (`chave(rotulo) === 'confirmado'`), não `startsWith` — esse é o fix de
segurança aplicado na revisão final do projeto atual (um `startsWith` colidiria com um
rótulo customizado como "Confirmação Pendente", causando um falso match silencioso).

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/infrastructure/medx/medx-catalogo.adapter.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MedxCatalogoAdapter } from './medx-catalogo.adapter';
import type { MedxHttpClient } from './medx-http.client';

const PROFISSIONAIS = [
  {
    IdDoUsuario: 43013640,
    NomeCompleto: 'Leize Ferreira',
    UsuarioNome: 'leize',
    Ativo: true,
    Agenda: true,
    LinkAgendamentoOnline: '',
  },
];
const TIPOS = [{ IddoDiagnosticoQP: 111, DiagnosticoQP: 'Consulta de Rotina', Tempo: 30 }];
const STATUS = ['Agendado', 'Confirmado', 'Chegou', 'Cancelado'];

function clientFalso(status: string[] = STATUS) {
  const chamadas: string[] = [];
  const client = {
    async get<T>(caminho: string): Promise<T> {
      chamadas.push(caminho);
      if (caminho.endsWith('/status')) return status as T;
      if (caminho.endsWith('/tipos')) return TIPOS as T;
      if (caminho.endsWith('/profissionais')) return PROFISSIONAIS as T;
      throw new Error(`caminho inesperado: ${caminho}`);
    },
    post: async <T>() => ({}) as T,
    put: async <T>() => ({}) as T,
  } as unknown as MedxHttpClient;
  return { client, chamadas };
}

describe('índice de status', () => {
  it('é descoberto, não codificado', async () => {
    const c = new MedxCatalogoAdapter(clientFalso().client);
    await c.carregar();
    expect(c.indiceStatusConfirmado()).toBe(1);
  });

  it('acompanha a reordenação dos rótulos da conta', async () => {
    const c = new MedxCatalogoAdapter(
      clientFalso(['Agendado', 'Chegou', 'Cancelado', 'Confirmado']).client,
    );
    await c.carregar();
    expect(c.indiceStatusConfirmado()).toBe(3);
  });

  it('ignora acento e caixa ao procurar o rótulo', async () => {
    const c = new MedxCatalogoAdapter(clientFalso(['Agendado', 'CONFIRMADO']).client);
    await c.carregar();
    expect(c.indiceStatusConfirmado()).toBe(1);
  });

  it('não confunde "Confirmação Pendente" com "Confirmado"', async () => {
    const c = new MedxCatalogoAdapter(
      clientFalso(['Agendado', 'Confirmação Pendente', 'Confirmado', 'Cancelado']).client,
    );
    await c.carregar();
    expect(c.indiceStatusConfirmado()).toBe(2);
  });

  it('falha no carregamento quando não existe rótulo de confirmação', async () => {
    const c = new MedxCatalogoAdapter(clientFalso(['Agendado', 'Chegou', 'Cancelado']).client);
    await expect(c.carregar()).rejects.toThrow(/Confirmado/);
  });

  it('erra com mensagem clara se consultado antes de carregar', () => {
    expect(() => new MedxCatalogoAdapter(clientFalso().client).indiceStatusConfirmado()).toThrow(
      /carregar/,
    );
  });
});

describe('resolução de profissional e tipo', () => {
  it('resolve profissional por nome completo', async () => {
    const c = new MedxCatalogoAdapter(clientFalso().client);
    await c.carregar();
    expect(await c.resolverProfissional('Leize Ferreira')).toBe(43013640);
  });

  it('resolve ignorando caixa, acento e espaços', async () => {
    const c = new MedxCatalogoAdapter(clientFalso().client);
    await c.carregar();
    expect(await c.resolverProfissional('  leize ferreira ')).toBe(43013640);
  });

  it('aceita o id numérico direto sem nova consulta', async () => {
    const { client, chamadas } = clientFalso();
    const c = new MedxCatalogoAdapter(client);
    await c.carregar();
    chamadas.length = 0;
    expect(await c.resolverProfissional(43013640)).toBe(43013640);
    expect(chamadas).toHaveLength(0);
  });

  it('resolve tipo devolvendo id, nome e duração', async () => {
    const c = new MedxCatalogoAdapter(clientFalso().client);
    await c.carregar();
    expect(await c.resolverTipoConsulta('Consulta de Rotina')).toEqual({
      id: 111,
      nome: 'Consulta de Rotina',
      duracaoMinutos: 30,
    });
  });

  it('erra com mensagem útil quando o profissional não existe', async () => {
    const c = new MedxCatalogoAdapter(clientFalso().client);
    await c.carregar();
    await expect(c.resolverProfissional('Fulano')).rejects.toThrow(/Fulano/);
  });

  it('revalida o cache depois do TTL', async () => {
    let agora = 0;
    const { client, chamadas } = clientFalso();
    const c = new MedxCatalogoAdapter(client);
    c.ttlMs = 1000;
    c.agora = () => agora;
    await c.carregar();
    const antes = chamadas.length;
    agora = 2000;
    await c.resolverProfissional('Leize Ferreira');
    expect(chamadas.length).toBeGreaterThan(antes);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/infrastructure/medx/medx-catalogo.adapter.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/infrastructure/medx/medx-catalogo.adapter.ts`**

```ts
import { Injectable } from '@nestjs/common';
import type { CatalogoClinicoPort, TipoConsultaResolvido } from '../../application/ports/catalogo-clinico.port';
import { MedxHttpClient } from './medx-http.client';
import type { MedxProfissional, MedxTipoAgendamento } from './medx.tipos';

const TTL_PADRAO_MS = 6 * 60 * 60 * 1000;

function chave(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

@Injectable()
export class MedxCatalogoAdapter implements CatalogoClinicoPort {
  ttlMs = TTL_PADRAO_MS;
  agora: () => number = Date.now;

  private profissionais: MedxProfissional[] = [];
  private tipos: MedxTipoAgendamento[] = [];
  private indiceConfirmado = -1;
  private carregadoEm = -Infinity;

  constructor(private readonly client: MedxHttpClient) {}

  async carregar(): Promise<void> {
    const [p, t, s] = await Promise.all([
      this.client.get<MedxProfissional[]>('/api/integration/financas/profissionais'),
      this.client.get<MedxTipoAgendamento[]>('/api/integration/agenda/tipos'),
      this.client.get<string[]>('/api/integration/agenda/status'),
    ]);

    this.profissionais = p;
    this.tipos = t;
    // Igualdade exata pós-normalização — NUNCA startsWith (colidiria com um
    // rótulo customizado como "Confirmação Pendente").
    this.indiceConfirmado = s.findIndex((rotulo) => chave(rotulo) === 'confirmado');

    if (this.indiceConfirmado < 0) {
      throw new Error(
        `Nenhum rótulo de status corresponde a "Confirmado" nesta conta do MedX. ` +
          `Rótulos recebidos: ${JSON.stringify(s)}`,
      );
    }

    this.carregadoEm = this.agora();
  }

  private async garantirCache(): Promise<void> {
    if (this.agora() - this.carregadoEm >= this.ttlMs) await this.carregar();
  }

  async resolverProfissional(valor: string | number): Promise<number> {
    if (typeof valor === 'number') return valor;
    if (/^\d+$/.test(valor.trim())) return Number(valor.trim());

    await this.garantirCache();
    const alvo = chave(valor);
    const achado = this.profissionais.find(
      (p) => chave(p.NomeCompleto) === alvo || chave(p.UsuarioNome) === alvo,
    );

    if (!achado) {
      throw new Error(`Profissional não encontrado no MedX: "${valor}"`);
    }
    return achado.IdDoUsuario;
  }

  async resolverTipoConsulta(valor: string | number): Promise<TipoConsultaResolvido> {
    await this.garantirCache();

    const ehNumero = typeof valor === 'number' || /^\d+$/.test(String(valor).trim());
    const achado = ehNumero
      ? this.tipos.find((t) => t.IddoDiagnosticoQP === Number(valor))
      : this.tipos.find((t) => chave(t.DiagnosticoQP) === chave(String(valor)));

    if (!achado) {
      throw new Error(`Tipo de consulta não encontrado no MedX: "${valor}"`);
    }

    return {
      id: achado.IddoDiagnosticoQP,
      nome: achado.DiagnosticoQP,
      duracaoMinutos: achado.Tempo,
    };
  }

  indiceStatusConfirmado(): number {
    if (this.indiceConfirmado < 0) {
      throw new Error('Catálogo do MedX não foi inicializado — chame carregar() antes');
    }
    return this.indiceConfirmado;
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/infrastructure/medx/medx-catalogo.adapter.spec.ts`
Expected: PASS — 12 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: MedxCatalogoAdapter com descoberta do índice de status"
```

---

### Task 15: Infraestrutura MedX — `MedxCadastroPacienteAdapter`

**Files:**
- Create: `src/agendamento/infrastructure/medx/medx-cadastro-paciente.adapter.ts`
- Test: `src/agendamento/infrastructure/medx/medx-cadastro-paciente.adapter.spec.ts`

**Interfaces:**
- Consumes: `MedxHttpClient` (Task 13), `MedxVinculoResposta` (Task 12),
  `CadastroPacientePort` (Task 7), `Telefone`/`Cpf` (Task 3)
- Produces: `class MedxCadastroPacienteAdapter implements CadastroPacientePort`
  (`@Injectable()`)

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/infrastructure/medx/medx-cadastro-paciente.adapter.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MedxCadastroPacienteAdapter } from './medx-cadastro-paciente.adapter';
import type { MedxHttpClient } from './medx-http.client';
import { Telefone } from '../../domain/paciente/telefone';
import { Cpf } from '../../domain/paciente/cpf';

const TELEFONE = Telefone.criar('+55 11 99999-8888');
const CPF = Cpf.criar('529.982.247-25');

function clientFalso(resposta: unknown) {
  const enviados: Array<{ caminho: string; corpo: unknown }> = [];
  const client = {
    get: async <T>() => ({}) as T,
    post: async <T>(caminho: string, corpo: unknown) => {
      enviados.push({ caminho, corpo });
      return resposta as T;
    },
    put: async <T>(caminho: string, corpo: unknown) => {
      enviados.push({ caminho, corpo });
      return 'Success' as T;
    },
  } as unknown as MedxHttpClient;
  return { client, enviados };
}

const DADOS = { nome: 'Maria Silva', telefone: TELEFONE, dataNascimento: '1990-05-20' };

describe('vincular', () => {
  it('converte o Id string da resposta em número', async () => {
    const { client } = clientFalso({ Id: '67890', Match: true });
    expect(await new MedxCadastroPacienteAdapter(client).vincular(DADOS)).toEqual({
      idPaciente: 67890,
      matchConfiavel: true,
    });
  });

  it('propaga match não confiável', async () => {
    const { client } = clientFalso({ Id: '1', Match: false });
    const r = await new MedxCadastroPacienteAdapter(client).vincular(DADOS);
    expect(r.matchConfiavel).toBe(false);
  });

  it('envia o telefone no formato nacional que a API espera', async () => {
    const { client, enviados } = clientFalso({ Id: '1', Match: true });
    await new MedxCadastroPacienteAdapter(client).vincular({
      ...DADOS,
      email: 'maria@email.com',
      sexo: 'F',
    });

    expect(enviados[0]).toEqual({
      caminho: '/api/integration/contatos/vinculo',
      corpo: {
        Name: 'Maria Silva',
        Phone: '11999998888',
        DateOfBirth: '1990-05-20',
        Email: 'maria@email.com',
        Gender: 'F',
      },
    });
  });

  it('omite email e sexo quando não informados', async () => {
    const { client, enviados } = clientFalso({ Id: '1', Match: true });
    await new MedxCadastroPacienteAdapter(client).vincular(DADOS);
    expect(enviados[0]!.corpo).not.toHaveProperty('Email');
    expect(enviados[0]!.corpo).not.toHaveProperty('Gender');
  });

  it('rejeita Id não numérico em vez de gerar NaN silencioso', async () => {
    const { client } = clientFalso({ Id: 'abc', Match: true });
    await expect(new MedxCadastroPacienteAdapter(client).vincular(DADOS)).rejects.toThrow(/Id/);
  });

  it('rejeita Id zero ou negativo', async () => {
    const { client } = clientFalso({ Id: '0', Match: true });
    await expect(new MedxCadastroPacienteAdapter(client).vincular(DADOS)).rejects.toThrow(/Id/);
  });
});

describe('registrarCpf', () => {
  it('envia PUT com Id_do_Cliente e o CPF só com dígitos', async () => {
    const { client, enviados } = clientFalso({});
    await new MedxCadastroPacienteAdapter(client).registrarCpf(67890, CPF);

    expect(enviados[0]).toEqual({
      caminho: '/api/integration/contatos',
      corpo: { Id_do_Cliente: 67890, CPF_CGC: '52998224725' },
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/infrastructure/medx/medx-cadastro-paciente.adapter.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/infrastructure/medx/medx-cadastro-paciente.adapter.ts`**

```ts
import { Injectable } from '@nestjs/common';
import type { CadastroPacientePort, DadosVinculo } from '../../application/ports/cadastro-paciente.port';
import type { Cpf } from '../../domain/paciente/cpf';
import { MedxHttpClient } from './medx-http.client';
import type { MedxVinculoResposta } from './medx.tipos';

@Injectable()
export class MedxCadastroPacienteAdapter implements CadastroPacientePort {
  constructor(private readonly client: MedxHttpClient) {}

  async vincular(dados: DadosVinculo) {
    const corpo: Record<string, string> = {
      Name: dados.nome,
      Phone: dados.telefone.nacional,
      DateOfBirth: dados.dataNascimento,
    };
    if (dados.email) corpo.Email = dados.email;
    if (dados.sexo) corpo.Gender = dados.sexo;

    const resposta = await this.client.post<MedxVinculoResposta>(
      '/api/integration/contatos/vinculo',
      corpo,
    );

    const idPaciente = Number(resposta?.Id);
    if (!Number.isInteger(idPaciente) || idPaciente <= 0) {
      throw new Error(`Vínculo devolveu Id inesperado do MedX: ${JSON.stringify(resposta?.Id)}`);
    }

    return { idPaciente, matchConfiavel: Boolean(resposta.Match) };
  }

  async registrarCpf(idPaciente: number, cpf: Cpf): Promise<void> {
    await this.client.put('/api/integration/contatos', {
      Id_do_Cliente: idPaciente,
      CPF_CGC: cpf.digitos,
    });
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/infrastructure/medx/medx-cadastro-paciente.adapter.spec.ts`
Expected: PASS — 7 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: MedxCadastroPacienteAdapter como serviço injetável"
```

---

### Task 16: Infraestrutura MedX — `MedxAgendaAdapter`

**Files:**
- Create: `src/agendamento/infrastructure/medx/medx-agenda.adapter.ts`
- Test: `src/agendamento/infrastructure/medx/medx-agenda.adapter.spec.ts`

**Interfaces:**
- Consumes: `MedxHttpClient` (Task 13), `MedxAgendamento` (Task 12), `AgendaMedicaPort`
  (Task 7)
- Produces: `class MedxAgendaAdapter implements AgendaMedicaPort` (`@Injectable()`),
  `CONFIRMACAO_LITERAL = "Mensagem Salva com Sucesso"`

**Duas garantias críticas, herdadas do projeto Fastify já revisado:**
1. A string literal `"Mensagem Salva com Sucesso"` vive **só** neste arquivo.
2. `confirmar()` reconstrói o PUT a partir de `...cru` (spread do payload bruto)
   **primeiro**, com os overrides (`Id_do_Agendamento`, `Status`, `Confirmacao`) **depois**
   — nessa ordem os overrides sempre vencem, preservando campos não modelados. A mensagem
   de erro de `criar()` **não** serializa o corpo da resposta (fix de PII da revisão final).

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/infrastructure/medx/medx-agenda.adapter.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MedxAgendaAdapter, CONFIRMACAO_LITERAL } from './medx-agenda.adapter';
import type { MedxHttpClient } from './medx-http.client';
import type { MedxAgendamento } from './medx.tipos';

const CRU: MedxAgendamento & { CampoQueNaoModelamos: string } = {
  Id_do_Agendamento: 1275002478,
  Id_do_Usuario: 43013640,
  Inicio: '2026-07-10T14:00:00',
  Final: '2026-07-10T14:30:00',
  Descricao: 'Consulta de Rotina — Maria Silva',
  Status: 0,
  Vinculado_a: 30094605,
  Id_do_TipoConsulta: 111,
  Confirmacao: '',
  LastEditDate: '2026-07-09T10:00:00',
  CampoQueNaoModelamos: 'precisa sobreviver ao PUT',
};

function clientFalso(resposta: unknown) {
  const enviados: Array<{ caminho: string; corpo?: unknown }> = [];
  const client = {
    get: async <T>(caminho: string) => {
      enviados.push({ caminho });
      return resposta as T;
    },
    post: async <T>(caminho: string, corpo: unknown) => {
      enviados.push({ caminho, corpo });
      return resposta as T;
    },
    put: async <T>(caminho: string, corpo: unknown) => {
      enviados.push({ caminho, corpo });
      return 'Agendamento atualizado com sucesso.' as T;
    },
  } as unknown as MedxHttpClient;
  return { client, enviados };
}

const CRIACAO = {
  idProfissional: 43013640,
  idPaciente: 30094605,
  inicio: '2026-07-10T14:00:00',
  fim: '2026-07-10T14:30:00',
  descricao: 'Consulta de Rotina — Maria Silva',
  idTipoConsulta: 111,
};

describe('criar', () => {
  it('devolve o inteiro que o MedX retorna', async () => {
    const { client } = clientFalso(1275002478);
    expect(await new MedxAgendaAdapter(client).criar(CRIACAO)).toBe(1275002478);
  });

  it('mapeia para os nomes exatos da API e nasce com Status 0', async () => {
    const { client, enviados } = clientFalso(1);
    await new MedxAgendaAdapter(client).criar(CRIACAO);

    expect(enviados[0]).toEqual({
      caminho: '/api/integration/agenda/agendamentos',
      corpo: {
        Id_do_Usuario: 43013640,
        Inicio: '2026-07-10T14:00:00',
        Final: '2026-07-10T14:30:00',
        Descricao: 'Consulta de Rotina — Maria Silva',
        Status: 0,
        Vinculado_a: 30094605,
        Id_do_TipoConsulta: 111,
      },
    });
  });

  it('rejeita retorno que não é um id válido, sem serializar a resposta na mensagem', async () => {
    const { client } = clientFalso({ Descricao: 'contém nome da paciente' });
    await expect(new MedxAgendaAdapter(client).criar(CRIACAO)).rejects.toThrow(/id/i);
    await expect(new MedxAgendaAdapter(client).criar(CRIACAO)).rejects.not.toThrow(
      /nome da paciente/,
    );
  });
});

describe('obter', () => {
  it('desembrulha o array que a API devolve e traduz para o port', async () => {
    const { client } = clientFalso([CRU]);
    const externo = await new MedxAgendaAdapter(client).obter(1275002478);

    expect(externo.id).toBe(1275002478);
    expect(externo.idProfissional).toBe(43013640);
    expect(externo.idPaciente).toBe(30094605);
    expect(externo.inicio).toBe('2026-07-10T14:00:00');
    expect(externo.ultimaEdicao).toBe('2026-07-09T10:00:00');
  });

  it('guarda o payload cru inteiro em bruto', async () => {
    const { client } = clientFalso([CRU]);
    const externo = await new MedxAgendaAdapter(client).obter(1275002478);
    expect((externo.bruto as any).CampoQueNaoModelamos).toBe('precisa sobreviver ao PUT');
  });

  it('erra quando o agendamento não existe', async () => {
    const { client } = clientFalso([]);
    await expect(new MedxAgendaAdapter(client).obter(999)).rejects.toThrow(/999/);
  });
});

describe('confirmar', () => {
  it('envia a string literal exigida e o índice recebido', async () => {
    const { client, enviados } = clientFalso([CRU]);
    const agenda = new MedxAgendaAdapter(client);
    const externo = await agenda.obter(1275002478);
    enviados.length = 0;

    await agenda.confirmar(externo, 1);

    const corpo = enviados[0]!.corpo as Record<string, unknown>;
    expect(enviados[0]!.caminho).toBe('/api/integration/agenda/agendamentos');
    expect(corpo.Status).toBe(1);
    expect(corpo.Confirmacao).toBe(CONFIRMACAO_LITERAL);
    expect(corpo.Confirmacao).toBe('Mensagem Salva com Sucesso');
  });

  it('preserva os campos que o port não modela', async () => {
    const { client, enviados } = clientFalso([CRU]);
    const agenda = new MedxAgendaAdapter(client);
    const externo = await agenda.obter(1275002478);
    enviados.length = 0;

    await agenda.confirmar(externo, 1);

    expect((enviados[0]!.corpo as any).CampoQueNaoModelamos).toBe('precisa sobreviver ao PUT');
  });

  it('envia o objeto completo que o PUT exige', async () => {
    const { client, enviados } = clientFalso([CRU]);
    const agenda = new MedxAgendaAdapter(client);
    const externo = await agenda.obter(1275002478);
    enviados.length = 0;

    await agenda.confirmar(externo, 1);

    const corpo = enviados[0]!.corpo as Record<string, unknown>;
    for (const campo of [
      'Id_do_Agendamento',
      'Id_do_Usuario',
      'Inicio',
      'Final',
      'Descricao',
      'Status',
      'Vinculado_a',
      'Id_do_TipoConsulta',
    ]) {
      expect(corpo).toHaveProperty(campo);
    }
  });
});

describe('listarPorPaciente', () => {
  it('traduz cada item para o port', async () => {
    const { client } = clientFalso([CRU]);
    const lista = await new MedxAgendaAdapter(client).listarPorPaciente(30094605);
    expect(lista).toHaveLength(1);
    expect(lista[0]!.id).toBe(1275002478);
  });

  it('devolve lista vazia quando a API não retorna array', async () => {
    const { client } = clientFalso(null);
    expect(await new MedxAgendaAdapter(client).listarPorPaciente(1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/infrastructure/medx/medx-agenda.adapter.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/infrastructure/medx/medx-agenda.adapter.ts`**

```ts
import { Injectable } from '@nestjs/common';
import type {
  AgendaMedicaPort,
  AgendamentoExterno,
  DadosCriacaoAgendamento,
} from '../../application/ports/agenda-medica.port';
import { MedxHttpClient } from './medx-http.client';
import type { MedxAgendamento } from './medx.tipos';

const BASE = '/api/integration/agenda/agendamentos';

/** Valor exigido pela API do MedX para marcar um agendamento como confirmado. */
export const CONFIRMACAO_LITERAL = 'Mensagem Salva com Sucesso';

/** Índice do primeiro rótulo: um agendamento nasce como "Agendado". */
const STATUS_AO_CRIAR = 0;

function traduzir(cru: MedxAgendamento): AgendamentoExterno {
  return {
    id: cru.Id_do_Agendamento,
    idProfissional: cru.Id_do_Usuario,
    idPaciente: cru.Vinculado_a,
    inicio: cru.Inicio,
    fim: cru.Final,
    descricao: cru.Descricao,
    status: cru.Status,
    idTipoConsulta: cru.Id_do_TipoConsulta,
    confirmacao: cru.Confirmacao,
    ultimaEdicao: cru.LastEditDate,
    bruto: cru,
  };
}

@Injectable()
export class MedxAgendaAdapter implements AgendaMedicaPort {
  constructor(private readonly client: MedxHttpClient) {}

  async criar(dados: DadosCriacaoAgendamento): Promise<number> {
    const resposta = await this.client.post<unknown>(BASE, {
      Id_do_Usuario: dados.idProfissional,
      Inicio: dados.inicio,
      Final: dados.fim,
      Descricao: dados.descricao,
      Status: STATUS_AO_CRIAR,
      Vinculado_a: dados.idPaciente,
      Id_do_TipoConsulta: dados.idTipoConsulta,
    });

    const id = Number(resposta);
    if (!Number.isInteger(id) || id <= 0) {
      // Não serializar o corpo da resposta aqui: se o MedX ecoar a Descricao
      // enviada (que contém o nome da paciente), o conteúdo vaza em log/e-mail
      // de alerta sem passar pela redação de PII do pino.
      throw new Error(
        `MedX não devolveu um id de agendamento válido (tipo recebido: ${typeof resposta})`,
      );
    }
    return id;
  }

  async obter(id: number): Promise<AgendamentoExterno> {
    const resposta = await this.client.get<MedxAgendamento[] | MedxAgendamento>(`${BASE}/${id}`);
    const cru = Array.isArray(resposta) ? resposta[0] : resposta;

    if (!cru) {
      throw new Error(`Agendamento ${id} não encontrado no MedX`);
    }
    return traduzir(cru);
  }

  async listarPorPaciente(idPaciente: number): Promise<AgendamentoExterno[]> {
    const resposta = await this.client.get<MedxAgendamento[]>(`${BASE}/paciente/${idPaciente}`);
    return Array.isArray(resposta) ? resposta.map(traduzir) : [];
  }

  async confirmar(agendamento: AgendamentoExterno, indiceStatusConfirmado: number): Promise<void> {
    // O PUT não é um PATCH: partimos do payload original para não apagar
    // campos que este port não modela. Spread do bruto PRIMEIRO, overrides
    // DEPOIS — a ordem inversa sobrescreveria Status/Confirmacao com o valor
    // antigo, deixando a consulta silenciosamente não confirmada.
    const cru = agendamento.bruto as MedxAgendamento;

    await this.client.put(BASE, {
      ...cru,
      Id_do_Agendamento: agendamento.id,
      Status: indiceStatusConfirmado,
      Confirmacao: CONFIRMACAO_LITERAL,
    });
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/infrastructure/medx/medx-agenda.adapter.spec.ts`
Expected: PASS — 12 testes.

- [ ] **Step 5: Confirmar que a string literal vive só neste arquivo**

Run: `grep -rn "Mensagem Salva com Sucesso" src/ | grep -v medx-agenda.adapter`
Expected: sem resultado (fora dos testes deste próprio arquivo, se o grep incluir `.spec.ts`
disso é esperado — confirme que nenhum arquivo de produção FORA de
`medx-agenda.adapter.ts` contém a string).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: MedxAgendaAdapter com reconstrução completa no PUT"
```

---

### Task 17: Infraestrutura Clint — `ClintWebhookAdapter`

**Files:**
- Create: `src/agendamento/infrastructure/clint/clint-webhook.adapter.ts`
- Test: `src/agendamento/infrastructure/clint/clint-webhook.adapter.spec.ts`

**Interfaces:**
- Consumes: `CrmPort` (Task 7), `ConfigService`
- Produces: `class ClintWebhookAdapter implements CrmPort` (`@Injectable()`, lê
  `CLINT_WEBHOOK_AGENDAMENTO_URL`/`CLINT_WEBHOOK_NOTIFICACAO_URL` via `ConfigService`)

Este é o último adapter da camada `infrastructure`. Toda falha HTTP ou de rede deve
propagar (lançar), para o job da fila tentar de novo — engolir um erro aqui é Critical
(o Clint nunca saberia que a notificação falhou).

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/infrastructure/clint/clint-webhook.adapter.spec.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ClintWebhookAdapter } from './clint-webhook.adapter';

afterEach(() => vi.restoreAllMocks());

const URLS: Record<string, string> = {
  CLINT_WEBHOOK_AGENDAMENTO_URL: 'https://clint.test/in/agendamento',
  CLINT_WEBHOOK_NOTIFICACAO_URL: 'https://clint.test/in/notificacao',
};

function configFalso(): ConfigService {
  return { get: (chave: string) => URLS[chave] } as ConfigService;
}

function corpoDe(chamada: [any, any]): Record<string, unknown> {
  return JSON.parse(String(chamada[1].body));
}

function espiar() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
}

describe('gravarIdAgendamento', () => {
  it('posta o id na url de agendamento', async () => {
    const spy = espiar();
    await new ClintWebhookAdapter(configFalso()).gravarIdAgendamento('deal-1', 1275002478);

    expect(String(spy.mock.calls[0]![0])).toBe(URLS.CLINT_WEBHOOK_AGENDAMENTO_URL);
    expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({
      deal_id: 'deal-1',
      id_agendamento_medx: 1275002478,
    });
  });

  it('envia content-type json', async () => {
    const spy = espiar();
    await new ClintWebhookAdapter(configFalso()).gravarIdAgendamento('deal-1', 1);
    const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });
});

describe('notificações', () => {
  it.each([
    ['notificarConfirmacao', 'confirmado'],
    ['notificarReagendamento', 'reagendamento_solicitado'],
    ['notificarCancelamento', 'cancelamento_solicitado'],
  ])('%s posta o evento %s na url de notificação', async (metodo, evento) => {
    const spy = espiar();
    await (new ClintWebhookAdapter(configFalso()) as any)[metodo]('deal-1');

    expect(String(spy.mock.calls[0]![0])).toBe(URLS.CLINT_WEBHOOK_NOTIFICACAO_URL);
    expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({ deal_id: 'deal-1', evento });
  });

  it('inclui o motivo ao notificar conflito', async () => {
    const spy = espiar();
    await new ClintWebhookAdapter(configFalso()).notificarConflito('deal-1', 'horário alterado');

    expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({
      deal_id: 'deal-1',
      evento: 'conflito',
      motivo: 'horário alterado',
    });
  });
});

describe('falhas', () => {
  it('lança quando o Clint responde erro, para o job tentar de novo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    await expect(
      new ClintWebhookAdapter(configFalso()).gravarIdAgendamento('deal-1', 1),
    ).rejects.toThrow(/500/);
  });

  it('propaga falha de rede', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new ClintWebhookAdapter(configFalso()).notificarConfirmacao('deal-1'),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/infrastructure/clint/clint-webhook.adapter.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/infrastructure/clint/clint-webhook.adapter.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CrmPort } from '../../application/ports/crm.port';

async function postar(url: string, corpo: Record<string, unknown>): Promise<void> {
  const resposta = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });

  if (!resposta.ok) {
    throw new Error(`Webhook de entrada do Clint respondeu HTTP ${resposta.status}`);
  }
}

@Injectable()
export class ClintWebhookAdapter implements CrmPort {
  constructor(private readonly config: ConfigService) {}

  private notificar(dealId: string, evento: string, extra?: Record<string, unknown>): Promise<void> {
    const url = this.config.get<string>('CLINT_WEBHOOK_NOTIFICACAO_URL');
    return postar(url!, { deal_id: dealId, evento, ...extra });
  }

  gravarIdAgendamento(dealId: string, idAgendamento: number): Promise<void> {
    const url = this.config.get<string>('CLINT_WEBHOOK_AGENDAMENTO_URL');
    return postar(url!, { deal_id: dealId, id_agendamento_medx: idAgendamento });
  }

  notificarConfirmacao(dealId: string): Promise<void> {
    return this.notificar(dealId, 'confirmado');
  }

  notificarReagendamento(dealId: string): Promise<void> {
    return this.notificar(dealId, 'reagendamento_solicitado');
  }

  notificarCancelamento(dealId: string): Promise<void> {
    return this.notificar(dealId, 'cancelamento_solicitado');
  }

  notificarConflito(dealId: string, motivo: string): Promise<void> {
    return this.notificar(dealId, 'conflito', { motivo });
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/infrastructure/clint/clint-webhook.adapter.spec.ts`
Expected: PASS — 8 testes.

- [ ] **Step 5: Rodar toda a suíte de infraestrutura MedX/Clint**

Run: `npx vitest run src/agendamento/infrastructure/medx src/agendamento/infrastructure/clint`
Expected: PASS em todos os arquivos.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: ClintWebhookAdapter como serviço injetável"
```

---

### Task 18: Application — `AgendarConsultaUseCase`

**Files:**
- Create: `src/agendamento/application/agendar-consulta/agendar-consulta.usecase.ts`
- Test: `src/agendamento/application/agendar-consulta/agendar-consulta.usecase.spec.ts`

**Interfaces:**
- Consumes: todos os ports (Task 7), `Agendamento` (Task 5), `CorrelacaoPaciente` (Task 6),
  `Telefone`/`Cpf` (Task 3), `PeriodoConsulta` (Task 4), `LoggerMinimo` (Task 7)
- Produces: `class AgendarConsultaUseCase` (`@Injectable()`, `executar(comando):
  Promise<void>`)

**Mudança de forma em relação ao projeto Fastify:** a fábrica `criarAgendarConsulta(deps)`
vira uma classe com os ports injetados via `@Inject(TOKEN)` no construtor, e o método
`agendarConsulta(comando)` retornado pela fábrica vira `executar(comando)`. **A lógica de
negócio é idêntica**, incluindo o fix crítico da revisão final: `agendamentos.salvar()` e
`agendamentos.buscarPorDeal()` agora são `await`ados (a interface é assíncrona desde a Task
5), mas a ordem das operações — gravar intenção antes de chamar o MedX, relançar erro em
vez de engolir — não muda.

Para o teste, como o repositório agora é Prisma (exige Postgres real), os testes deste
usecase usam **dublês em memória reais** (um `Map` por trás de cada método, não apenas
`vi.fn()` retornando valores fixos) para `agendamentos`/`correlacoes` — preserva o
comportamento de estado real (idempotência, adoção de órfão) sem depender de um banco
de teste para uma suíte de application.

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/application/agendar-consulta/agendar-consulta.usecase.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { AgendarConsultaUseCase } from './agendar-consulta.usecase';
import { Agendamento } from '../../domain/agendamento/agendamento';
import { PeriodoConsulta } from '../../domain/agendamento/periodo-consulta';
import { Telefone } from '../../domain/paciente/telefone';
import type { CorrelacaoPaciente } from '../../domain/paciente/correlacao-paciente';
import type { AgendamentoExterno } from '../ports/agenda-medica.port';

const COMANDO = {
  dealId: 'deal-1',
  nome: 'Maria Silva',
  telefone: '+55 11 99999-8888',
  dataNascimento: '1990-05-20',
  dataHora: '2026-07-10T14:00:00',
  profissional: 'Leize Ferreira',
  tipoConsulta: 'Consulta de Rotina',
  cpf: '529.982.247-25',
};

function externo(parcial: Partial<AgendamentoExterno> = {}): AgendamentoExterno {
  return {
    id: 999,
    idProfissional: 43013640,
    idPaciente: 67890,
    inicio: '2026-07-10T14:00:00',
    fim: '2026-07-10T14:30:00',
    descricao: '',
    status: 0,
    idTipoConsulta: 111,
    confirmacao: '',
    ultimaEdicao: '2026-07-09T10:00:00',
    bruto: {},
    ...parcial,
  };
}

function agendamentosFalso() {
  const registros = new Map<string, Agendamento>();
  return {
    async buscarPorDeal(dealId: string) {
      return registros.get(dealId) ?? null;
    },
    async salvar(a: Agendamento) {
      registros.set(a.dealId, a);
    },
  };
}

function correlacoesFalso() {
  const registros = new Map<string, CorrelacaoPaciente>();
  return {
    async buscarPorTelefone(t: Telefone) {
      return registros.get(t.e164) ?? null;
    },
    async salvar(c: CorrelacaoPaciente) {
      registros.set(c.telefone.e164, c);
    },
  };
}

function montar() {
  const agendamentos = agendamentosFalso();
  const correlacoes = correlacoesFalso();
  const cadastro = {
    vincular: vi.fn(async () => ({ idPaciente: 67890, matchConfiavel: true })),
    registrarCpf: vi.fn(async () => {}),
  };
  const agenda = {
    criar: vi.fn(async () => 1275002478),
    obter: vi.fn(async () => externo()),
    listarPorPaciente: vi.fn(async () => [] as AgendamentoExterno[]),
    confirmar: vi.fn(async () => {}),
  };
  const catalogo = {
    carregar: vi.fn(async () => {}),
    resolverProfissional: vi.fn(async () => 43013640),
    resolverTipoConsulta: vi.fn(async () => ({ id: 111, nome: 'Consulta de Rotina', duracaoMinutos: 30 })),
    indiceStatusConfirmado: () => 1,
  };
  const crm = {
    gravarIdAgendamento: vi.fn(async () => {}),
    notificarConfirmacao: vi.fn(async () => {}),
    notificarReagendamento: vi.fn(async () => {}),
    notificarCancelamento: vi.fn(async () => {}),
    notificarConflito: vi.fn(async () => {}),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const usecase = new AgendarConsultaUseCase(
    agendamentos as any,
    correlacoes as any,
    cadastro as any,
    agenda as any,
    catalogo as any,
    crm as any,
    logger as any,
  );

  return { agendamentos, correlacoes, cadastro, agenda, catalogo, crm, logger, usecase };
}

describe('caminho feliz', () => {
  it('cria o agendamento com início, fim e descrição corretos', async () => {
    const { agenda, usecase } = montar();
    await usecase.executar(COMANDO);

    expect(agenda.criar).toHaveBeenCalledWith({
      idProfissional: 43013640,
      idPaciente: 67890,
      inicio: '2026-07-10T14:00:00',
      fim: '2026-07-10T14:30:00',
      descricao: 'Consulta de Rotina — Maria Silva',
      idTipoConsulta: 111,
    });
  });

  it('devolve o id ao CRM', async () => {
    const { crm, usecase } = montar();
    await usecase.executar(COMANDO);
    expect(crm.gravarIdAgendamento).toHaveBeenCalledWith('deal-1', 1275002478);
  });

  it('persiste o agendamento como criado', async () => {
    const { usecase, agendamentos } = montar();
    await usecase.executar(COMANDO);
    const salvo = (await agendamentos.buscarPorDeal('deal-1'))!;
    expect(salvo.status).toBe('criado');
    expect(salvo.idMedx).toBe(1275002478);
  });

  it('converte o horário para o fuso da clínica', async () => {
    const { agenda, usecase } = montar();
    await usecase.executar({ ...COMANDO, dataHora: '2026-07-10T17:00:00Z' });
    expect(agenda.criar).toHaveBeenCalledWith(expect.objectContaining({ inicio: '2026-07-10T14:00:00' }));
  });
});

describe('idempotência', () => {
  it('não chama o MedX duas vezes para o mesmo deal_id', async () => {
    const { agenda, usecase } = montar();
    await usecase.executar(COMANDO);
    await usecase.executar(COMANDO);
    expect(agenda.criar).toHaveBeenCalledTimes(1);
  });

  it('grava a intenção antes de chamar o MedX', async () => {
    const { agenda, agendamentos, usecase } = montar();
    const observado: string[] = [];
    agenda.criar = vi.fn(async () => {
      observado.push((await agendamentos.buscarPorDeal('deal-1'))!.status);
      return 1275002478;
    });

    await usecase.executar(COMANDO);
    expect(observado).toEqual(['enviando']);
  });

  it('adota o agendamento órfão de uma tentativa interrompida', async () => {
    const { agenda, agendamentos, crm, usecase } = montar();
    await agendamentos.salvar(
      Agendamento.iniciar({
        dealId: 'deal-1',
        idPacienteMedx: 67890,
        idProfissionalMedx: 43013640,
        periodo: PeriodoConsulta.criar('2026-07-10T14:00:00', 30),
      }),
    );
    agenda.listarPorPaciente = vi.fn(async () => [externo({ id: 555 })]);

    await usecase.executar(COMANDO);

    expect(agenda.criar).not.toHaveBeenCalled();
    expect(crm.gravarIdAgendamento).toHaveBeenCalledWith('deal-1', 555);
  });

  it('após falha em agenda.criar, retry adota órfão gêmeo em vez de criar de novo', async () => {
    const { agenda, crm, usecase } = montar();
    agenda.criar = vi.fn(async () => {
      throw new Error('timeout na chamada ao MedX');
    });

    await expect(usecase.executar(COMANDO)).rejects.toThrow(/timeout/);

    agenda.listarPorPaciente = vi.fn(async () => [externo({ id: 777 })]);

    await usecase.executar(COMANDO);

    expect(agenda.criar).toHaveBeenCalledTimes(1);
    expect(crm.gravarIdAgendamento).toHaveBeenCalledWith('deal-1', 777);
  });

  it('cria normalmente quando não há órfão correspondente', async () => {
    const { agenda, agendamentos, usecase } = montar();
    await agendamentos.salvar(
      Agendamento.iniciar({
        dealId: 'deal-1',
        idPacienteMedx: 67890,
        idProfissionalMedx: 43013640,
        periodo: PeriodoConsulta.criar('2026-07-10T14:00:00', 30),
      }),
    );
    agenda.listarPorPaciente = vi.fn(async () => [externo({ inicio: '2026-07-11T09:00:00' })]);

    await usecase.executar(COMANDO);
    expect(agenda.criar).toHaveBeenCalled();
  });
});

describe('identidade do paciente', () => {
  it('reaproveita a correlação em cache sem chamar o vínculo de novo', async () => {
    const { cadastro, usecase } = montar();
    await usecase.executar(COMANDO);
    await usecase.executar({ ...COMANDO, dealId: 'deal-2' });
    expect(cadastro.vincular).toHaveBeenCalledTimes(1);
  });

  it('envia o telefone como value object para o port', async () => {
    const { cadastro, usecase } = montar();
    await usecase.executar(COMANDO);
    const enviado = (cadastro.vincular as any).mock.calls[0][0];
    expect(enviado.telefone).toBeInstanceOf(Telefone);
    expect(enviado.telefone.nacional).toBe('11999998888');
  });

  it('registra match duvidoso com alerta, sem interromper o agendamento', async () => {
    const { cadastro, correlacoes, crm, logger, usecase } = montar();
    cadastro.vincular = vi.fn(async () => ({ idPaciente: 67890, matchConfiavel: false }));

    await usecase.executar(COMANDO);

    expect((await correlacoes.buscarPorTelefone(Telefone.criar('11999998888')))!.exigeRevisao).toBe(true);
    expect(crm.gravarIdAgendamento).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ alerta: true }), expect.any(String));
  });
});

describe('CPF', () => {
  it('enriquece a ficha quando o CPF é válido', async () => {
    const { cadastro, usecase } = montar();
    await usecase.executar(COMANDO);
    expect(cadastro.registrarCpf).toHaveBeenCalledWith(67890, expect.anything());
  });

  it('ignora CPF inválido sem quebrar o agendamento', async () => {
    const { cadastro, crm, usecase } = montar();
    await usecase.executar({ ...COMANDO, cpf: '11111111111' });
    expect(cadastro.registrarCpf).not.toHaveBeenCalled();
    expect(crm.gravarIdAgendamento).toHaveBeenCalled();
  });

  it('não chama registrarCpf quando o CPF não veio', async () => {
    const { cadastro, usecase } = montar();
    const { cpf, ...semCpf } = COMANDO;
    await usecase.executar(semCpf);
    expect(cadastro.registrarCpf).not.toHaveBeenCalled();
  });

  it('falha ao gravar o CPF não derruba o agendamento', async () => {
    const { cadastro, crm, usecase } = montar();
    cadastro.registrarCpf = vi.fn(async () => {
      throw new Error('MedX recusou o CPF');
    });
    await expect(usecase.executar(COMANDO)).resolves.toBeUndefined();
    expect(crm.gravarIdAgendamento).toHaveBeenCalled();
  });
});

describe('falhas', () => {
  it('marca falhou e propaga quando o MedX recusa a criação', async () => {
    const { agenda, agendamentos, usecase } = montar();
    agenda.criar = vi.fn(async () => {
      throw new Error('MedX fora do ar');
    });

    await expect(usecase.executar(COMANDO)).rejects.toThrow(/fora do ar/);
    expect((await agendamentos.buscarPorDeal('deal-1'))!.status).toBe('falhou');
  });

  it('propaga telefone inválido como erro de domínio', async () => {
    const { usecase } = montar();
    await expect(usecase.executar({ ...COMANDO, telefone: '123' })).rejects.toThrow(/DDD/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/application/agendar-consulta/agendar-consulta.usecase.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/application/agendar-consulta/agendar-consulta.usecase.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Agendamento } from '../../domain/agendamento/agendamento';
import { PeriodoConsulta } from '../../domain/agendamento/periodo-consulta';
import type { AgendamentoRepositorio } from '../../domain/agendamento/agendamento.repositorio';
import { CorrelacaoPaciente } from '../../domain/paciente/correlacao-paciente';
import type { CorrelacaoPacienteRepositorio } from '../../domain/paciente/correlacao-paciente.repositorio';
import { Cpf } from '../../domain/paciente/cpf';
import { Telefone } from '../../domain/paciente/telefone';
import { AGENDA_MEDICA_PORT, type AgendaMedicaPort } from '../ports/agenda-medica.port';
import { CADASTRO_PACIENTE_PORT, type CadastroPacientePort } from '../ports/cadastro-paciente.port';
import { CATALOGO_CLINICO_PORT, type CatalogoClinicoPort } from '../ports/catalogo-clinico.port';
import { CRM_PORT, type CrmPort } from '../ports/crm.port';
import { LOGGER_PORT, type LoggerMinimo } from '../ports/logger.port';
import { AGENDAMENTO_REPOSITORIO, CORRELACAO_PACIENTE_REPOSITORIO } from '../../../shared/persistence/persistence.module';
import type { ComandoAgendamento } from './agendar-consulta.comando';

@Injectable()
export class AgendarConsultaUseCase {
  constructor(
    @Inject(AGENDAMENTO_REPOSITORIO) private readonly agendamentos: AgendamentoRepositorio,
    @Inject(CORRELACAO_PACIENTE_REPOSITORIO) private readonly correlacoes: CorrelacaoPacienteRepositorio,
    @Inject(CADASTRO_PACIENTE_PORT) private readonly cadastro: CadastroPacientePort,
    @Inject(AGENDA_MEDICA_PORT) private readonly agenda: AgendaMedicaPort,
    @Inject(CATALOGO_CLINICO_PORT) private readonly catalogo: CatalogoClinicoPort,
    @Inject(CRM_PORT) private readonly crm: CrmPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
  ) {}

  private async resolverPaciente(comando: ComandoAgendamento, telefone: Telefone): Promise<number> {
    const emCache = await this.correlacoes.buscarPorTelefone(telefone);
    if (emCache) return emCache.idPacienteMedx;

    const vinculo = await this.cadastro.vincular({
      nome: comando.nome,
      telefone,
      dataNascimento: comando.dataNascimento,
      email: comando.email,
      sexo: comando.sexo,
    });

    const correlacao = CorrelacaoPaciente.criar({
      telefone,
      idPacienteMedx: vinculo.idPaciente,
      matchConfiavel: vinculo.matchConfiavel,
      idContatoClint: null,
    });
    await this.correlacoes.salvar(correlacao);

    if (correlacao.exigeRevisao) {
      this.logger.warn(
        { alerta: true, deal_id: comando.dealId, id_paciente: correlacao.idPacienteMedx },
        'vínculo de paciente com match não confiável — revisar manualmente',
      );
    }

    return correlacao.idPacienteMedx;
  }

  async executar(comando: ComandoAgendamento): Promise<void> {
    const registrado = await this.agendamentos.buscarPorDeal(comando.dealId);

    if (registrado?.jaFoiCriado) {
      this.logger.info(
        { deal_id: comando.dealId, id_agendamento: registrado.idMedx },
        'agendamento já existia, nada a fazer',
      );
      return;
    }

    const houveTentativaAnterior = registrado?.tentativaInterrompida ?? false;

    const telefone = Telefone.criar(comando.telefone);
    const idPaciente = await this.resolverPaciente(comando, telefone);

    const idProfissional = await this.catalogo.resolverProfissional(comando.profissional);
    const tipo = await this.catalogo.resolverTipoConsulta(comando.tipoConsulta);
    const periodo = PeriodoConsulta.criar(comando.dataHora, tipo.duracaoMinutos);

    const agendamento = Agendamento.iniciar({
      dealId: comando.dealId,
      idPacienteMedx: idPaciente,
      idProfissionalMedx: idProfissional,
      periodo,
    });

    // Grava a intenção antes de chamar o MedX: um retry interrompido precisa
    // encontrar rastro para não criar consulta duplicada.
    await this.agendamentos.salvar(agendamento);

    let orfao: number | undefined;

    if (houveTentativaAnterior) {
      const daAgenda = await this.agenda.listarPorPaciente(idPaciente);
      const gemeo = daAgenda.find(
        (a) => a.idProfissional === idProfissional && periodo.comecaEm(a.inicio),
      );
      if (gemeo) {
        orfao = gemeo.id;
        this.logger.warn(
          { deal_id: comando.dealId, id_agendamento: orfao },
          'agendamento já existia no MedX de uma tentativa anterior — adotado',
        );
      }
    }

    if (orfao !== undefined) {
      agendamento.adotarExistente(orfao);
    } else {
      try {
        const idCriado = await this.agenda.criar({
          idProfissional,
          idPaciente,
          inicio: periodo.inicio,
          fim: periodo.fim,
          descricao: `${tipo.nome} — ${comando.nome}`,
          idTipoConsulta: tipo.id,
        });
        agendamento.registrarCriacao(idCriado);
      } catch (erro) {
        agendamento.marcarFalha();
        await this.agendamentos.salvar(agendamento);
        throw erro;
      }
    }

    await this.agendamentos.salvar(agendamento);

    const cpf = Cpf.tentarCriar(comando.cpf);
    if (cpf) {
      try {
        await this.cadastro.registrarCpf(idPaciente, cpf);
      } catch (erro) {
        this.logger.warn(
          { deal_id: comando.dealId, erro: (erro as Error).message },
          'não foi possível gravar o CPF na ficha do MedX',
        );
      }
    } else if (comando.cpf) {
      this.logger.warn({ deal_id: comando.dealId }, 'CPF recebido do CRM é inválido — ignorado');
    }

    await this.crm.gravarIdAgendamento(comando.dealId, agendamento.idMedx!);

    this.logger.info(
      { deal_id: comando.dealId, id_agendamento: agendamento.idMedx },
      'agendamento criado no MedX',
    );
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/application/agendar-consulta/agendar-consulta.usecase.spec.ts`
Expected: PASS — 17 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: AgendarConsultaUseCase como serviço injetável"
```

---

### Task 19: Application — `ProcessarRespostaUseCase`

**Files:**
- Create: `src/agendamento/application/processar-resposta-lembrete/processar-resposta.usecase.ts`
- Test: `src/agendamento/application/processar-resposta-lembrete/processar-resposta.usecase.spec.ts`

**Interfaces:**
- Consumes: `RespostaLembrete` (Task 4), `Agendamento` (Task 5), ports
  `AgendaMedicaPort`/`CatalogoClinicoPort`/`CrmPort` (Task 7), `AgendamentoRepositorio`
  (Task 5), `LoggerMinimo` (Task 7)
- Produces: `class ProcessarRespostaUseCase` (`@Injectable()`, `executar(comando):
  Promise<void>`)

Inclui o fix crítico da revisão final: **checa `agendamento.idMedx !== comando.
idAgendamentoMedx` antes de chamar `agenda.obter`** — sem essa checagem, um campo
customizado desatualizado no Clint confirmaria o agendamento errado no MedX.

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/application/processar-resposta-lembrete/processar-resposta.usecase.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { ProcessarRespostaUseCase } from './processar-resposta.usecase';
import { Agendamento } from '../../domain/agendamento/agendamento';
import { PeriodoConsulta } from '../../domain/agendamento/periodo-consulta';
import type { AgendamentoExterno } from '../ports/agenda-medica.port';

function externo(parcial: Partial<AgendamentoExterno> = {}): AgendamentoExterno {
  return {
    id: 1275002478,
    idProfissional: 43013640,
    idPaciente: 67890,
    inicio: '2026-07-10T14:00:00',
    fim: '2026-07-10T14:30:00',
    descricao: 'Consulta',
    status: 0,
    idTipoConsulta: 111,
    confirmacao: '',
    ultimaEdicao: '2026-07-09T10:00:00',
    bruto: {},
    ...parcial,
  };
}

function agendamentosFalso() {
  const registros = new Map<string, Agendamento>();
  return {
    async buscarPorDeal(dealId: string) {
      return registros.get(dealId) ?? null;
    },
    async salvar(a: Agendamento) {
      registros.set(a.dealId, a);
    },
  };
}

async function montar(noMedx: AgendamentoExterno = externo(), comRegistro = true) {
  const agendamentos = agendamentosFalso();

  if (comRegistro) {
    const a = Agendamento.iniciar({
      dealId: 'deal-1',
      idPacienteMedx: 67890,
      idProfissionalMedx: 43013640,
      periodo: PeriodoConsulta.criar('2026-07-10T14:00:00', 30),
    });
    a.registrarCriacao(1275002478);
    await agendamentos.salvar(a);
  }

  const agenda = {
    criar: vi.fn(async () => 0),
    obter: vi.fn(async () => noMedx),
    listarPorPaciente: vi.fn(async () => [] as AgendamentoExterno[]),
    confirmar: vi.fn(async () => {}),
  };
  const catalogo = {
    carregar: vi.fn(async () => {}),
    resolverProfissional: vi.fn(async () => 0),
    resolverTipoConsulta: vi.fn(async () => ({ id: 0, nome: '', duracaoMinutos: 30 })),
    indiceStatusConfirmado: () => 1,
  };
  const crm = {
    gravarIdAgendamento: vi.fn(async () => {}),
    notificarConfirmacao: vi.fn(async () => {}),
    notificarReagendamento: vi.fn(async () => {}),
    notificarCancelamento: vi.fn(async () => {}),
    notificarConflito: vi.fn(async () => {}),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const usecase = new ProcessarRespostaUseCase(
    agendamentos as any,
    agenda as any,
    catalogo as any,
    crm as any,
    logger as any,
  );

  return { agendamentos, agenda, catalogo, crm, logger, usecase };
}

const CONFIRMAR = { dealId: 'deal-1', idAgendamentoMedx: 1275002478, resposta: 'confirmar' };

describe('confirmar', () => {
  it('chama o port com o índice descoberto', async () => {
    const { agenda, usecase } = await montar();
    await usecase.executar(CONFIRMAR);
    expect(agenda.confirmar).toHaveBeenCalledWith(expect.objectContaining({ id: 1275002478 }), 1);
  });

  it('avisa o CRM da confirmação', async () => {
    const { crm, usecase } = await montar();
    await usecase.executar(CONFIRMAR);
    expect(crm.notificarConfirmacao).toHaveBeenCalledWith('deal-1');
  });

  it('persiste como confirmado com a última edição', async () => {
    const { usecase, agendamentos } = await montar();
    await usecase.executar(CONFIRMAR);
    const salvo = (await agendamentos.buscarPorDeal('deal-1'))!;
    expect(salvo.status).toBe('confirmado');
    expect(salvo.ultimaEdicaoConhecida).toBe('2026-07-09T10:00:00');
  });

  it('aceita reenvio quando o MedX já está confirmado', async () => {
    const { agenda, usecase } = await montar(externo({ status: 1 }));
    await usecase.executar(CONFIRMAR);
    expect(agenda.confirmar).toHaveBeenCalled();
  });

  it('é idempotente: não reescreve o que já confirmamos', async () => {
    const { agenda, usecase, agendamentos } = await montar();
    await usecase.executar(CONFIRMAR);
    agenda.confirmar.mockClear();
    await usecase.executar(CONFIRMAR);
    expect(agenda.confirmar).not.toHaveBeenCalled();
    expect((await agendamentos.buscarPorDeal('deal-1'))!.status).toBe('confirmado');
  });

  it('normaliza a resposta com caixa diferente', async () => {
    const { agenda, usecase } = await montar();
    await usecase.executar({ ...CONFIRMAR, resposta: 'CONFIRMAR' });
    expect(agenda.confirmar).toHaveBeenCalled();
  });
});

describe('recusas', () => {
  it('recusa quando o horário mudou desde o lembrete', async () => {
    const { agenda, crm, usecase, agendamentos } = await montar(externo({ inicio: '2026-07-11T09:00:00' }));
    await usecase.executar(CONFIRMAR);

    expect(agenda.confirmar).not.toHaveBeenCalled();
    expect(crm.notificarConflito).toHaveBeenCalledWith('deal-1', expect.stringMatching(/horário/i));
    expect((await agendamentos.buscarPorDeal('deal-1'))!.status).toBe('conflito');
  });

  it('recusa quando a consulta não está mais agendada', async () => {
    const { agenda, crm, usecase } = await montar(externo({ status: 3 }));
    await usecase.executar(CONFIRMAR);
    expect(agenda.confirmar).not.toHaveBeenCalled();
    expect(crm.notificarConflito).toHaveBeenCalled();
  });

  it('alerta ao recusar', async () => {
    const { logger, usecase } = await montar(externo({ status: 3 }));
    await usecase.executar(CONFIRMAR);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ alerta: true }), expect.any(String));
  });

  it('recusa quando o adapter não conhece o agendamento', async () => {
    const { agenda, crm, usecase } = await montar(externo(), false);
    await usecase.executar(CONFIRMAR);
    expect(agenda.confirmar).not.toHaveBeenCalled();
    expect(crm.notificarConflito).toHaveBeenCalled();
  });

  it('recusa quando o id do agendamento do CRM não bate com o registro local', async () => {
    const { agenda, crm, usecase, agendamentos } = await montar();
    // O registro local foi criado com idMedx 1275002478 (ver `montar`), mas o
    // payload do Clint chega com um id diferente (campo customizado desatualizado).
    await usecase.executar({ ...CONFIRMAR, idAgendamentoMedx: 999999999 });

    expect(agenda.obter).not.toHaveBeenCalled();
    expect(crm.notificarConflito).toHaveBeenCalledWith('deal-1', expect.stringMatching(/não confere|diverg/i));
    expect((await agendamentos.buscarPorDeal('deal-1'))!.status).toBe('conflito');
  });

  it('rejeita resposta fora das três opções', async () => {
    const { usecase } = await montar();
    await expect(usecase.executar({ ...CONFIRMAR, resposta: 'talvez' })).rejects.toThrow(/talvez/);
  });
});

describe('reagendar e cancelar', () => {
  it.each([
    ['reagendar', 'notificarReagendamento'],
    ['cancelar', 'notificarCancelamento'],
  ])('%s só avisa o CRM, sem tocar no MedX', async (resposta, metodo) => {
    const { agenda, crm, usecase } = await montar();
    await usecase.executar({ ...CONFIRMAR, resposta });

    expect(agenda.obter).not.toHaveBeenCalled();
    expect(agenda.confirmar).not.toHaveBeenCalled();
    expect((crm as any)[metodo]).toHaveBeenCalledWith('deal-1');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/application/processar-resposta-lembrete/processar-resposta.usecase.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/application/processar-resposta-lembrete/processar-resposta.usecase.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { AgendamentoRepositorio } from '../../domain/agendamento/agendamento.repositorio';
import { RespostaLembrete } from '../../domain/agendamento/resposta-lembrete';
import { AGENDA_MEDICA_PORT, type AgendaMedicaPort } from '../ports/agenda-medica.port';
import { CATALOGO_CLINICO_PORT, type CatalogoClinicoPort } from '../ports/catalogo-clinico.port';
import { CRM_PORT, type CrmPort } from '../ports/crm.port';
import { LOGGER_PORT, type LoggerMinimo } from '../ports/logger.port';
import { AGENDAMENTO_REPOSITORIO } from '../../../shared/persistence/persistence.module';
import type { ComandoResposta } from './processar-resposta.comando';

@Injectable()
export class ProcessarRespostaUseCase {
  constructor(
    @Inject(AGENDAMENTO_REPOSITORIO) private readonly agendamentos: AgendamentoRepositorio,
    @Inject(AGENDA_MEDICA_PORT) private readonly agenda: AgendaMedicaPort,
    @Inject(CATALOGO_CLINICO_PORT) private readonly catalogo: CatalogoClinicoPort,
    @Inject(CRM_PORT) private readonly crm: CrmPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
  ) {}

  async executar(comando: ComandoResposta): Promise<void> {
    const resposta = RespostaLembrete.criar(comando.resposta);

    if (resposta.exigeAtendimentoHumano) {
      if (resposta.valor === 'reagendar') {
        await this.crm.notificarReagendamento(comando.dealId);
      } else {
        await this.crm.notificarCancelamento(comando.dealId);
      }
      this.logger.info(
        { deal_id: comando.dealId, resposta: resposta.valor },
        'resposta do paciente encaminhada para atendimento humano',
      );
      return;
    }

    const agendamento = await this.agendamentos.buscarPorDeal(comando.dealId);

    const recusar = async (motivo: string): Promise<void> => {
      agendamento?.marcarConflito();
      if (agendamento) await this.agendamentos.salvar(agendamento);

      this.logger.warn(
        { alerta: true, deal_id: comando.dealId, id_agendamento: comando.idAgendamentoMedx, motivo },
        'confirmação recusada',
      );
      await this.crm.notificarConflito(comando.dealId, motivo);
    };

    if (!agendamento) {
      return recusar('adapter não tem registro deste agendamento');
    }

    if (agendamento.jaFoiConfirmado) {
      this.logger.info({ deal_id: comando.dealId }, 'agendamento já estava confirmado');
      return;
    }

    if (agendamento.idMedx !== comando.idAgendamentoMedx) {
      return recusar('id de agendamento informado pelo CRM não confere com o registro local');
    }

    const externo = await this.agenda.obter(comando.idAgendamentoMedx);

    const avaliacao = agendamento.avaliarConfirmacao(
      { status: externo.status, inicio: externo.inicio },
      this.catalogo.indiceStatusConfirmado(),
    );

    if (!avaliacao.permitido) {
      return recusar(avaliacao.motivo);
    }

    await this.agenda.confirmar(externo, this.catalogo.indiceStatusConfirmado());

    agendamento.confirmar(externo.ultimaEdicao);
    await this.agendamentos.salvar(agendamento);

    await this.crm.notificarConfirmacao(comando.dealId);

    this.logger.info(
      { deal_id: comando.dealId, id_agendamento: comando.idAgendamentoMedx },
      'agendamento confirmado no MedX',
    );
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/application/processar-resposta-lembrete/processar-resposta.usecase.spec.ts`
Expected: PASS — 13 testes.

- [ ] **Step 5: Rodar toda a suíte de `application`**

Run: `npx vitest run src/agendamento/application`
Expected: PASS — 33 testes (3 de contratos + 17 de AgendarConsulta + 13 de
ProcessarResposta).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: ProcessarRespostaUseCase como serviço injetável"
```

---

### Task 20: Infraestrutura — fila `@nestjs/bullmq` e `AdapterProcessor`

**Files:**
- Create: `src/agendamento/infrastructure/fila/fila.constants.ts`
- Create: `src/agendamento/infrastructure/fila/fila.module.ts`
- Create: `src/agendamento/infrastructure/fila/bullmq-fila.adapter.ts`
- Create: `src/agendamento/infrastructure/fila/adapter.processor.ts`
- Test: `src/agendamento/infrastructure/fila/adapter.processor.spec.ts`

**Interfaces:**
- Consumes: `AgendarConsultaUseCase` (Task 18), `ProcessarRespostaUseCase` (Task 19),
  `EventoRepositorio`/`EVENTO_REPOSITORIO` (Tasks 6/11), `ErroRateLimit` (Task 12),
  `LoggerMinimo`/`LOGGER_PORT` (Task 7), `JobAdapter`/`FILA_PORT` (Task 7)
- Produces: `NOME_FILA`, `LIMITER`, `OPCOES_JOB`; `class BullMqFilaAdapter implements
  FilaPort`; `class AdapterProcessor extends WorkerHost` (`@Processor(NOME_FILA, {...})`,
  método `process(job)`, `@OnWorkerEvent('failed') aoFalhar(job, erro)`); `class
  FilaModule` (`BullModule.forRootAsync` + `registerQueue`, exporta `BullModule` e
  `FILA_PORT`).

**Nota de wiring (importante para a Task 25):** `AdapterProcessor` depende de
`AgendarConsultaUseCase`/`ProcessarRespostaUseCase`, que vivem no módulo de aplicação —
registrá-lo dentro do próprio `FilaModule` criaria um ciclo de import entre
`FilaModule` e `AgendamentoModule`. Por isso `FilaModule` (criado nesta task) só cuida do
registro do BullMQ e do `FilaPort`; `AdapterProcessor` é registrado como provider do
`AgendamentoModule` na Task 25, que já tem acesso a tudo.

**429 não consome tentativa** (fix da revisão final, herdado): dentro de `process()`, ao
capturar `ErroRateLimit`, chama `this.worker.rateLimit(ms)` e lança `Worker.
RateLimitError()` em vez de relançar o erro original — isso devolve o job para "wait" sem
incrementar `attemptsMade`, e o evento NÃO é marcado como falhou (não é uma falha real).

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/infrastructure/fila/adapter.processor.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { AdapterProcessor } from './adapter.processor';
import { LIMITER, OPCOES_JOB, NOME_FILA } from './fila.constants';
import { ErroRateLimit } from '../medx/medx.erros';
import { EventoRecebido } from '../../domain/evento/evento-recebido';

describe('constantes da fila', () => {
  it('respeita o teto de 30 req/min do MedX com margem', () => {
    expect(LIMITER.max).toBeLessThan(30);
    expect(LIMITER.duration).toBe(60_000);
  });

  it('usa backoff exponencial com pelo menos 6 tentativas', () => {
    expect(OPCOES_JOB.attempts).toBeGreaterThanOrEqual(6);
    expect(OPCOES_JOB.backoff.type).toBe('exponential');
  });

  it('não descarta jobs que falharam, para permitir inspeção', () => {
    expect(OPCOES_JOB.removeOnFail).toBe(false);
  });

  it('usa um nome de fila estável', () => {
    expect(NOME_FILA).toBe('adapter-clint-medx');
  });
});

function eventosFalso() {
  const registros = new Map<number, EventoRecebido>();
  let proximoId = 1;
  return {
    async registrar(endpoint: string) {
      const e = EventoRecebido.restaurar({
        id: proximoId++,
        endpoint,
        status: 'recebido',
        erro: null,
        jobId: null,
      });
      registros.set(e.id, e);
      return e;
    },
    async salvar(e: EventoRecebido) {
      registros.set(e.id, e);
    },
    async expurgar() {
      return 0;
    },
    async registrarExistente(id: number) {
      return registros.get(id)!;
    },
  };
}

function montar() {
  const eventos = eventosFalso();
  const agendarConsulta = { executar: vi.fn(async () => {}) };
  const processarResposta = { executar: vi.fn(async () => {}) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const processor = new AdapterProcessor(
    eventos as any,
    agendarConsulta as any,
    processarResposta as any,
    logger as any,
  );
  // WorkerHost.worker normalmente é atribuído pelo runtime do Nest; em teste
  // direto, atribuímos um dublê mínimo.
  processor.worker = { rateLimit: vi.fn() } as any;

  return { eventos, agendarConsulta, processarResposta, logger, processor };
}

describe('AdapterProcessor.process', () => {
  it('roteia job de agendamento para o caso de uso certo', async () => {
    const { eventos, agendarConsulta, processarResposta, processor } = montar();
    const e = await eventos.registrar('/x');
    await processor.process({ data: { tipo: 'agendamento', eventoId: e.id, comando: {} } } as any);

    expect(agendarConsulta.executar).toHaveBeenCalled();
    expect(processarResposta.executar).not.toHaveBeenCalled();
  });

  it('roteia job de resposta para o caso de uso certo', async () => {
    const { eventos, agendarConsulta, processarResposta, processor } = montar();
    const e = await eventos.registrar('/x');
    await processor.process({ data: { tipo: 'resposta', eventoId: e.id, comando: {} } } as any);

    expect(processarResposta.executar).toHaveBeenCalled();
    expect(agendarConsulta.executar).not.toHaveBeenCalled();
  });

  it('marca o evento como processado no sucesso', async () => {
    const { eventos, processor } = montar();
    const e = await eventos.registrar('/x');
    await processor.process({ data: { tipo: 'agendamento', eventoId: e.id, comando: {} } } as any);
    expect((await eventos.registrarExistente(e.id)).status).toBe('processado');
  });

  it('marca falhou com a mensagem e repropaga para o BullMQ tentar de novo', async () => {
    const { eventos, agendarConsulta, processor } = montar();
    agendarConsulta.executar = vi.fn(async () => {
      throw new Error('MedX fora do ar');
    });
    const e = await eventos.registrar('/x');

    await expect(
      processor.process({ data: { tipo: 'agendamento', eventoId: e.id, comando: {} } } as any),
    ).rejects.toThrow(/fora do ar/);

    const salvo = await eventos.registrarExistente(e.id);
    expect(salvo.status).toBe('falhou');
    expect(salvo.erro).toMatch(/fora do ar/);
  });

  it('repropaga um erro especial de rate limit para o worker aplicar o Retry-After', async () => {
    const { eventos, agendarConsulta, processor } = montar();
    agendarConsulta.executar = vi.fn(async () => {
      throw new ErroRateLimit(60);
    });
    const e = await eventos.registrar('/x');

    await expect(
      processor.process({ data: { tipo: 'agendamento', eventoId: e.id, comando: {} } } as any),
    ).rejects.toThrow();
    expect((processor.worker as any).rateLimit).toHaveBeenCalledWith(60_000);
  });

  it('registra rate limit como aviso, não como erro, e não marca o evento como falhou', async () => {
    const { eventos, agendarConsulta, logger, processor } = montar();
    agendarConsulta.executar = vi.fn(async () => {
      throw new ErroRateLimit(60);
    });
    const e = await eventos.registrar('/x');

    await expect(
      processor.process({ data: { tipo: 'agendamento', eventoId: e.id, comando: {} } } as any),
    ).rejects.toThrow();

    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect((await eventos.registrarExistente(e.id)).status).toBe('recebido');
  });
});

describe('AdapterProcessor.aoFalhar (dead letter)', () => {
  it('alerta quando o job esgota as tentativas', () => {
    const { logger, processor } = montar();
    processor.aoFalhar(
      { id: 'job-1', attemptsMade: 6, opts: { attempts: 6 } } as any,
      new Error('MedX fora do ar'),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ alerta: true }),
      expect.any(String),
    );
  });

  it('não alerta quando ainda há tentativas restantes', () => {
    const { logger, processor } = montar();
    processor.aoFalhar({ id: 'job-1', attemptsMade: 2, opts: { attempts: 6 } } as any, new Error('timeout'));
    expect(logger.error).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/infrastructure/fila/adapter.processor.spec.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar `src/agendamento/infrastructure/fila/fila.constants.ts`**

```ts
import type { JobsOptions } from 'bullmq';

export const NOME_FILA = 'adapter-clint-medx';

/** Abaixo do teto de 30/min do MedX, com margem para chamadas manuais na mesma conta. */
export const LIMITER = { max: 25, duration: 60_000 } as const;

export const OPCOES_JOB: JobsOptions & { backoff: { type: string; delay: number } } = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: false,
};
```

- [ ] **Step 4: Implementar `src/agendamento/infrastructure/fila/adapter.processor.ts`**

```ts
import { Inject } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Worker, type Job } from 'bullmq';
import { LOGGER_PORT, type LoggerMinimo } from '../../application/ports/logger.port';
import type { JobAdapter } from '../../application/ports/fila.port';
import type { EventoRepositorio } from '../../domain/evento/evento.repositorio';
import { AgendarConsultaUseCase } from '../../application/agendar-consulta/agendar-consulta.usecase';
import { ProcessarRespostaUseCase } from '../../application/processar-resposta-lembrete/processar-resposta.usecase';
import { EVENTO_REPOSITORIO } from '../../../shared/persistence/persistence.module';
import { ErroRateLimit } from '../medx/medx.erros';
import { LIMITER, NOME_FILA } from './fila.constants';

@Processor(NOME_FILA, { concurrency: 1, limiter: LIMITER })
export class AdapterProcessor extends WorkerHost {
  constructor(
    @Inject(EVENTO_REPOSITORIO) private readonly eventos: EventoRepositorio,
    private readonly agendarConsulta: AgendarConsultaUseCase,
    private readonly processarResposta: ProcessarRespostaUseCase,
    @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
  ) {
    super();
  }

  async process(job: Job<JobAdapter>): Promise<void> {
    const dados = job.data;
    const evento = await this.eventos.registrarExistente(dados.eventoId);

    try {
      if (dados.tipo === 'agendamento') {
        await this.agendarConsulta.executar(dados.comando);
      } else {
        await this.processarResposta.executar(dados.comando);
      }

      evento.marcarProcessado();
      await this.eventos.salvar(evento);

      this.logger.info({ evento_id: dados.eventoId, tipo: dados.tipo }, 'job processado');
    } catch (erro) {
      if (erro instanceof ErroRateLimit) {
        // Um 429 não é falha real do job: devolve o job para "wait" respeitando
        // o Retry-After do MedX, sem consumir tentativa nem poluir a auditoria
        // com um evento que não falhou de verdade.
        this.logger.warn(
          { evento_id: dados.eventoId, esperar: erro.esperarSegundos },
          'rate limit do MedX — job devolvido para a fila sem consumir tentativa',
        );
        await this.worker.rateLimit(erro.esperarSegundos * 1000);
        throw Worker.RateLimitError();
      }

      const mensagem = erro instanceof Error ? erro.message : String(erro);

      evento.marcarFalha(mensagem);
      await this.eventos.salvar(evento);

      this.logger.error({ evento_id: dados.eventoId, erro: mensagem }, 'job falhou');

      throw erro;
    }
  }

  @OnWorkerEvent('failed')
  aoFalhar(job: Job, erro: Error): void {
    const tentativas = job?.attemptsMade ?? 0;
    const maximo = job?.opts?.attempts ?? 0;
    if (tentativas >= maximo) {
      this.logger.error(
        { alerta: true, job_id: job?.id, tentativas, erro: erro.message },
        'job esgotou as tentativas e foi para a dead letter',
      );
    }
  }
}
```

- [ ] **Step 5: Implementar `src/agendamento/infrastructure/fila/bullmq-fila.adapter.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { FilaPort, JobAdapter } from '../../application/ports/fila.port';
import { NOME_FILA } from './fila.constants';

@Injectable()
export class BullMqFilaAdapter implements FilaPort {
  constructor(@InjectQueue(NOME_FILA) private readonly fila: Queue<JobAdapter>) {}

  async add(nome: string, dados: JobAdapter): Promise<{ id?: string }> {
    const job = await this.fila.add(nome, dados);
    return { id: job.id };
  }
}
```

- [ ] **Step 6: Implementar `src/agendamento/infrastructure/fila/fila.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FILA_PORT } from '../../application/ports/fila.port';
import { BullMqFilaAdapter } from './bullmq-fila.adapter';
import { NOME_FILA, OPCOES_JOB } from './fila.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({ connection: { url: config.get<string>('REDIS_URL') } }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: NOME_FILA, defaultJobOptions: OPCOES_JOB }),
  ],
  providers: [{ provide: FILA_PORT, useClass: BullMqFilaAdapter }],
  exports: [BullModule, FILA_PORT],
})
export class FilaModule {}
```

- [ ] **Step 7: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/infrastructure/fila/adapter.processor.spec.ts`
Expected: PASS — 10 testes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: fila @nestjs/bullmq com rate limiter e AdapterProcessor"
```

---

### Task 21: Infraestrutura — `ObservabilidadeModule` (nestjs-pino, alertas, e-mail)

**Files:**
- Create: `src/shared/observabilidade/campos-redigidos.ts`
- Create: `src/shared/observabilidade/alerta-logger.ts`
- Create: `src/shared/observabilidade/notificador-email.ts`
- Create: `src/shared/observabilidade/observabilidade.module.ts`
- Test: `src/shared/observabilidade/alerta-logger.spec.ts`

**Interfaces:**
- Consumes: `NotificadorPort`/`NOTIFICADOR_PORT`, `LOGGER_PORT`/`LoggerMinimo` (Task 7),
  `nestjs-pino`
- Produces: `CAMPOS_REDIGIDOS`, `NOTIFICADOR_SILENCIOSO: NotificadorPort`, `class
  AlertaLogger implements LoggerMinimo` (`@Injectable()`, dispara alerta em todo
  `warn`/`error` cujo objeto traga `alerta: true`, sem nunca deixar a falha do notificador
  derrubar o log), `criarNotificadorEmail(opcoes)`, `class ObservabilidadeModule` (registra
  `nestjs-pino`, escolhe o notificador via `ConfigService`, expõe `LOGGER_PORT` e
  `NOTIFICADOR_PORT`).

O disparo do alerta continua **assíncrono** (`Promise.resolve().then(...)`) — os testes que
checam a chamada ao notificador precisam de `await new Promise((r) => setImmediate(r))`
depois do `warn`/`error`, do contrário a asserção roda antes da fila de microtasks
esvaziar (mesmo cuidado identificado e corrigido no projeto Fastify original).

- [ ] **Step 1: Instalar o nodemailer**

Run: `npm ls nodemailer` — se já instalado (Task 1), pule.

- [ ] **Step 2: Escrever o teste que falha**

`src/shared/observabilidade/alerta-logger.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';
import { AlertaLogger, NOTIFICADOR_SILENCIOSO } from './alerta-logger';
import { criarNotificadorEmail } from './notificador-email';
import type { NotificadorPort } from '../../agendamento/application/ports/notificador.port';

function pinoFalso(): PinoLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as PinoLogger;
}

describe('criarNotificadorEmail', () => {
  it('envia para o destino configurado com assunto prefixado', async () => {
    const enviarEmail = vi.fn(async () => {});
    await criarNotificadorEmail({ enviarEmail, destino: 'gestao@clinica.test' }).alertar(
      'job na dead letter',
      { deal_id: 'd1' },
    );

    expect(enviarEmail).toHaveBeenCalledWith(
      'gestao@clinica.test',
      '[adapter-clint-medx] job na dead letter',
      expect.stringContaining('d1'),
    );
  });
});

describe('NOTIFICADOR_SILENCIOSO', () => {
  it('não faz nada e resolve', async () => {
    await expect(NOTIFICADOR_SILENCIOSO.alertar('x', {})).resolves.toBeUndefined();
  });
});

describe('AlertaLogger', () => {
  it('repassa info sem alertar', () => {
    const notificador: NotificadorPort = { alertar: vi.fn(async () => {}) };
    const pino = pinoFalso();
    new AlertaLogger(pino, notificador).info({ deal_id: 'd1' }, 'tudo certo');

    expect(pino.info).toHaveBeenCalledWith({ deal_id: 'd1' }, 'tudo certo');
    expect(notificador.alertar).not.toHaveBeenCalled();
  });

  it('não alerta em warn comum', () => {
    const notificador: NotificadorPort = { alertar: vi.fn(async () => {}) };
    new AlertaLogger(pinoFalso(), notificador).warn({ deal_id: 'd1' }, 'aviso trivial');
    expect(notificador.alertar).not.toHaveBeenCalled();
  });

  it('alerta em warn marcado com alerta:true e ainda loga', async () => {
    const notificador: NotificadorPort = { alertar: vi.fn(async () => {}) };
    const pino = pinoFalso();
    new AlertaLogger(pino, notificador).warn({ alerta: true, deal_id: 'd1' }, 'confirmação recusada');
    await new Promise((r) => setImmediate(r));

    expect(pino.warn).toHaveBeenCalled();
    expect(notificador.alertar).toHaveBeenCalledWith('confirmação recusada', {
      alerta: true,
      deal_id: 'd1',
    });
  });

  it('alerta em error marcado com alerta:true', async () => {
    const notificador: NotificadorPort = { alertar: vi.fn(async () => {}) };
    new AlertaLogger(pinoFalso(), notificador).error({ alerta: true }, 'dead letter');
    await new Promise((r) => setImmediate(r));
    expect(notificador.alertar).toHaveBeenCalled();
  });

  it('não deixa a falha do notificador derrubar o log', () => {
    const notificador: NotificadorPort = {
      alertar: vi.fn(async () => {
        throw new Error('SMTP fora do ar');
      }),
    };
    const pino = pinoFalso();
    expect(() => new AlertaLogger(pino, notificador).warn({ alerta: true }, 'x')).not.toThrow();
    expect(pino.warn).toHaveBeenCalled();
  });

  it('ignora objetos que não são registros', () => {
    const notificador: NotificadorPort = { alertar: vi.fn(async () => {}) };
    expect(() => new AlertaLogger(pinoFalso(), notificador).warn('string solta')).not.toThrow();
    expect(notificador.alertar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/shared/observabilidade/alerta-logger.spec.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 4: Implementar `src/shared/observabilidade/campos-redigidos.ts`**

```ts
export const CAMPOS_REDIGIDOS = [
  'cpf',
  'telefone',
  'nome',
  'email',
  'celular',
  'data_nascimento',
  '*.cpf',
  '*.telefone',
  '*.nome',
  '*.email',
  '*.celular',
  '*.data_nascimento',
  '*.CPF_CGC',
  '*.Celular',
  '*.Nome',
  '*.Email',
  '*.Nascimento',
  'payload.cpf',
  'payload.telefone',
  'payload.nome',
  'payload.email',
];
```

- [ ] **Step 5: Implementar `src/shared/observabilidade/alerta-logger.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { LOGGER_PORT, type LoggerMinimo } from '../../agendamento/application/ports/logger.port';
import { NOTIFICADOR_PORT, type NotificadorPort } from '../../agendamento/application/ports/notificador.port';

export const NOTIFICADOR_SILENCIOSO: NotificadorPort = {
  async alertar(): Promise<void> {},
};

function deveAlertar(objeto: unknown): objeto is Record<string, unknown> {
  return typeof objeto === 'object' && objeto !== null && (objeto as Record<string, unknown>).alerta === true;
}

@Injectable()
export class AlertaLogger implements LoggerMinimo {
  constructor(
    @InjectPinoLogger(AlertaLogger.name) private readonly pino: PinoLogger,
    @Inject(NOTIFICADOR_PORT) private readonly notificador: NotificadorPort,
  ) {}

  info(o: unknown, m?: string): void {
    this.pino.info(o, m);
  }

  warn(o: unknown, m?: string): void {
    this.pino.warn(o, m);
    this.alertarSeNecessario(o, m);
  }

  error(o: unknown, m?: string): void {
    this.pino.error(o, m);
    this.alertarSeNecessario(o, m);
  }

  private alertarSeNecessario(objeto: unknown, mensagem?: string): void {
    if (deveAlertar(objeto)) {
      // Um alerta que falha nunca pode derrubar o fluxo que o disparou.
      void Promise.resolve()
        .then(() => this.notificador.alertar(mensagem ?? 'alerta do adapter', objeto))
        .catch(() => {});
    }
  }
}
```

Note: `LOGGER_PORT` é reexportado aqui só por conveniência de import — o token
propriamente dito continua definido em `logger.port.ts` (Task 7); não duplique a
declaração do `Symbol`.

- [ ] **Step 6: Implementar `src/shared/observabilidade/notificador-email.ts`**

```ts
import type { NotificadorPort } from '../../agendamento/application/ports/notificador.port';

export function criarNotificadorEmail(opcoes: {
  enviarEmail: (para: string, assunto: string, corpo: string) => Promise<void>;
  destino: string;
}): NotificadorPort {
  return {
    async alertar(assunto: string, detalhes: Record<string, unknown>): Promise<void> {
      await opcoes.enviarEmail(
        opcoes.destino,
        `[adapter-clint-medx] ${assunto}`,
        JSON.stringify(detalhes, null, 2),
      );
    },
  };
}
```

- [ ] **Step 7: Implementar `src/shared/observabilidade/observabilidade.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import nodemailer from 'nodemailer';
import { LOGGER_PORT } from '../../agendamento/application/ports/logger.port';
import { NOTIFICADOR_PORT, type NotificadorPort } from '../../agendamento/application/ports/notificador.port';
import { AlertaLogger, NOTIFICADOR_SILENCIOSO } from './alerta-logger';
import { criarNotificadorEmail } from './notificador-email';
import { CAMPOS_REDIGIDOS } from './campos-redigidos';

function escolherNotificador(config: ConfigService): NotificadorPort {
  const smtpUrl = config.get<string>('SMTP_URL');
  const destino = config.get<string>('ALERTA_EMAIL_DESTINO');
  if (!smtpUrl || !destino) {
    return NOTIFICADOR_SILENCIOSO;
  }

  return criarNotificadorEmail({
    destino,
    enviarEmail: async (para, assunto, corpo) => {
      const transporte = nodemailer.createTransport(smtpUrl);
      await transporte.sendMail({
        from: config.get<string>('ALERTA_EMAIL_ORIGEM'),
        to: para,
        subject: assunto,
        text: corpo,
      });
    },
  });
}

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL'),
          redact: CAMPOS_REDIGIDOS,
          base: { servico: 'adapter-clint-medx' },
          autoLogging: false,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    { provide: NOTIFICADOR_PORT, useFactory: escolherNotificador, inject: [ConfigService] },
    { provide: LOGGER_PORT, useClass: AlertaLogger },
  ],
  exports: [PinoLoggerModule, LOGGER_PORT, NOTIFICADOR_PORT],
})
export class ObservabilidadeModule {
  static escolherNotificador = escolherNotificador; // exposto para teste unitário
}
```

Expor `escolherNotificador` como propriedade estática permite testá-la isoladamente
(Task 25 já cobre isso de novo no contexto da composição — aqui é só para o `ConfigService`
falso não precisar bootar o módulo inteiro).

- [ ] **Step 8: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/shared/observabilidade/alerta-logger.spec.ts`
Expected: PASS — 8 testes.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: ObservabilidadeModule com nestjs-pino, alertas e notificador de e-mail"
```

---

### Task 22: Presentation — `WebhooksController` e a garantia "sempre 200"

**Files:**
- Create: `src/agendamento/presentation/http/schemas.ts`
- Create: `src/agendamento/presentation/http/webhooks.controller.ts`
- Create: `src/agendamento/presentation/http/webhook-always-ok.filter.ts`
- Create: `src/shared/presentation/not-found.filter.ts`
- Test: `test/webhooks.e2e-spec.ts` (suíte e2e — ver Task 28 para o setup completo do
  `Test.createTestingModule`; esta task só escreve os casos de teste do controller)

**Interfaces:**
- Consumes: `EventoRepositorio`/`EVENTO_REPOSITORIO` (Task 6/11), `FilaPort`/`FILA_PORT`
  (Task 7), `LoggerMinimo`/`LOGGER_PORT` (Task 7)
- Produces: `schemaAgendamento`/`schemaResposta` (Zod, idênticos ao projeto atual),
  `class WebhooksController`, `class WebhookAlwaysOkFilter` (`@Catch()`, escopado ao
  controller via `@UseFilters()`), `class NotFoundFilter` (`@Catch(NotFoundException)`,
  registrado globalmente em `main.ts` — Task 25 — mas só força 200 para requisições cujo
  `request.url` comece com `/webhooks/`; qualquer outro 404 passa normal)

**A garantia "sempre 200" precisa de DUAS peças, porque o parsing do corpo acontece ANTES
do controller rodar:**
1. `WebhookAlwaysOkFilter`, escopado ao `WebhooksController` via `@UseFilters()` — captura
   qualquer exceção lançada durante o processamento de uma rota já correspondida (inclusive
   corpo JSON malformado, se o Express/Nest a propagar como exceção na mesma janela de
   exceção da rota) e responde 200.
2. `NotFoundFilter`, registrado globalmente (não por rota) porque um 404 acontece quando
   NENHUM controller corresponde — não há como escopar um filtro a "nenhuma rota". Ele
   verifica o prefixo da URL antes de decidir: só força 200 para `/webhooks/*`; qualquer
   outro 404 (`/rota-que-nao-existe`) continua sendo um 404 de verdade. Isso preserva o
   Global Constraint ("nunca um filtro que se aplique a toda a API mascarando 404
   legítimos") porque o filtro em si é seletivo por conteúdo, mesmo sendo registrado
   globalmente.

**Atenção ao implementar (verificar empiricamente no Step 7):** confirme que corpo JSON
malformado em `POST /webhooks/clint/agendamento` realmente é capturado por
`WebhookAlwaysOkFilter` no Express/Nest. Se o body-parser do Express rejeitar o corpo antes
de a exceção entrar na "zona" de exceções do Nest para aquela rota (comportamento pode
variar por versão), talvez seja necessário registrar um parser JSON customizado com
tratamento de erro próprio em `main.ts` em vez de depender só do filtro. Se encontrar esse
gap, documente a solução encontrada no relatório da task — não deixe o teste passando por
acidente sem entender por quê.

- [ ] **Step 1: Implementar `src/agendamento/presentation/http/schemas.ts`** (idêntico ao
  projeto atual, já revisado — inclusive o fix de validação de `deal_id`/`data_nascimento`
  da revisão final)

```ts
import { z } from 'zod';
import { VALORES_RESPOSTA } from '../../domain/agendamento/resposta-lembrete';

export const schemaAgendamento = z.object({
  deal_id: z.string().uuid(),
  nome: z.string().min(1),
  telefone: z.string().min(1),
  data_nascimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'data de nascimento deve estar no formato YYYY-MM-DD'),
  // Mantido flexível: aceita offset, "Z" ou nenhum offset (horário local da
  // clínica) — todos válidos conforme PeriodoConsulta.criar.
  data_hora: z.string().min(1),
  profissional: z.union([z.string().min(1), z.number()]),
  tipo_consulta: z.union([z.string().min(1), z.number()]),
  cpf: z.string().optional(),
  email: z.string().optional(),
  sexo: z.enum(['M', 'F']).optional(),
});

export const schemaResposta = z.object({
  deal_id: z.string().uuid(),
  id_agendamento_medx: z.coerce.number().int().positive(),
  resposta: z.enum(VALORES_RESPOSTA as unknown as [string, ...string[]]),
});

export type PayloadAgendamento = z.infer<typeof schemaAgendamento>;
export type PayloadResposta = z.infer<typeof schemaResposta>;
```

- [ ] **Step 2: Implementar `src/agendamento/presentation/http/webhook-always-ok.filter.ts`**

```ts
import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { LOGGER_PORT, type LoggerMinimo } from '../../application/ports/logger.port';
import { Inject } from '@nestjs/common';

const OK = { ok: true } as const;

@Catch()
export class WebhookAlwaysOkFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER_PORT) private readonly logger: LoggerMinimo) {}

  catch(excecao: unknown, host: ArgumentsHost): void {
    const resposta = host.switchToHttp().getResponse<Response>();
    const mensagem = excecao instanceof Error ? excecao.message : String(excecao);
    this.logger.error({ erro: mensagem }, 'erro não tratado no webhook');
    resposta.status(200).json(OK);
  }
}
```

- [ ] **Step 3: Implementar `src/shared/presentation/not-found.filter.ts`**

```ts
import { ArgumentsHost, Catch, ExceptionFilter, Inject, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LOGGER_PORT, type LoggerMinimo } from '../../agendamento/application/ports/logger.port';

const OK = { ok: true } as const;

@Catch(NotFoundException)
export class NotFoundFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER_PORT) private readonly logger: LoggerMinimo) {}

  catch(excecao: NotFoundException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const requisicao = ctx.getRequest<Request>();
    const resposta = ctx.getResponse<Response>();

    if (requisicao.originalUrl.startsWith('/webhooks/')) {
      this.logger.warn(
        { alerta: true, metodo: requisicao.method, url: requisicao.originalUrl },
        'webhook chegou em rota inexistente — conferir a configuração no Clint',
      );
      resposta.status(200).json(OK);
      return;
    }

    // Qualquer outro 404 continua sendo um 404 de verdade.
    const corpo = excecao.getResponse();
    resposta.status(404).json(typeof corpo === 'string' ? { message: corpo } : corpo);
  }
}
```

- [ ] **Step 4: Implementar `src/agendamento/presentation/http/webhooks.controller.ts`**

```ts
import { Body, Controller, HttpCode, Headers, Inject, Post, UseFilters } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FILA_PORT, type FilaPort, type JobAdapter } from '../../application/ports/fila.port';
import { LOGGER_PORT, type LoggerMinimo } from '../../application/ports/logger.port';
import type { EventoRepositorio } from '../../domain/evento/evento.repositorio';
import { EVENTO_REPOSITORIO } from '../../../shared/persistence/persistence.module';
import { schemaAgendamento, schemaResposta } from './schemas';
import { WebhookAlwaysOkFilter } from './webhook-always-ok.filter';

type ResultadoValidacao = { ok: true; job: JobAdapter } | { ok: false; motivo: string };

@Controller('webhooks/clint')
@UseFilters(WebhookAlwaysOkFilter)
export class WebhooksController {
  constructor(
    @Inject(FILA_PORT) private readonly fila: FilaPort,
    @Inject(EVENTO_REPOSITORIO) private readonly eventos: EventoRepositorio,
    @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
    private readonly config: ConfigService,
  ) {}

  @Post('agendamento')
  @HttpCode(200)
  async agendamento(
    @Headers('x-adapter-secret') segredo: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    return this.receber(body, segredo, '/webhooks/clint/agendamento', (payload) => {
      const validado = schemaAgendamento.safeParse(payload);
      if (!validado.success) {
        return { ok: false, motivo: validado.error.issues.map((i) => i.path.join('.')).join(', ') };
      }
      const p = validado.data;
      return {
        ok: true,
        job: {
          tipo: 'agendamento',
          eventoId: 0,
          comando: {
            dealId: p.deal_id,
            nome: p.nome,
            telefone: p.telefone,
            dataNascimento: p.data_nascimento,
            dataHora: p.data_hora,
            profissional: p.profissional,
            tipoConsulta: p.tipo_consulta,
            cpf: p.cpf,
            email: p.email,
            sexo: p.sexo,
          },
        },
      };
    });
  }

  @Post('resposta-lembrete')
  @HttpCode(200)
  async respostaLembrete(
    @Headers('x-adapter-secret') segredo: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    return this.receber(body, segredo, '/webhooks/clint/resposta-lembrete', (payload) => {
      const validado = schemaResposta.safeParse(payload);
      if (!validado.success) {
        return { ok: false, motivo: validado.error.issues.map((i) => i.path.join('.')).join(', ') };
      }
      const p = validado.data;
      return {
        ok: true,
        job: {
          tipo: 'resposta',
          eventoId: 0,
          comando: { dealId: p.deal_id, idAgendamentoMedx: p.id_agendamento_medx, resposta: p.resposta },
        },
      };
    });
  }

  private async receber(
    body: unknown,
    segredo: string | undefined,
    endpoint: string,
    montarJob: (payload: unknown) => ResultadoValidacao,
  ): Promise<{ ok: true }> {
    const OK = { ok: true as const };

    if (segredo !== this.config.get<string>('ADAPTER_SECRET')) {
      this.logger.warn({ endpoint }, 'webhook recusado por segredo inválido');
      return OK;
    }

    const evento = await this.eventos.registrar(endpoint, body);
    const resultado = montarJob(body);

    if (!resultado.ok) {
      evento.marcarInvalido(resultado.motivo);
      await this.eventos.salvar(evento);
      this.logger.warn({ evento_id: evento.id, endpoint }, 'payload inválido');
      return OK;
    }

    try {
      const criado = await this.fila.add(resultado.job.tipo, { ...resultado.job, eventoId: evento.id });
      if (criado.id) {
        evento.associarJob(criado.id);
        await this.eventos.salvar(evento);
      }
    } catch (erro) {
      evento.marcarFalha(`não foi possível enfileirar: ${(erro as Error).message}`);
      await this.eventos.salvar(evento);
      this.logger.error(
        { alerta: true, evento_id: evento.id },
        'fila indisponível — evento gravado para reprocessar',
      );
    }

    return OK;
  }
}
```

- [ ] **Step 5: Escrever os casos de teste do controller** (parte da suíte e2e — arquivo
  completo e execução ficam na Task 28; aqui só registre os `it(...)` num arquivo
  provisório `src/agendamento/presentation/http/webhooks.controller.cases.ts` para
  referência da Task 28, OU pule direto para a Task 28 se preferir escrever tudo de uma vez
  — ambas são válidas, mas não deixe a task marcada como concluída sem pelo menos os testes
  de autenticação e de payload inválido rodando via `app.inject`-equivalente do Nest
  (supertest), mesmo que via um `Test.createTestingModule` mínimo só com
  `WebhooksController` e dublês dos providers).

Teste mínimo para fechar esta task (`src/agendamento/presentation/http/webhooks.controller.spec.ts`,
unitário, sem HTTP real — a suíte e2e completa com supertest vem na Task 28):
```ts
import { describe, it, expect, vi } from 'vitest';
import { WebhooksController } from './webhooks.controller';

function montar() {
  const eventos = {
    registrar: vi.fn(async (endpoint: string, payload: unknown) => ({
      id: 1,
      marcarInvalido: vi.fn(),
      marcarFalha: vi.fn(),
      associarJob: vi.fn(),
    })),
    salvar: vi.fn(async () => {}),
  };
  const fila = { add: vi.fn(async () => ({ id: 'job-1' })) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const config = { get: (chave: string) => (chave === 'ADAPTER_SECRET' ? 'segredo-certo' : undefined) };

  const controller = new WebhooksController(fila as any, eventos as any, logger as any, config as any);
  return { eventos, fila, logger, controller };
}

const AGENDAMENTO = {
  deal_id: '8feade82-d77b-4e8b-9d35-fd43e972b5c8',
  nome: 'Maria Silva',
  telefone: '+5511999998888',
  data_nascimento: '1990-05-20',
  data_hora: '2026-07-10T14:00:00-03:00',
  profissional: 'Leize Ferreira',
  tipo_consulta: 'Consulta de Rotina',
};

describe('WebhooksController.agendamento', () => {
  it('recusa sem o segredo certo, mas ainda responde ok', async () => {
    const { controller, fila } = montar();
    const r = await controller.agendamento('errado', AGENDAMENTO);
    expect(r).toEqual({ ok: true });
    expect(fila.add).not.toHaveBeenCalled();
  });

  it('grava o evento e enfileira com o segredo certo', async () => {
    const { controller, eventos, fila } = montar();
    const r = await controller.agendamento('segredo-certo', AGENDAMENTO);
    expect(r).toEqual({ ok: true });
    expect(eventos.registrar).toHaveBeenCalled();
    expect(fila.add).toHaveBeenCalledTimes(1);
  });

  it('marca inválido e não enfileira quando falta campo obrigatório', async () => {
    const { controller, fila } = montar();
    const { telefone, ...semTelefone } = AGENDAMENTO;
    const r = await controller.agendamento('segredo-certo', semTelefone);
    expect(r).toEqual({ ok: true });
    expect(fila.add).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Rodar o teste unitário e confirmar que passa**

Run: `npx vitest run src/agendamento/presentation/http/webhooks.controller.spec.ts`
Expected: PASS — 3 testes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: WebhooksController com a garantia sempre-200"
```

---

### Task 23: Presentation — `HealthController`

**Files:**
- Create: `src/agendamento/presentation/http/health.controller.ts`
- Test: `src/agendamento/presentation/http/health.controller.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 8), `MedxTokenProvider` (Task 12), `ConfigService`
- Produces: `interface Saude { redis: boolean; banco: boolean; medx: boolean }`, `class
  HealthController` com `GET /health` — **exceção documentada** à garantia "sempre 200"
  (responde 503 quando algo está fora do ar, conforme o spec do projeto).

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/presentation/http/health.controller.spec.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { HealthController } from './health.controller';

function respostaFalsa() {
  const resposta = { status: vi.fn(), json: vi.fn() } as any;
  resposta.status.mockReturnValue(resposta);
  return resposta;
}

function montar(overrides: Partial<{ banco: boolean; redis: boolean; medx: boolean }> = {}) {
  const prisma = {
    $queryRaw: overrides.banco === false ? vi.fn(async () => { throw new Error('fora'); }) : vi.fn(async () => [{ ok: 1 }]),
  };
  const redisClient = {
    ping:
      overrides.redis === false
        ? vi.fn(async () => { throw new Error('fora'); })
        : vi.fn(async () => 'PONG'),
  };
  const tokens = {
    obterToken:
      overrides.medx === false
        ? vi.fn(async () => { throw new Error('fora'); })
        : vi.fn(async () => 'jwt'),
  };

  return { controller: new HealthController(prisma as any, redisClient as any, tokens as any) };
}

describe('GET /health', () => {
  it('responde 200 quando tudo está de pé', async () => {
    const { controller } = montar();
    const resposta = respostaFalsa();
    await controller.verificar(resposta);
    expect(resposta.status).toHaveBeenCalledWith(200);
    expect(resposta.json).toHaveBeenCalledWith({ redis: true, banco: true, medx: true });
  });

  it('responde 503 quando algum componente está fora', async () => {
    const { controller } = montar({ redis: false });
    const resposta = respostaFalsa();
    await controller.verificar(resposta);
    expect(resposta.status).toHaveBeenCalledWith(503);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/presentation/http/health.controller.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/presentation/http/health.controller.ts`**

```ts
import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../../shared/persistence/prisma.service';
import { MedxTokenProvider } from '../../infrastructure/medx/medx-token.provider';

export const REDIS_HEALTH_CLIENT = Symbol('VerificadorRedis');

// Interface mínima que o health check precisa — implementada pela classe
// concreta `RedisHealthClient` (Task 25, shared/observabilidade/redis-health.client.ts).
// Nomes propositalmente diferentes (interface vs. classe) para não confundir
// os dois arquivos.
export interface VerificadorRedis {
  ping(): Promise<string>;
}

export interface Saude {
  redis: boolean;
  banco: boolean;
  medx: boolean;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_HEALTH_CLIENT) private readonly redis: VerificadorRedis,
    private readonly tokens: MedxTokenProvider,
  ) {}

  @Get()
  async verificar(@Res() resposta: Response): Promise<void> {
    const saude: Saude = {
      redis: await this.redis
        .ping()
        .then(() => true)
        .catch(() => false),
      banco: await this.prisma
        .$queryRaw`SELECT 1`
        .then(() => true)
        .catch(() => false),
      medx: await this.tokens
        .obterToken()
        .then(() => true)
        .catch(() => false),
    };
    const tudoOk = saude.redis && saude.banco && saude.medx;
    resposta.status(tudoOk ? 200 : 503).json(saude);
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/presentation/http/health.controller.spec.ts`
Expected: PASS — 2 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: HealthController verificando redis, banco e MedX"
```

---

### Task 24: Presentation — painel da fila (Bull Board sobre Express)

**Files:**
- Create: `src/agendamento/presentation/http/painel-fila.ts`
- Test: `src/agendamento/presentation/http/painel-fila.spec.ts`

**Interfaces:**
- Consumes: `Queue<JobAdapter>` (Task 20), `INestApplication`
- Produces: `registrarPainelFila(app, fila, credenciais): boolean` — devolve `true` se o
  painel subiu, `false` se foi pulado por falta de credenciais.

Equivalente ao `@bull-board/fastify` do projeto original, mas sobre Express
(`@bull-board/express` + `express-basic-auth`, já que o adapter HTTP mudou). **Sem
credenciais, a rota simplesmente não é registrada** — nunca existe uma versão
desprotegida, mesmo que temporária.

- [ ] **Step 1: Escrever o teste que falha**

`src/agendamento/presentation/http/painel-fila.spec.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Queue } from 'bullmq';
import { registrarPainelFila } from './painel-fila';

function appFalso() {
  const expressApp = express();
  return {
    app: { getHttpAdapter: () => ({ getInstance: () => expressApp }) } as any,
    expressApp,
  };
}

function filaFalsa(): Queue {
  const fila = new Queue('teste-painel', {
    connection: { host: '127.0.0.1', port: 1, retryStrategy: () => null },
  });
  fila.on('error', () => {});
  return fila;
}

describe('registrarPainelFila', () => {
  let fila: Queue;

  afterEach(async () => {
    await fila?.close();
  });

  it('sem credenciais não registra a rota e devolve false', () => {
    fila = filaFalsa();
    const { app } = appFalso();
    expect(registrarPainelFila(app, fila, {})).toBe(false);
  });

  it('com credenciais registra a rota protegida por basic auth', async () => {
    fila = filaFalsa();
    const { app, expressApp } = appFalso();

    expect(registrarPainelFila(app, fila, { usuario: 'u', senha: 's' })).toBe(true);

    const semAuth = await request(expressApp).get('/admin/filas/');
    expect(semAuth.status).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/presentation/http/painel-fila.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/agendamento/presentation/http/painel-fila.ts`**

```ts
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import basicAuth from 'express-basic-auth';

const CAMINHO = '/admin/filas';

/**
 * Sobe o painel apenas com credenciais definidas. Sem elas a rota não existe:
 * expor a fila sem autenticação vazaria deal_id e o conteúdo dos jobs.
 */
export function registrarPainelFila(
  app: INestApplication,
  fila: Queue,
  credenciais: { usuario?: string; senha?: string },
): boolean {
  const { usuario, senha } = credenciais;
  if (!usuario || !senha) return false;

  const painel = new ExpressAdapter();
  createBullBoard({ queues: [new BullMQAdapter(fila)], serverAdapter: painel });
  painel.setBasePath(CAMINHO);

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(
    CAMINHO,
    basicAuth({ users: { [usuario]: senha }, challenge: true, realm: 'adapter' }),
    painel.getRouter(),
  );

  return true;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/agendamento/presentation/http/painel-fila.spec.ts`
Expected: PASS — 2 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: painel da fila (Bull Board) protegido por basic auth sobre Express"
```

---

### Task 25: Composition — `AgendamentoModule`, `AppModule` e `main.ts` finais

**Files:**
- Create: `src/agendamento/agendamento.module.ts`
- Modify: `src/app.module.ts` (Task 1 criou um esqueleto; substitua pelo conteúdo abaixo)
- Modify: `src/main.ts` (Task 1 criou um esqueleto; substitua pelo conteúdo abaixo)
- Create: `src/shared/observabilidade/redis-health.client.ts`
- Test: `src/agendamento/agendamento.module.spec.ts` (só testa `escolherNotificador`,
  reexportado — o resto exige Redis/Postgres reais, coberto pela suíte e2e)

**Interfaces:**
- Consumes: tudo — este é o único ponto do projeto que conhece todas as camadas
- Produces: `class AgendamentoModule` (registra MedX/Clint como implementações dos ports,
  os dois usecases, `AdapterProcessor`, `HealthController`, `WebhooksController`; no
  `onModuleInit`, chama `catalogo.carregar()` **sem try/catch, deliberadamente** — se o
  rótulo "Confirmado" não existir na conta, o processo deve falhar imediatamente e alto na
  inicialização), `class AppModule`, `main.ts` final com shutdown gracioso e expurgo diário.

**`AdapterProcessor` é registrado aqui, não em `FilaModule`** (ver nota da Task 20) — evita
o ciclo de import entre `FilaModule` e o módulo que provê os usecases.

- [ ] **Step 1: Implementar `src/shared/observabilidade/redis-health.client.ts`**

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

@Injectable()
export class RedisHealthClient implements OnModuleDestroy {
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
```

- [ ] **Step 2: Escrever o teste que falha (`escolherNotificador`, reexportado do
  `ObservabilidadeModule` da Task 21)**

`src/agendamento/agendamento.module.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ObservabilidadeModule } from '../shared/observabilidade/observabilidade.module';
import { NOTIFICADOR_SILENCIOSO } from '../shared/observabilidade/alerta-logger';

function configFalso(valores: Record<string, string> = {}): ConfigService {
  return { get: (chave: string) => valores[chave] } as ConfigService;
}

describe('escolherNotificador', () => {
  it('usa o silencioso quando SMTP não está configurado', () => {
    expect(ObservabilidadeModule.escolherNotificador(configFalso())).toBe(NOTIFICADOR_SILENCIOSO);
  });

  it('usa o silencioso quando falta o destino', () => {
    expect(
      ObservabilidadeModule.escolherNotificador(configFalso({ SMTP_URL: 'smtp://x' })),
    ).toBe(NOTIFICADOR_SILENCIOSO);
  });

  it('monta o notificador de e-mail quando SMTP e destino existem', () => {
    const n = ObservabilidadeModule.escolherNotificador(
      configFalso({ SMTP_URL: 'smtp://x', ALERTA_EMAIL_DESTINO: 'gestao@clinica.test' }),
    );
    expect(n).not.toBe(NOTIFICADOR_SILENCIOSO);
    expect(typeof n.alertar).toBe('function');
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/agendamento/agendamento.module.spec.ts`
Expected: FAIL (a menos que a Task 21 já exponha `escolherNotificador` como estático —
neste caso confirme que passa direto e siga para o Step 5).

- [ ] **Step 4: Confirmar que passa**

Run: `npx vitest run src/agendamento/agendamento.module.spec.ts`
Expected: PASS — 3 testes.

- [ ] **Step 5: Implementar `src/agendamento/agendamento.module.ts`**

```ts
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { PersistenceModule } from '../shared/persistence/persistence.module';
import { ObservabilidadeModule } from '../shared/observabilidade/observabilidade.module';
import { RedisHealthClient } from '../shared/observabilidade/redis-health.client';
import { FilaModule } from './infrastructure/fila/fila.module';
import { REDIS_HEALTH_CLIENT } from './presentation/http/health.controller';

import { MedxTokenProvider } from './infrastructure/medx/medx-token.provider';
import { MedxHttpClient } from './infrastructure/medx/medx-http.client';
import { MedxCatalogoAdapter } from './infrastructure/medx/medx-catalogo.adapter';
import { MedxCadastroPacienteAdapter } from './infrastructure/medx/medx-cadastro-paciente.adapter';
import { MedxAgendaAdapter } from './infrastructure/medx/medx-agenda.adapter';
import { ClintWebhookAdapter } from './infrastructure/clint/clint-webhook.adapter';
import { AdapterProcessor } from './infrastructure/fila/adapter.processor';

import { CATALOGO_CLINICO_PORT, type CatalogoClinicoPort } from './application/ports/catalogo-clinico.port';
import { CADASTRO_PACIENTE_PORT } from './application/ports/cadastro-paciente.port';
import { AGENDA_MEDICA_PORT } from './application/ports/agenda-medica.port';
import { CRM_PORT } from './application/ports/crm.port';

import { AgendarConsultaUseCase } from './application/agendar-consulta/agendar-consulta.usecase';
import { ProcessarRespostaUseCase } from './application/processar-resposta-lembrete/processar-resposta.usecase';

import { WebhooksController } from './presentation/http/webhooks.controller';
import { HealthController } from './presentation/http/health.controller';

@Module({
  imports: [PersistenceModule, ObservabilidadeModule, FilaModule],
  controllers: [WebhooksController, HealthController],
  providers: [
    MedxTokenProvider,
    MedxHttpClient,
    { provide: CATALOGO_CLINICO_PORT, useClass: MedxCatalogoAdapter },
    { provide: CADASTRO_PACIENTE_PORT, useClass: MedxCadastroPacienteAdapter },
    { provide: AGENDA_MEDICA_PORT, useClass: MedxAgendaAdapter },
    { provide: CRM_PORT, useClass: ClintWebhookAdapter },
    AgendarConsultaUseCase,
    ProcessarRespostaUseCase,
    AdapterProcessor,
    { provide: REDIS_HEALTH_CLIENT, useClass: RedisHealthClient },
  ],
})
export class AgendamentoModule implements OnModuleInit {
  constructor(
    @Inject(CATALOGO_CLINICO_PORT) private readonly catalogo: CatalogoClinicoPort,
  ) {}

  async onModuleInit(): Promise<void> {
    // Falha cedo e alto se o rótulo de confirmação não existir nesta conta —
    // deliberadamente sem try/catch. Ver Global Constraints.
    await this.catalogo.carregar();
  }
}
```

- [ ] **Step 6: Substituir `src/app.module.ts`**

```ts
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
```

- [ ] **Step 7: Substituir `src/main.ts`**

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AppModule } from './app.module';
import { parseEnv } from './config/env.schema';
import { NotFoundFilter } from './shared/presentation/not-found.filter';
import { LOGGER_PORT, type LoggerMinimo } from './agendamento/application/ports/logger.port';
import { EVENTO_REPOSITORIO } from './shared/persistence/persistence.module';
import type { EventoRepositorio } from './agendamento/domain/evento/evento.repositorio';
import { registrarPainelFila } from './agendamento/presentation/http/painel-fila';
import { NOME_FILA } from './agendamento/infrastructure/fila/fila.constants';

async function bootstrap(): Promise<void> {
  const env = parseEnv(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const logger = app.get<LoggerMinimo>(LOGGER_PORT);
  app.useGlobalFilters(new NotFoundFilter(logger));

  const fila = app.get<Queue>(getQueueToken(NOME_FILA));
  const painelAtivo = await registrarPainelFila(app, fila, {
    usuario: env.BULLBOARD_USUARIO,
    senha: env.BULLBOARD_SENHA,
  });
  logger.info(
    { painel: painelAtivo },
    painelAtivo
      ? 'Bull Board disponível em /admin/filas'
      : 'Bull Board desativado — defina BULLBOARD_USUARIO e BULLBOARD_SENHA para habilitar',
  );

  const eventos = app.get<EventoRepositorio>(EVENTO_REPOSITORIO);
  const expurgoDiario = setInterval(() => {
    void eventos.expurgar(env.RETENCAO_DIAS).then((removidos) => {
      if (removidos > 0) logger.info({ removidos }, 'expurgo de eventos antigos');
    });
  }, 24 * 60 * 60 * 1000);
  expurgoDiario.unref();

  await app.listen(env.PORT, '0.0.0.0');
  logger.info({ porta: env.PORT }, 'adapter no ar');

  async function encerrar(sinal: string): Promise<void> {
    logger.info({ sinal }, 'encerrando');
    clearInterval(expurgoDiario);
    await app.close();
    process.exit(0);
  }

  process.on('SIGTERM', () => void encerrar('SIGTERM'));
  process.on('SIGINT', () => void encerrar('SIGINT'));
}

void bootstrap();
```

- [ ] **Step 8: Confirmar que o projeto inteiro compila**

Run: `npx tsc --noEmit -p tsconfig.build.json`
Expected: sem erros. Corrija qualquer import que ficou apontando para o caminho antigo
(`fila.port.ts` exporta `FILA_PORT`; `persistence.module.ts` exporta os três tokens de
repositório; `health.controller.ts` exporta `REDIS_HEALTH_CLIENT`).

- [ ] **Step 9: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: PASS em todos os arquivos `*.spec.ts` que não exigem Postgres/Redis reais; os
que exigem (persistência Prisma) continuam passando se houver um Postgres local acessível.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: AgendamentoModule, AppModule e main.ts ligando todas as camadas"
```

---

### Task 26: Docker — `Dockerfile` e `docker-compose.yml`

**Files:**
- Create: `Dockerfile` (substitui o do projeto Fastify)
- Create: `docker-compose.yml` (substitui, adiciona serviço `postgres`)
- Create: `.dockerignore`

**Interfaces:**
- Consumes: nada
- Produces: imagem Docker multi-stage rodando como usuário não-root; compose com
  `postgres`+`redis`+`adapter`.

- [ ] **Step 1: `.dockerignore`**

```
node_modules
dist
.git
.env
*.log
```

- [ ] **Step 2: `Dockerfile`**

```dockerfile
FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS builder
WORKDIR /app
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/main.js"]
```

- [ ] **Step 3: `entrypoint.sh`**

```bash
#!/bin/sh
set -e
npx prisma migrate deploy
exec "$@"
```

```bash
chmod +x entrypoint.sh
```

- [ ] **Step 4: `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: adapter
      POSTGRES_PASSWORD: adapter
      POSTGRES_DB: adapter
    volumes:
      - postgres-dados:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U adapter']
      interval: 10s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --appendfsync everysec
    volumes:
      - redis-dados:/data
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 3s
      retries: 5

  adapter:
    build: .
    env_file: .env
    environment:
      REDIS_URL: redis://redis:6379
      DATABASE_URL: postgresql://adapter:adapter@postgres:5432/adapter
    ports:
      - '3000:3000'
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'node', '-e', "require('http').get('http://localhost:3000/health',r=>process.exit(r.statusCode===200?0:1))"]
      interval: 15s
      timeout: 5s
      retries: 5

volumes:
  postgres-dados:
  redis-dados:
```

- [ ] **Step 5: Tentar `docker compose up -d --build` (verificação manual)**

Run: `docker compose up -d --build && sleep 15 && curl -s localhost:3000/health`
Expected: JSON com `redis`/`banco`/`medx` — `redis` e `banco` devem ficar `true` sempre;
`medx` só fica `true` com um `MEDX_INTEGRATION_TOKEN` real no `.env`. **Se o ambiente não
tiver Docker daemon disponível, documente essa limitação e siga em frente — não bloqueia
esta task** (mesma situação já registrada no projeto Fastify original).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Dockerfile e docker-compose.yml com Postgres, Redis e usuário não-root"
```

---

### Task 27: CI/CD — workflows, templates de issue/PR (adaptados do `api-agendaflow`)

**Files:**
- Create: `.github/workflows/ci.yaml`
- Create: `.github/workflows/cd.yaml`
- Create: `.github/workflows/label-pr.yml`
- Create: `.github/workflows/pr-metadata-check.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`, `bug_report.yml`, `feature_request.yml`, `task.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE/default.md`

**Interfaces:** nenhuma (infraestrutura de repositório, sem código de aplicação).

**Decisão já tomada com você:** sem `project-automation.yml` por enquanto (sem board
definido) — adicione depois se/quando houver um. Secrets necessários (configurar em
Settings → Secrets nesta ordem, valores reais ficam fora do escopo deste plano):
`DATABASE_URL` (para `prisma generate` no CI), `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`,
`GHCR_TOKEN`, `API_DOMAIN`.

- [ ] **Step 1: `.github/workflows/ci.yaml`**

```yaml
name: CI

on:
  push:
    branches: ['develop', 'main']
  pull_request:
    branches: ['develop', 'main']

jobs:
  build:
    runs-on: ubuntu-latest
    name: Validate, Lint, Test, Build (NestJS)

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Fetch PR commits
        if: github.event_name == 'pull_request'
        run: |
          git fetch --no-tags --prune origin "${{ github.event.pull_request.base.ref }}"
          git fetch --no-tags --prune origin "pull/${{ github.event.pull_request.number }}/head:pr"

      - name: Validate Commit Messages
        if: github.event_name == 'pull_request'
        run: npx commitlint --from "${{ github.event.pull_request.base.sha }}" --to pr --verbose

      - name: Generate Prisma Client
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: npm run prisma:generate

      - name: Lint code
        run: npm run lint

      - name: Check code formatting
        run: npx prettier '**/*.{css,scss,yaml,yml,ts,js,jsx,tsx,json,md}' --check

      - name: Run tests
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: npm test

      - name: Build project
        run: npm run build

  release:
    runs-on: ubuntu-latest
    name: Release
    needs: build
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Configure Git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Release
        run: |
          npm run release
          git push --follow-tags origin main
```

**Nota:** diferente do `api-agendaflow`, este workflow RODA os testes (`npm test`) — o
projeto de referência não roda, mas a suíte de 200+ testes deste adapter é o que sustenta a
confiança no código; não faz sentido herdar essa lacuna.

- [ ] **Step 2: `.github/workflows/cd.yaml`**

```yaml
name: CD

on:
  workflow_run:
    workflows: ['CI']
    branches: [main]
    types:
      - completed

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    name: Deploy to VPS

    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}

      - name: Setup Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and Push Docker Image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: |
            ghcr.io/${{ github.repository_owner }}/adapter-clint-medx:latest
            ghcr.io/${{ github.repository_owner }}/adapter-clint-medx:${{ github.event.workflow_run.head_sha }}

      - name: Deploy on VPS
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            set -e

            cd /srv/adapter-clint-medx/

            NEW_TAG="${{ github.event.workflow_run.head_sha }}"
            SERVICE="adapter"
            ENV_FILE=".env.adapter-clint-medx"

            echo "${{ secrets.GHCR_TOKEN }}" | docker login ghcr.io -u "${{ github.actor }}" --password-stdin

            CURRENT_TAG=$(grep '^ADAPTER_CLINT_MEDX_TAG=' "$ENV_FILE" | cut -d '=' -f2)

            echo "Tag atual: $CURRENT_TAG"
            echo "Nova tag: $NEW_TAG"

            cp "$ENV_FILE" "${ENV_FILE}.bak"

            sed -i "s/^ADAPTER_CLINT_MEDX_TAG=.*/ADAPTER_CLINT_MEDX_TAG=$NEW_TAG/" "$ENV_FILE"

            set -a; source "$ENV_FILE"; set +a

            docker compose pull "$SERVICE"
            docker compose up -d --force-recreate "$SERVICE"

            echo "Aguardando aplicação subir..."
            sleep 10

            HEALTHY=false
            for i in $(seq 1 12); do
              if curl -fk -s -o /dev/null "https://${{ secrets.API_DOMAIN }}/health"; then
                HEALTHY=true
                break
              fi
              echo "Healthcheck tentativa $i/12 falhou, aguardando 5s..."
              sleep 5
            done

            if [ "$HEALTHY" = "true" ]; then
              echo "Deploy validado com sucesso."
              rm -f "${ENV_FILE}.bak"
            else
              echo "Falha no healthcheck após 12 tentativas. Iniciando rollback..."
              mv "${ENV_FILE}.bak" "$ENV_FILE"
              set -a; source "$ENV_FILE"; set +a
              docker compose pull "$SERVICE"
              docker compose up -d --force-recreate "$SERVICE"
              exit 1
            fi
```

- [ ] **Step 3: `.github/workflows/label-pr.yml`**

```yaml
name: Auto-label PR

on:
  pull_request:
    types: [opened, edited]

permissions:
  pull-requests: write

jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - name: Aplicar label de tipo baseado no título
        env:
          GH_TOKEN: ${{ github.token }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          REPO: ${{ github.repository }}
        run: |
          PREFIX=$(echo "$PR_TITLE" | grep -oE '^[a-z]+' || echo "")

          case "$PREFIX" in
            feat)     LABEL="type: feat" ;;
            fix)      LABEL="type: fix" ;;
            chore)    LABEL="type: chore" ;;
            refactor) LABEL="type: refactor" ;;
            docs)     LABEL="type: docs" ;;
            test)     LABEL="type: test" ;;
            ci)       LABEL="type: ci" ;;
            perf)     LABEL="type: perf" ;;
            *)        LABEL="" ;;
          esac

          if [ -n "$LABEL" ]; then
            gh pr edit "$PR_NUMBER" --repo "$REPO" --add-label "$LABEL"
            echo "✅ Label aplicado: $LABEL"
          else
            echo "::warning::Título do PR não segue conventional commits. Formato esperado: feat|fix|chore|refactor|docs|test|ci|perf[(...)]:"
          fi
```

- [ ] **Step 4: `.github/workflows/pr-metadata-check.yml`**

```yaml
name: PR Metadata Check

on:
  pull_request:
    types:
      [opened, edited, synchronize, ready_for_review, labeled, unlabeled, assigned, unassigned, milestoned, demilestoned]

permissions:
  pull-requests: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Verificar metadados obrigatórios
        env:
          ASSIGNEES: ${{ toJson(github.event.pull_request.assignees) }}
          MILESTONE: ${{ toJson(github.event.pull_request.milestone) }}
          LABELS: ${{ toJson(github.event.pull_request.labels) }}
        run: |
          ERRORS=0

          ASSIGNEE_COUNT=$(echo "$ASSIGNEES" | jq 'length')
          if [ "$ASSIGNEE_COUNT" -eq 0 ]; then
            echo "::error::PR deve ter pelo menos um responsável (assignee)"
            ERRORS=$((ERRORS+1))
          fi

          IS_NULL=$(echo "$MILESTONE" | jq '. == null')
          if [ "$IS_NULL" = "true" ]; then
            echo "::error::PR deve ter uma milestone definida"
            ERRORS=$((ERRORS+1))
          fi

          LABEL_COUNT=$(echo "$LABELS" | jq 'length')
          if [ "$LABEL_COUNT" -eq 0 ]; then
            echo "::error::PR deve ter pelo menos um label (type:, priority: ou area:)"
            ERRORS=$((ERRORS+1))
          fi

          if [ "$ERRORS" -gt 0 ]; then
            echo ""
            echo "❌ $ERRORS metadado(s) obrigatório(s) faltando. Corrija antes de fazer merge."
            exit 1
          fi

          echo "✅ Todos os metadados obrigatórios presentes."
```

- [ ] **Step 5: Templates de issue e PR** (opções de `area:` adaptadas ao domínio deste
  projeto)

`.github/ISSUE_TEMPLATE/config.yml`:
```yaml
blank_issues_enabled: false
```

`.github/ISSUE_TEMPLATE/bug_report.yml`:
```yaml
name: 🐛 Bug Report
description: Reportar um comportamento incorreto ou inesperado
labels: ['type: fix', 'status: ready']
body:
  - type: markdown
    attributes:
      value: |
        Obrigado por reportar! Preencha todas as seções para facilitar a reprodução.

  - type: textarea
    id: description
    attributes:
      label: Descrição do bug
      description: Descreva de forma clara o que está acontecendo.
    validations:
      required: true

  - type: textarea
    id: steps
    attributes:
      label: Passos para reproduzir
      placeholder: |
        1. Chamar `POST /webhooks/clint/...`
        2. Com o payload `{ ... }`
        3. Observar erro `...`
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: Comportamento esperado
    validations:
      required: true

  - type: textarea
    id: actual
    attributes:
      label: Comportamento atual
    validations:
      required: true

  - type: textarea
    id: context
    attributes:
      label: Contexto adicional
      description: Logs, stack traces, screenshots ou qualquer informação relevante.

  - type: dropdown
    id: priority
    attributes:
      label: Prioridade
      options:
        - 'priority: critical'
        - 'priority: high'
        - 'priority: medium'
        - 'priority: low'
    validations:
      required: true

  - type: dropdown
    id: area
    attributes:
      label: Área afetada
      options:
        - 'area: medx'
        - 'area: clint'
        - 'area: fila'
        - 'area: agendamento'
        - 'area: infra'
        - 'area: security'
    validations:
      required: true
```

`.github/ISSUE_TEMPLATE/feature_request.yml`:
```yaml
name: ✨ Feature Request
description: Sugerir uma nova funcionalidade ou melhoria
labels: ['type: feat', 'status: needs-info']
body:
  - type: markdown
    attributes:
      value: |
        Descreva a funcionalidade que gostaria de ver implementada.

  - type: textarea
    id: problem
    attributes:
      label: Problema ou necessidade
      description: Qual problema esta funcionalidade resolve?
    validations:
      required: true

  - type: textarea
    id: solution
    attributes:
      label: Solução proposta
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Alternativas consideradas

  - type: textarea
    id: context
    attributes:
      label: Contexto adicional

  - type: dropdown
    id: priority
    attributes:
      label: Prioridade sugerida
      options:
        - 'priority: high'
        - 'priority: medium'
        - 'priority: low'
    validations:
      required: true

  - type: dropdown
    id: area
    attributes:
      label: Área relacionada
      options:
        - 'area: medx'
        - 'area: clint'
        - 'area: fila'
        - 'area: agendamento'
        - 'area: infra'
        - 'area: security'
    validations:
      required: true
```

`.github/ISSUE_TEMPLATE/task.yml`:
```yaml
name: 📦 Task / Chore
description: Tarefa técnica, refatoração, manutenção ou melhoria de CI/CD
labels: ['type: chore', 'status: ready']
body:
  - type: markdown
    attributes:
      value: |
        Use este template para tarefas técnicas que não são bugs nem features.

  - type: textarea
    id: description
    attributes:
      label: Descrição da tarefa
    validations:
      required: true

  - type: textarea
    id: acceptance
    attributes:
      label: Critérios de aceitação
      placeholder: |
        - [ ] O build passa sem warnings
        - [ ] Testes cobrem os casos X e Y
        - [ ] Documentação atualizada
    validations:
      required: true

  - type: textarea
    id: context
    attributes:
      label: Contexto técnico

  - type: dropdown
    id: type
    attributes:
      label: Tipo
      options:
        - 'type: chore'
        - 'type: refactor'
        - 'type: docs'
        - 'type: test'
        - 'type: ci'
        - 'type: perf'
    validations:
      required: true

  - type: dropdown
    id: priority
    attributes:
      label: Prioridade
      options:
        - 'priority: high'
        - 'priority: medium'
        - 'priority: low'
    validations:
      required: true
```

`.github/PULL_REQUEST_TEMPLATE/default.md`:
```markdown
## 📝 O que este PR faz?

## 🔗 Tarefa/Ticket Relacionado

## 🏷️ Tipo de Mudança

- [ ] ✨ Nova funcionalidade
- [ ] 🐛 Correção de bug
- [ ] ⚡ Melhoria de desempenho
- [ ] ♻️ Refatoração de código
- [ ] 📦 Outro (descreva abaixo)

## 🎯 Pontos para Revisão

## 🧪 Como isso foi testado?

## ✅ Checklist de Verificação

- [ ] 🎨 Meu código segue as diretrizes de estilo do projeto.
- [ ] 🧐 Fiz uma auto-revisão do meu próprio código.
- [ ] 🛡️ Fiz as alterações para cobrir todos os casos de borda.
- [ ] 🟢 As novas e existentes unidades de teste passam com sucesso.
```

- [ ] **Step 6: Criar as labels no repositório GitHub (verificação manual, fora do
  código)**

Os workflows assumem que as labels `type: feat`, `type: fix`, `type: chore`, `type:
refactor`, `type: docs`, `type: test`, `type: ci`, `type: perf`, `priority: critical`,
`priority: high`, `priority: medium`, `priority: low`, `area: medx`, `area: clint`,
`area: fila`, `area: agendamento`, `area: infra`, `area: security`, `status: ready`,
`status: needs-info` já existem no repositório — crie-as manualmente em Settings → Labels
antes de abrir o primeiro PR/issue com os templates (fora do escopo de código deste plano).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "ci: workflows de CI/CD e templates de issue/PR adaptados do api-agendaflow"
```

---

### Task 28: Suíte e2e — `test/webhooks.e2e-spec.ts`

**Files:**
- Create: `test/webhooks.e2e-spec.ts`
- Create: `vitest.e2e.config.ts`

**Interfaces:**
- Consumes: `AppModule` (Task 25), `Test.createTestingModule` (`@nestjs/testing`),
  `supertest`

**Filosofia de mock desta suíte:** só os sistemas genuinamente externos (MedX, Clint) são
substituídos por dublês via `overrideProvider`. `EventoRepositorio` (Prisma/Postgres) e a
fila (`@nestjs/bullmq`/Redis) continuam **reais** — exige Postgres e Redis acessíveis
(mesma suposição já feita nas Tasks 8-11 e 20). Isso testa a integração real da nossa
própria infraestrutura, mockando só o que não é nosso.

Dois apps de teste: um com tudo real exceto MedX/Clint (para os casos de autenticação,
validação e caminho feliz), e outro adicional só para o caso "fila indisponível" — como o
`FILA_PORT` real usa BullMQ contra Redis de verdade, simular indisponibilidade exige um
segundo `TestingModule` com esse port também substituído.

- [ ] **Step 1: `vitest.e2e.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
```

- [ ] **Step 2: Escrever o teste que falha**

`test/webhooks.e2e-spec.ts`:
```ts
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

process.env.ADAPTER_SECRET = 'segredo-de-teste';
process.env.MEDX_INTEGRATION_TOKEN = 'token-fake';
process.env.CLINT_WEBHOOK_AGENDAMENTO_URL = 'https://clint.test/a';
process.env.CLINT_WEBHOOK_NOTIFICACAO_URL = 'https://clint.test/n';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/adapter';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';

import { AppModule } from '../src/app.module';
import { CATALOGO_CLINICO_PORT } from '../src/agendamento/application/ports/catalogo-clinico.port';
import { AGENDA_MEDICA_PORT } from '../src/agendamento/application/ports/agenda-medica.port';
import { CADASTRO_PACIENTE_PORT } from '../src/agendamento/application/ports/cadastro-paciente.port';
import { CRM_PORT } from '../src/agendamento/application/ports/crm.port';
import { FILA_PORT } from '../src/agendamento/application/ports/fila.port';
import { LOGGER_PORT } from '../src/agendamento/application/ports/logger.port';
import { NotFoundFilter } from '../src/shared/presentation/not-found.filter';

const SEGREDO = 'segredo-de-teste';

const catalogoFalso = {
  carregar: vi.fn(async () => {}),
  resolverProfissional: vi.fn(async () => 43013640),
  resolverTipoConsulta: vi.fn(async () => ({ id: 111, nome: 'Consulta', duracaoMinutos: 30 })),
  indiceStatusConfirmado: () => 1,
};
const agendaFalsa = {
  criar: vi.fn(async () => 1275002478),
  obter: vi.fn(async () => ({
    id: 1275002478,
    idProfissional: 43013640,
    idPaciente: 67890,
    inicio: '',
    fim: '',
    descricao: '',
    status: 0,
    idTipoConsulta: 111,
    confirmacao: '',
    ultimaEdicao: '',
    bruto: {},
  })),
  listarPorPaciente: vi.fn(async () => []),
  confirmar: vi.fn(async () => {}),
};
const cadastroFalso = {
  vincular: vi.fn(async () => ({ idPaciente: 67890, matchConfiavel: true })),
  registrarCpf: vi.fn(async () => {}),
};
const crmFalso = {
  gravarIdAgendamento: vi.fn(async () => {}),
  notificarConfirmacao: vi.fn(async () => {}),
  notificarReagendamento: vi.fn(async () => {}),
  notificarCancelamento: vi.fn(async () => {}),
  notificarConflito: vi.fn(async () => {}),
};

const AGENDAMENTO = {
  deal_id: '8feade82-d77b-4e8b-9d35-fd43e972b5c8',
  nome: 'Maria Silva',
  telefone: '+5511999998888',
  data_nascimento: '1990-05-20',
  data_hora: '2026-07-10T14:00:00-03:00',
  profissional: 'Leize Ferreira',
  tipo_consulta: 'Consulta de Rotina',
};

const RESPOSTA = {
  deal_id: AGENDAMENTO.deal_id,
  id_agendamento_medx: 1275002478,
  resposta: 'confirmar',
};

async function construirApp(overrideFila = false): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CATALOGO_CLINICO_PORT)
    .useValue(catalogoFalso)
    .overrideProvider(AGENDA_MEDICA_PORT)
    .useValue(agendaFalsa)
    .overrideProvider(CADASTRO_PACIENTE_PORT)
    .useValue(cadastroFalso)
    .overrideProvider(CRM_PORT)
    .useValue(crmFalso);

  if (overrideFila) {
    builder.overrideProvider(FILA_PORT).useValue({
      add: vi.fn(async () => {
        throw new Error('Redis indisponível');
      }),
    });
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new NotFoundFilter(app.get(LOGGER_PORT)));
  await app.init();
  return app;
}

describe('webhooks (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await construirApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('autenticação', () => {
    it('recusa sem o segredo, mas ainda responde 200', async () => {
      const r = await request(app.getHttpServer())
        .post('/webhooks/clint/agendamento')
        .send(AGENDAMENTO);
      expect(r.status).toBe(200);
    });

    it('recusa com segredo errado', async () => {
      const r = await request(app.getHttpServer())
        .post('/webhooks/clint/agendamento')
        .set('x-adapter-secret', 'errado')
        .send(AGENDAMENTO);
      expect(r.status).toBe(200);
    });
  });

  describe('POST /webhooks/clint/agendamento', () => {
    it('aceita o payload válido e responde 200', async () => {
      const r = await request(app.getHttpServer())
        .post('/webhooks/clint/agendamento')
        .set('x-adapter-secret', SEGREDO)
        .send({ ...AGENDAMENTO, deal_id: '11111111-1111-1111-1111-111111111111' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });
    });

    it('responde 200 e não enfileira quando falta campo obrigatório', async () => {
      const { telefone, ...semTelefone } = AGENDAMENTO;
      const r = await request(app.getHttpServer())
        .post('/webhooks/clint/agendamento')
        .set('x-adapter-secret', SEGREDO)
        .send({ ...semTelefone, deal_id: '22222222-2222-2222-2222-222222222222' });
      expect(r.status).toBe(200);
    });

    it('responde 200 e não enfileira quando deal_id não é uuid', async () => {
      const r = await request(app.getHttpServer())
        .post('/webhooks/clint/agendamento')
        .set('x-adapter-secret', SEGREDO)
        .send({ ...AGENDAMENTO, deal_id: 'nao-e-um-uuid' });
      expect(r.status).toBe(200);
    });

    it('responde 200 para JSON malformado', async () => {
      const r = await request(app.getHttpServer())
        .post('/webhooks/clint/agendamento')
        .set('x-adapter-secret', SEGREDO)
        .set('content-type', 'application/json')
        .send('{isso não é json');
      expect(r.status).toBe(200);
    });
  });

  describe('POST /webhooks/clint/resposta-lembrete', () => {
    it.each(['confirmar', 'reagendar', 'cancelar'])('aceita a resposta %s', async (resposta) => {
      const r = await request(app.getHttpServer())
        .post('/webhooks/clint/resposta-lembrete')
        .set('x-adapter-secret', SEGREDO)
        .send({ ...RESPOSTA, deal_id: `33333333-3333-3333-3333-33333333333${resposta.length}`, resposta });
      expect(r.status).toBe(200);
    });

    it('responde 200 para resposta fora do enum', async () => {
      const r = await request(app.getHttpServer())
        .post('/webhooks/clint/resposta-lembrete')
        .set('x-adapter-secret', SEGREDO)
        .send({ ...RESPOSTA, deal_id: '44444444-4444-4444-4444-444444444444', resposta: 'talvez' });
      expect(r.status).toBe(200);
    });
  });

  describe('rota inexistente e método errado (NotFoundFilter)', () => {
    it('responde 200 para rota inexistente sob /webhooks', async () => {
      const r = await request(app.getHttpServer()).post('/webhooks/clint/nao-existe').send({});
      expect(r.status).toBe(200);
    });

    it('responde 200 para método errado numa rota de webhook existente', async () => {
      const r = await request(app.getHttpServer()).get('/webhooks/clint/agendamento');
      expect(r.status).toBe(200);
    });

    it('continua respondendo 404 de verdade fora de /webhooks', async () => {
      const r = await request(app.getHttpServer()).get('/rota-que-nao-existe');
      expect(r.status).toBe(404);
    });
  });
});

describe('webhooks (e2e) — fila indisponível', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await construirApp(true);
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 mesmo quando a fila está fora do ar', async () => {
    const r = await request(app.getHttpServer())
      .post('/webhooks/clint/agendamento')
      .set('x-adapter-secret', SEGREDO)
      .send({ ...AGENDAMENTO, deal_id: '55555555-5555-5555-5555-555555555555' });
    expect(r.status).toBe(200);
  });
});
```

- [ ] **Step 3: Adicionar o script de e2e (se ainda não existir da Task 1)**

Run: `npm pkg get scripts.test:e2e` — se vazio:
```bash
npm pkg set scripts.test:e2e="vitest run --config vitest.e2e.config.ts --passWithNoTests"
```

- [ ] **Step 4: Rodar a suíte e2e e confirmar que passa**

Run: `npm run test:e2e`
Expected: PASS — 14 testes (exige Postgres e Redis acessíveis via `DATABASE_URL`/
`REDIS_URL`; se não estiverem, o teste falha na conexão do Prisma/BullMQ, não na lógica —
suba `docker compose up -d postgres redis` antes de rodar, se necessário).

Se o teste "responde 200 para JSON malformado" falhar com um status diferente de 200:
investigue se o `WebhookAlwaysOkFilter` está realmente capturando a exceção de parsing do
Express antes dela vazar como 400 — pode ser necessário registrar um parser JSON
customizado com tratamento de erro em `main.ts` (`app.use(express.json({ ... }))` com um
`try/catch` no `verify`, ou um middleware de erro dedicado antes do roteamento). Documente
a solução encontrada no relatório desta task.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: suíte e2e cobrindo a garantia sempre-200 dos webhooks"
```

---

### Task 29: Script de descoberta adaptado e `.env.example` completo

**Files:**
- Create: `scripts/descoberta.ts` (adaptado das classes NestJS)
- Create: `.env.example` (substitui o mínimo da Task 8)

**Interfaces:**
- Consumes: `parseEnv` (Task 1), `MedxTokenProvider` (Task 12), `MedxHttpClient` (Task 13)
- Produces: saída em console e `docs/descoberta-medx.json`

Mesma finalidade do script original: responder as cinco perguntas de descoberta contra a
conta real do MedX antes de configurar o Clint. Adaptado para instanciar as classes
diretamente (sem o container de DI do Nest, já que é um script standalone via `tsx`) e com
o fix de igualdade exata (não `startsWith`) já aplicado.

- [ ] **Step 1: Implementar `scripts/descoberta.ts`**

```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import type { ConfigService } from '@nestjs/config';
import { parseEnv } from '../src/config/env.schema';
import { MedxTokenProvider } from '../src/agendamento/infrastructure/medx/medx-token.provider';
import { MedxHttpClient } from '../src/agendamento/infrastructure/medx/medx-http.client';

const env = parseEnv(process.env);
const config = {
  get: (chave: string) => (env as unknown as Record<string, unknown>)[chave],
} as ConfigService;

const tokens = new MedxTokenProvider(config);
const client = new MedxHttpClient(config, tokens);

async function tentar<T>(rotulo: string, fn: () => Promise<T>): Promise<T | { erro: string }> {
  try {
    const r = await fn();
    console.log(`\n=== ${rotulo} ===`);
    console.log(JSON.stringify(r, null, 2));
    return r;
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error(`\n=== ${rotulo} — FALHOU ===\n${erro}`);
    return { erro };
  }
}

async function main(): Promise<void> {
  const resultado = {
    status: await tentar('1. GET /agenda/status', () =>
      client.get<string[]>('/api/integration/agenda/status'),
    ),
    profissionais: await tentar('2. GET /financas/profissionais', () =>
      client.get<unknown[]>('/api/integration/financas/profissionais'),
    ),
    tipos: await tentar('3. GET /agenda/tipos', () =>
      client.get<unknown[]>('/api/integration/agenda/tipos'),
    ),
    setores: await tentar('4. GET /agenda/setores', () =>
      client.get<unknown[]>('/api/integration/agenda/setores'),
    ),
  };

  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/descoberta-medx.json', JSON.stringify(resultado, null, 2));

  const rotulos = Array.isArray(resultado.status) ? (resultado.status as string[]) : [];
  // Igualdade exata pós-normalização — NUNCA startsWith (ver fix da Task 14).
  const indice = rotulos.findIndex(
    (r) =>
      typeof r === 'string' &&
      r.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '') === 'confirmado',
  );

  console.log('\n\n=== CHECKLIST ===');
  console.log(`Rótulos de status: ${JSON.stringify(rotulos)}`);
  console.log(
    `Índice de "Confirmado": ${indice >= 0 ? indice : 'NÃO ENCONTRADO — PARE E CONSULTE A CLÍNICA'}`,
  );
  console.log('\nFalta fazer manualmente:');
  console.log('  5. POST /contatos/vinculo com um paciente conhecido — conferir se Id volta numérico');
  console.log('  6. Criar agendamento de teste e ler GET /agenda/agendamentos/{id}');
  console.log('     — conferir o formato de Inicio/Final e inspecionar os campos SMS e Confirmacao');
  console.log('\nResultado salvo em docs/descoberta-medx.json');
}

void main();
```

- [ ] **Step 2: Adicionar o script ao `package.json`**

```bash
npm pkg set scripts.descoberta="tsx scripts/descoberta.ts"
```

- [ ] **Step 3: Confirmar que compila**

Run: `npx tsc --noEmit -p tsconfig.build.json` (o script fica fora do build de produção,
mas precisa tipar corretamente contra o código-fonte).

- [ ] **Step 4: `.env.example` completo**

```
# ======================================================
# AMBIENTE
# ======================================================
NODE_ENV=development
PORT=3000

# ======================================================
# BANCO DE DADOS (PostgreSQL via Prisma)
# ======================================================
DATABASE_URL="postgresql://user:password@localhost:5432/adapter"

# ======================================================
# REDIS (fila BullMQ)
# ======================================================
REDIS_URL=redis://127.0.0.1:6379

# ======================================================
# SEGURANÇA DO WEBHOOK
# ======================================================
# Segredo compartilhado exigido no header X-Adapter-Secret de todo webhook do
# Clint. Gere um valor longo e aleatório — é a única barreira de autenticação,
# já que o Clint não assina o payload por HMAC.
ADAPTER_SECRET=troque-por-um-segredo-longo-e-aleatorio

# ======================================================
# MEDX (agenda médica)
# ======================================================
MEDX_HOST=https://integracao-app.medx.med.br
MEDX_INTEGRATION_TOKEN=

# ======================================================
# CLINT (CRM — webhooks de entrada que recebem o retorno do adapter)
# ======================================================
CLINT_WEBHOOK_AGENDAMENTO_URL=
CLINT_WEBHOOK_NOTIFICACAO_URL=

# ======================================================
# RETENÇÃO E LOG
# ======================================================
# Dias de retenção do payload bruto dos eventos recebidos (LGPD).
RETENCAO_DIAS=90
LOG_LEVEL=info

# ======================================================
# ALERTAS POR E-MAIL (opcional — sem isso, alertas ficam só no log)
# ======================================================
SMTP_URL=
ALERTA_EMAIL_DESTINO=
ALERTA_EMAIL_ORIGEM=adapter@localhost

# ======================================================
# PAINEL DA FILA (Bull Board — opcional, sem credenciais a rota não existe)
# ======================================================
BULLBOARD_USUARIO=
BULLBOARD_SENHA=
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: script de descoberta adaptado ao NestJS e .env.example completo"
```

---

### Task 30: `README.md`

**Files:**
- Create: `README.md` (substitui o do projeto Fastify)

**Interfaces:** nenhuma — documentação.

- [ ] **Step 1: Escrever `README.md`**

```markdown
# Adapter Clint ↔ MedX

Traduz webhooks do Clint em chamadas à API REST do MedX: cria agendamentos e processa
as confirmações que os pacientes respondem pelo WhatsApp.

Migrado de Fastify+SQLite para **NestJS + Prisma/PostgreSQL + `@nestjs/bullmq`**, seguindo
o padrão de stack da empresa (ver `docs/superpowers/specs/2026-09-15-migracao-nestjs-design.md`).

## Arquitetura

Camadas DDD dentro de `src/agendamento/`, expressas como módulos e providers do Nest.

| Camada | Papel |
|---|---|
| `domain/` | Regras e entidades. Framework-agnóstico, zero import de Nest |
| `application/` | Casos de uso (`@Injectable()`) sobre ports. Não conhece MedX nem Clint |
| `infrastructure/` | Adapters concretos: MedX, Clint, Prisma, `@nestjs/bullmq` |
| `presentation/` | Controllers HTTP e painel da fila |
| `agendamento.module.ts` | Liga as implementações concretas aos ports via `Symbol()` tokens |

## Subir localmente

1. `cp .env.example .env` e preencher `MEDX_INTEGRATION_TOKEN`, `ADAPTER_SECRET` e as
   duas URLs de webhook de entrada do Clint.
2. `docker compose up -d --build`
3. Conferir `curl localhost:3000/health`

## Desenvolvimento

```bash
npm ci
npx prisma generate
npx prisma migrate dev
npm run start:dev
```

Requer Postgres e Redis acessíveis (`docker compose up -d postgres redis` sobe só a infra).

## Testes

```bash
npm test          # unitários (Vitest) — application/domain não exigem infra externa
npm run test:e2e  # e2e (Vitest + supertest) — exige Postgres e Redis acessíveis
```

## Descoberta

Antes de configurar o Clint, rodar `npm run descoberta` para levantar os IDs de
profissionais, tipos de consulta e o índice real de status da conta. O adapter **não sobe**
se não encontrar um rótulo de status correspondente a "Confirmado" (falha explícita no
`onModuleInit` do `AgendamentoModule`).

## Configuração no Clint

- Campo customizado `id_agendamento_medx` no negócio.
- Webhook de saída com gatilho "mudar de etapa" → `POST /webhooks/clint/agendamento`, com
  o header `X-Adapter-Secret`.
- Webhook de saída da resposta do lembrete → `POST /webhooks/clint/resposta-lembrete`.
- Integrações de entrada recebendo o retorno do adapter.

## Regra inegociável

Os endpoints de webhook **sempre** respondem 200. O Clint desativa a integração após três
falhas consecutivas, e silenciosamente. Erros são sinalizados por log, alerta e pela fila —
nunca por status HTTP. Ver `WebhookAlwaysOkFilter` e `NotFoundFilter`.

## Alertas

Com `SMTP_URL` e `ALERTA_EMAIL_DESTINO` definidos, o adapter manda e-mail quando um job
esgota as tentativas, quando o vínculo de paciente sai com match duvidoso e quando uma
confirmação é recusada. Sem essas variáveis, os mesmos eventos ficam só no log.

## Painel da fila

Com `BULLBOARD_USUARIO` e `BULLBOARD_SENHA` definidos, o Bull Board fica em
`/admin/filas` protegido por basic auth. Sem as credenciais a rota não é registrada.

## Backup

O estado durável é o PostgreSQL (volume `postgres-dados`). Backup via `pg_dump`/snapshot
do volume; o Redis guarda apenas jobs em trânsito.

## Pendências conhecidas (follow-up antes do go-live)

- **Índice do status "Agendado" é assumido como `0`**, não descoberto em runtime (só
  "Confirmado" é). Numa conta MedX cuja lista de status não comece com "Agendado", isso é
  um risco real — ver ruling registrada durante a implementação original. Rode
  `npm run descoberta` e confira manualmente antes de configurar uma conta nova.
- CI/CD assume que as labels do GitHub (`type:`, `priority:`, `area:`) já existem no
  repositório — crie-as antes do primeiro PR.
```

- [ ] **Step 2: Rodar a suíte inteira uma última vez**

Run: `npm test && npm run test:e2e && npx tsc --noEmit -p tsconfig.build.json && npm run build`
Expected: tudo verde, build sem erro de tipo.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: README da versão NestJS do adapter"
```

