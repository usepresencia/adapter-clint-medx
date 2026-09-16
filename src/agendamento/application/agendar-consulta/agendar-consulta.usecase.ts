import { Inject, Injectable } from '@nestjs/common';
import { Agendamento } from '../../domain/agendamento/agendamento';
import { PeriodoConsulta } from '../../domain/agendamento/periodo-consulta';
import type { AgendamentoRepositorio } from '../../domain/agendamento/agendamento.repositorio';
import { CorrelacaoPaciente } from '../../domain/paciente/correlacao-paciente';
import type { CorrelacaoPacienteRepositorio } from '../../domain/paciente/correlacao-paciente.repositorio';
import { Cpf } from '../../domain/paciente/cpf';
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

        if (registrado?.jaFoiCriado) {
            this.logger.info(
                { deal_id: comando.dealId, id_agendamento: registrado.idMedx },
                'agendamento já existia, nada a fazer',
            );
            return;
        }

        const houveTentativaAnterior = registrado?.tentativaInterrompida ?? false;

        const telefone = Telefone.criar(comando.telefone);
        const idPaciente = await this.resolverPaciente(comando, telefone);

        const idProfissional = await this.catalogo.resolverProfissional(comando.profissional);
        const tipo = await this.catalogo.resolverTipoConsulta(comando.tipoConsulta);
        const periodo = PeriodoConsulta.criar(comando.dataHora, tipo.duracaoMinutos);

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

        const cpf = Cpf.tentarCriar(comando.cpf);
        if (!cpf && comando.cpf) {
            this.logger.warn(
                { deal_id: comando.dealId },
                'CPF recebido do CRM é inválido — ignorado',
            );
        }

        const enriquecimento = {
            ...(cpf ? { cpf } : {}),
            ...(comando.cidade ? { cidade: comando.cidade } : {}),
            ...(comando.endereco ? { endereco: comando.endereco } : {}),
            ...(comando.cep ? { cep: comando.cep } : {}),
        };

        if (Object.keys(enriquecimento).length > 0) {
            try {
                await this.cadastro.enriquecerFicha(idPaciente, enriquecimento);
            } catch (erro) {
                this.logger.warn(
                    { deal_id: comando.dealId, erro: (erro as Error).message },
                    'não foi possível enriquecer a ficha do paciente no MedX',
                );
            }
        }

        await this.crm.gravarIdAgendamento(comando.dealId, agendamento.idMedx!);

        this.logger.info(
            { deal_id: comando.dealId, id_agendamento: agendamento.idMedx },
            'agendamento criado no MedX',
        );
    }
}
