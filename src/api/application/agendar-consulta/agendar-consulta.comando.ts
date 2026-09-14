export interface ComandoAgendamento {
  dealId: string;
  nome: string;
  telefone: string;
  dataNascimento: string;
  dataHora: string;
  profissional: string | number;
  tipoConsulta: string | number;
  cpf?: string;
  email?: string;
  sexo?: "M" | "F";
}
