export const AGENDA_MEDICA_PORT = Symbol('AgendaMedicaPort');

export interface AgendamentoExterno {
    id: number;
    idProfissional: number;
    idPaciente: number;
    inicio: string;
    fim: string;
    descricao: string;
    status: number;
    idTipoConsulta: number;
    confirmacao: string;
    ultimaEdicao: string;
    /**
     * Payload original do sistema externo. O adapter usa isto para reconstruir uma
     * atualização completa sem perder campos que este port não modela.
     */
    bruto: unknown;
}

export interface DadosCriacaoAgendamento {
    idProfissional: number;
    idPaciente: number;
    inicio: string;
    fim: string;
    descricao: string;
    idTipoConsulta: number;
}

export interface ConsultaDisponibilidade {
    /**
     * Confirmado ao vivo: o MedxAgendaAdapter atual NÃO filtra por este id
     * (bug do MedX — qualquer proId negativo, único tipo de id que esta conta
     * usa para profissional, zera a resposta). Mantido no contrato para o dia
     * em que isso for corrigido do lado do MedX ou a clínica ganhar mais de
     * um profissional.
     */
    idProfissional: number;
    /** Início da janela consultada, formato `yyyy-LL-ddTHH:mm:ss` (horário local da clínica). */
    inicio: string;
    /** Fim da janela consultada, mesmo formato de `inicio`. */
    fim: string;
    duracaoMinutos: number;
}

export interface SlotDisponivel {
    /** Início do slot livre, formato `yyyy-LL-ddTHH:mm:ss`. */
    inicio: string;
    /** Fim do slot livre, mesmo formato de `inicio`. */
    fim: string;
}

export interface AgendaMedicaPort {
    criar(dados: DadosCriacaoAgendamento, indiceStatusAgendado: number): Promise<number>;
    obter(id: number): Promise<AgendamentoExterno>;
    listarPorPaciente(idPaciente: number): Promise<AgendamentoExterno[]>;
    confirmar(agendamento: AgendamentoExterno, indiceStatusConfirmado: number): Promise<void>;
    consultarDisponibilidade(consulta: ConsultaDisponibilidade): Promise<SlotDisponivel[]>;
}
