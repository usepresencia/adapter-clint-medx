import {
    BadRequestException,
    Controller,
    Get,
    Headers,
    Inject,
    Query,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsultarDisponibilidadeUseCase } from '../../application/consultar-disponibilidade/consultar-disponibilidade.usecase';
import type { SlotDisponivel } from '../../application/ports/agenda-medica.port';
import { LOGGER_PORT, type LoggerMinimo } from '../../application/ports/logger.port';
import { ErroDeDominio } from '../../domain/shared/erros';
import { schemaDisponibilidade } from './schemas';

// Endpoint de CONSULTA (não é um webhook de entrada): devolve status HTTP real,
// sem a garantia "sempre 200" dos outros endpoints — o agente de IA que chama
// isso precisa saber se a consulta deu certo ou não.
@Controller('clint/disponibilidade')
export class DisponibilidadeController {
    constructor(
        private readonly usecase: ConsultarDisponibilidadeUseCase,
        private readonly config: ConfigService,
        @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
    ) {}

    @Get()
    async consultar(
        @Headers('x-adapter-secret') segredo: string | undefined,
        @Query() query: unknown,
    ): Promise<{ slots: SlotDisponivel[] }> {
        if (segredo !== this.config.get<string>('ADAPTER_SECRET')) {
            throw new UnauthorizedException();
        }

        const validado = schemaDisponibilidade.safeParse(query);
        if (!validado.success) {
            throw new BadRequestException(
                validado.error.issues.map(i => i.path.join('.')).join(', '),
            );
        }

        try {
            const slots = await this.usecase.executar({
                profissional: validado.data.profissional,
                dataInicio: validado.data.data_inicio,
                dataFim: validado.data.data_fim,
                duracaoMinutos: validado.data.duracao_minutos,
            });
            return { slots };
        } catch (erro) {
            if (erro instanceof ErroDeDominio || /não encontrado/i.test((erro as Error).message)) {
                throw new BadRequestException((erro as Error).message);
            }
            this.logger.error(
                { erro: (erro as Error).message },
                'falha ao consultar disponibilidade no MedX',
            );
            throw erro;
        }
    }
}
