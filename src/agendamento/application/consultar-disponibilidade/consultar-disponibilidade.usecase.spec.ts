import { describe, it, expect, vi } from 'vitest';
import { ConsultarDisponibilidadeUseCase } from './consultar-disponibilidade.usecase';
import type { SlotDisponivel } from '../ports/agenda-medica.port';
import { ErroDeDominio } from '../../domain/shared/erros';

function montar() {
    const catalogo = {
        carregar: vi.fn(async () => {}),
        resolverProfissional: vi.fn(async () => 43013640),
        resolverTipoConsulta: vi.fn(),
        indiceStatusAgendado: () => 0,
        indiceStatusConfirmado: () => 1,
    };
    const agenda = {
        criar: vi.fn(),
        obter: vi.fn(),
        listarPorPaciente: vi.fn(),
        confirmar: vi.fn(),
        consultarDisponibilidade: vi.fn(
            async () =>
                [{ inicio: '2026-07-10T09:00:00', fim: '2026-07-10T09:30:00' }] as SlotDisponivel[],
        ),
    };

    const usecase = new ConsultarDisponibilidadeUseCase(catalogo as any, agenda as any);
    return { catalogo, agenda, usecase };
}

describe('ConsultarDisponibilidadeUseCase', () => {
    it('resolve o profissional e consulta a janela do dia inteiro quando só dataInicio é informada', async () => {
        const { agenda, usecase } = montar();

        await usecase.executar({ profissional: 'Leize', dataInicio: '2026-07-10' });

        expect(agenda.consultarDisponibilidade).toHaveBeenCalledWith({
            idProfissional: 43013640,
            inicio: '2026-07-10T00:00:00',
            fim: '2026-07-10T23:59:59',
            duracaoMinutos: 60,
        });
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
    });

    it('usa a duração informada em vez do padrão', async () => {
        const { agenda, usecase } = montar();

        await usecase.executar({
            profissional: 'Leize',
            dataInicio: '2026-07-10',
            duracaoMinutos: 45,
        });

        expect(agenda.consultarDisponibilidade).toHaveBeenCalledWith(
            expect.objectContaining({ duracaoMinutos: 45 }),
        );
    });

    it('devolve os slots traduzidos pelo port', async () => {
        const { usecase } = montar();

        const slots = await usecase.executar({ profissional: 'Leize', dataInicio: '2026-07-10' });

        expect(slots).toEqual([{ inicio: '2026-07-10T09:00:00', fim: '2026-07-10T09:30:00' }]);
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
