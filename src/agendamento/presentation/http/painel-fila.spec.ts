import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Queue } from 'bullmq';
import { registrarPainelFila } from './painel-fila';

function appFalso() {
    const expressApp = express();
    return {
        app: { getHttpAdapter: () => ({ getInstance: () => expressApp }) } as any,
        expressApp,
    };
}

function filaFalsa(): Queue {
    const fila = new Queue('teste-painel', {
        connection: { host: '127.0.0.1', port: 1, retryStrategy: () => null },
    });
    fila.on('error', () => {});
    return fila;
}

describe('registrarPainelFila', () => {
    let fila: Queue;

    afterEach(async () => {
        await fila?.close();
    });

    it('sem credenciais não registra a rota e devolve false', () => {
        fila = filaFalsa();
        const { app } = appFalso();
        expect(registrarPainelFila(app, fila, {})).toBe(false);
    });

    it('com credenciais registra a rota protegida por basic auth', async () => {
        fila = filaFalsa();
        const { app, expressApp } = appFalso();

        expect(registrarPainelFila(app, fila, { usuario: 'u', senha: 's' })).toBe(true);

        const semAuth = await request(expressApp).get('/admin/filas/');
        expect(semAuth.status).toBe(401);
    });
});
