function palavras(nome: string): string[] {
    return nome
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

/**
 * O nome da Clint (apelido, com emoji) casa com o nome completo do MedX quando
 * todas as palavras dele aparecem no nome do MedX, ignorando acento, caixa,
 * emoji e pontuação.
 */
export function nomeCasa(nomeMedx: string, nomeClint: string): boolean {
    const doClint = palavras(nomeClint);
    if (doClint.length === 0) return false;
    const doMedx = new Set(palavras(nomeMedx));
    return doClint.every(p => doMedx.has(p));
}
