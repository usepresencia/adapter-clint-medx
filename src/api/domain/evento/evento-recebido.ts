export type StatusEvento = "recebido" | "processado" | "invalido" | "falhou";

interface Dados {
  id: number;
  endpoint: string;
  status: StatusEvento;
  erro: string | null;
  jobId: string | null;
}

export class EventoRecebido {
  private constructor(
    readonly id: number,
    readonly endpoint: string,
    private statusInterno: StatusEvento,
    private erroInterno: string | null,
    private jobIdInterno: string | null
  ) {}

  static restaurar(dados: Dados): EventoRecebido {
    return new EventoRecebido(dados.id, dados.endpoint, dados.status, dados.erro, dados.jobId);
  }

  get status(): StatusEvento {
    return this.statusInterno;
  }

  get erro(): string | null {
    return this.erroInterno;
  }

  get jobId(): string | null {
    return this.jobIdInterno;
  }

  marcarProcessado(): void {
    this.statusInterno = "processado";
    this.erroInterno = null;
  }

  marcarInvalido(motivo: string): void {
    this.statusInterno = "invalido";
    this.erroInterno = motivo;
  }

  marcarFalha(erro: string): void {
    this.statusInterno = "falhou";
    this.erroInterno = erro;
  }

  associarJob(jobId: string): void {
    this.jobIdInterno = jobId;
  }
}
