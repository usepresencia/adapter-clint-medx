import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AgendamentoPrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/agendamento.prisma-repositorio';
import { CorrelacaoPacientePrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/correlacao-paciente.prisma-repositorio';
import { EventoPrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/evento.prisma-repositorio';
import { CliqueOrigemPrismaRepositorio } from '../../agendamento/infrastructure/persistencia/prisma/clique-origem.prisma-repositorio';

import { AGENDAMENTO_REPOSITORIO } from '../../agendamento/domain/agendamento/agendamento.repositorio';
import { CORRELACAO_PACIENTE_REPOSITORIO } from '../../agendamento/domain/paciente/correlacao-paciente.repositorio';
import { EVENTO_REPOSITORIO } from '../../agendamento/domain/evento/evento.repositorio';
import { CLIQUE_ORIGEM_REPOSITORIO } from '../../agendamento/domain/clique-origem/clique-origem.repositorio';

@Global()
@Module({
    providers: [
        PrismaService,
        { provide: AGENDAMENTO_REPOSITORIO, useClass: AgendamentoPrismaRepositorio },
        { provide: CORRELACAO_PACIENTE_REPOSITORIO, useClass: CorrelacaoPacientePrismaRepositorio },
        { provide: EVENTO_REPOSITORIO, useClass: EventoPrismaRepositorio },
        { provide: CLIQUE_ORIGEM_REPOSITORIO, useClass: CliqueOrigemPrismaRepositorio },
    ],
    exports: [
        PrismaService,
        AGENDAMENTO_REPOSITORIO,
        CORRELACAO_PACIENTE_REPOSITORIO,
        EVENTO_REPOSITORIO,
        CLIQUE_ORIGEM_REPOSITORIO,
    ],
})
export class PersistenceModule {}
