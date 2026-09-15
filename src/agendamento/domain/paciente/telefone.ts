import { ErroDeDominio } from '../shared/erros';

export class Telefone {
    private constructor(
        readonly e164: string,
        readonly nacional: string,
    ) {}

    static criar(bruto: string): Telefone {
        let digitos = (bruto ?? '').replace(/\D/g, '');

        if (digitos.startsWith('55') && digitos.length >= 12) {
            digitos = digitos.slice(2);
        }

        if (digitos.length < 10 || digitos.length > 11) {
            throw new ErroDeDominio(
                `Telefone sem DDD reconhecível: ${digitos.length} dígitos após normalização`,
            );
        }

        return new Telefone(`+55${digitos}`, digitos);
    }

    igual(outro: Telefone): boolean {
        return this.e164 === outro.e164;
    }
}
