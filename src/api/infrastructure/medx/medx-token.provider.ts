const MARGEM_RENOVACAO_MS = 120_000;

export interface TokenProvider {
  obterToken(): Promise<string>;
  invalidar(): void;
}

export function criarTokenProvider(opcoes: {
  host: string;
  integrationToken: string;
  agora?: () => number;
}): TokenProvider {
  const agora = opcoes.agora ?? Date.now;

  let token: string | null = null;
  let expiraEm = 0;
  let emVoo: Promise<string> | null = null;

  async function buscar(): Promise<string> {
    const resposta = await fetch(`${opcoes.host}/api/integration/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ IntegrationToken: opcoes.integrationToken }),
    });

    if (!resposta.ok) {
      throw new Error(`Falha ao trocar o token de integração: HTTP ${resposta.status}`);
    }

    const dados = (await resposta.json()) as { accessToken: string; expiresInSeconds: number };
    token = dados.accessToken;
    expiraEm = agora() + dados.expiresInSeconds * 1000;
    return token;
  }

  return {
    async obterToken(): Promise<string> {
      if (token && agora() < expiraEm - MARGEM_RENOVACAO_MS) {
        return token;
      }
      // A troca de token é limitada a 10 req/min por IP: chamadas concorrentes
      // compartilham a mesma requisição em voo.
      emVoo ??= buscar().finally(() => {
        emVoo = null;
      });
      return emVoo;
    },

    invalidar(): void {
      token = null;
      expiraEm = 0;
    },
  };
}
