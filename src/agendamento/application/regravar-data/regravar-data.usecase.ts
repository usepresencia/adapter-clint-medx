import { Inject, Injectable } from '@nestjs/common';
import { AGENDA_MEDICA_PORT, type AgendaMedicaPort } from '../ports/agenda-medica.port';
import { CATALOGO_CLINICO_PORT, type CatalogoClinicoPort } from '../ports/catalogo-clinico.port';
import { CRM_NEGOCIO_PORT, type CrmNegocioPort } from '../ports/crm-negocio.port';
import { LOGGER_PORT, type LoggerMinimo } from '../ports/logger.port';
import { RELOGIO_PORT, type Relogio } from '../ports/relogio.port';
import { calcularCampoData } from '../../domain/agendamento/campos-data';
import type { ComandoRegravarData } from './regravar-data.comando';

/**
 * Chamado pelas automações da Clint depois de mudarem o `etapa_lembrete` e
 * apagarem o campo de data que arma a próxima automação. Lê o agendamento no
 * MedX (fonte da verdade, então remarcações feitas por fora entram aqui) e
 * grava o valor recalculado. Não grava agendamento desmarcado/cancelado/falta
 * nem horário que já passou: uma data passada dispararia a automação na hora.
 */
@Injectable()
export class RegravarDataUseCase {
    constructor(
        @Inject(AGENDA_MEDICA_PORT) private readonly agenda: AgendaMedicaPort,
        @Inject(CATALOGO_CLINICO_PORT) private readonly catalogo: CatalogoClinicoPort,
        @Inject(CRM_NEGOCIO_PORT) private readonly crm: CrmNegocioPort,
        @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
        @Inject(RELOGIO_PORT) private readonly relogio: Relogio,
    ) {}

    async executar(comando: ComandoRegravarData): Promise<void> {
        const contexto = {
            deal_id: comando.dealId,
            id_agendamento: comando.idAgendamentoMedx,
            campo: comando.campo,
        };
        const externo = await this.agenda.obter(comando.idAgendamentoMedx);

        if ((await this.catalogo.indicesStatusQueLiberamHorario()).includes(externo.status)) {
            this.logger.warn(
                { ...contexto, status: externo.status },
                'agendamento desmarcado no MedX — data não regravada',
            );
            return;
        }

        const { campos, momento } = calcularCampoData(comando.campo, externo.inicio);

        if (momento <= this.relogio.agora()) {
            // A automação já apagou o campo: o negócio fica sem esse gatilho.
            this.logger.warn(
                { ...contexto, momento: momento.toISO(), alerta: true },
                'horário já passou — data não regravada, negócio ficou sem o campo',
            );
            return;
        }

        await this.crm.gravarCampos(comando.dealId, campos);
    }
}
