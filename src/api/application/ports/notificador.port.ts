export interface NotificadorPort {
  alertar(assunto: string, detalhes: Record<string, unknown>): Promise<void>;
}
