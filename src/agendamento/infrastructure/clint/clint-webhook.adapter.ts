import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CrmPort } from '../../application/ports/crm.port';

async function postar(url: string, corpo: Record<string, unknown>): Promise<void> {
    const resposta = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
    });

    if (!resposta.ok) {
        throw new Error(`Webhook de entrada do Clint respondeu HTTP ${resposta.status}`);
    }
}

@Injectable()
export class ClintWebhookAdapter implements CrmPort {
    constructor(private readonly config: ConfigService) {}

    private notificar(
        dealId: string,
        evento: string,
        extra?: Record<string, unknown>,
    ): Promise<void> {
        const url = this.config.get<string>('CLINT_WEBHOOK_NOTIFICACAO_URL');
        return postar(url!, { deal_id: dealId, evento, ...extra });
    }

    gravarIdAgendamento(dealId: string, idAgendamento: number): Promise<void> {
        const url = this.config.get<string>('CLINT_WEBHOOK_AGENDAMENTO_URL');
        return postar(url!, { deal_id: dealId, id_agendamento_medx: idAgendamento });
    }

    notificarConfirmacao(dealId: string): Promise<void> {
        return this.notificar(dealId, 'confirmado');
    }

    notificarReagendamento(dealId: string): Promise<void> {
        return this.notificar(dealId, 'reagendamento_solicitado');
    }

    notificarCancelamento(dealId: string): Promise<void> {
        return this.notificar(dealId, 'cancelamento_solicitado');
    }

    notificarConflito(dealId: string, motivo: string): Promise<void> {
        return this.notificar(dealId, 'conflito', { motivo });
    }
}
