import { describe, it, expect, vi } from 'vitest';
import { ProcessarRespostaUseCase } from './processar-resposta.usecase';
import { Agendamento } from '../../domain/agendamento/agendamento';
import { PeriodoConsulta } from '../../domain/agendamento/periodo-consulta';
import type { AgendamentoExterno } from '../ports/agenda-medica.port';

function externo(parcial: Partial<AgendamentoExterno> = {}): AgendamentoExterno {
    return {
        id: 1275002478,
        idProfissional: 43013640,
        idPaciente: 67890,
        inicio: '2026-07-10T14:00:00',
        fim: '2026-07-10T14:30:00',
        descricao: 'Consulta',
        status: 0,
        idTipoConsulta: 111,
        confirmacao: '',
        ultimaEdicao: '2026-07-09T10:00:00',
        bruto: {},
        ...parcial,
    };
}

function agendamentosFalso() {
    const registros = new Map<string, Agendamento>();
    return {
        async buscarPorDeal(dealId: string) {
            return registros.get(dealId) ?? null;
        },
        async salvar(a: Agendamento) {
            registros.set(a.dealId, a);
        },
    };
}

async function montar(noMedx: AgendamentoExterno = externo(), comRegistro = true) {
    const agendamentos = agendamentosFalso();

    if (comRegistro) {
        const a = Agendamento.iniciar({
            dealId: 'deal-1',
            idPacienteMedx: 67890,
            idProfissionalMedx: 43013640,
            periodo: PeriodoConsulta.criar('2026-07-10T14:00:00', 30),
        });
        a.registrarCriacao(1275002478);
        await agendamentos.salvar(a);
    }

    const agenda = {
        criar: vi.fn(async () => 0),
        obter: vi.fn(async () => noMedx),
        listarPorPaciente: vi.fn(async () => [] as AgendamentoExterno[]),
        confirmar: vi.fn(async () => {}),
    };
    const catalogo = {
        carregar: vi.fn(async () => {}),
        resolverProfissional: vi.fn(async () => 0),
        resolverTipoConsulta: vi.fn(async () => ({ id: 0, nome: '', duracaoMinutos: 30 })),
        indiceStatusConfirmado: () => 1,
    };
    const crm = {
        gravarIdAgendamento: vi.fn(async () => {}),
        notificarConfirmacao: vi.fn(async () => {}),
        notificarReagendamento: vi.fn(async () => {}),
        notificarCancelamento: vi.fn(async () => {}),
        notificarConflito: vi.fn(async () => {}),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const usecase = new ProcessarRespostaUseCase(
        agendamentos as any,
        agenda as any,
        catalogo as any,
        crm as any,
        logger as any,
    );

    return { agendamentos, agenda, catalogo, crm, logger, usecase };
}

const CONFIRMAR = { dealId: 'deal-1', idAgendamentoMedx: 1275002478, resposta: 'confirmar' };

describe('confirmar', () => {
    it('chama o port com o índice descoberto', async () => {
        const { agenda, usecase } = await montar();
        await usecase.executar(CONFIRMAR);
        expect(agenda.confirmar).toHaveBeenCalledWith(
            expect.objectContaining({ id: 1275002478 }),
            1,
        );
    });

    it('avisa o CRM da confirmação', async () => {
        const { crm, usecase } = await montar();
        await usecase.executar(CONFIRMAR);
        expect(crm.notificarConfirmacao).toHaveBeenCalledWith('deal-1');
    });

    it('persiste como confirmado com a última edição', async () => {
        const { usecase, agendamentos } = await montar();
        await usecase.executar(CONFIRMAR);
        const salvo = (await agendamentos.buscarPorDeal('deal-1'))!;
        expect(salvo.status).toBe('confirmado');
        expect(salvo.ultimaEdicaoConhecida).toBe('2026-07-09T10:00:00');
    });

    it('aceita reenvio quando o MedX já está confirmado', async () => {
        const { agenda, usecase } = await montar(externo({ status: 1 }));
        await usecase.executar(CONFIRMAR);
        expect(agenda.confirmar).toHaveBeenCalled();
    });

    it('é idempotente: não reescreve o que já confirmamos', async () => {
        const { agenda, usecase, agendamentos } = await montar();
        await usecase.executar(CONFIRMAR);
        agenda.confirmar.mockClear();
        await usecase.executar(CONFIRMAR);
        expect(agenda.confirmar).not.toHaveBeenCalled();
        expect((await agendamentos.buscarPorDeal('deal-1'))!.status).toBe('confirmado');
    });

    it('normaliza a resposta com caixa diferente', async () => {
        const { agenda, usecase } = await montar();
        await usecase.executar({ ...CONFIRMAR, resposta: 'CONFIRMAR' });
        expect(agenda.confirmar).toHaveBeenCalled();
    });
});

describe('recusas', () => {
    it('recusa quando o horário mudou desde o lembrete', async () => {
        const { agenda, crm, usecase, agendamentos } = await montar(
            externo({ inicio: '2026-07-11T09:00:00' }),
        );
        await usecase.executar(CONFIRMAR);

        expect(agenda.confirmar).not.toHaveBeenCalled();
        expect(crm.notificarConflito).toHaveBeenCalledWith(
            'deal-1',
            expect.stringMatching(/horário/i),
        );
        expect((await agendamentos.buscarPorDeal('deal-1'))!.status).toBe('conflito');
    });

    it('recusa quando a consulta não está mais agendada', async () => {
        const { agenda, crm, usecase } = await montar(externo({ status: 3 }));
        await usecase.executar(CONFIRMAR);
        expect(agenda.confirmar).not.toHaveBeenCalled();
        expect(crm.notificarConflito).toHaveBeenCalled();
    });

    it('alerta ao recusar', async () => {
        const { logger, usecase } = await montar(externo({ status: 3 }));
        await usecase.executar(CONFIRMAR);
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ alerta: true }),
            expect.any(String),
        );
    });

    it('recusa quando o adapter não conhece o agendamento', async () => {
        const { agenda, crm, usecase } = await montar(externo(), false);
        await usecase.executar(CONFIRMAR);
        expect(agenda.confirmar).not.toHaveBeenCalled();
        expect(crm.notificarConflito).toHaveBeenCalled();
    });

    it('recusa quando o id do agendamento do CRM não bate com o registro local', async () => {
        const { agenda, crm, usecase, agendamentos } = await montar();
        // O registro local foi criado com idMedx 1275002478 (ver `montar`), mas o
        // payload do Clint chega com um id diferente (campo customizado desatualizado).
        await usecase.executar({ ...CONFIRMAR, idAgendamentoMedx: 999999999 });

        expect(agenda.obter).not.toHaveBeenCalled();
        expect(crm.notificarConflito).toHaveBeenCalledWith(
            'deal-1',
            expect.stringMatching(/não confere|diverg/i),
        );
        expect((await agendamentos.buscarPorDeal('deal-1'))!.status).toBe('conflito');
    });

    it('rejeita resposta fora das três opções', async () => {
        const { usecase } = await montar();
        await expect(usecase.executar({ ...CONFIRMAR, resposta: 'talvez' })).rejects.toThrow(
            /talvez/,
        );
    });
});

describe('reagendar e cancelar', () => {
    it.each([
        ['reagendar', 'notificarReagendamento'],
        ['cancelar', 'notificarCancelamento'],
    ])('%s só avisa o CRM, sem tocar no MedX', async (resposta, metodo) => {
        const { agenda, crm, usecase } = await montar();
        await usecase.executar({ ...CONFIRMAR, resposta });

        expect(agenda.obter).not.toHaveBeenCalled();
        expect(agenda.confirmar).not.toHaveBeenCalled();
        expect((crm as any)[metodo]).toHaveBeenCalledWith('deal-1');
    });
});
