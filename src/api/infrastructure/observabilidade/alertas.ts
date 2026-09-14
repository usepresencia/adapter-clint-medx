import type { LoggerMinimo } from "../../../../lib/logger.js";
import type { NotificadorPort } from "../../application/ports/notificador.port.js";

export const NOTIFICADOR_SILENCIOSO: NotificadorPort = {
  async alertar(): Promise<void> {},
};

function deveAlertar(objeto: unknown): objeto is Record<string, unknown> {
  return (
    typeof objeto === "object" &&
    objeto !== null &&
    (objeto as Record<string, unknown>).alerta === true
  );
}

export function envolverComAlertas(
  logger: LoggerMinimo,
  notificador: NotificadorPort
): LoggerMinimo {
  function comAlerta(
    original: (o: unknown, m?: string) => void
  ): (o: unknown, m?: string) => void {
    return (objeto: unknown, mensagem?: string) => {
      original.call(logger, objeto, mensagem);

      if (deveAlertar(objeto)) {
        // Um alerta que falha nunca pode derrubar o fluxo que o disparou.
        void Promise.resolve()
          .then(() => notificador.alertar(mensagem ?? "alerta do adapter", objeto))
          .catch(() => {});
      }
    };
  }

  return {
    info: (o, m) => logger.info(o, m),
    warn: comAlerta(logger.warn),
    error: comAlerta(logger.error),
  };
}
