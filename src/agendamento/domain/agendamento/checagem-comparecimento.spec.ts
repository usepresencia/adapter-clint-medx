import { describe, it, expect } from 'vitest';
import { calcularHorarioChecagemComparecimento } from './checagem-comparecimento';

describe('calcularHorarioChecagemComparecimento', () => {
    it('soma 2h ao início da consulta', () => {
        expect(calcularHorarioChecagemComparecimento('2026-07-10T14:00:00')).toBe(
            '2026-07-10T16:00:00',
        );
    });

    it('atravessa a virada do dia quando ainda cai antes das 18h', () => {
        // 2026-07-10 é sexta-feira; +2h cai às 01:00 de sábado, antes das 18h —
        // não aciona o adiamento por horário comercial.
        expect(calcularHorarioChecagemComparecimento('2026-07-10T23:00:00')).toBe(
            '2026-07-11T01:00:00',
        );
    });

    it('adia para as 8h do dia seguinte quando a checagem cairia às 18h ou depois (dia de semana)', () => {
        // 2026-07-09 é quinta-feira; +2h cai exatamente às 18h.
        expect(calcularHorarioChecagemComparecimento('2026-07-09T16:00:00')).toBe(
            '2026-07-10T08:00:00',
        );
    });

    it('adia para a segunda-feira às 8h quando o dia seguinte é sábado', () => {
        // 2026-07-10 é sexta-feira; +2h cai às 19h — dia seguinte é sábado.
        expect(calcularHorarioChecagemComparecimento('2026-07-10T17:00:00')).toBe(
            '2026-07-13T08:00:00',
        );
    });

    it('adia para a segunda-feira às 8h quando o dia seguinte é domingo', () => {
        // 2026-07-11 é sábado; +2h cai às 19h — dia seguinte é domingo.
        expect(calcularHorarioChecagemComparecimento('2026-07-11T17:00:00')).toBe(
            '2026-07-13T08:00:00',
        );
    });

    it('rejeita data inválida', () => {
        expect(() => calcularHorarioChecagemComparecimento('não é data')).toThrow();
    });
});
