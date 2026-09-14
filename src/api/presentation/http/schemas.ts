import { z } from "zod";
import { VALORES_RESPOSTA } from "../../domain/agendamento/resposta-lembrete.js";

export const schemaAgendamento = z.object({
  deal_id: z.string().min(1),
  nome: z.string().min(1),
  telefone: z.string().min(1),
  data_nascimento: z.string().min(1),
  data_hora: z.string().min(1),
  profissional: z.union([z.string().min(1), z.number()]),
  tipo_consulta: z.union([z.string().min(1), z.number()]),
  cpf: z.string().optional(),
  email: z.string().optional(),
  sexo: z.enum(["M", "F"]).optional(),
});

export const schemaResposta = z.object({
  deal_id: z.string().min(1),
  id_agendamento_medx: z.coerce.number().int().positive(),
  resposta: z.enum(VALORES_RESPOSTA as unknown as [string, ...string[]]),
});

export type PayloadAgendamento = z.infer<typeof schemaAgendamento>;
export type PayloadResposta = z.infer<typeof schemaResposta>;
