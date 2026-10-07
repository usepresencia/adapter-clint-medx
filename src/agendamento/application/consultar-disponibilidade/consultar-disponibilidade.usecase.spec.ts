import { describe, it, expect, vi } from 'vitest';
import { ConsultarDisponibilidadeUseCase } from './consultar-disponibilidade.usecase';
import type { OcupacaoAgenda, SlotDisponivel } from '../ports/agenda-medica.port';
import { ErroDeDominio } from '../../domain/shared/erros';

const DRA = -692937676;
const OUTRO_PROFISSIONAL = -677083849;
const STATUS_AGENDADO = 1;
const STATUS_DESMARCADO = 0;

function blocos(dia: string, horas: string[]): SlotDisponivel[] {
    return horas.map(h => {
        const [hh, mm] = h.split(':').map(Number);
        const fimMin = hh! * 60 + mm! + 30;
        const fim = `${String(Math.floor(fimMin / 60)).padStart(2, '0')}:${String(fimMin % 60).padStart(2, '0')}`;
        return { inicio: `${dia}T${h}:00`, fim: `${dia}T${fim}:00` };
    });
}

function montar(opcoes: { grade?: SlotDisponivel[]; ocupacoes?: OcupacaoAgenda[] } = {}) {
    const catalogo = {
        carregar: vi.fn(async () => {}),
        resolverProfissional: vi.fn(async () => DRA),
        resolverTipoConsulta: vi.fn(),
        indiceStatusAgendado: () => STATUS_AGENDADO,
        indiceStatusConfirmado: () => 2,
        indicesStatusQueLiberamHorario: () => [STATUS_DESMARCADO],
    };
    const agenda = {
        criar: vi.fn(),
        obter: vi.fn(),
        listarPorPaciente: vi.fn(),
        confirmar: vi.fn(),
        consultarDisponibilidade: vi.fn(
            async () => opcoes.grade ?? blocos('2026-07-10', ['09:00', '09:30']),
        ),
        listarPorPeriodo: vi.fn(async () => opcoes.ocupacoes ?? []),
    };

    const usecase = new ConsultarDisponibilidadeUseCase(catalogo as any, agenda as any);
    usecase.agora = () => '2026-07-10T00:00:00';
    return { catalogo, agenda, usecase };
}

describe('ConsultarDisponibilidadeUseCase', () => {
    it('busca a grade em blocos de 30 min e a agenda da janela do dia inteiro', async () => {
        const { agenda, usecase } = montar();

        await usecase.executar({ profissional: 'Leize', dataInicio: '2026-07-10' });

        expect(agenda.consultarDisponibilidade).toHaveBeenCalledWith({
            idProfissional: DRA,
            inicio: '2026-07-10T00:00:00',
            fim: '2026-07-10T23:59:59',
            duracaoMinutos: 30,
        });
        expect(agenda.listarPorPeriodo).toHaveBeenCalledWith(
            '2026-07-10T00:00:00',
            '2026-07-10T23:59:59',
        );
    });

    it('usa dataFim quando informada, para consultar um intervalo de dias', async () => {
        const { agenda, usecase } = montar();

        await usecase.executar({
            profissional: 'Leize',
            dataInicio: '2026-07-10',
            dataFim: '2026-07-12',
        });

        expect(agenda.consultarDisponibilidade).toHaveBeenCalledWith(
            expect.objectContaining({
                inicio: '2026-07-10T00:00:00',
                fim: '2026-07-12T23:59:59',
            }),
        );
        expect(agenda.listarPorPeriodo).toHaveBeenCalledWith(
            '2026-07-10T00:00:00',
            '2026-07-12T23:59:59',
        );
    });

    it('monta horários de 60 min por padrão a partir dos blocos livres', async () => {
        const { usecase } = montar();

        const slots = await usecase.executar({ profissional: 'Leize', dataInicio: '2026-07-10' });

        expect(slots).toEqual([{ inicio: '2026-07-10T09:00:00', fim: '2026-07-10T10:00:00' }]);
    });

    it('usa a duração informada em vez do padrão', async () => {
        const { usecase } = montar();

        const slots = await usecase.executar({
            profissional: 'Leize',
            dataInicio: '2026-07-10',
            duracaoMinutos: 30,
        });

        expect(slots).toEqual(blocos('2026-07-10', ['09:00', '09:30']));
    });

    it('desconta os horários ocupados na agenda da profissional', async () => {
        const { usecase } = montar({
            grade: blocos('2026-07-10', ['13:00', '13:30', '14:00', '14:30']),
            ocupacoes: [
                {
                    idProfissional: DRA,
                    inicio: '2026-07-10T13:30:00',
                    fim: '2026-07-10T13:40:00',
                    status: STATUS_AGENDADO,
                },
            ],
        });

        const slots = await usecase.executar({ profissional: 'Leize', dataInicio: '2026-07-10' });

        expect(slots).toEqual([{ inicio: '2026-07-10T14:00:00', fim: '2026-07-10T15:00:00' }]);
    });

    it('ignora agendamentos de outro profissional', async () => {
        const { usecase } = montar({
            grade: blocos('2026-07-10', ['13:00', '13:30']),
            ocupacoes: [
                {
                    idProfissional: OUTRO_PROFISSIONAL,
                    inicio: '2026-07-10T13:30:00',
                    fim: '2026-07-10T13:40:00',
                    status: STATUS_AGENDADO,
                },
            ],
        });

        const slots = await usecase.executar({ profissional: 'Leize', dataInicio: '2026-07-10' });

        expect(slots).toEqual([{ inicio: '2026-07-10T13:00:00', fim: '2026-07-10T14:00:00' }]);
    });

    it('ignora agendamentos com status que libera o horário (ex.: desmarcado)', async () => {
        const { usecase } = montar({
            grade: blocos('2026-07-10', ['13:00', '13:30']),
            ocupacoes: [
                {
                    idProfissional: DRA,
                    inicio: '2026-07-10T13:30:00',
                    fim: '2026-07-10T13:40:00',
                    status: STATUS_DESMARCADO,
                },
            ],
        });

        const slots = await usecase.executar({ profissional: 'Leize', dataInicio: '2026-07-10' });

        expect(slots).toEqual([{ inicio: '2026-07-10T13:00:00', fim: '2026-07-10T14:00:00' }]);
    });

    it('não oferece horários que já passaram', async () => {
        const { usecase } = montar({
            grade: blocos('2026-07-10', ['08:00', '08:30', '09:00', '09:30']),
        });
        usecase.agora = () => '2026-07-10T08:15:00';

        const slots = await usecase.executar({ profissional: 'Leize', dataInicio: '2026-07-10' });

        expect(slots).toEqual([
            { inicio: '2026-07-10T08:30:00', fim: '2026-07-10T09:30:00' },
            { inicio: '2026-07-10T09:00:00', fim: '2026-07-10T10:00:00' },
        ]);
    });

    it('rejeita data em formato inválido', async () => {
        const { usecase } = montar();

        await expect(
            usecase.executar({ profissional: 'Leize', dataInicio: '10/07/2026' }),
        ).rejects.toThrow(ErroDeDominio);
    });

    it('propaga o erro quando o profissional não é encontrado', async () => {
        const { catalogo, usecase } = montar();
        catalogo.resolverProfissional = vi.fn(async () => {
            throw new Error('Profissional não encontrado no MedX: "Fulano"');
        });

        await expect(
            usecase.executar({ profissional: 'Fulano', dataInicio: '2026-07-10' }),
        ).rejects.toThrow(/Fulano/);
    });
});
