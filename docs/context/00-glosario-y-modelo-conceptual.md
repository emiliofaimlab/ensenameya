# DOC 0 — Glosario y Modelo Conceptual

> **Enséñame Ya — MVP Web.** Fuente de verdad conceptual del dominio.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 0 — Glosario y Modelo Conceptual |
| **Proyecto** | Enséñame Ya — MVP Web |
| **Cliente** | Nestor Valderrama |
| **Autor** | Emilio Faim — Faim Lab |
| **Propósito** | Vocabulario común, entidades, relaciones y reglas de negocio |
| **Audiencia** | Diseñador UX/UI, Dev Full-Stack, Project Manager, Cliente |
| **Estado** | Aprobado |
| **Fecha** | 2026-06-02 |

---

## 0.1 Propósito y cómo leer este documento

Este documento es la **fuente de verdad conceptual** de Enséñame Ya. Define el vocabulario, las entidades del dominio y las reglas de negocio que el resto de documentos (1–9) usarán sin volver a discutir. Si hay conflicto entre documentos, **este manda en lo conceptual**.

**Marcadores usados en toda la documentación:**

- `SUPUESTO:` — supuesto tomado para poder avanzar; debe confirmarse. Numerados `S-xx`.
- `DECISIÓN PENDIENTE:` — decisión abierta que **no** se resuelve aquí; se documenta con opciones e impacto. Numeradas `DP-xx`.
- `RN-xx` — regla de negocio.
- `D-xx` — divergencia entre la propuesta firmada y el modelo bloqueado.

> **Principio rector del producto:** el tutor vende **el resultado, no el proceso**. Esto justifica el modelo de precio por **paquete de N clases hacia un resultado** y orienta el descubrimiento hacia "qué logro" más que "cuántas horas".

---

## 0.2 Glosario de términos

| Término | Definición |
| :-- | :-- |
| **Usuario** | Persona registrada en la plataforma. Entidad base con uno o más roles. Campo `timezone` obligatorio. |
| **Alumno** | Rol de usuario que descubre, reserva y paga clases, y deja reseñas. |
| **Tutor** | Rol de usuario que ofrece Productos, define disponibilidad, da clases y recibe payouts. Pertenece a un Tier. Requiere aprobación manual del admin. |
| **Admin** | Rol operativo: aprueba tutores, gestiona categorías y tiers, supervisa pagos/payouts y reservas. |
| **Tier (Nivel de Tutor)** | Nivel al que pertenece un tutor; define su **% de split** de ganancias. 3 niveles iniciales; editable y ampliable por el admin. |
| **Split** | Reparto del monto de un cobro entre plataforma y tutor, determinado por el Tier del tutor. |
| **Categoría** | Área temática gestionada por el admin. Eje de descubrimiento de Productos. |
| **Producto** | Oferta vendible del tutor (etiqueta de UI: "Tutoría"). Pertenece a un tutor y a una o más categorías. Tiene un modelo de precio. |
| **Modelo de precio** | Forma de cobro de un Producto: por sesión, por hora, o por paquete de N clases. |
| **Resultado (outcome)** | Logro concreto que persigue un paquete (ej. "aprobar el examen X"). Eje de la propuesta de valor. |
| **Paquete** | Modelo de precio = **N sesiones 1:1 de un único participante** con el tutor, hacia un resultado. **No** es clase grupal. |
| **Clase grupal** | Sesión con varios alumnos a la vez. **Fuera de alcance del MVP** (no confundir con paquete). |
| **Disponibilidad** | Bloques horarios que el tutor publica para ser reservado. |
| **Reserva (booking)** | Compra de un Producto por un alumno. Genera 1..N Sesiones y un Pago. |
| **Sesión / Clase** | Instancia agendada de una clase 1:1: fecha, hora inicio/fin (mín. 30 min), sala de video, estado. Se guarda en UTC. |
| **Sala de video** | Sala 1:1 de Daily asociada a una Sesión, habilitada según su horario. |
| **Pago (charge)** | Cobro al alumno atado a una Reserva. Se reparte según el split del Tier. |
| **Payout (liquidación)** | Transferencia de las ganancias al tutor tras el periodo de retención. |
| **Periodo de retención** | Días que la plataforma retiene los fondos antes de liberar el payout. `DECISIÓN PENDIENTE DP-02: 15 o 30 días`. |
| **Proveedor de pago (`PaymentProvider`)** | Adaptador concreto detrás de una interfaz común con `charge()` y `payout()`. Qué proveedores se activan es `DP-01`. |
| **`PaymentRouter`** | Componente que resuelve qué proveedor usar para cobrar (`resolveCharge`) y para pagar (`resolvePayout`); pueden ser **distintos**. |
| **Corredor (corridor)** | Combinación país-de-cobro × país-de-payout que determina el proveedor (ej. "alumno USA → tutor CL"). |
| **Orquestación de pagos** | Estrategia de enrutar cobro/payout por geografía con tabla de routing en config/BD. Estrategia concreta en `DP-01`. |
| **Reseña** | Calificación 1–5 que deja el alumno **por compra**, una vez **completado el servicio** (todas las sesiones de la reserva). |
| **Onboarding** | Flujo de creación de perfil (alumno: preferencias/pago; tutor: bio, categorías, documentos, oferta inicial). |
| **Verificación de identidad** | Revisión manual de documentos del tutor (subir → "en revisión" → aprobado/rechazado). Diseñada para automatizar luego. |
| **RLS (Row Level Security)** | Mecanismo de Supabase/Postgres para restringir filas por rol/usuario. Base de la matriz de permisos (Doc 3). |
| **OAuth** | Autenticación delegada (Google) además de email. |
| **UTC / timezone** | Las sesiones se almacenan en UTC y se muestran en la zona horaria local de cada usuario. |
| **Referido (referral)** | Captación gestionada en **plataforma externa** (Referral Factory), **integrada al frontend**. Sin lógica interna en el MVP. |
| **MVP** | Primera versión funcional lista para operar y validar el modelo. |

---

## 0.3 Entidades del dominio

> Descripciones conceptuales. El **diccionario de campos** (tipos, llaves, nullability, índices) va en el **Doc 1**.

**Entidades núcleo:**

1. **Usuario** — base de identidad; roles Alumno/Tutor/Admin; auth Google+email; `timezone` obligatorio.
2. **Tutor** — extensión de perfil de un Usuario con rol Tutor: bio, categorías, documentos, estado de aprobación, estado de verificación de identidad; pertenece a un Tier.
3. **Tutor Tier** — nivel con `% split`; editable; el admin puede crear nuevos tiers.
4. **Categoría** — área temática; eje de descubrimiento; gestionada por admin.
5. **Producto** — oferta vendible; pertenece a un tutor y a **una o más** categorías; modelo de precio; reglas de cancelación (default del tutor, override opcional).
6. **Disponibilidad** — bloques horarios publicados por el tutor. `SUPUESTO S-03`.
7. **Reserva** — compra de un Producto por un alumno; ancla del Pago; genera 1..N Sesiones.
8. **Sesión / Clase** — instancia agendada; UTC; sala Daily; estado.
9. **Pago** — cobro atado a la Reserva; lleva el split aplicado.
10. **Payout** — liquidación al tutor tras retención.
11. **Reseña** — rating 1–5 ligado a una **Reserva** completada (una por compra).

**Entidades de soporte / configuración:**

12. **Documento de verificación** — archivo(s) que sube el tutor para KYC manual. `SUPUESTO S-10`.
13. **Tabla de routing de pagos** — configuración corredor → proveedor (en BD, no hardcodeada). Es el mecanismo que permite mantener `DP-01` abierta sin acoplar el core.

**Fuera del modelo de datos del MVP:**

14. **(Integración externa) Referidos** — **no es entidad del MVP**: se configura en Referral Factory y se integra a nivel de **frontend**. Se documenta el punto de integración, sin lógica ni tablas internas.

---

## 0.4 Relaciones entre entidades

| Relación | Cardinalidad | Descripción |
| :-- | :-- | :-- |
| Usuario — Tutor | 1 — 0..1 | Un Usuario con rol Tutor tiene un perfil Tutor. |
| Tutor Tier — Tutor | 1 — N | Un tier agrupa muchos tutores; cada tutor tiene exactamente un tier. |
| Tutor — Producto | 1 — N | Un tutor ofrece muchos productos. |
| Categoría — Producto | N — M | Un producto puede clasificarse en **varias** categorías; una categoría agrupa varios productos. |
| Tutor — Disponibilidad | 1 — N | Un tutor publica muchos bloques de disponibilidad. |
| Alumno (Usuario) — Reserva | 1 — N | Un alumno hace muchas reservas. |
| Producto — Reserva | 1 — N | Un producto puede reservarse muchas veces. |
| Reserva — Sesión | 1 — N | Una reserva genera de 1 a N sesiones (paquete → N; siempre 1 participante). |
| Reserva — Pago | 1 — 1 | Una reserva tiene un pago. `SUPUESTO S-04`. |
| Pago — Payout | Por definir | Modelo de agregación pendiente. `DECISIÓN PENDIENTE DP-06`. |
| Reserva — Reseña | 1 — 0..1 | Al completarse el servicio (todas sus sesiones), una reserva admite una reseña del alumno. |
| Tutor — Documento de verificación | 1 — N | Un tutor sube uno o más documentos. `SUPUESTO S-10`. |

---

## 0.5 Reglas de negocio (RN)

| ID | Regla |
| :-- | :-- |
| **RN-01** | Todo Usuario debe tener `timezone` definido (obligatorio en registro/onboarding). |
| **RN-02** | Las sesiones se almacenan en UTC y se muestran en la zona horaria local de cada usuario. |
| **RN-03** | La duración mínima de una sesión es 30 minutos. |
| **RN-04** | Un Tutor solo puede publicar/ofrecer Productos tras ser aprobado manualmente por un Admin. |
| **RN-05** | La verificación de identidad del tutor es manual al inicio (subir documento → "en revisión" → aprobado/rechazado), diseñada para automatizarse. |
| **RN-06** | Cada Tutor pertenece a exactamente un Tier; el Tier define el `% split` de ganancias. |
| **RN-07** | El Admin puede editar el split de cada Tier y crear nuevos Tiers. `SUPUESTO S-08`: aplica a reservas nuevas (no retroactivo). |
| **RN-08** | El split se aplica sobre el cobro según el Tier del Tutor, **independiente del proveedor de pago**. |
| **RN-09** | Un Producto pertenece a un Tutor y a **una o más** Categorías (clasificación N—M). |
| **RN-10** | Modelos de precio de Producto: por sesión, por hora, o por paquete de N clases. |
| **RN-11** | Las reglas de cancelación las define el Tutor (default a nivel tutor) y pueden sobreescribirse por Producto. |
| **RN-12** | Una Reserva genera de 1 a N Sesiones según el modelo de precio (paquete → N sesiones, **siempre 1 participante**). |
| **RN-13** | El Pago está atado a la Reserva; el monto se divide según el Tier (plataforma/tutor). |
| **RN-14** | El Payout se libera al Tutor tras el periodo de retención. `DECISIÓN PENDIENTE DP-02: 15 o 30 días`. |
| **RN-15** | La selección del proveedor de pago se resuelve mediante una **capa de enrutamiento configurable** (no acoplada al core). La **estrategia concreta** de proveedores por geografía es `DECISIÓN PENDIENTE DP-01`; recomendación Stripe-first + fallback. Ver `ENSEÑAME YA INFRAESTRUCTURA DE PAGOS.md`. |
| **RN-16** | La tabla de routing de proveedores vive en config/BD, **nunca hardcodeada**; activar un país/proveedor nuevo no toca el core. |
| **RN-17** | Una Reseña (1–5) se crea **por compra (Reserva)**, una sola vez, cuando el **servicio ofrecido se ha completado** (todas las Sesiones de la Reserva). El alumno reseña y puntúa al tutor. |
| **RN-18** | El acceso a la sala de video se habilita según fecha/hora/duración de la Sesión. `SUPUESTO S-07`: ventana de N min antes/después. |
| **RN-19** | Roles soportados: Alumno, Tutor, Admin; los permisos se aplican vía **RLS** en Supabase. |
| **RN-20** | El descubrimiento ocurre por dos vías: **descubrir tutores** y **descubrir productos por categoría**. |
| **RN-21** | **No se construye lógica interna de referidos.** Se configuran en plataforma externa (Referral Factory) y se **integran a nivel de frontend**; las reglas del programa son externas (`DP-04`). |
| **RN-22** | Las **clases grupales** (varios alumnos en una sesión) están **fuera de alcance**; un "paquete" es N sesiones 1:1 de un único participante. |

---

## 0.6 Supuestos (S)

| ID | Supuesto |
| :-- | :-- |
| **S-01** | El perfil de Alumno se modela como atributos sobre Usuario (o perfil ligero), sin entidad pesada separada. |
| **S-02** | ✅ **RESUELTO (2026-06-02):** un Producto puede tener **varias** categorías (N—M). Ver RN-09. |
| **S-03** | Existe una entidad **Disponibilidad** (bloques horarios) necesaria para reservar; su forma exacta se detalla en Doc 1. |
| **S-04** | Una Reserva tiene **un solo** Pago asociado (1:1). |
| **S-05** | ✅ **RESUELTO (2026-06-02):** la relación Pago↔Payout pasa a `DECISIÓN PENDIENTE DP-06`. |
| **S-06** | ✅ **RESUELTO (2026-06-02):** la Reseña es **por compra (Reserva)**, al completarse el servicio. Ver RN-17. |
| **S-07** | La ventana de acceso a la sala se abre N min antes del inicio y cierra N min después del fin (valores en Doc 5/6). |
| **S-08** | Los cambios de split de Tier aplican a **reservas nuevas** (no retroactivos). |
| **S-09** | Sentry (monitoreo) y SendGrid (email) de la propuesta se tratan como **candidatos**; el stack bloqueado no los fija (email detrás de interfaz; ver DP-05). |
| **S-10** | La verificación de identidad usa almacenamiento de **documentos** (Supabase Storage) ligado al Tutor. |
| **S-11** | La integración de referidos en frontend consume artefactos de Referral Factory (ej. enlace/código de registro); el detalle técnico se especifica en Doc 6. |

---

## 0.7 Decisiones pendientes (DP)

| ID | Decisión | Opciones / Recomendación | Impacto |
| :-- | :-- | :-- | :-- |
| **DP-01** | Proveedores de pago, corredores y estrategia de procesamiento | **Recomendación:** Stripe-first (todo lo posible con Stripe) + fallback al proveedor alterno por geografía cuando Stripe no soporte la ubicación del tutor/alumno. Ver `ENSEÑAME YA INFRAESTRUCTURA DE PAGOS.md` | Qué adaptadores se construyen primero; la capa agnóstica evita acoplar el core |
| **DP-02** | Periodo de retención de payout | 15 vs 30 días | Flujo de caja del tutor; máquina de estados de Payout |
| **DP-03** | Política de reembolsos | Por definir | Estados de Pago/Reserva; reglas de cancelación |
| **DP-04** | Reglas del programa de referidos (externo) | Referral Factory + integración frontend | Monto, conversión válida, límites de payout; sin lógica interna |
| **DP-05** | Herramienta de email | SendGrid u otra, detrás de interfaz | Implementación desacoplada |
| **DP-06** | Relación Pago ↔ Payout (modelo de agregación) | (a) un payout **agrupa varios pagos** por lote; (b) **un payout por pago** | Máquina de estados de Payout, conciliación, reportes del tutor |

---

## 0.8 Divergencias con la propuesta firmada (estado tras aclaración del cliente)

> Las 3 divergencias principales **quedaron aclaradas**. Se documentan para trazabilidad.

**✅ D-01 — Pagos → se trata como decisión pendiente (DP-01).**
La propuesta v1.1 nombra **Stripe** como procesador (secciones 1, 4.1.C, 4.4, 7). **Resolución acordada:** el tema de proveedores de pago **no se cierra en este documento**; se trata como `DP-01`. La **recomendación** es procesar todo lo posible con **Stripe** y, cuando se detecte que la ubicación del tutor o del alumno no es soportada por Stripe, enrutar al **proveedor alterno** según geografía. La **arquitectura agnóstica** (capa de adaptadores + `PaymentRouter` + tabla de routing en BD) se mantiene como **salvaguarda anti-acoplamiento**. Detalle y comparativa: `ENSEÑAME YA INFRAESTRUCTURA DE PAGOS.md`.

**✅ D-02 — Paquetes (confirmado por el cliente).**
La propuesta §5 lista "Paquetes, clases grupales" como fuera de alcance. **Aclaración del cliente:** son cosas distintas. Un **paquete** = **varias sesiones de un único participante** con el tutor (hacia un resultado) → **SÍ entra** al MVP como modelo de precio. Una **clase grupal** = varios estudiantes en una misma sesión → **sigue fuera de alcance**. *Impacto:* el modelo de Producto soporta paquetes 1:1; no se construyen sesiones multi-alumno.

**✅ D-03 — Referidos (confirmado por el cliente).**
La propuesta los incluye como integración (Referral Factory + Stripe; secciones 3, 4.4, 6, 11, 15). **Aclaración del cliente:** los referidos se configuran **directamente en una plataforma alterna** (Referral Factory) pero se **integran con el frontend** de la plataforma. Esto **evita construir lógica interna de referidos** y agiliza la configuración. *Impacto:* el desarrollo no implementa modelo de datos ni lógica de referidos; solo el **punto de integración en frontend** (ver Doc 6 / `S-11`). Las reglas del programa son externas (`DP-04`). **El cliente está claro en este punto.**

**🟡 D-04 — Comisión única → Tutor Tiers.** La propuesta habla de "configuración de comisión"; el modelo bloqueado introduce **Tiers** (3 niveles, split editable, crear tiers). Enriquecimiento, no contradicción.

**🟡 D-05 — Email: SendGrid → herramienta pendiente tras interfaz.** La propuesta nombra SendGrid (§17); el stack bloqueado deja la herramienta **pendiente** (`DP-05`) detrás de una abstracción. SendGrid queda como candidato.

---

## 0.9 Nota sobre diagramas

El **diagrama conceptual** (entidades y relaciones) se agregará en la **pasada final de diagramas**, una vez aprobado el contenido textual de todos los documentos del lote, conforme a la metodología acordada (contenido primero, diagramas al final). El `.md` es la fuente de verdad y el `.pdf` se regenerará en esa pasada.

---

*Fin del Documento 0.*
