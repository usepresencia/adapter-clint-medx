import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import { CorrelacaoPaciente } from '../../../domain/paciente/correlacao-paciente';
import { Telefone } from '../../../domain/paciente/telefone';
import type { CorrelacaoPacienteRepositorio } from '../../../domain/paciente/correlacao-paciente.repositorio';

@Injectable()
export class CorrelacaoPacientePrismaRepositorio implements CorrelacaoPacienteRepositorio {
    constructor(private readonly prisma: PrismaService) {}

    async buscarPorTelefone(telefone: Telefone): Promise<CorrelacaoPaciente | null> {
        const l = await this.prisma.pacienteCorrelacao.findUnique({
            where: { telefoneE164: telefone.e164 },
        });
        if (!l) return null;

        return CorrelacaoPaciente.restaurar({
            telefone: Telefone.criar(l.telefoneE164),
            idPacienteMedx: l.medxIdCliente,
            matchConfiavel: l.matchConfiavel,
            idContatoClint: l.clintContactId,
        });
    }

    async salvar(c: CorrelacaoPaciente): Promise<void> {
        await this.prisma.pacienteCorrelacao.upsert({
            where: { telefoneE164: c.telefone.e164 },
            create: {
                telefoneE164: c.telefone.e164,
                medxIdCliente: c.idPacienteMedx,
                clintContactId: c.idContatoClint,
                matchConfiavel: c.matchConfiavel,
            },
            update: {
                medxIdCliente: c.idPacienteMedx,
                clintContactId: c.idContatoClint,
                matchConfiavel: c.matchConfiavel,
            },
        });
    }
}
