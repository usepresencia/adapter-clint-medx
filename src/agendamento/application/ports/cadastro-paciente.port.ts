import type { Telefone } from '../../domain/paciente/telefone';

export const CADASTRO_PACIENTE_PORT = Symbol('CadastroPacientePort');

export interface DadosVinculo {
    nome: string;
    telefone: Telefone;
    dataNascimento: string;
    email?: string;
    sexo?: 'M' | 'F';
}

export interface DadosEnriquecimento {
    telefone: Telefone;
}

export interface CadastroPacientePort {
    vincular(dados: DadosVinculo): Promise<{ idPaciente: number; matchConfiavel: boolean }>;
    enriquecerFicha(idPaciente: number, dados: DadosEnriquecimento): Promise<void>;
    /** Celular do cadastro (ou o residencial); `null` se nenhum. */
    obterCelular(idPaciente: number): Promise<string | null>;
}
