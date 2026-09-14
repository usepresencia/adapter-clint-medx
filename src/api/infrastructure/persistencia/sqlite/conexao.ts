import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type { Database };

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS eventos_recebidos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint      TEXT    NOT NULL,
  payload_bruto TEXT    NOT NULL,
  recebido_em   TEXT    NOT NULL,
  status        TEXT    NOT NULL,
  job_id        TEXT,
  erro          TEXT
);

CREATE INDEX IF NOT EXISTS idx_eventos_recebido_em ON eventos_recebidos (recebido_em);

CREATE TABLE IF NOT EXISTS pacientes_correlacao (
  telefone_e164     TEXT    PRIMARY KEY,
  medx_id_cliente   INTEGER NOT NULL,
  clint_contact_id  TEXT,
  match_confiavel   INTEGER NOT NULL,
  criado_em         TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS agendamentos (
  deal_id             TEXT    PRIMARY KEY,
  medx_id_agendamento INTEGER,
  medx_id_cliente     INTEGER NOT NULL,
  medx_id_usuario     INTEGER NOT NULL,
  inicio              TEXT    NOT NULL,
  duracao_minutos     INTEGER NOT NULL,
  ultima_edicao       TEXT,
  status              TEXT    NOT NULL,
  criado_em           TEXT    NOT NULL,
  atualizado_em       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agendamentos_medx_id ON agendamentos (medx_id_agendamento);
`;

export function abrirBanco(caminho: string): Database.Database {
  if (caminho !== ":memory:") {
    mkdirSync(dirname(caminho), { recursive: true });
  }
  const db = new Database(caminho);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(MIGRATIONS);
  return db;
}
