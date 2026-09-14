import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { abrirBanco } from "../../../../../src/api/infrastructure/persistencia/sqlite/conexao.js";

describe("abrirBanco", () => {
  it("cria as três tabelas do adapter", () => {
    const nomes = abrirBanco(":memory:")
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((l: any) => l.name);

    for (const tabela of ["eventos_recebidos", "pacientes_correlacao", "agendamentos"]) {
      expect(nomes).toContain(tabela);
    }
  });

  it("impede dois agendamentos para o mesmo deal_id", () => {
    const db = abrirBanco(":memory:");
    const inserir = db.prepare(
      `INSERT INTO agendamentos (deal_id, medx_id_cliente, medx_id_usuario, inicio, duracao_minutos, status, criado_em, atualizado_em)
       VALUES (?, 1, 2, '2026-07-10T14:00:00', 30, 'enviando', datetime('now'), datetime('now'))`
    );
    inserir.run("deal-1");
    expect(() => inserir.run("deal-1")).toThrow(/UNIQUE/);
  });

  it("impede dois pacientes com o mesmo telefone", () => {
    const db = abrirBanco(":memory:");
    const inserir = db.prepare(
      `INSERT INTO pacientes_correlacao (telefone_e164, medx_id_cliente, match_confiavel, criado_em)
       VALUES (?, 1, 1, datetime('now'))`
    );
    inserir.run("+5511999998888");
    expect(() => inserir.run("+5511999998888")).toThrow(/UNIQUE/);
  });

  it("aplica as migrations duas vezes no mesmo arquivo sem erro", () => {
    const caminho = join(tmpdir(), `adapter-teste-${Date.now()}.sqlite`);
    try {
      expect(() => {
        abrirBanco(caminho).close();
        abrirBanco(caminho).close();
      }).not.toThrow();
    } finally {
      for (const sufixo of ["", "-wal", "-shm"]) {
        rmSync(`${caminho}${sufixo}`, { force: true });
      }
    }
  });
});
