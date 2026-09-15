import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import { AgendamentoPrismaRepositorio } from './agendamento.prisma-repositorio';
import { Agendamento } from '../../../domain/agendamento/agendamento';
import { PeriodoConsulta } from '../../../domain/agendamento/periodo-consulta';

const PERIODO = PeriodoConsulta.criar('2026-07-10T14:00:00', 30);

function novoAgendamento() {
    return Agendamento.iniciar({
        dealId: 'deal-1',
        idPacienteMedx: 67890,
        idProfissionalMedx: 43013640,
        periodo: PERIODO,
    });
}

describe('AgendamentoPrismaRepositorio', () => {
    const prisma = new PrismaService();
    const repo = new AgendamentoPrismaRepositorio(prisma);

    beforeEach(async () => {
        await prisma.onModuleInit();
        await prisma.agendamento.deleteMany();
    });

    afterAll(async () => {
        await prisma.onModuleDestroy();
    });

    it('devolve null para deal desconhecido', async () => {
        expect(await repo.buscarPorDeal('x')).toBeNull();
    });

    it('salva e restaura preservando o estado', async () => {
        const a = novoAgendamento();
        a.registrarCriacao(1275002478);
        a.confirmar('2026-07-09T10:00:00');
        await repo.salvar(a);

        const lido = (await repo.buscarPorDeal('deal-1'))!;
        expect(lido.idMedx).toBe(1275002478);
        expect(lido.status).toBe('confirmado');
        expect(lido.ultimaEdicaoConhecida).toBe('2026-07-09T10:00:00');
        expect(lido.idPacienteMedx).toBe(67890);
    });

    it('restaura o período com a duração original', async () => {
        await repo.salvar(novoAgendamento());
        const lido = (await repo.buscarPorDeal('deal-1'))!;
        expect(lido.periodo.inicio).toBe('2026-07-10T14:00:00');
        expect(lido.periodo.fim).toBe('2026-07-10T14:30:00');
    });

    it('salvar duas vezes atualiza em vez de duplicar', async () => {
        const a = novoAgendamento();
        await repo.salvar(a);
        a.registrarCriacao(99);
        await expect(repo.salvar(a)).resolves.not.toThrow();
        expect((await repo.buscarPorDeal('deal-1'))!.idMedx).toBe(99);
    });
});
