import { describe, it, expect, vi } from 'vitest';
import { CapturarCliqueUseCase } from './capturar-clique.usecase';
import type { CliqueOrigemRepositorio } from '../../domain/clique-origem/clique-origem.repositorio';

function cliquesFalso(): { repo: CliqueOrigemRepositorio; criar: ReturnType<typeof vi.fn> } {
    const criar = vi.fn(async () => {});
    return {
        repo: {
            criar,
            buscarPorCodigo: vi.fn(async () => null),
            reivindicar: vi.fn(async () => {}),
            buscarMaisRecentePorTelefone: vi.fn(async () => null),
            expurgarNaoReivindicados: vi.fn(async () => 0),
        },
        criar,
    };
}

describe('CapturarCliqueUseCase', () => {
    it('gera um código de 8 caracteres e persiste os dados do clique', async () => {
        const { repo, criar } = cliquesFalso();
        const usecase = new CapturarCliqueUseCase(repo);

        const codigo = await usecase.executar({ fbclid: 'fb.123', utmSource: 'meta' });

        expect(codigo).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
        expect(criar).toHaveBeenCalledWith(codigo, { fbclid: 'fb.123', utmSource: 'meta' });
    });

    it('gera códigos diferentes em chamadas diferentes', async () => {
        const { repo } = cliquesFalso();
        const usecase = new CapturarCliqueUseCase(repo);

        const a = await usecase.executar({});
        const b = await usecase.executar({});

        expect(a).not.toBe(b);
    });
});
