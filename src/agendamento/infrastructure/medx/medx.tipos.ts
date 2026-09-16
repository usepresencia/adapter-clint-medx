// A doc do MedX documenta PascalCase, mas a API real observada em produção
// devolve camelCase — tratamos a doc como desatualizada e seguimos o
// comportamento real.
export interface MedxProfissional {
    idDoUsuario: number;
    nomeCompleto: string;
    usuarioNome: string;
    ativo: boolean;
    agenda: boolean;
    linkAgendamentoOnline: string;
}

export interface MedxTipoAgendamento {
    iddoDiagnosticoQP: number;
    diagnosticoQP: string;
    tempo: number;
}

export interface MedxAgendamento {
    Id_do_Agendamento: number;
    Id_do_Usuario: number;
    Inicio: string;
    Final: string;
    Descricao: string;
    Status: number;
    Vinculado_a: number;
    Id_do_TipoConsulta: number;
    Confirmacao: string;
    LastEditDate: string;
    Nome?: string;
    SMS?: string;
}

// A doc do MedX documenta `Id`/`Match` (PascalCase), mas a API real observada
// em produção devolve minúsculo (`id`/`match`) — tratamos a doc como
// desatualizada e seguimos o comportamento real.
export interface MedxVinculoResposta {
    id: string;
    match: boolean;
}
