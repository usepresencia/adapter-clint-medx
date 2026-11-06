import { DateTime } from 'luxon';
import { ErroDeDominio } from '../shared/erros';
import { ehFimDeSemana, proximoDiaUtil } from './dia-util';
import { FORMATO_MEDX, FUSO_CLINICA } from './periodo-consulta';

const HORAS_APOS_CONSULTA = 2;
const HORA_LIMITE_NOITE = 18;
const HORA_REABERTURA = 8;

/**
 * Horário em que checamos no MedX se a paciente compareceu: 2h após o início
 * da consulta — ou, se isso cair às 18h ou depois (fora do horário
 * comercial) ou em fim de semana (consulta excepcional de sábado/domingo),
 * às 8h do próximo dia útil.
 */
export function calcularHorarioChecagemComparecimento(inicioConsultaIso: string): string {
    const inicioConsulta = DateTime.fromISO(inicioConsultaIso, { zone: FUSO_CLINICA });
    if (!inicioConsulta.isValid) {
        throw new ErroDeDominio(`Início da consulta é uma data inválida: ${inicioConsultaIso}`);
    }

    const candidato = inicioConsulta.plus({ hours: HORAS_APOS_CONSULTA });
    if (candidato.hour < HORA_LIMITE_NOITE && !ehFimDeSemana(candidato)) {
        return candidato.toFormat(FORMATO_MEDX);
    }

    const diaBase =
        candidato.hour >= HORA_LIMITE_NOITE
            ? candidato.plus({ days: 1 }).startOf('day')
            : candidato.startOf('day');

    const proximoDia = proximoDiaUtil(diaBase);
    return proximoDia.plus({ hours: HORA_REABERTURA }).toFormat(FORMATO_MEDX);
}
