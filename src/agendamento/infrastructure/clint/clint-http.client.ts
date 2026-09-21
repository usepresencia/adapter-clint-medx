import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

async function lerCorpo<T>(resposta: Response): Promise<T> {
    const texto = await resposta.text();
    if (texto === '') return undefined as T;
    return JSON.parse(texto) as T;
}

@Injectable()
export class ClintHttpClient {
    constructor(private readonly config: ConfigService) {}

    get<T>(caminho: string, query?: Query): Promise<T> {
        return this.chamar<T>('GET', caminho, query);
    }

    post<T>(caminho: string, corpo: unknown): Promise<T> {
        return this.chamar<T>('POST', caminho, undefined, corpo);
    }

    private async chamar<T>(
        metodo: string,
        caminho: string,
        query?: Query,
        corpo?: unknown,
    ): Promise<T> {
        const host = this.config.get<string>('CLINT_API_URL');
        const token = this.config.get<string>('CLINT_API_TOKEN');

        const resposta = await fetch(montarUrl(host!, caminho, query), {
            method: metodo,
            headers: {
                'api-token': token!,
                ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}),
            },
            ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
        });

        if (!resposta.ok) {
            throw new Error(`Clint respondeu HTTP ${resposta.status} em ${caminho}`);
        }

        return lerCorpo<T>(resposta);
    }
}
