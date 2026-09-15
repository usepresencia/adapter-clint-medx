import { Injectable } from '@nestjs/common';
import type {
    CadastroPacientePort,
    DadosVinculo,
} from '../../application/ports/cadastro-paciente.port';
import type { Cpf } from '../../domain/paciente/cpf';
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

        const idPaciente = Number(resposta?.Id);
        if (!Number.isInteger(idPaciente) || idPaciente <= 0) {
            throw new Error(
                `Vínculo devolveu Id inesperado do MedX: ${JSON.stringify(resposta?.Id)}`,
            );
        }

        return { idPaciente, matchConfiavel: Boolean(resposta.Match) };
    }

    async registrarCpf(idPaciente: number, cpf: Cpf): Promise<void> {
        await this.client.put('/api/integration/contatos', {
            Id_do_Cliente: idPaciente,
            CPF_CGC: cpf.digitos,
        });
    }
}
