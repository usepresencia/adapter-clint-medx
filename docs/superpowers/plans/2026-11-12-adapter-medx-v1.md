# Adapter na API v1 do MedX + regravação de datas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pôr o adapter de volta no ar falando com a API v1 do MedX, sem cair quando o MedX falha, com a regra nova do lembrete (06:00) e uma rota que as automações da Clint chamam para regravar o campo de data que arma a próxima automação.

**Architecture:** As mudanças de MedX ficam todas em `src/agendamento/infrastructure/medx/` atrás dos ports existentes (`AgendaMedicaPort`, `CatalogoClinicoPort`, `CadastroPacientePort`); os use cases só mudam onde o catálogo vira assíncrono. A rota nova segue o padrão dos webhooks atuais (controller → evento → fila BullMQ → use case) e grava na Clint por um port novo que usa a API REST da Clint por `deal_id` (`POST /v1/deals/{id}`), não a integração de entrada por telefone.

**Tech Stack:** NestJS 11, TypeScript, Vitest, Luxon, Zod, BullMQ, `fetch` nativo.

**Spec:** `docs/superpowers/specs/2026-11-11-sincronizacao-medx-clint-design.md` (seções "Regra do lembrete de chegada", "Caminho 1" e a tabela da cadeia). O monitor (seção "Monitor") fica **fora** deste plano.

## Global Constraints

- Commits neste repositório: **só a linha de cabeçalho** (Conventional Commits), sem corpo e sem assinatura/Co-Authored-By.
- Fuso da clínica: `America/Sao_Paulo` (`FUSO_CLINICA`); horário local sem offset no formato `yyyy-LL-dd'T'HH:mm:ss` (`FORMATO_MEDX`) em todos os ports.
- Ids do MedX podem ser negativos; só `0`/`NaN` indicam falha.
- Troca de token: `POST {MEDX_HOST}/api/integration/v1/token` com corpo `{ "integrationToken": <MEDX_INTEGRATION_TOKEN> }`; resposta `{ accessToken, tokenType, expiresInSeconds, scope }`. Limite de 10 trocas/min por IP: manter o compartilhamento da troca em voo.
- Nome da variável de ambiente continua `MEDX_INTEGRATION_TOKEN` (já contém o token pessoal na VPS).
- Listagens v1: resposta `{ items, page: { limit, hasMore, nextCursor, total }, meta }`; seguir `Cursor = page.nextCursor` enquanto `hasMore`; nunca reaproveitar cursor com outros filtros.
- `/v1/agenda/agendamentos/detalhes`: `Inicio`/`Fim` com no máximo **31 dias**, `Fim` **exclusivo**.
- Escritas v1: `POST .../preview` → `operationId`; depois `POST .../executar` com corpo `{ operationId }` e cabeçalho `Idempotency-Key: <operationId>`. Prévia vale 10 min. Não gerar nova operação automaticamente após resultado incerto.
- Não enviar `ProfissionalId` na disponibilidade (bug conhecido: id negativo zera a resposta).
- Nunca logar nome, telefone ou descrição de paciente fora da redação do pino.
- Regra D0: lembrete = início − 2h; se cair antes das 08:00 → **06:00 do próprio dia da consulta**; consulta em fim de semana → 18:00 do último dia útil anterior (inalterado).
- Regra da checagem (inalterada): início + 2h; se ≥ 18:00 ou fim de semana → 08:00 do próximo dia útil.
- O adapter nunca grava na Clint um horário que já passou.

## Review Focus

1. Automação pede regravação de um agendamento que foi **desmarcado/cancelado/faltou** no MedX → não grava nada e registra aviso (teste na Task 9).
2. Horário calculado **já passou** (ex.: regravar lembrete depois da consulta) → não apaga nem grava (teste na Task 9).
3. Período de disponibilidade **maior que 31 dias** ou cruzando a fronteira de janela → várias chamadas, sem item duplicado nem perdido na fronteira (teste na Task 3).
4. Horários do MedX chegam **com offset** (`-03:00`) e alguns `paciente`/`tipo` vêm `null` (anotações tipo "COMEÇA AS 09:00H") → normaliza para local sem offset e não quebra (teste na Task 3).
5. Prévia respondendo **409** (conflito/versão mudou) ou executar falhando → erro `ErroMedx` com status, sem retentar com outra prévia dentro da mesma chamada (teste na Task 2).

---

### Task 0: Preparar o ambiente

- [ ] **Step 1:** `git checkout main && git pull` (o `main` local está 3 commits atrás de `origin/main`, versão 1.9.2).
- [ ] **Step 2:** Criar o workspace isolado com superpowers:using-git-worktrees, branch `fix/medx-api-v1`.
- [ ] **Step 3:** `npm ci && npm test` — Expected: suíte verde antes de qualquer mudança.

### Task 1: Verificação ao vivo da API da Clint — FEITA em 2026-11-12

Negócio de teste: `521e2bf6-1ce0-4cf0-91d9-ea2dc7627eb1` (contato Cesar Pisa, RECEPÇÃO / PÓS CONSULTA).

Resultado:
- `POST https://api.clint.digital/v1/deals/{id}` com `{"fields":{"data_agendamento":"2026-12-31","hora_agendamento":"08:00","horario_checagem_comparecimento":"2026-12-31T10:00:00"}}` → 200 e os valores aparecem no `GET` exatamente nesses formatos.
- **A API REST não apaga campo:** `""` e `null` respondem 200 e o valor continua. Por isso **quem apaga é a automação** (nó `UPDATE_DATA` com `value_source: CLEAR`), logo antes do webhook; o adapter só grava.
- **Gravação via REST arma o gatilho de data:** `horario_checagem_comparecimento = 2026-11-12T12:50:00` gravado às 12:47 → a automação Checagem Comparecimento executou às 12:50:31 para esse negócio (parou na condição, porque o negócio não está em BOAS VINDAS).

### Task 2: Token v1 e operações em duas etapas no cliente HTTP

**Files:**
- Modify: `src/agendamento/infrastructure/medx/medx-token.provider.ts:38-41`, `medx-http.client.ts`
- Test: `medx-token.provider.spec.ts`, `medx-http.client.spec.ts`

**Interfaces:**
- Produces:
  - `MedxHttpClient.listarTodos<T>(caminho: string, query?: Query): Promise<T[]>` — segue `page.nextCursor` enquanto `page.hasMore`, devolve a concatenação de `items`.
  - `MedxHttpClient.executarOperacao<R>(prefixo: string, corpoPrevia: unknown): Promise<R>` — `POST {prefixo}/preview`, depois `POST {prefixo}/executar` com `{ operationId }` e header `Idempotency-Key`; devolve o corpo do executar.
  - `post` passa a aceitar cabeçalhos extras: `post<T>(caminho, corpo, cabecalhos?: Record<string,string>)`.

- [ ] **Step 1: Testes que falham**
  - token: `'posta integrationToken no endpoint v1'` → URL `https://medx.test/api/integration/v1/token`, corpo `{ integrationToken: 'tk' }` (substitui o teste antigo).
  - http: `'listarTodos segue o cursor até hasMore=false'` → duas respostas `{items:[1],page:{hasMore:true,nextCursor:'c2'}}` e `{items:[2],page:{hasMore:false,nextCursor:null}}`; resultado `[1,2]`; segunda URL contém `Cursor=c2`.
  - http: `'executarOperacao faz preview e executar com Idempotency-Key'` → preview devolve `{operationId:'op-1'}`; segunda chamada em `/x/executar`, corpo `{operationId:'op-1'}`, header `idempotency-key: op-1`.
  - http: `'executarOperacao propaga 409 da prévia como ErroMedx sem chamar executar'` → `expect(...).rejects.toMatchObject({ status: 409 })` e `fetch` chamado 2 vezes no máximo (token + preview).
- [ ] **Step 2:** `npx vitest run src/agendamento/infrastructure/medx/medx-token.provider.spec.ts src/agendamento/infrastructure/medx/medx-http.client.spec.ts` — Expected: FAIL nos 4 testes novos.
- [ ] **Step 3:** Implementar. Token: só URL e chave do corpo mudam.
- [ ] **Step 4:** Mesmo comando — Expected: PASS.
- [ ] **Step 5:** `git commit -m "fix: troca de token e operações em duas etapas na API v1 do MedX"`

### Task 3: Leituras da agenda na v1

**Files:**
- Modify: `src/agendamento/infrastructure/medx/medx.tipos.ts` (substituir os tipos de agenda), `medx-agenda.adapter.ts` (`obter`, `listarPorPaciente`, `listarPorPeriodo`, `consultarDisponibilidade`)
- Test: `medx-agenda.adapter.spec.ts`

**Interfaces:**
- Consumes: `listarTodos` (Task 2).
- Produces:
  - Em `medx.tipos.ts`: `MedxReferencia { id: number; nome: string }`; `MedxAgendaDetalhe { id; inicio; fim; profissional: MedxReferencia|null; paciente: MedxReferencia|null; tipo: MedxReferencia|null; procedimentoId: number|null; status: MedxReferencia; descricao: string|null; confirmacao: string|null; sms: string|null; chegada: string|null; atendidoEm: string|null; saiuEm: string|null; atualizadoEm: string|null; versao: string }`; `MedxDisponibilidadeV1 { horarios: { inicio: string; fim: string }[] }`.
  - `paraHorarioLocal(iso: string): string` exportada de `medx-agenda.adapter.ts` — converte `...-03:00`/`Z` para `FORMATO_MEDX` em `FUSO_CLINICA`.
  - `AgendamentoExterno` preenchido assim: `id`, `idProfissional = profissional?.id ?? 0`, `idPaciente = paciente?.id ?? 0`, `inicio/fim` locais, `descricao ?? ''`, `status = status.id`, `idTipoConsulta = tipo?.id ?? 0`, `confirmacao ?? ''`, `ultimaEdicao = atualizadoEm ?? ''`, `bruto = detalhe` (inteiro, com `versao`).
  - Rotas: `obter` → `GET /api/integration/v1/agenda/agendamentos/{id}/detalhes`; `listarPorPaciente` → `listarTodos('/api/integration/v1/agenda/agendamentos/paciente/{id}')`; `listarPorPeriodo` → `listarTodos('/api/integration/v1/agenda/agendamentos/detalhes', { Inicio, Fim })` em janelas de até 31 dias, fim exclusivo, deduplicando por `id`; `consultarDisponibilidade` → `GET /api/integration/v1/agenda/disponibilidade` com `Inicio`, `Fim`, `DuracaoMinutos` (sem `ProfissionalId`), mapeando `horarios[]` com `paraHorarioLocal`.

- [ ] **Step 1: Testes que falham**
  - `'obter traduz o detalhe v1 e guarda o bruto com versao'` → entrada com `inicio:'2026-11-12T10:10:00-03:00'`, `status:{id:2,nome:'Confirmado'}`; espera `inicio:'2026-11-12T10:10:00'`, `status:2`, `(bruto as any).versao` igual ao enviado.
  - `'obter aceita paciente e tipo nulos'` → `idPaciente:0`, `idTipoConsulta:0`.
  - `'listarPorPeriodo divide 45 dias em duas janelas de no máximo 31 dias sem duplicar'` → `inicio '2026-11-01T00:00:00'`, `fim '2026-12-16T00:00:00'`; espera 2 chamadas com `Fim` da 1ª == `Inicio` da 2ª, e um item repetido nas duas aparece uma vez.
  - `'consultarDisponibilidade não envia ProfissionalId e normaliza o offset'` → URL sem `ProfissionalId`; slot `2026-11-20T09:00:00-03:00` vira `2026-11-20T09:00:00`.
- [ ] **Step 2:** `npx vitest run src/agendamento/infrastructure/medx/medx-agenda.adapter.spec.ts` — Expected: FAIL nos novos.
- [ ] **Step 3:** Implementar; remover `combinarDiaComHora`, `MedxAgendamento`, `MedxAgendamentoPeriodo`, `MedxDisponibilidade` antigos e testes que só cobriam o formato antigo.
- [ ] **Step 4:** Mesmo comando + `npx tsc --noEmit` — Expected: PASS e sem erro de tipo.
- [ ] **Step 5:** `git commit -m "fix: leituras da agenda na API v1 do MedX"`

### Task 4: Catálogo v1 sob demanda e boot tolerante

**Files:**
- Modify: `medx-catalogo.adapter.ts`, `medx.tipos.ts`, `application/ports/catalogo-clinico.port.ts`, `agendamento.module.ts:66-74`, use cases `processar-resposta.usecase.ts:81-89`, `agendar-consulta.usecase.ts:134`, `verificar-comparecimento.usecase.ts:27`, `test/webhooks.e2e-spec.ts` (fakes)
- Test: `medx-catalogo.adapter.spec.ts`, specs dos três use cases

**Interfaces:**
- Produces (port, todos assíncronos agora): `indiceStatusAgendado(): Promise<number>`, `indiceStatusConfirmado(): Promise<number>`, `indiceStatusFinalizado(): Promise<number>` (−1 se ausente), `indicesStatusQueLiberamHorario(): Promise<number[]>`. Cada um chama `garantirCache()` antes. "Índice" passa a ser o `id` do status no catálogo v1.
- Fontes: status → `GET /api/integration/v1/agenda/catalogos` campo `status: {id,nome}[]`; tipos → `listarTodos('/api/integration/v1/agenda/tipos')` (`{id,nome,duracaoMinutos}`); profissionais → `GET /api/integration/v1/financas/profissionais` campo `profissionais: {id,nome,nomeCompleto,ativo,agendavel}[]` seguindo `page.nextCursor`. `resolverProfissional` compara `nome` ou `nomeCompleto`.
- `AgendamentoModule.onModuleInit`: tenta `carregar()`; em erro, `logger.warn` com a mensagem e segue (o adapter sobe).

- [ ] **Step 1: Testes que falham**
  - `'resolve status pelo nome no catálogo v1'` → status `[{id:1,nome:'Agendado'},{id:2,nome:'Confirmado'},{id:11,nome:'Finalizado Atendimento'},{id:0,nome:'Desmarcado'},{id:5,nome:'Cancelou'},{id:3,nome:'Faltou'}]`; espera `1`, `2`, `11`, `[0,5,3]`.
  - `'carrega sob demanda na primeira consulta, sem carregar() prévio'`.
  - `'falha de carga não fica em cache: próxima chamada tenta de novo'`.
  - módulo: `'onModuleInit não lança quando o MedX falha'`.
  - use cases: atualizar os fakes para `async () => n` e os testes existentes continuam passando.
- [ ] **Step 2:** `npx vitest run src/agendamento` — Expected: FAIL nos novos.
- [ ] **Step 3:** Implementar; nos use cases trocar a chamada por `await`.
- [ ] **Step 4:** `npm test && npx tsc --noEmit` — Expected: PASS.
- [ ] **Step 5:** `git commit -m "fix: catálogo do MedX v1 sob demanda e boot sem depender do MedX"`

### Task 5: Escritas da agenda (criar e confirmar)

**Files:**
- Modify: `medx-agenda.adapter.ts` (`criar`, `confirmar`), `application/ports/agenda-medica.port.ts` (`criar` perde o 2º parâmetro), `agendar-consulta.usecase.ts:125-135`
- Test: `medx-agenda.adapter.spec.ts`, `agendar-consulta.usecase.spec.ts`

**Interfaces:**
- Consumes: `executarOperacao` (Task 2), `MedxAgendaDetalhe` em `bruto` (Task 3).
- Produces:
  - `criar(dados: DadosCriacaoAgendamento): Promise<number>` → `executarOperacao('/api/integration/v1/agenda/operacoes', { acao: 'criar', pacienteId, profissionalId, inicio, duracaoMinutos, tipoId })`, `duracaoMinutos` = minutos entre `dados.inicio` e `dados.fim`; devolve `resposta.agendamento.id` (rejeita 0/NaN sem serializar o corpo).
  - `confirmar(agendamento, idStatusConfirmado): Promise<void>` → `executarOperacao('/api/integration/v1/agenda/cadastros', { acao: 'atualizar_agendamento', agendamento: { id, profissionalId, pacienteId, tipoId, procedimentoId, inicio, fim, status: idStatusConfirmado, descricao, confirmacao: CONFIRMACAO_LITERAL, sms, chegada, atendidoEm, saiuEm, versao } })`, todos copiados do `bruto` (substituição completa: campo omitido é apagado no MedX).

- [ ] **Step 1: Testes que falham**
  - `'criar usa operacoes/criar com duração calculada e devolve o id'` → inicio `10:00`, fim `10:30` ⇒ `duracaoMinutos:30`; resposta `{agendamento:{id:-123}}` ⇒ `-123`.
  - `'confirmar reenvia todos os campos do detalhe com versao e status confirmado'` → corpo da prévia contém `versao` original, `sms` original, `status:2`, `confirmacao:'Mensagem Salva com Sucesso'`.
- [ ] **Step 2:** `npx vitest run src/agendamento/infrastructure/medx/medx-agenda.adapter.spec.ts` — Expected: FAIL.
- [ ] **Step 3:** Implementar; ajustar a chamada no use case.
- [ ] **Step 4:** `npm test && npx tsc --noEmit` — Expected: PASS.
- [ ] **Step 5:** `git commit -m "fix: criação e confirmação de agendamento na API v1 do MedX"`

### Task 6: Cadastro de paciente na v1

**Files:**
- Modify: `medx-cadastro-paciente.adapter.ts`, `medx.tipos.ts` (remover `MedxVinculoResposta`, adicionar `MedxContatoResultado { pacienteId: number; resultado: string; criterio: string; criado: boolean }`)
- Test: `medx-cadastro-paciente.adapter.spec.ts`

**Interfaces:**
- `vincular(dados)` → `executarOperacao('/api/integration/v1/contatos/operacoes', { acao: 'vincular', vinculo: { nome, telefone: telefone.nacional, nascimento: dataNascimento, email?, sexo? } })`; devolve `{ idPaciente: dados.pacienteId, matchConfiavel: !dados.criado }` lendo `resposta.dados`.
- `enriquecerFicha(id, dados)` → mesmo prefixo, `{ acao: 'atualizar', pacienteId: id, dados: { cpfCnpj?, celular?, cidadeResidencial?, enderecoResidencial?, cepResidencial? } }` (continua sem chamada no use case — só deixa de apontar para rota morta).

- [ ] **Step 1: Testes que falham** — `'vincular manda acao vincular e lê pacienteId'`; `'vincular com paciente existente é match confiável'` (`criado:false` ⇒ `true`); `'enriquecerFicha manda só os campos informados'`.
- [ ] **Step 2:** `npx vitest run src/agendamento/infrastructure/medx/medx-cadastro-paciente.adapter.spec.ts` — Expected: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Mesmo comando — Expected: PASS.
- [ ] **Step 5:** `git commit -m "fix: vínculo e atualização de paciente na API v1 do MedX"`

### Task 7: Regra do lembrete às 06:00

**Files:**
- Modify: `src/agendamento/domain/agendamento/lembrete-chegada.ts`
- Test: `lembrete-chegada.spec.ts`

- [ ] **Step 1: Testes que falham** (todos dia útil, consulta em `2026-11-13`):
  - `'consulta 08:30 → 06:00 do mesmo dia'` → `'2026-11-13T06:00:00'`
  - `'consulta 07:30 → 06:00 do mesmo dia'` → `'2026-11-13T06:00:00'`
  - `'consulta 09:50 → 06:00 do mesmo dia'` → `'2026-11-13T06:00:00'`
  - `'consulta 10:10 → 08:10'` → `'2026-11-13T08:10:00'`
  - manter: consulta em sábado → 18:00 da sexta.
  - remover/atualizar os testes antigos que esperavam 18:00 da véspera para manhã de dia útil.
- [ ] **Step 2:** `npx vitest run src/agendamento/domain/agendamento/lembrete-chegada.spec.ts` — Expected: FAIL.
- [ ] **Step 3:** Implementar: `HORA_ENVIO_MADRUGADA = 6`; antes das 08:00 em dia útil → `inicioConsulta.startOf('day').plus({ hours: 6 })`; fim de semana mantém o ramo da véspera. Atualizar o comentário da função.
- [ ] **Step 4:** Mesmo comando — Expected: PASS.
- [ ] **Step 5:** `git commit -m "feat: lembrete de chegada às 06h quando a antecedência cai antes das 8h"`

### Task 8: Gravar campo de negócio na Clint por id

**Files:**
- Create: `src/agendamento/application/ports/crm-negocio.port.ts`, `src/agendamento/infrastructure/clint/clint-negocio.adapter.ts`
- Modify: `agendamento.module.ts` (provider), `test/webhooks.e2e-spec.ts` (fake)
- Test: `clint-negocio.adapter.spec.ts`

**Interfaces:**
- Produces:
  - `export const CRM_NEGOCIO_PORT = Symbol('CrmNegocioPort')`
  - `export type CampoDataNegocio = 'data_agendamento' | 'horario_lembrete_chegada' | 'horario_checagem_comparecimento'`
  - `interface CrmNegocioPort { gravarCampos(dealId: string, campos: Partial<Record<CampoDataNegocio | 'hora_agendamento', string>>): Promise<void> }` — um único `POST /v1/deals/{id}` com `{ fields: campos }`. Não apaga nada (a automação já apagou; ver Task 1). Formatos: `data_agendamento` `yyyy-LL-dd`, horários `yyyy-LL-dd'T'HH:mm:ss`, `hora_agendamento` `HH:mm`.
  - Usa `ClintHttpClient.post`.

- [ ] **Step 1: Testes que falham** — `'grava os campos no negócio pelo id'` (1 chamada, URL `/v1/deals/<id>`, corpo `{ fields: {...} }`); `'propaga erro HTTP da Clint'`.
- [ ] **Step 2:** `npx vitest run src/agendamento/infrastructure/clint/clint-negocio.adapter.spec.ts` — Expected: FAIL.
- [ ] **Step 3:** Implementar e registrar `{ provide: CRM_NEGOCIO_PORT, useClass: ClintNegocioAdapter }`.
- [ ] **Step 4:** Mesmo comando — Expected: PASS.
- [ ] **Step 5:** `git commit -m "feat: grava campos de data do negócio na Clint pelo deal_id"`

### Task 9: Rota de regravação de data para as automações

**Files:**
- Create: `src/agendamento/application/regravar-data/regravar-data.comando.ts`, `regravar-data.usecase.ts`
- Modify: `presentation/http/schemas.ts`, `presentation/http/webhooks.controller.ts`, `application/ports/fila.port.ts`, `infrastructure/fila/adapter.processor.ts`, `agendamento.module.ts`, `test/webhooks.e2e-spec.ts`
- Test: `regravar-data.usecase.spec.ts`, e2e

**Interfaces:**
- Consumes: `AgendaMedicaPort.obter` (Task 3), `CatalogoClinicoPort.indicesStatusQueLiberamHorario` (Task 4), `CrmNegocioPort.gravarCampos` (Task 8), `calcularHorarioLembreteChegada` (Task 7), `calcularHorarioChecagemComparecimento`.
- Produces:
  - Rota `POST /webhooks/clint/regravar-data`, header `x-adapter-secret`, corpo `{ deal_id: uuid, id_agendamento_medx: <schema idAgendamentoMedx existente>, campo: 'data_agendamento' | 'horario_lembrete_chegada' | 'horario_checagem_comparecimento' }`.
  - `ComandoRegravarData { dealId: string; idAgendamentoMedx: number; campo: CampoDataNegocio }`; job `{ tipo: 'regravar-data'; eventoId; comando }`.
  - `RegravarDataUseCase.executar(comando): Promise<void>` com `agora: () => DateTime` injetável para teste:
    1. `obter(idAgendamentoMedx)`; se `status` ∈ `indicesStatusQueLiberamHorario()` → `logger.warn` e retorna sem gravar.
    2. Valor: `data_agendamento` → `inicio.slice(0,10)` e também `hora_agendamento = inicio.slice(11,16)`; `horario_lembrete_chegada` → `calcularHorarioLembreteChegada(inicio)`; `horario_checagem_comparecimento` → `calcularHorarioChecagemComparecimento(inicio)`.
    3. Se o horário do valor (para `data_agendamento`: o `inicio` da consulta) é anterior a `agora()` em `FUSO_CLINICA` → `logger.warn` e retorna sem apagar nem gravar.
    4. `gravarCampos(dealId, { [campo]: valor, ...hora })`.

- [ ] **Step 1: Testes que falham** (use case, com fakes):
  - `'regrava o lembrete com a regra das 06h'` → consulta `2026-11-13T08:30:00`, agora `2026-11-12T12:00` ⇒ `gravarCampos(deal, { horario_lembrete_chegada: '2026-11-13T06:00:00' })`.
  - `'regrava data e hora do agendamento remarcado'` → `{ data_agendamento: '2026-11-13', hora_agendamento: '15:00' }`.
  - `'não grava quando o agendamento foi desmarcado'` → status em `[0,5,3]` ⇒ `gravarCampos` não chamado.
  - `'não grava horário que já passou'` → checagem calculada antes de `agora` ⇒ não chamado.
  - e2e: `'regravar-data com segredo e payload válidos enfileira job regravar-data'`; `'campo fora da lista vira evento inválido'`.
- [ ] **Step 2:** `npx vitest run src/agendamento/application/regravar-data && npm run test:e2e` — Expected: FAIL.
- [ ] **Step 3:** Implementar seguindo o padrão de `comparecimento` no controller e o `else if` no processor.
- [ ] **Step 4:** `npm test && npm run test:e2e && npx tsc --noEmit` — Expected: PASS.
- [ ] **Step 5:** `git commit -m "feat: rota para as automações regravarem o campo de data do negócio"`

### Task 10: Verificação final e PR

- [ ] **Step 1:** `npm run lint && npm run format:check && npm test && npm run test:e2e && npm run build` — Expected: tudo verde.
- [ ] **Step 2:** Smoke na VPS antes do merge, sem recriar o container de produção: rodar a imagem da branch num container avulso (`docker run --rm --env-file .env.adapter-clint-medx ...`) com um script que chama `MedxTokenProvider` + `listarPorPeriodo` de amanhã e `catalogo.indiceStatusConfirmado()`. Expected: token 200, itens listados, id `2`.
- [ ] **Step 3:** Abrir PR com o template `.github/PULL_REQUEST_TEMPLATE/default.md`, labels type/area/priority, milestone e assignee; descrição termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 4:** Depois do deploy (fora do código, com o usuário): conferir `/health`, reprocessar as checagens que falharam enquanto o adapter esteve fora, e então ajustar as automações D0 Boas Vindas, D3, D1, D0 Chegada e Compareceu: depois do nó que grava o `etapa_lembrete`, um nó `UPDATE_DATA` com `value_source: CLEAR` no campo da tabela do spec e em seguida o webhook para `/webhooks/clint/regravar-data` com `deal_id`, `id_agendamento_medx` e `campo`. Apagar os campos do negócio de teste `521e2bf6` e fechá-lo.
