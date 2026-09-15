import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { PersistenceModule } from '../shared/persistence/persistence.module';
import { ObservabilidadeModule } from '../shared/observabilidade/observabilidade.module';
import { RedisHealthClient } from '../shared/observabilidade/redis-health.client';
import { FilaModule } from './infrastructure/fila/fila.module';
import { REDIS_HEALTH_CLIENT } from './presentation/http/health.controller';

import { MedxTokenProvider } from './infrastructure/medx/medx-token.provider';
import { MedxHttpClient } from './infrastructure/medx/medx-http.client';
import { MedxCatalogoAdapter } from './infrastructure/medx/medx-catalogo.adapter';
import { MedxCadastroPacienteAdapter } from './infrastructure/medx/medx-cadastro-paciente.adapter';
import { MedxAgendaAdapter } from './infrastructure/medx/medx-agenda.adapter';
import { ClintWebhookAdapter } from './infrastructure/clint/clint-webhook.adapter';
import { AdapterProcessor } from './infrastructure/fila/adapter.processor';

import {
    CATALOGO_CLINICO_PORT,
    type CatalogoClinicoPort,
} from './application/ports/catalogo-clinico.port';
import { CADASTRO_PACIENTE_PORT } from './application/ports/cadastro-paciente.port';
import { AGENDA_MEDICA_PORT } from './application/ports/agenda-medica.port';
import { CRM_PORT } from './application/ports/crm.port';

import { AgendarConsultaUseCase } from './application/agendar-consulta/agendar-consulta.usecase';
import { ProcessarRespostaUseCase } from './application/processar-resposta-lembrete/processar-resposta.usecase';

import { WebhooksController } from './presentation/http/webhooks.controller';
import { HealthController } from './presentation/http/health.controller';

@Module({
    imports: [PersistenceModule, ObservabilidadeModule, FilaModule],
    controllers: [WebhooksController, HealthController],
    providers: [
        MedxTokenProvider,
        MedxHttpClient,
        { provide: CATALOGO_CLINICO_PORT, useClass: MedxCatalogoAdapter },
        { provide: CADASTRO_PACIENTE_PORT, useClass: MedxCadastroPacienteAdapter },
        { provide: AGENDA_MEDICA_PORT, useClass: MedxAgendaAdapter },
        { provide: CRM_PORT, useClass: ClintWebhookAdapter },
        AgendarConsultaUseCase,
        ProcessarRespostaUseCase,
        AdapterProcessor,
        { provide: REDIS_HEALTH_CLIENT, useClass: RedisHealthClient },
    ],
})
export class AgendamentoModule implements OnModuleInit {
    constructor(@Inject(CATALOGO_CLINICO_PORT) private readonly catalogo: CatalogoClinicoPort) {}

    async onModuleInit(): Promise<void> {
        // Falha cedo e alto se o rótulo de confirmação não existir nesta conta —
        // deliberadamente sem try/catch. Ver Global Constraints.
        await this.catalogo.carregar();
    }
}
