import { describe, it, expect } from "vitest";
import { CorrelacaoPaciente } from "../../../../src/api/domain/paciente/correlacao-paciente.js";
import { Telefone } from "../../../../src/api/domain/paciente/telefone.js";

const TELEFONE = Telefone.criar("11999998888");

describe("CorrelacaoPaciente", () => {
  it("exige revisão quando o match não é confiável", () => {
    const c = CorrelacaoPaciente.criar({
      telefone: TELEFONE,
      idPacienteMedx: 67890,
      matchConfiavel: false,
      idContatoClint: null,
    });
    expect(c.exigeRevisao).toBe(true);
  });

  it("não exige revisão quando o match é confiável", () => {
    const c = CorrelacaoPaciente.criar({
      telefone: TELEFONE,
      idPacienteMedx: 67890,
      matchConfiavel: true,
      idContatoClint: "c1",
    });
    expect(c.exigeRevisao).toBe(false);
    expect(c.idContatoClint).toBe("c1");
  });

  it("restaura preservando o telefone como value object", () => {
    const c = CorrelacaoPaciente.restaurar({
      telefone: TELEFONE,
      idPacienteMedx: 1,
      matchConfiavel: true,
      idContatoClint: null,
    });
    expect(c.telefone.igual(TELEFONE)).toBe(true);
  });
});
