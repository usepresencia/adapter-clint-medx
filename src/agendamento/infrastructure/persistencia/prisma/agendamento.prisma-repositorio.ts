import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import { Agendamento, type StatusAgendamento } from '../../../domain/agendamento/agendamento';
import { PeriodoConsulta } from '../../../domain/agendamento/periodo-consulta';
import type { AgendamentoRepositorio } from '../../../domain/agendamento/agendamento.repositorio';

@Injectable()
export class AgendamentoPrismaRepositorio implements AgendamentoRepositorio {
    constructor(private readonly prisma: PrismaService) {}

    async buscarPorDeal(dealId: string): Promise<Agendamento | null> {
        const l = await this.prisma.agendamento.findUnique({ where: { dealId } });
        if (!l) return null;

        return Agendamento.restaurar({
            dealId: l.dealId,
            idPacienteMedx: l.medxIdCliente,
            idProfissionalMedx: l.medxIdUsuario,
            periodo: PeriodoConsulta.criar(l.inicio, l.duracaoMinutos),
            idMedx: l.medxIdAgendamento,
            status: l.status as StatusAgendamento,
            ultimaEdicaoConhecida: l.ultimaEdicao,
        });
    }

    async salvar(a: Agendamento): Promise<void> {
        await this.prisma.agendamento.upsert({
            where: { dealId: a.dealId },
            create: {
                dealId: a.dealId,
                medxIdAgendamento: a.idMedx,
                medxIdCliente: a.idPacienteMedx,
                medxIdUsuario: a.idProfissionalMedx,
                inicio: a.periodo.inicio,
                duracaoMinutos: a.periodo.duracaoMinutos,
                ultimaEdicao: a.ultimaEdicaoConhecida,
                status: a.status,
            },
            update: {
                medxIdAgendamento: a.idMedx,
                ultimaEdicao: a.ultimaEdicaoConhecida,
                status: a.status,
            },
        });
    }
}
