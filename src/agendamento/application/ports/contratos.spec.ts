import { describe, it, expect } from 'vitest';
import { AGENDA_MEDICA_PORT } from './agenda-medica.port';
import { CADASTRO_PACIENTE_PORT } from './cadastro-paciente.port';
import { CATALOGO_CLINICO_PORT } from './catalogo-clinico.port';
import { CONVERSAO_PORT } from './conversao.port';
import { CRM_CONTATO_PORT } from './crm-contato.port';
import { CRM_NEGOCIO_PORT } from './crm-negocio.port';
import { CRM_PORT } from './crm.port';
import { ETAPAS_RECEPCAO } from './etapas-recepcao.port';
import { FILA_PORT } from './fila.port';
import { LOGGER_PORT } from './logger.port';
import { NOTIFICADOR_PORT } from './notificador.port';
import { RELOGIO_PORT } from './relogio.port';

describe('contratos dos ports', () => {
    it('todos os tokens de DI são símbolos distintos', () => {
        const tokens = [
            AGENDA_MEDICA_PORT,
            CADASTRO_PACIENTE_PORT,
            CATALOGO_CLINICO_PORT,
            CONVERSAO_PORT,
            CRM_CONTATO_PORT,
            CRM_NEGOCIO_PORT,
            CRM_PORT,
            ETAPAS_RECEPCAO,
            FILA_PORT,
            LOGGER_PORT,
            NOTIFICADOR_PORT,
            RELOGIO_PORT,
        ];
        expect(new Set(tokens).size).toBe(tokens.length);
    });
});
