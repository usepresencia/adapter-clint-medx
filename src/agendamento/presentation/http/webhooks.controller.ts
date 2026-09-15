import { Body, Controller, HttpCode, Headers, Inject, Post, UseFilters } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FILA_PORT, type FilaPort, type JobAdapter } from '../../application/ports/fila.port';
import { LOGGER_PORT, type LoggerMinimo } from '../../application/ports/logger.port';
import type { EventoRepositorio } from '../../domain/evento/evento.repositorio';
import { EVENTO_REPOSITORIO } from '../../../shared/persistence/persistence.module';
import { schemaAgendamento, schemaResposta } from './schemas';
import { WebhookAlwaysOkFilter } from './webhook-always-ok.filter';

type ResultadoValidacao = { ok: true; job: JobAdapter } | { ok: false; motivo: string };

@Controller('webhooks/clint')
@UseFilters(WebhookAlwaysOkFilter)
export class WebhooksController {
    constructor(
        @Inject(FILA_PORT) private readonly fila: FilaPort,
        @Inject(EVENTO_REPOSITORIO) private readonly eventos: EventoRepositorio,
        @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
        private readonly config: ConfigService,
    ) {}

    @Post('agendamento')
    @HttpCode(200)
    async agendamento(
        @Headers('x-adapter-secret') segredo: string | undefined,
        @Body() body: unknown,
    ): Promise<{ ok: true }> {
        return this.receber(body, segredo, '/webhooks/clint/agendamento', payload => {
            const validado = schemaAgendamento.safeParse(payload);
            if (!validado.success) {
                return {
                    ok: false,
                    motivo: validado.error.issues.map(i => i.path.join('.')).join(', '),
                };
            }
            const p = validado.data;
            return {
                ok: true,
                job: {
                    tipo: 'agendamento',
                    eventoId: 0,
                    comando: {
                        dealId: p.deal_id,
                        nome: p.nome,
                        telefone: p.telefone,
                        dataNascimento: p.data_nascimento,
                        dataHora: p.data_hora,
                        profissional: p.profissional,
                        tipoConsulta: p.tipo_consulta,
                        cpf: p.cpf,
                        email: p.email,
                        sexo: p.sexo,
                        cidade: p.cidade,
                        endereco: p.endereco,
                        cep: p.cep,
                    },
                },
            };
        });
    }

    @Post('resposta-lembrete')
    @HttpCode(200)
    async respostaLembrete(
        @Headers('x-adapter-secret') segredo: string | undefined,
        @Body() body: unknown,
    ): Promise<{ ok: true }> {
        return this.receber(body, segredo, '/webhooks/clint/resposta-lembrete', payload => {
            const validado = schemaResposta.safeParse(payload);
            if (!validado.success) {
                return {
                    ok: false,
                    motivo: validado.error.issues.map(i => i.path.join('.')).join(', '),
                };
            }
            const p = validado.data;
            return {
                ok: true,
                job: {
                    tipo: 'resposta',
                    eventoId: 0,
                    comando: {
                        dealId: p.deal_id,
                        idAgendamentoMedx: p.id_agendamento_medx,
                        resposta: p.resposta,
                    },
                },
            };
        });
    }

    private async receber(
        body: unknown,
        segredo: string | undefined,
        endpoint: string,
        montarJob: (payload: unknown) => ResultadoValidacao,
    ): Promise<{ ok: true }> {
        const OK = { ok: true as const };

        if (segredo !== this.config.get<string>('ADAPTER_SECRET')) {
            this.logger.warn({ endpoint }, 'webhook recusado por segredo inválido');
            return OK;
        }

        const evento = await this.eventos.registrar(endpoint, body);
        const resultado = montarJob(body);

        if (!resultado.ok) {
            evento.marcarInvalido(resultado.motivo);
            await this.eventos.salvar(evento);
            this.logger.warn({ evento_id: evento.id, endpoint }, 'payload inválido');
            return OK;
        }

        try {
            const criado = await this.fila.add(resultado.job.tipo, {
                ...resultado.job,
                eventoId: evento.id,
            });
            if (criado.id) {
                evento.associarJob(criado.id);
                await this.eventos.salvar(evento);
            }
        } catch (erro) {
            evento.marcarFalha(`não foi possível enfileirar: ${(erro as Error).message}`);
            await this.eventos.salvar(evento);
            this.logger.error(
                { alerta: true, evento_id: evento.id },
                'fila indisponível — evento gravado para reprocessar',
            );
        }

        return OK;
    }
}
