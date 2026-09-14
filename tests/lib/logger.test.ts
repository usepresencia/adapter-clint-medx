import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { CAMPOS_REDIGIDOS } from "../../lib/logger.js";

function capturar(): { stream: Writable; linhas: string[] } {
  const linhas: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      linhas.push(chunk.toString());
      cb();
    },
  });
  return { stream, linhas };
}

describe("redação de dados pessoais", () => {
  it("oculta cpf, telefone, nome e email dos logs", () => {
    const { stream, linhas } = capturar();
    pino({ redact: CAMPOS_REDIGIDOS }, stream).info(
      { deal_id: "abc", cpf: "12345678910", telefone: "11999998888", nome: "Maria Silva", email: "m@x.com" },
      "agendado"
    );

    const saida = linhas.join("");
    expect(saida).toContain("abc");
    for (const sigiloso of ["12345678910", "11999998888", "Maria Silva", "m@x.com"]) {
      expect(saida).not.toContain(sigiloso);
    }
  });

  it("oculta os mesmos campos quando aninhados", () => {
    const { stream, linhas } = capturar();
    pino({ redact: CAMPOS_REDIGIDOS }, stream).info({ paciente: { cpf: "98765432100", nome: "João" } }, "vinculo");

    const saida = linhas.join("");
    expect(saida).not.toContain("98765432100");
    expect(saida).not.toContain("João");
  });
});
