import { NextResponse } from "next/server";

import { suggestSearch } from "@/lib/catalog/queries";

/**
 * Sugerencias del buscador global (R24-05). GET `/api/search/suggest?q=…` →
 * `{ tutors, products, categories }` (pocas de cada una). Solo lee catálogo
 * público (tutores aprobados / productos activos), así que sirve con o sin
 * sesión; la RLS ya acota lo visible.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const data = await suggestSearch(q);
  return NextResponse.json(data);
}
