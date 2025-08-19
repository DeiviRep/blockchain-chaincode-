'use strict';

const shim = require('fabric-shim');
const TrazabilidadCaracteristicas = require('./chaincode.js');

class ChaincodeWrapper {
    constructor() {
        this.contract = new TrazabilidadCaracteristicas();
    }

    async Init(stub) {
        console.info('Init invoked');
        try {
            if (typeof this.contract.initLedger === 'function') {
                await this.contract.initLedger({ stub });
            }
            return shim.success();
        } catch (err) {
            return shim.error(err.message);
        }
    }

    async Invoke(stub) {
        const ret = stub.getFunctionAndParameters();
        const method = ret.fcn;
        const args = ret.params || [];

        if (!method) {
            return shim.success(Buffer.from('No function name provided'));
        }

        try {
            const result = await this.contract[method]({ stub }, ...args);
            const payload = typeof result === 'string' ? result : JSON.stringify(result || {});
            return shim.success(Buffer.from(payload));
        } catch (err) {
            const errorResponse = err.message || 'Error desconocido';
            return shim.error(errorResponse);
        }
    }
}

shim.start(new ChaincodeWrapper());
console.log('Chaincode started successfully');
