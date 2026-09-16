import { z } from 'zod';
import { VALORES_RESPOSTA } from '../../domain/agendamento/resposta-lembrete';

export const schemaAgendamento = z.object({
    deal_id: z.string().uuid(),
    nome: z.string().min(1),
    telefone: z.string().min(1),
    data_nascimento: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'data de nascimento deve estar no formato YYYY-MM-DD'),
    // A Clint manda dia e hora em campos separados — combinados em data_hora
    // antes de chegar no comando (ver WebhooksController). Formato do dia:
    // YYYY-MM-DD (confirmado com payload real); hora aceita HH:mm ou HH:mm:ss.
    dia_da_consulta: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'dia da consulta deve estar no formato YYYY-MM-DD'),
    hora_da_consulta: z.string().min(1),
    profissional: z.union([z.string().min(1), z.number()]),
    tipo_consulta: z.union([z.string().min(1), z.number()]),
    cpf: z.string().optional(),
    email: z.string().optional(),
    sexo: z.enum(['M', 'F']).optional(),
    cidade: z.string().optional(),
    // A Clint manda esse campo como rich-text (ex.: "<p>Rua Tal, 123</p>") —
    // removemos as tags HTML antes de repassar pro MedX.
    endereco: z
        .string()
        .optional()
        .transform(v => (v ? v.replace(/<[^>]*>/g, '').trim() : v)),
    cep: z.string().optional(),
    // Fallback usado quando o tipo de consulta não tem duração cadastrada no MedX.
    duracao_consulta: z.coerce.number().int().positive().optional(),
});

export const schemaResposta = z.object({
    deal_id: z.string().uuid(),
    id_agendamento_medx: z.coerce.number().int().positive(),
    resposta: z.enum(VALORES_RESPOSTA as unknown as [string, ...string[]]),
});

export type PayloadAgendamento = z.infer<typeof schemaAgendamento>;
export type PayloadResposta = z.infer<typeof schemaResposta>;
