import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchComTimeout, lerCorpo, montarUrl, type Query } from '../../../shared/http/http';

export type { Query };

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

        const resposta = await fetchComTimeout(montarUrl(host!, caminho, query), {
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
