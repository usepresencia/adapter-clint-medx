import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { calcularCampoData } from './campos-data';

const em = (iso: string) => DateTime.fromISO(iso, { zone: 'America/Sao_Paulo' });

describe('calcularCampoData', () => {
    it('data_agendamento grava data e hora e vale até o Aguardando Exame', () => {
        const r = calcularCampoData('data_agendamento', '2026-11-13T15:00:00');
        expect(r.campos).toEqual({ data_agendamento: '2026-11-13', hora_agendamento: '15:00' });
        expect(r.momento.toISO()).toBe(em('2026-11-20T09:00:00').toISO());
    });

    it('lembrete usa a regra das 06h e o próprio horário como momento', () => {
        const r = calcularCampoData('horario_lembrete_chegada', '2026-11-13T08:30:00');
        expect(r.campos).toEqual({ horario_lembrete_chegada: '2026-11-13T06:00:00' });
        expect(r.momento.toISO()).toBe(em('2026-11-13T06:00:00').toISO());
    });

    it('checagem 2h depois', () => {
        const r = calcularCampoData('horario_checagem_comparecimento', '2026-11-13T15:00:00');
        expect(r.campos).toEqual({ horario_checagem_comparecimento: '2026-11-13T17:00:00' });
    });
});
