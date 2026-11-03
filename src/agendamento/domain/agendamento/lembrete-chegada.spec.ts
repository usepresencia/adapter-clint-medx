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

    it('pula o fim de semana: consulta numa segunda de manhã usa a sexta às 18h', () => {
        // 2026-07-13 é segunda-feira; 2h antes das 8h cairia no domingo.
        expect(calcularHorarioLembreteChegada('2026-07-13T08:00:00')).toBe('2026-07-10T18:00:00');
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
