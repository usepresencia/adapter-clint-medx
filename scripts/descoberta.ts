import { writeFileSync, mkdirSync } from "node:fs";
import { carregarEnv } from "../lib/config/env.server.js";
import { criarTokenProvider } from "../src/api/infrastructure/medx/medx-token.provider.js";
import { criarMedxClient } from "../src/api/infrastructure/medx/medx-http.client.js";

const env = carregarEnv(process.env);
const client = criarMedxClient({
  host: env.MEDX_HOST,
  tokens: criarTokenProvider({
    host: env.MEDX_HOST,
    integrationToken: env.MEDX_INTEGRATION_TOKEN,
  }),
});

async function tentar<T>(rotulo: string, fn: () => Promise<T>): Promise<T | { erro: string }> {
  try {
    const r = await fn();
    console.log(`\n=== ${rotulo} ===`);
    console.log(JSON.stringify(r, null, 2));
    return r;
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error(`\n=== ${rotulo} — FALHOU ===\n${erro}`);
    return { erro };
  }
}

const resultado = {
  status: await tentar("1. GET /agenda/status", () =>
    client.get<string[]>("/api/integration/agenda/status")
  ),
  profissionais: await tentar("2. GET /financas/profissionais", () =>
    client.get<unknown[]>("/api/integration/financas/profissionais")
  ),
  tipos: await tentar("3. GET /agenda/tipos", () =>
    client.get<unknown[]>("/api/integration/agenda/tipos")
  ),
  setores: await tentar("4. GET /agenda/setores", () =>
    client.get<unknown[]>("/api/integration/agenda/setores")
  ),
};

mkdirSync("docs", { recursive: true });
writeFileSync("docs/descoberta-medx.json", JSON.stringify(resultado, null, 2));

const rotulos = Array.isArray(resultado.status) ? resultado.status : [];
const indice = rotulos.findIndex(
  (r) => typeof r === "string" && r.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "") === "confirmado"
);

console.log("\n\n=== CHECKLIST ===");
console.log(`Rótulos de status: ${JSON.stringify(rotulos)}`);
console.log(`Índice de "Confirmado": ${indice >= 0 ? indice : "NÃO ENCONTRADO — PARE E CONSULTE A CLÍNICA"}`);
console.log("\nFalta fazer manualmente:");
console.log("  5. POST /contatos/vinculo com um paciente conhecido — conferir se Id volta numérico");
console.log("  6. Criar agendamento de teste e ler GET /agenda/agendamentos/{id}");
console.log("     — conferir o formato de Inicio/Final e inspecionar os campos SMS e Confirmacao");
console.log("\nResultado salvo em docs/descoberta-medx.json");
