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
    sexo?: 'M' | 'F';
    cidade?: string;
    endereco?: string;
    cep?: string;
    /** Duração em minutos, usada quando o tipo de consulta não tem duração cadastrada no MedX. */
    duracaoConsulta?: number;
}
