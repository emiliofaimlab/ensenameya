// ⚠️ TEMPORAL — BORRAR ESTE ARCHIVO.
// El home definitivo vive en `src/app/(public)/page.tsx` (con su layout: header + footer).
// Mientras tanto, este `page.tsx` root "gana" la ruta "/" en Next, así que reutilizamos
// el shell + home del grupo para que "/" renderice correcto. Al borrar este archivo,
// el grupo `(public)` toma "/" de forma nativa. Pendiente por el permiso de `rm`
// (recargar settings con /hooks o reiniciar). Ver docs/PLAN-DESARROLLO.md (M0).
import PublicLayout from "./(public)/layout";
import HomePage from "./(public)/page";

export default function RootHome() {
  return (
    <PublicLayout>
      <HomePage />
    </PublicLayout>
  );
}
