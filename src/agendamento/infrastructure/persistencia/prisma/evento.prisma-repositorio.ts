import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../shared/persistence/prisma.service';
import { EventoRecebido, type StatusEvento } from '../../../domain/evento/evento-recebido';
import type { EventoRepositorio } from '../../../domain/evento/evento.repositorio';

@Injectable()
export class EventoPrismaRepositorio implements EventoRepositorio {
    constructor(private readonly prisma: PrismaService) {}

    async registrar(endpoint: string, payload: unknown): Promise<EventoRecebido> {
        const criado = await this.prisma.eventoRecebido.create({
            data: {
                endpoint,
                payloadBruto: payload as Prisma.InputJsonValue,
                status: 'recebido',
            },
        });

        return EventoRecebido.restaurar({
            id: criado.id,
            endpoint,
            status: 'recebido' as StatusEvento,
            erro: null,
            jobId: null,
        });
    }

    async salvar(evento: EventoRecebido): Promise<void> {
        await this.prisma.eventoRecebido.update({
            where: { id: evento.id },
            data: { status: evento.status, erro: evento.erro, jobId: evento.jobId },
        });
    }

    async expurgar(dias: number): Promise<number> {
        const limite = new Date();
        limite.setDate(limite.getDate() - dias);
        const resultado = await this.prisma.eventoRecebido.deleteMany({
            where: { recebidoEm: { lt: limite } },
        });
        return resultado.count;
    }

    async registrarExistente(id: number): Promise<EventoRecebido> {
        const l = await this.prisma.eventoRecebido.findUnique({ where: { id } });
        if (!l) {
            throw new Error(`Evento ${id} não encontrado`);
        }
        return EventoRecebido.restaurar({
            id: l.id,
            endpoint: l.endpoint,
            status: l.status as StatusEvento,
            erro: l.erro,
            jobId: l.jobId,
        });
    }
}
