# DOC 22 — La lista consolidada de Verónica, verificada contra el código

> **Qué es esto.** Los **34 puntos** del correo de Verónica del 21-ago («Lista pendientes — Enséñame
> Ya»), contrastados **uno a uno contra el código de `dev`** y ordenados por prioridad. No es una
> traducción de la lista a tickets: seis puntos ya están hechos, siete piden deshacer algo que el
> propio cliente decidió hace cuatro días, y dos no significan aquí lo que significan en el correo.
> Eso hay que decirlo **antes** de presupuestar nada.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 22 — Verificación de la lista consolidada del 21-ago |
| **Fecha** | 2026-08-24 |
| **Autor** | Jose Mora (desarrollo) |
| **Fuente** | Correo `Lista pendientes - Enséñame Ya`, Verónica Pérez, 21-ago 19:13 (cc: Emilio) |
| **Base** | `docs/20-PLAN-MINUTA-17AGO.md` · `docs/21-DECISION-CONSULTAS-PREVENTA.md` |
| **Verificación** | Auditoría sobre `dev` @ `e209180`: 7 agentes por módulo + 7 revisores adversariales que atacaron cada veredicto fichero en mano. **Todo estado de este documento sale de leer el código, no la documentación** — que en tres puntos ha vuelto a demostrarse falsa (§22.6) |
| **Convención de este documento** | «Está» = **está en `dev`**, que es lo que el equipo ve y lo que el cliente llama producción. El estado de `main` se trata aparte, en §22.7 |

---

## 22.0 · La conclusión, en seis frases

1. **Un tercio de la lista ya está construido.** Seis puntos están hechos de punta a punta —incluidos
   **los dos que el correo pedía verificar**— y otros cuatro lo están a medias sin que nadie lo haya
   visto. Contestarlos cuesta cero.
2. **Siete puntos deshacen decisiones que el cliente tomó por escrito el 20 de agosto.** El chat de
   la sala, la ventana de 7 días, el hold de 20 minutos, los pasos del checkout… La lista está
   **consolidada de reuniones anteriores** y arrastra peticiones que ya fueron respondidas y
   ejecutadas después.
3. **Dos puntos no existen en este producto.** No hay carrito —nunca lo hubo—, y el «ajuste del
   módulo de videollamadas por dLocal» no es trabajo de vídeo: es el webhook de dLocal, que es otro
   punto de la misma lista.
4. **Lo verdaderamente nuevo y barato cabe en dos días:** el vocabulario («sesión suelta» está en
   **cinco nombres distintos**, no en uno), los enlaces al perfil del tutor, el bloque de tutores
   recientes en el panel y la línea de `/privacy` que hoy contradice al código.
5. **Tres puntos son épicas disfrazadas de ajuste:** la eliminación de cuenta (que hoy **falla por
   integridad referencial**, no por falta de botón), la validación de categorías por área verificada
   (que no tiene contra qué validar) y el carrito multi-producto.
6. **Y hay un dato que conviene decir en la misma frase que todo lo demás:** el correo pide integrar
   Zinli y PayPal «de inmediato» mientras **el correo de la plataforma no envía ni un mensaje**
   —los avisos se acumulan `pending`, no `failed`, así que el síntoma es que no pasa nada— y
   **ningún reembolso ha movido un euro todavía**. Eso pesa más que las dos pasarelas.

---

## 22.1 · El marco: por qué esta lista no es una lista nueva

El correo se presenta como «puntos consolidados de reuniones anteriores y últimas sesiones», y eso
es exactamente lo que es. **Catorce de los treinta y cuatro puntos ya estaban en la minuta del
17-ago** (Doc 20, fichas MN-01…MN-15), que se respondió el 20-ago y se ejecutó el 20 y el 21.

La consecuencia práctica es incómoda pero simple: **el correo del 21-ago describe un producto
anterior a los commits del 20 y el 21 de agosto.** No es un error de Verónica — es que la lista se
redactó consolidando actas viejas mientras el código avanzaba por debajo.

| Lo que pide el correo | Lo que se decidió y ejecutó | Fecha |
| :-- | :-- | :-- |
| «Nombre en la tarjeta» | Hecho, **opcional porque el cliente lo pidió opcional** (P-5) | 20-ago · `94f5d21` |
| «Chat oculto por defecto» en la sala | Hecho **al revés, a petición literal del cliente**: chat acoplado a la derecha y abierto | 21-ago · `215a8a9` |
| «Error de cierre automático a los 7 días» | **No es un error**: es la respuesta P-6 del cliente («7 días antes y 7 después») | 20-ago · `40156e8` |
| «Reducir el bloqueo a 7 minutos» | El hold de 20 min se anunció así **a propósito** y se firmó como D-2 | 21-ago · `ab0705b` |
| «3 pasos: Selección, Revisión y Pago» | Se **quitó** una pantalla del camino por la queja contraria (N-33) | 17-ago · `d8d164b` |
| «Pantalla de fin de onboarding» | Hecha, y con el mismo medallón que pide el correo | 20-ago · `fee79f9` |

> **Recomendación de proceso, antes que ninguna otra:** devolverle a Verónica esta tabla **antes** de
> planificar. Media lista se resuelve enseñando, no programando.

---

## 22.2 · Los 34 puntos, con veredicto

**Leyenda:** 🟢 `HECHO` · 🟡 `PARCIAL` · 🔴 `NO EXISTE` · ⛔ `BLOQUEADO` · ⚪ `NO APLICA`.
Esfuerzo: `XS` <1 h · `S` medio día · `M` 1-2 días · `L` 3-5 días · `XL` semana o más.

### Pasarelas y métodos de pago

| | Punto | Veredicto | Evidencia y matiz | Esf. |
| :-- | :-- | :-- | :-- | :-- |
| **A1** | «Nombre en la tarjeta» | 🟢 **HECHO** | `name_collection: { individual: { enabled: true, optional: true } }` en los **dos** sitios que crean Session (`stripe-provider.ts:279`, `stripe.ts:316`), y `rg 'checkout.sessions.create'` confirma que no hay un tercero. Se ve en **tres** pantallas de pago, no dos. ⚠️ Dos matices que hay que decir: está **opcional porque lo pidió el cliente** (P-5), y **la etiqueta la escribe Stripe** con `locale:'es'` → en pantalla pone «Nombre», no el literal pedido | XS |
| **A2** | dLocal como respaldo | ⛔ **BLOQUEADO** | Sin cuenta y **mal planteado**: dLocal no es el respaldo de Stripe, es **quien está bloqueado por nosotros**. Y «si Stripe falla» no significa lo que parece: un rechazo de tarjeta no es un fallo de Stripe (`stripe-provider.ts:95-105` deja la Session abierta para reintentar), así que reintentar en otro PSP es reintentar un rechazo | XL |
| **A3** | «Ajustar el módulo de videollamadas por dLocal» | ⚪ **NO APLICA** | En el módulo de vídeo, **nada**. La sala está río abajo del webhook, y el webhook es de Stripe. Traducido: con dLocal cobrando hace falta **su webhook llamando a la misma `confirm_payment`** — sin él la reserva se queda en `pending_payment` y **la sala no abre nunca, sin ningún error en el log**. Es trabajo de A2, no de vídeo | N/A |
| **A4** | Zinli y PayPal «de inmediato» + pruebas | 🟡 **PARCIAL** | El puerto `PspProvider` existe (`src/lib/payments/port.ts`) y hay dos adaptadores, pero solo uno es PSP. ⚠️ **Dos llamadas de diez minutos pueden ahorrar el punto entero:** Zinli emite **tarjeta Visa prepago** — sus usuarios ya pueden pagar por el rail de Stripe; y **PayPal es un payment method de la propia Stripe** en varios países. Y la otra mitad —«pruebas integrales con Stripe y envíos de correo»— es la que de verdad importa: **el correo hoy no envía** | XL |
| **A5** | Payouts: nivel y % de split | 🟢 **HECHO** | `tutor/payouts/page.tsx:148-157` pinta «Tu nivel» con el tramo y «Te quedas con el X % · comisión Y %», y `tutor/page.tsx:218-232` lo repite. ⚠️ Residuo real de S: el % **no aparece por liquidación** — el reparto congelado vive en `payments.tier_split_pct` y hay que cruzar `payout_items → payments` | N/A |

### Compra, «carrito» y checkout

> ⚠️ **En Enséñame Ya no hay carrito, y nunca lo hubo.** Es mentoría → reserva → checkout de **una**
> reserva. `payments.booking_id` es `unique`. Los tres puntos que hablan de carrito hay que
> traducirlos antes de costearlos.

| | Punto | Veredicto | Evidencia y matiz | Esf. |
| :-- | :-- | :-- | :-- | :-- |
| **B1** | Carrito interactivo + 3 pasos | 🟡 **PARCIAL** | El repaso del producto **ya existe** (el «Resumen del pedido» de `checkout-form.tsx:592-664`), y **para sesión suelta ya son 2 pantallas** desde N-33. Añadir «Revisión» **sube** el número de pantallas: lo contrario de la queja original. ⚠️ Y separar Revisión de Pago obliga a partir la máquina de estados de `checkout-form.tsx` (780 líneas) y a decidir **en cuál de las dos corre `create_booking`** → es tocar el snapshot financiero, no maquetar | L |
| **B2** | Evitar saltos de pantalla | 🟢 **HECHO** | Resuelto **por ancla**, no por prop: `hrefFor` devuelve `/tutors/{id}?…#reservar` (`tutors/[id]/page.tsx:95-102`) y el ancla existe en `:293`; lo mismo en `products/[id]/page.tsx:292`. Los dos ficheros documentan que se puso **para este síntoma**. ⚠️ Añadir `scroll={false}` sería una **regresión**: en móvil el panel queda bajo el pliegue y parecería que la app no responde | N/A |
| **B3** | «Ver carrito» al añadir desde el calendario | ⚪ **NO APLICA** | Cesta multi-producto = tabla cabecera + líneas, levantar el `unique` de `payments.booking_id`, reescribir `create_booking` con snapshot **por línea** (distinto tutor → distinto split), una Session por pedido y rehacer el webhook. 🟢 **Lo que casi seguro quiere el cliente ya existe:** el panel «Tu selección» del selector de paquete (`slot-picker.tsx:345-419`), que ya es un carrito con quitar-elemento y total | XL |
| **B4** | Un solo bloque, tarjeta encima, resumen mayor | 🟡 **PARCIAL** | Hoy son **tres** piezas en dos columnas (`checkout-form.tsx:483`, rejilla `360px + resto`), y «tarjeta encima» ya se cumple **por debajo de 1024px**, no en escritorio. ⚠️ La tarjeta ilustrada **está vacía en toda primera compra** («SIN TARJETA GUARDADA», `:472-475`): agrandarla y subirla empeora la pantalla justo para el grueso de los alumnos. Y las dos columnas **son el Figma** (`:484`) | M |
| **B5** | Hold a 7 minutos | 🔴 **NO EXISTE** | Hoy 20 min. El número que manda **no está en el front**: es el `p_payment_cutoff` de `expire_stale_bookings`, que corre por `pg_cron` cada 5 min. **Tres choques duros** → ver §22.3 | S ⚠️ |

### Onboarding y flujo del tutor

| | Punto | Veredicto | Evidencia y matiz | Esf. |
| :-- | :-- | :-- | :-- | :-- |
| **C1** | Onboarding continuo | 🟡 **PARCIAL** | La fuga visible se cerró con N-03. Lo que queda no es lo que parece: **la mentoría no nace huérfana** (hereda la agenda del tutor), pero **el tutor sale del asistente sin que nadie le haya pedido una sola franja**, y el único sitio donde se le nombra es una fila de «Accesos rápidos» (`tutor/page.tsx:380`). El síntoma llega semanas después, al aprobarle | S |
| **C2** | Disponibilidad como **primer** paso | 🔴 **NO EXISTE** | ⚠️ **Y «primer» es técnicamente incorrecto:** la disponibilidad se interpreta en `profiles.timezone`, que nace en `'UTC'` y **no se persiste hasta el paso 3**. El sitio correcto es el **paso 4**, justo después de la zona horaria. 🟢 La mitad conceptual ya se ejecutó en otro sitio: `20260817200000` implantó «primero la disponibilidad, luego la oferta» a nivel de mentoría | M |
| **C3** | Pantalla de fin de onboarding | 🟢 **HECHO** | `<WizardDone>` (`wizard.tsx:102-138`), medallón `size-[120px]` idéntico en geometría al de `reservas/[id]/confirmacion/page.tsx:82`. `grep size-\[120px\]` devuelve **exactamente dos** resultados: no hay una tercera variante suelta. ⚠️ Matiz: «Tu reserva está confirmada» **no es el titular** de esa pantalla (es «¡Reserva registrada!»); lo reutilizable es el medallón | XS |
| **C4** | Validación de área verificada | 🔴 **NO EXISTE** | **No hay contra qué validar.** Las categorías del tutor son **autodeclaradas** (paso 2 del asistente escribe `tutor_categories` a voluntad) y ya son públicas. La versión barata —comprobar que las categorías de la mentoría están entre las declaradas— **es trabajo tirado**: el ingeniero que quiera dar inglés marca «Idiomas» y pasa. ⚠️ Y la ficha pública **ya pinta «Tutor verificado» sin matices** encima de esa lista autodeclarada, y la FAQ promete «verificación manual de identidad y experiencia» | XL |

### UI y UX

| | Punto | Veredicto | Evidencia y matiz | Esf. |
| :-- | :-- | :-- | :-- | :-- |
| **D1** | Cajas en la 2.ª sección + carrusel | 🟡 **PARCIAL** | 🟢 Las imágenes **ya están en disco** (`public/img/home-live.jpg`, `home-teach.jpg`, del 21-jul): **no está bloqueado por Diana**. Y `feature-split.tsx` ya soporta `tone='soft'`. ⚠️ **No hay carrusel en ninguna parte del repo** —los comentarios lo llaman así pero renderizan una **rejilla** (`sugerencias-card.tsx:59`)— y **«mentores favoritos» no existe**: tabla nueva, y hay que decidir si el favorito es del **tutor** o de la **mentoría** | L |
| **D2** | Agenda: últimas sesiones y tutores primero | 🟡 **PARCIAL** | 🟢 **El orden pedido ya está construido** y justificado por escrito (N-30): «Próximas sesiones» arriba, sugerencias por intereses abajo. Lo único que falta es **el bloque de tutores** recientes, y el dato ya está a mano | S |
| **D3** | Horarios: dropdown en vez de botones | 🔴 **NO EXISTE** | ⚠️ **Choca con un rediseño de hace tres semanas documentado en el propio fichero:** `availability-manager.tsx:58-77` explica que la pantalla se rehízo el 7-ago **porque era difícil de entender** y que el acordeón se eligió a propósito. Sería la tercera iteración en tres semanas. Y un menú **esconde** la acción más usada tras un clic extra: la reducción real es de 14 botones a **7 disparadores**, no a uno | M |
| **D4** | Títulos largos + «sesión individual» | 🟡 **PARCIAL** | ⚠️ **No es un nombre, son cinco.** El mismo `per_session` se llama hoy «Sesión única» (solo Home), **«Sesión suelta» (6 pantallas)**, «por sesión», «Por sesión» y «Sesión suelta» en el selector. Renombrar solo una deja la incoherencia peor. Los títulos: falta recorte en la miga de pan (`products/[id]/page.tsx:134`) y en el `<h1>` del detalle de reserva (`reservas/[id]/page.tsx:128`) | S |
| **D5** | Precio en moneda local | 🔴 **NO EXISTE** | 🟢 La señal de país **ya existe**: `countryFromTimezone(tz)` en `phone-input.tsx:26-38`, ya en uso. Falta la **fuente de tasas**. ⚠️ **Y no es una etiqueta, es una promesa comercial:** el alumno verá un número en el sitio y otro en su extracto. `grep 'USD\|moneda'` sobre los legales devuelve **0** — no hay ni un descargo escrito. Bloqueado además por **C-13** | M |
| **D6** | Enlace al perfil del tutor | 🟡 **PARCIAL** | ⚠️ **Casi lo contrario de lo que dice el correo:** en la ficha de la mentoría el enlace lleva tiempo y es un **botón con borde de marca** (`products/[id]/page.tsx:250`); también enlazan el catálogo, el Home y el chat. **Falta** en `featured-products.tsx` y en las superficies de reserva. Hay que preguntarle a Verónica **dónde** lo echó en falta: las respuestas dan trabajos muy distintos | S |

### Estrategia, marketing y referidos

| | Punto | Veredicto | Evidencia y matiz | Esf. |
| :-- | :-- | :-- | :-- | :-- |
| **E1** | Typeform en el dominio + app a subdominio | 🟡 **PARCIAL** | 🟢 **El Typeform es cero código nuestro:** `ensenameya.com` es una landing de GoDaddy que este repo no sirve. 🟢 El subdominio es configuración (`NEXT_PUBLIC_SITE_URL`) más reconfigurar OAuth, Supabase, el webhook de Stripe y los correos. ⚠️ **La trampa que muerde:** la cookie `ey-ref` se escribe **sin `domain`** (`middleware.ts:76-83`) → host-only. Al partir el dominio, **la atribución de referidos se pierde en silencio**. Es una línea, pero va **antes** de mover el DNS. ⛔ Y sigue chocando con DL-07 de dLocal | S |
| **E2** | Campaña bilateral en RF según clases impartidas | 🟡 **PARCIAL** | 🟢 La RPC `tutor_teaching_record` existe (`20260820160000`), y `ReferralCard` **ya llega al tutor** vía `/account`. Lo que no existe es la **diferenciación** de URL y copy por rol → XS. ⚠️ **Y el dato de segmentación está minado:** `no_show` significa «nadie abrió la sala en la ventana», **no** «el tutor faltó» — y desde MN-05 se puede tener gente dentro y acabar en `no_show`. Repartir premios con ese número premia y castiga mal | XL |
| **E3** | Landing de referidos, descuentos a cargo de la plataforma | 🔴 **NO EXISTE** | No hay `promotions`, ni `discount_amount`, ni nada. 🟢 Ya está decidido lo caro (P-9, 20-ago): el descuento sale de `platform_fee_amount` y **`tutor_net_amount` no se toca**. ⚠️ **Dos agujeros verificados:** `platform_fee_amount` **no tiene `check (>= 0)`** — la base de datos no frenará un margen negativo; y el motor de reembolsos calcula sobre `gross_amount`, así que un 100 % devuelve el precio **rebajado** mientras el tutor cobra el neto **íntegro** | XL |

### Calendario, mentorías y sala

| | Punto | Veredicto | Evidencia y matiz | Esf. |
| :-- | :-- | :-- | :-- | :-- |
| **F1** | «Reserva estas mentorías» + CTA por paso | 🔴 **NO EXISTE** | ⚠️ **Primero hay que preguntar qué calendario:** el de reservar (alumno) o el que literalmente se llama «Calendario» (`tutor/availability`) — en ese segundo el título sería **falso**, esa pantalla no reserva nada. Y el plural solo es cierto en la rama de paquete. ⛔ Los CTA por paso **reabren §20.14**, que ya respondió a «marcar los pasos» con **texto** y a propósito: «la queja no era el número de pasos, era no saber en cuál estabas» | S |
| **F2** | Sincronizar con Apple/Google Calendar | 🔴 **NO EXISTE** | `grep ics\|ical\|webcal` = 0. ⚠️ **«Apple Calendar» no es un botón, es un `.ics`, y un `.ics` descargado es una foto:** si la mentoría se reprograma, el evento sigue mintiendo. Sincronización de verdad = suscripción `webcal://` con token opaco en `profiles` → **L con migración**. Y una reserva de paquete son **N eventos**, no uno | M |
| **F3** | Header blanco, marca, nº de clase, chat oculto | 🟡 **PARCIAL** | El `<header>` **existe** (`live-room.tsx:588`) con título y nº de sesión, pero es **oscuro** (`#14141a`) y **sin marca** — el logo solo se pinta en los estados previo/posterior, y el comentario lo dice. 🟢 El blanco no es indecidible: `globals.css:72-73` ya tiene `--card`. ⛔ **El chat abierto contradice MN-04, que es petición literal del cliente** (`live-room.tsx:252-254`). Y F3 y F5 se pelean por la **misma franja de 52 px** | S |
| **F4** | Restringir acceso + «error de cierre a los 7 días» | ⛔ **BLOQUEADO** | 🔴 **No es un error: es la respuesta P-6 del cliente del 20-ago**, ejecutada el 21 (`40156e8` + `20260820190000`). La migración existe precisamente para **separar** «puedo entrar» de «la clase terminó», porque el cliente dijo **NO** a cobrar más tarde. ⚠️ Deshacerlo toca **al menos nueve sitios**, no tres. Y el peor pie es de dinero: quien «arregle» el cierre moviendo `close_expired_sessions()` a 7 días **retrasa todos los payouts una semana** contra el §12 del contrato | L |
| **F5** | «Reportar Conducta» arriba de la sala | 🔴 **NO EXISTE** *(en la sala)* | Existe **en el chat** (`report-conversation.tsx` → `conversation_reports`). ⚠️ **No es moverlo de sitio:** `report_conversation` valida pertenencia a una **conversación**, así que reusarlo desde la sala reporta el hilo de chat, no la conducta en la llamada. Las «opciones de reporte» (lista cerrada) exigen columna nueva → **migración**. Y sin bandeja de admin es **un buzón sin cartero** — literalmente lo que dice el componente: «esto es la puerta, no la sala» | L |

### Especiales y pendientes de decisión

| | Punto | Veredicto | Evidencia y matiz | Esf. |
| :-- | :-- | :-- | :-- | :-- |
| **G1** | Inbox Q&A: 2 propuestas de diseño | 🟡 **PARCIAL** | Analizado entero en `docs/21-DECISION-CONSULTAS-PREVENTA.md`. ⚠️ **Y hay una pieza construida que cambia la conversación:** la ficha de mentoría **ya tiene un bloque «Preguntas frecuentes»** que escribe el propio tutor (`products.faqs`, migración `20260724180000`, formulario en `product-form.tsx:790-815`). Si se le presentan «dos opciones nuevas» sin enseñarle esto, comprará la cara. **Efecto secundario que nadie ha mirado:** hoy ese bloque pinta 4 preguntas genéricas escritas por nosotros en toda mentoría sin FAQ propias, firmadas visualmente como del tutor | S |
| **G2** | Quitar el nº de registro empresarial (EIN) | 🔴 **NO EXISTE** | El EIN `42-2277169` está en **tres** sitios: el pie (`site-footer.tsx:97`), `/contacto` (`:74`) y **el §39 de los Términos, en los dos idiomas** (`terms-content.ts:480` y `:898`). ⚠️ **Misma trampa que el domicilio con MN-10:** quitarlo del pie no lo hace privado. Y tocar el §39 sube `TERMS_VERSION`, **sin flujo de re-aceptación** — el único escritor de `terms_acceptances` es el alta. ⚠️ `check:terms` **pasa en verde** aunque se borre de un solo idioma: no compara bloque a bloque | S |
| **G3** | Eliminación de cuenta | 🔴 **NO EXISTE** | `grep` = 0. ⚠️ **Y no falla por falta de botón, falla por integridad:** hay **cuatro FK que frenan** (`bookings.product_id` la primera), así que borrar casi cualquier tutor da **error de integridad**. Al revés, `reviews.student_id` es `CASCADE`: borrarse un alumno **le borra las reseñas al tutor y le mueve la media**; y `sessions` en `CASCADE` evapora el registro de clases impartidas que alimenta la campaña de E2. Y `/privacy` ya **promete** supresión por correo, sin proceso ni SLA detrás | L |
| **G4** | Aplazar Academias y *look and feel* | 🔴 **NO EXISTE** *(alcance futuro puro)* | Academias no existe en el código: «desplazarlo» cuesta editar Jira. ⚠️ **Dos avisos:** US-1601 (*look and feel* responsive) está **bloqueada por diseños de Diana que nadie ha pedido** — cambiarla de sprint no la desbloquea; y «ajustes secundarios de *look and feel*» **no está enumerado en ningún sitio**, así que sin inventario el sprint siguiente traerá una lista nueva y más larga | XS |

### Los dos que el correo pedía verificar

| | Punto | Veredicto | Evidencia |
| :-- | :-- | :-- | :-- |
| **H1** | Bloquear o seleccionar bloques de días y horarios | 🟢 **SÍ, ESTÁ** | Las **dos** cosas, y son dos cosas distintas: `availability_rules` (plantilla semanal recurrente) y `availability_exceptions` con `type = block \| open`, día completo o franja parcial (`20260709130000:16-45`). Pantalla: `tutor/availability/page.tsx` con `availability-manager.tsx` (panel izquierdo, reglas) y **`exceptions-manager.tsx`** (panel derecho, bloqueos). Verificado además que **bloquear impide reservar de verdad**. ⚠️ Si el cliente solo mira el panel izquierdo dirá que no se puede bloquear |
| **H2** | Perfil del alumno visible para el tutor | 🟢 **SÍ, ESTÁ** | RPC `tutor_students` `SECURITY DEFINER` con columnas elegidas a mano (`20260817150000`) **y pantalla de 231 líneas** en `tutor/alumnos/[id]/page.tsx`, con tres entradas (nombre del alumno, «Ver perfil» del detalle de reserva, avatar). Deja fuera a propósito teléfono, correo e intereses, **y lo dice en pantalla**. ⚠️ Riesgo real: **descubribilidad** — no hay entrada en el menú lateral |

---

## 22.3 · Las siete contradicciones — hay que devolvérselas antes de programar

No son matices de implementación. Son **peticiones que revierten una respuesta escrita del propio
cliente**, casi todas del 20 de agosto. Ejecutarlas sin preguntar es hacer y deshacer con su
presupuesto.

| # | El correo pide | El cliente dijo | Qué preguntar |
| :-- | :-- | :-- | :-- |
| **1** | **F4** · «solucionar el error de cierre automático a los 7 días» | **P-6, 20-ago: «7 días antes y 7 después»**, y **NO** a que el tutor cobre más tarde | ¿Es marcha atrás sobre P-6, o el problema es otro (p. ej. que el botón «Entrar a sala» aparezca demasiado pronto)? |
| **2** | **F3** · «chat oculto por defecto» | **MN-04, 21-ago**: «un embed de Daily prácticamente a pantalla completa, **y el chat incrustado a la derecha**» | ¿Oculto **siempre**, o solo que arranque plegado y se abra con el botón que ya está en la barra de Daily? |
| **3** | **B5** · hold a 7 minutos | **D-2, 20-ago**: el horario se retiene al abrir el checkout, **con contador visible** de 20 min | Ver los tres choques de abajo. **7 no significará 7** |
| **4** | **A1** · si «añadir el campo» significa **obligatorio** | **P-5, 20-ago: titular opcional**, para no meter otro muro antes del pago | ¿Se cambia a obligatorio, sabiendo que es revertir P-5? |
| **5** | **B1/F1** · más pasos y un CTA por paso | **N-33 + §20.14, 17 y 20-ago**: se **quitó** una pantalla porque «estás seleccionando dos veces algo», y se respondió a «marcar los pasos» con **texto**, a propósito | ¿La queja es el número de pasos o no saber en cuál estás? Ya se respondió lo segundo |
| **6** | **D3** · dropdown en la gestión de horarios | Rediseño del **7-ago**, hecho **justamente porque la pantalla era difícil de entender** | ¿El problema es el **número** de botones, o otra cosa? Sería la tercera iteración en tres semanas |
| **7** | **G1** · reabrir el canal de preguntas | **P-1, 20-ago: «sí, el chat solo tras reservar. La minuta manda»** | Legítimo reabrirlo, pero **hay que presentarlo como marcha atrás**, no colarlo como ajuste. Y enseñarle antes las FAQ que ya existen |

### El caso B5, en detalle — porque «7 minutos» no dará 7 minutos

Tres choques verificados, y ninguno se arregla con la migración:

- **El cron.** `expire_stale_bookings` corre `*/5`. Un corte de 7 min da una retención real de **7 a
  12 minutos** — un 71 % de varianza sobre lo anunciado (con 20 era del 25 %, y `policy.ts:41-45`
  explica que se anuncia corto **a propósito**).
- **Stripe.** La Session tiene un **suelo duro de 30 minutos** por límite de plataforma
  (`checkout/route.ts:88-89`). Hoy hay ~40 min en los que la reserva ya está cancelada y el
  formulario **sigue siendo pagable**, tapados por X-02 y su tabla de cobros tardíos. Con 7, esa
  ventana pasa a **~48-53 min** y **no se puede cerrar**.
- **El chat.** `pair_can_chat` abre el canal alumno↔tutor mientras hay una reserva en
  `pending_payment`. Bajar el hold recorta esa ventana de 20-25 a 7-12 minutos: **quien deje el pago
  a medias para preguntarle algo al tutor se queda mudo a mitad de conversación** — y como
  `cancelled` no cuenta en `pair_has_booking`, ya no vuelve a poder escribir.

> **Y el efecto de negocio va al revés de lo que se busca:** acortar el hold «para liberar cupos
> antes» hace que **más** alumnos paguen una reserva ya cancelada y acaben en el circuito de
> reembolso automático. Soporte, comisión de PSP perdida y un alumno enfadado, a cambio de trece
> minutos de cupo.

---

## 22.4 · Las preguntas al cliente — un solo mensaje

Sin estas respuestas, once puntos no se pueden empezar. Van con la consecuencia puesta.

| # | Pregunta | Bloquea |
| :-- | :-- | :-- |
| **V-1** | **La sala de 7 días: ¿es marcha atrás sobre vuestra respuesta del 20-ago, o el problema es otro?** Estrecharla toca nueve sitios y, si alguien confunde el cierre con el acceso, **retrasa todos los payouts una semana** | F4 |
| **V-2** | **El chat de la sala: ¿oculto siempre, o plegado al entrar?** Abierto es lo que pedisteis el 17-ago | F3 |
| **V-3** | **El hold: 7 minutos darán entre 7 y 12, y dejarán ~50 min en los que se puede pagar algo ya cancelado.** ¿Aun así 7? ¿O el objetivo era otra cosa? | B5 |
| **V-4** | **«Nombre en la tarjeta» ya está, opcional porque lo pedisteis así. ¿Se cambia a obligatorio?** La etiqueta la escribe Stripe: pone «Nombre» | A1 |
| **V-5** | **¿Qué calendario?** El de reservar (alumno) o el de disponibilidad del tutor. En el segundo, «Reserva estas mentorías» sería falso | F1 |
| **V-6** | **¿Dónde echasteis en falta el enlace al perfil del tutor?** En la ficha de la mentoría ya es un botón con borde de marca | D6 |
| **V-7** | **Zinli: ¿tienen API de comercio, o solo emiten Visa prepago?** Si es lo segundo, ya se puede pagar por Stripe hoy y el punto desaparece. **PayPal: ¿vale como método dentro de Stripe?** | A4 |
| **V-8** | **El EIN está en tres sitios, y uno es el contrato que firmasteis.** ¿Se retira solo de la web, o también del §39? Lo segundo sube la versión de los Términos **y no hay flujo de re-aceptación**. ⚠️ Y si el EIN está cargado en el panel de Stripe, quitarlo de la web no lo hace privado | G2 |
| **V-9** | **Moneda local: ¿asumís enseñar un importe distinto al que se cobra?** Hoy no hay ni un descargo escrito en los legales, y Venezuela es el peor caso (tasa volátil y múltiple). Sigue dependiendo de **C-13** | D5 |
| **V-10** | **Eliminación de cuenta: ¿borrado o anonimización?** Borrado real hoy **falla** por integridad, y borra las reseñas que el alumno dejó a sus tutores | G3 |
| **V-11** | **«Ajustes secundarios de look and feel»: ¿cuáles?** No están enumerados en ningún sitio | G4 |

---

## 22.5 · El orden de prioridades

El criterio no es la importancia declarada: es **qué desbloquea a qué**, y **qué se puede hacer sin
esperar a nadie**.

### 🟢 Tanda 0 · Contestar, no programar — hoy mismo, coste cero

Seis puntos hechos y cuatro medio hechos que nadie ha visto. **Es la mitad del correo.**

`A1` · `A5` · `B2` · `C3` · `H1` · `H2` — hechos.
`D2` (el orden ya está) · `D6` (el enlace ya está en la ficha) · `G1` (las FAQ del tutor ya existen)
· `E2` (la tarjeta de referidos ya llega al tutor) — hechos a medias, y la mitad hecha es la que se
pedía.

> Va primero porque **cambia la conversación**: si esto se enseña, la lista pasa de 34 puntos a ~20.

### 🔴 Tanda 1 · Las siete preguntas — salen el mismo día

§22.4 en un solo mensaje. **Siete de los puntos más caros de la lista dependen de esto**, y tres de
ellos son marcha atrás sobre decisiones suyas: no se tocan sin respuesta escrita.

### 🟢 Tanda 2 · Lo barato y sin dependencia — dos días, en paralelo

| Ficha | Qué | Esf. |
| :-- | :-- | :-- |
| **T2-1 · D4a** | **Un solo nombre para `per_session`.** Hoy son cinco («Sesión única», «Sesión suelta» ×6 pantallas, «por sesión», «Por sesión»). Unificar en **«Sesión individual»** desde `format.ts` y `product-filters.tsx` | S |
| **T2-2 · D4b** | Recorte de títulos largos en las **dos** superficies que quedan sin tope: miga de pan (`products/[id]:134`) y `<h1>` del detalle de reserva (`reservas/[id]:128`) | XS |
| **T2-3 · D6** | El enlace al perfil del tutor en `featured-products.tsx` **y decidir el fallback 404** para las superficies de reserva (un tutor desaprobado da `notFound()`) | S |
| **T2-4 · D2** | Bloque de tutores recientes en el panel del alumno | S |
| **T2-5 · H2b** | La línea de `/privacy` que hoy **contradice al código**: publica «el perfil de los alumnos es privado» sin la excepción que abrió `20260817150000` | XS |
| **T2-6 · E2a** | URL y copy de referidos diferenciados por rol (`NEXT_PUBLIC_REFERRAL_URL_TUTOR`) | XS |
| **T2-7 · E1a** | **`domain: '.ensenameya.com'` en la cookie `ey-ref`** — antes de que nadie toque el DNS, no después | XS |
| **T2-8 · G4** | Mover Academias en Jira/`BACKLOG.md` **y pedir el inventario** de *look and feel* | XS |
| **T2-9 · C1** | Cerrar el onboarding del tutor pidiéndole al menos una franja antes de terminar | S |

### 🟠 Tanda 3 · Con respuesta puesta — cada ficha arranca cuando llega su respuesta

`F3` (header blanco + marca, S) · `F1` (copy del calendario, S) · `B4` (agrupar el checkout, M) ·
`A1b` (titular obligatorio, XS) · `G2` (el EIN, S + decisión legal) · `B5` (el hold, S con migración
y con los tres choques encima de la mesa) · `F4` (la sala, L — **solo si confirman la marcha atrás**).

### 🔵 Tanda 4 · Épicas — no caben, y decirlo ahora vale más que decirlo tarde

| Punto | Por qué |
| :-- | :-- |
| **A2 / A3** | dLocal. Bloqueado por su revisión del sitio, que está bloqueada por el merge y por los dos dominios sin conectar |
| **A4** | Zinli/PayPal. **Puede desaparecer con dos llamadas** (V-7). Si no, es A2 ×2 |
| **B1 / B3** | Los 3 pasos y el carrito. El primero sube pantallas (lo contrario de lo pedido); el segundo reescribe el núcleo de dinero |
| **C4** | Validación de área verificada. **No hay contra qué validar**: las categorías son autodeclaradas |
| **D1** | Carrusel (no existe ninguno en el repo) + favoritos (tabla nueva) |
| **D3** | Dropdown de horarios. Tercera iteración de la misma pantalla en tres semanas |
| **D5** | Moneda local. Bloqueado por **C-13** y sin cobertura legal |
| **E3** | Motor de promociones. **Y con dos agujeros contables que hay que cerrar en la misma migración** |
| **F2** | Sincronización de calendario. Un `.ics` es una foto; la sincronización real es **L con migración** |
| **F5** | Reportar conducta en la sala. Migración + bandeja de admin, o es un buzón sin cartero |
| **G3** | Eliminación de cuenta. Hoy **falla por integridad**, y arrastra reseñas ajenas |

---

## 22.6 · Tres cosas que la documentación del repo dice mal

Van aquí para que no se vuelvan a citar como verdad.

1. **`docs/19-PLAN-DE-EJECUCION.md:646` y `:724` dan N-04 por XL y «no cabe».** El código lo
   desmiente: la migración `20260817200000` está aplicada y la UI existe en `product-form.tsx:753-757`.
   Gana el código.
2. **El Doc 20 §20.12 afirma que reescribir la privacidad rompería `npm run check:terms`.** No lo
   rompe: ese script solo lee `terms-content.ts` y compara porcentajes contra `lib/policy.ts`. **No
   lee `legal-doc.tsx`.**
3. **El contrato ya contempla promociones** (`terms-content.ts:187`, `:195`, `:197`), así que la
   campaña de referidos **no obliga a tocar el documento firmado** — solo el texto llano de
   `legal-doc.tsx:90` y `:141`.

Y una corrección al propio Doc 20: la atribución de referidos **sigue siendo la cookie `ey-ref`**,
no el email. Confirmado otra vez aquí, y ahora con la consecuencia añadida de E1.

---

## 22.7 · Lo que esta lista no dice y pesa más que ella

Tres cosas que no aparecen en el correo y que valen más que cualquiera de sus 34 puntos:

1. **El correo no envía.** ⚠️ **Corregido el 30-ago: el diagnóstico de esta línea estaba mal.**
   `RESEND_API_KEY` **sí estaba** dada de alta desde el 17-ago (en local, Preview y Production); lo
   que faltaba era el **reloj**, o sea `APP_BASE_URL` + `CRON_SECRET` en GitHub, sin los cuales los
   dos workflows de Actions llevaban **30 corridas en rojo**. Ya están puestos y los jobs dan 200. El
   síntoma que describe la línea —«no pasa nada»— era real; la causa, no. **Y sigue en pie lo que de
   verdad importa: nadie ha visto llegar un correo de la cola**, porque el reloj apunta a producción
   y allí la cola está vacía (los **336** avisos `pending` están en dev). El correo pide «pruebas
   integrales de envíos de correo» (A4) y esa media frase sigue siendo el punto más importante de
   toda la lista.
2. **Ningún reembolso ha movido un euro.** El job se ejercitó en simulacro. Encolar no es devolver.
   Sigue **exactamente igual** al 30-ago: el cron ya corre, pero contra prod, donde la cola está
   vacía; los **2** `refund_requests` `pending` viven en dev.
3. ~~**`main` sigue congelada en el commit del 29-jul.**~~ ✅ **El merge se hizo el 26-ago**
   (`3fca8b2`). Hoy `dev` va 52 commits y 7 migraciones por delante — un merge de una semana, no de
   dos meses. El párrafo de abajo describe el estado hasta esa fecha. Para el equipo `dev` es producción y esta
   auditoría se ha hecho contra `dev`, como toca. Pero el dominio público **no tiene** ni la sala de
   7 días, ni el checkout nuevo, ni el perfil del alumno, ni las páginas legales. Y es la URL que
   dLocal revisa a mano.

---

*Faim Lab · Doc 22 · Verificación de la lista consolidada del 21-ago · 24 de agosto de 2026.*

---

## 22.8 · Las once respuestas de Jose — 24 de agosto

Contestadas las once preguntas de §22.4. Cada una se mapeó contra el código con un agente y su
revisor adversarial. **Tres respuestas no se pueden cumplir tal como están enunciadas**, y una trae
adjunto un fallo que ya existe hoy.

| # | Respuesta | Consecuencia |
| :-- | :-- | :-- |
| **V-1** | **La sala de 7 días está mal.** Debe abrir «a la hora que corresponde y la duración que tiene» | 🟠 Marcha atrás sobre P-6. Implementable, pero **margen cero rompe la clase por dos caminos** y arrastra el botón de «Marcar completada». Falta elegir número — §22.9 |
| **V-2** | **Chat plegado al entrar**; header de marca activo; barra de título y contador **en blanco**; chat a la derecha en **el gris de Daily** | 🟠 Viable en un solo fichero, pero **con el chat plegado un mensaje no avisa por ningún sitio y además se da por leído**. Y «header activo» admite dos lecturas — §22.9 |
| **V-3** | **7 minutos. Fin.** | 🟢 Se ejecuta. ⚠️ Serán **7-8**, no 7 (hay que reprogramar el cron a cada minuto), y **la migración tiene que cerrar la carrera de `expire_stale_bookings`** — §22.10 |
| **V-4** | El input debe decir **«Titular de la tarjeta»**, y **requerido** | 🔴 **Requerido sí; el literal no.** `NameCollection.Individual` tiene solo `enabled` y `optional`, y `custom_text` no cubre el nombre. La etiqueta la escribe Stripe dentro de su iframe |
| **V-5** | La pantalla de reservar, **el título de arriba del calendario** | 🟢 Es [`booking-panel.tsx:239`](../src/components/catalog/booking-panel.tsx). En la ficha del tutor pinta «Reserva con este tutor» — ahí el plural de «Reserva estas mentorías» encaja |
| **V-6** | Tras reservar **no hay forma de llegar al tutor**. Integrar la tarjeta de la ficha pública | 🟢 **Y sin migración**: `tutor_profiles_select_public` ya abre esos campos a `authenticated`. Es ampliar un `select` y reutilizar el bloque |
| **V-7** | Equivocación suya: **Zinli va por tarjeta**; PayPal, no seguro | 🟢 **PayPal es método de Stripe** (`'paypal'` está en la unión `PaymentMethodType`). Dos líneas + activarlo en el panel. **El bloque de pagos se cierra sin adaptadores nuevos** |
| **V-8** | El EIN, **fuera de todo** | 🔴 **«Todo» incluye el contrato firmado.** Son **diez** puntos de edición, no seis, y sube `TERMS_VERSION` — **sin flujo de re-aceptación** — §22.9 |
| **V-9** | **Sí** a la moneda local | 🟠 Solo cabe como **precio orientativo en vitrina**. Falta decidir mostrar vs cobrar, y **C-13 sigue siendo la puerta** — §22.9 |
| **V-10** | **Anonimización**: borrar usuario y reservas, reseñas anónimas | 🔴 **Las dos mitades se contradicen.** `reviews.booking_id` es `cascade`: borrar la reserva borra la reseña. Y **borrar reservas borra `payments`**, con `payout_items` en `restrict` |
| **V-11** | *Look and feel*: post-entrega, no interesa | 🟢 Fuera de alcance |

### Los hallazgos que no venían en ninguna pregunta

| Qué | Dónde duele |
| :-- | :-- |
| 🔴 **`expire_stale_bookings` puede cancelar una reserva recién pagada.** Cancela sin guarda de estado; `confirm_payment` lee sin `for update`. Resultado: cobrado, sin clase y **sin reembolso posible** | Con el hold a 7 min y el cron a cada minuto, la ventana de colisión se multiplica. Tres líneas, en la misma migración |
| 🟠 **El botón «Entrar a sala» del panel no consulta la ventana.** Ofrece entrada a clases de dentro de semanas | Es, con diferencia, la explicación más probable de «la sala está abierta desde que compro» — y se arregla **sin tocar la migración ni el payout** |
| 🟠 **«Marcar completada» del tutor está anidado dentro del gate de ventana.** Estrechar la ventana estrecha el botón que fija `bookings.completed_at` | Es el reloj del payout. Hay que sacarlo del gate o aceptar el estrechamiento a conciencia |
| 🟠 **Anonimizar no cierra la puerta: el correo no está en `profiles`, está en `auth.users`** — y con Google el emparejamiento es por identidad del proveedor | La persona vuelve con «Continuar con Google» y aterriza en su perfil vaciado |
| 🟠 **`home_testimonials` no filtra estado.** Anonimizas al tutor y la portada sigue enseñando su mentoría | Es `security definer`: se salta la RLS |
| 🟢 **El literal «TITULAR» ya se pinta en nuestro DOM** (`checkout-form.tsx:480`), fuera del iframe | Puede que V-4 esté medio resuelto sin tocar Stripe |

### Las cuatro decisiones que faltaban — 24-ago

| Qué | Decisión | Consecuencia |
| :-- | :-- | :-- |
| **Ventana de la sala** | **10 min antes / 10 después** | Vuelve al valor previo a MN-05. Acceso y clase coinciden otra vez, queda **un solo número**, y nadie se corta a mitad de frase. Hay que **sacar «Marcar completada» del gate de ventana** o el tutor pierde el botón que fija `completed_at` |
| **EIN** | **Solo la web, ya** | Fuera del pie y de `/contacto`. **No se toca `terms-content.ts`**, y por tanto **tampoco `company.ts:23-25`**: mientras el §39 interpole esas claves, borrarlas rompe por tipos el contrato firmado. El §39 queda pendiente de Néstor |
| **Header de la sala** | **El `SiteHeader` real** | Se monta con `requireUser()`, que la página ya tiene. ⚠️ **Con guarda de navegación**: cada enlace ejecuta `call.destroy()`, así que se pide confirmación antes de salir de una llamada viva. Sin eso es una fila de botones para caerse de la clase |
| **Moneda local** | **Precio orientativo en vitrina** | El cobro sigue en USD. Sigue bloqueado por **C-13** (a qué mercado y a qué moneda) |

---

## 22.9 · El orden de trabajo, con las decisiones puestas

### 🟢 Tanda A · Hoy — frontend y copy, sin esquema, todo reversible

| Ficha | Qué | Esf. |
| :-- | :-- | :-- |
| **A-1 · V-5** | El título de arriba del calendario → «Reserva estas mentorías», en [`booking-panel.tsx:239`](../src/components/catalog/booking-panel.tsx). Solo la rama sin mentoría elegida (la ficha del tutor), que es donde el plural es cierto | XS |
| **A-2 · V-8** | El EIN fuera del pie y de `/contacto`. **No tocar `company.ts` ni `terms-content.ts`** | XS |
| **A-3 · V-4a** | Titular **requerido**: `optional: false` en los dos sitios que crean Session, **y subir `VERSION_PARAMS` a `"v4"`** o revientan los checkouts abiertos el día del despliegue | XS |
| **A-4 · V-7** | `"paypal"` en `payment_method_types`, en los dos sitios. Misma trampa de idempotencia: va en el **mismo** bump a `v4`. Requiere activarlo en el panel de Stripe | XS |
| **A-5 · V-2** | La sala: chat **plegado** al entrar, barra superior **blanca** con el `SiteHeader` y **guarda de navegación**, panel de chat en el gris de Daily. ⚠️ Incluye arreglar el autoscroll (hoy abre en el mensaje más viejo) y **que un mensaje con el chat plegado avise en vez de darse por leído** | M |
| **A-6 · V-6** | La tarjeta del tutor en las pantallas de reserva del alumno. **Sin migración**: los campos ya son legibles por `authenticated`; es ampliar el `select` de `tutorNames`. Con **fallback** para el tutor desaprobado, o el alumno recibe un 404 desde su propio panel | M |

### 🔴 Tanda B · Esquema — un solo dueño de la base de datos, y en este orden

**B-1 · El hold a 7 minutos, y la carrera que hay que cerrar con él.** Una migración nueva con
`create or replace expire_stale_bookings`, copiando el cuerpo de **X-01** (`20260817170000`), nunca
el de `20260709190000`, o se revierten los reembolsos reales sin que nada avise.
En el mismo fichero, y esto no es opcional:
· **`and status = 'pending_payment' returning id`** en el `update` de `bookings`. Sin esa guarda, un
  webhook que confirme entre el `select` y el `update` del cron deja **cobrado, cancelado y sin
  reembolso posible** — y bajar el corte multiplica la ventana de colisión.
· **Reprogramar el cron a cada minuto** (`unschedule` + `schedule`, el patrón fiable del repo), o 7
  significa entre 7 y 12.
· `HOLD_POLICY.minutes = 7` y **`CADUCIDAD_MIN` de 60 a 40**, o la ventana de «pagar algo ya
  cancelado» pasa de 35-40 a 52-53 minutos. El suelo duro de Stripe es 30, así que no se puede cerrar
  del todo.
· El hilo de chat pasa a **solo lectura con enlace a reservar** en vez de un error crudo en rojo.

**B-2 · La ventana de la sala a 10/10.** Migración nueva con `create or replace session_access_window`
y **backfill incondicional** — copiar el `where … is null` de MN-05 deja la migración en verde, la
función diciendo 10 minutos y el acceso seguiendo en 7 días, sin que nada avise.
`session_live_window()` y `close_expired_sessions()` **no se tocan**: de ahí sale `completed_at` y con
él el payout. Después: `ACCESS_WINDOW_DAYS`, los tres consumidores sin gate, **sacar «Marcar
completada» del gate de ventana**, y los copys que hoy prometen 7 días.
⚠️ Al barrer «7 días» **no tocar `tutor/payouts`**: ese 7 es la retención de payouts, y es dinero.

### 🔵 Tanda C · Bloqueadas por algo que no es código

| Qué | Espera |
| :-- | :-- |
| **Moneda orientativa** | **C-13** — a qué mercado y a qué moneda. Sin eso, elegir la tasa es inventar la decisión del cliente |
| **Anonimización de cuenta** | Rediseño y visto bueno: **no se borra ninguna reserva ni ningún pago; se borra la identidad**. Y hay que resolver que **con Google se puede volver a entrar** al perfil vaciado |
| **El §39 del contrato** | Néstor. Conviene mandarlo **junto** con la pregunta de «clase → mentoría», que toca el mismo fichero |
| **El literal del campo de Stripe** | Decidir entre aceptar el que escribe Stripe o poner rótulo propio. 🟢 Dato que puede cerrarlo gratis: **`checkout-form.tsx:480` ya pinta «TITULAR» en nuestro DOM**, fuera del iframe |

---

*Faim Lab · Doc 22 · §22.8–22.9 · Respuestas y orden de trabajo · 24 de agosto de 2026.*

---

## 22.10 · Dos cierres verificados en pantalla — 24-ago

### El campo «Nombre completo» es de Stripe, comprobado en el navegador

Se levantó el checkout real en dev con una alumna del seed y una mentoría de sesión individual.
El campo que se ve arriba, encima de «Método de pago», dice **«Nombre completo (opcional)»**.

**La prueba de que no es nuestro:** `document.querySelectorAll('input,label')` sobre nuestro propio
documento devuelve **cero elementos**. El correo, el nombre y los tres campos de tarjeta viven todos
dentro de iframes de `js.stripe.com/v3/elements-inner-*`.

| Mitad de la petición | Veredicto |
| :-- | :-- |
| Quitar el **«(opcional)»** y hacerlo obligatorio | 🟢 **Sí** — `optional: false`. El sufijo lo pinta Stripe a partir de ese parámetro y desaparece solo |
| Cambiar **«Nombre completo»** por «Titular de la tarjeta» | 🔴 **No** — `NameCollection.Individual` solo tiene `enabled` y `optional`, y `custom_text` no cubre este campo |

⚠️ Corrección al §22.2: el literal en español no es «Nombre», es **«Nombre completo»**.

### La anonimización: por qué tampoco se puede borrar la cuenta de acceso

Cadena de claves foráneas verificada: `auth.users` → `profiles` (`on delete cascade`,
`20260606121500:31`) → `bookings` (`cascade`, `20260709140000:35`) → `payments` (`cascade`, `:97`),
y `payout_items.payment_id` en **`on delete restrict`** (`20260716140000:48`).

Es decir: **borrar la cuenta de acceso no es una alternativa a borrar las reservas — es la misma
cosa.** Para un usuario con pagos ya liquidados revienta por integridad; para el resto se lleva en
silencio reservas, pagos, sesiones y reseñas.

**El diseño que sí funciona:**

1. **Nada de la contabilidad se borra.** `bookings`, `payments`, `payouts` y `sessions` se quedan —
   es lo que la privacidad publicada ya promete (`legal-doc.tsx:118`).
2. **Se vacía `profiles`**: nombre, teléfono, zona, objetivo y código de referido; y el avatar se
   borra de Storage.
3. **La fila de `auth.users` se conserva** —para que no cascadee— pero se inutiliza: se borran sus
   identidades de proveedor y se banea. **Ese es el paso que cierra la puerta de Google**, que
   reescribir el correo no cierra: el emparejamiento es por identidad del proveedor.
4. **Las reseñas se conservan sin autor.** Ya se pintan enmascaradas.
5. **Un tutor no se puede anonimizar mientras tenga saldo pendiente o sesiones futuras.** Es dinero
   y son clases vendidas a terceros.
6. ⚠️ **Hay que arreglar `home_testimonials` en la misma pasada**: es `security definer` y **no
   filtra estado**, así que hoy la portada seguiría enseñando la mentoría de una cuenta anonimizada.

