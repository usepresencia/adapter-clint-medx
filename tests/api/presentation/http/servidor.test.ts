import { describe, it, expect, vi } from "vitest";
import { criarServidor } from "../../../../src/api/presentation/http/servidor.js";
import { abrirBanco } from "../../../../src/api/infrastructure/persistencia/sqlite/conexao.js";
import { criarEventoRepositorio } from "../../../../src/api/infrastructure/persistencia/sqlite/evento.sqlite-repositorio.js";

const SEGREDO = "segredo-certo";

const AGENDAMENTO = {
  deal_id: "8feade82-d77b-4e8b-9d35-fd43e972b5c8",
  nome: "Maria Silva",
  telefone: "+5511999998888",
  data_nascimento: "1990-05-20",
  data_hora: "2026-07-10T14:00:00-03:00",
  profissional: "Leize Ferreira",
  tipo_consulta: "Consulta de Rotina",
};

const RESPOSTA = {
  deal_id: AGENDAMENTO.deal_id,
  id_agendamento_medx: 1275002478,
  resposta: "confirmar",
};

function montar(overrides: Record<string, any> = {}) {
  const db = abrirBanco(":memory:");
  const eventos = criarEventoRepositorio(db);
  const deps = {
    segredo: SEGREDO,
    eventos,
    fila: { add: vi.fn(async () => ({ id: "job-1" })) },
    verificarSaude: vi.fn(async () => ({ redis: true, banco: true, medx: true })),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
  const contarEventos = (): number =>
    (db.prepare("SELECT COUNT(*) c FROM eventos_recebidos").get() as any).c;
  const statusUnico = (): string =>
    (db.prepare("SELECT status FROM eventos_recebidos").get() as any).status;

  return { app: criarServidor(deps as any), deps, contarEventos, statusUnico };
}

function postar(app: any, url: string, payload: unknown, segredo?: string) {
  return app.inject({
    method: "POST",
    url,
    headers: segredo ? { "x-adapter-secret": segredo } : {},
    payload,
  });
}

describe("autenticação", () => {
  it("recusa sem o segredo, mas ainda assim com status 200", async () => {
    const { app, deps } = montar();
    const r = await postar(app, "/webhooks/clint/agendamento", AGENDAMENTO);
    expect(r.statusCode).toBe(200);
    expect(deps.fila.add).not.toHaveBeenCalled();
  });

  it("recusa com segredo errado sem enfileirar", async () => {
    const { app, deps } = montar();
    const r = await postar(app, "/webhooks/clint/agendamento", AGENDAMENTO, "errado");
    expect(r.statusCode).toBe(200);
    expect(deps.fila.add).not.toHaveBeenCalled();
  });
});

describe("POST /webhooks/clint/agendamento", () => {
  it("grava o evento, enfileira e responde 200", async () => {
    const { app, deps, contarEventos } = montar();
    const r = await postar(app, "/webhooks/clint/agendamento", AGENDAMENTO, SEGREDO);

    expect(r.statusCode).toBe(200);
    expect(deps.fila.add).toHaveBeenCalledTimes(1);
    expect(contarEventos()).toBe(1);
  });

  it("traduz o payload para o comando da aplicação", async () => {
    const { app, deps } = montar();
    await postar(app, "/webhooks/clint/agendamento", { ...AGENDAMENTO, cpf: "529.982.247-25" }, SEGREDO);

    const job = (deps.fila.add as any).mock.calls[0][1];
    expect(job.tipo).toBe("agendamento");
    expect(job.comando).toMatchObject({
      dealId: AGENDAMENTO.deal_id,
      nome: "Maria Silva",
      telefone: "+5511999998888",
      dataNascimento: "1990-05-20",
      dataHora: "2026-07-10T14:00:00-03:00",
      profissional: "Leize Ferreira",
      tipoConsulta: "Consulta de Rotina",
      cpf: "529.982.247-25",
    });
  });

  it("responde 200 e marca inválido quando falta campo obrigatório", async () => {
    const { app, deps, statusUnico } = montar();
    const { telefone, ...semTelefone } = AGENDAMENTO;
    const r = await postar(app, "/webhooks/clint/agendamento", semTelefone, SEGREDO);

    expect(r.statusCode).toBe(200);
    expect(deps.fila.add).not.toHaveBeenCalled();
    expect(statusUnico()).toBe("invalido");
  });

  it("responde 200 e marca inválido quando deal_id não é um UUID", async () => {
    const { app, deps, statusUnico } = montar();
    const r = await postar(app, "/webhooks/clint/agendamento", { ...AGENDAMENTO, deal_id: "nao-e-uuid" }, SEGREDO);

    expect(r.statusCode).toBe(200);
    expect(deps.fila.add).not.toHaveBeenCalled();
    expect(statusUnico()).toBe("invalido");
  });

  it("responde 200 e marca inválido quando data_nascimento não está em YYYY-MM-DD", async () => {
    const { app, deps, statusUnico } = montar();
    const r = await postar(
      app,
      "/webhooks/clint/agendamento",
      { ...AGENDAMENTO, data_nascimento: "10/07/2026" },
      SEGREDO
    );

    expect(r.statusCode).toBe(200);
    expect(deps.fila.add).not.toHaveBeenCalled();
    expect(statusUnico()).toBe("invalido");
  });

  it("responde 200 mesmo quando a fila está fora do ar", async () => {
    const { app } = montar({
      fila: {
        add: vi.fn(async () => {
          throw new Error("Redis indisponível");
        }),
      },
    });
    const r = await postar(app, "/webhooks/clint/agendamento", AGENDAMENTO, SEGREDO);
    expect(r.statusCode).toBe(200);
  });

  it("responde 200 para JSON malformado", async () => {
    const { app } = montar();
    const r = await app.inject({
      method: "POST",
      url: "/webhooks/clint/agendamento",
      headers: { "x-adapter-secret": SEGREDO, "content-type": "application/json" },
      payload: "{isso não é json",
    });
    expect(r.statusCode).toBe(200);
  });

  it("associa o job ao evento gravado", async () => {
    const { app, deps } = montar();
    await postar(app, "/webhooks/clint/agendamento", AGENDAMENTO, SEGREDO);
    expect(deps.fila.add).toHaveBeenCalled();
  });
});

describe("POST /webhooks/clint/resposta-lembrete", () => {
  it.each(["confirmar", "reagendar", "cancelar"])("aceita a resposta %s", async (resposta) => {
    const { app, deps } = montar();
    const r = await postar(app, "/webhooks/clint/resposta-lembrete", { ...RESPOSTA, resposta }, SEGREDO);

    expect(r.statusCode).toBe(200);
    expect(deps.fila.add).toHaveBeenCalledTimes(1);
  });

  it("marca inválido para resposta fora do enum", async () => {
    const { app, deps, statusUnico } = montar();
    await postar(app, "/webhooks/clint/resposta-lembrete", { ...RESPOSTA, resposta: "talvez" }, SEGREDO);

    expect(deps.fila.add).not.toHaveBeenCalled();
    expect(statusUnico()).toBe("invalido");
  });

  it("aceita id do agendamento vindo como string numérica", async () => {
    const { app, deps } = montar();
    await postar(app, "/webhooks/clint/resposta-lembrete", { ...RESPOSTA, id_agendamento_medx: "1275002478" }, SEGREDO);

    const job = (deps.fila.add as any).mock.calls[0][1];
    expect(job.comando.idAgendamentoMedx).toBe(1275002478);
  });
});

describe("rotas desconhecidas — garantia de sempre 200", () => {
  it("responde 200 para uma rota inexistente", async () => {
    const { app, deps } = montar();
    const r = await app.inject({ method: "POST", url: "/webhooks/clint/nao-existe", payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ alerta: true }),
      expect.any(String)
    );
  });

  it("responde 200 para método errado numa rota existente", async () => {
    const { app } = montar();
    const r = await app.inject({ method: "GET", url: "/webhooks/clint/agendamento" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });
});

describe("GET /health", () => {
  it("responde 200 quando tudo está de pé", async () => {
    const { app } = montar();
    const r = await app.inject({ method: "GET", url: "/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ redis: true, banco: true, medx: true });
  });

  it("responde 503 quando algum componente está fora", async () => {
    const { app } = montar({
      verificarSaude: vi.fn(async () => ({ redis: false, banco: true, medx: true })),
    });
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(503);
  });
});
