import { ErroDeDominio } from "../shared/erros.js";
import type { PeriodoConsulta } from "./periodo-consulta.js";

export type StatusAgendamento = "enviando" | "criado" | "confirmado" | "conflito" | "falhou";

/** Índice do primeiro rótulo do MedX ("Agendado"): um agendamento nasce não confirmado. */
export const STATUS_MEDX_AGENDADO = 0;

export interface EstadoExterno {
  status: number;
  inicio: string;
}

export type AvaliacaoConfirmacao =
  | { permitido: true }
  | { permitido: false; motivo: string };

interface DadosBase {
  dealId: string;
  idPacienteMedx: number;
  idProfissionalMedx: number;
  periodo: PeriodoConsulta;
}

export class Agendamento {
  private constructor(
    readonly dealId: string,
    readonly idPacienteMedx: number,
    readonly idProfissionalMedx: number,
    readonly periodo: PeriodoConsulta,
    private idMedxInterno: number | null,
    private statusInterno: StatusAgendamento,
    private ultimaEdicaoInterna: string | null
  ) {}

  static iniciar(dados: DadosBase): Agendamento {
    return new Agendamento(
      dados.dealId,
      dados.idPacienteMedx,
      dados.idProfissionalMedx,
      dados.periodo,
      null,
      "enviando",
      null
    );
  }

  static restaurar(
    dados: DadosBase & {
      idMedx: number | null;
      status: StatusAgendamento;
      ultimaEdicaoConhecida: string | null;
    }
  ): Agendamento {
    return new Agendamento(
      dados.dealId,
      dados.idPacienteMedx,
      dados.idProfissionalMedx,
      dados.periodo,
      dados.idMedx,
      dados.status,
      dados.ultimaEdicaoConhecida
    );
  }

  get idMedx(): number | null {
    return this.idMedxInterno;
  }

  get status(): StatusAgendamento {
    return this.statusInterno;
  }

  get ultimaEdicaoConhecida(): string | null {
    return this.ultimaEdicaoInterna;
  }

  get jaFoiCriado(): boolean {
    return this.idMedxInterno !== null;
  }

  get jaFoiConfirmado(): boolean {
    return this.statusInterno === "confirmado";
  }

  /** Houve uma tentativa de criação que não chegou a registrar o id — pode haver órfão no MedX. */
  get tentativaInterrompida(): boolean {
    return (
      this.idMedxInterno === null &&
      (this.statusInterno === "enviando" || this.statusInterno === "falhou")
    );
  }

  registrarCriacao(idMedx: number): void {
    if (this.jaFoiCriado) {
      throw new ErroDeDominio(
        `Agendamento ${this.dealId} já tem o id ${this.idMedxInterno} no MedX`
      );
    }
    this.idMedxInterno = idMedx;
    this.statusInterno = "criado";
  }

  adotarExistente(idMedx: number): void {
    this.registrarCriacao(idMedx);
  }

  marcarFalha(): void {
    this.statusInterno = "falhou";
  }

  marcarConflito(): void {
    this.statusInterno = "conflito";
  }

  avaliarConfirmacao(externo: EstadoExterno, indiceConfirmado: number): AvaliacaoConfirmacao {
    if (!this.jaFoiCriado) {
      return { permitido: false, motivo: "agendamento ainda não foi criado no MedX" };
    }

    if (externo.status !== STATUS_MEDX_AGENDADO && externo.status !== indiceConfirmado) {
      return { permitido: false, motivo: "consulta não está mais agendada no MedX" };
    }

    if (!this.periodo.comecaEm(externo.inicio)) {
      return { permitido: false, motivo: "horário da consulta foi alterado desde o lembrete" };
    }

    return { permitido: true };
  }

  confirmar(ultimaEdicao: string): void {
    if (!this.jaFoiCriado) {
      throw new ErroDeDominio(
        `Não é possível confirmar o agendamento ${this.dealId}: ele ainda não existe no MedX`
      );
    }
    this.statusInterno = "confirmado";
    this.ultimaEdicaoInterna = ultimaEdicao;
  }
}
