import { Injectable } from '@nestjs/common';
import type {
    CadastroPacientePort,
    DadosEnriquecimento,
    DadosVinculo,
} from '../../application/ports/cadastro-paciente.port';
import { MedxHttpClient } from './medx-http.client';
import type { MedxVinculoResposta } from './medx.tipos';

@Injectable()
export class MedxCadastroPacienteAdapter implements CadastroPacientePort {
    constructor(private readonly client: MedxHttpClient) {}

    async vincular(dados: DadosVinculo) {
        const corpo: Record<string, string> = {
            Name: dados.nome,
            Phone: dados.telefone.nacional,
            DateOfBirth: dados.dataNascimento,
        };
        if (dados.email) corpo.Email = dados.email;
        if (dados.sexo) corpo.Gender = dados.sexo;

        const resposta = await this.client.post<MedxVinculoResposta>(
            '/api/integration/contatos/vinculo',
            corpo,
        );

        const idPaciente = Number(resposta?.id);
        // Ids negativos são válidos nesta conta (confirmado ao vivo em outras
        // entidades do MedX — ver medx-agenda.adapter.ts). Só 0/NaN indicam falha.
        if (!Number.isInteger(idPaciente) || idPaciente === 0) {
            throw new Error(
                `Vínculo devolveu Id inesperado do MedX: ${JSON.stringify(resposta?.id)}`,
            );
        }

        return { idPaciente, matchConfiavel: Boolean(resposta.match) };
    }

    async enriquecerFicha(idPaciente: number, dados: DadosEnriquecimento): Promise<void> {
        // `vincular()` manda o telefone em `Phone`, mas esse campo não é persistido
        // no cadastro do paciente (confirmado no painel do MedX). A API é
        // case-sensitive pro binding do PUT: confirmado ao vivo via
        // GET /contatos/{id} que a grafia real é com a primeira letra minúscula
        // (id_do_Cliente, celular, cpF_CGC, cidade_Residencial,
        // endereco_Residencial, cep_Residencial) — a doc documenta tudo com a
        // primeira letra maiúscula, o que faz esses campos serem ignorados
        // silenciosamente (foi assim que cidade/endereço/cep nunca salvavam).
        const corpo: Record<string, string | number> = { id_do_Cliente: idPaciente };
        if (dados.cpf) corpo.cpF_CGC = dados.cpf.digitos;
        if (dados.telefone) corpo.celular = dados.telefone.nacional;
        if (dados.cidade) corpo.cidade_Residencial = dados.cidade;
        if (dados.endereco) corpo.endereco_Residencial = dados.endereco;
        if (dados.cep) corpo.cep_Residencial = dados.cep;

        await this.client.put('/api/integration/contatos', corpo);
    }
}
