/** Remove acentos e cedilha (NFD sem marcas diacríticas). */
export function semAcento(texto: string): string {
    return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}
