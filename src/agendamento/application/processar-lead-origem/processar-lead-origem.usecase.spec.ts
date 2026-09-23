import { describe, it, expect, vi } from 'vitest';
import { ProcessarLeadOrigemUseCase } from './processar-lead-origem.usecase';
import type { CrmContatoPort } from '../ports/crm-contato.port';
import type {
    CliqueOrigem,
    CliqueOrigemRepositorio,
} from '../../domain/clique-origem/clique-origem.repositorio';

function contatosFalso(idEncontrado: string | null = 'contato-1'): CrmContatoPort {
    return {
        buscarIdPorTelefone: vi.fn(async () => idEncontrado),
        adicionarTag: vi.fn(async () => {}),
    };
}

function cliquesFalso(clique: CliqueOrigem | null = null): CliqueOrigemRepositorio {
    return {
        criar: vi.fn(async () => {}),
        buscarPorCodigo: vi.fn(async () => clique),
        reivindicar: vi.fn(async () => {}),
        buscarMaisRecentePorTelefone: vi.fn(async () => null),
        expurgarNaoReivindicados: vi.fn(async () => 0),
    };
}

function cliqueDe(utmSource: string | null): CliqueOrigem {
    return {
        id: 1,
        codigo: 'ABC12345',
        fbclid: 'fb.123',
        utmSource,
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
        telefone: null,
        criadoEm: new Date('2026-09-22T10:00:00Z'),
    };
}

describe('marcadores de texto fixos (Google Meu Negócio / Instagram / Facebook)', () => {
    it('marca Google quando a mensagem contém o marcador do Google', async () => {
        const contatos = contatosFalso();
        const cliques = cliquesFalso();
        await new ProcessarLeadOrigemUseCase(contatos, cliques).executar({
            telefone: '+5511999998888',
            textoMensagem: 'Olá, vim pelo Google e gostaria de agendar uma consulta',
        });

        expect(contatos.adicionarTag).toHaveBeenCalledWith('contato-1', 'Google');
    });

    it('reconhece o marcador do Google mesmo com caixa diferente', async () => {
        const contatos = contatosFalso();
        const cliques = cliquesFalso();
        await new ProcessarLeadOrigemUseCase(contatos, cliques).executar({
            telefone: '+5511999998888',
            textoMensagem: 'VIM PELO GOOGLE',
        });

        expect(contatos.adicionarTag).toHaveBeenCalledWith('contato-1', 'Google');
    });

    it.each(['Oi, vim pelo Instagram', 'Vim pelo Facebook, gostaria de informações'])(
        'marca Meta quando a mensagem contém um marcador de Meta: %s',
        async textoMensagem => {
            const contatos = contatosFalso();
            const cliques = cliquesFalso();
            await new ProcessarLeadOrigemUseCase(contatos, cliques).executar({
                telefone: '+5511999998888',
                textoMensagem,
            });

            expect(contatos.adicionarTag).toHaveBeenCalledWith('contato-1', 'Meta');
        },
    );

    it('não faz nada quando a mensagem não contém nenhum marcador conhecido', async () => {
        const contatos = contatosFalso();
        const cliques = cliquesFalso();
        await new ProcessarLeadOrigemUseCase(contatos, cliques).executar({
            telefone: '+5511999998888',
            textoMensagem: 'Oi, gostaria de agendar uma consulta',
        });

        expect(contatos.buscarIdPorTelefone).not.toHaveBeenCalled();
        expect(contatos.adicionarTag).not.toHaveBeenCalled();
    });

    it('não adiciona tag quando o contato não é encontrado pelo telefone', async () => {
        const contatos = contatosFalso(null);
        const cliques = cliquesFalso();
        await new ProcessarLeadOrigemUseCase(contatos, cliques).executar({
            telefone: '+5511999998888',
            textoMensagem: 'vim pelo google',
        });

        expect(contatos.adicionarTag).not.toHaveBeenCalled();
    });
});

describe('código de referência do site (POST /leads/click)', () => {
    it('reconhece "Ref: <codigo>", reivindica o clique e marca a origem pelo utm_source', async () => {
        const contatos = contatosFalso();
        const cliques = cliquesFalso(cliqueDe('meta'));
        await new ProcessarLeadOrigemUseCase(contatos, cliques).executar({
            telefone: '+5511999998888',
            textoMensagem: 'Olá, vim pelo site (Ref: ABC12345)',
        });

        expect(cliques.buscarPorCodigo).toHaveBeenCalledWith('ABC12345');
        expect(cliques.reivindicar).toHaveBeenCalledWith('ABC12345', '+5511999998888');
        expect(contatos.adicionarTag).toHaveBeenCalledWith('contato-1', 'Meta');
    });

    it('reivindica com o telefone normalizado (e164), mesmo quando chega formatado diferente', async () => {
        const contatos = contatosFalso();
        const cliques = cliquesFalso(cliqueDe('meta'));
        await new ProcessarLeadOrigemUseCase(contatos, cliques).executar({
            telefone: '+55 (11) 99999-8888',
            textoMensagem: 'Ref: ABC12345',
        });

        expect(cliques.reivindicar).toHaveBeenCalledWith('ABC12345', '+5511999998888');
    });

    it('normaliza o código pra maiúsculo antes de buscar', async () => {
        const contatos = contatosFalso();
        const cliques = cliquesFalso(cliqueDe('google'));
        await new ProcessarLeadOrigemUseCase(contatos, cliques).executar({
            telefone: '+5511999998888',
            textoMensagem: 'vim do site ref: abc12345',
        });

        expect(cliques.buscarPorCodigo).toHaveBeenCalledWith('ABC12345');
        expect(contatos.adicionarTag).toHaveBeenCalledWith('contato-1', 'Google');
    });

    it('não aplica tag quando o utm_source não indica Google nem Meta', async () => {
        const contatos = contatosFalso();
        const cliques = cliquesFalso(cliqueDe('bing'));
        await new ProcessarLeadOrigemUseCase(contatos, cliques).executar({
            telefone: '+5511999998888',
            textoMensagem: 'Ref: ABC12345',
        });

        expect(cliques.reivindicar).toHaveBeenCalledWith('ABC12345', '+5511999998888');
        expect(contatos.adicionarTag).not.toHaveBeenCalled();
    });

    it('não faz nada (nem cai no fallback de marcador) quando o código não é encontrado', async () => {
        const contatos = contatosFalso();
        const cliques = cliquesFalso(null);
        await new ProcessarLeadOrigemUseCase(contatos, cliques).executar({
            telefone: '+5511999998888',
            textoMensagem: 'Ref: NAOEXISTE',
        });

        expect(cliques.reivindicar).not.toHaveBeenCalled();
        expect(contatos.adicionarTag).not.toHaveBeenCalled();
    });
});
