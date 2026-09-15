import { describe, it, expect } from 'vitest';
import { MedxCadastroPacienteAdapter } from './medx-cadastro-paciente.adapter';
import type { MedxHttpClient } from './medx-http.client';
import { Telefone } from '../../domain/paciente/telefone';
import { Cpf } from '../../domain/paciente/cpf';

const TELEFONE = Telefone.criar('+55 11 99999-8888');
const CPF = Cpf.criar('529.982.247-25');

function clientFalso(resposta: unknown) {
    const enviados: Array<{ caminho: string; corpo: unknown }> = [];
    const client = {
        get: async <T>() => ({}) as T,
        post: async <T>(caminho: string, corpo: unknown) => {
            enviados.push({ caminho, corpo });
            return resposta as T;
        },
        put: async <T>(caminho: string, corpo: unknown) => {
            enviados.push({ caminho, corpo });
            return 'Success' as T;
        },
    } as unknown as MedxHttpClient;
    return { client, enviados };
}

const DADOS = { nome: 'Maria Silva', telefone: TELEFONE, dataNascimento: '1990-05-20' };

describe('vincular', () => {
    it('converte o Id string da resposta em número', async () => {
        const { client } = clientFalso({ Id: '67890', Match: true });
        expect(await new MedxCadastroPacienteAdapter(client).vincular(DADOS)).toEqual({
            idPaciente: 67890,
            matchConfiavel: true,
        });
    });

    it('propaga match não confiável', async () => {
        const { client } = clientFalso({ Id: '1', Match: false });
        const r = await new MedxCadastroPacienteAdapter(client).vincular(DADOS);
        expect(r.matchConfiavel).toBe(false);
    });

    it('envia o telefone no formato nacional que a API espera', async () => {
        const { client, enviados } = clientFalso({ Id: '1', Match: true });
        await new MedxCadastroPacienteAdapter(client).vincular({
            ...DADOS,
            email: 'maria@email.com',
            sexo: 'F',
        });

        expect(enviados[0]).toEqual({
            caminho: '/api/integration/contatos/vinculo',
            corpo: {
                Name: 'Maria Silva',
                Phone: '11999998888',
                DateOfBirth: '1990-05-20',
                Email: 'maria@email.com',
                Gender: 'F',
            },
        });
    });

    it('omite email e sexo quando não informados', async () => {
        const { client, enviados } = clientFalso({ Id: '1', Match: true });
        await new MedxCadastroPacienteAdapter(client).vincular(DADOS);
        expect(enviados[0]!.corpo).not.toHaveProperty('Email');
        expect(enviados[0]!.corpo).not.toHaveProperty('Gender');
    });

    it('rejeita Id não numérico em vez de gerar NaN silencioso', async () => {
        const { client } = clientFalso({ Id: 'abc', Match: true });
        await expect(new MedxCadastroPacienteAdapter(client).vincular(DADOS)).rejects.toThrow(/Id/);
    });

    it('rejeita Id zero ou negativo', async () => {
        const { client } = clientFalso({ Id: '0', Match: true });
        await expect(new MedxCadastroPacienteAdapter(client).vincular(DADOS)).rejects.toThrow(/Id/);
    });
});

describe('enriquecerFicha', () => {
    it('envia PUT com Id_do_Cliente e o CPF só com dígitos', async () => {
        const { client, enviados } = clientFalso({});
        await new MedxCadastroPacienteAdapter(client).enriquecerFicha(67890, { cpf: CPF });

        expect(enviados[0]).toEqual({
            caminho: '/api/integration/contatos',
            corpo: { Id_do_Cliente: 67890, CPF_CGC: '52998224725' },
        });
    });

    it('envia cidade, endereço e cep mapeados para os campos residenciais do MedX', async () => {
        const { client, enviados } = clientFalso({});
        await new MedxCadastroPacienteAdapter(client).enriquecerFicha(67890, {
            cidade: 'São Paulo',
            endereco: 'Rua Teste, 450',
            cep: '01310100',
        });

        expect(enviados[0]).toEqual({
            caminho: '/api/integration/contatos',
            corpo: {
                Id_do_Cliente: 67890,
                Cidade_Residencial: 'São Paulo',
                Endereco_Residencial: 'Rua Teste, 450',
                Cep_Residencial: '01310100',
            },
        });
    });

    it('combina cpf e endereço numa única chamada', async () => {
        const { client, enviados } = clientFalso({});
        await new MedxCadastroPacienteAdapter(client).enriquecerFicha(67890, {
            cpf: CPF,
            cidade: 'São Paulo',
        });

        expect(enviados[0]!.corpo).toEqual({
            Id_do_Cliente: 67890,
            CPF_CGC: '52998224725',
            Cidade_Residencial: 'São Paulo',
        });
    });

    it('omite os campos não informados', async () => {
        const { client, enviados } = clientFalso({});
        await new MedxCadastroPacienteAdapter(client).enriquecerFicha(67890, { cidade: 'x' });

        const corpo = enviados[0]!.corpo as Record<string, unknown>;
        expect(corpo).not.toHaveProperty('CPF_CGC');
        expect(corpo).not.toHaveProperty('Endereco_Residencial');
        expect(corpo).not.toHaveProperty('Cep_Residencial');
    });
});
