# Monitor do MedX → Clint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um job a cada 5 minutos que reconcilia a agenda do MedX (hoje → +30 dias) com os negócios abertos da RECEPÇÃO na Clint: cria/assume negócios, regrava horários em remarcações, pede o salto de etapa e encerra cancelados.

**Architecture:** Regras de janela, de horário e de nome ficam em funções puras no domínio. Um use case `MonitorarAgendaUseCase` lê o MedX e a Clint uma vez por rodada, decide ação por agendamento e executa (modo `agir`) ou só registra (modo `observar`). A Clint é a fonte do estado (negócios abertos indexados por `id_agendamento_medx`); não há tabela nova. O job roda na fila BullMQ existente como job repetitivo.

**Tech Stack:** NestJS 11, TypeScript, Vitest, Luxon, Zod, BullMQ 6, API v1 do MedX, API REST da Clint.

**Spec:** `docs/superpowers/specs/2026-11-12-monitor-medx-design.md` (e `2026-11-11-sincronizacao-medx-clint-design.md` para a cadeia de automações).

## Global Constraints

- Commits: só a linha de cabeçalho (Conventional Commits), sem corpo nem Co-Authored-By.
- Status levados para a Clint: Agendado, Confirmado e Endovenoso; cancelamento: Desmarcado e Cancelou. Ids sempre do catálogo (por nome), nunca fixos.
- Todo negócio novo nasce em RECEPÇÃO / BOAS VINDAS (`CLINT_ORIGEM_RECEPCAO_ID` = `c10ccf49-2c9f-41d5-bfa7-c116daa2cc77`, `CLINT_ETAPA_BOAS_VINDAS_ID` = `03900fbe-0a12-462c-9599-2f5a3ff05657`).
- Negócios que podem ser assumidos: abertos em BOAS VINDAS ou ENDOVENOSO (`3a031270-0d91-4b81-aff5-55535b82ced6`) sem `id_agendamento_medx`.
- Ordem de gravação na Clint: etapa/`etapa_lembrete` (ou `proximo_lembrete`, que faz a automação gravar a etapa) → **rodada seguinte, com a etapa confirmada** → lembrete e checagem → `data_agendamento` + `hora_agendamento` por último, em chamadas separadas (Task 10).
- Formatos na Clint: `data_agendamento` `yyyy-LL-dd`; horários `yyyy-LL-dd'T'HH:mm:ss`; `hora_agendamento` `HH:mm`.
- Gatilhos (constantes num só arquivo): D3 = consulta −3 dias às 09:00; D1 = −1 dia às 12:45 (mudou em 2026-11-16; era 12:05); Aguardando Exame = +7 dias às 09:00; D0 Chegada = `calcularHorarioLembreteChegada`.
- `proximo_lembrete` ∈ `d3 | d1 | d0_chegada | nenhum`; `etapa_lembrete` de cancelamento = `cancelado`.
- Tags: `sem telefone no MedX` (sem telefone nos dois sistemas) e `conferir agendamento MedX` (contato ambíguo).
- Janela: hoje 00:00 → +30 dias; intervalo 5 min. `MONITOR_MEDX_MODO` = `desligado` (padrão) | `observar` | `agir`.
- Telefones internacionais continuam cobertos (`Telefone.estrangeiro`): na Clint o DDI fica separado do número (ex.: ddi `595`, phone `983111455`).
- Nunca gravar horário que já passou; nunca logar nome/telefone fora da redação do pino.

## Review Focus

1. Duas pacientes com o mesmo telefone (Karmen/Silvia) e um negócio aberto de cada → cada agendamento vai para o negócio certo pelo nome (teste na Task 6).
2. Primeira rodada com negócios já vinculados por `id_agendamento_medx` → nenhuma criação, nenhuma boas-vindas (teste na Task 7).
3. Remarcação para depois de 30 dias (some da listagem, mas existe) → não é tratada como cancelamento (teste na Task 7).
4. Consulta antecipada que deixa a etapa atual para trás → grava `proximo_lembrete` diferente do atual; sem salto quando a etapa atual ainda é alcançável (teste na Task 2 e Task 7).
5. Telefone estrangeiro (Paraguai, +595) — gravado completo ou sem o 5 inicial no MedX (`95982663052`) → acha o contato certo, sem criar duplicado (testes nas Tasks 5 e 6).
6. Falha da Clint ou do MedX no meio da rodada → os outros agendamentos continuam; a rodada seguinte corrige (teste na Task 7).
7. Nenhuma data é gravada enquanto a `etapa_lembrete` não está confirmada; `data_agendamento` é sempre a última chamada (testes na Task 10).

---

### Task 1: Verificações ao vivo (manual, com aprovação do usuário)

Negócio de teste `521e2bf6-1ce0-4cf0-91d9-ea2dc7627eb1`. Registrar cada resultado no ledger; se 1 ou 2 falharem, parar e voltar ao usuário.

- [ ] **1.** `POST /v1/deals` com `origin_id`, `stage_id` = BOAS VINDAS e o contato de teste: o D0 Boas Vindas aparece nas execuções (`list_automation_executions`)? Fechar o negócio criado depois.
- [ ] **2.** No negócio de teste, gravar `horario_checagem_comparecimento` = agora+3 min, depois (sem apagar) agora+6 min: a Checagem executa só no segundo horário?
- [ ] **3.** `GET /v1/deals?origin_id=…&status=OPEN&limit=…` traz `fields` com `id_agendamento_medx` e o `contact.phone`.
- [ ] **4.** `GET /v1/contacts?name=…` encontra por parte do nome?
- [ ] **5.** `GET /v1/contacts` encontra um contato estrangeiro (ddi `595`) por `phone` sem ddi e por `ddi`+`phone`? Registrar qual forma funciona.
- [ ] **6.** Prévia (sem executar) de `contatos/operacoes` `acao: atualizar` só com `dados.celular`: a proposta preserva os outros campos.

### Task 2: Regras de janela e de datas no domínio

**Files:**
- Create: `src/agendamento/domain/agendamento/gatilhos-lembrete.ts`, `janela-lembrete.ts`
- Modify: `src/agendamento/application/regravar-data/regravar-data.usecase.ts` (usar `calcularCampoData`)
- Test: `janela-lembrete.spec.ts`, `gatilhos-lembrete.spec.ts`, specs de `regravar-data` continuam verdes

**Interfaces:**
- Produces:
  - `type ProximoLembrete = 'd3' | 'd1' | 'd0_chegada' | 'nenhum'`
  - `horarioGatilhoD3(inicio: string): DateTime`, `horarioGatilhoD1(inicio): DateTime`, `horarioGatilhoAguardandoExame(inicio): DateTime` em `gatilhos-lembrete.ts`
  - `calcularProximoLembrete(inicio: string, agora: DateTime): ProximoLembrete` — `d3` se o gatilho D3 é futuro; senão `d1` se a consulta não é hoje; senão `d0_chegada` se o lembrete de chegada é futuro; senão `nenhum`.
  - `etapaFoiUltrapassada(etapaLembrete: string | null, novo: ProximoLembrete): boolean` — ordem `d3 < d1 < d0_chegada < nenhum`; verdadeiro se a etapa atual (`d3_preparacao_consulta`/`d1_preparando_chegada`/`d0_chegada`) vem antes de `novo`. Outras etapas → falso.
  - `calcularCampoData(campo: CampoDataNegocio, inicio: string): { campos: CamposNegocio; momento: DateTime }` (extraído do `RegravarDataUseCase`, mesma regra: `data_agendamento` vale até o gatilho Aguardando Exame).

- [ ] **Step 1: Testes que falham** (agora fixado; consulta `2026-11-20`, sexta, às 10:00):
  - `'5 dias antes → d3'`: agora `2026-11-15T10:00` → `d3`
  - `'2 dias antes → d1'`: agora `2026-11-18T10:00` → `d1`
  - `'véspera depois das 12:05 → d1'`: agora `2026-11-19T15:00` → `d1`
  - `'no dia, antes do lembrete → d0_chegada'`: agora `2026-11-20T07:00` → `d0_chegada` (lembrete 08:00)
  - `'no dia, depois do lembrete → nenhum'`: agora `2026-11-20T09:00` → `nenhum`
  - `'etapa d3 com novo d1 foi ultrapassada'` → `true`; `'etapa d1 com novo d1 não'` → `false`; `'etapa confirmado nunca'` → `false`
  - gatilhos: `horarioGatilhoD1('2026-11-20T10:00:00')` = `2026-11-19T12:05` (fuso da clínica)
- [ ] **Step 2:** `npx vitest run src/agendamento/domain/agendamento` — Expected: FAIL nos novos.
- [ ] **Step 3:** Implementar; `RegravarDataUseCase` passa a usar `calcularCampoData` e `horarioGatilhoAguardandoExame`.
- [ ] **Step 4:** `npx vitest run src/agendamento` — Expected: PASS (inclusive `regravar-data`).
- [ ] **Step 5:** `git commit -m "feat: regras de janela dos lembretes no domínio"`

### Task 3: Casar nome entre MedX e Clint

**Files:** Create `src/agendamento/domain/paciente/casar-nome.ts`; Test `casar-nome.spec.ts`

**Interfaces:** Produces `nomeCasa(nomeMedx: string, nomeClint: string): boolean` — normaliza (sem acento, caixa, emoji e pontuação); verdadeiro quando todas as palavras do nome da Clint aparecem no nome do MedX e há ao menos uma.

- [ ] **Step 1: Testes que falham:** `('KARMEN FEY DO NASCIMENTO','Karmen 💓💓')` → true; `('SILVIA FEY','Karmen 💓💓')` → false; `('SILVIA FEY','Silvia Fey🩷🩷')` → true; `('ANDREIA WELTER DE BARROS E SILVA','Andréia Welter 🌻')` → true; `('MARIA SILVA','')` → false; `('ACELI PIVETTA','Pct Katlin')` → false.
- [ ] **Step 2:** rodar — FAIL. **Step 3:** implementar. **Step 4:** rodar — PASS.
- [ ] **Step 5:** `git commit -m "feat: casamento de nome entre MedX e Clint"`

### Task 4: Leituras do MedX para o monitor

**Files:** Modify `application/ports/agenda-medica.port.ts`, `catalogo-clinico.port.ts`, `cadastro-paciente.port.ts`, `infrastructure/medx/medx-agenda.adapter.ts`, `medx-catalogo.adapter.ts`, `medx-cadastro-paciente.adapter.ts`, `medx.tipos.ts`; Tests nos specs correspondentes.

**Interfaces:**
- `AgendaMedicaPort.listarDetalhadosPorPeriodo(inicio: string, fim: string): Promise<AgendamentoExterno[]>` — mesma paginação/janelas de 31 dias de `listarPorPeriodo`, traduzindo o detalhe inteiro (`bruto` = `MedxAgendaDetalhe`).
- `AgendaMedicaPort.existe(id: number): Promise<boolean>` — `GET /{id}/detalhes`; `false` só em `ErroMedx` 404.
- `CatalogoClinicoPort.indiceStatusEndovenoso(): Promise<number>` (−1 se ausente) e `indicesStatusCancelamento(): Promise<number[]>` (Desmarcado, Cancelou).
- `CadastroPacientePort.obterCelular(idPaciente: number): Promise<string | null>` — `GET /api/integration/v1/contatos/{id}`, `dados.celular`, senão `dados.telefoneResidencial`, senão `null`.

- [ ] **Step 1: Testes que falham:** `'listarDetalhadosPorPeriodo traz paciente e status'`; `'existe devolve false só no 404'` (500 propaga); `'endovenoso e cancelamento pelo nome no catálogo'` (`12`, `[0,5]`); `'obterCelular lê dados.celular e cai para telefoneResidencial'`; `'obterCelular sem telefone → null'`.
- [ ] **Step 2:** `npx vitest run src/agendamento/infrastructure/medx` — FAIL. **Step 3:** implementar. **Step 4:** PASS + `npx tsc --noEmit`.
- [ ] **Step 5:** `git commit -m "feat: leituras do MedX para o monitor"`

### Task 5: Operações da Clint para o monitor

**Files:** Modify `application/ports/crm-negocio.port.ts`, `infrastructure/clint/clint-negocio.adapter.ts`, `config/env.schema.ts`; Test `clint-negocio.adapter.spec.ts`

**Interfaces:**
- `CamposNegocio` passa a aceitar também `etapa_lembrete`, `proximo_lembrete`, `tipo_consulta`, `id_agendamento_medx`, `duracao_consulta` (todos string).
- `NegocioRecepcao { id: string; contatoId: string; nomeContato: string; telefone: string | null; etapaId: string; campos: Record<string, string> }`
- `ContatoClint { id: string; nome: string; telefone: string | null }`
- `CrmNegocioPort` ganha:
  - `listarAbertosRecepcao(): Promise<NegocioRecepcao[]>` — `GET /v1/deals?origin_id&status=OPEN&limit=1000&page=n` até `hasNext=false`.
  - `buscarContatos(filtro: { telefone?: Telefone; nome?: string }): Promise<ContatoClint[]>` — `GET /v1/contacts`: brasileiro → `ddi=55&phone=nacional`; estrangeiro → forma confirmada na verificação 5 da Task 1 (padrão: `phone` = últimos 9 dígitos) e filtra os resultados cujo `ddi`+`phone` são os dígitos do E.164; nome → `name`. `ContatoClint.telefone` em E.164 (`+` + ddi + phone).
  - `criarNegocio(dados: { contatoId?: string; nome: string; telefone?: Telefone; campos: CamposNegocio }): Promise<string>` — `POST /v1/deals` com `origin_id`, `stage_id` BOAS VINDAS, `contact_id` quando houver, `fields`.
  - `encerrarComoPerdido(dealId: string): Promise<void>` — `POST /v1/deals/{id}` `{ status: 'LOST', lost_status_id }`; sem `CLINT_MOTIVO_PERDA_CANCELAMENTO_ID` lança erro claro.
- Env novas: `CLINT_ORIGEM_RECEPCAO_ID`, `CLINT_ETAPA_BOAS_VINDAS_ID`, `CLINT_ETAPA_ENDOVENOSO_ID` (defaults acima), `CLINT_MOTIVO_PERDA_CANCELAMENTO_ID` (opcional).

- [ ] **Step 1: Testes que falham:** `'lista todas as páginas de negócios abertos da RECEPÇÃO'` (2 páginas → concatena; query com `origin_id` e `status=OPEN`); `'criarNegocio usa contato existente e etapa BOAS VINDAS'`; `'criarNegocio sem contato manda nome e telefone'`; `'encerrarComoPerdido manda LOST com o motivo'`; `'encerrarComoPerdido sem motivo configurado falha claro'`; `'busca telefone do Paraguai e confere o DDI 595'`.
- [ ] **Step 2:** rodar — FAIL. **Step 3:** implementar (`ClintHttpClient.get` com query). **Step 4:** PASS + tsc.
- [ ] **Step 5:** `git commit -m "feat: operações da Clint para o monitor"`

### Task 6: Resolver o contato de um agendamento

**Files:** Create `src/agendamento/application/monitorar-agenda/resolver-contato.ts`; Test `resolver-contato.spec.ts`

**Interfaces:**
- Consumes: `obterCelular`, `enriquecerFicha` (Task 4/existente), `buscarContatos` (Task 5), `adicionarTag` (`CrmContatoPort`), `nomeCasa` (Task 3).
- Produces: `resolverContato(ag: AgendamentoExterno, nomePaciente: string, deps): Promise<ResultadoContato>` com
  `ResultadoContato = { tipo: 'contato'; contato: ContatoClint; telefone: Telefone } | { tipo: 'novo'; telefone: Telefone | null } | { tipo: 'ambiguo'; candidatos: ContatoClint[] }`
  - celular no MedX → `buscarContatos({telefone})`: 0 → tenta pelo nome (`buscarContatos({nome})` + `nomeCasa`; um só → `contato`), senão `novo` com telefone; 1 → `contato`; 2+ → filtra por `nomeCasa`; 1 → `contato`; senão `ambiguo`.
  - sem celular → `buscarContatos({nome})` filtrado por `nomeCasa`: 1 com telefone → `enriquecerFicha(idPaciente, {telefone})` e `contato`; 0 → `novo` sem telefone; 2+ → `ambiguo`.
  - Recebe uma flag `gravar` (modo agir); em observar não chama `enriquecerFicha`.

- [ ] **Step 1: Testes que falham:** `'telefone com um contato usa direto'`; `'telefone compartilhado escolhe pelo nome'` (Karmen/Silvia); `'telefone compartilhado sem nome que case é ambíguo'`; `'sem celular acha pelo nome e grava o telefone no MedX'`; `'sem celular e sem contato é novo sem telefone'`; `'em observar não grava no MedX'`; `'telefone estrangeiro gravado sem o 5 no MedX acha a paciente pelo nome'` (MedX `95982663052`, Clint `Juliane Rafaeli` ddi 595 → `contato`, não `novo`).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** `git commit -m "feat: resolução do contato da paciente para o monitor"`

### Task 7: Rodada do monitor

**Files:** Create `src/agendamento/application/monitorar-agenda/monitorar-agenda.usecase.ts`; Modify `agendamento.module.ts`; Test `monitorar-agenda.usecase.spec.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6.
- Produces: `MonitorarAgendaUseCase.executar(modo: 'observar' | 'agir'): Promise<ResumoRodada>`; `agora: () => DateTime` injetável; `ResumoRodada = { criados: number; assumidos: number; remarcados: number; cancelados: number; ignorados: number; falhas: number }`.
- Algoritmo por rodada:
  1. `listarDetalhadosPorPeriodo(hoje 00:00, hoje+30d)` e `listarAbertosRecepcao()` (índice por `campos.id_agendamento_medx`).
  2. Por agendamento (try/catch individual; falha conta em `falhas` e segue):
     - status de cancelamento + negócio vinculado → `gravarCampos({etapa_lembrete:'cancelado'})` e `encerrarComoPerdido`.
     - status fora de Agendado/Confirmado/Endovenoso, ou sem paciente → ignora.
     - vinculado e `data_agendamento`+`hora_agendamento` ≠ início → regrava as datas ainda futuras (`calcularCampoData` para os 3 campos) e, se `etapaFoiUltrapassada(etapa, calcularProximoLembrete(...))`, grava `proximo_lembrete`.
     - não vinculado → `resolverContato`; `ambiguo` → tag `conferir agendamento MedX` nos candidatos; `contato` com negócio aberto sem id em BOAS VINDAS/ENDOVENOSO → assume (grava id, `duracao_consulta`, `tipo_consulta` se endovenoso, datas, depois `proximo_lembrete`); senão cria (`criarNegocio` com id, `tipo_consulta`, e `etapa_lembrete = d0_boas_vindas` só se consulta; depois datas; depois `proximo_lembrete`); `novo` sem telefone → cria e põe a tag `sem telefone no MedX` no contato.
  3. Negócios vinculados cujo id não veio na listagem e cuja `data_agendamento` está na janela → `existe(id)`; `false` → tratamento de cancelamento.
  4. Em `observar`: nenhuma escrita; cada ação vira `logger.info({ acao, id_agendamento, deal_id }, 'monitor (observar)')`.

- [ ] **Step 1: Testes que falham** (fakes de portas; agora `2026-11-12T12:00`):
  - `'agendamento já vinculado e sem mudança não gera escrita'`
  - `'primeira rodada com tudo vinculado não cria nada'`
  - `'consulta nova cria em BOAS VINDAS com d0_boas_vindas, depois datas, depois proximo_lembrete'` (ordem das chamadas)
  - `'endovenoso novo cria sem etapa_lembrete e com tipo_consulta endovenoso'`
  - `'assume negócio aberto sem id em vez de criar'`
  - `'remarcação regrava as datas futuras sem mexer na etapa'`
  - `'antecipação que ultrapassa a etapa grava proximo_lembrete'`
  - `'cancelado fecha como perdido e marca etapa cancelado'`
  - `'some da listagem mas existe no MedX não cancela'`
  - `'some e não existe mais cancela'`
  - `'contato ambíguo põe tag nos candidatos e não cria'`
  - `'falha num agendamento não para a rodada'`
  - `'modo observar não escreve nada'`
- [ ] **Step 2:** `npx vitest run src/agendamento/application/monitorar-agenda` — FAIL. **Step 3:** implementar. **Step 4:** PASS + suíte inteira.
- [ ] **Step 5:** `git commit -m "feat: rodada do monitor da agenda do MedX"`

### Task 8: Agendamento do job e modo de operação

**Files:** Modify `config/env.schema.ts`, `application/ports/fila.port.ts`, `infrastructure/fila/bullmq-fila.adapter.ts`, `infrastructure/fila/adapter.processor.ts`, `agendamento.module.ts`; Tests `adapter.processor.spec.ts`, `bullmq-fila.adapter.spec.ts` (ou o spec existente), `env.schema.spec.ts` se houver.

**Interfaces:**
- Env `MONITOR_MEDX_MODO: z.enum(['desligado','observar','agir']).default('desligado')`.
- `FilaPort.agendarRepetitivo(nome: string, dados: JobAdapter, intervaloMs: number): Promise<void>` → `queue.upsertJobScheduler(nome, { every: intervaloMs }, { name: nome, data: dados })`; `desligado` remove o agendador (`removeJobScheduler`).
- `JobAdapter` ganha `{ tipo: 'monitor-medx'; eventoId: 0; comando: { modo: 'observar' | 'agir' } }`; o processor roda o use case **sem** buscar/salvar evento e loga o `ResumoRodada`.
- No `onModuleInit`, conforme o modo: agenda a cada 300 000 ms ou remove.

- [ ] **Step 1: Testes que falham:** `'roteia monitor-medx sem tocar em eventos'`; `'modo desligado remove o agendador'`; `'modo observar agenda a cada 5 minutos'`; env: `'MONITOR_MEDX_MODO padrão é desligado'`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** suíte inteira + tsc + lint.
- [ ] **Step 5:** `git commit -m "feat: agenda o monitor do MedX na fila com modo de operação"`

### Task 10: Etapa antes da data (duas fases) — revisão de 2026-11-16

Roda **antes** da Task 9. Spec: seção "Revisão de 2026-11-16" do desenho.

**Files:** Modify `src/agendamento/domain/agendamento/janela-lembrete.ts`, `src/agendamento/domain/agendamento/gatilhos-lembrete.ts`, `src/agendamento/application/monitorar-agenda/monitorar-agenda.usecase.ts`; Tests `janela-lembrete.spec.ts`, `gatilhos-lembrete.spec.ts` (ou o spec existente), `monitorar-agenda.usecase.spec.ts`.

**Interfaces:**
- Domínio: `datasLiberadas(etapaLembrete: string | null, proximo: ProximoLembrete): boolean` — `nenhum` → `true`; etapa vazia ou `d0_boas_vindas` → `false`; `etapaFoiUltrapassada(etapa, proximo)` → `false`; senão `true`.
- Domínio: `horarioGatilhoD1` passa a 12:45.
- Use case: um único caminho "sincronizar datas" para negócio vinculado com datas divergentes (substitui `remarcarSeMudou`, `concluirCriacao` e a gravação de datas em `assumir`/`criar`):
  1. `proximo = calcularProximoLembrete(inicio, agora)`.
  2. Se `etapaFoiUltrapassada` e `campos.proximo_lembrete !== proximo` → grava `proximo_lembrete`.
  3. Se `!datasLiberadas(etapa, proximo)` → não grava data; se faltar < 60 min para o gatilho do passo esperado → `logger.warn({ alerta: true, ... })` e tag `conferir agendamento MedX` no contato.
  4. Senão → `gravarSeHouver(lembrete + checagem futuros)` e, numa chamada separada e por último, `data_agendamento` + `hora_agendamento` (se o gatilho ainda vale, regra atual de `calcularCampoData`).
- Criação e assunção passam a gravar só etapa/vínculo/`proximo_lembrete`; as datas ficam para o caminho acima numa rodada seguinte.
- `criacaoFicouPelaMetade` continua cobrindo a falha entre criar e mover para BOAS VINDAS.

- [ ] **Step 1: Testes que falham:**
  - domínio: `'nenhum libera as datas'`; `'etapa vazia bloqueia'`; `'d0_boas_vindas bloqueia'`; `'etapa ultrapassada bloqueia'`; `'etapa alcançável libera'`; `'D1 dispara às 12:45 da véspera'`
  - use case: `'consulta nova grava etapa e proximo_lembrete sem nenhuma data'`; `'rodada seguinte com a etapa gravada pela automação grava as datas'`; `'data_agendamento é a última chamada'` (ordem das chamadas); `'remarcação com etapa ultrapassada grava só proximo_lembrete'`; `'remarcação com etapa alcançável regrava as datas na mesma rodada'`; `'data apagada pela automação com etapa à frente é regravada sem proximo_lembrete'`; `'bloqueio a menos de 60 min do gatilho alerta e põe tag'`; `'modo observar continua sem escrever'`
- [ ] **Step 2:** `npx vitest run src/agendamento` — FAIL. **Step 3:** implementar. **Step 4:** PASS + suíte inteira + tsc + lint.
- [ ] **Step 5:** `git commit -m "feat: monitor só grava datas com a etapa confirmada"`
- [ ] **Step 6 (com o usuário, na Clint):** tirar do D1 a limpeza de `data_agendamento` (fica só "gravar `d0_chegada`"); no D0 Boas Vindas, a espera de 30 min do caso `d1` passa para antes de gravar a etapa; a "[RECEPCAO] Entrada por janela" não apaga data nem chama `/regravar-data`.

### Task 9: Verificação final, PR e implantação em observar

- [ ] **Step 1:** `npm run lint && npm run format:check && npm test && npm run build` — tudo verde.
- [ ] **Step 2:** Smoke contra MedX e Clint reais com o build: uma rodada em `observar` (script local chamando o use case) — Expected: lista de ações coerente com a agenda de amanhã; nenhuma escrita.
- [ ] **Step 3:** PR com template, labels `type: feat`, `priority: high`, `area: medx`, `area: clint`, `area: agendamento`, milestone `v1 - Adapter`, assignee.
- [ ] **Step 4 (com o usuário, depois do merge):** na Clint, criar a opção `cancelado`, o campo `proximo_lembrete`, o motivo "Consulta cancelada no MedX" (id em `CLINT_MOTIVO_PERDA_CANCELAMENTO_ID`), as tags, a condição no D0 Boas Vindas e a automação "[RECEPCAO] Entrada por janela"; subir com `MONITOR_MEDX_MODO=observar`, conferir um dia de log, passar para `agir`.
