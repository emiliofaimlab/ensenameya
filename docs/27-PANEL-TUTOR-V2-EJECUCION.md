# DOC 27b — Panel del tutor v2: cómo se aplicó

> **Qué es esto.** El registro de ejecución del paquete que aprobó Emilio Faim el 8-sep-2026. La
> especificación vive al lado, en `docs/27-PANEL-TUTOR-V2-CAMBIOS-APROBADOS.md`, y **manda**: este
> documento no la repite, cuenta **qué se hizo, con qué medida y dónde hubo que apartarse de ella y
> por qué**. Es el documento que hay que leer antes de tocar el panel del tutor otra vez.

| Campo | Valor |
| :-- | :-- |
| **Especificación** | `docs/27-PANEL-TUTOR-V2-CAMBIOS-APROBADOS.md` (Emilio Faim, 8-sep-2026) |
| **Referencia visual** | Las capturas `<pantalla>-propuesta.png` del paquete original. ⚠️ **No están en el repo**: son 4 MB de PNG y el repo no es un almacén de imágenes. Viven en el zip `27-panel-tutor-v2.zip` que mandó el jefe |
| **Fecha de ejecución** | 2026-09-09 |
| **Alcance** | Solo frontend: `src/app/(app)/tutor/…`, `src/app/(app)/account/…`, el menú y sus piezas. **Ninguna migración** |
| **Reglas que siguen mandando** | Doc 24 §24.2 (R1 escritorio intacto · R2 no borrar funcionalidad · R3 el cliente gana al Figma · R4 «mentoría») |

---

## 27b.0 · Las reglas globales (§0), que son la base de todo lo demás

Se hicieron **primero y una sola vez**, porque de ellas dependen las siete pantallas y porque el
propio encargo lo pedía así («componentes reutilizables, no copias por pantalla»).

| Regla | Dónde vive | Qué hace |
| :-- | :-- | :-- |
| **G-01 · menú** | `components/layout/app-sidebar.tsx` | Seis destinos: Dashboard · Mis mentorías · Disponibilidad · Reservas · **Mis pagos** · **Mi cuenta**. «Verificación» deja de ser primer nivel y cuelga de «Mi cuenta». Cada sección tiene subniveles **siempre abiertos** |
| **G-02 · contadores** | `lib/tutor/sidebar-badges.ts` + `TutorShell` | Números reales, indexados por el `href` del subnivel. La categoría **suma** los de sus hijos, así que el menú no puede contradecirse a sí mismo |
| **G-03/G-04/G-05** | `components/layout/panel-controls.tsx` | El contador (20/18 px), el botón-icono de 36 px con `aria-label` obligatorio y la cuenta atrás «⏱ 3 h 10 m», roja bajo 12 h |
| **La cuenta atrás compartida** | `lib/booking.ts` → `aceptaAntesDe()` | Era `deadline()` dentro de la pantalla de reservas; ahora la usan también el dashboard y cualquier pantalla que enseñe una reserva por aceptar |

Medido con la cuenta de Valentina Ríos, en `/tutor/reservas`:

```
Dashboard 2      | Por atender 2 · Próximas sesiones · Tus ingresos
Mis mentorías 3  | Activas 3 · Pausadas · Borradores
Disponibilidad   | Horario semanal · Calendario · Excepciones
Reservas 2       | Por aceptar 2 · Próximas · Pasadas
Mis pagos 1      | Saldo · Cómo cobras · Mis cuentas 1 · Movimientos
Mi cuenta        | Verificación · Información personal · Contraseña · Avisos
```

Y en `/tutor/verification` se marcan a la vez **«Mi cuenta» y «Verificación»**, que es lo que hace
que mover la entrada a un subnivel no pierda el rastro de dónde estás.

### Tres decisiones de ejecución que la especificación no cubría

1. **Los subniveles solo se pintan de 768 en adelante.** El paquete los quiere siempre abiertos, y en
   la columna lo están. Por debajo el menú es la tira de una línea que Jose pidió el 9-sep (ver
   `docs/25` §25.1 ter): meter ahí un segundo nivel sería volver a las tres filas que se acababan de
   quitar. Comprobado a 390: seis destinos en una fila de 40 px y **cero subniveles**.
2. **`panel-controls.tsx` es un fichero aparte**, y no parte de `panel-shell.tsx`, porque el menú
   necesita el contador y `panel-shell` ya importa el menú: juntarlos es un ciclo de imports.
3. **El contador de una categoría es la suma de sus hijos**, no un número propio. Así el menú no
   puede decir «Mis pagos 3» y enseñar dentro un solo 1.

### ⚠️ Un efecto colateral que hay que aceptar a sabiendas: el menú del admin

`app-sidebar.tsx` lo comparten los tres paneles, así que el contador nuevo se aplica también al de
**admin**, cuyos badges eran **azules de 18 px** y ahora son **naranjas de 20** (medido en
`/admin`: Tutores 15, Alertas 40, Reportes 3). Nadie pidió tocar ese panel.

Se deja así por tres razones, pero queda escrito por si el cliente prefiere lo contrario:

1. G-02 fija el contador «idéntico a la campana», y la campana es exactamente `bg-primary` con texto
   blanco. El paquete incluye `app-sidebar.tsx` en su alcance.
2. Dos estilos de contador en el mismo producto, uno por panel, es una divergencia que nadie
   defendería si la viera junta.
3. El azul de antes era `--brand`, que en este diseño es el color de **enlace y marca**. Un badge de
   «trabajo pendiente» pintado del color de los enlaces era el error, no la corrección.

**Lo que cuesta:** el blanco sobre el naranja de marca da **2,89:1** y el azul anterior daba 3,8:1,
así que en contraste este cambio empeora. Los dos incumplen AA para texto pequeño; es la misma deuda
de marca que ya está anotada en `docs/25` §25.3 y que solo se cierra decidiendo el par de color con
el cliente. El resto del panel no pierde nada: los subniveles del admin no existen (`ADMIN_ITEMS` no
declara `children`), así que su menú es el de siempre con otro color de badge.

---

## 27b.1 · Lo que la especificación pide y el dato no permite

Esto es lo que hay que llevar de vuelta a Emilio. No son omisiones: son puntos donde el documento se
apoya en algo que no existe o que ya no es cierto.

| Qué dice el documento | Qué pasa de verdad | Qué se hizo |
| :-- | :-- | :-- |
| El paso «Cuenta de cobro» del checklist sale de `payout_country` («proxy») | Desde la migración del 8-sep ese país **se deduce de la zona horaria**, así que TODOS los tutores tienen uno. Con ese proxy el paso saldría siempre completado, que es justo lo contrario de lo que el checklist quiere decir | Se mira la cuenta de cobro de verdad, con una consulta más |
| **DP-1** · qué entra en «Por atender» además de las reservas | Sin decidir | Se cuentan **solo las reservas por aceptar**, y el menú y la pantalla dicen el mismo número. Los mensajes sin leer y las clases por cerrar quedan con un `TODO` que cita DP-1 |
| **DP-2** · ventana de «N reservas en 30 días» | Sin decidir | `TODO` citando DP-2 |
| **DP-3** · «Ganado este mes» | `tutor_balance` solo devuelve netos; el bruto no existe | `TODO` citando DP-3 |
| **DP-4** · qué avisos por correo son opcionales | Necesita una columna de preferencias que no existe | Se pinta la lista de avisos, pero **los interruptores no guardan nada** y así se dice |
| **DP-5** · eliminar cuenta con saldo o clases | Sin decidir | `TODO` citando DP-5 |
| **DP-6** · país de pago distinto al de la zona horaria | Sin decidir | `TODO` citando DP-6 |
| **AB-06** · nombres de los tres niveles | Sin decidir | Se queda «Nivel 1/2/3». No se inventa ninguno |

---

## 27b.2 · El hueco de datos que había que tapar antes de poder mirar nada

**En dev no existía ni una sola reserva `pending_acceptance`**: 81 completadas, 72 canceladas, 3
confirmadas y nada más. O sea que el bloque más importante del paquete —«Por aceptar» de Reservas y
«Por atender» del dashboard— se estaba construyendo contra una lista vacía, y con él la cuenta atrás
de las 24 h, los contadores del menú y el aviso NTF-07.

Lo repone `supabase/seed/dev-reservas-por-aceptar.sql`, que es idempotente:

```bash
npx supabase db query --linked --file supabase/seed/dev-reservas-por-aceptar.sql
```

Dos detalles del fichero que conviene no deshacer:

- Una de las dos reservas nace con **21 horas de antigüedad** a propósito: es la única forma de ver
  la píldora **roja** de G-05, que salta por debajo de 12 h.
- **No crea fila en `payments`**, y no es un olvido. La interfaz solo necesita título, alumno, fecha
  e importe, y una fila de pago movería el saldo del tutor justo en la pantalla de «Mis pagos».

⚠️ Y la causa de fondo: `dev-poblar.sql` ya avisaba de esto y repartía `auto_accept_bookings` para
evitarlo, pero hoy las tres mentorías de Valentina estaban en automático. Si algún día se vuelve a
sembrar dev entero, ese reparto hay que conservarlo.

---

## 27b.3 · Cómo se verificó

Todo está **medido en el navegador**, no leído del código: posición y tamaño de cada caja, estilos
aplicados, ausencia de scroll horizontal, y los estados alternativos (tutor pendiente de aprobación,
pantalla vacía). El ancho de referencia es **1280**, que es el de las capturas, y se comprueba además
que **768 y 390** no se rompen.

Tres trampas del entorno, medidas, que hay que conocer para repetirlo:

- **La app no hidrata fuera de `localhost`.** Next 16 bloquea el desarrollo desde otros orígenes, y
  el síntoma engaña: la página se pinta pero React nunca engancha. Para trabajar con sesión sin tocar
  la del navegador principal, la vía que funciona son los **subdominios**: `http://qa2.localhost:3000`.
- **Con el panel del navegador oculto no hay capturas ni clics**, y las transiciones CSS se congelan
  (leer un color a medio camino da un valor que no es ni el de antes ni el de después). Se mide por
  DOM y se inyecta `* { transition: none }` antes de leer colores.
- **La emulación de tamaño no siempre se aplica.** Para medir a un ancho exacto, un **iframe** de ese
  ancho es fiable donde el emulador no lo es. Así se cazó, por ejemplo, que el menú del panel sacaba
  la página a 549 px en una pantalla de 390.

---

## 27b.4 · Lo que el paquete toca sin decirlo: el asistente de alta

El alcance dice «solo el panel del tutor», pero **dos de sus pantallas comparten componente con el
asistente de alta** (`tutor/onboarding`), que no está en el paquete y que Verónica había dado por
bueno en su revisión del 3-sep («bien todo el proceso, fácil registrarse»):

| Componente | Lo usa | Qué le llega del paquete |
| :-- | :-- | :-- |
| `tutor/verification/verification-form.tsx` | La pantalla de Verificación **y el último paso del asistente** | §6.1 convierte la tarjeta «Tu expediente» en encabezado de sección con línea de agrupación |
| `tutor/availability/availability-manager.tsx` | La pantalla de Disponibilidad **y el paso 4 del asistente** | §3.2 quita los «+» por fila y sube «Abres 9 h a la semana» a una cabecera **que el asistente no tiene** |

No es un fallo de nadie: los agentes lo detectaron y lo dijeron, que es lo que había que hacer. Pero
significa que **el asistente hay que mirarlo aunque no esté en la lista**, y con una cuenta nueva:
que un tutor no pueda añadir su primera franja horaria sería un fallo mucho más caro que cualquier
detalle de maquetación del panel.

## 27b.5 · Errores de la especificación que se corrigieron sobre la marcha

Además del proxy `payout_country` de §27b.1:

- **El aviso «Sin franja de horario asignada» NO es la inversa literal de `buildUsedBy`** (§2.3).
  Cero filas en `product_availability_rules` no significa «esta mentoría no tiene horario»: significa
  el modo «toda mi disponibilidad», que es el normal. Aplicado al pie de la letra, el aviso ámbar
  habría salido en las tres tarjetas diciendo una falsedad.
- **«Ver mi ficha pública»** (§6.3) lleva a una ruta que devuelve 404 mientras el tutor no esté
  aprobado — y esa pantalla la miran sobre todo los que **aún no lo están**. Queda anotado como
  interpretación a confirmar con Emilio.

## 27b.6 · Las peticiones «este fichero no es mío»

Cada revisor devuelve, aparte de sus hallazgos, lo que habría que tocar **fuera de su pantalla**.
Nadie las recoge por su cuenta —el agente que las escribe no puede aplicarlas y el de al lado no
las lee—, así que se barren aquí. Es el mismo agujero que en el lote de Verónica dejó sin aplicar
siete arreglos, uno de ellos justo el fallo que ella había reportado.

| Petición | De quién | Qué se hizo |
| :-- | :-- | :-- |
| `PanelIconButton` tiene que saber pintarse como `<button>` y como `<Link>` | Dashboard, Reservas y Mis mentorías, por separado | **Aplicado**: prop `asChild` con `Slot.Root`, el mismo patrón que `components/ui/button.tsx` |
| Tarjeta de soporte: botón secundario «Escribir a soporte» y texto corto (§1.4) | Dashboard | **Aplicado** en `support-card.tsx`, para los dos paneles |
| Ancla `#horarios` en el formulario de mentoría (§2.3) | Mis mentorías | **Aplicado**: `id="horarios"` + `scroll-mt-24` |
| Rótulos de la fila de Stripe: «Editar» / «Configurar» / «Conectar con Stripe» (§5.4) | Mis pagos | **Aplicado** solo en modo compacto |
| Rótulo de la fila de PayPal: «Editar» en vez de «Cambiar cuenta» (§5.4) | Mis pagos | **Aplicado** solo en modo compacto |
| Quitar la pista «JPG, PNG o WebP · máx. 5 MB» bajo «Cambiar foto» (§7) | Mi cuenta | **NO se aplica** — ver abajo |
| Contraste de las píldoras de estado (§1) | Dashboard | **Aplicado y ampliado**: fallaban **cinco de seis**, no dos |
| `Info@ensenameya.com` en minúscula | Dashboard | **NO se aplica** — es el buzón del §18/§39 del contrato; se pregunta, no se corrige |
| Dos `aria-current="page"` a la vez en el menú (§6) | Verificación | **Aplicado** en `app-sidebar.tsx`; medido después: uno por pantalla |
| Subir el borde de los botones `outline` a #949494 (1.4.11) | Verificación | **NO se aplica** — repinta todos los botones de la app; es decisión de diseño |
| El contador de «Mis cuentas» prometía una acción que no existía (§5) | Mis pagos | **Aplicado** en `sidebar-badges.ts`: ahora lleva el saldo |

### Y un hueco que no pidió nadie: tres pantallas con el menú mudo

`TutorShell` resuelve los contadores por las diez pantallas del tutor. Pero **`/account`, `/pagos` y
`/referidos` no usan ese shell** —su menú depende de la cookie `ey-panel`, no de la ruta— así que
pintaban el mismo menú del tutor **sin un solo número**. Se nota justo donde peor: «Mi cuenta →
Verificación» lleva su propio contador (un documento rechazado), y esa entrada es la de la pantalla
en la que estás.

Se cierra en `lib/auth/panel-items.ts`, con la regla «el menú que se pinta trae sus contadores» en
un solo sitio: `panelMenu()` devuelve el par y `panelItems()` **deja de exportarse**. Con las dos
puertas abiertas, la cuarta pantalla compartida vuelve a elegir la que no trae números y nadie se
entera. **El menú del admin tenía el mismo hueco** en esas mismas tres pantallas y se cierra con la
misma línea.

### El contador naranja que no se podía bajar

Medido con la tutora de pruebas: el menú decía **«Mis pagos, 1 pendiente»** —naranja, que por G-02
significa «esto pide acción»— y al llegar a «Mis cuentas» la pantalla renderizaba **cero estrellas**.
La estrella solo se puede pulsar en una cuenta completa, y ella no tiene ninguna. Un tutor de un país
sin cobertura no lo bajaría **nunca**, que es exactamente lo que prohíbe la regla 1 de ese fichero:
un número que no baja enseña a ignorar todos los demás.

El contador pasa a llevar la condición del propio aviso H-01 —«solo si hay saldo disponible y ningún
método preferido», §5.1— que es la regla 2: **el criterio lo pone la pantalla**. Comprobado contra
los datos de dev en los dos sentidos, que es lo que faltaba:

| Tutor | Saldo | Preferido | Contador |
| :-- | --: | :-- | :-- |
| sofia.marin | 137,25 | ninguno | **1** |
| mateo.herrera | 108,75 | stripe | 0 |
| lucia.ferrer | 83,25 | paypal | 0 |
| val.rios | 0 | ninguno | 0 |

Lo que se pierde —el empujón al tutor que aún no ha conectado nada— no se pierde: vive en la caja
ámbar «Configura tu cuenta de cobro» del dashboard, que lo dice con palabras y enlaza al sitio.

⚠️ **Cuesta una consulta más** (`tutor_balance`) en un helper que corre en las diez pantallas del
tutor. Está memoizado por petición y en la pantalla de pagos se comparte con la que ya hacía, así que
donde de verdad se paga es en las otras nueve. Se aceptó a cambio de que el número no mienta.

### El menú declaraba dos «página actual»

Medido en `/tutor/verification`: el menú devolvía **dos** enlaces con `aria-current="page"`, «Mi
cuenta» y «Verificación». La categoría se anunciaba como la página actual aunque su enlace
(`/account`) lleve a otra pantalla, así que un lector de pantalla leía dos páginas actuales seguidas
y ofrecía como «la actual» un enlace que te saca de donde estás (4.1.2). Le pasa a **cualquier
categoría cuyos hijos sean rutas** y no anclas, o sea a «Mi cuenta» hoy y a la siguiente que se
añada.

Se corrige solo lo que se **anuncia**: el resaltado visual de la categoría se queda, porque ahí sí
es cierto —dice dónde estás dentro del menú—, y lo que se quita es el `aria-current`. Comprobado
después en las cuatro pantallas: exactamente uno por pantalla, y el correcto.

⚠️ **Lo que NO se ha tocado: el borde de los botones `outline`.** Es `#e0e0e0` sobre el fondo del
panel `#f9fafc`, o sea **1,26:1** contra los 3:1 que pide 1.4.11 para el límite de un componente. El
hallazgo es correcto y está medido, pero ese borde es el mismo gris de las tarjetas del Figma y
subirlo repinta **todos** los botones `outline` de la aplicación. Es una decisión de Diana y Emilio,
no un arreglo de esta pantalla.

### Las píldoras de estado fallaban casi todas

El revisor del dashboard midió las dos que su pantalla estrena («Listo» y «Nivel 1»). Al mirar la
constante entera —`PILL_TONE`, en `panel-shell.tsx`— fallaban **cinco de los seis tonos**: verde
3,52:1, azul 3,18:1, ámbar 3,55:1, rojo 4,40:1 y neutro 4,47:1, contra los 4,5:1 que le tocan a un
texto de 12 px. Solo el gris pasaba.

Los dos últimos son los que enseñan la trampa: **sobre blanco los dos aprueban**. Es el fondo de
color de la propia píldora el que se come la diferencia, y medir contra el fondo de la página es
justo el error que los dejó entrar. Se oscurecieron los cinco conservando el tono; la tabla con el
antes y el después está en el comentario de la constante.

⚠️ **La deuda del azul ya tiene su recambio escrito, y eso cambia la conversación.** `globals.css`
declara `--brand-foreground: #036fda`, que sobre blanco da **4,9:1** y aprueba. O sea que el arreglo
no es inventar un azul: es **usar el token que ya existe** allí donde el azul es TEXTO. Lo que lo
convierte en decisión y no en un `sed` son los números: `text-brand` sale **168 veces** en `src/`, y
no todas son texto —hay iconos sobre fondo `brand-muted` y `hover:text-brand` en chips— así que
cambiarlas a ciegas rompe casos que hoy están bien. Es un barrido propio, con su repaso, y no cabe
dentro de este paquete.

⚠️ **`text-brand` (#0080ff) sigue igual en el resto del sitio.** Aquí solo deja de usarse **sobre
el fondo azul claro de la píldora**. Que el azul de marca no llegue a 4,5:1 sobre blanco es deuda de
marca y se decide con Emilio, no dentro de este paquete.

### Por qué el `asChild` no era cosmética

Tres revisores lo pidieron sin hablar entre ellos, y cada uno por un motivo distinto que se arregla
con la misma pieza:

- El `<a>` a pelo **recarga la página entera** al navegar dentro de la app, mientras el botón de
  texto de la misma fila —que sí era `<Link>`— no lo hacía. La misma fila navegaba de dos maneras.
- Lo que **no navega** (abrir el chat, desplegar el «···») acababa siendo un `<a>` sin `href`: no lo
  alcanza el tabulador y el lector de pantalla no lo anuncia como botón (2.1.1 y 4.1.2). Por eso
  `chat-button.tsx` tenía una **copia a mano** de las clases, con su motivo escrito al lado.

### La pista del formato de la foto se queda

La captura de «Mi cuenta» no la dibuja, y es la única diferencia que quedaba con ella. Aun así se
conserva, y la decisión es a sabiendas:

- **No está en la lista aprobada.** Se dedujo de un recorte, y el recorte termina justo ahí. La
  regla del lote (G-07) es que lo que la lista no menciona se conserva.
- **Es la única instrucción del campo** (WCAG 3.3.2). Sin ella el tutor se entera del límite de
  5 MB cuando el fichero ya ha fallado, y el aviso de error es peor sitio para una regla que la
  etiqueta de al lado.
- **El componente lo montan cuatro pantallas**, tres de ellas del alta. Un prop para apagar la pista
  en una sola habría que explicarlo en las otras tres.

Si Emilio quiere la pista fuera, se quita: es un `hint={null}` y está anotado. Pero no se quita
adivinándolo de una captura.

## 27b.7 · Estado por pantalla

Cada pantalla pasó por tres manos distintas: **implementación** contra el documento y la captura,
**revisión** que intentaba refutarla punto por punto con medidas del navegador, y **corrección** de
lo que la revisión sostuvo. Las tres son agentes separados, y el revisor no podía editar nada.

«Cumplidos» son los puntos que la revisión dio por buenos **antes** de la corrección: es la nota del
primer intento, no el estado final. Lo que quedaba se arregló después, salvo lo que se lista abajo.

| § | Pantalla | Cumplidos en la 1.ª pasada | Mayores | Menores | Corrección |
| :-- | :-- | :-- | --: | --: | :-- |
| 1 | Dashboard (`/tutor`) | 13/17 | 5 | 7 | 3 ficheros |
| 2 | Mis mentorías (`/tutor/products`) | 9/12 | 5 | 11 | 2 ficheros |
| 3 | Disponibilidad (`/tutor/availability`) | 15/16 | 4 | 7 | 3 ficheros |
| 4 | Reservas (`/tutor/reservas`) | 19/21 | 3 | 9 | 2 ficheros |
| 5 | Mis pagos (`/tutor/payouts`) | 14/18 | 4 | 9 | 4 ficheros |
| 6 | Verificación (`/tutor/verification`) | 10/11 | 2 | 8 | 2 ficheros |
| 7 | Mi cuenta (`/account`) | 13/14 | 1 | 6 | 1 fichero |

**109 puntos verificados uno a uno, 93 buenos al primer intento.** Ninguno de los 21 agentes falló.

### Lo que NO está y no es un descuido

- **Los siete puntos de §27b.8**, que esperan respuesta de Emilio. Todos con su `TODO` en el sitio.
- **El borde de los botones `outline`** (1,26:1). Es correcto el hallazgo y repinta la app entera.
- **La deuda del azul de marca** (`text-brand`, 168 usos). Tiene recambio escrito y es un barrido
  aparte.
- **La pista del formato de la foto**, que se conserva a propósito (arriba, §27b.6).

### Lo que faltaba por ver, y se vio

Los agentes anotaron —en vez de darlo por bueno— todo lo que no pudieron mirar renderizado, porque
la única sesión que tenían era la de una tutora **aprobada, con datos**. Al cerrar el lote entré con
una cuenta de tutora **pendiente y vacía** (`qa.mobile.pendiente.2026-09-08`) y quedaron cubiertos:

- ✅ **El aviso de cuenta en revisión.** Píldora «En revisión» y el texto «Publicar mentorías se
  habilita cuando se apruebe tu perfil. Mientras tanto puedes dejar todo listo aquí abajo.»
- ✅ **El checklist en su peor caso**: «0 de 5 listos», los cinco pasos con su enlace.
- ✅ **Los estados vacíos** de las cinco pantallas: sesiones, reservas, mentorías, movimientos y
  cuentas de cobro. Ninguna devuelve error y las cinco frases dicen qué hacer.
- ✅ **El asistente de alta, que es lo que más preocupaba** (§27b.4). Los pasos 2, 3, 4 y 5 cargan
  sin un error. El paso 4 monta `AvailabilityManager` con los rótulos nuevos —«Día», «Desde»,
  «Hasta», cada uno con su `<label>` asociado, que era el fallo que la revisión de §3 encontró— y su
  estado vacío dice «Todavía no tienes horarios. Añade al menos uno para que puedan reservarte.»
- ✅ **La duda que la revisión de §6 dejó abierta**: cómo cae el expediente dentro del
  `WizardShell bare maxWidth={760}`. Medido en un iframe de 1280: **760 px justos**, sus cuatro
  pasos como lista y **cero scroll horizontal**, también a 390.

### Lo que sigue sin poderse ver, y por qué

- **Un documento rechazado, con y sin motivo del admin.** En `dev` no hay **ni un solo** rechazo, así
  que la frase que se escribió para ese caso no la ha visto nadie.
- **Los estados «rechazada» y «suspendida»** de la cuenta. Solo existe «pendiente» y «aprobada».
- **El botón «Editar»** de las filas de cobro: ninguna cuenta de `dev` tiene un método conectado de
  verdad, y conectarlo es entrar en Stripe o PayPal con credenciales reales.

Los tres se cierran sembrando `dev` o mirándolos en la preview con una cuenta de verdad. No son
cosas que un agente pueda medir.

## 27b.8 · Las siete respuestas que faltan (para Emilio)

Ninguna bloquea el merge: **todas están implementadas de la manera que hoy es cierta**, con un
`TODO` en el sitio exacto donde iría el cambio. Se listan porque son decisiones de producto, no
huecos de código, y porque el paquete las da por resueltas.

| # | Qué pide el paquete | Por qué no se puede hoy | Dónde está el hueco |
| :-- | :-- | :-- | :-- |
| **DP-1** | «Por atender» con tres tipos de fila: reserva por aceptar, **mensaje sin leer** y **clase por cerrar** | `messages` no marca leído **por participante**: no hay de dónde sacar «sin leer para el tutor». Y «clase vencida sin cerrar» necesita que alguien fije la ventana | `tutor/page.tsx`, en el bloque «Por atender» |
| **DP-2** | «12 reservas en 30 días» en la tarjeta de mentoría | Sin decidir si la ventana son 30 días o el histórico, y si además va la valoración media | `tutor/products/page.tsx`, en la línea de chips |
| **DP-3** | «Ganado este mes» como cuarta cifra | `tutor_balance` devuelve **netos por moneda y sin ventana temporal**. El bruto del mes no existe sin una función nueva | `tutor/page.tsx`, en la `dl` de «Tus ingresos» |
| **DP-4** | Interruptores Sí/No por tipo de aviso | **No hay dónde guardar la respuesta**: `notifications` es la cola de lo enviado, no una tabla de preferencias | `account-form.tsx`, sobre `AVISOS_*` |
| **DP-5** | Bloquear el borrado de cuenta también por **dinero pendiente** | Contradice a `20260831160000`, que separa a propósito lo que bloquea (clases vendidas sin dar) de lo que no (saldo, retiro, reembolso: desactivan y un job borra) | `account-form.tsx`, bloque «Eliminar mi cuenta» |
| **DP-6** | «Cambiar» el país de pago desde Mis pagos | El país **se deduce de la zona horaria** desde `20260908130000`. Un selector aparte rutearía dinero a un riel que no llega a ese país | `tutor/payouts/page.tsx`, junto a «País de pago» |
| **AB-06** | «Tu nivel» como escalera de tres píldoras con su reparto | La RLS del tutor (`tutor_tiers_select_own`) **solo le deja leer su propia fila**: los % de los niveles 2 y 3 no se pueden leer, y escribirlos a mano en el TSX es teclear cifras de dinero | `tutor/payouts/page.tsx` y `tutor/page.tsx` |

⚠️ **Un aviso sobre los nombres de nivel.** La pantalla pinta `tutor_tiers.name` tal y como está en
la base, y en la base pone «Tier 1/2/3» **en inglés** desde el seed de C-09. El paquete da por hecho
lo contrario. Se traduce en el momento de pintar (`tutor/tier.ts`), que es una sustitución de
prefijo y no una tabla de nombres: el día que la base diga «Nivel 1» —o los nombres que apruebe
Emilio— el reemplazo no encuentra nada y pasa el nombre de la base tal cual. **Cambiarlos es un
`UPDATE` en `tutor_tiers`, o sea una migración (regla de oro 5), y esta pantalla no se toca.**

⚠️ **DP-5 es la única donde el paquete y el código se contradicen de verdad**, y se resolvió a favor
del código: la migración de bajas ya distingue los dos casos y su distinción es la correcta. Si
Emilio quiere lo que pide la captura, no es texto: es cambiar cuándo se puede dar de baja una
cuenta, y eso toca dinero.

**Y una pregunta menor, de una línea:** el buzón oficial está escrito `Info@ensenameya.com`, con
**I mayúscula**, y sale así a la vista en la tarjeta de soporte y en las tres páginas legales. Se lee
como una errata. No se ha tocado porque es el buzón que nombran el §18 y el §39 del contrato y el
que está dado de alta en dLocal; para el correo da igual (el servidor no distingue mayúsculas en esa
parte), así que es puro cómo se ve. Si Emilio dice que sí, es un carácter en `lib/company.ts`.

**Y una segunda, de color:** la captura de «Mi cuenta» pinta **«Guardar cambios» naranja** y la app
lo tiene **azul** (`bg-brand`, #0080ff, medido). No se ha tocado —§7 no habla de colores y la regla
G-07 conserva lo que la lista no menciona— pero `cuenta-hoy.png`, que retrata el estado ANTERIOR,
también lo pinta naranja, así que parece una convención del artifact y no un cambio pedido. Si de
verdad se quiere naranja, no es solo ese botón: es decidir cuál es el color del botón primario en
todo el panel.
