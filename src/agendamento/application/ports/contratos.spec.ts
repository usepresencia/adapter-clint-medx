import { describe, it, expect } from 'vitest';
import type { AgendaMedicaPort, AgendamentoExterno } from './agenda-medica.port';
import type { CadastroPacientePort } from './cadastro-paciente.port';
import type { CatalogoClinicoPort } from './catalogo-clinico.port';
import type { CrmPort } from './crm.port';
import type { NotificadorPort } from './notificador.port';
import { AGENDA_MEDICA_PORT } from './agenda-medica.port';
import { CADASTRO_PACIENTE_PORT } from './cadastro-paciente.port';
import { CATALOGO_CLINICO_PORT } from './catalogo-clinico.port';
import { CRM_PORT } from './crm.port';
import { NOTIFICADOR_PORT } from './notificador.port';
import { LOGGER_PORT } from './logger.port';
import { FILA_PORT } from './fila.port';

const EXTERNO: AgendamentoExterno = {
    id: 1275002478,
    idProfissional: 43013640,
    idPaciente: 67890,
    inicio: '2026-07-10T14:00:00',
    fim: '2026-07-10T14:30:00',
    descricao: 'Consulta',
    status: 0,
    idTipoConsulta: 111,
    confirmacao: '',
    ultimaEdicao: '2026-07-09T10:00:00',
    bruto: {},
};

describe('contratos dos ports', () => {
    it('um dublê satisfaz AgendaMedicaPort', async () => {
        const porta: AgendaMedicaPort = {
            criar: async () => 1,
            obter: async () => EXTERNO,
            listarPorPaciente: async () => [EXTERNO],
            confirmar: async () => {},
        };
        expect(
            await porta.criar(
                {
                    idProfissional: 1,
                    idPaciente: 1,
                    inicio: 'x',
                    fim: 'y',
                    descricao: 'z',
                    idTipoConsulta: 1,
                },
                0,
            ),
        ).toBe(1);
    });

    it('um dublê satisfaz os demais ports', async () => {
        const cadastro: CadastroPacientePort = {
            vincular: async () => ({ idPaciente: 1, matchConfiavel: true }),
            enriquecerFicha: async () => {},
        };
        const catalogo: CatalogoClinicoPort = {
            carregar: async () => {},
            resolverProfissional: async () => 1,
            resolverTipoConsulta: async () => ({ id: 1, nome: 'Consulta', duracaoMinutos: 30 }),
            indiceStatusAgendado: () => 0,
            indiceStatusConfirmado: () => 1,
        };
        const crm: CrmPort = {
            gravarIdAgendamento: async () => {},
            notificarConfirmacao: async () => {},
            notificarReagendamento: async () => {},
            notificarCancelamento: async () => {},
            notificarConflito: async () => {},
        };
        const notificador: NotificadorPort = { alertar: async () => {} };

        expect(catalogo.indiceStatusAgendado()).toBe(0);
        expect(catalogo.indiceStatusConfirmado()).toBe(1);
        expect((await catalogo.resolverTipoConsulta('x')).duracaoMinutos).toBe(30);
        await expect(cadastro.enriquecerFicha(1, {} as never)).resolves.toBeUndefined();
        await expect(crm.notificarConflito('d', 'm')).resolves.toBeUndefined();
        await expect(notificador.alertar('a', {})).resolves.toBeUndefined();
    });

    it('todos os tokens de DI são símbolos distintos', () => {
        const tokens = [
            AGENDA_MEDICA_PORT,
            CADASTRO_PACIENTE_PORT,
            CATALOGO_CLINICO_PORT,
            CRM_PORT,
            NOTIFICADOR_PORT,
            LOGGER_PORT,
            FILA_PORT,
        ];
        expect(new Set(tokens).size).toBe(tokens.length);
    });
});
