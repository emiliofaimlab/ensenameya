-- ============================================================================
-- Enséñame Ya — M-02 (cierre): se retira `tutor_profiles.auto_accept_bookings`
--
-- `20260817180000` bajó el auto-aceptar del TUTOR a la MENTORÍA y dejó esta
-- columna deprecada, con su propio `comment on column` diciendo por qué NO se
-- borraba entonces:
--
--     «Se conserva solo para no romper el toggle del panel del tutor mientras
--      se retira»
--
-- y, más abajo en la misma migración:
--
--     «⚠️ CONSECUENCIA A CERRAR FUERA DE ESTA MIGRACIÓN: a partir de aquí ese
--      toggle del panel del tutor escribe una columna que ya no lee nadie. Es
--      un interruptor inerte y hay que quitarlo o reconvertirlo».
--
-- Se quitó. En el mismo commit que esta migración desaparecen
-- `src/app/(app)/tutor/reservas/auto-accept-toggle.tsx` (el único `update`) y
-- la consulta que lo alimentaba en `/tutor/reservas`, y el ajuste sale al
-- formulario de la mentoría (`products/acceptance-mode.tsx`, sobre
-- `products.auto_accept_bookings`). Con el último escritor fuera, el único
-- motivo documentado para conservar la columna deja de existir.
--
-- ⚠️ SE PIERDEN LOS VALORES, Y ES A PROPÓSITO. Nadie los va a echar de menos:
-- `20260817180000` decidió EXPRESAMENTE no sembrar las mentorías desde esta
-- columna («un backfill conservador dejaría la plataforma entera en false el
-- día uno»), así que estos booleanos no describen el comportamiento de nada
-- desde el 17-ago. Guardarlos «por si acaso» sería guardar un dato que ya
-- contradice a la realidad, que es peor que no tenerlo.
--
-- ⚠️ ORDEN DE DESPLIEGUE. Código y migración viajan juntos, pero si esto se
-- aplica ANTES de que el frontend nuevo esté arriba, el toggle viejo que siga
-- servido devolverá `PGRST204` («column not found») al pulsarlo. Hoy ese mismo
-- toggle ya no cambia nada, así que el daño es un toast rojo en lugar de una
-- mentira silenciosa — de las dos, la ruidosa es la buena. Al revés (código
-- primero, migración después) no hay ventana mala en absoluto.
--
-- ⚠️ NO HAY `revoke` DEL COLUMN-GRANT, y no es un olvido. El
-- `grant update (auto_accept_bookings) on public.tutor_profiles to
-- authenticated` de R24-19 (`20260724160000:18`) es un privilegio de COLUMNA:
-- vive en `pg_attribute.attacl` y se va con la columna en el mismo `drop`. Un
-- `revoke` escrito después fallaría por columna inexistente, y escrito antes
-- sería ceremonia.
--
-- REPLAY EN BASE NUEVA (prod, que aún no ha visto ninguna de estas): el orden
-- es `20260724160000` la crea → `20260806120000` y `20260817160000` publican
-- versiones de `confirm_payment` que la leen → `20260817180000` publica la v6,
-- que ya lee `products` → esto la borra. Ninguna función viva la referencia
-- cuando cae. Y aunque alguna quedara, el cuerpo de una `plpgsql` no resuelve
-- nombres de columna hasta que se ejecuta: no rompería la aplicación de las
-- migraciones, rompería en runtime. Por eso el orden importa y se deja escrito.
-- ============================================================================

alter table public.tutor_profiles
  drop column if exists auto_accept_bookings;

-- Dónde vive ahora, para quien llegue por `\d tutor_profiles` buscándola.
comment on table public.tutor_profiles is
  'Perfil público del tutor (EP-04). M-02 (27-ago-2026): ya NO tiene auto_accept_bookings — la aceptación automática se decide por mentoría, en products.auto_accept_bookings, y la lee confirm_payment.';
