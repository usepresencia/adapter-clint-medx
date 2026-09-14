import { describe, it, expect } from "vitest";
import { RespostaLembrete, VALORES_RESPOSTA } from "../../../../src/api/domain/agendamento/resposta-lembrete.js";
import { ErroDeDominio } from "../../../../src/api/domain/shared/erros.js";

describe("RespostaLembrete.criar", () => {
  it.each(VALORES_RESPOSTA)("aceita %s", (valor) => {
    expect(RespostaLembrete.criar(valor).valor).toBe(valor);
  });

  it("normaliza caixa e espaços", () => {
    expect(RespostaLembrete.criar("  CONFIRMAR ").valor).toBe("confirmar");
  });

  it.each(["talvez", "", "sim"])("rejeita %s", (entrada) => {
    expect(() => RespostaLembrete.criar(entrada)).toThrow(ErroDeDominio);
  });
});

describe("consequências da resposta", () => {
  it("só confirmar escreve no MedX", () => {
    expect(RespostaLembrete.criar("confirmar").exigeEscritaNoMedx).toBe(true);
    expect(RespostaLembrete.criar("reagendar").exigeEscritaNoMedx).toBe(false);
    expect(RespostaLembrete.criar("cancelar").exigeEscritaNoMedx).toBe(false);
  });

  it("reagendar e cancelar vão para a secretária", () => {
    expect(RespostaLembrete.criar("reagendar").exigeAtendimentoHumano).toBe(true);
    expect(RespostaLembrete.criar("cancelar").exigeAtendimentoHumano).toBe(true);
    expect(RespostaLembrete.criar("confirmar").exigeAtendimentoHumano).toBe(false);
  });
});
