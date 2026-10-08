const VISTA_INICIAL_CONFIG = {
    zoom: 2,
    enfocarId: null,
    centro: { x: 1091, y: 626 }
};

const RENDER_CONFIG = { modo: 'viewbox' };
let vistaBase = { x: 0, y: 0, kx: 1, ky: 1 };

const ENCUADRE_CONFIG = {
    margen: 70,
    zoomBusqueda: 2,
    zoomMaximo: 3,
    duracion: 900,
    duracionBotones: 220,
    respetarMovimientoReducido: false
};

const LIMITES_CONFIG = {
    modoMinimo: 'cubrir',
    zoomMaximo: 8,
    velocidadRueda: 0.004,
    recorte: { izq: 0, der: 0, arriba: 0, abajo: 0 }
};

let baseDeDatosHorarios = [];
let listaSugerencias = [];
let salonesRegistradosEnMapa = new Set();
let salonesExcluidosSet = new Set();    
const escuelaPorIdEdificio = new Map();

let estructurasConfig = { tipos: {}, estructuras: [] };
const estructuraPorId = new Map();
const estructuraPorSalon = new Map();

let anchoRealSVG = 0;
let altoRealSVG = 0;
let anchoContenedor = 0;
let altoContenedor = 0;
let mapaInicializado = false;
let escala = 1;
let escalaMinimaPermitida = 1;
let escalaMaximaPermitida = 8;
let transX = 0;
let transY = 0;
let contenedorMapa = null;
let svgEl = null;
let renderPendiente = false;

const punteros = new Map();
let inicioToque = { x: 0, y: 0 };
let huboArrastre = false;
let huboMultitouch = false;
let ultimoPellizco = null;

let salonActivoActual = null;

const elementosSalon = new Map();
const elementosResaltados = new Set();

let TIEMPO_LIMITE_MS = 20000;

class ErrorCarga extends Error {
    constructor(tipo, mensaje) { super(mensaje); this.tipo = tipo; }
}

async function pedir(url, { texto = false } = {}) {
    let ultimo;
    for (let intento = 0; intento < 2; intento++) {
        const control = new AbortController();
        const reloj = setTimeout(() => control.abort(), TIEMPO_LIMITE_MS);
        try {
            const respuesta = await fetch(url, { signal: control.signal });
            if (!respuesta.ok) throw new ErrorCarga('http', `El servidor respondió con el error ${respuesta.status}.`);
            if (respuesta.headers.get('x-desde-cache') === '1') anotarDatoDeCache(respuesta.headers.get('x-guardado'));
            return texto ? await respuesta.text() : await respuesta.json();
        } catch (e) {
            if (e instanceof ErrorCarga) ultimo = e;
            else if (e.name === 'AbortError') ultimo = new ErrorCarga('lento', 'La conexión es muy lenta y la descarga no terminó a tiempo.');
            else if (e instanceof SyntaxError) ultimo = new ErrorCarga('formato', 'El archivo no tiene un formato válido.');
            else if (navigator.onLine === false) ultimo = new ErrorCarga('sin-conexion', 'Parece que no tienes conexión a internet.');
            else ultimo = new ErrorCarga('red', 'No se pudo conectar con el servidor.');
        } finally {
            clearTimeout(reloj);
        }
        if (ultimo.tipo === 'formato' || (ultimo.tipo === 'http' && /error 4/.test(ultimo.message))) break;
        if (intento === 0) await new Promise(r => setTimeout(r, 1200));
    }
    throw ultimo;
}

let datosDesdeCache = null;
function anotarDatoDeCache(guardadoMs) {
    const t = Number(guardadoMs) || Date.now();
    datosDesdeCache = datosDesdeCache ? Math.min(datosDesdeCache, t) : t;
}

let mapaCargado = false;
let horariosListos = false;
let estructurasListas = false;

async function cargarSVGMapa() {
    const contenedor = document.querySelector('.mapa-placeholder');
    try {
        const texto = await pedir('./mapageofacing.svg', { texto: true });
        if (!/<svg[\s>]/i.test(texto)) throw new ErrorCarga('formato', 'El archivo del mapa no es un SVG válido.');

        contenedor.innerHTML = texto;
        const svgElemento = contenedor.querySelector('svg');
        if (svgElemento) svgElemento.id = 'svg1';

        registrarSalonesDinamicos();
        mapaCargado = true;
        return null;
    } catch (error) {
        console.error("Error al cargar mapageofacing.svg:", error);
        return error;
    }
}

function registrarSalonesDinamicos() {
    salonesRegistradosEnMapa.clear();
    elementosSalon.clear();
    elementosResaltados.clear();
    document.querySelectorAll('#svg1 [id]').forEach(el => {
        const id = el.id.trim();
        if (/[A-Z]/.test(id) && id === id.toUpperCase() && id !== 'SVG1') {
            salonesRegistradosEnMapa.add(id);
            elementosSalon.set(id, el);
            el.classList.add('salon');
            el.style.cursor = 'pointer';
        }
    });
}

async function cargarHorarios() {
    try {
        const datos = await pedir('./horarios.json');
        if (!Array.isArray(datos)) throw new ErrorCarga('formato', 'El archivo de horarios no tiene un formato válido.');
        baseDeDatosHorarios = datos;
        horariosListos = true;
        return null;
    } catch (error) {
        console.error("Error al cargar horarios.json:", error);
        return error;
    }
}

function procesarSugerencias() {
    const mapa = new Map();
    estructurasConfig.estructuras.forEach(est => {
        const tipo = estructurasConfig.tipos[est.tipo] || {};
        mapa.set(`EST_${est.nombre}`, { texto: est.nombre, tipo: 'Estructura', subtitulo: tipo.etiqueta || 'Lugar', icono: tipo.icono || '📍', valorBusqueda: est.nombre, tipoClave: est.tipo });
    });
    baseDeDatosHorarios.forEach(bloque => {
        const [codigo, materia, seccion, profesor, dia, hora, salon] = bloque;
        
        if (profesor && !mapa.has(`PROF_${profesor}`)) mapa.set(`PROF_${profesor}`, { texto: profesor, tipo: 'Profesor', icono: '👨‍🏫', valorBusqueda: profesor });
        if (salon && !mapa.has(`SALON_${salon}`)) mapa.set(`SALON_${salon}`, { texto: salon, tipo: 'Salón', icono: '📍', valorBusqueda: salon });
        
        const claveMateria = materia || codigo;
        if (claveMateria && !mapa.has(`MAT_${codigo}_${materia}`)) {
            const etiquetaUnificada = codigo && materia ? `${codigo} - ${materia}` : claveMateria;
            mapa.set(`MAT_${codigo}_${materia}`, { texto: etiquetaUnificada, tipo: 'Materia', icono: '📚', valorBusqueda: etiquetaUnificada, codigo, nombre: materia || '' });
        }
    });
    listaSugerencias = Array.from(mapa.values());
}

const DIAS_CLAVE = ["LU", "MA", "MI", "JU", "VI", "SA"];
const NOMBRES_DIAS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
const BLOQUES_HORAS = ["0800", "0850", "0940", "1030", "1120", "1210", "1300", "1350", "1440", "1530", "1620", "1710", "1800", "1850", "1940"];

function generarTablaHorario(bloquesFiltrados) {
    const contenedorLeyenda = document.getElementById('leyenda-panel');
    if (!bloquesFiltrados || bloquesFiltrados.length === 0) {
        if (contenedorLeyenda) contenedorLeyenda.innerHTML = '';
        return `<div style="padding: 20px; text-align: center; color: #5f6368;">No se encontraron clases.</div>`;
    }

    const mapaHorario = {};
    const mapaLeyenda = new Map();

    BLOQUES_HORAS.forEach(hora => {
        mapaHorario[hora] = {};
        DIAS_CLAVE.forEach(dia => mapaHorario[hora][dia] = []);
    });

    bloquesFiltrados.forEach(bloque => {
        const [codigo, materia, seccion, profesor, dia, hora, salon] = bloque;
        const claveUnicaSec = `${codigo}_${seccion}`;
        if (codigo && !mapaLeyenda.has(claveUnicaSec)) {
            mapaLeyenda.set(claveUnicaSec, { codigo, seccion, nombre: materia || 'Sin nombre', profesor: profesor ? `Prof. ${profesor}` : 'Prof. Por asignar' });
        }
        if (mapaHorario[hora] && mapaHorario[hora][dia]) mapaHorario[hora][dia].push({ codigo, seccion, salon });
    });

    let html = `<table class="tabla-horario"><thead><tr><th>HORA</th>${NOMBRES_DIAS.map(d => `<th>${d.substring(0, 3)}</th>`).join('')}</tr></thead><tbody>`;
    BLOQUES_HORAS.forEach(hora => {
        html += `<tr><td class="col-hora">${hora}</td>`;
        DIAS_CLAVE.forEach(dia => {
            const clases = mapaHorario[hora][dia];
            html += clases.length > 0 ? `<td class="celda-activa">${clases.map(c => `
                <div class="bloque-celda">
                    <span class="materia-sec">${c.codigo}-${c.seccion}</span>
                    <span class="salon-tag" onclick="enfocarSalonDesdeTabla('${c.salon}')">${c.salon}</span>
                </div>
            `).join('<hr class="separador-bloque">')}</td>` : `<td></td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    generarLeyendaHTML(mapaLeyenda);
    return html;
}

function generarLeyendaHTML(mapaLeyenda) {
    const contenedorLeyenda = document.getElementById('leyenda-panel');
    if (!contenedorLeyenda) return;
    let htmlLeyenda = `<ul>`;
    mapaLeyenda.forEach((info) => htmlLeyenda += `<li><strong>${info.codigo}</strong>: ${info.nombre} - Sección: ${info.seccion} - ${info.profesor}</li>`);
    htmlLeyenda += `</ul>`;
    contenedorLeyenda.innerHTML = htmlLeyenda;
}

function abrirPanelResultados(htmlContenido) {
    document.getElementById('contenido-panel').innerHTML = htmlContenido;
    document.getElementById('panel-info').classList.remove('activo');
    const panel = document.getElementById('modulo-resultados');
    panel.classList.add('activo');
    panel.classList.remove('minimizado');
    panel.classList.remove('expandido');
    panel.querySelector('.panel-scroll').scrollTop = 0;
    restablecerBotonMinimizar();
    actualizarEstadoHoja();
    abrirCapaHistorial();
}

const HOJA_MOVIL = { alturaAsomada: 0.38, mediaQuery: '(max-width: 768px)' };
const mqMovil = window.matchMedia(HOJA_MOVIL.mediaQuery);
const esVistaMovil = () => mqMovil.matches;

function actualizarEstadoHoja() {
    const panel = document.getElementById('modulo-resultados');
    const activo = panel.classList.contains('activo');
    const expandida = panel.classList.contains('expandido');
    document.body.classList.toggle('hoja-asomada', activo && !expandida);
    document.body.classList.toggle('hoja-expandida', activo && expandida);
    const asa = document.getElementById('asa-hoja');
    if (asa) asa.setAttribute('aria-label', expandida ? 'Bajar el horario' : 'Subir el horario');
}

function alternarHoja(expandir) {
    const panel = document.getElementById('modulo-resultados');
    const nuevo = (typeof expandir === 'boolean') ? expandir : !panel.classList.contains('expandido');
    panel.classList.toggle('expandido', nuevo);
    actualizarEstadoHoja();
}

function inicializarHojaMovil() {
    const panel = document.getElementById('modulo-resultados');
    const UMBRAL = 10, DISTANCIA = 40;
    let y0 = null, arrastrando = false, acaboDeArrastrar = false;

    panel.addEventListener('pointerdown', (e) => {
        if (!esVistaMovil() || !panel.classList.contains('activo')) return;
        if (e.target.closest('button:not(#asa-hoja)')) return;
        if (panel.classList.contains('expandido') && !e.target.closest('#asa-hoja')) return;
        y0 = e.clientY; arrastrando = false;
    });
    panel.addEventListener('pointermove', (e) => {
        if (y0 === null) return;
        if (!arrastrando && Math.abs(e.clientY - y0) > UMBRAL) {
            arrastrando = true;
            try { panel.setPointerCapture(e.pointerId); } catch (_) {}
        }
    });
    const terminar = (e) => {
        if (y0 === null) return;
        const dy = e.clientY - y0;
        if (arrastrando && e.type === 'pointerup') {
            if (dy < -DISTANCIA) alternarHoja(true);
            else if (dy > DISTANCIA) alternarHoja(false);
            acaboDeArrastrar = true;
            setTimeout(() => { acaboDeArrastrar = false; }, 0);
        }
        y0 = null; arrastrando = false;
    };
    panel.addEventListener('pointerup', terminar);
    panel.addEventListener('pointercancel', terminar);
    panel.addEventListener('click', (e) => { if (acaboDeArrastrar) { e.stopPropagation(); e.preventDefault(); } }, true);

    const asa = document.getElementById('asa-hoja');
    if (asa) asa.addEventListener('click', () => { if (esVistaMovil() && !acaboDeArrastrar) alternarHoja(); });
    if (mqMovil.addEventListener) mqMovil.addEventListener('change', actualizarEstadoHoja);
    else mqMovil.addListener(actualizarEstadoHoja);
}

function restablecerBotonMinimizar() {
    const btn = document.getElementById('btn-minimizar-panel');
    if (btn) {
        btn.textContent = '‹';
        btn.setAttribute('aria-label', 'Ocultar panel');
    }
}

function alternarMinimizarPanel() {
    const panel = document.getElementById('modulo-resultados');
    panel.classList.toggle('minimizado');
    
    const btn = document.getElementById('btn-minimizar-panel');
    if (panel.classList.contains('minimizado')) {
        btn.textContent = '›';
        btn.setAttribute('aria-label', 'Mostrar panel');
    } else {
        btn.textContent = '‹';
        btn.setAttribute('aria-label', 'Ocultar panel');
    }
}

function ocultarPaneles() {
    const panel = document.getElementById('modulo-resultados');
    panel.classList.remove('activo', 'minimizado');
    panel.classList.remove('expandido');
    restablecerBotonMinimizar();
    actualizarEstadoHoja();
    document.getElementById('panel-info').classList.remove('activo');
    document.getElementById('input-busqueda').value = '';
    salonActivoActual = null;
    sincronizarHistorial();
}

function cerrarPanelResultados() {
    ocultarPaneles();
    limpiarResaltadoMapa();
}

function normalizarTextoBusqueda(texto) {
    if (!texto) return '';
    const eq = {'10':'X', '1':'I', '2':'II', '3':'III', '4':'IV', '5':'V', '6':'VI', '7':'VII', '8':'VIII', '9':'IX'};
    return texto.toUpperCase().replace(/\b(10|[1-9])\b/g, (m) => eq[m] || m);
}

function cerrarTeclado() {
    const input = document.getElementById('input-busqueda');
    if (input && document.activeElement === input) input.blur();
}

function ejecutarBusqueda(texto, opciones = {}) {
    cerrarTeclado();
    const rawInput = (texto || document.getElementById('input-busqueda').value).trim();
    const busqueda = normalizarTextoBusqueda(rawInput);
    
    if (!busqueda) { 
        ocultarSugerencias();
        cerrarPanelResultados(); 
        limpiarResaltadoMapa(); 
        return; 
    }

    const estructurasExactas = estructurasConfig.estructuras.filter(e => plegar(e.nombre) === plegar(rawInput));
    if (estructurasExactas.length) {
        mostrarInfoEstructura(estructurasExactas, opciones);
        return;
    }

    if (!horariosListos) {
        const parciales = estructurasConfig.estructuras.filter(e => indiceCoincidenciaEstructura(e.nombre, plegar(rawInput)) >= 0);
        const nombres = new Set(parciales.map(e => plegar(e.nombre)));
        if (nombres.size === 1) { mostrarInfoEstructura(parciales, opciones); return; }
        if (nombres.size > 1) { mostrarSugerencias(rawInput); return; }
        avisarHorariosNoDisponibles();
        return;
    }

    const q = plegar(busqueda);
    const itemCoincidente = listaSugerencias.find(item => plegar(item.texto) === q || plegar(item.valorBusqueda) === q);
    let resultados = [];
    let salonesAEnfocar = new Set();
    const soloSalon = !!opciones.soloSalon ||
        (!itemCoincidente && salonesRegistradosEnMapa.has(rawInput.toUpperCase()));

    if (soloSalon) {
        resultados = baseDeDatosHorarios.filter(b => b[6] && plegar(b[6]) === q);
    } else if (itemCoincidente && itemCoincidente.tipo === 'Materia') {
        resultados = baseDeDatosHorarios.filter(b => b[0] === itemCoincidente.codigo);
    } else {
        const materiasCoincidentes = itemCoincidente ? [] : listaSugerencias.filter(item => item.tipo === 'Materia' && plegar(item.texto).includes(q));
        if (materiasCoincidentes.length > 1) {
            mostrarSugerencias(rawInput);
            return;
        }
        resultados = baseDeDatosHorarios.filter(b => {
            const [codigo, materia, seccion, profesor, dia, hora, salon] = b;
            const textoUnificadoMateria = codigo && materia ? `${codigo} - ${materia}` : (materia || codigo || '');
            return (salon && plegar(salon) === q) ||
                   (codigo && plegar(codigo) === q) ||
                   (profesor && plegar(profesor).includes(q)) ||
                   (materia && plegar(materia).includes(q)) ||
                   (plegar(textoUnificadoMateria) === q);
        });
    }

    if (resultados.length === 0 && !soloSalon) {
        const parciales = estructurasConfig.estructuras.filter(e => indiceCoincidenciaEstructura(e.nombre, plegar(rawInput)) >= 0);
        const nombresDistintos = new Set(parciales.map(e => plegar(e.nombre)));
        if (nombresDistintos.size === 1) { mostrarInfoEstructura(parciales, opciones); return; }
        if (nombresDistintos.size > 1) { mostrarSugerencias(rawInput); return; }
    }

    ocultarSugerencias();
    resultados.forEach(b => { if (b[6]) salonesAEnfocar.add(b[6].trim().toUpperCase()); });

    const idSalonBuscado = (itemCoincidente && itemCoincidente.tipo === 'Salón') ? itemCoincidente.texto.trim().toUpperCase() : rawInput.toUpperCase();
    const esSalon = (itemCoincidente && itemCoincidente.tipo === 'Salón') || salonesRegistradosEnMapa.has(idSalonBuscado);
    const banner = esSalon && !salonesExcluidosSet.has(idSalonBuscado) ? generarBannerEstado(idSalonBuscado) : '';
    abrirPanelResultados(banner + generarTablaHorario(resultados));
    resaltarSalonesEnMapa(Array.from(salonesAEnfocar));
    if (opciones.encuadrar !== false) encuadrarElementos(elementosResaltados);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
let capaResaltado = null;

function agregarContornoSuperior(el, clase) {
    const svg = document.getElementById('svg1');
    if (!svg || !el.parentNode || !el.parentNode.getCTM) return;
    if (!capaResaltado || !capaResaltado.isConnected) {
        capaResaltado = document.createElementNS(SVG_NS, 'g');
        capaResaltado.setAttribute('pointer-events', 'none');
        svg.appendChild(capaResaltado);
    }
    const ctmPadre = el.parentNode.getCTM();
    const ctmCapa = capaResaltado.getCTM();
    if (!ctmPadre || !ctmCapa) return;

    const m = ctmCapa.inverse().multiply(ctmPadre);
    const grupo = document.createElementNS(SVG_NS, 'g');
    grupo.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);

    [clase.replace('contorno', 'halo'), clase].forEach(claseCapa => {
        const forma = el.cloneNode(false);
        forma.removeAttribute('id');
        forma.removeAttribute('style');
        forma.setAttribute('class', claseCapa);
        grupo.appendChild(forma);
    });
    capaResaltado.appendChild(grupo);
}

function marcarSalon(idSalon, clase) {
    const el = elementosSalon.get(idSalon) || document.getElementById(idSalon);
    if (!el) return;
    el.classList.add(clase);
    elementosResaltados.add(el);
    agregarContornoSuperior(el, clase === 'salon-libre' ? 'contorno-libre' : 'contorno-resaltado');
}

function resaltarSalonesEnMapa(listaSalones) {
    limpiarResaltadoMapa();
    listaSalones.forEach(idSalon => {
        if (elementosSalon.has(idSalon)) { marcarSalon(idSalon, 'salon-resaltado'); return; }
        const est = estructuraPorSalon.get(idSalon);
        if (est) est.ids.forEach(id => marcarSalon(id, 'salon-resaltado'));
        else marcarSalon(idSalon, 'salon-resaltado');
    });
}

function enfocarSalonDesdeTabla(idSalon) {
    if (!idSalon) return;
    if (esVistaMovil()) alternarHoja(false);
    resaltarSalonesEnMapa([idSalon.toUpperCase()]);
    encuadrarElementos(elementosResaltados);
}

function limpiarResaltadoMapa() {
    elementosResaltados.forEach(el => el.classList.remove('salon-resaltado', 'salon-libre'));
    elementosResaltados.clear();
    if (capaResaltado) capaResaltado.textContent = '';
}

function inicializarBuscador() {
    document.getElementById('btn-buscar').addEventListener('click', () => ejecutarBusqueda());
    document.getElementById('input-busqueda').addEventListener('input', (e) => mostrarSugerencias(e.target.value));
    document.getElementById('input-busqueda').addEventListener('keydown', (e) => { if (e.key === 'Enter') ejecutarBusqueda(); });
    document.getElementById('btn-cerrar-panel').addEventListener('click', cerrarPanelResultados);
    document.getElementById('btn-cerrar-info').addEventListener('click', cerrarPanelResultados);
}

function indiceCoincidenciaEstructura(nombre, qPlegado) {
    const completo = plegar(nombre);
    const i = completo.indexOf(qPlegado);
    if (i < 0) return -1;
    const m = completo.match(/\s-\s*EDIFICIO\s*\d+$/);
    if (m && i >= m.index) return -1;
    return i;
}

const ORDEN_ESTRUCTURAS = ['escuela', 'decanato', 'direccion', 'departamento'];

function escaparHTML(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function puntuarSugerencia(item, q, qRomano) {
    const pos = (texto, consulta) => { const i = plegar(texto).indexOf(consulta); return i < 0 ? null : (i === 0 ? 0 : 1); };
    switch (item.tipo) {
        case 'Materia': {
            const porCodigo = item.codigo ? pos(item.codigo, qRomano) : null;
            if (porCodigo !== null) return [0, porCodigo];
            const porNombre = pos(item.nombre || item.texto, qRomano);
            if (porNombre !== null) return [1, porNombre];
            const porTexto = pos(item.texto, qRomano);
            return porTexto === null ? null : [1, 1];
        }
        case 'Salón': { const p = pos(item.texto, qRomano); return p === null ? null : [2, p]; }
        case 'Profesor': { const p = pos(item.texto, qRomano); return p === null ? null : [3, p]; }
        case 'Estructura': {
            const ix = indiceCoincidenciaEstructura(item.texto, q);
            if (ix < 0) return null;
            const p = ix === 0 ? 0 : 1;
            const i = ORDEN_ESTRUCTURAS.indexOf(item.tipoClave);
            return [4 + (i < 0 ? ORDEN_ESTRUCTURAS.length : i), p];
        }
    }
    return null;
}

function mostrarSugerencias(filtro) {
    const box = document.getElementById('sugerencias-box');
    const busqueda = normalizarTextoBusqueda(filtro.trim());
    if (!busqueda) { box.classList.add('oculto'); return; }

    const q = plegar(filtro.trim());
    const qRomano = plegar(busqueda);
    const coinc = [];
    listaSugerencias.forEach(item => {
        const p = puntuarSugerencia(item, q, qRomano);
        if (p) coinc.push({ item, grupo: p[0], pos: p[1] });
    });
    if (coinc.length === 0) { box.classList.add('oculto'); return; }
    coinc.sort((a, b) => (a.grupo - b.grupo) || (a.pos - b.pos) || a.item.texto.localeCompare(b.item.texto, 'es'));

    box.innerHTML = coinc.map(({ item: i }) => `<div class="sugerencia-item" data-valor="${escaparHTML(i.valorBusqueda)}"><span class="sugerencia-icono">${i.icono}</span><div class="sugerencia-texto"><span class="sugerencia-titulo">${escaparHTML(i.texto)}</span><span class="sugerencia-subtitulo">${escaparHTML(i.subtitulo || i.tipo)}</span></div></div>`).join('');
    box.scrollTop = 0;
    box.classList.remove('oculto');

    box.onclick = (e) => {
        const el = e.target.closest('.sugerencia-item');
        if (!el) return;
        const valor = el.getAttribute('data-valor');
        document.getElementById('input-busqueda').value = valor;
        ejecutarBusqueda(valor);
    };
}

function ocultarSugerencias() { document.getElementById('sugerencias-box').classList.add('oculto'); }

let desfaseX = 0;
let desfaseY = 0;

function medirSVG() {
    const vb = svgEl.viewBox.baseVal;
    const anchoPx = parseFloat(svgEl.getAttribute('width')) || 2000;
    const altoPx = parseFloat(svgEl.getAttribute('height')) || 1818;
    const vx = vb.x || 0, vy = vb.y || 0;
    const vw = vb.width || anchoPx, vh = vb.height || altoPx;
    const kx = vw / anchoPx;
    const ky = vh / altoPx;
    const r = LIMITES_CONFIG.recorte;

    desfaseX = r.izq;
    desfaseY = r.arriba;
    anchoRealSVG = Math.max(1, anchoPx - r.izq - r.der);
    altoRealSVG = Math.max(1, altoPx - r.arriba - r.abajo);

    vistaBase = { x: vx + r.izq * kx, y: vy + r.arriba * ky, kx, ky };
    svgEl.setAttribute('viewBox', `${vistaBase.x} ${vistaBase.y} ${anchoRealSVG * kx} ${altoRealSVG * ky}`);
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    if (RENDER_CONFIG.modo === 'viewbox') {
        svgEl.setAttribute('preserveAspectRatio', 'none');
        svgEl.style.width = '100%';
        svgEl.style.height = '100%';
    } else {
        svgEl.setAttribute('preserveAspectRatio', 'xMinYMin meet');
        svgEl.style.width = anchoRealSVG + 'px';
        svgEl.style.height = altoRealSVG + 'px';
    }
}

function calcularEscalas() {
    const ex = anchoContenedor / anchoRealSVG;
    const ey = altoContenedor / altoRealSVG;
    escalaMinimaPermitida = LIMITES_CONFIG.modoMinimo === 'contener' ? Math.min(ex, ey) : Math.max(ex, ey);
    escalaMaximaPermitida = Math.max(LIMITES_CONFIG.zoomMaximo, escalaMinimaPermitida * 2);
}

function limitarEscala(e) {
    return Math.min(escalaMaximaPermitida, Math.max(escalaMinimaPermitida, e));
}

function limitarTraslacion() {
    const w = anchoRealSVG * escala;
    const h = altoRealSVG * escala;
    transX = w <= anchoContenedor ? (anchoContenedor - w) / 2
                                  : Math.min(0, Math.max(anchoContenedor - w, transX));
    transY = h <= altoContenedor ? (altoContenedor - h) / 2
                                 : Math.min(0, Math.max(altoContenedor - h, transY));
}

function calcularVistaInicial() {
    const cfg = VISTA_INICIAL_CONFIG;
    let c = { x: anchoRealSVG / 2, y: altoRealSVG / 2 };
    const elFoco = cfg.enfocarId && document.getElementById(cfg.enfocarId);
    if (elFoco) {
        renderizarAhora();
        const re = elFoco.getBoundingClientRect();
        const rc = contenedorMapa.getBoundingClientRect();
        c = { x: (re.left + re.width / 2 - rc.left - transX) / escala, y: (re.top + re.height / 2 - rc.top - transY) / escala };
    } else if (cfg.centro) {
        c = { x: cfg.centro.x - desfaseX, y: cfg.centro.y - desfaseY };
    }
    return { escala: limitarEscala(escalaMinimaPermitida * Math.max(1, cfg.zoom)), cx: c.x, cy: c.y };
}

function establecerVistaInicial() {
    const v = calcularVistaInicial();
    escala = v.escala;
    transX = anchoContenedor / 2 - v.cx * escala;
    transY = altoContenedor / 2 - v.cy * escala;
}

function renderizarAhora() {
    if (RENDER_CONFIG.modo === 'viewbox') {
        if (!anchoContenedor || !altoContenedor) return;
        const v = vistaBase;
        svgEl.setAttribute('viewBox', [
            (v.x - transX / escala * v.kx).toFixed(4), (v.y - transY / escala * v.ky).toFixed(4),
            (anchoContenedor / escala * v.kx).toFixed(4), (altoContenedor / escala * v.ky).toFixed(4)
        ].join(' '));
    } else {
        svgEl.style.transform = `translate(${transX}px, ${transY}px) scale(${escala})`;
    }
    actualizarEstadoControles();
}

function aplicarTransformacionSVG() {
    limitarTraslacion();
    if (renderPendiente) return;
    renderPendiente = true;
    requestAnimationFrame(() => {
        renderPendiente = false;
        renderizarAhora();
    });
}

function zoomHacia(px, py, nuevaEscala) {
    const s = limitarEscala(nuevaEscala);
    const r = s / escala;
    transX = px - (px - transX) * r;
    transY = py - (py - transY) * r;
    escala = s;
    aplicarTransformacionSVG();
}

function datosPellizco() {
    const [a, b] = punteros.values();
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}

function inicializarPanZoom() {
    contenedorMapa = document.getElementById('modulo-mapa');
    svgEl = document.getElementById('svg1');
    if (!contenedorMapa || !svgEl) return;

    medirSVG();

    new ResizeObserver(entries => {
        const { width, height } = entries[0].contentRect;
        if (!width || !height) return;
        anchoContenedor = width;
        altoContenedor = height;
        const relativo = mapaInicializado ? escala / escalaMinimaPermitida : 1;
        calcularEscalas();
        if (!mapaInicializado) {
            establecerVistaInicial();
            mapaInicializado = true;
        } else {
            escala = limitarEscala(escalaMinimaPermitida * relativo);
        }
        aplicarTransformacionSVG();
        if (!cargaInicialTerminada) {
            cargaInicialTerminada = true;
            requestAnimationFrame(() => requestAnimationFrame(ocultarCarga));
        }
    }).observe(contenedorMapa);

    contenedorMapa.addEventListener('wheel', (e) => {
        e.preventDefault();
        cancelarAnimacionVista();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= 400;
        dy = Math.max(-120, Math.min(120, dy));
        const rect = contenedorMapa.getBoundingClientRect();
        zoomHacia(e.clientX - rect.left, e.clientY - rect.top, escala * Math.exp(-dy * LIMITES_CONFIG.velocidadRueda));
    }, { passive: false });

    contenedorMapa.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        cancelarAnimacionVista();
        contenedorMapa.setPointerCapture(e.pointerId);
        punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (punteros.size === 1) {
            inicioToque = { x: e.clientX, y: e.clientY };
            huboArrastre = false;
            huboMultitouch = false;
        } else if (punteros.size === 2) {
            huboMultitouch = true;
            ultimoPellizco = datosPellizco();
        }
    });

    contenedorMapa.addEventListener('pointermove', (e) => {
        const p = punteros.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;

        if (punteros.size === 1) {
            if (!huboArrastre && Math.hypot(e.clientX - inicioToque.x, e.clientY - inicioToque.y) > 6) huboArrastre = true;
            transX += dx;
            transY += dy;
            aplicarTransformacionSVG();
        } else if (punteros.size >= 2) {
            const nuevo = datosPellizco();
            if (ultimoPellizco && ultimoPellizco.dist > 0 && nuevo.dist > 0) {
                const rect = contenedorMapa.getBoundingClientRect();
                transX += nuevo.cx - ultimoPellizco.cx;
                transY += nuevo.cy - ultimoPellizco.cy;
                zoomHacia(nuevo.cx - rect.left, nuevo.cy - rect.top, escala * nuevo.dist / ultimoPellizco.dist);
            }
            ultimoPellizco = nuevo;
        }
    });

    const terminarPuntero = (e) => {
        if (!punteros.delete(e.pointerId)) return;
        ultimoPellizco = null;
        if (punteros.size === 0) {
            if (e.type === 'pointerup' && !huboArrastre && !huboMultitouch) manejarToqueEnMapa(e.clientX, e.clientY);
            huboMultitouch = false;
        }
    };
    contenedorMapa.addEventListener('pointerup', terminarPuntero);
    contenedorMapa.addEventListener('pointercancel', terminarPuntero);
}

function manejarToqueEnMapa(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    for (let nodo = el; nodo && nodo !== svgEl; nodo = nodo.parentElement) {
        if (salonesRegistradosEnMapa.has(nodo.id)) {
            seleccionarSalon(nodo.id);
            return;
        }
    }
    if (el === contenedorMapa || el === svgEl || el.classList.contains('mapa-placeholder')) cerrarPanelResultados();
}

function procesarEstructuras() {
    estructuraPorId.clear();
    estructuraPorSalon.clear();
    escuelaPorIdEdificio.clear();

    const escuelasGlobales = estructurasConfig.estructuras.filter(e => !e.nombre.includes(" - Edificio"));

    estructurasConfig.estructuras.forEach(est => {
        est.ids = (est.ids || []).filter(id => {
            const el = document.getElementById(id);
            if (!el) return false;
            if (!salonesRegistradosEnMapa.has(id)) {
                salonesRegistradosEnMapa.add(id);
                elementosSalon.set(id, el);
                el.classList.add('salon');
                el.style.cursor = 'pointer';
            }
            return true;
        });

        est.ids.forEach(id => {
            estructuraPorId.set(id, est);
            const escuelaGlobal = escuelasGlobales.find(g => g.tipo === 'escuela' && g.ids.includes(id) && g.nombre !== est.nombre);
            if (escuelaGlobal) {
                escuelaPorIdEdificio.set(id, escuelaGlobal);
            }
        });

        (est.salones || []).forEach(s => estructuraPorSalon.set(String(s).trim().toUpperCase(), est));
    });
}

function seleccionarSalon(idSalon) {
    const panelActivo = document.getElementById('modulo-resultados').classList.contains('activo') ||
                        document.getElementById('panel-info').classList.contains('activo');
    if (salonActivoActual === idSalon && panelActivo) {
        cerrarPanelResultados();
        return;
    }
    
    salonActivoActual = idSalon;

    const escuelaGlobal = escuelaPorIdEdificio.get(idSalon);
    if (escuelaGlobal) {
        mostrarInfoEstructura(escuelaGlobal, { encuadrar: false });
        return;
    }

    const est = estructuraPorId.get(idSalon);
    if (est) {
        mostrarInfoEstructura(est, { encuadrar: false });
        return;
    }

    document.getElementById('input-busqueda').value = idSalon;
    ejecutarBusqueda(idSalon, { encuadrar: false, soloSalon: true });
}

let animacionVista = null;
let escalaObjetivoVista = null;

function cancelarAnimacionVista() {
    if (animacionVista) { cancelAnimationFrame(animacionVista); animacionVista = null; }
    escalaObjetivoVista = null;
}

function animarVista(escalaFin, cx, cy, ax, ay, duracion = ENCUADRE_CONFIG.duracion) {
    cancelarAnimacionVista();
    escalaFin = limitarEscala(escalaFin);
    escalaObjetivoVista = escalaFin;
    const e0 = escala;
    const c0x = (ax - transX) / e0;
    const c0y = (ay - transY) / e0;
    const reducirMovimiento = ENCUADRE_CONFIG.respetarMovimientoReducido &&
        window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sinAnimacion = duracion <= 0 || reducirMovimiento;
    const t0 = performance.now();

    const paso = (ahora) => {
        const t = sinAnimacion ? 1 : Math.min(1, (ahora - t0) / duracion);
        const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        escala = e0 * Math.pow(escalaFin / e0, k);
        transX = ax - (c0x + (cx - c0x) * k) * escala;
        transY = ay - (c0y + (cy - c0y) * k) * escala;
        limitarTraslacion();
        renderizarAhora();
        animacionVista = t < 1 ? requestAnimationFrame(paso) : null;
        if (t >= 1) escalaObjetivoVista = null;
    };
    animacionVista = requestAnimationFrame(paso);
}

function ventanaMasDensa(items, W, H) {
    let mejor = [], mejorArea = Infinity;
    for (const a of items) {
        for (const b of items) {
            const dentro = items.filter(i => i.cx >= a.cx && i.cx <= a.cx + W && i.cy >= b.cy && i.cy <= b.cy + H);
            if (dentro.length < mejor.length) continue;
            const area = (Math.max(...dentro.map(i => i.x1)) - Math.min(...dentro.map(i => i.x0))) *
                         (Math.max(...dentro.map(i => i.y1)) - Math.min(...dentro.map(i => i.y0)));
            if (dentro.length > mejor.length || area < mejorArea) { mejor = dentro; mejorArea = area; }
        }
    }
    return mejor;
}

function calcularEncuadre(items, anchoUtil, altoUtil) {
    const caja = g => ({
        x0: Math.min(...g.map(i => i.x0)), y0: Math.min(...g.map(i => i.y0)),
        x1: Math.max(...g.map(i => i.x1)), y1: Math.max(...g.map(i => i.y1))
    });
    const escalaPara = g => {
        const c = caja(g);
        return Math.min(anchoUtil / Math.max(c.x1 - c.x0, 1), altoUtil / Math.max(c.y1 - c.y0, 1));
    };
    const escalaTope = Math.min(escalaMaximaPermitida, escalaMinimaPermitida * ENCUADRE_CONFIG.zoomMaximo);
    const escalaComoda = Math.min(escalaTope, Math.max(escalaMinimaPermitida, escalaMinimaPermitida * ENCUADRE_CONFIG.zoomBusqueda));

    let grupo = items;
    if (items.length > 1 && escalaPara(items) < escalaComoda) {
        grupo = ventanaMasDensa(items, anchoUtil / escalaComoda, altoUtil / escalaComoda);
    }
    const c = caja(grupo);
    return {
        escala: Math.min(escalaTope, Math.max(escalaMinimaPermitida, escalaPara(grupo))),
        cx: (c.x0 + c.x1) / 2,
        cy: (c.y0 + c.y1) / 2,
        usados: grupo.length
    };
}

function areaVisibleMapa() {
    let x0 = 0;
    const panel = document.getElementById('modulo-resultados');
    if (esVistaMovil()) {
        const asomada = panel.classList.contains('activo') && !panel.classList.contains('expandido');
        const y1 = asomada ? altoContenedor * (1 - HOJA_MOVIL.alturaAsomada) - 10 : altoContenedor;
        return { x0: 0, y0: 80, x1: anchoContenedor, y1 };
    }
    if (panel.classList.contains('activo') && !panel.classList.contains('minimizado')) {
        const borde = panel.offsetLeft + panel.offsetWidth;
        if (borde < anchoContenedor * 0.6) x0 = borde + 10;
    }
    return { x0, y0: 80, x1: anchoContenedor, y1: altoContenedor };
}

function encuadrarElementos(elementos) {
    if (!svgEl || !mapaInicializado) return;
    const lista = Array.from(elementos || []);
    if (lista.length === 0) return;

    cancelarAnimacionVista();
    renderizarAhora();
    const rc = contenedorMapa.getBoundingClientRect();
    const items = [];
    lista.forEach(el => {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) return;
        const x0 = (r.left - rc.left - transX) / escala, x1 = (r.right - rc.left - transX) / escala;
        const y0 = (r.top - rc.top - transY) / escala, y1 = (r.bottom - rc.top - transY) / escala;
        items.push({ x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
    });
    if (items.length === 0) return;

    const area = areaVisibleMapa();
    const ancho = area.x1 - area.x0, alto = area.y1 - area.y0;
    const m = Math.min(ENCUADRE_CONFIG.margen, 0.12 * Math.min(ancho, alto));
    const enc = calcularEncuadre(items, Math.max(50, ancho - 2 * m), Math.max(50, alto - 2 * m));
    animarVista(enc.escala, enc.cx, enc.cy, (area.x0 + area.x1) / 2, (area.y0 + area.y1) / 2);
}

const Historial = { sentinela: false, ignorar: 0, pendiente: null, abrirPendiente: false };

function hayCapasAbiertas() {
    return ['panel-opciones', 'modulo-resultados', 'panel-info']
        .some(id => document.getElementById(id).classList.contains('activo'));
}

function abrirCapaHistorial() {
    if (Historial.sentinela) return;
    Historial.sentinela = true;
    if (Historial.ignorar > 0) { Historial.abrirPendiente = true; return; }
    history.pushState({ geofacing: true }, '');
}

function sincronizarHistorial() {
    clearTimeout(Historial.pendiente);
    Historial.pendiente = setTimeout(() => {
        if (!Historial.sentinela || hayCapasAbiertas()) return;
        Historial.sentinela = false;
        if (Historial.abrirPendiente) { Historial.abrirPendiente = false; return; }
        Historial.ignorar++;
        history.back();
    }, 0);
}

window.addEventListener('popstate', () => {
    if (Historial.ignorar > 0) {
        Historial.ignorar--;
        if (Historial.ignorar === 0 && Historial.abrirPendiente) {
            Historial.abrirPendiente = false;
            history.pushState({ geofacing: true }, '');
        }
        return;
    }
    Historial.sentinela = false;
    Historial.abrirPendiente = false;
    if (!hayCapasAbiertas()) return;
    if (document.getElementById('panel-opciones').classList.contains('activo')) cerrarMenuDrawer();
    else cerrarPanelResultados();
    if (hayCapasAbiertas()) abrirCapaHistorial();
});

function plegar(texto) {
    return (texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

async function cargarEstructuras() {
    try {
        const datos = await pedir('./estructuras.json');
        if (!datos || !Array.isArray(datos.estructuras)) throw new ErrorCarga('formato', 'El archivo de lugares no tiene un formato válido.');

        estructurasConfig = { tipos: datos.tipos || {}, estructuras: datos.estructuras };
        salonesExcluidosSet = new Set((datos.salonesExcluidosLibres || []).map(s => s.trim().toUpperCase()));
        estructurasListas = true;
        return null;
    } catch (error) {
        console.error("Error al cargar estructuras.json:", error);
        return error;
    }
}

function mostrarInfoEstructura(estructuras, opciones = {}) {
    const lista = Array.isArray(estructuras) ? estructuras : [estructuras];
    const primera = lista[0];
    ocultarSugerencias();
    ocultarPaneles();
    limpiarResaltadoMapa();
    document.getElementById('input-busqueda').value = primera.nombre;
    lista.forEach(est => est.ids.forEach(id => marcarSalon(id, 'salon-resaltado')));
    const tipo = estructurasConfig.tipos[primera.tipo] || {};
    const cuantas = lista.length > 1 ? ` · ${lista.length} en el mapa` : '';
    document.getElementById('info-tipo').textContent = (tipo.etiqueta || 'Lugar') + cuantas;
    document.getElementById('info-nombre').textContent = primera.nombre;
    document.getElementById('panel-info').classList.add('activo');
    abrirCapaHistorial();
    if (opciones.encuadrar !== false) encuadrarElementos(elementosResaltados);
}

function resaltarEstructurasPorTipo(clave) {
    const tipo = estructurasConfig.tipos[clave] || {};
    const lista = estructurasConfig.estructuras.filter(e => e.tipo === clave && e.ids.length);
    limpiarResaltadoMapa();
    if (lista.length === 0) {
        mostrarAviso(`No hay ${(tipo.plural || tipo.etiqueta || 'lugares').toLowerCase()} registrados en el mapa.`);
        cerrarMenuDrawer();
        return;
    }
    ocultarPaneles();
    lista.forEach(e => e.ids.forEach(id => marcarSalon(id, 'salon-resaltado')));
    cerrarMenuDrawer();
    encuadrarElementos(elementosResaltados);
}

function construirOpcionesBusqueda() {
    const contenedor = document.getElementById('opciones-busqueda');
    if (!contenedor) return;
    const opciones = [{ valor: 'salones-libres', etiqueta: '⚡ Salones libres ahora' }];
    Object.entries(estructurasConfig.tipos).forEach(([clave, t]) => {
        if (t.buscable) opciones.push({ valor: clave, etiqueta: `${t.icono || '📍'} ${t.plural || t.etiqueta}` });
    });
    const filtro = document.getElementById('filtro-duracion');
    contenedor.onchange = () => {
        const marcada = document.querySelector('input[name="tipo-busqueda"]:checked');
        if (filtro) filtro.hidden = !marcada || marcada.value !== 'salones-libres';
    };
    contenedor.innerHTML = opciones.map((o, i) =>
        `<label class="opcion-busqueda"><input type="radio" name="tipo-busqueda" value="${o.valor}"${i === 0 ? ' checked' : ''}><span>${o.etiqueta}</span></label>`
    ).join('');
}

function resaltarSeleccion() {
    const marcada = document.querySelector('input[name="tipo-busqueda"]:checked');
    const valor = marcada ? marcada.value : 'salones-libres';
    if (valor === 'salones-libres') resaltarSalonesLibresAhora();
    else resaltarEstructurasPorTipo(valor);
}

function obtenerTiempoCaracas() {
    const ahora = new Date();
    const opciones = { timeZone: 'America/Caracas', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' };
    const formateador = new Intl.DateTimeFormat('es-VE', opciones);
    const partes = formateador.formatToParts(ahora);

    let diaTexto = '', hora = 0, minutos = 0;
    partes.forEach(p => {
        if (p.type === 'weekday') diaTexto = p.value.toLowerCase();
        if (p.type === 'hour') hora = parseInt(p.value, 10);
        if (p.type === 'minute') minutos = parseInt(p.value, 10);
    });

    const equivalenciasDias = {
        'lun': 'LU', 'lun.': 'LU', 'mar': 'MA', 'mar.': 'MA',
        'mié': 'MI', 'mié.': 'MI', 'mie': 'MI', 'jue': 'JU', 'jue.': 'JU',
        'vie': 'VI', 'vie.': 'VI', 'sáb': 'SA', 'sáb.': 'SA', 'sab': 'SA'
    };

    return { diaClave: equivalenciasDias[diaTexto] || 'LU', totalMinutos: hora * 60 + minutos };
}

function parseBloqueAMinutos(bloqueStr) {
    return parseInt(bloqueStr.substring(0, 2), 10) * 60 + parseInt(bloqueStr.substring(2, 4), 10);
}

const BLOQUES_HORARIO = [
    { clave: "0800", inicio: 480 },  { clave: "0850", inicio: 530 },  { clave: "0940", inicio: 580 },
    { clave: "1030", inicio: 630 },  { clave: "1120", inicio: 680 },  { clave: "1210", inicio: 730 },
    { clave: "1300", inicio: 780 },  { clave: "1350", inicio: 830 },  { clave: "1440", inicio: 880 },
    { clave: "1530", inicio: 930 },  { clave: "1620", inicio: 980 },  { clave: "1710", inicio: 1030 },
    { clave: "1800", inicio: 1080 }, { clave: "1850", inicio: 1130 }, { clave: "1940", inicio: 1180 }
];
const DURACION_BLOQUE = 50;

function obtenerBloqueHoraActual() {
    const { totalMinutos } = obtenerTiempoCaracas();
    const bloque = BLOQUES_HORARIO.find(b => totalMinutos >= b.inicio && totalMinutos < b.inicio + DURACION_BLOQUE);
    return bloque ? bloque.clave : null;
}

function horaTexto(minutos) {
    return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

let ocupacionPorSalon = null;
function construirIndiceOcupacion() {
    ocupacionPorSalon = new Map();
    baseDeDatosHorarios.forEach(bloque => {
        const [, , , , dia, hora, salon] = bloque;
        if (!salon) return;
        const clave = `${dia}|${salon.trim().toUpperCase()}`;
        if (!ocupacionPorSalon.has(clave)) ocupacionPorSalon.set(clave, new Set());
        ocupacionPorSalon.get(clave).add(hora);
    });
}

function estadoSalonAhora(idSalon) {
    const claveActual = obtenerBloqueHoraActual();
    if (!claveActual) return null;
    if (!ocupacionPorSalon) construirIndiceOcupacion();

    const { diaClave, totalMinutos } = obtenerTiempoCaracas();
    const ocupados = ocupacionPorSalon.get(`${diaClave}|${idSalon}`) || new Set();
    const libre = !ocupados.has(claveActual);

    let k = BLOQUES_HORARIO.findIndex(b => b.clave === claveActual) + 1;
    while (k < BLOQUES_HORARIO.length && ocupados.has(BLOQUES_HORARIO[k].clave) === !libre) k++;

    let hasta;
    if (k < BLOQUES_HORARIO.length) hasta = BLOQUES_HORARIO[k].inicio;
    else hasta = libre ? null : BLOQUES_HORARIO[BLOQUES_HORARIO.length - 1].inicio + DURACION_BLOQUE;
    return { libre, hasta, minutosRestantes: hasta === null ? Infinity : hasta - totalMinutos };
}

function generarBannerEstado(idSalon) {
    if (!horariosListos) return '';
    const estado = estadoSalonAhora(idSalon);
    if (!estado) return '';
    const base = estado.libre ? 'Libre ahora' : 'Ocupado ahora';
    const texto = estado.hasta === null ? `${base} · el resto del día` : `${base} · hasta las ${horaTexto(estado.hasta)}`;
    return `<div class="estado-salon ${estado.libre ? 'estado-libre' : 'estado-ocupado'}"><span class="estado-punto"></span>${texto}</div>`;
}

function resaltarSalonesLibresAhora() {
    limpiarResaltadoMapa();

    if (!horariosListos) {
        cerrarMenuDrawer();
        avisarHorariosNoDisponibles();
        return;
    }

    if (!obtenerBloqueHoraActual()) {
        mostrarAviso("En este momento estamos fuera del horario de clases en la UC (Caracas / Valencia).");
        cerrarMenuDrawer();
        return;
    }

    ocultarPaneles();
    const selector = document.getElementById('select-duracion');
    const minimo = selector ? parseInt(selector.value, 10) || 0 : 0;

    salonesRegistradosEnMapa.forEach(idSalon => {
        if (estructuraPorId.has(idSalon)) return;
        if (salonesExcluidosSet.has(idSalon)) return;
        const estado = estadoSalonAhora(idSalon);
        if (estado && estado.libre && estado.minutosRestantes >= minimo) marcarSalon(idSalon, 'salon-libre');
    });
    cerrarMenuDrawer();

    if (elementosResaltados.size === 0) {
        mostrarAviso(minimo ? `No hay salones que sigan libres por ${minimo >= 60 ? minimo / 60 + ' h' : minimo + ' min'} o más.` : "No hay salones libres en este momento.");
        return;
    }
    encuadrarElementos(elementosResaltados);
}

function inicializarMenuOpciones() {
    const btnHamburguesa = document.getElementById('btn-hamburguesa');
    const btnCerrarDrawer = document.getElementById('btn-cerrar-drawer');
    const overlay = document.getElementById('overlay-drawer');
    const btnResaltar = document.getElementById('btn-resaltar');

    if (btnHamburguesa) btnHamburguesa.addEventListener('click', () => {
        document.getElementById('panel-opciones').classList.add('activo');
        if (overlay) overlay.classList.add('activo');
        abrirCapaHistorial();
    });
    if (btnCerrarDrawer) btnCerrarDrawer.addEventListener('click', cerrarMenuDrawer);
    if (overlay) overlay.addEventListener('click', cerrarMenuDrawer);
    if (btnResaltar) btnResaltar.addEventListener('click', resaltarSeleccion);
}

function cerrarMenuDrawer() {
    const panel = document.getElementById('panel-opciones');
    const overlay = document.getElementById('overlay-drawer');
    if (panel) panel.classList.remove('activo');
    if (overlay) overlay.classList.remove('activo');
    sincronizarHistorial();
}

const FACTOR_ZOOM_BOTON = 1.5;
const controles = { mas: null, menos: null, inicial: null, max: null, min: null };

function inicializarControlesMapa() {
    controles.mas = document.getElementById('btn-zoom-mas');
    controles.menos = document.getElementById('btn-zoom-menos');
    controles.inicial = document.getElementById('btn-vista-inicial');
    if (!controles.mas) return;
    controles.mas.addEventListener('click', () => zoomConBoton(FACTOR_ZOOM_BOTON));
    controles.menos.addEventListener('click', () => zoomConBoton(1 / FACTOR_ZOOM_BOTON));
    controles.inicial.addEventListener('click', volverAVistaInicial);
}

function actualizarEstadoControles() {
    if (!controles.mas) return;
    const enMax = escala >= escalaMaximaPermitida - 1e-4;
    const enMin = escala <= escalaMinimaPermitida + 1e-4;
    if (enMax !== controles.max) { controles.max = enMax; controles.mas.disabled = enMax; }
    if (enMin !== controles.min) { controles.min = enMin; controles.menos.disabled = enMin; }
    if (controles.inicial.disabled) controles.inicial.disabled = false;
}

function centroDeVista() {
    const area = areaVisibleMapa();
    return { x: (area.x0 + anchoContenedor) / 2, y: altoContenedor / 2 };
}

function zoomConBoton(factor) {
    if (!mapaInicializado) return;
    const base = (animacionVista && escalaObjetivoVista) ? escalaObjetivoVista : escala;
    const destino = limitarEscala(base * factor);
    if (Math.abs(destino - base) < 1e-9) return;
    const c = centroDeVista();
    animarVista(destino, (c.x - transX) / escala, (c.y - transY) / escala, c.x, c.y, ENCUADRE_CONFIG.duracionBotones);
}

function volverAVistaInicial() {
    if (!mapaInicializado) return;
    const v = calcularVistaInicial();
    const c = centroDeVista();
    animarVista(v.escala, v.cx, v.cy, c.x, c.y);
}

let temporizadorAviso = null;

function cerrarAviso() {
    clearTimeout(temporizadorAviso);
    const cont = document.getElementById('avisos');
    if (cont) cont.textContent = '';
}

function mostrarAviso(texto, { tipo = 'info', accion = null, alAccion = null, persistente = false } = {}) {
    const cont = document.getElementById('avisos');
    if (!cont) return;
    cerrarAviso();
    const aviso = document.createElement('div');
    aviso.className = `aviso aviso-${tipo}`;
    const t = document.createElement('span');
    t.className = 'aviso-texto';
    t.textContent = texto;
    aviso.appendChild(t);
    if (accion) {
        const b = document.createElement('button');
        b.className = 'aviso-accion';
        b.textContent = accion;
        b.addEventListener('click', () => { if (alAccion) alAccion(); });
        aviso.appendChild(b);
    }
    const x = document.createElement('button');
    x.className = 'aviso-cerrar';
    x.setAttribute('aria-label', 'Cerrar aviso');
    x.textContent = '×';
    x.addEventListener('click', cerrarAviso);
    aviso.appendChild(x);
    cont.appendChild(aviso);
    if (!persistente && tipo !== 'error') temporizadorAviso = setTimeout(cerrarAviso, 6000);
}

let cargaInicialTerminada = false;

function mostrarCarga() {
    const p = document.getElementById('pantalla-carga');
    if (!p) return;
    p.hidden = false;
    p.classList.remove('error', 'oculta');
    document.getElementById('carga-titulo').textContent = 'Cargando el mapa…';
    document.getElementById('carga-detalle').textContent = '';
    document.getElementById('btn-reintentar-mapa').hidden = true;
}

function ocultarCarga() {
    const p = document.getElementById('pantalla-carga');
    if (!p || p.hidden) return;
    p.classList.add('oculta');
    setTimeout(() => { p.hidden = true; }, 350);
}

function mostrarErrorCarga(error) {
    const p = document.getElementById('pantalla-carga');
    p.hidden = false;
    p.classList.remove('oculta');
    p.classList.add('error');
    document.getElementById('carga-titulo').textContent = 'No se pudo cargar el mapa';
    document.getElementById('carga-detalle').textContent = `${error.message} Revisa tu conexión e inténtalo de nuevo.`;
    document.getElementById('btn-reintentar-mapa').hidden = false;
}

function avisarHorariosNoDisponibles() {
    mostrarAviso('Los horarios no están disponibles, así que no se pueden buscar salones, profesores ni materias.',
        { tipo: 'error', accion: 'Reintentar', alAccion: reintentarDatos });
}

function avisarDatosFaltantes(errHorarios, errEstructuras) {
    if (!errHorarios && !errEstructuras) return;
    const partes = [];
    if (errHorarios) partes.push('los horarios (la búsqueda de salones, profesores y materias no funcionará)');
    if (errEstructuras) partes.push('la lista de lugares (cantinas, baños, escuelas…)');
    const detalle = (errHorarios || errEstructuras).message;
    mostrarAviso(`No se pudieron cargar ${partes.join(' ni ')}. ${detalle}`,
        { tipo: 'error', accion: 'Reintentar', alAccion: reintentarDatos });
}

let intentoCarga = 0;

async function iniciarCarga({ silencioso = false } = {}) {
    const miIntento = ++intentoCarga;
    if (!silencioso) mostrarCarga();
    const aviso = setTimeout(() => {
        const d = document.getElementById('carga-detalle');
        if (miIntento === intentoCarga && d && !silencioso) d.textContent = 'Sigue cargando… la conexión parece lenta.';
    }, 7000);

    const [errSvg, errHorarios, errEstructuras] = await Promise.all([
        mapaCargado ? null : cargarSVGMapa(),
        horariosListos ? null : cargarHorarios(),
        estructurasListas ? null : cargarEstructuras()
    ]);
    clearTimeout(aviso);
    if (miIntento !== intentoCarga) return;

    if (errSvg) { mostrarErrorCarga(errSvg); return; }

    procesarEstructuras();
    procesarSugerencias();
    construirOpcionesBusqueda();
    ocupacionPorSalon = null;
    if (!mapaInicializado && !svgEl) {
        inicializarPanZoom();
        setTimeout(ocultarCarga, 4000);
    }
    cerrarAviso();
    if (datosDesdeCache && !errHorarios && !errEstructuras) {
        const fecha = new Date(datosDesdeCache).toLocaleString('es-VE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        mostrarAviso(navigator.onLine
            ? `La conexión es lenta: se usan los datos guardados (${fecha}).`
            : `Sin conexión: se usan los datos guardados (${fecha}).`, { persistente: true });
    }
    avisarDatosFaltantes(errHorarios, errEstructuras);
}

async function reintentarDatos() {
    mostrarAviso('Reintentando…', { persistente: true });
    await iniciarCarga({ silencioso: true });
    if (horariosListos && estructurasListas) mostrarAviso('Datos cargados correctamente.');
}

const PWA_CONFIG = {
    registrarEnLocal: false
};

function esEntornoLocal() {
    return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}

function esDispositivoMovil() {
    const tactil = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    return tactil || /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

function esAppInstalada() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

async function iniciarPWA() {
    if (!('serviceWorker' in navigator)) return;
    const forzar = new URLSearchParams(location.search).has('sw');

    if (esEntornoLocal() && !PWA_CONFIG.registrarEnLocal && !forzar) {
        (await navigator.serviceWorker.getRegistrations()).forEach(r => r.unregister());
        if (window.caches) (await caches.keys()).filter(k => k.startsWith('geofacing-')).forEach(k => caches.delete(k));
        return;
    }

    const teniaControlador = !!navigator.serviceWorker.controller;
    try {
        const registro = await navigator.serviceWorker.register('./sw.js', { scope: './' });

        const avisarSiHayNueva = () => {
            if (registro.waiting && navigator.serviceWorker.controller) {
                mostrarAviso('Hay una nueva versión de GeoFacing.',
                    { accion: 'Actualizar', alAccion: () => registro.waiting.postMessage('saltar-espera'), persistente: true });
            }
        };
        avisarSiHayNueva();
        registro.addEventListener('updatefound', () => {
            const nuevo = registro.installing;
            if (nuevo) nuevo.addEventListener('statechange', () => { if (nuevo.state === 'installed') avisarSiHayNueva(); });
        });

        let recargando = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!teniaControlador || recargando) return;
            recargando = true;
            location.reload();
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') registro.update().catch(() => {});
        });

        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (error) {
        console.warn('No se pudo activar el modo sin conexión:', error);
    }
}

function inicializarAvisosDeConexion() {
    window.addEventListener('offline', () => {
        if (mapaInicializado) mostrarAviso('Sin conexión. El mapa y los horarios ya cargados siguen disponibles.');
    });
    window.addEventListener('online', () => {
        if (!mapaInicializado) return;
        if (datosDesdeCache) mostrarAviso('Conexión restablecida.', { accion: 'Actualizar datos', alAccion: () => location.reload(), persistente: true });
        else mostrarAviso('Conexión restablecida.');
    });
}

let promptInstalacion = null;

function actualizarSeccionInstalar() {
    const seccion = document.getElementById('seccion-instalar');
    const separador = document.getElementById('sep-instalar');
    const boton = document.getElementById('btn-instalar');
    const texto = document.getElementById('texto-instalar');
    if (!seccion) return;
    let mostrar = false;
    if (!esAppInstalada() && esDispositivoMovil()) {
        if (promptInstalacion) {
            mostrar = true;
            boton.hidden = false;
            texto.textContent = 'Añade GeoFacing a tu pantalla de inicio: se abre como una app y también funciona sin conexión.';
        } else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
            mostrar = true;
            boton.hidden = true;
            texto.textContent = 'En iPhone o iPad: pulsa el botón Compartir y elige «Añadir a pantalla de inicio». Así se abre como una app y funciona sin conexión.';
        }
    }
    seccion.hidden = !mostrar;
    separador.hidden = !mostrar;
}

function inicializarInstalacion() {
    window.addEventListener('beforeinstallprompt', evento => {
        evento.preventDefault();
        promptInstalacion = evento;
        actualizarSeccionInstalar();
    });
    window.addEventListener('appinstalled', () => {
        promptInstalacion = null;
        actualizarSeccionInstalar();
        mostrarAviso('GeoFacing se instaló en tu pantalla de inicio.');
    });
    const boton = document.getElementById('btn-instalar');
    if (boton) boton.addEventListener('click', async () => {
        if (!promptInstalacion) return;
        const peticion = promptInstalacion;
        promptInstalacion = null;
        cerrarMenuDrawer();
        peticion.prompt();
        await peticion.userChoice;
        actualizarSeccionInstalar();
    });
    actualizarSeccionInstalar();
}

document.addEventListener('DOMContentLoaded', () => {
    inicializarBuscador();
    inicializarHojaMovil();
    inicializarMenuOpciones();
    inicializarControlesMapa();
    inicializarInstalacion();
    inicializarAvisosDeConexion();
    window.addEventListener('load', iniciarPWA);
    const btnReintentar = document.getElementById('btn-reintentar-mapa');
    if (btnReintentar) btnReintentar.addEventListener('click', () => iniciarCarga());
    window.addEventListener('online', () => {
        const p = document.getElementById('pantalla-carga');
        if (p && !p.hidden && p.classList.contains('error')) iniciarCarga();
    });
    iniciarCarga();
});