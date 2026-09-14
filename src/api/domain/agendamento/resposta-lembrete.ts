import { ErroDeDominio } from "../shared/erros.js";

export type ValorResposta = "confirmar" | "reagendar" | "cancelar";

export const VALORES_RESPOSTA: readonly ValorResposta[] = ["confirmar", "reagendar", "cancelar"];

export class RespostaLembrete {
  private constructor(readonly valor: ValorResposta) {}

  static criar(bruto: string): RespostaLembrete {
    const normalizado = (bruto ?? "").trim().toLowerCase();

    if (!VALORES_RESPOSTA.includes(normalizado as ValorResposta)) {
      throw new ErroDeDominio(
        `Resposta de lembrete desconhecida: "${bruto}". Esperado uma de ${VALORES_RESPOSTA.join(", ")}`
      );
    }

    return new RespostaLembrete(normalizado as ValorResposta);
  }

  get exigeEscritaNoMedx(): boolean {
    return this.valor === "confirmar";
  }

  get exigeAtendimentoHumano(): boolean {
    return !this.exigeEscritaNoMedx;
  }
}
