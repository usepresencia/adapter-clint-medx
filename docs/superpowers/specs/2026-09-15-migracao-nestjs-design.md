# Migração do adapter Clint ↔ MedX para NestJS — Design

**Data:** 2026-09-15
**Status:** aprovado para planejamento

## 1. Contexto

O adapter Clint ↔ MedX foi implementado (26 tasks, ver
`docs/superpowers/specs/2026-09-12-adapter-clint-medx-design.md` e o plano correspondente)
sobre Fastify standalone, com DI manual via composition root (`container.ts`) e SQLite
(`better-sqlite3`) para persistência.

A empresa padroniza sua stack de API em NestJS, com um projeto de referência real em
produção — `api-agendaflow` (`/Users/cesarpisa/Projects/Presencia/api-agendaflow`, npm
package `presencia-api`). Este documento desenha a migração do adapter para essa stack,
preservando a lógica de domínio e aplicação já implementada e revisada (222 testes) e
adotando as convenções estruturais, de CI/CD e de qualidade de código do projeto de
referência onde fizerem sentido para este adapter.

**Motivação para SQLite → Postgres:** experiência prévia da equipe mostra que SQLite não se
comporta bem no ambiente de VPS usado pela empresa (contenção de I/O em volume compartilhado,
dificuldade de backup consistente sob carga). Migrar para Prisma + PostgreSQL resolve isso e
alinha com o `api-agendaflow`.

## 2. Escopo

### Dentro

- Trocar o framework HTTP/DI de Fastify standalone para NestJS (`@nestjs/platform-express`).
- Trocar a persistência de `better-sqlite3` para Prisma + PostgreSQL.
- Trocar Pino standalone por `nestjs-pino`, preservando a redação de PII já implementada.
- Trocar a instanciação manual de BullMQ (`Queue`/`Worker`) por `@nestjs/bullmq`
  (`@Processor`, `WorkerHost`).
- Adotar a estrutura de módulos, DI por `Symbol()` token e "persistence module" global do
  `api-agendaflow`.
- Copiar e adaptar os workflows de CI/CD (`ci.yaml`, `cd.yaml`, `label-pr.yml`,
  `pr-metadata-check.yml`), templates de issue/PR, e toda a configuração de qualidade de
  código (ESLint flat config, Prettier, EditorConfig, commitlint, husky + lint-staged,
  `nest-cli.json`) do `api-agendaflow`.
- Manter 100% da lógica de `domain/` sem alteração (é framework-agnóstica hoje e continua
  sendo).
- Manter 100% das regras de negócio de `application/` (idempotência, adoção de órfão,
  avaliação de confirmação, etc.) — só muda a forma de instanciação (classe injetável em
  vez de fábrica manual).

### Fora

- `project-automation.yml` (rastreamento em GitHub Project board) — adicionado depois,
  quando houver um board definido para este projeto.
- Qualquer mudança de comportamento de negócio. Esta é uma migração de infraestrutura/
  framework, não uma revisão de regras — os achados e rulings da revisão final do projeto
  atual (ver ledger da implementação original) continuam válidos e não são reabertos aqui.
- Autenticação de usuário (o `api-agendaflow` tem Firebase/Passport/JWT porque atende
  clientes finais; este adapter só recebe webhooks server-to-server autenticados por
  segredo compartilhado — esse mecanismo é preservado, não é substituído por OAuth/JWT).

## 3. Decisões e justificativas

| Decisão | Escolha | Por quê |
|---|---|---|
| Framework HTTP | NestJS + `@nestjs/platform-express` | Padrão da empresa (`api-agendaflow`); para o volume deste adapter, a diferença de performance Express/Fastify é irrelevante |
| Persistência | Prisma + PostgreSQL | SQLite não se comporta bem na VPS da empresa (experiência prévia); alinha com o padrão |
| Campos de horário (`inicio`, `ultima_edicao`) | `String` no Prisma, não `DateTime` | `PeriodoConsulta` produz uma string sem timezone representando horário local da clínica; `DateTime`→`Date` do JS reintroduziria dependência do timezone do container, exatamente o bug que `PeriodoConsulta` existe para evitar |
| Logger | `nestjs-pino`, não o `Logger` nativo do Nest | O `Logger` nativo não tem redação de PII embutida; a redação de CPF/telefone/nome/e-mail é exigência LGPD do projeto já revisada — preservá-la pesa mais que seguir 100% o padrão do `api-agendaflow` neste ponto específico |
| Fila | `@nestjs/bullmq` (`@Processor`/`WorkerHost`) | `api-agendaflow` não tem precedente de fila de jobs (só cron); `@nestjs/bullmq` é o jeito idiomático do Nest de integrar BullMQ, e `WorkerHost` expõe `this.worker`, permitindo que o fix de rate-limit (`Worker.RateLimitError()`) já validado migre quase linha a linha |
| Validação HTTP de entrada | Zod nos webhooks (mantido), `class-validator`/DTOs reservado para rotas internas futuras | Os schemas Zod já refletem o contrato do Clint com precisão e passaram por revisão; trocar por decorators não ganha nada aqui, só reescreveria testes que já passam |
| Testes de `presentation/` | `Test.createTestingModule` + supertest (e2e real), destoando do `api-agendaflow` (que não tem suíte e2e) | A garantia "sempre 200" é crítica demais — a revisão final do projeto atual já pegou uma brecha real nela — para não ter um teste de integração HTTP de ponta a ponta |
| Path aliases (`@/*` → `src/*`) | Adotado | O design original proibia aliases para não depender de loader em runtime; o Nest/`ts-node`/build do `api-agendaflow` já resolve isso via `tsconfig-paths` no build compilado, então a restrição original deixa de se aplicar |
| CI: step de teste | Adicionado (o `api-agendaflow` não roda testes em CI) | A suíte de 222 testes é o que sustenta a confiança no código; não faz sentido herdar essa lacuna |
| `project-automation.yml` | Não copiado agora | Sem um GitHub Project board definido para este projeto ainda; adicionar depois é trivial |

### Decisões descartadas

- **Manter SQLite**: rejeitado por experiência operacional ruim na VPS da empresa.
- **`Logger` nativo do Nest sem redação**: rejeitado — perderia a garantia de LGPD já
  implementada e testada.
- **BullMQ manual (como hoje) só exposto via provider Nest**: rejeitado — `@nestjs/bullmq`
  é pouco mais trabalho e é o padrão idiomático, sem motivo para fugir dele já que não há
  precedente contrário no `api-agendaflow`.
- **Seguir `api-agendaflow` e não ter suíte e2e**: rejeitado — a garantia "sempre 200" é
  a mais crítica do sistema; abrir mão do teste de integração HTTP é um risco desproporcional
  à economia de esforço.

## 4. Arquitetura

### Estrutura de diretórios

```
src/
  main.ts                                  bootstrap NestFactory<NestExpressApplication>
  app.module.ts                            módulo raiz

  config/
    env.schema.ts                          zod — mesmo padrão do adapter atual e do api-agendaflow

  agendamento/
    domain/                                INALTERADO — VOs, entidades, ErroDeDominio
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
      ports/                               interfaces + Symbol() tokens
        agenda-medica.port.ts
        cadastro-paciente.port.ts
        catalogo-clinico.port.ts
        crm.port.ts
        notificador.port.ts
        fila.port.ts
      agendar-consulta/
        agendar-consulta.comando.ts
        agendar-consulta.usecase.ts        @Injectable(), injeta ports via @Inject(TOKEN)
      processar-resposta-lembrete/
        processar-resposta.comando.ts
        processar-resposta.usecase.ts      @Injectable()

    infrastructure/
      persistencia/prisma/
        agendamento.prisma-repositorio.ts
        correlacao-paciente.prisma-repositorio.ts
        evento.prisma-repositorio.ts
      medx/                                mesma lógica de hoje, classes @Injectable()
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
        fila.module.ts                     BullModule.forRootAsync + registerQueue
        adapter.processor.ts               @Processor(NOME_FILA, {...}) extends WorkerHost
        bullmq-fila.adapter.ts             implementa FilaPort sobre a Queue do Nest

    presentation/
      http/
        webhooks.controller.ts             @Controller() — POST agendamento, POST resposta-lembrete
        health.controller.ts               GET /health
        schemas.ts                         zod, reaproveitado
        painel-fila.ts                     Bull Board — mesma lógica de hoje
      agendamento.module.ts                @Module — controllers + providers deste contexto

    agendamento.module.ts                  agrega os módulos acima

  shared/
    persistence/
      prisma.service.ts                    PrismaClient como @Injectable() (OnModuleInit/OnModuleDestroy)
      persistence.module.ts                @Global() — Symbol() tokens → useClass Prisma repos
    observabilidade/
      logger.module.ts                     LoggerModule.forRootAsync (nestjs-pino) com CAMPOS_REDIGIDOS
      alerta-logger.ts                     @Injectable() implements LoggerMinimo — envolve pino + notifica
      notificador-email.ts                 mesma lógica de hoje, @Injectable()
    filters/
      webhook-not-found.filter.ts          404 em /webhooks/* também vira 200 com log de alerta

prisma/
  schema.prisma
  migrations/

test/
  webhooks.e2e-spec.ts                     Test.createTestingModule + supertest
```

### Regras de dependência (preservadas)

As mesmas regras do projeto atual continuam valendo, agora expressas via `@Module` em vez
de convenção testada por scanner de arquivos:

- `domain/` não importa de nenhuma outra camada — continua puro TypeScript.
- `application/` importa de `domain/` e das interfaces em `application/ports/` — nunca de
  `infrastructure/`.
- `infrastructure/` implementa os ports e importa de `domain/`.
- `presentation/` (controllers) injeta usecases e ports via `@Inject()`, nunca implementa
  lógica de negócio.
- `shared/persistence/persistence.module.ts` é o único lugar que liga interface (`Symbol()`
  token) a implementação concreta (`useClass`) — equivalente ao `container.ts` de hoje,
  mas declarativo.

O teste de arquitetura atual (`tests/api/arquitetura.test.ts`, que varre imports por texto)
é substituído por um lint rule (`eslint-plugin-boundaries` ou verificação equivalente) ou
mantido como está, adaptado aos novos caminhos — decisão de detalhe para o plano de
implementação, não bloqueia este spec.

### DI e persistência (padrão do `api-agendaflow`)

```ts
// shared/persistence/persistence.module.ts
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
  exports: [PrismaService, AGENDAMENTO_REPOSITORIO, CORRELACAO_PACIENTE_REPOSITORIO, EVENTO_REPOSITORIO],
})
export class PersistenceModule {}
```

Os usecases passam a receber os repositórios/ports por injeção de construtor:

```ts
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

  async executar(comando: ComandoAgendamento): Promise<void> {
    // corpo idêntico ao usecase atual — nenhuma regra de negócio muda
  }
}
```

## 5. Modelo de dados (Prisma)

```prisma
// prisma/schema.prisma
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

**Nota crítica preservada do design original:** `inicio` e `ultimaEdicao` são `String`, não
`DateTime`. `PeriodoConsulta` produz uma string sem offset representando horário local da
clínica (`America/Sao_Paulo`); usar `DateTime` faria o Prisma devolver um `Date` do JS, e
`new Date("2026-07-10T14:00:00")` (sem "Z") é interpretado pelo runtime como horário local
**do processo**, não da clínica — reintroduzindo dependência do timezone do container, o
exato bug que `PeriodoConsulta` existe para eliminar. Os timestamps de auditoria
(`criadoEm`/`atualizadoEm`/`recebidoEm`) são seguros como `DateTime` porque nunca entram em
comparação de horário de consulta.

Migrations Prisma (`prisma migrate dev` em desenvolvimento, `prisma migrate deploy` no
entrypoint de produção) substituem as migrations SQL embutidas em `abrirBanco()`.

## 6. Fila (`@nestjs/bullmq`)

```ts
// infrastructure/fila/fila.module.ts
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => ({ connection: { url: config.get('REDIS_URL') } }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: NOME_FILA, defaultJobOptions: OPCOES_JOB }),
  ],
  providers: [
    AdapterProcessor,
    { provide: FILA_PORT, useClass: BullMqFilaAdapter },
  ],
  exports: [FILA_PORT],
})
export class FilaModule {}
```

```ts
// infrastructure/fila/adapter.processor.ts
@Processor(NOME_FILA, { concurrency: 1, limiter: LIMITER }) // max: 25, duration: 60_000 — preservado
export class AdapterProcessor extends WorkerHost {
  constructor(
    @Inject(EVENTO_REPOSITORIO) private readonly eventos: EventoRepositorio,
    private readonly agendarConsulta: AgendarConsultaUseCase,
    private readonly processarResposta: ProcessarRespostaUseCase,
  ) {
    super();
  }

  async process(job: Job<JobAdapter>): Promise<void> {
    const evento = this.eventos.registrarExistente(job.data.eventoId);
    try {
      if (job.data.tipo === 'agendamento') {
        await this.agendarConsulta.executar(job.data.comando);
      } else {
        await this.processarResposta.executar(job.data.comando);
      }
      evento.marcarProcessado();
      this.eventos.salvar(evento);
    } catch (erro) {
      if (erro instanceof ErroRateLimit) {
        await this.worker.rateLimit(erro.esperarSegundos * 1000);
        throw Worker.RateLimitError(); // não conta como tentativa — mesmo fix da revisão final do projeto atual
      }
      evento.marcarFalha(erro instanceof Error ? erro.message : String(erro));
      this.eventos.salvar(evento);
      throw erro;
    }
  }

  @OnWorkerEvent('failed')
  aoFalhar(job: Job, erro: Error): void {
    // alerta de dead letter — mesma lógica de hoje
  }
}
```

`WorkerHost.worker` dá acesso à instância real do BullMQ, permitindo que o fix de rate-limit
(usar `Worker.RateLimitError()` em vez de deixar o BullMQ contar a tentativa — corrigido na
revisão final do projeto atual) migre quase linha a linha.

## 7. Apresentação HTTP e a garantia "sempre 200"

Segue o precedente do `api-agendaflow` (webhooks do WhatsApp/Google Calendar): try/catch
dentro do handler, retorno silencioso em erro — **não** um filtro de exceção global, que
transformaria erros de negócio capturados em 500.

```ts
@Controller('webhooks/clint')
export class WebhooksController {
  constructor(
    @Inject(FILA_PORT) private readonly fila: FilaPort,
    @Inject(EVENTO_REPOSITORIO) private readonly eventos: EventoRepositorio,
    @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
  ) {}

  @Post('agendamento')
  @HttpCode(200)
  async agendamento(
    @Headers('x-adapter-secret') segredo: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    if (segredo !== this.segredoEsperado) {
      this.logger.warn({ endpoint: 'agendamento' }, 'segredo inválido');
      return { ok: true };
    }
    const evento = this.eventos.registrar('/webhooks/clint/agendamento', body);
    const validado = schemaAgendamento.safeParse(body); // zod, reaproveitado
    if (!validado.success) {
      evento.marcarInvalido(validado.error.issues.map((i) => i.path.join('.')).join(', '));
      this.eventos.salvar(evento);
      return { ok: true };
    }
    try {
      const job = await this.fila.add('agendamento', { tipo: 'agendamento', eventoId: evento.id, comando: {...} });
      if (job.id) { evento.associarJob(job.id); this.eventos.salvar(evento); }
    } catch (erro) {
      evento.marcarFalha(`não foi possível enfileirar: ${(erro as Error).message}`);
      this.eventos.salvar(evento);
      this.logger.error({ alerta: true, evento_id: evento.id }, 'fila indisponível');
    }
    return { ok: true }; // SEMPRE, qualquer caminho
  }

  // POST resposta-lembrete: mesmo padrão
}
```

Rota/método errado (404) nos webhooks: um filtro dedicado, restrito a `/webhooks/*`,
loga com `alerta: true` e responde 200 — não um `@Catch()` global, para não mascarar 404s
legítimos de outras rotas que a API venha a ter no futuro (`/health`, `/admin/filas`).

Não há prefixo global `/api/v1` — este adapter não é uma API pública versionada consumida
por múltiplos apps cliente (diferente do `api-agendaflow`); as rotas permanecem
`/webhooks/clint/*`, `/health`, `/admin/filas`, como estão hoje.

## 8. Logger e alertas

```ts
// shared/observabilidade/logger.module.ts
LoggerModule.forRootAsync({
  useFactory: (config: ConfigService) => ({
    pinoHttp: {
      level: config.get('LOG_LEVEL'),
      redact: CAMPOS_REDIGIDOS, // reaproveitado literalmente do projeto atual
      base: { servico: 'adapter-clint-medx' },
      autoLogging: false,
    },
  }),
  inject: [ConfigService],
})
```

`envolverComAlertas` (hoje uma função pura que decora um `LoggerMinimo`) vira um
`@Injectable()` fino que implementa a mesma interface `LoggerMinimo`, injetando o
`PinoLogger` real e o `NotificadorPort`:

```ts
@Injectable()
export class AlertaLogger implements LoggerMinimo {
  constructor(
    @InjectPinoLogger(AlertaLogger.name) private readonly pino: PinoLogger,
    @Inject(NOTIFICADOR_PORT) private readonly notificador: NotificadorPort,
  ) {}
  info(o: unknown, m?: string) { this.pino.info(o, m); }
  warn(o: unknown, m?: string) { /* loga + dispara alerta se alerta:true — lógica idêntica a hoje */ }
  error(o: unknown, m?: string) { /* idem */ }
}
```

A lógica interna (quando alertar, engolir falha do notificador sem derrubar o log) não
muda — só a embalagem. Os usecases continuam recebendo `LoggerMinimo` via
`@Inject(LOGGER_PORT)`, então **nenhum teste de `domain/`/`application/` muda**.

## 9. Testes

| Camada | Estratégia | Muda em relação a hoje? |
|---|---|---|
| `domain/` | Vitest puro, zero dependência de Nest | Não muda |
| `application/` | Instanciação direta da classe com `vi.fn()` nos ports (sem `TestingModule`, igual ao `api-agendaflow`) | Troca `criarX(deps)` por `new XUseCase(deps)`; mesma cobertura |
| `infrastructure/persistencia` | Testes de comportamento real contra Postgres de teste (via `docker-compose` de dev/CI) | Perde o `:memory:` instantâneo do SQLite — precisa de um Postgres de teste subindo antes da suíte |
| `infrastructure/medx`, `infrastructure/clint` | Dublê de `fetch`/`MedxClient`, sem mudança de abordagem | Não muda |
| `presentation/` | `Test.createTestingModule` + supertest — suíte e2e real | **Novo** em relação ao `api-agendaflow` (que não tem e2e) — deliberado, dada a criticidade da garantia "sempre 200" |

O teste de arquitetura (hoje um scanner de imports por texto) é substituído por regra de
lint (`eslint-plugin-boundaries` ou equivalente) verificando as mesmas quatro regras de
dependência entre camadas — detalhe de implementação, não bloqueia este spec.

## 10. CI/CD e qualidade de código

Copiados e adaptados de `api-agendaflow` (`.github/workflows/`):

- **`ci.yaml`**: checkout, Node 22, `npm ci`, commitlint em PRs, `prisma generate` (com
  `DATABASE_URL` secret), ESLint, Prettier `--check`, `npm run build`, **e `npm test`**
  (adicionado — o `api-agendaflow` não roda testes em CI, lacuna que não copiamos). Job de
  `release` (via `standard-version`) em push para `main`, igual ao original.
- **`cd.yaml`**: mesmo padrão exato — build+push da imagem para GHCR, deploy via SSH
  (`appleboy/ssh-action`) rodando `docker compose pull/up --force-recreate`, healthcheck
  com retry (12× 5s) e rollback automático restaurando o `.env` anterior em caso de falha.
  Nomes de serviço/path trocados para `adapter-clint-medx` (`SERVICE=adapter-clint-medx`,
  `ENV_FILE=.env.adapter-clint-medx`, path `/srv/adapter-clint-medx/`); referencia os
  mesmos nomes de secret do padrão da empresa (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`,
  `GHCR_TOKEN`, `API_DOMAIN`) — os valores são configurados nos secrets do repositório,
  fora do escopo deste documento.
- **`label-pr.yml`**, **`pr-metadata-check.yml`**: copiados sem alteração estrutural
  (genéricos); as labels `type:`/`priority:`/`area:` precisam existir no repositório antes
  de ativar.
- **`project-automation.yml`**: não copiado nesta fase (sem GitHub Project board definido).
- **Issue templates + PR template**: copiados, com as opções de `area:` trocadas para o
  domínio deste projeto (`medx`, `clint`, `fila`, `agendamento` em vez de `whatsapp`/
  `presencia`/etc.).

**Qualidade de código** (inexistente no projeto atual — adicionado nesta migração):
`eslint.config.mjs` (flat config, ESLint 9, mesmas regras relaxadas do `api-agendaflow` —
`no-explicit-any: off`, etc.), `.prettierrc` (4 espaços, aspas simples, 100 colunas),
`.prettierignore`, `.editorconfig`, `commitlint.config.js` (Conventional Commits),
`.husky/pre-commit` rodando `lint-staged`, `nest-cli.json`. `tsconfig.json` ganha o alias
`@/* → src/*` (decisão da Seção 3 — a proibição original de path aliases deixa de se
aplicar porque o build do Nest resolve isso corretamente em tempo de compilação, diferente
do cenário original que motivou a proibição).

`.env.example` reescrito do zero com a mesma convenção visual do `api-agendaflow` (seções
`# ===`, comentários em português explicando o porquê), mas só com as variáveis reais deste
projeto: `NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL`, `ADAPTER_SECRET`, `MEDX_HOST`,
`MEDX_INTEGRATION_TOKEN`, `CLINT_WEBHOOK_AGENDAMENTO_URL`, `CLINT_WEBHOOK_NOTIFICACAO_URL`,
`RETENCAO_DIAS`, `LOG_LEVEL`, `SMTP_URL`, `ALERTA_EMAIL_DESTINO`, `ALERTA_EMAIL_ORIGEM`,
`BULLBOARD_USUARIO`, `BULLBOARD_SENHA`.

## 11. Docker

`Dockerfile` multi-stage seguindo o padrão do `api-agendaflow`: estágio `deps` (`npm ci`),
`builder` (`npx prisma generate` + `npm run build`), `runner` final rodando como usuário
não-root (`node` ou equivalente — fecha um achado Minor da revisão final do projeto atual,
que apontava o container rodando como root). `docker-compose.yml` ganha um serviço
`postgres` (volume nomeado, igual ao `redis` já existente); o entrypoint roda
`prisma migrate deploy` antes de `node dist/main.js`.

## 12. O que NÃO muda

Para deixar explícito o que este spec preserva sem alteração, já revisado no projeto
original:

- Toda a lógica de `domain/`: `Telefone`, `Cpf`, `PeriodoConsulta`, `Agendamento`
  (incluindo `avaliarConfirmacao` e a correção de `tentativaInterrompida` da revisão
  final), `RespostaLembrete`, `CorrelacaoPaciente`, `EventoRecebido`.
- Toda a lógica de `application/`: `AgendarConsultaUseCase` e `ProcessarRespostaUseCase`
  — idempotência, adoção de órfão, checagem de identidade do id de agendamento (fix da
  revisão final), enriquecimento de CPF, tratamento de match duvidoso.
- Todos os adapters MedX (`medx-catalogo`, `medx-cadastro-paciente`, `medx-agenda` —
  incluindo o fix da descoberta de status por igualdade exata e a correção de PII na
  mensagem de erro) e o adapter Clint.
- O achado Important não corrigido da revisão final (`STATUS_MEDX_AGENDADO` hardcoded em
  vez de descoberto em runtime) permanece como recomendação de follow-up — não é escopo
  desta migração, mas também não é esquecido: deve ser tratado antes do go-live com uma
  conta MedX cuja lista de status não comece necessariamente por "Agendado".
- Os 11 achados Minor da revisão final continuam registrados como follow-up, independente
  desta migração.
</content>
