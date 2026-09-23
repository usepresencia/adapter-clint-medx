import { Inject, Injectable } from '@nestjs/common';
import { Telefone } from '../../domain/paciente/telefone';
import { CONVERSAO_PORT, type ConversaoPort } from '../ports/conversao.port';
import { CLIQUE_ORIGEM_REPOSITORIO } from '../../../shared/persistence/persistence.module';
import type { CliqueOrigemRepositorio } from '../../domain/clique-origem/clique-origem.repositorio';
import type { ComandoVendaGanha } from './processar-venda-ganha.comando';

/**
 * Cobre o caminho de leads do site (UTM/fbclid): quando o negócio chega em
 * "VENDA GANHA", dispara o evento Purchase pra Meta CAPI se houver um clique
 * com fbclid associado ao telefone. O caminho de anúncio pago (CTWA) já é
 * coberto nativamente pelo node SEND_CAPI_EVENT do Clint, em paralelo.
 *
 * Diferente da notificação de QualifiedLead na confirmação da consulta, aqui
 * a falha NÃO é engolida — o job precisa poder ser reprocessado pela fila,
 * já que essa notificação é o único efeito deste job (não há outro fluxo do
 * paciente em risco de duplicação numa nova tentativa).
 */
@Injectable()
export class ProcessarVendaGanhaUseCase {
    constructor(
        @Inject(CLIQUE_ORIGEM_REPOSITORIO) private readonly cliques: CliqueOrigemRepositorio,
        @Inject(CONVERSAO_PORT) private readonly conversao: ConversaoPort,
    ) {}

    async executar(comando: ComandoVendaGanha): Promise<void> {
        const clique = await this.cliques.buscarMaisRecentePorTelefone(comando.telefone);
        if (!clique?.fbclid) return;

        const telefone = Telefone.criar(comando.telefone);
        await this.conversao.notificarCompra(
            telefone,
            clique.fbclid,
            clique.criadoEm,
            comando.valor,
        );
    }
}
