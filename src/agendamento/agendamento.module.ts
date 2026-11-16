import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FILA_PORT, type FilaPort } from './application/ports/fila.port';
import { PersistenceModule } from '../shared/persistence/persistence.module';
import { ObservabilidadeModule } from '../shared/observabilidade/observabilidade.module';
import { RedisHealthClient } from '../shared/observabilidade/redis-health.client';
import { REDIS_HEALTH_CLIENT } from '../shared/observabilidade/redis-health.port';
import { FilaModule } from './infrastructure/fila/fila.module';

import { MedxTokenProvider } from './infrastructure/medx/medx-token.provider';
import { MedxHttpClient } from './infrastructure/medx/medx-http.client';
import { MedxCatalogoAdapter } from './infrastructure/medx/medx-catalogo.adapter';
import { MedxCadastroPacienteAdapter } from './infrastructure/medx/medx-cadastro-paciente.adapter';
import { MedxAgendaAdapter } from './infrastructure/medx/medx-agenda.adapter';
import { ClintWebhookAdapter } from './infrastructure/clint/clint-webhook.adapter';
import { ClintHttpClient } from './infrastructure/clint/clint-http.client';
import { ClintContatoAdapter } from './infrastructure/clint/clint-contato.adapter';
import { ClintNegocioAdapter } from './infrastructure/clint/clint-negocio.adapter';
import { MetaCapiAdapter } from './infrastructure/meta/meta-capi.adapter';
import { AdapterProcessor } from './infrastructure/fila/adapter.processor';

import {
    CATALOGO_CLINICO_PORT,
    type CatalogoClinicoPort,
} from './application/ports/catalogo-clinico.port';
import { LOGGER_PORT, type LoggerMinimo } from './application/ports/logger.port';
import { CADASTRO_PACIENTE_PORT } from './application/ports/cadastro-paciente.port';
import { AGENDA_MEDICA_PORT } from './application/ports/agenda-medica.port';
import { CRM_PORT } from './application/ports/crm.port';
import { CRM_CONTATO_PORT } from './application/ports/crm-contato.port';
import { CRM_NEGOCIO_PORT } from './application/ports/crm-negocio.port';
import { CONVERSAO_PORT } from './application/ports/conversao.port';
import { ETAPAS_RECEPCAO } from './application/ports/etapas-recepcao.port';

import { RegravarDataUseCase } from './application/regravar-data/regravar-data.usecase';
import { MonitorarAgendaUseCase } from './application/monitorar-agenda/monitorar-agenda.usecase';
import { ResolvedorContato } from './application/monitorar-agenda/resolver-contato';
import { AgendarConsultaUseCase } from './application/agendar-consulta/agendar-consulta.usecase';
import { ProcessarRespostaUseCase } from './application/processar-resposta-lembrete/processar-resposta.usecase';
import { ProcessarLeadOrigemUseCase } from './application/processar-lead-origem/processar-lead-origem.usecase';
import { ConsultarDisponibilidadeUseCase } from './application/consultar-disponibilidade/consultar-disponibilidade.usecase';
import { CapturarCliqueUseCase } from './application/capturar-clique/capturar-clique.usecase';
import { ProcessarVendaGanhaUseCase } from './application/processar-venda-ganha/processar-venda-ganha.usecase';
import { VerificarComparecimentoUseCase } from './application/verificar-comparecimento/verificar-comparecimento.usecase';

import { WebhooksController } from './presentation/http/webhooks.controller';
import { HealthController } from './presentation/http/health.controller';
import { DisponibilidadeController } from './presentation/http/disponibilidade.controller';
import { LeadsController } from './presentation/http/leads.controller';

/** Intervalo da rodada do monitor do MedX. */
const INTERVALO_MONITOR_MS = 5 * 60 * 1000;
const JOB_MONITOR = 'monitor-medx';

@Module({
    imports: [PersistenceModule, ObservabilidadeModule, FilaModule],
    controllers: [WebhooksController, HealthController, DisponibilidadeController, LeadsController],
    providers: [
        MedxTokenProvider,
        MedxHttpClient,
        { provide: CATALOGO_CLINICO_PORT, useClass: MedxCatalogoAdapter },
        { provide: CADASTRO_PACIENTE_PORT, useClass: MedxCadastroPacienteAdapter },
        { provide: AGENDA_MEDICA_PORT, useClass: MedxAgendaAdapter },
        { provide: CRM_PORT, useClass: ClintWebhookAdapter },
        ClintHttpClient,
        { provide: CRM_CONTATO_PORT, useClass: ClintContatoAdapter },
        { provide: CRM_NEGOCIO_PORT, useClass: ClintNegocioAdapter },
        { provide: CONVERSAO_PORT, useClass: MetaCapiAdapter },
        {
            provide: ETAPAS_RECEPCAO,
            useFactory: (config: ConfigService) => ({
                criacao: config.get<string>('CLINT_ETAPA_CRIACAO_ID')!,
                boasVindas: config.get<string>('CLINT_ETAPA_BOAS_VINDAS_ID')!,
                endovenoso: config.get<string>('CLINT_ETAPA_ENDOVENOSO_ID')!,
            }),
            inject: [ConfigService],
        },
        AgendarConsultaUseCase,
        ProcessarRespostaUseCase,
        ProcessarLeadOrigemUseCase,
        ConsultarDisponibilidadeUseCase,
        CapturarCliqueUseCase,
        ProcessarVendaGanhaUseCase,
        VerificarComparecimentoUseCase,
        RegravarDataUseCase,
        ResolvedorContato,
        MonitorarAgendaUseCase,
        AdapterProcessor,
        { provide: REDIS_HEALTH_CLIENT, useClass: RedisHealthClient },
    ],
})
export class AgendamentoModule implements OnModuleInit {
    constructor(
        @Inject(CATALOGO_CLINICO_PORT) private readonly catalogo: CatalogoClinicoPort,
        @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
        @Inject(FILA_PORT) private readonly fila: FilaPort,
        private readonly config: ConfigService,
    ) {}

    async onModuleInit(): Promise<void> {
        // Aquece o catálogo, mas o adapter sobe mesmo com o MedX fora: os
        // webhooks são gravados e enfileirados, e o catálogo recarrega sob
        // demanda no primeiro job.
        try {
            await this.catalogo.carregar();
        } catch (erro) {
            this.logger.warn(
                { alerta: true, erro: erro instanceof Error ? erro.message : String(erro) },
                'catálogo do MedX indisponível no boot — será carregado sob demanda',
            );
        }

        const modo = this.config.get<'desligado' | 'observar' | 'agir'>('MONITOR_MEDX_MODO');
        if (modo === 'observar' || modo === 'agir') {
            await this.fila.agendarRepetitivo(
                JOB_MONITOR,
                { tipo: 'monitor-medx', comando: { modo } },
                INTERVALO_MONITOR_MS,
            );
            this.logger.info({ modo }, 'monitor do MedX agendado a cada 5 minutos');
        } else {
            await this.fila.removerRepetitivo(JOB_MONITOR);
        }
    }
}
