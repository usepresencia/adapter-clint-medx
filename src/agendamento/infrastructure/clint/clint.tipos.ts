export interface ContatoApi {
    id: string;
    name: string | null;
    phone: string | null;
    ddi: string | null;
}

/** Telefone do contato em E.164, ou `null` sem número. */
export function e164(contato: ContatoApi): string | null {
    const numero = (contato.phone ?? '').replace(/\D/g, '');
    if (!numero) return null;
    const ddi = (contato.ddi ?? '').replace(/\D/g, '');
    return `+${ddi}${numero}`;
}
