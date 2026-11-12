import type { CampoDataNegocio } from '../ports/crm-negocio.port';

export interface ComandoRegravarData {
    dealId: string;
    idAgendamentoMedx: number;
    campo: CampoDataNegocio;
}
