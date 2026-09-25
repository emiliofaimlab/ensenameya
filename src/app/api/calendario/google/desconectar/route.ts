import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { descifrar, revocar } from "@/lib/google-calendar";

/** Revoca el permiso en Google y borra la conexión. Los eventos ya creados se
 *  quedan en su calendario, pero dejan de actualizarse. */
export async function POST() {
  const { data } = await (await createClient()).auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "no autorizado" }, { status: 401 });

  const admin = createAdminClient();
  const { data: fila } = await admin
    .from("google_calendar_connections")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (fila) {
    try {
      await revocar(descifrar(fila.refresh_token));
    } catch {
      // Token ilegible (secreto rotado): se borra igual.
    }
  }
  const { error } = await admin.from("google_calendar_connections").delete().eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
