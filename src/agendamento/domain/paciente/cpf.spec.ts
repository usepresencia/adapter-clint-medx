import { describe, it, expect } from 'vitest';
import { Cpf } from './cpf';
import { ErroDeDominio } from '../shared/erros';

const VALIDO = '529.982.247-25';

describe('Cpf.criar', () => {
    it('remove a pontuação', () => {
        expect(Cpf.criar(VALIDO).digitos).toBe('52998224725');
    });

    it('aceita já sem pontuação', () => {
        expect(Cpf.criar('52998224725').digitos).toBe('52998224725');
    });

    it('rejeita dígito verificador errado', () => {
        expect(() => Cpf.criar('52998224724')).toThrow(ErroDeDominio);
    });

    it('rejeita quantidade de dígitos diferente de 11', () => {
        expect(() => Cpf.criar('529982247')).toThrow(ErroDeDominio);
    });

    it.each(['00000000000', '11111111111', '99999999999'])(
        'rejeita a sequência repetida %s',
        entrada => {
            expect(() => Cpf.criar(entrada)).toThrow(ErroDeDominio);
        },
    );
});

describe('Cpf.tentarCriar', () => {
    it('devolve null para ausente', () => {
        expect(Cpf.tentarCriar(undefined)).toBeNull();
        expect(Cpf.tentarCriar(null)).toBeNull();
        expect(Cpf.tentarCriar('')).toBeNull();
    });

    it('devolve null para inválido em vez de lançar', () => {
        expect(Cpf.tentarCriar('52998224724')).toBeNull();
    });

    it('devolve o Cpf quando válido', () => {
        expect(Cpf.tentarCriar(VALIDO)?.digitos).toBe('52998224725');
    });
});
