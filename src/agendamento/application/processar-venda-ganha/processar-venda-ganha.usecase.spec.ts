import { describe, it, expect, vi } from 'vitest';
import { ProcessarVendaGanhaUseCase } from './processar-venda-ganha.usecase';
import type {
    CliqueOrigem,
    CliqueOrigemRepositorio,
} from '../../domain/clique-origem/clique-origem.repositorio';

function cliquesFalso(clique: CliqueOrigem | null = null): CliqueOrigemRepositorio {
    return {
        criar: vi.fn(async () => {}),
        buscarPorCodigo: vi.fn(async () => null),
        reivindicar: vi.fn(async () => {}),
        buscarMaisRecentePorTelefone: vi.fn(async () => clique),
        expurgarNaoReivindicados: vi.fn(async () => 0),
    };
}

function conversaoFalso() {
    return { notificarConversao: vi.fn(async () => {}), notificarCompra: vi.fn(async () => {}) };
}

function cliqueDe(fbclid: string | null): CliqueOrigem {
    return {
        id: 1,
        codigo: 'ABC12345',
        fbclid,
        utmSource: 'meta',
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
        telefone: '+5511999998888',
        criadoEm: new Date('2026-09-20T12:00:00Z'),
    };
}

describe('ProcessarVendaGanhaUseCase', () => {
    it('notifica a compra quando há clique com fbclid pro telefone', async () => {
        const clique = cliqueDe('fb.clique.123');
        const cliques = cliquesFalso(clique);
        const conversao = conversaoFalso();

        await new ProcessarVendaGanhaUseCase(cliques, conversao).executar({
            telefone: '+5511999998888',
            valor: 350,
        });

        expect(cliques.buscarMaisRecentePorTelefone).toHaveBeenCalledWith('+5511999998888');
        expect(conversao.notificarCompra).toHaveBeenCalledWith(
            expect.objectContaining({ e164: '+5511999998888' }),
            'fb.clique.123',
            clique.criadoEm,
            350,
        );
    });

    it('não notifica quando não há clique associado ao telefone', async () => {
        const cliques = cliquesFalso(null);
        const conversao = conversaoFalso();

        await new ProcessarVendaGanhaUseCase(cliques, conversao).executar({
            telefone: '+5511999998888',
            valor: 350,
        });

        expect(conversao.notificarCompra).not.toHaveBeenCalled();
    });

    it('não notifica quando o clique não tem fbclid', async () => {
        const cliques = cliquesFalso(cliqueDe(null));
        const conversao = conversaoFalso();

        await new ProcessarVendaGanhaUseCase(cliques, conversao).executar({
            telefone: '+5511999998888',
            valor: 350,
        });

        expect(conversao.notificarCompra).not.toHaveBeenCalled();
    });

    it('propaga a falha da Meta CAPI (o job deve poder ser reprocessado pela fila)', async () => {
        const cliques = cliquesFalso(cliqueDe('fb.clique.123'));
        const conversao = conversaoFalso();
        conversao.notificarCompra = vi.fn(async () => {
            throw new Error('Meta CAPI respondeu HTTP 500');
        });

        await expect(
            new ProcessarVendaGanhaUseCase(cliques, conversao).executar({
                telefone: '+5511999998888',
                valor: 350,
            }),
        ).rejects.toThrow(/500/);
    });
});
