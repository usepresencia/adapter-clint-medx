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
    // antes de chegar no comando (ver WebhooksController). O dia agora vem de
    // um campo DATE do negócio (DEAL/data_agendamento), que a Clint sempre
    // serializa como DD/MM/AAAA (confirmado com payload real) — não é o
    // AAAA-MM-DD que a validação exigia antes. Hora aceita HH:mm ou HH:mm:ss.
    dia_da_consulta: z
        .string()
        .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'dia da consulta deve estar no formato DD/MM/AAAA'),
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
    telefone: z.string().min(1),
});

export const schemaLeadOrigem = z.object({
    telefone: z.string().min(1),
    texto_mensagem: z.string().min(1),
});

export const schemaCapturarClique = z.object({
    fbclid: z.string().optional(),
    utm_source: z.string().optional(),
    utm_medium: z.string().optional(),
    utm_campaign: z.string().optional(),
    utm_content: z.string().optional(),
    utm_term: z.string().optional(),
});

export const schemaVendaGanha = z.object({
    telefone: z.string().min(1),
    valor: z.coerce.number(),
});

export const schemaDisponibilidade = z.object({
    profissional: z.string().min(1),
    data_inicio: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'data_inicio deve estar no formato YYYY-MM-DD'),
    data_fim: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'data_fim deve estar no formato YYYY-MM-DD')
        .optional(),
    duracao_minutos: z.coerce.number().int().positive().optional(),
});
