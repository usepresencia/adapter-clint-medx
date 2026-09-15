export const CATALOGO_CLINICO_PORT = Symbol('CatalogoClinicoPort');

export interface TipoConsultaResolvido {
    id: number;
    nome: string;
    duracaoMinutos: number;
}

export interface CatalogoClinicoPort {
    /** Carrega as tabelas de apoio. Falha se o rótulo de confirmação não existir na conta. */
    carregar(): Promise<void>;
    resolverProfissional(valor: string | number): Promise<number>;
    resolverTipoConsulta(valor: string | number): Promise<TipoConsultaResolvido>;
    indiceStatusConfirmado(): number;
}
