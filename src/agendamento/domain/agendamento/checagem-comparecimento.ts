import { DateTime } from 'luxon';
import { ErroDeDominio } from '../shared/erros';
import { FORMATO_MEDX, FUSO_CLINICA } from './periodo-consulta';

const HORAS_APOS_CONSULTA = 2;
const HORA_LIMITE_NOITE = 18;
const HORA_REABERTURA = 8;
const SABADO = 6;
const DOMINGO = 7;

/** Empurra sábado/domingo para a segunda-feira seguinte, mesma hora do dia. */
function adiarFimDeSemana(dt: DateTime): DateTime {
    if (dt.weekday === SABADO) return dt.plus({ days: 2 });
    if (dt.weekday === DOMINGO) return dt.plus({ days: 1 });
    return dt;
}

/**
 * Horário em que checamos no MedX se a paciente compareceu: 2h após o início
 * da consulta — ou, se isso cair às 18h ou depois (fora do horário
 * comercial), às 8h do próximo dia útil (adiando sábado/domingo para segunda).
 */
export function calcularHorarioChecagemComparecimento(inicioConsultaIso: string): string {
    const inicioConsulta = DateTime.fromISO(inicioConsultaIso, { zone: FUSO_CLINICA });
    if (!inicioConsulta.isValid) {
        throw new ErroDeDominio(`Início da consulta é uma data inválida: ${inicioConsultaIso}`);
    }

    const candidato = inicioConsulta.plus({ hours: HORAS_APOS_CONSULTA });
    if (candidato.hour < HORA_LIMITE_NOITE) {
        return candidato.toFormat(FORMATO_MEDX);
    }

    const proximoDia = adiarFimDeSemana(candidato.plus({ days: 1 }).startOf('day'));
    return proximoDia.plus({ hours: HORA_REABERTURA }).toFormat(FORMATO_MEDX);
}
