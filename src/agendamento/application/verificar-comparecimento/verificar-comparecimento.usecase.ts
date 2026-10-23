import { Inject, Injectable } from '@nestjs/common';
import { Telefone } from '../../domain/paciente/telefone';
import { AGENDA_MEDICA_PORT, type AgendaMedicaPort } from '../ports/agenda-medica.port';
import { CATALOGO_CLINICO_PORT, type CatalogoClinicoPort } from '../ports/catalogo-clinico.port';
import { CRM_PORT, type CrmPort } from '../ports/crm.port';
import type { ComandoVerificarComparecimento } from './verificar-comparecimento.comando';

/**
 * Roda 2h após o horário da consulta (ver automação "D0 Chegada" / campo
 * horario_checagem_comparecimento na Clint). Só conta como comparecimento o
 * status "Finalizado Atendimento" no MedX — qualquer outro (inclusive
 * Confirmado, Agendado ou rótulo ausente) é tratado como não comparecimento,
 * por decisão explícita: evita falso-positivo se a recepção nunca marcar o
 * atendimento como concluído.
 */
@Injectable()
export class VerificarComparecimentoUseCase {
    constructor(
        @Inject(AGENDA_MEDICA_PORT) private readonly agenda: AgendaMedicaPort,
        @Inject(CATALOGO_CLINICO_PORT) private readonly catalogo: CatalogoClinicoPort,
        @Inject(CRM_PORT) private readonly crm: CrmPort,
    ) {}

    async executar(comando: ComandoVerificarComparecimento): Promise<void> {
        const telefone = Telefone.criar(comando.telefone);
        const externo = await this.agenda.obter(comando.idAgendamentoMedx);
        const compareceu = externo.status === this.catalogo.indiceStatusFinalizado();

        if (compareceu) {
            await this.crm.notificarComparecimento(comando.dealId, telefone);
        } else {
            await this.crm.notificarNaoComparecimento(comando.dealId, telefone);
        }
    }
}
