import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CrmPort } from '../../application/ports/crm.port';
import type { Telefone } from '../../domain/paciente/telefone';
import { calcularHorarioLembreteChegada } from '../../domain/agendamento/lembrete-chegada';
import { calcularHorarioChecagemComparecimento } from '../../domain/agendamento/checagem-comparecimento';

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

    // O webhook de entrada do Clint identifica o negócio por email, telefone
    // ou instagram — nunca só pelo deal_id (confirmado ao vivo: um payload só
    // com deal_id não foi processado). Por isso todo POST inclui o telefone.
    private notificar(
        dealId: string,
        evento: string,
        telefone: Telefone,
        extra?: Record<string, unknown>,
    ): Promise<void> {
        const url = this.config.get<string>('CLINT_WEBHOOK_NOTIFICACAO_URL');
        return postar(url!, { deal_id: dealId, evento, telefone: telefone.e164, ...extra });
    }

    gravarIdAgendamento(
        dealId: string,
        idAgendamento: number,
        telefone: Telefone,
        inicio: string,
    ): Promise<void> {
        const url = this.config.get<string>('CLINT_WEBHOOK_AGENDAMENTO_URL');
        const [dataAgendamento, horaCompleta] = inicio.split('T');
        return postar(url!, {
            deal_id: dealId,
            id_agendamento_medx: idAgendamento,
            telefone: telefone.e164,
            data_agendamento: dataAgendamento,
            // Vai direto para a mensagem dos lembretes ("às 14:00"): sem segundos.
            hora_agendamento: horaCompleta?.slice(0, 5),
            horario_lembrete_chegada: calcularHorarioLembreteChegada(inicio),
            horario_checagem_comparecimento: calcularHorarioChecagemComparecimento(inicio),
        });
    }

    notificarConfirmacao(dealId: string, telefone: Telefone): Promise<void> {
        return this.notificar(dealId, 'confirmado', telefone);
    }

    notificarReagendamento(dealId: string, telefone: Telefone): Promise<void> {
        return this.notificar(dealId, 'reagendamento_solicitado', telefone);
    }

    notificarCancelamento(dealId: string, telefone: Telefone): Promise<void> {
        return this.notificar(dealId, 'cancelamento_solicitado', telefone);
    }

    notificarConflito(dealId: string, motivo: string, telefone: Telefone): Promise<void> {
        return this.notificar(dealId, 'conflito', telefone, { motivo });
    }

    notificarComparecimento(dealId: string, telefone: Telefone): Promise<void> {
        return this.notificar(dealId, 'compareceu', telefone);
    }

    notificarNaoComparecimento(dealId: string, telefone: Telefone): Promise<void> {
        return this.notificar(dealId, 'nao_compareceu', telefone);
    }
}
