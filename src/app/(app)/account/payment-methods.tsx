"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type Card = { id: string; brand: string | null; last4: string | null };

const selectClasses =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/**
 * US-607 (RN-43) — card-on-file con PSP simulado. Solo marca + últimos 4 (display);
 * el PAN nunca se toca. El token lo emitiría el PSP; aquí es un stub reutilizable.
 */
export function PaymentMethods({ userId, cards }: { userId: string; cards: Card[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState("Visa");
  const [last4, setLast4] = useState("");

  async function addCard(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!/^\d{4}$/.test(last4)) return toast.error("Ingresa los últimos 4 dígitos.");

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("payment_methods").insert({
      profile_id: userId,
      provider: "simulated",
      provider_token: `tok_sim_${crypto.randomUUID()}`, // el PSP real lo devuelve
      brand,
      last4,
    });
    setBusy(false);
    if (error) return toast.error("No se pudo guardar la tarjeta.");
    toast.success("Tarjeta guardada.");
    setLast4("");
    router.refresh();
  }

  async function removeCard(id: string) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("payment_methods").delete().eq("id", id);
    setBusy(false);
    if (error) return toast.error("No se pudo eliminar.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {cards.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-lg border">
          {cards.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>
                {c.brand ?? "Tarjeta"} •••• {c.last4}
              </span>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => removeCard(c.id)}>
                Eliminar
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No tienes tarjetas guardadas.</p>
      )}

      <form onSubmit={addCard} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="brand">Marca</Label>
          <select id="brand" className={selectClasses} value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option>Visa</option>
            <option>Mastercard</option>
            <option>Amex</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="last4">Últimos 4 dígitos</Label>
          <Input id="last4" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} placeholder="4242" />
        </div>
        <Button type="submit" disabled={busy}>Guardar tarjeta</Button>
      </form>
      <p className="text-muted-foreground text-xs">
        Pago simulado — no ingreses datos reales de tarjeta.
      </p>
    </div>
  );
}
