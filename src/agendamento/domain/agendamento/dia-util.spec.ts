import { DateTime } from 'luxon';
import { describe, it, expect } from 'vitest';
import { diaUtilAnterior, ehFimDeSemana, proximoDiaUtil } from './dia-util';

describe('ehFimDeSemana', () => {
    it('reconhece sábado como fim de semana', () => {
        expect(ehFimDeSemana(DateTime.fromISO('2026-07-11'))).toBe(true);
    });

    it('reconhece domingo como fim de semana', () => {
        expect(ehFimDeSemana(DateTime.fromISO('2026-07-12'))).toBe(true);
    });

    it('não reconhece dias de semana como fim de semana', () => {
        expect(ehFimDeSemana(DateTime.fromISO('2026-07-10'))).toBe(false);
    });
});

describe('proximoDiaUtil', () => {
    it('empurra sábado para a segunda-feira seguinte', () => {
        expect(proximoDiaUtil(DateTime.fromISO('2026-07-11')).toISODate()).toBe('2026-07-13');
    });

    it('empurra domingo para a segunda-feira seguinte', () => {
        expect(proximoDiaUtil(DateTime.fromISO('2026-07-12')).toISODate()).toBe('2026-07-13');
    });

    it('mantém dia de semana inalterado', () => {
        expect(proximoDiaUtil(DateTime.fromISO('2026-07-10')).toISODate()).toBe('2026-07-10');
    });
});

describe('diaUtilAnterior', () => {
    it('volta domingo para a sexta-feira anterior', () => {
        expect(diaUtilAnterior(DateTime.fromISO('2026-07-12')).toISODate()).toBe('2026-07-10');
    });

    it('volta sábado para a sexta-feira anterior', () => {
        expect(diaUtilAnterior(DateTime.fromISO('2026-07-11')).toISODate()).toBe('2026-07-10');
    });

    it('mantém dia de semana inalterado', () => {
        expect(diaUtilAnterior(DateTime.fromISO('2026-07-10')).toISODate()).toBe('2026-07-10');
    });
});
