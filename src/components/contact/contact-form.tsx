"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CheckCircle2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * DL-01 · los tres campos que dLocal exige: nombre, correo y mensaje.
 *
 * La validación de verdad está en `POST /api/contacto` y en los `check` de la
 * tabla; lo de aquí solo evita el viaje de ida y vuelta para lo obvio. Cuando
 * el servidor rechaza, se enseña SU mensaje: es el que sabe por qué.
 */
export function ContactForm() {
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);

    const datos = new FormData(e.currentTarget);
    const payload = {
      name: String(datos.get("name") ?? ""),
      email: String(datos.get("email") ?? ""),
      message: String(datos.get("message") ?? ""),
      website: String(datos.get("website") ?? ""),
    };

    try {
      const res = await fetch("/api/contacto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        toast.error(cuerpo.error ?? "No hemos podido enviar tu mensaje.");
        setEnviando(false);
        return;
      }
      setEnviado(true);
    } catch {
      toast.error("No hemos podido conectar. Revisa tu conexión.");
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div className="rounded-2xl border border-border bg-background p-8 text-center">
        <CheckCircle2Icon
          className="mx-auto size-11 text-brand"
          strokeWidth={1.5}
          aria-hidden
        />
        <h2 className="mt-4 text-[20px] font-semibold">Mensaje recibido</h2>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Te responderemos al correo que nos has dejado. Solemos contestar en
          menos de 24 horas en días laborables.
        </p>
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => {
            setEnviado(false);
            setEnviando(false);
          }}
        >
          Escribir otro mensaje
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-border bg-background p-6 sm:p-8"
      noValidate
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="contacto-nombre">Nombre</Label>
          <Input
            id="contacto-nombre"
            name="name"
            autoComplete="name"
            maxLength={120}
            required
            placeholder="Cómo te llamas"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="contacto-email">Correo electrónico</Label>
          <Input
            id="contacto-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            placeholder="tu@correo.com"
          />
        </div>
      </div>

      <div className="mt-5 grid gap-2">
        <Label htmlFor="contacto-mensaje">Mensaje</Label>
        <Textarea
          id="contacto-mensaje"
          name="message"
          rows={6}
          maxLength={5000}
          required
          placeholder="Cuéntanos en qué podemos ayudarte."
        />
      </div>

      {/*
        Honeypot. Invisible para una persona y tentador para un bot, que rellena
        todo lo que encuentra. `tabIndex={-1}` y `aria-hidden` lo sacan también
        del teclado y del lector de pantalla, para que nadie lo rellene sin
        querer; `autoComplete="off"` evita que lo haga el navegador.
        Va con `hidden` de CSS y no con `type="hidden"`: los bots suelen saltarse
        los ocultos por tipo.
      */}
      <div className="hidden" aria-hidden>
        <label htmlFor="contacto-website">No rellenes este campo</label>
        <input
          id="contacto-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <Button type="submit" className="mt-6 w-full sm:w-auto" disabled={enviando}>
        {enviando ? "Enviando…" : "Enviar mensaje"}
      </Button>

      <p className="mt-4 text-[13px] text-muted-foreground">
        Usamos tu correo solo para responderte. Puedes leer cómo tratamos tus
        datos en nuestra{" "}
        <a href="/privacy" className="underline hover:text-brand">
          política de privacidad
        </a>
        .
      </p>
    </form>
  );
}
