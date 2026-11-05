/**
 * EY-246 · Texto libre que escribe el usuario (bio del tutor, descripciones):
 * respeta párrafos y viñetas sin editor rico ni HTML.
 *
 * Es ítem solo lo que se marcó como ítem (`-`, `•` o `*`) y el resto es prosa,
 * en el orden en que se escribió. Cada línea sin viñeta es un párrafo: quien
 * pulsó Intro lo hizo a propósito.
 */
export type BloqueTexto =
  | { tipo: "parrafo"; texto: string }
  | { tipo: "lista"; items: string[] };

export function bloquesDeTexto(text: string): BloqueTexto[] {
  const bloques: BloqueTexto[] = [];
  for (const cruda of text.split("\n")) {
    const linea = cruda.trim();
    if (!linea) continue;
    const ultimo = bloques[bloques.length - 1];
    if (/^[-•*]\s*/.test(linea)) {
      const texto = linea.replace(/^[-•*]\s*/, "").trim();
      if (!texto) continue;
      if (ultimo?.tipo === "lista") ultimo.items.push(texto);
      else bloques.push({ tipo: "lista", items: [texto] });
    } else {
      bloques.push({ tipo: "parrafo", texto: linea });
    }
  }
  return bloques;
}

/** Pinta los bloques con viñetas de punto. La clave lleva el índice: dos párrafos iguales no deben compartirla. */
export function TextoLargo({ texto, className }: { texto: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-3 ${className ?? ""}`}>
      {bloquesDeTexto(texto).map((b, i) =>
        b.tipo === "lista" ? (
          <ul key={`b${i}`} className="list-disc space-y-1.5 pl-5">
            {b.items.map((item, j) => (
              <li key={`${j}-${item}`}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={`b${i}`} className="text-pretty">
            {b.texto}
          </p>
        ),
      )}
    </div>
  );
}
