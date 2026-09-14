import type Database from "better-sqlite3";
import { Agendamento, type StatusAgendamento } from "../../../domain/agendamento/agendamento.js";
import { PeriodoConsulta } from "../../../domain/agendamento/periodo-consulta.js";
import type { AgendamentoRepositorio } from "../../../domain/agendamento/agendamento.repositorio.js";

export function criarAgendamentoRepositorio(db: Database.Database): AgendamentoRepositorio {
  return {
    buscarPorDeal(dealId: string): Agendamento | null {
      const l: any = db.prepare("SELECT * FROM agendamentos WHERE deal_id = ?").get(dealId);
      if (!l) return null;

      return Agendamento.restaurar({
        dealId: l.deal_id,
        idPacienteMedx: l.medx_id_cliente,
        idProfissionalMedx: l.medx_id_usuario,
        periodo: PeriodoConsulta.criar(l.inicio, l.duracao_minutos),
        idMedx: l.medx_id_agendamento,
        status: l.status as StatusAgendamento,
        ultimaEdicaoConhecida: l.ultima_edicao,
      });
    },

    salvar(a: Agendamento): void {
      db.prepare(
        `INSERT INTO agendamentos
           (deal_id, medx_id_agendamento, medx_id_cliente, medx_id_usuario,
            inicio, duracao_minutos, ultima_edicao, status, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(deal_id) DO UPDATE SET
           medx_id_agendamento = excluded.medx_id_agendamento,
           ultima_edicao       = excluded.ultima_edicao,
           status              = excluded.status,
           atualizado_em       = datetime('now')`
      ).run(
        a.dealId,
        a.idMedx,
        a.idPacienteMedx,
        a.idProfissionalMedx,
        a.periodo.inicio,
        a.periodo.duracaoMinutos,
        a.ultimaEdicaoConhecida,
        a.status
      );
    },
  };
}
