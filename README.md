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
