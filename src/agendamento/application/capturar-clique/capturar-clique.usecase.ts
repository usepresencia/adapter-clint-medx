import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CLIQUE_ORIGEM_REPOSITORIO } from '../../../shared/persistence/persistence.module';
import type { CliqueOrigemRepositorio } from '../../domain/clique-origem/clique-origem.repositorio';
import type { ComandoCapturarClique } from './capturar-clique.comando';

// Sem 0/O, 1/I/L: evita ambiguidade se alguém precisar ler/digitar o código.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAMANHO_CODIGO = 8;

function gerarCodigo(): string {
    const bytes = randomBytes(TAMANHO_CODIGO);
    let codigo = '';
    for (let i = 0; i < TAMANHO_CODIGO; i++) {
        codigo += ALFABETO[bytes[i]! % ALFABETO.length];
    }
    return codigo;
}

@Injectable()
export class CapturarCliqueUseCase {
    constructor(
        @Inject(CLIQUE_ORIGEM_REPOSITORIO) private readonly cliques: CliqueOrigemRepositorio,
    ) {}

    async executar(comando: ComandoCapturarClique): Promise<string> {
        const codigo = gerarCodigo();
        await this.cliques.criar(codigo, comando);
        return codigo;
    }
}
