import type { Telefone } from './telefone';
import type { CorrelacaoPaciente } from './correlacao-paciente';

export const CORRELACAO_PACIENTE_REPOSITORIO = Symbol('CorrelacaoPacienteRepositorio');

export interface CorrelacaoPacienteRepositorio {
    buscarPorTelefone(telefone: Telefone): Promise<CorrelacaoPaciente | null>;
    salvar(correlacao: CorrelacaoPaciente): Promise<void>;
}
