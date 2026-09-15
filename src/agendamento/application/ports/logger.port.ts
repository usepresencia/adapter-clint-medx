export const LOGGER_PORT = Symbol('LoggerMinimo');

export interface LoggerMinimo {
    info(o: unknown, m?: string): void;
    warn(o: unknown, m?: string): void;
    error(o: unknown, m?: string): void;
}
