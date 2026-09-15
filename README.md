# Adapter Clint ↔ MedX

Traduz webhooks do Clint em chamadas à API REST do MedX: cria agendamentos e processa
as confirmações que os pacientes respondem pelo WhatsApp.

Migrado de Fastify+SQLite para **NestJS + Prisma/PostgreSQL + `@nestjs/bullmq`**, seguindo
o padrão de stack da empresa (ver `docs/superpowers/specs/2026-09-15-migracao-nestjs-design.md`).

## Arquitetura

Camadas DDD dentro de `src/agendamento/`, expressas como módulos e providers do Nest.

| Camada                  | Papel                                                                  |
| ----------------------- | ---------------------------------------------------------------------- |
| `domain/`               | Regras e entidades. Framework-agnóstico, zero import de Nest           |
| `application/`          | Casos de uso (`@Injectable()`) sobre ports. Não conhece MedX nem Clint |
| `infrastructure/`       | Adapters concretos: MedX, Clint, Prisma, `@nestjs/bullmq`              |
| `presentation/`         | Controllers HTTP e painel da fila                                      |
| `agendamento.module.ts` | Liga as implementações concretas aos ports via `Symbol()` tokens       |

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
