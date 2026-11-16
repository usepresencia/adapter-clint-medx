import { describe, it, expect } from 'vitest';
import { MedxCadastroPacienteAdapter } from './medx-cadastro-paciente.adapter';
import type { MedxHttpClient } from './medx-http.client';
import { Telefone } from '../../domain/paciente/telefone';

const TELEFONE = Telefone.criar('+55 11 99999-8888');
const PREFIXO = '/api/integration/v1/contatos/operacoes';

function clientFalso(resposta: unknown = {}) {
    const enviados: Array<{ caminho: string; corpo: unknown }> = [];
    const client = {
        executarOperacao: async <T>(caminho: string, corpo: unknown) => {
            enviados.push({ caminho, corpo });
            return resposta as T;
        },
    } as unknown as MedxHttpClient;
    return { client, enviados };
}

const DADOS = { nome: 'Maria Silva', telefone: TELEFONE, dataNascimento: '1990-05-20' };
const resultado = (dados: Record<string, unknown>) => ({
    operationId: 'op',
    acao: 'vincular',
    dados,
});

describe('vincular', () => {
    it('vincular manda acao vincular e lê pacienteId', async () => {
        const { client, enviados } = clientFalso(resultado({ pacienteId: -67890, criado: true }));

        const r = await new MedxCadastroPacienteAdapter(client).vincular({
            ...DADOS,
            email: 'maria@x.test',
            sexo: 'F',
        });

        expect(r.idPaciente).toBe(-67890);
        expect(enviados[0]).toEqual({
            caminho: PREFIXO,
            corpo: {
                acao: 'vincular',
                vinculo: {
                    nome: 'Maria Silva',
                    telefone: TELEFONE.nacional,
                    nascimento: '1990-05-20',
                    email: 'maria@x.test',
                    sexo: 'F',
                },
            },
        });
    });

    it('vincular com paciente existente é match confiável', async () => {
        const { client } = clientFalso(resultado({ pacienteId: 1, criado: false }));
        expect((await new MedxCadastroPacienteAdapter(client).vincular(DADOS)).matchConfiavel).toBe(
            true,
        );
    });

    it('paciente criado agora não é match confiável', async () => {
        const { client } = clientFalso(resultado({ pacienteId: 1, criado: true }));
        expect((await new MedxCadastroPacienteAdapter(client).vincular(DADOS)).matchConfiavel).toBe(
            false,
        );
    });

    it('omite email e sexo quando não informados', async () => {
        const { client, enviados } = clientFalso(resultado({ pacienteId: 1, criado: false }));
        await new MedxCadastroPacienteAdapter(client).vincular(DADOS);
        const vinculo = (enviados[0]!.corpo as { vinculo: Record<string, unknown> }).vinculo;
        expect(vinculo).not.toHaveProperty('email');
        expect(vinculo).not.toHaveProperty('sexo');
    });

    it('rejeita pacienteId zero ou ausente', async () => {
        const { client } = clientFalso(resultado({ pacienteId: 0 }));
        await expect(new MedxCadastroPacienteAdapter(client).vincular(DADOS)).rejects.toThrow(
            /pacienteId/,
        );
    });
});

describe('enriquecerFicha', () => {
    it('enriquecerFicha manda só o celular', async () => {
        const { client, enviados } = clientFalso();

        await new MedxCadastroPacienteAdapter(client).enriquecerFicha(-67890, {
            telefone: TELEFONE,
        });

        expect(enviados[0]).toEqual({
            caminho: PREFIXO,
            corpo: {
                acao: 'atualizar',
                pacienteId: -67890,
                dados: { celular: TELEFONE.nacional },
            },
        });
    });
});

describe('obterCelular', () => {
    const com = (dados: Record<string, unknown>) => {
        const caminhos: string[] = [];
        const client = {
            get: async <T>(caminho: string) => {
                caminhos.push(caminho);
                return { id: 1, dados } as T;
            },
        } as unknown as MedxHttpClient;
        return { client, caminhos };
    };

    it('obterCelular lê dados.celular e cai para telefoneResidencial', async () => {
        const a = com({ celular: '45999197847', telefoneResidencial: '4532221111' });
        expect(await new MedxCadastroPacienteAdapter(a.client).obterCelular(1090077047)).toBe(
            '45999197847',
        );
        expect(a.caminhos[0]).toBe('/api/integration/v1/contatos/1090077047');
        const b = com({ celular: '', telefoneResidencial: '4532221111' });
        expect(await new MedxCadastroPacienteAdapter(b.client).obterCelular(1)).toBe('4532221111');
    });

    it('obterCelular sem telefone → null', async () => {
        const { client } = com({ celular: null, telefoneResidencial: '' });
        expect(await new MedxCadastroPacienteAdapter(client).obterCelular(1)).toBeNull();
    });
});
