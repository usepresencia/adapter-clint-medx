import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(process.cwd(), "src", "api");

function arquivosDe(camada: string): string[] {
  const base = join(RAIZ, camada);
  try {
    return readdirSync(base, { recursive: true, encoding: "utf8" })
      .filter((caminho) => caminho.endsWith(".ts"))
      .map((caminho) => join(base, caminho));
  } catch {
    return []; // camada ainda não existe
  }
}

function importesDe(arquivo: string): string[] {
  const conteudo = readFileSync(arquivo, "utf8");
  return [...conteudo.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
}

function violacoes(camada: string, proibidas: string[]): string[] {
  const encontradas: string[] = [];
  for (const arquivo of arquivosDe(camada)) {
    for (const importado of importesDe(arquivo)) {
      for (const proibida of proibidas) {
        if (importado.includes(`/${proibida}/`) || importado.includes(`${proibida}/`)) {
          encontradas.push(`${arquivo} importa de ${proibida}: ${importado}`);
        }
      }
    }
  }
  return encontradas;
}

describe("regras de dependência entre camadas", () => {
  it("domain não importa de nenhuma outra camada", () => {
    expect(violacoes("domain", ["application", "infrastructure", "presentation", "composition"])).toEqual([]);
  });

  it("application não importa de infrastructure nem de presentation", () => {
    expect(violacoes("application", ["infrastructure", "presentation", "composition"])).toEqual([]);
  });

  it("presentation não importa de infrastructure", () => {
    expect(violacoes("presentation", ["infrastructure"])).toEqual([]);
  });

  it("infrastructure não importa de presentation", () => {
    expect(violacoes("infrastructure", ["presentation"])).toEqual([]);
  });
});
