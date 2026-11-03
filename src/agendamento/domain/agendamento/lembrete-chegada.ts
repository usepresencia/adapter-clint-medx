import { DateTime } from 'luxon';
import { ErroDeDominio } from '../shared/erros';
import { diaUtilAnterior, ehFimDeSemana } from './dia-util';
import { FORMATO_MEDX, FUSO_CLINICA } from './periodo-consulta';

const ANTECEDENCIA_HORAS = 2;
const HORA_MINIMA_ENVIO = 8;
const HORA_ENVIO_VESPERA = 18;

/**
 * Horário de envio do lembrete de chegada: 2h antes da consulta, ou, se isso
 * cair antes das 8h (fora do horário de atendimento) ou em fim de semana
 * (consulta excepcional de sábado/domingo), às 18h do último dia útil
 * anterior à consulta.
 */
export function calcularHorarioLembreteChegada(inicioConsultaIso: string): string {
    const inicioConsulta = DateTime.fromISO(inicioConsultaIso, { zone: FUSO_CLINICA });
    if (!inicioConsulta.isValid) {
        throw new ErroDeDominio(`Início da consulta é uma data inválida: ${inicioConsultaIso}`);
    }

    const candidato = inicioConsulta.minus({ hours: ANTECEDENCIA_HORAS });
    const aberturaDoDia = inicioConsulta.startOf('day').plus({ hours: HORA_MINIMA_ENVIO });
    const foraDoExpediente = candidato < aberturaDoDia || ehFimDeSemana(candidato);

    const resultado = foraDoExpediente
        ? diaUtilAnterior(inicioConsulta.startOf('day').minus({ days: 1 })).plus({
              hours: HORA_ENVIO_VESPERA,
          })
        : candidato;

    return resultado.toFormat(FORMATO_MEDX);
}
