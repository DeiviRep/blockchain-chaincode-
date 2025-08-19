'use strict';

const { Contract } = require('fabric-contract-api');
const crypto = require('crypto');

class TrazabilidadCaracteristicas extends Contract {
  // --- Utils ---
  _validarCoords(latitud, longitud) {
    const lat = parseFloat(latitud);
    const lon = parseFloat(longitud);
    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lon) || lon < -180 || lon > 180) {
      throw new Error('Latitud o longitud inválida');
    }
    return { lat, lon };
  }

  _parseJSONSafe(str, fallback) {
    try {
      if (!str || typeof str !== 'string') return fallback;
      const v = JSON.parse(str);
      return v ?? fallback;
    } catch {
      return fallback;
    }
  }

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

  _validarTransicionEstado(actual, nuevo) {
    const transiciones = {
      Registro: ['Embarque'],
      Embarque: ['Desembarque'],
      Desembarque: ['Nacionalización'],
      Nacionalización: ['Distribución', 'ConsumidorFinal'],
      Distribución: ['ConsumidorFinal'],
      ConsumidorFinal: []
    };

    if (actual && !transiciones[actual]?.includes(nuevo)) {
      throw new Error(`Transición inválida de ${actual} a ${nuevo}`);
    }
  }

  _nowIso(ctx) {
    const t = ctx.stub.getTxTimestamp();
    return new Date(t.seconds.low * 1000).toISOString();
  }

  _generarHashHistorico(dispositivo) {
    const datosRelevantes = {
      id: dispositivo.id,
      modelo: dispositivo.modelo,
      marca: dispositivo.marca,
      origenPais: dispositivo.origenPais,
      estado: dispositivo.estado,
      timestamp: dispositivo.timestamp,
    };
    return crypto.createHash('sha256').update(JSON.stringify(datosRelevantes)).digest('hex');
  }

  // --- Bootstrap ---
  async initLedger(ctx) {
    console.info('Ledger trazabilidad iniciado v3.0');
    return;
  }

  // --- Registro inicial ---
  async registrarDispositivo(
    ctx,
    id,
    modelo,
    marca,
    imeiSerial,
    origenPais,
    latitud,
    longitud,
    evento,           // debe ser 'Registro'
    uuidLote = '',
    actor = '',
    rol = '',
    urlLote = '',     // NUEVO: se guarda en el dispositivo
    detallesJSON = '{}',
    documentosMetaJSON = '[]',
    documentosCodigoJSON = '{}',
    documentosHashJSON = '[]'
  ) {
    if (!id) throw new Error('Se requiere id');
    if (evento !== 'Registro') throw new Error("El registro inicial debe tener evento 'Registro'");

    const { lat, lon } = this._validarCoords(latitud, longitud);

    const exists = await ctx.stub.getState(id);
    if (exists && exists.length > 0) throw new Error(`El dispositivo ${id} ya existe`);

    const detalles = this._parseJSONSafe(detallesJSON, {});
    const documentosMeta = this._parseJSONSafe(documentosMetaJSON, []);
    const documentosCodigo = this._parseJSONSafe(documentosCodigoJSON, {});
    const documentosHash = this._parseJSONSafe(documentosHashJSON, []);

    const timestamp = this._nowIso(ctx);
    const txId = ctx.stub.getTxID();

    const dispositivo = {
      id,
      uuidLote: uuidLote || '',
      urlLote: urlLote || '',
      modelo,
      marca,
      imeiSerial,
      origenPais,
      ubicacion: { lat, lon },
      estado: evento,
      evento,
      detalles, // libre pero mantenemos propiedades específicas abajo
      documentosMeta,
      documentosCodigo,
      documentosHash,
      actor,
      rol,
      txId,
      timestamp,
      // propiedades específicas por evento de registro ya están arriba (marca, modelo, etc.)
      // props de otros eventos se crean vacías para claridad
      tipoTransporte: undefined,
      nroContenedor: undefined,
      puertoSalida: undefined,
      puertoExtranjero: undefined,
      integridad: undefined,
      descripcionIntegridad: undefined,
      dim: undefined,
      valorCif: undefined,
      arancel: undefined,
      iva: undefined,
      ice: undefined,
      totalPagado: undefined,
      comerciante: undefined,
      deposito: undefined,
      tienda: undefined,
      fechaCompra: undefined,
      hashHistorico: '',
    };
    dispositivo.hashHistorico = this._generarHashHistorico(dispositivo);

    await ctx.stub.putState(id, Buffer.from(JSON.stringify(dispositivo)));

    if (uuidLote) {
      const compositeKey = ctx.stub.createCompositeKey('lote~id', [uuidLote, id]);
      await ctx.stub.putState(compositeKey, Buffer.from('\u0000'));
    }

    ctx.stub.setEvent('DispositivoRegistrado', Buffer.from(JSON.stringify({ id, evento, actor, rol, txId, timestamp })));

    return JSON.stringify(dispositivo);
  }

  // ---- Consultar por ID ----
  async consultarDispositivo(ctx, id) {
    if (!id) throw new Error('Se requiere id');
    const buf = await ctx.stub.getState(id);
    if (!buf || buf.length === 0) throw new Error(`El dispositivo ${id} no existe`);
    return buf.toString();
  }

  // --- Actualizar ---
  // async actualizarDispositivo(
  //   ctx,
  //   id,
  //   modelo,
  //   marca,
  //   origenPais,
  //   latitud,
  //   longitud,
  //   evento,
  //   actor = '',
  //   rol = '',
  //   detallesJSON = '{}',
  //   documentosMetaJSON = '[]',
  //   documentosCodigoJSON = '{}',
  //   documentosHashJSON = '[]',
  //   forceUpdate = 'false'
  // ) {
  //   if (!id) throw new Error('Se requiere id');
  //   const buf = await ctx.stub.getState(id);
  //   if (!buf || buf.length === 0) throw new Error(`El dispositivo ${id} no existe`);

  //   const anterior = JSON.parse(buf.toString());
  //   if (!this._eventosValidos().includes(evento)) throw new Error(`Evento inválido: ${evento}`);

  //   this._validarTransicionEstado(anterior.estado, evento);
  //   this._validarRolPermiso(rol, evento);

  //   const { lat, lon } = this._validarCoords(latitud, longitud);
  //   const force = forceUpdate === true || forceUpdate === 'true';

  //   if (!force) {
  //     if ((modelo && modelo !== anterior.modelo) ||
  //         (marca && marca !== anterior.marca) ||
  //         (origenPais && origenPais !== anterior.origenPais)) {
  //       throw new Error('Cambiar modelo/marca/origenPais requiere forceUpdate=true');
  //     }
  //   }

  //   const timestamp = this._nowIso(ctx);
  //   const txId = ctx.stub.getTxID();

  //   const detalles = this._parseJSONSafe(detallesJSON, {});
  //   const documentosMeta = this._parseJSONSafe(documentosMetaJSON, []);
  //   const documentosCodigo = this._parseJSONSafe(documentosCodigoJSON, {});
  //   const documentosHash = this._parseJSONSafe(documentosHashJSON, []);

  //   const actualizado = {
  //     ...anterior,
  //     modelo: modelo || anterior.modelo,
  //     marca: marca || anterior.marca,
  //     origenPais: origenPais || anterior.origenPais,
  //     ubicacion: { lat, lon },
  //     estado: evento,
  //     evento,
  //     detalles: Object.keys(detalles).length > 0 ? detalles : anterior.detalles,
  //     documentosMeta: documentosMeta.length > 0 ? documentosMeta : anterior.documentosMeta,
  //     documentosCodigo: Object.keys(documentosCodigo).length > 0 ? documentosCodigo : anterior.documentosCodigo,
  //     documentosHash: documentosHash.length > 0 ? documentosHash : anterior.documentosHash,
  //     actor,
  //     rol,
  //     txId,
  //     timestamp,
  //     hashHistorico: ''
  //   };
  //   actualizado.hashHistorico = this._generarHashHistorico(actualizado);

  //   await ctx.stub.putState(id, Buffer.from(JSON.stringify(actualizado)));

  //   ctx.stub.setEvent('DispositivoActualizado', Buffer.from(JSON.stringify({ id, evento, actor, rol, txId, timestamp })));

  //   return JSON.stringify(actualizado);
  // }

  // ---- Actualizar (eventos) ----
  async actualizarDispositivo(
    ctx,
    id,
    modelo,                 // ignorado salvo forceUpdate (si quisieras, pero ya no lo usamos)
    marca,
    origenPais,
    latitud,
    longitud,
    evento,                 // 'Embarque' | 'Desembarque' | 'Nacionalización' | 'Distribución' | 'ConsumidorFinal'
    actor = '',
    rol = '',
    documentosMetaJSON = '[]',
    documentosCodigoJSON = '{}',
    documentosHashJSON = '[]',
    forceUpdate = 'false',
    detallesJSON = '{}'     // CAMPOS ESPECÍFICOS DEL EVENTO
  ) {
    if (!id) throw new Error('Se requiere id');
    const buf = await ctx.stub.getState(id);
    if (!buf || buf.length === 0) throw new Error(`El dispositivo ${id} no existe`);

    const anterior = JSON.parse(buf.toString());
    if (!this._eventosValidos().includes(evento)) throw new Error(`Evento inválido: ${evento}`);

    this._validarTransicionEstado(anterior.estado, evento);

    const { lat, lon } = this._validarCoords(latitud, longitud);
    const force = forceUpdate === true || forceUpdate === 'true';

    // Ya no permitimos cambiar modelo/marca/origen por aquí (lo ignoramos salvo force)
    if (!force) {
      if ((modelo && modelo !== anterior.modelo) ||
          (marca && marca !== anterior.marca) ||
          (origenPais && origenPais !== anterior.origenPais)) {
        throw new Error('Cambiar modelo/marca/origenPais requiere forceUpdate=true');
      }
    }

    const timestamp = this._nowIso(ctx);
    const txId = ctx.stub.getTxID();

    const documentosMeta = this._parseJSONSafe(documentosMetaJSON, []);
    const documentosCodigo = this._parseJSONSafe(documentosCodigoJSON, {});
    const documentosHash = this._parseJSONSafe(documentosHashJSON, []);
    const detalles = this._parseJSONSafe(detallesJSON, {});

    const actualizado = {
      ...anterior,
      modelo: modelo || anterior.modelo,
      marca: marca || anterior.marca,
      origenPais: origenPais || anterior.origenPais,
      ubicacion: { lat, lon },
      estado: evento,
      evento,
      documentosMeta: documentosMeta.length > 0 ? documentosMeta : anterior.documentosMeta,
      documentosCodigo: Object.keys(documentosCodigo).length > 0 ? documentosCodigo : anterior.documentosCodigo,
      documentosHash: documentosHash.length > 0 ? documentosHash : anterior.documentosHash,
      actor,
      rol,
      txId,
      timestamp,
    };

    // Escribir SOLO propiedades específicas del evento actual:
    switch (evento) {
      case 'Embarque': {
        actualizado.tipoTransporte = detalles.tipoTransporte || '';
        actualizado.nroContenedor = detalles.nroContenedor || '';
        actualizado.puertoSalida = detalles.puertoSalida || '';
        break;
      }
      case 'Desembarque': {
        actualizado.puertoExtranjero = detalles.puertoExtranjero || '';
        // integridad boolean estricta
        const integ = (typeof detalles.integridad === 'boolean') ? detalles.integridad : false;
        actualizado.integridad = integ;
        actualizado.descripcionIntegridad = detalles.descripcionIntegridad || '';
        break;
      }
      case 'Nacionalización': {
        actualizado.dim = detalles.dim || '';
        actualizado.valorCif = Number(detalles.valorCif || 0);
        actualizado.arancel = Number(detalles.arancel || 0);
        actualizado.iva = Number(detalles.iva || 0);
        actualizado.ice = Number(detalles.ice || 0);
        actualizado.totalPagado = Number(detalles.totalPagado || 0);
        break;
      }
      case 'Distribución': {
        actualizado.comerciante = detalles.comerciante || '';
        actualizado.deposito = detalles.deposito || '';
        break;
      }
      case 'ConsumidorFinal': {
        actualizado.tienda = detalles.tienda || '';
        actualizado.fechaCompra = detalles.fechaCompra || ''; // ISO string
        break;
      }
      default:
        break;
    }

    actualizado.hashHistorico = this._generarHashHistorico(actualizado);

    await ctx.stub.putState(id, Buffer.from(JSON.stringify(actualizado)));

    ctx.stub.setEvent('DispositivoActualizado', Buffer.from(JSON.stringify({ id, evento, actor, rol, txId, timestamp })));

    return JSON.stringify(actualizado);
  }

  // ---- Historial ----
  async obtenerHistorial(ctx, id) {
    if (!id) throw new Error('Se requiere id');
    const iterator = await ctx.stub.getHistoryForKey(id);
    const historial = [];
    let result = await iterator.next();
    while (!result.done) {
      if (result.value && result.value.value) {
        try {
          const parsed = JSON.parse(result.value.value.toString('utf8'));
          historial.push({
            txId: result.value.tx_id || parsed.txId,
            timestamp: parsed.timestamp,
            evento: parsed.evento,
            actor: parsed.actor,
            rol: parsed.rol,
            estado: parsed.estado,
            hashHistorico: parsed.hashHistorico,
            data: parsed,
          });
        } catch {}
      }
      result = await iterator.next();
    }
    await iterator.close();
    return JSON.stringify(historial);
  }

  // ---- Listados ----
  async listarDispositivos(ctx) {
    const iterator = await ctx.stub.getStateByRange('', '');
    const dispositivos = [];
    let result = await iterator.next();
    while (!result.done) {
      if (result.value && result.value.key && !result.value.key.includes('~')) {
        try {
          dispositivos.push(JSON.parse(result.value.value.toString('utf8')));
        } catch {}
      }
      result = await iterator.next();
    }
    await iterator.close();
    return JSON.stringify(dispositivos);
  }

  async listarPorLote(ctx, uuidLote) {
    if (!uuidLote) throw new Error('Se requiere uuidLote');
    const iterator = await ctx.stub.getStateByPartialCompositeKey('lote~id', [uuidLote]);
    const dispositivos = [];
    let result = await iterator.next();
    while (!result.done) {
      const parsed = ctx.stub.splitCompositeKey(result.value.key);
      const id = parsed.attributes[1];
      const buf = await ctx.stub.getState(id);
      if (buf && buf.length > 0) dispositivos.push(JSON.parse(buf.toString()));
      result = await iterator.next();
    }
    await iterator.close();
    return JSON.stringify(dispositivos);
  }
}

module.exports = TrazabilidadCaracteristicas;