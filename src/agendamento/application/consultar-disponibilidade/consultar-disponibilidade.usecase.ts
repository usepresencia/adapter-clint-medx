import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { FORMATO_MEDX, FUSO_CLINICA } from '../../domain/agendamento/periodo-consulta';
import { ErroDeDominio } from '../../domain/shared/erros';
import {
    AGENDA_MEDICA_PORT,
    type AgendaMedicaPort,
    type SlotDisponivel,
} from '../ports/agenda-medica.port';
import { CATALOGO_CLINICO_PORT, type CatalogoClinicoPort } from '../ports/catalogo-clinico.port';
import type { ComandoDisponibilidade } from './consultar-disponibilidade.comando';

const DURACAO_PADRAO_MINUTOS = 30;

function limiteDoDia(data: string, borda: 'inicio' | 'fim'): string {
    const dt = DateTime.fromFormat(data, 'yyyy-LL-dd', { zone: FUSO_CLINICA });
    if (!dt.isValid) {
        throw new ErroDeDominio(`Data deve estar no formato YYYY-MM-DD, recebeu: ${data}`);
    }
    return (borda === 'inicio' ? dt.startOf('day') : dt.endOf('day')).toFormat(FORMATO_MEDX);
}

@Injectable()
export class ConsultarDisponibilidadeUseCase {
    constructor(
        @Inject(CATALOGO_CLINICO_PORT) private readonly catalogo: CatalogoClinicoPort,
        @Inject(AGENDA_MEDICA_PORT) private readonly agenda: AgendaMedicaPort,
    ) {}

    async executar(comando: ComandoDisponibilidade): Promise<SlotDisponivel[]> {
        const idProfissional = await this.catalogo.resolverProfissional(comando.profissional);
        const dataFim = comando.dataFim ?? comando.dataInicio;

        return this.agenda.consultarDisponibilidade({
            idProfissional,
            inicio: limiteDoDia(comando.dataInicio, 'inicio'),
            fim: limiteDoDia(dataFim, 'fim'),
            duracaoMinutos: comando.duracaoMinutos ?? DURACAO_PADRAO_MINUTOS,
        });
    }
}
