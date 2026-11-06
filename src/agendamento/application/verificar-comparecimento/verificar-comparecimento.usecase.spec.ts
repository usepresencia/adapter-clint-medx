import { describe, it, expect, vi } from 'vitest';
import { VerificarComparecimentoUseCase } from './verificar-comparecimento.usecase';
import type { AgendamentoExterno } from '../ports/agenda-medica.port';

function externo(status: number): AgendamentoExterno {
    return {
        id: 1275002478,
        idProfissional: 43013640,
        idPaciente: 67890,
        inicio: '2026-07-10T14:00:00',
        fim: '2026-07-10T14:30:00',
        descricao: 'Consulta',
        status,
        idTipoConsulta: 111,
        confirmacao: '',
        ultimaEdicao: '2026-07-09T10:00:00',
        bruto: {},
    };
}

const INDICE_FINALIZADO = 5;

function montar(statusNoMedx: number) {
    const agenda = { obter: vi.fn(async () => externo(statusNoMedx)) };
    const catalogo = { indiceStatusFinalizado: () => INDICE_FINALIZADO };
    const crm = {
        notificarComparecimento: vi.fn(async () => {}),
        notificarNaoComparecimento: vi.fn(async () => {}),
    };

    const usecase = new VerificarComparecimentoUseCase(agenda as any, catalogo as any, crm as any);
    return { usecase, agenda, crm };
}

describe('VerificarComparecimentoUseCase', () => {
    it('notifica comparecimento quando o status no MedX é "finalizado"', async () => {
        const { usecase, agenda, crm } = montar(INDICE_FINALIZADO);

        await usecase.executar({
            dealId: 'deal-1',
            idAgendamentoMedx: 1275002478,
            telefone: '+55 45 98838-3189',
        });

        expect(agenda.obter).toHaveBeenCalledWith(1275002478);
        expect(crm.notificarComparecimento).toHaveBeenCalledWith(
            'deal-1',
            expect.objectContaining({ e164: '+5545988383189' }),
        );
        expect(crm.notificarNaoComparecimento).not.toHaveBeenCalled();
    });

    it('notifica não comparecimento quando o status no MedX é qualquer outro', async () => {
        const { usecase, crm } = montar(0);

        await usecase.executar({
            dealId: 'deal-1',
            idAgendamentoMedx: 1275002478,
            telefone: '+55 45 98838-3189',
        });

        expect(crm.notificarNaoComparecimento).toHaveBeenCalledWith(
            'deal-1',
            expect.objectContaining({ e164: '+5545988383189' }),
        );
        expect(crm.notificarComparecimento).not.toHaveBeenCalled();
    });
});
