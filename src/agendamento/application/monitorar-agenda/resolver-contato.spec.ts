import { describe, it, expect, vi } from 'vitest';
import { ResolvedorContato } from './resolver-contato';
import type { ContatoClint } from '../ports/crm-negocio.port';

const KARMEN: ContatoClint = { id: 'karmen', nome: 'Karmen 💓💓', telefone: '+5544999365902' };
const SILVIA: ContatoClint = { id: 'silvia', nome: 'Silvia Fey🩷🩷', telefone: '+5544999365902' };
const JULIANE: ContatoClint = { id: 'juliane', nome: 'Juliane Rafaeli', telefone: '+595982663052' };

function montar(opcoes: {
    celular: string | null;
    porTelefone?: ContatoClint[];
    porNome?: ContatoClint[];
}) {
    const cadastro = {
        obterCelular: vi.fn(async () => opcoes.celular),
        enriquecerFicha: vi.fn(async () => {}),
    };
    const crm = {
        buscarContatos: vi.fn(async (f: { telefone?: unknown; nome?: string }) =>
            f.telefone ? (opcoes.porTelefone ?? []) : (opcoes.porNome ?? []),
        ),
    };
    const resolvedor = new ResolvedorContato(cadastro as any, crm as any);
    return { resolvedor, cadastro, crm };
}

const paciente = (nome: string, idPaciente = 77) => ({ idPaciente, nome });

describe('ResolvedorContato', () => {
    it('telefone com um contato usa direto', async () => {
        const { resolvedor } = montar({ celular: '44999365902', porTelefone: [KARMEN] });
        const r = await resolvedor.resolver(paciente('SILVIA FEY'), {
            contatosAbertos: [],
            gravar: true,
        });
        expect(r).toMatchObject({ tipo: 'contato', contato: KARMEN });
    });

    it('telefone compartilhado escolhe pelo nome', async () => {
        const { resolvedor } = montar({ celular: '44999365902', porTelefone: [KARMEN, SILVIA] });
        const r = await resolvedor.resolver(paciente('SILVIA FEY'), {
            contatosAbertos: [],
            gravar: true,
        });
        expect(r).toMatchObject({ tipo: 'contato', contato: SILVIA });
    });

    it('telefone compartilhado sem nome que case é ambíguo', async () => {
        const { resolvedor } = montar({ celular: '44999365902', porTelefone: [KARMEN, SILVIA] });
        const r = await resolvedor.resolver(paciente('ROSANE DAL PIVA'), {
            contatosAbertos: [],
            gravar: true,
        });
        expect(r).toEqual({ tipo: 'ambiguo', candidatos: [KARMEN, SILVIA] });
    });

    it('telefone estrangeiro gravado sem o 5 no MedX acha a paciente pelo nome', async () => {
        const { resolvedor } = montar({ celular: '95982663052', porTelefone: [], porNome: [] });
        const r = await resolvedor.resolver(paciente('JULIANE LUISA SCHUH RAFAELI'), {
            contatosAbertos: [JULIANE],
            gravar: true,
        });
        expect(r).toMatchObject({ tipo: 'contato', contato: JULIANE });
    });

    it('sem celular acha pelo nome e grava o telefone no MedX', async () => {
        const andreia = { id: 'andreia', nome: 'Andréia Welter 🌻', telefone: '+5545999141574' };
        const { resolvedor, cadastro, crm } = montar({ celular: null, porNome: [andreia] });
        const r = await resolvedor.resolver(paciente('ANDREIA WELTER DE BARROS E SILVA'), {
            contatosAbertos: [],
            gravar: true,
        });
        expect(r).toMatchObject({ tipo: 'contato', contato: andreia });
        expect(crm.buscarContatos).toHaveBeenCalledWith({ nome: 'ANDREIA' });
        expect(cadastro.enriquecerFicha).toHaveBeenCalledWith(77, {
            telefone: expect.objectContaining({ e164: '+5545999141574' }),
        });
    });

    it('sem celular e sem contato é novo sem telefone', async () => {
        const { resolvedor } = montar({ celular: null, porNome: [] });
        const r = await resolvedor.resolver(paciente('SIGMUND FEY'), {
            contatosAbertos: [],
            gravar: true,
        });
        expect(r).toEqual({ tipo: 'novo', telefone: null });
    });

    it('em observar não grava no MedX', async () => {
        const andreia = { id: 'andreia', nome: 'Andréia Welter', telefone: '+5545999141574' };
        const { resolvedor, cadastro } = montar({ celular: null, porNome: [andreia] });
        await resolvedor.resolver(paciente('ANDREIA WELTER'), {
            contatosAbertos: [],
            gravar: false,
        });
        expect(cadastro.enriquecerFicha).not.toHaveBeenCalled();
    });
});
