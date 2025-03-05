'use strict';

const { Contract } = require('fabric-contract-api');

class TrazabilidadCaracteristicas extends Contract {
    async initLedger(ctx) {
        console.info('Sistema de trazabilidad iniciado');
    }

    async registrarDispositivo(ctx, id, modelo, marca, caracteristica, origen) {
        const timestamp = ctx.stub.getTxTimestamp(); // Usar timestamp de la transacción
        const isoTimestamp = new Date(timestamp.seconds.low * 1000).toISOString();

        const dispositivo = {
            id: id,
            modelo: modelo,
            marca: marca,
            caracteristica: caracteristica,
            origen: origen,
            timestamp: isoTimestamp
        };
        await ctx.stub.putState(id, Buffer.from(JSON.stringify(dispositivo)));
        return JSON.stringify(dispositivo);
    }

    async consultarDispositivo(ctx, id) {
        const dispositivo = await ctx.stub.getState(id);
        if (!dispositivo || dispositivo.length === 0) {
            throw new Error(`El dispositivo ${id} no existe`);
        }
        return dispositivo.toString();
    }
}

module.exports = TrazabilidadCaracteristicas;