import type { FastifyInstance } from "fastify";
import type { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import nodemailer from "nodemailer";

import type { Env } from "../../../lib/config/env.server.js";
import { criarLogger } from "../../../lib/logger.js";

import type { JobAdapter } from "../application/ports/fila.port.js";
import type { NotificadorPort } from "../application/ports/notificador.port.js";
import { criarAgendarConsulta } from "../application/agendar-consulta/agendar-consulta.usecase.js";
import { criarProcessarResposta } from "../application/processar-resposta-lembrete/processar-resposta.usecase.js";

import { abrirBanco } from "../infrastructure/persistencia/sqlite/conexao.js";
import { criarAgendamentoRepositorio } from "../infrastructure/persistencia/sqlite/agendamento.sqlite-repositorio.js";
import { criarCorrelacaoPacienteRepositorio } from "../infrastructure/persistencia/sqlite/correlacao-paciente.sqlite-repositorio.js";
import { criarEventoRepositorio } from "../infrastructure/persistencia/sqlite/evento.sqlite-repositorio.js";
import { criarTokenProvider } from "../infrastructure/medx/medx-token.provider.js";
import { criarMedxClient } from "../infrastructure/medx/medx-http.client.js";
import { criarCatalogoMedx } from "../infrastructure/medx/medx-catalogo.adapter.js";
import { criarCadastroPacienteMedx } from "../infrastructure/medx/medx-cadastro-paciente.adapter.js";
import { criarAgendaMedx } from "../infrastructure/medx/medx-agenda.adapter.js";
import { criarCrmWebhookClint } from "../infrastructure/clint/clint-webhook.adapter.js";
import { criarFila, criarWorker } from "../infrastructure/fila/fila.js";
import { envolverComAlertas, NOTIFICADOR_SILENCIOSO } from "../infrastructure/observabilidade/alertas.js";
import { criarNotificadorEmail } from "../infrastructure/observabilidade/notificador-email.js";

import { criarServidor } from "../presentation/http/servidor.js";

export interface Aplicacao {
  app: FastifyInstance;
  fila: Queue<JobAdapter>;
  worker: Worker<JobAdapter>;
  expurgar(): number;
  encerrar(): Promise<void>;
}

export function escolherNotificador(env: Env): NotificadorPort {
  if (!env.SMTP_URL || !env.ALERTA_EMAIL_DESTINO) {
    return NOTIFICADOR_SILENCIOSO;
  }

  return criarNotificadorEmail({
    destino: env.ALERTA_EMAIL_DESTINO,
    enviarEmail: async (para, assunto, corpo) => {
      const transporte = nodemailer.createTransport(env.SMTP_URL!);
      await transporte.sendMail({
        from: env.ALERTA_EMAIL_ORIGEM,
        to: para,
        subject: assunto,
        text: corpo,
      });
    },
  });
}

export async function montarAplicacao(env: Env): Promise<Aplicacao> {
  const loggerBase = criarLogger(env);
  const notificador = escolherNotificador(env);
  const logger = envolverComAlertas(loggerBase, notificador);

  if (notificador === NOTIFICADOR_SILENCIOSO) {
    loggerBase.warn({}, "SMTP não configurado — alertas ficarão apenas no log");
  }

  // Persistência
  const db = abrirBanco(env.DATABASE_PATH);
  const agendamentos = criarAgendamentoRepositorio(db);
  const correlacoes = criarCorrelacaoPacienteRepositorio(db);
  const eventos = criarEventoRepositorio(db);

  // MedX
  const tokens = criarTokenProvider({
    host: env.MEDX_HOST,
    integrationToken: env.MEDX_INTEGRATION_TOKEN,
  });
  const medx = criarMedxClient({ host: env.MEDX_HOST, tokens });
  const catalogo = criarCatalogoMedx(medx);
  const cadastro = criarCadastroPacienteMedx(medx);
  const agenda = criarAgendaMedx(medx);

  // Falha cedo e alto se o rótulo de confirmação não existir nesta conta.
  await catalogo.carregar();
  loggerBase.info(
    { indice_confirmado: catalogo.indiceStatusConfirmado() },
    "catálogo do MedX carregado"
  );

  // Clint
  const crm = criarCrmWebhookClint({
    urlAgendamento: env.CLINT_WEBHOOK_AGENDAMENTO_URL,
    urlNotificacao: env.CLINT_WEBHOOK_NOTIFICACAO_URL,
  });

  // Casos de uso
  const agendarConsulta = criarAgendarConsulta({
    agendamentos, correlacoes, cadastro, agenda, catalogo, crm, logger,
  });
  const processarResposta = criarProcessarResposta({
    agendamentos, agenda, catalogo, crm, logger,
  });

  // Fila
  const conexao = { url: env.REDIS_URL };
  const fila = criarFila(conexao);
  const worker = criarWorker({ eventos, agendarConsulta, processarResposta, logger }, conexao);

  worker.on("failed", (job, erro) => {
    const tentativas = job?.attemptsMade ?? 0;
    const maximo = job?.opts.attempts ?? 0;
    if (tentativas >= maximo) {
      logger.error(
        { alerta: true, job_id: job?.id, tentativas, erro: erro.message },
        "job esgotou as tentativas e foi para a dead letter"
      );
    }
  });

  // HTTP
  const redisSaude = new IORedis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });

  const app = criarServidor({
    segredo: env.ADAPTER_SECRET,
    eventos,
    fila,
    logger,
    verificarSaude: async () => ({
      redis: await redisSaude.ping().then(() => true).catch(() => false),
      banco: (() => {
        try {
          db.prepare("SELECT 1").get();
          return true;
        } catch {
          return false;
        }
      })(),
      medx: await tokens.obterToken().then(() => true).catch(() => false),
    }),
  });

  return {
    app,
    fila,
    worker,
    expurgar: () => {
      const removidos = eventos.expurgar(env.RETENCAO_DIAS);
      if (removidos > 0) loggerBase.info({ removidos }, "expurgo de eventos antigos");
      return removidos;
    },
    encerrar: async () => {
      await worker.close();
      await fila.close();
      await app.close();
      redisSaude.disconnect();
      db.close();
    },
  };
}
