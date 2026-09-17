"use client";

import { useEffect, useRef } from "react";

// Los únicos tres eventos que otorgan «activación de usuario» en los dos
// motores. `touchstart`, `touchmove`, `wheel` y `scroll` NO la otorgan —ni en
// WebKit ni en Chromium—, así que un reintento colgado de ellos se vuelve a
// rechazar exactamente igual. `pointerdown` es el más temprano en Chromium,
// `touchend` el que documenta WebKit, y `click` el comodín que llega en ambos.
const GESTOS = ["pointerdown", "touchend", "click"] as const;

/**
 * Fondo en video del hero (reunión 7-ago), con el arranque forzado desde JS.
 *
 * Por qué existe este componente y no basta el marcado: `autoplay` + `muted` +
 * `playsInline` le piden al navegador UN intento durante el parseo, y nadie
 * comprueba si salió. En móvil ese intento se rechaza por media docena de
 * motivos que NO son la política de Chromium —Samsung Internet con
 * «Reproducción automática: solo Wi-Fi» navegando con datos, WebView in-app con
 * gesto obligatorio, ahorro de batería o de datos de iOS, la pestaña que cargó
 * oculta, la vuelta por BFCache— y todos terminan igual: el poster fijo, para
 * siempre, porque nada vuelve a llamar a `play()`. Escritorio no lo nota porque
 * ahí el primer intento casi siempre triunfa: de ahí el «en móvil no se
 * reproduce» que reportaron Néstor y la clienta.
 *
 * ⚠️ NO hay una rama por navegador, aunque eso fuera lo que se pidió. El código
 * de arranque es idéntico en todos: `play()` y su promesa. Lo que cambia de un
 * navegador a otro es POR QUÉ se rechaza, y eso se atiende reintentando en los
 * momentos en los que ese rechazo pudo caducar. Mirar el user-agent para elegir
 * código sería un error y envejecería mal.
 *
 * ⚠️ Y hay rechazos que NO son nuestros: con el ahorro de batería de iOS, o
 * dentro de un WebView que exige gesto, no existe código que fuerce el
 * arranque. Ahí el poster ES el resultado correcto hasta que el usuario toque
 * la pantalla, y por eso el hero tiene que leerse terminado con la imagen fija.
 */
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;

    // Igual que `rotating-word.tsx`: son 8 s en bucle infinito, o sea
    // movimiento automático de más de 5 s sin control de pausa (WCAG 2.2.2).
    // No basta con no reintentar: hay que apagar también el `autoplay` del
    // marcado, que si no vuelve a dispararse solo en cuanto lleguen los datos.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      v.autoplay = false;
      v.pause();
      return;
    }

    const intentar = () => {
      // Las dos asignaciones, no una. La política lee `muted` en el instante
      // del `play()`, pero el algoritmo de carga de medios lo REINICIA al valor
      // de `defaultMuted` cada vez que recarga el recurso. React solo escribe
      // el atributo al renderizar: si el árbol se recrea en cliente, el
      // elemento se queda con `defaultMuted = false` y el siguiente `load()` lo
      // DESMUTEA — y un autoplay con sonido lo bloquea Chrome sin excepciones.
      v.muted = true;
      v.defaultMuted = true;
      void v.play().catch(() => {});
    };

    const quitar = () => {
      v.removeEventListener("canplay", intentar);
      document.removeEventListener("visibilitychange", intentar);
      window.removeEventListener("pageshow", intentar);
      for (const g of GESTOS) document.removeEventListener(g, intentar, true);
    };

    // ⚠️ Este riesgo lo trae nuestro propio arreglo: en iOS, si la app
    // anfitriona dejó `allowsInlineMediaPlayback` en false, `playsinline` se
    // ignora y el `play()` que dispara el gesto abre el video A PANTALLA
    // COMPLETA. Un fondo decorativo secuestrando la pantalla al primer toque es
    // bastante peor que el poster: se sale y se deja de insistir.
    const rendirse = () => {
      (
        v as HTMLVideoElement & { webkitExitFullscreen?: () => void }
      ).webkitExitFullscreen?.();
      v.pause();
      quitar();
    };

    intentar();
    // El intento del parser ocurre antes de que haya datos, y el navegador no
    // lo repite cuando llegan.
    v.addEventListener("canplay", intentar);
    // Pestaña que cargó en segundo plano, app que vuelve al frente, regreso por
    // BFCache: WebKit pausa y no reanuda solo.
    document.addEventListener("visibilitychange", intentar);
    window.addEventListener("pageshow", intentar);
    // La ÚNICA salida legal cuando el rechazo es de política. No se quitan al
    // primer `playing` a propósito: si iOS vuelve a pausar al salir el elemento
    // de la pantalla, el siguiente toque lo devuelve. Sobre un video ya en
    // marcha `play()` es un no-op que resuelve, así que no cuesta nada.
    for (const g of GESTOS)
      document.addEventListener(g, intentar, { capture: true, passive: true });
    v.addEventListener("webkitbeginfullscreen", rendirse);

    return () => {
      quitar();
      v.removeEventListener("webkitbeginfullscreen", rendirse);
    };
  }, []);

  return (
    <video
      ref={ref}
      className="absolute inset-0 -z-10 size-full object-cover"
      autoPlay
      muted
      loop
      playsInline
      // `auto` y no `metadata`: `preload` es una PISTA, y los modos de ahorro
      // de datos —y los navegadores que bloquean la autoreproducción— la
      // respetan al pie de la letra. Ahí se bajaban solo los 3.747 bytes de la
      // cabecera, así que cuando por fin llegaba el gesto del usuario no había
      // ni un fotograma que pintar. Con el fichero en 353 KB está acotado.
      preload="auto"
      // El JPG que había antes de que esto fuera video: pinta en el primer
      // frame y se queda de fondo definitivo donde el navegador se niegue.
      poster="/img/hero-home-v2.jpg"
      // `src` aquí y no un `<source>` hijo: con el hijo, un fallo al elegir el
      // recurso dispara el `error` en el HIJO y `video.error` se queda en null,
      // o sea que el fallo es inobservable desde cualquier manejador — la regla
      // de oro 11 del CLAUDE.md, pero en el navegador. Y como solo hay un
      // fichero, el hijo tampoco estaba negociando nada.
      src="/video/hero-home-v2.mp4"
      aria-hidden
    />
  );
}
