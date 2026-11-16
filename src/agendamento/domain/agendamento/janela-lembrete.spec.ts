import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
    calcularProximoLembrete,
    datasLiberadas,
    etapaFoiUltrapassada,
    horarioGatilhoDoPasso,
} from './janela-lembrete';
import {
    horarioGatilhoD1,
    horarioGatilhoD3,
    horarioGatilhoAguardandoExame,
} from './gatilhos-lembrete';

const CONSULTA = '2026-11-20T10:00:00'; // sexta-feira
const em = (iso: string) => DateTime.fromISO(iso, { zone: 'America/Sao_Paulo' });

describe('calcularProximoLembrete', () => {
    it('5 dias antes → d3', () => {
        expect(calcularProximoLembrete(CONSULTA, em('2026-11-15T10:00:00'))).toBe('d3');
    });
    it('2 dias antes → d1', () => {
        expect(calcularProximoLembrete(CONSULTA, em('2026-11-18T10:00:00'))).toBe('d1');
    });
    it('véspera depois das 12:05 → d1', () => {
        expect(calcularProximoLembrete(CONSULTA, em('2026-11-19T15:00:00'))).toBe('d1');
    });
    it('no dia, antes do lembrete → d0_chegada', () => {
        expect(calcularProximoLembrete(CONSULTA, em('2026-11-20T07:00:00'))).toBe('d0_chegada');
    });
    it('no dia, depois do lembrete → nenhum', () => {
        expect(calcularProximoLembrete(CONSULTA, em('2026-11-20T09:00:00'))).toBe('nenhum');
    });
});

describe('etapaFoiUltrapassada', () => {
    it('etapa d3 com novo d1 foi ultrapassada', () => {
        expect(etapaFoiUltrapassada('d3_preparacao_consulta', 'd1')).toBe(true);
    });
    it('etapa d1 com novo d1 não', () => {
        expect(etapaFoiUltrapassada('d1_preparando_chegada', 'd1')).toBe(false);
    });
    it('etapa confirmado nunca', () => {
        expect(etapaFoiUltrapassada('confirmado', 'nenhum')).toBe(false);
        expect(etapaFoiUltrapassada(null, 'd1')).toBe(false);
    });
});

describe('datasLiberadas', () => {
    it('nenhum libera as datas', () => {
        expect(datasLiberadas(null, 'nenhum')).toBe(true);
        expect(datasLiberadas('d0_boas_vindas', 'nenhum')).toBe(true);
    });
    it('etapa vazia bloqueia', () => {
        expect(datasLiberadas(null, 'd1')).toBe(false);
    });
    it('d0_boas_vindas bloqueia', () => {
        expect(datasLiberadas('d0_boas_vindas', 'd3')).toBe(false);
    });
    it('etapa ultrapassada bloqueia', () => {
        expect(datasLiberadas('d3_preparacao_consulta', 'd1')).toBe(false);
    });
    it('etapa alcançável libera', () => {
        expect(datasLiberadas('d1_preparando_chegada', 'd1')).toBe(true);
        expect(datasLiberadas('d3_preparacao_consulta', 'd3')).toBe(true);
        expect(datasLiberadas('d0_chegada', 'd1')).toBe(true);
    });
});

describe('horarioGatilhoDoPasso', () => {
    it('d3, d1 e d0_chegada devolvem o horário em que cada automação dispara', () => {
        expect(horarioGatilhoDoPasso('d3', CONSULTA)?.toISO()).toBe(
            em('2026-11-17T09:00:00').toISO(),
        );
        expect(horarioGatilhoDoPasso('d1', CONSULTA)?.toISO()).toBe(
            em('2026-11-19T12:45:00').toISO(),
        );
        expect(horarioGatilhoDoPasso('d0_chegada', CONSULTA)?.toISO()).toBe(
            em('2026-11-20T08:00:00').toISO(),
        );
    });
    it('nenhum não tem gatilho', () => {
        expect(horarioGatilhoDoPasso('nenhum', CONSULTA)).toBeNull();
    });
});

describe('gatilhos', () => {
    it('D1 é a véspera às 12:45, D3 três dias antes às 09:00, Aguardando Exame +7 dias às 09:00', () => {
        expect(horarioGatilhoD1(CONSULTA).toISO()).toBe(em('2026-11-19T12:45:00').toISO());
        expect(horarioGatilhoD3(CONSULTA).toISO()).toBe(em('2026-11-17T09:00:00').toISO());
        expect(horarioGatilhoAguardandoExame(CONSULTA).toISO()).toBe(
            em('2026-11-27T09:00:00').toISO(),
        );
    });
});
