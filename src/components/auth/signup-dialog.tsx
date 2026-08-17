"use client";

import { useState } from "react";
import Link from "next/link";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SignupForm } from "@/components/auth/signup-form";
import { hrefLogin, type SignupIntent } from "@/components/auth/auth-links";

/**
 * M-05 · El alta como MÓDULO sobre la página, no como pantalla aparte.
 *
 * Lo pidieron las dos reuniones por separado con la misma frase: "las otras
 * plataformas cuando van a registrar no te sacan de la página en la que estás
 * […] regístrate y seguimos". Quien pulsa "Crear cuenta" desde el pie de la
 * portada estaba leyendo la portada; devolverle a la portada después de un
 * viaje de ida y vuelta a `/signup` es perder el hilo por el camino.
 *
 * ⚠️ `/signup` SIGUE EXISTIENDO como ruta y comparte el mismo `SignupForm`:
 * hay enlaces externos, correos de confirmación y `?next=` que apuntan ahí. El
 * modal es el camino principal, no el único.
 */
export function SignupDialog({
  children,
  intent,
  titulo = "Crea tu cuenta",
  descripcion = "Aprende en vivo 1 a 1 con tutores verificados",
}: {
  /** El disparador (un `<Button>`); se clona con `asChild`. */
  children: React.ReactNode;
  /** Con qué venía: "Quiero enseñar" abre el alta ya en el lado de tutor. */
  intent?: SignupIntent;
  titulo?: string;
  descripcion?: string;
}) {
  const [open, setOpen] = useState(false);
  // Dónde estaba el visitante al abrir, para volver aquí tras el onboarding
  // (US-201 sigue siendo obligatorio; lo que se conserva es el "y seguimos").
  const [next, setNext] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(abierto) => {
        // Se lee al ABRIR y no al montar: en una página con varios disparadores
        // el componente se monta una vez y la URL puede haber cambiado por medio
        // (navegación de cliente). Y leer `window` en el render rompería el SSR.
        if (abierto) setNext(rutaActual());
        setOpen(abierto);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      {/*
        El diálogo por defecto mide `sm:max-w-sm` y trae padding 4: son medidas
        de confirmación, no de formulario. Aquí se iguala a la card de AU02
        (440 de ancho). El `overflow-y-auto` es por el móvil: con el teclado
        abierto el alto útil se queda en nada y sin scroll propio el botón de
        "Crear cuenta" queda fuera de alcance.
      */}
      <DialogContent className="max-h-[90svh] gap-0 overflow-y-auto p-6 sm:max-w-[440px] sm:p-8">
        <DialogHeader className="text-center">
          <DialogTitle className="text-[26px] font-bold tracking-tight">
            {titulo}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {descripcion}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6">
          <SignupForm
            next={next}
            // En el modal no hay página de servidor que haya leído la cookie de
            // referido: la resuelve el propio formulario al enviar.
            referralCode={null}
            intentInicial={intent ?? "alumno"}
            enModal
            onDone={() => setOpen(false)}
          />
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          ¿Ya tienes cuenta?{" "}
          <Link
            href={hrefLogin(next)}
            className="font-semibold text-brand hover:underline"
          >
            Inicia sesión
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Ruta + query actuales, para el `?next=`. Nunca el host.
 *
 * ⚠️ Se descarta el `//` inicial: `https://sitio.com//loquesea` da un
 * `pathname` que empieza por `//`, y eso reinyectado en un `?next=` es la forma
 * canónica de colar un open-redirect (`safeNext` lo rechaza justo por eso).
 * Mejor no generarlo que confiar en que todo el mundo lo filtre después.
 */
function rutaActual(): string | null {
  if (typeof window === "undefined") return null;
  const { pathname, search } = window.location;
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return null;
  return `${pathname}${search}`;
}
