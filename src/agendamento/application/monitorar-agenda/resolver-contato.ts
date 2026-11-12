import { Inject, Injectable } from '@nestjs/common';
import { CADASTRO_PACIENTE_PORT, type CadastroPacientePort } from '../ports/cadastro-paciente.port';
import {
    CRM_NEGOCIO_PORT,
    type ContatoClint,
    type CrmNegocioPort,
} from '../ports/crm-negocio.port';
import { Telefone } from '../../domain/paciente/telefone';
import { nomeCasa } from '../../domain/paciente/casar-nome';

export type ResultadoContato =
    | { tipo: 'contato'; contato: ContatoClint; telefone: Telefone | null }
    | { tipo: 'novo'; telefone: Telefone | null }
    | { tipo: 'ambiguo'; candidatos: ContatoClint[] };

export interface ContextoResolucao {
    /** Contatos dos negócios abertos da RECEPÇÃO (comparados por nome sem acento). */
    contatosAbertos: ContatoClint[];
    /** `false` no modo observar: não grava telefone no MedX. */
    gravar: boolean;
}

function telefoneOuNull(bruto: string | null): Telefone | null {
    if (!bruto) return null;
    try {
        return Telefone.criar(bruto);
    } catch {
        return null;
    }
}

/**
 * Acha o contato da Clint de uma paciente do MedX:
 * - telefone com um contato → esse; com vários → decide pelo nome; nenhum →
 *   tenta pelo nome (cobre telefone estrangeiro gravado incompleto no MedX);
 * - sem telefone no MedX → pelo nome; achando com telefone, grava no MedX;
 * - nunca assume com mais de um candidato.
 */
@Injectable()
export class ResolvedorContato {
    constructor(
        @Inject(CADASTRO_PACIENTE_PORT) private readonly cadastro: CadastroPacientePort,
        @Inject(CRM_NEGOCIO_PORT) private readonly crm: CrmNegocioPort,
    ) {}

    async resolver(
        paciente: { idPaciente: number; nome: string },
        contexto: ContextoResolucao,
    ): Promise<ResultadoContato> {
        const telefone = paciente.idPaciente
            ? telefoneOuNull(await this.cadastro.obterCelular(paciente.idPaciente))
            : null;

        if (telefone) {
            const porTelefone = await this.crm.buscarContatos({ telefone });
            if (porTelefone.length === 1) {
                return { tipo: 'contato', contato: porTelefone[0]!, telefone };
            }
            if (porTelefone.length > 1) {
                const peloNome = porTelefone.filter(c => nomeCasa(paciente.nome, c.nome));
                return peloNome.length === 1
                    ? { tipo: 'contato', contato: peloNome[0]!, telefone }
                    : { tipo: 'ambiguo', candidatos: porTelefone };
            }
        }

        const porNome = await this.buscarPorNome(paciente.nome, contexto.contatosAbertos);
        if (porNome.length > 1) return { tipo: 'ambiguo', candidatos: porNome };
        if (porNome.length === 0) return { tipo: 'novo', telefone };

        const contato = porNome[0]!;
        const doContato = telefoneOuNull(contato.telefone);
        if (!telefone && doContato && contexto.gravar) {
            await this.cadastro.enriquecerFicha(paciente.idPaciente, { telefone: doContato });
        }
        return { tipo: 'contato', contato, telefone: doContato ?? telefone };
    }

    /**
     * A busca da Clint casa só prefixo e diferencia acento; por isso junta os
     * contatos dos negócios abertos (comparação sem acento) com a busca pelo
     * primeiro nome, e filtra tudo por `nomeCasa`.
     */
    private async buscarPorNome(nome: string, abertos: ContatoClint[]): Promise<ContatoClint[]> {
        const primeiro = nome.trim().split(/\s+/)[0] ?? '';
        const daApi = primeiro ? await this.crm.buscarContatos({ nome: primeiro }) : [];
        const porId = new Map<string, ContatoClint>();
        for (const c of [...abertos, ...daApi]) {
            if (nomeCasa(nome, c.nome)) porId.set(c.id, c);
        }
        return [...porId.values()];
    }
}
