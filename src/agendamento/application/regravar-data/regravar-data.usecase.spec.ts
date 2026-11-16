import { describe, it, expect, vi } from 'vitest';
import { DateTime } from 'luxon';
import { RegravarDataUseCase } from './regravar-data.usecase';
import type { AgendamentoExterno } from '../ports/agenda-medica.port';
import type { CampoDataNegocio } from '../ports/crm-negocio.port';

const DEAL = '521e2bf6-1ce0-4cf0-91d9-ea2dc7627eb1';

function externo(inicio: string, status = 1): AgendamentoExterno {
    return {
        id: -1084641653,
        idProfissional: -677083849,
        idPaciente: 1,
        inicio,
        fim: inicio,
        descricao: '',
        status,
        idTipoConsulta: 0,
        confirmacao: '',
        ultimaEdicao: '',
        bruto: {},
    };
}

function montar(inicio: string, agora: string, status = 1) {
    const agenda = { obter: vi.fn(async () => externo(inicio, status)) };
    const catalogo = { indicesStatusQueLiberamHorario: async () => [0, 5, 3] };
    const crm = { gravarCampos: vi.fn(async () => {}) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const relogio = { agora: () => DateTime.fromISO(agora, { zone: 'America/Sao_Paulo' }) };
    const usecase = new RegravarDataUseCase(
        agenda as any,
        catalogo as any,
        crm as any,
        logger,
        relogio,
    );
    const executar = (campo: CampoDataNegocio) =>
        usecase.executar({ dealId: DEAL, idAgendamentoMedx: -1084641653, campo });
    return { executar, agenda, crm, logger };
}

describe('RegravarDataUseCase', () => {
    it('regrava o lembrete com a regra das 06h', async () => {
        const { executar, agenda, crm } = montar('2026-11-13T08:30:00', '2026-11-12T12:00:00');
        await executar('horario_lembrete_chegada');
        expect(agenda.obter).toHaveBeenCalledWith(-1084641653);
        expect(crm.gravarCampos).toHaveBeenCalledWith(DEAL, {
            horario_lembrete_chegada: '2026-11-13T06:00:00',
        });
    });

    it('regrava a checagem 2h depois da consulta', async () => {
        const { executar, crm } = montar('2026-11-13T15:00:00', '2026-11-12T12:00:00');
        await executar('horario_checagem_comparecimento');
        expect(crm.gravarCampos).toHaveBeenCalledWith(DEAL, {
            horario_checagem_comparecimento: '2026-11-13T17:00:00',
        });
    });

    it('regrava data e hora do agendamento remarcado', async () => {
        const { executar, crm } = montar('2026-11-13T15:00:00', '2026-11-12T12:00:00');
        await executar('data_agendamento');
        expect(crm.gravarCampos).toHaveBeenCalledWith(DEAL, {
            data_agendamento: '2026-11-13',
            hora_agendamento: '15:00',
        });
    });

    it('não grava quando o agendamento foi desmarcado', async () => {
        for (const status of [0, 5, 3]) {
            const { executar, crm, logger } = montar(
                '2026-11-13T15:00:00',
                '2026-11-12T12:00:00',
                status,
            );
            await executar('horario_lembrete_chegada');
            expect(crm.gravarCampos).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalled();
        }
    });

    it('não grava horário que já passou', async () => {
        const { executar, crm, logger } = montar('2026-11-12T09:00:00', '2026-11-12T12:00:00');
        await executar('horario_checagem_comparecimento');
        expect(crm.gravarCampos).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('regrava a data depois da consulta para armar o Aguardando Exame (+7 dias, 09:00)', async () => {
        const { executar, crm } = montar('2026-11-12T11:00:00', '2026-11-12T13:00:00');
        await executar('data_agendamento');
        expect(crm.gravarCampos).toHaveBeenCalledWith(DEAL, {
            data_agendamento: '2026-11-12',
            hora_agendamento: '11:00',
        });
    });

    it('não regrava a data quando até o Aguardando Exame (+7 dias, 09:00) já passou', async () => {
        const { executar, crm } = montar('2026-11-01T11:00:00', '2026-11-08T09:30:00');
        await executar('data_agendamento');
        expect(crm.gravarCampos).not.toHaveBeenCalled();
    });

    it('alerta quando deixa de gravar um horário que já passou', async () => {
        const { executar, logger } = montar('2026-11-12T09:00:00', '2026-11-12T12:00:00');
        await executar('horario_checagem_comparecimento');
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ alerta: true }),
            expect.any(String),
        );
    });
});
