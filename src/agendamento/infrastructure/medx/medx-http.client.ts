import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MedxTokenProvider } from './medx-token.provider';
import { ErroMedx, ErroRateLimit } from './medx.erros';

export type Query = Record<string, string | number | undefined>;

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

    post<T>(caminho: string, corpo: unknown): Promise<T> {
        return this.chamar<T>('POST', caminho, undefined, corpo);
    }

    put<T>(caminho: string, corpo: unknown): Promise<T> {
        return this.chamar<T>('PUT', caminho, undefined, corpo);
    }

    private async chamar<T>(
        metodo: string,
        caminho: string,
        query?: Query,
        corpo?: unknown,
        jaRenovou = false,
    ): Promise<T> {
        const host = this.config.get<string>('MEDX_HOST');
        const token = await this.tokens.obterToken();

        const resposta = await fetch(montarUrl(host!, caminho, query), {
            method: metodo,
            headers: {
                authorization: `Bearer ${token}`,
                ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
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
            return this.chamar<T>(metodo, caminho, query, corpo, true);
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
