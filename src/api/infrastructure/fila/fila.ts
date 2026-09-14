import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import type { JobAdapter } from "../../application/ports/fila.port.js";
import { ErroRateLimit } from "../medx/medx.erros.js";
import { processarJob, type DepsProcessador } from "./processador.js";

export type { DepsProcessador };

export const NOME_FILA = "adapter-clint-medx";

/** Abaixo do teto de 30/min do MedX, com margem para chamadas manuais na mesma conta. */
export const LIMITER = { max: 25, duration: 60_000 } as const;

export const OPCOES_JOB: JobsOptions & { backoff: { type: string; delay: number } } = {
  attempts: 6,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: false,
};

export function criarFila(conexao: ConnectionOptions): Queue<JobAdapter> {
  return new Queue<JobAdapter>(NOME_FILA, {
    connection: conexao,
    defaultJobOptions: OPCOES_JOB,
  });
}

export function criarWorker(deps: DepsProcessador, conexao: ConnectionOptions): Worker<JobAdapter> {
  const worker = new Worker<JobAdapter>(
    NOME_FILA,
    async (job) => processarJob(deps, job.data),
    { connection: conexao, concurrency: 1, limiter: { ...LIMITER } }
  );

  worker.on("failed", (_job, erro) => {
    if (erro instanceof ErroRateLimit) {
      void worker.rateLimit(erro.esperarSegundos * 1000);
    }
  });

  return worker;
}
