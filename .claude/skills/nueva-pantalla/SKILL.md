---
name: nueva-pantalla
description: Crea una pantalla/ruta Next.js (App Router) para Enséñame Ya siguiendo las convenciones del proyecto (grupo de rutas correcto, guardas de sesión y rol de lib/auth/server, loading.tsx, cliente Supabase correcto, locale es, Tailwind responsive, RLS, UTC a hora local). Úsalo al añadir páginas o vistas nuevas.
---

# Nueva pantalla (Enséñame Ya)

## 1. Elige el grupo de rutas — es el primer paso, no un detalle

Ninguna pantalla vive en `src/app/<ruta>/page.tsx` directamente. Todas cuelgan de uno de los
**seis grupos**, y el grupo decide el armazón, la guarda de sesión y qué se ve alrededor:

| Grupo | Para qué | Guarda del layout |
| :-- | :-- | :-- |
| `(public)` | catálogo, tutores, legales, contacto, carrito | ninguna: `getSessionContext()` para pintar cabecera con o sin sesión |
| `(auth)` | login y registro | `requireGuest()` |
| `(recovery)` | `/reset` | ninguna a propósito: corre con una sesión de recuperación |
| `(app)` | panel de alumno, tutor y admin | `requireUser()` |
| `(checkout)` | solo donde se cobra: aislado, sin cabecera ni pie ni chat | — |
| `(room)` | solo la sala de Daily, casi a pantalla completa | — |

Los grupos están **en la raíz** a propósito: los layouts del App Router se anidan, así que un
`layout.tsx` dentro de `(app)` heredaría su cabecera, su menú y su pie. Si tu pantalla no debe
heredarlos, no basta con anidar — tiene que estar en otro grupo. Lee el comentario de cabecera
de `src/app/(checkout)/layout.tsx` antes de crear uno nuevo.

## 2. Server vs Client

- Por defecto **Server Component**: los datos se piden en el servidor y las páginas públicas
  posicionan.
- `"use client"` solo para estado/interactividad del navegador. El patrón de la casa es una
  página server que hace las consultas y le pasa los datos a un componente cliente pequeño.

## 3. Sesión y rol: `src/lib/auth/server.ts`, nunca `auth.getUser()`

```ts
import { requireUser, requireRole, getSessionContext } from "@/lib/auth/server";

const { user, roles } = await requireUser();   // exige sesión → /login?next=…
await requireRole("admin");                    // exige rol → si no, a su home
const ctx = await getSessionContext();          // sin redirigir: user | null, roles, notices…
```

Firmas reales que ofrece ese módulo: `getSessionContext()`, `getUser()`, `getUserRoles()`,
`requireUser()`, `requireGuest()`, `requireRole(role)`, `getUserTimezone()`,
`getViewerTimezone()`.

⚠️ **`supabase.auth.getUser()` no se usa en pantallas.** Es un viaje de red al servidor de Auth
(medido: 250–400 ms) y se pagaba varias veces por navegación —layout, página y el helper de zona
horaria—, que es la lentitud que reportó el cliente. `getSessionContext()` verifica el JWT **en
local** con `getClaims()` (ES256 + JWKS, ~17 ms), trae roles, perfil y avisos en una sola RPC
(`session_bootstrap`) y está envuelto en `cache()`, así que llamarlo desde el layout y desde la
página cuesta una vez. Misma garantía criptográfica, no un `getSession()` a ciegas.

`requireUser()` además empuja al onboarding si falta (US-201 / RN-44); no lo reimplementes.

## 4. Cliente Supabase correcto

- Server Component / Route Handler →
  `import { createClient } from "@/lib/supabase/server"` (es async: `await createClient()`).
- Client Component → `import { createClient } from "@/lib/supabase/client"`.
- `service_role` → `import { createAdminClient } from "@/lib/supabase/admin"`.

La regla es **jamás en el navegador**, no "jamás en una pantalla": el módulo es `server-only`
(si lo importa un componente cliente, el build falla) y hay pantallas que lo usan a propósito
—`src/app/(app)/pagos/page.tsx` y `src/app/(app)/admin/payouts/page.tsx`— para leer datos de
sistema que la RLS del usuario no puede ver. Por defecto usa `server.ts` y deja que mande la
RLS; saltársela "para que sea más fácil" es cómo una regla default-deny se convierte en fuga.

## 5. `loading.tsx`: obligatorio en toda ruta con datos

Sin él la navegación se queda **congelada en la pantalla anterior** hasta que llegan los datos
(medido: ~700 ms), en vez de pintar el armazón en ~60 ms. Hay siete en el repo y son de dos
formas:

```tsx
// ruta sin menú lateral → basta reexportar
export { PageLoading as default } from "@/components/layout/page-loading";
```

```tsx
// dentro de un panel: el menú NO debe desaparecer mientras carga
import { PanelShell } from "@/components/layout/panel-shell";
import { TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import { PageLoading } from "@/components/layout/page-loading";

export default function TutorLoading() {
  return (
    <PanelShell items={TUTOR_ITEMS}>
      <PageLoading />
    </PanelShell>
  );
}
```

## 6. Datos

- Confía en RLS para "lo del usuario" y pide **solo** las columnas necesarias en `.select()`.
- **Mira el `error`.** `const { data } = …` convierte un fallo en lista vacía, que es una mentira
  creíble: así una cola del admin enseñó «(0)» con 11 tutores esperando.
- Embeds ambiguos: si hay más de un camino entre dos tablas, PostgREST devuelve `PGRST201` y la
  consulta entera se cae. Se nombra la FK — `profiles!tutor_profiles_profile_id_fkey(full_name)`.

## 7. Fechas: UTC en la BD, hora local en pantalla (RN-01 / RN-02)

- Con sesión → `getUserTimezone()`. Pantalla **pública** con horarios → `getViewerTimezone()`
  (un visitante en Venezuela ve la clase del tutor mexicano en su propia hora).
- Formatea con `formatSessionTime(iso, tz)` / `formatShortDate(iso, tz)` de `@/lib/booking`.
  Pasar `timeZone` es **obligatorio** en server: sin él el SSR usa la del servidor (UTC).
- La zona del navegador viaja en la cookie `ey-tz` (`TZ_COOKIE` en `src/lib/tz.ts`), y
  `'UTC'` en `profiles.timezone` significa «nadie la fijó», no «vive en UTC».

## 8. Lo demás

- Textos en español (locale `es`). Vocabulario: **mentoría**; «sesión» y «tutor» se mantienen.
- Tailwind, responsive móvil / tablet / escritorio.
- El flujo de la pantalla, en
  `docs/context/04-mapa-de-pantallas-y-flujos.md`. Si el Figma no trae un campo, no se pone.
- Verifica con `npm run lint` y `npm run typecheck`.

## Esqueleto (Server Component con datos, dentro de `(app)`)

```tsx
import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatSessionTime } from "@/lib/booking";

export const metadata = { title: "Mis reservas · Enséñame Ya" };

export default async function Page() {
  const { user } = await requireUser();
  const tz = await getUserTimezone();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("id, status, sessions(start_at)")
    .eq("student_id", user.id);

  if (error) throw error; // nunca lo trates como lista vacía

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {(data ?? []).map((b) => (
        <p key={b.id}>{formatSessionTime(b.sessions!.start_at, tz)}</p>
      ))}
    </main>
  );
}
```

Y su `loading.tsx` al lado, en el mismo segmento.
