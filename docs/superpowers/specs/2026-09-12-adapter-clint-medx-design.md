# Adapter Clint ↔ MedX — Design

**Data:** 2026-09-12
**Status:** aprovado para planejamento

## 1. Contexto

A clínica opera o atendimento comercial no **Clint** (CRM com automações de WhatsApp
e webhooks) e a operação clínica no **MedX** (agenda, prontuário, finanças). Hoje o
agendamento é transcrito manualmente de um sistema para o outro.

Este projeto entrega um **servidor adapter** que traduz os webhooks do Clint em
chamadas à API REST do MedX, e devolve o resultado ao Clint.

O adapter é um tradutor, não uma fonte de verdade. Ele não guarda dado clínico além
do mínimo necessário para correlacionar os dois sistemas e auditar o que fez.

## 2. Escopo

### Dentro

- **Fluxo A — agendamento:** negócio muda de etapa no Clint → adapter resolve o
  paciente no MedX, cria o agendamento, devolve o ID ao Clint.
- **Fluxo B — confirmação D-1:** paciente responde o lembrete → adapter confirma o
  agendamento no MedX (só na opção "confirmar") e devolve a resposta ao Clint.
- Idempotência, fila com retry, auditoria e observabilidade dos dois fluxos.

### Fora

- Remarcação automática (exigiria consulta de disponibilidade e conversa com estado).
- Cancelamento automático no MedX — a secretária assume.
- Qualquer escrita no módulo financeiro do MedX.
- Disparo de mensagens de WhatsApp pelo adapter. Quem fala com o paciente é o Clint.

## 3. Decisões e justificativas

| Decisão | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript (Node) | Já é a stack do time; tipar os dois contratos é o que segura um adapter de tradução |
| Hospedagem | VPS própria, Docker | Processo longo para o worker; sem dependência de fila gerenciada |
| Entrega | ACK 200 imediato + fila | O webhook do Clint **se autodesativa após 3 falhas consecutivas**; nunca podemos devolver erro |
| Fila | BullMQ sobre Redis | Retry com backoff, dead letter e **rate limiter nativo** — este último é obrigatório dado o limite do MedX |
| Persistência | SQLite em modo WAL, em volume da VPS | O Redis serve à fila; correlação, idempotência e auditoria LGPD precisam de registro durável e consultável. Backup é cópia de arquivo, e migrar para Postgres depois é troca de repositório |
| Correlação | `Id_do_Agendamento` | O MedX **não retorna link de agendamento**; o ID inteiro é o identificador canônico |
| Identidade do paciente | Telefone + nome + nascimento, via `POST /contatos/vinculo`, com cache local | É o único endpoint que faz match-ou-cria e devolve ID; CPF não é aceito em busca |
| CPF | Enriquecimento pós-cadastro | A API não permite busca por CPF; ele passa a ser dado de ficha, não chave |
| Saída para o Clint | Webhook de entrada, atrás de interface | Plano atual suporta webhook; a interface permite trocar por `POST /v1/deals/{id}` sem tocar no resto |

### Decisões descartadas

- **Síncrono puro** (chamar o MedX dentro da request do webhook): qualquer lentidão
  do MedX vira timeout no Clint, e três timeouts desativam a integração silenciosamente.
- **Link de confirmação do MedX** (`medx.med.br/l/?i=XXXX`): não existe na API de
  integração e o código é opaco. Torna-se redundante — quem confirma agora é a
  quick reply do WhatsApp.
- **CPF como chave de busca:** exigiria paginar `/contatos/grid` inteiro, inviável
  sob 30 req/min.

## 4. Arquitetura

O adapter é organizado em camadas DDD. `lib/` guarda o que é transversal a todas elas;
`src/api/` guarda as camadas propriamente ditas.

### Fluxo de uma requisição

```
                        ┌──────────────────────────────────────┐
  Clint ──webhook──▶    │  presentation/http                   │
                        │  valida segredo → grava evento       │
                        │  → enfileira → 200 OK (~20ms)        │
                        └──────────────┬───────────────────────┘
                                       │
                        ┌──────────────▼───────────────────────┐
                        │  infrastructure/fila (BullMQ)        │
                        │  backoff exponencial + limiter       │
                        └──────────────┬───────────────────────┘
                                       │
                        ┌──────────────▼───────────────────────┐
                        │  application/                        │
                        │  AgendarConsulta                     │
                        │  ProcessarRespostaLembrete           │
                        │  (conhecem apenas ports)             │
                        └──────┬────────────────────┬──────────┘
                               │                    │
                    ┌──────────▼─────────┐  ┌───────▼──────────┐
                    │ infrastructure/    │  │ infrastructure/  │
                    │ medx (3 adapters)  │  │ clint (1 adapter)│
                    └────────────────────┘  └──────────────────┘

              domain/ é chamado por todas e não importa nenhuma
```

### Estrutura de diretórios

```
lib/
  config/env.server.ts                    validação de ambiente com Zod
  logger.ts                               pino + redação de dados pessoais

src/api/
  domain/
    shared/erros.ts
    paciente/
      telefone.ts                         VO
      cpf.ts                              VO
      correlacao-paciente.ts              entidade
      correlacao-paciente.repositorio.ts  port de persistência
    agendamento/
      periodo-consulta.ts                 VO
      resposta-lembrete.ts                VO
      agendamento.ts                      entidade + regras de transição
      agendamento.repositorio.ts          port de persistência
    evento/
      evento-recebido.ts                  entidade
      evento.repositorio.ts               port de persistência

  application/
    ports/
      agenda-medica.port.ts
      cadastro-paciente.port.ts
      catalogo-clinico.port.ts
      crm.port.ts
      notificador.port.ts
    agendar-consulta/
    processar-resposta-lembrete/

  infrastructure/
    persistencia/sqlite/                  conexão + três repositórios
    medx/                                 token, client HTTP, três adapters
    clint/                                adapter de webhook de entrada
    fila/                                 BullMQ e processador
    observabilidade/                      notificador de e-mail, alertas

  presentation/
    http/                                 servidor, schemas, rotas, painel da fila

  composition/container.ts                wiring de todas as dependências
  main.ts                                 entrypoint
```

### Regras de dependência

| Camada | Pode importar de | Nunca importa de |
|---|---|---|
| `domain` | `lib`, e só de si mesma | qualquer outra camada |
| `application` | `domain`, `lib` | `infrastructure`, `presentation` |
| `infrastructure` | `application` (ports), `domain`, `lib` | `presentation` |
| `presentation` | `application`, `domain`, `lib` | `infrastructure` (exceto via container) |
| `composition` | todas | — |

O ganho concreto: quando o MedX mudar um campo, a mudança fica confinada em
`infrastructure/medx/`. O `domain` e a `application` não têm como saber que o MedX
existe — eles conhecem `AgendaMedicaPort`, e nada mais.

### Onde mora a regra de negócio

O `domain` carrega decisões, não só dados. Em particular:

- `Telefone` e `Cpf` validam e normalizam na construção — um `Telefone` inválido não existe.
- `PeriodoConsulta` calcula o fim a partir do início e da duração, no fuso da clínica.
- `Agendamento.podeSerConfirmado(estadoNoMedx)` decide se a confirmação prossegue ou é
  recusada, encapsulando as regras de horário alterado e consulta cancelada.
- `RespostaLembrete` só admite os três valores que o lembrete oferece.

Os casos de uso orquestram; eles não decidem.

## 5. Contrato de entrada — webhooks do Clint

Os nomes dos campos no webhook de saída do Clint são editáveis pela clínica, então
fixamos o contrato abaixo e configuramos o Clint para casar com ele.

Ambos os endpoints exigem o header `X-Adapter-Secret` com o segredo compartilhado.
O webhook de saída do Clint **não é assinado por HMAC** (o HMAC do `PUT /v2/webhooks`
cobre apenas eventos de SMS/Voice), portanto o segredo é a única barreira.

### `POST /webhooks/clint/agendamento`

| Campo | Obrigatório | Tipo | Observação |
|---|---|---|---|
| `deal_id` | sim | uuid | Chave de idempotência |
| `nome` | sim | string | Nome do paciente |
| `telefone` | sim | string | Chave de identidade; normalizado para E.164 |
| `data_nascimento` | sim | `YYYY-MM-DD` | Desempate de homônimos e familiares |
| `data_hora` | sim | ISO 8601 | Início da consulta |
| `profissional` | sim | string \| int | ID do MedX ou nome (resolvido por cache) |
| `tipo_consulta` | sim | string \| int | ID ou nome; define a duração |
| `cpf` | não | string | Enriquece a ficha após o cadastro |
| `email` | não | string | Cadastro |
| `sexo` | não | `M` \| `F` | Cadastro |

### `POST /webhooks/clint/resposta-lembrete`

| Campo | Obrigatório | Tipo | Observação |
|---|---|---|---|
| `deal_id` | sim | uuid | Idempotência e correlação |
| `id_agendamento_medx` | sim | int | Gravado pelo adapter no Fluxo A; mesmo nome do campo customizado no Clint |
| `resposta` | sim | enum | `confirmar` \| `reagendar` \| `cancelar` |

Payload que não valida contra o schema é gravado como evento com status `invalid`
e **responde 200 assim mesmo** — recusar com 4xx conta como falha e aproxima a
desativação do webhook. O alerta vai pelo canal de observabilidade, não pelo HTTP.

## 6. Contrato de saída — MedX

Host: `https://integracao-app.medx.med.br`

### Autenticação

`POST /api/integration/token` troca o token de integração por um JWT de ~15 minutos.
As demais chamadas usam `Authorization: Bearer <accessToken>`.

Escopos necessários: `contatos:read`, `contatos:write`, `agenda:read`, `agenda:write`,
`financas:read` (este último só para listar profissionais e procedimentos).

**Cache de token:** o JWT é guardado no Redis com renovação 2 minutos antes de expirar,
protegida por lock distribuído. Sem isso, jobs concorrentes disparam renovações em
paralelo e batem no limite de 10 trocas/min por IP — derrubando a própria autenticação.

### Rate limiting

| Política | Limite | Partição |
|---|---|---|
| Troca de token | 10 req/min | por IP |
| Chamadas da API | 30 req/min | por conta |

O `429` vem com `Retry-After: 60`.

O worker roda com `concurrency: 1` e `limiter: { max: 25, duration: 60000 }`. A margem
de 5 abaixo do teto protege contra chamadas manuais ou de outra integração na mesma
conta. Um `429` não conta como falha do job: o worker respeita o `Retry-After` e
reenfileira com atraso.

### Resolvers com cache

Três tabelas de apoio são carregadas na inicialização e revalidadas a cada 6 horas:

| Recurso | Endpoint | Uso |
|---|---|---|
| Profissionais | `GET /financas/profissionais` | `IdDoUsuario` ← ID ou `NomeCompleto` |
| Tipos de consulta | `GET /agenda/tipos` | `IddoDiagnosticoQP` e `Tempo` (duração) |
| Status da agenda | `GET /agenda/status` | Índice do rótulo `Confirmado` |

**O índice de status é descoberto, nunca codificado.** A API devolve um array de
rótulos onde a posição é o valor (`["Agendado", "Confirmado", "Chegou", "Cancelado"]`),
mas os rótulos são customizáveis por conta e os exemplos da documentação são
contraditórios — o exemplo de criação usa `Status: 1` e o de atualização usa
`Status: 3`. O adapter procura o rótulo `Confirmado` (case-insensitive, sem acento)
e usa o índice encontrado. **Se não encontrar, o processo falha na inicialização com
erro explícito.** Chutar aqui significa cancelar consultas achando que confirma.

### Chamadas usadas

| Operação | Endpoint |
|---|---|
| Resolver paciente | `POST /api/integration/contatos/vinculo` |
| Enriquecer CPF | `PUT /api/integration/contatos` |
| Criar agendamento | `POST /api/integration/agenda/agendamentos` |
| Ler agendamento | `GET /api/integration/agenda/agendamentos/{id}` |
| Confirmar | `PUT /api/integration/agenda/agendamentos` |
| Detectar duplicata | `GET /api/integration/agenda/agendamentos/paciente/{idPaciente}` |

## 7. Fluxo A — agendamento

```
1. Já existe agendamento para este deal_id na tabela local?
   → sim: encerra o job com sucesso (idempotência)

2. Resolve o paciente:
   a. cache local tem o telefone normalizado? → usa o Id_do_Cliente, 0 chamadas
   b. senão: POST /contatos/vinculo { Name, Phone, DateOfBirth, Email, Gender }
      → grava no cache; se Match=false, marca o registro para revisão humana

3. Resolve profissional (Id_do_Usuario) e tipo (Id_do_TipoConsulta + Tempo)
   pelos resolvers em cache

4. Calcula Final = Inicio + Tempo (minutos)
   Monta Descricao = "<tipo de consulta> — <nome do paciente>"

5. Grava intenção na tabela local (status=enviando) ANTES da chamada

6. POST /agenda/agendamentos
   → resposta é um inteiro puro: o Id_do_Agendamento

7. Grava o Id_do_Agendamento na tabela local (status=criado)

8. Se veio CPF: PUT /contatos enriquece a ficha (falha aqui não falha o job)

9. ClintGateway.gravarIdAgendamento(deal_id, id_agendamento)
```

### Normalização de data e hora

O MedX envia e aceita datas **sem timezone** (`"2026-07-10T14:00:00"`), o que significa
horário local da clínica. O adapter converte tudo para `America/Sao_Paulo` e serializa
sem offset. Todo `Date` cruzando a fronteira do módulo `medx/` passa por essa conversão —
é o bug que marca a consulta três horas errada e só aparece quando a paciente chega.

### Idempotência e duplicatas

`POST /agenda/agendamentos` não aceita chave de idempotência. Se a rede cair depois
do MedX gravar e antes de recebermos a resposta, o retry criaria uma segunda consulta.

Mitigação em duas camadas:

1. A tabela local grava a intenção **antes** da chamada. Um retry encontra o registro
   em `enviando` e, em vez de recriar, consulta
   `GET /agenda/agendamentos/paciente/{idPaciente}` procurando um agendamento com o
   mesmo `Id_do_Usuario` e `Inicio`. Se achar, adota o ID existente.
2. `deal_id` é chave única na tabela de agendamentos.

## 8. Fluxo B — resposta ao lembrete

```
1. Grava a resposta do paciente na tabela de eventos (as três opções)

2. switch (resposta):

   confirmar:
     a. GET /agenda/agendamentos/{id}   — estado fresco
     b. valida o estado atual:
          consulta cancelada?            → não confirma, alerta, devolve ao Clint
          Inicio mudou desde o Fluxo A?  → não confirma, alerta, devolve ao Clint
     c. monta o PUT a partir do que o GET devolveu, alterando apenas:
          Status      → índice descoberto de "Confirmado"
          Confirmacao → "Mensagem Salva com Sucesso"   (string literal exigida)
     d. grava o LastEditDate retornado, marca status=confirmado
     e. ClintGateway.notificarConfirmacao(deal_id)

   reagendar:
     ClintGateway.notificarReagendamento(deal_id)   — sem chamada ao MedX

   cancelar:
     ClintGateway.notificarCancelamento(deal_id)    — sem chamada ao MedX
```

O `PUT` não é um PATCH: ele exige `Id_do_Agendamento`, `Id_do_Usuario`, `Inicio`,
`Final`, `Descricao`, `Status`, `Vinculado_a` e `Id_do_TipoConsulta`. Por isso o
ciclo ler-modificar-escrever, e por isso o corpo do `PUT` é montado a partir da
resposta do `GET` — qualquer edição que a secretária tenha feito entre o agendamento e
a confirmação é preservada, em vez de sobrescrita por dados de um dia atrás.

A validação do passo (b) existe porque o paciente pode confirmar um horário que não
existe mais. O lembrete saiu com um horário específico; se a secretária remarcou ou
cancelou desde então, confirmar automaticamente daria ao paciente a garantia de uma
consulta errada. Nesses casos o adapter não escreve no MedX e devolve o caso para
atendimento humano.

Reagendar e cancelar não tocam o MedX: a secretária assume. **Consequência operacional
a comunicar à clínica:** o horário permanece ocupado no MedX até alguém agir.

## 9. Modelo de dados

```
eventos_recebidos
  id, endpoint, payload_bruto (json), recebido_em,
  status (recebido|processado|invalido|falhou), job_id, erro

pacientes_correlacao
  telefone_normalizado (único), medx_id_cliente, clint_contact_id,
  match_confiavel (bool), revisado (bool), criado_em

agendamentos
  deal_id (único), medx_id_agendamento, medx_id_cliente,
  medx_id_usuario, inicio, last_edit_date,
  status (enviando|criado|confirmado|conflito|falhou),
  criado_em, atualizado_em
```

`payload_bruto` é gravado **antes** de qualquer processamento. É o que garante que
nada se perde: a fila decide como reprocessar, mas o registro do que chegou é
independente dela.

## 10. Erros e casos de borda

| Situação | Comportamento |
|---|---|
| MedX fora do ar | Retry com backoff exponencial (1min, 5min, 15min, 1h, 6h); depois dead letter |
| `429` do MedX | Reenfileira respeitando `Retry-After`; não conta como tentativa |
| JWT expirado no meio do job | Renova e repete a chamada uma vez, transparente |
| `Match: false` no vínculo | Segue o fluxo, mas marca `match_confiavel=false` e alerta |
| Horário mudou ou consulta cancelada | Não confirma, marca `conflito`, alerta e devolve ao Clint para atendimento humano |
| Profissional não resolvido | Falha o job com erro explícito; revalida o cache antes de desistir |
| Rótulo `Confirmado` ausente | Falha na inicialização do processo |
| Payload inválido | Grava como `invalido`, responde 200, alerta |
| `deal_id` repetido | Job encerra com sucesso sem chamar o MedX |
| Webhook de volta ao Clint falha | Retry próprio; o agendamento no MedX já está criado e não é refeito |

O princípio que atravessa a tabela: **o endpoint HTTP sempre responde 200**. Erro é
sinalizado por observabilidade, nunca por status code — porque status code de erro,
repetido três vezes, desliga a integração.

## 11. Segurança e LGPD

- Token de integração do MedX e segredo do webhook em variáveis de ambiente, nunca
  no código nem em log.
- O adapter trafega CPF, telefone, nome e data de nascimento — dado pessoal sensível
  por contexto de saúde. TLS obrigatório; a VPS não expõe a porta do Redis.
- `payload_bruto` tem retenção de 90 dias, alinhada ao histórico do próprio Clint,
  com expurgo automático.
- Logs registram `deal_id` e `Id_do_Agendamento`; **nunca** CPF, telefone ou nome.
- A trilha de auditoria responde "o que aconteceu com o agendamento da paciente X",
  que é a pergunta que a clínica vai fazer.

## 12. Observabilidade

- Log estruturado (JSON) com `deal_id` como chave de correlação ponta a ponta.
- Endpoint `/health` verificando Redis, banco e validade do token MedX.
- Bull Board protegido por autenticação para inspeção visual da fila.
- Alerta por e-mail para a gestão em: job na dead letter, conflito de
  `LastEditDate`, match não confiável, e falha na inicialização dos resolvers.

## 13. Testes

TDD. O `domain` e a `application` são o alvo principal — concentram a regra e não
dependem de I/O nenhum.

| Camada | Abordagem |
|---|---|
| `domain` | Unitários puros, sem dublê algum: validação de `Telefone` e `Cpf`, cálculo de `PeriodoConsulta`, e as transições de `Agendamento` — incluindo `podeSerConfirmado` com horário alterado e consulta cancelada |
| `application` | Unitários com todos os ports dublados. Cobrem idempotência, adoção de agendamento órfão, match duvidoso e os três ramos da resposta ao lembrete |
| `infrastructure/medx` | Integração contra `fetch` dublado respondendo os payloads reais da documentação, incluindo `429` e JWT expirado |
| `infrastructure/persistencia` | Integração contra SQLite em memória: unicidade, idempotência de `iniciar`, expurgo por retenção |
| `presentation/http` | Integração via `app.inject`: segredo inválido, payload inválido, fila fora do ar — **sempre assertando que a resposta é 200** |
| Ponta a ponta | Um agendamento e uma confirmação contra a conta de teste do MedX, executados manualmente antes do go-live |

A regra de dependência é testável e deve ser testada: um teste de arquitetura verifica
que nenhum arquivo em `src/api/domain` importa de `application`, `infrastructure` ou
`presentation`, e que nenhum arquivo em `src/api/application` importa de
`infrastructure` ou `presentation`.

O teste que não pode faltar: **o endpoint responde 200 mesmo com o MedX fora do ar**.
É a garantia de que o webhook não se desativa.

## 14. Tarefas de descoberta (antes de codificar)

Cinco perguntas que só a conta real responde. Uma sessão de uma hora com o token
de integração resolve todas.

1. `GET /agenda/status` — quais os rótulos e índices reais da clínica.
2. `GET /financas/profissionais` — confirmar que `IdDoUsuario` é mesmo o que o
   `POST /agenda/agendamentos` espera em `Id_do_Usuario`.
3. `GET /agenda/tipos` — inventário dos tipos e suas durações.
4. `POST /contatos/vinculo` com um paciente conhecido — verificar se `Id` volta como
   string numérica conversível para o `Vinculado_a` (integer) do agendamento.
5. Criar um agendamento de teste e ler `GET /agenda/agendamentos/{id}` — confirmar o
   formato exato de `Inicio`/`Final` gravados e inspecionar os campos `SMS` e
   `Confirmacao`.

## 15. Configuração no Clint (fora do código)

- Campo customizado `id_agendamento_medx` no negócio.
- Webhook de saída na origem, gatilho "mudar de etapa", método POST, apontando para
  `/webhooks/clint/agendamento` com o header de segredo.
- Webhook de saída para a resposta do lembrete, apontando para
  `/webhooks/clint/resposta-lembrete`.
- Integrações de entrada recebendo o retorno do adapter.
- **Verificar com o suporte do Clint** se a conta consegue disparar quick replies em
  mensagem iniciada pela clínica. No WhatsApp Official isso exige template aprovado
  pela Meta ou o recurso Direct Send (`WHATSAPP_OFFICIAL_DIRECT_SEND`). Se a conta
  não tiver, o Fluxo B inteiro não acontece — e isso é independente do adapter.

## 16. Fase 2 (fora deste escopo)

- Remarcação automática com `GET /agenda/disponibilidade`.
- Cancelamento automático no MedX.
- Migração do gateway de saída para a API REST do Clint (`POST /v1/deals/{id}`),
  que atualiza o negócio por ID em vez de casar por telefone.
