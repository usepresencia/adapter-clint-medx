import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AgendamentoPrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/agendamento.prisma-repositorio';
import { CorrelacaoPacientePrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/correlacao-paciente.prisma-repositorio';

export const AGENDAMENTO_REPOSITORIO = Symbol('AgendamentoRepositorio');
export const CORRELACAO_PACIENTE_REPOSITORIO = Symbol('CorrelacaoPacienteRepositorio');

@Global()
@Module({
    providers: [
        PrismaService,
        { provide: AGENDAMENTO_REPOSITORIO, useClass: AgendamentoPrismaRepositorio },
        { provide: CORRELACAO_PACIENTE_REPOSITORIO, useClass: CorrelacaoPacientePrismaRepositorio },
    ],
    exports: [PrismaService, AGENDAMENTO_REPOSITORIO, CORRELACAO_PACIENTE_REPOSITORIO],
})
export class PersistenceModule {}
