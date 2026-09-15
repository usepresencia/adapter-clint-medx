import type { FastifyInstance } from "fastify";
import type { Queue } from "bullmq";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import basicAuth from "@fastify/basic-auth";

const CAMINHO = "/admin/filas";

/**
 * Sobe o painel apenas com credenciais definidas. Sem elas a rota não existe:
 * expor a fila sem autenticação vazaria deal_id e o conteúdo dos jobs.
 */
export async function registrarPainelFila(
  app: FastifyInstance,
  fila: Queue,
  credenciais: { usuario?: string; senha?: string }
): Promise<boolean> {
  const { usuario, senha } = credenciais;
  if (!usuario || !senha) return false;

  const painel = new FastifyAdapter();
  createBullBoard({ queues: [new BullMQAdapter(fila)], serverAdapter: painel });
  painel.setBasePath(CAMINHO);

  await app.register(basicAuth, {
    validate: async (informado, segredo) => {
      if (informado !== usuario || segredo !== senha) {
        return new Error("credenciais inválidas");
      }
      return undefined;
    },
    authenticate: { realm: "adapter" },
  });

  await app.register(async (instancia) => {
    instancia.addHook("onRequest", instancia.basicAuth);
    await instancia.register(painel.registerPlugin(), { prefix: CAMINHO });
  });

  return true;
}
