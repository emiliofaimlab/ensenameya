# Graph Report - .  (2026-06-10)

## Corpus Check
- Corpus is ~47,251 words - fits in a single context window. You may not need a graph.

## Summary
- 505 nodes · 679 edges · 56 communities (24 shown, 32 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.8)
- Token cost: 255,686 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Modelo de dominio y roles|Modelo de dominio y roles]]
- [[_COMMUNITY_Reserva, cobro y reembolso|Reserva, cobro y reembolso]]
- [[_COMMUNITY_Dependencias npm (package.json)|Dependencias npm (package.json)]]
- [[_COMMUNITY_Pagos proveedores y decisiones C|Pagos: proveedores y decisiones C]]
- [[_COMMUNITY_Reglas de oro y skills|Reglas de oro y skills]]
- [[_COMMUNITY_Arquitectura Edge Functions e integraciones|Arquitectura: Edge Functions e integraciones]]
- [[_COMMUNITY_Rutas y layout (App Router)|Rutas y layout (App Router)]]
- [[_COMMUNITY_Config shadcn (components.json)|Config shadcn (components.json)]]
- [[_COMMUNITY_Clientes Supabase y tipos|Clientes Supabase y tipos]]
- [[_COMMUNITY_Config TypeScript (tsconfig)|Config TypeScript (tsconfig)]]
- [[_COMMUNITY_Liquidación (payout) y retención|Liquidación (payout) y retención]]
- [[_COMMUNITY_Primitivos UI avatartablalabel|Primitivos UI: avatar/tabla/label]]
- [[_COMMUNITY_Primitivos UI buttonsheetheader|Primitivos UI: button/sheet/header]]
- [[_COMMUNITY_Primitivo UI dropdown menu|Primitivo UI: dropdown menu]]
- [[_COMMUNITY_Primitivos UI badgeinputpage-header|Primitivos UI: badge/input/page-header]]
- [[_COMMUNITY_Providers de layout (themetoasts)|Providers de layout (theme/toasts)]]
- [[_COMMUNITY_Primitivo UI dialog|Primitivo UI: dialog]]
- [[_COMMUNITY_Primitivo UI select|Primitivo UI: select]]
- [[_COMMUNITY_Referidos (Referral Factory)|Referidos (Referral Factory)]]
- [[_COMMUNITY_Primitivo UI alert|Primitivo UI: alert]]
- [[_COMMUNITY_Primitivo UI tabs|Primitivo UI: tabs]]
- [[_COMMUNITY_Permisos settings.json|Permisos settings.json]]
- [[_COMMUNITY_Permisos settings.local.json|Permisos settings.local.json]]
- [[_COMMUNITY_Seguridad RLS|Seguridad RLS]]
- [[_COMMUNITY_Zona horaria (UTC)|Zona horaria (UTC)]]
- [[_COMMUNITY_Sala en vivo (Daily)|Sala en vivo (Daily)]]
- [[_COMMUNITY_Observabilidad (Sentry)|Observabilidad (Sentry)]]
- [[_COMMUNITY_Recordatorios (NTF-11)|Recordatorios (NTF-11)]]
- [[_COMMUNITY_Config ESLint|Config ESLint]]
- [[_COMMUNITY_Config Next.js|Config Next.js]]
- [[_COMMUNITY_Config PostCSS|Config PostCSS]]
- [[_COMMUNITY_Decisión C-06 (invitado)|Decisión C-06 (invitado)]]
- [[_COMMUNITY_Decisión C-07 (tiempo de pago)|Decisión C-07 (tiempo de pago)]]
- [[_COMMUNITY_Decisión C-08 (ventana de sala)|Decisión C-08 (ventana de sala)]]
- [[_COMMUNITY_Épica EP-01 (auth)|Épica EP-01 (auth)]]
- [[_COMMUNITY_Épica EP-02 (onboarding)|Épica EP-02 (onboarding)]]
- [[_COMMUNITY_Épica EP-03 (descubrimiento)|Épica EP-03 (descubrimiento)]]
- [[_COMMUNITY_Épica EP-06 (reserva)|Épica EP-06 (reserva)]]
- [[_COMMUNITY_Épica EP-11 (admin)|Épica EP-11 (admin)]]
- [[_COMMUNITY_Hallazgo H-3|Hallazgo H-3]]
- [[_COMMUNITY_NTF-01 (bienvenida)|NTF-01 (bienvenida)]]
- [[_COMMUNITY_NTF-02 (reset)|NTF-02 (reset)]]
- [[_COMMUNITY_NTF-06 (KYC recibido)|NTF-06 (KYC recibido)]]
- [[_COMMUNITY_NTF-07 (nueva reserva)|NTF-07 (nueva reserva)]]
- [[_COMMUNITY_NTF-08 (inicio de sesión)|NTF-08 (inicio de sesión)]]
- [[_COMMUNITY_NTF-13 (alerta admin)|NTF-13 (alerta admin)]]
- [[_COMMUNITY_NTF-14 (reseña)|NTF-14 (reseña)]]
- [[_COMMUNITY_NTF-15 (pago fallido)|NTF-15 (pago fallido)]]
- [[_COMMUNITY_NTF-16 (payout)|NTF-16 (payout)]]
- [[_COMMUNITY_OAuth (Google)|OAuth (Google)]]
- [[_COMMUNITY_Onboarding|Onboarding]]
- [[_COMMUNITY_RN-03 (duración mínima)|RN-03 (duración mínima)]]
- [[_COMMUNITY_RN-10 (modelos de precio)|RN-10 (modelos de precio)]]
- [[_COMMUNITY_RN-22 (clases grupales fuera)|RN-22 (clases grupales fuera)]]
- [[_COMMUNITY_Hito M2 (catálogo tutor)|Hito M2 (catálogo tutor)]]
- [[_COMMUNITY_Hito M9 (pulido)|Hito M9 (pulido)]]

## God Nodes (most connected - your core abstractions)
1. `cn()` - 90 edges
2. `compilerOptions` - 16 edges
3. `scripts` - 12 edges
4. `DP-03 — política de reembolsos` - 10 edges
5. `Skill /nueva-migracion` - 9 edges
6. `Tutor` - 8 edges
7. `Reserva (booking)` - 8 edges
8. `profiles (tabla)` - 8 edges
9. `M4 — booking_status` - 8 edges
10. `S-15 — escritura financiera solo vía service role/webhooks` - 8 edges

## Surprising Connections (you probably didn't know these)
- `C-02 — Días de retención del payout` --semantically_similar_to--> `DP-02 — periodo de retención de payout (15 vs 30 días)`  [INFERRED] [semantically similar]
  docs/context/APROBACION-CLIENTE-FAIMLAB.md → docs/context/00-glosario-y-modelo-conceptual.md
- `Regla de oro 1 — RLS default-deny` --references--> `RISK-13 — Mala configuración de RLS → fuga`  [EXTRACTED]
  CLAUDE.md → docs/context/09-riesgos-y-decisiones-pendientes.md
- `Edge Function create-booking` --implements--> `Supabase Edge Functions`  [EXTRACTED]
  docs/PLAN-DESARROLLO.md → CLAUDE.md
- `Edge Function create-booking` --implements--> `Regla de oro 7 — Snapshots financieros vía función controlada`  [EXTRACTED]
  docs/PLAN-DESARROLLO.md → CLAUDE.md
- `Skill /nueva-pantalla` --implements--> `Regla de oro 3 — service_role jamás en el cliente`  [EXTRACTED]
  .claude/skills/nueva-pantalla/SKILL.md → CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Orquestación de compra (Reserva→Pago→Sesión→Payout)** — context_02_maquinas_de_estado_m4, context_02_maquinas_de_estado_m6, context_02_maquinas_de_estado_m5, context_02_maquinas_de_estado_m7 [EXTRACTED 1.00]
- **Aprobación de tutor y verificación KYC** — context_02_maquinas_de_estado_m1, context_02_maquinas_de_estado_m2, context_02_maquinas_de_estado_m8, concept_rn_29 [EXTRACTED 1.00]
- **Arquitectura agnóstica de pagos por geografía** — concept_payment_router, concept_payment_provider, concept_corredor, context_01_modelo_de_datos_payment_routing_rules, concept_dp_01 [EXTRACTED 1.00]
- **Capa de pagos agnóstica (ports & adapters)** — concept_payment_provider, concept_payment_router, concept_payment_routing_rules, concept_adapter_stripe, concept_adapter_dlocal, concept_dp_01 [EXTRACTED 0.95]
- **Flujo de cancelación y reembolso (FL-05)** — concept_fl_05, concept_dp_03, concept_dp_08, concept_ntf_09, concept_ntf_10 [EXTRACTED 0.90]
- **Decisiones cliente C-xx ↔ decisiones técnicas DP-xx** — concept_c_01, concept_dp_01, concept_c_03, concept_dp_03, concept_c_13, concept_risk_02 [INFERRED 0.85]
- **Patrón dinero server-side (regla 2/7 → Edge Function + service_role)** — concept_golden_rule_2_money_server_side, concept_golden_rule_7_controlled_functions, concept_create_booking, concept_edge_functions, concept_s_15 [EXTRACTED 0.90]
- **Loop de vibecode: rebanada → migración → pantalla → verificación** — docs_plan_desarrollo_vibecode_loop, skill_nueva_migracion, skill_nueva_pantalla, docs_plan_desarrollo_definition_of_done [EXTRACTED 0.90]
- **Stubs cableados a decisiones reales en M10 (C-01/C-03/C-11)** — docs_plan_desarrollo_m10, concept_payment_provider_stub, concept_email_provider_port, concept_c_01, concept_c_03, concept_c_11 [EXTRACTED 0.85]

## Communities (56 total, 32 thin omitted)

### Community 0 - "Modelo de dominio y roles"
Cohesion: 0.05
Nodes (47): Admin, Alumno, Categoría, Clase grupal (fuera de alcance), Disponibilidad, Documento de verificación (KYC), FL-03 — Flujo del Admin, Modelo de precio (+39 more)

### Community 1 - "Reserva, cobro y reembolso"
Cohesion: 0.06
Nodes (44): C-05 — Política de no-show, Flujo de cobro (charge), Integración de video Daily, DP-03 — política de reembolsos, DP-08 — política de inasistencia (no_show), EP-08 — Sesión en vivo (Daily), FL-01 — Flujo del Alumno, FL-05 — Cancelación y reembolso (+36 more)

### Community 2 - "Dependencias npm (package.json)"
Cohesion: 0.05
Nodes (39): dependencies, class-variance-authority, clsx, lucide-react, next, next-themes, radix-ui, react (+31 more)

### Community 3 - "Pagos: proveedores y decisiones C"
Cohesion: 0.07
Nodes (39): Adaptador Bamboo, Adaptador crypto_usdt (solo payout), Adaptador dLocal, Adaptador MercadoPago, Adaptador Stripe (Connect), Documento de aprobación del cliente (FaimLab), C-01 — Proveedores al lanzamiento (BLOQUEANTE), C-03 — Política de reembolsos (BLOQUEANTE) (+31 more)

### Community 4 - "Reglas de oro y skills"
Cohesion: 0.09
Nodes (31): CLAUDE.md — Manual del proyecto, src/lib/database.types.ts (tipos generados), Tabla de routing de contexto profundo (Docs 0–9), Supabase Edge Functions, Ambientes dev/staging/prod (mismas migraciones), Regla de oro 1 — RLS default-deny, Regla de oro 2 — El dinero es server-side, Regla de oro 3 — service_role jamás en el cliente (+23 more)

### Community 5 - "Arquitectura: Edge Functions e integraciones"
Cohesion: 0.08
Nodes (30): AD-01 — Framework React (default Next.js), AD-02 — Runtime de webhooks/jobs, AD-03 — Librería de estilos/UI (Tailwind), Anexo A — Arquitectura del proyecto, C-11 — Herramienta de email (Mailgun candidato), C-12 — Opt-out de notificaciones, Edge Function create-booking, DP-05 — Herramienta de email (+22 more)

### Community 6 - "Rutas y layout (App Router)"
Cohesion: 0.13
Nodes (12): Container(), Section(), SiteFooter(), SiteHeader(), features, Card(), CardAction(), CardContent() (+4 more)

### Community 7 - "Config shadcn (components.json)"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 8 - "Clientes Supabase y tipos"
Cohesion: 0.13
Nodes (13): CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema, Enums, Json, Tables (+5 more)

### Community 9 - "Config TypeScript (tsconfig)"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 10 - "Liquidación (payout) y retención"
Cohesion: 0.13
Nodes (19): C-02 — Días de retención del payout, C-04 — Payout por pago o por lote, C-15 — Moneda de liquidación y FX, DP-02 — periodo de retención de payout (15 vs 30 días), DP-06 — relación Pago↔Payout (agregación), DP-07 — moneda de liquidación y FX cross-border, EP-10 — Payouts a tutores, FL-02 — Flujo del Tutor (+11 more)

### Community 11 - "Primitivos UI: avatar/tabla/label"
Cohesion: 0.19
Nodes (16): cn(), Avatar(), AvatarBadge(), AvatarFallback(), AvatarGroup(), AvatarGroupCount(), AvatarImage(), Label() (+8 more)

### Community 12 - "Primitivos UI: button/sheet/header"
Cohesion: 0.20
Nodes (11): navLinks, Button(), buttonVariants, Sheet(), SheetContent(), SheetDescription(), SheetFooter(), SheetHeader() (+3 more)

### Community 13 - "Primitivo UI: dropdown menu"
Cohesion: 0.12
Nodes (9): DropdownMenuCheckboxItem(), DropdownMenuContent(), DropdownMenuItem(), DropdownMenuLabel(), DropdownMenuRadioItem(), DropdownMenuSeparator(), DropdownMenuShortcut(), DropdownMenuSubContent() (+1 more)

### Community 14 - "Primitivos UI: badge/input/page-header"
Cohesion: 0.14
Nodes (8): PageHeader(), PageHeaderProps, Badge(), badgeVariants, Input(), Separator(), Skeleton(), Textarea()

### Community 15 - "Providers de layout (theme/toasts)"
Cohesion: 0.18
Nodes (7): geistMono, geistSans, metadata, ThemeProvider(), Toaster(), TooltipContent(), TooltipProvider()

### Community 16 - "Primitivo UI: dialog"
Cohesion: 0.18
Nodes (6): DialogContent(), DialogDescription(), DialogFooter(), DialogHeader(), DialogOverlay(), DialogTitle()

### Community 17 - "Primitivo UI: select"
Cohesion: 0.18
Nodes (8): SelectContent(), SelectGroup(), SelectItem(), SelectLabel(), SelectScrollDownButton(), SelectScrollUpButton(), SelectSeparator(), SelectTrigger()

### Community 18 - "Referidos (Referral Factory)"
Cohesion: 0.38
Nodes (7): C-10 — Reglas del programa de referidos, DP-04 — reglas del programa de referidos (externo), EP-13 — Referidos (integración frontend), FL-04 — Flujo de Referido, Referido (Referral Factory), Referral Factory (referidos frontend), RN-21 — sin lógica interna de referidos (externo)

### Community 19 - "Primitivo UI: alert"
Cohesion: 0.40
Nodes (5): Alert(), AlertAction(), AlertDescription(), AlertTitle(), alertVariants

### Community 20 - "Primitivo UI: tabs"
Cohesion: 0.40
Nodes (5): Tabs(), TabsContent(), TabsList(), tabsListVariants, TabsTrigger()

### Community 21 - "Permisos settings.json"
Cohesion: 0.50
Nodes (3): permissions, allow, deny

### Community 23 - "Seguridad RLS"
Cohesion: 0.67
Nodes (3): RLS (Row Level Security), RN-19 — roles Alumno/Tutor/Admin aplicados vía RLS, Default-deny / mínimo privilegio (RLS)

### Community 24 - "Zona horaria (UTC)"
Cohesion: 0.67
Nodes (3): RN-01 — timezone obligatorio en Usuario, RN-02 — sesiones en UTC, mostradas en hora local, UTC / timezone

## Ambiguous Edges - Review These
- `Paquete (N sesiones 1:1)` → `Clase grupal (fuera de alcance)`  [AMBIGUOUS]
  docs/context/00-glosario-y-modelo-conceptual.md · relation: conceptually_related_to

## Knowledge Gaps
- **198 isolated node(s):** `allow`, `deny`, `allow`, `$schema`, `style` (+193 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **32 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Paquete (N sesiones 1:1)` and `Clase grupal (fuera de alcance)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `cn()` connect `Primitivos UI: avatar/tabla/label` to `Rutas y layout (App Router)`, `Primitivos UI: button/sheet/header`, `Primitivo UI: dropdown menu`, `Primitivos UI: badge/input/page-header`, `Providers de layout (theme/toasts)`, `Primitivo UI: dialog`, `Primitivo UI: select`, `Primitivo UI: alert`, `Primitivo UI: tabs`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `S-15 — escritura financiera solo vía service role/webhooks` connect `Reglas de oro y skills` to `Reserva, cobro y reembolso`, `Liquidación (payout) y retención`, `Pagos: proveedores y decisiones C`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `profiles (tabla)` connect `Modelo de dominio y roles` to `Reserva, cobro y reembolso`, `Liquidación (payout) y retención`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **What connects `allow`, `deny`, `allow` to the rest of the system?**
  _203 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Modelo de dominio y roles` be split into smaller, more focused modules?**
  _Cohesion score 0.05272895467160037 - nodes in this community are weakly interconnected._
- **Should `Reserva, cobro y reembolso` be split into smaller, more focused modules?**
  _Cohesion score 0.05708245243128964 - nodes in this community are weakly interconnected._