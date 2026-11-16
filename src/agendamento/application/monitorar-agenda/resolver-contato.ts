import { Inject, Injectable } from '@nestjs/common';
import { CADASTRO_PACIENTE_PORT, type CadastroPacientePort } from '../ports/cadastro-paciente.port';
import {
    CRM_CONTATO_PORT,
    type ContatoClint,
    type CrmContatoPort,
} from '../ports/crm-contato.port';
import { Telefone } from '../../domain/paciente/telefone';
import { semAcento } from '../../domain/shared/texto';
import { nomeCasa } from '../../domain/paciente/casar-nome';

export type ResultadoContato =
    /** `nomeConfere`: falso quando o telefone achou um contato só, de outro nome. */
    | { tipo: 'contato'; contato: ContatoClint; telefone: Telefone | null; nomeConfere: boolean }
    | { tipo: 'novo'; telefone: Telefone | null }
    /** `porTelefone`: o mesmo telefone em vários contatos (único caso que recebe tag). */
    | { tipo: 'ambiguo'; candidatos: ContatoClint[]; porTelefone: boolean };

interface ContextoResolucao {
    /** Contatos dos negócios abertos da RECEPÇÃO (comparados por nome sem acento). */
    contatosAbertos: ContatoClint[];
    /** `false` no modo observar: não grava telefone no MedX. */
    gravar: boolean;
}

/**
 * Sem telefone para estreitar, um contato de uma palavra só ("Maria") casaria
 * com qualquer homônima; exige ao menos duas palavras do nome do contato.
 */
function nomeCasaSemTelefone(nomeMedx: string, nomeClint: string): boolean {
    const palavras = semAcento(nomeClint)
        .replace(/[^A-Za-z\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    return palavras.length >= 2 && nomeCasa(nomeMedx, nomeClint);
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
        @Inject(CRM_CONTATO_PORT) private readonly crm: CrmContatoPort,
    ) {}

    async resolver(
        paciente: { idPaciente: number; nome: string; telefone?: string | null },
        contexto: ContextoResolucao,
    ): Promise<ResultadoContato> {
        // O telefone do agendamento (`sms`) evita uma chamada ao MedX por
        // paciente — o limite de requisições estourou numa rodada real.
        const telefone =
            telefoneOuNull(paciente.telefone ?? null) ??
            (paciente.idPaciente
                ? telefoneOuNull(await this.cadastro.obterCelular(paciente.idPaciente))
                : null);

        if (telefone) {
            const porTelefone = await this.buscarPorTelefone(telefone);
            if (porTelefone.length === 1) {
                const contato = porTelefone[0]!;
                return {
                    tipo: 'contato',
                    contato,
                    telefone,
                    nomeConfere: nomeCasa(paciente.nome, contato.nome),
                };
            }
            if (porTelefone.length > 1) {
                const peloNome = porTelefone.filter(c => nomeCasa(paciente.nome, c.nome));
                return peloNome.length === 1
                    ? { tipo: 'contato', contato: peloNome[0]!, telefone, nomeConfere: true }
                    : { tipo: 'ambiguo', candidatos: porTelefone, porTelefone: true };
            }
        }

        const porNome = await this.buscarPorNome(paciente.nome, contexto.contatosAbertos);
        if (porNome.length > 1) return { tipo: 'ambiguo', candidatos: porNome, porTelefone: false };
        if (porNome.length === 0) return { tipo: 'novo', telefone };

        const contato = porNome[0]!;
        const doContato = telefoneOuNull(contato.telefone);
        if (!telefone && doContato && contexto.gravar) {
            await this.cadastro.enriquecerFicha(paciente.idPaciente, { telefone: doContato });
        }
        return { tipo: 'contato', contato, telefone: doContato ?? telefone, nomeConfere: true };
    }

    /**
     * Número paraguaio gravado no MedX sem o 5 inicial (`95982663052`) parece
     * um celular brasileiro de DDD 95; sem resultado, tenta também com 595.
     */
    private async buscarPorTelefone(telefone: Telefone): Promise<ContatoClint[]> {
        const achados = await this.crm.buscarContatos({ telefone });
        if (achados.length > 0 || telefone.estrangeiro || !telefone.nacional.startsWith('95')) {
            return achados;
        }
        const paraguaio = telefoneOuNull(`5${telefone.nacional}`);
        return paraguaio?.estrangeiro ? this.crm.buscarContatos({ telefone: paraguaio }) : achados;
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
            if (nomeCasaSemTelefone(nome, c.nome)) porId.set(c.id, c);
        }
        return [...porId.values()];
    }
}
