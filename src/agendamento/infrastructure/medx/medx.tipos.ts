/** Item de `profissionais` em GET /api/integration/v1/financas/profissionais. */
export interface MedxProfissional {
    id: number;
    nome: string;
    nomeCompleto: string | null;
    ativo: boolean;
    agendavel: boolean;
}

/** Item de GET /api/integration/v1/agenda/tipos. */
export interface MedxTipoAgendamento {
    id: number;
    nome: string;
    duracaoMinutos: number;
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

/** Referência `{ id, nome }` usada em toda a API v1. */
export interface MedxReferencia {
    id: number;
    nome: string;
}

/**
 * Item de GET /api/integration/v1/agenda/agendamentos/detalhes, /{id}/detalhes
 * e /paciente/{id} (confirmado ao vivo em 2026-11-12). Horários vêm com offset
 * (`-03:00`); `paciente`/`tipo` vêm nulos em anotações sem paciente.
 */
export interface MedxAgendaDetalhe {
    id: number;
    inicio: string;
    fim: string;
    profissional: MedxReferencia | null;
    paciente: MedxReferencia | null;
    tipo: MedxReferencia | null;
    procedimentoId: number | null;
    status: MedxReferencia;
    descricao: string | null;
    confirmacao: string | null;
    sms: string | null;
    chegada: string | null;
    atendidoEm: string | null;
    saiuEm: string | null;
    atualizadoEm: string | null;
    /** Exigida sem alteração para atualizar o agendamento. */
    versao: string;
}

export interface MedxDisponibilidadeV1 {
    horarios?: Array<{ inicio: string; fim: string }>;
}
