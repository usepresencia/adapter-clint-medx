import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import { EventoPrismaRepositorio } from './evento.prisma-repositorio';

describe('EventoPrismaRepositorio', () => {
    const prisma = new PrismaService();
    const repo = new EventoPrismaRepositorio(prisma);

    beforeEach(async () => {
        await prisma.onModuleInit();
        await prisma.eventoRecebido.deleteMany();
    });

    afterAll(async () => {
        await prisma.onModuleDestroy();
    });

    it('registra devolvendo a entidade com id', async () => {
        const e = await repo.registrar('/webhooks/clint/agendamento', { deal_id: 'd1' });
        expect(e.id).toBeGreaterThan(0);
        expect(e.status).toBe('recebido');
    });

    it('persiste a transição para falhou com o erro', async () => {
        const e = await repo.registrar('/x', {});
        e.marcarFalha('MedX fora do ar');
        await repo.salvar(e);

        const linha = await prisma.eventoRecebido.findUniqueOrThrow({ where: { id: e.id } });
        expect(linha.status).toBe('falhou');
        expect(linha.erro).toBe('MedX fora do ar');
    });

    it('expurga eventos mais antigos que a retenção', async () => {
        const antigo = new Date();
        antigo.setDate(antigo.getDate() - 100);
        await prisma.eventoRecebido.create({
            data: { endpoint: '/x', payloadBruto: {}, status: 'processado', recebidoEm: antigo },
        });
        await repo.registrar('/x', {});
        expect(await repo.expurgar(90)).toBe(1);
    });

    it('grava o job associado', async () => {
        const e = await repo.registrar('/x', {});
        e.associarJob('job-1');
        await repo.salvar(e);

        const linha = await prisma.eventoRecebido.findUniqueOrThrow({ where: { id: e.id } });
        expect(linha.jobId).toBe('job-1');
    });

    it('reconstrói um evento existente por id', async () => {
        const e = await repo.registrar('/x', {});
        const outro = await repo.buscarPorId(e.id);
        expect(outro.id).toBe(e.id);
        expect(outro.status).toBe('recebido');
    });

    it('lança quando o evento não existe', async () => {
        await expect(repo.buscarPorId(999999)).rejects.toThrow(/999999/);
    });
});
