// ==========================================
// CONFIGURACIÓN GLOBAL Y PARÁMETROS
// ==========================================
const MODO_PRUEBA = false;
const PROBAR_DIA = "MA";
const PROBAR_BLOQUE = "0940";

// --- CONFIGURACIÓN DE VISTA INICIAL Y LÍMITES ---
// Coordenadas del mapa: píxeles del lienzo del SVG (2000 x 1818), con (0,0) = esquina superior izquierda.
// Tip: con el mapa abierto, ejecuta  vistaActual()  en la consola del navegador para
// leer el centro y el zoom que estás viendo y copiarlos aquí.
const VISTA_INICIAL_CONFIG = {
    zoom: 2,         // 1 = mapa completo (zoom mínimo); 3 = triple; etc.
    enfocarId: null, // id de un elemento del SVG (ej. 'AD4') para iniciar centrado en él; tiene prioridad sobre 'centro'
    centro: { x: 1091, y: 626 }  // zona del BOULEVARD. null = centro del mapa
};

const LIMITES_CONFIG = {
    modoMinimo: 'cubrir', // 'cubrir': nunca hay bordes vacíos (puede recortar un eje)
                          // 'contener': se ve el mapa completo, con márgenes en un eje
    zoomMaximo: 8,        // escala máxima (píxeles de pantalla por unidad del SVG)
    velocidadRueda: 0.004,// sensibilidad del zoom con la rueda / trackpad
    // Los límites son exactamente el viewBox del SVG (el marco negro coincide con él).
    // Recorte opcional extra, en px del lienzo, por si algún día quieres acotar más el mapa.
    recorte: { izq: 0, der: 0, arriba: 0, abajo: 0 }
};

let baseDeDatosHorarios = [];
let listaSugerencias = [];
let salonesRegistradosEnMapa = new Set();
let salonesExcluidosSet = new Set();    
const escuelaPorIdEdificio = new Map();

// Estructuras que no son salones (escuelas, departamentos, cantinas...), definidas en estructuras.json
let estructurasConfig = { tipos: {}, estructuras: [] };
const estructuraPorId = new Map();     // id del elemento SVG -> estructura
const estructuraPorSalon = new Map();  // salón sin elemento propio (dentro de una escuela...) -> estructura

// Dimensiones y transformación del mapa
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

// Gestos (Pointer Events: ratón, táctil y lápiz con el mismo código)
const punteros = new Map();   // pointerId -> {x, y}
let inicioToque = { x: 0, y: 0 };
let huboArrastre = false;
let huboMultitouch = false;
let ultimoPellizco = null;

let salonActivoActual = null;

// Caches para no recorrer el DOM en cada acción
const elementosSalon = new Map();      // id -> elemento SVG
const elementosResaltados = new Set(); // elementos con clase de resaltado activa

// --- 0. CARGA DINÁMICA DEL MAPA SVG (FETCH) ---
async function cargarSVGMapa() {
    const contenedor = document.querySelector('.mapa-placeholder');
    try {
        const respuesta = await fetch('./mapageofacing.svg');
        if (!respuesta.ok) throw new Error(`HTTP Error Status: ${respuesta.status}`);

        contenedor.innerHTML = await respuesta.text();
        const svgElemento = contenedor.querySelector('svg');
        if (svgElemento) svgElemento.id = 'svg1';
        
        registrarSalonesDinamicos();
        console.log(`✅ SVG cargado. Registrados ${salonesRegistradosEnMapa.size} espacios interactivos.`);
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
            el.classList.add('salon'); // la transición CSS solo se aplica a estos nodos
            el.style.cursor = 'pointer';
        }
    });
}

// --- 1. CARGA Y PROCESAMIENTO DE DATOS ---
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

// --- 2. GENERACIÓN DE TABLA Y LEYENDA ---
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

// --- 3. GESTIÓN DE PANELES Y BÚSQUEDA ---
// --- GESTIÓN DE PANELES CON EL BOTÓN "ATRÁS" DEL MÓVIL ---

function abrirPanelResultados(htmlContenido) {
    document.getElementById('contenido-panel').innerHTML = htmlContenido;
    document.getElementById('panel-info').classList.remove('activo');
    const panel = document.getElementById('modulo-resultados');
    
    if (!panel.classList.contains('activo')) {
        history.pushState({ panelAbierto: true }, '');
    }
    panel.classList.add('activo');
    panel.classList.remove('minimizado');
    
    const btn = document.getElementById('btn-minimizar-panel');
    if (btn) {
        btn.textContent = '‹';
        btn.setAttribute('aria-label', 'Ocultar panel');
    }
}

// Interceptamos el evento popstate (cuando el usuario presiona "Atrás" en el celular)
window.addEventListener('popstate', (event) => {
    const panelResultados = document.getElementById('modulo-resultados');
    const panelDrawer = document.getElementById('panel-opciones');
    
    if (panelResultados.classList.contains('activo')) {
        cerrarPanelResultados();
    } else if (panelDrawer && panelDrawer.classList.contains('activo')) {
        cerrarMenuDrawer();
    }
});

// Función para ocultar/mostrar el panel lateralmente (Estilo Google Maps)
function alternarMinimizarPanel() {
    const panel = document.getElementById('modulo-resultados');
    panel.classList.toggle('minimizado');
    
    // Cambia la flecha de dirección según el estado
    const btn = document.getElementById('btn-minimizar-panel');
    if (panel.classList.contains('minimizado')) {
        btn.textContent = '›'; // Apunta hacia afuera para abrir
        btn.setAttribute('aria-label', 'Mostrar panel');
    } else {
        btn.textContent = '‹'; // Apunta hacia adentro para cerrar
        btn.setAttribute('aria-label', 'Ocultar panel');
    }
}

// Oculta los paneles (horario e info de estructura) sin tocar el resaltado del mapa
function ocultarPaneles() {
    document.getElementById('modulo-resultados').classList.remove('activo');
    document.getElementById('panel-info').classList.remove('activo');
    document.getElementById('input-busqueda').value = '';
    salonActivoActual = null;
}

function cerrarPanelResultados() {
    ocultarPaneles();
    limpiarResaltadoMapa();
    // Si hay un estado en el historial creado por el panel, podemos retrocederlo o dejarlo limpio
    if (history.state && history.state.panelAbierto) {
        history.back();
    }
}

function normalizarTextoBusqueda(texto) {
    if (!texto) return '';
    const eq = {'10':'X', '1':'I', '2':'II', '3':'III', '4':'IV', '5':'V', '6':'VI', '7':'VII', '8':'VIII', '9':'IX'};
    return texto.toUpperCase().replace(/\b(10|[1-9])\b/g, (m) => eq[m] || m);
}

function ejecutarBusqueda(texto) {
    const rawInput = (texto || document.getElementById('input-busqueda').value).trim();
    const busqueda = normalizarTextoBusqueda(rawInput);
    
    if (!busqueda) { 
        ocultarSugerencias();
        cerrarPanelResultados(); 
        limpiarResaltadoMapa(); 
        return; 
    }

    // Estructura (escuela, departamento, cantina...): ventana pequeña con el nombre, sin horario
    const estructuraExacta = estructurasConfig.estructuras.find(e => plegar(e.nombre) === plegar(rawInput));
    if (estructuraExacta) {
        mostrarInfoEstructura(estructuraExacta);
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

    // Sin horarios: ¿coincide parcialmente con alguna estructura?
    if (resultados.length === 0) {
        const parciales = estructurasConfig.estructuras.filter(e => plegar(e.nombre).includes(plegar(rawInput)));
        if (parciales.length === 1) { mostrarInfoEstructura(parciales[0]); return; }
        if (parciales.length > 1) { mostrarSugerencias(rawInput); return; }
    }

    ocultarSugerencias();
    resultados.forEach(b => { if (b[6]) salonesAEnfocar.add(b[6].trim().toUpperCase()); });
    abrirPanelResultados(generarTablaHorario(resultados));
    resaltarSalonesEnMapa(Array.from(salonesAEnfocar));
}

// --- Contorno resaltado en una capa superior (evita que los salones vecinos tapen el borde) ---
const SVG_NS = 'http://www.w3.org/2000/svg';
let capaResaltado = null;

function agregarContornoSuperior(el, clase) {
    const svg = document.getElementById('svg1');
    if (!svg || !el.parentNode || !el.parentNode.getCTM) return;
    if (!capaResaltado || !capaResaltado.isConnected) {
        capaResaltado = document.createElementNS(SVG_NS, 'g');
        capaResaltado.setAttribute('pointer-events', 'none'); // los toques pasan al salón original
        svg.appendChild(capaResaltado);
    }
    const ctmPadre = el.parentNode.getCTM();
    const ctmCapa = capaResaltado.getCTM();
    if (!ctmPadre || !ctmCapa) return;

    // Misma posición que el original, aunque sus grupos tengan transformaciones (scale, matrix...)
    const m = ctmCapa.inverse().multiply(ctmPadre);
    const grupo = document.createElementNS(SVG_NS, 'g');
    grupo.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);

    const contorno = el.cloneNode(false); // solo la forma, sin hijos
    contorno.removeAttribute('id');
    contorno.removeAttribute('style');
    contorno.setAttribute('class', clase);
    grupo.appendChild(contorno);
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
        const est = estructuraPorSalon.get(idSalon); // salón dentro de una escuela/departamento sin elemento propio
        if (est) est.ids.forEach(id => marcarSalon(id, 'salon-resaltado'));
        else marcarSalon(idSalon, 'salon-resaltado');
    });
}

function enfocarSalonDesdeTabla(idSalon) {
    if (!idSalon) return;
    resaltarSalonesEnMapa([idSalon.toUpperCase()]);
}

function limpiarResaltadoMapa() {
    elementosResaltados.forEach(el => el.classList.remove('salon-resaltado', 'salon-libre'));
    elementosResaltados.clear();
    if (capaResaltado) capaResaltado.textContent = '';
}

// --- 4. INTERACCIÓN DIRECTA MAPA Y BUSCADOR ---
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
    
    const q = plegar(filtro);          // sin acentos, para estructuras ("cantina 1", "direccion")
    const qRomano = plegar(busqueda);  // con números romanos, para materias
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

// --- 5. ENCUADRE, ZOOM Y PAN/DRAG (Pointer Events + clamping) ---

// Desfase entre el sistema de coordenadas del lienzo original y el área recortada (0 si no hay recorte)
let desfaseX = 0;
let desfaseY = 0;
let bboxOriginal = { w: 0, h: 0 };
let panelCalibrar = null;
let cursorCalibrar = null;

// Los límites son el viewBox original del SVG (no getBBox(), que incluye trazos que sobresalen del marco).
// El SVG de Inkscape usa mm en el viewBox y px en width/height: se trabaja en px (1 unidad = 1 px a escala 1).
function medirSVG() {
    const vb = svgEl.viewBox.baseVal;
    const anchoPx = parseFloat(svgEl.getAttribute('width')) || 2000;
    const altoPx = parseFloat(svgEl.getAttribute('height')) || 1818;
    const vx = vb.x || 0, vy = vb.y || 0;
    const vw = vb.width || anchoPx, vh = vb.height || altoPx;
    const kx = vw / anchoPx;   // unidades del viewBox por px
    const ky = vh / altoPx;
    const r = LIMITES_CONFIG.recorte;

    bboxOriginal = { w: anchoPx, h: altoPx };
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

// Límites herméticos: el mapa nunca deja ver fondo vacío (o se centra si es más chico que la pantalla).
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
        // El SVG aún no tiene transform: 1 unidad = 1 px desde su esquina, así que el rect del elemento ya está en unidades del mapa recortado
        const re = elFoco.getBoundingClientRect();
        const rs = svgEl.getBoundingClientRect();
        c = { x: re.left + re.width / 2 - rs.left, y: re.top + re.height / 2 - rs.top };
    } else if (cfg.centro) {
        c = { x: cfg.centro.x - desfaseX, y: cfg.centro.y - desfaseY };
    }
    transX = anchoContenedor / 2 - c.x * escala;
    transY = altoContenedor / 2 - c.y * escala;
}

// El estado se corrige al instante; el DOM se escribe como máximo una vez por frame.
function aplicarTransformacionSVG() {
    limitarTraslacion();
    if (renderPendiente) return;
    renderPendiente = true;
    requestAnimationFrame(() => {
        renderPendiente = false;
        svgEl.style.transform = `translate(${transX}px, ${transY}px) scale(${escala})`;
        if (panelCalibrar) actualizarPanelCalibrar();
    });
}

// Zoom manteniendo fijo el punto (px, py) de la pantalla. Primero se limita la escala y luego
// se calcula la traslación, así el punto focal y los límites nunca se contradicen.
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
    if (new URLSearchParams(location.search).has('calibrar')) iniciarCalibrador();

    // ResizeObserver: mide el contenedor solo cuando cambia (sin leer el layout en cada frame)
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

    // Rueda / trackpad: zoom exponencial hacia el cursor
    contenedorMapa.addEventListener('wheel', (e) => {
        e.preventDefault();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;        // líneas -> px (Firefox)
        else if (e.deltaMode === 2) dy *= 400;  // páginas -> px
        dy = Math.max(-120, Math.min(120, dy)); // evita saltos bruscos
        const rect = contenedorMapa.getBoundingClientRect();
        zoomHacia(e.clientX - rect.left, e.clientY - rect.top, escala * Math.exp(-dy * LIMITES_CONFIG.velocidadRueda));
    }, { passive: false });

    contenedorMapa.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
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
            // Pellizco incremental: desplaza por el movimiento del centro y escala hacia él
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

// Toque/clic sin arrastre: selecciona un salón o, si fue en vacío, cierra el panel.
function manejarToqueEnMapa(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    // Sube por los ancestros hasta hallar un salón registrado (los paths internos de Inkscape traen ids propios)
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

    // Primero identificamos las escuelas globales (las que tienen múltiples ids o nombres limpios sin "- Edificio")
    const escuelasGlobales = estructurasConfig.estructuras.filter(e => !e.nombre.includes(" - Edificio"));

    estructurasConfig.estructuras.forEach(est => {
        est.ids = (est.ids || []).filter(id => {
            const el = document.getElementById(id);
            if (!el) { console.warn(`⚠️ estructuras.json: no existe el id "${id}" en el SVG (${est.nombre})`); return false; }
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
            
            // Si este edificio pertenece a una escuela con varios edificios, 
            // asociamos su ID al objeto de la escuela global correspondiente para resaltarlos todos juntos al tocarlo.
            const escuelaGlobal = escuelasGlobales.find(g => g.tipo === 'escuela' && g.ids.includes(id) && g.nombre !== est.nombre);
            if (escuelaGlobal) {
                escuelaPorIdEdificio.set(id, escuelaGlobal);
            }
        });

        // Vinculamos los salones específicos a este edificio en particular
        (est.salones || []).forEach(s => estructuraPorSalon.set(String(s).trim().toUpperCase(), est));
    });
}

// Al tocar un elemento directamente en el mapa
function seleccionarSalon(idSalon) {
    const panelActivo = document.getElementById('modulo-resultados').classList.contains('activo') ||
                        document.getElementById('panel-info').classList.contains('activo');
    if (salonActivoActual === idSalon && panelActivo) {
        cerrarPanelResultados();
        return;
    }
    
    salonActivoActual = idSalon;

    // PRIORIDAD 1: Si el ID pertenece a un edificio de una escuela múltiple, 
    // mostramos la escuela global y resaltamos TODOS sus edificios a la vez.
    const escuelaGlobal = escuelaPorIdEdificio.get(idSalon);
    if (escuelaGlobal) {
        mostrarInfoEstructura(escuelaGlobal);
        return;
    }

    // PRIORIDAD 2: Si es una estructura normal (departamento, cantina, decanato, etc.)
    const est = estructuraPorId.get(idSalon);
    if (est) {
        mostrarInfoEstructura(est);
        return;
    }

    // PRIORIDAD 3: Si es un salón suelto, ejecutamos la búsqueda normal
    document.getElementById('input-busqueda').value = idSalon;
    ejecutarBusqueda(idSalon);
}

// Vista actual en coordenadas del SVG original (las mismas que usan 'centro' y 'recorte')
function calcularVistaActual() {
    return {
        zoom: +(escala / escalaMinimaPermitida).toFixed(2),
        centro: {
            x: Math.round((anchoContenedor / 2 - transX) / escala + desfaseX),
            y: Math.round((altoContenedor / 2 - transY) / escala + desfaseY)
        }
    };
}
window.vistaActual = () => {
    const r = calcularVistaActual();
    console.log(JSON.stringify(r));
    return r;
};

// Modo calibración: abre la página con  index.html?calibrar
function iniciarCalibrador() {
    panelCalibrar = document.createElement('div');
    panelCalibrar.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2000;background:rgba(0,0,0,.82);color:#fff;font:12px/1.5 monospace;padding:8px 12px;border-radius:8px;pointer-events:none;white-space:pre';
    document.body.appendChild(panelCalibrar);
    contenedorMapa.addEventListener('pointermove', (e) => { cursorCalibrar = { x: e.clientX, y: e.clientY }; actualizarPanelCalibrar(); });
}

function actualizarPanelCalibrar() {
    const v = calcularVistaActual();
    let lineaCursor = 'cursor: (mueve el mouse sobre el mapa)';
    if (cursorCalibrar) {
        const rect = contenedorMapa.getBoundingClientRect();
        const mx = Math.round((cursorCalibrar.x - rect.left - transX) / escala + desfaseX);
        const my = Math.round((cursorCalibrar.y - rect.top - transY) / escala + desfaseY);
        lineaCursor = `cursor: x=${mx}  y=${my}`;
    }
    panelCalibrar.textContent =
        `${lineaCursor}\n` +
        `vista:  zoom: ${v.zoom}, centro: { x: ${v.centro.x}, y: ${v.centro.y} }\n` +
        `SVG original: ${Math.round(bboxOriginal.w)} x ${Math.round(bboxOriginal.h)}  |  recortado: ${Math.round(anchoRealSVG)} x ${Math.round(altoRealSVG)}`;
}

// --- 5.5 ESTRUCTURAS (escuelas, departamentos, cantinas, baños...) ---
// Quita acentos y pasa a mayúsculas para comparar textos ("Dirección" == "direccion")
function plegar(texto) {
    return (texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

async function cargarEstructuras() {
    try {
        const respuesta = await fetch('./estructuras.json');
        if (!respuesta.ok) throw new Error(`HTTP Error Status: ${respuesta.status}`);
        const datos = await respuesta.json();
        
        estructurasConfig = { tipos: datos.tipos || {}, estructuras: datos.estructuras || [] };
        
        // Aquí es donde integramos la lectura de los salones excluidos del JSON
        salonesExcluidosSet = new Set((datos.salonesExcluidosLibres || []).map(s => s.trim().toUpperCase()));
    } catch (error) {
        console.error("❌ Error al cargar estructuras.json:", error);
    }
}

// Ventana pequeña con el nombre de la estructura + resaltado en el mapa
function mostrarInfoEstructura(est) {
    ocultarSugerencias();
    ocultarPaneles();
    limpiarResaltadoMapa();
    document.getElementById('input-busqueda').value = est.nombre;
    est.ids.forEach(id => marcarSalon(id, 'salon-resaltado'));
    const tipo = estructurasConfig.tipos[est.tipo] || {};
    document.getElementById('info-tipo').textContent = tipo.etiqueta || 'Lugar';
    document.getElementById('info-nombre').textContent = est.nombre;
    document.getElementById('panel-info').classList.add('activo');
}

// Resalta todas las estructuras de un tipo (cantinas, baños, papelerías...)
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
}

// Opciones del menú: salones libres + los tipos marcados como "buscable" en estructuras.json
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

// --- 6. CÁLCULO DE HORA CARACAS (UTC-4) Y SALONES DISPONIBLES ---
function obtenerTiempoCaracas() {
    if (MODO_PRUEBA) return { diaClave: PROBAR_DIA, totalMinutos: parseBloqueAMinutos(PROBAR_BLOQUE) };

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
    if (MODO_PRUEBA) return PROBAR_BLOQUE;
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
        if (salonesExcluidosSet.has(idSalon)) return; // Salta los excluidos
        
        if (!salonesOcupados.has(idSalon)) marcarSalon(idSalon, 'salon-libre');
    });
    cerrarMenuDrawer();
}

// --- 7. MENÚ HAMBURGUESA / DRAWER ---
function inicializarMenuOpciones() {
    const btnHamburguesa = document.getElementById('btn-hamburguesa');
    const btnCerrarDrawer = document.getElementById('btn-cerrar-drawer');
    const overlay = document.getElementById('overlay-drawer');
    const btnResaltar = document.getElementById('btn-resaltar');

    if (btnHamburguesa) btnHamburguesa.addEventListener('click', () => { document.getElementById('panel-opciones').classList.add('activo'); if (overlay) overlay.classList.add('activo'); });
    if (btnCerrarDrawer) btnCerrarDrawer.addEventListener('click', cerrarMenuDrawer);
    if (overlay) overlay.addEventListener('click', cerrarMenuDrawer);
    if (btnResaltar) btnResaltar.addEventListener('click', resaltarSeleccion);
}

function cerrarMenuDrawer() {
    const panel = document.getElementById('panel-opciones');
    const overlay = document.getElementById('overlay-drawer');
    if (panel) panel.classList.remove('activo');
    if (overlay) overlay.classList.remove('activo');
}

// --- 8. INICIALIZACIÓN GENERAL ---
document.addEventListener('DOMContentLoaded', async () => {
    inicializarBuscador();
    inicializarMenuOpciones();
    await Promise.all([cargarSVGMapa(), cargarHorarios(), cargarEstructuras()]); // en paralelo
    procesarEstructuras();
    procesarSugerencias();
    construirOpcionesBusqueda();
    inicializarPanZoom();
});