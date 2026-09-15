import { Worker } from "bullmq";
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

export async function processarJob(
  deps: DepsProcessador,
  dados: JobAdapter,
  worker: Pick<Worker, "rateLimit">
): Promise<void> {
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
    if (erro instanceof ErroRateLimit) {
      // Um 429 não é falha real do job: devolve o job para "wait" respeitando
      // o Retry-After do MedX, sem consumir tentativa nem poluir a auditoria
      // com um evento que não falhou de verdade.
      deps.logger.warn(
        { evento_id: dados.eventoId, esperar: erro.esperarSegundos },
        "rate limit do MedX — job devolvido para a fila sem consumir tentativa"
      );
      await worker.rateLimit(erro.esperarSegundos * 1000);
      throw Worker.RateLimitError();
    }

    const mensagem = erro instanceof Error ? erro.message : String(erro);

    evento.marcarFalha(mensagem);
    deps.eventos.salvar(evento);

    deps.logger.error({ evento_id: dados.eventoId, erro: mensagem }, "job falhou");

    throw erro;
  }
}
