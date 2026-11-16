import type { ZodType, z } from 'zod';
import { Body, Controller, HttpCode, Headers, Inject, Post, UseFilters } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FILA_PORT, type FilaPort, type JobWebhook } from '../../application/ports/fila.port';
import { LOGGER_PORT, type LoggerMinimo } from '../../application/ports/logger.port';
import type { EventoRepositorio } from '../../domain/evento/evento.repositorio';
import { EVENTO_REPOSITORIO } from '../../domain/evento/evento.repositorio';
import {
    schemaAgendamento,
    schemaResposta,
    schemaLeadOrigem,
    schemaVendaGanha,
    schemaComparecimento,
    schemaRegravarData,
} from './schemas';
import { WebhookAlwaysOkFilter } from './webhook-always-ok.filter';

/**
 * A Clint manda dia e hora da consulta em campos separados. `dia_da_consulta`
 * vem no formato DD/MM/AAAA (é como a Clint serializa o campo DATE do
 * negócio) e precisa virar AAAA-MM-DD antes de virar ISO. `hora_da_consulta`
 * às vezes vem só como "HH:mm"/"HH:mm:ss", às vezes como uma data-hora ISO
 * completa (o dia embutido nela é irrelevante/placeholder — o dia real é
 * sempre `dia_da_consulta`). Se tiver "T", usamos só a parte depois dele.
 */
function combinarDataHora(dia: string, hora: string): string {
    const [diaDoMes, mes, ano] = dia.split('/');
    const diaIso = `${ano}-${mes}-${diaDoMes}`;
    const partes = hora.split('T');
    const horaLimpa = partes.length > 1 ? partes[1] : partes[0];
    return `${diaIso}T${horaLimpa}`;
}

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
    agendamento(@Headers('x-adapter-secret') segredo: string | undefined, @Body() body: unknown) {
        return this.receber('agendamento', body, segredo, schemaAgendamento, p => ({
            tipo: 'agendamento',
            comando: {
                dealId: p.deal_id,
                nome: p.nome,
                telefone: p.telefone,
                dataNascimento: p.data_nascimento,
                dataHora: combinarDataHora(p.dia_da_consulta, p.hora_da_consulta),
                profissional: p.profissional,
                tipoConsulta: p.tipo_consulta,
                email: p.email,
                sexo: p.sexo,
                duracaoConsulta: p.duracao_consulta,
            },
        }));
    }

    @Post('resposta-lembrete')
    @HttpCode(200)
    respostaLembrete(
        @Headers('x-adapter-secret') segredo: string | undefined,
        @Body() body: unknown,
    ) {
        return this.receber('resposta-lembrete', body, segredo, schemaResposta, p => ({
            tipo: 'resposta',
            comando: {
                dealId: p.deal_id,
                idAgendamentoMedx: p.id_agendamento_medx,
                resposta: p.resposta,
                telefone: p.telefone,
            },
        }));
    }

    @Post('lead-origem')
    @HttpCode(200)
    leadOrigem(@Headers('x-adapter-secret') segredo: string | undefined, @Body() body: unknown) {
        return this.receber('lead-origem', body, segredo, schemaLeadOrigem, p => ({
            tipo: 'lead-origem',
            comando: { telefone: p.telefone, textoMensagem: p.texto_mensagem },
        }));
    }

    @Post('venda-ganha')
    @HttpCode(200)
    vendaGanha(@Headers('x-adapter-secret') segredo: string | undefined, @Body() body: unknown) {
        return this.receber('venda-ganha', body, segredo, schemaVendaGanha, p => ({
            tipo: 'venda-ganha',
            comando: { telefone: p.telefone, valor: p.valor },
        }));
    }

    @Post('comparecimento')
    @HttpCode(200)
    comparecimento(
        @Headers('x-adapter-secret') segredo: string | undefined,
        @Body() body: unknown,
    ) {
        return this.receber('comparecimento', body, segredo, schemaComparecimento, p => ({
            tipo: 'comparecimento',
            comando: {
                dealId: p.deal_id,
                idAgendamentoMedx: p.id_agendamento_medx,
                telefone: p.telefone,
            },
        }));
    }

    /** Regravação manual de um campo de data a partir do MedX (o monitor cuida do fluxo normal). */
    @Post('regravar-data')
    @HttpCode(200)
    regravarData(@Headers('x-adapter-secret') segredo: string | undefined, @Body() body: unknown) {
        return this.receber('regravar-data', body, segredo, schemaRegravarData, p => ({
            tipo: 'regravar-data',
            comando: {
                dealId: p.deal_id,
                idAgendamentoMedx: p.id_agendamento_medx,
                campo: p.campo,
            },
        }));
    }

    /**
     * Sempre responde 200 (a Clint não deve reenviar): segredo errado só
     * loga; payload inválido e falha de fila ficam no evento gravado.
     */
    private async receber<S extends ZodType>(
        rota: string,
        body: unknown,
        segredo: string | undefined,
        schema: S,
        montarJob: (payload: z.infer<S>) => JobWebhook,
    ): Promise<{ ok: true }> {
        const OK = { ok: true as const };
        const endpoint = `/webhooks/clint/${rota}`;

        if (segredo !== this.config.get<string>('ADAPTER_SECRET')) {
            this.logger.warn({ endpoint }, 'webhook recusado por segredo inválido');
            return OK;
        }

        const evento = await this.eventos.registrar(endpoint, body);
        const validado = schema.safeParse(body);

        if (!validado.success) {
            evento.marcarInvalido(validado.error.issues.map(i => i.path.join('.')).join(', '));
            await this.eventos.salvar(evento);
            this.logger.warn({ evento_id: evento.id, endpoint }, 'payload inválido');
            return OK;
        }

        const job = montarJob(validado.data);
        try {
            const criado = await this.fila.add(job.tipo, { ...job, eventoId: evento.id });
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
