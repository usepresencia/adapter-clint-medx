import type { Telefone } from "./telefone.js";

interface Dados {
  telefone: Telefone;
  idPacienteMedx: number;
  matchConfiavel: boolean;
  idContatoClint: string | null;
}

export class CorrelacaoPaciente {
  private constructor(
    readonly telefone: Telefone,
    readonly idPacienteMedx: number,
    readonly matchConfiavel: boolean,
    readonly idContatoClint: string | null
  ) {}

  static criar(dados: Dados): CorrelacaoPaciente {
    return new CorrelacaoPaciente(
      dados.telefone,
      dados.idPacienteMedx,
      dados.matchConfiavel,
      dados.idContatoClint
    );
  }

  static restaurar(dados: Dados): CorrelacaoPaciente {
    return CorrelacaoPaciente.criar(dados);
  }

  /** Match duvidoso significa risco de ter agendado para o paciente errado. */
  get exigeRevisao(): boolean {
    return !this.matchConfiavel;
  }
}
