import { Injectable } from '@nestjs/common';
import type {
    AgendaMedicaPort,
    AgendamentoExterno,
    ConsultaDisponibilidade,
    DadosCriacaoAgendamento,
    SlotDisponivel,
} from '../../application/ports/agenda-medica.port';
import { MedxHttpClient } from './medx-http.client';
import type { MedxAgendamento, MedxDisponibilidade } from './medx.tipos';

const BASE = '/api/integration/agenda/agendamentos';

/** Valor exigido pela API do MedX para marcar um agendamento como confirmado. */
export const CONFIRMACAO_LITERAL = 'Mensagem Salva com Sucesso';

function traduzir(cru: MedxAgendamento): AgendamentoExterno {
    return {
        id: cru.id_do_Agendamento,
        idProfissional: cru.id_do_Usuario,
        idPaciente: cru.vinculado_a,
        inicio: cru.inicio,
        fim: cru.final,
        descricao: cru.descricao,
        status: cru.status,
        idTipoConsulta: cru.id_do_Diagnostico_QP,
        confirmacao: cru.confirmacao ?? '',
        ultimaEdicao: cru.lastEditDate ?? '',
        bruto: cru,
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
        const resposta = await this.client.get<MedxAgendamento[] | MedxAgendamento>(
            `${BASE}/${id}`,
        );
        const cru = Array.isArray(resposta) ? resposta[0] : resposta;

        if (!cru) {
            throw new Error(`Agendamento ${id} não encontrado no MedX`);
        }
        return traduzir(cru);
    }

    async consultarDisponibilidade(consulta: ConsultaDisponibilidade): Promise<SlotDisponivel[]> {
        const resposta = await this.client.get<MedxDisponibilidade[]>(
            '/api/integration/agenda/disponibilidade',
            {
                inicio: consulta.inicio,
                fim: consulta.fim,
                proId: consulta.idProfissional,
                intervalo: consulta.duracaoMinutos,
            },
        );

        if (!Array.isArray(resposta)) return [];
        return resposta.map(slot => ({ inicio: slot.De, fim: slot.Ate }));
    }

    async listarPorPaciente(idPaciente: number): Promise<AgendamentoExterno[]> {
        const resposta = await this.client.get<MedxAgendamento[]>(`${BASE}/paciente/${idPaciente}`);
        return Array.isArray(resposta) ? resposta.map(traduzir) : [];
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
