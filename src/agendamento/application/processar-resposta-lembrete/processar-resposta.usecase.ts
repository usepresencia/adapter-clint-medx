import { Inject, Injectable } from '@nestjs/common';
import type { AgendamentoRepositorio } from '../../domain/agendamento/agendamento.repositorio';
import { RespostaLembrete } from '../../domain/agendamento/resposta-lembrete';
import { Telefone } from '../../domain/paciente/telefone';
import { AGENDA_MEDICA_PORT, type AgendaMedicaPort } from '../ports/agenda-medica.port';
import { CATALOGO_CLINICO_PORT, type CatalogoClinicoPort } from '../ports/catalogo-clinico.port';
import { CRM_PORT, type CrmPort } from '../ports/crm.port';
import { LOGGER_PORT, type LoggerMinimo } from '../ports/logger.port';
import { AGENDAMENTO_REPOSITORIO } from '../../../shared/persistence/persistence.module';
import type { ComandoResposta } from './processar-resposta.comando';

@Injectable()
export class ProcessarRespostaUseCase {
    constructor(
        @Inject(AGENDAMENTO_REPOSITORIO) private readonly agendamentos: AgendamentoRepositorio,
        @Inject(AGENDA_MEDICA_PORT) private readonly agenda: AgendaMedicaPort,
        @Inject(CATALOGO_CLINICO_PORT) private readonly catalogo: CatalogoClinicoPort,
        @Inject(CRM_PORT) private readonly crm: CrmPort,
        @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
    ) {}

    async executar(comando: ComandoResposta): Promise<void> {
        const resposta = RespostaLembrete.criar(comando.resposta);
        const telefone = Telefone.criar(comando.telefone);

        if (resposta.exigeAtendimentoHumano) {
            if (resposta.valor === 'reagendar') {
                await this.crm.notificarReagendamento(comando.dealId, telefone);
            } else {
                await this.crm.notificarCancelamento(comando.dealId, telefone);
            }
            this.logger.info(
                { deal_id: comando.dealId, resposta: resposta.valor },
                'resposta do paciente encaminhada para atendimento humano',
            );
            return;
        }

        const agendamento = await this.agendamentos.buscarPorDeal(comando.dealId);

        const recusar = async (motivo: string): Promise<void> => {
            agendamento?.marcarConflito();
            if (agendamento) await this.agendamentos.salvar(agendamento);

            this.logger.warn(
                {
                    alerta: true,
                    deal_id: comando.dealId,
                    id_agendamento: comando.idAgendamentoMedx,
                    motivo,
                },
                'confirmação recusada',
            );
            await this.crm.notificarConflito(comando.dealId, motivo, telefone);
        };

        if (!agendamento) {
            return recusar('adapter não tem registro deste agendamento');
        }

        if (agendamento.jaFoiConfirmado) {
            this.logger.info({ deal_id: comando.dealId }, 'agendamento já estava confirmado');
            return;
        }

        if (agendamento.idMedx !== comando.idAgendamentoMedx) {
            return recusar('id de agendamento informado pelo CRM não confere com o registro local');
        }

        const externo = await this.agenda.obter(comando.idAgendamentoMedx);

        const avaliacao = agendamento.avaliarConfirmacao(
            { status: externo.status, inicio: externo.inicio },
            this.catalogo.indiceStatusAgendado(),
            this.catalogo.indiceStatusConfirmado(),
        );

        if (!avaliacao.permitido) {
            return recusar(avaliacao.motivo);
        }

        await this.agenda.confirmar(externo, this.catalogo.indiceStatusConfirmado());

        agendamento.confirmar(externo.ultimaEdicao);
        await this.agendamentos.salvar(agendamento);

        await this.crm.notificarConfirmacao(comando.dealId, telefone);

        this.logger.info(
            { deal_id: comando.dealId, id_agendamento: comando.idAgendamentoMedx },
            'agendamento confirmado no MedX',
        );
    }
}
