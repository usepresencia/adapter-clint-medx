import type { TokenProvider } from "./medx-token.provider.js";
import { ErroMedx, ErroRateLimit } from "./medx.erros.js";

export type Query = Record<string, string | number | undefined>;

export interface MedxClient {
  get<T>(caminho: string, query?: Query): Promise<T>;
  post<T>(caminho: string, corpo: unknown): Promise<T>;
  put<T>(caminho: string, corpo: unknown): Promise<T>;
}

function montarUrl(host: string, caminho: string, query?: Query): string {
  if (!query) return `${host}${caminho}`;

  const partes = Object.entries(query)
    .filter(([, valor]) => valor !== undefined)
    .map(([chave, valor]) => `${encodeURIComponent(chave)}=${encodeURIComponent(String(valor))}`);

  return partes.length ? `${host}${caminho}?${partes.join("&")}` : `${host}${caminho}`;
}

/** A API devolve ora JSON, ora um inteiro puro, ora uma frase. Todos são respostas válidas. */
async function lerCorpo<T>(resposta: Response): Promise<T> {
  const texto = await resposta.text();
  if (texto === "") return undefined as T;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return texto as T;
  }
}

export function criarMedxClient(opcoes: { host: string; tokens: TokenProvider }): MedxClient {
  async function chamar<T>(
    metodo: string,
    caminho: string,
    query?: Query,
    corpo?: unknown,
    jaRenovou = false
  ): Promise<T> {
    const token = await opcoes.tokens.obterToken();

    const resposta = await fetch(montarUrl(opcoes.host, caminho, query), {
      method: metodo,
      headers: {
        authorization: `Bearer ${token}`,
        ...(corpo !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    });

    if (resposta.status === 429) {
      const cabecalho = resposta.headers.get("retry-after");
      const segundos = cabecalho ? Number(cabecalho) : 60;
      throw new ErroRateLimit(Number.isFinite(segundos) ? segundos : 60);
    }

    if (resposta.status === 401 && !jaRenovou) {
      opcoes.tokens.invalidar();
      return chamar<T>(metodo, caminho, query, corpo, true);
    }

    if (!resposta.ok) {
      throw new ErroMedx(resposta.status, `MedX respondeu HTTP ${resposta.status} em ${caminho}`);
    }

    return lerCorpo<T>(resposta);
  }

  return {
    get: <T>(caminho: string, query?: Query) => chamar<T>("GET", caminho, query),
    post: <T>(caminho: string, corpo: unknown) => chamar<T>("POST", caminho, undefined, corpo),
    put: <T>(caminho: string, corpo: unknown) => chamar<T>("PUT", caminho, undefined, corpo),
  };
}
