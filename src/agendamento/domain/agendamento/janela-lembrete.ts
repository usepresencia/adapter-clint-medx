import { DateTime } from 'luxon';
import { FUSO_CLINICA } from './periodo-consulta';
import { horarioGatilhoD1, horarioGatilhoD3 } from './gatilhos-lembrete';
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

/**
 * A etapa já está onde o passo esperado exige, então o monitor pode gravar as
 * datas. Sem etapa (ou ainda em `d0_boas_vindas`) a automação de entrada não
 * rodou; com a etapa ultrapassada falta o salto. Gravar a data antes disso
 * dispararia uma automação com a etapa errada.
 */
export function datasLiberadas(etapaLembrete: string | null, novo: ProximoLembrete): boolean {
    if (novo === 'nenhum') return true;
    if (!etapaLembrete || etapaLembrete === 'd0_boas_vindas') return false;
    return !etapaFoiUltrapassada(etapaLembrete, novo);
}

/** Quando a automação do passo dispara; `nenhum` não tem gatilho. */
export function horarioGatilhoDoPasso(novo: ProximoLembrete, inicio: string): DateTime | null {
    if (novo === 'd3') return horarioGatilhoD3(inicio);
    if (novo === 'd1') return horarioGatilhoD1(inicio);
    if (novo === 'd0_chegada') {
        return DateTime.fromISO(calcularHorarioLembreteChegada(inicio), { zone: FUSO_CLINICA });
    }
    return null;
}
