# B2B — Perfil «academia»

> **Estado: construida la VITRINA, nada del motor.** Nace de la consulta de
> Néstor (14-sep-2026) a raíz de la alianza con un tutor de inglés que trae su
> propia metodología y su propio *supply* («Tutorías de inglés powered by
> Project Blue»).
>
> El 15-sep se decidió construir **solo la cara pública** para poder enseñarla
> al cliente. Lo que existe hoy, en código:
>
> | Existe | No existe, y es deliberado |
> | :-- | :-- |
> | Tabla `academies` + `tutor_profiles.academy_id` (`20260915180000`) | Rol `academia` y su panel |
> | `/academias` y `/academias/<slug>` públicas | Alta de tutores por la academia (hoy la hace el admin por SQL) |
> | Vista `academies_public` con cifras agregadas | **Cualquier cambio en el motor de pagos** |
>
> ⚠️ **El motor de pagos NO se ha tocado, y no se toca sin hablar con el
> cliente.** Reservar desde la ficha de una academia crea el mismo `booking`
> contra el mismo tutor que reservar desde `/tutors`: la academia no cobra, no
> recibe payouts y no tiene mentorías propias. Todo lo que sigue en este
> documento sobre el reparto del dinero **sigue sin construir**.

## TL;DR

1. **La alianza se puede cerrar hoy**, con cuentas de tutor individuales y el
   reparto academia↔profesor fuera de la plataforma. Desde el 15-sep esos
   tutores además se ven agrupados bajo la marca de la academia en
   `/academias/<slug>`, que es presentación y nada más.
2. **El perfil «academia» de verdad sí es un pivot**, y lo caro no es la pantalla:
   es que el reparto de dinero hoy es de **dos partes** y una academia lo vuelve
   de **tres**.
3. **Hoy no hay que hacer nada para preservar la opción.** Ni un campo «por si
   acaso». Las dos decisiones que importaban ya están bien tomadas por casualidad
   (ver [Lo que ya juega a favor](#lo-que-ya-juega-a-favor)).

## La versión con cinta adhesiva (coste: cero)

Project Blue entra con **N cuentas de tutor individuales**, una por profesor.
Cada uno cobra de EY como cualquier otro tutor, y el reparto con la academia lo
liquidan ellos por su cuenta. El «powered by Project Blue» es una landing de
marketing, no un producto.

Qué se pierde frente a la versión construida:

- La academia **no ve** las reservas ni los ingresos de sus profesores dentro de
  EY. Los pide por fuera.
- **No hay cobro agregado**: EY paga a N personas, no a una empresa.
- El co-branding es una página, no una experiencia.
- La aprobación sigue siendo **tutor a tutor**, con los 6 documentos de KYC de
  C-14.

Qué se gana: se descubre si el B2B vende **antes** de pagar el esquema. Si
funciona con cinta adhesiva, se construye con datos reales en la mano.

## Lo que costaría construirlo de verdad

Ordenado por dolor, que no coincide con el orden de visibilidad.

### 1. El dinero — la mitad del proyecto está aquí

El reparto actual tiene **exactamente dos partes**, y está congelado en el
esquema en tres sitios:

| Dónde | Qué dice hoy |
| :-- | :-- |
| `bookings.tier_split_pct` | un `numeric(5,2)`: el % que se lleva el tutor. Un número, dos partes. |
| `payouts.tutor_id` | `references profiles(id)` — el beneficiario **es** el tutor |
| `payout_items.payment_id` | un pago pertenece a **≤ 1 payout** (`unique`) |

Una academia introduce un beneficiario que no es el tutor, y eso arrastra:

- **El split de tres partes.** `tier_split_pct` deja de poder expresar el reparto.
  No es «un campo más»: es cambiar el modelo, con su snapshot por reserva y su
  aritmética de redondeo (el dinero es `bigint` en unidades mínimas, y 100 −
  a − b tiene que cuadrar al céntimo).
- **La ruta de payout.** La decide `payout_country_rules(payee_country)` con el
  país del **tutor**. Con academia de por medio el país del beneficiario puede
  ser otro, y son rieles distintos (Wise llega a 55 países, dLocal a 18).
- ⚠️ **Los datos bancarios están modelados para PERSONA FÍSICA.**
  `tutor_payout_accounts` es PK por `tutor_id` y pide
  `beneficiary_first_name` + `beneficiary_last_name` + documento fiscal personal.
  Una academia es una empresa: razón social y documento de empresa. Wise y dLocal
  distinguen beneficiario `INDIVIDUAL` de `BUSINESS` y **piden campos distintos**.
  Esto es trabajo real en `lib/payments/wise-mapeo.ts` y en el formulario, no un
  rename.
- **`generate_payout_for_tutor` y el job `payouts-process`** asumen un tutor por
  payout de principio a fin.

### 2. Identidad y organización

`app_role` es un enum de tres valores: `('alumno','tutor','admin')`. Hace falta:

- rol nuevo (o un concepto aparte de rol — decisión de diseño abierta),
- tabla `organizations`,
- tabla puente `organization_members`.

⚠️ **Trampa conocida (regla de oro 10):** una tabla puente nueva entre `profiles`
y `tutor_profiles` vuelve **ambiguos los embeds de PostgREST** entre esas dos
tablas, y las consultas existentes se caen con `PGRST201` — no se degradan. Es
exactamente lo que hizo `tutor_views` (`20260827140000`), que dejó la cola de
aprobación del admin enseñando «(0)» con 11 tutores esperando. Habría que repasar
y nombrar la FK en toda consulta ya escrita que haga ese embed.

### 3. RLS — la parte aburrida y la que falla abierto

Toda la política actual se resuelve con «eres tú» o «eres admin». Un dueño de
academia es un **tercer sujeto**: ve reservas, sesiones e ingresos de *sus*
tutores, y de nadie más. Tablas a repasar, mínimo: `bookings`, `sessions`,
`payments`, `payouts`, `products`, `availability`, `reviews`, `messages`.

Es el trabajo menos vistoso del lote y el único donde equivocarse **publica datos
de un tutor a un tercero**. No se hace con prisa (RISK-13).

### 4. KYC y aprobación

Hoy la cola de admin aprueba tutor a tutor con los 6 documentos de C-14. Una
academia querría **avalar a los suyos** o aprobar en bloque. Es una decisión de
producto y de responsabilidad legal (¿quién responde si un profesor avalado por
la academia resulta no tener el título?), no un problema técnico.

### 5. Co-branding

- **Barato:** un campo de marca en el perfil del tutor y pintarlo en la ficha y en
  la tarjeta. Un par de días.
- **Caro:** subdominio propio, tema propio, catálogo filtrado. Eso es
  multi-tenant, y es otra liga entera.

## Lo que ya juega a favor

Dos decisiones del esquema, tomadas por otros motivos, dejan la puerta abierta:

- **`tier_split_pct` es un snapshot por reserva**, no una lectura en vivo. El día
  que el reparto sea de tres partes, las reservas viejas **no se reinterpretan**
  solas. No hay que migrar historia.
- **`payouts.provider` es `text`, no un enum**, y se resuelve al ejecutar. Un
  riel nuevo para empresas no rompe el esquema.

## Lo que hay que hacer hoy

**Nada.**

En particular, **no** añadir un `organization_id` nullable «por si acaso»: una
columna que nadie lee es una columna que hay que explicar durante un año, y este
repo ya tiene bastante de eso.

Lo único que sí importa, y es gratis:

1. **No prometer «powered by X» en público** hasta que exista la experiencia que
   el nombre promete.
2. **No reabrir el reparto de comisión** en el MVP. Si `tier_split_pct` se
   convierte en algo más complicado ahora, se paga el coste sin cobrar el
   beneficio.

## Inconvenientes que no son de código

- **Conflicto de canal.** Si la academia trae el *supply* y también la demanda,
  ¿por qué pasa por EY? La respuesta tiene que ser el producto (pagos
  internacionales, sala, calendario), no el descubrimiento.
- **Quién es el cliente.** Si el alumno llega por la academia, la relación y la
  recompra son de la academia. EY se queda de infraestructura — que puede ser un
  gran negocio, pero **es otro negocio** que el marketplace.
- **Los legales.** `/terms` describe una relación EY↔tutor↔alumno. Un cuarto
  actor que cobra dinero cambia el contrato, y **los legales los redacta el
  cliente**, no nosotros.
- **La comisión.** Una academia negocia. El día que haya dos academias con dos
  splits distintos, `tutor_tiers` deja de ser una tabla de tres filas y pasa a
  ser un tema.

## Si algún día se hace: por dónde empezar

No por la pantalla. El orden que evita rehacer trabajo:

1. Decidir **quién cobra** (academia agregada, o tutores individuales con un
   *fee* a la academia). Todo lo demás cuelga de esta respuesta.
2. Modelo de reparto de N partes, con su snapshot y sus tests de redondeo.
3. `organizations` + `organization_members` + RLS, con las FK nombradas desde el
   primer día.
4. Beneficiario `BUSINESS` en los rieles de payout.
5. Pantallas.

La 1 es una reunión, no un *sprint*. Y hasta que esté contestada, cualquier
estimación de las otras cuatro es inventada.
