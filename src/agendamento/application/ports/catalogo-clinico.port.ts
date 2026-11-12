export const CATALOGO_CLINICO_PORT = Symbol('CatalogoClinicoPort');

export interface TipoConsultaResolvido {
    id: number;
    nome: string;
    duracaoMinutos: number;
}

export interface CatalogoClinicoPort {
    /**
     * Carrega as tabelas de apoio. Falha se os status "Agendado" ou
     * "Confirmado" não existirem na conta — os ids variam por conta e NUNCA
     * devem ser fixados em código. As consultas abaixo carregam sob demanda.
     */
    carregar(): Promise<void>;
    resolverProfissional(valor: string | number): Promise<number>;
    resolverTipoConsulta(valor: string | number): Promise<TipoConsultaResolvido>;
    indiceStatusAgendado(): Promise<number>;
    indiceStatusConfirmado(): Promise<number>;
    /** -1 quando a conta não tem o rótulo "Finalizado Atendimento". */
    indiceStatusFinalizado(): Promise<number>;
    /**
     * Índices dos status que deixam o horário livre na agenda (Desmarcado,
     * Cancelou, Faltou). Rótulo ausente na conta é só ignorado.
     */
    indicesStatusQueLiberamHorario(): Promise<number[]>;
}
