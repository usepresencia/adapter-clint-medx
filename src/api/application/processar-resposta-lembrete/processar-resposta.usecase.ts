import type { LoggerMinimo } from "../../../../lib/logger.js";
import type { AgendamentoRepositorio } from "../../domain/agendamento/agendamento.repositorio.js";
import { RespostaLembrete } from "../../domain/agendamento/resposta-lembrete.js";
import type { AgendaMedicaPort } from "../ports/agenda-medica.port.js";
import type { CatalogoClinicoPort } from "../ports/catalogo-clinico.port.js";
import type { CrmPort } from "../ports/crm.port.js";
import type { ComandoResposta } from "./processar-resposta.comando.js";

export interface DepsProcessarResposta {
  agendamentos: AgendamentoRepositorio;
  agenda: AgendaMedicaPort;
  catalogo: CatalogoClinicoPort;
  crm: CrmPort;
  logger: LoggerMinimo;
}

export function criarProcessarResposta(deps: DepsProcessarResposta) {
  return async function processarResposta(comando: ComandoResposta): Promise<void> {
    const resposta = RespostaLembrete.criar(comando.resposta);

    if (resposta.exigeAtendimentoHumano) {
      if (resposta.valor === "reagendar") {
        await deps.crm.notificarReagendamento(comando.dealId);
      } else {
        await deps.crm.notificarCancelamento(comando.dealId);
      }
      deps.logger.info(
        { deal_id: comando.dealId, resposta: resposta.valor },
        "resposta do paciente encaminhada para atendimento humano"
      );
      return;
    }

    const agendamento = deps.agendamentos.buscarPorDeal(comando.dealId);

    async function recusar(motivo: string): Promise<void> {
      agendamento?.marcarConflito();
      if (agendamento) deps.agendamentos.salvar(agendamento);

      deps.logger.warn(
        { alerta: true, deal_id: comando.dealId, id_agendamento: comando.idAgendamentoMedx, motivo },
        "confirmação recusada"
      );
      await deps.crm.notificarConflito(comando.dealId, motivo);
    }

    if (!agendamento) {
      return recusar("adapter não tem registro deste agendamento");
    }

    if (agendamento.jaFoiConfirmado) {
      deps.logger.info({ deal_id: comando.dealId }, "agendamento já estava confirmado");
      return;
    }

    if (agendamento.idMedx !== comando.idAgendamentoMedx) {
      return recusar("id de agendamento informado pelo CRM não confere com o registro local");
    }

    const externo = await deps.agenda.obter(comando.idAgendamentoMedx);

    const avaliacao = agendamento.avaliarConfirmacao(
      { status: externo.status, inicio: externo.inicio },
      deps.catalogo.indiceStatusConfirmado()
    );

    if (!avaliacao.permitido) {
      return recusar(avaliacao.motivo);
    }

    await deps.agenda.confirmar(externo, deps.catalogo.indiceStatusConfirmado());

    agendamento.confirmar(externo.ultimaEdicao);
    deps.agendamentos.salvar(agendamento);

    await deps.crm.notificarConfirmacao(comando.dealId);

    deps.logger.info(
      { deal_id: comando.dealId, id_agendamento: comando.idAgendamentoMedx },
      "agendamento confirmado no MedX"
    );
  };
}
