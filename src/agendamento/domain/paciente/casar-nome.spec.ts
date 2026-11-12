import { describe, it, expect } from 'vitest';
import { nomeCasa } from './casar-nome';

describe('nomeCasa', () => {
    it.each([
        ['KARMEN FEY DO NASCIMENTO', 'Karmen 💓💓', true],
        ['SILVIA FEY', 'Karmen 💓💓', false],
        ['SILVIA FEY', 'Silvia Fey🩷🩷', true],
        ['ANDREIA WELTER DE BARROS E SILVA', 'Andréia Welter 🌻', true],
        ['MARIA SILVA', '', false],
        ['ACELI PIVETTA', 'Pct Katlin', false],
        ['JULIANE LUISA SCHUH RAFAELI', 'Juliane Rafaeli', true],
    ])('%s × %s → %s', (medx, clint, esperado) => {
        expect(nomeCasa(medx, clint)).toBe(esperado);
    });
});
