export interface DadosClique {
    fbclid?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
}

export interface CliqueOrigem {
    id: number;
    codigo: string;
    fbclid: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    telefone: string | null;
    criadoEm: Date;
}

export interface CliqueOrigemRepositorio {
    criar(codigo: string, dados: DadosClique): Promise<void>;
    buscarPorCodigo(codigo: string): Promise<CliqueOrigem | null>;
    /** Associa o clique a um telefone quando a mensagem de WhatsApp chega com o código. */
    reivindicar(codigo: string, telefone: string): Promise<void>;
    buscarMaisRecentePorTelefone(telefone: string): Promise<CliqueOrigem | null>;
    /** Remove cliques sem telefone associado mais antigos que `dias`; devolve quantos saíram. */
    expurgarNaoReivindicados(dias: number): Promise<number>;
}
