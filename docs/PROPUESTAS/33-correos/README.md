# Doc 33 · Correos — lo que NO es código

> El rediseño de los 34 correos está en el repo (`src/lib/email-sistema.ts`,
> `src/lib/email-templates.ts`). Esto es **lo que hay que hacer a mano** para
> que se vea en la bandeja de alguien. Sin estos tres pasos, el lote es código
> desplegado y correos que siguen saliendo como antes.

---

## 1 · Las tres plantillas de Auth — pegar a mano, en los DOS proyectos

De los 34 correos, **31 los manda nuestro job** (`/api/cron/notifications-send`
→ Resend) y **tres los manda GoTrue**, el servicio de Auth de Supabase, desde su
propio proceso. Esos tres nunca pasan por `renderEmail` en ejecución: hay que
darle a Supabase el HTML ya hecho.

**Generar** (ya ejecutado; se repite cuando cambie el diseño o el texto):

```bash
npm run build:correos-auth     # → supabase/templates/*.html
```

🔴 **`supabase/config.toml` NO se aplica a la nube.** Este proyecto no tiene
stack local y el CI solo corre `supabase db push`, **nunca `supabase config
push`**. Los bloques `[auth.email.template.*]` de ese fichero son documentación:
dicen qué asunto va con qué HTML, y nada más. **El despliegue es pegarlo.**

**Pegar**, proyecto por proyecto → Dashboard → **Authentication → Emails**:

| Pestaña del panel | Asunto (exacto) | Fichero a pegar en el cuerpo |
| :-- | :-- | :-- |
| **Confirm signup** | `Confirma tu correo para entrar a Enséñame Ya` | `supabase/templates/confirm_signup.html` |
| **Reset password** | `Restablece tu contraseña` | `supabase/templates/reset_password.html` |
| **Change email address** | `Confirma tu nueva dirección de correo` | `supabase/templates/change_email.html` |

- **dev** — `lbtpnszjjsxbeileqsja`
- **prod** — `nrzsyysqanbrcgtslfte`

Son **dos pegados distintos**: nada de lo que se guarde en dev viaja a prod.
Hay que hacer los seis (tres plantillas × dos proyectos) y cambiar **asunto y
cuerpo**, no solo el cuerpo.

**Cómo comprobar que quedó bien** (30 segundos, en el propio panel):

1. En el cuerpo pegado tiene que verse `{{ .ConfirmationURL }}` **literal**, con
   sus dos llaves, su espacio y su punto, y dentro de un `href="…"`. Si el editor
   del panel lo ha escapado (llaves convertidas en entidades HTML) o lo ha
   partido, GoTrue ya no lo reconoce: **no lo sustituye, lo copia**, y el correo
   sale con el marcador a la vista y un botón que no lleva a ninguna parte. No
   falla nada visible — se entrega igual y nadie puede confirmar su cuenta.
   (`npm run build:correos-auth` comprueba esto mismo sobre el HTML generado; lo
   que no puede comprobar es el copia-pega.)
2. El logotipo tiene que cargar. Va como URL absoluta a
   `https://ensenameya.com/img/correo/logo-ya.png`, que es lo único que funciona
   en un correo: relativa no apunta a nada y `ensenameya.vercel.app` es un 308
   que el cliente de correo puede no seguir.
3. Prueba real: **Reset password** desde la pantalla de login, con una dirección
   tuya.

⚠️ **La confirmación de registro solo se puede probar de verdad en prod.**
`enable_confirmations` está **encendida en prod y apagada en dev** (y `config.toml`
tampoco gobierna eso — está en Dashboard → Authentication → Sign In / Providers).
En dev ese correo no se envía nunca, así que pegarlo ahí es por consistencia, no
porque se vaya a ver.

---

## 2 · El SMTP de Resend en Auth — es parte del trabajo, no un extra

Hoy esos tres correos salen por el **SMTP compartido de Supabase**. Eso deja dos
agujeros, y el segundo es el que importa:

1. **El límite.** El SMTP compartido está capado a propósito y no es para
   producción; el tope por hora solo se puede subir con SMTP propio — lo dice el
   propio `config.toml`: *«Number of emails that can be sent per hour. Requires
   `auth.email.smtp` to be enabled.»*
2. 🔴 **El dominio del remitente y el del enlace no coinciden.** El correo llega
   de `…@mail.app.supabase.io` y el botón lleva a `ensenameya.com`. SPF y DKIM
   alinean con el dominio de Supabase, no con el nuestro. **Ese es exactamente
   el patrón que los filtros puntúan como phishing**: un remitente que no es
   quien dice el enlace. Y el correo que se lleva ese castigo es el PRIMERO que
   recibe un usuario nuestro — el de confirmar la cuenta. Si cae en spam, no hay
   registro.

Por eso el SMTP va en este lote y no en «mejoras»: **el rediseño no arregla la
entregabilidad, y el remitente sí.**

**Qué hace falta, en orden:**

1. **Verificar el dominio en Resend.** ⚠️ `ensenameya.com` lleva **Microsoft 365
   detrás de Proofpoint** y ahí el correo no se toca de pasada: los `MX` y el
   `SPF` del ápice **no se tocan**. Se verifica un **subdominio** de envío (tipo
   `send.ensenameya.com`), que se lleva sus propios registros y deja el buzón
   `info@ensenameya.com` intacto. Esto es una tarea de DNS con su propio riesgo,
   no un clic — es el motivo por el que `src/lib/email.ts` sigue mandando desde
   `onboarding@resend.dev`.
2. **Dashboard → Authentication → Emails → SMTP Settings**, en dev y en prod:
   host de Resend, usuario `resend`, contraseña = la `RESEND_API_KEY`, remitente
   = la dirección del dominio verificado.
3. **`EMAIL_FROM` en Vercel** con **esa misma dirección**, para que los 31
   correos nuestros y los 3 de Auth vengan del mismo sitio. Si divergen, el
   usuario ve dos remitentes distintos de la misma marca, que es otra señal
   negativa.

Hasta que esto esté, el punto 1 se puede pegar igual: el diseño mejora aunque el
remitente siga siendo el de pruebas. Son independientes.

---

## 3 · Orden de despliegue — **Vercel PRIMERO, migraciones después**

🔴 **No es una preferencia.** Si una migración empieza a encolar un `template`
que el código desplegado no conoce:

`renderEmail()` devuelve `null` → el job llama a
`mark_notification(p_ok := false)` → la notificación queda **`failed`, que es
PERMANENTE**: no se reintenta nunca. **El correo se pierde y no lo grita nadie**
— no hay build en rojo, no hay 500, no hay excepción. Lo único que se mueve es el
contador `fallosPermanentes` de la respuesta JSON del job, que no mira nadie.

```
1. merge → Vercel despliega el código   (email-templates.ts con los 34 ids)
2. comprobar que el deploy está VIVO    (no «en curso»: vivo)
3. db push                              (CI al mergear a main) → los triggers encolan
4. pegar las 3 plantillas de Auth       (§1, dev y prod)
```

**Para volver atrás, al revés:** revertir el código dejando las migraciones
puestas abre el mismo agujero. Se revierten las migraciones primero, o no se
revierte el código.

---

## 4 · Las cinco decisiones abiertas del pliego

| # | Decisión | Cómo la deja este lote | Qué falta |
| :-- | :-- | :-- | :-- |
| 1 | **Reembolso: ¿pedido o cobrado?** | **Sigue abierta; el texto ya no miente.** ⚠️ NTF-10 sale cuando **la base de datos anota** el reembolso, NO cuando el PSP lo acepta: los tres caminos (`cancel_booking` de RN-37, el reembolso manual del admin y `expire_stale_bookings`) escriben `payments.status = 'refunded'` y el trigger encola ahí mismo. Quien habla con el PSP es `/api/cron/refunds-process`, que lee la cola `refund_requests` y **no toca `payments` ni encola nada** — verificado leyendo el job. Por eso el correo dice «está en camino» y «entre 3 y 10 días hábiles», y **nunca** «ya lo tienes». | Producto decide: acuse al pedirlo (lo de hoy), aviso al liquidarlo, o los dos. El segundo habría que construirlo entero — el webhook de Stripe **no** escucha reembolsos liquidados. |
| 2 | **El reloj de NTF-08 / NTF-11** | **Resuelta.** `20260911210000` los encola desde **`pg_cron`**, dentro de Postgres, y no desde GitHub Actions — cuya cadencia es una ficción (pide `*/5`, entrega una cada 2-6 h). Y `caducar_notificaciones` **mata en la cola** lo que ya no puede llegar a tiempo, porque el envío sigue yendo por el reloj lento. | Mirar `cron.job_run_details` **agregando por `jobname` y `status`** tras aplicar la migración: un job de `pg_cron` que falla no se lo dice a nadie. Y arreglado en dev ≠ arreglado en prod. |
| 3 | **S-49 y el enlace de baja** | **Abierta, y apagada a propósito.** Siete correos son no esenciales y deberían llevar «dejar de recibir estos avisos», pero su destino `/account#avisos` **no existe**. `BAJA_TIENE_DESTINO = false` y en su lugar va la cabecera `List-Unsubscribe` como `mailto:` (RFC 2369, válida, la respetan Gmail y Outlook, y no necesita pantalla). | Construir S-49. El día que exista: `BAJA_TIENE_DESTINO` a `true`, el `mailto:` a URL, y el enlace del pie vuelve solo — la marca `baja` ya está puesta correo por correo. |
| 4 | **El remitente definitivo** | **Abierta.** Sigue siendo `onboarding@resend.dev` (`EMAIL_FROM` sin poner). No es un olvido: verificar el dominio son registros DNS sobre M365 + Proofpoint. | El §2 entero. Es la decisión que **bloquea a las otras cuatro en impacto**: sin ella, los 34 correos salen bien diseñados desde una dirección que no es nuestra. |
| 5 | **Los correos de referidos** | **Abierta, y fuera de nuestro alcance por diseño.** Ninguno de los 34 ids es de referidos. Las reglas, los montos y el pago viven **enteros en Referral Factory** (RN-21), y los correos de recompensa los manda RF con su propia marca. Nosotros solo emitimos el enlace `?ref=`. | Decidir si queremos correo propio («tu referido reservó su primera mentoría»). Sería plantilla nueva **+ trigger nuevo** — y entonces aplica el orden de despliegue del §3. |
