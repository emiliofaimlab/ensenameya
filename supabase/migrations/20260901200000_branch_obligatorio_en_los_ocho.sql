-- Enséñame Ya — `bank_branch` es obligatorio en los OCHO países, no en tres.
--
-- B1 (`20260901160000`) puso `requires_branch = false` en AR, CL, EC, MX y PE, y
-- lo dejó anotado como «la apuesta más grande del diseño»: la tabla global de
-- dLocal marcaba el campo `Required: Yes` sin excepciones, pero las páginas por
-- país no lo repetían, así que se eligió lo permisivo para no rechazar tutores.
--
-- Ya no hace falta apostar. Con la cuenta de sandbox se le mandó a
-- `POST /v1/payouts` un beneficiario por país, con y sin `bank_branch`:
-- **sin él, los ocho responden `5000 must not be null`**; con él, pasan a
-- errores de negocio (fondos, formato, límite), que es la señal de que el
-- payload ya es aceptable.
--
-- Es la diferencia entre «la documentación no lo dice» y «la API lo rechaza», y
-- por eso esto se corrige con datos y no con criterio.
--
-- Se corrige con UPDATE y no reescribiendo B1: esa migración ya está aplicada y
-- las migraciones son inmutables (regla de oro 5).
--
-- `branch_pattern` se queda en null en los cinco que no publican formato: el
-- `check` genérico de longitud y charset basta, y un patrón inventado
-- rechazaría sucursales válidas — que es el error contrario y peor, porque deja
-- al tutor sin poder cobrar y sin saber por qué.
update public.payout_country_rules
   set requires_branch = true
 where requires_branch is distinct from true;

-- ⚠️ Dos cosas más que salieron de la misma tanda de pruebas y que NO se
-- arreglan aquí porque piden decidir, no corregir:
--   · **AR rechaza `bank_account_type: 'CHECKING'`** («unsupported value»), así
--     que su lista de tipos admitidos está mal y hay que ejercitarla contra la
--     API uno por uno antes de escribirla.
--   · **PE exige `beneficiary.address.street`**, un campo que B1 decidió no
--     guardar porque la documentación no dice nunca cuáles hacen falta. Ahora
--     sabemos uno; probablemente no sea el único.
