# Inventario de la Fase C · versiones vivas

> Fase 0 de `docs/PLAN-ACADEMIAS-Y-GRUPALES.md`. Sacado de `supabase/migrations/` el
> 8-oct-2026 sobre 220 migraciones (la última, `20261006140000`). **Antes de reescribir una
> función se vuelve a mirar aquí y en el repo**: si entró otra migración que la toca, esta
> tabla ya miente. Al empezar la Fase C, esta lista pasa a la cabecera de su primera migración.
>
> ⚠️ Esto es la versión viva **en el repo**. La de la BD de dev puede ser otra si alguien
> aplicó algo a mano (regla 11: «arreglado» es por ambiente). Se compara con
> `pg_get_functiondef` antes de copiar.

## Funciones que se reescriben

`v` = cuántas migraciones la han definido. Las referencias del plan (§2) siguen siendo
correctas: de las 4 migraciones posteriores al plan, solo `20261002120000` define una
función (`products_slug`), y no es ninguna de estas.

| Función | Versión viva | v | Quién la cambia |
| :-- | :-- | --: | :-- |
| `create_booking_line(uuid, uuid, timestamptz[])` | `20260910120000:97` | 6 | Grupales + academias |
| `create_booking` | `20260827150000:468` | 3 | Solo se prueba (llama a la de arriba) |
| `create_order(jsonb)` | `20260827150000:524` | 1 | Solo se prueba |
| `get_available_slots(uuid, date, date)` | `20260831190000:137` | 3 | Grupales |
| `cancel_booking(uuid, text)` | `20260912110000:3022` | 4 | Grupales + academias |
| `expire_stale_bookings(interval, interval)` | `20260912110000:2830` | 4 | Academias (grupales lo verifica) |
| `proponer_reagenda(uuid, timestamptz)` | `20260925120000:96` | 1 | Grupales + academias |
| `responder_reagenda(uuid, boolean)` | `20260925120000:190` | 1 | Grupales + academias |
| `join_session(uuid)` | `20260828120000:69` | 4 | Grupales (gemela `join_group_class`) |
| `close_expired_sessions()` | `20260828183000:68` | 3 | Grupales · ⚠️ cron, regla 11 |
| `build_payout_for_tutor` | `20260912100000:482` | 3 | Academias (grupales lo verifica) |
| `tutor_balance(integer)` | `20260912100000:1289` | 2 | Academias |
| `aplicar_credito(uuid, uuid)` | `20260912110000:1591` | 2 | Grupales + academias |
| `comprar_regalo` | `20260912110000:2138` | 1 | Grupales + academias |
| `reembolsar_con_credito` | `20260912110000:900` | 1 | Solo se usa (`cancelar_fecha_grupal`): ¿importe parcial? |
| `enqueue_refund(uuid, bigint, text, text)` | `20260912110000:768` | 2 | Solo se usa |
| `notify_booking()` (trigger) | `20260911180000:249` | 3 | Grupales (NTF-51/56) |
| `google_calendar_eventos` | `20260925180000:53` | 1 | Grupales (un evento por clase al tutor) |
| `calendar_feed(text)` | `20260826210000:259` | 1 | Grupales |
| `avisar_clases_de_manana()` | `20260911210000:172` | 1 | Grupales (uno por `group_class` al tutor) |
| `avisar_clases_que_empiezan()` | `20260911210000:235` | 1 | Grupales |
| `send_conversation_message` | `20260828150000:70` | 3 | Grupales + academias (chat) |
| `pair_can_chat(uuid, uuid)` | `20260826140000:71` | 2 | Grupales |
| `my_conversations()` | `20260817210000:778` | 3 | Grupales + academias · ⚠️ ya se hizo `drop` 2 veces |
| `mark_conversation_read(uuid)` | `20260817210000:691` | 1 | Grupales |
| `unread_conversation_counts()` | `20260817210000:735` | 1 | Grupales |
| `purge_expired_messages()` | `20260827190000:87` | **9** | Grupales · ⚠️ cron, la más reescrita del repo |
| `confirm_payment` | `20260912110000:1276` | 8 | No se toca: verificar el invariante del 5 % |

## Esquema que se toca

| Objeto | Dónde vive hoy |
| :-- | :-- |
| Candado `sessions_sin_solape_por_tutor` | Solo `20260831180000:110-126` (las demás lo citan en comentarios) |
| Políticas de `products` | 4 migraciones; última `20260723130000` |
| `products.slug` + `products_slug()` | `20261002120000`, **posterior al plan**: la ficha grupal y el sitemap de G2 van por slug |
| Políticas de `bookings` y `sessions` | Una sola: `20260709140000` |
| Políticas de `messages` y `conversations` | `20260817210000` |
| `academies` + `tutor_profiles.academy_id` | `20260915180000` (ya existe; `REQUERIMIENTOS.md` la sustituye) |

## Regla 10 · embeds

- **Chat:** el frontend **no** embebe `conversations`; todo pasa por `my_conversations()` y
  las otras RPC. Darle a `conversations` una FK más (`group_product_id → products`) no rompe
  ninguna consulta de `src/`.
- **`profiles ↔ academies`: ⚠️ ya hay una tabla puente.** `tutor_profiles` tiene FK a
  `profiles` y a `academies`, así que para PostgREST ya une las dos. Crear `academy_members`
  añade la segunda vía → cualquier embed `profiles ↔ academies` sin FK nombrada cae con
  `PGRST201`. Hoy `src/` no hace ninguno (el catálogo lee `academies_public`), pero las
  pantallas de A2/A3 deben nombrar la FK desde el primer día.
- **Embeds sin nombrar a `profiles`:** solo dos, ambos por FK directa y sin puente posible:
  `admin/notificaciones/queries.ts:102` y `admin/alertas/page.tsx:84` (payouts). Si
  `payouts` gana `academy_id`, pasa a ser puente `profiles ↔ academies`: no rompe esos dos,
  pero suma otra vía al punto anterior.
- **Consultas a `products`:** 36 `from("products")` en 18 ficheros (el plan dice 35).
  Contando embeds `products(…)`, 72 en 38. La pasada de G2 recorre las 72.

## Bloqueado

- **`REQUERIMIENTOS.md` no está en el repo.** La Fase C incluye su Fase 1 entera (§3.1–§3.3).
  Sin él solo avanza la parte de grupales.
