import type { NotificadorPort } from '../../agendamento/application/ports/notificador.port';

export function criarNotificadorEmail(opcoes: {
    enviarEmail: (para: string, assunto: string, corpo: string) => Promise<void>;
    destino: string;
}): NotificadorPort {
    return {
        async alertar(assunto: string, detalhes: Record<string, unknown>): Promise<void> {
            await opcoes.enviarEmail(
                opcoes.destino,
                `[adapter-clint-medx] ${assunto}`,
                JSON.stringify(detalhes, null, 2),
            );
        },
    };
}
