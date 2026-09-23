import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { ConversaoPort } from '../../application/ports/conversao.port';
import type { Telefone } from '../../domain/paciente/telefone';

const VERSAO_API = 'v19.0';
const MOEDA_PADRAO = 'BRL';

/** Formato exigido pela Meta CAPI pro parâmetro user_data.fbc — nunca o fbclid cru. */
function montarFbc(fbclid: string, capturadoEm: Date): string {
    return `fb.1.${capturadoEm.getTime()}.${fbclid}`;
}

function hashTelefone(telefone: Telefone): string {
    const digitos = telefone.e164.replace('+', '');
    return createHash('sha256').update(digitos).digest('hex');
}

@Injectable()
export class MetaCapiAdapter implements ConversaoPort {
    constructor(private readonly config: ConfigService) {}

    async notificarConversao(telefone: Telefone, fbclid: string, capturadoEm: Date): Promise<void> {
        await this.enviarEvento('QualifiedLead', telefone, fbclid, capturadoEm);
    }

    async notificarCompra(
        telefone: Telefone,
        fbclid: string,
        capturadoEm: Date,
        valor: number,
    ): Promise<void> {
        await this.enviarEvento('Purchase', telefone, fbclid, capturadoEm, {
            value: valor,
            currency: MOEDA_PADRAO,
        });
    }

    private async enviarEvento(
        eventName: string,
        telefone: Telefone,
        fbclid: string,
        capturadoEm: Date,
        customData?: Record<string, unknown>,
    ): Promise<void> {
        const pixelId = this.config.get<string>('META_PIXEL_ID');
        const token = this.config.get<string>('META_CAPI_ACCESS_TOKEN');

        if (!pixelId || !token) {
            throw new Error(
                'META_PIXEL_ID/META_CAPI_ACCESS_TOKEN não configurados — não é possível notificar a Meta CAPI',
            );
        }

        const resposta = await fetch(
            `https://graph.facebook.com/${VERSAO_API}/${pixelId}/events?access_token=${token}`,
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    data: [
                        {
                            event_name: eventName,
                            event_time: Math.floor(Date.now() / 1000),
                            action_source: 'system_generated',
                            user_data: {
                                ph: [hashTelefone(telefone)],
                                fbc: montarFbc(fbclid, capturadoEm),
                            },
                            ...(customData ? { custom_data: customData } : {}),
                        },
                    ],
                }),
            },
        );

        if (!resposta.ok) {
            const corpo = await resposta.text();
            throw new Error(`Meta CAPI respondeu HTTP ${resposta.status}: ${corpo}`);
        }
    }
}
