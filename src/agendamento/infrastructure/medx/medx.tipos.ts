export interface MedxProfissional {
    IdDoUsuario: number;
    NomeCompleto: string;
    UsuarioNome: string;
    Ativo: boolean;
    Agenda: boolean;
    LinkAgendamentoOnline: string;
}

export interface MedxTipoAgendamento {
    IddoDiagnosticoQP: number;
    DiagnosticoQP: string;
    Tempo: number;
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

export interface MedxVinculoResposta {
    Id: string;
    Match: boolean;
}
