# Acceso de administrador — dev (RV-19)

> **Qué es esto.** El acceso al panel de admin de **dev**, separado del documento de cuentas de
> prueba. Hasta el 17-ago los dos vivían juntos y compartían contraseña; esa es exactamente la
> incidencia **RV-19**.
>
> ⚠️ **Aquí NO hay ninguna contraseña, y no la va a haber.** Este repositorio es **público**
> (`github.com/emiliofaimlab/ensenameya`). Escribirla aquí sería mover el problema, no arreglarlo.

| Campo | Valor |
| :-- | :-- |
| Documento | Acceso admin dev |
| Fecha | 2026-08-17 |
| Ámbito | **Solo dev** (`lbtpnszjjsxbeileqsja`) |
| Sustituye a | La entrada "Admin" de `Guia-de-pruebas-dev.pdf` (10-ago) |

---

## 1. El problema, dicho entero

Tras la purga del 10-ago quedaron **13 cuentas en dev**: 8 tutores, 4 alumnos y **un admin**
(`admin.us1101@ensenameya.dev`, el único con rol `admin` desde `supabase/seed/admin-bootstrap.sql`).
Las trece se igualaron a **la misma contraseña**, y esa contraseña se repartió en el mismo PDF de
pruebas que se le pasa a cualquiera que vaya a probar la app.

Con esa única cadena, quien iba a probar el flujo de reserva como alumno podía además, sin
proponérselo:

- **aprobar o rechazar tutores** y leer sus **documentos de KYC** (7 documentos por tutor, `C-14`);
- **reembolsar pagos** desde `refund_payment` (US-704) — y desde el 17-ago eso ya **encola contra
  Stripe de verdad** (X-01), así que el botón mueve dinero en el sandbox;
- **repartir roles**, incluido el de admin;
- leer `payments`, `payouts` y `profiles` de todo el mundo (matriz de §1 de `QA-LANZAMIENTO.md`:
  el admin ve 43 perfiles, 54 reservas y 49 pagos).

**Y hay un agravante que RV-19 no menciona:** la contraseña compartida está **escrita en claro en el
repositorio público**, en `supabase/seed/dev-poblar.sql` (`crypt('…', gen_salt('bf'))`, cabecera del
archivo). Para las 12 cuentas de mentira eso es asumible —solo pueden mirar datos falsos de dev—;
para el **admin** no lo es en ningún caso. Mientras el admin comparta esa contraseña, **el acceso de
administrador de dev es público**.

> La frontera real no es "cuentas de prueba sí / no": es **qué puede hacer cada rol**. Un alumno de
> mentira con contraseña conocida no es un problema. Un administrador con contraseña conocida sí.

---

## 2. Qué se hace, en tres pasos

### Paso 1 — Rotar la contraseña del admin a una propia

Por el panel, que es el camino soportado: **Supabase → dev → Authentication → Users →
`admin.us1101@ensenameya.dev` → Reset / update password**.

Si hiciera falta hacerlo por SQL (SQL editor de **dev**):

```sql
-- Solo dev. Este mismo UPDATE contra prod sería un incidente.
update auth.users
   set encrypted_password = extensions.crypt('<la nueva, del gestor>', extensions.gen_salt('bf')),
       updated_at = now()
 where email = 'admin.us1101@ensenameya.dev';
```

⚠️ **Cambiar la contraseña no cierra las sesiones ya abiertas.** Los refresh tokens vivos siguen
sirviendo. Si el motivo de la rotación es que alguien la tuvo, hay que además **cerrar sus sesiones**
(en el panel, "Sign out user"; por SQL, borrando sus filas de `auth.sessions` y
`auth.refresh_tokens`). Rotar sin esto deja la puerta abierta el tiempo que dure el token.

### Paso 2 — Guardarla donde no sea el repositorio

**Gestor de contraseñas del equipo**, con acceso solo para quien administra. Nunca en el repo, ni en
Jira, ni en capturas, ni en el PDF de pruebas, ni en un mensaje de chat.

⚠️ **Guardarla bien no es opcional aquí: no hay recuperación por correo.** `@ensenameya.dev` no tiene
buzón, así que el "he olvidado mi contraseña" del admin **no llega a ninguna parte**. Si se pierde,
la única salida es volver a fijarla por SQL o por el panel — lo cual solo puede hacer quien ya tenga
acceso a Supabase. Es recuperable, pero no por el camino que uno espera.

### Paso 3 — Dejar la nota en el sitio de donde salió

Para que quien busque el acceso de admin donde siempre lo tuvo no concluya que se perdió:

- [ ] **`Guia-de-pruebas-dev.pdf`** (el documento que se reparte al equipo): quitar la fila del admin
      y dejar en su lugar *"El acceso de administrador ya no está aquí — pedirlo a quien administra;
      ver `docs/ACCESO-ADMIN-DEV.md`."*
- [ ] **`supabase/seed/dev-poblar.sql`**: su cabecera dice "Contraseña de **todas**". Desde la
      rotación deja de ser cierto y hay que decirlo ahí, que es donde alguien lo lee. **Ese archivo
      no es de este carril**; queda anotado para quien lo tenga.
- [x] **`docs/QA-LANZAMIENTO.md` §4.1**, en el punto de sembrar el admin: apunta aquí.

---

## 3. Qué NO cambia, y por qué

- **Las 12 cuentas de prueba se quedan como están**, con su contraseña compartida y pública. Son
  alumnos y tutores de mentira sobre datos de mentira en dev; rotarlas costaría reescribir el seed y
  el PDF a cambio de nada. ⚠️ Ese razonamiento se cae el día que **dev tenga un dato personal de
  verdad** — una cuenta real de alguien del equipo, un documento de KYC auténtico subido "para
  probar". Si eso pasa, dev deja de ser un entorno de mentira y esto hay que replantearlo entero.
- **`admin-bootstrap.sql` no se toca.** Siembra el rol, no la contraseña.

---

## 4. Producción, que es donde esto importa de verdad

En prod **todavía no hay admin sembrado** — es un punto abierto del checklist
(`QA-LANZAMIENTO.md` §4.1). Cuando se siembre:

- [ ] Contraseña **propia**, generada en el momento, **distinta de la de dev** y distinta de la del
      seed. No copiar nada de este entorno.
- [ ] Guardada en el gestor antes de crearla, no después.
- [ ] Con un **buzón que reciba de verdad** — si el admin de prod se llama `…@ensenameya.dev` hereda
      el mismo problema de recuperación descrito arriba, y allí no hay red.
- [ ] Y su onboarding completado: el gate de `requireUser` (RN-44) también aplica al admin.

> Lo de dev es una molestia. Lo mismo en prod, con pagos reales y documentos de identidad de tutores
> de verdad, es otra cosa.

---

*Faim Lab · RV-19 · 17 de agosto de 2026.*
