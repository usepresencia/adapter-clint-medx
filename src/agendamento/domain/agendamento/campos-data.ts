import { DateTime } from 'luxon';
import { FUSO_CLINICA } from './periodo-consulta';
import { calcularHorarioLembreteChegada } from './lembrete-chegada';
import { calcularHorarioChecagemComparecimento } from './checagem-comparecimento';
import { horarioGatilhoAguardandoExame } from './gatilhos-lembrete';

/** Campos de data do negócio que armam automações de gatilho de data na Clint. */
export type CampoDataNegocio =
    'data_agendamento' | 'horario_lembrete_chegada' | 'horario_checagem_comparecimento';

export const CAMPOS_DATA: readonly CampoDataNegocio[] = [
    'data_agendamento',
    'horario_lembrete_chegada',
    'horario_checagem_comparecimento',
];

/**
 * Valor de um campo de data para a consulta e o `momento` até o qual gravá-lo
 * faz sentido. `data_agendamento` arma automações antes (D3, D1) e depois da
 * consulta (Aguardando Exame), então vale até o último desses gatilhos; os
 * horários valem até eles mesmos.
 */
export function calcularCampoData(
    campo: CampoDataNegocio,
    inicio: string,
): { campos: Record<string, string>; momento: DateTime } {
    if (campo === 'data_agendamento') {
        return {
            campos: {
                data_agendamento: inicio.slice(0, 10),
                hora_agendamento: inicio.slice(11, 16),
            },
            momento: horarioGatilhoAguardandoExame(inicio),
        };
    }
    const valor =
        campo === 'horario_lembrete_chegada'
            ? calcularHorarioLembreteChegada(inicio)
            : calcularHorarioChecagemComparecimento(inicio);
    return { campos: { [campo]: valor }, momento: DateTime.fromISO(valor, { zone: FUSO_CLINICA }) };
}
