# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.3.0](https://github.com/useagendaflow/adapter-clint-medx/compare/v1.2.2...v1.3.0) (2026-09-16)

### Features

- aceita duracao_consulta como fallback quando o MedX nao tem duracao cadastrada ([fcc33a6](https://github.com/useagendaflow/adapter-clint-medx/commit/fcc33a62a2f057393dd3cc1b979cec88fd842e83))

### [1.2.2](https://github.com/useagendaflow/adapter-clint-medx/compare/v1.2.1...v1.2.2) (2026-09-16)

### Bug Fixes

- **medx:** usa campos reais (camelCase) da API de vínculo e catálogo ([5bcda85](https://github.com/useagendaflow/adapter-clint-medx/commit/5bcda85bcba02758dfeda67bb814bd8100009701))

### [1.2.1](https://github.com/useagendaflow/adapter-clint-medx/compare/v1.2.0...v1.2.1) (2026-09-16)

### Bug Fixes

- extrai só a hora quando hora_da_consulta vem como datetime ISO completo ([e02ab10](https://github.com/useagendaflow/adapter-clint-medx/commit/e02ab10d20905059076ee71bacb4c2244d81a84b))

## [1.2.0](https://github.com/useagendaflow/adapter-clint-medx/compare/v1.1.1...v1.2.0) (2026-09-15)

### Features

- combina dia e hora da consulta enviados separados pela Clint ([5d9f9aa](https://github.com/useagendaflow/adapter-clint-medx/commit/5d9f9aa18953be33f535e241b946c51e7ee433e0))

### [1.1.1](https://github.com/useagendaflow/adapter-clint-medx/compare/v1.1.0...v1.1.1) (2026-09-15)

### Bug Fixes

- usa GITHUB_TOKEN automático para login no GHCR na VPS ([e4d6973](https://github.com/useagendaflow/adapter-clint-medx/commit/e4d6973ee5bd8b67c6b8c9cedd5f5e3f012b9a5a))

## 1.1.0 (2026-09-15)

### Features

- adapter de agenda do MedX com reconstrução completa no PUT ([184f95b](https://github.com/useagendaflow/adapter-clint-medx/commit/184f95b0c2e378af178a5f43da3cb386c0d32773))
- adapter de cadastro de paciente no MedX ([196bafc](https://github.com/useagendaflow/adapter-clint-medx/commit/196bafcd783bbb4892590057ffc290cde4c2ddca))
- adapter de catálogo clínico com descoberta do índice de status ([4f57cb2](https://github.com/useagendaflow/adapter-clint-medx/commit/4f57cb297e4012002aa529b3fad5a06e9fb69270))
- adapter de saída para o Clint via webhook de entrada ([ea59898](https://github.com/useagendaflow/adapter-clint-medx/commit/ea59898d0beb04a5a29cada3176df74b500e9966))
- AgendamentoModule, AppModule e main.ts ligando todas as camadas ([835f9db](https://github.com/useagendaflow/adapter-clint-medx/commit/835f9dbbecbd4a0be4855e9c00cb93b3f268715f))
- AgendarConsultaUseCase como serviço injetável ([057b1f3](https://github.com/useagendaflow/adapter-clint-medx/commit/057b1f350c8c1b931db56e8e977cc2b82ea459f8))
- alertas disparados por marcação no log e notificador por e-mail ([e60da5a](https://github.com/useagendaflow/adapter-clint-medx/commit/e60da5a5e9d9981e5f39b077d43b29776a7d09a0))
- bootstrap do projeto e validação de ambiente com Zod ([d65d506](https://github.com/useagendaflow/adapter-clint-medx/commit/d65d5064f88f4270cef9720189751570fa6d72e5))
- bootstrap do projeto NestJS com validação de ambiente ([7e542e2](https://github.com/useagendaflow/adapter-clint-medx/commit/7e542e2f9ec074a7b4d28762509220492dcdd82f))
- caso de uso de agendamento sobre os ports ([08986d7](https://github.com/useagendaflow/adapter-clint-medx/commit/08986d7cc29da9ff7efb2feeb639caec9eb260e1))
- caso de uso de resposta ao lembrete ([a717f06](https://github.com/useagendaflow/adapter-clint-medx/commit/a717f068c64f22ff6d3e24bd0b1c6165966d32fa))
- cliente HTTP do MedX com tratamento de 429 e renovação de token ([7cb1b65](https://github.com/useagendaflow/adapter-clint-medx/commit/7cb1b657d1d838ac84713787e87711e9cc7d62cd))
- ClintWebhookAdapter como serviço injetável ([0688335](https://github.com/useagendaflow/adapter-clint-medx/commit/0688335e07da60bd786a9b14730d33e9539edf19))
- composition root ligando os adapters aos ports ([daa773f](https://github.com/useagendaflow/adapter-clint-medx/commit/daa773f1e7df6812f9ccbfc26270c827ca87aeca))
- conexão SQLite com migrations e modo WAL ([fd4523b](https://github.com/useagendaflow/adapter-clint-medx/commit/fd4523bd2d3dee9baa955b1956ea8fa4f4c45594))
- Dockerfile e docker-compose.yml com Postgres, Redis e usuário não-root ([5844178](https://github.com/useagendaflow/adapter-clint-medx/commit/5844178463cd50f2bc212468ba05e459aad5411c))
- enriquece a ficha do paciente no MedX com cidade, endereço e cep ([177d465](https://github.com/useagendaflow/adapter-clint-medx/commit/177d465564e44a2c17796cbe0d0820133a17bf86))
- entidade Agendamento com a regra de recusa de confirmação ([f31245b](https://github.com/useagendaflow/adapter-clint-medx/commit/f31245b809f34926caed1fc123f39b00bf30e54f))
- entidade Agendamento com a regra de recusa de confirmação ([5abffd5](https://github.com/useagendaflow/adapter-clint-medx/commit/5abffd50c1b17ac34738b24d9384c3f18e3c37d0))
- entidades de correlação de paciente e evento recebido ([247e2d8](https://github.com/useagendaflow/adapter-clint-medx/commit/247e2d8dd018623df9d921309d93a425ae132aba))
- entidades de correlação de paciente e evento recebido ([b41c469](https://github.com/useagendaflow/adapter-clint-medx/commit/b41c469d20e51ef7da7d8a4d4be492d1f6ef0b2b))
- fila @nestjs/bullmq com rate limiter e AdapterProcessor ([a7c2692](https://github.com/useagendaflow/adapter-clint-medx/commit/a7c2692ee5631e81f2f131e0b0662e0b580ec228))
- fila BullMQ com rate limiter e processador de jobs ([4a66fba](https://github.com/useagendaflow/adapter-clint-medx/commit/4a66fbaebf9682db0e96b32c7d2efa1270ce3942))
- HealthController verificando redis, banco e MedX ([a2d1fae](https://github.com/useagendaflow/adapter-clint-medx/commit/a2d1faeda725e3016e4149b0f1c65aea3349c0a0))
- logger compartilhado com redação de dados pessoais ([b3d3535](https://github.com/useagendaflow/adapter-clint-medx/commit/b3d3535d0e00ea2f6c59911e7ed54ce5d284bc75))
- MedxAgendaAdapter com reconstrução completa no PUT ([64ab1c9](https://github.com/useagendaflow/adapter-clint-medx/commit/64ab1c902a1b856dd3a11899bd1fe5b002f5c865))
- MedxCadastroPacienteAdapter como serviço injetável ([f3f4f8c](https://github.com/useagendaflow/adapter-clint-medx/commit/f3f4f8c523211a5a241059701fddf68c397bf80d))
- MedxCatalogoAdapter com descoberta do índice de status ([b3d36e9](https://github.com/useagendaflow/adapter-clint-medx/commit/b3d36e972799664950ed88f7d80c6f29615f9e8b))
- MedxHttpClient como serviço injetável ([bcc8a12](https://github.com/useagendaflow/adapter-clint-medx/commit/bcc8a12f4a63d07927ba4fa39b9867a3436ac67e))
- MedxTokenProvider como serviço injetável ([bf92555](https://github.com/useagendaflow/adapter-clint-medx/commit/bf925557db5404ebe1d0324c57cf58a5c3499530))
- ObservabilidadeModule com nestjs-pino, alertas e notificador de e-mail ([8ba1c2d](https://github.com/useagendaflow/adapter-clint-medx/commit/8ba1c2d89600615c705167e81de99fbf8b94df14))
- painel da fila (Bull Board) protegido por basic auth sobre Express ([0c09216](https://github.com/useagendaflow/adapter-clint-medx/commit/0c092165349fcd6207aaa4f2116c807b9d5e32a7))
- painel da fila, empacotamento Docker e documentação ([69ec526](https://github.com/useagendaflow/adapter-clint-medx/commit/69ec52639ec818b1ba69e01545c3d1a4c795bd86))
- PersistenceModule e repositório Prisma de Agendamento ([7a58234](https://github.com/useagendaflow/adapter-clint-medx/commit/7a5823454f9beb0b49a11d3945e7fbfcc972abe2))
- ports da camada de aplicação ([88cdb84](https://github.com/useagendaflow/adapter-clint-medx/commit/88cdb849b173b805c6a76b8d32f8af2a08ba8018))
- ports da camada de aplicação com Symbol tokens de DI ([96267ee](https://github.com/useagendaflow/adapter-clint-medx/commit/96267eebfd4e62841b3ae1a84c7f5b6751015efe))
- ProcessarRespostaUseCase como serviço injetável ([1c13f37](https://github.com/useagendaflow/adapter-clint-medx/commit/1c13f37fc8fb44811de607cc6a191775ae3b8d4a))
- provedor de token do MedX com renovação antecipada ([7baea52](https://github.com/useagendaflow/adapter-clint-medx/commit/7baea522f8bf8843ece56607f52029b4521fca47))
- repositório Prisma de CorrelacaoPaciente ([3521358](https://github.com/useagendaflow/adapter-clint-medx/commit/3521358e6d0843c14caf38f38bc67d931009c127))
- repositório Prisma de Evento e PersistenceModule completo ([6354559](https://github.com/useagendaflow/adapter-clint-medx/commit/63545590baaa5269c7f1fb44bfaf09efae70e8cd))
- repositórios SQLite dos três agregados ([75ca606](https://github.com/useagendaflow/adapter-clint-medx/commit/75ca606554153b33c0ab83181bf9c2cd5c1f9a80))
- schema Prisma e PrismaService ([f6c2aeb](https://github.com/useagendaflow/adapter-clint-medx/commit/f6c2aeb4f47bb5ea318a88da29ebfe364864fed5))
- script de descoberta adaptado ao NestJS e .env.example completo ([4efadda](https://github.com/useagendaflow/adapter-clint-medx/commit/4efadda170def4b281d91e699aedf3ebc5653f66))
- script de descoberta das tabelas de apoio do MedX ([9d66b01](https://github.com/useagendaflow/adapter-clint-medx/commit/9d66b01f43a91256172f3ef44fffa5753dc6bb64))
- servidor HTTP que sempre responde 200 e enfileira os webhooks ([81239d1](https://github.com/useagendaflow/adapter-clint-medx/commit/81239d1439f2921c87c4f1d3485aaa75ba35bd20))
- value object Cpf com validação de dígitos verificadores ([ee08419](https://github.com/useagendaflow/adapter-clint-medx/commit/ee08419d23d60443afd8b425f5047d1a9ddb9733))
- value object PeriodoConsulta com fuso da clínica ([1b2f9da](https://github.com/useagendaflow/adapter-clint-medx/commit/1b2f9da992cec2ec416a667f799c1a977f8a23e4))
- value object RespostaLembrete com as três opções do lembrete ([725bc91](https://github.com/useagendaflow/adapter-clint-medx/commit/725bc91ac462cab2a2fc8f87e8737a22582c4ac8))
- value object Telefone com normalização e validação ([bac70fd](https://github.com/useagendaflow/adapter-clint-medx/commit/bac70fd2f340e9ee28f880487fe07c1715858214))
- value objects PeriodoConsulta e RespostaLembrete ([5c7efac](https://github.com/useagendaflow/adapter-clint-medx/commit/5c7efac361dd4764183989de988271b7094cef4f))
- value objects Telefone e Cpf no novo projeto NestJS ([70cc511](https://github.com/useagendaflow/adapter-clint-medx/commit/70cc5118f1d6bdab5cc0e78ceff9be363c5814f3))
- WebhooksController com a garantia sempre-200 ([11c533d](https://github.com/useagendaflow/adapter-clint-medx/commit/11c533d690daac1cfc0a06a21748b52608073017))

### Bug Fixes

- adiciona assertions ao teste de persistência de falha de evento ([908b544](https://github.com/useagendaflow/adapter-clint-medx/commit/908b54470ef0fc9a50102a6533d937d40e231a9b))
- corrige 7 achados da revisão final (duplicidade, 404, rate limit, PII, validação) ([05aeb8e](https://github.com/useagendaflow/adapter-clint-medx/commit/05aeb8e422e6daf44ddbbcc4ba46d8663623fd13))
- descoberta de status Confirmado com igualdade exata, não prefixo ([62c7602](https://github.com/useagendaflow/adapter-clint-medx/commit/62c7602771c1e61826d5c493e04a02f8e1e41c80))
- regras de dependência de camadas — corrige falsos negativos e adiciona composition ([7ff6acb](https://github.com/useagendaflow/adapter-clint-medx/commit/7ff6acbd14b8f5b05cdc7c0331a655224fb68c8b))
- remover arquivo de lock de sessão do controle de versão ([bb7848e](https://github.com/useagendaflow/adapter-clint-medx/commit/bb7848ec6c58f6932972ecfe3fc6e7fcd8f899b6))
- reverter validação estrita de email (regressão introduzida no fix wave) ([d7ada67](https://github.com/useagendaflow/adapter-clint-medx/commit/d7ada67dc00207937e4fe3cdae489207207c0633))
- sobe Postgres e Redis como services no CI para os testes ([86e316f](https://github.com/useagendaflow/adapter-clint-medx/commit/86e316fb52c8e6cf9f8e366fdf0792f5d63259c6))
