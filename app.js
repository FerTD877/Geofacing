const VISTA_INICIAL_CONFIG = {
    zoom: 2,
    enfocarId: null,
    centro: { x: 1091, y: 626 }
};

const ENCUADRE_CONFIG = {
    margen: 70,
    zoomBusqueda: 2,
    zoomMaximo: 3,
    duracion: 600
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

async function cargarSVGMapa() {
    const contenedor = document.querySelector('.mapa-placeholder');
    try {
        const respuesta = await fetch('./mapageofacing.svg');
        if (!respuesta.ok) throw new Error(`HTTP Error Status: ${respuesta.status}`);

        contenedor.innerHTML = await respuesta.text();
        const svgElemento = contenedor.querySelector('svg');
        if (svgElemento) svgElemento.id = 'svg1';
        
        registrarSalonesDinamicos();
    } catch (error) {
        console.error("❌ Error al cargar mapageofacing.svg via fetch:", error);
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
        const respuesta = await fetch('./horarios.json');
        if (!respuesta.ok) throw new Error(`HTTP Error Status: ${respuesta.status}`);
        baseDeDatosHorarios = await respuesta.json();
    } catch (error) {
        console.error("❌ Error al cargar horarios.json:", error);
    }
}

function procesarSugerencias() {
    const mapa = new Map();
    estructurasConfig.estructuras.forEach(est => {
        const tipo = estructurasConfig.tipos[est.tipo] || {};
        mapa.set(`EST_${est.nombre}`, { texto: est.nombre, tipo: 'Estructura', subtitulo: tipo.etiqueta || 'Lugar', icono: tipo.icono || '📍', valorBusqueda: est.nombre });
    });
    baseDeDatosHorarios.forEach(bloque => {
        const [codigo, materia, seccion, profesor, dia, hora, salon] = bloque;
        
        if (profesor && !mapa.has(`PROF_${profesor}`)) mapa.set(`PROF_${profesor}`, { texto: profesor, tipo: 'Profesor', icono: '👨‍🏫', valorBusqueda: profesor });
        if (salon && !mapa.has(`SALON_${salon}`)) mapa.set(`SALON_${salon}`, { texto: salon, tipo: 'Salón', icono: '📍', valorBusqueda: salon });
        
        const claveMateria = materia || codigo;
        if (claveMateria && !mapa.has(`MAT_${codigo}_${materia}`)) {
            const etiquetaUnificada = codigo && materia ? `${codigo} - ${materia}` : claveMateria;
            mapa.set(`MAT_${codigo}_${materia}`, { texto: etiquetaUnificada, tipo: 'Materia', icono: '📚', valorBusqueda: etiquetaUnificada, codigo });
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
    restablecerBotonMinimizar();
    abrirCapaHistorial();
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
    restablecerBotonMinimizar();
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

function ejecutarBusqueda(texto, opciones = {}) {
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

    const itemCoincidente = listaSugerencias.find(item => item.texto.toUpperCase() === busqueda || item.valorBusqueda.toUpperCase() === busqueda);
    let resultados = [];
    let salonesAEnfocar = new Set();

    if (itemCoincidente && itemCoincidente.tipo === 'Materia') {
        resultados = baseDeDatosHorarios.filter(b => b[0] === itemCoincidente.codigo);
    } else {
        const materiasCoincidentes = itemCoincidente ? [] : listaSugerencias.filter(item => item.tipo === 'Materia' && item.texto.toUpperCase().includes(busqueda));
        if (materiasCoincidentes.length > 1) {
            mostrarSugerencias(rawInput);
            return;
        }
        resultados = baseDeDatosHorarios.filter(b => {
            const [codigo, materia, seccion, profesor, dia, hora, salon] = b;
            const textoUnificadoMateria = codigo && materia ? `${codigo} - ${materia}` : (materia || codigo || '');
            return (salon && salon.toUpperCase() === busqueda) ||
                   (codigo && codigo.toUpperCase() === busqueda) ||
                   (profesor && profesor.toUpperCase().includes(busqueda)) ||
                   (materia && materia.toUpperCase().includes(busqueda)) ||
                   (textoUnificadoMateria.toUpperCase() === busqueda);
        });
    }

    if (resultados.length === 0) {
        const parciales = estructurasConfig.estructuras.filter(e => plegar(e.nombre).includes(plegar(rawInput)));
        const nombresDistintos = new Set(parciales.map(e => plegar(e.nombre)));
        if (nombresDistintos.size === 1) { mostrarInfoEstructura(parciales, opciones); return; }
        if (nombresDistintos.size > 1) { mostrarSugerencias(rawInput); return; }
    }

    ocultarSugerencias();
    resultados.forEach(b => { if (b[6]) salonesAEnfocar.add(b[6].trim().toUpperCase()); });
    abrirPanelResultados(generarTablaHorario(resultados));
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
    document.getElementById('input-busqueda').addEventListener('keypress', (e) => { if (e.key === 'Enter') ejecutarBusqueda(); });
    document.getElementById('btn-cerrar-panel').addEventListener('click', cerrarPanelResultados);
    document.getElementById('btn-cerrar-info').addEventListener('click', cerrarPanelResultados);
}

function mostrarSugerencias(filtro) {
    const box = document.getElementById('sugerencias-box');
    const busqueda = normalizarTextoBusqueda(filtro.trim());
    if (!busqueda) { box.classList.add('oculto'); return; }
    
    const q = plegar(filtro);
    const qRomano = plegar(busqueda);
    const coinc = listaSugerencias.filter(item =>
        item.tipo === 'Estructura' ? plegar(item.texto).includes(q) : plegar(item.texto).includes(qRomano)
    ).slice(0, 6);
    if (coinc.length === 0) { box.classList.add('oculto'); return; }
    
    box.innerHTML = coinc.map(i => `<div class="sugerencia-item" data-valor="${i.valorBusqueda}"><span class="sugerencia-icono">${i.icono}</span><div class="sugerencia-texto"><span class="sugerencia-titulo">${i.texto}</span><span class="sugerencia-subtitulo">${i.subtitulo || i.tipo}</span></div></div>`).join('');
    box.classList.remove('oculto');
    
    document.querySelectorAll('.sugerencia-item').forEach(el => el.addEventListener('click', () => { 
        const valor = el.getAttribute('data-valor');
        document.getElementById('input-busqueda').value = valor; 
        ejecutarBusqueda(valor); 
    }));
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

    svgEl.setAttribute('viewBox', `${vx + r.izq * kx} ${vy + r.arriba * ky} ${anchoRealSVG * kx} ${altoRealSVG * ky}`);
    svgEl.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.style.width = anchoRealSVG + 'px';
    svgEl.style.height = altoRealSVG + 'px';
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

function establecerVistaInicial() {
    escala = limitarEscala(escalaMinimaPermitida * Math.max(1, VISTA_INICIAL_CONFIG.zoom));
    let c = { x: anchoRealSVG / 2, y: altoRealSVG / 2 };
    const cfg = VISTA_INICIAL_CONFIG;
    const elFoco = cfg.enfocarId && document.getElementById(cfg.enfocarId);
    if (elFoco) {
        const re = elFoco.getBoundingClientRect();
        const rs = svgEl.getBoundingClientRect();
        c = { x: re.left + re.width / 2 - rs.left, y: re.top + re.height / 2 - rs.top };
    } else if (cfg.centro) {
        c = { x: cfg.centro.x - desfaseX, y: cfg.centro.y - desfaseY };
    }
    transX = anchoContenedor / 2 - c.x * escala;
    transY = altoContenedor / 2 - c.y * escala;
}

function renderizarAhora() {
    svgEl.style.transform = `translate(${transX}px, ${transY}px) scale(${escala})`;
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
    ejecutarBusqueda(idSalon, { encuadrar: false });
}

let animacionVista = null;

function cancelarAnimacionVista() {
    if (animacionVista) { cancelAnimationFrame(animacionVista); animacionVista = null; }
}

function animarVista(escalaFin, cx, cy, ax, ay) {
    cancelarAnimacionVista();
    escalaFin = limitarEscala(escalaFin);
    const e0 = escala;
    const c0x = (ax - transX) / e0;
    const c0y = (ay - transY) / e0;
    const sinAnimacion = ENCUADRE_CONFIG.duracion <= 0 ||
        (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const t0 = performance.now();

    const paso = (ahora) => {
        const t = sinAnimacion ? 1 : Math.min(1, (ahora - t0) / ENCUADRE_CONFIG.duracion);
        const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        escala = e0 * Math.pow(escalaFin / e0, k);
        transX = ax - (c0x + (cx - c0x) * k) * escala;
        transY = ay - (c0y + (cy - c0y) * k) * escala;
        limitarTraslacion();
        renderizarAhora();
        animacionVista = t < 1 ? requestAnimationFrame(paso) : null;
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

const Historial = { sentinela: false, ignorar: 0, pendiente: null };

function hayCapasAbiertas() {
    return ['panel-opciones', 'modulo-resultados', 'panel-info']
        .some(id => document.getElementById(id).classList.contains('activo'));
}

function abrirCapaHistorial() {
    if (Historial.sentinela) return;
    history.pushState({ geofacing: true }, '');
    Historial.sentinela = true;
}

function sincronizarHistorial() {
    clearTimeout(Historial.pendiente);
    Historial.pendiente = setTimeout(() => {
        if (Historial.sentinela && !hayCapasAbiertas()) {
            Historial.sentinela = false;
            Historial.ignorar++;
            history.back();
        }
    }, 0);
}

window.addEventListener('popstate', () => {
    if (Historial.ignorar > 0) { Historial.ignorar--; return; }
    Historial.sentinela = false;
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
        const respuesta = await fetch('./estructuras.json');
        if (!respuesta.ok) throw new Error(`HTTP Error Status: ${respuesta.status}`);
        const datos = await respuesta.json();
        
        estructurasConfig = { tipos: datos.tipos || {}, estructuras: datos.estructuras || [] };
        salonesExcluidosSet = new Set((datos.salonesExcluidosLibres || []).map(s => s.trim().toUpperCase()));
    } catch (error) {
        console.error("❌ Error al cargar estructuras.json:", error);
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
        alert(`No hay ${(tipo.plural || tipo.etiqueta || 'lugares').toLowerCase()} registrados en el mapa.`);
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

function obtenerBloqueHoraActual() {
    const { totalMinutos } = obtenerTiempoCaracas();
    const bloques = [
        { clave: "0800", inicio: 480, fin: 529 }, { clave: "0850", inicio: 530, fin: 579 },
        { clave: "0940", inicio: 580, fin: 629 }, { clave: "1030", inicio: 630, fin: 679 },
        { clave: "1120", inicio: 680, fin: 729 }, { clave: "1210", inicio: 730, fin: 779 },
        { clave: "1300", inicio: 780, fin: 829 }, { clave: "1350", inicio: 830, fin: 879 },
        { clave: "1440", inicio: 880, fin: 929 }, { clave: "1530", inicio: 930, fin: 979 },
        { clave: "1620", inicio: 980, fin: 1029 }, { clave: "1710", inicio: 1030, fin: 1079 },
        { clave: "1800", inicio: 1080, fin: 1129 }, { clave: "1850", inicio: 1130, fin: 1179 },
        { clave: "1940", inicio: 1180, fin: 1230 }
    ];
    const bloqueEncontrado = bloques.find(b => totalMinutos >= b.inicio && totalMinutos <= b.fin);
    return bloqueEncontrado ? bloqueEncontrado.clave : null;
}

function resaltarSalonesLibresAhora() {
    const horaBloqueActual = obtenerBloqueHoraActual();
    limpiarResaltadoMapa();

    if (!horaBloqueActual) {
        alert("En este momento estamos fuera del horario de clases en la UC (Caracas / Valencia).");
        cerrarMenuDrawer();
        return;
    }

    ocultarPaneles();
    const { diaClave } = obtenerTiempoCaracas();
    const salonesOcupados = new Set();
    baseDeDatosHorarios.forEach(bloque => {
        const [, , , , dia, hora, salon] = bloque;
        if (dia === diaClave && hora === horaBloqueActual && salon) {
            salonesOcupados.add(salon.trim().toUpperCase());
        }
    });

    salonesRegistradosEnMapa.forEach(idSalon => {
        if (estructuraPorId.has(idSalon)) return; 
        if (salonesExcluidosSet.has(idSalon)) return;
        
        if (!salonesOcupados.has(idSalon)) marcarSalon(idSalon, 'salon-libre');
    });
    cerrarMenuDrawer();
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

document.addEventListener('DOMContentLoaded', async () => {
    inicializarBuscador();
    inicializarMenuOpciones();
    await Promise.all([cargarSVGMapa(), cargarHorarios(), cargarEstructuras()]);
    procesarEstructuras();
    procesarSugerencias();
    construirOpcionesBusqueda();
    inicializarPanZoom();
});