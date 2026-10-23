import { describe, it, expect } from 'vitest';
import { calcularHorarioLembreteChegada } from './lembrete-chegada';

describe('calcularHorarioLembreteChegada', () => {
    it('usa 2h antes da consulta quando isso ainda cai às 8h ou depois', () => {
        expect(calcularHorarioLembreteChegada('2026-07-10T14:00:00')).toBe('2026-07-10T12:00:00');
    });

    it('cai exatamente nas 8h quando a consulta é às 10h (limite inclusivo)', () => {
        expect(calcularHorarioLembreteChegada('2026-07-10T10:00:00')).toBe('2026-07-10T08:00:00');
    });

    it('usa a véspera às 18h quando 2h antes cairia antes das 8h', () => {
        expect(calcularHorarioLembreteChegada('2026-07-10T09:00:00')).toBe('2026-07-09T18:00:00');
    });

    it('usa a véspera às 18h para consulta logo na abertura (8h)', () => {
        expect(calcularHorarioLembreteChegada('2026-07-10T08:00:00')).toBe('2026-07-09T18:00:00');
    });

    it('usa a véspera às 18h quando 2h antes atravessa a virada do dia', () => {
        expect(calcularHorarioLembreteChegada('2026-07-10T01:00:00')).toBe('2026-07-09T18:00:00');
    });

    it('rejeita data inválida', () => {
        expect(() => calcularHorarioLembreteChegada('não é data')).toThrow();
    });
});
