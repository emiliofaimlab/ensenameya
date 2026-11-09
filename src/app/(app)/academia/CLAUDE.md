# Sección Academias — reglas para agentes

Se suma al `CLAUDE.md` raíz; no lo repite.

- **Puerta:** toda pantalla empieza con `await requireAcademiaPropia()` (`src/lib/auth/academia.ts`). Ni `requireRole`, ni un layout que haga de guarda.
- **Esquema:** ya existe y no se crea otro. `academies`, `academy_members` (admin/tutor/student · invited/active/removed), `availability_requests`, `es_admin_de_academia()`, `es_alumno_de_academia()`. Migraciones `*academ*`. Escritura por RPC, nunca un insert directo.
- **Reglas de negocio:** RA-xx en `docs/REQUERIMIENTOS.md`; las grupales, en RG-xx de `docs/PLAN-ACADEMIAS-Y-GRUPALES.md`.
- **Listados de mentorías:** filtra `group_template_id is null`.
- **Fuera de alcance:** `src/components/sala/` (la segunda cámara está en espera de aviso), los descargables del tutor (`/tutor/descargables`) y el dinero (`20261009190000`).
- **Enlaces:** desde fuera de `(app)` no se escribe `/academia` a mano (regla 13).
