# Panel del tutor v2 — Cambios aprobados (8-sep-2026)

> Lista cerrada de ajustes aprobados por Emilio Faim sobre el panel del tutor de Enséñame Ya, pantalla por pantalla, para que desarrollo (Jose Mora) los aplique con un agente de Claude y el resultado quede **igual** a la referencia visual. La referencia es el artifact «Panel del tutor v2» (vista **Propuesta**) y sus capturas en `capturas/`. Donde este documento y el `page.tsx` de esta carpeta difieran, **manda este documento**.

| Campo | Valor |
| :-- | :-- |
| **Referencia visual** | https://claude.ai/code/artifact/48c16a23-b9b9-4d8c-b358-d78ea2fd8f7e (enlace directo por pantalla: `?pantalla=<id>&vista=propuesta`) · copia local `revision-7-pantallas.html` · PNG en `capturas/` |
| **Base de código** | `main` al 8-sep-2026 (165 migraciones). Las vistas «Hoy» del artifact reproducen ese estado |
| **Origen** | Doc 27 (diagnóstico) + 40 comentarios de Emilio del 8-sep, todos aplicados en el artifact (v25) |
| **Alcance** | Solo frontend del panel del tutor (`src/app/(app)/tutor/…`, `src/app/(app)/account/…`, `src/components/layout/app-sidebar.tsx`). Sin migraciones salvo lo marcado como DECISIÓN PENDIENTE |
| **Ids de pantalla** | `dashboard` · `mentorias` · `disponibilidad` · `reservas` · `payouts` · `verificacion` · `cuenta` |

---

## 0 · Reglas globales (aplican a todas las pantallas)

**G-01 · Menú lateral** (`app-sidebar.tsx`, `TUTOR_ITEMS`)
- Entradas y orden: **Dashboard · Mis mentorías · Disponibilidad · Reservas · Mis pagos · Mi cuenta**. Se renombran `Payouts → Mis pagos` y `Cuenta → Mi cuenta`. **«Verificación» conserva su nombre** y pasa a ser subnivel de «Mi cuenta» (deja de ser entrada de primer nivel).
- Iconos: los mismos de hoy (lucide `LayoutDashboard`, `BookOpen`, `CalendarPlus`, `Ticket`, `Wallet`, `ShieldCheck` para Verificación dentro del subnivel si se quiere, `User`).
- **Subniveles siempre abiertos**, en todas las pantallas del panel. Cada subnivel es un ancla al bloque de su pantalla:
  - Dashboard → Por atender · Próximas sesiones · Tus ingresos
  - Mis mentorías → Activas · Pausadas · Borradores (filtros)
  - Disponibilidad → Horario semanal · Calendario · Excepciones
  - Reservas → Por aceptar · Próximas · Pasadas (filtros)
  - Mis pagos → Saldo · Cómo cobras · Mis cuentas · Movimientos
  - Mi cuenta → Verificación · Información personal · Contraseña · Avisos
- Estilo del subnivel: indentado con línea izquierda de 1 px `#e0e0e0`, filas de 26 px, 12 px, color `#595959`; activo en azul `brand` 600 sin fondo.

**G-02 · Contadores («notificaciones»)**
- **De categoría (externo):** círculo **20 px**, fondo `#fe6a00`, texto blanco **700**, Poppins 11 px, alineado a la derecha de la fila. Estilo idéntico a la campana (`notifications-bell.tsx`).
- **De subnivel (interno):** círculo **18 px**, fondo `#e6edf5`, texto `#4d4d4d` 600, 10.5 px, alineado a la derecha **con 16 px de margen derecho** para separarlo del de categoría. Menos atención que el externo, a propósito.
- **El contador de la categoría es la suma de los de sus subniveles.** Con el estado de ejemplo: Dashboard 4 (Por atender) · Mis mentorías 4 (2+1+1) · Reservas 2 · Mis pagos 1 (Mis cuentas: método sin elegir) · Mi cuenta 1 (Verificación: documento rechazado). Disponibilidad sin contador.
- Dígitos **centrados** en el círculo (`line-height` = alto, `text-align:center`; con `place-items` Poppins los asienta bajos).
- `PanelShell` ya acepta `badges` indexados por `href` (lo usa admin); reutilizarlo y extenderlo a subniveles.

**G-03 · Contadores de los chips de filtro** (Reservas, Mis mentorías): círculo 20 px **gris** (`#ebebeb` / `#6b6b6b`), 600. **Solo «Por aceptar» va en naranja** (es el único que pide acción del tutor). En el chip activo, blanco translúcido (`rgba(255,255,255,.28)`) con texto blanco.

**G-04 · Botones-icono en filas de sesión/reserva** (34–36 px, con `aria-label` y `title`):
- Chat: el `ChatDeReservaButton` actual.
- **Ojo «Ver reserva»** (lucide `Eye`, outline): en toda sesión/reserva futura y pasada. Sustituye al «Ver» de texto.
- **Videocámara «Entrar a la sala»** (lucide `Video`, botón primario naranja 36×36): **solo** cuando `roomOpen(s)`. Sustituye al «Ir a la sala / Entrar a sala» de texto.
- Orden en la fila: chat · ojo · videocámara. En listas con píldora de estado (Reservas) usar **rejilla fija** `estado(104 px) · cámara(36) · ojo(36)` y dejar el hueco de la cámara vacío cuando no hay sala, para que la píldora no se desplace entre filas.

**G-05 · Cuenta atrás de aceptación** (RN-38): píldora solo con reloj y tiempo, `⏱ 3 h 10 m` (negra; **roja** bajo 12 h). Sin «Vence en». La explicación va en `title`/tooltip: «Tiempo que te queda para aceptar o rechazar. Si vence, la reserva se cancela y el alumno recibe el 100 %.»

**G-06 · Usuaria de ejemplo** en capturas y seeds de prueba: **Diana**.

**G-07 · Vistas «Hoy»** del artifact reflejan `main`; no son objetivo. Lo que no aparece en esta lista se conserva como está.

---

## 1 · Dashboard — `src/app/(app)/tutor/page.tsx`

Orden final de la pantalla:

1. **Cabecera:** «Hola, Diana» + subtítulo dinámico «Hoy tienes 1 clase y 4 cosas esperan tu respuesta.» (singular/plural real; sin el texto fijo actual).
2. **Aviso de cuenta** solo si `approval_status ≠ approved` (en revisión / rechazado / suspendido). **Se elimina el banner «¡Bienvenido!… hasta 5 sesiones»** y su consulta.
3. **Checklist «Lo que falta para que te reserven»**, **a ancho completo**, encima de las dos columnas. Cinco pasos con estado y enlace al subnivel del menú donde se completa: Foto de perfil · Documentos de identidad · Horario semanal · Primera mentoría publicada · Cuenta de cobro («Configurar en Mis pagos →»). Contador «4 de 5 listos». Se oculta al completarse. Fuentes: `avatar_path`, `identity_verification_status`, `count(availability_rules)`, `count(products where status='active')`, `payout_country` (proxy).
4. **Dos columnas: izquierda 300 px · derecha 1fr.**
   - **Izquierda (sticky al hacer scroll): «Tus ingresos»**, la tarjeta con más peso (borde 1.5 px `#19191f`): rótulo «Disponible para cobrar», **cifra 34 px**, «Se paga el **lunes 14 de septiembre**», filas «En camino (se libera en 7 días)», «Ganado este mes» *(ver DP-3)*, «Tu nivel» = **solo la etiqueta «Nivel 1»** (el reparto en tooltip). Si hay saldo y no hay cuenta de cobro: caja ámbar «Configura tu cuenta de cobro para poder recibir tu pago.» + botón «Configurar cuenta de cobro». Enlace «Ver el detalle de mis pagos →». Debajo, la tarjeta de soporte (`SupportCard`) con botón secundario «Escribir a soporte».
   - **Derecha:** **«Por atender (N)»** (borde azul 1.5 px) con todo lo que espera al tutor y su acción en la fila: reserva nueva (cuenta atrás G-05 + Aceptar/Rechazar con `AcceptRejectButtons`), mensaje sin leer (Responder), clase por cerrar (Marcar como dictada). Enlace «Ver todo». Debajo, **«Próximas sesiones»** (hasta 5; «Horas en tu zona: America/Bogotá» bajo el título; botones G-04; «Ver agenda» → `/tutor/reservas?f=proximas`; estado vacío con «Publicar una mentoría» / «Revisar horario»).
5. **Se eliminan:** los 4 tiles, «Reservas recientes», «Accesos rápidos» (N-08) y el párrafo del nivel (N-16).

Consultas: mismas 8 del `Promise.all` actual, sustituyendo las tres que sobran (reservas recientes, count de pendientes, count de completadas) por pendientes con `count:"exact"`, `availability_rules` (head) y `products` activos (head). Mensajes sin leer y clases por cerrar: **DP-1**.

---

## 2 · Mis mentorías — `src/app/(app)/tutor/products/page.tsx`

1. Subtítulo con datos: «4 mentorías · 2 se venden ahora mismo».
2. **Chips de filtro** con contador (G-03): Todas · Activas · Pausadas · Borradores (estado en la URL como en Reservas).
3. **Se conserva la tarjeta con aire** (miniatura 56 px, título, «Resultado: …», precio · duración · categorías). Cambios dentro de la tarjeta:
   - Línea de chips: **«Aceptación manual» / «Automática»** (gris) + píldora de estado + «12 reservas en 30 días» *(DP-2)*.
   - **Acciones como tres iconos** a la derecha, sin separador ni botones de texto: **ojo** (ver como alumno → ficha pública), **lápiz** (editar), **«···»** (pausar/reanudar, archivar, duplicar). `aria-label` en los tres.
   - Aviso ámbar en la tarjeta cuando la mentoría **no tiene franja de horario asignada**: «⚠ Sin franja de horario asignada · Asignar» (abre la edición en el paso de horarios). Inversa de `buildUsedBy`.

---

## 3 · Disponibilidad — `src/app/(app)/tutor/availability/*`

1. Cabecera: «Abres **9 h** a la semana en **America/Bogotá (GMT−5)** · ahora son las 14:32 · cambiar zona» (enlace a Mi cuenta).
2. **Horario semanal**: se conserva el bloque de hoy (día + chips). Cambios: el chip lleva **solo la franja** (`09:00–12:00 ✕`, sin «→ 3 clases · 2 mentorías»); cada día muestra sus **horas abiertas** a la izquierda de los chips («5 h», «—» si cerrado); botón **«+ Añadir franja»** en la cabecera de la tarjeta que abre el formulario (Desde/Hasta) en vez de tenerlo siempre desplegado. «Copiar a otros días» sigue en el formulario. **Sin notas de ayuda** adicionales. El aviso «se solapa» se queda como hoy.
3. **Calendario**: se conserva **tal cual** (solo disponibilidad y excepciones). No se añade agenda del día ni clases reservadas.
4. **Excepciones**: **lista primero**, botón «+ Añadir» en la cabecera abre el formulario (Fecha, Tipo, Desde, Hasta, Motivo).

---

## 4 · Reservas — `src/app/(app)/tutor/reservas/page.tsx`

1. Subtítulo de una línea: «Todas las reservas de tus mentorías, en tu zona horaria.» (las reglas de 24 h y aceptación automática salen de la cabecera).
2. Chips con contador (G-03): **Todas · Por aceptar · Próximas · Completadas · Canceladas** («Próximas» sustituye a «Confirmadas»; incluye `confirmed`/`in_progress` con sesión futura).
3. **Bloque «Por aceptar (N)»** (borde azul): una fila por reserva —título · alumno · fecha · monto— con cuenta atrás (G-05) y Aceptar/Rechazar. Aviso fijo bajo el título: «Si no respondes en 24 h, la reserva se cancela y el alumno recibe el 100 %.» Sustituye a las tarjetas TU07b (que repetían estado tres veces).
4. **El resto en dos grupos** con rótulo: **PRÓXIMAS** (por fecha de sesión) y **PASADAS** (más reciente primero). Fila: título · alumno · fecha · monto en una línea; acciones con rejilla fija G-04 (estado · cámara · ojo).
5. **Sin identificador de reserva en la lista** (va en el detalle y en Mis pagos). En las pasadas, la **valoración recibida en una tercera línea** («★★★★★ Valoración del alumno»), **sin el comentario**.

---

## 5 · Mis pagos — `src/app/(app)/tutor/payouts/page.tsx` (+ `metodos-de-cobro.tsx`)

**Se conserva la diagramación del 8-sep** (tiles · Cómo cobras · métodos · Movimientos). Ajustes:

1. **Aviso superior** (solo si hay saldo disponible y ningún método preferido): «Tienes $ 112,50 listos y aún no elegiste tu método preferido» / «El pago del lunes 14 saldrá “por decidir” hasta que elijas uno.» + botón «Elegir método» (ancla a Mis cuentas). Cubre H-01.
2. **Tiles**: solo rótulo y monto, **sin texto debajo**. En «Disponible para retirar», el retiro es el **círculo azul con flecha →** al lado del monto (el icono del tile «Saldo disponible» del dashboard actual), `aria-label` «Retirar ahora», con confirmación.
3. **«Cómo cobras»**: rótulos **País de pago · Frecuencia · Método preferido · Tu nivel**. País con «Cambiar» (lleva a la zona horaria en Mi cuenta); **sin** texto «según tu zona horaria». Frecuencia: «Cada lunes». Nivel como **escalera de tres** píldoras («Nivel 1 › Nivel 2 › Nivel 3», la actual en azul, las demás gris) con el reparto de cada una en `title`; **sin** texto de ayuda. Nombres de nivel: **AB-06** (provisionales).
4. **«Mis cuentas»** (antes «Cómo quieres cobrar»; mismo nombre que el subnivel del menú). Subtítulo: «Conecta las que quieras; la estrella marca la predeterminada.» Por método: logo, nombre, píldoras «Completo / Sin conectar» y «Automático / Lo envía una persona», línea de detalle. Acciones: **«Conectar» / «Configurar»** si falta; si está conectada, **estrella** (icono, `aria-label` «Marcar como predeterminada»; vacía = disponible, rellena = predeterminada, una sola) + **«Editar»**. **Se elimina el radio** de la izquierda; el preferido se lee en «Cómo cobras» (`tutor_payout_preferences.method`).
5. **Movimientos**: tabla actual + columna **«Vía · destino»** (riel + cuenta enmascarada) y columna **«Reservas»** con desplegable de las reservas incluidas (`payout_items`). Cubre N-27.

---

## 6 · Verificación — `src/app/(app)/tutor/verification/*`

Se conserva el proceso actual (estado · expediente · cuatro pasos desplegables · Guardar borrador / Guardar y enviar a revisión). Ajustes:

1. **«Tu expediente de tutor» deja de ser una tarjeta** (parecía un quinto paso) y pasa a **encabezado de sección**: título 18 px 700, subtítulo «Cuatro bloques. Complétalos y envíalos juntos: así lo revisamos de una vez.», píldora «2 de 4 listos» a la derecha, y los cuatro pasos agrupados debajo (línea izquierda 2 px `#e0e0e0`).
2. **Motivo del rechazo visible** en la línea de resumen del paso 2, en rojo, sin desplegar (p. ej. «Documento de identidad rechazado: la foto está cortada por abajo. Sube las dos caras completas.»). Dentro, «Subir de nuevo».
3. Cabecera: título **«Verificación»**, subtítulo «Lo que ven los alumnos y lo que revisa el equipo antes de aprobarte.», botón **«Ver mi ficha pública ↗»** (`/tutors/[id]`).
4. Menú: entrada como subnivel de «Mi cuenta» (G-01).

---

## 7 · Mi cuenta — `src/app/(app)/account/*`

1. Título «Mi cuenta», subtítulo «Tus datos, tu acceso y los avisos que recibes.»
2. Dos columnas: **izquierda «Información personal»** con la **foto (avatar + «Cambiar foto») encima del nombre**, Nombre, Correo («El correo no se puede cambiar aquí.»), Zona horaria con ayuda «Ahora son las 14:32 en tu zona. Afecta a tu horario, a las horas de tus clases, a los correos que te enviamos y a tu país de pago.», «Guardar cambios». **Derecha: «Contraseña»** y debajo **«Avisos por correo»** *(DP-4)*.
3. **Se elimina la tarjeta «Foto de perfil»** suelta (la foto vive en Información personal; el paso 1 de Verificación la muestra y enlaza aquí).
4. **A ancho completo, apiladas y en este orden: «Sesión»** (como hoy, con «Cerrar sesión») y **«Eliminar mi cuenta»**, que antes del botón lista los bloqueos («tienes 2 clases confirmadas y $ 157,50 sin pagar…») y deja el botón inactivo hasta que no quede nada *(DP-5)*.

---

## 8 · Decisiones pendientes (no implementar sin respuesta)

| ID | Pregunta | Afecta |
| :-- | :-- | :-- |
| **DP-1** | Qué tipos entran en «Por atender» además de reservas: mensajes sin leer (`messages`), clases vencidas sin `completed` (`sessions`), documentos rechazados. Y de qué consultas salen | Dashboard |
| **DP-2** | Ventana de «reservas en 30 días» (30 d / total) y si se enseña valoración media por mentoría | Mis mentorías |
| **DP-3** | «Ganado este mes» necesita el bruto: `tutor_balance` solo devuelve netos (Doc 25 H-06) | Dashboard · Mis pagos |
| **DP-4** | Qué avisos por correo son opcionales; requiere columna de preferencias (NTF-xx) | Mi cuenta |
| **DP-5** | Eliminar cuenta con saldo o clases: ¿se bloquea hasta el último pago o se permite y se paga después? (N-17) | Mi cuenta |
| **DP-6** | ¿Se permite un país de pago distinto al de la zona horaria? Hoy `20260908130000` lo deduce | Mis pagos · Mi cuenta |
| **AB-06** | Nombres de los tres niveles (hoy «Nivel 1/2/3») | Mis pagos · Dashboard |

---

## 9 · Cómo entregar

Un PR por pantalla, en este orden: menú (G-01/G-02) → Dashboard → Reservas → Mis pagos → Mis mentorías → Disponibilidad → Verificación → Mi cuenta. Cada PR con captura de la pantalla junto a la de `capturas/` para comparar. Nada de esta lista requiere migración; lo que la requiera está en §8.
