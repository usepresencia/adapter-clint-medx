import type { Telefone } from '../../domain/paciente/telefone';

export const CONVERSAO_PORT = Symbol('ConversaoPort');

export interface ConversaoPort {
    /**
     * `capturadoEm` é o momento em que o clique foi registrado (não o
     * momento da conversão) — é o timestamp que a Meta exige embutido no
     * parâmetro `fbc`.
     */
    notificarConversao(telefone: Telefone, fbclid: string, capturadoEm: Date): Promise<void>;
}
