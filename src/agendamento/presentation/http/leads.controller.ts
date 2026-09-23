import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CapturarCliqueUseCase } from '../../application/capturar-clique/capturar-clique.usecase';
import { schemaCapturarClique } from './schemas';

/**
 * Endpoint público, chamado pelo navegador do visitante do site — sem
 * X-Adapter-Secret (o visitante não tem esse segredo) e sem a garantia
 * "sempre 200" dos webhooks do Clint. Protegido por CORS restrito ao
 * domínio do site (ver main.ts), não por autenticação.
 */
@Controller('leads')
export class LeadsController {
    constructor(private readonly usecase: CapturarCliqueUseCase) {}

    @Post('click')
    @HttpCode(200)
    async click(@Body() body: unknown): Promise<{ codigo: string }> {
        const validado = schemaCapturarClique.safeParse(body);
        if (!validado.success) {
            throw new BadRequestException(
                validado.error.issues.map(i => i.path.join('.')).join(', '),
            );
        }

        const codigo = await this.usecase.executar({
            fbclid: validado.data.fbclid,
            utmSource: validado.data.utm_source,
            utmMedium: validado.data.utm_medium,
            utmCampaign: validado.data.utm_campaign,
            utmContent: validado.data.utm_content,
            utmTerm: validado.data.utm_term,
        });

        return { codigo };
    }
}
