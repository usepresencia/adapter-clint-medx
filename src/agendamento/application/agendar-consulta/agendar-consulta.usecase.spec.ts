import { describe, it, expect, vi } from 'vitest';
import { AgendarConsultaUseCase } from './agendar-consulta.usecase';
import { Agendamento } from '../../domain/agendamento/agendamento';
import { PeriodoConsulta } from '../../domain/agendamento/periodo-consulta';
import { Telefone } from '../../domain/paciente/telefone';
import type { CorrelacaoPaciente } from '../../domain/paciente/correlacao-paciente';
import type { AgendamentoExterno } from '../ports/agenda-medica.port';

const COMANDO = {
    dealId: 'deal-1',
    nome: 'Maria Silva',
    telefone: '+55 11 99999-8888',
    dataNascimento: '1990-05-20',
    dataHora: '2026-07-10T14:00:00',
    profissional: 'Leize Ferreira',
    tipoConsulta: 'Consulta de Rotina',
    cpf: '529.982.247-25',
};

function externo(parcial: Partial<AgendamentoExterno> = {}): AgendamentoExterno {
    return {
        id: 999,
        idProfissional: 43013640,
        idPaciente: 67890,
        inicio: '2026-07-10T14:00:00',
        fim: '2026-07-10T14:30:00',
        descricao: '',
        status: 0,
        idTipoConsulta: 111,
        confirmacao: '',
        ultimaEdicao: '2026-07-09T10:00:00',
        bruto: {},
        ...parcial,
    };
}

function agendamentosFalso() {
    const registros = new Map<string, Agendamento>();
    return {
        async buscarPorDeal(dealId: string) {
            return registros.get(dealId) ?? null;
        },
        async salvar(a: Agendamento) {
            registros.set(a.dealId, a);
        },
    };
}

function correlacoesFalso() {
    const registros = new Map<string, CorrelacaoPaciente>();
    return {
        async buscarPorTelefone(t: Telefone) {
            return registros.get(t.e164) ?? null;
        },
        async salvar(c: CorrelacaoPaciente) {
            registros.set(c.telefone.e164, c);
        },
    };
}

function montar() {
    const agendamentos = agendamentosFalso();
    const correlacoes = correlacoesFalso();
    const cadastro = {
        vincular: vi.fn(async () => ({ idPaciente: 67890, matchConfiavel: true })),
        enriquecerFicha: vi.fn(async () => {}),
    };
    const agenda = {
        criar: vi.fn(async () => 1275002478),
        obter: vi.fn(async () => externo()),
        listarPorPaciente: vi.fn(async () => [] as AgendamentoExterno[]),
        confirmar: vi.fn(async () => {}),
    };
    const catalogo = {
        carregar: vi.fn(async () => {}),
        resolverProfissional: vi.fn(async () => 43013640),
        resolverTipoConsulta: vi.fn(async () => ({
            id: 111,
            nome: 'Consulta de Rotina',
            duracaoMinutos: 30,
        })),
        indiceStatusAgendado: () => 0,
        indiceStatusConfirmado: () => 1,
    };
    const crm = {
        gravarIdAgendamento: vi.fn(async () => {}),
        notificarConfirmacao: vi.fn(async () => {}),
        notificarReagendamento: vi.fn(async () => {}),
        notificarCancelamento: vi.fn(async () => {}),
        notificarConflito: vi.fn(async () => {}),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const usecase = new AgendarConsultaUseCase(
        agendamentos as any,
        correlacoes as any,
        cadastro as any,
        agenda as any,
        catalogo as any,
        crm as any,
        logger as any,
    );

    return { agendamentos, correlacoes, cadastro, agenda, catalogo, crm, logger, usecase };
}

describe('caminho feliz', () => {
    it('cria o agendamento com início, fim e descrição corretos', async () => {
        const { agenda, usecase } = montar();
        await usecase.executar(COMANDO);

        expect(agenda.criar).toHaveBeenCalledWith(
            {
                idProfissional: 43013640,
                idPaciente: 67890,
                inicio: '2026-07-10T14:00:00',
                fim: '2026-07-10T14:30:00',
                descricao: 'Consulta de Rotina — Maria Silva',
                idTipoConsulta: 111,
            },
            0,
        );
    });

    it('devolve o id ao CRM', async () => {
        const { crm, usecase } = montar();
        await usecase.executar(COMANDO);
        expect(crm.gravarIdAgendamento).toHaveBeenCalledWith(
            'deal-1',
            1275002478,
            expect.any(Telefone),
        );
    });

    it('persiste o agendamento como criado', async () => {
        const { usecase, agendamentos } = montar();
        await usecase.executar(COMANDO);
        const salvo = (await agendamentos.buscarPorDeal('deal-1'))!;
        expect(salvo.status).toBe('criado');
        expect(salvo.idMedx).toBe(1275002478);
    });

    it('converte o horário para o fuso da clínica', async () => {
        const { agenda, usecase } = montar();
        await usecase.executar({ ...COMANDO, dataHora: '2026-07-10T17:00:00Z' });
        expect(agenda.criar).toHaveBeenCalledWith(
            expect.objectContaining({ inicio: '2026-07-10T14:00:00' }),
            0,
        );
    });
});

describe('duração da consulta', () => {
    it('usa a duração informada pela Clint quando o MedX não tem duração cadastrada para o tipo', async () => {
        const { agenda, catalogo, usecase } = montar();
        catalogo.resolverTipoConsulta = vi.fn(async () => ({
            id: 111,
            nome: 'Consulta',
            duracaoMinutos: null as unknown as number,
        }));

        await usecase.executar({ ...COMANDO, duracaoConsulta: 45 });

        expect(agenda.criar).toHaveBeenCalledWith(
            expect.objectContaining({ fim: '2026-07-10T14:45:00' }),
            0,
        );
    });

    it('prioriza a duração do MedX quando ela existe, ignorando a da Clint', async () => {
        const { agenda, usecase } = montar();
        await usecase.executar({ ...COMANDO, duracaoConsulta: 999 });

        expect(agenda.criar).toHaveBeenCalledWith(
            expect.objectContaining({ fim: '2026-07-10T14:30:00' }),
            0,
        );
    });

    it('propaga o erro de domínio quando nem o MedX nem a Clint informam duração', async () => {
        const { catalogo, usecase } = montar();
        catalogo.resolverTipoConsulta = vi.fn(async () => ({
            id: 111,
            nome: 'Consulta',
            duracaoMinutos: null as unknown as number,
        }));

        await expect(usecase.executar(COMANDO)).rejects.toThrow(/duração/i);
    });
});

describe('idempotência', () => {
    it('não chama o MedX duas vezes para o mesmo deal_id', async () => {
        const { agenda, usecase } = montar();
        await usecase.executar(COMANDO);
        await usecase.executar(COMANDO);
        expect(agenda.criar).toHaveBeenCalledTimes(1);
    });

    it('grava a intenção antes de chamar o MedX', async () => {
        const { agenda, agendamentos, usecase } = montar();
        const observado: string[] = [];
        agenda.criar = vi.fn(async () => {
            observado.push((await agendamentos.buscarPorDeal('deal-1'))!.status);
            return 1275002478;
        });

        await usecase.executar(COMANDO);
        expect(observado).toEqual(['enviando']);
    });

    it('adota o agendamento órfão de uma tentativa interrompida', async () => {
        const { agenda, agendamentos, crm, usecase } = montar();
        await agendamentos.salvar(
            Agendamento.iniciar({
                dealId: 'deal-1',
                idPacienteMedx: 67890,
                idProfissionalMedx: 43013640,
                periodo: PeriodoConsulta.criar('2026-07-10T14:00:00', 30),
            }),
        );
        agenda.listarPorPaciente = vi.fn(async () => [externo({ id: 555 })]);

        await usecase.executar(COMANDO);

        expect(agenda.criar).not.toHaveBeenCalled();
        expect(crm.gravarIdAgendamento).toHaveBeenCalledWith('deal-1', 555, expect.any(Telefone));
    });

    it('após falha em agenda.criar, retry adota órfão gêmeo em vez de criar de novo', async () => {
        const { agenda, crm, usecase } = montar();
        agenda.criar = vi.fn(async () => {
            throw new Error('timeout na chamada ao MedX');
        });

        await expect(usecase.executar(COMANDO)).rejects.toThrow(/timeout/);

        agenda.listarPorPaciente = vi.fn(async () => [externo({ id: 777 })]);

        await usecase.executar(COMANDO);

        expect(agenda.criar).toHaveBeenCalledTimes(1);
        expect(crm.gravarIdAgendamento).toHaveBeenCalledWith('deal-1', 777, expect.any(Telefone));
    });

    it('cria normalmente quando não há órfão correspondente', async () => {
        const { agenda, agendamentos, usecase } = montar();
        await agendamentos.salvar(
            Agendamento.iniciar({
                dealId: 'deal-1',
                idPacienteMedx: 67890,
                idProfissionalMedx: 43013640,
                periodo: PeriodoConsulta.criar('2026-07-10T14:00:00', 30),
            }),
        );
        agenda.listarPorPaciente = vi.fn(async () => [externo({ inicio: '2026-07-11T09:00:00' })]);

        await usecase.executar(COMANDO);
        expect(agenda.criar).toHaveBeenCalled();
    });
});

describe('identidade do paciente', () => {
    it('reaproveita a correlação em cache sem chamar o vínculo de novo', async () => {
        const { cadastro, usecase } = montar();
        await usecase.executar(COMANDO);
        await usecase.executar({ ...COMANDO, dealId: 'deal-2' });
        expect(cadastro.vincular).toHaveBeenCalledTimes(1);
    });

    it('envia o telefone como value object para o port', async () => {
        const { cadastro, usecase } = montar();
        await usecase.executar(COMANDO);
        const enviado = (cadastro.vincular as any).mock.calls[0][0];
        expect(enviado.telefone).toBeInstanceOf(Telefone);
        expect(enviado.telefone.nacional).toBe('11999998888');
    });

    it('registra match duvidoso com alerta, sem interromper o agendamento', async () => {
        const { cadastro, correlacoes, crm, logger, usecase } = montar();
        cadastro.vincular = vi.fn(async () => ({ idPaciente: 67890, matchConfiavel: false }));

        await usecase.executar(COMANDO);

        expect(
            (await correlacoes.buscarPorTelefone(Telefone.criar('11999998888')))!.exigeRevisao,
        ).toBe(true);
        expect(crm.gravarIdAgendamento).toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ alerta: true }),
            expect.any(String),
        );
    });
});

describe('enriquecimento de ficha (desativado)', () => {
    // O PUT /contatos do MedX está exigindo ~44 campos obrigatórios pra
    // qualquer atualização parcial (confirmado ao vivo, contradiz a própria
    // doc) — enriquecerFicha() sempre falhava, então a chamada foi desligada
    // até o MedX corrigir a API. O port/adapter continuam existindo pra
    // religar rápido quando isso acontecer.
    it('nunca chama enriquecerFicha, mesmo com cpf/cidade/endereco/cep no comando', async () => {
        const { cadastro, usecase } = montar();
        await usecase.executar({
            ...COMANDO,
            cidade: 'São Paulo',
            endereco: 'Rua Teste, 450',
            cep: '01310100',
        });
        expect(cadastro.enriquecerFicha).not.toHaveBeenCalled();
    });

    it('grava o agendamento no CRM normalmente, sem depender do enriquecimento', async () => {
        const { crm, usecase } = montar();
        await usecase.executar(COMANDO);
        expect(crm.gravarIdAgendamento).toHaveBeenCalled();
    });
});

describe('falhas', () => {
    it('marca falhou e propaga quando o MedX recusa a criação', async () => {
        const { agenda, agendamentos, usecase } = montar();
        agenda.criar = vi.fn(async () => {
            throw new Error('MedX fora do ar');
        });

        await expect(usecase.executar(COMANDO)).rejects.toThrow(/fora do ar/);
        expect((await agendamentos.buscarPorDeal('deal-1'))!.status).toBe('falhou');
    });

    it('propaga telefone inválido como erro de domínio', async () => {
        const { usecase } = montar();
        await expect(usecase.executar({ ...COMANDO, telefone: '123' })).rejects.toThrow(/DDD/);
    });
});
