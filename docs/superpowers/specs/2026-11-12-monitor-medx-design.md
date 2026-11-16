# Monitor do MedX → Clint

Data: 2026-11-12. Status: rascunho para aprovação. Complementa `2026-11-11-sincronizacao-medx-clint-design.md` (caminhos 2 e 3, cancelamento) e substitui a seção "Monitor" de lá.

## Intenção

A recepção marca, remarca e cancela consultas direto no MedX. Hoje a Clint só fica sabendo do que nasce nela (Venda Ganha → webhook de agendamento). Resultado visto em 11 e 12/11: negócios criados à mão sem `id_agendamento_medx`, remarcações que deixaram lembrete e checagem no dia errado (Aceli, Vivian, Sirlei), pacientes do dia sem negócio (Maria de Lourdes, Everton) e correções manuais campo a campo. O monitor faz a Clint seguir o MedX sozinha, e a paciente entra no fluxo de lembretes no ponto certo da janela até a consulta.

## Objetivos

- Todo agendamento de consulta ou endovenoso no MedX tem um negócio na RECEPÇÃO com os dados certos e entra na cadeia de lembretes no passo que a janela permite.
- Remarcação no MedX atualiza os horários sem repetir lembrete já enviado.
- Cancelamento no MedX encerra o negócio e silencia os lembretes.

## Fora de escopo / não-objetivos

- Status Laser, Intramuscular/tzp, Cabelo, USG/CRIO, Espera, Reservado: ignorados por enquanto (decisão do usuário).
- Anotações sem paciente na agenda (ex.: "COMEÇA AS 09:00H"): ignoradas.
- Falta (status Faltou): continua com a Checagem Comparecimento, o monitor não age (decisão do usuário).
- Mensagens próprias do endovenoso: serão padronizadas depois; o monitor só deixa o negócio pronto.
- Alerta por e-mail: o adapter não tem SMTP configurado; a revisão humana acontece na Clint (tag).

## Anti-objetivos

- Mandar mensagem para a pessoa errada (negócio no contato errado). Na dúvida entre dois contatos, não assume.
- Reenviar lembrete já enviado por causa de uma remarcação.
- Disparar uma automação fora de vez porque o adapter gravou uma data que já passou (exceção deliberada: o D1 "30 min depois", abaixo).

## Decisões do usuário

**Quais agendamentos:** só status Agendado (1), Confirmado (2) e Endovenoso (12). Os ids de status vêm do catálogo da conta, não fixos no código.

**Agendamento novo — consulta (Agendado/Confirmado):** negócio em RECEPÇÃO / BOAS VINDAS; a paciente recebe o D0 Boas Vindas e depois vai para o primeiro "Dx" que ainda cabe na janela:
- 3 dias ou mais até a consulta → D3, D1, D0 Chegada (cadeia completa);
- 2 dias → pula D3, vai para D1;
- 1 dia (o horário do D1 já passou) → D1 sai **30 minutos depois** de entrar na etapa;
- consulta hoje → só o D0 Chegada, e só se o horário dele ainda não passou.

**Agendamento novo — endovenoso (status 12):** negócio em RECEPÇÃO / ENDOVENOSO com `tipo_consulta = endovenoso`, **sem boas-vindas**, só os "Dx" que couberem na janela; etapa e datas prontas para as automações próprias que virão.

**Remarcação (início mudou no MedX):** segue da etapa em que está; só os horários são regravados. Nada do que já foi enviado se repete.

**Cancelado ou Desmarcado:** `etapa_lembrete = cancelado` (opção nova no campo) e o negócio é fechado como **perdido** com o motivo "Consulta cancelada no MedX" (motivo novo na RECEPÇÃO). Se a paciente remarcar depois, é um agendamento novo: nasce outro negócio e ela recebe a boas-vindas de novo.

**Negócio já existente:** se o contato tem negócio aberto na RECEPÇÃO sem `id_agendamento_medx`, o monitor assume esse negócio e atualiza (não cria outro).

**Achar o contato na Clint:**
- telefone do MedX com um só contato na Clint → usa esse contato;
- dois ou mais contatos com o mesmo telefone → escolhe pelo nome;
- sem telefone no MedX → procura pelo nome na Clint; achando contato com telefone, **grava esse telefone no cadastro da paciente no MedX** e segue normal;
- sem telefone nos dois → cria contato e negócio na Clint com a tag "sem telefone no MedX" para a recepção completar.

**Quem escolhe o passo na entrada: a automação, com um campo calculado pelo adapter** (decisão do usuário). A condição da Clint compara data só com valor fixo, não com "hoje", então a automação não calcula a janela sozinha:
- o adapter grava no negócio o campo novo `proximo_lembrete` (TEXT: `d3`, `d1`, `d0_chegada` ou `nenhum`) ao criar ou assumir o negócio, calculado pela janela e pelos horários dos gatilhos;
- o D0 Boas Vindas lê `proximo_lembrete` numa condição e grava o `etapa_lembrete` correspondente; no caso `d1`, espera 30 minutos (nó de espera) **antes de gravar a etapa** (o monitor só grava as datas depois de ver a etapa, então o D1 sai ~30 min depois); no caso `nenhum`, não grava etapa; nenhuma automação apaga data (revisão de 2026-11-16, abaixo);
- o adapter continua sem alterar `etapa_lembrete` na rota de regravação.
- Limite aceito: o valor é calculado na criação; se ela cair a menos de 30 min das 12:05 da véspera ou da virada do dia, o passo pode sair errado nesses casos raros.

## Decisões minhas (o usuário pode mudar)

- **Horários dos gatilhos** que o adapter precisa conhecer (copiados das automações em 2026-11-12; D1 atualizado em 2026-11-16): D3 = `data_agendamento` −3 dias às 09:00; D1 = −1 dia às 12:45; Aguardando Exame = +7 dias às 09:00. Ficam como constantes nomeadas em um lugar só; se a automação mudar, muda ali.
- **Frequência e janela:** a cada 5 minutos, de hoje até 30 dias à frente (cabe no limite de 31 dias por consulta da API v1).
- **Reconciliação, não detecção de mudança:** a cada rodada, cada agendamento da janela é comparado com o vínculo salvo no adapter (tabela nova: `id_agendamento_medx`, `deal_id`, último início e status vistos). Assim uma rodada que falhou é corrigida na seguinte.
- **Modo observar:** uma variável de ambiente liga o monitor em modo "só registra no log o que faria". Começa assim no primeiro deploy; vira "agir" depois que o usuário conferir o log de um dia.
- **Partida sem duplicar:** a cada rodada o monitor lista os negócios abertos da RECEPÇÃO pela API da Clint e indexa por `id_agendamento_medx` e por telefone; a tabela de vínculo é cache, não fonte. Assim os negócios que nasceram pelo fluxo Clint → `agendar-consulta` (que já têm o id) são reconhecidos desde a primeira rodada. Somado ao modo observar, evita boas-vindas em massa no primeiro deploy.
- **Quais negócios podem ser assumidos:** só abertos em BOAS VINDAS ou ENDOVENOSO. AGENDAMENTO fica fora (é o fluxo Clint esperando o webhook gravar o id), assim como PÓS CONSULTA, COMPARECEU e NÃO COMPARECEU.
- **Criação de consulta:** o adapter cria em BOAS VINDAS com `etapa_lembrete = d0_boas_vindas`, `id_agendamento_medx` e `duracao_consulta`, e grava `proximo_lembrete`. **As datas** (`horario_lembrete_chegada`, `horario_checagem_comparecimento` e, por último, `data_agendamento` + `hora_agendamento`) **só entram numa rodada seguinte**, depois que a automação de entrada gravou a etapa (regra de duas fases, abaixo).
- **Todo negócio novo nasce em RECEPÇÃO / BOAS VINDAS** (decisão do usuário): o canal de criação da Clint só cria numa etapa; quem move para outra etapa é sempre a automação.
- **Criação de endovenoso** (decisão do usuário): o adapter cria em BOAS VINDAS com `tipo_consulta = endovenoso`, `proximo_lembrete` e os mesmos dados, **sem** `etapa_lembrete` (assim o D0 Boas Vindas, que exige `d0_boas_vindas`, não envia). A automação de entrada abaixo move para ENDOVENOSO e grava a etapa.
- **Remarcação regrava todos os campos de data** (lembrete e checagem, e por último `data_agendamento` + hora), pulando os que já passaram, **desde que a etapa esteja confirmada** (regra de duas fases). As condições de `etapa_lembrete` impedem que um gatilho rearmado envie fora de vez.
- **Remarcação que passa por cima da etapa atual** (decisão do usuário: recalcular e pular). Ex.: está em `d3_preparacao_consulta` e a consulta foi antecipada para amanhã. Se o gatilho da etapa atual já passou, o adapter grava só o `proximo_lembrete` recalculado; a automação de entrada faz o salto; as datas entram na rodada em que o monitor vê a etapa nova. Se o gatilho atual ainda está no futuro, a etapa já está certa e as datas são regravadas na hora.

**Automação nova "[RECEPCAO] Entrada por janela"** (provisionar com o usuário; mantém a escolha da etapa na Clint):
- gatilho: `proximo_lembrete` mudou;
- não age se `etapa_lembrete = d0_boas_vindas` (consulta nova: quem conduz é o D0 Boas Vindas);
- se `tipo_consulta = endovenoso` e a etapa é BOAS VINDAS → move para ENDOVENOSO;
- grava `etapa_lembrete` conforme `proximo_lembrete` (`d3_preparacao_consulta`, `d1_preparando_chegada` ou `d0_chegada`; `nenhum` não grava); no caso `d1`, espera 30 min **antes** de gravar a etapa;
- não apaga data nem chama `/webhooks/clint/regravar-data`: quem grava as datas é o monitor, na rodada em que vê a etapa nova.
- Também cobre o negócio assumido com `etapa_lembrete` vazio.
- Risco para quem construir: o gatilho só dispara se o valor **mudar**; o adapter precisa garantir que o salto grava um valor diferente do atual (se igual, não há salto a fazer).
- **Plano B se a verificação 2 falhar** (valor diferente não rearma): o adapter grava `evento = remarcado`; uma automação nova (gatilho "campo mudou") apaga as datas e chama `/webhooks/clint/regravar-data` para cada uma.
- **Contato ambíguo** (telefone com 2+ contatos e o nome não decide, ou busca por nome com 2+ candidatos): não cria nem assume; põe a tag "conferir agendamento MedX" nos contatos candidatos e tenta de novo na rodada seguinte.
- **Agendamento que some da janela:** só trata como cancelado se `GET /v1/agenda/agendamentos/{id}/detalhes` também não o encontrar (um remarcado para além de 30 dias continua existindo e é tratado como remarcação).
- **Casar nome:** comparar sem acento, caixa e emoji; o contato serve quando todas as palavras do nome dele na Clint aparecem no nome completo do MedX e só um contato passa.
- **Telefone do MedX:** ler do cadastro do paciente (`/v1/contatos/{id}`), não do campo `sms` do agendamento.

## Revisão de 2026-11-16: etapa antes da data, em duas fases

Visto em produção entre 13 e 16/11: o D1 não regravava o lembrete de chegada (o D0 não saiu para ninguém em 13/11); depois passou a **apagar** a `data_agendamento` ao fim; datas gravadas sem a etapa certa fizeram automações dispararem para a paciente errada ou com o texto errado. Decisão do usuário: **a `data_agendamento` só é preenchida depois que a etapa está correta.**

**Regra de duas fases (monitor):** a cada rodada, para um negócio vinculado cujas datas divergem do MedX (vazias numa criação, diferentes numa remarcação):
1. Calcula o `proximo_lembrete` e decide se as datas estão liberadas:
   - `proximo_lembrete = nenhum` → liberadas (não há passo da cadeia a esperar; só a checagem costuma estar no futuro);
   - `etapa_lembrete` vazia ou `d0_boas_vindas` → **bloqueadas** (a automação de entrada ainda não gravou a etapa);
   - `etapaFoiUltrapassada(etapa, proximo)` → **bloqueadas** (falta o salto); grava `proximo_lembrete` se for diferente do atual;
   - qualquer outro caso → liberadas.
2. Bloqueadas: não grava nenhuma data nesta rodada. A próxima rodada lê o negócio de novo.
3. Liberadas: grava `horario_lembrete_chegada` e `horario_checagem_comparecimento` (os que estão no futuro) e, **por último, numa chamada separada**, `data_agendamento` + `hora_agendamento`.

Não há estado guardado: tudo sai do que a Clint mostra na rodada. A ordem vale mesmo quando a etapa é gravada por uma automação da Clint, cujo fim o adapter não enxerga. O custo é até uma rodada (5 min) entre a etapa e as datas.

**Bloqueio que não se resolve:** se as datas continuam bloqueadas quando falta menos de 60 min para o gatilho do passo esperado, o monitor loga com `alerta: true` e põe a tag `conferir agendamento MedX` no contato (ex.: automação de entrada que não rodou).

**Automações não apagam data.** O ciclo "apagar + `/regravar-data`" existia porque nada mais trazia a data do MedX no meio da cadeia; com o monitor, ele sai. As automações só enviam e avançam `etapa_lembrete`; a etapa é a trava contra envio fora de vez (data regravada com a etapa à frente → gatilho dispara e a condição barra). A rota `/webhooks/clint/regravar-data` continua existindo para uso manual.

## Restrições conhecidas

- **Negócio de contexto nos gatilhos de data da Clint** (visto em 13 e 16/11, 9 de 9 casos): o gatilho de data roda no **negócio aberto mais recente do contato, em qualquer funil**, e não no negócio dono da data. Paciente com um lead mais novo no COMERCIAL 1 (ou um ENDOVENOSO vazio) não recebe D1/D0, e a Checagem Comparecimento manda `id_agendamento_medx` vazio ("payload inválido"). Mitigação até o adapter disparar por `deal_id`: limpar negócios duplicados; o monitor pode marcar com a tag `conferir agendamento MedX` o contato cujo negócio da RECEPÇÃO não é o mais recente (exige listar os negócios do contato; fica a critério de quem construir).
- **Etapa do funil define o texto:** o D1 escolhe a mensagem pela etapa (BOAS VINDAS → consulta; ENDOVENOSO → endovenoso). Consulta num negócio em ENDOVENOSO recebe a mensagem de endovenoso (Daniela, 16/11). Ao assumir negócio, a etapa precisa combinar com o tipo.

- API v1 do MedX: token pessoal; `/agenda/agendamentos/detalhes` até 31 dias com fim exclusivo, paginado; escrita em prévia + executar com `Idempotency-Key`; atualização de paciente preserva campos omitidos.
- API REST da Clint (`POST /v1/deals/{id}`): grava e arma gatilho de data, **não apaga** campo (`""`/`null` ignorados).
- Gravar data já passada dispara a automação na hora.
- Regra Clint: etapa e `etapa_lembrete` antes das datas, sempre (gravar em duas chamadas, nessa ordem).

## A verificar antes de construir (ao vivo, no negócio de teste `521e2bf6`)

1. Criar negócio direto em BOAS VINDAS pela API dispara o D0 Boas Vindas (gatilho "mudou de etapa")?
2. Gravar um valor **diferente** num campo de data já preenchido rearma o gatilho para o novo horário (sem apagar antes)? A remarcação depende disso.
3. A API cria contato/negócio sem telefone? Como buscar contato por nome?
4. Como fechar como perdido: `status` e `lost_status_id` no `POST /v1/deals/{id}`.
5. Listar negócios abertos da RECEPÇÃO com os campos (`GET /v1/deals` com filtro de origem/status) para indexar por `id_agendamento_medx` e telefone.
6. Atualizar só o celular do paciente no MedX (`contatos/operacoes`, `acao: atualizar`): confirmar por prévia, sem executar, que os outros campos ficam preservados (a API antiga exigia ~44 campos).

Pré-requisitos na Clint (com o usuário): opção `cancelado` no campo `etapa_lembrete`, campo `proximo_lembrete` (TEXT), motivo de perda "Consulta cancelada no MedX", tags "sem telefone no MedX" e "conferir agendamento MedX", a condição por `proximo_lembrete` (com espera de 30 min no caso `d1`) no D0 Boas Vindas e a automação nova "[RECEPCAO] Entrada por janela".

## Em aberto

- D1 e D0 Chegada já aceitam ENDOVENOSO e mandariam as mensagens de consulta para endovenoso até o fluxo próprio existir.
- Paciente com dois agendamentos no período (consulta + endovenoso): dois negócios, um em cada etapa (palpite).

## Deixado para quem for construir

Nome e esquema da tabela de vínculo, estrutura do job repetitivo, formato dos logs do modo observar, ordem das chamadas dentro de uma rodada. Tudo com teste primeiro, MedX e Clint simulados.

## Revisão de 2026-11-16 (code review): limites conhecidos

- **Webhook de entrada (`gravarIdAgendamento`)** manda id e datas num payload só, sem a regra de duas fases: quem decide a etapa nesse caminho é a automação da Clint que o recebe. Só o monitor segue a regra. Para unificar, a automação de entrada teria de parar de mapear as datas (decisão com o usuário, na Clint).
- **Negócio duplicado:** o monitor alerta (log com `alerta` + tag `conferir agendamento MedX`) quando o negócio mais novo do contato na RECEPÇÃO não tem `id_agendamento_medx` e outro tem, depois de 30 min de carência. Negócio mais novo em **outro funil** não é detectável: a API REST da Clint ignora o filtro `contact_id` em `/v1/deals` (confirmado ao vivo).
- **Limite de requisições do MedX** na carga inicial da rodada: a rodada é pulada com aviso (sem alerta) e recomeça no próximo ciclo.
- **D1 enviado 30 min depois da entrada:** depois do gatilho esperado o monitor espera a etapa sem alertar (coberto por teste).
- **Timeout** de 30 s em toda chamada HTTP; o worker é único (`concurrency: 1`), então uma chamada pendurada travaria a fila.
