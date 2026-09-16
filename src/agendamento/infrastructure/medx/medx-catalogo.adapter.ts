import { Injectable } from '@nestjs/common';
import type {
    CatalogoClinicoPort,
    TipoConsultaResolvido,
} from '../../application/ports/catalogo-clinico.port';
import { MedxHttpClient } from './medx-http.client';
import type { MedxProfissional, MedxTipoAgendamento } from './medx.tipos';

const TTL_PADRAO_MS = 6 * 60 * 60 * 1000;

function chave(texto: string): string {
    return texto
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');
}

function encontrarIndiceStatus(rotulos: string[], alvo: string): number {
    // Igualdade exata pós-normalização — NUNCA startsWith (colidiria com um
    // rótulo customizado como "Confirmação Pendente").
    return rotulos.findIndex(rotulo => chave(rotulo) === alvo);
}

@Injectable()
export class MedxCatalogoAdapter implements CatalogoClinicoPort {
    ttlMs = TTL_PADRAO_MS;
    agora: () => number = Date.now;

    private profissionais: MedxProfissional[] = [];
    private tipos: MedxTipoAgendamento[] = [];
    private indiceAgendado = -1;
    private indiceConfirmado = -1;
    private carregadoEm = -Infinity;

    constructor(private readonly client: MedxHttpClient) {}

    async carregar(): Promise<void> {
        const [p, t, s] = await Promise.all([
            this.client.get<MedxProfissional[]>('/api/integration/financas/profissionais'),
            this.client.get<MedxTipoAgendamento[]>('/api/integration/agenda/tipos'),
            this.client.get<string[]>('/api/integration/agenda/status'),
        ]);

        this.profissionais = p;
        this.tipos = t;

        this.indiceAgendado = encontrarIndiceStatus(s, 'agendado');
        if (this.indiceAgendado < 0) {
            throw new Error(
                `Nenhum rótulo de status corresponde a "Agendado" nesta conta do MedX. ` +
                    `Rótulos recebidos: ${JSON.stringify(s)}`,
            );
        }

        this.indiceConfirmado = encontrarIndiceStatus(s, 'confirmado');
        if (this.indiceConfirmado < 0) {
            throw new Error(
                `Nenhum rótulo de status corresponde a "Confirmado" nesta conta do MedX. ` +
                    `Rótulos recebidos: ${JSON.stringify(s)}`,
            );
        }

        this.carregadoEm = this.agora();
    }

    private async garantirCache(): Promise<void> {
        if (this.agora() - this.carregadoEm >= this.ttlMs) await this.carregar();
    }

    async resolverProfissional(valor: string | number): Promise<number> {
        if (typeof valor === 'number') return valor;
        if (/^\d+$/.test(valor.trim())) return Number(valor.trim());

        await this.garantirCache();
        const alvo = chave(valor);
        const achado = this.profissionais.find(
            p => chave(p.nomeCompleto) === alvo || chave(p.usuarioNome) === alvo,
        );

        if (!achado) {
            throw new Error(`Profissional não encontrado no MedX: "${valor}"`);
        }
        return achado.idDoUsuario;
    }

    async resolverTipoConsulta(valor: string | number): Promise<TipoConsultaResolvido> {
        await this.garantirCache();

        const ehNumero = typeof valor === 'number' || /^\d+$/.test(String(valor).trim());
        const achado = ehNumero
            ? this.tipos.find(t => t.iddoDiagnosticoQP === Number(valor))
            : this.tipos.find(t => chave(t.diagnosticoQP) === chave(String(valor)));

        if (!achado) {
            throw new Error(`Tipo de consulta não encontrado no MedX: "${valor}"`);
        }

        return {
            id: achado.iddoDiagnosticoQP,
            nome: achado.diagnosticoQP,
            duracaoMinutos: achado.tempo,
        };
    }

    indiceStatusAgendado(): number {
        if (this.indiceAgendado < 0) {
            throw new Error('Catálogo do MedX não foi inicializado — chame carregar() antes');
        }
        return this.indiceAgendado;
    }

    indiceStatusConfirmado(): number {
        if (this.indiceConfirmado < 0) {
            throw new Error('Catálogo do MedX não foi inicializado — chame carregar() antes');
        }
        return this.indiceConfirmado;
    }
}
