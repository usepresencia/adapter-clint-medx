import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { Relogio } from '../../application/ports/relogio.port';
import { FUSO_CLINICA } from '../../domain/agendamento/periodo-consulta';

@Injectable()
export class RelogioSistema implements Relogio {
    agora(): DateTime {
        return DateTime.now().setZone(FUSO_CLINICA);
    }
}
