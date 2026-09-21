export interface ComandoDisponibilidade {
    profissional: string | number;
    /** Formato YYYY-MM-DD. */
    dataInicio: string;
    /** Formato YYYY-MM-DD. Quando omitido, usa o mesmo valor de dataInicio. */
    dataFim?: string;
    duracaoMinutos?: number;
}
