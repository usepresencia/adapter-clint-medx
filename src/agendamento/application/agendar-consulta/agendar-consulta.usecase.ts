import { Inject, Injectable } from '@nestjs/common';
import { Agendamento } from '../../domain/agendamento/agendamento';
import { PeriodoConsulta } from '../../domain/agendamento/periodo-consulta';
import type { AgendamentoRepositorio } from '../../domain/agendamento/agendamento.repositorio';
import { CorrelacaoPaciente } from '../../domain/paciente/correlacao-paciente';
import type { CorrelacaoPacienteRepositorio } from '../../domain/paciente/correlacao-paciente.repositorio';
import { Telefone } from '../../domain/paciente/telefone';
import { AGENDA_MEDICA_PORT, type AgendaMedicaPort } from '../ports/agenda-medica.port';
import { CADASTRO_PACIENTE_PORT, type CadastroPacientePort } from '../ports/cadastro-paciente.port';
import { CATALOGO_CLINICO_PORT, type CatalogoClinicoPort } from '../ports/catalogo-clinico.port';
import { CRM_PORT, type CrmPort } from '../ports/crm.port';
import { LOGGER_PORT, type LoggerMinimo } from '../ports/logger.port';
import {
    AGENDAMENTO_REPOSITORIO,
    CORRELACAO_PACIENTE_REPOSITORIO,
} from '../../../shared/persistence/persistence.module';
import type { ComandoAgendamento } from './agendar-consulta.comando';

@Injectable()
export class AgendarConsultaUseCase {
    constructor(
        @Inject(AGENDAMENTO_REPOSITORIO) private readonly agendamentos: AgendamentoRepositorio,
        @Inject(CORRELACAO_PACIENTE_REPOSITORIO)
        private readonly correlacoes: CorrelacaoPacienteRepositorio,
        @Inject(CADASTRO_PACIENTE_PORT) private readonly cadastro: CadastroPacientePort,
        @Inject(AGENDA_MEDICA_PORT) private readonly agenda: AgendaMedicaPort,
        @Inject(CATALOGO_CLINICO_PORT) private readonly catalogo: CatalogoClinicoPort,
        @Inject(CRM_PORT) private readonly crm: CrmPort,
        @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
    ) {}

    private async resolverPaciente(
        comando: ComandoAgendamento,
        telefone: Telefone,
    ): Promise<number> {
        const emCache = await this.correlacoes.buscarPorTelefone(telefone);
        if (emCache) return emCache.idPacienteMedx;

        const vinculo = await this.cadastro.vincular({
            nome: comando.nome,
            telefone,
            dataNascimento: comando.dataNascimento,
            email: comando.email,
            sexo: comando.sexo,
        });

        const correlacao = CorrelacaoPaciente.criar({
            telefone,
            idPacienteMedx: vinculo.idPaciente,
            matchConfiavel: vinculo.matchConfiavel,
            idContatoClint: null,
        });
        await this.correlacoes.salvar(correlacao);

        if (correlacao.exigeRevisao) {
            this.logger.warn(
                { alerta: true, deal_id: comando.dealId, id_paciente: correlacao.idPacienteMedx },
                'vínculo de paciente com match não confiável — revisar manualmente',
            );
        }

        return correlacao.idPacienteMedx;
    }

    async executar(comando: ComandoAgendamento): Promise<void> {
        const registrado = await this.agendamentos.buscarPorDeal(comando.dealId);
        const telefone = Telefone.criar(comando.telefone);

        if (registrado?.jaFoiCriado) {
            // Reenvia o id ao CRM mesmo já tendo sido criado: um reprocessamento
            // (retry do Clint, fila reentregando o job) não pode deixar o CRM sem
            // o id só porque nós já sabíamos dele.
            await this.crm.gravarIdAgendamento(comando.dealId, registrado.idMedx!, telefone);
            this.logger.info(
                { deal_id: comando.dealId, id_agendamento: registrado.idMedx },
                'agendamento já existia, id reenviado ao CRM',
            );
            return;
        }

        const houveTentativaAnterior = registrado?.tentativaInterrompida ?? false;
        const idPaciente = await this.resolverPaciente(comando, telefone);

        const idProfissional = await this.catalogo.resolverProfissional(comando.profissional);
        const tipo = await this.catalogo.resolverTipoConsulta(comando.tipoConsulta);
        const duracaoMinutos = tipo.duracaoMinutos ?? comando.duracaoConsulta;
        const periodo = PeriodoConsulta.criar(comando.dataHora, duracaoMinutos as number);

        const agendamento = Agendamento.iniciar({
            dealId: comando.dealId,
            idPacienteMedx: idPaciente,
            idProfissionalMedx: idProfissional,
            periodo,
        });

        // Grava a intenção antes de chamar o MedX: um retry interrompido precisa
        // encontrar rastro para não criar consulta duplicada.
        await this.agendamentos.salvar(agendamento);

        let orfao: number | undefined;

        if (houveTentativaAnterior) {
            const daAgenda = await this.agenda.listarPorPaciente(idPaciente);
            const gemeo = daAgenda.find(
                a => a.idProfissional === idProfissional && periodo.comecaEm(a.inicio),
            );
            if (gemeo) {
                orfao = gemeo.id;
                this.logger.warn(
                    { deal_id: comando.dealId, id_agendamento: orfao },
                    'agendamento já existia no MedX de uma tentativa anterior — adotado',
                );
            }
        }

        if (orfao !== undefined) {
            agendamento.adotarExistente(orfao);
        } else {
            try {
                const idCriado = await this.agenda.criar(
                    {
                        idProfissional,
                        idPaciente,
                        inicio: periodo.inicio,
                        fim: periodo.fim,
                        descricao: `${tipo.nome} — ${comando.nome}`,
                        idTipoConsulta: tipo.id,
                    },
                    this.catalogo.indiceStatusAgendado(),
                );
                agendamento.registrarCriacao(idCriado);
            } catch (erro) {
                agendamento.marcarFalha();
                await this.agendamentos.salvar(agendamento);
                throw erro;
            }
        }

        await this.agendamentos.salvar(agendamento);

        // enriquecerFicha() está desligado: o PUT /contatos do MedX exige ~44
        // campos obrigatórios pra qualquer atualização parcial (confirmado ao
        // vivo, contradiz a própria doc) — toda chamada falhava com HTTP 400.
        // Religar quando o MedX corrigir a API.

        await this.crm.gravarIdAgendamento(comando.dealId, agendamento.idMedx!, telefone);

        this.logger.info(
            { deal_id: comando.dealId, id_agendamento: agendamento.idMedx },
            'agendamento criado no MedX',
        );
    }
}
