'use strict';

const { Contract } = require('fabric-contract-api');

// =============================================================================
// CONSTANTS
// =============================================================================
const ESTADOS = {
  REGISTRADO:         'REGISTRADO',
  EMBARCADO:          'EMBARCADO',
  DESEMBARCADO:       'DESEMBARCADO',
  NACIONALIZADO:      'NACIONALIZADO',
  EN_DISTRIBUCION:    'EN_DISTRIBUCION',
  PRODUCTO_ADQUIRIDO: 'PRODUCTO_ADQUIRIDO'
};

const TRANSICIONES_ESTADO = {
  [ESTADOS.REGISTRADO]:         [ESTADOS.EMBARCADO],
  [ESTADOS.EMBARCADO]:          [ESTADOS.DESEMBARCADO],
  [ESTADOS.DESEMBARCADO]:       [ESTADOS.NACIONALIZADO],
  [ESTADOS.NACIONALIZADO]:      [ESTADOS.EN_DISTRIBUCION, ESTADOS.PRODUCTO_ADQUIRIDO],
  [ESTADOS.EN_DISTRIBUCION]:    [ESTADOS.PRODUCTO_ADQUIRIDO],
  [ESTADOS.PRODUCTO_ADQUIRIDO]: []
};

const INDICES = {
  LOTE_PRODUCTO: 'LOTE~PRODUCTO',
  IMEI_PRODUCTO: 'IMEI~PRODUCTO'
};

const KEYS = { PRODUCTO: 'PRODUCTO_' };

// =============================================================================
// VALIDATORS — solo invariantes del ledger
// =============================================================================
class Validators {
  static validarEstado(estado) {
    if (!Object.values(ESTADOS).includes(estado)) {
      throw new Error(`Estado inválido: ${estado}`);
    }
  }

  static validarTransicionEstado(estadoActual, nuevoEstado) {
    if (estadoActual && !TRANSICIONES_ESTADO[estadoActual]?.includes(nuevoEstado)) {
      throw new Error(`Transición inválida de ${estadoActual} a ${nuevoEstado}`);
    }
  }
}

// =============================================================================
// UTILITIES
// =============================================================================
class Utils {
  static parseJSONSafe(str, fallback = {}) {
    try {
      if (!str || typeof str !== 'string') return fallback;
      return JSON.parse(str) ?? fallback;
    } catch {
      return fallback;
    }
  }

  static getTxTimestamp(ctx) {
    const ts = ctx.stub.getTxTimestamp();
    return new Date(ts.seconds.low * 1000).toISOString();
  }

  static crearEvento(ctx, tipo, puntoControl, latitud, longitud, datosAdicionales = {}) {
    return {
      tipo,
      fecha:       Utils.getTxTimestamp(ctx),
      puntoControl,
      coordenadas: [parseFloat(latitud), parseFloat(longitud)],
      ...datosAdicionales
    };
  }
}

// =============================================================================
// DATA PROCESSORS
// =============================================================================
class DataProcessors {
  static procesarDatosEvento(tipoEvento, datos) {
    const r = {};
    switch (tipoEvento) {
      case ESTADOS.EMBARCADO:
        if (datos.puntoControl)   r.puntoControl   = datos.puntoControl;
        if (datos.contenedor)     r.contenedor     = datos.contenedor;
        if (datos.tipoTransporte) r.tipoTransporte = datos.tipoTransporte;
        break;
      case ESTADOS.DESEMBARCADO:
        if (datos.puntoControl)            r.puntoControl            = datos.puntoControl;
        if (datos.integridad !== undefined) r.integridad             = datos.integridad;
        if (datos.descripcionIntegridad)   r.descripcionIntegridad   = datos.descripcionIntegridad;
        break;
      case ESTADOS.NACIONALIZADO:
        if (datos.puntoControl) r.puntoControl = datos.puntoControl;
        if (datos.dim)          r.dim          = datos.dim;
        if (datos.valorCIF)     r.valorCIF     = parseFloat(datos.valorCIF);
        if (datos.totalPagado)  r.totalPagado  = parseFloat(datos.totalPagado);
        if (datos.arancel)      r.arancel      = parseFloat(datos.arancel);
        if (datos.iva)          r.iva          = parseFloat(datos.iva);
        if (datos.ice)          r.ice          = parseFloat(datos.ice);
        break;
      case ESTADOS.EN_DISTRIBUCION:
        if (datos.puntoControl) r.puntoControl = datos.puntoControl;
        if (datos.comerciante)  r.comerciante  = datos.comerciante;
        if (datos.deposito)     r.deposito     = datos.deposito;
        break;
      case ESTADOS.PRODUCTO_ADQUIRIDO:
        if (datos.puntoControl) r.puntoControl = datos.puntoControl;
        if (datos.tienda)       r.tienda       = datos.tienda;
        if (datos.fechaCompra)  r.fechaCompra  = datos.fechaCompra;
        if (datos.cliente)      r.cliente      = datos.cliente;
        break;
    }
    return r;
  }

  static generarResumenLotes(productos) {
    const lotesMap  = {};
    const ordenEstados = Object.values(ESTADOS);

    productos.forEach(p => {
      if (!lotesMap[p.uuidLote]) {
        lotesMap[p.uuidLote] = {
          id:                p.uuidLote,
          lote:              p.lote,
          marca:             p.marca,
          modelo:            p.modelo,
          cantidadProductos: 0,
          url:               p.urlLote,
          fechaCreacion:     p.fechaCreacion,
          estadoMinimo:      p.estado,
          productos:         []
        };
      }
      const entry = lotesMap[p.uuidLote];
      entry.cantidadProductos++;
      entry.productos.push({ id: p.id, imeiSerial: p.imeiSerial, estado: p.estado });

      if (ordenEstados.indexOf(p.estado) < ordenEstados.indexOf(entry.estadoMinimo)) {
        entry.estadoMinimo = p.estado;
      }
    });

    return Object.values(lotesMap);
  }
}

// =============================================================================
// DATABASE ACCESS LAYER
// =============================================================================
class DatabaseAccess {
  constructor(ctx) { this.ctx = ctx; }

  async obtenerProducto(productoId) {
    const buf = await this.ctx.stub.getState(`${KEYS.PRODUCTO}${productoId}`);
    if (!buf || buf.length === 0) throw new Error(`El producto ${productoId} no existe`);
    return JSON.parse(buf.toString());
  }

  async guardarProducto(productoId, producto) {
    await this.ctx.stub.putState(`${KEYS.PRODUCTO}${productoId}`, Buffer.from(JSON.stringify(producto)));
  }

  async existeProducto(productoId) {
    const buf = await this.ctx.stub.getState(`${KEYS.PRODUCTO}${productoId}`);
    return buf && buf.length > 0;
  }

  async crearIndices(uuidLote, productoId, imeiSerial) {
    const iLote = this.ctx.stub.createCompositeKey(INDICES.LOTE_PRODUCTO, [uuidLote, productoId]);
    await this.ctx.stub.putState(iLote, Buffer.from('\u0000'));

    const iImei = this.ctx.stub.createCompositeKey(INDICES.IMEI_PRODUCTO, [imeiSerial, productoId]);
    await this.ctx.stub.putState(iImei, Buffer.from('\u0000'));
  }

  async listarTodosLosProductos() {
    const iterator = await this.ctx.stub.getStateByRange(`${KEYS.PRODUCTO}`, `${KEYS.PRODUCTO}\uffff`);
    const productos = [];
    let result = await iterator.next();
    while (!result.done) {
      if (result.value?.value) {
        try { productos.push(JSON.parse(result.value.value.toString())); }
        catch (e) { console.error('Error parsing producto:', e); }
      }
      result = await iterator.next();
    }
    await iterator.close();
    return productos;
  }

  async listarProductosPorLote(uuidLote) {
    const iterator = await this.ctx.stub.getStateByPartialCompositeKey(INDICES.LOTE_PRODUCTO, [uuidLote]);
    const productos = [];
    let result = await iterator.next();
    while (!result.done) {
      if (result.value?.key) {
        const parts = this.ctx.stub.splitCompositeKey(result.value.key);
        productos.push(await this.obtenerProducto(parts.attributes[1]));
      }
      result = await iterator.next();
    }
    await iterator.close();
    return productos;
  }

  async buscarPorImei(imei) {
    const iterator = await this.ctx.stub.getStateByPartialCompositeKey(INDICES.IMEI_PRODUCTO, [imei]);
    const result   = await iterator.next();
    if (!result.done && result.value) {
      const parts = this.ctx.stub.splitCompositeKey(result.value.key);
      await iterator.close();
      return await this.obtenerProducto(parts.attributes[1]);
    }
    await iterator.close();
    return null;
  }

  async obtenerHistorialProducto(productoId) {
    const iterator = await this.ctx.stub.getHistoryForKey(`${KEYS.PRODUCTO}${productoId}`);
    const historial = [];
    let result = await iterator.next();
    while (!result.done) {
      if (result.value?.value) {
        try {
          historial.push({
            txId:      result.value.tx_id,
            timestamp: new Date(result.value.timestamp.seconds.low * 1000).toISOString(),
            isDelete:  result.value.is_delete,
            value:     result.value.value.toString()
          });
        } catch (e) { console.error('Error en auditoría:', e); }
      }
      result = await iterator.next();
    }
    await iterator.close();
    return historial;
  }
}

// =============================================================================
// PRODUCTO SERVICE
// =============================================================================
class ProductoService {
  constructor(dbAccess) { this.db = dbAccess; }

  async registrarProducto(productoId, lote, uuidLote, marca, modelo, imeiSerial, puntoControl, latitud, longitud, urlLote = '') {
    if (await this.db.existeProducto(productoId)) {
      throw new Error(`El producto ${productoId} ya existe`);
    }
    if (await this.db.buscarPorImei(imeiSerial)) {
      throw new Error(`El IMEI ${imeiSerial} ya está registrado`);
    }

    const nuevoProducto = {
      lote, uuidLote, id: productoId, marca, modelo, imeiSerial,
      estado:        ESTADOS.REGISTRADO,
      urlLote:       urlLote || `trazabilidad.io/lote/${uuidLote}`,
      fechaCreacion: Utils.getTxTimestamp(this.db.ctx),
      eventos:       [Utils.crearEvento(this.db.ctx, ESTADOS.REGISTRADO, puntoControl, latitud, longitud)]
    };

    await this.db.guardarProducto(productoId, nuevoProducto);
    await this.db.crearIndices(uuidLote, productoId, imeiSerial);
    return nuevoProducto;
  }

  async agregarEvento(productoId, tipoEvento, puntoControl, latitud, longitud, datosEventoJSON = '{}') {
    Validators.validarEstado(tipoEvento);

    const producto = await this.db.obtenerProducto(productoId);
    Validators.validarTransicionEstado(producto.estado, tipoEvento);

    const datos        = Utils.parseJSONSafe(datosEventoJSON, {});
    const adicionales  = DataProcessors.procesarDatosEvento(tipoEvento, datos);
    const nuevoEvento  = Utils.crearEvento(this.db.ctx, tipoEvento, puntoControl, latitud, longitud, adicionales);

    producto.eventos.push(nuevoEvento);
    producto.estado = tipoEvento;

    await this.db.guardarProducto(productoId, producto);
    return producto;
  }
}

// =============================================================================
// CONSULTA SERVICE
// =============================================================================
class ConsultaService {
  constructor(dbAccess) { this.db = dbAccess; }

  async buscarPorQR(codigo) {
    const porImei = await this.db.buscarPorImei(codigo);
    if (porImei) return { encontrado: true, tipo: 'producto', data: porImei };

    try {
      const producto = await this.db.obtenerProducto(codigo);
      return { encontrado: true, tipo: 'producto', data: producto };
    } catch {
      return { encontrado: false, mensaje: 'Producto no encontrado' };
    }
  }

  async obtenerEstadisticas() {
    const todos = await this.db.listarTodosLosProductos();
    return todos.reduce((stats, p) => {
      stats.totalProductos++;
      switch (p.estado) {
        case ESTADOS.REGISTRADO:         stats.registrados++;         break;
        case ESTADOS.EMBARCADO:          stats.embarcados++;          break;
        case ESTADOS.DESEMBARCADO:       stats.desembarcados++;       break;
        case ESTADOS.NACIONALIZADO:      stats.nacionalizados++;      break;
        case ESTADOS.EN_DISTRIBUCION:    stats.enDistribucion++;      break;
        case ESTADOS.PRODUCTO_ADQUIRIDO: stats.productosAdquiridos++; break;
      }
      return stats;
    }, { totalProductos: 0, registrados: 0, embarcados: 0, desembarcados: 0, nacionalizados: 0, enDistribucion: 0, productosAdquiridos: 0 });
  }

  async obtenerActividadReciente(limite = 10) {
    const todos   = await this.db.listarTodosLosProductos();
    const eventos = [];
    todos.forEach(p => {
      p.eventos.forEach(ev => eventos.push({
        ...ev, productoId: p.id, lote: p.lote,
        marca: p.marca, modelo: p.modelo, imeiSerial: p.imeiSerial
      }));
    });
    eventos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    return eventos.slice(0, parseInt(limite));
  }
}

// =============================================================================
// MAIN CONTRACT
// =============================================================================
class TrazabilidadContract extends Contract {

  async initLedger(ctx) {
    console.info('Sistema de Trazabilidad iniciado');
    return JSON.stringify({ mensaje: 'Ledger inicializado correctamente' });
  }

  // --- Productos ---

  async registrarProducto(ctx, productoId, lote, uuidLote, marca, modelo, imeiSerial, puntoControl, latitud, longitud, urlLote = '') {
    const db      = new DatabaseAccess(ctx);
    const service = new ProductoService(db);
    const nuevo   = await service.registrarProducto(productoId, lote, uuidLote, marca, modelo, imeiSerial, puntoControl, latitud, longitud, urlLote);

    ctx.stub.setEvent('ProductoRegistrado', Buffer.from(JSON.stringify({
      productoId, lote, uuidLote, imeiSerial, timestamp: nuevo.fechaCreacion
    })));

    return JSON.stringify(nuevo);
  }

  async agregarEventoProducto(ctx, productoId, tipoEvento, puntoControl, latitud, longitud, datosEventoJSON = '{}') {
    const db      = new DatabaseAccess(ctx);
    const service = new ProductoService(db);
    const producto = await service.agregarEvento(productoId, tipoEvento, puntoControl, latitud, longitud, datosEventoJSON);

    ctx.stub.setEvent('EventoProductoAgregado', Buffer.from(JSON.stringify({
      productoId, tipoEvento, puntoControl, timestamp: Utils.getTxTimestamp(ctx)
    })));

    return JSON.stringify(producto);
  }

  async obtenerProducto(ctx, productoId) {
    const db = new DatabaseAccess(ctx);
    return JSON.stringify(await db.obtenerProducto(productoId));
  }

  async listarProductos(ctx) {
    const db = new DatabaseAccess(ctx);
    return JSON.stringify(await db.listarTodosLosProductos());
  }

  async listarProductosPorLote(ctx, uuidLote) {
    const db = new DatabaseAccess(ctx);
    return JSON.stringify(await db.listarProductosPorLote(uuidLote));
  }

  async listarResumenLotes(ctx) {
    const db       = new DatabaseAccess(ctx);
    const todos    = await db.listarTodosLosProductos();
    return JSON.stringify(DataProcessors.generarResumenLotes(todos));
  }

  // --- Consultas ---

  async buscarPorQR(ctx, codigo) {
    const db      = new DatabaseAccess(ctx);
    const service = new ConsultaService(db);
    return JSON.stringify(await service.buscarPorQR(codigo));
  }

  async obtenerEstadisticas(ctx) {
    const db      = new DatabaseAccess(ctx);
    const service = new ConsultaService(db);
    return JSON.stringify(await service.obtenerEstadisticas());
  }

  async obtenerActividadReciente(ctx, limite = 10) {
    const db      = new DatabaseAccess(ctx);
    const service = new ConsultaService(db);
    return JSON.stringify(await service.obtenerActividadReciente(limite));
  }

  // --- Auditoría ---

  async auditarHistorialProducto(ctx, productoId) {
    const db = new DatabaseAccess(ctx);
    return JSON.stringify(await db.obtenerHistorialProducto(productoId));
  }

  async verificarIntegridadProducto(ctx, productoId) {
    const db        = new DatabaseAccess(ctx);
    const producto  = await db.obtenerProducto(productoId);
    const historial = await db.obtenerHistorialProducto(productoId);

    return JSON.stringify({
      productoId,
      imeiSerial:         producto.imeiSerial,
      integridadOk:       true,
      totalTransacciones: historial.length,
      fechaCreacion:      producto.fechaCreacion,
      ultimaModificacion: historial[0]?.timestamp,
      eventos:            producto.eventos.length,
      estadoActual:       producto.estado
    });
  }

  async auditarLoteCompleto(ctx, uuidLote) {
    const db        = new DatabaseAccess(ctx);
    const productos = await db.listarProductosPorLote(uuidLote);
    const resultado = { uuidLote, totalProductos: productos.length, productos: [] };

    for (const producto of productos) {
      const historial = await db.obtenerHistorialProducto(producto.id);
      resultado.productos.push({
        productoId:         producto.id,
        imeiSerial:         producto.imeiSerial,
        integridadOk:       true,
        totalTransacciones: historial.length,
        fechaCreacion:      producto.fechaCreacion,
        ultimaModificacion: historial[0]?.timestamp,
        eventos:            producto.eventos.length,
        estadoActual:       producto.estado
      });
    }

    return JSON.stringify(resultado);
  }
}

module.exports = TrazabilidadContract;