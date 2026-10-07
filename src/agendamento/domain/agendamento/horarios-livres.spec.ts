import { describe, it, expect } from 'vitest';
import { calcularHorariosLivres, type Intervalo } from './horarios-livres';

function blocos(dia: string, horas: string[]): Intervalo[] {
    return horas.map(h => {
        const [hh, mm] = h.split(':').map(Number);
        const fimMin = hh! * 60 + mm! + 30;
        const fim = `${String(Math.floor(fimMin / 60)).padStart(2, '0')}:${String(fimMin % 60).padStart(2, '0')}`;
        return { inicio: `${dia}T${h}:00`, fim: `${dia}T${fim}:00` };
    });
}

const DIA = '2026-10-07';
const MADRUGADA = `${DIA}T00:00:00`;

describe('calcularHorariosLivres', () => {
    it('monta consultas de 60 min a partir de blocos de 30 min consecutivos, começando no :00 e no :30', () => {
        const livres = calcularHorariosLivres({
            blocos: blocos(DIA, ['08:00', '08:30', '09:00', '09:30']),
            ocupados: [],
            duracaoMinutos: 60,
            agora: MADRUGADA,
        });

        expect(livres).toEqual([
            { inicio: `${DIA}T08:00:00`, fim: `${DIA}T09:00:00` },
            { inicio: `${DIA}T08:30:00`, fim: `${DIA}T09:30:00` },
            { inicio: `${DIA}T09:00:00`, fim: `${DIA}T10:00:00` },
        ]);
    });

    it('um agendamento de 10 min ocupa só o bloco de 30 min em que cai', () => {
        const livres = calcularHorariosLivres({
            blocos: blocos(DIA, ['13:00', '13:30', '14:00', '14:30']),
            ocupados: [{ inicio: `${DIA}T13:30:00`, fim: `${DIA}T13:40:00` }],
            duracaoMinutos: 60,
            agora: MADRUGADA,
        });

        expect(livres).toEqual([{ inicio: `${DIA}T14:00:00`, fim: `${DIA}T15:00:00` }]);
    });

    it('um agendamento que atravessa dois blocos ocupa os dois', () => {
        const livres = calcularHorariosLivres({
            blocos: blocos(DIA, ['09:00', '09:30', '10:00', '10:30', '11:00']),
            ocupados: [{ inicio: `${DIA}T09:20:00`, fim: `${DIA}T10:10:00` }],
            duracaoMinutos: 60,
            agora: MADRUGADA,
        });

        expect(livres).toEqual([{ inicio: `${DIA}T10:30:00`, fim: `${DIA}T11:30:00` }]);
    });

    it('não junta blocos separados por um intervalo fora da grade (ex.: almoço)', () => {
        const livres = calcularHorariosLivres({
            blocos: blocos(DIA, ['11:30', '13:00']),
            ocupados: [],
            duracaoMinutos: 60,
            agora: MADRUGADA,
        });

        expect(livres).toEqual([]);
    });

    it('não oferece horário que já começou ou passou', () => {
        const livres = calcularHorariosLivres({
            blocos: blocos(DIA, ['08:00', '08:30', '09:00', '09:30', '10:00']),
            ocupados: [],
            duracaoMinutos: 60,
            agora: `${DIA}T09:10:00`,
        });

        expect(livres).toEqual([{ inicio: `${DIA}T09:30:00`, fim: `${DIA}T10:30:00` }]);
    });

    it('um agendamento sem duração (fim igual ao início) ainda ocupa o bloco em que cai', () => {
        const livres = calcularHorariosLivres({
            blocos: blocos(DIA, ['15:00', '15:30', '16:00']),
            ocupados: [{ inicio: `${DIA}T15:30:00`, fim: `${DIA}T15:30:00` }],
            duracaoMinutos: 30,
            agora: MADRUGADA,
        });

        expect(livres).toEqual([
            { inicio: `${DIA}T15:00:00`, fim: `${DIA}T15:30:00` },
            { inicio: `${DIA}T16:00:00`, fim: `${DIA}T16:30:00` },
        ]);
    });

    it('aceita blocos fora de ordem e devolve os horários ordenados', () => {
        const livres = calcularHorariosLivres({
            blocos: blocos(DIA, ['10:30', '10:00']),
            ocupados: [],
            duracaoMinutos: 60,
            agora: MADRUGADA,
        });

        expect(livres).toEqual([{ inicio: `${DIA}T10:00:00`, fim: `${DIA}T11:00:00` }]);
    });
});
