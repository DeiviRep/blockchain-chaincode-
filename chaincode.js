'use strict';

const { Contract } = require('fabric-contract-api');

class TrazabilidadCaracteristicas extends Contract {

    // Util - validación geo
    _validarCoords(latitud, longitud) {
        const lat = parseFloat(latitud);
        const lon = parseFloat(longitud);
        if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lon) || lon < -180 || lon > 180) {
            throw new Error('Latitud o longitud inválida');
        }
        return { lat, lon };
    }

    // Util - eventos válidos (extensible)
    _eventosValidos() {
        return [
            'Registro',
            'Embarque',
            'Desembarque',
            'Nacionalización',
            'Distribución',
            'ConsumidorFinal'
        ];
    }

    // Inicializa ledger (por compatibilidad)
    async initLedger(ctx) {
        console.info('Sistema Ledger de trazabilidad iniciado');
        return;
    }

    /**
     * registrarDispositivo
     * Firma extendida (todos los campos opcionales al final):
     * registrarDispositivo(ctx, id, modelo, marca, origen, latitud, longitud, evento, loteId, actor, rol, documentosJSON, codigoDocumentosJSON, hashDocumentosJSON, urlPublica)
     *
     * Nota: documentosJSON, codigoDocumentosJSON, hashDocumentosJSON son opcionales y se aceptan como JSON stringificadas.
     * Por defecto se almacenan vacíos si no se envían.
     */
    async registrarDispositivo(ctx, id, modelo, marca, origen, latitud, longitud, evento, loteId = '', actor = '', rol = '', documentosJSON = '[]', codigoDocumentosJSON = '{}', hashDocumentosJSON = '[]', urlPublica = '') {
        if (!id) throw new Error('Se requiere id');

        // Validar coords
        const { lat, lon } = this._validarCoords(latitud, longitud);

        // Evento válido
        const eventosValidos = this._eventosValidos();
        if (!eventosValidos.includes(evento)) {
            throw new Error(`Evento inválido. Use uno de: ${eventosValidos.join(', ')}`);
        }

        // Timestamps y txId
        const txId = ctx.stub.getTxID();
        const timestampProto = ctx.stub.getTxTimestamp();
        const isoTimestamp = new Date(timestampProto.seconds.low * 1000).toISOString();

        // Generar qrCodeId simple
        const qrCodeId = `TRZ-${id}-${isoTimestamp.split('.')[0].replace(/[:T-]/g, '')}`;

        // Parsear opcionales con tolerancia
        let documentos = [];
        let codigoDocumentos = {};
        let hashDocumentos = [];
        console.log("FFFFFFFF")
        try {
            documentos = JSON.parse(documentosJSON || '[]');
            if (!Array.isArray(documentos)) documentos = [];
        } catch (e) {
            documentos = [];
        }
        try {
            codigoDocumentos = JSON.parse(codigoDocumentosJSON || '{}');
            if (typeof codigoDocumentos !== 'object' || Array.isArray(codigoDocumentos)) codigoDocumentos = {};
        } catch (e) {
            codigoDocumentos = {};
        }
        try {
            hashDocumentos = JSON.parse(hashDocumentosJSON || '[]');
            if (!Array.isArray(hashDocumentos)) hashDocumentos = [];
        } catch (e) {
            hashDocumentos = [];
        }

        // Chequear existencia
        const exists = await ctx.stub.getState(id);
        if (exists && exists.length > 0) {
            throw new Error(`El dispositivo ${id} ya existe. Use actualizarDispositivo para añadir eventos.`);
        }

        // Estado actual (registro inicial)
        const dispositivo = {
            id,
            loteId,
            modelo,
            marca,
            origen,
            ubicacion: `${lat},${lon}`,
            evento,
            qrCodeId,
            urlPublica: urlPublica || '',
            documentos,
            codigoDocumentos,
            hashDocumentos,
            actor,
            rol,
            txId,
            timestamp: isoTimestamp
        };

        // Guardar estado actual
        await ctx.stub.putState(id, Buffer.from(JSON.stringify(dispositivo)));

        // Índice por lote (si loteId presente)
        if (loteId && loteId.length > 0) {
            const compositeKey = ctx.stub.createCompositeKey('lote~id', [loteId, id]);
            await ctx.stub.putState(compositeKey, Buffer.from('\u0000'));
        }

        // Emitir evento Fabric
        ctx.stub.setEvent('DispositivoRegistrado', Buffer.from(JSON.stringify({ id, loteId, evento, actor, rol, txId, timestamp: isoTimestamp })));

        return JSON.stringify(dispositivo);
    }

        /**
     * consultarDispositivo
     * Firma:
     * consultarDispositivo(ctx, id)
     *
     * Devuelve el estado actual (JSON string) del dispositivo o lanza error si no existe.
     */
    async consultarDispositivo(ctx, id) {
        if (!id) throw new Error('Se requiere id');
        const dispositivoBuf = await ctx.stub.getState(id);
        if (!dispositivoBuf || dispositivoBuf.length === 0) {
            throw new Error(`El dispositivo ${id} no existe`);
        }
        return dispositivoBuf.toString();
    }

    /**
     * actualizarDispositivo
     * Firma:
     * actualizarDispositivo(ctx, id, modelo, marca, origen, latitud, longitud, evento, actor, rol, documentosJSON, codigoDocumentosJSON, hashDocumentosJSON, urlPublica, forceUpdate)
     *
     * forceUpdate: 'true'|'false' (string) o booleano
     */
    async actualizarDispositivo(ctx, id, modelo, marca, origen, latitud, longitud, evento, actor = '', rol = '', documentosJSON = '[]', codigoDocumentosJSON = '{}', hashDocumentosJSON = '[]', urlPublica = '', forceUpdate = 'false') {
        if (!id) throw new Error('Se requiere id');
        const existsBuf = await ctx.stub.getState(id);
        if (!existsBuf || existsBuf.length === 0) {
            throw new Error(`El dispositivo ${id} no existe`);
        }

        const eventosValidos = this._eventosValidos();
        if (!eventosValidos.includes(evento)) {
            throw new Error(`Evento inválido. Use uno de: ${eventosValidos.join(', ')}`);
        }

        const { lat, lon } = this._validarCoords(latitud, longitud);

        const timestampProto = ctx.stub.getTxTimestamp();
        const isoTimestamp = new Date(timestampProto.seconds.low * 1000).toISOString();
        const txId = ctx.stub.getTxID();

        // Mantener qrCodeId original y loteId
        const dispositivoAnterior = JSON.parse(existsBuf.toString());
        const qrCodeId = dispositivoAnterior.qrCodeId || `TRZ-${id}-${isoTimestamp.split('.')[0].replace(/[:T-]/g, '')}`;
        const loteId = dispositivoAnterior.loteId || '';

        // Parsear opcionales con tolerancia
        let documentos = [];
        let codigoDocumentos = {};
        let hashDocumentos = [];
        try {
            documentos = JSON.parse(documentosJSON || '[]');
            if (!Array.isArray(documentos)) documentos = [];
        } catch (e) {
            documentos = [];
        }
        try {
            codigoDocumentos = JSON.parse(codigoDocumentosJSON || '{}');
            if (typeof codigoDocumentos !== 'object' || Array.isArray(codigoDocumentos)) codigoDocumentos = {};
        } catch (e) {
            codigoDocumentos = {};
        }
        try {
            hashDocumentos = JSON.parse(hashDocumentosJSON || '[]');
            if (!Array.isArray(hashDocumentos)) hashDocumentos = [];
        } catch (e) {
            hashDocumentos = [];
        }

        // Prevención de cambios no autorizados a características principales
        const force = (forceUpdate === 'true' || forceUpdate === true);
        if (!force) {
            if ((modelo && modelo !== dispositivoAnterior.modelo) ||
                (marca && marca !== dispositivoAnterior.marca) ||
                (origen && origen !== dispositivoAnterior.origen)) {
                throw new Error('Para cambiar modelo/marca/origen se necesita forceUpdate=true y autorización administrativa.');
            }
        }

        const dispositivo = {
            id,
            loteId,
            modelo: modelo || dispositivoAnterior.modelo,
            marca: marca || dispositivoAnterior.marca,
            origen: origen || dispositivoAnterior.origen,
            ubicacion: `${lat},${lon}`,
            evento,
            qrCodeId,
            urlPublica: urlPublica || dispositivoAnterior.urlPublica || '',
            documentos: documentos.length > 0 ? documentos : dispositivoAnterior.documentos || [],
            codigoDocumentos: Object.keys(codigoDocumentos).length > 0 ? codigoDocumentos : (dispositivoAnterior.codigoDocumentos || {}),
            hashDocumentos: hashDocumentos.length > 0 ? hashDocumentos : (dispositivoAnterior.hashDocumentos || []),
            actor,
            rol,
            txId,
            timestamp: isoTimestamp
        };

        await ctx.stub.putState(id, Buffer.from(JSON.stringify(dispositivo)));

        // Emitir evento Fabric para backend
        ctx.stub.setEvent('DispositivoActualizado', Buffer.from(JSON.stringify({ id, loteId, evento, actor, rol, txId, timestamp: isoTimestamp })));

        return JSON.stringify(dispositivo);
    }

    // Obtener historial enriquecido
    async obtenerHistorial(ctx, id) {
        if (!id) throw new Error('Se requiere id');
        const iterator = await ctx.stub.getHistoryForKey(id);
        const historial = [];

        let result = await iterator.next();
        while (!result.done) {
            if (result.value && result.value.value) {
                try {
                    const raw = result.value.value.toString('utf8');
                    const parsed = JSON.parse(raw);
                    historial.push({
                        txId: result.value.tx_id || parsed.txId || null,
                        timestamp: parsed.timestamp || null,
                        actor: parsed.actor || null,
                        rol: parsed.rol || null,
                        evento: parsed.evento || null,
                        data: parsed
                    });
                } catch (err) {
                    // ignorar valores no JSON
                }
            }
            result = await iterator.next();
        }
        await iterator.close();
        return JSON.stringify(historial);
    }

    // Listar todos los dispositivos (estado actual). Omite composite keys
    async listarDispositivos(ctx) {
        const iterator = await ctx.stub.getStateByRange('', '');
        const dispositivos = [];

        let result = await iterator.next();
        while (!result.done) {
            if (result.value && result.value.key) {
                // Ignorar entradas de índice (composite keys contienen "~")
                if (!result.value.key.includes('lote~id')) {
                    try {
                        const strValue = result.value.value.toString('utf8');
                        const record = JSON.parse(strValue);
                        dispositivos.push(record);
                    } catch (err) {
                        // no-json, ignorar
                    }
                }
            }
            result = await iterator.next();
        }
        await iterator.close();
        return JSON.stringify(dispositivos);
    }

    // Listar dispositivos por lote usando composite key
    async listarPorLote(ctx, loteId) {
        if (!loteId) throw new Error('Se requiere loteId');
        const iterator = await ctx.stub.getStateByPartialCompositeKey('lote~id', [loteId]);
        const dispositivos = [];

        let result = await iterator.next();
        while (!result.done) {
            if (result.value && result.value.key) {
                // compositeKey -> parse to extract id
                try {
                    const parsed = ctx.stub.splitCompositeKey(result.value.key);
                    const id = parsed.attributes[1];
                    const deviceBuf = await ctx.stub.getState(id);
                    if (deviceBuf && deviceBuf.length > 0) {
                        dispositivos.push(JSON.parse(deviceBuf.toString()));
                    }
                } catch (err) {
                    // ignorar
                }
            }
            result = await iterator.next();
        }
        await iterator.close();
        return JSON.stringify(dispositivos);
    }

}

module.exports = TrazabilidadCaracteristicas;
