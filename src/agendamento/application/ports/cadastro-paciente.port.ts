import type { Cpf } from '../../domain/paciente/cpf';
import type { Telefone } from '../../domain/paciente/telefone';

export const CADASTRO_PACIENTE_PORT = Symbol('CadastroPacientePort');

export interface DadosVinculo {
    nome: string;
    telefone: Telefone;
    dataNascimento: string;
    email?: string;
    sexo?: 'M' | 'F';
}

export interface CadastroPacientePort {
    vincular(dados: DadosVinculo): Promise<{ idPaciente: number; matchConfiavel: boolean }>;
    registrarCpf(idPaciente: number, cpf: Cpf): Promise<void>;
}
