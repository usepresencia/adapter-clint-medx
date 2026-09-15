import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AgendamentoPrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/agendamento.prisma-repositorio';
import { CorrelacaoPacientePrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/correlacao-paciente.prisma-repositorio';
import { EventoPrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/evento.prisma-repositorio';

export const AGENDAMENTO_REPOSITORIO = Symbol('AgendamentoRepositorio');
export const CORRELACAO_PACIENTE_REPOSITORIO = Symbol('CorrelacaoPacienteRepositorio');
export const EVENTO_REPOSITORIO = Symbol('EventoRepositorio');

@Global()
@Module({
    providers: [
        PrismaService,
        { provide: AGENDAMENTO_REPOSITORIO, useClass: AgendamentoPrismaRepositorio },
        { provide: CORRELACAO_PACIENTE_REPOSITORIO, useClass: CorrelacaoPacientePrismaRepositorio },
        { provide: EVENTO_REPOSITORIO, useClass: EventoPrismaRepositorio },
    ],
    exports: [
        PrismaService,
        AGENDAMENTO_REPOSITORIO,
        CORRELACAO_PACIENTE_REPOSITORIO,
        EVENTO_REPOSITORIO,
    ],
})
export class PersistenceModule {}
