import { Inject, Injectable } from '@nestjs/common';
import { RELOGIO_PORT, type Relogio } from '../../application/ports/relogio.port';
import { RelogioSistema } from '../relogio/relogio-sistema';
import { fetchComTimeout } from '../../../shared/http/http';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';

const MARGEM_RENOVACAO_MS = 120_000;

@Injectable()
export class MedxTokenProvider {
    private token: string | null = null;
    private expiraEm = 0;
    private emVoo: Promise<string> | null = null;

    constructor(
        private readonly config: ConfigService<Env, true>,
        @Inject(RELOGIO_PORT) private readonly relogio: Relogio = new RelogioSistema(),
    ) {}

    async obterToken(): Promise<string> {
        if (this.token && this.relogio.agora().toMillis() < this.expiraEm - MARGEM_RENOVACAO_MS) {
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
        const host = this.config.get('MEDX_HOST', { infer: true });
        const integrationToken = this.config.get('MEDX_INTEGRATION_TOKEN', { infer: true });

        const resposta = await fetchComTimeout(`${host}/api/integration/v1/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ integrationToken }),
        });

        if (!resposta.ok) {
            throw new Error(`Falha ao trocar o token de integração: HTTP ${resposta.status}`);
        }

        const dados = (await resposta.json()) as { accessToken: string; expiresInSeconds: number };
        this.token = dados.accessToken;
        this.expiraEm = this.relogio.agora().toMillis() + dados.expiresInSeconds * 1000;
        return this.token;
    }
}
