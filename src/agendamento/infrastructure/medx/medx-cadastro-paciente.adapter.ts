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
        const corpo: Record<string, string | number> = { Id_do_Cliente: idPaciente };
        if (dados.cpf) corpo.CPF_CGC = dados.cpf.digitos;
        if (dados.cidade) corpo.Cidade_Residencial = dados.cidade;
        if (dados.endereco) corpo.Endereco_Residencial = dados.endereco;
        if (dados.cep) corpo.Cep_Residencial = dados.cep;

        await this.client.put('/api/integration/contatos', corpo);
    }
}
