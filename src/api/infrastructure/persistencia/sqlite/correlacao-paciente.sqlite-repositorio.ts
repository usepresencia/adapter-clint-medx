import type Database from "better-sqlite3";
import { CorrelacaoPaciente } from "../../../domain/paciente/correlacao-paciente.js";
import { Telefone } from "../../../domain/paciente/telefone.js";
import type { CorrelacaoPacienteRepositorio } from "../../../domain/paciente/correlacao-paciente.repositorio.js";

export function criarCorrelacaoPacienteRepositorio(
  db: Database.Database
): CorrelacaoPacienteRepositorio {
  return {
    buscarPorTelefone(telefone: Telefone): CorrelacaoPaciente | null {
      const l: any = db
        .prepare("SELECT * FROM pacientes_correlacao WHERE telefone_e164 = ?")
        .get(telefone.e164);
      if (!l) return null;

      return CorrelacaoPaciente.restaurar({
        telefone: Telefone.criar(l.telefone_e164),
        idPacienteMedx: l.medx_id_cliente,
        matchConfiavel: Boolean(l.match_confiavel),
        idContatoClint: l.clint_contact_id,
      });
    },

    salvar(c: CorrelacaoPaciente): void {
      db.prepare(
        `INSERT INTO pacientes_correlacao
           (telefone_e164, medx_id_cliente, clint_contact_id, match_confiavel, criado_em)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(telefone_e164) DO UPDATE SET
           medx_id_cliente  = excluded.medx_id_cliente,
           clint_contact_id = excluded.clint_contact_id,
           match_confiavel  = excluded.match_confiavel`
      ).run(
        c.telefone.e164,
        c.idPacienteMedx,
        c.idContatoClint,
        c.matchConfiavel ? 1 : 0
      );
    },
  };
}
