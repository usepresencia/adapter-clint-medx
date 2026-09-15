import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AgendamentoPrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/agendamento.prisma-repositorio';

export const AGENDAMENTO_REPOSITORIO = Symbol('AgendamentoRepositorio');

@Global()
@Module({
    providers: [
        PrismaService,
        { provide: AGENDAMENTO_REPOSITORIO, useClass: AgendamentoPrismaRepositorio },
    ],
    exports: [PrismaService, AGENDAMENTO_REPOSITORIO],
})
export class PersistenceModule {}
