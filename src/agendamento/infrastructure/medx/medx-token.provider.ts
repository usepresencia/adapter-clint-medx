import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const MARGEM_RENOVACAO_MS = 120_000;

@Injectable()
export class MedxTokenProvider {
    /** Sobrescrito em testes para controlar o relógio; produção usa Date.now. */
    agora: () => number = Date.now;

    private token: string | null = null;
    private expiraEm = 0;
    private emVoo: Promise<string> | null = null;

    constructor(private readonly config: ConfigService) {}

    async obterToken(): Promise<string> {
        if (this.token && this.agora() < this.expiraEm - MARGEM_RENOVACAO_MS) {
            return this.token;
        }
        // A troca de token é limitada a 10 req/min por IP: chamadas concorrentes
        // compartilham a mesma requisição em voo.
        this.emVoo ??= this.buscar().finally(() => {
            this.emVoo = null;
        });
        return this.emVoo;
    }

    invalidar(): void {
        this.token = null;
        this.expiraEm = 0;
    }

    private async buscar(): Promise<string> {
        const host = this.config.get<string>('MEDX_HOST');
        const integrationToken = this.config.get<string>('MEDX_INTEGRATION_TOKEN');

        const resposta = await fetch(`${host}/api/integration/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ IntegrationToken: integrationToken }),
        });

        if (!resposta.ok) {
            throw new Error(`Falha ao trocar o token de integração: HTTP ${resposta.status}`);
        }

        const dados = (await resposta.json()) as { accessToken: string; expiresInSeconds: number };
        this.token = dados.accessToken;
        this.expiraEm = this.agora() + dados.expiresInSeconds * 1000;
        return this.token;
    }
}
