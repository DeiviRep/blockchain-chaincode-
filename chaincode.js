'use strict';

const { Contract } = require('fabric-contract-api');

class TrazabilidadCaracteristicas extends Contract {
    async initLedger(ctx) {
        console.info('Sistema de trazabilidad iniciado');
    }

    async registrarDispositivo(ctx, id, modelo, marca, caracteristica, origen) {
        const timestamp = ctx.stub.getTxTimestamp();
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

    async actualizarDispositivo(ctx, id, modelo, marca, caracteristica, origen) {
        const dispositivoExistente = await ctx.stub.getState(id);
        if (!dispositivoExistente || dispositivoExistente.length === 0) {
            throw new Error(`El dispositivo ${id} no existe`);
        }

        const timestamp = ctx.stub.getTxTimestamp();
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

    async listarDispositivos(ctx) {
        const iterator = await ctx.stub.getStateByRange('', '');
        const dispositivos = [];

        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
                dispositivos.push(record);
            } catch (err) {
                console.log(err);
            }
            result = await iterator.next();
        }
        await iterator.close();
        return JSON.stringify(dispositivos);
    }

    async eliminarDispositivo(ctx, id) {
        const dispositivoExistente = await ctx.stub.getState(id);
        if (!dispositivoExistente || dispositivoExistente.length === 0) {
            throw new Error(`El dispositivo ${id} no existe`);
        }
        await ctx.stub.deleteState(id);
        return JSON.stringify({ message: `Dispositivo ${id} eliminado` });
    }

    async consultarPorMarca(ctx, marca) {
        const iterator = await ctx.stub.getStateByRange('', '');
        const dispositivos = [];

        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
                if (record.marca === marca) {
                    dispositivos.push(record);
                }
            } catch (err) {
                console.log(err);
            }
            result = await iterator.next();
        }
        await iterator.close();
        return JSON.stringify(dispositivos);
    }
}

module.exports = TrazabilidadCaracteristicas;