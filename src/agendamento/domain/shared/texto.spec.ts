import { describe, it, expect } from 'vitest';
import { semAcento } from './texto';

describe('semAcento', () => {
    it('tira acentos e cedilha e mantém o resto', () => {
        expect(semAcento('Conceição Ângela')).toBe('Conceicao Angela');
        expect(semAcento('Maria-1')).toBe('Maria-1');
    });
});
