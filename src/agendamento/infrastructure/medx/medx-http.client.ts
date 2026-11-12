import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MedxTokenProvider } from './medx-token.provider';
import { ErroMedx, ErroRateLimit } from './medx.erros';

export type Query = Record<string, string | number | undefined>;

const MAX_PAGINAS = 100;

interface PaginaMedx {
    page?: { hasMore?: boolean; nextCursor?: string | null };
}

function montarUrl(host: string, caminho: string, query?: Query): string {
    if (!query) return `${host}${caminho}`;

    const partes = Object.entries(query)
        .filter(([, valor]) => valor !== undefined)
        .map(
            ([chave, valor]) => `${encodeURIComponent(chave)}=${encodeURIComponent(String(valor))}`,
        );

    return partes.length ? `${host}${caminho}?${partes.join('&')}` : `${host}${caminho}`;
}

/** A API devolve ora JSON, ora um inteiro puro, ora uma frase. Todos são respostas válidas. */
async function lerCorpo<T>(resposta: Response): Promise<T> {
    const texto = await resposta.text();
    if (texto === '') return undefined as T;
    try {
        return JSON.parse(texto) as T;
    } catch {
        return texto as T;
    }
}

@Injectable()
export class MedxHttpClient {
    constructor(
        private readonly config: ConfigService,
        private readonly tokens: MedxTokenProvider,
    ) {}

    get<T>(caminho: string, query?: Query): Promise<T> {
        return this.chamar<T>('GET', caminho, query);
    }

    post<T>(caminho: string, corpo: unknown, cabecalhos?: Record<string, string>): Promise<T> {
        return this.chamar<T>('POST', caminho, undefined, corpo, false, cabecalhos);
    }

    put<T>(caminho: string, corpo: unknown): Promise<T> {
        return this.chamar<T>('PUT', caminho, undefined, corpo);
    }

    /**
     * Lista paginada da API v1: segue `page.nextCursor` enquanto `page.hasMore`.
     * `chaveItens` cobre rotas que não usam `items` (ex.: `profissionais`).
     * Para com erro se o MedX repetir o cursor ou passar de MAX_PAGINAS.
     */
    async listarTodos<T>(caminho: string, query?: Query, chaveItens = 'items'): Promise<T[]> {
        const itens: T[] = [];
        const vistos = new Set<string>();
        let cursor: string | undefined;
        do {
            if (vistos.size >= MAX_PAGINAS) {
                throw new Error(`MedX passou de ${MAX_PAGINAS} páginas em ${caminho}`);
            }
            const pagina = await this.get<Record<string, unknown> & PaginaMedx>(caminho, {
                ...query,
                Cursor: cursor,
            });
            itens.push(...((pagina?.[chaveItens] as T[] | undefined) ?? []));
            cursor = pagina?.page?.hasMore ? (pagina.page.nextCursor ?? undefined) : undefined;
            if (cursor !== undefined) {
                if (vistos.has(cursor)) {
                    throw new Error(`MedX repetiu o cursor de paginação em ${caminho}`);
                }
                vistos.add(cursor);
            }
        } while (cursor);
        return itens;
    }

    /**
     * Escrita em duas etapas da API v1: prévia em `{prefixo}/preview` e
     * execução em `{prefixo}/executar` com o mesmo `operationId` no corpo e no
     * Idempotency-Key. Erro na prévia interrompe antes de executar.
     */
    async executarOperacao<R>(prefixo: string, corpoPrevia: unknown): Promise<R> {
        const previa = await this.post<{ operationId: string }>(`${prefixo}/preview`, corpoPrevia);
        const operationId = previa?.operationId;
        if (!operationId) {
            throw new Error(`Prévia do MedX em ${prefixo} não devolveu operationId`);
        }
        return this.post<R>(
            `${prefixo}/executar`,
            { operationId },
            { 'idempotency-key': operationId },
        );
    }

    private async chamar<T>(
        metodo: string,
        caminho: string,
        query?: Query,
        corpo?: unknown,
        jaRenovou = false,
        cabecalhos?: Record<string, string>,
    ): Promise<T> {
        const host = this.config.get<string>('MEDX_HOST');
        const token = await this.tokens.obterToken();

        const resposta = await fetch(montarUrl(host!, caminho, query), {
            method: metodo,
            headers: {
                authorization: `Bearer ${token}`,
                ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
                ...cabecalhos,
            },
            ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
        });

        if (resposta.status === 429) {
            const cabecalho = resposta.headers.get('retry-after');
            const segundos = cabecalho ? Number(cabecalho) : 60;
            throw new ErroRateLimit(Number.isFinite(segundos) ? segundos : 60);
        }

        if (resposta.status === 401 && !jaRenovou) {
            this.tokens.invalidar();
            return this.chamar<T>(metodo, caminho, query, corpo, true, cabecalhos);
        }

        if (!resposta.ok) {
            throw new ErroMedx(
                resposta.status,
                `MedX respondeu HTTP ${resposta.status} em ${caminho}`,
            );
        }

        return lerCorpo<T>(resposta);
    }
}
