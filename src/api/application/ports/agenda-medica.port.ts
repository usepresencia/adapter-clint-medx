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

export interface AgendaMedicaPort {
  criar(dados: DadosCriacaoAgendamento): Promise<number>;
  obter(id: number): Promise<AgendamentoExterno>;
  listarPorPaciente(idPaciente: number): Promise<AgendamentoExterno[]>;
  confirmar(agendamento: AgendamentoExterno, indiceStatusConfirmado: number): Promise<void>;
}
