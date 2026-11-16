export type Query = Record<string, string | number | undefined>;

/** Sem resposta neste prazo a chamada falha: o worker é único e uma chamada pendurada travaria a fila. */
export const TIMEOUT_HTTP_MS = 30_000;

export function montarUrl(host: string, caminho: string, query?: Query): string {
    if (!query) return `${host}${caminho}`;

    const partes = Object.entries(query)
        .filter(([, valor]) => valor !== undefined)
        .map(
            ([chave, valor]) => `${encodeURIComponent(chave)}=${encodeURIComponent(String(valor))}`,
        );

    return partes.length ? `${host}${caminho}?${partes.join('&')}` : `${host}${caminho}`;
}

/** As APIs devolvem ora JSON, ora um inteiro puro, ora uma frase. Todos são respostas válidas. */
export async function lerCorpo<T>(resposta: Response): Promise<T> {
    const texto = await resposta.text();
    if (texto === '') return undefined as T;
    try {
        return JSON.parse(texto) as T;
    } catch {
        return texto as T;
    }
}

/** `fetch` com prazo. A mensagem de timeout traz só o caminho: a query pode ter segredo. */
export async function fetchComTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number = TIMEOUT_HTTP_MS,
): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (erro) {
        if (erro instanceof Error && erro.name === 'TimeoutError') {
            throw new Error(`Timeout de ${timeoutMs} ms em ${new URL(url).pathname}`);
        }
        throw erro;
    }
}
