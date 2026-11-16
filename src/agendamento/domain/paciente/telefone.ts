import { ErroDeDominio } from '../shared/erros';

const DDI_BRASIL = '55';
const MAX_DIGITOS_E164 = 15;
const MIN_DIGITOS_ESTRANGEIRO = 11;

export class Telefone {
    private constructor(
        readonly e164: string,
        /** Brasileiro: DDD + número. Estrangeiro: o número completo com DDI, sem o `+`. */
        readonly nacional: string,
        readonly estrangeiro: boolean = false,
    ) {}

    static criar(bruto: string): Telefone {
        let digitos = (bruto ?? '').replace(/\D/g, '');

        if (digitos.startsWith(DDI_BRASIL) && digitos.length >= 12) {
            digitos = digitos.slice(2);
        }

        if (digitos.length >= 10 && digitos.length <= 11) {
            return new Telefone(`+${DDI_BRASIL}${digitos}`, digitos);
        }

        // O Clint envia o número completo em E.164 (ex.: +595981342249 de uma paciente
        // paraguaia). Fora do formato brasileiro, mantém o DDI de origem em vez de
        // assumir +55.
        if (digitos.length >= MIN_DIGITOS_ESTRANGEIRO && digitos.length <= MAX_DIGITOS_E164) {
            return new Telefone(`+${digitos}`, digitos, true);
        }

        throw new ErroDeDominio(
            `Telefone sem DDD reconhecível: ${digitos.length} dígitos após normalização`,
        );
    }
}
