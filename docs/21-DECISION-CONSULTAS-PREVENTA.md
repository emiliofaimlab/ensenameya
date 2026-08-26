# DOC 21 — Preguntar antes de comprar: dos caminos para que el cliente elija

> **Qué es esto.** Hoy, en la plataforma, **un alumno no puede hacerle una pregunta a un tutor sin
> haber reservado antes**. No es un descuido: es la consecuencia directa de una decisión que el
> cliente tomó por escrito el 20 de agosto (P-1, Doc 20 §20.10). Este documento pone encima de la
> mesa **las dos formas de devolver ese canal**, con lo que cuesta cada una **medido contra el
> código**, no estimado a ojo.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 21 — Consultas de preventa: preguntas públicas vs. consulta previa privada |
| **Fecha** | 2026-08-24 |
| **Autor** | Jose Mora (desarrollo) |
| **Decide** | Cliente, vía Verónica |
| **Base** | Doc 20 §20.10 (respuesta P-1) · MN-06 (`b786e38`) · M-12 (`9305c1c`) |
| **Verificación** | Contra `dev` @ `e209180`. Cada cifra de esfuerzo de este documento sale de mirar el fichero que habría que tocar |

---

## 21.0 · La conclusión, en cinco frases

1. **El hueco es real y lo abrimos nosotros a propósito.** Desde MN-06 (`b786e38`, 20-ago) escribir
   a un tutor exige tener una mentoría reservada con él. El único canal que le queda a quien todavía
   duda es `/contacto`, que **va al buzón de la empresa, no al tutor**.
2. **Las dos opciones no son la misma cosa con dos interfaces.** La 1 es **contenido público**: una
   respuesta sirve a todos los que vengan después. La 2 es **conversación privada**: una respuesta,
   un alumno.
3. ⚠️ **La opción 2 ya está construida y apagada.** Es M-12 (`9305c1c`, migración
   `20260817210000_conversaciones_previas.sql`, 1.154 líneas) con la puerta de MN-06 delante.
   Y **ya trae exactamente los límites que pide el enunciado**: sin adjuntos, tope de mensajes y
   fusión con el chat de la clase sin migrar nada. Volver a encenderla son **dos líneas de SQL** y
   recuperar un componente que está en el histórico de git.
4. **La opción 1 no existe: ni tabla, ni pantalla, ni diseño en Figma.** Y arrastra una pieza que
   hoy **no existe para nada**: una cola de moderación. Los reportes de chat ya se guardan
   (`conversation_reports`) y **ninguna pantalla de admin los lee**.
5. **No son excluyentes.** Si se quieren las dos, el orden barato es 2 primero (un día) y 1 después.

> ⚠️ **Y una advertencia de proceso, antes que ninguna otra cosa.** Elegir la opción 2 es **volver
> atrás sobre una decisión que el cliente tomó hace cuatro días** («la minuta manda»). Es
> perfectamente legítimo —M-12 se cerró el mismo día en que se construyó, y el cliente nunca llegó a
> verlo funcionando, porque no está en producción— pero **hay que presentarlo como lo que es**, no
> colarlo como un ajuste.

---

## 21.1 · Cómo llegamos aquí — la línea de tiempo, en cuatro fechas

| Fecha | Qué pasó | Rastro |
| :-- | :-- | :-- |
| **17-ago 19:28** | Se abre el chat **antes** de comprar. Conversación anclada al par (alumno, tutor), histórico continuo, topes anti-spam, sin adjuntos | `9305c1c` · `20260817210000` |
| **17-ago (mismo día)** | Reunión con el cliente de la que sale la minuta. **Las dos cosas se cruzan sin verse** | Doc 20 §20.1 (B-2) |
| **20-ago** | El cliente contesta P-1: **«sí, el chat solo tras reservar»** | Doc 20 §20.10 |
| **20-ago 15:26** | Se cierra. Los hilos previos quedan **visibles en solo lectura** | `b786e38` · `20260820180000` |

**Lo que quedó abierto y por eso existe este documento:** cerrar el chat de preventa **no sustituyó
el canal por otro**. Un alumno que se pregunta «¿esto cubre lo que yo necesito?» hoy tiene que pagar
para preguntarlo.

⚠️ **Y hay un reloj corriendo.** Los hilos de preventa que ya existen se congelaron en solo lectura,
y `purge_expired_messages()` borra la conversación entera a los 30 días sin actividad si el par no
compró. O sea: **a los 30 días desaparecen solos**. Coincide con la retención de 30 días que las
páginas legales publican, así que es decisión de producto, no fallo — pero el cliente los quería
«visibles», y esto los caduca.

---

## 21.2 · Opción 1 · Preguntas y respuestas **públicas** en la mentoría

*(la de MercadoLibre)*

### Cómo se ve

En la ficha de cada mentoría, debajo de la descripción, un bloque **«Preguntas»**: cualquiera que
entre —haya comprado o no, esté registrado o no— **lee** las preguntas que otros ya hicieron y las
respuestas del tutor. Quien quiera preguntar, escribe. El tutor responde desde su panel. La
respuesta queda publicada para siempre, debajo de la mentoría.

### Lo que gana

| | Por qué importa aquí |
| :-- | :-- |
| **Una respuesta sirve a muchos** | Es la única de las dos que **escala**: el tutor contesta una vez «¿hace falta saber Excel?» y deja de contestarlo |
| **Quita fricción sin abrir un canal privado** | La duda se resuelve sin que nadie tenga que hablar con nadie |
| **Contenido indexable** | Cada pregunta respondida es texto real en la ficha. Es lo más parecido a marketing gratis que hay en la lista |
| **Presión social sana** | Un tutor que responde rápido y bien lo demuestra en público. Hoy eso solo lo dicen las reseñas, y esas exigen haber comprado |

### Lo que hay que construir — **nada de esto existe**

| Pieza | Qué es | Esfuerzo |
| :-- | :-- | :-- |
| **Migración** | Tabla `product_questions` (pregunta, respuesta, estado, autor, mentoría) + RLS + `grant select` a `anon` (es la parte pública) + dos funciones controladas: preguntar y responder, con sus topes anti-spam | **M** |
| **Ficha pública** | Sección nueva en la página de la mentoría: lista, paginación, formulario (solo con sesión) | **M** |
| **Panel del tutor** | «Preguntas sin responder», con su contador. Sin esto la funcionalidad **no funciona**: nadie contesta lo que no ve | **S/M** |
| **Aviso al tutor** | Tipo de notificación nuevo + plantilla de correo. ⚠️ Barato pero **imprescindible**: hoy el chat **no manda ni un correo** cuando llega un mensaje, solo enciende el punto rojo de la campana | **S** |
| **Moderación** | Cola de admin para ocultar/borrar. **Hoy no existe ninguna**, ni para el chat | **M** |
| **Legales** | Los Términos **ya lo cubren** (§22, contenido de usuarios y moderación): no hay que tocar el documento firmado. Sí conviene una línea en Privacidad, porque hoy publica «los mensajes se borran a los 30 días» y esto **no caduca** | **XS** |

**Total realista: L.** No es una pantalla; es una superficie pública nueva con moderación detrás.

### ⚠️ Lo que hay que mirar de frente antes de elegirla

1. **Es la primera vez que alguien publica texto libre en la web sin haber comprado.** Hoy lo único
   público que escribe un usuario son las **reseñas**, y esas cuelgan de una reserva pagada. Se pasa
   de «solo habla quien compró» a «habla cualquiera con cuenta». Es un cambio de naturaleza, no de
   funcionalidad.
2. **La evasión de plataforma deja de ser privada y pasa a ser publicidad.** Un «escríbeme a mi
   WhatsApp» en un chat privado lo ve una persona; en la ficha lo ven todos, y se queda ahí. El §21
   de los Términos lo prohíbe, pero prohibirlo no lo borra: hace falta quien lo quite.
3. **Datos personales en abierto.** Alguien va a escribir su correo o su teléfono en una pregunta
   pública. Y el §2.1 de los Términos contempla **menores de edad** en la plataforma.
4. **Con poco catálogo, se ve peor que si no estuviera.** Hoy el seed son ~15 mentorías. Un bloque
   «Nadie ha preguntado todavía» repetido quince veces resta, no suma. **Esta opción paga con
   volumen; hoy no lo hay.**
5. **Nombre del alumno.** Hay que decidir si se publica y cómo. 🟢 Dato bueno: ya existe el patrón
   —los testimonios de la home publican **«Jose M.»**, enmascarado, sin abrir la tabla de perfiles.

### 🟢 Variante barata de la misma idea, por si el presupuesto manda

**El tutor escribe él mismo las preguntas frecuentes de su mentoría.** Se queda el 80 % del efecto
—la ficha responde dudas sola, el texto es indexable, no hay que comprar para leerlo— y **desaparece
todo lo caro**: sin moderación, sin spam, sin datos personales de terceros, sin menores publicando.
Es un campo más en el formulario de la mentoría. **Esfuerzo: S.** No es lo mismo que pediste —falta
la parte de «alguien ya preguntó mi duda»— pero es el mismo estante con la décima parte del riesgo.

---

## 21.3 · Opción 2 · Consulta previa **limitada**, que se funde con el chat al comprar

### Cómo se ve

En la ficha del tutor, un botón **«Escribir a este tutor»**. Se abre un hilo privado, limitado: sin
adjuntos y con tope de mensajes. Si la compra se concreta, **no hay nada que unificar**: es el mismo
hilo. El alumno que preguntó el martes y compró el jueves sigue viendo su pregunta arriba del todo.

### ⚠️ Esto no es una propuesta: es lo que ya se construyó

| Lo que pide el enunciado | Lo que ya hace el código |
| :-- | :-- |
| «un inbox especial de consultas antes de comprar» | La bandeja de conversaciones, con su contador de no leídos |
| «sin enviar archivos» | La función de preventa **no acepta adjuntos**. Por diseño, no por olvido: no tiene ni el parámetro |
| «x número de mensajes» | **5 seguidos** sin que el tutor conteste · **20 en total** antes de comprar · **10 hilos nuevos** por alumno y día |
| «si se concreta la compra, se unifica con el chat de la clase» | **Ya es el mismo hilo desde el principio.** No hay fusión que programar porque nunca hubo dos |

### Lo que costaría encenderla otra vez

| Pieza | Qué | Esfuerzo |
| :-- | :-- | :-- |
| **Migración** | Retirar la guarda de MN-06 en las dos funciones de la puerta. Son **dos condiciones**, y el criterio vive en **un solo sitio** (`pair_can_chat`), justo para poder hacer esto sin que dos pantallas digan cosas distintas | **XS** |
| **Ficha del tutor** | Devolver el botón «Escribir a este tutor». El componente **existe en git**: se borró entero en `b786e38` | **XS** |
| **Bandeja** | Que el hilo sin compra vuelva a admitir escritura. La columna que lo decide ya viaja a la pantalla (`can_chat`) | **XS** |
| **Aviso al tutor** | ⚠️ **Lo mismo que en la opción 1, y sigue sin estar:** hoy un mensaje nuevo **no manda correo**. Una consulta que nadie ve es peor que no tener el canal | **S** |

**Total realista: un día.** La parte cara ya se pagó el 17 de agosto.

### ⚠️ Lo que hay que mirar de frente antes de elegirla

1. **Es marcha atrás sobre P-1**, contestada por escrito hace cuatro días. Hay que decirlo con esas
   palabras.
2. **No escala.** El tutor contesta la misma pregunta veinte veces. Es exactamente lo que la opción
   1 viene a resolver.
3. **Carga de trabajo sobre el tutor, sin obligación de responder.** Un tutor que no contesta genera
   peor impresión que un canal que no existe. Y **no hay hoy ningún indicador de tiempo de
   respuesta**.
4. **Soporte gratis e infinito** es justo lo que el §21 de los Términos previene. Por eso M-12 puso
   el tope en 20 mensajes: pasado eso, o se compra o se habla en otra parte.

---

## 21.4 · Cara a cara

| | **1 · Preguntas públicas** | **2 · Consulta previa privada** |
| :-- | :-- | :-- |
| **Quién lo lee** | Todo el mundo, también sin cuenta | Solo los dos |
| **Una respuesta vale para** | Todos los que vengan después | Una persona |
| **Ayuda a que te encuentren** | 🟢 Sí, es texto en la ficha | 🔴 No |
| **Carga sobre el tutor** | Baja y decreciente | Constante |
| **Moderación** | 🔴 Obligatoria, y **hay que construirla** | 🟢 La que ya hay: reportar y bloquear el hilo |
| **Riesgo de datos personales en abierto** | 🔴 Alto | 🟢 Bajo |
| **Riesgo de fuga fuera de la plataforma** | 🔴 Público y permanente | 🟠 Privado, con topes |
| **Cuánto cuesta** | **L** — nada existe | **XS/S** — está hecho y apagado |
| **Cuándo se puede ver funcionando** | Semana | Día |
| **Sirve con el catálogo de hoy** | 🔴 No: necesita volumen | 🟢 Sí, desde la primera visita |
| **Rehace una decisión del cliente** | 🟢 No | ⚠️ Sí (P-1, 20-ago) |

---

## 21.5 · Lo que hace falta que el cliente conteste

**Si elige la 1:**

| # | Pregunta | Por qué bloquea |
| :-- | :-- | :-- |
| **Q-1** | ¿Puede preguntar cualquiera, o hace falta cuenta? | Cambia el diseño entero: sin cuenta hay que resolver el spam con otra cosa (captcha) |
| **Q-2** | ¿La pregunta se publica al instante, o solo cuando el tutor responde? | «Solo al responder» es más caro pero **elimina el 90 % de la moderación**. Es lo que hace MercadoLibre |
| **Q-3** | ¿Se publica el nombre de quien pregunta? | Se recomienda **enmascarado** («Jose M.»), como ya se hace en los testimonios de la home |
| **Q-4** | **¿Quién modera, y en cuánto tiempo?** | Es la pregunta cara y no es de desarrollo: es una persona con una tarea recurrente |
| **Q-5** | ¿El tutor puede ocultar una pregunta de su propia ficha? | Si puede, la sección deja de ser fiable. Si no puede, hay que atender sus quejas |

**Si elige la 2:**

| # | Pregunta | Por qué bloquea |
| :-- | :-- | :-- |
| **Q-6** | ¿Confirma que **rehace P-1** del 20-ago? | Sin esto no se toca nada |
| **Q-7** | ¿Se quedan los topes actuales (5 / 20 / 10 al día) o quiere otros números? | Es un número en una función |
| **Q-8** | ¿La consulta previa **caduca**? Hoy el hilo sin compra se borra a los 30 días, y eso está publicado en Privacidad | Cambiarlo es cambiar una política ya publicada |

**Para las dos:**

| # | Pregunta | Por qué bloquea |
| :-- | :-- | :-- |
| **Q-9** | ¿Se avisa al tutor **por correo** de que tiene una pregunta? | 🔴 Hoy **no se avisa de ningún mensaje de chat**, solo se enciende la campana. Sin esto, las dos opciones se llenan de preguntas sin responder |

---

## 21.6 · Cuatro cosas que valen para cualquiera de las dos

1. ⚠️ **Nada de esto se va a ver en producción por elegirlo.** `main` sigue por detrás de `dev`, y el
   chat de preventa, el cierre de MN-06 y todo lo de agosto **no están desplegados**. El merge va
   antes que este documento.
2. **El aviso al tutor no es un extra, es el requisito.** Un canal de preguntas sin notificación es
   un buzón sin cartero.
3. **Los Términos ya lo cubren** (§22: contenido de usuarios, moderación; §21: evasión). **No hay que
   tocar el documento firmado** para ninguna de las dos.
4. **La moderación no tiene pantalla.** Los reportes de chat se guardan desde el 17-ago y **nadie los
   ve**. La opción 1 lo convierte en urgente; la opción 2 lo deja como está.

---

## 21.7 · Lo que recomienda desarrollo

**La opción 1 es la mejor idea de producto. La opción 2 es la que se puede tener el lunes.**

Y no compiten realmente, porque **resuelven cosas distintas**: la pública responde *la duda genérica*
(«¿esto es para principiantes?»), la privada responde *mi duda* («tengo el examen el día 12, ¿te da
tiempo?»). Ninguna sustituye a la otra del todo.

**El orden que propongo, si hay que elegir uno:**

1. **La opción 2 primero**, si el cliente confirma Q-6. Cuesta un día porque ya está hecha, y tapa el
   agujero desde el primer visitante. Con Q-9 incluido, que es la mitad de su valor.
2. **La opción 1 después**, cuando haya catálogo y visitas que la llenen — o **ya mismo en su
   variante barata** (preguntas frecuentes escritas por el propio tutor), que da el mismo estante sin
   estrenar una superficie pública moderada.

⚠️ **La objeción a la opción 1 no es la idea: es el calendario y el moderador.** Si el cliente
contesta Q-2 con «solo se publica cuando el tutor responde» y pone nombre a quien modera, la opción
1 deja de ser cara en riesgo y pasa a ser solo cara en horas — y entonces es la que yo construiría.

---

## Anexo · Dónde está cada cosa, para quien tenga que ejecutarlo

| Pieza | Fichero |
| :-- | :-- |
| La puerta del chat (MN-06) | `supabase/migrations/20260820180000_mn06_chat_solo_tras_reservar.sql` — el criterio vive en `pair_can_chat`, en un solo sitio |
| El chat de preventa (M-12) | `supabase/migrations/20260817210000_conversaciones_previas.sql` |
| El botón borrado | `src/components/chat/contact-tutor.tsx`, eliminado en `b786e38` (95 líneas) |
| La bandeja | `src/components/chat/` · la columna `can_chat` de `my_conversations()` |
| Ficha pública de la mentoría | `src/app/(public)/products/[id]/page.tsx` (325 líneas) |
| Reportes sin pantalla | tabla `conversation_reports` · `src/components/chat/report-conversation.tsx` |
| Nombre público enmascarado (precedente) | `supabase/migrations/20260723120000_dd01_dd02_home_publico.sql` |
| Contenido público con compra previa (precedente) | `supabase/migrations/20260716130000_ep09_reviews.sql` |
| Avisos y plantillas | `src/lib/notifications.ts` · `src/lib/email-templates.ts` (+ su `.check.ts`) |
| Retención publicada | `src/components/legal/legal-doc.tsx:116` |

---

*Faim Lab · Doc 21 · Consultas de preventa · 24 de agosto de 2026.*
