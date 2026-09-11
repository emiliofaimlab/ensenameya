import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * CUÁNTOS DÍAS TIENE EL DESTINATARIO PARA AGENDAR SU REGALO.
 *
 * 🔴 SALE DE LA BASE, NO DE UN LITERAL. El número lo escribe
 * `gift_expiry_days()` (`20260912110000`, §0) y es el MISMO que
 * `confirm_gift_payment` usa para calcular `credits.expires_at` al cobrar. Un
 * 90 tecleado en esta carpeta diría la verdad hasta el día que el cliente lo
 * cambie en la migración; y el sitio donde se nota es el peor posible — la
 * frase que se lee justo antes de pagar.
 *
 * ⚠️ La cabecera de esa migración manda además tener un espejo
 * (`GIFT_POLICY.diasParaAgendar` en `src/lib/policy.ts`), que hoy **no
 * existe**. Mientras no exista, leerlo por RPC es lo honesto: una constante
 * nueva aquí sería un tercer sitio donde el número puede envejecer, y de los
 * tres este es el único que no puede mentir. Si mañana se añade a `policy.ts`,
 * esta función es la que hay que borrar, no la que hay que duplicar.
 *
 * ⚠️ Y SI LA LECTURA FALLA NO SE INVENTA UN NÚMERO: devuelve `null` y quien lo
 * pinta dice «caduca» sin cifra (regla de oro 10 — un `const { data } = …`
 * aquí convertiría un fallo en un `0` y la pantalla prometería un regalo que
 * caduca hoy). La RPC es `immutable` y tiene `grant execute` a `authenticated`,
 * así que el caso normal es que llegue siempre.
 */
export async function diasParaAgendar(): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gift_expiry_days");

  if (error) {
    console.error("[regalar] no se pudo leer gift_expiry_days:", error.message);
    return null;
  }
  return typeof data === "number" ? data : null;
}

/**
 * «caduca a los 90 días» / «caduca» — la misma frase en las cuatro pantallas.
 *
 * Se escribe una vez porque la dicen la puerta, el formulario, el pago y «Mis
 * regalos», y porque es una PROMESA: si dos de ellas dijeran plazos distintos,
 * la que se lee antes de pagar sería la que manda y la otra la que genera el
 * correo a soporte.
 */
export function plazoEnPalabras(dias: number | null): string {
  return dias === null ? "tiene fecha de caducidad" : `caduca a los ${dias} días`;
}
