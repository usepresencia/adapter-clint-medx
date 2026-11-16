import { DateTime } from 'luxon';
import { FUSO_CLINICA } from './periodo-consulta';

/**
 * Horários de disparo das automações de data da RECEPÇÃO na Clint, copiados
 * das automações. Se uma automação mudar de horário, muda aqui.
 * - D3 Preparação Consulta: `data_agendamento` −3 dias às 09:00
 * - D1 Preparando chegada: `data_agendamento` −1 dia às 12:45 (era 12:05 até 2026-11-16)
 * - Aguardando Exame: `data_agendamento` +7 dias às 09:00
 */
const D3 = { dias: -3, hora: 9, minuto: 0 };
const D1 = { dias: -1, hora: 12, minuto: 45 };
const AGUARDANDO_EXAME = { dias: 7, hora: 9, minuto: 0 };

function gatilho(inicio: string, g: { dias: number; hora: number; minuto: number }): DateTime {
    return DateTime.fromISO(inicio, { zone: FUSO_CLINICA })
        .startOf('day')
        .plus({ days: g.dias, hours: g.hora, minutes: g.minuto });
}

export const horarioGatilhoD3 = (inicio: string): DateTime => gatilho(inicio, D3);
export const horarioGatilhoD1 = (inicio: string): DateTime => gatilho(inicio, D1);
export const horarioGatilhoAguardandoExame = (inicio: string): DateTime =>
    gatilho(inicio, AGUARDANDO_EXAME);
