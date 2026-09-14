import { describe, it, expect } from "vitest";
import { abrirBanco } from "../../../../../src/api/infrastructure/persistencia/sqlite/conexao.js";
import { criarAgendamentoRepositorio } from "../../../../../src/api/infrastructure/persistencia/sqlite/agendamento.sqlite-repositorio.js";
import { criarCorrelacaoPacienteRepositorio } from "../../../../../src/api/infrastructure/persistencia/sqlite/correlacao-paciente.sqlite-repositorio.js";
import { criarEventoRepositorio } from "../../../../../src/api/infrastructure/persistencia/sqlite/evento.sqlite-repositorio.js";
import { Agendamento } from "../../../../../src/api/domain/agendamento/agendamento.js";
import { PeriodoConsulta } from "../../../../../src/api/domain/agendamento/periodo-consulta.js";
import { CorrelacaoPaciente } from "../../../../../src/api/domain/paciente/correlacao-paciente.js";
import { Telefone } from "../../../../../src/api/domain/paciente/telefone.js";

const PERIODO = PeriodoConsulta.criar("2026-07-10T14:00:00", 30);
const TELEFONE = Telefone.criar("11999998888");

function novoAgendamento() {
  return Agendamento.iniciar({
    dealId: "deal-1",
    idPacienteMedx: 67890,
    idProfissionalMedx: 43013640,
    periodo: PERIODO,
  });
}

describe("agendamento", () => {
  it("devolve null para deal desconhecido", () => {
    expect(criarAgendamentoRepositorio(abrirBanco(":memory:")).buscarPorDeal("x")).toBeNull();
  });

  it("salva e restaura preservando o estado", () => {
    const repo = criarAgendamentoRepositorio(abrirBanco(":memory:"));
    const a = novoAgendamento();
    a.registrarCriacao(1275002478);
    a.confirmar("2026-07-09T10:00:00");
    repo.salvar(a);

    const lido = repo.buscarPorDeal("deal-1")!;
    expect(lido.idMedx).toBe(1275002478);
    expect(lido.status).toBe("confirmado");
    expect(lido.ultimaEdicaoConhecida).toBe("2026-07-09T10:00:00");
    expect(lido.idPacienteMedx).toBe(67890);
  });

  it("restaura o período com a duração original", () => {
    const repo = criarAgendamentoRepositorio(abrirBanco(":memory:"));
    repo.salvar(novoAgendamento());
    const lido = repo.buscarPorDeal("deal-1")!;
    expect(lido.periodo.inicio).toBe("2026-07-10T14:00:00");
    expect(lido.periodo.fim).toBe("2026-07-10T14:30:00");
  });

  it("salvar duas vezes atualiza em vez de duplicar", () => {
    const repo = criarAgendamentoRepositorio(abrirBanco(":memory:"));
    const a = novoAgendamento();
    repo.salvar(a);
    a.registrarCriacao(99);
    expect(() => repo.salvar(a)).not.toThrow();
    expect(repo.buscarPorDeal("deal-1")!.idMedx).toBe(99);
  });
});

describe("correlação de paciente", () => {
  it("devolve null para telefone desconhecido", () => {
    const repo = criarCorrelacaoPacienteRepositorio(abrirBanco(":memory:"));
    expect(repo.buscarPorTelefone(TELEFONE)).toBeNull();
  });

  it("salva e recupera pelo value object Telefone", () => {
    const repo = criarCorrelacaoPacienteRepositorio(abrirBanco(":memory:"));
    repo.salvar(
      CorrelacaoPaciente.criar({
        telefone: TELEFONE,
        idPacienteMedx: 67890,
        matchConfiavel: false,
        idContatoClint: "c1",
      })
    );

    const lido = repo.buscarPorTelefone(Telefone.criar("+55 11 99999-8888"))!;
    expect(lido.idPacienteMedx).toBe(67890);
    expect(lido.exigeRevisao).toBe(true);
    expect(lido.idContatoClint).toBe("c1");
  });
});

describe("evento", () => {
  it("registra devolvendo a entidade com id", () => {
    const repo = criarEventoRepositorio(abrirBanco(":memory:"));
    const e = repo.registrar("/webhooks/clint/agendamento", { deal_id: "d1" });
    expect(e.id).toBeGreaterThan(0);
    expect(e.status).toBe("recebido");
  });

  it("persiste a transição para falhou com o erro", () => {
    const db = abrirBanco(":memory:");
    const repo = criarEventoRepositorio(db);
    const e = repo.registrar("/x", {});
    e.marcarFalha("MedX fora do ar");
    repo.salvar(e);

    const linha: any = db.prepare("SELECT status, erro FROM eventos_recebidos WHERE id = ?").get(e.id);
    expect(linha.status).toBe("falhou");
    expect(linha.erro).toBe("MedX fora do ar");
  });

  it("expurga eventos mais antigos que a retenção", () => {
    const db = abrirBanco(":memory:");
    const repo = criarEventoRepositorio(db);
    db.prepare(
      `INSERT INTO eventos_recebidos (endpoint, payload_bruto, recebido_em, status)
       VALUES ('/x', '{}', datetime('now', '-100 days'), 'processado')`
    ).run();
    repo.registrar("/x", {});
    expect(repo.expurgar(90)).toBe(1);
  });

  it("grava o job associado", () => {
    const db = abrirBanco(":memory:");
    const repo = criarEventoRepositorio(db);
    const e = repo.registrar("/x", {});
    e.associarJob("job-1");
    repo.salvar(e);

    const linha: any = db.prepare("SELECT job_id, status FROM eventos_recebidos WHERE id = ?").get(e.id);
    expect(linha.job_id).toBe("job-1");
  });
});
