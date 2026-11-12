import { describe, it, expect } from 'vitest';
import { MedxCadastroPacienteAdapter } from './medx-cadastro-paciente.adapter';
import type { MedxHttpClient } from './medx-http.client';
import { Telefone } from '../../domain/paciente/telefone';
import { Cpf } from '../../domain/paciente/cpf';

const TELEFONE = Telefone.criar('+55 11 99999-8888');
const CPF = Cpf.criar('529.982.247-25');
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
    it('enriquecerFicha manda só os campos informados', async () => {
        const { client, enviados } = clientFalso();

        await new MedxCadastroPacienteAdapter(client).enriquecerFicha(-67890, {
            cpf: CPF,
            telefone: TELEFONE,
            cidade: 'Toledo',
        });

        expect(enviados[0]).toEqual({
            caminho: PREFIXO,
            corpo: {
                acao: 'atualizar',
                pacienteId: -67890,
                dados: {
                    cpfCnpj: '52998224725',
                    celular: TELEFONE.nacional,
                    cidadeResidencial: 'Toledo',
                },
            },
        });
    });
});
