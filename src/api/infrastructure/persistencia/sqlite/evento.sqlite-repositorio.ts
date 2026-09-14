import type Database from "better-sqlite3";
import { EventoRecebido, type StatusEvento } from "../../../domain/evento/evento-recebido.js";
import type { EventoRepositorio } from "../../../domain/evento/evento.repositorio.js";

export function criarEventoRepositorio(db: Database.Database): EventoRepositorio {
  return {
    registrar(endpoint: string, payload: unknown): EventoRecebido {
      const info = db
        .prepare(
          `INSERT INTO eventos_recebidos (endpoint, payload_bruto, recebido_em, status)
           VALUES (?, ?, datetime('now'), 'recebido')`
        )
        .run(endpoint, JSON.stringify(payload));

      return EventoRecebido.restaurar({
        id: Number(info.lastInsertRowid),
        endpoint,
        status: "recebido" as StatusEvento,
        erro: null,
        jobId: null,
      });
    },

    salvar(evento: EventoRecebido): void {
      db.prepare(
        "UPDATE eventos_recebidos SET status = ?, erro = ?, job_id = ? WHERE id = ?"
      ).run(evento.status, evento.erro, evento.jobId, evento.id);
    },

    expurgar(dias: number): number {
      return db
        .prepare(
          `DELETE FROM eventos_recebidos
           WHERE recebido_em < datetime('now', '-' || ? || ' days')`
        )
        .run(dias).changes;
    },

    registrarExistente(id: number): EventoRecebido {
      const l: any = db.prepare("SELECT * FROM eventos_recebidos WHERE id = ?").get(id);
      if (!l) {
        throw new Error(`Evento ${id} não encontrado`);
      }
      return EventoRecebido.restaurar({
        id: l.id,
        endpoint: l.endpoint,
        status: l.status as StatusEvento,
        erro: l.erro,
        jobId: l.job_id,
      });
    },
  };
}
