import { describe, it, expect } from 'vitest';
import { calcularHorarioLembreteChegada } from './lembrete-chegada';

describe('calcularHorarioLembreteChegada', () => {
    it('usa 2h antes da consulta quando isso ainda cai às 8h ou depois', () => {
        expect(calcularHorarioLembreteChegada('2026-07-10T14:00:00')).toBe('2026-07-10T12:00:00');
    });

    it('cai exatamente nas 8h quando a consulta é às 10h (limite inclusivo)', () => {
        expect(calcularHorarioLembreteChegada('2026-07-10T10:00:00')).toBe('2026-07-10T08:00:00');
    });

    it('consulta 08:30 → 06:00 do mesmo dia', () => {
        expect(calcularHorarioLembreteChegada('2026-11-13T08:30:00')).toBe('2026-11-13T06:00:00');
    });

    it('consulta 07:30 → 06:00 do mesmo dia', () => {
        expect(calcularHorarioLembreteChegada('2026-11-13T07:30:00')).toBe('2026-11-13T06:00:00');
    });

    it('consulta 09:50 → 06:00 do mesmo dia', () => {
        expect(calcularHorarioLembreteChegada('2026-11-13T09:50:00')).toBe('2026-11-13T06:00:00');
    });

    it('consulta 10:10 → 08:10', () => {
        expect(calcularHorarioLembreteChegada('2026-11-13T10:10:00')).toBe('2026-11-13T08:10:00');
    });

    it('consulta numa segunda de manhã usa a própria segunda às 06:00', () => {
        // 2026-07-13 é segunda-feira.
        expect(calcularHorarioLembreteChegada('2026-07-13T08:00:00')).toBe('2026-07-13T06:00:00');
    });

    it('consulta às 06:00 ou antes usa a véspera às 18h para não avisar depois da consulta', () => {
        expect(calcularHorarioLembreteChegada('2026-07-10T06:00:00')).toBe('2026-07-09T18:00:00');
        expect(calcularHorarioLembreteChegada('2026-07-10T01:00:00')).toBe('2026-07-09T18:00:00');
    });

    it('pula o fim de semana: consulta excepcional de sábado usa a sexta às 18h', () => {
        // 2026-07-11 é sábado; mesmo com 2h de antecedência dentro do horário
        // comercial, sábado não é dia de disparo.
        expect(calcularHorarioLembreteChegada('2026-07-11T14:00:00')).toBe('2026-07-10T18:00:00');
    });

    it('rejeita data inválida', () => {
        expect(() => calcularHorarioLembreteChegada('não é data')).toThrow();
    });
});
