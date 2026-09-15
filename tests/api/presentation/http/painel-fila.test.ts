import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { Queue } from "bullmq";
import { registrarPainelFila } from "../../../../src/api/presentation/http/painel-fila.js";

// Sem uma conexão real com o Redis: a fila só precisa existir como instância
// verdadeira de `Queue` (o BullMQAdapter faz `instanceof Queue`), nunca chega
// a ser consultada nos cenários abaixo. `retryStrategy: () => null` evita
// tentativas repetidas de reconexão e o listener de erro evita ruído no
// console quando a conexão recusada dispara o evento `error`.
function filaFalsa(): Queue {
  const fila = new Queue("teste-painel-fila", {
    connection: { host: "127.0.0.1", port: 1, maxRetriesPerRequest: 0, retryStrategy: () => null },
  });
  fila.on("error", () => {});
  return fila;
}

describe("registrarPainelFila", () => {
  let app: FastifyInstance;
  let fila: Queue;

  afterEach(async () => {
    await app?.close();
    await fila?.close();
  });

  it("sem credenciais: não registra a rota e devolve false", async () => {
    app = Fastify({ logger: false });
    fila = filaFalsa();

    const ativo = await registrarPainelFila(app, fila, {});
    await app.ready();

    expect(ativo).toBe(false);
    const r = await app.inject({ method: "GET", url: "/admin/filas" });
    expect(r.statusCode).toBe(404);
  });

  it("com apenas usuário (sem senha): não registra a rota e devolve false", async () => {
    app = Fastify({ logger: false });
    fila = filaFalsa();

    const ativo = await registrarPainelFila(app, fila, { usuario: "u" });
    await app.ready();

    expect(ativo).toBe(false);
    const r = await app.inject({ method: "GET", url: "/admin/filas" });
    expect(r.statusCode).toBe(404);
  });

  it("com credenciais: registra a rota e devolve true", async () => {
    app = Fastify({ logger: false });
    fila = filaFalsa();

    const ativo = await registrarPainelFila(app, fila, { usuario: "u", senha: "s" });
    await app.ready();

    expect(ativo).toBe(true);
  });

  it("com credenciais: bloqueia acesso sem header Authorization", async () => {
    app = Fastify({ logger: false });
    fila = filaFalsa();

    await registrarPainelFila(app, fila, { usuario: "u", senha: "s" });
    await app.ready();

    const r = await app.inject({ method: "GET", url: "/admin/filas" });
    expect(r.statusCode).toBe(401);
  });

  it("com credenciais: bloqueia acesso com usuário/senha errados", async () => {
    app = Fastify({ logger: false });
    fila = filaFalsa();

    await registrarPainelFila(app, fila, { usuario: "u", senha: "s" });
    await app.ready();

    const credenciaisErradas = Buffer.from("u:errada").toString("base64");
    const r = await app.inject({
      method: "GET",
      url: "/admin/filas",
      headers: { authorization: `Basic ${credenciaisErradas}` },
    });
    expect(r.statusCode).toBe(401);
  });
});
