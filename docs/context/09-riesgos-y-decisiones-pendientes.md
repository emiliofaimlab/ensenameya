# DOC 9 — Riesgos y Decisiones Pendientes

> **Enséñame Ya — MVP Web.** Registro consolidado de decisiones abiertas (DP), riesgos, supuestos a
> confirmar y gobierno de decisiones.
>
> 🔴 **Todo lo de pagos y payouts de este documento está subordinado a `docs/DICTADO-PAGOS.md`**
> (9-sep-2026, aprobado y desplegado en producción). De ahí salen el cierre de DP-01 y el estado de
> RISK-02 y RISK-20.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 9 — Riesgos y Decisiones Pendientes |
| **Proyecto** | Enséñame Ya — MVP Web |
| **Cliente** | Nestor Valderrama |
| **Autor** | Emilio Faim — Faim Lab |
| **Depende de** | Docs 0–8, `docs/DICTADO-PAGOS.md`, `docs/PAGOS-Y-PAYOUTS.md` |
| **Propósito** | Hacer visibles y gestionables los puntos abiertos y los riesgos |

---

## 9.1 Propósito

Consolida en un solo lugar lo que **no está cerrado** y lo que **puede salir mal**, con su impacto,
mitigación y quién debe resolverlo. Cumple el mandato del engagement: *no inventar decisiones*;
documentar opciones e impacto, y diseñar **sin acoplarse** a lo pendiente (regla de oro 8).

---

## 9.2 Registro de decisiones pendientes (DP)

### Estado de un vistazo

| DP | Tema | Estado | Cómo quedó |
| :-- | :-- | :-- | :-- |
| **DP-01** | Proveedores de pago y corredores | ✅ **Cerrada** | El cobro lo decide el país del **alumno** (dLocal donde cobra, Stripe en el resto). El payout, el del **tutor**: PayPal, y detrás de «Banco» compiten Wise → Stripe → dLocal. Manual solo Venezuela. → `docs/DICTADO-PAGOS.md` |
| **DP-02** | Periodo de retención de payout | ✅ **Cerrada** | **7 días**, lote **semanal** (`run-payout-batch`, pg_cron, lunes 03:00). Ni 15 ni 30. |
| **DP-03** | Política de reembolsos | ✅ **Cerrada** | **RN-37**: ≥24 h = 100 %, <24 h por el alumno = 50 %, cancelada por el tutor = 100 %. Vive en `src/lib/policy.ts` y de ahí lo leen las páginas legales. |
| **DP-04** | Reglas del programa de referidos | 🔴 **Abierta** | Y peor que abierta: ver RISK-08. |
| **DP-05** | Herramienta de email | ✅ **Cerrada** | **Resend** (C-11): el único candidato que deja enviar sin dominio verificado. |
| **DP-06** | Relación Pago ↔ Payout | ✅ **Cerrada** | **Por lote**, y la clave de agrupación es (tutor, moneda, `funding_provider`). Un tutor con cobros de dos corredores recibe **dos** órdenes. |
| **DP-07** | Moneda de liquidación y FX | 🟡 **Abierta** | Las columnas existen (`payments.settlement_currency`, `fx_rate`) y hay un `DLOCALGO_FX_SPREAD`; no hay política escrita de quién asume la diferencia. El **coste** lo manda `docs/PAGOS-Y-PAYOUTS.md`. |
| **DP-08** | Política de inasistencia (no-show) | 🔴 **Abierta** | Default operable en pie: no-show del alumno = sin reembolso; del tutor = reembolso de esa sesión. |

### Las que siguen abiertas, con detalle

#### DP-04 — Reglas del programa de referidos (externo)
- **Opciones:** configuración en Referral Factory (monto, conversión válida, límites de payout).
- **Impacto:** EP-13; sin lógica interna (RN-21).
- **Lo que hace que esto no sea solo «configurar»:** la **atribución no existe** (Doc 6 §6.12). Antes
  de decidir reglas hay que decidir si se construye el mecanismo o se acepta que quién trajo a quién
  se queda entero en la plataforma externa.
- **Owner:** Cliente + Faim Lab. **Necesaria antes de:** activar el programa.

#### DP-07 — Moneda de liquidación y FX (cross-border)
- **Opciones:** (a) split en moneda de cobro; (b) en moneda de payout con `fx_rate`; (c) cobrar y
  liquidar en USD.
- **Impacto:** `settlement_currency` / `fx_rate` en `payments`; reportes del tutor.
- **Por qué ahora aprieta más que en junio:** con el cobro ruteado por el país del alumno, un mismo
  tutor recibe cobros de corredores distintos y con monedas distintas. Ya no es un caso de borde.
- **Owner:** Cliente + Faim Lab. **Necesaria antes de:** operar de verdad fuera de un solo corredor.

#### DP-08 — Política de inasistencia (no-show)
- **Opciones:** (a) no-show del alumno = consumido / del tutor = reembolso; (b) ventana de gracia +
  reprogramación; (c) penalizaciones configurables.
- **Impacto:** M5/M4; reembolsos; el contenido de NTF-09/NTF-10.
- **Dato que la condiciona:** el cierre automático de la sesión ocurre en `end_at + 10 min`, y a
  partir de ahí la reserva ya no es cancelable. Existe un hueco de ≤15 min entre el fin de la clase y
  el cierre en el que todavía se puede cancelar al 50 %.
- **Owner:** Cliente. **Necesaria antes de:** operación con tráfico real.

---

## 9.3 Registro de riesgos

> Escala: Probabilidad/Impacto ∈ {Baja, Media, Alta}.

| ID | Riesgo | Prob. | Impacto | Sev. | Estado y mitigación |
| :-- | :-- | :-- | :-- | :-- | :-- |
| RISK-01 | Holds o cierres de cuenta de un proveedor | Media | Alto | **Media** | Mitigado con hechos: cuatro rieles con adaptador escrito y el ruteo en datos. Perder uno no para la plataforma. |
| RISK-02 | Venezuela paga a mano | Media | Medio | **Media** | Venezuela **cobra por Stripe** y **paga por el riel manual** (Zinli · Zelle · Binance). Es el único país del mundo que ninguno de los tres rieles automáticos alcanza, así que no hay alternativa técnica que buscar. El riesgo es **carga operativa**: 14 de los 24 tutores están ahí y cada payout lo cierra una persona desde el panel. |
| RISK-03 | Exposición FX en corredores cross-border | Alta | Medio | **Alta** | Con el cobro ruteado por el país del alumno, el cross-border es el caso normal y no el de borde. Se cierra resolviendo DP-07. |
| RISK-04 | La retención de payout afecta la caja del tutor | Baja | Bajo | **Baja** | **Cerrado por DP-02**: 7 días, y el tutor puede pedir su retiro él mismo (RN-40) sobre saldo con retención vencida. |
| RISK-05 | Sobrecosto de Daily | Media | Medio | **Media** | El gasto es por **minuto-participante**, no por sala abierta: una sala con `exp` lejano y vacía no cuesta. Falta monitorizar minutos y poner alertas. La **grabación** sí está contratada y consume. |
| RISK-06 | Coste por cuenta de Stripe escala con los tutores | Baja | Bajo | **Baja** | No hay cuenta conectada por tutor ni onboarding de Connect: la plataforma crea una cuenta de destinatario solo cuando ese riel va a ejecutar. |
| RISK-07 | Confusión paquetes vs. clases grupales | Baja | Medio | **Baja** | **Cerrado** (D-02): paquete = N sesiones 1:1; grupal fuera (RN-22). |
| RISK-08 | Referidos sin atribución | **Alta** | Medio | **Alta** | 🔴 **La atribución no existe.** La cookie `ey-ref` funciona y espera un `?ref=` que Referral Factory no manda; `profiles.referral_code` se escribe y no lo lee nadie. Antes de las reglas del programa (DP-04) hay que decidir si se construye el mecanismo. |
| RISK-09 | Herramienta de email sin definir | — | — | **Cerrado del todo (10-sep)** | Resend (DP-05), con el **dominio propio verificado** y `EMAIL_FROM` puesto. Ya no queda nada colgando de la migración de dominio, que también se hizo. |
| RISK-10 | El KYC manual se vuelve cuello de botella | Media | Medio | **Media** | Seis documentos (C-14) con cola y estados en el panel; diseñado para automatizar luego (RN-05). |
| RISK-11 | Política de reembolsos sin definir → disputas | Baja | Alto | **Media** | **Cerrado por RN-37**, y el mecanismo está ejercitado con dinero real en *test mode*. Lo que queda abierto es **cuándo se avisa** (Doc 7, NTF-10). |
| RISK-12 | Errores de zona horaria | Media | Alto | **Alta** | La zona horaria no solo pinta fechas: **decide quién cobra** (`pais_de_cobro_por_zona()`). Un alumno de viaje o con VPN rutea por otro corredor — se acepta, y la fila comodín garantiza que pueda comprar igual. Mitigación: UTC en BD, hora local en UI, y el país **congelado** en la reserva. |
| RISK-13 | Mala configuración de RLS → fuga de datos | Baja | Alto | **Media** | Default-deny + matriz de RLS **ejecutada** (`docs/QA-LANZAMIENTO.md`). Y las **vistas** exigen `security_invoker = true`: sin él corren con los privilegios de su dueño y publican lo que las políticas tapaban. |
| RISK-14 | Webhook no idempotente → doble cobro | Baja | Alto | **Media** | Firma verificada sobre cuerpo crudo + idempotencia (RN-34/26). Acreditar un cobro es exclusivo del webhook. |
| RISK-15 | No-show sin política | Media | Medio | **Media** | DP-08 con default operable. |
| RISK-16 | Chargebacks y disputas | Media | Medio | **Media** | Evidencias del proveedor; sin panel de disputas propio. |
| RISK-17 | Protección de datos personales y de KYC | Baja | Alto | **Media** | Bucket privado por Storage API con la sesión del usuario; ruta comprobada (`<uid>/<doc_type>`); retención de chat y grabaciones con purga en pg_cron. |
| RISK-18 | Bus factor: 1 full-stack dev | Media | Alto | **Alta** | Esta documentación y el `CLAUDE.md`. Sigue siendo el riesgo estructural del proyecto. |
| RISK-19 | Demoras de aprobación del cliente | Media | Medio | **Media** | Feedback consolidado por ronda. |
| RISK-20 | Onboarding/KYC del tutor en el proveedor de pago | — | — | **Desaparecido** | No existe alta del tutor **en** un proveedor: teclea sus coordenadas en nuestro formulario y no entra en el flujo de ningún tercero. Es doctrina del dictado, no un estado transitorio. |
| RISK-21 | Complejidad de conciliación multi-proveedor | **Alta** | Medio | **Alta** | Cuatro rieles ejecutando y dos balances de origen. Lo único que concilia hoy es el barrido de `payouts-process` para las órdenes en duda; **el job de conciliación de cobros no existe**. |
| RISK-22 | Redondeo, unidades menores y multi-moneda | Baja | Medio | **Media** | `bigint` en minor units (S-12); el split se congela al crear el pago. |
| **RISK-23** | **Un job de `pg_cron` que falla no se lo dice a nadie** | Media | Alto | **Alta** | No hay build en rojo, ni 500, ni fila en `notifications`: el error se queda en `cron.job_run_details`. Hay **nueve** jobs de pg_cron, y los diarios y el semanal —`run-payout-batch`, que es dinero, y `purge-expired-messages`, que sostiene la retención que prometen los legales— se caen de la ventana si se leen las últimas filas. Mitigación: agregar por `jobname` y `status`, no leer las diez últimas; y comprobar la última corrida **en el ambiente donde importa** después de tocar la función. |
| **RISK-24** | **Un payout rechazado no baja al siguiente riel** | Media | Medio | **Media** | El descenso entre candidatos ocurre **antes** de elegir (`rielSirveParaEsteTutor`). Después, un rechazo del proveedor marca la orden `failed` y ahí se queda hasta que un admin la reintente. Con cuatro rieles complementándose, esto convierte en fallo lo que debería ser un cambio de vía. Referencia: Doc 6 §6.7. |

**Top riesgos hoy:** RISK-03 (FX, que DP-07 debe cerrar), RISK-08 (referidos sin atribución),
RISK-12 (la zona horaria decide el cobro), RISK-21 (conciliación) y RISK-23 (jobs mudos).

---

## 9.4 Supuestos materiales a confirmar

| ID | Supuesto | Estado |
| :-- | :-- | :-- |
| S-04 | Una reserva = un pago (1:1) | Vigente. |
| S-08 | Cambios de split no retroactivos | Vigente y en código: se congela en la reserva. |
| S-15 | Escritura financiera solo `service_role` | Vigente. ⚠️ Y `service_role` **no se salta los `grant`**: tabla que toque un job = grant explícito en su migración. |
| S-21 | Aprobar tutor exige identidad verificada | Vigente. |
| S-24/S-29 | No-show / reembolso previo a liquidar | Ligados a **DP-08**. |
| S-25 | Ventana de checkout | Superado: la autocancelación por pago vencido es de **20 min** (ADENDA §5). |
| S-28 | Checkout **alojado** por el proveedor | 🔴 **Derogado** por el punto 2 del dictado. Los formularios viven dentro del sitio; lo que sobrevive es que no guardamos datos de tarjeta, porque los campos siguen en iframes del proveedor. |
| S-35 | Sin checkout como invitado | 🔴 **Derogado.** Existe: la cuenta se crea **dentro** del pago (`src/app/api/checkout/invitado/route.ts`). ⚠️ Y la asimetría sigue importando justo aquí: la confirmación de correo está **encendida en prod y apagada en dev**, así que este flujo se comporta distinto en cada ambiente. |
| S-45 | Ventana de sala ≈ 10 / 10 min | ✅ **Confirmado en código.** Ojo: son **dos** funciones distintas, la de acceso a la sala y la de contabilidad de la clase. |
| S-49 | Opt-out de no esenciales | Sin construir. |

---

## 9.5 Divergencias con la propuesta firmada (estado)

| ID | Tema | Estado |
| :-- | :-- | :-- |
| D-01 | Pagos: Stripe único → multi-proveedor | ✅ **Cerrado**: cuatro rieles, ruteo en datos, y quién cobra lo decide el país del alumno. |
| D-02 | Paquetes vs. clases grupales | ✅ **Confirmado**: paquete = N sesiones 1:1; grupal fuera (RN-22). |
| D-03 | Referidos: lógica interna → integración externa | ✅ **Confirmado** en el diseño (RN-21), pero la **atribución no existe** → RISK-08. |
| D-04 | Comisión única → Tutor Tiers | Enriquecimiento (RN-06/07). |
| D-05 | Email: SendGrid → herramienta tras interfaz | ✅ **Cerrado**: el puerto se mantuvo y detrás quedó **Resend**. |

---

## 9.6 Gobierno de decisiones y control de cambios

- **Cómo se resuelve una DP:** propuesta de opciones → decisión del owner → se registra como regla o
  **configuración** → se actualiza el doc afectado. La resolución de una DP no debería requerir
  rediseño (regla de oro 8).
- ⚠️ **«Configuración» no significa `UPDATE` a mano.** Cuando la configuración vive en una tabla que
  gobierna dinero —`payment_routing_rules`, `payout_country_rules`— cambiarla es una **migración**
  (regla de oro 5): dev y producción llegaron a rutear distinto por tocarlas a mano.
- **Control de cambios:** todo lo fuera del alcance contratado es cambio de alcance → estimación de
  impacto y aprobación escrita antes de ejecutar.
- **Bitácora:** el estado de ejecución vive en `docs/PLAN-DESARROLLO.md`.

---

## 9.7 Recomendaciones de cierre

1. **Cerrar DP-07 (FX).** Es la única DP de dinero que sigue abierta y con el ruteo nuevo aplica a
   casi toda reserva cross-border.
2. **Decidir DP-04 sabiendo que la atribución no existe**: construirla, o aceptar que el programa
   vive entero en Referral Factory.
3. **Escribir el descenso de riel tras un rechazo** (RISK-24) antes de que haya volumen de payouts.
4. **Poner ojos en los `pg_cron`** (RISK-23): una consulta agregada por `jobname` y `status`, no las
   diez últimas filas.
5. **Cablear NTF-08/NTF-11/NTF-13/NTF-17**, que son los avisos que hoy no existen y que sostienen
   promesas del producto (las 24 h de aceptación, el recordatorio de clase).
6. **Cerrar DP-08** antes de tener tráfico real, y con ella el hueco de cancelación de ≤15 min.

---

## 9.8 Nota sobre diagramas

Una **matriz de calor de riesgos** (probabilidad × impacto) se agrega en la pasada final. El `.md` es
la fuente.

---

## 9.9 Hallazgos de esquema todavía abiertos

> Vienen de la revisión de los Docs 1–3. Solo queda uno sin cerrar.

### H-5 · `availability_exceptions` es mutable en los permisos e inmutable en el uso

- **Qué pasa:** la tabla tiene `created_at` y **no tiene `updated_at`**, contra la convención de
  auditoría del Doc 1 §1.2 («toda tabla mutable lleva `updated_at`»). Y sin embargo declara la
  política `availability_exceptions_update_own` y concede `update` a `authenticated`.
- **Y la pantalla ya la trata como inmutable:** `exceptions-manager.tsx` solo hace `insert` y
  `delete`. Nadie ejerce la `U`.
- **Las dos salidas, y hay que elegir una:**
  1. **Declararlas inmutables** —editar es borrar y crear— y retirar la política y el `grant` de
     `update`. Es lo que el producto hace hoy, y deja el permiso alineado con la realidad.
  2. **Añadir `updated_at`** con su trigger `set_updated_at()`, como tienen `availability_rules` y el
     resto de tablas mutables, si se va a permitir editar de verdad.
- **Por qué sigue importando aunque nadie edite:** un permiso concedido y sin usar es una superficie
  que la próxima pantalla puede estrenar sin darse cuenta, y ese día la fila cambia sin dejar rastro.
- **Owner:** Faim Lab. **Coste:** una migración pequeña en cualquiera de las dos direcciones.

---

*Fin del Documento 9.*
