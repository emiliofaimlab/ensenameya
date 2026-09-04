# Enséñame Ya — Validación y Aprobación del Cliente

> ℹ️ **ESTADO DE LAS DECISIONES (4-sep-2026).** Este documento es la **v1 para firma** (9-jun-2026)
> y no se reescribe. Lo que ha cambiado desde entonces en sus `C-xx`:
>
> | | Estado |
> | :-- | :-- |
> | **C-01** proveedores | ✅ **dLocal + Stripe**, los dos con cuenta operativa (sandbox y producción). Payouts por PayPal y Stripe Connect |
> | **C-03** reembolsos | ✅ RN-37 — ≥24 h 100 %, <24 h alumno 50 %, tutor 100 %. Es código (`lib/policy.ts`) |
> | **C-11** correo | ✅ **Resend** |
> | **C-14** KYC | ✅ 7 documentos (`20260715130000`) |
> | **C-13** mercado | ⏳ **El único bloqueante de negocio que queda** |
>
> Ojo a un párrafo de §«proveedor por país» que este doc da por bueno y **es falso**: dice que
> Venezuela «requeriría un riel USDT y una entidad fuera». **No**: Venezuela cobra por Stripe y
> cobra por PayPal, las dos cosas verificadas. El mapa vigente está en `docs/PAGOS-Y-PAYOUTS.md`.


> **Documento comercial / de aprobación.** Conversión fiel a Markdown del PDF
> `APROBACION-CLIENTE-FAIMLAB.pdf` (v1 · 2026-06-09). Resumen **completo y no técnico**
> para revisión y firma del cliente. El **detalle técnico** vive en los Docs 0–9 +
> `REVISION-docs-1-3.md` de esta misma carpeta. Los diagramas (Figuras 1–7) eran imágenes
> en el PDF; aquí se transcribe su **contenido textual íntegro** (que, según el propio pie
> de cada figura, *es la fuente de verdad*).

**Para:** Nestor Valderrama. Este documento reúne, en un solo lugar y para tu **revisión,
corrección y aprobación**, la definición de: perfiles de usuario, pantallas, flujos,
procesos de pago y las decisiones que necesitamos que confirmes antes de entrar a
desarrollo.

| Campo | Valor |
| :-- | :-- |
| **Cliente** | Nestor Valderrama |
| **Proveedor** | Emilio Faim — Faim Lab (Tech Lead / Solutions Architect) |
| **Producto** | Enséñame Ya — marketplace web de e-learning (clases 1:1 en vivo) |
| **Propósito** | Validar y aprobar el alcance funcional para iniciar el desarrollo |
| **Versión** | v1 — 2026-06-09 |
| **Estado** | Para revisión y aprobación del cliente |

## Cómo usar este documento

- Revisa cada sección. Al cierre de cada una hay un espacio para **aprobar** o anotar **correcciones**.
- La **Sección 6 (Decisiones a confirmar)** son preguntas concretas: por favor **respóndelas** — son las que desbloquean el desarrollo. Algunas están marcadas como **BLOQUEANTE**.
- Lo que apruebes aquí queda como la **base** contra la que construimos. Cambios posteriores siguen el control de cambios acordado.
- Para cada sección marca con una X: `[ ] Aprobado` · `[ ] Aprobado con correcciones` (anótalas en el espacio).

> Los identificadores entre paréntesis (p. ej. `SCR-AL05`, `DP-01`) son referencias técnicas internas para trazabilidad; no necesitas memorizarlos.

---

## 1. Tipos de perfil y la información de cada uno

El sistema maneja **tres roles**. Un mismo usuario puede tener más de uno (por ejemplo, ser **alumno** y **tutor** a la vez).

### 1.1 Alumno

Persona que descubre, reserva y paga clases.

| Dato | ¿Obligatorio? | Para qué se usa |
| :-- | :-- | :-- |
| Nombre completo | Sí | Identificación y trato |
| Email | Sí | Acceso y notificaciones |
| Contraseña **o** cuenta de Google | Sí | Inicio de sesión (email o Google) |
| Zona horaria | Sí | Mostrar y agendar clases en su hora local |
| País | Opcional | Determina el corredor de cobro |
| Foto de perfil | Opcional | Personalización |
| Preferencias | Opcional | Recomendaciones / experiencia |
| Código de referido | Opcional (se captura solo) | Atribución del programa de referidos |

### 1.2 Tutor

Además de los datos de alumno, el tutor aporta:

| Dato | ¿Obligatorio? | Para qué se usa |
| :-- | :-- | :-- |
| Titular y biografía | Recomendado | Perfil público / conversión |
| Categorías (una o varias) | Sí (mínimo 1) | Descubrimiento por materia |
| Oferta inicial (al menos un producto/tutoría) | Sí | Definir qué vende y a qué precio |
| **Documentos de identidad (verificación / KYC)** | Sí | Verificar identidad antes de aprobar — **la lista exacta de documentos se define en C-14 (Sección 6)** |
| País donde cobra | Sí | Determina el proveedor de pago de su liquidación |
| Política de cancelación | Opcional (hay una por defecto) | Reglas de reembolso de sus clases |
| Tier (nivel) | Lo asigna el administrador | Define el **% de ganancia** del tutor — los porcentajes se definen en C-09 |
| Foto de perfil | Por confirmar | Posible requisito de onboarding — ver C-14 |

> El **estado de aprobación** del tutor (pendiente / aprobado / rechazado / suspendido) lo gestiona el administrador tras revisar identidad y perfil.

### 1.3 Administrador

Operador de la plataforma. **No se auto-registra**: la cuenta se crea de forma controlada. Gestiona: aprobación de tutores y KYC, categorías, comisiones/tiers, supervisión de pagos y payouts, reservas, estadísticas e incidencias.

**Aprobación Sección 1:** `[ ] Aprobado` `[ ] Con correcciones:` ___________________________

---

## 2. Mapa de pantallas

El MVP contempla **~49 pantallas** agrupadas por zona. El siguiente mapa muestra cómo se navega entre ellas: la zona pública, la **puerta de acceso** (se exige sesión para reservar), y las zonas de Alumno, Tutor y Admin, con la Sala en vivo compartida.

> **Figura 1 — Mapa de Pantallas y Navegación** (transcripción del diagrama):
>
> ```
> [Zona pública · anon]
> Landing / Home (P01)            Descubrir (P04–P05)            Perfil · Producto (P07 / P08)
>   destacados                →     tutores · productos     →      bio · rating · precio
>   + P02/P03 institucional          categoría · búsqueda           CTA Reservar
>                                                                         │ RESERVAR
>                                                                         ▼
>                                              [Puerta de acceso · S-35]
>                                              Login / Registro (AU01–04)
>                                              intención alumno/tutor (S-37)
>                                              S-35: sesión para reservar
>                                                         │
>             ┌───────────────────────────────┼───────────────────────────────┐
>             ▼                                 ▼                                ▼
>      [Zona con login]                  [Zona con login]                 [Zona con login]
>      Alumno (AL01–08)                  Tutor (TU01–09)                  Admin (AD01–15)
>      onboarding · dashboard            onboarding · KYC                 aprobaciones · KYC
>      agendar · checkout                productos · disponibilidad       pagos · payouts
>      confirmación · cancelar           reservas · sesiones              categorías · comisión
>      reseña                            payout / cobros                  reservas · estadísticas
>             │ (AL03)                          │ (TU08)                          │
>             └───────────────┐   ┌─────────────┘                                 ▼
>                             ▼   ▼                                    Global / transversal (G01–03)
>                   Sala en vivo 1:1 (LV01)                            config · errores · vacíos
>                   Daily · ventana RN-18                              desde menú (auth)
>                   compartida alumno + tutor
>
> Leyenda: ▭ pública (anon) · ▭ puerta de acceso (S-35) · ▭ zona con login · ─ ─ ─ acceso contextual
> Pie de figura: «DOC 4 · V2 2026-06-08 · ~45 PANTALLAS SCR-XX · EL CONTENIDO TEXTUAL ES LA FUENTE DE VERDAD»
> ```
>
> *Figura 1 — Mapa de navegación y pantallas: zona pública, puerta de acceso y zonas por rol, con la Sala en vivo compartida y las pantallas globales.*

Y este es el **inventario visual** completo: las ~49 pantallas (con su ID `SCR-xx` y su ruta) agrupadas por zona.

> **Figura 2 — Inventario de Pantallas (badge: «49 PANTALLAS»).** Su contenido se reproduce íntegro en las tablas «Inventario por zona» de abajo (se añade la **Ruta** que aparece en el diagrama). Pie de figura: «DOC 4 · ENSÉÑAME YA · FAIM LAB · 2026-06-08».
>
> *Figura 2 — Inventario visual de las ~49 pantallas, agrupadas por zona: público, autenticación, alumno, tutor, sala en vivo, admin y globales.*

### Inventario por zona

#### Públicas (sin iniciar sesión)

| ID | Pantalla | Ruta | Propósito |
| :-- | :-- | :-- | :-- |
| P01 | Landing / Home | `/` | Propuesta de valor + accesos a descubrimiento; destacados |
| P02 | Sobre Nosotros | `/about` | Información institucional |
| P03 | ¿Cómo funciona? | `/how-it-works` | Explicación del modelo alumno/tutor |
| P04 | Explorar Tutores | `/tutors` | Listado de tutores aprobados + búsqueda |
| P05 | Explorar Clases/Productos | `/classes` | Listado de ofertas (enfoque reservar) |
| P06 | Resultados por Categoría | `/categories/{slug}` | Navegación y listado filtrado por categoría |
| P07 | Perfil público del Tutor | `/tutors/{id}` | Bio, categorías, productos, rating, CTA "Reservar" |
| P08 | Detalle de Producto | `/products/{id}` | Descripción, resultado, precio, modelo, CTA "Reservar" |
| P09 | Resultados de Búsqueda | `/search?q=` | Búsqueda por palabra clave |

#### Acceso (autenticación)

| ID | Pantalla | Ruta | Propósito |
| :-- | :-- | :-- | :-- |
| AU01 | Login | `/login` | Email + Google |
| AU02 | Registro | `/signup` | Email + Google; elige intención (alumno/tutor) |
| AU03 | Recuperar contraseña | `/reset` | Solicitud + nueva contraseña vía enlace |
| AU04 | Verificación de correo / retorno Google | `/auth/callback` | Confirmación de cuenta |

#### Alumno

| ID | Pantalla | Ruta | Propósito |
| :-- | :-- | :-- | :-- |
| AL01 | Onboarding | `/onboarding` | Nombre, zona horaria, preferencias |
| AL02 | Dashboard | `/app` | Próximas sesiones y pasadas |
| AL03 | Detalle de Reserva / Sesión | `/app/bookings/{id}` | Estado, acceso a sala, acciones |
| AL04 | Agendar | `/products/{id}/book` | Elegir horario(s) disponible(s) |
| AL05 | Checkout / Pago | `/app/checkout/{id}` | Resumen + pago |
| AL06 | Confirmación | `/app/bookings/{id}/confirmed` | Resumen con horario bloqueado |
| AL07 | Cancelación | `/app/bookings/{id}/cancel` | Cancelar según política |
| AL08 | Dejar Reseña | `/app/bookings/{id}/review` | Calificación 1–5 + comentario |

#### Tutor

| ID | Pantalla | Ruta | Propósito |
| :-- | :-- | :-- | :-- |
| TU01 | Onboarding | `/tutor/onboarding` | Bio, categorías, oferta inicial |
| TU02 | Verificación de Identidad | `/tutor/verification` | Subir documentos (KYC) |
| TU03 | Mis Productos | `/tutor/products` | Gestión de tutorías |
| TU04 | Crear/Editar Producto | `/tutor/products/new\|{id}` | Precio, duración, categorías, política |
| TU05 | Disponibilidad / Calendario | `/tutor/availability` | Horarios recurrentes + excepciones |
| TU06 | Dashboard | `/tutor` | Sesiones + total ganado |
| TU07 | Reservas | `/tutor/bookings` | Listado y detalle de reservas |
| TU08 | Detalle de Sesión | `/tutor/sessions/{id}` | Ver estado / marcar completada / cancelar |
| TU09 | Payout / Cobros | `/tutor/payouts` | Estado de retiros e historial (solo consulta) |

#### Sala en vivo (compartida) y Globales

| ID | Pantalla | Ruta | Propósito |
| :-- | :-- | :-- | :-- |
| LV01 | Sala de Clase 1:1 | `/room/{sessionId}` | Videollamada (Daily), habilitada por ventana; soporta móvil |
| G01 | Error (404/500) | (contextual) | Manejo de errores |
| G02 | Estado vacío | (contextual) | Listados sin datos |
| G03 | Configuración de cuenta | `/account` | Perfil, zona horaria, seguridad, cerrar sesión |

#### Admin (panel)

| ID | Pantalla | Ruta | Propósito |
| :-- | :-- | :-- | :-- |
| AD01 / AD02 | Login + Dashboard | `/admin/login` · `/admin` | Acceso y resumen de pendientes + KPIs |
| AD03 / AD04 | Tutores por aprobar / aprobados | `/admin/tutors?status=pending` · `?status=approved` | Listas con filtros |
| AD05 | Detalle de Tutor | `/admin/tutors/{id}` | Aprobar / rechazar / suspender; revisar KYC |
| AD06 / AD07 | Pagos pendientes / historial | `/admin/payments?status=pending` · `/admin/payments` | Supervisión de cobros |
| AD08 | Detalle de Pago | `/admin/payments/{id}` | Monto, comisiones, reembolso |
| AD09 / AD10 | Reservas / detalle | `/admin/bookings` · `/admin/bookings/{id}` | Soporte y trazas |
| AD11 | Categorías | `/admin/categories` | Crear / editar categorías |
| AD12 | Comisión / Tiers | `/admin/tiers` | Editar % y crear niveles |
| AD13 | Estadísticas | `/admin/stats` | KPIs por periodo |
| AD14 | Alertas / Incidencias | `/admin/alerts` | Fallas de pago, disputas, no-shows |
| AD15 | Payouts a tutores | `/admin/payouts` | Ejecutar / retener liquidaciones |

> **Referidos:** no es una pantalla propia; es un **widget** de Referral Factory embebido (p. ej. en el dashboard del alumno) que solo captura el código de referido.

**Aprobación Sección 2:** `[ ] Aprobado` `[ ] Con correcciones:` ___________________________

---

## 3. Especificación de pantallas (qué hace cada una)

Resumen funcional de qué ve y qué hace el usuario en cada pantalla. (El detalle técnico vive en la documentación de implementación.)

### 3.1 Públicas

| Pantalla | Contenido y acciones clave |
| :-- | :-- |
| Landing (P01) | Hero + buscador + destacados; enlaces a explorar y a registro |
| Explorar Tutores (P04) | Filtros (categoría, rating, precio), tarjetas de tutor, paginación |
| Explorar Productos (P05) | Filtros por modelo de precio / duración; tarjetas de oferta |
| Categoría (P06) | Lista de categorías y su catálogo; enlaza directo a perfil/producto |
| Perfil del Tutor (P07) | Bio, categorías, productos, reseñas, disponibilidad resumida, "Reservar" |
| Detalle de Producto (P08) | Resultado prometido, precio, modelo, duración, política, "Reservar" |
| Búsqueda (P09) | Resultados por palabra clave agrupados (tutores/productos/categorías) |

### 3.2 Alumno

| Pantalla | Contenido y acciones clave |
| :-- | :-- |
| Onboarding (AL01) | Nombre y **zona horaria** (obligatoria); solo en el primer acceso |
| Dashboard (AL02) | Próximas y pasadas sesiones; acceso a sala cuando esté habilitada |
| Detalle de reserva (AL03) | Estado, sesiones, recibo, botón de sala, cancelar, dejar reseña |
| Agendar (AL04) | Calendario de horarios libres del tutor (en hora local); para paquetes, N sesiones |
| Checkout (AL05) | Resumen, total y moneda; pago por proveedor (checkout seguro alojado) |
| Confirmación (AL06) | Confirmación, horario bloqueado; "ver detalle" / "volver al inicio" |
| Cancelación (AL07) | Muestra la política aplicable y el reembolso estimado; confirma |
| Reseña (AL08) | 1–5 estrellas + comentario, solo tras completar el servicio |

### 3.3 Tutor

| Pantalla | Contenido y acciones clave |
| :-- | :-- |
| Onboarding (TU01) | Titular, bio, categorías, zona horaria, primera oferta |
| Verificación (TU02) | Subir documentos de identidad; ver estado de revisión |
| Mis Productos (TU03) | Publicar / pausar / archivar; crear nuevo |
| Crear producto (TU04) | Modelo de precio (sesión / hora / paquete), precio, duración, categorías, política |
| Disponibilidad (TU05) | Horarios recurrentes + excepciones (bloquear / abrir extra) |
| Dashboard (TU06) | Próximas sesiones, total ganado / neto, estado de aprobación |
| Reservas (TU07) | Listado y detalle de reservas recibidas |
| Detalle de sesión (TU08) | Entrar a sala, marcar completada, cancelar (con política) |
| Payout (TU09) | Saldo en retención, próximos pagos e historial — **solo consulta** (la liquidación la ejecuta el administrador) |

### 3.4 Sala en vivo y Admin (pantallas clave)

| Pantalla | Contenido y acciones clave |
| :-- | :-- |
| Sala en vivo (LV01) | Video 1:1 (Daily); se habilita por una **ventana** alrededor del horario; soporta móvil |
| Detalle de Tutor — Admin (AD05) | Visor seguro de documentos KYC; aprobar / rechazar / suspender; asignar tier; notifica al tutor el resultado |
| Detalle de Pago (AD08) | Monto bruto / comisión / neto, proveedor y referencia; **iniciar reembolso** total o parcial |
| Comisión / Tiers (AD12) | Editar el % de cada tier y crear tiers; aplica a reservas nuevas (no retroactivo) |
| Payouts (AD15) | Ejecutar / retener / reintentar liquidaciones a tutores |

**Aprobación Sección 3:** `[ ] Aprobado` `[ ] Con correcciones:` ___________________________

---

## 4. Flujos de usuario

Cada flujo muestra el recorrido paso a paso y los puntos de decisión clave.

### 4.1 Flujo del Alumno — descubrir, reservar, tomar la clase y reseñar

El alumno descubre una oferta, agenda, **paga dentro de una ventana de tiempo**, recibe la confirmación, toma la clase en vivo y deja su reseña. Si el pago falla o expira la ventana, la reserva se libera; el alumno puede cancelar según la política.

> **Figura 3 — FL-01 · Flujo del Alumno** (transcripción del diagrama):
>
> ```
> (inicio) Registro / Login ──────────── AU01/02 · email · Google
>     │
>     ▼
> Descubrir y reservar ───────────────── P04–P09 · AL04 → booking: pending_payment
>     │
>     ▼
> ◇ ¿Pago en la ventana? ──────────────── AL05 · 30 min (RN-27)
>     │                          └── NO ──▶ Pago falla o expira (M6 · RN-27)
>     │ SÍ · PAID                            reintenta dentro de ventana, o auto-cancela
>     ▼
> Confirmación ───────────────────────── AL06 → confirmed · crea sesiones
>     │
>     ▼
> Clase en vivo 1:1 ──────────────────── LV01 · ventana RN-18 → in_progress → completed
>     │                          └── CANCEL ─ ─▶ Cancelación (AL07)
>     │                                          RN-11 · DP-03 → cancelled · reembolso
>     ▼
> (fin) Deja reseña ──────────────────── AL08 → completed (RN-28)
>
> Leyenda: ◯ inicio/fin · ▭ paso · ◇ decisión (foco) · ─ ─ ─ ruta alterna
> Pie de figura: «DOC 4 · V2 2026-06-08 · ESTADOS SEGÚN DOC 2 (M1–M8) · EL CONTENIDO TEXTUAL ES LA FUENTE DE VERDAD»
> ```
>
> *Figura 3 — FL-01 · Flujo del Alumno, con la rama de pago fallido/expirado y la ruta de cancelación.*

### 4.2 Flujo del Tutor — alta, aprobación, operar y cobrar

El tutor se registra, completa su perfil y sube documentos. **Mientras espera la aprobación puede ir creando productos en borrador**; la aprobación del administrador es la que habilita **publicar**. Luego recibe reservas, imparte y consulta sus pagos. **El cobro/payout es de solo lectura para el tutor: lo ejecuta el administrador.**

> **Figura 4 — FL-02 · Flujo del Tutor** (transcripción del diagrama):
>
> ```
> (inicio) Registro tutor ───────────── AU02 → approval: pending
>     │
>     ▼
> Onboarding + KYC ──────────────────── TU01–TU02 → identity / document: pending
>     │            └ ─ ─ PARALELO ─ ─▶ Productos en draft (TU03–TU04)
>     │                                 se crean en pending; publicar requiere aprobado
>     ▼
> ◇ ¿Admin aprueba identidad+perfil? ── AD05 · RN-29
>     │            └── NO ──▶ Rechazo → corrige (AD05)
>     │                       → identity: rejected · reenvía a revisión ──┐ (REENVÍA)
>     │ SÍ (RN-29)                                                         └─▶ (vuelve a Onboarding + KYC)
>     ▼
> Publica oferta ────────────────────── TU03 → product: draft → active (RN-24)
>     │
>     ▼
> Recibe e imparte clase ────────────── TU07 · LV01 · TU08 · ventana RN-18 → session: completed
>     │            └ ─ ─ CANCELAR ─ ─▶ Tutor cancela sesión (TU08)
>     │                                 FL-05 · DP-03 → cancelled · reembolso
>     ▼
> Cobro / Payout — consulta ─────────── TU09 · solo lectura (S-15) · lo liquida admin (AD15)
>
> Leyenda: ◯ inicio · ▭ paso · ◇ decisión (foco) · ▭ ─ ─ paralelo / opcional
> Pie de figura: «DOC 4 · V2 2026-06-08 · ESTADOS SEGÚN DOC 2 (M1—M8) · EL CONTENIDO TEXTUAL ES LA FUENTE DE VERDAD»
> ```
>
> *Figura 4 — FL-02 · Flujo del Tutor: alta, verificación, aprobación, publicar, operar y cobrar.*

### 4.3 Flujo del Administrador — operación

Desde el **Dashboard** el administrador accede a sus áreas de operación: aprobación de tutores/KYC (la decisión clave), categorías y comisiones, pagos y reembolsos, payouts, reservas, y estadísticas/alertas.

> **Figura 5 — FL-03 · Flujo del Admin** (transcripción del diagrama):
>
> ```
>                         Dashboard Admin (AD01–AD02)
>                         entrada · pendientes · KPIs
>           ┌────────────────┬───────────────┬────────────────┐
>           ▼                ▼               ▼                ▼
> [operación clave]   Categorías ·      Pagos /          Payouts (AD15)
> Aprobar tutores /   Comisión          Reembolsos       hold / release (M7)
> KYC (AD03–AD05)     (AD11–AD12)       (AD06–AD08)      ejecuta service role
> M1 · M2 · M8        split · tiers     M6 · service role
> NTF-03 al tutor     (RN-07)           NTF-10 reembolso
>           │         aplica a nuevas
>           ▼         (S-08)                  │
>     Reservas (AD09–AD10)                     ▼
>     lectura / soporte               Estadísticas / Alertas (AD13–AD14)
>     /admin/bookings/{id}            KPIs por periodo · incidencias
>                                     NTF-13 alertas internas
>
> Leyenda: ▭ áreas accesibles desde el Dashboard · ▭ operación clave (aprobación)
> Pie de figura: «DOC 4 · V2 2026-06-08 · EL DASHBOARD (AD02) ES EL PUNTO DE ENTRADA · FUENTE DE VERDAD = TEXTO»
> ```
>
> *Figura 5 — FL-03 · Flujo del Admin: el Dashboard y sus áreas de operación.*

### 4.4 Flujo de Referido — integración externa

El programa de referidos se gestiona en una plataforma externa (Referral Factory). El **único paso interno** es capturar el código de referido cuando alguien se registra con un enlace. Las reglas (monto, conversión válida, límites) se configuran fuera.

> **Figura 6 — FL-04 · Flujo de Referido** (transcripción del diagrama):
>
> ```
> (inicio interno) Abre widget de referidos ──── AL02 / G03 · artefacto Referral Factory
>     │
>     ▼
> [externo] Comparte enlace / código ─────────── Referral Factory gestiona · reglas DP-04
>     │
>     ▼
> [único paso interno] Captura referral_code ─── AU02 · al registrarse con ?ref=
>     │                                           en profiles (S-18) · única atribución interna
>     ▼
> [externo] Conversión / payout del referido ─── lo resuelve Referral Factory
>                                                 monto / condición / límites = DP-04
>
> RN-21: sin lógica interna propia — solo captura de atribución.
> Leyenda: ◯ inicio (interno) · ▭ único paso interno · ▭ externo (RF)
> Pie de figura: «DOC 4 · V2 2026-06-08 · INTEGRACIÓN EXTERNA REFERRAL FACTORY · SIN CAMBIOS V2»
> ```
>
> *Figura 6 — FL-04 · Flujo de Referido: integración externa; el único paso interno es la captura de atribución.*

### 4.5 Flujo de Cancelación y Reembolso

Cuatro disparadores posibles: cancela el **alumno**, cancela el **tutor**, **no-show** (inasistencia, detectada automáticamente y revisable por el admin), o **reembolso por el admin**. El efecto financiero depende de la política (a confirmar en la Sección 6).

> **Figura 7 — FL-05 · Cancelación y Reembolso** (transcripción del diagrama):
>
> ```
>                 Disparador de cancelación (DP-03 / DP-08)
>                 mecanismo: Doc 2 §2.13
>     ┌───────────────┬──────────────────┬──────────────────┐
>     ▼ ALUMNO        ▼ TUTOR            ▼ NO-SHOW           ▼ ADMIN
> Alumno cancela   Tutor cancela     No-show              Reembolso por admin
> (AL03–AL07)      (TU08)            [SISTEMA · AD14]      (AD08)
> política         → booking:        detección automática  → payment:
> RN-11 / DP-03    cancelled         por timeout (S-07)     refunded/partial
> → booking/       → payment:        revisión admin en AD14 ajuste de payout (S-20)
> session:         refunded (100%)   → session: no_show      service role (M6)
> cancelled                          · DP-08
> → payment:                         [política pendiente
> refunded/partial                    DP-08]
> NTF-09 + NTF-10  NTF-09 (al alumno) NTF según política    NTF-10
>
> Leyenda: ▭ casos por disparador · ▭ política pendiente (DP-08)
> Pie de figura: «DOC 4 · V2 2026-06-08 · NO-SHOW = DETECCIÓN AUTOMÁTICA + AD14 · FUENTE DE VERDAD = TEXTO»
> ```
>
> *Figura 7 — FL-05 · Cancelación y reembolso: casos por disparador y estados resultantes.*
>
> *(Nota de transcripción: el diagrama referencia el ajuste de payout como «S-20»; en los Docs técnicos esa regla de exclusión/ajuste del `payout_item` ante reembolso previo a liquidar es el supuesto **S-29**. Se conserva el texto tal como aparece en el PDF.)*

**Aprobación Sección 4:** `[ ] Aprobado` `[ ] Con correcciones:` ___________________________

---

## 5. Procesos de pago

La plataforma está diseñada con una **capa de pagos agnóstica**: el núcleo no depende de un proveedor concreto, lo que nos protege ante cambios y permite activar países/proveedores **sin reescribir** el sistema.

### 5.1 Cómo se cobra al alumno (y se reparte)

| Paso | Qué ocurre |
| :-- | :-- |
| 1 | El alumno confirma horario(s) → se crea una reserva tentativa |
| 2 | Va al checkout y paga mediante el proveedor (checkout seguro alojado; **no almacenamos datos de tarjeta**) |
| 3 | El proveedor confirma el cobro |
| 4 | Se **reparte** el monto según el tier del tutor: el tutor recibe su %, la plataforma retiene su comisión |
| 5 | Se confirma la reserva, se agendan las sesiones y se crean las salas de video |

> El **% de reparto** queda **congelado** en el momento de la compra (un cambio de comisión no afecta reservas ya hechas). Los porcentajes por tier se definen en **C-09**.

### 5.2 Cómo se paga al tutor (payout)

| Paso | Qué ocurre |
| :-- | :-- |
| 1 | Al cobrarse, se **devenga** el neto del tutor (aún no se libera) |
| 2 | Tras **completarse el servicio** y vencer el **periodo de retención**, el pago se programa |
| 3 | El sistema ejecuta la liquidación con el proveedor correspondiente al país del tutor |
| 4 | El proveedor confirma; se notifica al tutor |

> El **periodo de retención** (C-02) y la **modalidad de agrupación** (un pago por reserva o por lote, C-04) son decisiones a confirmar. Para **paquetes**, el payout se libera al completar toda la reserva (ver C-02).

### 5.3 Corredores por geografía (estrategia)

El proveedor se elige por el **país donde cobra el tutor**. Resumen orientativo (la selección final de proveedores es **C-01 / C-13**):

| Tutor ↓ / Alumno → | Estados Unidos | LATAM | Venezuela |
| :-- | :-- | :-- | :-- |
| **Estados Unidos** | Cobro + payout local con split | Cobro intl · payout al tutor US | Cobro intl · payout US |
| **Brasil / México** | Cobro intl · payout BR/MX | Cobro local o intl · payout BR/MX | Cobro intl · payout BR/MX |
| **LATAM (AR, CO, CL, PE, UY)** | Cobro intl · payout local | Mismo país o cross-border | Cobro intl · payout local |
| **Venezuela** | Cobro intl · **payout USDT** | Cobro intl · **payout USDT** | Cobro + payout en **USDT** |

> **Venezuela** no tiene cobro/payout bancario nativo de los proveedores; requeriría un riel **USDT** y una entidad del negocio constituida fuera. Es una **decisión estratégica** (C-13 / RISK-02).

### 5.4 Principios de seguridad

- Sin datos de tarjeta en la plataforma (checkout alojado por el proveedor).
- Toda **escritura financiera** ocurre en el servidor (el cliente solo lee).
- Webhooks firmados e idempotentes (no se duplican cobros).

**Aprobación Sección 5:** `[ ] Aprobado` `[ ] Con correcciones:` ___________________________

---

## 6. Decisiones que necesitamos que confirmes

Estas son las consultas que debemos resolver contigo. **4 son bloqueantes** para iniciar; el resto se necesitan antes del sprint o del lanzamiento, pero conviene cerrarlas pronto.

### Resumen

| ID | Tema | Pregunta clave | Urgencia |
| :-- | :-- | :-- | :-- |
| C-01 | Pagos | ¿Qué proveedores se activan al lanzamiento? | **BLOQUEANTE** |
| C-02 | Pagos | ¿Cuántos días de retención antes de pagar al tutor? | Antes de Fase 2 |
| C-03 | Pagos | ¿Cuál es la política de reembolsos? | **BLOQUEANTE** |
| C-04 | Pagos | ¿Payout por pago o por lote? | Antes de Fase 2 |
| C-05 | Operación | ¿Política ante inasistencias (no-show)? | Antes de Fase 2 |
| C-06 | Operación | ¿Checkout sin crear cuenta (invitado)? | Antes de Fase 2 |
| C-07 | Operación | ¿Cuánto tiempo para pagar tras reservar? | Antes de Fase 2 |
| C-08 | Operación | ¿Minutos antes/después para abrir la sala? | Antes de Fase 2 |
| C-09 | Comisiones | ¿% de reparto por tier de tutor? | Antes de Fase 2 |
| C-10 | Referidos | ¿Reglas del programa de referidos? | Antes de lanzamiento |
| C-11 | Comunicación | ¿Herramienta de email transaccional? | Antes de Fase 2 |
| C-12 | Comunicación | ¿Quién puede desactivar notificaciones? | Antes de Fase 2 |
| C-13 | Mercado | ¿Mercado(s) geográfico(s) del lanzamiento? | **BLOQUEANTE** |
| C-14 | Tutores | ¿Qué se exige para aprobar un tutor? | **BLOQUEANTE** |
| C-15 | Pagos | ¿Moneda de liquidación y manejo de tipo de cambio? | Antes de cross-border |

### Bloque A — Pagos y finanzas

**C-01 — ¿Qué proveedores de pago se activan para el lanzamiento? · BLOQUEANTE**
- Contexto: la capa es agnóstica; falta elegir el/los proveedores iniciales. Recomendación a evaluar: **DLocal** como principal (eficiente en liquidaciones locales y splits) con **Stripe** de respaldo.
- Tu decisión: ___________________________

**C-02 — ¿Cuántos días de retención antes de liberar el payout? · Antes de Fase 2**
- Contexto: se retienen los fondos del tutor unos días tras completarse el servicio (protege ante disputas/chargebacks).
- 1) ¿Prefieres 1 semana, 15 o 30 días? ___________
- 2) ¿Uniforme para todos los tutores o configurable por tier? ___________
- 3) **Paquetes (N sesiones):** ¿el payout se cuenta tras completar **toda** la reserva (criterio por defecto) o prefieres una cadencia por sesión en paquetes largos? ___________

**C-03 — ¿Política de reembolsos ante cancelaciones? · BLOQUEANTE**
- Contexto: es la decisión de mayor riesgo financiero/reputacional. El mecanismo ya está construido; faltan porcentajes y plazos.
- 1) ¿Cuántas horas de antelación cuentan como "cancelación a tiempo" (reembolso total)? ___________
- 2) ¿Qué % retiene la plataforma ante cancelación tardía del **alumno**? ___________
- 3) ¿Qué % ante cancelación tardía del **tutor**? ___________
- 4) En paquetes con sesiones parcialmente tomadas, ¿se reembolsa lo no consumido? ___________
- 5) ¿El tutor define su propia política o la plataforma impone una única? ___________

**C-04 — ¿Cómo se agregan los payouts — uno por pago o por lote? · Antes de Fase 2**
- Opciones: (a) un payout por cada pago (trazabilidad simple); (b) un payout por lote (ej. semanal/quincenal).
- 1) ¿Cuál prefieres? ___________  2) Si es por lote, ¿con qué frecuencia? ___________

**C-15 — ¿Moneda de liquidación y tipo de cambio (cross-border)? · Antes de cross-border**
- Contexto: cuando el tutor cobra en otro país/moneda, hay que definir la moneda y quién asume el tipo de cambio.
- 1) ¿En qué moneda recibe el tutor: su moneda local, USD, o la misma del cobro? ___________
- 2) ¿La plataforma absorbe el riesgo de tipo de cambio o se traslada al tutor? ___________
- 3) ¿Se muestra el tipo de cambio aplicado en su detalle de payout? ___________

### Bloque B — Política operativa

**C-05 — ¿Política ante inasistencias (no-show)? · Antes de Fase 2**
- Default propuesto: no-show del **alumno** = sesión consumida (sin reembolso); no-show del **tutor** = reembolso de esa sesión.
- 1) ¿Confirmas el default? ___________
- 2) ¿Reprogramación automática ante no-show del tutor, o solo reembolso? ___________
- 3) ¿Penalización acumulada para tutores con varios no-shows? ___________

**C-06 — ¿Se permite checkout sin crear cuenta (invitado)? · Antes de Fase 2**
- 1) ¿Permitir reservar y pagar sin cuenta? ___________
- 2) Si sí, ¿cuándo se pide crear contraseña — después del pago o al entrar a la sala? ___________

**C-07 — ¿Cuánto tiempo tiene el alumno para pagar tras reservar? · Antes de Fase 2**
- Supuesto actual: 30 minutos; si no paga, la reserva se libera.
- ¿Confirmas 30 minutos o prefieres otro valor? ___________

**C-08 — ¿Cuántos minutos antes/después se abre la sala? · Antes de Fase 2**
- Sugerido: 10 minutos antes / 10 después.
- ¿Confirmas 10/10 u otro valor? ___________

### Bloque C — Comisiones y tiers

**C-09 — ¿% de reparto por tier de tutor? · Antes de Fase 2**
- Contexto: 3 tiers iniciales (editables). Cada tier define el % que retiene la plataforma vs. el que recibe el tutor.
- 1) ¿Porcentajes de los 3 tiers? ___________
- 2) ¿Nombres de los tiers? ___________
- 3) ¿Con qué tier ingresan los tutores nuevos? ___________
- 4) ¿Criterios de ascenso de tier (sesiones, rating)? ___________

### Bloque D — Referidos

**C-10 — ¿Reglas del programa de referidos? · Antes de lanzamiento**
- Se configura en Referral Factory (externo).
- 1) ¿Monto/beneficio por referido exitoso (para quien refiere y para el nuevo)? ___________
- 2) ¿Qué define una "conversión válida" (registro, primera reserva, primer pago)? ___________
- 3) ¿Límite de referidos por usuario o de payout del programa? ___________
- 4) ¿Activar desde el lanzamiento o después? ___________

### Bloque E — Comunicación

**C-11 — ¿Herramienta de email transaccional? · Antes de Fase 2**
- Recomendación a confirmar: **Mailgun** (buena entregabilidad). Tu decisión: ___________

**C-12 — ¿Quién puede desactivar notificaciones (opt-out)? · Antes de Fase 2**
- 1) ¿Cuáles notificaciones son obligatorias y cuáles opcionales? ___________
- 2) ¿Habrá emails de marketing además de los del sistema? ___________

### Bloque F — Mercado

**C-13 — ¿Mercado objetivo geográfico del lanzamiento? · BLOQUEANTE**
- 1) ¿En cuántos países y cuáles operarás al lanzamiento? ___________
- 2) ¿**Venezuela** entra en el MVP o se excluye del primer lanzamiento? ___________

### Bloque G — Aprobación de tutores

**C-14 — ¿Qué información y documentos se exigen para aprobar un tutor? · BLOQUEANTE**
- Contexto: el flujo está construido; falta el **criterio** (qué se pide, qué valida el admin, qué se comunica). Sin esto no se puede diseñar la pantalla de carga ni el checklist del admin.
- 1) ¿Qué documentos son **obligatorios**? (cédula, pasaporte, título, certificado, CV) ___________
- 2) ¿Alguno es opcional o depende de la categoría/materia? ___________
- 3) ¿Se exige foto de perfil en el onboarding? ___________
- 4) ¿El admin revisa solo documentos o también hace entrevista? ___________
- 5) ¿Hay un plazo máximo de revisión? ¿Qué pasa si se vence? ___________
- 6) ¿Motivos de rechazo estándar? (ilegible, vencido, no cumple perfil) ___________
- 7) ¿El tutor rechazado puede volver a postular? ¿Cuántas veces / con qué condiciones? ___________
- 8) ¿El rechazo se comunica con mensaje personalizado o motivo genérico? ___________

**Confirmación Sección 6:** `[ ] Respondidas` `[ ] Pendientes:` ___________________________

---

## 7. Hoja de aprobación

| Sección | Aprobado | Con correcciones (resumen) |
| :-- | :-- | :-- |
| 1. Perfiles de usuario | `[ ]` | |
| 2. Mapa de pantallas | `[ ]` | |
| 3. Specs de pantallas | `[ ]` | |
| 4. Flujos de usuario | `[ ]` | |
| 5. Procesos de pago | `[ ]` | |
| 6. Decisiones (respuestas) | `[ ]` | |

**Comentarios generales:**

___________________________________________________________________

___________________________________________________________________

| | |
| :-- | :-- |
| **Aprobado por** (cliente) | ___________________________ |
| **Cargo** | ___________________________ |
| **Fecha** | ___________________________ |
| **Firma** | ___________________________ |

> Al aprobar, esta definición queda como la base acordada para iniciar el desarrollo. Gracias, Nestor.

*Documento de validación y aprobación — Enséñame Ya · Faim Lab · v1 2026-06-09.*
