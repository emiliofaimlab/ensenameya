import { getSessionContext } from "@/lib/auth/server";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PanelCard } from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { GestorDeAdmins, type AdminRow } from "./gestor";

export const metadata = { title: "Administradores · Enséñame Ya" };

/**
 * Quién tiene acceso de admin — darlo y quitarlo sin entrar a la base.
 *
 * Hasta hoy esto era un `insert` a mano en `user_roles`: la tabla no tiene
 * políticas de escritura a propósito (RN-31/S-31) y no había puerta ninguna.
 * Funcionaba, pero cada alta pasaba por nosotros. El 21-sep-2026, dando admin a
 * una cuenta existente, quedó claro que iba a repetirse.
 *
 * ⚠️ LO QUE SE DA AQUÍ ES ACCESO TOTAL, y la pantalla lo dice en voz alta: un
 * admin ve los pagos de todos, las fichas de los alumnos y aprueba
 * verificaciones de identidad. No es un permiso más.
 *
 * Las reglas duras viven en la base (`20260921200000`), no aquí: solo cuentas
 * que ya existen, y nadie se quita el acceso a sí mismo —que es lo que impide
 * quedarse fuera del panel y lo que garantiza que siempre quede al menos un
 * admin—. Esta pantalla solo las cuenta en cristiano.
 *
 * ⚠️ No lleva `loading.tsx` propio: `(app)/admin/loading.tsx` cubre `/admin/*`.
 */
export default async function AdminAdministradoresPage() {
  // Igual que `requireRole('admin')`, pero conservando el uid: la pantalla
  // necesita saber cuál de las filas eres TÚ para no ofrecerte un botón que la
  // base va a rechazar.
  const { user, roles } = await getSessionContext();
  if (!user) redirect("/login?next=/admin/administradores");
  if (!roles.includes("admin")) redirect("/app");

  const supabase = await createClient();

  // `listar_admins()` y no un `select`: el correo vive en `auth.users`, que no
  // está expuesto en la API. La propia función comprueba que quien pregunta sea
  // admin.
  const { data, error } = await supabase.rpc("listar_admins");

  // Regla de oro 10: sin mirar el `error`, un fallo de permisos se pintaría
  // como «no hay administradores», que en ESTA pantalla es la mentira más cara
  // que hay — invita a dar de alta a alguien creyendo que no queda nadie.
  const admins: AdminRow[] = error ? [] : (data ?? []);

  return (
    <AdminShell
      title="Administradores"
      description="Quién puede entrar al panel. Dar acceso es dar acceso a todo: pagos, fichas de alumnos y aprobación de tutores."
    >
      {error ? (
        <PanelCard className="border-[1.5px] border-[#f0bfbf] bg-[#fff8f8]">
          <p className="text-[13px] text-[#404040]">
            No se pudo leer la lista de administradores: {error.message}
          </p>
        </PanelCard>
      ) : (
        <GestorDeAdmins admins={admins} yo={user.id} />
      )}

      <PanelCard className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-[#19191f]">
          Antes de dar acceso
        </h2>
        <ul className="flex flex-col gap-2 text-[13px] leading-[1.6] text-[#404040]">
          <li>
            La cuenta <strong>tiene que existir ya</strong> en la plataforma.
            Esto no crea usuarios: si el correo no está registrado, no pasa
            nada — que es también lo que te avisa de una errata.
          </li>
          <li>
            <strong>Se suma a lo que ya tenga.</strong> Si esa persona es tutora
            o alumna, lo sigue siendo; solo gana el acceso al panel.
          </li>
          <li>
            <strong>No puedes quitarte el acceso a ti mismo.</strong> Es lo que
            impide que nadie se quede fuera del panel por un clic, y lo que
            garantiza que siempre quede alguien dentro.
          </li>
          <li>
            El cambio es <strong>inmediato</strong>: con recargar la página, esa
            persona ya ve el panel. No hace falta que cierre sesión.
          </li>
        </ul>
      </PanelCard>
    </AdminShell>
  );
}
