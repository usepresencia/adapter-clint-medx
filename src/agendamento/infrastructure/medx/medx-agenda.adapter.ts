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
import type { MedxAgendaDetalhe, MedxDisponibilidadeV1 } from './medx.tipos';
import { FORMATO_MEDX, FUSO_CLINICA } from '../../domain/agendamento/periodo-consulta';

const BASE_V1 = '/api/integration/v1/agenda/agendamentos';
/** Limites do MedX para Inicio/Fim (sempre com Fim exclusivo). */
const MAX_DIAS_AGENDAMENTOS = 31;
const MAX_DIAS_DISPONIBILIDADE = 14;

/** Valor exigido pela API do MedX para marcar um agendamento como confirmado. */
export const CONFIRMACAO_LITERAL = 'Mensagem Salva com Sucesso';

function interpretar(iso: string): DateTime {
    const temOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso);
    return temOffset
        ? DateTime.fromISO(iso, { setZone: true }).setZone(FUSO_CLINICA)
        : DateTime.fromISO(iso, { zone: FUSO_CLINICA });
}

/** Divide [inicio, fim) em janelas contíguas de no máximo `maxDias`, no formato local. */
function janelas(inicio: string, fim: string, maxDias: number): Array<[string, string]> {
    const resultado: Array<[string, string]> = [];
    const limite = interpretar(fim);
    let atual = interpretar(inicio);
    while (atual < limite) {
        const fimJanela = DateTime.min(atual.plus({ days: maxDias }), limite);
        resultado.push([atual.toFormat(FORMATO_MEDX), fimJanela.toFormat(FORMATO_MEDX)]);
        atual = fimJanela;
    }
    return resultado;
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

    async criar(dados: DadosCriacaoAgendamento): Promise<number> {
        // `cadastros/criar_agendamento` (e não `operacoes/criar`) porque só ele
        // aceita a descrição que a recepção lê na agenda. Sem `status`: o
        // padrão do MedX é 1, "Agendado" nesta conta.
        const resposta = await this.client.executarOperacao<{ dados?: { id?: number } }>(
            '/api/integration/v1/agenda/cadastros',
            {
                acao: 'criar_agendamento',
                agendamento: {
                    profissionalId: dados.idProfissional,
                    pacienteId: dados.idPaciente,
                    tipoId: dados.idTipoConsulta,
                    inicio: dados.inicio,
                    fim: dados.fim,
                    descricao: dados.descricao,
                },
            },
        );

        const id = Number(resposta?.dados?.id);
        // Ids negativos são válidos nesta conta; só 0/NaN indicam falha. Não
        // serializar a resposta: ela pode trazer o nome da paciente.
        if (!Number.isInteger(id) || id === 0) {
            throw new Error('MedX não devolveu um id de agendamento válido');
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
        // Na v1 o ProfissionalId é obrigatório (sem ele: 400 invalid_id) e o
        // id negativo funciona — o bug da API antiga (lista vazia com id
        // negativo) não existe mais. Confirmado ao vivo em 2026-11-12.
        const slots: SlotDisponivel[] = [];
        for (const [inicio, fim] of janelas(
            consulta.inicio,
            consulta.fim,
            MAX_DIAS_DISPONIBILIDADE,
        )) {
            const resposta = await this.client.get<MedxDisponibilidadeV1 | undefined>(
                '/api/integration/v1/agenda/disponibilidade',
                {
                    ProfissionalId: consulta.idProfissional,
                    Inicio: inicio,
                    Fim: fim,
                    DuracaoMinutos: consulta.duracaoMinutos,
                },
            );
            for (const slot of resposta?.horarios ?? []) {
                slots.push({
                    inicio: paraHorarioLocal(slot.inicio),
                    fim: paraHorarioLocal(slot.fim),
                });
            }
        }
        return slots;
    }

    async listarPorPeriodo(inicio: string, fim: string): Promise<OcupacaoAgenda[]> {
        const porId = new Map<number, MedxAgendaDetalhe>();
        for (const [ini, fimJanela] of janelas(inicio, fim, MAX_DIAS_AGENDAMENTOS)) {
            const itens = await this.client.listarTodos<MedxAgendaDetalhe>(`${BASE_V1}/detalhes`, {
                Inicio: ini,
                Fim: fimJanela,
            });
            for (const item of itens) porId.set(item.id, item);
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
        // Atualização completa: o MedX apaga o que não for reenviado, então
        // tudo sai do detalhe lido (com a `versao` intacta) e só status e
        // confirmação mudam.
        const d = agendamento.bruto as MedxAgendaDetalhe;
        if (!d.profissional || !d.paciente) {
            throw new Error(
                `Agendamento ${d.id} do MedX sem profissional ou paciente — não dá para confirmar`,
            );
        }
        await this.client.executarOperacao('/api/integration/v1/agenda/cadastros', {
            acao: 'atualizar_agendamento',
            agendamento: {
                id: d.id,
                profissionalId: d.profissional.id,
                pacienteId: d.paciente.id,
                tipoId: d.tipo?.id ?? null,
                procedimentoId: d.procedimentoId,
                inicio: d.inicio,
                fim: d.fim,
                status: indiceStatusConfirmado,
                descricao: d.descricao,
                confirmacao: CONFIRMACAO_LITERAL,
                sms: d.sms,
                chegada: d.chegada,
                atendidoEm: d.atendidoEm,
                saiuEm: d.saiuEm,
                versao: d.versao,
            },
        });
    }
}
