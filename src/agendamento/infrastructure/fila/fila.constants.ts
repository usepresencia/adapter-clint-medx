import type { JobsOptions } from 'bullmq';

export const NOME_FILA = 'adapter-clint-medx';

/** Abaixo do teto de 30/min do MedX, com margem para chamadas manuais na mesma conta. */
export const LIMITER = { max: 25, duration: 60_000 } as const;

export const OPCOES_JOB: JobsOptions & { backoff: { type: string; delay: number } } = {
    attempts: 6,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: false,
};
