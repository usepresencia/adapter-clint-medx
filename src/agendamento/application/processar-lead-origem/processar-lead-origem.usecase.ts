import { Inject, Injectable } from '@nestjs/common';
import { Telefone } from '../../domain/paciente/telefone';
import { CRM_CONTATO_PORT, type CrmContatoPort } from '../ports/crm-contato.port';
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

function identificarOrigem(textoMensagem: string): string | null {
    const normalizado = textoMensagem.toLowerCase();
    if (normalizado.includes(MARCADOR_GOOGLE)) return 'Google';
    if (MARCADORES_META.some(marcador => normalizado.includes(marcador))) return 'Meta';
    return null;
}

@Injectable()
export class ProcessarLeadOrigemUseCase {
    constructor(@Inject(CRM_CONTATO_PORT) private readonly contatos: CrmContatoPort) {}

    async executar(comando: ComandoLeadOrigem): Promise<void> {
        const origem = identificarOrigem(comando.textoMensagem);
        if (!origem) return;

        const telefone = Telefone.criar(comando.telefone);
        const contatoId = await this.contatos.buscarIdPorTelefone(telefone);
        if (!contatoId) return;

        await this.contatos.adicionarTag(contatoId, origem);
    }
}
