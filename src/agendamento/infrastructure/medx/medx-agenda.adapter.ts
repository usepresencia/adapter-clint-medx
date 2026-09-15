import { Injectable } from '@nestjs/common';
import type {
    AgendaMedicaPort,
    AgendamentoExterno,
    DadosCriacaoAgendamento,
} from '../../application/ports/agenda-medica.port';
import { MedxHttpClient } from './medx-http.client';
import type { MedxAgendamento } from './medx.tipos';

const BASE = '/api/integration/agenda/agendamentos';

/** Valor exigido pela API do MedX para marcar um agendamento como confirmado. */
export const CONFIRMACAO_LITERAL = 'Mensagem Salva com Sucesso';

/** Índice do primeiro rótulo: um agendamento nasce como "Agendado". */
const STATUS_AO_CRIAR = 0;

function traduzir(cru: MedxAgendamento): AgendamentoExterno {
    return {
        id: cru.Id_do_Agendamento,
        idProfissional: cru.Id_do_Usuario,
        idPaciente: cru.Vinculado_a,
        inicio: cru.Inicio,
        fim: cru.Final,
        descricao: cru.Descricao,
        status: cru.Status,
        idTipoConsulta: cru.Id_do_TipoConsulta,
        confirmacao: cru.Confirmacao,
        ultimaEdicao: cru.LastEditDate,
        bruto: cru,
    };
}

@Injectable()
export class MedxAgendaAdapter implements AgendaMedicaPort {
    constructor(private readonly client: MedxHttpClient) {}

    async criar(dados: DadosCriacaoAgendamento): Promise<number> {
        const resposta = await this.client.post<unknown>(BASE, {
            Id_do_Usuario: dados.idProfissional,
            Inicio: dados.inicio,
            Final: dados.fim,
            Descricao: dados.descricao,
            Status: STATUS_AO_CRIAR,
            Vinculado_a: dados.idPaciente,
            Id_do_TipoConsulta: dados.idTipoConsulta,
        });

        const id = Number(resposta);
        if (!Number.isInteger(id) || id <= 0) {
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
        // DEPOIS — a ordem inversa sobrescreveria Status/Confirmacao com o valor
        // antigo, deixando a consulta silenciosamente não confirmada.
        const cru = agendamento.bruto as MedxAgendamento;

        await this.client.put(BASE, {
            ...cru,
            Id_do_Agendamento: agendamento.id,
            Status: indiceStatusConfirmado,
            Confirmacao: CONFIRMACAO_LITERAL,
        });
    }
}
