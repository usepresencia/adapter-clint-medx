import { describe, it, expect, vi } from 'vitest';
import { AdapterProcessor } from './adapter.processor';
import { LIMITER, OPCOES_JOB, NOME_FILA } from './fila.constants';
import { ErroRateLimit } from '../medx/medx.erros';
import { EventoRecebido } from '../../domain/evento/evento-recebido';

describe('constantes da fila', () => {
    it('respeita o teto de 30 req/min do MedX com margem', () => {
        expect(LIMITER.max).toBeLessThan(30);
        expect(LIMITER.duration).toBe(60_000);
    });

    it('usa backoff exponencial com pelo menos 6 tentativas', () => {
        expect(OPCOES_JOB.attempts).toBeGreaterThanOrEqual(6);
        expect(OPCOES_JOB.backoff.type).toBe('exponential');
    });

    it('não descarta jobs que falharam, para permitir inspeção', () => {
        expect(OPCOES_JOB.removeOnFail).toBe(false);
    });

    it('usa um nome de fila estável', () => {
        expect(NOME_FILA).toBe('adapter-clint-medx');
    });
});

function eventosFalso() {
    const registros = new Map<number, EventoRecebido>();
    let proximoId = 1;
    return {
        async registrar(endpoint: string) {
            const e = EventoRecebido.restaurar({
                id: proximoId++,
                endpoint,
                status: 'recebido',
                erro: null,
                jobId: null,
            });
            registros.set(e.id, e);
            return e;
        },
        async salvar(e: EventoRecebido) {
            registros.set(e.id, e);
        },
        async expurgar() {
            return 0;
        },
        async buscarPorId(id: number) {
            return registros.get(id)!;
        },
    };
}

function montar() {
    const eventos = eventosFalso();
    const agendarConsulta = { executar: vi.fn(async () => {}) };
    const processarResposta = { executar: vi.fn(async () => {}) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const processor = new AdapterProcessor(
        eventos as any,
        agendarConsulta as any,
        processarResposta as any,
        logger as any,
    );
    // WorkerHost.worker é um getter só-leitura apoiado no campo privado
    // `_worker` (atribuído pelo runtime do Nest); em teste direto, atribuímos
    // o dublê diretamente no backing field.
    (processor as any)._worker = { rateLimit: vi.fn() };

    return { eventos, agendarConsulta, processarResposta, logger, processor };
}

describe('AdapterProcessor.process', () => {
    it('roteia job de agendamento para o caso de uso certo', async () => {
        const { eventos, agendarConsulta, processarResposta, processor } = montar();
        const e = await eventos.registrar('/x');
        await processor.process({
            data: { tipo: 'agendamento', eventoId: e.id, comando: {} },
        } as any);

        expect(agendarConsulta.executar).toHaveBeenCalled();
        expect(processarResposta.executar).not.toHaveBeenCalled();
    });

    it('roteia job de resposta para o caso de uso certo', async () => {
        const { eventos, agendarConsulta, processarResposta, processor } = montar();
        const e = await eventos.registrar('/x');
        await processor.process({ data: { tipo: 'resposta', eventoId: e.id, comando: {} } } as any);

        expect(processarResposta.executar).toHaveBeenCalled();
        expect(agendarConsulta.executar).not.toHaveBeenCalled();
    });

    it('marca o evento como processado no sucesso', async () => {
        const { eventos, processor } = montar();
        const e = await eventos.registrar('/x');
        await processor.process({
            data: { tipo: 'agendamento', eventoId: e.id, comando: {} },
        } as any);
        expect((await eventos.buscarPorId(e.id)).status).toBe('processado');
    });

    it('marca falhou com a mensagem e repropaga para o BullMQ tentar de novo', async () => {
        const { eventos, agendarConsulta, processor } = montar();
        agendarConsulta.executar = vi.fn(async () => {
            throw new Error('MedX fora do ar');
        });
        const e = await eventos.registrar('/x');

        await expect(
            processor.process({
                data: { tipo: 'agendamento', eventoId: e.id, comando: {} },
            } as any),
        ).rejects.toThrow(/fora do ar/);

        const salvo = await eventos.buscarPorId(e.id);
        expect(salvo.status).toBe('falhou');
        expect(salvo.erro).toMatch(/fora do ar/);
    });

    it('repropaga um erro especial de rate limit para o worker aplicar o Retry-After', async () => {
        const { eventos, agendarConsulta, processor } = montar();
        agendarConsulta.executar = vi.fn(async () => {
            throw new ErroRateLimit(60);
        });
        const e = await eventos.registrar('/x');

        await expect(
            processor.process({
                data: { tipo: 'agendamento', eventoId: e.id, comando: {} },
            } as any),
        ).rejects.toThrow();
        expect((processor.worker as any).rateLimit).toHaveBeenCalledWith(60_000);
    });

    it('registra rate limit como aviso, não como erro, e não marca o evento como falhou', async () => {
        const { eventos, agendarConsulta, logger, processor } = montar();
        agendarConsulta.executar = vi.fn(async () => {
            throw new ErroRateLimit(60);
        });
        const e = await eventos.registrar('/x');

        await expect(
            processor.process({
                data: { tipo: 'agendamento', eventoId: e.id, comando: {} },
            } as any),
        ).rejects.toThrow();

        expect(logger.warn).toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        expect((await eventos.buscarPorId(e.id)).status).toBe('recebido');
    });
});

describe('AdapterProcessor.aoFalhar (dead letter)', () => {
    it('alerta quando o job esgota as tentativas', () => {
        const { logger, processor } = montar();
        processor.aoFalhar(
            { id: 'job-1', attemptsMade: 6, opts: { attempts: 6 } } as any,
            new Error('MedX fora do ar'),
        );
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ alerta: true }),
            expect.any(String),
        );
    });

    it('não alerta quando ainda há tentativas restantes', () => {
        const { logger, processor } = montar();
        processor.aoFalhar(
            { id: 'job-1', attemptsMade: 2, opts: { attempts: 6 } } as any,
            new Error('timeout'),
        );
        expect(logger.error).not.toHaveBeenCalled();
    });
});
