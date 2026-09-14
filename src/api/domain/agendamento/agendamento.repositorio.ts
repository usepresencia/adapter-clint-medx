import type { Agendamento } from "./agendamento.js";

export interface AgendamentoRepositorio {
  buscarPorDeal(dealId: string): Agendamento | null;
  salvar(agendamento: Agendamento): void;
}
