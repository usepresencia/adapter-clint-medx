import type { LoggerMinimo } from "../../../../lib/logger.js";
import { Agendamento } from "../../domain/agendamento/agendamento.js";
import { PeriodoConsulta } from "../../domain/agendamento/periodo-consulta.js";
import type { AgendamentoRepositorio } from "../../domain/agendamento/agendamento.repositorio.js";
import { CorrelacaoPaciente } from "../../domain/paciente/correlacao-paciente.js";
import type { CorrelacaoPacienteRepositorio } from "../../domain/paciente/correlacao-paciente.repositorio.js";
import { Cpf } from "../../domain/paciente/cpf.js";
import { Telefone } from "../../domain/paciente/telefone.js";
import type { AgendaMedicaPort } from "../ports/agenda-medica.port.js";
import type { CadastroPacientePort } from "../ports/cadastro-paciente.port.js";
import type { CatalogoClinicoPort } from "../ports/catalogo-clinico.port.js";
import type { CrmPort } from "../ports/crm.port.js";
import type { ComandoAgendamento } from "./agendar-consulta.comando.js";

export interface DepsAgendarConsulta {
  agendamentos: AgendamentoRepositorio;
  correlacoes: CorrelacaoPacienteRepositorio;
  cadastro: CadastroPacientePort;
  agenda: AgendaMedicaPort;
  catalogo: CatalogoClinicoPort;
  crm: CrmPort;
  logger: LoggerMinimo;
}

export function criarAgendarConsulta(deps: DepsAgendarConsulta) {
  async function resolverPaciente(
    comando: ComandoAgendamento,
    telefone: Telefone
  ): Promise<number> {
    const emCache = deps.correlacoes.buscarPorTelefone(telefone);
    if (emCache) return emCache.idPacienteMedx;

    const vinculo = await deps.cadastro.vincular({
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
    deps.correlacoes.salvar(correlacao);

    if (correlacao.exigeRevisao) {
      deps.logger.warn(
        { alerta: true, deal_id: comando.dealId, id_paciente: correlacao.idPacienteMedx },
        "vínculo de paciente com match não confiável — revisar manualmente"
      );
    }

    return correlacao.idPacienteMedx;
  }

  return async function agendarConsulta(comando: ComandoAgendamento): Promise<void> {
    const registrado = deps.agendamentos.buscarPorDeal(comando.dealId);

    if (registrado?.jaFoiCriado) {
      deps.logger.info(
        { deal_id: comando.dealId, id_agendamento: registrado.idMedx },
        "agendamento já existia, nada a fazer"
      );
      return;
    }

    const houveTentativaAnterior = registrado?.tentativaInterrompida ?? false;

    const telefone = Telefone.criar(comando.telefone);
    const idPaciente = await resolverPaciente(comando, telefone);

    const idProfissional = await deps.catalogo.resolverProfissional(comando.profissional);
    const tipo = await deps.catalogo.resolverTipoConsulta(comando.tipoConsulta);
    const periodo = PeriodoConsulta.criar(comando.dataHora, tipo.duracaoMinutos);

    const agendamento = Agendamento.iniciar({
      dealId: comando.dealId,
      idPacienteMedx: idPaciente,
      idProfissionalMedx: idProfissional,
      periodo,
    });

    // Grava a intenção antes de chamar o MedX: um retry interrompido precisa
    // encontrar rastro para não criar consulta duplicada.
    deps.agendamentos.salvar(agendamento);

    let orfao: number | undefined;

    if (houveTentativaAnterior) {
      const daAgenda = await deps.agenda.listarPorPaciente(idPaciente);
      const gemeo = daAgenda.find(
        (a) => a.idProfissional === idProfissional && periodo.comecaEm(a.inicio)
      );
      if (gemeo) {
        orfao = gemeo.id;
        deps.logger.warn(
          { deal_id: comando.dealId, id_agendamento: orfao },
          "agendamento já existia no MedX de uma tentativa anterior — adotado"
        );
      }
    }

    if (orfao !== undefined) {
      agendamento.adotarExistente(orfao);
    } else {
      try {
        const idCriado = await deps.agenda.criar({
          idProfissional,
          idPaciente,
          inicio: periodo.inicio,
          fim: periodo.fim,
          descricao: `${tipo.nome} — ${comando.nome}`,
          idTipoConsulta: tipo.id,
        });
        agendamento.registrarCriacao(idCriado);
      } catch (erro) {
        agendamento.marcarFalha();
        deps.agendamentos.salvar(agendamento);
        throw erro;
      }
    }

    deps.agendamentos.salvar(agendamento);

    const cpf = Cpf.tentarCriar(comando.cpf);
    if (cpf) {
      try {
        await deps.cadastro.registrarCpf(idPaciente, cpf);
      } catch (erro) {
        deps.logger.warn(
          { deal_id: comando.dealId, erro: (erro as Error).message },
          "não foi possível gravar o CPF na ficha do MedX"
        );
      }
    } else if (comando.cpf) {
      deps.logger.warn({ deal_id: comando.dealId }, "CPF recebido do CRM é inválido — ignorado");
    }

    await deps.crm.gravarIdAgendamento(comando.dealId, agendamento.idMedx!);

    deps.logger.info(
      { deal_id: comando.dealId, id_agendamento: agendamento.idMedx },
      "agendamento criado no MedX"
    );
  };
}
