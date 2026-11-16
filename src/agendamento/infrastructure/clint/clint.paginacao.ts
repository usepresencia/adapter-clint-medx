import type { ClintHttpClient } from './clint-http.client';

const LIMITE_PAGINA = 1000;
const MAX_PAGINAS = 50;

interface Pagina<T> {
    data?: T[];
    hasNext?: boolean;
}

/** Percorre as páginas de uma listagem da API REST da Clint (`hasNext`). */
export async function listarTodasAsPaginas<T>(
    client: ClintHttpClient,
    caminho: string,
    filtros: Record<string, string | undefined>,
): Promise<T[]> {
    const itens: T[] = [];
    for (let page = 1; page <= MAX_PAGINAS; page++) {
        const pagina = await client.get<Pagina<T>>(caminho, {
            ...filtros,
            limit: LIMITE_PAGINA,
            page,
        });
        itens.push(...(pagina?.data ?? []));
        if (!pagina?.hasNext) return itens;
    }
    throw new Error(`Clint passou de ${MAX_PAGINAS} páginas em ${caminho}`);
}
