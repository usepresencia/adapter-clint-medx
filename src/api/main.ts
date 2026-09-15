import { carregarEnv } from "../../lib/config/env.server.js";
import { montarAplicacao } from "./composition/container.js";

const env = carregarEnv(process.env);
const aplicacao = await montarAplicacao(env);

const expurgoDiario = setInterval(() => aplicacao.expurgar(), 24 * 60 * 60 * 1000);
expurgoDiario.unref();

await aplicacao.app.listen({ port: env.PORT, host: "0.0.0.0" });
console.log(`adapter no ar na porta ${env.PORT}`);

async function encerrar(sinal: string): Promise<void> {
  console.log(`encerrando por ${sinal}`);
  clearInterval(expurgoDiario);
  await aplicacao.encerrar();
  process.exit(0);
}

process.on("SIGTERM", () => void encerrar("SIGTERM"));
process.on("SIGINT", () => void encerrar("SIGINT"));
