import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { AGENDA_MEDICA_PORT, type AgendaMedicaPort } from '../ports/agenda-medica.port';
import { CATALOGO_CLINICO_PORT, type CatalogoClinicoPort } from '../ports/catalogo-clinico.port';
import {
    CRM_NEGOCIO_PORT,
    type CamposNegocio,
    type CrmNegocioPort,
} from '../ports/crm-negocio.port';
import { LOGGER_PORT, type LoggerMinimo } from '../ports/logger.port';
import { calcularHorarioLembreteChegada } from '../../domain/agendamento/lembrete-chegada';
import { calcularHorarioChecagemComparecimento } from '../../domain/agendamento/checagem-comparecimento';
import { FUSO_CLINICA } from '../../domain/agendamento/periodo-consulta';
import type { ComandoRegravarData } from './regravar-data.comando';

/**
 * `data_agendamento` arma automações antes (D3, D1) e depois da consulta
 * (Aguardando Exame: +7 dias às 09:00). Ela só deixa de ser útil quando o
 * último gatilho que arma já passou.
 */
const DIAS_AGUARDANDO_EXAME = 7;
const HORA_AGUARDANDO_EXAME = 9;

/**
 * Chamado pelas automações da Clint depois de mudarem o `etapa_lembrete` e
 * apagarem o campo de data que arma a próxima automação. Lê o agendamento no
 * MedX (fonte da verdade, então remarcações feitas por fora entram aqui) e
 * grava o valor recalculado. Não grava agendamento desmarcado/cancelado/falta
 * nem horário que já passou: uma data passada dispararia a automação na hora.
 */
@Injectable()
export class RegravarDataUseCase {
    /** Sobrescrito em testes para controlar o relógio. */
    agora: () => DateTime = () => DateTime.now().setZone(FUSO_CLINICA);

    constructor(
        @Inject(AGENDA_MEDICA_PORT) private readonly agenda: AgendaMedicaPort,
        @Inject(CATALOGO_CLINICO_PORT) private readonly catalogo: CatalogoClinicoPort,
        @Inject(CRM_NEGOCIO_PORT) private readonly crm: CrmNegocioPort,
        @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
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

        const { campos, momento } = this.calcular(comando.campo, externo.inicio);

        if (DateTime.fromISO(momento, { zone: FUSO_CLINICA }) <= this.agora()) {
            // A automação já apagou o campo: o negócio fica sem esse gatilho.
            this.logger.warn(
                { ...contexto, momento, alerta: true },
                'horário já passou — data não regravada, negócio ficou sem o campo',
            );
            return;
        }

        await this.crm.gravarCampos(comando.dealId, campos);
    }

    private calcular(
        campo: ComandoRegravarData['campo'],
        inicio: string,
    ): { campos: CamposNegocio; momento: string } {
        if (campo === 'data_agendamento') {
            return {
                campos: {
                    data_agendamento: inicio.slice(0, 10),
                    hora_agendamento: inicio.slice(11, 16),
                },
                momento: DateTime.fromISO(inicio, { zone: FUSO_CLINICA })
                    .startOf('day')
                    .plus({ days: DIAS_AGUARDANDO_EXAME, hours: HORA_AGUARDANDO_EXAME })
                    .toISO()!,
            };
        }
        const valor =
            campo === 'horario_lembrete_chegada'
                ? calcularHorarioLembreteChegada(inicio)
                : calcularHorarioChecagemComparecimento(inicio);
        return { campos: { [campo]: valor }, momento: valor };
    }
}
