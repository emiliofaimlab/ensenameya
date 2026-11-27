"use client";

import type { ComponentProps } from "react";

import { pedirAbrirHilo } from "@/components/chat/open-thread";
import { Button } from "@/components/ui/button";

/**
 * «Abrir chat» desde una página de servidor: abre el hilo en la burbuja.
 * Sustituye a los `<a href="/chat/…">` desde que esa pantalla no existe (27-nov).
 */
export function AbrirChatButton({
  conversationId,
  ...props
}: { conversationId: string } & Omit<ComponentProps<typeof Button>, "onClick" | "asChild">) {
  return <Button type="button" {...props} onClick={() => pedirAbrirHilo({ conversationId })} />;
}
