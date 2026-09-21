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

// A doc do MedX documenta PascalCase (Id_do_Agendamento, Vinculado_a...), mas
// a API real observada em produção devolve snake_case minúsculo — tratamos a
// doc como desatualizada e seguimos o comportamento real (confirmado via
// GET /agenda/agendamentos/{id} e /agenda/agendamentos/paciente/{id} ao vivo).
// `id_do_TipoConsulta` também existe na resposta real, mas é um campo
// aparentemente não relacionado ao tipo de consulta escolhido (fica sempre 0
// nos testes ao vivo) — o valor que reflete o tipo resolvido é
// `id_do_Diagnostico_QP`.
export interface MedxAgendamento {
    id_do_Agendamento: number;
    id_do_Usuario: number;
    inicio: string;
    final: string;
    descricao: string;
    status: number;
    vinculado_a: number;
    id_do_Diagnostico_QP: number;
    confirmacao: string | null;
    lastEditDate: string | null;
    nome?: string | null;
    sms?: string | null;
}

// A doc do MedX documenta `Id`/`Match` (PascalCase), mas a API real observada
// em produção devolve minúsculo (`id`/`match`) — tratamos a doc como
// desatualizada e seguimos o comportamento real.
export interface MedxVinculoResposta {
    id: string;
    match: boolean;
}

// A doc documenta PascalCase (Data/De/Ate), mas a API real devolve minúsculo
// — confirmado ao vivo em produção, mesmo padrão de todo outro endpoint desta
// conta. Além disso, `de`/`ate` SEMPRE trazem a mesma data-base (não o dia do
// slot) — só a hora deles é significativa; `data` é quem informa o dia real.
export interface MedxDisponibilidade {
    data: string;
    de: string;
    ate: string;
}
