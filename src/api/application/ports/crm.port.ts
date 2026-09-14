export interface CrmPort {
  gravarIdAgendamento(dealId: string, idAgendamento: number): Promise<void>;
  notificarConfirmacao(dealId: string): Promise<void>;
  notificarReagendamento(dealId: string): Promise<void>;
  notificarCancelamento(dealId: string): Promise<void>;
  notificarConflito(dealId: string, motivo: string): Promise<void>;
}
