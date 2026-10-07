import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { FORMATO_MEDX, FUSO_CLINICA } from '../../domain/agendamento/periodo-consulta';
import { calcularHorariosLivres } from '../../domain/agendamento/horarios-livres';
import { ErroDeDominio } from '../../domain/shared/erros';
import {
    AGENDA_MEDICA_PORT,
    type AgendaMedicaPort,
    type SlotDisponivel,
} from '../ports/agenda-medica.port';
import { CATALOGO_CLINICO_PORT, type CatalogoClinicoPort } from '../ports/catalogo-clinico.port';
import type { ComandoDisponibilidade } from './consultar-disponibilidade.comando';

const DURACAO_PADRAO_MINUTOS = 60;
/** Granularidade da grade: um agendamento ocupa os blocos de 30 min em que cai. */
const BLOCO_GRADE_MINUTOS = 30;

function limiteDoDia(data: string, borda: 'inicio' | 'fim'): string {
    const dt = DateTime.fromFormat(data, 'yyyy-LL-dd', { zone: FUSO_CLINICA });
    if (!dt.isValid) {
        throw new ErroDeDominio(`Data deve estar no formato YYYY-MM-DD, recebeu: ${data}`);
    }
    return (borda === 'inicio' ? dt.startOf('day') : dt.endOf('day')).toFormat(FORMATO_MEDX);
}

@Injectable()
export class ConsultarDisponibilidadeUseCase {
    agora: () => string = () => DateTime.now().setZone(FUSO_CLINICA).toFormat(FORMATO_MEDX);

    constructor(
        @Inject(CATALOGO_CLINICO_PORT) private readonly catalogo: CatalogoClinicoPort,
        @Inject(AGENDA_MEDICA_PORT) private readonly agenda: AgendaMedicaPort,
    ) {}

    /**
     * A disponibilidade do MedX é só a grade de atendimento — confirmado ao
     * vivo que ela NÃO desconta os agendamentos existentes. Por isso a agenda
     * do período é buscada à parte e descontada aqui.
     */
    async executar(comando: ComandoDisponibilidade): Promise<SlotDisponivel[]> {
        const idProfissional = await this.catalogo.resolverProfissional(comando.profissional);
        const inicio = limiteDoDia(comando.dataInicio, 'inicio');
        const fim = limiteDoDia(comando.dataFim ?? comando.dataInicio, 'fim');

        const [blocos, agendamentos] = await Promise.all([
            this.agenda.consultarDisponibilidade({
                idProfissional,
                inicio,
                fim,
                duracaoMinutos: BLOCO_GRADE_MINUTOS,
            }),
            this.agenda.listarPorPeriodo(inicio, fim),
        ]);

        const liberam = new Set(this.catalogo.indicesStatusQueLiberamHorario());
        const ocupados = agendamentos.filter(
            a => a.idProfissional === idProfissional && !liberam.has(a.status),
        );

        return calcularHorariosLivres({
            blocos,
            ocupados,
            duracaoMinutos: comando.duracaoMinutos ?? DURACAO_PADRAO_MINUTOS,
            agora: this.agora(),
        });
    }
}
