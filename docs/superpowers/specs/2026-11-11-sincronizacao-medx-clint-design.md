# Sincronização MedX → Clint (agendamentos por fora do fluxo)

Data: 2026-11-11. Status: rascunho para aprovação.

## Intenção

A recepção cria e remarca agendamentos direto no MedX. Hoje o adapter só conhece o que passa pela Clint, então esses agendamentos nunca chegam à Clint, ou chegam com datas velhas. Caso concreto: a Aceli foi remarcada do dia 11 para o dia 12 no MedX, e na Clint os campos "Horário lembrete chegada" e "Horário checagem comparecimento" continuaram no dia 11. A checagem de comparecimento rodaria no dia errado e a trataria como não compareceu.

O objetivo é que a Clint reflita o MedX sem digitação manual, respeitando uma restrição da Clint (abaixo).

## Restrição da Clint

Se o campo de data for preenchido antes de o `etapa_lembrete` e a etapa do negócio estarem corretos, a automação de gatilho de data não roda. Regra: **etapa e `etapa_lembrete` primeiro, datas depois, sempre.**

Já confirmado pelo usuário: apagar a data e regravá-la rearma o gatilho de data, e os nós de uma automação rodam em ordem (o webhook só sai depois do apagamento).

## Objetivos

- Detectar no MedX agendamento novo, remarcação, cancelamento e finalização.
- Atualizar na Clint os campos de data do negócio: `data_agendamento` (DATE) com `hora_agendamento` (TEXT) e `duracao_consulta` (TEXT) (o "horário do agendamento"), `horario_lembrete_chegada` (DATETIME) e `horario_checagem_comparecimento` (DATETIME). Sem mensagem à paciente e sem mudar a etapa na remarcação.
- Criar o negócio em RECEPÇÃO / BOAS VINDAS quando a paciente não tem negócio na Clint.
- Respeitar a ordem etapa → datas em todos os caminhos.

## Regra do lembrete de chegada (D0) — alterada em 2026-11-11

O lembrete sai 2h antes da consulta. **Se isso cair antes das 08:00, o lembrete sai às 06:00 do próprio dia da consulta** (substitui a regra anterior, que mandava para as 18:00 do dia útil anterior). Exemplos: consulta 07:30 → 06:00; 08:40 → 06:00; 09:50 → 06:00; 10:10 → 08:10.

Consulta em fim de semana (excepcional): mantém 18:00 do último dia útil anterior (decisão minha, não discutida).

A mudança é em `calcularHorarioLembreteChegada` (`src/agendamento/domain/agendamento/lembrete-chegada.ts`), com teste primeiro.

## Fora de escopo

- Não atualizar nem resetar `etapa_lembrete` pelo adapter.
- Não reenviar notificações já enviadas. Ponto aberto: ver "Em aberto".
- Não mover negócio de etapa em remarcação.

## Desenho

### Caminho 1: negócio que passa pelo fluxo da Clint
Regra (decidida em 2026-11-12): **toda automação que muda o `etapa_lembrete` termina regravando o campo de data que arma a próxima automação.** Os nós de uma automação rodam em ordem; a Clint não consegue copiar uma data de um campo para outro, então quem regrava é o adapter: depois do nó que grava o `etapa_lembrete`, a automação **apaga o campo** (nó `UPDATE_DATA` com "limpar") e chama o adapter por webhook com `deal_id`, `id_agendamento_medx` e o campo a regravar. O adapter lê o agendamento atual no MedX (fonte da verdade, então uma remarcação feita por fora é corrigida no caminho) e grava o valor recalculado pela API REST da Clint (`POST /v1/deals/{id}`). Confirmado em 2026-11-12: essa API grava, mas não apaga campo (`""` e `null` são ignorados), por isso o apagar fica na automação.

Cadeia lida na Clint em 2026-11-12:

| Automação | Gatilho | Condição | Grava `etapa_lembrete` | Campo que o adapter regrava |
|---|---|---|---|---|
| D0 Boas Vindas | negócio entra em BOAS VINDAS, espera 30 min | `d0_boas_vindas` | `d3_preparacao_consulta` | `data_agendamento` (arma a D3) |
| D3 Preparação Consulta | `data_agendamento` −3 dias, 09:00 | BOAS VINDAS e `d3_preparacao_consulta` | `d1_preparando_chegada` | `data_agendamento` (arma a D1) |
| D1 Preparando chegada | `data_agendamento` −1 dia, 12:05 | BOAS VINDAS ou ENDOVENOSO e `d1_preparando_chegada` | `d0_chegada` (só depois do botão Café/Chá/Água) | `horario_lembrete_chegada` (arma a D0 Chegada) |
| D0 Chegada | `horario_lembrete_chegada` | BOAS VINDAS ou ENDOVENOSO e `d0_chegada` | `confirmado` | `horario_checagem_comparecimento` (arma a Checagem) |
| Checagem Comparecimento | `horario_checagem_comparecimento` | BOAS VINDAS, sem `reagendar_humano`/`cancelar_humano`, sem evento | — (chama `/webhooks/clint/comparecimento`) | — |
| Compareceu | `evento = compareceu` | — | apaga | `data_agendamento` (arma Aguardando Exame, +7 dias 09:00) |
| Não Compareceu (inativa) | `evento = nao_compareceu` | — | `reagendar_humano` (botão Reagendar) | nenhum (segue com humano) |
| Aguardando Exame | `data_agendamento` +7 dias, 09:00 | COMPARECEU/AGUARDA EXAMES, diferente de `aguardando_exame` | `aguardando_exame` | nenhum (fim da cadeia) |

O adapter regrava só o campo pedido, para não rearmar automações que não são a próxima. Regravar uma data já passada pode disparar a automação na hora; as condições de `etapa_lembrete` de cada uma impedem envio fora de vez, mas o adapter não deve gravar datas no passado.

### Caminho 2: agendamento criado por fora
O monitor encontra um `id_Agendamento` desconhecido. O adapter cria o negócio em RECEPÇÃO / BOAS VINDAS pela integração (etapa de criação já ajustada para BOAS VINDAS), garante a etapa e o `etapa_lembrete` e só depois grava as datas. Se não houver telefone utilizável, registra para revisão e não cria.

**Endovenoso (status 12 no MedX):** o adapter preenche o campo `tipo_consulta` (TEXT, rótulo "Tipo Consulta") do negócio com `endovenoso`. Como a criação sempre nasce em BOAS VINDAS, uma **automação nova** (gatilho: negócio criado ou campo `tipo_consulta` alterado) move o negócio para a etapa ENDOVENOSO (id `3a031270-0d91-4b81-aff5-55535b82ced6`, ordem 3 da RECEPÇÃO) quando o tipo for `endovenoso`. Isso vale só para negócio que não existia; negócio já existente não muda de etapa por esse motivo.

### Caminho 3: remarcação por fora
O monitor encontra `inicio` diferente do retrato salvo. O adapter aciona uma **automação nova** na Clint, que executa o ciclo apagar + regravar do caminho 1 e chama o adapter para gravar as datas novas.

### Monitor
Job repetitivo no BullMQ (já existe fila/Redis), a cada cerca de 5 minutos (decisão minha, ajustável). Consulta `GET /api/integration/agenda/agendamentos?inicio&fim` do MedX, janela de hoje até cerca de 30 dias à frente (decisão minha). Compara cada item com o retrato na tabela `agendamentos` (id, `inicio`, `status`, `lastEditDate`):
- id novo → caminho 2;
- `inicio` diferente → caminho 3;
- status Desmarcado (0) ou Cancelou (5) → tratamento de cancelamento (ver "Em aberto");
- status Finalizado Atendimento (11) → evento de comparecimento.
A primeira rodada só grava o retrato, sem criar negócios nem alterar datas.

### Proteções
- Integração da RECEPÇÃO: "Etapa para atualização" = BOAS VINDAS e status Aberto (já configurado), para a gravação atingir só o negócio certo.
- Webhook que falha depois de apagar as datas deixa o negócio sem lembrete nem checagem: o adapter precisa de retentativa e de alerta.
- Mudança idempotente: o mesmo evento não pode ser enviado duas vezes (o retrato salvo evita).

## Fatos do MedX que o desenho usa
- Status da conta: 0 Desmarcado, 1 Agendado, 2 Confirmado, 3 Faltou, 5 Cancelou, 11 Finalizado Atendimento, 12 Endovenoso (tipo de procedimento).
- Dois profissionais/agendas aparecem em `id_Usuario`; o filtro por `proId` do MedX não funciona (bug conhecido no código).
- Telefone vem em `sms` e em `descricao`; pode estar vazio (ex.: Sigmund Fey, Andreia Welter), e há telefones compartilhados (Karmen e Silvia Fey) e internacionais (Juliane, +595).
- A troca de token do MedX tem limite de 10 req/min por IP; o token já é reutilizado.

## Fatos da Clint (lidos em 2026-11-11)
- Origem RECEPÇÃO (`c10ccf49-2c9f-41d5-bfa7-c116daa2cc77`), etapas: AGENDAMENTO, BOAS VINDAS, ENDOVENOSO, NÃO COMPARECEU, COMPARECEU/AGUARDA EXAMES, PÓS CONSULTA.
- Campos de negócio usados: `etapa_lembrete` (SELECT: d0_boas_vindas, d0_chegada, d1_preparando_chegada, d3_preparacao_consulta, aguardando_exame, confirmado, reagendar_humano, cancelar_humano), `id_agendamento_medx`, `tipo_consulta`, `data_agendamento`, `hora_agendamento`, `duracao_consulta`, `horario_lembrete_chegada`, `horario_checagem_comparecimento`, `evento`, `deal_id`.
- Automações da RECEPÇÃO com gatilho de data (FIELD_DATE): D0 Chegada, D1 Preparando chegada, D3 Preparação Consulta, Checagem Comparecimento e Aguardando Exame. Esta última dispara 7 dias depois de `data_agendamento`, às 09:00, e só para negócios em COMPARECEU/AGUARDA EXAMES; por isso regravar `data_agendamento` numa remarcação também a rearma.
- [RECEPCAO] Não Compareceu continua INATIVA (reativar depois dos testes).

## Em aberto
- **Configurar a jornada de trabalho no MedX (depois do deploy do código).** Em 2026-11-12 as agendas "Leize" e "Administrador" estavam sem jornada; a API v1 devolve 0 horários em `/agenda/disponibilidade` e só cria agendamento dentro da jornada. Até isso ser configurado, a disponibilidade da landing page e a criação de consulta a partir da Clint não funcionam (lembretes, checagem e regravação de datas não dependem disso).
- Reenviar ou não notificações já enviadas (ex.: lembrete D0) quando a data muda.
- O que fazer com cancelamento e com status Faltou no MedX.
- Endovenoso: se a etapa ENDOVENOSO participa da checagem de comparecimento (a condição atual da Checagem exige a etapa BOAS VINDAS, então negócios em ENDOVENOSO não seriam checados).
- Gatilhos de data de D1 e D3: não lidos (D1 tem 294 nós). Se usam `data_agendamento` ou outro campo, entram no ciclo apagar + regravar. Confirmar na Clint.
- Dois negócios abertos do mesmo contato em BOAS VINDAS (telefone compartilhado) continuam sendo atualizados juntos; tratar quando aparecer.

## Deixado para quem for construir
Nomes de tabelas e colunas, forma exata do payload do webhook novo, estrutura do job e retentativas, e o formato do alerta. Cada um com teste primeiro, com o MedX e a Clint simulados.
