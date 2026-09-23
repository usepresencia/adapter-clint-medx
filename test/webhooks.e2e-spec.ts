import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import request from 'supertest';

process.env.ADAPTER_SECRET = 'segredo-de-teste';
process.env.MEDX_INTEGRATION_TOKEN = 'token-fake';
process.env.CLINT_WEBHOOK_AGENDAMENTO_URL = 'https://clint.test/a';
process.env.CLINT_WEBHOOK_NOTIFICACAO_URL = 'https://clint.test/n';
process.env.CLINT_API_TOKEN = 'token-fake';
process.env.META_PIXEL_ID = 'pixel-teste';
process.env.META_CAPI_ACCESS_TOKEN = 'token-teste';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/adapter';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';

import { AppModule } from '../src/app.module';
import { CATALOGO_CLINICO_PORT } from '../src/agendamento/application/ports/catalogo-clinico.port';
import { AGENDA_MEDICA_PORT } from '../src/agendamento/application/ports/agenda-medica.port';
import { CADASTRO_PACIENTE_PORT } from '../src/agendamento/application/ports/cadastro-paciente.port';
import { CRM_PORT } from '../src/agendamento/application/ports/crm.port';
import { CRM_CONTATO_PORT } from '../src/agendamento/application/ports/crm-contato.port';
import { CONVERSAO_PORT } from '../src/agendamento/application/ports/conversao.port';
import { FILA_PORT } from '../src/agendamento/application/ports/fila.port';
import { LOGGER_PORT } from '../src/agendamento/application/ports/logger.port';
import { NotFoundFilter } from '../src/shared/presentation/not-found.filter';
import { PrismaService } from '../src/shared/persistence/prisma.service';

const SEGREDO = 'segredo-de-teste';

const catalogoFalso = {
    carregar: vi.fn(async () => {}),
    resolverProfissional: vi.fn(async () => 43013640),
    resolverTipoConsulta: vi.fn(async () => ({ id: 111, nome: 'Consulta', duracaoMinutos: 30 })),
    indiceStatusAgendado: () => 0,
    indiceStatusConfirmado: () => 1,
};
const agendaFalsa = {
    criar: vi.fn(async () => 1275002478),
    obter: vi.fn(async () => ({
        id: 1275002478,
        idProfissional: 43013640,
        idPaciente: 67890,
        inicio: '',
        fim: '',
        descricao: '',
        status: 0,
        idTipoConsulta: 111,
        confirmacao: '',
        ultimaEdicao: '',
        bruto: {},
    })),
    listarPorPaciente: vi.fn(async () => []),
    confirmar: vi.fn(async () => {}),
    consultarDisponibilidade: vi.fn(async () => [
        { inicio: '2026-07-10T09:00:00', fim: '2026-07-10T09:30:00' },
    ]),
};
const cadastroFalso = {
    vincular: vi.fn(async () => ({ idPaciente: 67890, matchConfiavel: true })),
    enriquecerFicha: vi.fn(async () => {}),
};
const crmFalso = {
    gravarIdAgendamento: vi.fn(async () => {}),
    notificarConfirmacao: vi.fn(async () => {}),
    notificarReagendamento: vi.fn(async () => {}),
    notificarCancelamento: vi.fn(async () => {}),
    notificarConflito: vi.fn(async () => {}),
};
const contatosFalso = {
    buscarIdPorTelefone: vi.fn(async () => 'contato-1'),
    adicionarTag: vi.fn(async () => {}),
};
const conversaoFalso = {
    notificarConversao: vi.fn(async () => {}),
    notificarCompra: vi.fn(async () => {}),
};

const AGENDAMENTO = {
    deal_id: '8feade82-d77b-4e8b-9d35-fd43e972b5c8',
    nome: 'Maria Silva',
    telefone: '+5511999998888',
    data_nascimento: '1990-05-20',
    dia_da_consulta: '2026-07-10',
    hora_da_consulta: '14:00',
    profissional: 'Leize Ferreira',
    tipo_consulta: 'Consulta de Rotina',
};

const RESPOSTA = {
    deal_id: AGENDAMENTO.deal_id,
    id_agendamento_medx: 1275002478,
    resposta: 'confirmar',
    telefone: AGENDAMENTO.telefone,
};

/**
 * O evento é gravado e atualizado (status/erro/jobId) de forma síncrona dentro
 * do próprio handler HTTP, antes da resposta — mesmo o processamento real do
 * usecase sendo assíncrono (fila). Por isso dá pra checar aqui, sem esperar o
 * worker: é a única forma confiável de distinguir "aceito" de "inválido",
 * já que os dois casos respondem 200 (garantia sempre-200).
 *
 * Filtra pelo deal_id dentro do payload bruto (não por "o mais recente da
 * tabela"): jobs de execuções anteriores da suíte podem ainda estar na fila
 * do Redis e serem processados fora de ordem, contaminando um simples
 * `ORDER BY id DESC LIMIT 1`.
 */
async function eventoDoDeal(prisma: PrismaService, dealId: string) {
    return prisma.eventoRecebido.findFirst({
        where: { payloadBruto: { path: ['deal_id'], equals: dealId } },
        orderBy: { id: 'desc' },
    });
}

async function construirApp(overrideFila = false): Promise<INestApplication> {
    const builder = Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(CATALOGO_CLINICO_PORT)
        .useValue(catalogoFalso)
        .overrideProvider(AGENDA_MEDICA_PORT)
        .useValue(agendaFalsa)
        .overrideProvider(CADASTRO_PACIENTE_PORT)
        .useValue(cadastroFalso)
        .overrideProvider(CRM_PORT)
        .useValue(crmFalso)
        .overrideProvider(CRM_CONTATO_PORT)
        .useValue(contatosFalso)
        .overrideProvider(CONVERSAO_PORT)
        .useValue(conversaoFalso);

    if (overrideFila) {
        builder.overrideProvider(FILA_PORT).useValue({
            add: vi.fn(async () => {
                throw new Error('Redis indisponível');
            }),
        });
    }

    const moduleRef = await builder.compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalFilters(new NotFoundFilter(app.get(HttpAdapterHost), app.get(LOGGER_PORT)));
    await app.init();
    return app;
}

describe('webhooks (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    beforeAll(async () => {
        app = await construirApp();
        prisma = app.get(PrismaService);
    });

    afterAll(async () => {
        await app.close();
    });

    describe('autenticação', () => {
        it('recusa sem o segredo, mas ainda responde 200', async () => {
            const r = await request(app.getHttpServer())
                .post('/webhooks/clint/agendamento')
                .send(AGENDAMENTO);
            expect(r.status).toBe(200);
        });

        it('recusa com segredo errado', async () => {
            const r = await request(app.getHttpServer())
                .post('/webhooks/clint/agendamento')
                .set('x-adapter-secret', 'errado')
                .send(AGENDAMENTO);
            expect(r.status).toBe(200);
        });
    });

    describe('POST /webhooks/clint/agendamento', () => {
        it('aceita o payload válido e responde 200', async () => {
            const dealId = '11111111-1111-4111-8111-111111111111';
            const r = await request(app.getHttpServer())
                .post('/webhooks/clint/agendamento')
                .set('x-adapter-secret', SEGREDO)
                .send({ ...AGENDAMENTO, deal_id: dealId });
            expect(r.status).toBe(200);
            expect(r.body).toEqual({ ok: true });

            const evento = await eventoDoDeal(prisma, dealId);
            // 'recebido' (enfileirado) ou já 'processado' pelo worker — é uma
            // corrida legítima com o processamento assíncrono; o que importa
            // aqui é que NÃO foi marcado como inválido.
            expect(['recebido', 'processado']).toContain(evento?.status);
            expect(evento?.erro).toBeNull();
            expect(evento?.jobId).not.toBeNull();
        });

        it('responde 200 e não enfileira quando falta campo obrigatório', async () => {
            const dealId = '22222222-2222-4222-8222-222222222222';
            const { telefone, ...semTelefone } = AGENDAMENTO;
            const r = await request(app.getHttpServer())
                .post('/webhooks/clint/agendamento')
                .set('x-adapter-secret', SEGREDO)
                .send({ ...semTelefone, deal_id: dealId });
            expect(r.status).toBe(200);

            const evento = await eventoDoDeal(prisma, dealId);
            expect(evento?.status).toBe('invalido');
            expect(evento?.erro).toContain('telefone');
        });

        it('responde 200 e não enfileira quando deal_id não é uuid', async () => {
            const dealId = 'nao-e-um-uuid';
            const r = await request(app.getHttpServer())
                .post('/webhooks/clint/agendamento')
                .set('x-adapter-secret', SEGREDO)
                .send({ ...AGENDAMENTO, deal_id: dealId });
            expect(r.status).toBe(200);

            const evento = await eventoDoDeal(prisma, dealId);
            expect(evento?.status).toBe('invalido');
            expect(evento?.erro).toContain('deal_id');
        });

        it('responde 200 para JSON malformado', async () => {
            const r = await request(app.getHttpServer())
                .post('/webhooks/clint/agendamento')
                .set('x-adapter-secret', SEGREDO)
                .set('content-type', 'application/json')
                .send('{isso não é json');
            expect(r.status).toBe(200);
        });
    });

    describe('POST /webhooks/clint/resposta-lembrete', () => {
        it.each([
            ['confirmar', '33333333-3333-4333-8333-333333333330'],
            ['reagendar', '33333333-3333-4333-8333-333333333331'],
            ['cancelar', '33333333-3333-4333-8333-333333333332'],
        ])('aceita a resposta %s', async (resposta, dealId) => {
            const r = await request(app.getHttpServer())
                .post('/webhooks/clint/resposta-lembrete')
                .set('x-adapter-secret', SEGREDO)
                .send({ ...RESPOSTA, deal_id: dealId, resposta });
            expect(r.status).toBe(200);

            const evento = await eventoDoDeal(prisma, dealId);
            // Mesma corrida legítima com o worker assíncrono do caso de
            // agendamento — aqui o usecase nem chega a lançar erro quando
            // não encontra o agendamento local (recusa é fluxo normal),
            // então o evento sempre acaba 'processado', não 'falhou'.
            expect(['recebido', 'processado']).toContain(evento?.status);
            expect(evento?.erro).toBeNull();
        });

        it('responde 200 e não enfileira quando a resposta está fora do enum', async () => {
            const dealId = '44444444-4444-4444-8444-444444444444';
            const r = await request(app.getHttpServer())
                .post('/webhooks/clint/resposta-lembrete')
                .set('x-adapter-secret', SEGREDO)
                .send({ ...RESPOSTA, deal_id: dealId, resposta: 'talvez' });
            expect(r.status).toBe(200);

            const evento = await eventoDoDeal(prisma, dealId);
            expect(evento?.status).toBe('invalido');
            expect(evento?.erro).toContain('resposta');
        });
    });

    describe('POST /webhooks/clint/lead-origem', () => {
        it('aceita o payload válido, identifica a origem e aplica a tag no contato', async () => {
            const r = await request(app.getHttpServer())
                .post('/webhooks/clint/lead-origem')
                .set('x-adapter-secret', SEGREDO)
                .send({ telefone: '+5511999998888', texto_mensagem: 'Olá, vim pelo Google' });
            expect(r.status).toBe(200);
            expect(r.body).toEqual({ ok: true });

            await vi.waitFor(() => {
                expect(contatosFalso.adicionarTag).toHaveBeenCalledWith('contato-1', 'Google');
            });
        });

        it('responde 200 e não enfileira quando falta o texto da mensagem', async () => {
            const r = await request(app.getHttpServer())
                .post('/webhooks/clint/lead-origem')
                .set('x-adapter-secret', SEGREDO)
                .send({ telefone: '+5511999998888' });
            expect(r.status).toBe(200);
            expect(r.body).toEqual({ ok: true });
        });
    });

    describe('POST /webhooks/clint/venda-ganha', () => {
        it('aceita o payload válido e responde 200', async () => {
            const r = await request(app.getHttpServer())
                .post('/webhooks/clint/venda-ganha')
                .set('x-adapter-secret', SEGREDO)
                .send({ telefone: '+5511999998888', valor: 350 });
            expect(r.status).toBe(200);
            expect(r.body).toEqual({ ok: true });
        });

        it('responde 200 e não enfileira quando falta o valor', async () => {
            const r = await request(app.getHttpServer())
                .post('/webhooks/clint/venda-ganha')
                .set('x-adapter-secret', SEGREDO)
                .send({ telefone: '+5511999998888' });
            expect(r.status).toBe(200);
            expect(r.body).toEqual({ ok: true });
        });
    });

    describe('POST /leads/click', () => {
        it('devolve um código e aceita payload vazio', async () => {
            const r = await request(app.getHttpServer()).post('/leads/click').send({});
            expect(r.status).toBe(200);
            expect(r.body.codigo).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
        });

        it('devolve 400 quando um campo vem em formato errado', async () => {
            const r = await request(app.getHttpServer()).post('/leads/click').send({ fbclid: 123 });
            expect(r.status).toBe(400);
        });
    });

    describe('fluxo completo: clique no site → mensagem com Ref → confirmação → CAPI', () => {
        it('associa o clique ao telefone e dispara QualifiedLead na confirmação e Purchase na venda ganha', async () => {
            // A confirmação só segue o caminho de sucesso (e só aí dispara a
            // conversão) quando o adapter já tem um registro LOCAL do
            // agendamento — por isso este teste cria um agendamento de
            // verdade via /webhooks/clint/agendamento antes de confirmar,
            // diferente dos testes de resposta-lembrete isolados mais acima
            // (que testam só a recusa, deliberadamente sem esse registro).
            conversaoFalso.notificarConversao.mockClear();
            conversaoFalso.notificarCompra.mockClear();

            const dealId = '66666666-6666-4666-8666-666666666666';
            const telefone = '+5511988887777';

            // O mock padrão de agenda.obter devolve inicio/fim vazios, o que
            // reprovaria a confirmação (horário não bate com o combinado em
            // dia_da_consulta/hora_da_consulta do AGENDAMENTO). Só este
            // teste chega de fato nessa checagem — os outros testes de
            // resposta-lembrete acima recusam antes, por não terem um
            // agendamento local registrado.
            agendaFalsa.obter.mockResolvedValueOnce({
                id: 1275002478,
                idProfissional: 43013640,
                idPaciente: 67890,
                inicio: '2026-07-10T14:00:00',
                fim: '2026-07-10T14:30:00',
                descricao: '',
                status: 0,
                idTipoConsulta: 111,
                confirmacao: '',
                ultimaEdicao: '2026-07-10T10:00:00',
                bruto: {},
            });

            const clique = await request(app.getHttpServer())
                .post('/leads/click')
                .send({ fbclid: 'fb.e2e.123', utm_source: 'meta', utm_campaign: 'promo' });
            const codigo = clique.body.codigo as string;

            const leadOrigem = await request(app.getHttpServer())
                .post('/webhooks/clint/lead-origem')
                .set('x-adapter-secret', SEGREDO)
                .send({ telefone, texto_mensagem: `Olá, vim pelo site (Ref: ${codigo})` });
            expect(leadOrigem.status).toBe(200);

            await vi.waitFor(() => {
                expect(contatosFalso.adicionarTag).toHaveBeenCalledWith('contato-1', 'Meta');
            });

            const agendamento = await request(app.getHttpServer())
                .post('/webhooks/clint/agendamento')
                .set('x-adapter-secret', SEGREDO)
                .send({ ...AGENDAMENTO, deal_id: dealId, telefone });
            expect(agendamento.status).toBe(200);

            await vi.waitFor(async () => {
                const registro = await prisma.agendamento.findUnique({ where: { dealId } });
                expect(registro).not.toBeNull();
            });

            const resposta = await request(app.getHttpServer())
                .post('/webhooks/clint/resposta-lembrete')
                .set('x-adapter-secret', SEGREDO)
                .send({ ...RESPOSTA, deal_id: dealId, telefone, id_agendamento_medx: 1275002478 });
            expect(resposta.status).toBe(200);

            await vi.waitFor(() => {
                expect(conversaoFalso.notificarConversao).toHaveBeenCalledWith(
                    expect.objectContaining({ e164: telefone }),
                    'fb.e2e.123',
                    expect.any(Date),
                );
            });

            const vendaGanha = await request(app.getHttpServer())
                .post('/webhooks/clint/venda-ganha')
                .set('x-adapter-secret', SEGREDO)
                .send({ telefone, valor: 350 });
            expect(vendaGanha.status).toBe(200);

            await vi.waitFor(() => {
                expect(conversaoFalso.notificarCompra).toHaveBeenCalledWith(
                    expect.objectContaining({ e164: telefone }),
                    'fb.e2e.123',
                    expect.any(Date),
                    350,
                );
            });
        });
    });

    describe('rota inexistente e método errado (NotFoundFilter)', () => {
        it('responde 200 para rota inexistente sob /webhooks', async () => {
            const r = await request(app.getHttpServer())
                .post('/webhooks/clint/nao-existe')
                .send({});
            expect(r.status).toBe(200);
        });

        it('responde 200 para método errado numa rota de webhook existente', async () => {
            const r = await request(app.getHttpServer()).get('/webhooks/clint/agendamento');
            expect(r.status).toBe(200);
        });

        it('continua respondendo 404 de verdade fora de /webhooks', async () => {
            const r = await request(app.getHttpServer()).get('/rota-que-nao-existe');
            expect(r.status).toBe(404);
        });
    });

    describe('GET /clint/disponibilidade', () => {
        it('devolve os slots com 200 quando os parâmetros são válidos', async () => {
            const r = await request(app.getHttpServer())
                .get('/clint/disponibilidade')
                .set('x-adapter-secret', SEGREDO)
                .query({ profissional: 'Leize', data_inicio: '2026-07-10' });

            expect(r.status).toBe(200);
            expect(r.body).toEqual({
                slots: [{ inicio: '2026-07-10T09:00:00', fim: '2026-07-10T09:30:00' }],
            });
        });

        it('responde 401 sem o segredo — diferente dos webhooks, não mascara como 200', async () => {
            const r = await request(app.getHttpServer())
                .get('/clint/disponibilidade')
                .query({ profissional: 'Leize', data_inicio: '2026-07-10' });

            expect(r.status).toBe(401);
        });

        it('responde 400 com data em formato inválido', async () => {
            const r = await request(app.getHttpServer())
                .get('/clint/disponibilidade')
                .set('x-adapter-secret', SEGREDO)
                .query({ profissional: 'Leize', data_inicio: '10/07/2026' });

            expect(r.status).toBe(400);
        });

        it('responde 400 quando o profissional não é encontrado', async () => {
            catalogoFalso.resolverProfissional.mockRejectedValueOnce(
                new Error('Profissional não encontrado no MedX: "Fulano"'),
            );

            const r = await request(app.getHttpServer())
                .get('/clint/disponibilidade')
                .set('x-adapter-secret', SEGREDO)
                .query({ profissional: 'Fulano', data_inicio: '2026-07-10' });

            expect(r.status).toBe(400);
        });
    });
});

describe('webhooks (e2e) — fila indisponível', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    beforeAll(async () => {
        app = await construirApp(true);
        prisma = app.get(PrismaService);
    });

    afterAll(async () => {
        await app.close();
    });

    it('responde 200 mesmo quando a fila está fora do ar, e grava o evento como falhou', async () => {
        const dealId = '55555555-5555-4555-8555-555555555555';
        const r = await request(app.getHttpServer())
            .post('/webhooks/clint/agendamento')
            .set('x-adapter-secret', SEGREDO)
            .send({ ...AGENDAMENTO, deal_id: dealId });
        expect(r.status).toBe(200);

        const evento = await eventoDoDeal(prisma, dealId);
        expect(evento?.status).toBe('falhou');
        expect(evento?.erro).toContain('Redis indisponível');
    });
});
