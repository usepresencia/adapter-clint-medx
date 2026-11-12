import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import {
    AGENDA_MEDICA_PORT,
    type AgendaMedicaPort,
    type AgendamentoExterno,
} from '../ports/agenda-medica.port';
import { CATALOGO_CLINICO_PORT, type CatalogoClinicoPort } from '../ports/catalogo-clinico.port';
import {
    CRM_NEGOCIO_PORT,
    type CamposNegocio,
    type ContatoClint,
    type CrmNegocioPort,
    type NegocioRecepcao,
} from '../ports/crm-negocio.port';
import { CRM_CONTATO_PORT, type CrmContatoPort } from '../ports/crm-contato.port';
import { LOGGER_PORT, type LoggerMinimo } from '../ports/logger.port';
import { ResolvedorContato } from './resolver-contato';
import { CAMPOS_DATA, calcularCampoData } from '../../domain/agendamento/campos-data';
import {
    calcularProximoLembrete,
    etapaFoiUltrapassada,
} from '../../domain/agendamento/janela-lembrete';
import { FORMATO_MEDX, FUSO_CLINICA } from '../../domain/agendamento/periodo-consulta';
import type { Telefone } from '../../domain/paciente/telefone';

export type ModoMonitor = 'observar' | 'agir';

export interface ResumoRodada {
    criados: number;
    assumidos: number;
    remarcados: number;
    cancelados: number;
    ignorados: number;
    falhas: number;
}

const DIAS_JANELA = 30;
const TAG_SEM_TELEFONE = 'sem telefone no MedX';
const TAG_AMBIGUO = 'conferir agendamento MedX';

interface Rodada {
    modo: ModoMonitor;
    agora: DateTime;
    resumo: ResumoRodada;
    porIdAgendamento: Map<string, NegocioRecepcao>;
    negocios: NegocioRecepcao[];
    contatosAbertos: ContatoClint[];
    relevantes: number[];
    cancelamento: number[];
    endovenoso: number;
}

/**
 * Reconcilia a agenda do MedX (hoje → +30 dias) com os negócios abertos da
 * RECEPÇÃO. A Clint é a fonte do estado: o vínculo é o campo
 * `id_agendamento_medx` do negócio. Em `observar`, só registra no log o que
 * faria. Ordem de gravação: etapa → datas → `proximo_lembrete`.
 */
@Injectable()
export class MonitorarAgendaUseCase {
    /** Sobrescrito em testes para controlar o relógio. */
    agora: () => DateTime = () => DateTime.now().setZone(FUSO_CLINICA);

    constructor(
        @Inject(AGENDA_MEDICA_PORT) private readonly agenda: AgendaMedicaPort,
        @Inject(CATALOGO_CLINICO_PORT) private readonly catalogo: CatalogoClinicoPort,
        @Inject(CRM_NEGOCIO_PORT) private readonly crm: CrmNegocioPort,
        @Inject(CRM_CONTATO_PORT) private readonly contatos: CrmContatoPort,
        private readonly resolvedor: ResolvedorContato,
        @Inject(LOGGER_PORT) private readonly logger: LoggerMinimo,
        private readonly config: ConfigService,
    ) {}

    async executar(modo: ModoMonitor): Promise<ResumoRodada> {
        const agora = this.agora();
        const inicioJanela = agora.startOf('day');
        const fimJanela = inicioJanela.plus({ days: DIAS_JANELA });

        const [agendamentos, negocios, agendado, confirmado, endovenoso, cancelamento] =
            await Promise.all([
                this.agenda.listarDetalhadosPorPeriodo(
                    inicioJanela.toFormat(FORMATO_MEDX),
                    fimJanela.toFormat(FORMATO_MEDX),
                ),
                this.crm.listarAbertosRecepcao(),
                this.catalogo.indiceStatusAgendado(),
                this.catalogo.indiceStatusConfirmado(),
                this.catalogo.indiceStatusEndovenoso(),
                this.catalogo.indicesStatusCancelamento(),
            ]);

        const rodada: Rodada = {
            modo,
            agora,
            resumo: {
                criados: 0,
                assumidos: 0,
                remarcados: 0,
                cancelados: 0,
                ignorados: 0,
                falhas: 0,
            },
            porIdAgendamento: new Map(
                negocios
                    .filter(n => n.campos.id_agendamento_medx)
                    .map(n => [n.campos.id_agendamento_medx!, n]),
            ),
            negocios,
            contatosAbertos: [
                ...new Map(
                    negocios.map(n => [
                        n.contatoId,
                        { id: n.contatoId, nome: n.nomeContato, telefone: n.telefone },
                    ]),
                ).values(),
            ],
            relevantes: [agendado, confirmado, endovenoso].filter(id => id >= 0),
            cancelamento,
            endovenoso,
        };

        const vistos = new Set<string>();
        let interrompida = false;
        for (const ag of agendamentos) {
            vistos.add(String(ag.id));
            if (!(await this.comProtecao(rodada, ag.id, () => this.processar(rodada, ag)))) {
                interrompida = true;
                break;
            }
        }

        if (!interrompida) await this.tratarDesaparecidos(rodada, vistos, inicioJanela, fimJanela);

        this.logger.info({ modo, ...rodada.resumo }, 'monitor do MedX: rodada concluída');
        return rodada.resumo;
    }

    private async processar(r: Rodada, ag: AgendamentoExterno): Promise<void> {
        const negocio = r.porIdAgendamento.get(String(ag.id));

        if (r.cancelamento.includes(ag.status)) {
            if (negocio) await this.cancelar(r, negocio, ag.id);
            else r.resumo.ignorados++;
            return;
        }
        if (!r.relevantes.includes(ag.status) || !ag.idPaciente) {
            r.resumo.ignorados++;
            return;
        }

        const ehEndovenoso = ag.status === r.endovenoso;
        if (negocio) {
            if (this.criacaoFicouPelaMetade(negocio)) {
                await this.concluirCriacao(r, negocio.id, ag);
                return;
            }
            await this.remarcarSeMudou(r, negocio, ag);
            return;
        }

        // Sem negócio e a consulta de hoje já começou: não cabe boas-vindas.
        if (DateTime.fromISO(ag.inicio, { zone: FUSO_CLINICA }) <= r.agora) {
            r.resumo.ignorados++;
            return;
        }

        const bruto = ag.bruto as { paciente?: { nome?: string }; sms?: string | null } | null;
        const nome = bruto?.paciente?.nome ?? '';
        const resultado = await this.resolvedor.resolver(
            { idPaciente: ag.idPaciente, nome, telefone: bruto?.sms ?? null },
            { contatosAbertos: r.contatosAbertos, gravar: r.modo === 'agir' },
        );

        if (resultado.tipo === 'ambiguo') {
            // Só o telefone compartilhado vira tag; ambíguo por nome fica para
            // a próxima rodada (marcar homônimas seria pior).
            const candidatos = resultado.porTelefone ? resultado.candidatos : [];
            for (const c of candidatos) {
                await this.escrever(
                    r,
                    'tag contato ambíguo',
                    { id_agendamento: ag.id, contato: c.id },
                    () => this.contatos.adicionarTag(c.id, TAG_AMBIGUO),
                );
            }
            r.resumo.ignorados++;
            return;
        }

        if (resultado.tipo === 'contato') {
            // Negócio que a Clint acabou de criar e ainda espera o id pelo
            // webhook de entrada: fica para a próxima rodada (evita duplicar).
            const pendente = r.negocios.some(
                n =>
                    n.contatoId === resultado.contato.id &&
                    !n.campos.id_agendamento_medx &&
                    n.etapaId === this.config.get<string>('CLINT_ETAPA_CRIACAO_ID'),
            );
            if (pendente) {
                r.resumo.ignorados++;
                return;
            }
            // Prefere o negócio da etapa que combina com o tipo (endovenoso →
            // ENDOVENOSO, consulta → BOAS VINDAS); senão, qualquer assumível.
            const candidatos = r.negocios.filter(
                n =>
                    n.contatoId === resultado.contato.id &&
                    !n.campos.id_agendamento_medx &&
                    this.etapasAssumiveis().includes(n.etapaId),
            );
            const etapaDoTipo = this.config.get<string>(
                ehEndovenoso ? 'CLINT_ETAPA_ENDOVENOSO_ID' : 'CLINT_ETAPA_BOAS_VINDAS_ID',
            );
            const assumivel = candidatos.find(n => n.etapaId === etapaDoTipo) ?? candidatos[0];
            // Telefone de um contato só, com outro nome (ex.: mãe e filha): usa o
            // contato, mas não assume o negócio dele.
            if (assumivel && resultado.nomeConfere) {
                await this.assumir(r, assumivel, ag, ehEndovenoso);
                return;
            }
            await this.criar(r, ag, ehEndovenoso, { contatoId: resultado.contato.id, nome });
            return;
        }

        await this.criar(r, ag, ehEndovenoso, {
            nome,
            telefone: resultado.telefone ?? undefined,
            semTelefone: !resultado.telefone,
        });
    }

    private async criar(
        r: Rodada,
        ag: AgendamentoExterno,
        ehEndovenoso: boolean,
        quem: { contatoId?: string; nome: string; telefone?: Telefone; semTelefone?: boolean },
    ): Promise<void> {
        const contexto = { id_agendamento: ag.id, acao: 'criar' };
        const campos: CamposNegocio = {
            ...this.camposBase(ag, ehEndovenoso),
            ...(ehEndovenoso ? {} : { etapa_lembrete: 'd0_boas_vindas' }),
        };

        await this.escrever(r, 'criar negócio', contexto, async () => {
            const criado = await this.crm.criarNegocio({
                contatoId: quem.contatoId,
                nome: quem.nome,
                telefone: quem.telefone,
                campos,
            });
            await this.concluirCriacao(r, criado.id, ag, false);
            if (quem.semTelefone && criado.contatoId) {
                await this.contatos.adicionarTag(criado.contatoId, TAG_SEM_TELEFONE);
            }
            this.registrar(r, { id: criado.id, contatoId: criado.contatoId ?? '' }, ag, campos);
        });
        if (r.modo === 'observar' && quem.contatoId) {
            this.registrar(r, { id: `observar:${ag.id}`, contatoId: quem.contatoId }, ag, campos);
        }
        r.resumo.criados++;
    }

    private async assumir(
        r: Rodada,
        negocio: NegocioRecepcao,
        ag: AgendamentoExterno,
        ehEndovenoso: boolean,
    ): Promise<void> {
        const proximo = calcularProximoLembrete(ag.inicio, r.agora);
        const etapa = negocio.campos.etapa_lembrete || null;
        await this.escrever(
            r,
            'assumir negócio',
            { id_agendamento: ag.id, deal_id: negocio.id },
            async () => {
                await this.crm.gravarCampos(negocio.id, this.camposBase(ag, ehEndovenoso));
                await this.gravarSeHouver(negocio.id, this.camposDeData(r, ag));
                if (!etapa || etapaFoiUltrapassada(etapa, proximo)) {
                    await this.crm.gravarCampos(negocio.id, { proximo_lembrete: proximo });
                }
            },
        );
        // Marca na rodada (inclusive em observar) para outro agendamento do
        // mesmo contato não assumir o mesmo negócio.
        negocio.campos.id_agendamento_medx = String(ag.id);
        r.porIdAgendamento.set(String(ag.id), negocio);
        r.resumo.assumidos++;
    }

    private async remarcarSeMudou(
        r: Rodada,
        negocio: NegocioRecepcao,
        ag: AgendamentoExterno,
    ): Promise<void> {
        const naClint = `${negocio.campos.data_agendamento ?? ''}T${negocio.campos.hora_agendamento ?? ''}`;
        if (naClint === ag.inicio.slice(0, 16)) return;

        const proximo = calcularProximoLembrete(ag.inicio, r.agora);
        await this.escrever(
            r,
            'remarcar',
            { id_agendamento: ag.id, deal_id: negocio.id },
            async () => {
                // O salto vem antes das datas: elas são o marcador de que a
                // remarcação terminou (se o salto falhar, a próxima rodada refaz).
                if (etapaFoiUltrapassada(negocio.campos.etapa_lembrete || null, proximo)) {
                    await this.crm.gravarCampos(negocio.id, { proximo_lembrete: proximo });
                }
                await this.gravarSeHouver(negocio.id, this.camposDeData(r, ag));
            },
        );
        r.resumo.remarcados++;
    }

    private async cancelar(
        r: Rodada,
        negocio: NegocioRecepcao,
        idAgendamento: number,
    ): Promise<void> {
        await this.escrever(
            r,
            'cancelar',
            { id_agendamento: idAgendamento, deal_id: negocio.id },
            async () => {
                await this.crm.gravarCampos(negocio.id, { etapa_lembrete: 'cancelado' });
                await this.crm.encerrarComoPerdido(negocio.id);
            },
        );
        r.resumo.cancelados++;
    }

    /**
     * Negócio vinculado cuja consulta está na janela mas não veio na listagem:
     * consulta pelo id; não existe ou foi cancelado → cancela; existe (foi
     * remarcado para além da janela) → regrava as datas.
     */
    private async tratarDesaparecidos(
        r: Rodada,
        vistos: Set<string>,
        inicioJanela: DateTime,
        fimJanela: DateTime,
    ): Promise<void> {
        const de = inicioJanela.toISODate()!;
        const ate = fimJanela.toISODate()!;
        for (const [id, negocio] of r.porIdAgendamento) {
            const data = negocio.campos.data_agendamento;
            if (vistos.has(id) || !data || data < de || data >= ate) continue;
            const seguir = await this.comProtecao(r, Number(id), async () => {
                const externo = await this.agenda.obterSeExistir(Number(id));
                if (!externo || r.cancelamento.includes(externo.status)) {
                    await this.cancelar(r, negocio, Number(id));
                } else {
                    await this.remarcarSeMudou(r, negocio, externo);
                }
            });
            if (!seguir) return;
        }
    }

    /**
     * Negócio criado pelo monitor que parou antes de entrar em BOAS VINDAS
     * (falha entre a criação e o `proximo_lembrete`).
     */
    private criacaoFicouPelaMetade(negocio: NegocioRecepcao): boolean {
        const criadoPeloMonitor =
            negocio.campos.etapa_lembrete === 'd0_boas_vindas' ||
            negocio.campos.tipo_consulta === 'endovenoso';
        return (
            negocio.etapaId === this.config.get<string>('CLINT_ETAPA_CRIACAO_ID') &&
            criadoPeloMonitor &&
            !negocio.campos.proximo_lembrete
        );
    }

    /** Entra em BOAS VINDAS (dispara a cadeia), grava as datas e o `proximo_lembrete`. */
    private async concluirCriacao(
        r: Rodada,
        dealId: string,
        ag: AgendamentoExterno,
        protegido = true,
    ): Promise<void> {
        const passos = async () => {
            await this.crm.moverParaBoasVindas(dealId);
            await this.gravarSeHouver(dealId, this.camposDeData(r, ag));
            await this.crm.gravarCampos(dealId, {
                proximo_lembrete: calcularProximoLembrete(ag.inicio, r.agora),
            });
        };
        if (!protegido) return passos();
        await this.escrever(
            r,
            'concluir criação',
            { id_agendamento: ag.id, deal_id: dealId },
            passos,
        );
    }

    private registrar(
        r: Rodada,
        criado: { id: string; contatoId: string },
        ag: AgendamentoExterno,
        campos: CamposNegocio,
    ): void {
        const novo: NegocioRecepcao = {
            id: criado.id,
            contatoId: criado.contatoId,
            nomeContato: '',
            telefone: null,
            etapaId: this.config.get<string>('CLINT_ETAPA_BOAS_VINDAS_ID')!,
            campos: { ...(campos as Record<string, string>), id_agendamento_medx: String(ag.id) },
        };
        r.negocios.push(novo);
        r.porIdAgendamento.set(String(ag.id), novo);
    }

    private camposBase(ag: AgendamentoExterno, ehEndovenoso: boolean): CamposNegocio {
        const duracao = DateTime.fromISO(ag.fim).diff(
            DateTime.fromISO(ag.inicio),
            'minutes',
        ).minutes;
        return {
            id_agendamento_medx: String(ag.id),
            duracao_consulta: String(Math.round(duracao)),
            ...(ehEndovenoso ? { tipo_consulta: 'endovenoso' } : {}),
        };
    }

    /** Campos de data da consulta, só os que ainda armam algo no futuro. */
    private camposDeData(r: Rodada, ag: AgendamentoExterno): CamposNegocio {
        const campos: CamposNegocio = {};
        for (const campo of CAMPOS_DATA) {
            const calculado = calcularCampoData(campo, ag.inicio);
            if (calculado.momento > r.agora) Object.assign(campos, calculado.campos);
        }
        return campos;
    }

    private etapasAssumiveis(): string[] {
        return [
            this.config.get<string>('CLINT_ETAPA_BOAS_VINDAS_ID')!,
            this.config.get<string>('CLINT_ETAPA_ENDOVENOSO_ID')!,
        ];
    }

    private async gravarSeHouver(dealId: string, campos: CamposNegocio): Promise<void> {
        if (Object.keys(campos).length > 0) await this.crm.gravarCampos(dealId, campos);
    }

    private async escrever(
        r: Rodada,
        acao: string,
        contexto: Record<string, unknown>,
        fazer: () => Promise<void>,
    ): Promise<void> {
        if (r.modo === 'observar') {
            this.logger.info({ ...contexto, acao }, 'monitor do MedX (observar)');
            return;
        }
        await fazer();
    }

    /**
     * Isola a falha de um agendamento. Devolve `false` quando a rodada deve
     * parar: limite de requisições do MedX (o resto seguiria falhando; a
     * próxima rodada continua de onde parou).
     */
    private async comProtecao(
        r: Rodada,
        idAgendamento: number,
        fazer: () => Promise<void>,
    ): Promise<boolean> {
        try {
            await fazer();
            return true;
        } catch (erro) {
            r.resumo.falhas++;
            if (erro instanceof Error && erro.name === 'ErroRateLimit') {
                this.logger.warn(
                    { id_agendamento: idAgendamento },
                    'monitor do MedX: limite de requisições — rodada encerrada, continua na próxima',
                );
                return false;
            }
            this.logger.error(
                {
                    alerta: true,
                    id_agendamento: idAgendamento,
                    erro: erro instanceof Error ? erro.message : String(erro),
                },
                'monitor do MedX: falha ao processar agendamento',
            );
            return true;
        }
    }
}
