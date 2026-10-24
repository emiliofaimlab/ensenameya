import { SalaGrupal } from "../../sala-grupal";

export const metadata = { title: "Sala en vivo · Enséñame Ya" };

/** G3 · sala de una fecha grupal; la usa sobre todo el tutor (ver `SalaGrupal`). */
export default async function SalaGrupalPage({
  params,
}: {
  params: Promise<{ groupClassId: string }>;
}) {
  const { groupClassId } = await params;
  return <SalaGrupal groupClassId={groupClassId} />;
}
