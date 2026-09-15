import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import { CorrelacaoPacientePrismaRepositorio } from './correlacao-paciente.prisma-repositorio';
import { CorrelacaoPaciente } from '../../../domain/paciente/correlacao-paciente';
import { Telefone } from '../../../domain/paciente/telefone';

const TELEFONE = Telefone.criar('11999998888');

describe('CorrelacaoPacientePrismaRepositorio', () => {
    const prisma = new PrismaService();
    const repo = new CorrelacaoPacientePrismaRepositorio(prisma);

    beforeEach(async () => {
        await prisma.onModuleInit();
        await prisma.pacienteCorrelacao.deleteMany();
    });

    afterAll(async () => {
        await prisma.onModuleDestroy();
    });

    it('devolve null para telefone desconhecido', async () => {
        expect(await repo.buscarPorTelefone(TELEFONE)).toBeNull();
    });

    it('salva e recupera pelo value object Telefone', async () => {
        await repo.salvar(
            CorrelacaoPaciente.criar({
                telefone: TELEFONE,
                idPacienteMedx: 67890,
                matchConfiavel: false,
                idContatoClint: 'c1',
            }),
        );

        const lido = (await repo.buscarPorTelefone(Telefone.criar('+55 11 99999-8888')))!;
        expect(lido.idPacienteMedx).toBe(67890);
        expect(lido.exigeRevisao).toBe(true);
        expect(lido.idContatoClint).toBe('c1');
    });

    it('salvar duas vezes para o mesmo telefone atualiza em vez de duplicar', async () => {
        await repo.salvar(
            CorrelacaoPaciente.criar({
                telefone: TELEFONE,
                idPacienteMedx: 1,
                matchConfiavel: true,
                idContatoClint: null,
            }),
        );
        await repo.salvar(
            CorrelacaoPaciente.criar({
                telefone: TELEFONE,
                idPacienteMedx: 2,
                matchConfiavel: true,
                idContatoClint: null,
            }),
        );
        const lido = (await repo.buscarPorTelefone(TELEFONE))!;
        expect(lido.idPacienteMedx).toBe(2);
    });
});
