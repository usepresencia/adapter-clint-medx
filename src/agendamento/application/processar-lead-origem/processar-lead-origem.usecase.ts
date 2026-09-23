import { Inject, Injectable } from '@nestjs/common';
import { Telefone } from '../../domain/paciente/telefone';
import { CRM_CONTATO_PORT, type CrmContatoPort } from '../ports/crm-contato.port';
import { CLIQUE_ORIGEM_REPOSITORIO } from '../../../shared/persistence/persistence.module';
import type { CliqueOrigemRepositorio } from '../../domain/clique-origem/clique-origem.repositorio';
import type { ComandoLeadOrigem } from './processar-lead-origem.comando';

/**
 * Nem Google Meu Negócio nem o link de bio/Instagram/Facebook passam por uma
 * URL nossa antes de abrir o WhatsApp — não há onde capturar um UTM. A
 * origem só é identificável se cada canal usar uma mensagem pré-preenchida
 * distinta no link `wa.me`. Esses marcadores precisam existir literalmente
 * no texto configurado em cada canal (ajuste combinado com a clínica).
 */
const MARCADOR_GOOGLE = 'vim pelo google';
const MARCADORES_META = ['vim pelo instagram', 'vim pelo facebook'];

/**
 * O site (leize.com.br) embute um código de referência na mensagem — gerado
 * por POST /leads/click — em vez de um marcador fixo, porque só ele carrega
 * o UTM/fbclid real do clique (ver
 * docs/superpowers/specs/2026-09-22-atribuicao-lead-meta-capi-design.md).
 */
const PADRAO_REF = /ref:\s*([a-z0-9]{6,10})/i;

function identificarOrigemPorMarcador(textoMensagem: string): string | null {
    const normalizado = textoMensagem.toLowerCase();
    if (normalizado.includes(MARCADOR_GOOGLE)) return 'Google';
    if (MARCADORES_META.some(marcador => normalizado.includes(marcador))) return 'Meta';
    return null;
}

function identificarOrigemPorUtm(utmSource: string | null): string | null {
    if (!utmSource) return null;
    const normalizado = utmSource.toLowerCase();
    if (normalizado.includes('google')) return 'Google';
    if (['meta', 'facebook', 'instagram'].some(termo => normalizado.includes(termo))) {
        return 'Meta';
    }
    return null;
}

@Injectable()
export class ProcessarLeadOrigemUseCase {
    constructor(
        @Inject(CRM_CONTATO_PORT) private readonly contatos: CrmContatoPort,
        @Inject(CLIQUE_ORIGEM_REPOSITORIO) private readonly cliques: CliqueOrigemRepositorio,
    ) {}

    async executar(comando: ComandoLeadOrigem): Promise<void> {
        const telefone = Telefone.criar(comando.telefone);
        const referencia = comando.textoMensagem.match(PADRAO_REF);

        const origem = referencia
            ? await this.origemPorReferencia(referencia[1]!.toUpperCase(), telefone)
            : identificarOrigemPorMarcador(comando.textoMensagem);

        if (!origem) return;

        const contatoId = await this.contatos.buscarIdPorTelefone(telefone);
        if (!contatoId) return;

        await this.contatos.adicionarTag(contatoId, origem);
    }

    /**
     * Código não encontrado (expirado/inválido): termina sem tag, não cai no
     * fallback de marcador de texto no mesmo processamento — evita marcar
     * "Google"/"Meta" por engano a partir de um "Ref:" que não bateu com
     * nenhum clique real. Reivindica com o telefone NORMALIZADO (e164) —
     * ProcessarRespostaUseCase e ProcessarVendaGanhaUseCase sempre buscam
     * por esse mesmo formato, então gravar o telefone cru aqui quebraria a
     * atribuição sempre que o Clint mandasse o número formatado diferente
     * entre um webhook e outro.
     */
    private async origemPorReferencia(codigo: string, telefone: Telefone): Promise<string | null> {
        const clique = await this.cliques.buscarPorCodigo(codigo);
        if (!clique) return null;

        await this.cliques.reivindicar(codigo, telefone.e164);
        return identificarOrigemPorUtm(clique.utmSource);
    }
}
