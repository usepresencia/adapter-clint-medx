export const CATALOGO_CLINICO_PORT = Symbol('CatalogoClinicoPort');

export interface TipoConsultaResolvido {
    id: number;
    nome: string;
    duracaoMinutos: number;
}

export interface CatalogoClinicoPort {
    /**
     * Carrega as tabelas de apoio. Falha se os rótulos de "Agendado" ou
     * "Confirmado" não existirem na conta — os índices variam por conta e
     * NUNCA devem ser fixados em código (ver Global Constraints).
     */
    carregar(): Promise<void>;
    resolverProfissional(valor: string | number): Promise<number>;
    resolverTipoConsulta(valor: string | number): Promise<TipoConsultaResolvido>;
    indiceStatusAgendado(): number;
    indiceStatusConfirmado(): number;
}
