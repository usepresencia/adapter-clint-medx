import { ErroDeDominio } from '../shared/erros';

function digitoVerificador(digitos: string, peso: number): number {
    let soma = 0;
    for (let i = 0; i < peso - 1; i++) {
        soma += Number(digitos[i]) * (peso - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
}

export class Cpf {
    private constructor(readonly digitos: string) {}

    static criar(bruto: string): Cpf {
        const digitos = (bruto ?? '').replace(/\D/g, '');

        if (digitos.length !== 11) {
            throw new ErroDeDominio(`CPF deve ter 11 dígitos, recebeu ${digitos.length}`);
        }

        if (/^(\d)\1{10}$/.test(digitos)) {
            throw new ErroDeDominio('CPF com todos os dígitos iguais é inválido');
        }

        if (
            digitoVerificador(digitos, 10) !== Number(digitos[9]) ||
            digitoVerificador(digitos, 11) !== Number(digitos[10])
        ) {
            throw new ErroDeDominio('CPF com dígito verificador inválido');
        }

        return new Cpf(digitos);
    }

    static tentarCriar(bruto: string | undefined | null): Cpf | null {
        if (!bruto) return null;
        try {
            return Cpf.criar(bruto);
        } catch {
            return null;
        }
    }
}
