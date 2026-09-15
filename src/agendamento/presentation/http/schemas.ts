import { z } from 'zod';
import { VALORES_RESPOSTA } from '../../domain/agendamento/resposta-lembrete';

export const schemaAgendamento = z.object({
    deal_id: z.string().uuid(),
    nome: z.string().min(1),
    telefone: z.string().min(1),
    data_nascimento: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'data de nascimento deve estar no formato YYYY-MM-DD'),
    // Mantido flexível: aceita offset, "Z" ou nenhum offset (horário local da
    // clínica) — todos válidos conforme PeriodoConsulta.criar.
    data_hora: z.string().min(1),
    profissional: z.union([z.string().min(1), z.number()]),
    tipo_consulta: z.union([z.string().min(1), z.number()]),
    cpf: z.string().optional(),
    email: z.string().optional(),
    sexo: z.enum(['M', 'F']).optional(),
});

export const schemaResposta = z.object({
    deal_id: z.string().uuid(),
    id_agendamento_medx: z.coerce.number().int().positive(),
    resposta: z.enum(VALORES_RESPOSTA as unknown as [string, ...string[]]),
});

export type PayloadAgendamento = z.infer<typeof schemaAgendamento>;
export type PayloadResposta = z.infer<typeof schemaResposta>;
