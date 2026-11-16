import { Inject, Injectable } from '@nestjs/common';
import type {
    CatalogoClinicoPort,
    TipoConsultaResolvido,
} from '../../application/ports/catalogo-clinico.port';
import { RELOGIO_PORT, type Relogio } from '../../application/ports/relogio.port';
import { RelogioSistema } from '../relogio/relogio-sistema';
import { MedxHttpClient } from './medx-http.client';
import type { MedxProfissional, MedxReferencia, MedxTipoAgendamento } from './medx.tipos';

const TTL_PADRAO_MS = 6 * 60 * 60 * 1000;
const STATUS_QUE_LIBERAM_HORARIO = ['desmarcado', 'cancelou', 'faltou'];
const STATUS_DE_CANCELAMENTO = ['desmarcado', 'cancelou'];

function chave(texto: string): string {
    return texto
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');
}

function encontrarIdStatus(status: MedxReferencia[], alvo: string): number {
    // Igualdade exata pós-normalização — NUNCA startsWith (colidiria com um
    // rótulo customizado como "Confirmação Pendente").
    return status.find(s => chave(s.nome) === alvo)?.id ?? -1;
}

/** Uma string só de dígitos é tratada como id direto, sem consulta ao catálogo. */
function ehInteiroPuro(texto: string): boolean {
    return /^\d+$/.test(texto.trim());
}

interface Carregado {
    profissionais: MedxProfissional[];
    tipos: MedxTipoAgendamento[];
    agendado: number;
    confirmado: number;
    finalizado: number;
    liberam: number[];
    endovenoso: number;
    cancelamento: number[];
}

/**
 * Catálogo da conta no MedX (API v1). Carrega sob demanda e revalida a cada
 * TTL; uma falha de carga não fica em cache, a próxima consulta tenta de novo.
 * Os "índices" de status são os ids da lista `status` de /agenda/catalogos.
 */
@Injectable()
export class MedxCatalogoAdapter implements CatalogoClinicoPort {
    ttlMs = TTL_PADRAO_MS;

    private dados: Carregado | null = null;
    private carregadoEm = -Infinity;
    private emVoo: Promise<void> | null = null;

    constructor(
        private readonly client: MedxHttpClient,
        @Inject(RELOGIO_PORT) private readonly relogio: Relogio = new RelogioSistema(),
    ) {}

    async carregar(): Promise<void> {
        const [catalogos, tipos, profissionais] = await Promise.all([
            this.client.get<{ status: MedxReferencia[] }>('/api/integration/v1/agenda/catalogos'),
            this.client.listarTodos<MedxTipoAgendamento>('/api/integration/v1/agenda/tipos'),
            this.client.listarTodos<MedxProfissional>(
                '/api/integration/v1/financas/profissionais',
                undefined,
                'profissionais',
            ),
        ]);
        const status = catalogos?.status ?? [];

        const agendado = encontrarIdStatus(status, 'agendado');
        if (agendado < 0) {
            throw new Error(
                `Nenhum status corresponde a "Agendado" nesta conta do MedX. ` +
                    `Status recebidos: ${JSON.stringify(status.map(s => s.nome))}`,
            );
        }
        const confirmado = encontrarIdStatus(status, 'confirmado');
        if (confirmado < 0) {
            throw new Error(
                `Nenhum status corresponde a "Confirmado" nesta conta do MedX. ` +
                    `Status recebidos: ${JSON.stringify(status.map(s => s.nome))}`,
            );
        }

        this.dados = {
            profissionais,
            tipos,
            agendado,
            confirmado,
            finalizado: encontrarIdStatus(status, 'finalizado atendimento'),
            endovenoso: encontrarIdStatus(status, 'endovenoso'),
            cancelamento: STATUS_DE_CANCELAMENTO.map(alvo =>
                encontrarIdStatus(status, alvo),
            ).filter(id => id >= 0),
            liberam: STATUS_QUE_LIBERAM_HORARIO.map(alvo => encontrarIdStatus(status, alvo)).filter(
                id => id >= 0,
            ),
        };
        this.carregadoEm = this.relogio.agora().toMillis();
    }

    private async garantir(): Promise<Carregado> {
        if (!this.dados || this.relogio.agora().toMillis() - this.carregadoEm >= this.ttlMs) {
            // Chamadas simultâneas compartilham a mesma carga em voo.
            this.emVoo ??= this.carregar().finally(() => {
                this.emVoo = null;
            });
            await this.emVoo;
        }
        return this.dados!;
    }

    async resolverProfissional(valor: string | number): Promise<number> {
        if (typeof valor === 'number') return valor;
        if (ehInteiroPuro(valor)) return Number(valor.trim());

        const { profissionais } = await this.garantir();
        const alvo = chave(valor);
        const achado = profissionais.find(
            p =>
                chave(p.nome) === alvo ||
                (p.nomeCompleto !== null && chave(p.nomeCompleto) === alvo),
        );
        if (!achado) {
            throw new Error(`Profissional não encontrado no MedX: "${valor}"`);
        }
        return achado.id;
    }

    async resolverTipoConsulta(valor: string | number): Promise<TipoConsultaResolvido> {
        const { tipos } = await this.garantir();
        const ehNumero = typeof valor === 'number' || ehInteiroPuro(String(valor));
        const achado = ehNumero
            ? tipos.find(t => t.id === Number(valor))
            : tipos.find(t => chave(t.nome) === chave(String(valor)));

        if (!achado) {
            throw new Error(`Tipo de consulta não encontrado no MedX: "${valor}"`);
        }
        return { id: achado.id, nome: achado.nome, duracaoMinutos: achado.duracaoMinutos };
    }

    async indiceStatusAgendado(): Promise<number> {
        return (await this.garantir()).agendado;
    }

    async indiceStatusConfirmado(): Promise<number> {
        return (await this.garantir()).confirmado;
    }

    async indiceStatusFinalizado(): Promise<number> {
        return (await this.garantir()).finalizado;
    }

    async indicesStatusQueLiberamHorario(): Promise<number[]> {
        return (await this.garantir()).liberam;
    }

    async indiceStatusEndovenoso(): Promise<number> {
        return (await this.garantir()).endovenoso;
    }

    async indicesStatusCancelamento(): Promise<number[]> {
        return (await this.garantir()).cancelamento;
    }
}
