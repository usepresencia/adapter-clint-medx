import { DateTime } from 'luxon';
import { FORMATO_MEDX, FUSO_CLINICA } from './periodo-consulta';

/** Horário local da clínica no formato `yyyy-LL-ddTHH:mm:ss`. */
export interface Intervalo {
    inicio: string;
    fim: string;
}

interface Faixa {
    inicio: DateTime;
    fim: DateTime;
}

function lerData(valor: string): DateTime {
    return DateTime.fromISO(valor, { zone: FUSO_CLINICA });
}

function lerFaixa(intervalo: Intervalo): Faixa {
    const inicio = lerData(intervalo.inicio);
    const fim = lerData(intervalo.fim);
    // Agendamento sem duração ainda ocupa o bloco em que cai.
    return { inicio, fim: fim > inicio ? fim : inicio.plus({ minutes: 1 }) };
}

function sobrepoe(a: Faixa, b: Faixa): boolean {
    return a.inicio < b.fim && b.inicio < a.fim;
}

/**
 * A grade chega em blocos curtos (30 min). Um bloco que encosta em qualquer
 * agendamento sai inteiro — é isso que arredonda um agendamento de 10 min
 * para o bloco de 30 min em que ele cai. Um horário só é oferecido se houver
 * blocos livres e CONSECUTIVOS cobrindo toda a duração pedida.
 */
export function calcularHorariosLivres(entrada: {
    blocos: Intervalo[];
    ocupados: Intervalo[];
    duracaoMinutos: number;
    agora: string;
}): Intervalo[] {
    const ocupados = entrada.ocupados.map(lerFaixa);
    const agora = lerData(entrada.agora);

    const livres = entrada.blocos
        .map(lerFaixa)
        .filter(bloco => !ocupados.some(ocupado => sobrepoe(bloco, ocupado)))
        .sort((a, b) => a.inicio.toMillis() - b.inicio.toMillis());

    const horarios: Intervalo[] = [];
    livres.forEach((primeiro, indice) => {
        if (primeiro.inicio < agora) return;

        const fimDesejado = primeiro.inicio.plus({ minutes: entrada.duracaoMinutos });
        let coberturaAte = primeiro.fim;
        for (let i = indice + 1; coberturaAte < fimDesejado && i < livres.length; i++) {
            if (!livres[i]!.inicio.equals(coberturaAte)) break;
            coberturaAte = livres[i]!.fim;
        }

        if (coberturaAte >= fimDesejado) {
            horarios.push({
                inicio: primeiro.inicio.toFormat(FORMATO_MEDX),
                fim: fimDesejado.toFormat(FORMATO_MEDX),
            });
        }
    });
    return horarios;
}
