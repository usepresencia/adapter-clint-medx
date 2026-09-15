import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { LoggerMinimo } from "../../../../lib/logger.js";
import type { FilaPort, JobAdapter } from "../../application/ports/fila.port.js";
import type { EventoRepositorio } from "../../domain/evento/evento.repositorio.js";
import { schemaAgendamento, schemaResposta } from "./schemas.js";

export interface Saude {
  redis: boolean;
  banco: boolean;
  medx: boolean;
}

export interface DepsServidor {
  segredo: string;
  eventos: EventoRepositorio;
  fila: FilaPort;
  verificarSaude: () => Promise<Saude>;
  logger: LoggerMinimo;
}

const OK = { ok: true } as const;

export function criarServidor(deps: DepsServidor): FastifyInstance {
  const app = Fastify({ logger: false });

  // Nada sai deste servidor com status de erro: o Clint desativa o webhook
  // após três falhas consecutivas. Erro é sinalizado por log e alerta.
  app.setErrorHandler((erro: Error, _requisicao, resposta) => {
    deps.logger.error({ erro: erro.message }, "erro não tratado no webhook");
    void resposta.status(200).send(OK);
  });

  function autorizado(requisicao: FastifyRequest): boolean {
    return requisicao.headers["x-adapter-secret"] === deps.segredo;
  }

  async function receber(
    requisicao: FastifyRequest,
    resposta: FastifyReply,
    endpoint: string,
    montarJob: (payload: unknown) => { ok: true; job: JobAdapter } | { ok: false; motivo: string }
  ): Promise<FastifyReply> {
    if (!autorizado(requisicao)) {
      deps.logger.warn({ endpoint }, "webhook recusado por segredo inválido");
      return resposta.status(200).send(OK);
    }

    const evento = deps.eventos.registrar(endpoint, requisicao.body);
    const resultado = montarJob(requisicao.body);

    if (!resultado.ok) {
      evento.marcarInvalido(resultado.motivo);
      deps.eventos.salvar(evento);
      deps.logger.warn({ evento_id: evento.id, endpoint }, "payload inválido");
      return resposta.status(200).send(OK);
    }

    try {
      const criado = await deps.fila.add(resultado.job.tipo, {
        ...resultado.job,
        eventoId: evento.id,
      });
      if (criado.id) {
        evento.associarJob(criado.id);
        deps.eventos.salvar(evento);
      }
    } catch (erro) {
      evento.marcarFalha(`não foi possível enfileirar: ${(erro as Error).message}`);
      deps.eventos.salvar(evento);
      deps.logger.error(
        { alerta: true, evento_id: evento.id },
        "fila indisponível — evento gravado para reprocessar"
      );
    }

    return resposta.status(200).send(OK);
  }

  app.post("/webhooks/clint/agendamento", (requisicao, resposta) =>
    receber(requisicao, resposta, "/webhooks/clint/agendamento", (payload) => {
      const validado = schemaAgendamento.safeParse(payload);
      if (!validado.success) {
        return { ok: false, motivo: validado.error.issues.map((i) => i.path.join(".")).join(", ") };
      }
      const p = validado.data;
      return {
        ok: true,
        job: {
          tipo: "agendamento",
          eventoId: 0,
          comando: {
            dealId: p.deal_id,
            nome: p.nome,
            telefone: p.telefone,
            dataNascimento: p.data_nascimento,
            dataHora: p.data_hora,
            profissional: p.profissional,
            tipoConsulta: p.tipo_consulta,
            cpf: p.cpf,
            email: p.email,
            sexo: p.sexo,
          },
        },
      };
    })
  );

  app.post("/webhooks/clint/resposta-lembrete", (requisicao, resposta) =>
    receber(requisicao, resposta, "/webhooks/clint/resposta-lembrete", (payload) => {
      const validado = schemaResposta.safeParse(payload);
      if (!validado.success) {
        return { ok: false, motivo: validado.error.issues.map((i) => i.path.join(".")).join(", ") };
      }
      const p = validado.data;
      return {
        ok: true,
        job: {
          tipo: "resposta",
          eventoId: 0,
          comando: {
            dealId: p.deal_id,
            idAgendamentoMedx: p.id_agendamento_medx,
            resposta: p.resposta,
          },
        },
      };
    })
  );

  app.get("/health", async (_requisicao, resposta) => {
    const saude = await deps.verificarSaude();
    const tudoOk = saude.redis && saude.banco && saude.medx;
    return resposta.status(tudoOk ? 200 : 503).send(saude);
  });

  app.setNotFoundHandler((requisicao, resposta) => {
    deps.logger.warn(
      { alerta: true, metodo: requisicao.method, url: requisicao.url },
      "webhook chegou em rota inexistente — conferir a configuração no Clint"
    );
    return resposta.status(200).send(OK);
  });

  return app;
}
