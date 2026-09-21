import { describe, it, expect, vi } from 'vitest';
import { ProcessarLeadOrigemUseCase } from './processar-lead-origem.usecase';
import type { CrmContatoPort } from '../ports/crm-contato.port';

function contatosFalso(idEncontrado: string | null = 'contato-1'): CrmContatoPort {
    return {
        buscarIdPorTelefone: vi.fn(async () => idEncontrado),
        adicionarTag: vi.fn(async () => {}),
    };
}

describe('ProcessarLeadOrigemUseCase', () => {
    it('marca Google quando a mensagem contém o marcador do Google', async () => {
        const contatos = contatosFalso();
        await new ProcessarLeadOrigemUseCase(contatos).executar({
            telefone: '+5511999998888',
            textoMensagem: 'Olá, vim pelo Google e gostaria de agendar uma consulta',
        });

        expect(contatos.buscarIdPorTelefone).toHaveBeenCalled();
        expect(contatos.adicionarTag).toHaveBeenCalledWith('contato-1', 'Google');
    });

    it('reconhece o marcador do Google mesmo com caixa diferente', async () => {
        const contatos = contatosFalso();
        await new ProcessarLeadOrigemUseCase(contatos).executar({
            telefone: '+5511999998888',
            textoMensagem: 'VIM PELO GOOGLE',
        });

        expect(contatos.adicionarTag).toHaveBeenCalledWith('contato-1', 'Google');
    });

    it.each(['Oi, vim pelo Instagram', 'Vim pelo Facebook, gostaria de informações'])(
        'marca Meta quando a mensagem contém um marcador de Meta: %s',
        async textoMensagem => {
            const contatos = contatosFalso();
            await new ProcessarLeadOrigemUseCase(contatos).executar({
                telefone: '+5511999998888',
                textoMensagem,
            });

            expect(contatos.adicionarTag).toHaveBeenCalledWith('contato-1', 'Meta');
        },
    );

    it('não faz nada quando a mensagem não contém nenhum marcador conhecido', async () => {
        const contatos = contatosFalso();
        await new ProcessarLeadOrigemUseCase(contatos).executar({
            telefone: '+5511999998888',
            textoMensagem: 'Oi, gostaria de agendar uma consulta',
        });

        expect(contatos.buscarIdPorTelefone).not.toHaveBeenCalled();
        expect(contatos.adicionarTag).not.toHaveBeenCalled();
    });

    it('não adiciona tag quando o contato não é encontrado pelo telefone', async () => {
        const contatos = contatosFalso(null);
        await new ProcessarLeadOrigemUseCase(contatos).executar({
            telefone: '+5511999998888',
            textoMensagem: 'vim pelo google',
        });

        expect(contatos.adicionarTag).not.toHaveBeenCalled();
    });
});
