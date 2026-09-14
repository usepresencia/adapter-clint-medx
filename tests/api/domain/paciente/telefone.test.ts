import { describe, it, expect } from "vitest";
import { Telefone } from "../../../../src/api/domain/paciente/telefone.js";
import { ErroDeDominio } from "../../../../src/api/domain/shared/erros.js";

describe("Telefone.criar", () => {
  it.each([
    ["+55 11 99999-8888", "+5511999998888", "11999998888"],
    ["5511999998888", "+5511999998888", "11999998888"],
    ["11999998888", "+5511999998888", "11999998888"],
    ["(11) 99999-8888", "+5511999998888", "11999998888"],
  ])("normaliza %s", (entrada, e164, nacional) => {
    const t = Telefone.criar(entrada);
    expect(t.e164).toBe(e164);
    expect(t.nacional).toBe(nacional);
  });

  it("preserva fixos de 8 dígitos sem inventar o nono", () => {
    expect(Telefone.criar("1133334444").nacional).toBe("1133334444");
  });

  it.each(["99998888", "", "123"])("rejeita %s por não ter DDD", (entrada) => {
    expect(() => Telefone.criar(entrada)).toThrow(ErroDeDominio);
  });

  it("considera iguais dois telefones escritos de formas diferentes", () => {
    expect(Telefone.criar("+55 11 99999-8888").igual(Telefone.criar("11999998888"))).toBe(true);
  });

  it("distingue telefones diferentes", () => {
    expect(Telefone.criar("11999998888").igual(Telefone.criar("11999998887"))).toBe(false);
  });
});
