---
name: nueva-pantalla
description: Crea una pantalla/ruta Next.js (App Router) para Enséñame Ya siguiendo las convenciones del proyecto (server vs client component, cliente Supabase correcto, locale es, Tailwind responsive, RLS, UTC a hora local). Úsalo al añadir páginas o vistas nuevas.
---

# Nueva pantalla (Enséñame Ya)

Al crear una ruta o pantalla:

1. **Ubicación:** `src/app/<ruta>/page.tsx`. Layouts compartidos en el
   `layout.tsx` del segmento.
2. **Server vs Client:**
   - Por defecto **Server Component** (datos en el servidor, mejor SEO en
     páginas públicas).
   - Usa `"use client"` solo si necesitas estado/interactividad del navegador.
3. **Cliente Supabase correcto:**
   - Server Component / Route Handler →
     `import { createClient } from "@/lib/supabase/server"` (es async:
     `const supabase = await createClient()`).
   - Client Component → `import { createClient } from "@/lib/supabase/client"`.
   - **Nunca** uses `service_role` aquí; eso vive en Edge Functions.
4. **Auth / protección:** en rutas privadas valida la sesión con
   `supabase.auth.getUser()` y redirige si no hay usuario. RLS ya protege los
   datos; la redirección es solo UX.
5. **Datos:** confía en RLS para "lo del usuario". Pide solo las columnas
   necesarias en el `.select()`.
6. **Fechas:** la BD entrega UTC; renderiza en la zona horaria del usuario (RN-02).
7. **i18n:** textos en español (locale `es`).
8. **Estilos:** Tailwind, responsive Desktop / Tablet / Móvil.
9. **Spec:** revisa la pantalla en `docs/context/05-spec-por-pantalla.md` y el
   flujo en `docs/context/04-mapa-de-pantallas-y-flujos.md`.
10. **Verifica:** `npm run lint` y `npx tsc --noEmit`.

## Esqueleto (Server Component con datos)

```tsx
import { createClient } from "@/lib/supabase/server";

export default async function Page() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // … queries protegidas por RLS …

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {/* contenido */}
    </main>
  );
}
```
