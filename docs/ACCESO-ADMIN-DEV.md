# Acceso de administrador — dev (RV-19)

> **Qué es esto.** Cómo se entra como administrador en **dev**, cómo se siembra uno nuevo y por qué
> ese acceso no vive en el documento de pruebas que se reparte al equipo.
>
> ⚠️ **Aquí NO hay ninguna contraseña, y no la va a haber.** Este repositorio es **público**
> (`github.com/emiliofaimlab/ensenameya`). Escribirla aquí sería mover el problema, no arreglarlo.

| Campo | Valor |
| :-- | :-- |
| Documento | Acceso admin dev (RV-19) |
| Ámbito | **Solo dev** (`lbtpnszjjsxbeileqsja`) |
| Sustituye a | La entrada "Admin" de `Guia-de-pruebas-dev.pdf` |
| Verificado contra dev | 2026-09-09 |

---

## 1. Cómo se entra hoy

- **La cuenta es `admin.us1101@ensenameya.dev`**, y es la **única** con rol `admin`: una sola fila
  `role = 'admin'` en `user_roles` sobre 45 cuentas de dev.
- **La contraseña se pide a quien administra.** Sigue **pendiente de rotar**: hoy es la misma que
  siembra `supabase/seed/dev-poblar.sql`, y ese archivo está en el repositorio público → §4.
- **Al entrar aterriza en `/admin`**: con rol `admin` manda `ROLE_HOME.admin` (`src/lib/auth/roles.ts`),
  salvo que la cookie `ey-panel` recuerde otro panel válido para esa persona.
- **El onboarding también aplica al admin** (RN-44): `requireUser()` redirige al asistente hasta que
  `profiles.onboarding_complete` sea cierto (`src/lib/auth/server.ts`).
- **Para mirar datos sin pasar por la app**, la terminal:

```bash
npx supabase db query --linked "select u.email, ur.role from auth.users u
  join public.user_roles ur on ur.user_id = u.id where ur.role = 'admin';"
```

⚠️ El `--linked` es obligatorio: sin él el CLI apunta a `127.0.0.1:54322` y pide Docker, que en este
proyecto no existe (`docs/ENTORNOS.md`).

---

## 2. Sembrar un admin (dev o un ambiente nuevo)

1. **El usuario tiene que existir ya en Auth.** Se registra por la app o desde el panel de Supabase.
   En **dev** el alta queda confirmada sola (las cuentas nuevas nacen con `email_confirmed_at`); en
   **prod** hay que confirmar el correo antes.
2. **`supabase/seed/admin-bootstrap.sql`**, con el email cambiado, en el SQL Editor del ambiente o
   por `db query`. Es idempotente (PK `user_id + role`) y siembra **el rol, no la contraseña**.
3. Comprobar con el `select` final del propio archivo: tiene que devolver la fila con `role = 'admin'`.

⚠️ **Por REST con `service_role` no se puede**: `user_roles` no le da `grant` (regla de oro 9) y la
llamada muere con `42501 permission denied`. Lo mismo pasa al sembrar catálogo (`products`,
`tutor_profiles`): la vía buena es abrir sesión del propio usuario con un magic link, que es lo que
hace `supabase/seed/dev-imagenes.mjs`.

⚠️ **Aprobar un tutor a mano son DOS escrituras**, no una: `tutor_profiles.approval_status` **y** la
fila de `user_roles`. Por eso se aprueba con `review_tutor()` desde `/admin/tutores/<id>`, que hace
las dos en la misma transacción (`20260715170000`). Un `update` suelto deja al tutor «aprobado» y sin
rol, y el fallo no aparece hasta que intenta entrar a su panel.

---

## 3. Qué puede el admin, que es de dónde sale el problema

Con esa única credencial se puede, sin proponérselo:

- **aprobar o rechazar tutores** y abrir sus **documentos de KYC** (6 tipos, `C-14`: CV, título,
  identidad, certificado, diploma y corte de notas). En dev hay **21 documentos subidos y 20 son de
  cuentas cuyo correo NO es `@ensenameya.dev`** — diez de ellos, de dos cuentas de `gmail.com`;
- **reembolsar pagos** con `refund_payment` desde `/admin/payments/<id>` (US-704), que **ejecuta
  contra Stripe en *test mode*** (X-01): el botón mueve dinero de verdad en el sandbox;
- **repartir roles**, incluido el de admin;
- **leer `profiles`, `payments` y `payouts` de todo el mundo** — hoy 45 perfiles, 171 reservas y
  97 pagos.

> La frontera real no es "cuentas de prueba sí / no": es **qué puede hacer cada rol**. Un alumno de
> mentira con contraseña conocida no es un problema. Un administrador con contraseña conocida sí.

---

## 4. La rotación, que es lo que sigue pendiente

### Paso 1 — Contraseña propia para el admin

Por el panel, que es el camino soportado: **Supabase → dev → Authentication → Users →
`admin.us1101@ensenameya.dev` → Reset / update password**. Por SQL (SQL editor de **dev**):

```sql
-- Solo dev. Este mismo UPDATE contra prod sería un incidente.
update auth.users
   set encrypted_password = extensions.crypt('<la nueva, del gestor>', extensions.gen_salt('bf')),
       updated_at = now()
 where email = 'admin.us1101@ensenameya.dev';
```

⚠️ **Cambiar la contraseña no cierra las sesiones ya abiertas.** Los refresh tokens vivos siguen
sirviendo. Si el motivo de la rotación es que alguien la tuvo, hay que además **cerrar sus sesiones**
("Sign out user" en el panel; por SQL, borrando sus filas de `auth.sessions` y `auth.refresh_tokens`).

### Paso 2 — Guardarla donde no sea el repositorio

**Gestor de contraseñas del equipo**, con acceso solo para quien administra. Nunca en el repo, ni en
Jira, ni en capturas, ni en el PDF de pruebas, ni en un mensaje de chat.

⚠️ **No hay recuperación por correo.** `@ensenameya.dev` no tiene buzón, así que el "he olvidado mi
contraseña" del admin no llega a ninguna parte. Si se pierde, solo se puede volver a fijar desde
Supabase — o sea, solo quien ya tiene acceso al proyecto.

### Paso 3 — Dejar la nota donde antes estaba el dato

- [ ] **`Guia-de-pruebas-dev.pdf`**: quitar la fila del admin y dejar *"El acceso de administrador ya
      no está aquí — pedirlo a quien administra; ver `docs/ACCESO-ADMIN-DEV.md`."*
- [ ] **`supabase/seed/dev-poblar.sql`**: su cabecera dice "Contraseña de **todas**". Desde la
      rotación deja de ser cierto y hay que decirlo ahí, que es donde alguien lo lee.
- [x] **`docs/QA-LANZAMIENTO.md` §4.1**, en el punto de sembrar el admin: apunta aquí.

---

## 5. Qué NO cambia, y con qué matiz

- **Las 12 cuentas del seed se quedan como están**, con su contraseña compartida y pública: son
  alumnos y tutores de mentira, y rotarlas costaría reescribir el seed y el PDF a cambio de nada.
  ⚠️ **Pero dev ya no es un entorno enteramente de mentira**: de sus 45 cuentas, **24 tienen un correo
  que no es del dominio de pruebas**, y casi todos los documentos de KYC cuelgan de ellas (§3). El
  argumento cubre a las cuentas del seed; no cubre lo que se ha ido subiendo encima.
- **`admin-bootstrap.sql` no se toca.** Siembra el rol, no la contraseña.

---

## 6. Producción

En prod **todavía no hay admin sembrado** — es un punto abierto del checklist
(`QA-LANZAMIENTO.md` §4.1). Cuando se siembre:

- [ ] Contraseña **propia**, generada en el momento, **distinta de la de dev** y de la del seed.
- [ ] Guardada en el gestor antes de crearla, no después.
- [ ] Con un **buzón que reciba de verdad**: un `…@ensenameya.dev` hereda el problema de recuperación
      de §4 y allí no hay red.
- [ ] Y su onboarding completado: el gate de `requireUser` (RN-44) también aplica al admin.

> Lo de dev es una molestia. Lo mismo en prod, con pagos reales y documentos de identidad de tutores
> de verdad, es otra cosa.

---

*Faim Lab · RV-19.*
