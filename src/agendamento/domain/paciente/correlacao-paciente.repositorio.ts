import type { Telefone } from './telefone';
import type { CorrelacaoPaciente } from './correlacao-paciente';

export interface CorrelacaoPacienteRepositorio {
    buscarPorTelefone(telefone: Telefone): Promise<CorrelacaoPaciente | null>;
    salvar(correlacao: CorrelacaoPaciente): Promise<void>;
}
