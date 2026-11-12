import { DateTime } from 'luxon';
import { ErroDeDominio } from '../shared/erros';
import { diaUtilAnterior, ehFimDeSemana } from './dia-util';
import { FORMATO_MEDX, FUSO_CLINICA } from './periodo-consulta';

const ANTECEDENCIA_HORAS = 2;
const HORA_MINIMA_ENVIO = 8;
const HORA_ENVIO_MADRUGADA = 6;
const HORA_ENVIO_VESPERA = 18;

/**
 * Horário de envio do lembrete de chegada: 2h antes da consulta. Se isso cair
 * antes das 8h, sai às 6h do próprio dia da consulta. Vai para as 18h do
 * último dia útil anterior quando a consulta é em fim de semana (excepcional)
 * ou é às 6h ou antes (o aviso das 6h chegaria depois dela).
 */
export function calcularHorarioLembreteChegada(inicioConsultaIso: string): string {
    const inicioConsulta = DateTime.fromISO(inicioConsultaIso, { zone: FUSO_CLINICA });
    if (!inicioConsulta.isValid) {
        throw new ErroDeDominio(`Início da consulta é uma data inválida: ${inicioConsultaIso}`);
    }

    const diaDaConsulta = inicioConsulta.startOf('day');
    const vespera = () =>
        diaUtilAnterior(diaDaConsulta.minus({ days: 1 })).plus({ hours: HORA_ENVIO_VESPERA });

    if (ehFimDeSemana(inicioConsulta)) return vespera().toFormat(FORMATO_MEDX);

    const candidato = inicioConsulta.minus({ hours: ANTECEDENCIA_HORAS });
    if (candidato >= diaDaConsulta.plus({ hours: HORA_MINIMA_ENVIO })) {
        return candidato.toFormat(FORMATO_MEDX);
    }

    const madrugada = diaDaConsulta.plus({ hours: HORA_ENVIO_MADRUGADA });
    return (madrugada < inicioConsulta ? madrugada : vespera()).toFormat(FORMATO_MEDX);
}
