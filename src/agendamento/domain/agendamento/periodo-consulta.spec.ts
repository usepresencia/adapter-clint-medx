import { describe, it, expect } from 'vitest';
import { PeriodoConsulta } from './periodo-consulta';
import { ErroDeDominio } from '../shared/erros';

describe('PeriodoConsulta.criar', () => {
    it('converte UTC para o horário local da clínica', () => {
        expect(PeriodoConsulta.criar('2026-07-10T17:00:00Z', 30).inicio).toBe(
            '2026-07-10T14:00:00',
        );
    });

    it('mantém a hora quando o offset já é o de São Paulo', () => {
        expect(PeriodoConsulta.criar('2026-07-10T14:00:00-03:00', 30).inicio).toBe(
            '2026-07-10T14:00:00',
        );
    });

    it('trata string sem offset como já sendo horário da clínica', () => {
        expect(PeriodoConsulta.criar('2026-07-10T14:00:00', 30).inicio).toBe('2026-07-10T14:00:00');
    });

    it('calcula o fim somando a duração', () => {
        expect(PeriodoConsulta.criar('2026-07-10T14:00:00', 30).fim).toBe('2026-07-10T14:30:00');
    });

    it('atravessa a virada do dia', () => {
        expect(PeriodoConsulta.criar('2026-07-10T23:45:00', 30).fim).toBe('2026-07-11T00:15:00');
    });

    it('rejeita data inválida', () => {
        expect(() => PeriodoConsulta.criar('não é data', 30)).toThrow(ErroDeDominio);
    });

    it.each([0, -15])('rejeita duração de %i minutos', duracao => {
        expect(() => PeriodoConsulta.criar('2026-07-10T14:00:00', duracao)).toThrow(ErroDeDominio);
    });
});

describe('comecaEm', () => {
    it('ignora diferença de precisão de segundos fracionários', () => {
        expect(
            PeriodoConsulta.criar('2026-07-10T14:00:00', 30).comecaEm('2026-07-10T14:00:00.000'),
        ).toBe(true);
    });

    it('reconhece o mesmo instante expresso em UTC', () => {
        expect(
            PeriodoConsulta.criar('2026-07-10T14:00:00', 30).comecaEm('2026-07-10T17:00:00Z'),
        ).toBe(true);
    });

    it('distingue horários diferentes', () => {
        expect(
            PeriodoConsulta.criar('2026-07-10T14:00:00', 30).comecaEm('2026-07-10T15:00:00'),
        ).toBe(false);
    });

    it('devolve false para data ilegível em vez de estourar', () => {
        expect(PeriodoConsulta.criar('2026-07-10T14:00:00', 30).comecaEm('lixo')).toBe(false);
    });
});
