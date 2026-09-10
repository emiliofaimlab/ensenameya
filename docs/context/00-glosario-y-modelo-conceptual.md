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
| **Estado** | Aprobado — manda en lo conceptual |
| **Pagos** | El vocabulario de cobro y payout lo fija `docs/DICTADO-PAGOS.md` |

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
| **Producto** | Oferta vendible del tutor. **La etiqueta en pantalla es "Mentoría"**, en singular y plural, y no "Tutoría" ni "Clase". Pertenece a un tutor y a una o más categorías. Tiene un modelo de precio. |
| **Modelo de precio** | Forma de cobro de un Producto: por sesión, por hora, o por paquete de N clases. |
| **Resultado (outcome)** | Logro concreto que persigue un paquete (ej. "aprobar el examen X"). Eje de la propuesta de valor. |
| **Paquete** | Modelo de precio = **N sesiones 1:1 de un único participante** con el tutor, hacia un resultado. **No** es clase grupal. |
| **Clase grupal** | Sesión con varios alumnos a la vez. **Fuera de alcance del MVP** (no confundir con paquete). |
| **Disponibilidad** | Bloques horarios que el tutor publica para ser reservado. |
| **Reserva (booking)** | Compra de un Producto por un alumno. Genera 1..N Sesiones y un Pago. |
| **Sesión / Clase** | Instancia agendada de una clase 1:1: fecha, hora inicio/fin (mín. 30 min), sala de video, estado. Se guarda en UTC. |
| **Sala de video** | Sala 1:1 de Daily asociada a una Sesión, habilitada según su horario. |
| **Pago (charge)** | Cobro al alumno atado a una Reserva. Se reparte según el split del Tier. El **formulario de pago vive siempre dentro del sitio**, nunca en una página del proveedor. |
| **Payout (liquidación)** | Transferencia de las ganancias al tutor tras el periodo de retención. |
| **Periodo de retención** | Días que la plataforma retiene los fondos antes de liberar el payout: **7 días**, en lote **semanal**. |
| **Riel** | Vía por la que se mueve el dinero. Cada riel dice qué **dato de cobro** pide al tutor (una cuenta bancaria o un identificador), **quién ejecuta** (un proveedor o una persona) y si está atado a un balance. Los rieles son `stripe`, `dlocal`, `wise`, `paypal`, `manual` y `banco-manual`. |
| **Proveedor de pago (`PaymentProvider`)** | El adaptador de un riel, detrás de una interfaz común. Los que ejecutan por máquina exponen `charge()` y/o `payout()`; los que ejecuta una persona no exponen ninguno de los dos. |
| **Pasarela de cobro** | El riel que le cobra al alumno. **La decide el país del ALUMNO**, por fees. |
| **Riel de payout** | El riel que le paga al tutor. **Lo decide el país del TUTOR**, y es una lista ordenada por fee: el primero que pueda pagarle es el que ejecuta. |
| **Banco (tarjeta de cobro del tutor)** | Una sola opción en la pantalla del tutor, con **un solo formulario**, detrás de la cual compiten **Wise, Stripe y dLocal**. El tutor nunca sabe cuál ejecutó: su historial dice «Transferencia bancaria». |
| **Método manual** | Zinli, Zelle o Binance. Lo cierra una persona desde el panel admin. **Solo Venezuela**, que es el único país que ninguno de los tres rieles automáticos alcanza. |
| **Corredor (corridor)** | Combinación país-de-cobro × país-de-payout. ⚠️ Las dos puntas se resuelven **por separado y con claves distintas**: el corredor no elige un proveedor, elige dos. |
| **Balance de origen (`funding_provider`)** | De qué saldo sale el dinero de un payout. Los rieles atados a balance (dLocal, Stripe) solo pueden pagar lo que ellos mismos cobraron; Wise y PayPal se fondean desde nuestro banco. |
| **Orquestación de pagos** | Enrutar cobro y payout por geografía con la tabla de ruteo en BD. ⚠️ Tocar esa tabla es una **migración**, no un `UPDATE`. |
| **Reseña** | Calificación 1–5 que deja el alumno **por compra**, una vez **completado el servicio** (todas las sesiones de la reserva). |
| **Onboarding** | Flujo de creación de perfil (alumno: preferencias/pago; tutor: bio, categorías, documentos, oferta inicial). |
| **Verificación de identidad** | Revisión manual de documentos del tutor (subir → "en revisión" → aprobado/rechazado). Diseñada para automatizar luego. |
| **RLS (Row Level Security)** | Mecanismo de Supabase/Postgres para restringir filas por rol/usuario. Base de la matriz de permisos (Doc 3). |
| **OAuth** | Autenticación delegada (Google) además de email. |
| **UTC / timezone** | Las sesiones se almacenan en UTC y se muestran en la zona horaria local de cada usuario. |
| **Referido (referral)** | Captación gestionada en **plataforma externa** (Referral Factory), **integrada al frontend**. Sin lógica interna en el MVP. ⚠️ Y sin **atribución**: quién trajo a quién se queda entero en esa plataforma. |
| **MVP** | Primera versión funcional lista para operar y validar el modelo. |

---

## 0.3 Entidades del dominio

> Descripciones conceptuales. El **diccionario de campos** (tipos, llaves, nullability, índices) va en el **Doc 1**.

**Entidades núcleo:**

1. **Usuario** — base de identidad; roles Alumno/Tutor/Admin; auth Google+email; `timezone` obligatorio.
2. **Tutor** — extensión de perfil de un Usuario con rol Tutor: bio, categorías, documentos, estado de aprobación, estado de verificación de identidad; pertenece a un Tier.
3. **Tutor Tier** — nivel con `% split`; editable; el admin puede crear nuevos tiers.
4. **Categoría** — área temática; eje de descubrimiento; gestionada por admin.
5. **Producto** — oferta vendible; pertenece a un tutor y a **una o más** categorías; modelo de precio. **Las reglas de cancelación no son suyas**: son únicas de plataforma (RN-37).
6. **Disponibilidad** — bloques horarios publicados por el tutor. `SUPUESTO S-03`.
7. **Reserva** — compra de un Producto por un alumno; ancla del Pago; genera 1..N Sesiones.
8. **Sesión / Clase** — instancia agendada; UTC; sala Daily; estado.
9. **Pago** — cobro atado a la Reserva; lleva el split aplicado.
10. **Payout** — liquidación al tutor tras retención.
11. **Reseña** — rating 1–5 ligado a una **Reserva** completada (una por compra).

**Entidades de soporte / configuración:**

12. **Documento de verificación** — archivo(s) que sube el tutor para KYC manual. `SUPUESTO S-10`.
13. **Tabla de routing de pagos** — la misma fila responde a **dos** preguntas con **dos** claves: quién cobra (país del alumno) y quién paga (país del tutor). Vive en BD, no hardcodeada, y se cambia con una migración.

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
| Pago — Payout | N — 1 | Un payout **agrupa** varios pagos. La clave de agrupación es (tutor, moneda, balance de origen), así que un tutor con cobros de dos corredores recibe **dos** órdenes de retiro. |
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
| **RN-11** | ⚠️ **Derogada por RN-37.** La política de cancelación y reembolso es **única de plataforma**, no la define el tutor ni se sobrescribe por producto: ≥24 h = 100 %, <24 h por el alumno = 50 %, cancelada por el tutor = 100 %. Vive en `src/lib/policy.ts` y se muestra en el perfil y en el checkout. |
| **RN-12** | Una Reserva genera de 1 a N Sesiones según el modelo de precio (paquete → N sesiones, **siempre 1 participante**). |
| **RN-13** | El Pago está atado a la Reserva; el monto se divide según el Tier (plataforma/tutor). |
| **RN-14** | El Payout se libera al Tutor tras el periodo de retención: **7 días**, en lote semanal. El tutor puede además pedir su retiro él mismo sobre saldo con retención ya vencida (RN-40). |
| **RN-15** | **El cobro lo decide el país del ALUMNO y el payout el del TUTOR.** Las dos puntas se resuelven contra la misma tabla de ruteo con claves distintas, y cada una devuelve una **lista ordenada por fee**, no un proveedor único. Fuente: `docs/DICTADO-PAGOS.md`. |
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
| **S-09** | ✅ **Resuelto:** monitoreo = **Sentry** (instalado, apagado sin DSN) y correo = **Resend** (DP-05). Los dos siguen detrás de su configuración: la clave es el interruptor. |
| **S-10** | La verificación de identidad usa almacenamiento de **documentos** (Supabase Storage) ligado al Tutor. |
| **S-11** | La integración de referidos en frontend consume artefactos de Referral Factory (ej. enlace/código de registro); el detalle técnico se especifica en Doc 6. |
| **S-38** | **i18n del MVP en español**, con los textos centralizados para una localización futura. El `locale` viaja en el puerto de correo (Doc 6 §6.11) y las fechas se renderizan en el `timezone` del destinatario (RN-02). *Absorbido del Doc 5, retirado.* |
| **S-44** | Las **estadísticas del admin se calculan sobre vistas**, no sobre consultas a las tablas base, por rendimiento. ⚠️ Toda vista lleva `with (security_invoker = true)` y columnas explícitas: sin eso corre con los privilegios de su dueño y publica lo que la RLS tapaba. *Absorbido del Doc 5, retirado.* |

---

## 0.7 Decisiones pendientes (DP)

> Estado consolidado y detalle de cada una en **Doc 9 §9.2**. Aquí solo el veredicto conceptual.

| ID | Decisión | Estado |
| :-- | :-- | :-- |
| **DP-01** | Proveedores de pago y corredores | ✅ **Cerrada** por `docs/DICTADO-PAGOS.md`: cobro por país del alumno (dLocal o Stripe), payout por país del tutor (PayPal, y Wise → Stripe → dLocal detrás de «Banco»), manual solo Venezuela. |
| **DP-02** | Periodo de retención de payout | ✅ **Cerrada**: 7 días, lote semanal. |
| **DP-03** | Política de reembolsos | ✅ **Cerrada** por **RN-37**: ≥24 h = 100 %, <24 h por el alumno = 50 %, cancelada por el tutor = 100 %. |
| **DP-04** | Reglas del programa de referidos (externo) | 🔴 **Abierta**, y condicionada a que la atribución no existe. |
| **DP-05** | Herramienta de email | ✅ **Cerrada**: **Resend**. |
| **DP-06** | Relación Pago ↔ Payout | ✅ **Cerrada**: **por lote**, agrupando por tutor, moneda y balance de origen. |
| **DP-07** | Moneda de liquidación y FX | 🟡 **Abierta** (surgió en Doc 6). |
| **DP-08** | Política de inasistencia (no-show) | 🔴 **Abierta** (surgió en Doc 2). |

---

## 0.8 Divergencias con la propuesta firmada (estado tras aclaración del cliente)

> Las 3 divergencias principales **quedaron aclaradas**. Se documentan para trazabilidad.

**✅ D-01 — Pagos: Stripe único → cuatro rieles con ruteo en datos.**
La propuesta v1.1 nombraba **Stripe** como único procesador. Lo que se construyó es una capa
agnóstica con **cuatro rieles automáticos** —Stripe, dLocal, Wise y PayPal— más un riel manual para
Venezuela, y el ruteo en la tabla `payment_routing_rules`. La divergencia queda cerrada: la
salvaguarda anti-acoplamiento no solo se mantuvo, se usó. Detalle: `docs/DICTADO-PAGOS.md`.

**✅ D-02 — Paquetes (confirmado por el cliente).**
La propuesta §5 lista "Paquetes, clases grupales" como fuera de alcance. **Aclaración del cliente:** son cosas distintas. Un **paquete** = **varias sesiones de un único participante** con el tutor (hacia un resultado) → **SÍ entra** al MVP como modelo de precio. Una **clase grupal** = varios estudiantes en una misma sesión → **sigue fuera de alcance**. *Impacto:* el modelo de Producto soporta paquetes 1:1; no se construyen sesiones multi-alumno.

**🟡 D-03 — Referidos (confirmado en el diseño, incompleto en el hecho).**
La propuesta los incluye como integración (Referral Factory + Stripe; secciones 3, 4.4, 6, 11, 15). **Aclaración del cliente:** los referidos se configuran **directamente en una plataforma alterna** (Referral Factory) pero se **integran con el frontend** de la plataforma. Esto **evita construir lógica interna de referidos** y agiliza la configuración. *Impacto:* el desarrollo no implementa modelo de datos ni lógica de referidos; solo el **punto de integración en frontend** (ver Doc 6 / `S-11`). Las reglas del programa son externas (`DP-04`). ⚠️ **Lo que no está resuelto es la atribución**: la plataforma externa no devuelve al referido con un código, así que hoy nada dentro de la app sabe quién trajo a quién. Ver Doc 9, RISK-08.

**🟡 D-04 — Comisión única → Tutor Tiers.** La propuesta habla de "configuración de comisión"; el modelo bloqueado introduce **Tiers** (3 niveles, split editable, crear tiers). Enriquecimiento, no contradicción.

**✅ D-05 — Email: SendGrid → Resend.** La propuesta nombraba SendGrid (§17). El puerto se mantuvo y detrás quedó **Resend**, que es el único de los candidatos que deja enviar y probar sin dominio verificado. SendGrid no se usó.

---

## 0.9 Nota sobre diagramas

El **diagrama conceptual** (entidades y relaciones) se agregará en la **pasada final de diagramas**, una vez aprobado el contenido textual de todos los documentos del lote, conforme a la metodología acordada (contenido primero, diagramas al final). El `.md` es la fuente de verdad y el `.pdf` se regenerará en esa pasada.

---

*Fin del Documento 0.*
