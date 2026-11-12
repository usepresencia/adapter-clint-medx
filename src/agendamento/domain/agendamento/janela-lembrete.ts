import { DateTime } from 'luxon';
import { FUSO_CLINICA } from './periodo-consulta';
import { horarioGatilhoD3 } from './gatilhos-lembrete';
import { calcularHorarioLembreteChegada } from './lembrete-chegada';

export type ProximoLembrete = 'd3' | 'd1' | 'd0_chegada' | 'nenhum';

const ORDEM: Record<ProximoLembrete, number> = { d3: 0, d1: 1, d0_chegada: 2, nenhum: 3 };

const PASSO_DA_ETAPA: Record<string, ProximoLembrete> = {
    d3_preparacao_consulta: 'd3',
    d1_preparando_chegada: 'd1',
    d0_chegada: 'd0_chegada',
};

/**
 * Primeiro lembrete que ainda cabe na janela até a consulta. O D1 vale até a
 * véspera (se o horário dele já passou, a automação o envia 30 min depois de
 * entrar na etapa); no próprio dia só cabe o D0 Chegada, se ainda for futuro.
 */
export function calcularProximoLembrete(inicio: string, agora: DateTime): ProximoLembrete {
    if (horarioGatilhoD3(inicio) > agora) return 'd3';

    const diaDaConsulta = DateTime.fromISO(inicio, { zone: FUSO_CLINICA }).startOf('day');
    if (agora.setZone(FUSO_CLINICA).startOf('day') < diaDaConsulta) return 'd1';

    const chegada = DateTime.fromISO(calcularHorarioLembreteChegada(inicio), {
        zone: FUSO_CLINICA,
    });
    return chegada > agora ? 'd0_chegada' : 'nenhum';
}

/** A etapa atual da cadeia ficou para trás em relação ao passo que ainda cabe. */
export function etapaFoiUltrapassada(etapaLembrete: string | null, novo: ProximoLembrete): boolean {
    const atual = etapaLembrete ? PASSO_DA_ETAPA[etapaLembrete] : undefined;
    return atual !== undefined && ORDEM[atual] < ORDEM[novo];
}
