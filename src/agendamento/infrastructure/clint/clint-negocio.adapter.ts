import { Injectable } from '@nestjs/common';
import type { CamposNegocio, CrmNegocioPort } from '../../application/ports/crm-negocio.port';
import { ClintHttpClient } from './clint-http.client';

/** Grava campos de negócio pela API REST da Clint (`POST /v1/deals/{id}`). */
@Injectable()
export class ClintNegocioAdapter implements CrmNegocioPort {
    constructor(private readonly client: ClintHttpClient) {}

    async gravarCampos(dealId: string, campos: CamposNegocio): Promise<void> {
        await this.client.post(`/v1/deals/${dealId}`, { fields: campos });
    }
}
