'use strict';

const shim = require('fabric-shim');
const { Contract } = require('fabric-contract-api');
const TrazabilidadCaracteristicas = require('./chaincode.js');

class ChaincodeWrapper {
    constructor() {
        this.contract = new TrazabilidadCaracteristicas();
    }

    async Init(stub) {
        return shim.success();
    }

    async Invoke(stub) {
        const ret = stub.getFunctionAndParameters();
        const method = ret.fcn;
        const args = ret.params;

        try {
            const result = await this.contract[method]({ stub }, ...args);
            return shim.success(Buffer.from(result || ''));
        } catch (err) {
            // Devolver el error como un éxito con un mensaje JSON
            const errorResponse = JSON.stringify({ error: err.message || 'Error desconocido' });
            return shim.success(Buffer.from(errorResponse));
        }
    }
}

shim.start(new ChaincodeWrapper());
console.log('Chaincode started successfully');
