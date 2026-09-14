import type { EventoRecebido } from "./evento-recebido.js";

export interface EventoRepositorio {
  /** Grava o payload bruto e devolve o evento já com id. */
  registrar(endpoint: string, payload: unknown): EventoRecebido;
  salvar(evento: EventoRecebido): void;
  /** Remove eventos mais antigos que a retenção; devolve quantos saíram. */
  expurgar(dias: number): number;
  /** Reconstrói a entidade de um evento já gravado, para o worker atualizar seu estado. */
  registrarExistente(id: number): EventoRecebido;
}
