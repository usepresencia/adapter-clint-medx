export interface ComandoAgendamento {
    dealId: string;
    nome: string;
    telefone: string;
    dataNascimento: string;
    dataHora: string;
    profissional: string | number;
    tipoConsulta: string | number;
    email?: string;
    sexo?: 'M' | 'F';
    /** Duração em minutos, usada quando o tipo de consulta não tem duração cadastrada no MedX. */
    duracaoConsulta?: number;
}
