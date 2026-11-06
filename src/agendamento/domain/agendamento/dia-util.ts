import { DateTime } from 'luxon';

const SABADO = 6;
const DOMINGO = 7;

/** Verdadeiro quando a data cai em sábado ou domingo. */
export function ehFimDeSemana(dt: DateTime): boolean {
    return dt.weekday === SABADO || dt.weekday === DOMINGO;
}

/** Empurra sábado/domingo para a segunda-feira seguinte, mesma hora do dia. */
export function proximoDiaUtil(dt: DateTime): DateTime {
    if (dt.weekday === SABADO) return dt.plus({ days: 2 });
    if (dt.weekday === DOMINGO) return dt.plus({ days: 1 });
    return dt;
}

/** Volta sábado/domingo para a sexta-feira anterior, mesma hora do dia. */
export function diaUtilAnterior(dt: DateTime): DateTime {
    if (dt.weekday === DOMINGO) return dt.minus({ days: 2 });
    if (dt.weekday === SABADO) return dt.minus({ days: 1 });
    return dt;
}
