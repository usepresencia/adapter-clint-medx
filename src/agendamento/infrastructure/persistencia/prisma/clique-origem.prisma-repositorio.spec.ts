import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import { CliqueOrigemPrismaRepositorio } from './clique-origem.prisma-repositorio';

describe('CliqueOrigemPrismaRepositorio', () => {
    const prisma = new PrismaService();
    const repo = new CliqueOrigemPrismaRepositorio(prisma);

    beforeEach(async () => {
        await prisma.onModuleInit();
        await prisma.cliqueOrigem.deleteMany();
    });

    afterAll(async () => {
        await prisma.onModuleDestroy();
    });

    it('cria um clique e devolve pelo código', async () => {
        await repo.criar('ABC12345', {
            fbclid: 'fb.123',
            utmSource: 'meta',
            utmCampaign: 'promo-setembro',
        });

        const clique = await repo.buscarPorCodigo('ABC12345');
        expect(clique).toMatchObject({
            codigo: 'ABC12345',
            fbclid: 'fb.123',
            utmSource: 'meta',
            utmCampaign: 'promo-setembro',
            telefone: null,
        });
    });

    it('devolve null quando o código não existe', async () => {
        expect(await repo.buscarPorCodigo('NAO-EXISTE')).toBeNull();
    });

    it('reivindica um clique associando o telefone', async () => {
        await repo.criar('XYZ98765', { fbclid: 'fb.999' });
        await repo.reivindicar('XYZ98765', '+5511999998888');

        const clique = await repo.buscarPorCodigo('XYZ98765');
        expect(clique?.telefone).toBe('+5511999998888');
    });

    it('busca o clique mais recente por telefone', async () => {
        await repo.criar('AAA11111', { utmSource: 'google' });
        await repo.reivindicar('AAA11111', '+5511999998888');

        await new Promise(resolve => setTimeout(resolve, 10));

        await repo.criar('BBB22222', { utmSource: 'meta' });
        await repo.reivindicar('BBB22222', '+5511999998888');

        const maisRecente = await repo.buscarMaisRecentePorTelefone('+5511999998888');
        expect(maisRecente?.codigo).toBe('BBB22222');
    });

    it('devolve null quando não há clique pro telefone', async () => {
        expect(await repo.buscarMaisRecentePorTelefone('+5511900000000')).toBeNull();
    });

    it('expurga só cliques não reivindicados mais antigos que a retenção', async () => {
        const antigo = new Date();
        antigo.setDate(antigo.getDate() - 100);

        await prisma.cliqueOrigem.create({
            data: { codigo: 'VELHO001', criadoEm: antigo },
        });
        await prisma.cliqueOrigem.create({
            data: { codigo: 'VELHO002', criadoEm: antigo, telefone: '+5511999998888' },
        });
        await repo.criar('NOVO0001', {});

        expect(await repo.expurgarNaoReivindicados(90)).toBe(1);

        expect(await repo.buscarPorCodigo('VELHO001')).toBeNull();
        expect(await repo.buscarPorCodigo('VELHO002')).not.toBeNull();
        expect(await repo.buscarPorCodigo('NOVO0001')).not.toBeNull();
    });
});
