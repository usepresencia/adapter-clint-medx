export const REDIS_HEALTH_CLIENT = Symbol('VerificadorRedis');

export interface VerificadorRedis {
    ping(): Promise<string>;
}
