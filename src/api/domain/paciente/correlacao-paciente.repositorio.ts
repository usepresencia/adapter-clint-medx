import type { Telefone } from "./telefone.js";
import type { CorrelacaoPaciente } from "./correlacao-paciente.js";

export interface CorrelacaoPacienteRepositorio {
  buscarPorTelefone(telefone: Telefone): CorrelacaoPaciente | null;
  salvar(correlacao: CorrelacaoPaciente): void;
}
