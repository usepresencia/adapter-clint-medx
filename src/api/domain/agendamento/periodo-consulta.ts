import { DateTime } from "luxon";
import { ErroDeDominio } from "../shared/erros.js";

export const FUSO_CLINICA = "America/Sao_Paulo";
const FORMATO_MEDX = "yyyy-LL-dd'T'HH:mm:ss";

function interpretar(valor: string): DateTime | null {
  const temOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(valor);
  const dt = temOffset
    ? DateTime.fromISO(valor, { setZone: true }).setZone(FUSO_CLINICA)
    : DateTime.fromISO(valor, { zone: FUSO_CLINICA });

  return dt.isValid ? dt : null;
}

export class PeriodoConsulta {
  private constructor(
    readonly inicio: string,
    readonly fim: string,
    readonly duracaoMinutos: number
  ) {}

  static criar(inicioIso: string, duracaoMinutos: number): PeriodoConsulta {
    if (!Number.isFinite(duracaoMinutos) || duracaoMinutos <= 0) {
      throw new ErroDeDominio(`Duração da consulta deve ser positiva, recebeu ${duracaoMinutos}`);
    }

    const dt = interpretar(inicioIso);
    if (!dt) {
      throw new ErroDeDominio(`Início da consulta é uma data inválida: ${inicioIso}`);
    }

    return new PeriodoConsulta(
      dt.toFormat(FORMATO_MEDX),
      dt.plus({ minutes: duracaoMinutos }).toFormat(FORMATO_MEDX),
      duracaoMinutos
    );
  }

  comecaEm(outroInicioIso: string): boolean {
    const outro = interpretar(outroInicioIso);
    return outro !== null && outro.toFormat(FORMATO_MEDX) === this.inicio;
  }
}
