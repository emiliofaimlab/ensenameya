import { requireAcademiaPropia } from "@/lib/auth/academia";

export const metadata = { title: "Mi academia · Enséñame Ya" };

/**
 * Panel de la academia (A2/A3). Hoy solo la puerta: las pantallas se cuelgan
 * de esta carpeta y leen `src/app/(app)/academia/CLAUDE.md` antes de empezar.
 */
export default async function AcademiaPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string }>;
}) {
  const { a } = await searchParams;
  const { academia, verComo } = await requireAcademiaPropia(a);
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      {verComo ? (
        <p className="mb-4 rounded-lg bg-[#e5f2ff] px-3 py-2 text-[13px] text-[#405980]">
          Estás viendo el portal como el equipo de Enséñame Ya.
        </p>
      ) : null}
      <h1 className="text-2xl font-semibold">{academia.name}</h1>
    </main>
  );
}
