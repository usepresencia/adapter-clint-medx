import type { LoggerMinimo } from "../../../../lib/logger.js";
import type { ComandoAgendamento } from "../../application/agendar-consulta/agendar-consulta.comando.js";
import type { ComandoResposta } from "../../application/processar-resposta-lembrete/processar-resposta.comando.js";
import type { JobAdapter } from "../../application/ports/fila.port.js";
import type { EventoRepositorio } from "../../domain/evento/evento.repositorio.js";
import { ErroRateLimit } from "../medx/medx.erros.js";

export interface DepsProcessador {
  eventos: EventoRepositorio;
  agendarConsulta: (comando: ComandoAgendamento) => Promise<void>;
  processarResposta: (comando: ComandoResposta) => Promise<void>;
  logger: LoggerMinimo;
}

export async function processarJob(deps: DepsProcessador, dados: JobAdapter): Promise<void> {
  const evento = deps.eventos.registrarExistente(dados.eventoId);

  try {
    if (dados.tipo === "agendamento") {
      await deps.agendarConsulta(dados.comando);
    } else {
      await deps.processarResposta(dados.comando);
    }

    evento.marcarProcessado();
    deps.eventos.salvar(evento);

    deps.logger.info({ evento_id: dados.eventoId, tipo: dados.tipo }, "job processado");
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);

    evento.marcarFalha(mensagem);
    deps.eventos.salvar(evento);

    if (erro instanceof ErroRateLimit) {
      deps.logger.warn(
        { evento_id: dados.eventoId, esperar: erro.esperarSegundos },
        "rate limit do MedX — job será repetido"
      );
    } else {
      deps.logger.error({ evento_id: dados.eventoId, erro: mensagem }, "job falhou");
    }

    throw erro;
  }
}
