import { Inject } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Worker, type Job } from 'bullmq';
import { LOGGER_PORT, type LoggerMinimo } from '../../application/ports/logger.port';
import type { JobAdapter } from '../../application/ports/fila.port';
import type { EventoRepositorio } from '../../domain/evento/evento.repositorio';
import { AgendarConsultaUseCase } from '../../application/agendar-consulta/agendar-consulta.usecase';
import { ProcessarRespostaUseCase } from '../../application/processar-resposta-lembrete/processar-resposta.usecase';
import { ProcessarLeadOrigemUseCase } from '../../application/processar-lead-origem/processar-lead-origem.usecase';
import { ProcessarVendaGanhaUseCase } from '../../application/processar-venda-ganha/processar-venda-ganha.usecase';
import { EVENTO_REPOSITORIO } from '../../../shared/persistence/persistence.module';
import { ErroRateLimit } from '../medx/medx.erros';
import { LIMITER, NOME_FILA } from './fila.constants';

@Processor(NOME_FILA, { concurrency: 1, limiter: LIMITER })
export class AdapterProcessor extends WorkerHost {
    constructor(
        @Inject(EVENTO_REPOSITORIO) private readonly eventos: EventoRepositorio,
        private readonly agendarConsulta: AgendarConsultaUseCase,
        private readonly processarResposta: ProcessarRespostaUseCase,
        private readonly processarLeadOrigem: ProcessarLeadOrigemUseCase,
        private readonly processarVendaGanha: ProcessarVendaGanhaUseCase,
        @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
    ) {
        super();
    }

    async process(job: Job<JobAdapter>): Promise<void> {
        const dados = job.data;
        const evento = await this.eventos.buscarPorId(dados.eventoId);

        try {
            if (dados.tipo === 'agendamento') {
                await this.agendarConsulta.executar(dados.comando);
            } else if (dados.tipo === 'resposta') {
                await this.processarResposta.executar(dados.comando);
            } else if (dados.tipo === 'lead-origem') {
                await this.processarLeadOrigem.executar(dados.comando);
            } else {
                await this.processarVendaGanha.executar(dados.comando);
            }

            evento.marcarProcessado();
            await this.eventos.salvar(evento);

            this.logger.info({ evento_id: dados.eventoId, tipo: dados.tipo }, 'job processado');
        } catch (erro) {
            if (erro instanceof ErroRateLimit) {
                // Um 429 não é falha real do job: devolve o job para "wait" respeitando
                // o Retry-After do MedX, sem consumir tentativa nem poluir a auditoria
                // com um evento que não falhou de verdade.
                this.logger.warn(
                    { evento_id: dados.eventoId, esperar: erro.esperarSegundos },
                    'rate limit do MedX — job devolvido para a fila sem consumir tentativa',
                );
                await this.worker.rateLimit(erro.esperarSegundos * 1000);
                throw Worker.RateLimitError();
            }

            const mensagem = erro instanceof Error ? erro.message : String(erro);

            evento.marcarFalha(mensagem);
            await this.eventos.salvar(evento);

            this.logger.error({ evento_id: dados.eventoId, erro: mensagem }, 'job falhou');

            throw erro;
        }
    }

    @OnWorkerEvent('failed')
    aoFalhar(job: Job, erro: Error): void {
        const tentativas = job?.attemptsMade ?? 0;
        const maximo = job?.opts?.attempts ?? 0;
        if (tentativas >= maximo) {
            this.logger.error(
                { alerta: true, job_id: job?.id, tentativas, erro: erro.message },
                'job esgotou as tentativas e foi para a dead letter',
            );
        }
    }
}
