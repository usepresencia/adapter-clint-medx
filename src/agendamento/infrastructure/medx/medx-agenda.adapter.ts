import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type {
    AgendaMedicaPort,
    AgendamentoExterno,
    ConsultaDisponibilidade,
    DadosCriacaoAgendamento,
    OcupacaoAgenda,
    SlotDisponivel,
} from '../../application/ports/agenda-medica.port';
import { MedxHttpClient } from './medx-http.client';
import type { MedxAgendaDetalhe, MedxAgendamento, MedxDisponibilidadeV1 } from './medx.tipos';
import { FORMATO_MEDX, FUSO_CLINICA } from '../../domain/agendamento/periodo-consulta';

const BASE = '/api/integration/agenda/agendamentos';
const BASE_V1 = '/api/integration/v1/agenda/agendamentos';
/** Limite do MedX para Inicio/Fim em /agendamentos/detalhes (o Fim é exclusivo). */
const MAX_DIAS_JANELA = 31;

/** Valor exigido pela API do MedX para marcar um agendamento como confirmado. */
export const CONFIRMACAO_LITERAL = 'Mensagem Salva com Sucesso';

function interpretar(iso: string): DateTime {
    const temOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso);
    return temOffset
        ? DateTime.fromISO(iso, { setZone: true }).setZone(FUSO_CLINICA)
        : DateTime.fromISO(iso, { zone: FUSO_CLINICA });
}

/** Horário da API v1 (com offset) para o formato local sem offset usado nos ports. */
export function paraHorarioLocal(iso: string): string {
    return interpretar(iso).toFormat(FORMATO_MEDX);
}

function traduzir(detalhe: MedxAgendaDetalhe): AgendamentoExterno {
    return {
        id: detalhe.id,
        idProfissional: detalhe.profissional?.id ?? 0,
        idPaciente: detalhe.paciente?.id ?? 0,
        inicio: paraHorarioLocal(detalhe.inicio),
        fim: paraHorarioLocal(detalhe.fim),
        descricao: detalhe.descricao ?? '',
        status: detalhe.status.id,
        idTipoConsulta: detalhe.tipo?.id ?? 0,
        confirmacao: detalhe.confirmacao ?? '',
        ultimaEdicao: detalhe.atualizadoEm ?? '',
        bruto: detalhe,
    };
}

@Injectable()
export class MedxAgendaAdapter implements AgendaMedicaPort {
    constructor(private readonly client: MedxHttpClient) {}

    async criar(dados: DadosCriacaoAgendamento, indiceStatusAgendado: number): Promise<number> {
        const resposta = await this.client.post<unknown>(BASE, {
            Id_do_Usuario: dados.idProfissional,
            Inicio: dados.inicio,
            Final: dados.fim,
            Descricao: dados.descricao,
            Status: indiceStatusAgendado,
            Vinculado_a: dados.idPaciente,
            Id_do_TipoConsulta: dados.idTipoConsulta,
        });

        const id = Number(resposta);
        // Ids negativos são válidos nesta conta (confirmado ao vivo — o MedX usa
        // esse esquema também para ids de profissional). Só 0/NaN indicam falha.
        if (!Number.isInteger(id) || id === 0) {
            // Não serializar o corpo da resposta aqui: se o MedX ecoar a Descricao
            // enviada (que contém o nome da paciente), o conteúdo vaza em log/e-mail
            // de alerta sem passar pela redação de PII do pino.
            throw new Error(
                `MedX não devolveu um id de agendamento válido (tipo recebido: ${typeof resposta})`,
            );
        }
        return id;
    }

    async obter(id: number): Promise<AgendamentoExterno> {
        const detalhe = await this.client.get<MedxAgendaDetalhe | undefined>(
            `${BASE_V1}/${id}/detalhes`,
        );
        if (!detalhe?.id) {
            throw new Error(`Agendamento ${id} não encontrado no MedX`);
        }
        return traduzir(detalhe);
    }

    async consultarDisponibilidade(consulta: ConsultaDisponibilidade): Promise<SlotDisponivel[]> {
        // `ProfissionalId` NÃO é enviado: esta conta usa só ids negativos para
        // profissional e o MedX devolvia lista vazia com eles (bug conhecido).
        // A clínica atende com uma profissional; reavaliar se ganhar outra.
        const resposta = await this.client.get<MedxDisponibilidadeV1 | undefined>(
            '/api/integration/v1/agenda/disponibilidade',
            {
                Inicio: consulta.inicio,
                Fim: consulta.fim,
                DuracaoMinutos: consulta.duracaoMinutos,
            },
        );
        return (resposta?.horarios ?? []).map(slot => ({
            inicio: paraHorarioLocal(slot.inicio),
            fim: paraHorarioLocal(slot.fim),
        }));
    }

    async listarPorPeriodo(inicio: string, fim: string): Promise<OcupacaoAgenda[]> {
        const porId = new Map<number, MedxAgendaDetalhe>();
        const limite = interpretar(fim);
        let janela = interpretar(inicio);

        while (janela < limite) {
            const fimJanela = DateTime.min(janela.plus({ days: MAX_DIAS_JANELA }), limite);
            const itens = await this.client.listarTodos<MedxAgendaDetalhe>(`${BASE_V1}/detalhes`, {
                Inicio: janela.toFormat(FORMATO_MEDX),
                Fim: fimJanela.toFormat(FORMATO_MEDX),
            });
            for (const item of itens) porId.set(item.id, item);
            janela = fimJanela;
        }

        return [...porId.values()].map(item => ({
            idProfissional: item.profissional?.id ?? 0,
            inicio: paraHorarioLocal(item.inicio),
            fim: paraHorarioLocal(item.fim),
            status: item.status.id,
        }));
    }

    async listarPorPaciente(idPaciente: number): Promise<AgendamentoExterno[]> {
        const itens = await this.client.listarTodos<MedxAgendaDetalhe>(
            `${BASE_V1}/paciente/${idPaciente}`,
        );
        return itens.map(traduzir);
    }

    async confirmar(
        agendamento: AgendamentoExterno,
        indiceStatusConfirmado: number,
    ): Promise<void> {
        // O PUT não é um PATCH: partimos do payload original para não apagar
        // campos que este port não modela. Spread do bruto PRIMEIRO, overrides
        // DEPOIS — a ordem inversa sobrescreveria status/confirmacao com o valor
        // antigo, deixando a consulta silenciosamente não confirmada.
        //
        // Os nomes de campo aqui (snake_case) batem com o que o GET devolve de
        // verdade, mas o PUT em si ainda não foi testado ao vivo nesta conta —
        // só a criação (POST) foi confirmada. Validar no primeiro teste real.
        const cru = agendamento.bruto as MedxAgendamento;

        await this.client.put(BASE, {
            ...cru,
            id_do_Agendamento: agendamento.id,
            status: indiceStatusConfirmado,
            confirmacao: CONFIRMACAO_LITERAL,
        });
    }
}
