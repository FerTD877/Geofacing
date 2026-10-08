const VERSION = '2026-10-08-1';

const CACHE_APP = 'geofacing-app-' + VERSION;
const CACHE_DATOS = 'geofacing-datos';
const TIEMPO_RED_MS = 3000;

const ARCHIVOS_APP = [
  'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'logo_geofacing.png', 'favicon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'
];
const ARCHIVOS_DATOS = ['mapageofacing.svg', 'horarios.json', 'estructuras.json'];

async function sellar(respuesta) {
  const cabeceras = new Headers(respuesta.headers);
  cabeceras.set('x-guardado', String(Date.now()));
  return new Response(await respuesta.blob(), { status: respuesta.status, statusText: respuesta.statusText, headers: cabeceras });
}

function marcarDesdeCache(respuesta) {
  const cabeceras = new Headers(respuesta.headers);
  cabeceras.set('x-desde-cache', '1');
  return new Response(respuesta.body, { status: respuesta.status, statusText: respuesta.statusText, headers: cabeceras });
}

async function guardarDato(url) {
  const respuesta = await fetch(new Request(url, { cache: 'reload' }));
  if (respuesta.ok) await (await caches.open(CACHE_DATOS)).put(url, await sellar(respuesta.clone()));
}

self.addEventListener('install', evento => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE_APP);
    await cache.addAll(ARCHIVOS_APP.map(u => new Request(u, { cache: 'reload' })));
    await Promise.all(ARCHIVOS_DATOS.map(u => guardarDato(u).catch(() => {})));
    if (!self.registration.active) self.skipWaiting();
  })());
});

self.addEventListener('activate', evento => {
  evento.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter(n => n.startsWith('geofacing-app-') && n !== CACHE_APP).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', evento => {
  if (evento.data === 'saltar-espera') self.skipWaiting();
});

async function desdeLaApp(peticion) {
  const guardada = await (await caches.open(CACHE_APP)).match(peticion, { ignoreSearch: true });
  return guardada || fetch(peticion);
}

async function redPrimero(evento, peticion, ruta) {
  const cache = await caches.open(CACHE_DATOS);
  const descarga = fetch(peticion.url, { cache: 'no-cache' }).then(async respuesta => {
    if (respuesta.ok) await cache.put(ruta, await sellar(respuesta.clone()));
    return respuesta;
  });
  evento.waitUntil(descarga.catch(() => {}));

  const limite = new Promise(resolver => setTimeout(() => resolver(null), TIEMPO_RED_MS));
  try {
    const rapida = await Promise.race([descarga, limite]);
    if (rapida) return rapida;
  } catch (e) {}

  const guardada = await cache.match(ruta);
  if (guardada) return marcarDesdeCache(guardada);
  return descarga;
}

self.addEventListener('fetch', evento => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  const base = new URL(self.registration.scope).pathname;
  let ruta = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
  if (ruta === '') ruta = 'index.html';

  if (peticion.mode === 'navigate') {
    evento.respondWith(desdeLaApp(new Request('index.html')));
  } else if (ARCHIVOS_DATOS.includes(ruta)) {
    evento.respondWith(redPrimero(evento, peticion, ruta));
  } else if (ARCHIVOS_APP.includes(ruta)) {
    evento.respondWith(desdeLaApp(peticion));
  }
});