import type { DateTime } from 'luxon';

export const RELOGIO_PORT = Symbol('Relogio');

export interface Relogio {
    /** Agora, no fuso da clínica. */
    agora(): DateTime;
}
