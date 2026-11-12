import { Injectable } from '@nestjs/common';
import type {
    CadastroPacientePort,
    DadosEnriquecimento,
    DadosVinculo,
} from '../../application/ports/cadastro-paciente.port';
import { MedxHttpClient } from './medx-http.client';
import type { MedxContatoResultado } from './medx.tipos';

const PREFIXO = '/api/integration/v1/contatos/operacoes';

@Injectable()
export class MedxCadastroPacienteAdapter implements CadastroPacientePort {
    constructor(private readonly client: MedxHttpClient) {}

    /**
     * Localiza a paciente ou a cadastra se não houver correspondência. Um 409
     * (correspondência ambígua) sobe como ErroMedx: exige escolha humana.
     */
    async vincular(dados: DadosVinculo) {
        const vinculo: Record<string, string> = {
            nome: dados.nome,
            telefone: dados.telefone.nacional,
            nascimento: dados.dataNascimento,
        };
        if (dados.email) vinculo.email = dados.email;
        if (dados.sexo) vinculo.sexo = dados.sexo;

        const resposta = await this.client.executarOperacao<{ dados?: MedxContatoResultado }>(
            PREFIXO,
            { acao: 'vincular', vinculo },
        );

        const idPaciente = Number(resposta?.dados?.pacienteId);
        // Ids negativos são válidos nesta conta; só 0/NaN indicam falha.
        if (!Number.isInteger(idPaciente) || idPaciente === 0) {
            throw new Error(
                `Vínculo do MedX devolveu pacienteId inesperado: ${JSON.stringify(resposta?.dados?.pacienteId)}`,
            );
        }

        // Paciente já existente é o equivalente ao antigo `match: true`.
        return { idPaciente, matchConfiavel: resposta.dados?.criado === false };
    }

    /** Atualização parcial: na v1 os campos omitidos são preservados. */
    async enriquecerFicha(idPaciente: number, dados: DadosEnriquecimento): Promise<void> {
        const campos: Record<string, string> = {};
        if (dados.cpf) campos.cpfCnpj = dados.cpf.digitos;
        if (dados.telefone) campos.celular = dados.telefone.nacional;
        if (dados.cidade) campos.cidadeResidencial = dados.cidade;
        if (dados.endereco) campos.enderecoResidencial = dados.endereco;
        if (dados.cep) campos.cepResidencial = dados.cep;

        await this.client.executarOperacao(PREFIXO, {
            acao: 'atualizar',
            pacienteId: idPaciente,
            dados: campos,
        });
    }
}
