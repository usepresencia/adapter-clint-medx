import { describe, it, expect } from 'vitest';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
    it('conecta e permite uma query simples', async () => {
        const prisma = new PrismaService();
        await prisma.onModuleInit();
        const resultado: unknown = await prisma.$queryRaw`SELECT 1 as ok`;
        expect(resultado).toEqual([{ ok: 1 }]);
        await prisma.onModuleDestroy();
    });

    it('as três tabelas existem', async () => {
        const prisma = new PrismaService();
        await prisma.onModuleInit();
        const tabelas: Array<{ table_name: string }> = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `;
        const nomes = tabelas.map(t => t.table_name);
        expect(nomes).toContain('eventos_recebidos');
        expect(nomes).toContain('pacientes_correlacao');
        expect(nomes).toContain('agendamentos');
        await prisma.onModuleDestroy();
    });
});
