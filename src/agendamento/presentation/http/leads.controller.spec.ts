import { describe, it, expect, vi } from 'vitest';
import { LeadsController } from './leads.controller';

function montar() {
    const usecase = { executar: vi.fn(async () => 'ABC12345') };
    const controller = new LeadsController(usecase as any);
    return { usecase, controller };
}

describe('LeadsController.click', () => {
    it('devolve o código gerado pelo use case', async () => {
        const { controller } = montar();
        const resultado = await controller.click({ fbclid: 'fb.123', utm_source: 'meta' });
        expect(resultado).toEqual({ codigo: 'ABC12345' });
    });

    it('repassa os campos utm/fbclid pro comando do use case', async () => {
        const { usecase, controller } = montar();
        await controller.click({
            fbclid: 'fb.123',
            utm_source: 'meta',
            utm_medium: 'cpc',
            utm_campaign: 'promo-setembro',
            utm_content: 'anuncio-1',
            utm_term: 'ginecologista',
        });

        expect(usecase.executar).toHaveBeenCalledWith({
            fbclid: 'fb.123',
            utmSource: 'meta',
            utmMedium: 'cpc',
            utmCampaign: 'promo-setembro',
            utmContent: 'anuncio-1',
            utmTerm: 'ginecologista',
        });
    });

    it('aceita payload vazio (nenhum parâmetro capturado)', async () => {
        const { controller } = montar();
        const resultado = await controller.click({});
        expect(resultado).toEqual({ codigo: 'ABC12345' });
    });

    it('rejeita payload com campo em formato errado, com 400', async () => {
        const { controller } = montar();
        await expect(controller.click({ fbclid: 123 })).rejects.toThrow();
    });
});
