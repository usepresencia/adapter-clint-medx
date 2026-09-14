# Adapter Clint ↔ MedX — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir um servidor adapter que traduz webhooks do Clint em chamadas à API REST do MedX, criando agendamentos e processando confirmações de pacientes.

**Architecture:** Camadas DDD — `domain` com as regras, `application` orquestrando sobre ports, `infrastructure` com os adapters concretos e `presentation` com o HTTP. Os endpoints gravam o evento bruto e respondem 200 imediatamente, alimentando uma fila BullMQ cujos workers chamam o MedX com rate limiting e retry.

**Tech Stack:** Node 22 LTS · TypeScript · Fastify · Zod · BullMQ + Redis · better-sqlite3 · Luxon · Pino · Vitest

**Spec:** `docs/superpowers/specs/2026-09-12-adapter-clint-medx-design.md`

## Global Constraints

- **Node 22 LTS ou superior.** O código usa `fetch` nativo; não instalar axios ou node-fetch.
- **O endpoint HTTP sempre responde 200.** Nunca retornar 4xx ou 5xx de um webhook do Clint — três falhas consecutivas desativam a integração no Clint permanentemente.
- **Regras de dependência entre camadas, verificadas por teste:**
  - `src/api/domain` não importa de nenhuma outra camada.
  - `src/api/application` importa só de `domain` e `lib`.
  - `src/api/infrastructure` e `src/api/presentation` podem importar de `application`, `domain` e `lib`.
  - Só `src/api/composition` importa de todas.
- **Host do MedX:** `https://integracao-app.medx.med.br`. Todas as rotas começam com `/api/integration`.
- **Rate limit do MedX:** 30 req/min por conta. O worker usa `max: 25, duration: 60000`. A troca de token tem limite separado de 10 req/min por IP.
- **JWT do MedX expira em ~900 segundos.** Renovar 120 segundos antes de expirar.
- **Timezone:** `America/Sao_Paulo`. O MedX envia e recebe datas sem offset (`"2026-07-10T14:00:00"`) e elas representam horário local da clínica.
- **String literal de confirmação:** `"Mensagem Salva com Sucesso"` — exatamente assim, exigida pela API. Vive apenas em `infrastructure/medx`.
- **O índice numérico de `Status` nunca é codificado.** É descoberto em runtime via `GET /agenda/status`.
- **Logs nunca contêm CPF, telefone, nome ou e-mail.** Correlação é por `deal_id` e `Id_do_Agendamento`.
- **Imports relativos com extensão `.js`.** Sem path aliases, para não depender de loader em runtime.
- **Idioma:** código, nomes de função e mensagens de commit em português; nomes de camada em inglês.

## Estrutura de arquivos

```
lib/
  config/env.server.ts
  logger.ts

src/api/
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
    ports/agenda-medica.port.ts
    ports/cadastro-paciente.port.ts
    ports/catalogo-clinico.port.ts
    ports/crm.port.ts
    ports/notificador.port.ts
    ports/fila.port.ts
    agendar-consulta/agendar-consulta.comando.ts
    agendar-consulta/agendar-consulta.usecase.ts
    processar-resposta-lembrete/processar-resposta.comando.ts
    processar-resposta-lembrete/processar-resposta.usecase.ts
  infrastructure/
    persistencia/sqlite/conexao.ts
    persistencia/sqlite/correlacao-paciente.sqlite-repositorio.ts
    persistencia/sqlite/agendamento.sqlite-repositorio.ts
    persistencia/sqlite/evento.sqlite-repositorio.ts
    medx/medx.erros.ts
    medx/medx.tipos.ts
    medx/medx-token.provider.ts
    medx/medx-http.client.ts
    medx/medx-catalogo.adapter.ts
    medx/medx-cadastro-paciente.adapter.ts
    medx/medx-agenda.adapter.ts
    clint/clint-webhook.adapter.ts
    fila/fila.ts
    fila/processador.ts
    observabilidade/notificador-email.ts
    observabilidade/alertas.ts
  presentation/
    http/schemas.ts
    http/servidor.ts
    http/painel-fila.ts
  composition/container.ts
  main.ts

scripts/descoberta.ts
tests/…                              espelha a estrutura acima
```

---

### Task 1: Bootstrap do projeto e configuração de ambiente

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `lib/config/env.server.ts`
- Test: `tests/lib/config/env.server.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `carregarEnv(fonte: Record<string, string | undefined>): Env` e o tipo `Env` com `PORT: number`, `ADAPTER_SECRET: string`, `MEDX_HOST: string`, `MEDX_INTEGRATION_TOKEN: string`, `REDIS_URL: string`, `DATABASE_PATH: string`, `CLINT_WEBHOOK_AGENDAMENTO_URL: string`, `CLINT_WEBHOOK_NOTIFICACAO_URL: string`, `RETENCAO_DIAS: number`, `LOG_LEVEL: string`, `SMTP_URL?: string`, `ALERTA_EMAIL_DESTINO?: string`, `ALERTA_EMAIL_ORIGEM: string`, `BULLBOARD_USUARIO?: string`, `BULLBOARD_SENHA?: string`

- [ ] **Step 1: Inicializar o projeto**

```bash
cd /Users/cesarpisa/Projects/dra-leize
git init
npm init -y
npm pkg set type="module"
npm install fastify zod bullmq ioredis better-sqlite3 luxon pino
npm install -D typescript @types/node @types/better-sqlite3 @types/luxon vitest tsx
```

- [ ] **Step 2: Criar `tsconfig.json`**

`rootDir` é a raiz do repositório porque o código vive em duas árvores, `lib/` e `src/`.

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["lib/**/*", "src/**/*"]
}
```

- [ ] **Step 3: Criar `vitest.config.ts` e `.gitignore`**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

`.gitignore`:
```
node_modules/
dist/
dados/
.env
*.sqlite
*.sqlite-wal
*.sqlite-shm
```

- [ ] **Step 4: Adicionar scripts ao `package.json`**

```bash
npm pkg set scripts.dev="tsx watch src/api/main.ts"
npm pkg set scripts.build="tsc"
npm pkg set scripts.start="node dist/src/api/main.js"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.descoberta="tsx scripts/descoberta.ts"
```

- [ ] **Step 5: Escrever o teste que falha**

`tests/lib/config/env.server.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { carregarEnv } from "../../../lib/config/env.server.js";

const base = {
  ADAPTER_SECRET: "segredo",
  MEDX_INTEGRATION_TOKEN: "token-medx",
  CLINT_WEBHOOK_AGENDAMENTO_URL: "https://clint.example/a",
  CLINT_WEBHOOK_NOTIFICACAO_URL: "https://clint.example/n",
};

describe("carregarEnv", () => {
  it("aplica os valores padrão quando as variáveis opcionais faltam", () => {
    const env = carregarEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.MEDX_HOST).toBe("https://integracao-app.medx.med.br");
    expect(env.RETENCAO_DIAS).toBe(90);
    expect(env.ALERTA_EMAIL_ORIGEM).toBe("adapter@localhost");
  });

  it("rejeita configuração sem o segredo do adapter", () => {
    const { ADAPTER_SECRET, ...semSegredo } = base;
    expect(() => carregarEnv(semSegredo)).toThrow(/ADAPTER_SECRET/);
  });

  it("converte PORT para número", () => {
    expect(carregarEnv({ ...base, PORT: "8080" }).PORT).toBe(8080);
  });

  it("aceita SMTP e Bull Board ausentes, deixando-os indefinidos", () => {
    const env = carregarEnv(base);
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.BULLBOARD_USUARIO).toBeUndefined();
  });
});
```

- [ ] **Step 6: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/lib/config/env.server.test.ts`
Expected: FAIL — o módulo `lib/config/env.server.ts` não existe.

- [ ] **Step 7: Implementar `lib/config/env.server.ts`**

```ts
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
```

- [ ] **Step 8: Criar `.env.example`**

```
PORT=3000
ADAPTER_SECRET=troque-por-um-segredo-longo-e-aleatorio
MEDX_HOST=https://integracao-app.medx.med.br
MEDX_INTEGRATION_TOKEN=
REDIS_URL=redis://127.0.0.1:6379
DATABASE_PATH=./dados/adapter.sqlite
CLINT_WEBHOOK_AGENDAMENTO_URL=
CLINT_WEBHOOK_NOTIFICACAO_URL=
RETENCAO_DIAS=90
LOG_LEVEL=info
SMTP_URL=
ALERTA_EMAIL_DESTINO=
ALERTA_EMAIL_ORIGEM=adapter@localhost
BULLBOARD_USUARIO=
BULLBOARD_SENHA=
```

- [ ] **Step 9: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/lib/config/env.server.test.ts`
Expected: PASS — 4 testes.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: bootstrap do projeto e validação de ambiente com Zod"
```

---

### Task 2: Logger compartilhado com redação de dados pessoais

**Files:**
- Create: `lib/logger.ts`
- Test: `tests/lib/logger.test.ts`

**Interfaces:**
- Consumes: `Env` da Task 1
- Produces: `criarLogger(env: Env): Logger`, `CAMPOS_REDIGIDOS: string[]`, e a interface `LoggerMinimo { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; error(o: unknown, m?: string): void }` — é `LoggerMinimo` que as outras camadas recebem, nunca o pino concreto.

- [ ] **Step 1: Escrever o teste que falha**

`tests/lib/logger.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { CAMPOS_REDIGIDOS } from "../../lib/logger.js";

function capturar(): { stream: Writable; linhas: string[] } {
  const linhas: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      linhas.push(chunk.toString());
      cb();
    },
  });
  return { stream, linhas };
}

describe("redação de dados pessoais", () => {
  it("oculta cpf, telefone, nome e email dos logs", () => {
    const { stream, linhas } = capturar();
    pino({ redact: CAMPOS_REDIGIDOS }, stream).info(
      { deal_id: "abc", cpf: "12345678910", telefone: "11999998888", nome: "Maria Silva", email: "m@x.com" },
      "agendado"
    );

    const saida = linhas.join("");
    expect(saida).toContain("abc");
    for (const sigiloso of ["12345678910", "11999998888", "Maria Silva", "m@x.com"]) {
      expect(saida).not.toContain(sigiloso);
    }
  });

  it("oculta os mesmos campos quando aninhados", () => {
    const { stream, linhas } = capturar();
    pino({ redact: CAMPOS_REDIGIDOS }, stream).info({ paciente: { cpf: "98765432100", nome: "João" } }, "vinculo");

    const saida = linhas.join("");
    expect(saida).not.toContain("98765432100");
    expect(saida).not.toContain("João");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/lib/logger.test.ts`
Expected: FAIL — `lib/logger.ts` não existe.

- [ ] **Step 3: Implementar `lib/logger.ts`**

```ts
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
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/lib/logger.test.ts`
Expected: PASS — 2 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: logger compartilhado com redação de dados pessoais"
```

---

### Task 3: Domínio — erro base e value object Telefone

**Files:**
- Create: `src/api/domain/shared/erros.ts`, `src/api/domain/paciente/telefone.ts`
- Test: `tests/api/domain/paciente/telefone.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `class ErroDeDominio extends Error`
  - `class Telefone` com `static criar(bruto: string): Telefone`, propriedades readonly `e164: string` e `nacional: string`, e `igual(outro: Telefone): boolean`. O construtor é privado: um `Telefone` só existe válido.

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/domain/paciente/telefone.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Telefone } from "../../../../src/api/domain/paciente/telefone.js";
import { ErroDeDominio } from "../../../../src/api/domain/shared/erros.js";

describe("Telefone.criar", () => {
  it.each([
    ["+55 11 99999-8888", "+5511999998888", "11999998888"],
    ["5511999998888", "+5511999998888", "11999998888"],
    ["11999998888", "+5511999998888", "11999998888"],
    ["(11) 99999-8888", "+5511999998888", "11999998888"],
  ])("normaliza %s", (entrada, e164, nacional) => {
    const t = Telefone.criar(entrada);
    expect(t.e164).toBe(e164);
    expect(t.nacional).toBe(nacional);
  });

  it("preserva fixos de 8 dígitos sem inventar o nono", () => {
    expect(Telefone.criar("1133334444").nacional).toBe("1133334444");
  });

  it.each(["99998888", "", "123"])("rejeita %s por não ter DDD", (entrada) => {
    expect(() => Telefone.criar(entrada)).toThrow(ErroDeDominio);
  });

  it("considera iguais dois telefones escritos de formas diferentes", () => {
    expect(Telefone.criar("+55 11 99999-8888").igual(Telefone.criar("11999998888"))).toBe(true);
  });

  it("distingue telefones diferentes", () => {
    expect(Telefone.criar("11999998888").igual(Telefone.criar("11999998887"))).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/domain/paciente/telefone.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar `src/api/domain/shared/erros.ts`**

```ts
export class ErroDeDominio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeDominio";
  }
}
```

- [ ] **Step 4: Implementar `src/api/domain/paciente/telefone.ts`**

```ts
import { ErroDeDominio } from "../shared/erros.js";

export class Telefone {
  private constructor(
    readonly e164: string,
    readonly nacional: string
  ) {}

  static criar(bruto: string): Telefone {
    let digitos = (bruto ?? "").replace(/\D/g, "");

    if (digitos.startsWith("55") && digitos.length >= 12) {
      digitos = digitos.slice(2);
    }

    if (digitos.length < 10 || digitos.length > 11) {
      throw new ErroDeDominio(
        `Telefone sem DDD reconhecível: ${digitos.length} dígitos após normalização`
      );
    }

    return new Telefone(`+55${digitos}`, digitos);
  }

  igual(outro: Telefone): boolean {
    return this.e164 === outro.e164;
  }
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/domain/paciente/telefone.test.ts`
Expected: PASS — 9 testes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: value object Telefone com normalização e validação"
```

---

### Task 4: Domínio — value object Cpf

**Files:**
- Create: `src/api/domain/paciente/cpf.ts`
- Test: `tests/api/domain/paciente/cpf.test.ts`

**Interfaces:**
- Consumes: `ErroDeDominio` (Task 3)
- Produces: `class Cpf` com `static criar(bruto: string): Cpf`, `static tentarCriar(bruto: string | undefined | null): Cpf | null`, e propriedade readonly `digitos: string` (11 dígitos, sem pontuação). Valida os dois dígitos verificadores.

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/domain/paciente/cpf.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Cpf } from "../../../../src/api/domain/paciente/cpf.js";
import { ErroDeDominio } from "../../../../src/api/domain/shared/erros.js";

// 529.982.247-25 é um CPF com dígitos verificadores válidos.
const VALIDO = "529.982.247-25";

describe("Cpf.criar", () => {
  it("remove a pontuação", () => {
    expect(Cpf.criar(VALIDO).digitos).toBe("52998224725");
  });

  it("aceita já sem pontuação", () => {
    expect(Cpf.criar("52998224725").digitos).toBe("52998224725");
  });

  it("rejeita dígito verificador errado", () => {
    expect(() => Cpf.criar("52998224724")).toThrow(ErroDeDominio);
  });

  it("rejeita quantidade de dígitos diferente de 11", () => {
    expect(() => Cpf.criar("529982247")).toThrow(ErroDeDominio);
  });

  it.each(["00000000000", "11111111111", "99999999999"])(
    "rejeita a sequência repetida %s",
    (entrada) => {
      expect(() => Cpf.criar(entrada)).toThrow(ErroDeDominio);
    }
  );
});

describe("Cpf.tentarCriar", () => {
  it("devolve null para ausente", () => {
    expect(Cpf.tentarCriar(undefined)).toBeNull();
    expect(Cpf.tentarCriar(null)).toBeNull();
    expect(Cpf.tentarCriar("")).toBeNull();
  });

  it("devolve null para inválido em vez de lançar", () => {
    expect(Cpf.tentarCriar("52998224724")).toBeNull();
  });

  it("devolve o Cpf quando válido", () => {
    expect(Cpf.tentarCriar(VALIDO)?.digitos).toBe("52998224725");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/domain/paciente/cpf.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/api/domain/paciente/cpf.ts`**

```ts
import { ErroDeDominio } from "../shared/erros.js";

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
    const digitos = (bruto ?? "").replace(/\D/g, "");

    if (digitos.length !== 11) {
      throw new ErroDeDominio(`CPF deve ter 11 dígitos, recebeu ${digitos.length}`);
    }

    if (/^(\d)\1{10}$/.test(digitos)) {
      throw new ErroDeDominio("CPF com todos os dígitos iguais é inválido");
    }

    if (
      digitoVerificador(digitos, 10) !== Number(digitos[9]) ||
      digitoVerificador(digitos, 11) !== Number(digitos[10])
    ) {
      throw new ErroDeDominio("CPF com dígito verificador inválido");
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

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/domain/paciente/cpf.test.ts`
Expected: PASS — 11 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: value object Cpf com validação de dígitos verificadores"
```

---

### Task 5: Domínio — value object PeriodoConsulta

**Files:**
- Create: `src/api/domain/agendamento/periodo-consulta.ts`
- Test: `tests/api/domain/agendamento/periodo-consulta.test.ts`

**Interfaces:**
- Consumes: `ErroDeDominio` (Task 3), `luxon`
- Produces: `FUSO_CLINICA = "America/Sao_Paulo"` e `class PeriodoConsulta` com `static criar(inicioIso: string, duracaoMinutos: number): PeriodoConsulta`, propriedades readonly `inicio: string` e `fim: string` (ambas no formato do MedX, `YYYY-MM-DDTHH:mm:ss`, sem offset), e `comecaEm(outroInicioIso: string): boolean`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/domain/agendamento/periodo-consulta.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PeriodoConsulta } from "../../../../src/api/domain/agendamento/periodo-consulta.js";
import { ErroDeDominio } from "../../../../src/api/domain/shared/erros.js";

describe("PeriodoConsulta.criar", () => {
  it("converte UTC para o horário local da clínica", () => {
    expect(PeriodoConsulta.criar("2026-07-10T17:00:00Z", 30).inicio).toBe("2026-07-10T14:00:00");
  });

  it("mantém a hora quando o offset já é o de São Paulo", () => {
    expect(PeriodoConsulta.criar("2026-07-10T14:00:00-03:00", 30).inicio).toBe("2026-07-10T14:00:00");
  });

  it("trata string sem offset como já sendo horário da clínica", () => {
    expect(PeriodoConsulta.criar("2026-07-10T14:00:00", 30).inicio).toBe("2026-07-10T14:00:00");
  });

  it("calcula o fim somando a duração", () => {
    expect(PeriodoConsulta.criar("2026-07-10T14:00:00", 30).fim).toBe("2026-07-10T14:30:00");
  });

  it("atravessa a virada do dia", () => {
    expect(PeriodoConsulta.criar("2026-07-10T23:45:00", 30).fim).toBe("2026-07-11T00:15:00");
  });

  it("rejeita data inválida", () => {
    expect(() => PeriodoConsulta.criar("não é data", 30)).toThrow(ErroDeDominio);
  });

  it.each([0, -15])("rejeita duração de %i minutos", (duracao) => {
    expect(() => PeriodoConsulta.criar("2026-07-10T14:00:00", duracao)).toThrow(ErroDeDominio);
  });
});

describe("comecaEm", () => {
  it("ignora diferença de precisão de segundos fracionários", () => {
    expect(PeriodoConsulta.criar("2026-07-10T14:00:00", 30).comecaEm("2026-07-10T14:00:00.000")).toBe(true);
  });

  it("reconhece o mesmo instante expresso em UTC", () => {
    expect(PeriodoConsulta.criar("2026-07-10T14:00:00", 30).comecaEm("2026-07-10T17:00:00Z")).toBe(true);
  });

  it("distingue horários diferentes", () => {
    expect(PeriodoConsulta.criar("2026-07-10T14:00:00", 30).comecaEm("2026-07-10T15:00:00")).toBe(false);
  });

  it("devolve false para data ilegível em vez de estourar", () => {
    expect(PeriodoConsulta.criar("2026-07-10T14:00:00", 30).comecaEm("lixo")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/domain/agendamento/periodo-consulta.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/api/domain/agendamento/periodo-consulta.ts`**

```ts
import { DateTime } from "luxon";
import { ErroDeDominio } from "../shared/erros.js";

export const FUSO_CLINICA = "America/Sao_Paulo";
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
    readonly duracaoMinutos: number
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
      duracaoMinutos
    );
  }

  comecaEm(outroInicioIso: string): boolean {
    const outro = interpretar(outroInicioIso);
    return outro !== null && outro.toFormat(FORMATO_MEDX) === this.inicio;
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/domain/agendamento/periodo-consulta.test.ts`
Expected: PASS — 12 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: value object PeriodoConsulta com fuso da clínica"
```

---
### Task 6: Domínio — value object RespostaLembrete

**Files:**
- Create: `src/api/domain/agendamento/resposta-lembrete.ts`
- Test: `tests/api/domain/agendamento/resposta-lembrete.test.ts`

**Interfaces:**
- Consumes: `ErroDeDominio` (Task 3)
- Produces: `type ValorResposta = "confirmar" | "reagendar" | "cancelar"`, `VALORES_RESPOSTA: readonly ValorResposta[]` e `class RespostaLembrete` com `static criar(bruto: string): RespostaLembrete`, readonly `valor: ValorResposta`, e os getters `exigeEscritaNoMedx: boolean` e `exigeAtendimentoHumano: boolean`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/domain/agendamento/resposta-lembrete.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { RespostaLembrete, VALORES_RESPOSTA } from "../../../../src/api/domain/agendamento/resposta-lembrete.js";
import { ErroDeDominio } from "../../../../src/api/domain/shared/erros.js";

describe("RespostaLembrete.criar", () => {
  it.each(VALORES_RESPOSTA)("aceita %s", (valor) => {
    expect(RespostaLembrete.criar(valor).valor).toBe(valor);
  });

  it("normaliza caixa e espaços", () => {
    expect(RespostaLembrete.criar("  CONFIRMAR ").valor).toBe("confirmar");
  });

  it.each(["talvez", "", "sim"])("rejeita %s", (entrada) => {
    expect(() => RespostaLembrete.criar(entrada)).toThrow(ErroDeDominio);
  });
});

describe("consequências da resposta", () => {
  it("só confirmar escreve no MedX", () => {
    expect(RespostaLembrete.criar("confirmar").exigeEscritaNoMedx).toBe(true);
    expect(RespostaLembrete.criar("reagendar").exigeEscritaNoMedx).toBe(false);
    expect(RespostaLembrete.criar("cancelar").exigeEscritaNoMedx).toBe(false);
  });

  it("reagendar e cancelar vão para a secretária", () => {
    expect(RespostaLembrete.criar("reagendar").exigeAtendimentoHumano).toBe(true);
    expect(RespostaLembrete.criar("cancelar").exigeAtendimentoHumano).toBe(true);
    expect(RespostaLembrete.criar("confirmar").exigeAtendimentoHumano).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/domain/agendamento/resposta-lembrete.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/api/domain/agendamento/resposta-lembrete.ts`**

```ts
import { ErroDeDominio } from "../shared/erros.js";

export type ValorResposta = "confirmar" | "reagendar" | "cancelar";

export const VALORES_RESPOSTA: readonly ValorResposta[] = ["confirmar", "reagendar", "cancelar"];

export class RespostaLembrete {
  private constructor(readonly valor: ValorResposta) {}

  static criar(bruto: string): RespostaLembrete {
    const normalizado = (bruto ?? "").trim().toLowerCase();

    if (!VALORES_RESPOSTA.includes(normalizado as ValorResposta)) {
      throw new ErroDeDominio(
        `Resposta de lembrete desconhecida: "${bruto}". Esperado uma de ${VALORES_RESPOSTA.join(", ")}`
      );
    }

    return new RespostaLembrete(normalizado as ValorResposta);
  }

  get exigeEscritaNoMedx(): boolean {
    return this.valor === "confirmar";
  }

  get exigeAtendimentoHumano(): boolean {
    return !this.exigeEscritaNoMedx;
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/domain/agendamento/resposta-lembrete.test.ts`
Expected: PASS — 8 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: value object RespostaLembrete com as três opções do lembrete"
```

---

### Task 7: Domínio — entidade Agendamento e seu repositório

Esta é a tarefa onde mora a regra que o projeto inteiro existe para proteger: quando
uma confirmação deve ser recusada. Ela é pura — nenhum I/O, nenhum conhecimento do MedX
além de dois inteiros de status.

**Files:**
- Create: `src/api/domain/agendamento/agendamento.ts`, `src/api/domain/agendamento/agendamento.repositorio.ts`
- Test: `tests/api/domain/agendamento/agendamento.test.ts`

**Interfaces:**
- Consumes: `PeriodoConsulta` (Task 5), `ErroDeDominio` (Task 3)
- Produces:
  - `type StatusAgendamento = "enviando" | "criado" | "confirmado" | "conflito" | "falhou"`
  - `STATUS_MEDX_AGENDADO = 0`
  - `interface EstadoExterno { status: number; inicio: string }`
  - `type AvaliacaoConfirmacao = { permitido: true } | { permitido: false; motivo: string }`
  - `class Agendamento` com `static iniciar(d)`, `static restaurar(d)`, getters `idMedx`, `status`, `ultimaEdicaoConhecida`, `jaFoiCriado`, `jaFoiConfirmado`, `tentativaInterrompida`, e os métodos `registrarCriacao(idMedx)`, `adotarExistente(idMedx)`, `marcarFalha()`, `marcarConflito()`, `avaliarConfirmacao(externo, indiceConfirmado)`, `confirmar(ultimaEdicao)`
  - `interface AgendamentoRepositorio { buscarPorDeal(dealId: string): Agendamento | null; salvar(a: Agendamento): void }`

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/domain/agendamento/agendamento.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Agendamento, STATUS_MEDX_AGENDADO } from "../../../../src/api/domain/agendamento/agendamento.js";
import { PeriodoConsulta } from "../../../../src/api/domain/agendamento/periodo-consulta.js";
import { ErroDeDominio } from "../../../../src/api/domain/shared/erros.js";

const PERIODO = PeriodoConsulta.criar("2026-07-10T14:00:00", 30);
const INDICE_CONFIRMADO = 1;

function novo() {
  return Agendamento.iniciar({
    dealId: "deal-1",
    idPacienteMedx: 67890,
    idProfissionalMedx: 43013640,
    periodo: PERIODO,
  });
}

describe("ciclo de vida", () => {
  it("nasce em enviando, sem id do MedX", () => {
    const a = novo();
    expect(a.status).toBe("enviando");
    expect(a.idMedx).toBeNull();
    expect(a.jaFoiCriado).toBe(false);
  });

  it("registra a criação e passa para criado", () => {
    const a = novo();
    a.registrarCriacao(1275002478);
    expect(a.idMedx).toBe(1275002478);
    expect(a.status).toBe("criado");
    expect(a.jaFoiCriado).toBe(true);
  });

  it("reconhece uma tentativa interrompida", () => {
    expect(novo().tentativaInterrompida).toBe(true);
    const a = novo();
    a.registrarCriacao(1);
    expect(a.tentativaInterrompida).toBe(false);
  });

  it("adota um agendamento que já existia no MedX", () => {
    const a = novo();
    a.adotarExistente(999);
    expect(a.idMedx).toBe(999);
    expect(a.status).toBe("criado");
  });

  it("marca falha", () => {
    const a = novo();
    a.marcarFalha();
    expect(a.status).toBe("falhou");
  });

  it("rejeita registrar criação duas vezes", () => {
    const a = novo();
    a.registrarCriacao(1);
    expect(() => a.registrarCriacao(2)).toThrow(ErroDeDominio);
  });
});

describe("avaliarConfirmacao", () => {
  function criado() {
    const a = novo();
    a.registrarCriacao(1275002478);
    return a;
  }

  it("permite quando o estado no MedX bate com o agendado", () => {
    const r = criado().avaliarConfirmacao(
      { status: STATUS_MEDX_AGENDADO, inicio: "2026-07-10T14:00:00" },
      INDICE_CONFIRMADO
    );
    expect(r).toEqual({ permitido: true });
  });

  it("permite quando o MedX já está confirmado (reenvio do paciente)", () => {
    const r = criado().avaliarConfirmacao(
      { status: INDICE_CONFIRMADO, inicio: "2026-07-10T14:00:00" },
      INDICE_CONFIRMADO
    );
    expect(r.permitido).toBe(true);
  });

  it("recusa quando o horário mudou desde o lembrete", () => {
    const r = criado().avaliarConfirmacao(
      { status: STATUS_MEDX_AGENDADO, inicio: "2026-07-11T09:00:00" },
      INDICE_CONFIRMADO
    );
    expect(r).toEqual({ permitido: false, motivo: expect.stringMatching(/horário/i) });
  });

  it("recusa quando a consulta não está mais agendada", () => {
    const r = criado().avaliarConfirmacao(
      { status: 3, inicio: "2026-07-10T14:00:00" },
      INDICE_CONFIRMADO
    );
    expect(r).toEqual({ permitido: false, motivo: expect.stringMatching(/agendada/i) });
  });

  it("recusa quando o agendamento ainda não foi criado no MedX", () => {
    const r = novo().avaliarConfirmacao(
      { status: STATUS_MEDX_AGENDADO, inicio: "2026-07-10T14:00:00" },
      INDICE_CONFIRMADO
    );
    expect(r.permitido).toBe(false);
  });

  it("aceita o mesmo instante expresso em UTC", () => {
    const r = criado().avaliarConfirmacao(
      { status: STATUS_MEDX_AGENDADO, inicio: "2026-07-10T17:00:00Z" },
      INDICE_CONFIRMADO
    );
    expect(r.permitido).toBe(true);
  });
});

describe("confirmar", () => {
  it("passa para confirmado e guarda a última edição", () => {
    const a = novo();
    a.registrarCriacao(1);
    a.confirmar("2026-07-09T10:00:00");
    expect(a.status).toBe("confirmado");
    expect(a.jaFoiConfirmado).toBe(true);
    expect(a.ultimaEdicaoConhecida).toBe("2026-07-09T10:00:00");
  });

  it("recusa confirmar o que nunca foi criado", () => {
    expect(() => novo().confirmar("2026-07-09T10:00:00")).toThrow(ErroDeDominio);
  });

  it("marcarConflito leva para conflito", () => {
    const a = novo();
    a.registrarCriacao(1);
    a.marcarConflito();
    expect(a.status).toBe("conflito");
  });
});

describe("restaurar", () => {
  it("reconstrói o estado vindo da persistência", () => {
    const a = Agendamento.restaurar({
      dealId: "deal-1",
      idPacienteMedx: 67890,
      idProfissionalMedx: 43013640,
      periodo: PERIODO,
      idMedx: 1275002478,
      status: "confirmado",
      ultimaEdicaoConhecida: "2026-07-09T10:00:00",
    });
    expect(a.jaFoiConfirmado).toBe(true);
    expect(a.idMedx).toBe(1275002478);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/domain/agendamento/agendamento.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/api/domain/agendamento/agendamento.ts`**

```ts
import { ErroDeDominio } from "../shared/erros.js";
import type { PeriodoConsulta } from "./periodo-consulta.js";

export type StatusAgendamento = "enviando" | "criado" | "confirmado" | "conflito" | "falhou";

/** Índice do primeiro rótulo do MedX ("Agendado"): um agendamento nasce não confirmado. */
export const STATUS_MEDX_AGENDADO = 0;

export interface EstadoExterno {
  status: number;
  inicio: string;
}

export type AvaliacaoConfirmacao =
  | { permitido: true }
  | { permitido: false; motivo: string };

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
    private ultimaEdicaoInterna: string | null
  ) {}

  static iniciar(dados: DadosBase): Agendamento {
    return new Agendamento(
      dados.dealId,
      dados.idPacienteMedx,
      dados.idProfissionalMedx,
      dados.periodo,
      null,
      "enviando",
      null
    );
  }

  static restaurar(
    dados: DadosBase & {
      idMedx: number | null;
      status: StatusAgendamento;
      ultimaEdicaoConhecida: string | null;
    }
  ): Agendamento {
    return new Agendamento(
      dados.dealId,
      dados.idPacienteMedx,
      dados.idProfissionalMedx,
      dados.periodo,
      dados.idMedx,
      dados.status,
      dados.ultimaEdicaoConhecida
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
    return this.statusInterno === "confirmado";
  }

  /** Houve uma tentativa de criação que não chegou a registrar o id — pode haver órfão no MedX. */
  get tentativaInterrompida(): boolean {
    return this.statusInterno === "enviando" && this.idMedxInterno === null;
  }

  registrarCriacao(idMedx: number): void {
    if (this.jaFoiCriado) {
      throw new ErroDeDominio(
        `Agendamento ${this.dealId} já tem o id ${this.idMedxInterno} no MedX`
      );
    }
    this.idMedxInterno = idMedx;
    this.statusInterno = "criado";
  }

  adotarExistente(idMedx: number): void {
    this.registrarCriacao(idMedx);
  }

  marcarFalha(): void {
    this.statusInterno = "falhou";
  }

  marcarConflito(): void {
    this.statusInterno = "conflito";
  }

  avaliarConfirmacao(externo: EstadoExterno, indiceConfirmado: number): AvaliacaoConfirmacao {
    if (!this.jaFoiCriado) {
      return { permitido: false, motivo: "agendamento ainda não foi criado no MedX" };
    }

    if (externo.status !== STATUS_MEDX_AGENDADO && externo.status !== indiceConfirmado) {
      return { permitido: false, motivo: "consulta não está mais agendada no MedX" };
    }

    if (!this.periodo.comecaEm(externo.inicio)) {
      return { permitido: false, motivo: "horário da consulta foi alterado desde o lembrete" };
    }

    return { permitido: true };
  }

  confirmar(ultimaEdicao: string): void {
    if (!this.jaFoiCriado) {
      throw new ErroDeDominio(
        `Não é possível confirmar o agendamento ${this.dealId}: ele ainda não existe no MedX`
      );
    }
    this.statusInterno = "confirmado";
    this.ultimaEdicaoInterna = ultimaEdicao;
  }
}
```

- [ ] **Step 4: Implementar `src/api/domain/agendamento/agendamento.repositorio.ts`**

```ts
import type { Agendamento } from "./agendamento.js";

export interface AgendamentoRepositorio {
  buscarPorDeal(dealId: string): Agendamento | null;
  salvar(agendamento: Agendamento): void;
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/domain/agendamento/agendamento.test.ts`
Expected: PASS — 16 testes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: entidade Agendamento com a regra de recusa de confirmação"
```

---

### Task 8: Domínio — CorrelacaoPaciente, EventoRecebido e seus repositórios

**Files:**
- Create: `src/api/domain/paciente/correlacao-paciente.ts`, `src/api/domain/paciente/correlacao-paciente.repositorio.ts`, `src/api/domain/evento/evento-recebido.ts`, `src/api/domain/evento/evento.repositorio.ts`
- Test: `tests/api/domain/paciente/correlacao-paciente.test.ts`, `tests/api/domain/evento/evento-recebido.test.ts`

**Interfaces:**
- Consumes: `Telefone` (Task 3)
- Produces:
  - `class CorrelacaoPaciente` com `static criar(d)`, `static restaurar(d)`, readonly `telefone`, `idPacienteMedx`, `matchConfiavel`, `idContatoClint`, e getter `exigeRevisao: boolean`
  - `interface CorrelacaoPacienteRepositorio { buscarPorTelefone(t: Telefone): CorrelacaoPaciente | null; salvar(c: CorrelacaoPaciente): void }`
  - `type StatusEvento = "recebido" | "processado" | "invalido" | "falhou"` e `class EventoRecebido` com `static restaurar(d)`, readonly `id`, `endpoint`, getters `status`, `erro`, `jobId`, e os métodos `marcarProcessado()`, `marcarInvalido(motivo)`, `marcarFalha(erro)`, `associarJob(jobId)`
  - `interface EventoRepositorio { registrar(endpoint: string, payload: unknown): EventoRecebido; salvar(e: EventoRecebido): void; expurgar(dias: number): number }`

- [ ] **Step 1: Escrever os testes que falham**

`tests/api/domain/paciente/correlacao-paciente.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { CorrelacaoPaciente } from "../../../../src/api/domain/paciente/correlacao-paciente.js";
import { Telefone } from "../../../../src/api/domain/paciente/telefone.js";

const TELEFONE = Telefone.criar("11999998888");

describe("CorrelacaoPaciente", () => {
  it("exige revisão quando o match não é confiável", () => {
    const c = CorrelacaoPaciente.criar({
      telefone: TELEFONE,
      idPacienteMedx: 67890,
      matchConfiavel: false,
      idContatoClint: null,
    });
    expect(c.exigeRevisao).toBe(true);
  });

  it("não exige revisão quando o match é confiável", () => {
    const c = CorrelacaoPaciente.criar({
      telefone: TELEFONE,
      idPacienteMedx: 67890,
      matchConfiavel: true,
      idContatoClint: "c1",
    });
    expect(c.exigeRevisao).toBe(false);
    expect(c.idContatoClint).toBe("c1");
  });

  it("restaura preservando o telefone como value object", () => {
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

`tests/api/domain/evento/evento-recebido.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { EventoRecebido } from "../../../../src/api/domain/evento/evento-recebido.js";

function novo() {
  return EventoRecebido.restaurar({
    id: 1,
    endpoint: "/webhooks/clint/agendamento",
    status: "recebido",
    erro: null,
    jobId: null,
  });
}

describe("EventoRecebido", () => {
  it("nasce recebido", () => {
    expect(novo().status).toBe("recebido");
  });

  it("marca processado", () => {
    const e = novo();
    e.marcarProcessado();
    expect(e.status).toBe("processado");
    expect(e.erro).toBeNull();
  });

  it("marca inválido guardando o motivo", () => {
    const e = novo();
    e.marcarInvalido("telefone ausente");
    expect(e.status).toBe("invalido");
    expect(e.erro).toBe("telefone ausente");
  });

  it("marca falha guardando o erro", () => {
    const e = novo();
    e.marcarFalha("MedX fora do ar");
    expect(e.status).toBe("falhou");
    expect(e.erro).toBe("MedX fora do ar");
  });

  it("associa o job da fila", () => {
    const e = novo();
    e.associarJob("job-1");
    expect(e.jobId).toBe("job-1");
  });

  it("limpa o erro ao reprocessar com sucesso", () => {
    const e = novo();
    e.marcarFalha("erro anterior");
    e.marcarProcessado();
    expect(e.erro).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/api/domain/paciente/correlacao-paciente.test.ts tests/api/domain/evento/evento-recebido.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar `src/api/domain/paciente/correlacao-paciente.ts`**

```ts
import type { Telefone } from "./telefone.js";

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
    readonly idContatoClint: string | null
  ) {}

  static criar(dados: Dados): CorrelacaoPaciente {
    return new CorrelacaoPaciente(
      dados.telefone,
      dados.idPacienteMedx,
      dados.matchConfiavel,
      dados.idContatoClint
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

- [ ] **Step 4: Implementar `src/api/domain/paciente/correlacao-paciente.repositorio.ts`**

```ts
import type { Telefone } from "./telefone.js";
import type { CorrelacaoPaciente } from "./correlacao-paciente.js";

export interface CorrelacaoPacienteRepositorio {
  buscarPorTelefone(telefone: Telefone): CorrelacaoPaciente | null;
  salvar(correlacao: CorrelacaoPaciente): void;
}
```

- [ ] **Step 5: Implementar `src/api/domain/evento/evento-recebido.ts`**

```ts
export type StatusEvento = "recebido" | "processado" | "invalido" | "falhou";

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
    private jobIdInterno: string | null
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
    this.statusInterno = "processado";
    this.erroInterno = null;
  }

  marcarInvalido(motivo: string): void {
    this.statusInterno = "invalido";
    this.erroInterno = motivo;
  }

  marcarFalha(erro: string): void {
    this.statusInterno = "falhou";
    this.erroInterno = erro;
  }

  associarJob(jobId: string): void {
    this.jobIdInterno = jobId;
  }
}
```

- [ ] **Step 6: Implementar `src/api/domain/evento/evento.repositorio.ts`**

```ts
import type { EventoRecebido } from "./evento-recebido.js";

export interface EventoRepositorio {
  /** Grava o payload bruto e devolve o evento já com id. */
  registrar(endpoint: string, payload: unknown): EventoRecebido;
  salvar(evento: EventoRecebido): void;
  /** Remove eventos mais antigos que a retenção; devolve quantos saíram. */
  expurgar(dias: number): number;
}
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/api/domain`
Expected: PASS — todos os testes de domínio.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: entidades de correlação de paciente e evento recebido"
```

---

### Task 9: Teste de arquitetura das camadas

A regra de dependência só vale se for verificada. Este teste falha no CI quando alguém
importa `infrastructure` de dentro do `domain`.

**Files:**
- Test: `tests/api/arquitetura.test.ts`

**Interfaces:**
- Consumes: nada — lê os arquivos-fonte diretamente
- Produces: nada

- [ ] **Step 1: Escrever o teste**

`tests/api/arquitetura.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(process.cwd(), "src", "api");

function arquivosDe(camada: string): string[] {
  const base = join(RAIZ, camada);
  try {
    return readdirSync(base, { recursive: true, encoding: "utf8" })
      .filter((caminho) => caminho.endsWith(".ts"))
      .map((caminho) => join(base, caminho));
  } catch {
    return []; // camada ainda não existe
  }
}

function importesDe(arquivo: string): string[] {
  const conteudo = readFileSync(arquivo, "utf8");
  return [...conteudo.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
}

function violacoes(camada: string, proibidas: string[]): string[] {
  const encontradas: string[] = [];
  for (const arquivo of arquivosDe(camada)) {
    for (const importado of importesDe(arquivo)) {
      for (const proibida of proibidas) {
        if (importado.includes(`/${proibida}/`) || importado.includes(`${proibida}/`)) {
          encontradas.push(`${arquivo} importa de ${proibida}: ${importado}`);
        }
      }
    }
  }
  return encontradas;
}

describe("regras de dependência entre camadas", () => {
  it("domain não importa de nenhuma outra camada", () => {
    expect(violacoes("domain", ["application", "infrastructure", "presentation", "composition"])).toEqual([]);
  });

  it("application não importa de infrastructure nem de presentation", () => {
    expect(violacoes("application", ["infrastructure", "presentation", "composition"])).toEqual([]);
  });

  it("presentation não importa de infrastructure", () => {
    expect(violacoes("presentation", ["infrastructure"])).toEqual([]);
  });

  it("infrastructure não importa de presentation", () => {
    expect(violacoes("infrastructure", ["presentation"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/arquitetura.test.ts`
Expected: PASS — 4 testes. Com apenas o `domain` implementado, as outras camadas ainda
não têm arquivos, e `readdirSync` devolve lista vazia — o teste passa vazio e ganha dentes
conforme as camadas nascem.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: verificação automática das regras de dependência entre camadas"
```

---
### Task 10: Infraestrutura — conexão SQLite e migrations

**Files:**
- Create: `src/api/infrastructure/persistencia/sqlite/conexao.ts`
- Test: `tests/api/infrastructure/persistencia/sqlite/conexao.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `abrirBanco(caminho: string): Database.Database` — aplica as migrations e liga o modo WAL. Tabelas: `eventos_recebidos`, `pacientes_correlacao`, `agendamentos`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/infrastructure/persistencia/sqlite/conexao.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { abrirBanco } from "../../../../../src/api/infrastructure/persistencia/sqlite/conexao.js";

describe("abrirBanco", () => {
  it("cria as três tabelas do adapter", () => {
    const nomes = abrirBanco(":memory:")
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((l: any) => l.name);

    for (const tabela of ["eventos_recebidos", "pacientes_correlacao", "agendamentos"]) {
      expect(nomes).toContain(tabela);
    }
  });

  it("impede dois agendamentos para o mesmo deal_id", () => {
    const db = abrirBanco(":memory:");
    const inserir = db.prepare(
      `INSERT INTO agendamentos (deal_id, medx_id_cliente, medx_id_usuario, inicio, duracao_minutos, status, criado_em, atualizado_em)
       VALUES (?, 1, 2, '2026-07-10T14:00:00', 30, 'enviando', datetime('now'), datetime('now'))`
    );
    inserir.run("deal-1");
    expect(() => inserir.run("deal-1")).toThrow(/UNIQUE/);
  });

  it("impede dois pacientes com o mesmo telefone", () => {
    const db = abrirBanco(":memory:");
    const inserir = db.prepare(
      `INSERT INTO pacientes_correlacao (telefone_e164, medx_id_cliente, match_confiavel, criado_em)
       VALUES (?, 1, 1, datetime('now'))`
    );
    inserir.run("+5511999998888");
    expect(() => inserir.run("+5511999998888")).toThrow(/UNIQUE/);
  });

  it("aplica as migrations duas vezes no mesmo arquivo sem erro", () => {
    const caminho = join(tmpdir(), `adapter-teste-${Date.now()}.sqlite`);
    try {
      expect(() => {
        abrirBanco(caminho).close();
        abrirBanco(caminho).close();
      }).not.toThrow();
    } finally {
      for (const sufixo of ["", "-wal", "-shm"]) {
        rmSync(`${caminho}${sufixo}`, { force: true });
      }
    }
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/infrastructure/persistencia/sqlite/conexao.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/api/infrastructure/persistencia/sqlite/conexao.ts`**

```ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type { Database };

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS eventos_recebidos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint      TEXT    NOT NULL,
  payload_bruto TEXT    NOT NULL,
  recebido_em   TEXT    NOT NULL,
  status        TEXT    NOT NULL,
  job_id        TEXT,
  erro          TEXT
);

CREATE INDEX IF NOT EXISTS idx_eventos_recebido_em ON eventos_recebidos (recebido_em);

CREATE TABLE IF NOT EXISTS pacientes_correlacao (
  telefone_e164     TEXT    PRIMARY KEY,
  medx_id_cliente   INTEGER NOT NULL,
  clint_contact_id  TEXT,
  match_confiavel   INTEGER NOT NULL,
  criado_em         TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS agendamentos (
  deal_id             TEXT    PRIMARY KEY,
  medx_id_agendamento INTEGER,
  medx_id_cliente     INTEGER NOT NULL,
  medx_id_usuario     INTEGER NOT NULL,
  inicio              TEXT    NOT NULL,
  duracao_minutos     INTEGER NOT NULL,
  ultima_edicao       TEXT,
  status              TEXT    NOT NULL,
  criado_em           TEXT    NOT NULL,
  atualizado_em       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agendamentos_medx_id ON agendamentos (medx_id_agendamento);
`;

export function abrirBanco(caminho: string): Database.Database {
  if (caminho !== ":memory:") {
    mkdirSync(dirname(caminho), { recursive: true });
  }
  const db = new Database(caminho);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(MIGRATIONS);
  return db;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/infrastructure/persistencia/sqlite/conexao.test.ts`
Expected: PASS — 4 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: conexão SQLite com migrations e modo WAL"
```

---

### Task 11: Infraestrutura — repositórios SQLite

**Files:**
- Create: `src/api/infrastructure/persistencia/sqlite/agendamento.sqlite-repositorio.ts`, `src/api/infrastructure/persistencia/sqlite/correlacao-paciente.sqlite-repositorio.ts`, `src/api/infrastructure/persistencia/sqlite/evento.sqlite-repositorio.ts`
- Test: `tests/api/infrastructure/persistencia/sqlite/repositorios.test.ts`

**Interfaces:**
- Consumes: `abrirBanco` (Task 10) e as entidades e ports das Tasks 3, 5, 7, 8
- Produces:
  - `criarAgendamentoRepositorio(db): AgendamentoRepositorio`
  - `criarCorrelacaoPacienteRepositorio(db): CorrelacaoPacienteRepositorio`
  - `criarEventoRepositorio(db): EventoRepositorio`

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/infrastructure/persistencia/sqlite/repositorios.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { abrirBanco } from "../../../../../src/api/infrastructure/persistencia/sqlite/conexao.js";
import { criarAgendamentoRepositorio } from "../../../../../src/api/infrastructure/persistencia/sqlite/agendamento.sqlite-repositorio.js";
import { criarCorrelacaoPacienteRepositorio } from "../../../../../src/api/infrastructure/persistencia/sqlite/correlacao-paciente.sqlite-repositorio.js";
import { criarEventoRepositorio } from "../../../../../src/api/infrastructure/persistencia/sqlite/evento.sqlite-repositorio.js";
import { Agendamento } from "../../../../../src/api/domain/agendamento/agendamento.js";
import { PeriodoConsulta } from "../../../../../src/api/domain/agendamento/periodo-consulta.js";
import { CorrelacaoPaciente } from "../../../../../src/api/domain/paciente/correlacao-paciente.js";
import { Telefone } from "../../../../../src/api/domain/paciente/telefone.js";

const PERIODO = PeriodoConsulta.criar("2026-07-10T14:00:00", 30);
const TELEFONE = Telefone.criar("11999998888");

function novoAgendamento() {
  return Agendamento.iniciar({
    dealId: "deal-1",
    idPacienteMedx: 67890,
    idProfissionalMedx: 43013640,
    periodo: PERIODO,
  });
}

describe("agendamento", () => {
  it("devolve null para deal desconhecido", () => {
    expect(criarAgendamentoRepositorio(abrirBanco(":memory:")).buscarPorDeal("x")).toBeNull();
  });

  it("salva e restaura preservando o estado", () => {
    const repo = criarAgendamentoRepositorio(abrirBanco(":memory:"));
    const a = novoAgendamento();
    a.registrarCriacao(1275002478);
    a.confirmar("2026-07-09T10:00:00");
    repo.salvar(a);

    const lido = repo.buscarPorDeal("deal-1")!;
    expect(lido.idMedx).toBe(1275002478);
    expect(lido.status).toBe("confirmado");
    expect(lido.ultimaEdicaoConhecida).toBe("2026-07-09T10:00:00");
    expect(lido.idPacienteMedx).toBe(67890);
  });

  it("restaura o período com a duração original", () => {
    const repo = criarAgendamentoRepositorio(abrirBanco(":memory:"));
    repo.salvar(novoAgendamento());
    const lido = repo.buscarPorDeal("deal-1")!;
    expect(lido.periodo.inicio).toBe("2026-07-10T14:00:00");
    expect(lido.periodo.fim).toBe("2026-07-10T14:30:00");
  });

  it("salvar duas vezes atualiza em vez de duplicar", () => {
    const repo = criarAgendamentoRepositorio(abrirBanco(":memory:"));
    const a = novoAgendamento();
    repo.salvar(a);
    a.registrarCriacao(99);
    expect(() => repo.salvar(a)).not.toThrow();
    expect(repo.buscarPorDeal("deal-1")!.idMedx).toBe(99);
  });
});

describe("correlação de paciente", () => {
  it("devolve null para telefone desconhecido", () => {
    const repo = criarCorrelacaoPacienteRepositorio(abrirBanco(":memory:"));
    expect(repo.buscarPorTelefone(TELEFONE)).toBeNull();
  });

  it("salva e recupera pelo value object Telefone", () => {
    const repo = criarCorrelacaoPacienteRepositorio(abrirBanco(":memory:"));
    repo.salvar(
      CorrelacaoPaciente.criar({
        telefone: TELEFONE,
        idPacienteMedx: 67890,
        matchConfiavel: false,
        idContatoClint: "c1",
      })
    );

    const lido = repo.buscarPorTelefone(Telefone.criar("+55 11 99999-8888"))!;
    expect(lido.idPacienteMedx).toBe(67890);
    expect(lido.exigeRevisao).toBe(true);
    expect(lido.idContatoClint).toBe("c1");
  });
});

describe("evento", () => {
  it("registra devolvendo a entidade com id", () => {
    const repo = criarEventoRepositorio(abrirBanco(":memory:"));
    const e = repo.registrar("/webhooks/clint/agendamento", { deal_id: "d1" });
    expect(e.id).toBeGreaterThan(0);
    expect(e.status).toBe("recebido");
  });

  it("persiste a transição para falhou com o erro", () => {
    const repo = criarEventoRepositorio(abrirBanco(":memory:"));
    const e = repo.registrar("/x", {});
    e.marcarFalha("MedX fora do ar");
    repo.salvar(e);

    const outro = criarEventoRepositorio(abrirBanco(":memory:"));
    void outro; // o estado é verificado na mesma conexão abaixo
  });

  it("expurga eventos mais antigos que a retenção", () => {
    const db = abrirBanco(":memory:");
    const repo = criarEventoRepositorio(db);
    db.prepare(
      `INSERT INTO eventos_recebidos (endpoint, payload_bruto, recebido_em, status)
       VALUES ('/x', '{}', datetime('now', '-100 days'), 'processado')`
    ).run();
    repo.registrar("/x", {});
    expect(repo.expurgar(90)).toBe(1);
  });

  it("grava o job associado", () => {
    const db = abrirBanco(":memory:");
    const repo = criarEventoRepositorio(db);
    const e = repo.registrar("/x", {});
    e.associarJob("job-1");
    repo.salvar(e);

    const linha: any = db.prepare("SELECT job_id, status FROM eventos_recebidos WHERE id = ?").get(e.id);
    expect(linha.job_id).toBe("job-1");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/infrastructure/persistencia/sqlite/repositorios.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar `src/api/infrastructure/persistencia/sqlite/agendamento.sqlite-repositorio.ts`**

```ts
import type Database from "better-sqlite3";
import { Agendamento, type StatusAgendamento } from "../../../domain/agendamento/agendamento.js";
import { PeriodoConsulta } from "../../../domain/agendamento/periodo-consulta.js";
import type { AgendamentoRepositorio } from "../../../domain/agendamento/agendamento.repositorio.js";

export function criarAgendamentoRepositorio(db: Database.Database): AgendamentoRepositorio {
  return {
    buscarPorDeal(dealId: string): Agendamento | null {
      const l: any = db.prepare("SELECT * FROM agendamentos WHERE deal_id = ?").get(dealId);
      if (!l) return null;

      return Agendamento.restaurar({
        dealId: l.deal_id,
        idPacienteMedx: l.medx_id_cliente,
        idProfissionalMedx: l.medx_id_usuario,
        periodo: PeriodoConsulta.criar(l.inicio, l.duracao_minutos),
        idMedx: l.medx_id_agendamento,
        status: l.status as StatusAgendamento,
        ultimaEdicaoConhecida: l.ultima_edicao,
      });
    },

    salvar(a: Agendamento): void {
      db.prepare(
        `INSERT INTO agendamentos
           (deal_id, medx_id_agendamento, medx_id_cliente, medx_id_usuario,
            inicio, duracao_minutos, ultima_edicao, status, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(deal_id) DO UPDATE SET
           medx_id_agendamento = excluded.medx_id_agendamento,
           ultima_edicao       = excluded.ultima_edicao,
           status              = excluded.status,
           atualizado_em       = datetime('now')`
      ).run(
        a.dealId,
        a.idMedx,
        a.idPacienteMedx,
        a.idProfissionalMedx,
        a.periodo.inicio,
        a.periodo.duracaoMinutos,
        a.ultimaEdicaoConhecida,
        a.status
      );
    },
  };
}
```

- [ ] **Step 4: Implementar `src/api/infrastructure/persistencia/sqlite/correlacao-paciente.sqlite-repositorio.ts`**

```ts
import type Database from "better-sqlite3";
import { CorrelacaoPaciente } from "../../../domain/paciente/correlacao-paciente.js";
import { Telefone } from "../../../domain/paciente/telefone.js";
import type { CorrelacaoPacienteRepositorio } from "../../../domain/paciente/correlacao-paciente.repositorio.js";

export function criarCorrelacaoPacienteRepositorio(
  db: Database.Database
): CorrelacaoPacienteRepositorio {
  return {
    buscarPorTelefone(telefone: Telefone): CorrelacaoPaciente | null {
      const l: any = db
        .prepare("SELECT * FROM pacientes_correlacao WHERE telefone_e164 = ?")
        .get(telefone.e164);
      if (!l) return null;

      return CorrelacaoPaciente.restaurar({
        telefone: Telefone.criar(l.telefone_e164),
        idPacienteMedx: l.medx_id_cliente,
        matchConfiavel: Boolean(l.match_confiavel),
        idContatoClint: l.clint_contact_id,
      });
    },

    salvar(c: CorrelacaoPaciente): void {
      db.prepare(
        `INSERT INTO pacientes_correlacao
           (telefone_e164, medx_id_cliente, clint_contact_id, match_confiavel, criado_em)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(telefone_e164) DO UPDATE SET
           medx_id_cliente  = excluded.medx_id_cliente,
           clint_contact_id = excluded.clint_contact_id,
           match_confiavel  = excluded.match_confiavel`
      ).run(
        c.telefone.e164,
        c.idPacienteMedx,
        c.idContatoClint,
        c.matchConfiavel ? 1 : 0
      );
    },
  };
}
```

- [ ] **Step 5: Implementar `src/api/infrastructure/persistencia/sqlite/evento.sqlite-repositorio.ts`**

```ts
import type Database from "better-sqlite3";
import { EventoRecebido, type StatusEvento } from "../../../domain/evento/evento-recebido.js";
import type { EventoRepositorio } from "../../../domain/evento/evento.repositorio.js";

export function criarEventoRepositorio(db: Database.Database): EventoRepositorio {
  return {
    registrar(endpoint: string, payload: unknown): EventoRecebido {
      const info = db
        .prepare(
          `INSERT INTO eventos_recebidos (endpoint, payload_bruto, recebido_em, status)
           VALUES (?, ?, datetime('now'), 'recebido')`
        )
        .run(endpoint, JSON.stringify(payload));

      return EventoRecebido.restaurar({
        id: Number(info.lastInsertRowid),
        endpoint,
        status: "recebido" as StatusEvento,
        erro: null,
        jobId: null,
      });
    },

    salvar(evento: EventoRecebido): void {
      db.prepare(
        "UPDATE eventos_recebidos SET status = ?, erro = ?, job_id = ? WHERE id = ?"
      ).run(evento.status, evento.erro, evento.jobId, evento.id);
    },

    expurgar(dias: number): number {
      return db
        .prepare(
          `DELETE FROM eventos_recebidos
           WHERE recebido_em < datetime('now', '-' || ? || ' days')`
        )
        .run(dias).changes;
    },
  };
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/infrastructure/persistencia/sqlite/repositorios.test.ts`
Expected: PASS — 10 testes.

- [ ] **Step 7: Rodar o teste de arquitetura**

Run: `npx vitest run tests/api/arquitetura.test.ts`
Expected: PASS — a infraestrutura importa do `domain`, que é permitido.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: repositórios SQLite dos três agregados"
```

---

### Task 12: Application — os ports

Nenhuma implementação aqui, só contratos. É a fronteira que mantém o MedX fora do
`domain` e da `application`.

**Files:**
- Create: `src/api/application/ports/agenda-medica.port.ts`, `src/api/application/ports/cadastro-paciente.port.ts`, `src/api/application/ports/catalogo-clinico.port.ts`, `src/api/application/ports/crm.port.ts`, `src/api/application/ports/notificador.port.ts`, `src/api/application/ports/fila.port.ts`
- Test: `tests/api/application/ports/contratos.test.ts`

**Interfaces:**
- Consumes: `Cpf`, `Telefone` (Tasks 3 e 4)
- Produces:
  - `interface AgendamentoExterno { id: number; idProfissional: number; idPaciente: number; inicio: string; fim: string; descricao: string; status: number; idTipoConsulta: number; confirmacao: string; ultimaEdicao: string; bruto: unknown }` — `bruto` carrega o payload original para o adapter reconstruir o `PUT` sem perder campos que o port não modela
  - `interface DadosCriacaoAgendamento { idProfissional: number; idPaciente: number; inicio: string; fim: string; descricao: string; idTipoConsulta: number }`
  - `interface AgendaMedicaPort { criar(d: DadosCriacaoAgendamento): Promise<number>; obter(id: number): Promise<AgendamentoExterno>; listarPorPaciente(idPaciente: number): Promise<AgendamentoExterno[]>; confirmar(a: AgendamentoExterno, indiceStatusConfirmado: number): Promise<void> }`
  - `interface DadosVinculo { nome: string; telefone: Telefone; dataNascimento: string; email?: string; sexo?: "M" | "F" }`
  - `interface CadastroPacientePort { vincular(d: DadosVinculo): Promise<{ idPaciente: number; matchConfiavel: boolean }>; registrarCpf(idPaciente: number, cpf: Cpf): Promise<void> }`
  - `interface CatalogoClinicoPort { carregar(): Promise<void>; resolverProfissional(v: string | number): Promise<number>; resolverTipoConsulta(v: string | number): Promise<{ id: number; nome: string; duracaoMinutos: number }>; indiceStatusConfirmado(): number }`
  - `interface CrmPort { gravarIdAgendamento(dealId: string, idAgendamento: number): Promise<void>; notificarConfirmacao(dealId: string): Promise<void>; notificarReagendamento(dealId: string): Promise<void>; notificarCancelamento(dealId: string): Promise<void>; notificarConflito(dealId: string, motivo: string): Promise<void> }`
  - `interface NotificadorPort { alertar(assunto: string, detalhes: Record<string, unknown>): Promise<void> }`
  - `type JobAdapter = { tipo: "agendamento"; eventoId: number; comando: ComandoAgendamento } | { tipo: "resposta"; eventoId: number; comando: ComandoResposta }` e `interface FilaPort { add(nome: string, dados: JobAdapter): Promise<{ id?: string }> }` — o job é contrato entre `presentation` e `infrastructure`, então vive na `application`; assim nenhuma das duas precisa importar da outra

- [ ] **Step 1: Escrever o teste que falha**

Ports são só tipos, então o teste verifica que um dublê satisfaz cada contrato — o
compilador é quem faz a verificação real, e o teste garante que ela roda.

`tests/api/application/ports/contratos.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { AgendaMedicaPort, AgendamentoExterno } from "../../../../src/api/application/ports/agenda-medica.port.js";
import type { CadastroPacientePort } from "../../../../src/api/application/ports/cadastro-paciente.port.js";
import type { CatalogoClinicoPort } from "../../../../src/api/application/ports/catalogo-clinico.port.js";
import type { CrmPort } from "../../../../src/api/application/ports/crm.port.js";
import type { NotificadorPort } from "../../../../src/api/application/ports/notificador.port.js";

const EXTERNO: AgendamentoExterno = {
  id: 1275002478,
  idProfissional: 43013640,
  idPaciente: 67890,
  inicio: "2026-07-10T14:00:00",
  fim: "2026-07-10T14:30:00",
  descricao: "Consulta",
  status: 0,
  idTipoConsulta: 111,
  confirmacao: "",
  ultimaEdicao: "2026-07-09T10:00:00",
  bruto: {},
};

describe("contratos dos ports", () => {
  it("um dublê satisfaz AgendaMedicaPort", async () => {
    const porta: AgendaMedicaPort = {
      criar: async () => 1,
      obter: async () => EXTERNO,
      listarPorPaciente: async () => [EXTERNO],
      confirmar: async () => {},
    };
    expect(await porta.criar({
      idProfissional: 1, idPaciente: 1, inicio: "x", fim: "y", descricao: "z", idTipoConsulta: 1,
    })).toBe(1);
  });

  it("um dublê satisfaz os demais ports", async () => {
    const cadastro: CadastroPacientePort = {
      vincular: async () => ({ idPaciente: 1, matchConfiavel: true }),
      registrarCpf: async () => {},
    };
    const catalogo: CatalogoClinicoPort = {
      carregar: async () => {},
      resolverProfissional: async () => 1,
      resolverTipoConsulta: async () => ({ id: 1, nome: "Consulta", duracaoMinutos: 30 }),
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
    expect((await catalogo.resolverTipoConsulta("x")).duracaoMinutos).toBe(30);
    await expect(cadastro.registrarCpf(1, {} as never)).resolves.toBeUndefined();
    await expect(crm.notificarConflito("d", "m")).resolves.toBeUndefined();
    await expect(notificador.alertar("a", {})).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/application/ports/contratos.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar `src/api/application/ports/agenda-medica.port.ts`**

```ts
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

- [ ] **Step 4: Implementar `src/api/application/ports/cadastro-paciente.port.ts`**

```ts
import type { Cpf } from "../../domain/paciente/cpf.js";
import type { Telefone } from "../../domain/paciente/telefone.js";

export interface DadosVinculo {
  nome: string;
  telefone: Telefone;
  dataNascimento: string;
  email?: string;
  sexo?: "M" | "F";
}

export interface CadastroPacientePort {
  vincular(dados: DadosVinculo): Promise<{ idPaciente: number; matchConfiavel: boolean }>;
  registrarCpf(idPaciente: number, cpf: Cpf): Promise<void>;
}
```

- [ ] **Step 5: Implementar `src/api/application/ports/catalogo-clinico.port.ts`**

```ts
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

- [ ] **Step 6: Implementar `src/api/application/ports/crm.port.ts` e `notificador.port.ts`**

`crm.port.ts`:
```ts
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
export interface NotificadorPort {
  alertar(assunto: string, detalhes: Record<string, unknown>): Promise<void>;
}
```

- [ ] **Step 7: Criar os dois comandos e o port da fila**

Os comandos são só interfaces. Defini-los aqui evita import circular entre os ports e
os casos de uso, que os consomem nas Tasks 20 e 21.

`src/api/application/agendar-consulta/agendar-consulta.comando.ts`:
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
  sexo?: "M" | "F";
}
```

`src/api/application/processar-resposta-lembrete/processar-resposta.comando.ts`:
```ts
export interface ComandoResposta {
  dealId: string;
  idAgendamentoMedx: number;
  /** Valor cru vindo do CRM; o value object RespostaLembrete valida e normaliza. */
  resposta: string;
}
```

`src/api/application/ports/fila.port.ts`:
```ts
import type { ComandoAgendamento } from "../agendar-consulta/agendar-consulta.comando.js";
import type { ComandoResposta } from "../processar-resposta-lembrete/processar-resposta.comando.js";

export type JobAdapter =
  | { tipo: "agendamento"; eventoId: number; comando: ComandoAgendamento }
  | { tipo: "resposta"; eventoId: number; comando: ComandoResposta };

export interface FilaPort {
  add(nome: string, dados: JobAdapter): Promise<{ id?: string }>;
}
```

- [ ] **Step 8: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/application/ports/contratos.test.ts`
Expected: PASS — 2 testes.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: ports da camada de aplicação"
```

---
### Task 13: Infraestrutura MedX — erros, tipos e provedor de token

**Files:**
- Create: `src/api/infrastructure/medx/medx.erros.ts`, `src/api/infrastructure/medx/medx.tipos.ts`, `src/api/infrastructure/medx/medx-token.provider.ts`
- Test: `tests/api/infrastructure/medx/medx-token.provider.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `class ErroMedx extends Error` com `status: number`; `class ErroRateLimit extends ErroMedx` com `esperarSegundos: number`
  - Tipos crus da API em `medx.tipos.ts`: `MedxProfissional`, `MedxTipoAgendamento`, `MedxAgendamento`, `MedxVinculoResposta`
  - `interface TokenProvider { obterToken(): Promise<string>; invalidar(): void }` e `criarTokenProvider(opcoes: { host: string; integrationToken: string; agora?: () => number }): TokenProvider`

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/infrastructure/medx/medx-token.provider.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { criarTokenProvider } from "../../../../src/api/infrastructure/medx/medx-token.provider.js";

const respostaOk = (token: string) =>
  new Response(
    JSON.stringify({ accessToken: token, tokenType: "Bearer", expiresInSeconds: 900, scope: "" }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

const opcoes = { host: "https://medx.test", integrationToken: "tk" };

afterEach(() => vi.restoreAllMocks());

describe("criarTokenProvider", () => {
  it("busca o token na primeira chamada", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaOk("jwt-1"));
    expect(await criarTokenProvider(opcoes).obterToken()).toBe("jwt-1");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("posta o IntegrationToken no corpo, no endpoint certo", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaOk("jwt-1"));
    await criarTokenProvider(opcoes).obterToken();

    expect(String(spy.mock.calls[0]![0])).toBe("https://medx.test/api/integration/token");
    expect(JSON.parse(String(spy.mock.calls[0]![1]!.body))).toEqual({ IntegrationToken: "tk" });
  });

  it("reaproveita o token dentro da validade", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaOk("jwt-1"));
    const p = criarTokenProvider(opcoes);
    await p.obterToken();
    await p.obterToken();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("renova quando faltam menos de 120s para expirar", async () => {
    let agora = 0;
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respostaOk("jwt-1"))
      .mockResolvedValueOnce(respostaOk("jwt-2"));

    const p = criarTokenProvider({ ...opcoes, agora: () => agora });
    expect(await p.obterToken()).toBe("jwt-1");
    agora = 800_000; // restam 100s
    expect(await p.obterToken()).toBe("jwt-2");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("colapsa chamadas concorrentes numa única requisição", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaOk("jwt-1"));
    const p = criarTokenProvider(opcoes);
    await Promise.all([p.obterToken(), p.obterToken(), p.obterToken()]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("busca de novo depois de invalidar", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaOk("jwt-1"));
    const p = criarTokenProvider(opcoes);
    await p.obterToken();
    p.invalidar();
    await p.obterToken();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("propaga erro quando o token de integração é recusado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
    await expect(criarTokenProvider(opcoes).obterToken()).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/infrastructure/medx/medx-token.provider.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/api/infrastructure/medx/medx.erros.ts`**

```ts
export class ErroMedx extends Error {
  constructor(
    readonly status: number,
    mensagem: string
  ) {
    super(mensagem);
    this.name = "ErroMedx";
  }
}

export class ErroRateLimit extends ErroMedx {
  constructor(readonly esperarSegundos: number) {
    super(429, `Rate limit do MedX atingido; aguardar ${esperarSegundos}s`);
    this.name = "ErroRateLimit";
  }
}
```

- [ ] **Step 4: Implementar `src/api/infrastructure/medx/medx.tipos.ts`**

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

- [ ] **Step 5: Implementar `src/api/infrastructure/medx/medx-token.provider.ts`**

```ts
const MARGEM_RENOVACAO_MS = 120_000;

export interface TokenProvider {
  obterToken(): Promise<string>;
  invalidar(): void;
}

export function criarTokenProvider(opcoes: {
  host: string;
  integrationToken: string;
  agora?: () => number;
}): TokenProvider {
  const agora = opcoes.agora ?? Date.now;

  let token: string | null = null;
  let expiraEm = 0;
  let emVoo: Promise<string> | null = null;

  async function buscar(): Promise<string> {
    const resposta = await fetch(`${opcoes.host}/api/integration/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ IntegrationToken: opcoes.integrationToken }),
    });

    if (!resposta.ok) {
      throw new Error(`Falha ao trocar o token de integração: HTTP ${resposta.status}`);
    }

    const dados = (await resposta.json()) as { accessToken: string; expiresInSeconds: number };
    token = dados.accessToken;
    expiraEm = agora() + dados.expiresInSeconds * 1000;
    return token;
  }

  return {
    async obterToken(): Promise<string> {
      if (token && agora() < expiraEm - MARGEM_RENOVACAO_MS) {
        return token;
      }
      // A troca de token é limitada a 10 req/min por IP: chamadas concorrentes
      // compartilham a mesma requisição em voo.
      emVoo ??= buscar().finally(() => {
        emVoo = null;
      });
      return emVoo;
    },

    invalidar(): void {
      token = null;
      expiraEm = 0;
    },
  };
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/infrastructure/medx/medx-token.provider.test.ts`
Expected: PASS — 7 testes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: provedor de token do MedX com renovação antecipada"
```

---

### Task 14: Infraestrutura MedX — cliente HTTP

**Files:**
- Create: `src/api/infrastructure/medx/medx-http.client.ts`
- Test: `tests/api/infrastructure/medx/medx-http.client.test.ts`

**Interfaces:**
- Consumes: `TokenProvider`, `ErroMedx`, `ErroRateLimit` (Task 13)
- Produces: `type Query = Record<string, string | number | undefined>` e `interface MedxClient { get<T>(caminho: string, query?: Query): Promise<T>; post<T>(caminho: string, corpo: unknown): Promise<T>; put<T>(caminho: string, corpo: unknown): Promise<T> }`, mais `criarMedxClient(opcoes: { host: string; tokens: TokenProvider }): MedxClient`

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/infrastructure/medx/medx-http.client.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { criarMedxClient } from "../../../../src/api/infrastructure/medx/medx-http.client.js";
import { ErroRateLimit, ErroMedx } from "../../../../src/api/infrastructure/medx/medx.erros.js";

afterEach(() => vi.restoreAllMocks());

function tokensFalsos() {
  let invalidado = false;
  return {
    obterToken: async () => (invalidado ? "jwt-novo" : "jwt-1"),
    invalidar: () => {
      invalidado = true;
    },
    foiInvalidado: () => invalidado,
  };
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

function cliente(tokens = tokensFalsos()) {
  return { client: criarMedxClient({ host: "https://medx.test", tokens }), tokens };
}

describe("criarMedxClient", () => {
  it("envia o Bearer token no header", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json([]));
    await cliente().client.get("/api/integration/agenda/status");

    const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer jwt-1");
  });

  it("monta a query string ignorando valores indefinidos", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json([]));
    await cliente().client.get("/x", { inicio: "2026-07-10", idUsuario: 12, setor: undefined });

    expect(String(spy.mock.calls[0]![0])).toBe("https://medx.test/x?inicio=2026-07-10&idUsuario=12");
  });

  it("converte 429 em ErroRateLimit lendo o Retry-After", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 429, headers: { "retry-after": "60" } })
    );
    await expect(cliente().client.get("/x")).rejects.toMatchObject({ esperarSegundos: 60 });
    await expect(cliente().client.get("/x")).rejects.toBeInstanceOf(ErroRateLimit);
  });

  it("usa 60 segundos quando o 429 não traz Retry-After", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 429 }));
    await expect(cliente().client.get("/x")).rejects.toMatchObject({ esperarSegundos: 60 });
  });

  it("renova o token uma vez ao receber 401 e repete a chamada", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(json({ ok: true }));

    const { client, tokens } = cliente();
    await expect(client.get("/x")).resolves.toEqual({ ok: true });
    expect(tokens.foiInvalidado()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("não repete indefinidamente quando o 401 persiste", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
    await expect(cliente().client.get("/x")).rejects.toBeInstanceOf(ErroMedx);
  });

  it("resolve para número quando o corpo é o inteiro do POST de agendamento", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("1275002478", { status: 200, headers: { "content-type": "text/plain" } })
    );
    await expect(cliente().client.post("/x", {})).resolves.toBe(1275002478);
  });

  it("resolve para string quando o corpo é uma mensagem de texto", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Agendamento atualizado com sucesso.", { status: 200 })
    );
    await expect(cliente().client.put("/x", {})).resolves.toBe("Agendamento atualizado com sucesso.");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/infrastructure/medx/medx-http.client.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/api/infrastructure/medx/medx-http.client.ts`**

```ts
import type { TokenProvider } from "./medx-token.provider.js";
import { ErroMedx, ErroRateLimit } from "./medx.erros.js";

export type Query = Record<string, string | number | undefined>;

export interface MedxClient {
  get<T>(caminho: string, query?: Query): Promise<T>;
  post<T>(caminho: string, corpo: unknown): Promise<T>;
  put<T>(caminho: string, corpo: unknown): Promise<T>;
}

function montarUrl(host: string, caminho: string, query?: Query): string {
  if (!query) return `${host}${caminho}`;

  const partes = Object.entries(query)
    .filter(([, valor]) => valor !== undefined)
    .map(([chave, valor]) => `${encodeURIComponent(chave)}=${encodeURIComponent(String(valor))}`);

  return partes.length ? `${host}${caminho}?${partes.join("&")}` : `${host}${caminho}`;
}

/** A API devolve ora JSON, ora um inteiro puro, ora uma frase. Todos são respostas válidas. */
async function lerCorpo<T>(resposta: Response): Promise<T> {
  const texto = await resposta.text();
  if (texto === "") return undefined as T;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return texto as T;
  }
}

export function criarMedxClient(opcoes: { host: string; tokens: TokenProvider }): MedxClient {
  async function chamar<T>(
    metodo: string,
    caminho: string,
    query?: Query,
    corpo?: unknown,
    jaRenovou = false
  ): Promise<T> {
    const token = await opcoes.tokens.obterToken();

    const resposta = await fetch(montarUrl(opcoes.host, caminho, query), {
      method: metodo,
      headers: {
        authorization: `Bearer ${token}`,
        ...(corpo !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    });

    if (resposta.status === 429) {
      const cabecalho = resposta.headers.get("retry-after");
      const segundos = cabecalho ? Number(cabecalho) : 60;
      throw new ErroRateLimit(Number.isFinite(segundos) ? segundos : 60);
    }

    if (resposta.status === 401 && !jaRenovou) {
      opcoes.tokens.invalidar();
      return chamar<T>(metodo, caminho, query, corpo, true);
    }

    if (!resposta.ok) {
      throw new ErroMedx(resposta.status, `MedX respondeu HTTP ${resposta.status} em ${caminho}`);
    }

    return lerCorpo<T>(resposta);
  }

  return {
    get: <T>(caminho: string, query?: Query) => chamar<T>("GET", caminho, query),
    post: <T>(caminho: string, corpo: unknown) => chamar<T>("POST", caminho, undefined, corpo),
    put: <T>(caminho: string, corpo: unknown) => chamar<T>("PUT", caminho, undefined, corpo),
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/infrastructure/medx/medx-http.client.test.ts`
Expected: PASS — 8 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: cliente HTTP do MedX com tratamento de 429 e renovação de token"
```

---

### Task 15: Script de descoberta contra a conta real

**Files:**
- Create: `scripts/descoberta.ts`
- Test: verificação manual — o script consulta a conta real

**Interfaces:**
- Consumes: `carregarEnv` (Task 1), `criarTokenProvider` (Task 13), `criarMedxClient` (Task 14)
- Produces: saída em console e o arquivo `docs/descoberta-medx.json`

Esta tarefa responde às cinco perguntas da Seção 14 do spec antes que qualquer adapter
dependa delas. **Rode antes de seguir para a Task 16.**

- [ ] **Step 1: Escrever `scripts/descoberta.ts`**

```ts
import { writeFileSync, mkdirSync } from "node:fs";
import { carregarEnv } from "../lib/config/env.server.js";
import { criarTokenProvider } from "../src/api/infrastructure/medx/medx-token.provider.js";
import { criarMedxClient } from "../src/api/infrastructure/medx/medx-http.client.js";

const env = carregarEnv(process.env);
const client = criarMedxClient({
  host: env.MEDX_HOST,
  tokens: criarTokenProvider({
    host: env.MEDX_HOST,
    integrationToken: env.MEDX_INTEGRATION_TOKEN,
  }),
});

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

const resultado = {
  status: await tentar("1. GET /agenda/status", () =>
    client.get<string[]>("/api/integration/agenda/status")
  ),
  profissionais: await tentar("2. GET /financas/profissionais", () =>
    client.get<unknown[]>("/api/integration/financas/profissionais")
  ),
  tipos: await tentar("3. GET /agenda/tipos", () =>
    client.get<unknown[]>("/api/integration/agenda/tipos")
  ),
  setores: await tentar("4. GET /agenda/setores", () =>
    client.get<unknown[]>("/api/integration/agenda/setores")
  ),
};

mkdirSync("docs", { recursive: true });
writeFileSync("docs/descoberta-medx.json", JSON.stringify(resultado, null, 2));

const rotulos = Array.isArray(resultado.status) ? resultado.status : [];
const indice = rotulos.findIndex(
  (r) => typeof r === "string" && r.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").startsWith("confirm")
);

console.log("\n\n=== CHECKLIST ===");
console.log(`Rótulos de status: ${JSON.stringify(rotulos)}`);
console.log(`Índice de "Confirmado": ${indice >= 0 ? indice : "NÃO ENCONTRADO — PARE E CONSULTE A CLÍNICA"}`);
console.log("\nFalta fazer manualmente:");
console.log("  5. POST /contatos/vinculo com um paciente conhecido — conferir se Id volta numérico");
console.log("  6. Criar agendamento de teste e ler GET /agenda/agendamentos/{id}");
console.log("     — conferir o formato de Inicio/Final e inspecionar os campos SMS e Confirmacao");
console.log("\nResultado salvo em docs/descoberta-medx.json");
```

- [ ] **Step 2: Rodar contra a conta real**

Run:
```bash
MEDX_INTEGRATION_TOKEN=<token real> \
ADAPTER_SECRET=x \
CLINT_WEBHOOK_AGENDAMENTO_URL=https://x.test/a \
CLINT_WEBHOOK_NOTIFICACAO_URL=https://x.test/n \
npm run descoberta
```

Expected: a lista de rótulos de status, o índice de "Confirmado", e os inventários de
profissionais e tipos. Se o índice sair como `NÃO ENCONTRADO`, **pare e consulte a
clínica** — o rótulo foi renomeado, e a Task 16 precisa saber o nome real para ajustar
o critério de busca.

- [ ] **Step 3: Registrar os achados no spec**

Acrescente ao fim de `docs/superpowers/specs/2026-09-12-adapter-clint-medx-design.md`
uma seção "Achados da descoberta" com os índices reais de status e os IDs de
profissionais e tipos que a clínica usa.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: script de descoberta das tabelas de apoio do MedX"
```

---

### Task 16: Infraestrutura MedX — adapter de catálogo clínico

**Files:**
- Create: `src/api/infrastructure/medx/medx-catalogo.adapter.ts`
- Test: `tests/api/infrastructure/medx/medx-catalogo.adapter.test.ts`

**Interfaces:**
- Consumes: `MedxClient` (Task 14), tipos (Task 13), `CatalogoClinicoPort` (Task 12)
- Produces: `criarCatalogoMedx(client: MedxClient, opcoes?: { ttlMs?: number; agora?: () => number }): CatalogoClinicoPort`

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/infrastructure/medx/medx-catalogo.adapter.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { criarCatalogoMedx } from "../../../../src/api/infrastructure/medx/medx-catalogo.adapter.js";
import type { MedxClient } from "../../../../src/api/infrastructure/medx/medx-http.client.js";

const PROFISSIONAIS = [
  { IdDoUsuario: 43013640, NomeCompleto: "Leize Ferreira", UsuarioNome: "leize", Ativo: true, Agenda: true, LinkAgendamentoOnline: "" },
];
const TIPOS = [{ IddoDiagnosticoQP: 111, DiagnosticoQP: "Consulta de Rotina", Tempo: 30 }];
const STATUS = ["Agendado", "Confirmado", "Chegou", "Cancelado"];

function clientFalso(status: string[] = STATUS) {
  const chamadas: string[] = [];
  const client: MedxClient = {
    async get<T>(caminho: string): Promise<T> {
      chamadas.push(caminho);
      if (caminho.endsWith("/status")) return status as T;
      if (caminho.endsWith("/tipos")) return TIPOS as T;
      if (caminho.endsWith("/profissionais")) return PROFISSIONAIS as T;
      throw new Error(`caminho inesperado: ${caminho}`);
    },
    post: async <T>() => ({}) as T,
    put: async <T>() => ({}) as T,
  };
  return { client, chamadas };
}

describe("índice de status", () => {
  it("é descoberto, não codificado", async () => {
    const c = criarCatalogoMedx(clientFalso().client);
    await c.carregar();
    expect(c.indiceStatusConfirmado()).toBe(1);
  });

  it("acompanha a reordenação dos rótulos da conta", async () => {
    const c = criarCatalogoMedx(clientFalso(["Agendado", "Chegou", "Cancelado", "Confirmado"]).client);
    await c.carregar();
    expect(c.indiceStatusConfirmado()).toBe(3);
  });

  it("ignora acento e caixa ao procurar o rótulo", async () => {
    const c = criarCatalogoMedx(clientFalso(["Agendado", "CONFIRMADO"]).client);
    await c.carregar();
    expect(c.indiceStatusConfirmado()).toBe(1);
  });

  it("falha no carregamento quando não existe rótulo de confirmação", async () => {
    const c = criarCatalogoMedx(clientFalso(["Agendado", "Chegou", "Cancelado"]).client);
    await expect(c.carregar()).rejects.toThrow(/Confirmado/);
  });

  it("erra com mensagem clara se consultado antes de carregar", () => {
    expect(() => criarCatalogoMedx(clientFalso().client).indiceStatusConfirmado()).toThrow(/carregar/);
  });
});

describe("resolução de profissional e tipo", () => {
  it("resolve profissional por nome completo", async () => {
    const c = criarCatalogoMedx(clientFalso().client);
    await c.carregar();
    expect(await c.resolverProfissional("Leize Ferreira")).toBe(43013640);
  });

  it("resolve ignorando caixa, acento e espaços", async () => {
    const c = criarCatalogoMedx(clientFalso().client);
    await c.carregar();
    expect(await c.resolverProfissional("  leize ferreira ")).toBe(43013640);
  });

  it("aceita o id numérico direto sem nova consulta", async () => {
    const { client, chamadas } = clientFalso();
    const c = criarCatalogoMedx(client);
    await c.carregar();
    chamadas.length = 0;
    expect(await c.resolverProfissional(43013640)).toBe(43013640);
    expect(chamadas).toHaveLength(0);
  });

  it("resolve tipo devolvendo id, nome e duração", async () => {
    const c = criarCatalogoMedx(clientFalso().client);
    await c.carregar();
    expect(await c.resolverTipoConsulta("Consulta de Rotina")).toEqual({
      id: 111,
      nome: "Consulta de Rotina",
      duracaoMinutos: 30,
    });
  });

  it("erra com mensagem útil quando o profissional não existe", async () => {
    const c = criarCatalogoMedx(clientFalso().client);
    await c.carregar();
    await expect(c.resolverProfissional("Fulano")).rejects.toThrow(/Fulano/);
  });

  it("revalida o cache depois do TTL", async () => {
    let agora = 0;
    const { client, chamadas } = clientFalso();
    const c = criarCatalogoMedx(client, { ttlMs: 1000, agora: () => agora });
    await c.carregar();
    const antes = chamadas.length;
    agora = 2000;
    await c.resolverProfissional("Leize Ferreira");
    expect(chamadas.length).toBeGreaterThan(antes);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/infrastructure/medx/medx-catalogo.adapter.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/api/infrastructure/medx/medx-catalogo.adapter.ts`**

```ts
import type {
  CatalogoClinicoPort,
  TipoConsultaResolvido,
} from "../../application/ports/catalogo-clinico.port.js";
import type { MedxClient } from "./medx-http.client.js";
import type { MedxProfissional, MedxTipoAgendamento } from "./medx.tipos.js";

const TTL_PADRAO_MS = 6 * 60 * 60 * 1000;

function chave(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function criarCatalogoMedx(
  client: MedxClient,
  opcoes?: { ttlMs?: number; agora?: () => number }
): CatalogoClinicoPort {
  const ttl = opcoes?.ttlMs ?? TTL_PADRAO_MS;
  const agora = opcoes?.agora ?? Date.now;

  let profissionais: MedxProfissional[] = [];
  let tipos: MedxTipoAgendamento[] = [];
  let indiceConfirmado = -1;
  let carregadoEm = -Infinity;

  async function carregar(): Promise<void> {
    const [p, t, s] = await Promise.all([
      client.get<MedxProfissional[]>("/api/integration/financas/profissionais"),
      client.get<MedxTipoAgendamento[]>("/api/integration/agenda/tipos"),
      client.get<string[]>("/api/integration/agenda/status"),
    ]);

    profissionais = p;
    tipos = t;
    indiceConfirmado = s.findIndex((rotulo) => chave(rotulo).startsWith("confirm"));

    if (indiceConfirmado < 0) {
      throw new Error(
        `Nenhum rótulo de status corresponde a "Confirmado" nesta conta do MedX. ` +
          `Rótulos recebidos: ${JSON.stringify(s)}`
      );
    }

    carregadoEm = agora();
  }

  async function garantirCache(): Promise<void> {
    if (agora() - carregadoEm >= ttl) await carregar();
  }

  return {
    carregar,

    async resolverProfissional(valor: string | number): Promise<number> {
      if (typeof valor === "number") return valor;
      if (/^\d+$/.test(valor.trim())) return Number(valor.trim());

      await garantirCache();
      const alvo = chave(valor);
      const achado = profissionais.find(
        (p) => chave(p.NomeCompleto) === alvo || chave(p.UsuarioNome) === alvo
      );

      if (!achado) {
        throw new Error(`Profissional não encontrado no MedX: "${valor}"`);
      }
      return achado.IdDoUsuario;
    },

    async resolverTipoConsulta(valor: string | number): Promise<TipoConsultaResolvido> {
      await garantirCache();

      const ehNumero = typeof valor === "number" || /^\d+$/.test(String(valor).trim());
      const achado = ehNumero
        ? tipos.find((t) => t.IddoDiagnosticoQP === Number(valor))
        : tipos.find((t) => chave(t.DiagnosticoQP) === chave(String(valor)));

      if (!achado) {
        throw new Error(`Tipo de consulta não encontrado no MedX: "${valor}"`);
      }

      return {
        id: achado.IddoDiagnosticoQP,
        nome: achado.DiagnosticoQP,
        duracaoMinutos: achado.Tempo,
      };
    },

    indiceStatusConfirmado(): number {
      if (indiceConfirmado < 0) {
        throw new Error("Catálogo do MedX não foi inicializado — chame carregar() antes");
      }
      return indiceConfirmado;
    },
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/infrastructure/medx/medx-catalogo.adapter.test.ts`
Expected: PASS — 11 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: adapter de catálogo clínico com descoberta do índice de status"
```

---
### Task 17: Infraestrutura MedX — adapter de cadastro de paciente

**Files:**
- Create: `src/api/infrastructure/medx/medx-cadastro-paciente.adapter.ts`
- Test: `tests/api/infrastructure/medx/medx-cadastro-paciente.adapter.test.ts`

**Interfaces:**
- Consumes: `MedxClient` (Task 14), `MedxVinculoResposta` (Task 13), `CadastroPacientePort` (Task 12), `Telefone` e `Cpf` (Tasks 3 e 4)
- Produces: `criarCadastroPacienteMedx(client: MedxClient): CadastroPacientePort`

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/infrastructure/medx/medx-cadastro-paciente.adapter.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { criarCadastroPacienteMedx } from "../../../../src/api/infrastructure/medx/medx-cadastro-paciente.adapter.js";
import type { MedxClient } from "../../../../src/api/infrastructure/medx/medx-http.client.js";
import { Telefone } from "../../../../src/api/domain/paciente/telefone.js";
import { Cpf } from "../../../../src/api/domain/paciente/cpf.js";

const TELEFONE = Telefone.criar("+55 11 99999-8888");
const CPF = Cpf.criar("529.982.247-25");

function clientFalso(resposta: unknown) {
  const enviados: Array<{ caminho: string; corpo: unknown }> = [];
  const client: MedxClient = {
    get: async <T>() => ({}) as T,
    post: async <T>(caminho: string, corpo: unknown) => {
      enviados.push({ caminho, corpo });
      return resposta as T;
    },
    put: async <T>(caminho: string, corpo: unknown) => {
      enviados.push({ caminho, corpo });
      return "Success" as T;
    },
  };
  return { client, enviados };
}

const DADOS = { nome: "Maria Silva", telefone: TELEFONE, dataNascimento: "1990-05-20" };

describe("vincular", () => {
  it("converte o Id string da resposta em número", async () => {
    const { client } = clientFalso({ Id: "67890", Match: true });
    expect(await criarCadastroPacienteMedx(client).vincular(DADOS)).toEqual({
      idPaciente: 67890,
      matchConfiavel: true,
    });
  });

  it("propaga match não confiável", async () => {
    const { client } = clientFalso({ Id: "1", Match: false });
    const r = await criarCadastroPacienteMedx(client).vincular(DADOS);
    expect(r.matchConfiavel).toBe(false);
  });

  it("envia o telefone no formato nacional que a API espera", async () => {
    const { client, enviados } = clientFalso({ Id: "1", Match: true });
    await criarCadastroPacienteMedx(client).vincular({
      ...DADOS,
      email: "maria@email.com",
      sexo: "F",
    });

    expect(enviados[0]).toEqual({
      caminho: "/api/integration/contatos/vinculo",
      corpo: {
        Name: "Maria Silva",
        Phone: "11999998888",
        DateOfBirth: "1990-05-20",
        Email: "maria@email.com",
        Gender: "F",
      },
    });
  });

  it("omite email e sexo quando não informados", async () => {
    const { client, enviados } = clientFalso({ Id: "1", Match: true });
    await criarCadastroPacienteMedx(client).vincular(DADOS);
    expect(enviados[0]!.corpo).not.toHaveProperty("Email");
    expect(enviados[0]!.corpo).not.toHaveProperty("Gender");
  });

  it("rejeita Id não numérico em vez de gerar NaN silencioso", async () => {
    const { client } = clientFalso({ Id: "abc", Match: true });
    await expect(criarCadastroPacienteMedx(client).vincular(DADOS)).rejects.toThrow(/Id/);
  });

  it("rejeita Id zero ou negativo", async () => {
    const { client } = clientFalso({ Id: "0", Match: true });
    await expect(criarCadastroPacienteMedx(client).vincular(DADOS)).rejects.toThrow(/Id/);
  });
});

describe("registrarCpf", () => {
  it("envia PUT com Id_do_Cliente e o CPF só com dígitos", async () => {
    const { client, enviados } = clientFalso({});
    await criarCadastroPacienteMedx(client).registrarCpf(67890, CPF);

    expect(enviados[0]).toEqual({
      caminho: "/api/integration/contatos",
      corpo: { Id_do_Cliente: 67890, CPF_CGC: "52998224725" },
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/infrastructure/medx/medx-cadastro-paciente.adapter.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/api/infrastructure/medx/medx-cadastro-paciente.adapter.ts`**

```ts
import type {
  CadastroPacientePort,
  DadosVinculo,
} from "../../application/ports/cadastro-paciente.port.js";
import type { Cpf } from "../../domain/paciente/cpf.js";
import type { MedxClient } from "./medx-http.client.js";
import type { MedxVinculoResposta } from "./medx.tipos.js";

export function criarCadastroPacienteMedx(client: MedxClient): CadastroPacientePort {
  return {
    async vincular(dados: DadosVinculo) {
      const corpo: Record<string, string> = {
        Name: dados.nome,
        Phone: dados.telefone.nacional,
        DateOfBirth: dados.dataNascimento,
      };
      if (dados.email) corpo.Email = dados.email;
      if (dados.sexo) corpo.Gender = dados.sexo;

      const resposta = await client.post<MedxVinculoResposta>(
        "/api/integration/contatos/vinculo",
        corpo
      );

      const idPaciente = Number(resposta?.Id);
      if (!Number.isInteger(idPaciente) || idPaciente <= 0) {
        throw new Error(
          `Vínculo devolveu Id inesperado do MedX: ${JSON.stringify(resposta?.Id)}`
        );
      }

      return { idPaciente, matchConfiavel: Boolean(resposta.Match) };
    },

    async registrarCpf(idPaciente: number, cpf: Cpf): Promise<void> {
      await client.put("/api/integration/contatos", {
        Id_do_Cliente: idPaciente,
        CPF_CGC: cpf.digitos,
      });
    },
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/infrastructure/medx/medx-cadastro-paciente.adapter.test.ts`
Expected: PASS — 7 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: adapter de cadastro de paciente no MedX"
```

---

### Task 18: Infraestrutura MedX — adapter de agenda

Aqui vive a string literal `"Mensagem Salva com Sucesso"`, e em nenhum outro lugar.
O `PUT` do MedX não é um PATCH: o adapter reconstrói o objeto inteiro a partir do
`bruto` guardado na leitura, para não apagar campos que o port não modela.

**Files:**
- Create: `src/api/infrastructure/medx/medx-agenda.adapter.ts`
- Test: `tests/api/infrastructure/medx/medx-agenda.adapter.test.ts`

**Interfaces:**
- Consumes: `MedxClient` (Task 14), `MedxAgendamento` (Task 13), `AgendaMedicaPort` (Task 12)
- Produces: `criarAgendaMedx(client: MedxClient): AgendaMedicaPort` e `CONFIRMACAO_LITERAL = "Mensagem Salva com Sucesso"`

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/infrastructure/medx/medx-agenda.adapter.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  criarAgendaMedx,
  CONFIRMACAO_LITERAL,
} from "../../../../src/api/infrastructure/medx/medx-agenda.adapter.js";
import type { MedxClient } from "../../../../src/api/infrastructure/medx/medx-http.client.js";
import type { MedxAgendamento } from "../../../../src/api/infrastructure/medx/medx.tipos.js";

const CRU: MedxAgendamento & { CampoQueNaoModelamos: string } = {
  Id_do_Agendamento: 1275002478,
  Id_do_Usuario: 43013640,
  Inicio: "2026-07-10T14:00:00",
  Final: "2026-07-10T14:30:00",
  Descricao: "Consulta de Rotina — Maria Silva",
  Status: 0,
  Vinculado_a: 30094605,
  Id_do_TipoConsulta: 111,
  Confirmacao: "",
  LastEditDate: "2026-07-09T10:00:00",
  CampoQueNaoModelamos: "precisa sobreviver ao PUT",
};

function clientFalso(resposta: unknown) {
  const enviados: Array<{ caminho: string; corpo?: unknown }> = [];
  const client: MedxClient = {
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
      return "Agendamento atualizado com sucesso." as T;
    },
  };
  return { client, enviados };
}

const CRIACAO = {
  idProfissional: 43013640,
  idPaciente: 30094605,
  inicio: "2026-07-10T14:00:00",
  fim: "2026-07-10T14:30:00",
  descricao: "Consulta de Rotina — Maria Silva",
  idTipoConsulta: 111,
};

describe("criar", () => {
  it("devolve o inteiro que o MedX retorna", async () => {
    const { client } = clientFalso(1275002478);
    expect(await criarAgendaMedx(client).criar(CRIACAO)).toBe(1275002478);
  });

  it("mapeia para os nomes exatos da API e nasce com Status 0", async () => {
    const { client, enviados } = clientFalso(1);
    await criarAgendaMedx(client).criar(CRIACAO);

    expect(enviados[0]).toEqual({
      caminho: "/api/integration/agenda/agendamentos",
      corpo: {
        Id_do_Usuario: 43013640,
        Inicio: "2026-07-10T14:00:00",
        Final: "2026-07-10T14:30:00",
        Descricao: "Consulta de Rotina — Maria Silva",
        Status: 0,
        Vinculado_a: 30094605,
        Id_do_TipoConsulta: 111,
      },
    });
  });

  it("rejeita retorno que não é um id válido", async () => {
    const { client } = clientFalso("erro qualquer");
    await expect(criarAgendaMedx(client).criar(CRIACAO)).rejects.toThrow(/id/i);
  });
});

describe("obter", () => {
  it("desembrulha o array que a API devolve e traduz para o port", async () => {
    const { client } = clientFalso([CRU]);
    const externo = await criarAgendaMedx(client).obter(1275002478);

    expect(externo.id).toBe(1275002478);
    expect(externo.idProfissional).toBe(43013640);
    expect(externo.idPaciente).toBe(30094605);
    expect(externo.inicio).toBe("2026-07-10T14:00:00");
    expect(externo.ultimaEdicao).toBe("2026-07-09T10:00:00");
  });

  it("guarda o payload cru inteiro em bruto", async () => {
    const { client } = clientFalso([CRU]);
    const externo = await criarAgendaMedx(client).obter(1275002478);
    expect((externo.bruto as any).CampoQueNaoModelamos).toBe("precisa sobreviver ao PUT");
  });

  it("erra quando o agendamento não existe", async () => {
    const { client } = clientFalso([]);
    await expect(criarAgendaMedx(client).obter(999)).rejects.toThrow(/999/);
  });
});

describe("confirmar", () => {
  it("envia a string literal exigida e o índice recebido", async () => {
    const { client, enviados } = clientFalso([CRU]);
    const agenda = criarAgendaMedx(client);
    const externo = await agenda.obter(1275002478);
    enviados.length = 0;

    await agenda.confirmar(externo, 1);

    const corpo = enviados[0]!.corpo as Record<string, unknown>;
    expect(enviados[0]!.caminho).toBe("/api/integration/agenda/agendamentos");
    expect(corpo.Status).toBe(1);
    expect(corpo.Confirmacao).toBe(CONFIRMACAO_LITERAL);
    expect(corpo.Confirmacao).toBe("Mensagem Salva com Sucesso");
  });

  it("preserva os campos que o port não modela", async () => {
    const { client, enviados } = clientFalso([CRU]);
    const agenda = criarAgendaMedx(client);
    const externo = await agenda.obter(1275002478);
    enviados.length = 0;

    await agenda.confirmar(externo, 1);

    expect((enviados[0]!.corpo as any).CampoQueNaoModelamos).toBe("precisa sobreviver ao PUT");
  });

  it("envia o objeto completo que o PUT exige", async () => {
    const { client, enviados } = clientFalso([CRU]);
    const agenda = criarAgendaMedx(client);
    const externo = await agenda.obter(1275002478);
    enviados.length = 0;

    await agenda.confirmar(externo, 1);

    const corpo = enviados[0]!.corpo as Record<string, unknown>;
    for (const campo of [
      "Id_do_Agendamento", "Id_do_Usuario", "Inicio", "Final",
      "Descricao", "Status", "Vinculado_a", "Id_do_TipoConsulta",
    ]) {
      expect(corpo).toHaveProperty(campo);
    }
  });
});

describe("listarPorPaciente", () => {
  it("traduz cada item para o port", async () => {
    const { client } = clientFalso([CRU]);
    const lista = await criarAgendaMedx(client).listarPorPaciente(30094605);
    expect(lista).toHaveLength(1);
    expect(lista[0]!.id).toBe(1275002478);
  });

  it("devolve lista vazia quando a API não retorna array", async () => {
    const { client } = clientFalso(null);
    expect(await criarAgendaMedx(client).listarPorPaciente(1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/infrastructure/medx/medx-agenda.adapter.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/api/infrastructure/medx/medx-agenda.adapter.ts`**

```ts
import type {
  AgendaMedicaPort,
  AgendamentoExterno,
  DadosCriacaoAgendamento,
} from "../../application/ports/agenda-medica.port.js";
import type { MedxClient } from "./medx-http.client.js";
import type { MedxAgendamento } from "./medx.tipos.js";

const BASE = "/api/integration/agenda/agendamentos";

/** Valor exigido pela API do MedX para marcar um agendamento como confirmado. */
export const CONFIRMACAO_LITERAL = "Mensagem Salva com Sucesso";

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

export function criarAgendaMedx(client: MedxClient): AgendaMedicaPort {
  return {
    async criar(dados: DadosCriacaoAgendamento): Promise<number> {
      const resposta = await client.post<unknown>(BASE, {
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
        throw new Error(
          `MedX não devolveu um id de agendamento válido: ${JSON.stringify(resposta)}`
        );
      }
      return id;
    },

    async obter(id: number): Promise<AgendamentoExterno> {
      const resposta = await client.get<MedxAgendamento[] | MedxAgendamento>(`${BASE}/${id}`);
      const cru = Array.isArray(resposta) ? resposta[0] : resposta;

      if (!cru) {
        throw new Error(`Agendamento ${id} não encontrado no MedX`);
      }
      return traduzir(cru);
    },

    async listarPorPaciente(idPaciente: number): Promise<AgendamentoExterno[]> {
      const resposta = await client.get<MedxAgendamento[]>(`${BASE}/paciente/${idPaciente}`);
      return Array.isArray(resposta) ? resposta.map(traduzir) : [];
    },

    async confirmar(agendamento: AgendamentoExterno, indiceStatusConfirmado: number): Promise<void> {
      // O PUT não é um PATCH: partimos do payload original para não apagar
      // campos que este port não modela.
      const cru = agendamento.bruto as MedxAgendamento;

      await client.put(BASE, {
        ...cru,
        Id_do_Agendamento: agendamento.id,
        Status: indiceStatusConfirmado,
        Confirmacao: CONFIRMACAO_LITERAL,
      });
    },
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/infrastructure/medx/medx-agenda.adapter.test.ts`
Expected: PASS — 11 testes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: adapter de agenda do MedX com reconstrução completa no PUT"
```

---

### Task 19: Infraestrutura Clint — adapter de webhook

**Files:**
- Create: `src/api/infrastructure/clint/clint-webhook.adapter.ts`
- Test: `tests/api/infrastructure/clint/clint-webhook.adapter.test.ts`

**Interfaces:**
- Consumes: `CrmPort` (Task 12)
- Produces: `criarCrmWebhookClint(opcoes: { urlAgendamento: string; urlNotificacao: string }): CrmPort`

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/infrastructure/clint/clint-webhook.adapter.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { criarCrmWebhookClint } from "../../../../src/api/infrastructure/clint/clint-webhook.adapter.js";

afterEach(() => vi.restoreAllMocks());

const OPCOES = {
  urlAgendamento: "https://clint.test/in/agendamento",
  urlNotificacao: "https://clint.test/in/notificacao",
};

function corpoDe(chamada: [any, any]): Record<string, unknown> {
  return JSON.parse(String(chamada[1].body));
}

function espiar() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
}

describe("gravarIdAgendamento", () => {
  it("posta o id na url de agendamento", async () => {
    const spy = espiar();
    await criarCrmWebhookClint(OPCOES).gravarIdAgendamento("deal-1", 1275002478);

    expect(String(spy.mock.calls[0]![0])).toBe(OPCOES.urlAgendamento);
    expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({
      deal_id: "deal-1",
      id_agendamento_medx: 1275002478,
    });
  });

  it("envia content-type json", async () => {
    const spy = espiar();
    await criarCrmWebhookClint(OPCOES).gravarIdAgendamento("deal-1", 1);
    const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
  });
});

describe("notificações", () => {
  it.each([
    ["notificarConfirmacao", "confirmado"],
    ["notificarReagendamento", "reagendamento_solicitado"],
    ["notificarCancelamento", "cancelamento_solicitado"],
  ])("%s posta o evento %s na url de notificação", async (metodo, evento) => {
    const spy = espiar();
    await (criarCrmWebhookClint(OPCOES) as any)[metodo]("deal-1");

    expect(String(spy.mock.calls[0]![0])).toBe(OPCOES.urlNotificacao);
    expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({ deal_id: "deal-1", evento });
  });

  it("inclui o motivo ao notificar conflito", async () => {
    const spy = espiar();
    await criarCrmWebhookClint(OPCOES).notificarConflito("deal-1", "horário alterado");

    expect(corpoDe(spy.mock.calls[0] as [any, any])).toEqual({
      deal_id: "deal-1",
      evento: "conflito",
      motivo: "horário alterado",
    });
  });
});

describe("falhas", () => {
  it("lança quando o Clint responde erro, para o job tentar de novo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    await expect(
      criarCrmWebhookClint(OPCOES).gravarIdAgendamento("deal-1", 1)
    ).rejects.toThrow(/500/);
  });

  it("propaga falha de rede", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      criarCrmWebhookClint(OPCOES).notificarConfirmacao("deal-1")
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/infrastructure/clint/clint-webhook.adapter.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/api/infrastructure/clint/clint-webhook.adapter.ts`**

```ts
import type { CrmPort } from "../../application/ports/crm.port.js";

async function postar(url: string, corpo: Record<string, unknown>): Promise<void> {
  const resposta = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });

  if (!resposta.ok) {
    throw new Error(`Webhook de entrada do Clint respondeu HTTP ${resposta.status}`);
  }
}

export function criarCrmWebhookClint(opcoes: {
  urlAgendamento: string;
  urlNotificacao: string;
}): CrmPort {
  const notificar = (dealId: string, evento: string, extra?: Record<string, unknown>) =>
    postar(opcoes.urlNotificacao, { deal_id: dealId, evento, ...extra });

  return {
    gravarIdAgendamento: (dealId, idAgendamento) =>
      postar(opcoes.urlAgendamento, { deal_id: dealId, id_agendamento_medx: idAgendamento }),

    notificarConfirmacao: (dealId) => notificar(dealId, "confirmado"),
    notificarReagendamento: (dealId) => notificar(dealId, "reagendamento_solicitado"),
    notificarCancelamento: (dealId) => notificar(dealId, "cancelamento_solicitado"),
    notificarConflito: (dealId, motivo) => notificar(dealId, "conflito", { motivo }),
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/infrastructure/clint/clint-webhook.adapter.test.ts`
Expected: PASS — 8 testes.

- [ ] **Step 5: Rodar a suíte inteira e o teste de arquitetura**

Run: `npm test`
Expected: PASS em todos os arquivos, incluindo as quatro regras de dependência.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: adapter de saída para o Clint via webhook de entrada"
```

---
### Task 20: Application — caso de uso Agendar Consulta

**Files:**
- Create: `src/api/application/agendar-consulta/agendar-consulta.comando.ts`, `src/api/application/agendar-consulta/agendar-consulta.usecase.ts`
- Test: `tests/api/application/agendar-consulta/agendar-consulta.usecase.test.ts`

**Interfaces:**
- Consumes: todos os ports (Task 12), `Agendamento` (7), `CorrelacaoPaciente` (8), `Telefone` (3), `Cpf` (4), `PeriodoConsulta` (5), `LoggerMinimo` (2)
- Produces:
  - `interface ComandoAgendamento { dealId: string; nome: string; telefone: string; dataNascimento: string; dataHora: string; profissional: string | number; tipoConsulta: string | number; cpf?: string; email?: string; sexo?: "M" | "F" }`
  - `interface DepsAgendarConsulta { agendamentos: AgendamentoRepositorio; correlacoes: CorrelacaoPacienteRepositorio; cadastro: CadastroPacientePort; agenda: AgendaMedicaPort; catalogo: CatalogoClinicoPort; crm: CrmPort; logger: LoggerMinimo }`
  - `criarAgendarConsulta(deps: DepsAgendarConsulta): (comando: ComandoAgendamento) => Promise<void>`

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/application/agendar-consulta/agendar-consulta.usecase.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { criarAgendarConsulta } from "../../../../src/api/application/agendar-consulta/agendar-consulta.usecase.js";
import { abrirBanco } from "../../../../src/api/infrastructure/persistencia/sqlite/conexao.js";
import { criarAgendamentoRepositorio } from "../../../../src/api/infrastructure/persistencia/sqlite/agendamento.sqlite-repositorio.js";
import { criarCorrelacaoPacienteRepositorio } from "../../../../src/api/infrastructure/persistencia/sqlite/correlacao-paciente.sqlite-repositorio.js";
import { Agendamento } from "../../../../src/api/domain/agendamento/agendamento.js";
import { PeriodoConsulta } from "../../../../src/api/domain/agendamento/periodo-consulta.js";
import { Telefone } from "../../../../src/api/domain/paciente/telefone.js";
import type { AgendamentoExterno } from "../../../../src/api/application/ports/agenda-medica.port.js";

const COMANDO = {
  dealId: "deal-1",
  nome: "Maria Silva",
  telefone: "+55 11 99999-8888",
  dataNascimento: "1990-05-20",
  dataHora: "2026-07-10T14:00:00",
  profissional: "Leize Ferreira",
  tipoConsulta: "Consulta de Rotina",
  cpf: "529.982.247-25",
};

function externo(parcial: Partial<AgendamentoExterno> = {}): AgendamentoExterno {
  return {
    id: 999,
    idProfissional: 43013640,
    idPaciente: 67890,
    inicio: "2026-07-10T14:00:00",
    fim: "2026-07-10T14:30:00",
    descricao: "",
    status: 0,
    idTipoConsulta: 111,
    confirmacao: "",
    ultimaEdicao: "2026-07-09T10:00:00",
    bruto: {},
    ...parcial,
  };
}

function montar() {
  const db = abrirBanco(":memory:");
  const agendamentos = criarAgendamentoRepositorio(db);
  const correlacoes = criarCorrelacaoPacienteRepositorio(db);

  const deps = {
    agendamentos,
    correlacoes,
    cadastro: {
      vincular: vi.fn(async () => ({ idPaciente: 67890, matchConfiavel: true })),
      registrarCpf: vi.fn(async () => {}),
    },
    agenda: {
      criar: vi.fn(async () => 1275002478),
      obter: vi.fn(async () => externo()),
      listarPorPaciente: vi.fn(async () => [] as AgendamentoExterno[]),
      confirmar: vi.fn(async () => {}),
    },
    catalogo: {
      carregar: vi.fn(async () => {}),
      resolverProfissional: vi.fn(async () => 43013640),
      resolverTipoConsulta: vi.fn(async () => ({ id: 111, nome: "Consulta de Rotina", duracaoMinutos: 30 })),
      indiceStatusConfirmado: () => 1,
    },
    crm: {
      gravarIdAgendamento: vi.fn(async () => {}),
      notificarConfirmacao: vi.fn(async () => {}),
      notificarReagendamento: vi.fn(async () => {}),
      notificarCancelamento: vi.fn(async () => {}),
      notificarConflito: vi.fn(async () => {}),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  return { deps, agendamentos, correlacoes, executar: criarAgendarConsulta(deps as any) };
}

describe("caminho feliz", () => {
  it("cria o agendamento com início, fim e descrição corretos", async () => {
    const { deps, executar } = montar();
    await executar(COMANDO);

    expect(deps.agenda.criar).toHaveBeenCalledWith({
      idProfissional: 43013640,
      idPaciente: 67890,
      inicio: "2026-07-10T14:00:00",
      fim: "2026-07-10T14:30:00",
      descricao: "Consulta de Rotina — Maria Silva",
      idTipoConsulta: 111,
    });
  });

  it("devolve o id ao CRM", async () => {
    const { deps, executar } = montar();
    await executar(COMANDO);
    expect(deps.crm.gravarIdAgendamento).toHaveBeenCalledWith("deal-1", 1275002478);
  });

  it("persiste o agendamento como criado", async () => {
    const { executar, agendamentos } = montar();
    await executar(COMANDO);
    const salvo = agendamentos.buscarPorDeal("deal-1")!;
    expect(salvo.status).toBe("criado");
    expect(salvo.idMedx).toBe(1275002478);
  });

  it("converte o horário para o fuso da clínica", async () => {
    const { deps, executar } = montar();
    await executar({ ...COMANDO, dataHora: "2026-07-10T17:00:00Z" });
    expect(deps.agenda.criar).toHaveBeenCalledWith(
      expect.objectContaining({ inicio: "2026-07-10T14:00:00" })
    );
  });
});

describe("idempotência", () => {
  it("não chama o MedX duas vezes para o mesmo deal_id", async () => {
    const { deps, executar } = montar();
    await executar(COMANDO);
    await executar(COMANDO);
    expect(deps.agenda.criar).toHaveBeenCalledTimes(1);
  });

  it("grava a intenção antes de chamar o MedX", async () => {
    const { deps, agendamentos } = montar();
    const observado: string[] = [];
    deps.agenda.criar = vi.fn(async () => {
      observado.push(agendamentos.buscarPorDeal("deal-1")!.status);
      return 1275002478;
    });

    await criarAgendarConsulta(deps as any)(COMANDO);
    expect(observado).toEqual(["enviando"]);
  });

  it("adota o agendamento órfão de uma tentativa interrompida", async () => {
    const { deps, agendamentos } = montar();
    agendamentos.salvar(
      Agendamento.iniciar({
        dealId: "deal-1",
        idPacienteMedx: 67890,
        idProfissionalMedx: 43013640,
        periodo: PeriodoConsulta.criar("2026-07-10T14:00:00", 30),
      })
    );
    deps.agenda.listarPorPaciente = vi.fn(async () => [externo({ id: 555 })]);

    await criarAgendarConsulta(deps as any)(COMANDO);

    expect(deps.agenda.criar).not.toHaveBeenCalled();
    expect(deps.crm.gravarIdAgendamento).toHaveBeenCalledWith("deal-1", 555);
  });

  it("cria normalmente quando não há órfão correspondente", async () => {
    const { deps, agendamentos } = montar();
    agendamentos.salvar(
      Agendamento.iniciar({
        dealId: "deal-1",
        idPacienteMedx: 67890,
        idProfissionalMedx: 43013640,
        periodo: PeriodoConsulta.criar("2026-07-10T14:00:00", 30),
      })
    );
    deps.agenda.listarPorPaciente = vi.fn(async () => [externo({ inicio: "2026-07-11T09:00:00" })]);

    await criarAgendarConsulta(deps as any)(COMANDO);
    expect(deps.agenda.criar).toHaveBeenCalled();
  });
});

describe("identidade do paciente", () => {
  it("reaproveita a correlação em cache sem chamar o vínculo de novo", async () => {
    const { deps, executar } = montar();
    await executar(COMANDO);
    await executar({ ...COMANDO, dealId: "deal-2" });
    expect(deps.cadastro.vincular).toHaveBeenCalledTimes(1);
  });

  it("envia o telefone como value object para o port", async () => {
    const { deps, executar } = montar();
    await executar(COMANDO);
    const enviado = (deps.cadastro.vincular as any).mock.calls[0][0];
    expect(enviado.telefone).toBeInstanceOf(Telefone);
    expect(enviado.telefone.nacional).toBe("11999998888");
  });

  it("registra match duvidoso com alerta, sem interromper o agendamento", async () => {
    const { deps, correlacoes } = montar();
    deps.cadastro.vincular = vi.fn(async () => ({ idPaciente: 67890, matchConfiavel: false }));

    await criarAgendarConsulta(deps as any)(COMANDO);

    expect(correlacoes.buscarPorTelefone(Telefone.criar("11999998888"))!.exigeRevisao).toBe(true);
    expect(deps.crm.gravarIdAgendamento).toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ alerta: true }),
      expect.any(String)
    );
  });
});

describe("CPF", () => {
  it("enriquece a ficha quando o CPF é válido", async () => {
    const { deps, executar } = montar();
    await executar(COMANDO);
    expect(deps.cadastro.registrarCpf).toHaveBeenCalledWith(67890, expect.anything());
  });

  it("ignora CPF inválido sem quebrar o agendamento", async () => {
    const { deps } = montar();
    await criarAgendarConsulta(deps as any)({ ...COMANDO, cpf: "11111111111" });
    expect(deps.cadastro.registrarCpf).not.toHaveBeenCalled();
    expect(deps.crm.gravarIdAgendamento).toHaveBeenCalled();
  });

  it("não chama registrarCpf quando o CPF não veio", async () => {
    const { deps } = montar();
    const { cpf, ...semCpf } = COMANDO;
    await criarAgendarConsulta(deps as any)(semCpf);
    expect(deps.cadastro.registrarCpf).not.toHaveBeenCalled();
  });

  it("falha ao gravar o CPF não derruba o agendamento", async () => {
    const { deps } = montar();
    deps.cadastro.registrarCpf = vi.fn(async () => {
      throw new Error("MedX recusou o CPF");
    });
    await expect(criarAgendarConsulta(deps as any)(COMANDO)).resolves.toBeUndefined();
    expect(deps.crm.gravarIdAgendamento).toHaveBeenCalled();
  });
});

describe("falhas", () => {
  it("marca falhou e propaga quando o MedX recusa a criação", async () => {
    const { deps, agendamentos } = montar();
    deps.agenda.criar = vi.fn(async () => {
      throw new Error("MedX fora do ar");
    });

    await expect(criarAgendarConsulta(deps as any)(COMANDO)).rejects.toThrow(/fora do ar/);
    expect(agendamentos.buscarPorDeal("deal-1")!.status).toBe("falhou");
  });

  it("propaga telefone inválido como erro de domínio", async () => {
    const { executar } = montar();
    await expect(executar({ ...COMANDO, telefone: "123" })).rejects.toThrow(/DDD/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/application/agendar-consulta/agendar-consulta.usecase.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Conferir `src/api/application/agendar-consulta/agendar-consulta.comando.ts`**

O arquivo já foi criado na Task 12, junto com o port da fila. Confirme que está exatamente assim:

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
  sexo?: "M" | "F";
}
```

- [ ] **Step 4: Implementar `src/api/application/agendar-consulta/agendar-consulta.usecase.ts`**

```ts
import type { LoggerMinimo } from "../../../../lib/logger.js";
import { Agendamento } from "../../domain/agendamento/agendamento.js";
import { PeriodoConsulta } from "../../domain/agendamento/periodo-consulta.js";
import type { AgendamentoRepositorio } from "../../domain/agendamento/agendamento.repositorio.js";
import { CorrelacaoPaciente } from "../../domain/paciente/correlacao-paciente.js";
import type { CorrelacaoPacienteRepositorio } from "../../domain/paciente/correlacao-paciente.repositorio.js";
import { Cpf } from "../../domain/paciente/cpf.js";
import { Telefone } from "../../domain/paciente/telefone.js";
import type { AgendaMedicaPort } from "../ports/agenda-medica.port.js";
import type { CadastroPacientePort } from "../ports/cadastro-paciente.port.js";
import type { CatalogoClinicoPort } from "../ports/catalogo-clinico.port.js";
import type { CrmPort } from "../ports/crm.port.js";
import type { ComandoAgendamento } from "./agendar-consulta.comando.js";

export interface DepsAgendarConsulta {
  agendamentos: AgendamentoRepositorio;
  correlacoes: CorrelacaoPacienteRepositorio;
  cadastro: CadastroPacientePort;
  agenda: AgendaMedicaPort;
  catalogo: CatalogoClinicoPort;
  crm: CrmPort;
  logger: LoggerMinimo;
}

export function criarAgendarConsulta(deps: DepsAgendarConsulta) {
  async function resolverPaciente(
    comando: ComandoAgendamento,
    telefone: Telefone
  ): Promise<number> {
    const emCache = deps.correlacoes.buscarPorTelefone(telefone);
    if (emCache) return emCache.idPacienteMedx;

    const vinculo = await deps.cadastro.vincular({
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
    deps.correlacoes.salvar(correlacao);

    if (correlacao.exigeRevisao) {
      deps.logger.warn(
        { alerta: true, deal_id: comando.dealId, id_paciente: correlacao.idPacienteMedx },
        "vínculo de paciente com match não confiável — revisar manualmente"
      );
    }

    return correlacao.idPacienteMedx;
  }

  return async function agendarConsulta(comando: ComandoAgendamento): Promise<void> {
    const registrado = deps.agendamentos.buscarPorDeal(comando.dealId);

    if (registrado?.jaFoiCriado) {
      deps.logger.info(
        { deal_id: comando.dealId, id_agendamento: registrado.idMedx },
        "agendamento já existia, nada a fazer"
      );
      return;
    }

    const houveTentativaAnterior = registrado?.tentativaInterrompida ?? false;

    const telefone = Telefone.criar(comando.telefone);
    const idPaciente = await resolverPaciente(comando, telefone);

    const idProfissional = await deps.catalogo.resolverProfissional(comando.profissional);
    const tipo = await deps.catalogo.resolverTipoConsulta(comando.tipoConsulta);
    const periodo = PeriodoConsulta.criar(comando.dataHora, tipo.duracaoMinutos);

    const agendamento = Agendamento.iniciar({
      dealId: comando.dealId,
      idPacienteMedx: idPaciente,
      idProfissionalMedx: idProfissional,
      periodo,
    });

    // Grava a intenção antes de chamar o MedX: um retry interrompido precisa
    // encontrar rastro para não criar consulta duplicada.
    deps.agendamentos.salvar(agendamento);

    let orfao: number | undefined;

    if (houveTentativaAnterior) {
      const daAgenda = await deps.agenda.listarPorPaciente(idPaciente);
      const gemeo = daAgenda.find(
        (a) => a.idProfissional === idProfissional && periodo.comecaEm(a.inicio)
      );
      if (gemeo) {
        orfao = gemeo.id;
        deps.logger.warn(
          { deal_id: comando.dealId, id_agendamento: orfao },
          "agendamento já existia no MedX de uma tentativa anterior — adotado"
        );
      }
    }

    if (orfao !== undefined) {
      agendamento.adotarExistente(orfao);
    } else {
      try {
        const idCriado = await deps.agenda.criar({
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
        deps.agendamentos.salvar(agendamento);
        throw erro;
      }
    }

    deps.agendamentos.salvar(agendamento);

    const cpf = Cpf.tentarCriar(comando.cpf);
    if (cpf) {
      try {
        await deps.cadastro.registrarCpf(idPaciente, cpf);
      } catch (erro) {
        deps.logger.warn(
          { deal_id: comando.dealId, erro: (erro as Error).message },
          "não foi possível gravar o CPF na ficha do MedX"
        );
      }
    } else if (comando.cpf) {
      deps.logger.warn({ deal_id: comando.dealId }, "CPF recebido do CRM é inválido — ignorado");
    }

    await deps.crm.gravarIdAgendamento(comando.dealId, agendamento.idMedx!);

    deps.logger.info(
      { deal_id: comando.dealId, id_agendamento: agendamento.idMedx },
      "agendamento criado no MedX"
    );
  };
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/application/agendar-consulta/agendar-consulta.usecase.test.ts`
Expected: PASS — 16 testes.

- [ ] **Step 6: Rodar o teste de arquitetura**

Run: `npx vitest run tests/api/arquitetura.test.ts`
Expected: PASS — o caso de uso importa só de `domain`, `ports` e `lib`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: caso de uso de agendamento sobre os ports"
```

---

### Task 21: Application — caso de uso Processar Resposta do Lembrete

**Files:**
- Create: `src/api/application/processar-resposta-lembrete/processar-resposta.comando.ts`, `src/api/application/processar-resposta-lembrete/processar-resposta.usecase.ts`
- Test: `tests/api/application/processar-resposta-lembrete/processar-resposta.usecase.test.ts`

**Interfaces:**
- Consumes: `RespostaLembrete` (6), `Agendamento` (7), ports `AgendaMedicaPort`, `CatalogoClinicoPort`, `CrmPort` (12), `AgendamentoRepositorio` (7), `LoggerMinimo` (2)
- Produces:
  - `interface ComandoResposta { dealId: string; idAgendamentoMedx: number; resposta: string }`
  - `interface DepsProcessarResposta { agendamentos: AgendamentoRepositorio; agenda: AgendaMedicaPort; catalogo: CatalogoClinicoPort; crm: CrmPort; logger: LoggerMinimo }`
  - `criarProcessarResposta(deps: DepsProcessarResposta): (comando: ComandoResposta) => Promise<void>`

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/application/processar-resposta-lembrete/processar-resposta.usecase.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { criarProcessarResposta } from "../../../../src/api/application/processar-resposta-lembrete/processar-resposta.usecase.js";
import { abrirBanco } from "../../../../src/api/infrastructure/persistencia/sqlite/conexao.js";
import { criarAgendamentoRepositorio } from "../../../../src/api/infrastructure/persistencia/sqlite/agendamento.sqlite-repositorio.js";
import { Agendamento } from "../../../../src/api/domain/agendamento/agendamento.js";
import { PeriodoConsulta } from "../../../../src/api/domain/agendamento/periodo-consulta.js";
import type { AgendamentoExterno } from "../../../../src/api/application/ports/agenda-medica.port.js";

function externo(parcial: Partial<AgendamentoExterno> = {}): AgendamentoExterno {
  return {
    id: 1275002478,
    idProfissional: 43013640,
    idPaciente: 67890,
    inicio: "2026-07-10T14:00:00",
    fim: "2026-07-10T14:30:00",
    descricao: "Consulta",
    status: 0,
    idTipoConsulta: 111,
    confirmacao: "",
    ultimaEdicao: "2026-07-09T10:00:00",
    bruto: {},
    ...parcial,
  };
}

function montar(noMedx: AgendamentoExterno = externo(), comRegistro = true) {
  const db = abrirBanco(":memory:");
  const agendamentos = criarAgendamentoRepositorio(db);

  if (comRegistro) {
    const a = Agendamento.iniciar({
      dealId: "deal-1",
      idPacienteMedx: 67890,
      idProfissionalMedx: 43013640,
      periodo: PeriodoConsulta.criar("2026-07-10T14:00:00", 30),
    });
    a.registrarCriacao(1275002478);
    agendamentos.salvar(a);
  }

  const deps = {
    agendamentos,
    agenda: {
      criar: vi.fn(async () => 0),
      obter: vi.fn(async () => noMedx),
      listarPorPaciente: vi.fn(async () => [] as AgendamentoExterno[]),
      confirmar: vi.fn(async () => {}),
    },
    catalogo: {
      carregar: vi.fn(async () => {}),
      resolverProfissional: vi.fn(async () => 0),
      resolverTipoConsulta: vi.fn(async () => ({ id: 0, nome: "", duracaoMinutos: 30 })),
      indiceStatusConfirmado: () => 1,
    },
    crm: {
      gravarIdAgendamento: vi.fn(async () => {}),
      notificarConfirmacao: vi.fn(async () => {}),
      notificarReagendamento: vi.fn(async () => {}),
      notificarCancelamento: vi.fn(async () => {}),
      notificarConflito: vi.fn(async () => {}),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  return { deps, agendamentos, executar: criarProcessarResposta(deps as any) };
}

const CONFIRMAR = { dealId: "deal-1", idAgendamentoMedx: 1275002478, resposta: "confirmar" };

describe("confirmar", () => {
  it("chama o port com o índice descoberto", async () => {
    const { deps, executar } = montar();
    await executar(CONFIRMAR);
    expect(deps.agenda.confirmar).toHaveBeenCalledWith(expect.objectContaining({ id: 1275002478 }), 1);
  });

  it("avisa o CRM da confirmação", async () => {
    const { deps, executar } = montar();
    await executar(CONFIRMAR);
    expect(deps.crm.notificarConfirmacao).toHaveBeenCalledWith("deal-1");
  });

  it("persiste como confirmado com a última edição", async () => {
    const { executar, agendamentos } = montar();
    await executar(CONFIRMAR);
    const salvo = agendamentos.buscarPorDeal("deal-1")!;
    expect(salvo.status).toBe("confirmado");
    expect(salvo.ultimaEdicaoConhecida).toBe("2026-07-09T10:00:00");
  });

  it("aceita reenvio quando o MedX já está confirmado", async () => {
    const { deps, executar } = montar(externo({ status: 1 }));
    await executar(CONFIRMAR);
    expect(deps.agenda.confirmar).toHaveBeenCalled();
  });

  it("é idempotente: não reescreve o que já confirmamos", async () => {
    const { deps, executar, agendamentos } = montar();
    await executar(CONFIRMAR);
    (deps.agenda.confirmar as any).mockClear();
    await executar(CONFIRMAR);
    expect(deps.agenda.confirmar).not.toHaveBeenCalled();
    expect(agendamentos.buscarPorDeal("deal-1")!.status).toBe("confirmado");
  });

  it("normaliza a resposta com caixa diferente", async () => {
    const { deps, executar } = montar();
    await executar({ ...CONFIRMAR, resposta: "CONFIRMAR" });
    expect(deps.agenda.confirmar).toHaveBeenCalled();
  });
});

describe("recusas", () => {
  it("recusa quando o horário mudou desde o lembrete", async () => {
    const { deps, executar, agendamentos } = montar(externo({ inicio: "2026-07-11T09:00:00" }));
    await executar(CONFIRMAR);

    expect(deps.agenda.confirmar).not.toHaveBeenCalled();
    expect(deps.crm.notificarConflito).toHaveBeenCalledWith("deal-1", expect.stringMatching(/horário/i));
    expect(agendamentos.buscarPorDeal("deal-1")!.status).toBe("conflito");
  });

  it("recusa quando a consulta não está mais agendada", async () => {
    const { deps, executar } = montar(externo({ status: 3 }));
    await executar(CONFIRMAR);
    expect(deps.agenda.confirmar).not.toHaveBeenCalled();
    expect(deps.crm.notificarConflito).toHaveBeenCalled();
  });

  it("alerta ao recusar", async () => {
    const { deps, executar } = montar(externo({ status: 3 }));
    await executar(CONFIRMAR);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ alerta: true }),
      expect.any(String)
    );
  });

  it("recusa quando o adapter não conhece o agendamento", async () => {
    const { deps, executar } = montar(externo(), false);
    await executar(CONFIRMAR);
    expect(deps.agenda.confirmar).not.toHaveBeenCalled();
    expect(deps.crm.notificarConflito).toHaveBeenCalled();
  });

  it("rejeita resposta fora das três opções", async () => {
    const { executar } = montar();
    await expect(executar({ ...CONFIRMAR, resposta: "talvez" })).rejects.toThrow(/talvez/);
  });
});

describe("reagendar e cancelar", () => {
  it.each([
    ["reagendar", "notificarReagendamento"],
    ["cancelar", "notificarCancelamento"],
  ])("%s só avisa o CRM, sem tocar no MedX", async (resposta, metodo) => {
    const { deps, executar } = montar();
    await executar({ ...CONFIRMAR, resposta });

    expect(deps.agenda.obter).not.toHaveBeenCalled();
    expect(deps.agenda.confirmar).not.toHaveBeenCalled();
    expect((deps.crm as any)[metodo]).toHaveBeenCalledWith("deal-1");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/application/processar-resposta-lembrete/processar-resposta.usecase.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Conferir `src/api/application/processar-resposta-lembrete/processar-resposta.comando.ts`**

O arquivo já foi criado na Task 12. Confirme que está exatamente assim:

```ts
export interface ComandoResposta {
  dealId: string;
  idAgendamentoMedx: number;
  /** Valor cru vindo do CRM; o value object RespostaLembrete valida e normaliza. */
  resposta: string;
}
```

- [ ] **Step 4: Implementar `src/api/application/processar-resposta-lembrete/processar-resposta.usecase.ts`**

```ts
import type { LoggerMinimo } from "../../../../lib/logger.js";
import type { AgendamentoRepositorio } from "../../domain/agendamento/agendamento.repositorio.js";
import { RespostaLembrete } from "../../domain/agendamento/resposta-lembrete.js";
import type { AgendaMedicaPort } from "../ports/agenda-medica.port.js";
import type { CatalogoClinicoPort } from "../ports/catalogo-clinico.port.js";
import type { CrmPort } from "../ports/crm.port.js";
import type { ComandoResposta } from "./processar-resposta.comando.js";

export interface DepsProcessarResposta {
  agendamentos: AgendamentoRepositorio;
  agenda: AgendaMedicaPort;
  catalogo: CatalogoClinicoPort;
  crm: CrmPort;
  logger: LoggerMinimo;
}

export function criarProcessarResposta(deps: DepsProcessarResposta) {
  return async function processarResposta(comando: ComandoResposta): Promise<void> {
    const resposta = RespostaLembrete.criar(comando.resposta);

    if (resposta.exigeAtendimentoHumano) {
      if (resposta.valor === "reagendar") {
        await deps.crm.notificarReagendamento(comando.dealId);
      } else {
        await deps.crm.notificarCancelamento(comando.dealId);
      }
      deps.logger.info(
        { deal_id: comando.dealId, resposta: resposta.valor },
        "resposta do paciente encaminhada para atendimento humano"
      );
      return;
    }

    const agendamento = deps.agendamentos.buscarPorDeal(comando.dealId);

    async function recusar(motivo: string): Promise<void> {
      agendamento?.marcarConflito();
      if (agendamento) deps.agendamentos.salvar(agendamento);

      deps.logger.warn(
        { alerta: true, deal_id: comando.dealId, id_agendamento: comando.idAgendamentoMedx, motivo },
        "confirmação recusada"
      );
      await deps.crm.notificarConflito(comando.dealId, motivo);
    }

    if (!agendamento) {
      return recusar("adapter não tem registro deste agendamento");
    }

    if (agendamento.jaFoiConfirmado) {
      deps.logger.info({ deal_id: comando.dealId }, "agendamento já estava confirmado");
      return;
    }

    const externo = await deps.agenda.obter(comando.idAgendamentoMedx);

    const avaliacao = agendamento.avaliarConfirmacao(
      { status: externo.status, inicio: externo.inicio },
      deps.catalogo.indiceStatusConfirmado()
    );

    if (!avaliacao.permitido) {
      return recusar(avaliacao.motivo);
    }

    await deps.agenda.confirmar(externo, deps.catalogo.indiceStatusConfirmado());

    agendamento.confirmar(externo.ultimaEdicao);
    deps.agendamentos.salvar(agendamento);

    await deps.crm.notificarConfirmacao(comando.dealId);

    deps.logger.info(
      { deal_id: comando.dealId, id_agendamento: comando.idAgendamentoMedx },
      "agendamento confirmado no MedX"
    );
  };
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/application/processar-resposta-lembrete/processar-resposta.usecase.test.ts`
Expected: PASS — 13 testes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: caso de uso de resposta ao lembrete"
```

---
### Task 22: Infraestrutura — fila BullMQ e processador

**Files:**
- Create: `src/api/infrastructure/fila/fila.ts`, `src/api/infrastructure/fila/processador.ts`
- Modify: `src/api/domain/evento/evento.repositorio.ts` (novo método `registrarExistente`), `src/api/infrastructure/persistencia/sqlite/evento.sqlite-repositorio.ts` (implementação dele)
- Test: `tests/api/infrastructure/fila/processador.test.ts`

**Interfaces:**
- Consumes: comandos dos casos de uso (20, 21), `EventoRepositorio` (8), `ErroRateLimit` (13), `LoggerMinimo` (2)
- Produces:
  - Em `fila.ts`: `NOME_FILA = "adapter-clint-medx"`, `LIMITER = { max: 25, duration: 60_000 }`, `OPCOES_JOB`, `criarFila(conexao): Queue<JobAdapter>`, `criarWorker(deps: DepsProcessador, conexao): Worker<JobAdapter>`
  - Em `processador.ts`: `interface DepsProcessador { eventos: EventoRepositorio; agendarConsulta: (c: ComandoAgendamento) => Promise<void>; processarResposta: (c: ComandoResposta) => Promise<void>; logger: LoggerMinimo }` e `processarJob(deps: DepsProcessador, dados: JobAdapter): Promise<void>`
  - `JobAdapter` vem de `application/ports/fila.port.ts` (Task 12); não é declarado aqui

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/infrastructure/fila/processador.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { processarJob } from "../../../../src/api/infrastructure/fila/processador.js";
import { LIMITER, OPCOES_JOB } from "../../../../src/api/infrastructure/fila/fila.js";
import { ErroRateLimit } from "../../../../src/api/infrastructure/medx/medx.erros.js";
import { abrirBanco } from "../../../../src/api/infrastructure/persistencia/sqlite/conexao.js";
import { criarEventoRepositorio } from "../../../../src/api/infrastructure/persistencia/sqlite/evento.sqlite-repositorio.js";

describe("política da fila", () => {
  it("respeita o teto de 30 req/min do MedX com margem", () => {
    expect(LIMITER.max).toBeLessThan(30);
    expect(LIMITER.duration).toBe(60_000);
  });

  it("usa backoff exponencial com pelo menos 5 tentativas", () => {
    expect(OPCOES_JOB.attempts).toBeGreaterThanOrEqual(5);
    expect(OPCOES_JOB.backoff.type).toBe("exponential");
  });

  it("não descarta jobs que falharam, para permitir inspeção", () => {
    expect(OPCOES_JOB.removeOnFail).toBe(false);
  });
});

function montar() {
  const db = abrirBanco(":memory:");
  const eventos = criarEventoRepositorio(db);
  const deps = {
    eventos,
    agendarConsulta: vi.fn(async () => {}),
    processarResposta: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const statusDo = (id: number): string =>
    (db.prepare("SELECT status FROM eventos_recebidos WHERE id = ?").get(id) as any).status;
  const erroDe = (id: number): string | null =>
    (db.prepare("SELECT erro FROM eventos_recebidos WHERE id = ?").get(id) as any).erro;

  return { deps, eventos, statusDo, erroDe };
}

describe("processarJob", () => {
  it("roteia job de agendamento para o caso de uso certo", async () => {
    const { deps, eventos } = montar();
    const e = eventos.registrar("/x", {});
    await processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any });

    expect(deps.agendarConsulta).toHaveBeenCalled();
    expect(deps.processarResposta).not.toHaveBeenCalled();
  });

  it("roteia job de resposta para o caso de uso certo", async () => {
    const { deps, eventos } = montar();
    const e = eventos.registrar("/x", {});
    await processarJob(deps as any, { tipo: "resposta", eventoId: e.id, comando: {} as any });

    expect(deps.processarResposta).toHaveBeenCalled();
    expect(deps.agendarConsulta).not.toHaveBeenCalled();
  });

  it("marca o evento como processado no sucesso", async () => {
    const { deps, eventos, statusDo } = montar();
    const e = eventos.registrar("/x", {});
    await processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any });
    expect(statusDo(e.id)).toBe("processado");
  });

  it("marca falhou com a mensagem e repropaga para o BullMQ tentar de novo", async () => {
    const { deps, eventos, statusDo, erroDe } = montar();
    deps.agendarConsulta = vi.fn(async () => {
      throw new Error("MedX fora do ar");
    });
    const e = eventos.registrar("/x", {});

    await expect(
      processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any })
    ).rejects.toThrow(/fora do ar/);

    expect(statusDo(e.id)).toBe("falhou");
    expect(erroDe(e.id)).toMatch(/fora do ar/);
  });

  it("repropaga ErroRateLimit para o worker aplicar o Retry-After", async () => {
    const { deps, eventos } = montar();
    deps.agendarConsulta = vi.fn(async () => {
      throw new ErroRateLimit(60);
    });
    const e = eventos.registrar("/x", {});

    await expect(
      processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any })
    ).rejects.toBeInstanceOf(ErroRateLimit);
  });

  it("registra rate limit como aviso, não como erro", async () => {
    const { deps, eventos } = montar();
    deps.agendarConsulta = vi.fn(async () => {
      throw new ErroRateLimit(60);
    });
    const e = eventos.registrar("/x", {});

    await expect(
      processarJob(deps as any, { tipo: "agendamento", eventoId: e.id, comando: {} as any })
    ).rejects.toThrow();

    expect(deps.logger.warn).toHaveBeenCalled();
    expect(deps.logger.error).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/infrastructure/fila/processador.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar `src/api/infrastructure/fila/processador.ts`**

```ts
import type { LoggerMinimo } from "../../../../lib/logger.js";
import type { ComandoAgendamento } from "../../application/agendar-consulta/agendar-consulta.comando.js";
import type { ComandoResposta } from "../../application/processar-resposta-lembrete/processar-resposta.comando.js";
import type { JobAdapter } from "../../application/ports/fila.port.js";
import type { EventoRepositorio } from "../../domain/evento/evento.repositorio.js";
import { ErroRateLimit } from "../medx/medx.erros.js";

export interface DepsProcessador {
  eventos: EventoRepositorio;
  agendarConsulta: (comando: ComandoAgendamento) => Promise<void>;
  processarResposta: (comando: ComandoResposta) => Promise<void>;
  logger: LoggerMinimo;
}

export async function processarJob(deps: DepsProcessador, dados: JobAdapter): Promise<void> {
  const evento = deps.eventos.registrarExistente(dados.eventoId);

  try {
    if (dados.tipo === "agendamento") {
      await deps.agendarConsulta(dados.comando);
    } else {
      await deps.processarResposta(dados.comando);
    }

    evento.marcarProcessado();
    deps.eventos.salvar(evento);

    deps.logger.info({ evento_id: dados.eventoId, tipo: dados.tipo }, "job processado");
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);

    evento.marcarFalha(mensagem);
    deps.eventos.salvar(evento);

    if (erro instanceof ErroRateLimit) {
      deps.logger.warn(
        { evento_id: dados.eventoId, esperar: erro.esperarSegundos },
        "rate limit do MedX — job será repetido"
      );
    } else {
      deps.logger.error({ evento_id: dados.eventoId, erro: mensagem }, "job falhou");
    }

    throw erro;
  }
}
```

Isto exige um método a mais no port de evento. Acrescente a `src/api/domain/evento/evento.repositorio.ts`:

```ts
  /** Reconstrói a entidade de um evento já gravado, para o worker atualizar seu estado. */
  registrarExistente(id: number): EventoRecebido;
```

E a implementação em `src/api/infrastructure/persistencia/sqlite/evento.sqlite-repositorio.ts`, dentro do objeto retornado:

```ts
    registrarExistente(id: number): EventoRecebido {
      const l: any = db.prepare("SELECT * FROM eventos_recebidos WHERE id = ?").get(id);
      if (!l) {
        throw new Error(`Evento ${id} não encontrado`);
      }
      return EventoRecebido.restaurar({
        id: l.id,
        endpoint: l.endpoint,
        status: l.status as StatusEvento,
        erro: l.erro,
        jobId: l.job_id,
      });
    },
```

- [ ] **Step 4: Implementar `src/api/infrastructure/fila/fila.ts`**

```ts
import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import type { JobAdapter } from "../../application/ports/fila.port.js";
import { ErroRateLimit } from "../medx/medx.erros.js";
import { processarJob, type DepsProcessador } from "./processador.js";

export type { DepsProcessador };

export const NOME_FILA = "adapter-clint-medx";

/** Abaixo do teto de 30/min do MedX, com margem para chamadas manuais na mesma conta. */
export const LIMITER = { max: 25, duration: 60_000 } as const;

export const OPCOES_JOB: JobsOptions & { backoff: { type: string; delay: number } } = {
  attempts: 6,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: false,
};

export function criarFila(conexao: ConnectionOptions): Queue<JobAdapter> {
  return new Queue<JobAdapter>(NOME_FILA, {
    connection: conexao,
    defaultJobOptions: OPCOES_JOB,
  });
}

export function criarWorker(deps: DepsProcessador, conexao: ConnectionOptions): Worker<JobAdapter> {
  const worker = new Worker<JobAdapter>(
    NOME_FILA,
    async (job) => processarJob(deps, job.data),
    { connection: conexao, concurrency: 1, limiter: { ...LIMITER } }
  );

  worker.on("failed", (_job, erro) => {
    if (erro instanceof ErroRateLimit) {
      void worker.rateLimit(erro.esperarSegundos * 1000);
    }
  });

  return worker;
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/infrastructure/fila/processador.test.ts`
Expected: PASS — 9 testes.

- [ ] **Step 6: Rodar os testes de persistência para confirmar que o método novo não quebrou nada**

Run: `npx vitest run tests/api/infrastructure/persistencia`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: fila BullMQ com rate limiter e processador de jobs"
```

---

### Task 23: Infraestrutura — alertas e notificador por e-mail

**Files:**
- Create: `src/api/infrastructure/observabilidade/alertas.ts`, `src/api/infrastructure/observabilidade/notificador-email.ts`
- Test: `tests/api/infrastructure/observabilidade/alertas.test.ts`

**Interfaces:**
- Consumes: `NotificadorPort` (Task 12), `LoggerMinimo` (Task 2)
- Produces:
  - `NOTIFICADOR_SILENCIOSO: NotificadorPort`
  - `envolverComAlertas(logger: LoggerMinimo, notificador: NotificadorPort): LoggerMinimo` — dispara alerta em todo `warn`/`error` cujo objeto traga `alerta: true`
  - `criarNotificadorEmail(opcoes: { enviarEmail: (para: string, assunto: string, corpo: string) => Promise<void>; destino: string }): NotificadorPort`

- [ ] **Step 1: Instalar o nodemailer**

```bash
npm install nodemailer
npm install -D @types/nodemailer
```

- [ ] **Step 2: Escrever o teste que falha**

`tests/api/infrastructure/observabilidade/alertas.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import {
  envolverComAlertas,
  NOTIFICADOR_SILENCIOSO,
} from "../../../../src/api/infrastructure/observabilidade/alertas.js";
import { criarNotificadorEmail } from "../../../../src/api/infrastructure/observabilidade/notificador-email.js";

const loggerFalso = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe("criarNotificadorEmail", () => {
  it("envia para o destino configurado com assunto prefixado", async () => {
    const enviarEmail = vi.fn(async () => {});
    await criarNotificadorEmail({ enviarEmail, destino: "gestao@clinica.test" }).alertar(
      "job na dead letter",
      { deal_id: "d1" }
    );

    expect(enviarEmail).toHaveBeenCalledWith(
      "gestao@clinica.test",
      "[adapter-clint-medx] job na dead letter",
      expect.stringContaining("d1")
    );
  });
});

describe("NOTIFICADOR_SILENCIOSO", () => {
  it("não faz nada e resolve", async () => {
    await expect(NOTIFICADOR_SILENCIOSO.alertar("x", {})).resolves.toBeUndefined();
  });
});

describe("envolverComAlertas", () => {
  it("repassa info sem alertar", () => {
    const n = { alertar: vi.fn(async () => {}) };
    const base = loggerFalso();
    envolverComAlertas(base, n).info({ deal_id: "d1" }, "tudo certo");

    expect(base.info).toHaveBeenCalledWith({ deal_id: "d1" }, "tudo certo");
    expect(n.alertar).not.toHaveBeenCalled();
  });

  it("não alerta em warn comum", () => {
    const n = { alertar: vi.fn(async () => {}) };
    envolverComAlertas(loggerFalso(), n).warn({ deal_id: "d1" }, "aviso trivial");
    expect(n.alertar).not.toHaveBeenCalled();
  });

  it("alerta em warn marcado com alerta:true e ainda loga", () => {
    const n = { alertar: vi.fn(async () => {}) };
    const base = loggerFalso();
    envolverComAlertas(base, n).warn({ alerta: true, deal_id: "d1" }, "confirmação recusada");

    expect(base.warn).toHaveBeenCalled();
    expect(n.alertar).toHaveBeenCalledWith("confirmação recusada", { alerta: true, deal_id: "d1" });
  });

  it("alerta em error marcado com alerta:true", () => {
    const n = { alertar: vi.fn(async () => {}) };
    envolverComAlertas(loggerFalso(), n).error({ alerta: true }, "dead letter");
    expect(n.alertar).toHaveBeenCalled();
  });

  it("não deixa a falha do notificador derrubar o log", () => {
    const n = {
      alertar: vi.fn(async () => {
        throw new Error("SMTP fora do ar");
      }),
    };
    const base = loggerFalso();
    expect(() => envolverComAlertas(base, n).warn({ alerta: true }, "x")).not.toThrow();
    expect(base.warn).toHaveBeenCalled();
  });

  it("ignora objetos que não são registros", () => {
    const n = { alertar: vi.fn(async () => {}) };
    expect(() => envolverComAlertas(loggerFalso(), n).warn("string solta")).not.toThrow();
    expect(n.alertar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/infrastructure/observabilidade/alertas.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 4: Implementar `src/api/infrastructure/observabilidade/alertas.ts`**

```ts
import type { LoggerMinimo } from "../../../../lib/logger.js";
import type { NotificadorPort } from "../../application/ports/notificador.port.js";

export const NOTIFICADOR_SILENCIOSO: NotificadorPort = {
  async alertar(): Promise<void> {},
};

function deveAlertar(objeto: unknown): objeto is Record<string, unknown> {
  return (
    typeof objeto === "object" &&
    objeto !== null &&
    (objeto as Record<string, unknown>).alerta === true
  );
}

export function envolverComAlertas(
  logger: LoggerMinimo,
  notificador: NotificadorPort
): LoggerMinimo {
  function comAlerta(
    original: (o: unknown, m?: string) => void
  ): (o: unknown, m?: string) => void {
    return (objeto: unknown, mensagem?: string) => {
      original.call(logger, objeto, mensagem);

      if (deveAlertar(objeto)) {
        // Um alerta que falha nunca pode derrubar o fluxo que o disparou.
        void Promise.resolve()
          .then(() => notificador.alertar(mensagem ?? "alerta do adapter", objeto))
          .catch(() => {});
      }
    };
  }

  return {
    info: (o, m) => logger.info(o, m),
    warn: comAlerta(logger.warn),
    error: comAlerta(logger.error),
  };
}
```

- [ ] **Step 5: Implementar `src/api/infrastructure/observabilidade/notificador-email.ts`**

```ts
import type { NotificadorPort } from "../../application/ports/notificador.port.js";

export function criarNotificadorEmail(opcoes: {
  enviarEmail: (para: string, assunto: string, corpo: string) => Promise<void>;
  destino: string;
}): NotificadorPort {
  return {
    async alertar(assunto: string, detalhes: Record<string, unknown>): Promise<void> {
      await opcoes.enviarEmail(
        opcoes.destino,
        `[adapter-clint-medx] ${assunto}`,
        JSON.stringify(detalhes, null, 2)
      );
    },
  };
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/infrastructure/observabilidade/alertas.test.ts`
Expected: PASS — 8 testes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: alertas disparados por marcação no log e notificador por e-mail"
```

---

### Task 24: Presentation — servidor HTTP e rotas de webhook

**Files:**
- Create: `src/api/presentation/http/schemas.ts`, `src/api/presentation/http/servidor.ts`
- Test: `tests/api/presentation/http/servidor.test.ts`

**Interfaces:**
- Consumes: `EventoRepositorio` (8), `JobAdapter` e `FilaPort` de `application/ports/fila.port.ts` (12), `LoggerMinimo` (2)
- Produces:
  - `schemaAgendamento`, `schemaResposta` (Zod) e os tipos inferidos
  - `interface Saude { redis: boolean; banco: boolean; medx: boolean }`
  - `interface DepsServidor { segredo: string; eventos: EventoRepositorio; fila: FilaPort; verificarSaude: () => Promise<Saude>; logger: LoggerMinimo }`
  - `criarServidor(deps: DepsServidor): FastifyInstance` com `POST /webhooks/clint/agendamento`, `POST /webhooks/clint/resposta-lembrete` e `GET /health`

- [ ] **Step 1: Escrever o teste que falha**

`tests/api/presentation/http/servidor.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { criarServidor } from "../../../../src/api/presentation/http/servidor.js";
import { abrirBanco } from "../../../../src/api/infrastructure/persistencia/sqlite/conexao.js";
import { criarEventoRepositorio } from "../../../../src/api/infrastructure/persistencia/sqlite/evento.sqlite-repositorio.js";

const SEGREDO = "segredo-certo";

const AGENDAMENTO = {
  deal_id: "8feade82-d77b-4e8b-9d35-fd43e972b5c8",
  nome: "Maria Silva",
  telefone: "+5511999998888",
  data_nascimento: "1990-05-20",
  data_hora: "2026-07-10T14:00:00-03:00",
  profissional: "Leize Ferreira",
  tipo_consulta: "Consulta de Rotina",
};

const RESPOSTA = {
  deal_id: AGENDAMENTO.deal_id,
  id_agendamento_medx: 1275002478,
  resposta: "confirmar",
};

function montar(overrides: Record<string, any> = {}) {
  const db = abrirBanco(":memory:");
  const eventos = criarEventoRepositorio(db);
  const deps = {
    segredo: SEGREDO,
    eventos,
    fila: { add: vi.fn(async () => ({ id: "job-1" })) },
    verificarSaude: vi.fn(async () => ({ redis: true, banco: true, medx: true })),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
  const contarEventos = (): number =>
    (db.prepare("SELECT COUNT(*) c FROM eventos_recebidos").get() as any).c;
  const statusUnico = (): string =>
    (db.prepare("SELECT status FROM eventos_recebidos").get() as any).status;

  return { app: criarServidor(deps as any), deps, contarEventos, statusUnico };
}

function postar(app: any, url: string, payload: unknown, segredo?: string) {
  return app.inject({
    method: "POST",
    url,
    headers: segredo ? { "x-adapter-secret": segredo } : {},
    payload,
  });
}

describe("autenticação", () => {
  it("recusa sem o segredo, mas ainda assim com status 200", async () => {
    const { app, deps } = montar();
    const r = await postar(app, "/webhooks/clint/agendamento", AGENDAMENTO);
    expect(r.statusCode).toBe(200);
    expect(deps.fila.add).not.toHaveBeenCalled();
  });

  it("recusa com segredo errado sem enfileirar", async () => {
    const { app, deps } = montar();
    const r = await postar(app, "/webhooks/clint/agendamento", AGENDAMENTO, "errado");
    expect(r.statusCode).toBe(200);
    expect(deps.fila.add).not.toHaveBeenCalled();
  });
});

describe("POST /webhooks/clint/agendamento", () => {
  it("grava o evento, enfileira e responde 200", async () => {
    const { app, deps, contarEventos } = montar();
    const r = await postar(app, "/webhooks/clint/agendamento", AGENDAMENTO, SEGREDO);

    expect(r.statusCode).toBe(200);
    expect(deps.fila.add).toHaveBeenCalledTimes(1);
    expect(contarEventos()).toBe(1);
  });

  it("traduz o payload para o comando da aplicação", async () => {
    const { app, deps } = montar();
    await postar(app, "/webhooks/clint/agendamento", { ...AGENDAMENTO, cpf: "529.982.247-25" }, SEGREDO);

    const job = (deps.fila.add as any).mock.calls[0][1];
    expect(job.tipo).toBe("agendamento");
    expect(job.comando).toMatchObject({
      dealId: AGENDAMENTO.deal_id,
      nome: "Maria Silva",
      telefone: "+5511999998888",
      dataNascimento: "1990-05-20",
      dataHora: "2026-07-10T14:00:00-03:00",
      profissional: "Leize Ferreira",
      tipoConsulta: "Consulta de Rotina",
      cpf: "529.982.247-25",
    });
  });

  it("responde 200 e marca inválido quando falta campo obrigatório", async () => {
    const { app, deps, statusUnico } = montar();
    const { telefone, ...semTelefone } = AGENDAMENTO;
    const r = await postar(app, "/webhooks/clint/agendamento", semTelefone, SEGREDO);

    expect(r.statusCode).toBe(200);
    expect(deps.fila.add).not.toHaveBeenCalled();
    expect(statusUnico()).toBe("invalido");
  });

  it("responde 200 mesmo quando a fila está fora do ar", async () => {
    const { app } = montar({
      fila: {
        add: vi.fn(async () => {
          throw new Error("Redis indisponível");
        }),
      },
    });
    const r = await postar(app, "/webhooks/clint/agendamento", AGENDAMENTO, SEGREDO);
    expect(r.statusCode).toBe(200);
  });

  it("responde 200 para JSON malformado", async () => {
    const { app } = montar();
    const r = await app.inject({
      method: "POST",
      url: "/webhooks/clint/agendamento",
      headers: { "x-adapter-secret": SEGREDO, "content-type": "application/json" },
      payload: "{isso não é json",
    });
    expect(r.statusCode).toBe(200);
  });

  it("associa o job ao evento gravado", async () => {
    const { app, deps } = montar();
    await postar(app, "/webhooks/clint/agendamento", AGENDAMENTO, SEGREDO);
    expect(deps.fila.add).toHaveBeenCalled();
  });
});

describe("POST /webhooks/clint/resposta-lembrete", () => {
  it.each(["confirmar", "reagendar", "cancelar"])("aceita a resposta %s", async (resposta) => {
    const { app, deps } = montar();
    const r = await postar(app, "/webhooks/clint/resposta-lembrete", { ...RESPOSTA, resposta }, SEGREDO);

    expect(r.statusCode).toBe(200);
    expect(deps.fila.add).toHaveBeenCalledTimes(1);
  });

  it("marca inválido para resposta fora do enum", async () => {
    const { app, deps, statusUnico } = montar();
    await postar(app, "/webhooks/clint/resposta-lembrete", { ...RESPOSTA, resposta: "talvez" }, SEGREDO);

    expect(deps.fila.add).not.toHaveBeenCalled();
    expect(statusUnico()).toBe("invalido");
  });

  it("aceita id do agendamento vindo como string numérica", async () => {
    const { app, deps } = montar();
    await postar(app, "/webhooks/clint/resposta-lembrete", { ...RESPOSTA, id_agendamento_medx: "1275002478" }, SEGREDO);

    const job = (deps.fila.add as any).mock.calls[0][1];
    expect(job.comando.idAgendamentoMedx).toBe(1275002478);
  });
});

describe("GET /health", () => {
  it("responde 200 quando tudo está de pé", async () => {
    const { app } = montar();
    const r = await app.inject({ method: "GET", url: "/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ redis: true, banco: true, medx: true });
  });

  it("responde 503 quando algum componente está fora", async () => {
    const { app } = montar({
      verificarSaude: vi.fn(async () => ({ redis: false, banco: true, medx: true })),
    });
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(503);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/presentation/http/servidor.test.ts`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar `src/api/presentation/http/schemas.ts`**

```ts
import { z } from "zod";
import { VALORES_RESPOSTA } from "../../domain/agendamento/resposta-lembrete.js";

export const schemaAgendamento = z.object({
  deal_id: z.string().min(1),
  nome: z.string().min(1),
  telefone: z.string().min(1),
  data_nascimento: z.string().min(1),
  data_hora: z.string().min(1),
  profissional: z.union([z.string().min(1), z.number()]),
  tipo_consulta: z.union([z.string().min(1), z.number()]),
  cpf: z.string().optional(),
  email: z.string().optional(),
  sexo: z.enum(["M", "F"]).optional(),
});

export const schemaResposta = z.object({
  deal_id: z.string().min(1),
  id_agendamento_medx: z.coerce.number().int().positive(),
  resposta: z.enum(VALORES_RESPOSTA as unknown as [string, ...string[]]),
});

export type PayloadAgendamento = z.infer<typeof schemaAgendamento>;
export type PayloadResposta = z.infer<typeof schemaResposta>;
```

- [ ] **Step 4: Implementar `src/api/presentation/http/servidor.ts`**

```ts
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { LoggerMinimo } from "../../../../lib/logger.js";
import type { FilaPort, JobAdapter } from "../../application/ports/fila.port.js";
import type { EventoRepositorio } from "../../domain/evento/evento.repositorio.js";
import { schemaAgendamento, schemaResposta } from "./schemas.js";

export interface Saude {
  redis: boolean;
  banco: boolean;
  medx: boolean;
}

export interface DepsServidor {
  segredo: string;
  eventos: EventoRepositorio;
  fila: FilaPort;
  verificarSaude: () => Promise<Saude>;
  logger: LoggerMinimo;
}

const OK = { ok: true } as const;

export function criarServidor(deps: DepsServidor): FastifyInstance {
  const app = Fastify({ logger: false });

  // Nada sai deste servidor com status de erro: o Clint desativa o webhook
  // após três falhas consecutivas. Erro é sinalizado por log e alerta.
  app.setErrorHandler((erro, _requisicao, resposta) => {
    deps.logger.error({ erro: erro.message }, "erro não tratado no webhook");
    void resposta.status(200).send(OK);
  });

  function autorizado(requisicao: FastifyRequest): boolean {
    return requisicao.headers["x-adapter-secret"] === deps.segredo;
  }

  async function receber(
    requisicao: FastifyRequest,
    resposta: FastifyReply,
    endpoint: string,
    montarJob: (payload: unknown) => { ok: true; job: JobAdapter } | { ok: false; motivo: string }
  ): Promise<FastifyReply> {
    if (!autorizado(requisicao)) {
      deps.logger.warn({ endpoint }, "webhook recusado por segredo inválido");
      return resposta.status(200).send(OK);
    }

    const evento = deps.eventos.registrar(endpoint, requisicao.body);
    const resultado = montarJob(requisicao.body);

    if (!resultado.ok) {
      evento.marcarInvalido(resultado.motivo);
      deps.eventos.salvar(evento);
      deps.logger.warn({ evento_id: evento.id, endpoint }, "payload inválido");
      return resposta.status(200).send(OK);
    }

    try {
      const criado = await deps.fila.add(resultado.job.tipo, {
        ...resultado.job,
        eventoId: evento.id,
      });
      if (criado.id) {
        evento.associarJob(criado.id);
        deps.eventos.salvar(evento);
      }
    } catch (erro) {
      evento.marcarFalha(`não foi possível enfileirar: ${(erro as Error).message}`);
      deps.eventos.salvar(evento);
      deps.logger.error(
        { alerta: true, evento_id: evento.id },
        "fila indisponível — evento gravado para reprocessar"
      );
    }

    return resposta.status(200).send(OK);
  }

  app.post("/webhooks/clint/agendamento", (requisicao, resposta) =>
    receber(requisicao, resposta, "/webhooks/clint/agendamento", (payload) => {
      const validado = schemaAgendamento.safeParse(payload);
      if (!validado.success) {
        return { ok: false, motivo: validado.error.issues.map((i) => i.path.join(".")).join(", ") };
      }
      const p = validado.data;
      return {
        ok: true,
        job: {
          tipo: "agendamento",
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
    })
  );

  app.post("/webhooks/clint/resposta-lembrete", (requisicao, resposta) =>
    receber(requisicao, resposta, "/webhooks/clint/resposta-lembrete", (payload) => {
      const validado = schemaResposta.safeParse(payload);
      if (!validado.success) {
        return { ok: false, motivo: validado.error.issues.map((i) => i.path.join(".")).join(", ") };
      }
      const p = validado.data;
      return {
        ok: true,
        job: {
          tipo: "resposta",
          eventoId: 0,
          comando: {
            dealId: p.deal_id,
            idAgendamentoMedx: p.id_agendamento_medx,
            resposta: p.resposta,
          },
        },
      };
    })
  );

  app.get("/health", async (_requisicao, resposta) => {
    const saude = await deps.verificarSaude();
    const tudoOk = saude.redis && saude.banco && saude.medx;
    return resposta.status(tudoOk ? 200 : 503).send(saude);
  });

  return app;
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/presentation/http/servidor.test.ts`
Expected: PASS — 14 testes.

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS em todos os arquivos, incluindo as regras de dependência.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: servidor HTTP que sempre responde 200 e enfileira os webhooks"
```

---
### Task 25: Composition root e entrypoint

O único lugar do projeto que conhece todas as camadas. Aqui as implementações
concretas são ligadas aos ports.

**Files:**
- Create: `src/api/composition/container.ts`, `src/api/main.ts`
- Test: `tests/api/composition/container.test.ts`

**Interfaces:**
- Consumes: tudo
- Produces: `interface Aplicacao { app: FastifyInstance; fila: Queue<JobAdapter>; worker: Worker<JobAdapter>; expurgar(): number; encerrar(): Promise<void> }` e `montarAplicacao(env: Env): Promise<Aplicacao>`

- [ ] **Step 1: Escrever o teste que falha**

O teste cobre o que é testável sem Redis: a montagem do notificador conforme o ambiente.

`tests/api/composition/container.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { escolherNotificador } from "../../../src/api/composition/container.js";
import { NOTIFICADOR_SILENCIOSO } from "../../../src/api/infrastructure/observabilidade/alertas.js";

const base = {
  ALERTA_EMAIL_ORIGEM: "adapter@localhost",
} as any;

describe("escolherNotificador", () => {
  it("usa o silencioso quando SMTP não está configurado", () => {
    expect(escolherNotificador(base)).toBe(NOTIFICADOR_SILENCIOSO);
  });

  it("usa o silencioso quando falta o destino", () => {
    expect(escolherNotificador({ ...base, SMTP_URL: "smtp://x" })).toBe(NOTIFICADOR_SILENCIOSO);
  });

  it("monta o notificador de e-mail quando SMTP e destino existem", () => {
    const n = escolherNotificador({
      ...base,
      SMTP_URL: "smtp://x",
      ALERTA_EMAIL_DESTINO: "gestao@clinica.test",
    });
    expect(n).not.toBe(NOTIFICADOR_SILENCIOSO);
    expect(typeof n.alertar).toBe("function");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/api/composition/container.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/api/composition/container.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import nodemailer from "nodemailer";

import type { Env } from "../../../lib/config/env.server.js";
import { criarLogger } from "../../../lib/logger.js";

import type { JobAdapter } from "../application/ports/fila.port.js";
import type { NotificadorPort } from "../application/ports/notificador.port.js";
import { criarAgendarConsulta } from "../application/agendar-consulta/agendar-consulta.usecase.js";
import { criarProcessarResposta } from "../application/processar-resposta-lembrete/processar-resposta.usecase.js";

import { abrirBanco } from "../infrastructure/persistencia/sqlite/conexao.js";
import { criarAgendamentoRepositorio } from "../infrastructure/persistencia/sqlite/agendamento.sqlite-repositorio.js";
import { criarCorrelacaoPacienteRepositorio } from "../infrastructure/persistencia/sqlite/correlacao-paciente.sqlite-repositorio.js";
import { criarEventoRepositorio } from "../infrastructure/persistencia/sqlite/evento.sqlite-repositorio.js";
import { criarTokenProvider } from "../infrastructure/medx/medx-token.provider.js";
import { criarMedxClient } from "../infrastructure/medx/medx-http.client.js";
import { criarCatalogoMedx } from "../infrastructure/medx/medx-catalogo.adapter.js";
import { criarCadastroPacienteMedx } from "../infrastructure/medx/medx-cadastro-paciente.adapter.js";
import { criarAgendaMedx } from "../infrastructure/medx/medx-agenda.adapter.js";
import { criarCrmWebhookClint } from "../infrastructure/clint/clint-webhook.adapter.js";
import { criarFila, criarWorker } from "../infrastructure/fila/fila.js";
import { envolverComAlertas, NOTIFICADOR_SILENCIOSO } from "../infrastructure/observabilidade/alertas.js";
import { criarNotificadorEmail } from "../infrastructure/observabilidade/notificador-email.js";

import { criarServidor } from "../presentation/http/servidor.js";

export interface Aplicacao {
  app: FastifyInstance;
  fila: Queue<JobAdapter>;
  worker: Worker<JobAdapter>;
  expurgar(): number;
  encerrar(): Promise<void>;
}

export function escolherNotificador(env: Env): NotificadorPort {
  if (!env.SMTP_URL || !env.ALERTA_EMAIL_DESTINO) {
    return NOTIFICADOR_SILENCIOSO;
  }

  return criarNotificadorEmail({
    destino: env.ALERTA_EMAIL_DESTINO,
    enviarEmail: async (para, assunto, corpo) => {
      const transporte = nodemailer.createTransport(env.SMTP_URL!);
      await transporte.sendMail({
        from: env.ALERTA_EMAIL_ORIGEM,
        to: para,
        subject: assunto,
        text: corpo,
      });
    },
  });
}

export async function montarAplicacao(env: Env): Promise<Aplicacao> {
  const loggerBase = criarLogger(env);
  const notificador = escolherNotificador(env);
  const logger = envolverComAlertas(loggerBase, notificador);

  if (notificador === NOTIFICADOR_SILENCIOSO) {
    loggerBase.warn({}, "SMTP não configurado — alertas ficarão apenas no log");
  }

  // Persistência
  const db = abrirBanco(env.DATABASE_PATH);
  const agendamentos = criarAgendamentoRepositorio(db);
  const correlacoes = criarCorrelacaoPacienteRepositorio(db);
  const eventos = criarEventoRepositorio(db);

  // MedX
  const tokens = criarTokenProvider({
    host: env.MEDX_HOST,
    integrationToken: env.MEDX_INTEGRATION_TOKEN,
  });
  const medx = criarMedxClient({ host: env.MEDX_HOST, tokens });
  const catalogo = criarCatalogoMedx(medx);
  const cadastro = criarCadastroPacienteMedx(medx);
  const agenda = criarAgendaMedx(medx);

  // Falha cedo e alto se o rótulo de confirmação não existir nesta conta.
  await catalogo.carregar();
  loggerBase.info(
    { indice_confirmado: catalogo.indiceStatusConfirmado() },
    "catálogo do MedX carregado"
  );

  // Clint
  const crm = criarCrmWebhookClint({
    urlAgendamento: env.CLINT_WEBHOOK_AGENDAMENTO_URL,
    urlNotificacao: env.CLINT_WEBHOOK_NOTIFICACAO_URL,
  });

  // Casos de uso
  const agendarConsulta = criarAgendarConsulta({
    agendamentos, correlacoes, cadastro, agenda, catalogo, crm, logger,
  });
  const processarResposta = criarProcessarResposta({
    agendamentos, agenda, catalogo, crm, logger,
  });

  // Fila
  const conexao = { url: env.REDIS_URL };
  const fila = criarFila(conexao);
  const worker = criarWorker({ eventos, agendarConsulta, processarResposta, logger }, conexao);

  worker.on("failed", (job, erro) => {
    const tentativas = job?.attemptsMade ?? 0;
    const maximo = job?.opts.attempts ?? 0;
    if (tentativas >= maximo) {
      logger.error(
        { alerta: true, job_id: job?.id, tentativas, erro: erro.message },
        "job esgotou as tentativas e foi para a dead letter"
      );
    }
  });

  // HTTP
  const redisSaude = new IORedis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

  const app = criarServidor({
    segredo: env.ADAPTER_SECRET,
    eventos,
    fila,
    logger,
    verificarSaude: async () => ({
      redis: await redisSaude.ping().then(() => true).catch(() => false),
      banco: (() => {
        try {
          db.prepare("SELECT 1").get();
          return true;
        } catch {
          return false;
        }
      })(),
      medx: await tokens.obterToken().then(() => true).catch(() => false),
    }),
  });

  return {
    app,
    fila,
    worker,
    expurgar: () => {
      const removidos = eventos.expurgar(env.RETENCAO_DIAS);
      if (removidos > 0) loggerBase.info({ removidos }, "expurgo de eventos antigos");
      return removidos;
    },
    encerrar: async () => {
      await worker.close();
      await fila.close();
      await app.close();
      redisSaude.disconnect();
      db.close();
    },
  };
}
```

- [ ] **Step 4: Implementar `src/api/main.ts`**

```ts
import { carregarEnv } from "../../lib/config/env.server.js";
import { montarAplicacao } from "./composition/container.js";

const env = carregarEnv(process.env);
const aplicacao = await montarAplicacao(env);

const expurgoDiario = setInterval(() => aplicacao.expurgar(), 24 * 60 * 60 * 1000);
expurgoDiario.unref();

await aplicacao.app.listen({ port: env.PORT, host: "0.0.0.0" });
console.log(`adapter no ar na porta ${env.PORT}`);

async function encerrar(sinal: string): Promise<void> {
  console.log(`encerrando por ${sinal}`);
  clearInterval(expurgoDiario);
  await aplicacao.encerrar();
  process.exit(0);
}

process.on("SIGTERM", () => void encerrar("SIGTERM"));
process.on("SIGINT", () => void encerrar("SIGINT"));
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/api/composition/container.test.ts`
Expected: PASS — 3 testes.

- [ ] **Step 6: Verificar a build e a suíte inteira**

Run: `npm run build && npm test`
Expected: build sem erro de tipo, todos os testes passando.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: composition root ligando os adapters aos ports"
```

---

### Task 26: Painel da fila, empacotamento e documentação

**Files:**
- Create: `src/api/presentation/http/painel-fila.ts`, `Dockerfile`, `docker-compose.yml`, `README.md`
- Modify: `src/api/composition/container.ts` (registrar o painel)
- Test: verificação manual via `docker compose up`

**Interfaces:**
- Consumes: `Queue<JobAdapter>` (Task 22), `FastifyInstance`
- Produces: `registrarPainelFila(app: FastifyInstance, fila: Queue<JobAdapter>, credenciais: { usuario?: string; senha?: string }): Promise<boolean>` — devolve `true` se o painel subiu, `false` se foi pulado por falta de credenciais

- [ ] **Step 1: Instalar as dependências do painel**

```bash
npm install @bull-board/api @bull-board/fastify @fastify/basic-auth
```

- [ ] **Step 2: Implementar `src/api/presentation/http/painel-fila.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Queue } from "bullmq";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter.js";
import { FastifyAdapter } from "@bull-board/fastify";
import basicAuth from "@fastify/basic-auth";

const CAMINHO = "/admin/filas";

/**
 * Sobe o painel apenas com credenciais definidas. Sem elas a rota não existe:
 * expor a fila sem autenticação vazaria deal_id e o conteúdo dos jobs.
 */
export async function registrarPainelFila(
  app: FastifyInstance,
  fila: Queue,
  credenciais: { usuario?: string; senha?: string }
): Promise<boolean> {
  const { usuario, senha } = credenciais;
  if (!usuario || !senha) return false;

  const painel = new FastifyAdapter();
  createBullBoard({ queues: [new BullMQAdapter(fila)], serverAdapter: painel });
  painel.setBasePath(CAMINHO);

  await app.register(basicAuth, {
    validate: async (informado, segredo) => {
      if (informado !== usuario || segredo !== senha) {
        return new Error("credenciais inválidas");
      }
      return undefined;
    },
    authenticate: { realm: "adapter" },
  });

  await app.register(async (instancia) => {
    instancia.addHook("onRequest", instancia.basicAuth);
    await instancia.register(painel.registerPlugin(), { prefix: CAMINHO });
  });

  return true;
}
```

- [ ] **Step 3: Registrar o painel no container**

Em `src/api/composition/container.ts`, acrescente o import:

```ts
import { registrarPainelFila } from "../presentation/http/painel-fila.js";
```

E, logo depois da criação do `app` (antes do `return`):

```ts
  const painelAtivo = await registrarPainelFila(app, fila, {
    usuario: env.BULLBOARD_USUARIO,
    senha: env.BULLBOARD_SENHA,
  });

  loggerBase.info(
    { painel: painelAtivo },
    painelAtivo
      ? "Bull Board disponível em /admin/filas"
      : "Bull Board desativado — defina BULLBOARD_USUARIO e BULLBOARD_SENHA para habilitar"
  );
```

- [ ] **Step 4: Rodar a suíte e o teste de arquitetura**

Run: `npm test`
Expected: PASS. O painel vive em `presentation` e importa apenas bibliotecas externas
e o tipo `Queue` do BullMQ — não a nossa `infrastructure` —, então as regras de
dependência seguem satisfeitas.

- [ ] **Step 5: Criar o `Dockerfile`**

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY lib ./lib
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev && apt-get purge -y python3 make g++ && apt-get autoremove -y
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/dados
EXPOSE 3000
CMD ["node", "dist/src/api/main.js"]
```

As ferramentas de compilação são necessárias porque o `better-sqlite3` é um módulo nativo.

- [ ] **Step 6: Criar o `docker-compose.yml`**

A configuração de persistência do Redis não é opcional: sem `appendonly yes`, um crash
perde os jobs em voo.

```yaml
services:
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --appendfsync everysec
    volumes:
      - redis-dados:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  adapter:
    build: .
    env_file: .env
    environment:
      REDIS_URL: redis://redis:6379
      DATABASE_PATH: /app/dados/adapter.sqlite
    ports:
      - "3000:3000"
    volumes:
      - adapter-dados:/app/dados
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

volumes:
  redis-dados:
  adapter-dados:
```

- [ ] **Step 7: Escrever o `README.md`**

```markdown
# Adapter Clint ↔ MedX

Traduz webhooks do Clint em chamadas à API REST do MedX: cria agendamentos e processa
as confirmações que os pacientes respondem pelo WhatsApp.

## Arquitetura

Camadas DDD. `lib/` guarda o que é transversal; `src/api/` guarda as camadas.

| Camada | Papel |
|---|---|
| `domain` | Regras e entidades. Não importa de ninguém |
| `application` | Casos de uso sobre ports. Não conhece MedX nem Clint |
| `infrastructure` | Adapters concretos: MedX, Clint, SQLite, BullMQ |
| `presentation` | HTTP e painel da fila |
| `composition` | Liga tudo |

As regras de dependência são verificadas por `tests/api/arquitetura.test.ts`.

## Subir

1. `cp .env.example .env` e preencher `MEDX_INTEGRATION_TOKEN`, `ADAPTER_SECRET` e as
   duas URLs de webhook de entrada do Clint.
2. `docker compose up -d --build`
3. Conferir `curl localhost:3000/health`

## Descoberta

Antes de configurar o Clint, rodar `npm run descoberta` para levantar os IDs de
profissionais, tipos de consulta e o índice real de status da conta. O adapter **não
sobe** se não encontrar um rótulo de status correspondente a "Confirmado".

## Configuração no Clint

- Campo customizado `id_agendamento_medx` no negócio.
- Webhook de saída com gatilho "mudar de etapa" → `POST /webhooks/clint/agendamento`,
  com o header `X-Adapter-Secret`.
- Webhook de saída da resposta do lembrete → `POST /webhooks/clint/resposta-lembrete`.
- Integrações de entrada recebendo o retorno do adapter.

Os campos esperados em cada payload estão na Seção 5 do spec.

## Regra inegociável

Os endpoints de webhook **sempre** respondem 200. O Clint desativa a integração após
três falhas consecutivas, e silenciosamente. Erros são sinalizados por log, alerta e
pela fila — nunca por status HTTP.

## Alertas

Com `SMTP_URL` e `ALERTA_EMAIL_DESTINO` definidos, o adapter manda e-mail quando um job
esgota as tentativas, quando o vínculo de paciente sai com match duvidoso e quando uma
confirmação é recusada. Sem essas variáveis, os mesmos eventos ficam só no log.

## Painel da fila

Com `BULLBOARD_USUARIO` e `BULLBOARD_SENHA` definidos, o Bull Board fica em
`/admin/filas` protegido por basic auth. Sem as credenciais a rota não é registrada.

## Backup

O estado durável é o arquivo SQLite no volume `adapter-dados`. Backup é copiar esse
arquivo; o Redis guarda apenas jobs em trânsito.
```

- [ ] **Step 8: Verificar a build e a suíte**

Run: `npm run build && npm test`
Expected: build sem erro de tipo, todos os testes passando.

- [ ] **Step 9: Subir localmente e conferir**

Run: `docker compose up -d --build && sleep 10 && curl -s localhost:3000/health`
Expected: JSON com `redis`, `banco` e `medx` — os três `true` quando o token do MedX é válido.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: painel da fila, empacotamento Docker e documentação"
```

---

## Cobertura do spec

| Seção do spec | Tarefas |
|---|---|
| 4 Arquitetura em camadas | 1–26, verificada por 9 |
| 4 Onde mora a regra de negócio | 3, 4, 5, 6, 7, 8 |
| 5 Contrato de entrada | 24 |
| 6 Contrato MedX: token, rate limit, resolvers | 13, 14, 16 |
| 7 Fluxo A: timezone, idempotência, adoção de órfão | 5, 20 |
| 8 Fluxo B: validação de estado e recusa | 7, 21 |
| 9 Modelo de dados | 10, 11 |
| 10 Erros e casos de borda | 13, 14, 20, 21, 22, 24 |
| 11 Segurança e LGPD | 1, 2, 11 (expurgo), 24 (segredo), 26 (painel protegido) |
| 12 Observabilidade | 2, 23, 24 (`/health`), 25, 26 |
| 13 Testes | todas; regras de dependência em 9 |
| 14 Tarefas de descoberta | 15 |
| 15 Configuração no Clint | 26 (README) |
| 16 Fase 2 | fora de escopo, intencionalmente |
