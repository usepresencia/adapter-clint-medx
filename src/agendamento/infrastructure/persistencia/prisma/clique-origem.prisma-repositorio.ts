import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import type {
    CliqueOrigem,
    CliqueOrigemRepositorio,
    DadosClique,
} from '../../../domain/clique-origem/clique-origem.repositorio';

@Injectable()
export class CliqueOrigemPrismaRepositorio implements CliqueOrigemRepositorio {
    constructor(private readonly prisma: PrismaService) {}

    async criar(codigo: string, dados: DadosClique): Promise<void> {
        await this.prisma.cliqueOrigem.create({
            data: {
                codigo,
                fbclid: dados.fbclid,
                utmSource: dados.utmSource,
                utmMedium: dados.utmMedium,
                utmCampaign: dados.utmCampaign,
                utmContent: dados.utmContent,
                utmTerm: dados.utmTerm,
            },
        });
    }

    async buscarPorCodigo(codigo: string): Promise<CliqueOrigem | null> {
        const l = await this.prisma.cliqueOrigem.findUnique({ where: { codigo } });
        return l ?? null;
    }

    async reivindicar(codigo: string, telefone: string): Promise<void> {
        await this.prisma.cliqueOrigem.update({ where: { codigo }, data: { telefone } });
    }

    async buscarMaisRecentePorTelefone(telefone: string): Promise<CliqueOrigem | null> {
        const l = await this.prisma.cliqueOrigem.findFirst({
            where: { telefone },
            orderBy: { criadoEm: 'desc' },
        });
        return l ?? null;
    }

    async expurgarNaoReivindicados(dias: number): Promise<number> {
        const limite = new Date();
        limite.setDate(limite.getDate() - dias);
        const resultado = await this.prisma.cliqueOrigem.deleteMany({
            where: { telefone: null, criadoEm: { lt: limite } },
        });
        return resultado.count;
    }
}
