import { describe, it, expect } from 'vitest';
import { Telefone } from './telefone';
import { ErroDeDominio } from '../shared/erros';

describe('Telefone.criar', () => {
    it.each([
        ['+55 11 99999-8888', '+5511999998888', '11999998888'],
        ['5511999998888', '+5511999998888', '11999998888'],
        ['11999998888', '+5511999998888', '11999998888'],
        ['(11) 99999-8888', '+5511999998888', '11999998888'],
    ])('normaliza %s', (entrada, e164, nacional) => {
        const t = Telefone.criar(entrada);
        expect(t.e164).toBe(e164);
        expect(t.nacional).toBe(nacional);
    });

    describe('número internacional', () => {
        it.each([
            ['+595 981 342249', '+595981342249'],
            ['+595981342249', '+595981342249'],
            ['595981342249', '+595981342249'],
        ])('mantém %s como E.164 estrangeiro', (entrada, e164) => {
            const t = Telefone.criar(entrada);
            expect(t.e164).toBe(e164);
            expect(t.estrangeiro).toBe(true);
        });

        it('não marca número brasileiro como estrangeiro', () => {
            expect(Telefone.criar('+55 11 99999-8888').estrangeiro).toBe(false);
            expect(Telefone.criar('11999998888').estrangeiro).toBe(false);
        });

        it('normaliza números estrangeiros escritos de formas diferentes para o mesmo E.164', () => {
            expect(Telefone.criar('+595 981 342249').e164).toBe(
                Telefone.criar('595981342249').e164,
            );
        });

        it.each(['+5959', '+1234567890123456'])('rejeita %s por tamanho inválido', entrada => {
            expect(() => Telefone.criar(entrada)).toThrow(ErroDeDominio);
        });
    });

    it('preserva fixos de 8 dígitos sem inventar o nono', () => {
        expect(Telefone.criar('1133334444').nacional).toBe('1133334444');
    });

    it.each(['99998888', '', '123'])('rejeita %s por não ter DDD', entrada => {
        expect(() => Telefone.criar(entrada)).toThrow(ErroDeDominio);
    });

    it('normaliza telefones escritos de formas diferentes para o mesmo E.164', () => {
        expect(Telefone.criar('+55 11 99999-8888').e164).toBe(Telefone.criar('11999998888').e164);
    });

    it('distingue telefones diferentes', () => {
        expect(Telefone.criar('11999998888').e164).not.toBe(Telefone.criar('11999998887').e164);
    });
});
