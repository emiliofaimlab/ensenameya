# Academias y clases grupales · Plan único de desarrollo

| | |
| :-- | :-- |
| **Para** | Emilio Faim · Verónica Pérez |
| **De** | FaimLab (José Mora) |
| **Fecha** | 2 de octubre de 2026 |
| **Periodo** | Del 5 de octubre al 31 de diciembre de 2026, los tres meses de soporte. En el escenario medio desborda dos semanas a enero (§17) |
| **Base** | `main` con 216 migraciones (la última es `20260925200000_google_calendar_baja.sql`) |
| **Cruza** | `REQUERIMIENTOS.md` (Academias, Emilio, 2-oct) · «Clases grupales en Enséñame Ya» (documento del cliente, versión final del 2-oct) · reunión de desarrollo del 2-oct |
| **Manda sobre** | **RN-22** (`docs/context/00-glosario-y-modelo-conceptual.md:149`, además de `:47-48`, `:201`; `09-riesgos-y-decisiones-pendientes.md:85,131`; D-02 y RISK-07): las clases grupales **dejan de estar fuera de alcance**. **No cambia ninguna regla de academias (RA-xx)**: lo que toca a RA-24 y al §9 de `REQUERIMIENTOS.md` se propone en la Fase I y espera el visto bueno de Emilio |
| **Origen** | Reunión del 2-oct · `REQUERIMIENTOS.md` · documento de clases grupales · revisión del código de `main` del 2-oct |

> **Cómo leerlo.** El §1 es el plan en doce líneas. El §2 es el mapa de lo que academias y grupales tocan a la vez, que es la razón de este documento. El §3 recoge las reglas de negocio de clases grupales (`RG-xx`), con el mismo peso que las `RA-xx` de academias. El §4 lista lo que falta decidir y quién lo decide. Del §5 al §8 están el orden, la capacidad, la estimación y el cronograma semana a semana. Del §9 al §13 está lo que hay que construir, fase por fase, con sus criterios de aceptación. Los requisitos de academias **no se repiten**: se remite a `REQUERIMIENTOS.md`, que sigue siendo la fuente. El §14 es cómo convive el soporte con el plan, el §15 los riesgos y el §16 lo que **no** se construye. Si algo de aquí choca con `REQUERIMIENTOS.md`, manda `REQUERIMIENTOS.md` y se avisa a Emilio. Si choca con una regla de oro de `CLAUDE.md`, manda la regla de oro y también se avisa.

## 1. El plan en doce líneas

1. Se construyen **dos funcionalidades que tocan el mismo corazón**: clases grupales y academias. Las dos reescriben `create_booking_line`, `cancel_booking`, `expire_stale_bookings`, `proponer_reagenda`, `build_payout_for_tutor` y las políticas de `products`, `bookings`, `sessions` y `messages` (§2).
2. Por eso se hace **una sola base común de datos y dinero** (Fase C), que incluye la Fase 1 de academias entera y el esquema de grupales. Cada función compartida **se reescribe una sola vez**.
3. **Orden:** Fase 0 (cierre) → Fase C (base común) → grupales (G1 a G4) → academias (A2 a A5, con la numeración de Emilio) → Fase I (integración).
4. **Grupales va primero** porque lo pidió Emilio («sin clases grupales no tiene sentido activar las academias»), porque es más corto y porque sirve a todos los tutores, no solo a las academias.
5. **Grupales llega a producción para tutores piloto hacia el 17 de noviembre.** Se abre a todos los tutores habilitados después de dos semanas de piloto.
6. **Academias puede publicar y cobrar hacia el 28 de diciembre.** La primera academia real entra en enero, después del QA integral. No se lanza nada con clientes en la semana de Navidad.
7. **Capacidad:** 60 días hábiles en el periodo. Los viernes son de soporte, así que quedan **47 días de desarrollo** (§6).
8. **Trabajo estimado: 48 a 62 días, con 55 como punto medio** (§7). En el mejor caso cabe todo antes del 31 de diciembre. En el medio, las estadísticas de academias, el QA integral y la integración pasan a la primera quincena de enero.
9. **Una clase grupal es una entidad nueva (`group_classes`), y cada cupo es una reserva y un pago normales.** Así se reutiliza todo el dinero: el cargo del 5 %, el nivel del tutor, los reembolsos, la reseña y el payout.
10. **El cliente decide dos cosas antes del 16 de octubre:** el cupo mínimo y los paquetes (D-1 y D-2). **Nada de la Fase C depende de ellas.**
11. **De los paquetes se construye la opción A** (ciclo con fechas fijas pagado por adelantado; el tutor cobra al terminar el ciclo). La opción B, la mensualidad recurrente, **no cabe en estos tres meses**: hoy no existe ningún cobro recurrente (§16).
12. Cada fase **se despliega y se comprueba sola** contra dev antes de empezar la siguiente, como pide Emilio para su Fase 1.

## 2. Qué cruza: mapa de choques entre academias y grupales

Todas estas funciones tienen varios cientos de líneas y el repo las reescribe enteras copiando la versión viva. **El riesgo principal es que dos ramas reescriban la misma función y la que llegue después revierta a la otra sin avisar.** Ya pasó una vez (comentario en `20260912110000:2824-2828`). La columna de la derecha dice cómo se evita.

| Objeto | Versión viva | Academias (`REQUERIMIENTOS.md` §3) | Grupales (este plan §10) | Cómo se hace una sola vez |
| :-- | :-- | :-- | :-- | :-- |
| `create_booking_line` | `20260910120000:97` | Comprueba academia activa, lista y comisión. Congela `academy_id`, el % y el país de cobro | Cupo con bloqueo de fila, fechas fijas de la clase, sesiones con `group_class_id` | **Una sola reescritura en la Fase C**, con las dos ramas dentro. Mismo texto de error de carrera (lo lee `esCarreraDeHorario`) |
| `products` y su política de lectura | `20260706120000` + añadidos | `academy_id`, `visibility`, `assignment_mode` | `pricing_model = 'group'`, `capacity`, `min_seats` | Una migración de esquema. Un solo formulario (`product-form.tsx`) con todos los campos, ocultos según el caso |
| `bookings` | `20260709140000` | `academy_id`, `needs_reassignment`, `mandatory` | Nada nuevo: la reserva apunta al producto grupal | Una migración |
| `sessions` y el candado de solape | `20260831180000:110-126` | Nada | `group_class_id`. El candado excluye las sesiones grupales y hay un candado nuevo entre tablas | Una migración, con prueba de carrera |
| `cancel_booking` | `20260912110000:3022` | Rechaza al alumno en clases obligatorias | Cancelar el propio cupo funciona tal cual. Cancelar la clase o una fecha va por RPC nuevas | Una reescritura (academias). Grupales solo añade funciones nuevas |
| `expire_stale_bookings` | `20260912110000:2830` | No caduca las reservas `mandatory` | El cupo se libera solo al caducar el hold | Una reescritura (academias). Grupales lo verifica |
| `proponer_reagenda` / `responder_reagenda` | `20260925120000:96` | Rechaza al alumno en clases obligatorias | Rechaza las sesiones grupales. Reagendar la clase va por RPC nueva | Una reescritura con las dos condiciones |
| `build_payout_for_tutor` / `tutor_balance` | `20260912100000:482` / `:1289` | + `academy_id is null`, y una función gemela para academias | Nada: cada cupo es un pago | Una reescritura (academias). Grupales lo verifica con casos de prueba |
| `aplicar_credito` / `comprar_regalo` | `20260916150000:33` / `20260912110000:2138` | Rechazan las ofertas de academia | Regalo de cupo: solo con cupos libres y clase futura | Una reescritura con las dos condiciones |
| Chat (`conversations`, `messages` y 6 RPC) | `20260817210000`, `20260828150000` | El administrador lee sin escribir y aparece un aviso fijo (RA-19) | Hilo grupal por clase | **Una sola pasada por el modelo de chat** en la Fase C (esquema) y en G3 (pantallas). El visor de academia se monta sobre el modelo ya ampliado |
| RLS de `bookings`, `sessions` y `messages` | varias | El administrador de academia vía RPC `academia_*` | Los inscritos de una clase se leen entre sí, solo nombre y foto | Revisar las dos a la vez en la Fase C |
| 35 consultas a `products` en 18 ficheros | `src/` | Filtrar por `visibility` | Pintar «Grupal», los cupos y la fecha fija | Una sola pasada por las 35 consultas en G2, dejando preparado el filtro de `visibility` para A4 |
| Correos | último código NTF-39 | NTF-40 a NTF-50 | NTF-51 a NTF-56 | Rangos reservados de antemano, sin choques |

⚠️ **Regla de trabajo para todo el plan:** una sola rama de integración, migraciones en orden estricto y, antes de reescribir una función, **copiar la versión viva más reciente**, nunca la de una rama. En cada PR que toque una función compartida se anota en la cabecera de la migración qué versión reemplaza.

## 3. Reglas de negocio de clases grupales

Salen del documento del cliente en su versión final del 2-oct. Lo marcado como **SUPUESTO** es una recomendación tomada por defecto que Emilio puede cambiar (§4).

| ID | Regla |
| :-- | :-- |
| **RG‑01** | Una **clase grupal** es un producto con `pricing_model = 'group'`. Tiene **una o varias fechas fijas** que publica el tutor. Con varias fechas es un **ciclo** (RG-16). Las clases 1:1 y los paquetes 1:1 no cambian |
| **RG‑02** | El precio es **fijo por cupo**, no un precio por grupo que se reparta. Ejemplo: USD 25 por cupo con un mínimo de 4 alumnos son USD 100 para el tutor antes de comisión. Cada alumno extra suma, y nadie paga más si otro se da de baja |
| **RG‑03** | **Cupo máximo:** lo fija el tutor, entre 2 y **10** (`check`). *(SUPUESTO S‑G‑01: tope de plataforma de 10)* |
| **RG‑04** | **Cupo mínimo:** opcional, lo fija el tutor. Sin mínimo, la clase se da aunque haya un solo inscrito. Con mínimo, si no se alcanza **24 h antes** de la primera fecha, la clase se cancela sola con reembolso del 100 % a todos. *(Decisión del cliente D‑1; las 24 h son el SUPUESTO S‑G‑02)* |
| **RG‑05** | Al publicar, las fechas **salen de la disponibilidad 1:1** del tutor. No se puede publicar encima de una sesión 1:1 ya vendida, y nadie puede reservar 1:1 encima de una clase grupal publicada, aunque todavía no tenga inscritos |
| **RG‑06** | **Cada cupo es una reserva y un pago propios**, con las mismas reglas que una clase 1:1: pasarela según el país del alumno, cargo del 5 % sobre su cupo, porcentaje del nivel del tutor congelado al reservar y créditos aplicables. Una misma clase puede cobrarse por medios distintos |
| **RG‑07** | Las clases grupales **no pasan por la aceptación del tutor** (RN-38): el tutor ya aceptó al publicar. `auto_accept_bookings = true` es obligatorio en productos grupales (`check`) |
| **RG‑08** | **Apartar el cupo:** mientras el alumno paga, su reserva `pending_payment` ocupa un cupo durante 7 minutos (RN-27), igual que hoy un horario 1:1. Si caduca, el cupo se libera solo |
| **RG‑09** | **Baja de un alumno:** se aplica RN-37 solo a su cupo (100 % con 24 h o más de antelación, 50 % con menos). La clase sigue para los demás y nadie paga diferencia |
| **RG‑10** | **El tutor cancela la clase:** reembolso del 100 % a todos los inscritos (RN-37), con aviso a cada uno |
| **RG‑11** | **Reagendar:** solo el tutor, con 24 h de antelación, y se avisa a todos. Al alumno al que no le sirva la hora nueva se le permite cancelar su cupo con el 100 % hasta que empiece la clase. Los alumnos no pueden proponer cambios de hora en una clase grupal. *(SUPUESTO S‑G‑04)* |
| **RG‑12** | **Sala de video:** una sala por fecha de clase. Entran el tutor, como anfitrión que puede silenciar o sacar a alguien, y los inscritos con pago confirmado. Se graba siempre (RN-42), cada alumno acepta el aviso antes de entrar y la grabación la ven todos los inscritos durante 30 días |
| **RG‑13** | **Chat:** un chat grupal por clase (o por ciclo) con el tutor y los inscritos con pago confirmado. El chat privado tutor–alumno de las clases 1:1 no cambia. Quien se da de baja sale del chat. Los mensajes se borran 30 días después de la última fecha. *(SUPUESTO S‑G‑07: los 30 días de RN-41 se cuentan desde la última fecha)* |
| **RG‑14** | **Reseña:** cada alumno deja la suya cuando su reserva está `completed` (RN-25). El promedio del tutor las suma igual que las 1:1 |
| **RG‑15** | **Pago al tutor:** la suma de los cupos que no se cancelaron, cuando cada reserva queda `completed`, con la retención de RN-14 (7 días) y el lote semanal o el retiro de RN-40, exactamente como hoy. *(SUPUESTO S‑G‑06: «se genera cuando la clase se da por terminada», como dice el documento del cliente, se interpreta como el flujo actual, no como un pago inmediato)* |
| **RG‑16** | **Ciclo (opción A de paquetes):** N fechas fijas que el alumno compra enteras en un solo pago. El tutor cobra al terminar el ciclo, como los paquetes de hoy. Si el alumno falta a una fecha, la pierde sin reembolso (DP-08). El alumno solo puede darse de baja antes de la primera fecha, con RN-37. Si el tutor cancela una fecha, se reembolsa esa fecha (el pago dividido entre N) a cada inscrito. *(Decisión del cliente D‑2)* |
| **RG‑17** | **Créditos y regalos:** sirven para pagar un cupo. Un cupo se puede regalar solo mientras la clase tenga cupos libres y falten más de 24 h para la primera fecha. Si al canjearlo ya no hay cupo, el regalo vuelve como saldo a quien lo recibió. *(SUPUESTO S‑G‑05)* |
| **RG‑18** | **Habilitación:** un interruptor en el admin activa las clases grupales tutor por tutor (`tutor_profiles.group_classes_enabled`, por defecto apagado) |
| **RG‑19** | **Privacidad:** los inscritos ven el nombre y la imagen de los demás en la sala y en el chat. Se avisa antes de inscribirse. Los textos de Términos y Privacidad los redacta el cliente; nosotros marcamos qué párrafos cambian |
| **RG‑20** | **Lista de espera:** no existe en esta versión. Una clase llena desactiva el botón «Inscribirme» |
| **RG‑21** | **Clases grupales de academia:** no existen hasta la Fase I. Hasta entonces, RA-24 y el §9 de `REQUERIMIENTOS.md` siguen vigentes tal cual: las academias trabajan solo 1 a 1 |

## 4. Decisiones abiertas y supuestos

| ID | Qué hay que decidir | Quién | Fecha límite | Si no llega a tiempo |
| :-- | :-- | :-- | :-- | :-- |
| **D‑1** | Cupo mínimo: ¿el tutor puede poner un mínimo y la clase se cancela sola si no se alcanza (propuesta), o la clase se da siempre? | Cliente | **16-oct** | Se construye la propuesta. Apagarla después es retirar un campo del formulario |
| **D‑2** | Paquetes: ¿opción A (ciclo pagado por adelantado), B (mensualidad recurrente) o solo clases sueltas? | Cliente | **16-oct** | Se construye la A. La B queda fuera de este plan en cualquier caso (§16) |
| **S‑G‑01** | Tope de 10 alumnos por clase | Emilio | 9-oct | Se queda en 10 |
| **S‑G‑02** | El mínimo se comprueba 24 h antes de la primera fecha | Emilio | 9-oct | Se queda en 24 h, que coincide con el corte de RN-37 |
| **S‑G‑03** | Las grupales no pasan por aceptación del tutor (RG-07) | Emilio | 9-oct | Se queda así |
| **S‑G‑04** | Reagendar solo lo hace el tutor, y el alumno puede cancelar con el 100 % (RG-11) | Emilio | 9-oct | Se queda así |
| **S‑G‑05** | El regalo de cupo vuelve como saldo si la clase se llena (RG-17) | Emilio | 9-oct | Se queda así |
| **S‑G‑06** | El pago al tutor sigue RN-14 sin cambios (RG-15) | Emilio | 9-oct | Se queda así |
| **S‑G‑07** | La retención del chat grupal se cuenta desde la última fecha (RG-13) | Emilio | 9-oct | Se queda así |
| **S‑G‑08** | Las grupales se pueden meter en el carrito como una línea más | Emilio | 9-oct | Se queda así |
| **S‑P‑01** | Vercel: seguir en Pro (unos USD 20 al mes) | Cliente, vía Emilio | 9-oct | Se sigue en Pro |
| **S‑P‑02** | Daily: confirmar que el plan contratado cubre salas de hasta 11 personas y la grabación de esas salas (el costo sube por minuto y participante) | Emilio | 9-nov | G3 se construye igual, pero el piloto no arranca sin confirmarlo |

## 5. Orden y por qué

| Opción | Cómo sería | A favor | En contra |
| :-- | :-- | :-- | :-- |
| A · Grupales y después academias, cada una con su propia base | Dos proyectos seguidos | Simple de explicar | Reescribe dos veces las mismas funciones de dinero, con riesgo de que una revierta a la otra |
| B · Academias primero | Seguir `REQUERIMIENTOS.md` tal cual y estudiar grupales después | La especificación ya está lista | Contradice lo que pidió Emilio y deja grupales para 2027 |
| **C · Base común, grupales, academias e integración** | **Este plan** | Toca el dinero **una vez**. Grupales sale antes. La base de academias queda hecha desde octubre. La integración llega al final, cuando las dos piezas ya existen | La Fase C es más larga que cualquiera de las dos bases por separado (6 a 8 días frente a 4 o 5) |

**Se elige la C.** Además, la Fase C no depende de las decisiones del cliente (D-1 y D-2 solo afectan a una función de cron y a la interfaz), así que se puede empezar el lunes 5 de octubre sin esperar a nadie.

## 6. Capacidad

Días hábiles entre el lunes 5 de octubre y el jueves 31 de diciembre de 2026. Feriados que se descuentan: 12-oct, 24-dic, 25-dic y 31-dic. El 26-nov (Thanksgiving en EE. UU.) se trabaja, pero el cliente probablemente no responde, así que esa semana no lleva hitos que dependan de él.

| Mes | Días hábiles | Soporte | **Desarrollo** |
| :-- | --: | --: | --: |
| Octubre (5–30) | 19 | 4 viernes | **15** |
| Noviembre (2–30) | 21 | 4 viernes | **17** |
| Diciembre (1–31) | 20 | 5 (viernes 4, 11 y 18; miércoles 23 y 30) | **15** |
| **Total** | **60** | **13** | **47** |

- **Soporte:** un día por semana. Es el primer amortiguador: si una semana no hay soporte, ese viernes se dedica al plan (§14).
- **Ritmo de referencia** (`PLAN-DESARROLLO.md`): con agentes, una funcionalidad completa sale en un día y llegan correcciones de uno a cinco días después. Ejemplos: el carrito multilínea en 1 día más correcciones, reagendar en 1 día más una corrección, Google Calendar en el mismo día y el panel del tutor v2 en unos 2. Las estimaciones de este plan **incluyen** esas correcciones y la verificación contra dev, como hace Emilio en su §10.

## 7. Estimación

Días hábiles de José a tiempo completo, con la verificación de cada fase incluida.

| Fase | Contenido | Días | Medio |
| :-- | :-- | :-- | --: |
| 0 | Cierre y preparación | 2 | 2 |
| C | Base común: Fase 1 de academias entera + esquema y funciones de grupales | 6 – 8 | 7 |
| G1 | Grupales: el tutor publica y gestiona | 3 – 4 | 3,5 |
| G2 | Grupales: el alumno descubre, se inscribe y paga | 3 – 4 | 3,5 |
| G3 | Grupales: sala, chat, grabación, calendario y avisos | 4 – 5 | 4,5 |
| G4 | Grupales: admin, legales, correos, QA y piloto | 3 – 4 | 3,5 |
| A2 | Academias: sección del admin de EY (Fase 2 de Emilio) | 3 – 4 | 3,5 |
| A3 | Academias: portal de la academia (Fase 3) | 7 – 9 | 8 |
| A3b | Academias: agenda asignada (Fase 3b) | 3 – 4 | 3,5 |
| A4 | Academias: lo público y el alumno (Fase 4) | 4 – 5 | 4,5 |
| A5 | Academias: estadísticas (Fase 5) | 2 – 3 | 2,5 |
| A‑C | Academias: 11 correos nuevos (NTF-40 a NTF-50) | 2 | 2 |
| A‑QA | Academias: QA integral con cuentas sembradas y ajustes | 3 – 4 | 3,5 |
| I | Integración: grupales dentro de academias | 3 – 4 | 3,5 |
| | **Total** | **48 – 62** | **55** |

**Cómo se reparte, para poner precio** (la Fase 0 se divide a medias):

| Bloque | Días | Semanas a tiempo completo |
| :-- | :-- | :-- |
| Clases grupales (mitad de 0 + parte grupal de C + G1 a G4) | 18 – 23 | 3,5 – 4,5 |
| Academias (mitad de 0 + Fase 1 dentro de C + A2 a A‑QA) | 27 – 35 | 5,5 – 7 (cuadra con los 28 a 36 de `REQUERIMIENTOS.md`) |
| Integración | 3 – 4 | 1 |

La parte grupal sale algo por encima de las «tres semanas» que se dijeron en la reunión. La revisión del código encontró tres cosas que no estaban a la vista: el candado de solape impide hoy varias sesiones del tutor a la misma hora, el chat está atado al par tutor–alumno en seis funciones y la sala está maquetada para dos personas.

## 8. Cronograma semana a semana

Escenario medio (55 días). De lunes a jueves es desarrollo y el viernes, soporte.

| Sem. | Fechas | Desarrollo | Hito o entregable | Del cliente |
| :-- | :-- | :-- | :-- | :-- |
| 1 | 5 – 9 oct | Fase 0 (lun–mar). Fase C: esquema y migraciones (mié–jue) | **H0** (6-oct): Fase 0 cerrada | Emilio confirma los supuestos S‑G (9-oct). Confirmar Vercel Pro |
| 2 | 13 – 16 oct (12 feriado) | Fase C: `create_booking_line` única, candado entre tablas, cupos, holds | — | **D‑1 y D‑2 (16-oct)** |
| 3 | 19 – 23 oct | Fase C: payouts, cancelaciones, cron del mínimo, chat (esquema). Despliegue y verificación (lun–mar). G1 (mié–jue) | **H1** (20-oct): base común en producción, sin cambios visibles | — |
| 4 | 26 – 30 oct | G1 (lun–mar). G2 (mié–jue) | — | Enviamos al cliente los párrafos legales que cambian (30-oct) |
| 5 | 2 – 6 nov | G2 (lun). G3 (mar–jue) | **H2** (2-nov): demo interna en dev, el tutor publica y el alumno paga | — |
| 6 | 9 – 13 nov | G3 (lun–mar). G4 (mié–jue) | — | Lista de 3 a 5 tutores piloto (9-nov). Confirmar el plan de Daily (9-nov). Textos legales de vuelta (12-nov) |
| 7 | 16 – 20 nov | G4 y despliegue (lun). A2 (mar–jue) | **H3** (17-nov): **grupales en producción para los tutores piloto** | — |
| 8 | 23 – 27 nov | A2 (lun). A3 (mar–jue) | — | Semana de Thanksgiving, sin hitos del cliente |
| 9 | 30 nov – 4 dic | A3 | **H4** (1-dic): grupales abiertas a todos los tutores habilitados | Datos de la primera academia: acuerdo, comisión y correo del administrador (7-dic) |
| 10 | 7 – 11 dic | A3 (lun). A3b (mar–jue) | **H5** (10-dic): demo de academias (admin, portal y agenda asignada) | — |
| 11 | 14 – 18 dic | A4 | — | Políticas de la primera academia (enlace) |
| 12 | 21 – 23 dic | A4 (lun). Correos de academias (mar). Soporte (mié) | — | — |
| 13 | 28 – 30 dic | Correos de academias (lun). A5 (mar). Soporte (mié) | **H6** (28-dic): **academias puede publicar y cobrar** (en producción, sin academias reales) | — |
| 14 | 4 – 7 ene | A5 y QA integral de academias | — | — |
| 15 | 11 – 14 ene | QA integral y Fase I | **H7** (14-ene): estadísticas, QA e integración cerrados | — |
| 16 | 18 ene | — | **H8**: primera academia real | Alta de la academia |

**Escenarios:**

| Escenario | Días | Termina | Qué queda dentro de diciembre |
| :-- | :-- | :-- | :-- |
| Mejor | 48 | 30-dic | Todo |
| **Medio** | **55** | **14-ene** | Grupales completo; academias hasta publicar y cobrar |
| Peor | 62 | 28-ene | Grupales completo; academias hasta A4 |

**Palancas si hace falta que todo quepa en diciembre:** pasar el soporte a medio día por semana (gana unos 6 días); dejar la Fase I para el primer trimestre (gana 3 o 4); construir la agenda asignada (A3b) después del primer lanzamiento de academias, si la primera academia no es un colegio (gana 3 o 4).

## 9. Fase 0 · Cierre y preparación (2 días)

- **Reglas del proyecto:** actualizar RN-22 en `docs/context/00-glosario-y-modelo-conceptual.md` (`:47-48`, `:149`, `:201`) y en `09-riesgos-y-decisiones-pendientes.md` (`:85`, `:131`, D-02, RISK-07). Actualizar `CLAUDE.md`, que todavía dice 178 migraciones (son 216), y añadir las reglas RG-xx con un enlace a este documento.
- **`docs/B2B-ACADEMIAS.md`** y la cabecera de `20260915180000_las_academias_agrupan_tutores.sql`: anotar que `REQUERIMIENTOS.md` las sustituye (lo dice su propia cabecera).
- **Congelar el diseño de la Fase C** (§10) y hacer la lista de cada función que se reescribe, con la versión viva de la que se parte.
- **Regla 10:** inventario de embeds `profiles ↔ academies` (catálogo y admin) y de embeds de `conversations`, que ya tiene dos FK a `profiles`, antes de crear `academy_members` o tocar el chat.
- **Cuentas sembradas para dev**, como en el Doc 34:
    - un tutor independiente con grupales habilitadas;
    - tres alumnos de países con pasarelas distintas;
    - una academia con administrador, dos tutores y cinco alumnos en lista;
    - un alumno que no está en la lista.
- **Confirmar Vercel Pro** y **revisar el plan de Daily** (S-P-01 y S-P-02).

**Criterios de aceptación:** las reglas actualizadas están en `main`, la lista de funciones a reescribir está escrita en la cabecera de la primera migración de la Fase C y las cuentas sembradas existen en dev.

## 10. Fase C · Base común: datos y dinero (6 a 8 días)

Es la única fase que toca dinero. **Se despliega y se comprueba sola** antes de empezar G1. Incluye **la Fase 1 de `REQUERIMIENTOS.md` completa (§3.1, §3.2 y §3.3)**, sin cambios, más lo de esta sección. Donde una función aparece en las dos, lleva las dos ramas dentro de la misma reescritura.

### 10.1 Esquema de grupales

| Objeto | Cambio |
| :-- | :-- |
| `pricing_model` (enum) | + `'group'`. `per_session`, `per_hour` y `per_package` siguen igual |
| `products` | + `capacity smallint` (nulo salvo en grupales; `check (capacity between 2 and 10)`) · + `min_seats smallint` (nulo = sin mínimo; `check (min_seats >= 1 and min_seats <= capacity)`) · `check`: `pricing_model = 'group'` exige `capacity` no nulo y `auto_accept_bookings = true` (RG-07) · en grupales, `package_num_sessions` = número de fechas |
| `group_classes` | **Nueva.** `id`, `product_id` (FK nombrada), `tutor_id`, `sequence_no`, `start_at`, `end_at` (mismo `check` de 30 min que `sessions`), `status` (`scheduled` / `cancelled` / `completed`), `daily_room_name`, `rescheduled_at`, `cancelled_at`, `cancel_reason`, `recordings_purged_at`. Exclusión GiST por tutor y rango (sin solape entre clases grupales del mismo tutor), con el mismo patrón que `sessions_sin_solape_por_tutor` |
| `sessions` | + `group_class_id uuid` (FK nombrada; nulo = 1:1). **Se recrea el candado** `sessions_sin_solape_por_tutor` con `and group_class_id is null` en el predicado: las N sesiones de un mismo cupo-fecha comparten tutor y hora a propósito |
| Candado entre tablas | **Nuevo.** Trigger en `sessions` (solo 1:1) y en `group_classes` que toma `pg_advisory_xact_lock(hashtext(tutor_id::text))` y rechaza el solape con la otra tabla. Una restricción de exclusión no puede cruzar dos tablas |
| `tutor_profiles` | + `group_classes_enabled boolean not null default false` (RG-18) |
| `conversations` | + `kind text not null default 'pair' check (kind in ('pair','group'))` · + `group_product_id uuid` (FK nombrada a `products`) · `student_id` admite nulo **solo** si `kind = 'group'` · `conversations_pair_unique` pasa a ser un índice único parcial `where kind = 'pair'` · + índice único `(group_product_id) where kind = 'group'`. **Los miembros no se guardan en una tabla puente:** salen de las reservas vivas del producto. Así no hay `PGRST201` (regla 10) |
| `messages` | Sin cambios de columnas. Para los hilos grupales, `expires_at` = última fecha + 30 días (RG-13) |

Lo de academias (`academies`, `academy_members`, `availability_requests` y las columnas nuevas de `products`, `bookings` y `payouts`) va tal cual en `REQUERIMIENTOS.md` §3.1, **en la misma migración de esquema**.

Las reglas de oro aplican tal cual: RLS que niega todo por defecto en `group_classes` (regla 1), `grant` explícitos también a `service_role` (regla 9), `comment on` con el porqué, FK nombradas en los embeds (regla 10) y `npm run db:types` al terminar (regla 6).

### 10.2 Funciones

| Función | Cambio de grupales | Cambio de academias (`REQUERIMIENTOS.md` §3.2) |
| :-- | :-- | :-- |
| `create_booking_line` | Si el producto es `group`: bloquea la fila del producto (`for update`), cuenta los cupos vivos (reservas en `pending_payment`, `pending_acceptance`, `confirmed` o `in_progress`) y, si no queda ninguno, rechaza con «Esta clase ya no tiene cupos». Las fechas salen de `group_classes`, no de `get_available_slots`. Crea una sesión por fecha con `group_class_id`. Cierra la inscripción al empezar la primera fecha. El resto (porcentaje del nivel, `payer_country`, `payee_country`, proveedor, 5 %) no cambia | Academia activa, lista y comisión; congela `academy_id`, el porcentaje y `payout_country` |
| `get_available_slots` | Resta también las `group_classes` en estado `scheduled` del tutor (RG-05) | — |
| `publicar_clase_grupal(p_product, p_fechas timestamptz[])` | **Nueva.** Solo el tutor dueño y con `group_classes_enabled`. Crea las `group_classes` (el candado entre tablas protege el solape). Pasa el producto a `active` | — |
| `cancelar_clase_grupal(p_product, p_motivo)` | **Nueva.** Solo el tutor o el admin. Recorre las reservas vivas del producto y aplica `cancel_booking` como parte tutor (100 %). Marca las `group_classes` como `cancelled` | — |
| `cancelar_fecha_grupal(p_group_class, p_motivo)` | **Nueva**, para ciclos (RG-16). Cancela esa fecha y reembolsa a cada inscrito `gross_amount / num_sessions` con `reembolsar_con_credito`. ⚠️ Hay que verificar que acepta importes parciales en Stripe, dLocal y PayPal | — |
| `reagendar_clase_grupal(p_group_class, p_nuevo_inicio)` | **Nueva** (RG-11). Solo el tutor, con 24 h o más. Mueve la `group_class` y todas sus sesiones, marca `rescheduled_at`, vuelve a fijar las claves de recordatorio (como hace `responder_reagenda`) y avisa (NTF-54) | — |
| `cancel_booking` | Si quien cancela es el alumno y la fecha fue reagendada, el 100 % aplica aunque falten menos de 24 h (RG-11). En ciclos con la primera fecha ya pasada, se rechaza (RG-16; hoy ya rechaza las reservas `in_progress`) | Rechaza al alumno en `mandatory` |
| `expire_stale_bookings` | Ninguno: al caducar el hold se libera el cupo, porque el conteo se hace por estado. Se verifica con un caso de prueba | No caduca las `mandatory` |
| `cancelar_grupales_sin_minimo()` + cron cada 15 min | **Nueva** (RG-04). Productos con `min_seats` cuya primera fecha empieza en 24 h o menos y que tienen menos cupos confirmados que el mínimo: llama a `cancelar_clase_grupal`. Cada producto va en su propio `begin…exception`, como `expire_stale_bookings`. ⚠️ **Regla 11:** se revisa `cron.job_run_details` en la verificación | — |
| `proponer_reagenda` / `responder_reagenda` | Rechaza las sesiones con `group_class_id`: «En una clase grupal la hora la cambia el tutor» | Rechaza al alumno en `mandatory` |
| `join_session` → `join_group_class(p_group_class)` | **Nueva.** Autoriza al tutor o a un alumno con sesión viva en esa fecha y pago confirmado. El nombre de sala sale de la clase (`'eyg-' \|\| replace(id,'-','')`) y se guarda en `group_classes.daily_room_name`. Marca `in_progress` la sesión de quien entra, igual que hoy | — |
| `close_expired_sessions` | También pasa a `completed` las `group_classes` vencidas. Las sesiones de los ausentes quedan `no_show` y la reserva se completa igual (comportamiento actual; el alumno pagó, DP-08) | — |
| `build_payout_for_tutor` / `tutor_balance` | Ninguno: cada cupo es un pago con su `tutor_net_amount`. Se verifica con casos de prueba | + `academy_id is null` y la función gemela `build_payout_for_academy` |
| `aplicar_credito` / `comprar_regalo` | `comprar_regalo` de un producto `group` exige cupos libres y más de 24 h para la primera fecha. Al canjear sin cupo, el crédito vuelve como saldo (RG-17) | Rechazan las ofertas de academia |
| `notify_booking` (trigger) | En grupales, el tutor recibe NTF-51 en lugar de NTF-07 y el alumno NTF-56 en lugar de NTF-09. Clave por reserva, como hoy | — |
| Recordatorios NTF-11 y NTF-08 | Los de los alumnos siguen siendo por sesión (cada cupo tiene su fila: no hay colisión). El del tutor pasa a ser **uno por `group_class`**, con clave `'NTF-11:group_class:<id>:tutor'`, para no mandarle N recordatorios | — |
| `google_calendar_eventos` / `calendar_feed` | El tutor recibe **un evento por `group_class`** (id del evento = id de la clase), no N. El alumno, uno por su sesión, como hoy | — |
| `send_conversation_message`, `pair_can_chat`, `my_conversations`, `mark_conversation_read`, `unread_conversation_counts`, `purge_expired_messages` | Aceptan `kind = 'group'`. Pertenencia = tutor del producto o alumno con reserva viva y pagada. Un hilo grupal se crea al confirmarse el primer cupo | El administrador de academia lee sin escribir (RA-19), sobre el modelo ya ampliado |
| Política de `group_classes` (select) | La leen el tutor, los inscritos y el admin. La parte pública (fecha y cupos libres) va por una vista `group_classes_public` con solo esas columnas | — |
| Políticas de `sessions` y `bookings` | Sin cambios: cada alumno sigue viendo solo lo suyo. Los nombres de los demás inscritos van por una RPC que devuelve solo el nombre visible y la foto (RG-19) | Vía RPC `academia_*` (sin abrir RLS) |

⚠️ **Regla 12:** las funciones que cambian de argumentos se hacen con `drop` + `create`, y se reponen los `grant execute`. `create_booking_line` la llaman `create_booking` (`20260827150000:468`) y `create_order` (`:524`): se prueban las dos.

⚠️ **Regla 2:** el invariante `gross = platform_fee + tutor_net + service_fee` no lo defiende ningún `check` (lo dice el comentario de `20260916120000`). Se comprueba en todas las filas nuevas.

### 10.3 Criterios de aceptación (Fase C)

Se comprueban contra dev, en transacciones revertidas, como el 16-sep. **Los ocho criterios de `REQUERIMIENTOS.md` §3.3**, más estos:

1. Un producto grupal con `capacity = 3` admite tres reservas. La cuarta se rechaza con «Esta clase ya no tiene cupos». **Dos transacciones simultáneas por el último cupo**: una entra y la otra se rechaza (prueba de carrera, como la del candado del 31-ago).
2. Un hold de la cuarta reserva que caduca a los 7 minutos libera el cupo y la siguiente reserva entra.
3. Publicar una clase grupal encima de una sesión 1:1 vendida se rechaza. Una clase grupal publicada sin inscritos no aparece en `get_available_slots`, y reservar 1:1 encima se rechaza aunque se llame a la función directamente.
4. Un cupo de 2000 de un tutor con nivel del 75 % cobra 2100 (5 % de servicio), congela `tier_split_pct = 75` y el `tutor_net_amount` es 1500.
5. El alumno que cancela con 24 h o más recupera el 100 % de su cupo. Los demás cupos no cambian.
6. `cancelar_clase_grupal` reembolsa el 100 % a todos y marca las clases como canceladas.
7. Un producto con `min_seats = 4` y tres confirmados se cancela solo 24 h antes y reembolsa el 100 %. El job aparece en `cron.job_run_details` con estado correcto.
8. Un ciclo de 4 fechas crea una reserva con 4 sesiones por alumno. Si el tutor cancela una fecha, se reembolsa el 25 % del pago a cada uno.
9. Las reservas grupales completadas y con la retención vencida aparecen en `build_payout_for_tutor`. Las de academia no aparecen ahí y sí en `build_payout_for_academy`.
10. El tutor tiene un solo evento de Google Calendar por fecha grupal; cada alumno tiene el suyo.
11. Un alumno que no está inscrito no lee el hilo grupal ni la lista de inscritos de esa clase.
12. `npm run db:types`, typecheck, lint y las comprobaciones (`check:*`) en verde.

## 11. Clases grupales · fases G1 a G4

### 11.1 G1 · El tutor publica y gestiona (3 a 4 días)

| Pantalla | Requisitos |
| :-- | :-- |
| `/tutor/products/new` y `/[id]/edit` (`product-form.tsx`) | Nuevo tipo «Clase grupal», visible solo con `group_classes_enabled`. Campos: título, descripción, nivel, categorías, precio por cupo, moneda, duración, **fechas** (una, o varias para un ciclo), **cupo máximo** (2 a 10) y **cupo mínimo** (opcional; se oculta si D-1 dice que no). Publicar llama a `publicar_clase_grupal`; un choque de horario devuelve las fechas en conflicto y no crea nada |
| `/tutor/clases-grupales/[id]` | **Nueva.** Fechas, cupos ocupados y libres, lista de inscritos con el estado del pago y acciones: cancelar la clase, cancelar una fecha (ciclos) y reagendar una fecha |
| Materiales | Los que suba el tutor quedan visibles para todos los inscritos. Mismo tope de 50 MB (desde el 21-sep) |
| `/tutor/payouts` («Mis ingresos») | Una línea por alumno que pagó, **agrupadas bajo la clase** |
| `/tutor` (resumen) | Las próximas clases grupales aparecen en la agenda junto a las 1:1, con «N/M inscritos» |

**Criterios de aceptación:** un tutor sin el interruptor no ve el tipo «Clase grupal» y no puede llamar a `publicar_clase_grupal`. Un tutor con el interruptor publica una clase suelta y un ciclo de 4 fechas. Esas horas desaparecen de su disponibilidad 1:1.

### 11.2 G2 · El alumno descubre, se inscribe y paga (3 a 4 días)

| Pieza | Requisitos |
| :-- | :-- |
| `/classes`, `/search`, `/categories/[slug]` | Filtro «Grupal» (`MODELS`, `src/components/catalog/product-filters.tsx:75`). La tarjeta (`product-card.tsx`) lleva la etiqueta «Grupal», la fecha y hora en la zona del alumno (`src/lib/tz.ts`) y «Quedan N cupos» |
| Ficha `/products/[id]` y `/tutores/[id]` | `booking-panel.tsx`: en lugar del selector de horarios, las fechas fijas y el botón «Inscribirme». Clase llena = botón desactivado. Aviso de privacidad (RG-19) antes de continuar |
| Checkout `/reservar/[productId]/checkout` | El hold aparta un cupo (`src/lib/checkout/hold.ts`: `holdsQueSolapan` no aplica a grupales; el mensaje de clase llena se reconoce aparte de `esCarreraDeHorario`). Pasarela, 5 % y créditos como hoy (`/api/pagos/checkout`, `/api/pagos/credito` para precio 0) |
| Carrito (`/carrito`, `src/lib/cart/resolve.ts`) | La clase grupal entra como una línea más (S-G-08) |
| `/reservas` y `/reservas/[id]` | La reserva grupal aparece junto a las 1:1 con «Grupal · N participantes», las fechas y el enlace al chat grupal. «Cancelar mi cupo» con la política de RG-09 o RG-11 |
| Regalar | En una clase grupal, «Regalar» solo aparece si se cumple RG-17 |
| SEO | `sitemap.ts` incluye las clases grupales activas y futuras. `npm run check:seo` en verde |
| **Las 35 consultas a `products`** (18 ficheros) | Se revisan todas para `pricing_model = 'group'` (precio por cupo, sin selector de horarios). **En la misma pasada se deja preparado el punto donde A4 filtrará `visibility`**, para no recorrerlas dos veces |

**Criterios de aceptación:** un alumno de Venezuela y otro de México se inscriben en la misma clase por pasarelas distintas. La clase llena desactiva el botón en el catálogo y en la ficha. Un alumno que cancela con más de 24 h ve el 100 % devuelto y el cupo vuelve a aparecer.

### 11.3 G3 · Sala, chat, grabación, calendario y avisos (4 a 5 días)

| Pieza | Requisitos |
| :-- | :-- |
| Sala (`/room/[sessionId]`, `live-room.tsx`) | Entrada por `join_group_class`. `layoutConfig.grid.maxTilesPerPage` sube de 2 (línea 690) a una cuadrícula para 11. El tutor entra con `is_owner` y puede silenciar o sacar a alguien. `ensureRoom` (`src/lib/daily.ts:101`) fija `max_participants = capacity + 1` |
| Grabación (`/api/recordings/[sessionId]`) | Si la sesión es grupal, lee `daily_room_name` de la `group_class`. La purga (`/api/cron/recordings-purge`) marca `group_classes.recordings_purged_at`. Aviso de grabación (RN-42) para cada alumno, como hoy (`session_recording_consents`) |
| Chat (`/chat/[threadId]`, `components/chat/*`) | Hilo grupal con el nombre de la clase, la lista de participantes y los mensajes de todos. Aviso fijo: «Chat del grupo · los inscritos ven tus mensajes». Quien se da de baja sale del hilo |
| Calendario | Un evento por fecha para el tutor y uno por sesión para cada alumno, en Google y en ICS. Al reagendar o cancelar se actualizan todos |
| Avisos en la plataforma | Inscripción, clase llena, cancelación, cambio de hora y recordatorios |

**Criterios de aceptación:** cuatro cuentas (el tutor y tres alumnos) entran a la vez y se ven. El tutor silencia a un alumno. La grabación la ven los tres. Un mensaje en el chat le llega a los cuatro. Un alumno dado de baja deja de ver el hilo. El tutor tiene un solo evento en su Google Calendar.

### 11.4 G4 · Admin, legales, correos, QA y piloto (3 a 4 días)

| Pieza | Requisitos |
| :-- | :-- |
| `/admin` · ficha de clase grupal | Inscritos, pagos y reembolsos de cada clase. Acciones: cancelar la clase entera o sacar a un alumno (con reembolso del 100 %) |
| `/admin` · tutores | Interruptor «Clases grupales» por tutor (RG-18) |
| `/admin` · reportes y CSV | Los ingresos se separan entre grupales y 1:1 |
| Legales | Lista de los párrafos de Términos y Privacidad que cambian (enviada el 30-oct). Se publican los textos que devuelva el cliente |
| Correos | NTF-51 a NTF-56 (§12), con plantilla en `src/lib/email-templates.ts` y clave de idempotencia |
| QA | Escenarios del anexo B, con las cuentas sembradas, en dev y después en producción con el primer tutor piloto |
| Piloto | Se activa el interruptor a 3 a 5 tutores (lista del cliente, 9-nov). Dos semanas de observación con Sentry y PostHog, y después se abre a todos los habilitados (H4) |

**Criterios de aceptación:** pasan todos los escenarios del anexo B. El admin cancela una clase con 3 inscritos y los 3 reciben el 100 % y el correo. El CSV distingue grupales de 1:1.

## 12. Correos nuevos de grupales

Con el sistema y las plantillas del Doc 33. Los códigos NTF-40 a NTF-50 quedan reservados para academias (`REQUERIMIENTOS.md` §7), así que grupales empieza en NTF-51.

| Código | A quién | Cuándo | Clave de idempotencia |
| :-- | :-- | :-- | :-- |
| NTF-51 | Tutor | Un alumno se inscribió (sustituye a NTF-07 en grupales) | `NTF-51:booking:<id>` |
| NTF-52 | Tutor | La clase se llenó | `NTF-52:product:<id>` |
| NTF-53 | Alumnos y tutor | La clase se canceló por no llegar al mínimo, con el reembolso | `NTF-53:product:<id>:<user>` |
| NTF-54 | Alumnos | El tutor cambió la hora de una fecha. Puedes cancelar con el 100 % | `NTF-54:group_class:<id>:<rescheduled_at>:<user>` |
| NTF-55 | Alumnos | El tutor canceló la clase o una fecha del ciclo, con el reembolso | `NTF-55:group_class:<id>:<user>` |
| NTF-56 | Alumno | Confirmación de inscripción: fechas, enlace al chat grupal y aviso de grabación (sustituye a NTF-09 en grupales) | `NTF-56:booking:<id>` |

Los recordatorios NTF-11 y NTF-08 se reutilizan: el del alumno, por sesión; el del tutor, uno por fecha de clase (§10.2).

## 13. Academias y la Fase I de integración

### 13.1 Academias · fases A2 a A5

Se construyen **tal cual** dicen las Fases 2 a 5 y el §7 de `REQUERIMIENTOS.md`, con sus pantallas, reglas y criterios de aceptación. Este plan solo añade:

- **Orden:** A2 → A3 → A3b → A4 → correos → A5 → QA integral. Los cuatro primeros correos (NTF-40 a NTF-43, invitaciones) se adelantan a A2 y A3 si hace falta probar las invitaciones de punta a punta.
- **A3, panel del tutor de academia:** lo que oculta incluye el tipo «Clase grupal» (RG-21) hasta la Fase I.
- **A4, las 35 consultas a `products`:** se parte de la pasada hecha en G2, que deja marcado dónde va el filtro de `visibility`.
- **A3, chat:** el visor de solo lectura (RA-19) se monta sobre el modelo de chat ya ampliado en la Fase C. Tiene que funcionar con hilos de par y, desde la Fase I, también con hilos grupales.
- **Riesgo ya señalado por Emilio:** que «Mis cuentas» esté más acoplado a `tutor_profiles` de lo previsto. Puede sumar 1 o 2 días a A3 y está dentro del rango alto.

### 13.2 Fase I · Grupales dentro de academias (3 a 4 días)

**Requiere el visto bueno de Emilio**, porque amplía RA-24 y retira las clases grupales del §9 de `REQUERIMIENTOS.md`.

| Pieza | Requisitos |
| :-- | :-- |
| Ofertas grupales de academia | Una oferta de academia puede tener `pricing_model = 'group'`. Combina los tres ajustes de RA-23: una grupal privada solo la ve la lista, una grupal gratuita no pide tarjeta, y el dinero de una de pago va a la academia porque cada cupo lleva `academy_id` congelado. **No hace falta tocar el motor:** sale de cómo está construida la Fase C |
| Agenda asignada grupal | La academia asigna **varios alumnos de su lista** a una clase grupal (amplía RA-24, que hoy es «siempre 1 a 1»). Cada alumno recibe su reserva `mandatory` y, si es de pago, la paga como en RA-25 |
| Reasignar (RA-15) | Cambiar el tutor de una clase grupal mueve todas sus reservas a la vez, con NTF-47 a cada alumno |
| Estadísticas (A5) | Asistencia por clase grupal y ocupación media de cupos |
| Panel del tutor de academia | Ve sus clases grupales asignadas, sin poder crearlas |

**Criterios de aceptación:** una academia publica una clase grupal privada de pago con 4 alumnos de su lista. El dinero llega a `build_payout_for_academy` y no al tutor. Un alumno fuera de la lista no la ve. Reasignar el tutor avisa a los 4 alumnos y a los dos tutores.

## 14. Cómo convive el soporte con el plan

- **Entrada única:** el portal `support.faimlab.com/ensename-ya` crea la tarea en Jira (proyecto EY). Verónica filtra, prioriza y asigna desde «My open work items». Los clientes no comentan en las tarjetas.
- **Prioridad alta** solo si el sitio, los pagos o una sala están caídos. Eso interrumpe el plan el día que haga falta, y el día se recupera moviendo el cronograma. Se anota en Jira.
- **Todo lo demás** entra los viernes. Una mejora que pase de un día se estima y se decide con Emilio: o se cotiza aparte o se mete en el plan, moviendo una fase.
- **Pendientes de soporte ya conocidos**, que se atienden los viernes:
    - verificación de PayPal (ticket y soporte telefónico; si no avanza, Néstor);
    - verificación de Google Calendar (nuevo video con la pantalla de permiso);
    - **pasar al código la regla del firewall de Vercel** (hoy solo está en el panel; si alguien la borra, se caen sin aviso la verificación de Google y la indexación);
    - revisión semanal de Sentry y PostHog;
    - remitente seguro en el correo de Néstor;
    - textos legales pendientes del cliente (Privacidad, Cookies, sección 39 de los Términos).
- **Informe mensual** para Verónica con lo atendido en soporte y el avance del plan frente a este cronograma.

## 15. Riesgos

| Riesgo | Qué pasaría | Mitigación |
| :-- | :-- | :-- |
| Dos reescrituras de la misma función se pisan | Una feature revierte a la otra sin avisar | Fase C única, una rama, orden fijo y versión de origen anotada en cada migración (§2) |
| Sobreventa de cupos | Más inscritos que cupos | Bloqueo de fila sobre el producto y prueba de carrera en los criterios de la Fase C |
| Candado entre tablas por trigger | Una 1:1 y una grupal a la misma hora | Bloqueo consultivo por tutor en las dos direcciones y prueba de carrera |
| El chat está atado al par en 6 funciones y en los componentes | G3 se alarga | El modelo se cambia en la Fase C; si G3 se va de 5 días, se avisa en esa misma semana |
| Costo de Daily con salas de hasta 11 personas y grabación | Sube la factura mensual | Confirmar el plan antes del piloto (S-P-02) |
| Reembolso parcial de una fecha de ciclo | Una pasarela no admite importes parciales | Verificarlo en la Fase C; si una no lo admite, esa fecha se compensa con saldo |
| «Mis cuentas» acoplado a `tutor_profiles` | A3 se alarga 1 o 2 días | Ya está en el rango alto |
| Decisiones del cliente tarde | La interfaz de G1 se rehace | La Fase C no depende de ellas; se construye con la propuesta y se ajusta |
| Diciembre | Cliente y equipo con menos disponibilidad | Ningún lanzamiento con clientes entre el 21-dic y el 4-ene |
| El soporte se come más de un día por semana | Todo se corre | Se mide cada viernes y se reajusta el cronograma en el informe mensual |
| Pantallas sin verificar a ojo | «El código verde no es código que funcione» (`PLAN-DESARROLLO.md:1492`) | Cada criterio con sesión se comprueba en el navegador con las cuentas sembradas |

## 16. Fuera de alcance

- **Mensualidad recurrente (opción B de paquetes).** Hoy no existe ningún cobro recurrente: la búsqueda de `subscription`, `recurring` y `off_session` en `src/` no encuentra nada de cobros, y `setup_future_usage` se retiró (`checkout/route.ts:241`). Habría que construirlo para cada pasarela (Stripe, dLocal y PayPal) y por país. Estimación aproximada: 8 a 12 días. Se propone para el primer trimestre de 2027 si el cliente la elige.
- **Pagar al tutor por cada fecha dada de un ciclo.** En la opción A cobra al terminar el ciclo, como los paquetes de hoy.
- **Precio por grupo dividido entre los asistentes.** Se descartó en la reunión porque obliga a rehacer el reparto del dinero.
- **Lista de espera** (RG-20).
- **Más de 10 alumnos por clase.**
- **Pizarra compartida** en la sala: Daily no la trae; se cotiza aparte si el cliente la quiere.
- **Chat entre alumnos fuera de una clase.**
- **Que el alumno proponga otra hora** en una clase grupal.
- Todo lo del §9 de `REQUERIMIENTOS.md`, **salvo las clases grupales**, que entran con la Fase I.

## 17. Estimación y fechas clave

| Hito | Fecha (escenario medio) | Qué significa |
| :-- | :-- | :-- |
| H0 | 6-oct | Fase 0 cerrada |
| H1 | 20-oct | Base común en producción y verificada. Sin cambios visibles para el usuario |
| H2 | 2-nov | Demo interna de grupales en dev: el tutor publica y el alumno paga |
| **H3** | **17-nov** | **Clases grupales en producción para los tutores piloto** |
| H4 | 1-dic | Clases grupales abiertas a todos los tutores habilitados |
| H5 | 10-dic | Demo de academias: admin, portal y agenda asignada |
| **H6** | **28-dic** | **Academias puede publicar y cobrar** (en producción, sin academias reales) |
| H7 | 14-ene | Estadísticas, QA integral y Fase I cerradas |
| H8 | 18-ene | Primera academia real |

**Total: 48 a 62 días hábiles, unas 10 a 13 semanas a tiempo completo.** Con un día de soporte por semana, el escenario medio cierra el 14 de enero y el mejor, el 30 de diciembre.

## Anexo A · Calendario del periodo

| Semana | Lun | Mar | Mié | Jue | Vie |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | 5-oct | 6 | 7 | 8 | 9 soporte |
| 2 | 12 **feriado** | 13 | 14 | 15 | 16 soporte |
| 3 | 19 | 20 | 21 | 22 | 23 soporte |
| 4 | 26 | 27 | 28 | 29 | 30 soporte |
| 5 | 2-nov | 3 | 4 | 5 | 6 soporte |
| 6 | 9 | 10 | 11 | 12 | 13 soporte |
| 7 | 16 | 17 | 18 | 19 | 20 soporte |
| 8 | 23 | 24 | 25 | 26 (Thanksgiving EE. UU.) | 27 soporte |
| 9 | 30 | 1-dic | 2 | 3 | 4 soporte |
| 10 | 7 | 8 | 9 | 10 | 11 soporte |
| 11 | 14 | 15 | 16 | 17 | 18 soporte |
| 12 | 21 | 22 | 23 soporte | 24 **feriado** | 25 **feriado** |
| 13 | 28 | 29 | 30 soporte | 31 **feriado** | 1-ene **feriado** |

## Anexo B · Escenarios de prueba de clases grupales

Se ejecutan en G4 con las cuentas sembradas de la Fase 0, primero en dev y después en producción con el primer tutor piloto.

1. El tutor sin interruptor no ve «Clase grupal». El admin lo enciende y el tutor ya lo ve.
2. El tutor publica una clase suelta con 4 cupos, sin mínimo, para dentro de 3 días. Esa hora desaparece de su agenda 1:1.
3. El tutor intenta publicar encima de una sesión 1:1 vendida y recibe la fecha en conflicto.
4. Tres alumnos de países distintos se inscriben por pasarelas distintas. Se cobra el 5 % a cada uno y el tutor recibe NTF-51 tres veces.
5. Un cuarto alumno abre el checkout y no paga. A los 7 minutos el cupo vuelve.
6. Se inscriben un cuarto y un quinto a la vez por el último cupo: uno entra y el otro ve «Esta clase ya no tiene cupos».
7. La clase llena desactiva el botón en el catálogo y en la ficha, y el tutor recibe NTF-52.
8. Un alumno cancela con más de 24 h y recupera el 100 %. Sale del chat grupal y el cupo se libera.
9. El tutor reagenda una fecha. Los alumnos reciben NTF-54, y uno cancela con menos de 24 h y recupera el 100 %.
10. Clase con mínimo de 4 y 3 inscritos: 24 h antes se cancela sola, todos recuperan el 100 % y reciben NTF-53.
11. Ciclo de 4 fechas: el tutor cancela la tercera y cada inscrito recupera el 25 % y recibe NTF-55.
12. Sala: entran el tutor y tres alumnos y se ven. El tutor silencia y saca a uno. La grabación la ven los tres inscritos.
13. Chat grupal: un mensaje del tutor llega a los tres. Un alumno no inscrito no puede abrir el hilo.
14. Google Calendar: el tutor tiene un evento por fecha; cada alumno, el suyo. Al reagendar se mueven todos.
15. Al terminar, cada alumno deja su reseña y el promedio del tutor se recalcula.
16. Con la retención vencida, los cupos aparecen en el payout del tutor por su nivel. Los cupos cancelados no aparecen.
17. Un regalo de cupo se compra con cupos libres. Si la clase se llena antes del canje, el regalo vuelve como saldo.
18. El admin ve la ficha de la clase, saca a un alumno con el 100 % y descarga el CSV con los ingresos grupales separados.
19. Mismo recorrido en móvil (Safari en iOS y Chrome en Android) y con el traductor de Chrome activo.
