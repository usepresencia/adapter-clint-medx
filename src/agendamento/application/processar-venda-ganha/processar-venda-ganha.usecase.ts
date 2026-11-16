import { Inject, Injectable } from '@nestjs/common';
import { Telefone } from '../../domain/paciente/telefone';
import { CONVERSAO_PORT, type ConversaoPort } from '../ports/conversao.port';
import { CLIQUE_ORIGEM_REPOSITORIO } from '../../domain/clique-origem/clique-origem.repositorio';
import type { CliqueOrigemRepositorio } from '../../domain/clique-origem/clique-origem.repositorio';
import type { ComandoVendaGanha } from './processar-venda-ganha.comando';

/**
 * Quando o negócio chega em "VENDA GANHA", dispara o Purchase para a Meta CAPI
 * se houver clique com fbclid para o telefone. Falha da Meta sobe: o job
 * precisa poder ser reprocessado (é o único efeito deste job).
 */
@Injectable()
export class ProcessarVendaGanhaUseCase {
    constructor(
        @Inject(CLIQUE_ORIGEM_REPOSITORIO) private readonly cliques: CliqueOrigemRepositorio,
        @Inject(CONVERSAO_PORT) private readonly conversao: ConversaoPort,
    ) {}

    async executar(comando: ComandoVendaGanha): Promise<void> {
        const telefone = Telefone.criar(comando.telefone);
        const clique = await this.cliques.buscarMaisRecentePorTelefone(telefone.e164);
        if (!clique?.fbclid) return;

        await this.conversao.notificarCompra(
            telefone,
            clique.fbclid,
            clique.criadoEm,
            comando.valor,
        );
    }
}
