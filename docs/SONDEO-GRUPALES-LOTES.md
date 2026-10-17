# Sondeo de clases grupales · plan de lotes

| | |
| :-- | :-- |
| **Fecha** | 16 de octubre de 2026 |
| **Rama** | `feat/grupales-academias` (no se mergea a `dev` ni a `main`: ver `PLAN-ACADEMIAS-Y-GRUPALES.md`) |
| **Origen** | Recorrido en vivo en local (build de producción contra la BD de dev: tutora + 4 alumnos por Stripe y dLocal, sala con 4 participantes, chat, baja, ciclo, reagenda) y auditoría de código de 7 tramos con verificación adversarial (94 hallazgos únicos, ninguno refutado) |
| **Total** | **112 hallazgos** en 11 lotes (0 a 10). Cada uno aparece **una sola vez** |

## Cómo se usa

- Cada hallazgo tiene un ID fijo: **B** (bloquea el piloto), **A** (alto), **M** (medio), **P** (pulido), **D** (entorno de dev).
- 🔴 = visto en vivo. Sin marca = confirmado en el código (y a veces en dev) por un verificador que intentó refutarlo.
- `aud. #n` = número del hallazgo en la auditoría. Sirve para comprobar que no falta ninguno.
- ⚖️ = necesita decisión de Emilio antes de construirlo. Se propone una opción por defecto.
- Al cerrar un hallazgo: marcar `[x]` y citar el ID en el commit (`fix(grupales): B1 · …`).
- **Reglas para todos los lotes:**
  - Antes de reescribir una función SQL, copiar la versión viva más reciente. Cada función se reescribe **una sola vez por lote** (por eso los lotes van agrupados por función, no por pantalla).
  - Si cambian los argumentos de una RPC, `drop` + `create` y reponer los `grant` (regla de oro 12).
  - Después, `npm run db:push` + `npm run db:types`.
  - Se verifica contra `npm run build` + `npm start`, nunca contra `next dev` (regla 13), con las cuentas `ga.*` de dev.
  - Si se toca un job de `pg_cron`, se revisa `cron.job_run_details` (regla 11).

## Resumen

| Lote | Qué cierra | Hallazgos | Estimación |
| :-- | :-- | --: | :-- |
| 0 | Preparación: entorno local y correos que se pierden | 4 | ½ día |
| 1 | Seguridad y corte de inscripción (BD) | 9 | 1 día |
| 2 | Bajas, reembolsos, mínimo y edición de la clase (BD + pantalla de baja) | 9 | 1 – 1½ días |
| 3 | Chat del grupo | 12 | 1 día |
| 4 | Sala: privacidad y lógica | 10 | 1 día |
| 5 | Sala: galería, moderación y pulido | 10 | 1 día |
| 6 | Avisos y correos | 11 | 1 día |
| 7 | Alumno: catálogo y ficha | 14 | 1 día |
| 8 | Alumno: checkout, regalo y su reserva | 16 | 1 – 1½ días |
| 9 | Tutor y admin | 17 | 1 – 1½ días |
| 10 | Re-sondeo completo | — | ½ – 1 día |
| | **Total** | **112** | **≈ 10 – 12 días** |

**Todos los bloqueantes (B1 a B12) se cierran en los lotes 0 a 5.** Del 6 en adelante se puede trabajar con el piloto ya en marcha.

**Orden.**
- Los lotes 0, 1 y 2 van seguidos y en ese orden: tocan el dinero y las mismas funciones SQL.
- Del 3 al 9 el orden recomendado es el de la tabla, pero se pueden reordenar.
- Nunca dos lotes a la vez en el mismo árbol: varios tocan `live-room.tsx`, `reservas/[id]/page.tsx` o `product-form.tsx`.

## Decisiones para Emilio (pedirlas antes del lote 2)

> **16-oct · Emilio confirmó además las tres reglas que fija el lote 2:** B6 (con la clase publicada, el cupo solo sube y nunca por debajo de los inscritos; mínimo, precio y duración fijos), B7 (el mínimo se revisa una sola vez a las 24 h y no se admite mínimo con la primera fecha a menos de 48 h) y M15 (la hora nueva de una reagenda también con 24 h o más, y el 100 % por reagenda solo para quien ya estaba inscrito).

| ID | Pregunta | Propuesta por defecto |
| :-- | :-- | :-- |
| M1 | ¿Qué recibe un alumno al que se saca a mitad de un ciclo? | ✅ **Decidido (Emilio, 16-oct):** solo las fechas que faltan (por tramos, como `cancelar_fecha_grupal`) |
| M14 | RG-11 frente a RG-16: si el tutor mueve una fecha de un ciclo ya empezado, ¿qué puede hacer el alumno? | Recuperar solo esa fecha (gross/N), no darse de baja del ciclo |
| M2 | ¿Un alumno expulsado de la sala puede volver a entrar? | No, en esa fecha. Sí en las siguientes del ciclo |
| M8 | ¿Se mantiene el chat privado alumno–tutor en las grupales? | Se mantiene, pero los hilos vacíos no se le muestran al tutor |
| A5 | ¿Desde cuándo se graba? | Desde la hora de inicio, no desde que entra el primero |
| M30 | ¿La grabación debe incluir el documento que presenta el tutor? | Sí: publicar el lienzo del visor como pista de video |
| P27 | ¿Adjuntos en el chat del grupo? | Solo el tutor |
| P31 | S-G-08: ¿las grupales entran al carrito? | Retirar S-G-08 por escrito (Outschool y Preply no lo hacen) |

---

## Lote 0 · Preparación (½ día) · ✅ hecho el 16-oct

Que el resto se pueda probar de punta a punta en local, y que ningún aviso se pierda al lanzar.

> **Hecho:** migración `20261017100000` (RPC `descartar_plantilla_desconocida`), `notifications-send` (pide 3 × 50 y envía como mucho 50; las cuentas `@ensenameya.dev` se marcan enviadas para que la campana las siga enseñando), `siteUrl(origen)` en el checkout, en el alta de tarjeta y en PayPal Connect, `scripts/dlocal-aviso-local.mjs` y las dos recetas en `ENTORNOS.md` §2 (incluida la de ver los correos: `SALIDA_CORREOS=<carpeta> npm run check:correos`).

- [x] **B12** 🔴 Los 5 correos grupales (NTF-51, 52, 54, 55 y 56) salen `failed` en dev: el reloj del correo lo ejecuta la rama `dev`, que no tiene esas plantillas, y `notifications-send/route.ts:233-238` marca `failed` **para siempre** cualquier plantilla que no conoce. Al lanzar, si la migración llega a prod antes que el código, se pierden los avisos de ese intervalo. → Que una plantilla desconocida quede `pending` (con una caducidad), y montar una vía para ver los correos grupales renderizados (`check:correos` o una vista previa local) sin depender del reloj de dev.
- [x] **D1** 🔴 En local, Stripe devuelve a `http://localhost:3000/...` aunque se use otro puerto (`site-url.ts:58`). → Fuera de Vercel, sacar el origen de la petición, o documentar `NEXT_PUBLIC_SITE_URL` en `.env.local`.
- [x] **D2** 🔴 En local, dLocal no puede avisar al webhook (sale a una URL local inalcanzable): el pago queda `pending` y el apartado caduca. → Documentar (o hacer un script de) cómo reenviar el aviso firmado del sandbox, que es lo que se hizo en el sondeo.
- [x] **D3** Las cuentas de QA `@ensenameya.dev` reciben correos reales que rebotan (el seed solo silencia los de bienvenida). → Marcar `failed` los correos a ese dominio desde el job de dev, o usar un buzón comodín.

## Lote 1 · Seguridad y corte de inscripción (1 día) · ✅ hecho el 16-oct

> **Hecho:** migración `20261017110000` (aplicada en dev y probada en transacciones revertidas) y el código de grabaciones, catálogo, checkout, ficha y reseñas. Además de lo previsto, salió de la revisión adversarial:
> - `precio_vigente_grupal()`: el mismo precio de cupo para `create_booking_line` **y** `comprar_regalo`. Un regalo comprado antes de que cancelaran una fecha pasa a saldo (causa `fecha_cancelada`).
> - La ficha, la tarjeta y el checkout anuncian ese mismo precio y las fechas vivas.
> - `products_protege_cierre`: el tutor no puede escribir `inscripcion_cierra_at` a mano.
> - El cron de regalos sale `failed` si falla un producto (regla 11).
> - `tutor_balance` también filtra los pagos de 0.
> - P33 cerrado también para `authenticated`.
> - B1 no le quita la grabación al tutor ni al admin.
> - Una grupal archivada no ofrece «Compartir mi reserva» y sus reseñas no enlazan a una ficha 404.
>
> M11 quedó **solo para grupales**: reservarse a uno mismo una 1:1 sigue siendo posible, como antes del sondeo, porque la ficha 1:1 aún no tiene su aviso de «es tuya».
>
> ⚠️ Verificado con `next dev` en el 3001 y no con el build: el `.next` de producción lo estaba sirviendo otra sesión en el 3003. Antes de mergear, repasar contra `npm run build`.

Funciones que se reescriben: `create_booking_line`, `comprar_regalo` (solo el corte), `get_available_slots`, `close_expired_sessions`, `build_payout_for_tutor` / `run_payout_batch`, la vista `group_classes_public` y la Route Handler de grabaciones.
Esta vista gana dos columnas: `inscripcion_cierra_at` y `min_seats` (la usa el lote 7). `inscritos_pagados` se deja para el lote 6 (M17), que es quien la usa.

- [x] **B1** 🔴 La grabación de una clase se entrega a quien no está inscrito (baja con reembolso, o checkout abandonado). En el sondeo, una alumna dada de baja obtuvo **200 + enlace firmado**. Ocurre en `api/recordings/[sessionId]/route.ts:42-64`, que no mira el estado de la sesión ni de la reserva antes de usar `service_role`. → Exigir sesión no cancelada y reserva `confirmed/in_progress/completed`; mejor, una RPC SECURITY DEFINER `grabacion_de_fecha(p_group_class)`. _(aud. #40)_
- [x] **B2** Un ciclo vuelve a abrir la inscripción después de la 1.ª fecha y cobra el ciclo entero por menos clases. El corte usa la primera fecha `scheduled` (`20261009190000:144-152`) y el cron pasa la fecha dada a `completed`. → Cerrar la inscripción en la primera fecha **no cancelada** (como `comprar_regalo`). Agregar `inscripcion_cierra_at` a la vista y usarla en el catálogo, la ficha y el checkout. _(aud. #0, #14, #75)_
- [x] **B5** 🔴 RG-05 roto: con una grupal publicada sin inscritos, el 1:1 sigue ofreciendo esa hora y el alumno choca con el candado al pagar. EY-228 (`20261013190000`) reescribió `get_available_slots` desde la versión anterior a grupales, y en prod ganaría al aplicarse en orden. → Una migración que combine el cuerpo de EY-228 con los bloques «G ·». Revisar de paso otras funciones que `dev` y grupales reescribieron en paralelo. _(aud. #82)_
- [x] **A7** El regalo de un cupo se queda atrapado si la clase empieza sin llenarse, y caduca a los 90 días. Solo se convierte en saldo si la clase se llena o se archiva (`20261014170000:93-118`). → Llamar a `regalos_de_clase_a_saldo(…, 'inscripcion_cerrada')` cuando se cierra la inscripción (desde `close_expired_sessions` o desde el cron de 15 min), y también al pausar. _(aud. #15, #90)_
- [x] **M9** 🔴 Las grupales terminadas siguen `active` para siempre. El catálogo dijo «3 mentorías» y pintó 2 (`queries.ts:229` filtra después de paginar) y el «Desde» del tutor sale de una clase pasada. → En `close_expired_sessions`, archivar el producto grupal cuando no le quedan fechas `scheduled`, y filtrar en la consulta con `inscripcion_cierra_at`. _(aud. #1)_
- [x] **M11** El tutor ve «Inscribirme» en su propia clase y puede pagar un cupo de ella. → En `create_booking_line`, agregar `if p_student = v_prod.tutor_id then raise …`, y en la ficha cambiar el botón por «Es tu clase · Ver inscritos». _(aud. #7, #16)_
- [x] **M25** La regla de las 24 h para regalar se mide con la primera fecha `scheduled` en la ficha y con la primera no cancelada en SQL. → Usar `inscripcion_cierra_at` también en `regalable`. _(aud. #23)_
- [x] **P32** Una clase grupal gratis genera órdenes de pago de 0 US$ al tutor. → Agregar `and p.gross_amount > 0` en `build_payout_for_tutor`, en `run_payout_batch` y en `tutor_balance`, como ya hacen las de academia. _(aud. #93)_
- [x] **P33** `cancel_reason` y `cancelled_at` de `group_classes` los puede leer cualquiera con la clave anon. → `revoke select (cancel_reason, cancelled_at) … from anon`. _(aud. #12)_

## Lote 2 · Bajas, reembolsos, mínimo y edición de la clase (1 – 1½ días) · ✅ hecho el 16-oct

> **Hecho:** migración `20261017120000` (aplicada en dev y probada en transacciones revertidas) y las pantallas de baja del alumno, la ficha y la baja del tutor, la ficha de la clase, el formulario y la ficha del admin. Verificado en vivo con «Sondeo: Ciclo de pronunciación» (A8: 15,75 ya devueltos + 15,75 ahora sobre 31,50). Además de lo previsto, salió de la revisión adversarial:
> - Al sacar a un alumno a mitad de ciclo (M1) la reserva no se cancela y `notify_booking` no avisaba: ahora `cancel_booking` encola NTF-55 con `tramos`, y el correo dice «la parte de las fechas que faltaban» en vez del 100 %.
> - B6 congela también `package_num_sessions` (es la N del prorrateo: moverla era cambiar el precio) y la moneda, y el cupo no baja del mínimo (antes saltaba un check en inglés).
> - RN-23 (`enforce_product_publish_guard`) solo en la PUBLICACIÓN: con un tutor suspendido fallaban en silencio la marca de B7 y el cierre de inscripción del lote 1.
> - Sin fechas por delante no hay «Sacar» (dejaba el pago en «reembolso parcial» de 0), y `cancel_booking` bloquea el pago antes de la política (carrera con `cancelar_fecha_grupal` que rompía A8).
> - El motivo que elige el tutor le llega al alumno por correo: el formulario lo dice y el correo ya no afirma «no fue por algo que hicieras tú» cuando trae motivo.
> - La baja del alumno avisa cuando pagó una parte con saldo (vuelve al saldo, no a la tarjeta).

Funciones que se reescriben: `cancel_booking`, `reagendar_clase_grupal`, `cancelar_grupales_sin_minimo`, `publicar_clase_grupal` (solo la regla del mínimo), `admin_sacar_de_clase_grupal` y el trigger `products_guarda_grupal`. Pantallas: `reservas/[id]/cancelar`, `tutor/reservas/[id]` y la ficha del tutor.

- [x] **B6** Con la clase publicada, el tutor puede cambiar cupo, mínimo, precio y duración sin ningún freno:
  - bajar el cupo por debajo de los inscritos deja fuera de la sala (Daily admite cupo + 1) a alumnos que pagaron;
  - poner un mínimo con menos de 24 h hace que el cron cancele la clase.

  → Que `products_guarda_grupal` salte también con `update of capacity, min_seats, price_amount, session_duration_min`: el cupo nunca por debajo de las reservas vivas, y mínimo, precio y duración fijos tras publicar. Bloquear esos campos en `product-form.tsx`. _(aud. #68, #84)_
- [x] **B7** El mínimo se revisa durante todo el último día, cada 15 min, y no una vez a las 24 h. Una baja tardía tumba la clase para los demás con un correo que dice «faltando 24 horas». Además, una clase publicada con mínimo y la primera fecha a menos de 24 h se cancela sola. → `products.minimo_evaluado_at`: el cron evalúa una sola vez y marca. Rechazar el mínimo si la primera fecha está a menos de 48 h (en `publicar_clase_grupal` y en el formulario). Corregir el texto de NTF-53. _(aud. #32, #83)_
- [x] **A8** Si ya hubo un reembolso parcial (una fecha del ciclo cancelada), la pantalla de baja promete más de lo que se devuelve y la baja al 50 % devuelve menos de lo justo. → `v_refund := v_prev + round((gross - v_prev) * pct / 100)` en `cancel_booking`, y que la pantalla lea `payments.refunded_amount`. _(aud. #28)_
- [x] **A10** El tutor no puede cancelar la última fecha que queda de un ciclo ya empezado, y el admin tampoco desde su ficha. → `puedeCancelar = ciclo && start_at > ahora` (`tutor/clases-grupales/[id]/page.tsx:188`), más el botón «Cancelar fecha» por fila en el admin. _(aud. #73)_
- [x] **M1** ⚖️ Desde la ficha 1:1 de la reserva, el tutor puede cancelar el cupo de un alumno de la grupal con el 100 % del ciclo (aunque ya se dieran fechas) y le ofrece «Reagendar». Además, el «Sacar» del admin a mitad de ciclo falla con `in_progress` o devuelve todo. → En `tutor/reservas/[id]`, si es grupal, esconder Cancelar y Reagendar y enlazar a la ficha de la clase. En `cancel_booking` y `admin_sacar_de_clase_grupal`, reembolso por tramos (según la decisión). _(aud. #71, #91)_
- [x] **M15** Reagendar exige 24 h sobre la hora vieja, pero la nueva puede ser dentro de 5 minutos, y desordena el ciclo. Además, el 100 % por reagenda también lo cobra quien se inscribió después del cambio. → `p_nuevo_inicio >= now() + 24 h`, reordenar `sequence_no` en ciclos y exigir `rescheduled_at > bookings.created_at` en `cancel_booking`. En la interfaz, `min` en el input y «Se avisará a N inscritos». _(aud. #79, #85, #86)_
- [x] **M26** El botón «Cancelar mi cupo» y la estimación «100 % · Tu caso» aparecen cuando `cancel_booking` va a rechazar la baja (RG-16), y la política mostrada no menciona RG-16 ni RG-11. → Una RPC `politica_de_baja(p_booking)` → `{permitida, pct, motivo}` que usen el detalle, la pantalla de baja y la propia `cancel_booking`. _(aud. #29)_
- [x] **P9** 🔴 La pantalla de baja dice «Faltan 0 h» con 45 minutos por delante (`cancelar/page.tsx:34`). → Mostrar minutos por debajo de 1 h.
- [x] **P10** 🔴 Los motivos de baja son de 1:1 en una grupal: «Encontré otro tutor», «El tutor tarda en confirmar». → Una lista propia para grupales.

## Lote 3 · Chat del grupo (1 día) · ✅ hecho el 17-oct (salvo M8 y P27, que esperan a Emilio)

> **Hecho:** migración `20261017130000` (aplicada en dev, probada revertida) y el chat: `my_conversations` filtra `kind` y trae los hilos de grupo con su título; `notify_new_message` avisa a todo el grupo menos al emisor; reportar y descargar en grupo; autoría con foto, «Tutor» y «(tú)»; separadores por día; «Ya no formas parte de este grupo». Verificado en vivo con la tutora, Víctor y Mariana. De la revisión adversarial salió además:
> - `purge_expired_messages` borraba un hilo de grupo con un reporte sin atender (la cascada se llevaba el reporte): ahora la rama de grupo respeta el bloqueo y el reporte pendiente, como el par.
> - El admin ofrecía «Desactivar a Grupo «…»» con id nulo cuando el tutor reporta su grupo: ahí ya no hay parte «alumno».
> - En vivo, quien se inscribe después de abrir el chat firma «Participante», no «Ya no está en el grupo»; un id de hilo que no es UUID da 404 (y no la pantalla de error), y la reserva terminada cuyo chat ya se purgó lo dice en vez de «no disponible».

Funciones que se reescriben: `my_conversations` (`drop` + `create`, reponer grants), `notify_new_message`, `report_conversation` y `hilo_grupal_caducado`. Pantallas: `chat/[threadId]`, `components/chat/*`, la burbuja y el chat de la reserva.

- [x] **B3** 🔴 La tutora abre el chat de su grupo y ve una consulta previa de 1:1: «Chat con tu alumno · Conversación de solo lectura», «te quedan 4 de 5 mensajes» y los mensajes sin autor. En su burbuja, cada clase aparece como «tu alumno · Sin mentoría reservada». La causa: `my_conversations` (`20260820180000:442`) no filtra `kind`, y `chat/[threadId]/page.tsx` mira la bandeja antes que el hilo de grupo. → Filtrar por `kind`, y que la página mire primero `hiloDeGrupo`. _(aud. #54)_
- [x] **B4** Los mensajes del grupo no avisan a nadie: `notify_new_message` sale si `student_id` es null (`20260826160000:145`). El hilo de grupo no aparece en la bandeja del alumno, y su reserva muestra en grande el chat privado y el del grupo solo como enlace. → En el aviso, una rama `kind='group'` (todos los miembros menos el emisor, con dedupe por hora). Que `my_conversations` devuelva los hilos de grupo con su título. En la reserva grupal, el chat del grupo como principal. _(aud. #33, #55, #57, #92)_
- [x] **M7** El chat de hasta 11 desconocidos no tiene «Reportar» (`report_conversation` exige ser alumno o tutor del par). Además, «Descargar la conversación» da 404 al alumno y un archivo falso, «Conversación con tu alumno», a la tutora. → Pertenencia con `puede_ver_conversacion` en el reporte, `ReportConversation` también en modo grupal y una exportación de grupo en `api/chat/[threadId]/download`. _(aud. #56, #59)_
  - ➕ **Nuevo (lote 2, 16-oct):** el alumno que el tutor saca con el ciclo empezado (M1) queda con la reserva `completed`, no `cancelled`, y `puede_ver_conversacion` admite `completed`: **sigue en el chat del grupo** y puede leerlo. → Que la pertenencia exija además alguna sesión suya de esa clase no cancelada, o que no tenga sesiones canceladas por M1 con fecha futura. Decidirlo junto con M2 (expulsión de la sala).
- [ ] **M8** ⚖️ ⏸ _(espera a Emilio)_ 🔴 La tutora recibe un hilo privado vacío por cada inscrito de cada clase (10 alumnos son 10 hilos). → Según la decisión: esconder al tutor los hilos sin mensajes que solo tienen grupales, o no crear el par en grupales. _(aud. #58)_
- [x] **M31** Participantes y autoría pobres: no hay fotos (RG-19), la tutora no se distingue y quien se fue firma «Participante». → Pasar `avatar_path` y `es_tutor` desde `inscritos_de_clase`, con avatar, insignia «Tutor», avatares apilados en la cabecera y «(tú)». _(aud. #61)_
- [x] **P12** 🔴 Quien se dio de baja y abre el enlace del chat recibe un 404 seco. → «Ya no formas parte de este grupo» con un enlace a su reserva. _(aud. #64)_
- [ ] **P27** ⚖️ ⏸ _(espera a Emilio)_ El tutor no puede compartir material con el grupo por el chat. → Adjuntos solo para el tutor en hilos de grupo, con una carpeta de Storage por producto. _(aud. #62)_
- [x] **P28** Los mensajes solo llevan la hora: en un ciclo de semanas no se sabe de qué día son. → Separadores por día en la zona del usuario. _(aud. #63)_
- [x] **P29** El hilo nace con el apartado del pago, no con el primer pago: la tutora ve «Abrir chat» con cero inscritos. → Mostrar la tarjeta solo con pagados, o cambiar el texto. _(aud. #65)_
- [x] **P44** El aviso «los inscritos ven tus mensajes» no es fijo: falta antes del primer mensaje y nunca sale en la sala. → Una línea fija sobre el cuadro de texto en modo grupal. _(aud. #60)_
- [x] **P45** Si falla la consulta del hilo, el enlace al chat desaparece en silencio y la sala se queda en «Abriendo la conversación…» para siempre. → Mirar `error` en las tres consultas (regla de oro 10) y mostrar «El chat no está disponible». _(aud. #66)_
- [x] **P46** Una clase cancelada conserva su chat hasta 30 días después de una fecha que ya no ocurrirá. → En `hilo_grupal_caducado`, contar la última fecha no cancelada o la fecha de cancelación. _(aud. #67)_

## Lote 4 · Sala: privacidad y lógica (1 día) · ✅ hecho el 17-oct (salvo A5 y M2, que esperan a Emilio)

> **Hecho:** migración `20261017140000` (aplicada en dev) y la sala: cola de manos que solo ve la tutora y «Bajar» al alumno correcto (B8); sin «Clase extendida» falsa (B9, con caso en `sala.check.ts`); nombre enmascarado en el token (B10); `/room/<id de la fecha>` abre la sala grupal (M3); cupo de Daily + 4 y «La sala está llena» claro (M6); la tutora ya no depende de la sesión de un alumno (M29); estados de fecha cancelada/terminada/movida con salida (P42); grabación por fecha para la tutora y para quien faltó (A6). Verificado en vivo: P42, M3, y el endpoint de grabación por fecha (`ready` para la tutora, 404 para Elena). De la revisión adversarial salió además:
> - NTF-19 avisaba «ya puedes ver la grabación» aunque nadie hubiera entrado (todas las sesiones en no_show): ahora exige que la sala se haya abierto.
> - El correo de la grabación ya no le dice «asististe» a quien faltó, y el de la tutora (uno por fecha) lleva la clase y la manda a la ficha de la clase.
> - En la sala simulada (sin Daily), «Bajar» la mano de un alumno no le llegaba.
> - Las salidas de la sala hacia `(app)` iban con `<Link>` (regla 13): ahora `<a>`.

Funciones y archivos: `join_group_class` (margen de Daily, expulsiones), `api/room/grupal/[id]/route.ts`, `sala-grupal.tsx`, `room/[sessionId]/page.tsx`, la lógica de `live-room.tsx`, `lib/daily.ts` y `reservas/[id]` (enlace a la grabación).

- [x] **B8** 🔴 «Levantar la mano» no sirve en grupo: si un alumno la levanta, los demás leen «**El tutor** levantó la mano» con un «Bajar» que baja la de otro, y la tutora lee «Un alumno…» sin saber quién (`live-room.tsx:548-552`, `use-mano-levantada.ts`). → Un canal con el `user_id` del remitente, una cola de manos que solo ve la tutora y cada alumno viendo solo la suya. _(aud. #41)_
- [x] **B9** 🔴 «Clase extendida · quedan 59:49» desde el minuto 0, y el aviso de los 5 minutos nunca sale (`sala-grupal.tsx:113-115`). → `extendida={false}`, más un caso en `sala.check.ts`. _(aud. #43)_
- [x] **B10** 🔴 La sala muestra el nombre completo de cada alumno («Mariana Xóchitl») mientras el chat lo enmascara («Víctor E.»). Choca con RG-19 y pueden ser menores (`api/room/grupal/[id]/route.ts:58-85` usa `full_name`). → `mask_person_name` para alumnos y `display_name` para el tutor en el token. _(aud. #44)_
- [ ] **A5** ⚖️ ⏸ _(espera a Emilio)_ 🔴 La grabación arranca con el primero que entra, 10 min antes de la hora: vi «Grabando» con «Empieza en 08:50» (`daily.ts:265`). → Arrancarla a la hora de inicio, según la decisión.
- [x] **A6** El alumno que faltó (sesión `no_show`) no ve la grabación ni recibe el aviso, aunque RG-12 dice que la ven todos los inscritos, y la tutora no tiene dónde verla. → `RecordingLink` también en `no_show` de grupales, NTF-19 a los ausentes y «Ver grabación» por fecha en la ficha del tutor (endpoint por fecha, con la misma autorización que B1). _(aud. #35, #47)_
- [ ] **M2** ⚖️ ⏸ _(espera a Emilio)_ 🔴 «Sacar de la sala» usa un `confirm()` nativo y no persiste nada: el alumno vuelve a entrar con un clic, y ve «Se perdió la conexión». → Una tabla `group_class_expulsiones` (RLS + grant a `service_role`) que `join_group_class` rechace, un diálogo propio y, en el cliente, mensajes distintos para `ejected`, `exp-room` y `meeting-full`. _(aud. #46)_
- [x] **M3** 🔴 El enlace a la sala que llevan el Google Calendar y el ICS del tutor (`/room/<id de la fecha>`) da 404. → En `room/[sessionId]/page.tsx`, si no hay sesión con ese id, buscar una `group_class` y pintar `SalaGrupal`. Así también siguen sirviendo los eventos ya escritos. _(aud. #69)_
- [x] **M6** El cupo de Daily es cupo + 1, sin margen: una segunda pestaña o una reconexión deja fuera a un alumno que pagó, o a la tutora, y la pantalla se queda en «Conectando…». → Cupo + 3 o + 4, y en el `catch` del join un mensaje claro. _(aud. #49)_
- [x] **M29** La tutora entra a su clase con la sesión de un alumno cualquiera (la primera por UUID): si ese alumno solo tiene un apartado, o se da de baja, a ella le dicen «Esta reserva no está activa» o la sacan. → Que el estado de la tutora salga de `group_classes.status`, no de una sesión prestada. _(aud. #42)_
- [x] **P42** Con la fecha cancelada o reagendada, la sala dice «No tienes un cupo activo», sin cabecera ni salida. → Estados explícitos («Esta fecha se canceló; te devolvimos su parte», «Se movió al…») y un enlace de vuelta. _(aud. #50)_

## Lote 5 · Sala: galería, moderación y pulido (1 día) · ✅ hecho el 17-oct (salvo M30, que espera a Emilio)

> **Hecho, sin SQL:** galería que calcula columnas sin scroll con el tutor primero (B11, `galeria()` con casos en `sala.check.ts`); el alumno de una grupal entra sin pantalla compartida (token `canSend`), con el micro apagado y una antesala con vista previa, y el tutor concede la pantalla o «Silencia a todos» (M5); casilla con nombre accesible (P15); menús de tesela con Escape, `role="menu"` y foco (P16); insignia «Tutor» (P17); aviso de mano junto al contador (P18); `loading.tsx` en `(room)` y cascada de tres niveles en vez de cinco (P26); «clase»/«mentoría» por props (P43); chat lateral u hoja según el ancho (P49). ⚠️ **No verificado en vivo con Daily**: necesita una llamada con varias personas y queda para el re-sondeo del lote 10. De la revisión adversarial salió además:
> - Con la galería sin scroll, el menú de moderación quedaba recortado en teselas pequeñas (11 personas en móvil) y «Sacar de la sala» no se podía pulsar: ahora el menú va `fixed` y se abre hacia donde quepa.
> - La insignia «Tutor» quedaba tapada por el contador cuando el tutor va primero: ahora va junto al nombre.
> - `/room/<id que no es UUID>` daba la pantalla de error en vez del 404; la 1:1 había pasado a decir «clase» en el contador; al darse de baja un alumno se leía «La clase se canceló».

Archivos: `escenario-sala.tsx`, `tesela.tsx`, la barra y los menús de `live-room.tsx`, `recording-consent.tsx` y un `loading.tsx` nuevo en `(room)`.

- [x] **B11** 🔴 La sala en móvil no aguanta un grupo: con 4 personas, teselas de 210 px en una sola columna sin scroll, y la cuarta queda debajo de la barra. Con 11, la mayoría no se ve (`escenario-sala.tsx:73-83`). → Una galería que calcule columnas y tamaño según `n` y el contenedor, sin scroll, con `content-[safe_center]` y la tutora fija en primer lugar. _(aud. #45)_
- [x] **M5** Moderación insuficiente: cualquier alumno puede compartir pantalla y tapar al tutor, y todos entran con micro y cámara abiertos y sin vista previa. → Token de alumno sin `screenVideo` (el tutor puede concederlo), entrada con `startAudioOff: true`, una antesala mínima con vista previa y «Silenciar a todos». _(aud. #48)_
- [ ] **M30** ⚖️ ⏸ _(espera a Emilio)_ La grabación no incluye el documento que presenta el tutor ni sus anotaciones (viajan por `app-message`). → Publicar el lienzo del visor como pista mientras se presenta (`canvas.captureStream`). _(aud. #51)_
- [x] **P15** 🔴 La casilla del aviso de grabación no tiene nombre accesible: el lector de pantalla lee «on».
- [x] **P16** 🔴 Los menús «Opciones de…» de las teselas no se cierran con Escape ni al abrir otro: quedan varios abiertos a la vez. Además no tienen `role="menu"`.
- [x] **P17** 🔴 Nada distingue a la tutora como anfitriona en su tesela. → Insignia «Tutora».
- [x] **P18** 🔴 El aviso de «mano levantada» tapa el contador de tiempo.
- [x] **P26** 🔴 «Entrar a sala» tarda de 6 a 8 s sin ninguna señal: no hay `loading.tsx` en `(room)` y la carga son cuatro niveles de consultas en serie. → Esqueleto de la antesala y una cascada aplanada. _(aud. #53)_
- [x] **P43** 🔴 La sala mezcla «Clase grupal» y «mentoría» («Esta mentoría se graba», «abre 10 minutos antes de la mentoría»), y al cerrar dice que «se marcó como completada». → Un sustantivo que llegue por props. _(aud. #52)_
- [x] **P49** 🔴 En anchos de tableta, el chat de la sala tapa entero el video. → Panel lateral o hoja inferior según el ancho.

## Lote 6 · Avisos y correos (1 día) · ✅ hecho el 17-oct (salvo M14, que espera a Emilio)

> **Hecho:** migración `20261017160000` (aplicada en dev, probada revertida) y los avisos: la baja del propio alumno avisa al tutor con nombre y cupos («quedan 2/3») y al alumno con su plantilla (A2); la campana con nombre y clase, agrupada por clase y con un contador de verdad (A3, «28 sin leer» en vivo: antes nunca pasaba de 8); los recordatorios usan la sesión del aviso (A9); `inscritos_pagados` como única definición de «inscritos» y NTF-52 solo con pagados (M17); aviso al tutor cuando la clase se cancela sin pagados (M20; la parte de NTF-19 ya la cerró el lote 4); la última fecha de un ciclo empezado sí avisa (M27); la campana en la zona del perfil (P13); un solo aviso al inscribirse, con la clase y el importe (P14); el motivo de la cancelación en la reserva y «Se canceló la clase» (P39); todas las fechas y el `.ics` en la inscripción (P40). De la revisión adversarial salió además:
> - Con los dos últimos cupos confirmados a la vez, «tu clase se llenó» no salía nunca: el aviso se serializa por producto (candado propio, sin invertir el orden de `cancelar_clase_grupal`).
> - Cancelar la última fecha de un ciclo ya no dice «el resto del ciclo sigue igual»; el `.ics` de un ciclo va uno por fecha; «Quedan 1 inscrito…» concuerda.
> - Si el equipo cancela una clase sin escribir motivo, el texto por defecto ya no culpa al tutor («El equipo de Enséñame Ya canceló la clase grupal»), y el correo al tutor no repite el título como motivo.

Funciones que se reescriben: `notify_booking`, `avisar_cambio_de_fecha_grupal`, `notify_recording`, `pending_email_notifications`, `cancelar_clase_grupal` (solo el aviso al tutor) y el encolado de NTF-52. Archivos: `email-templates.ts`, `notifications.ts`, `notifications-bell.tsx` y `notifications-send/route.ts`.

- [x] **A2** 🔴 Cuando un alumno se da de baja, la tutora recibe el correo genérico de 1:1, «Se canceló la mentoría… el horario volvió a quedar libre», y es falso: la clase sigue. → Una rama en `notify_booking` para la baja del propio alumno: al tutor «Elena se dio de baja de X · quedan 2/3», y al alumno una plantilla de baja grupal. _(aud. #31, #70)_
- [x] **A3** 🔴 La campana de la tutora dice «Alguien se inscribió en tu clase grupal» tres veces y «Tu clase grupal se llenó», sin nombre ni clase (`notifications.ts:68-69`). Además, el contador se calcula sobre los 8 últimos avisos (`notifications-bell.tsx:137`, `NOTICES_LIMIT = 8`), así que nunca pasa de 8 y el «9+» es inalcanzable. → Nombre enmascarado y título de la clase en el payload y en el texto, agrupar por clase («3 alumnos se inscribieron en…») y un contador con una consulta `count` aparte.
- [x] **A9** En un ciclo, los recordatorios de la 2.ª fecha en adelante muestran la fecha 1, y su «Entrar a la sala» lleva a una sala cerrada: `pending_email_notifications` toma siempre la primera sesión. → Usar la sesión del payload cuando venga. _(aud. #27)_
- [ ] **M14** ⚖️ ⏸ _(espera a Emilio)_ NTF-54 («puedes cancelar con el 100 %») también llega a ciclos ya empezados, y el sistema rechaza esa baja. → Que el payload diga si el ciclo ya empezó, que la plantilla cambie el texto y que se aplique la decisión de Emilio. _(aud. #30)_
- [x] **M17** «Inscritos» cambia según la pantalla (el panel cuenta los apartados; la ficha, no), y «Tu clase se llenó» puede llegar sin estar llena. → Una sola definición, cupo pagado: agregar `inscritos_pagados` a la vista (una función SECURITY DEFINER, como `cupos_libres`), usarla en el panel y mostrar «+N pagando» aparte. Que NTF-52 cuente solo pagados. _(aud. #77)_
- [x] **M20** Si la clase se cancela sola sin alumnos pagados, el tutor no recibe ningún aviso. Además recibe un «tu grabación está lista» por cada alumno. → Encolar NTF-53/55 al tutor dentro de `cancelar_clase_grupal`, y NTF-19 al tutor una sola vez por fecha (`NTF-19:group_class:<id>:tutor`). _(aud. #87, #89)_
- [x] **M27** Si el tutor cancela la última fecha que queda de un ciclo ya empezado, el alumno no recibe el aviso de la cancelación y sí un «deja tu reseña». → En `avisar_cambio_de_fecha_grupal`, que la condición sea «hay otra fecha no cancelada». _(aud. #34, #88)_
- [x] **P13** 🔴 La campana muestra la hora del navegador y no la del perfil (`notifications-bell.tsx:386`), cuando el resto del panel dice «Horas en tu zona». → Pasar la `timeZone` del perfil.
- [x] **P14** 🔴 Una inscripción le genera al alumno dos avisos («Tu pago se registró» y «Tu inscripción… quedó confirmada»), y ninguno nombra la clase. → Uno solo, con el título.
- [x] **P39** Tras una cancelación del tutor o por no llegar al mínimo, el detalle solo dice «Cancelada», y el correo de cancelación de la clase dice «Se canceló tu cupo». → Leer `cancel_reason` y pintar un aviso con el motivo, y que el asunto diga «Se canceló la clase». _(aud. #36)_
- [x] **P40** La confirmación de inscripción (NTF-56) solo enseña la primera fecha y no lleva calendario. → Todas las fechas, y el `.ics` como en la 1:1. _(aud. #38)_

## Lote 7 · Alumno: catálogo y ficha (1 día) · ✅ hecho el 17-oct

> **Hecho, sin SQL:** mínimo y reglas de grupal o de ciclo en la ficha (A12); panel de próximas grupales en el perfil del tutor (M10); «Queda 1 cupo»/«¡Último cupo!» (P3); «Ya tienes tu cupo» (P7); pie según el caso (P8); textos que ya no son solo 1:1 (P23); «por cupo · N fechas (X c/u)» y la etiqueta del formulario del tutor (P24); fechas como rango y en hora local (P25); JSON-LD con `CourseInstance` por fecha, `SoldOut`/`Discontinued` y `noindex` si está cerrada (P30); aviso de privacidad ampliado también junto al botón de pagar (P34); chip «Clase grupal · máx. N» (P35); «Empiezan antes» (P36); salidas con la clase llena (P37); el «2» de «Cómo funciona» (P52). Verificado en vivo en el catálogo y la ficha del «Taller de álgebra en grupo». De la revisión adversarial salió además:
> - En un ciclo ya empezado (una sola fecha viva) la ficha enseñaba las reglas de una clase suelta: «ciclo» se decide ahora por el número de fechas del producto.
> - «Se da con un mínimo de N · faltan X» ya no sale a menos de 24 h, cuando el mínimo ya se evaluó (B7).

Archivos: `grupal-panel.tsx`, `product-card.tsx`, `product-filters.tsx`, `lib/catalog/{queries,format}.ts`, `mentorias/[id]/page.tsx`, `tutores/[id]/page.tsx` y `mentorias/page.tsx`.

- [x] **A12** Antes de pagar no se informa del cupo mínimo ni de las reglas del ciclo (baja solo antes de la 1.ª fecha, la fecha a la que faltas se pierde, si el tutor cancela una fecha se devuelve solo esa). → `min_seats` de la vista (lote 1) en la ficha («Se da con un mínimo de 4 · faltan 2») y una política de grupal o de ciclo en la ficha. El checkout lo hace el lote 8 (M12). _(aud. #3, #22)_
- [x] **M10** El perfil de un tutor que solo da grupales dice «Este tutor aún no tiene mentorías disponibles para reservar». → Un panel «Próximas clases grupales» cuando no hay 1:1. _(aud. #2)_
- [x] **P3** «Quedan 1 cupos» (`product-card.tsx:72`, `grupal-panel.tsx:88`). → «Queda 1 cupo» o «¡Último cupo!». _(aud. #8)_
- [x] **P7** 🔴 Ya inscrito, el panel sigue titulado «Inscríbete en esta clase» (`grupal-panel.tsx:55`). → «Ya tienes tu cupo».
- [x] **P8** 🔴 «Cancela tu cupo con 24 h y recibe el 100 %» es fijo (`grupal-panel.tsx:127`), aunque la clase empiece en 1 h o sea un ciclo. → Un texto según el caso.
- [x] **P23** 🔴 Textos que solo hablan de 1:1: el pie dice «mentorías en vivo 1 - 1» y el catálogo «Sesiones, mentorías y paquetes».
- [x] **P24** El precio de un ciclo no dice qué incluye («20 US$ por cupo» sin «2 fechas» ni cuánto sale cada una), una grupal gratis dice «por sesión», y en el formulario del tutor «Precio por cupo» es en realidad el del ciclo entero. → En `format.ts`: «por cupo · N fechas (X c/u)», y en `product-form.tsx` la etiqueta «Precio del ciclo, por alumno» con el cálculo en vivo. _(aud. #6, #76)_
- [x] **P25** Las fechas no dicen en qué zona horaria están ni a qué hora terminan. → «En tu hora local (Caracas)» y el rango «18:00 – 19:00». _(aud. #9, #26)_
- [x] **P30** El JSON-LD dice `InStock` aunque la clase esté llena o cerrada, no lleva las fechas, y la ficha cerrada sigue indexable. → `SoldOut` o `Discontinued`, un `CourseInstance` por fecha y `noindex` si está cerrada. _(aud. #10)_
- [x] **P34** El aviso de privacidad (RG-19) se queda corto (no menciona cámara, micrófono ni la grabación compartida) y no sale en el checkout. → Ampliar el texto y repetirlo junto al botón de pagar. _(aud. #4)_
- [x] **P35** La ficha de una grupal se presenta como 1:1: el único chip es «Confirmación inmediata», sale «1 a 1» cuando ya no quedan fechas, y los metadatos dicen «Mentoría 1:1». → Decidir con `pricingModel`, y un chip «Clase grupal · máx. N». _(aud. #5)_
- [x] **P36** El filtro «Grupal» ordena por fecha de creación, no por cuándo empieza la clase. → Con `model=group`, ordenar por `inscripcion_cierra_at` y agregar «Empiezan antes». _(aud. #11)_
- [x] **P37** 🔴 Con la clase llena, el botón queda desactivado y no se ofrece nada más; en el checkout, solo «Volver a la clase». → «Ver otras clases de {tutor}» o «Reserva una sesión 1 a 1». _(aud. #13)_
- [x] **P52** 🔴 En «Cómo funciona», el paso 2 lleva un rayo en lugar del número 2.

## Lote 8 · Alumno: checkout, regalo y su reserva (1 – 1½ días) · ✅ hecho el 17-oct (salvo P31, que espera a Emilio, y M21, que pide medir contra el build)

> **Hecho:** migración `20261017180000` (aplicada en dev; `cupos_apartados` y su columna en la vista) y las pantallas: confirmación grupal «¡Tienes tu cupo!» con las fechas vivas y el aviso de grabación (A1); el regalo filtra lo regalable, explica RG-17 y tiene variante grupal (A11); «Tu cupo está apartado · Terminar mi pago» y «Alguien está terminando de pagar» (M4); textos de cupo y política de grupal o ciclo en el checkout (M12); la reserva explica la reagenda y la fecha cancelada (M13); «¿Ya tienes cuenta?» en el checkout de invitado (M22); «Inscribirme en la clase» desde el regalo (M23); «Volver a la clase» si falla (M24); «Con quién compartes la clase», «Fecha 1 de 2», «Darme de baja» y la etiqueta «Grupal» (M28); sin pasos falsos en el checkout (P6); el chat de una reserva cancelada no promete nada (P11); un segundo checkout reutiliza el apartado (P38); el regalo grupal se nombra bien (P41); país y correo del pagador en Stripe (P50). Verificado en vivo el detalle y la confirmación de Víctor. De la revisión adversarial salió además:
> - 🔴 El detalle de la reserva pedía `group_classes.cancel_reason`, que el lote 1 (P33) dejó sin permiso: la consulta entera caía con 42501 y **todas** las reservas, también las 1:1, daban 404. Arreglado, y ahora un fallo de esa consulta sale como error y no como «no existe» (regla 10).
> - La baja de un alumno a mitad de ciclo (M1) ya no se explica como «el tutor canceló esta fecha»; «terminando de pagar» concuerda con el número de cupos en pago.
- **M21** queda sin hacer: hay que medir `/api/pagos/checkout` contra el build de producción antes de tocar el orden de las llamadas (Stripe, dLocal, idempotencia X-02).

Archivos: `(checkout)/reservar/[productId]/checkout`, `components/checkout/*`, `regalar/**`, `regalo-recibido.tsx`, `reservas/page.tsx`, `reservas/[id]/page.tsx`, `reservas/[id]/confirmacion` y `api/pagos/checkout`.

- [x] **A1** 🔴 La confirmación de inscripción está escrita para 1:1: «¡Reserva registrada!», «el horario queda bloqueado en su agenda», «Puedes chatear con tu tutor» (`reservas/[id]/confirmacion/page.tsx:38,180,214`). No menciona el grupo, los compañeros, el chat del grupo ni el aviso de grabación. → Una variante grupal: «Tienes tu cupo · 3 de 3 inscritos», con las fechas y enlaces al chat y a la sala.
- [x] **A11** Regalar un cupo: la pantalla lo presenta como 1:1 («el día y la hora los elige quien lo recibe»), el listado no comprueba RG-17 y el rechazo sale como un error genérico. → Filtrar por `regalable` y explicar por qué, una variante grupal con las fechas y que el error de RG-17 se lea tal cual. _(aud. #18)_
- [x] **M4** 🔴 Con el último cupo solo apartado (sin pagar), los demás ven «Clase completa», y quien lo apartó también si recarga. → Resolver en el servidor la reserva viva de quien mira, y a los demás decirles «Alguien está terminando de pagar el último cupo; vuelve en unos minutos». _(aud. #17)_
- [x] **M12** 🔴 El checkout de una grupal habla de horario («Te guardamos este horario», `hold-countdown.tsx:95`) y cuenta la política de 1:1, incluido «Si cancela el tutor, siempre el 100 %», que no vale para una fecha suelta de un ciclo. → Una prop `grupal` con textos de cupo y la política de grupal o de ciclo. _(aud. #21)_
- [x] **M13** 🔴 Tras una reagenda o una fecha cancelada, la reserva no explica nada: ni que la hora cambió y puede darse de baja con el 100 %, ni por qué la fecha está «Cancelada» y cuánto se devolvió.
- [ ] **M21** 🔴 ⏸ _(pide medir contra el build de producción)_ «Preparando tu pago seguro…» tarda entre 10 y 20 s con Stripe y con dLocal. → Medir `/api/pagos/checkout` contra el build y recortar lo que vaya en serie.
- [x] **M22** 🔴 El checkout de invitado no ofrece «¿Ya tienes cuenta? Inicia sesión», y el botón dice «Crear cuenta y pagar» aunque el correo ya tenga cuenta.
- [x] **M23** Quien recibe un cupo de regalo pulsa «Elegir día y hora» y cae en una página intermedia sin salida útil. → «Inscribirme en la clase», directo al checkout con `<a>` (regla 13), las fechas y la fecha límite. _(aud. #19)_
- [x] **M24** Si una grupal falla en el checkout, el error ofrece «Elegir otro horario» y lleva a una página intermedia. → «Volver a la clase», y «Ver mi inscripción» si ya está inscrito. _(aud. #20)_
- [x] **M28** 🔴 La lista, el detalle y la baja siguen con lenguaje de 1:1: no se ven los participantes, dice «Sesión N», «paquete completo» y «Cancelar reserva» junto a «Cancelar mi cupo», y en el panel del alumno no aparece «Grupal». → «Con quién compartes la clase · 3 de 3» con `inscritos_de_clase`, «Fecha 1 de 2», «Darme de baja» y la etiqueta «Grupal». _(aud. #37)_
- [x] **P6** 🔴 El paso a paso del checkout marca «Selección ✓ Revisión ✓», dos pasos que en una grupal el alumno no vio (`checkout-steps.tsx:36`).
- [x] **P11** 🔴 Una reserva cancelada dice «El chat se habilita cuando la reserva esté confirmada» (`reservas/[id]/page.tsx:586`).
- [ ] **P31** ⚖️ ⏸ _(espera a Emilio)_ Las grupales no se pueden meter al carrito, aunque S-G-08 lo da por decidido (`cart/resolve.ts` no las conoce). → Según la decisión: retirarlo por escrito, o agregar «Al carrito» con su rama en `resolve.ts`. _(aud. #25)_
- [x] **P38** Con dos pestañas del checkout, la segunda lee «Ya estás inscrito» por un apartado sin pagar. → Tratar ese caso como recuperable: reutilizar el apartado o ir a la reserva pagada. _(aud. #24)_
- [x] **P41** El regalo de una grupal aparece en «Mis reservas» como «Sesión individual». → «Clase grupal · N fechas». _(aud. #39)_
- [x] **P50** 🔴 En el formulario de Stripe, el país sale por defecto «Noruega», y el bloque de Link vuelve a pedir el correo (sugiriendo «@ensenameya.de»). → Pasar el país del pagador y el correo del cliente a la sesión de Stripe.

## Lote 9 · Tutor y admin (1 – 1½ días)

Archivos: `tutor/clases-grupales/[id]/*`, `tutor/products/*` (incluido `product-status-actions.tsx`), `tutor/page.tsx`, `tutor/reservas/page.tsx`, `tutor/payouts/page.tsx` y `admin/clases-grupales/**`.

- [ ] **A4** 🔴 La tutora no ve cuánto va a ganar: la ficha de la clase no tiene ingresos, «Mis ingresos» no agrupa los cupos bajo la clase y «Reservas» muestra 21 US$ por alumno (lo que pagó el alumno, con el 5 %) en vez de sus 16 US$ (`tutor/reservas/page.tsx:276,517`). → Una tarjeta «Tus ingresos» en la ficha (cobrado, «si se llena», reembolsado y cuándo se libera), líneas agrupadas por clase y el neto del tutor en «Reservas». _(aud. #74)_
- [ ] **M16** El menú «···» de «Mis mentorías» trata la grupal como 1:1: archivar deja una clase fantasma (las fechas y los inscritos siguen), duplicar falla y publicar da un error crudo. → Pasar `pricingModel`: «Cerrar inscripciones» en vez de Pausar, Archivar que lleve a «Cancelar la clase» y copiar `capacity` y `min_seats` al duplicar. _(aud. #72)_
- [ ] **M18** 🔴 Publicar es a ciegas: las fechas se teclean en inputs de día y hora sin ver la agenda, los días bloqueados ni las 1:1 vendidas. → Un selector con los horarios libres (una RPC con la misma lógica que `get_available_slots`, sin producto). El «mínimo con menos de 24 h» del mismo hallazgo va en B7. _(aud. #78)_
- [ ] **M19** 🔴 Publicar con una fecha que choca deja creado un borrador (la especificación dice «no crea nada»), y el reintento avisa de un fallo de categorías que no existe. → No crear el producto hasta que `publicar_clase_grupal` acepte, o hacer idempotente el guardado de categorías.
- [ ] **M32** El texto del motivo al cancelar dice «se guarda con la cancelación», pero los alumnos lo leen en el correo; y en la lista de inscritos no se distingue a quien sacó el admin. → «Mensaje para los inscritos (opcional): lo verán en el correo». _(aud. #80)_
- [ ] **P1** 🔴 «Los 3 inscritos recuperan el 100 % de lo que **pagón**» (`tutor/clases-grupales/[id]/acciones.tsx:138`, el plural «pagó» + «n»).
- [ ] **P2** 🔴 «La clase se publicó, pero **faltó** las categorías» (`product-form.tsx:645`, también en `:669`). → Concordancia («faltaron»).
- [ ] **P4** 🔴 «Horas en tu zona: America/Mexico_City», con el identificador crudo de la zona (`product-form.tsx:1116`, `tutor/page.tsx:624`, `clases-grupales/[id]/page.tsx:150`). → «hora de Ciudad de México (GMT-6)».
- [ ] **P5** 🔴 «La política es única de plataforma (RN-37)…», con jerga interna a la vista del tutor (`product-form.tsx:1402`). Además no menciona las reglas de grupales ni de ciclos.
- [ ] **P19** 🔴 Al publicar, la ficha nueva de la clase se abre con el scroll en el pie de página.
- [ ] **P20** 🔴 «Reagendar» desactivado explica por qué solo en un `title` («Solo se reagenda con 24 horas…»), que no se ve en móvil.
- [ ] **P21** 🔴 «Cancelar fecha» dice «Se reembolsa esta fecha a cada inscrito» sin el monto, ni lo que deja de cobrar el tutor.
- [ ] **P22** 🔴 El admin muestra estados en inglés (`paid · stripe`, `partially_refunded`), confirma con un `prompt` nativo y no tiene un listado de clases grupales (solo se llega desde la ficha del tutor).
- [ ] **P47** En el panel, la fila grupal no tiene el botón de la sala aunque esté abierta. «Entrar a sala» aparece semanas antes en la ficha, y «Mis mentorías» no dice cuándo es la próxima fecha ni cuántos inscritos tiene. → Videocámara dentro de la ventana de la sala, «La sala abre el…» fuera de ella, y «Próxima: … · 3/6». _(aud. #81)_
- [ ] **P48** 🔴 «Reservas» del tutor: una fila por alumno sin agrupar bajo la clase, la baja de una alumna aparece como «Alumno», y en «Pasadas» salen cancelaciones de fechas futuras.
- [ ] **P51** 🔴 En móvil, la tarjeta «Inscritos / Cupos libres / Cupo mínimo» de la ficha se apila en tres filas. → Tres columnas compactas.
- [ ] **P53** 🔴 El reagendar en línea no rellena la fecha actual y queda apretado junto a «Entrar a sala». Tras cancelar una fecha, la cabecera «Fechas del ciclo» pasa a «Fecha» y pierde la numeración.

## Lote 10 · Re-sondeo completo (½ – 1 día)

- [ ] Repetir el recorrido del sondeo del 16-oct contra el build de producción: tutora + 4 alumnos por Stripe y dLocal, clase llena, baja, segundo alumno, sala con 4 (uno en móvil), chat, ciclo (choque, reagenda, cancelar fecha) y admin.
- [ ] Los 19 escenarios del anexo B de `PLAN-ACADEMIAS-Y-GRUPALES.md`.
- [ ] Revisar que los 112 IDs de este documento estén en `[x]`, y anotar en este mismo fichero lo que se haya decidido no hacer.

---

### Control de cobertura

Los 94 hallazgos únicos de la auditoría (`#0` a `#93`) están citados como `aud. #n` en algún punto de arriba; los que no llevan número salieron solo del recorrido en vivo. Comprobación:

```bash
for i in $(seq 0 93); do grep -q "#$i[,)]" docs/SONDEO-GRUPALES-LOTES.md || echo "falta #$i"; done
```
