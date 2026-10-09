# Academias · Requerimientos para desarrollo

| | |
| :-- | :-- |
| **Para** | José Mora |
| **De** | FaimLab (Emilio) |
| **Fecha** | 2 de octubre de 2026 |
| **Base** | `main` con 216 migraciones (la última es `20260925200000`) |
| **Manda sobre** | `docs/B2B-ACADEMIAS.md` y la cabecera de `20260915180000_las_academias_agrupan_tutores.sql`: las dos dicen que la academia «no cobra, no recibe payouts y no tiene mentorías propias». **Eso deja de ser cierto con este documento.** |
| **Origen** | Doc 35 v2 (FaimLab) + respuestas del cliente + decisiones de Emilio del 2-oct |

> **Cómo leerlo.** El §1 es el modelo en diez líneas. El §2 recoge las reglas de negocio (`RA-xx`), que son lo que no se negocia. Del §3 al §8 está lo que hay que construir, fase por fase, con sus criterios de aceptación. El §9 es lo que **no** se construye. Si algo de aquí choca con el código, manda la regla de negocio y se avisa a Emilio. Si choca con una regla de oro de `CLAUDE.md`, manda la regla de oro y también se avisa.

## 1. El modelo en doce líneas

1. Una **academia** es una organización que el admin de EY da de alta desde el panel. No hay registro público.
2. Tiene **un administrador** (`academies.owner_id`), que entra a un portal propio, `/academia`.
3. La academia tiene **tutores** (cuentas solo de academia), **alumnos** (su lista) y **ofertas** (`products` con `academy_id`).
4. Cada oferta es **pública** (marketplace + página de la academia) o **privada** (solo para los alumnos de su lista), y puede ser **gratuita** (precio 0) o **de pago**.
5. Lo que se cobra por EY se le paga **a la academia**: una orden de pago cuyo beneficiario es su administrador, por los rieles actuales (PayPal o Banco). La academia paga a sus tutores por fuera.
6. EY cobra a la academia **un porcentaje por academia**, que el admin de EY puede cambiar y que se congela en cada reserva. El cargo de servicio del 5 % que paga el alumno se aplica igual.
7. **Los horarios de los tutores los pone la academia.** El tutor solo puede pedir días libres o bloqueos.
8. **El admin de EY ve y puede hacer todo** lo que puede hacer la academia, además de crear y suspender academias, fijar la comisión y aprobar cambios.
9. EY aprueba **los cambios del perfil público** de la academia y **la identidad de cada tutor nuevo**. Todo lo demás lo publica la academia sola.
10. A las academias **no les aplican** ni los referidos, ni los créditos, ni los regalos, ni los niveles (tiers) de tutor.
11. **El acuerdo EY–academia queda abierto** (RA-21/22): lo rellena EY al dar de alta la academia, sin valores por defecto.
12. **Cada oferta combina tres ajustes** (RA-23 a 25): pública o privada, gratis o de pago, y la reserva el alumno o la asigna la academia. Cualquier combinación vale.

## 2. Reglas de negocio

| ID | Regla |
| :-- | :-- |
| **RA‑01** | Las academias solo las crea el admin de EY. No hay formulario público |
| **RA‑02** | Cada academia tiene **un** administrador. Puede cambiarlo el admin de EY |
| **RA‑03** | Una cuenta de **tutor de academia** pertenece a una sola academia y **no puede vender por su cuenta**. Para ser tutor independiente se necesita **otra cuenta con otro correo**. Si el correo invitado ya es de un tutor independiente, la invitación se rechaza con ese mensaje |
| **RA‑04** | El tutor de academia solo sube el **documento de identidad** (`id_document`). EY lo aprueba en la cola de siempre. Con eso queda activo (`approval_status = 'approved'`). La competencia la responde la academia |
| **RA‑05** | Las ofertas, los precios, los horarios, la visibilidad y los alumnos los gestiona la academia **sin aprobación de EY** |
| **RA‑06** | Los cambios del **perfil público** de la academia (nombre, lema, descripción, logo, portada, color, web, enlace a políticas) quedan **pendientes** hasta que EY los aprueba. Mientras tanto se sigue mostrando la versión anterior |
| **RA‑07** | Una oferta **privada** solo la ve y la reserva un alumno que esté **activo en la lista** de esa academia. Cualquier otra persona recibe «Esta clase es solo para alumnos de {academia}» |
| **RA‑08** | Una oferta de academia puede costar 0. Con importe 0 el checkout no pide tarjeta (ya funciona así desde `20260921120000`) |
| **RA‑09** | Al reservar se **congelan** en `bookings` la academia (`academy_id`), su comisión (en `tier_split_pct`, como hoy el nivel) y su país de cobro (`payee_country`) |
| **RA‑10** | El dinero de una reserva con `academy_id` es **de la academia**. No entra ni en el saldo del tutor ni en sus órdenes de pago |
| **RA‑11** | Los pagos a la academia van al **administrador** de la academia, a la cuenta PayPal o Banco que conecte en su portal, por los rieles del dictado de pagos. Con la misma retención y el mismo ciclo que los tutores |
| **RA‑12** | El cargo de servicio del 5 % al alumno **se aplica** a las ofertas de pago de academia. Con precio 0, el cargo es 0 |
| **RA‑13** | A las academias y sus ofertas **no les aplican referidos, créditos, regalos ni niveles de tutor**. El botón «Regalar esta mentoría» no aparece en sus ofertas |
| **RA‑14** | **Horarios:** solo la academia edita los horarios y bloqueos de sus tutores. El tutor los ve y puede **pedir** un día libre o un bloqueo. Si la academia lo acepta, se crea el bloqueo; si lo rechaza, no pasa nada y se le avisa al tutor |
| **RA‑15** | **Reasignar:** la academia puede cambiar el tutor de una reserva futura, siempre a otro tutor **suyo** y activo. Se avisa al alumno y a los dos tutores |
| **RA‑16** | Si la reserva reasignada **era de pago**, el alumno puede cancelarla con **reembolso del 100 %** hasta que empiece la sesión. Si **era gratuita**, no puede negarse: se le avisa y nada más, porque pueden ser clases obligatorias |
| **RA‑17** | Si un tutor sale de la academia, su perfil de tutor queda **inactivo** (la cuenta sigue existiendo como alumno), sus ofertas se pausan y sus reservas futuras se marcan **«Sin tutor: reasignar»**. La academia las reasigna, las reagenda o las cancela. Hasta entonces siguen siendo de la academia |
| **RA‑18** | Si la academia cancela, aplica la regla de cancelación **por parte del tutor** (RN-37): reembolso completo al alumno |
| **RA‑19** | El administrador de la academia **puede leer, sin escribir**, las conversaciones de chat de sus tutores, para vigilar la seguridad y el cumplimiento de los términos. **Los dos participantes ven un aviso fijo en esa conversación**: «{Academia} puede ver esta conversación» |
| **RA‑20** | Una academia **suspendida** desaparece del público y no admite reservas nuevas. Las reservas existentes siguen su curso. Una academia **solo se elimina si no tiene reservas**; si las tiene, se suspende |
| **RA‑21** | **El acuerdo EY–academia queda abierto.** No hay valores por defecto: hoy no hay ningún acuerdo firmado. El admin de EY rellena las condiciones al dar de alta la academia y las puede cambiar en cualquier momento: comisión sobre las clases de pago, cuota fija (monto, moneda y periodicidad; **se factura fuera de la plataforma**), clases gratuitas incluidas, fecha de inicio y notas. Los cambios **solo afectan a las reservas nuevas** |
| **RA‑22** | **Sin comisión fijada, la academia solo puede publicar ofertas gratuitas.** En cuanto EY fija la comisión, se habilitan las de pago. *(SUPUESTO S‑35.4: recomendación tomada por defecto; Emilio puede cambiarla)* |
| **RA‑23** | **Cada oferta de academia se configura con tres ajustes independientes, y se permite cualquier combinación:** visibilidad (**pública** / **privada**) · precio (**gratis** / **de pago**; el de pago exige comisión, RA‑22) · agenda (**la reserva el alumno** / **la asigna la academia**). Ejemplos válidos: privada de pago, pública gratuita, asignada de pago, asignada gratuita |
| **RA‑24** | **Agenda asignada.** La academia asigna a un alumno **de su lista** un horario semanal fijo (días, hora y rango de fechas) con el tutor de la oferta, y la plataforma crea todas las sesiones. Es **siempre 1 a 1** (nada grupal; se estudiará aparte). El alumno las ve como «Clase obligatoria · {Academia}» y **no puede cancelarlas ni reagendarlas**: solo la academia. Si la oferta es pública, el resto de alumnos la pueden reservar con normalidad; la asignación es una vía más, no la única |
| **RA‑25** | **Asignada y de pago:** la reserva nace en `pending_payment`, al alumno le llega un correo y paga desde «Mis reservas» por el checkout de siempre. Estas reservas **no las caduca** `expire_stale_bookings`: la academia ve «Pendiente de pago» y decide si la cancela. **Todos los alumnos se registran con normalidad**, sin accesos especiales: la invitación lleva al registro con su correo, y si ya tienen cuenta quedan vinculados al momento |

## 3. Fase 1 · Base de datos y dinero

Es la única fase que toca dinero. **Se despliega y se comprueba sola** antes de empezar la 2.

### 3.1 Esquema

| Objeto | Cambio |
| :-- | :-- |
| `academy_status` | + `'suspended'`. `draft` y `active` siguen igual |
| `academies` | + `owner_id uuid references profiles(id)`, nulo hasta que el administrador acepta · `commission_pct numeric(5,2)` **nulo** = sin acuerdo (RA‑22): el **% que se queda la academia**, con la misma semántica que `tier_split_pct` · `fixed_fee_amount bigint`, `fixed_fee_currency char(3)`, `fixed_fee_period text` (informativos, RA‑21) · `included_free_classes text` · `agreement_starts_on date` · `payout_country char(2)` · `cover_path text` · `policies_url text` · `pending_changes jsonb` (RA-06) · `allow_public_offers boolean default true` (permiso de EY) · `agreement_notes text` (solo admin: lo que se pactó, RA-21) |
| `academy_members` | **Nueva.** `academy_id`, `email citext`, `profile_id` (nulo hasta aceptar), `role` (`admin` / `tutor` / `student`), `status` (`invited` / `active` / `removed`), `invited_at`, `accepted_at`, `token`. Única por (`academy_id`, `email`, `role`). Es a la vez la lista de alumnos y la tabla de invitaciones |
| `products` | + `academy_id uuid references academies(id)` (nulo = oferta de tutor independiente) · `visibility text not null default 'public' check (visibility in ('public','private'))` · `assignment_mode text not null default 'booking' check (assignment_mode in ('booking','assigned'))` · checks: `visibility = 'private'` y `assignment_mode = 'assigned'` exigen `academy_id`. **No hay más restricciones entre los tres ajustes** (RA‑23) |
| `bookings` | + `academy_id uuid references academies(id)`, **congelado** (RA-09) · + `needs_reassignment boolean default false` (RA-17) · + `mandatory boolean default false` (RA-24: bloquea la cancelación y la reagenda **del alumno**) |
| `payouts` | + `academy_id uuid references academies(id)`. `tutor_id` sigue siendo **el beneficiario** (el `owner_id` de la academia): así todo lo que resuelve la cuenta de destino por `tutor_id` funciona sin tocarlo. Hay que actualizar el `comment on column` |
| `availability_requests` | **Nueva.** `tutor_id`, `academy_id`, `date`, `start_time`, `end_time` (opcionales, igual que en `availability_exceptions`), `reason`, `status` (`pending` / `accepted` / `rejected`), `decided_by`, `decided_at` |

Las reglas de oro aplican tal cual: RLS default-deny en las tablas nuevas, grants explícitos (también a `service_role`, regla 9), `comment on` con el porqué y FK nombradas en los embeds.

⚠️ **Regla 10:** `academy_members` une `profiles` con `academies`, y `tutor_profiles` también apunta a las dos. Hay que revisar los embeds `profiles ↔ academies` existentes (catálogo y admin) **antes** de desplegar.

### 3.2 Funciones que cambian

| Función | Cambio |
| :-- | :-- |
| `create_booking_line` (última versión en `20260901140000`) | Si `products.academy_id` no es nulo: rechaza la reserva si la academia no está `active`; si la oferta es `private`, exige que el alumno esté en la lista activa (RA-07); si la oferta es de pago y `commission_pct` es nulo, la rechaza (RA‑22); si la llama `academia_asignar_horario`, exige que el alumno esté en la lista activa y marca `mandatory = true` (RA‑24); toma `v_split` de `academies.commission_pct` en lugar del nivel; toma `payee_country` de `academies.payout_country`; escribe `bookings.academy_id` |
| `build_payout_for_tutor` | + `and b.academy_id is null`. El crédito de recompensa sigue igual |
| `build_payout_for_academy(p_academy, p_retention_days, p_status)` | **Nueva**, gemela de la anterior: agrupa por `b.academy_id = p_academy` e inserta `payouts` con `tutor_id = owner_id` y `academy_id = p_academy`. Sin bloque de créditos (RA-13) |
| `tutor_balance` | Excluye las reservas con `academy_id` |
| `payouts-process` (cron) y `generate_*` que llaman al builder | También recorren las academias activas con `owner_id` |
| `expire_stale_bookings` | No caduca las reservas con `mandatory = true` (RA‑25) |
| `cancel_booking`, `proponer_reagenda` | Si `bookings.mandatory` y quien llama es el alumno: rechazo con «Esta clase es obligatoria; habla con {academia}» (RA-24) |
| `aplicar_credito`, `comprar_regalo` | Rechazan reservas y ofertas con `academy_id` (RA-13) |
| `referral_conversions_pending` | No cuenta como conversión ni un pago de academia ni una sesión de un tutor de academia |
| Política de `products` (select) | Una fila `private` solo la leen: los alumnos activos en la lista de esa academia, el tutor asignado, el `owner_id` y el admin de EY. Las `public` no cambian |

⚠️ **Regla 12:** las funciones que cambian de argumentos se hacen con `drop` + `create`, y se reponen los `grant execute`.

### 3.3 Criterios de aceptación (Fase 1)

Se comprueban contra dev, en transacciones revertidas, como el 16-sep:

1. Una oferta de academia de 2000 con comisión del 80 % cobra 2100 al alumno (5 % de servicio), congela `tier_split_pct = 80` y `academy_id`, y el `tutor_net_amount` es 1600.
2. Esa reserva, ya completada y con la retención vencida, aparece en `build_payout_for_academy` con beneficiario el `owner_id`, y **no aparece** en `tutor_balance` ni en `build_payout_for_tutor` del tutor que la impartió.
3. Si se cambia `commission_pct` después, la reserva anterior no cambia.
4. Una oferta privada no la devuelve ninguna consulta como `anon`, ni como un alumno que no está en la lista. Sí la devuelve como alumno de la lista. Y `create_booking_line` rechaza al alumno que no está en la lista.
5. Una oferta de academia a 0 se reserva sin tarjeta y no genera orden de pago.
6. `aplicar_credito` y `comprar_regalo` rechazan las ofertas de academia.
7. El invariante `gross = platform_fee + tutor_net + service_fee` se cumple en todas las filas nuevas.
8. `npm run db:types`, typecheck, lint y las comprobaciones (`check:*`) en verde.

## 4. Fase 2 · Sección «Academias» del panel de admin de EY

Ruta `src/app/(app)/admin/academias/`, con su **entrada en el menú desde el primer día** (que no se repita lo de `/admin/notificaciones`).

| Pantalla | Requisitos |
| :-- | :-- |
| **Listado** | Todas las academias con filtros por estado, país y actividad (última reserva). Columnas: nombre, administrador, tutores, alumnos, reservas del mes, ingresos del mes, estado. Botón «Crear academia» |
| **Crear / editar** | Nombre, slug, datos de perfil, `payout_country` y el bloque **«Acuerdo»** (RA-21), con todos los campos opcionales y editables: comisión, cuota fija, clases gratis incluidas, fecha de inicio y notas. Mientras la comisión esté vacía, se ve el aviso «Sin acuerdo: solo ofertas gratuitas». **Administrador por correo:** si el correo tiene cuenta, se vincula; si no, se crea una invitación (`academy_members` con `role = 'admin'`) y la academia queda `draft` hasta que la acepta |
| **Permisos** | Cambiar de administrador · `allow_public_offers` · suspender o reactivar (RA-20) · eliminar (solo sin reservas) |
| **Aprobaciones** | Lista de academias con `pending_changes`: antes y después, con aprobar (aplica los cambios y vacía `pending_changes`) o rechazar con motivo. Los tutores de academia entran en la **cola de verificación existente** con la etiqueta «Academia X · solo identidad» (RA-04) |
| **Ver como la academia** | Botón que abre las pantallas de la Fase 3 sobre esa academia. **No se construyen dos veces:** las funciones `academia_*` aceptan al `owner_id` **o** a `has_role('admin')` |

Todas las escrituras van por RPC `security definer` que comprueban `has_role('admin')`. **Ninguna política de escritura para el cliente** en `academies`.

**Criterios de aceptación:** el admin crea una academia con un correo sin cuenta → llega la invitación → al registrarse, el administrador queda como `owner_id` y la academia pasa a `active`. Un cambio de perfil hecho desde el portal no se ve en `/academias/<slug>` hasta que se aprueba.

## 5. Fase 3 · Portal de la academia (`/academia`)

**Acceso:** quien sea `owner_id` de una academia que no esté suspendida. El enlace en el menú aparece solo para esa persona. **Sin rol nuevo en `app_role`.** Acordarse de la regla 13: el destino se resuelve en servidor.

**Seguridad:** el portal **no abre RLS en las tablas existentes**. Todo pasa por funciones `academia_*(p_academy, …)`, `security definer`, y cada una empieza comprobando `owner_id = auth.uid() or has_role('admin')`. Así hay **un solo lugar** que auditar.

| Pantalla | Requisitos |
| :-- | :-- |
| **Resumen** | Estadísticas del §8 y pendientes: días libres por decidir, reservas «Sin tutor», invitaciones sin aceptar, perfil en revisión |
| **Perfil** | Edita los campos de RA-06; al guardar va a `pending_changes` y se ve «En revisión». Sube el logo y la portada al bucket `avatars` en la carpeta `academies/<id>/`, lo que exige una **política de storage nueva** para el `owner_id` |
| **Tutores** | Invitar por correo (RA-03) · estado invitado → identidad en revisión → activo · editar su ficha pública (nombre visible, foto, presentación, materias) · dar de baja (RA-17) |
| **Horarios** | Calendario semanal por tutor: reglas (`availability_rules`) y bloqueos (`availability_exceptions`), escritos por `academia_guardar_horario()` · bandeja de `availability_requests` con aceptar o rechazar |
| **Ofertas** | Crear, editar, pausar y archivar. Campos: tutor asignado (solo tutores activos de la academia), título, descripción, categorías, precio (0 permitido), moneda, duración, paquete, visibilidad (`public` solo si `allow_public_offers`). `products.tutor_id` = el tutor asignado; `academy_id` = la academia |
| **Alumnos** | Pegar varios correos (uno por línea) → una fila `academy_members` por correo. Si el correo ya tiene cuenta, se vincula y queda `active` al momento; si no, queda `invited` hasta que se registra con ese correo. Dar de baja = `removed`: deja de ver las privadas, y sus reservas ya hechas siguen |
| **Reservas** | Todas las de sus ofertas, con filtros por tutor, estado, fecha y oferta. Acciones: **reasignar** (RA-15/16), **reagendar** (con el flujo `proponer_reagenda` de `20260925120000`, actuando como la parte tutor) y **cancelar** (RA-18) |
| **Chat** | Solo lectura de las conversaciones de sus tutores (RA-19). Mismo visor que el admin de EY, sin caja de respuesta |
| **Ingresos** | Cobrado, comisión de EY, neto, pendiente de pago y órdenes de pago con su estado. Debajo, **«Mis cuentas»** reutilizado (PayPal / Banco) para el `owner_id` |

⚠️ **Verificar antes de reutilizar «Mis cuentas»:** el formulario y el ruteo leen hoy `tutor_profiles.payout_country`. Para la academia el país sale de `academies.payout_country`. Revisar `metodos-de-cobro.tsx`, `riel-viable.ts` y el job `payouts-process` para que el `owner_id` **no necesite** fila en `tutor_profiles`.

**Ajustes de cada oferta y agenda asignada (RA-23 a RA-25):**
- **Ofertas:** el formulario tiene los tres ajustes como controles independientes: visibilidad, precio (0 = gratis) y agenda («La reserva el alumno» / «La asigna la academia»). Si no hay comisión fijada, «de pago» aparece desactivado con el motivo (RA‑22).
- **Alumnos → Asignar horario:** se elige el alumno de la lista, una oferta con agenda «La asigna la academia», los días de la semana, la hora y el rango de fechas. `academia_asignar_horario()` crea **una reserva tipo paquete** con todas las sesiones: a 0 si es gratis (camino gratuito ya existente) o en `pending_payment` si es de pago. Reutiliza `create_booking_line`, así que no hace falta un modelo nuevo. El candado de solape (`20260831180000`) impide pisar otra clase del tutor; si un hueco choca, la función devuelve la lista de fechas en conflicto y no crea nada.
- **Editar o quitar una asignación:** mueve o cancela las sesiones futuras. Las pasadas no se tocan. Si estaba pagada, se aplica el reembolso de una cancelación por parte del tutor (RA-18).
- **Estadísticas:** se añade la **asistencia** por alumno en las clases asignadas (sesiones completadas frente a ausencias).

**Panel del tutor de academia:** el mismo `/tutor`, con estas diferencias:
- Arriba, un aviso: «Das clases con {Academia}».
- **Ocultos:** Mis pagos, crear o editar mentorías, nivel y referidos.
- **Disponibilidad en solo lectura**, con el botón «Pedir día libre».
- El onboarding solo pide la identidad.

**Avisos en el chat:** en toda conversación con un tutor de academia, los dos lados ven el aviso de RA-19.

**Criterios de aceptación:**
- El administrador de la academia A **no puede** leer nada de la academia B llamando a las RPC con el id de B. Hay que probarlo explícitamente.
- Un tutor de academia no puede escribir en `availability_rules` (ni por la pantalla ni por la API).
- Al reasignar una reserva pagada, el alumno puede cancelarla con el 100 %; al reasignar una gratuita, no aparece esa opción.
- El calendario de Google de los dos tutores se actualiza solo tras reasignar.

## 6. Fase 4 · Lo público y el alumno

| Pieza | Requisitos |
| :-- | :-- |
| `/academias/<slug>` | + portada y enlace a las políticas · las ofertas privadas se muestran **solo** a quien está en la lista · una academia `suspended` devuelve 404 |
| Marketplace y búsqueda | Solo ofertas `visibility = 'public'`. Las de academia llevan «{Academia} · con {tutor}» |
| `tutors_public`, `/tutores` | Los tutores de academia **no** salen en el directorio general. Su ficha `/tutores/<slug>` existe y muestra solo las ofertas públicas de su academia, con la marca |
| `sitemap.ts` | Excluye privadas y academias suspendidas. Además, `npm run check:seo` en verde |
| Checkout | Si la oferta es de una academia: «Al reservar aceptas los [Términos de Enséñame Ya] y las [políticas de {Academia}]». Sin el botón «Regalar» (RA-13) |
| Panel del alumno (`/app`) | Nueva sección **«Mis academias»**: las academias en las que está activo y sus ofertas privadas |
| Invitación | El enlace del correo lleva al registro con el correo ya escrito; si ya hay sesión, a «Mis academias». La cookie y el flujo de `handle_new_user` vinculan `academy_members.profile_id` |

⚠️ Hay **~35 consultas a `products`** en `src/`: todas se revisan contra `visibility`. Que la RLS oculte las privadas a quien no está en la lista **no basta**: a un alumno de la lista también le saldrían en el marketplace general.

## 7. Correos nuevos

Con el sistema y las plantillas del Doc 33. Códigos provisionales a partir del último (NTF-39):

| Código | A quién | Cuándo |
| :-- | :-- | :-- |
| NTF-40 | Futuro administrador | EY lo nombra administrador de una academia |
| NTF-41 | Tutor | La academia lo invita |
| NTF-42 | Alumno sin cuenta | La academia lo invita |
| NTF-43 | Alumno con cuenta | La academia lo agrega a su lista |
| NTF-44 | Administrador | Perfil aprobado o rechazado (con el motivo) |
| NTF-45 | Administrador | Un tutor pidió un día libre |
| NTF-46 | Tutor | Su petición fue aceptada o rechazada |
| NTF-47 | Alumno + tutor anterior + tutor nuevo | Reserva reasignada. Al alumno, si es de pago, le dice que puede cancelar con el 100 % |
| NTF-48 | Administrador | Un tutor salió y hay reservas «Sin tutor» |
| NTF-49 | Alumno | La academia le asignó un horario (y, si es de pago, el enlace para pagarlo) |
| NTF-50 | Alumno | Su horario asignado cambió o se canceló |

Cada uno con su clave de idempotencia, como `GIFT:claim:<id>`.

## 8. Fase 5 · Estadísticas

Una función `academia_estadisticas(p_academy, p_desde, p_hasta, p_tutor default null)` que sirve al portal y al admin de EY:

- Ingresos: bruto, comisión de EY y neto de la academia.
- Reservas por estado y sesiones completadas.
- Cancelaciones (por quién) y ausencias.
- Alumnos activos, **separados entre los de la lista y los que llegaron por el marketplace**.
- Tutores activos y su ocupación (horas reservadas / horas disponibles).
- Calificación media.

En el admin de EY, además: comparativa entre academias y comisión total generada.

## 9. Fuera de alcance

- Pagar a una cuenta de empresa (razón social, beneficiario `BUSINESS` en Wise o dLocal).
- Varios administradores por academia, o roles finos (finanzas, agenda…).
- Un tutor en varias academias. Un precio distinto para miembros en la misma oferta (se resuelve con dos ofertas: una pública de pago y una privada gratuita).
- **Clases grupales** (un tutor con varios alumnos en la misma sesión): todo sigue siendo 1 a 1, como hoy. Se estudiará aparte.
- Accesos sin registro o sin contraseña: todos los alumnos se registran.
- Subdominio, dominio propio, marca blanca.
- Facturar cuotas B2B dentro de la plataforma (RA-21).
- Alta masiva por CSV o códigos de acceso.
- Referidos para academias.
- Registro público de academias.

## 10. Estimación

Calculada sobre el ritmo real del equipo con agentes (`PLAN-DESARROLLO.md`). Por ejemplo, referidos v2 se hizo en un día y Google Calendar en otro. Son **días hábiles de José con dedicación completa**, incluida la verificación contra dev de cada fase.

| Fase | Contenido | Días |
| :-- | :-- | :-- |
| 1 | Base de datos y dinero | 4 – 5 |
| 2 | Sección «Academias» del admin de EY (con el acuerdo abierto) | 3 – 4 |
| 3 | Portal de la academia (8 pantallas, invitaciones, horarios, reasignar, chat) | 7 – 9 |
| 3b | Agenda asignada (asignar horario, gratis o de pago, bloqueos del alumno, sin caducidad) | 3 – 4 |
| 4 | Lo público y el alumno (~35 consultas, «Mis academias», checkout) | 4 – 5 |
| 5 | Estadísticas (con asistencia) | 2 – 3 |
| — | 11 correos nuevos (NTF-40 a NTF-50) | 2 |
| — | QA integral con cuentas sembradas (como el Doc 34) y ajustes | 3 – 4 |
| | **Total** | **28 – 36 días hábiles ≈ 6 – 7 semanas** |

**Hitos intermedios:**
- **Una academia puede publicar y cobrar ofertas** cuando estén las fases 1, 2, 3 y 4: **~4,5 – 5 semanas**. La agenda asignada y las estadísticas pueden llegar después sin bloquearla.
- **Las clases asignadas** (el caso de un colegio) llegan con la fase 3b: **~5,5 semanas**.

**Lo que puede alargarlo:**
- Que el formulario «Mis cuentas» resulte más acoplado a `tutor_profiles` de lo previsto (§5, verificación). Puede sumar 1 – 2 días a la fase 3.
