#!/usr/bin/env node
/**
 * Límite de texto de los subagentes. ÚNICO sitio donde viven las reglas:
 * lo ejecuta el hook `SubagentStop` de `.claude/settings.json` y lo prueba
 * `npm run check:agentes`. Cambiar el límite = cambiar este fichero.
 *
 * Exit 2 + stderr = Claude Code rechaza el informe y el agente lo reescribe.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MAX_PALABRAS = 200;

/** Relleno que no aporta nada. Se compara en minúsculas. */
export const RELLENO = [
  "¡claro", "por supuesto", "espero que esto", "espero que te", "en resumen",
  "cabe destacar", "es importante mencionar", "no dudes en", "como se mencionó",
  "great question", "i hope this helps", "certainly!", "let me know if",
];

/** Devuelve la lista de faltas; vacía = pasa. El código (```) no cuenta. */
export function revisar(texto) {
  const prosa = String(texto ?? "").replace(/```[\s\S]*?```/g, " ");
  const palabras = prosa.split(/\s+/).filter(Boolean).length;
  const bajo = prosa.toLowerCase();
  const faltas = [];
  if (palabras > MAX_PALABRAS) faltas.push(`${palabras} palabras (máximo ${MAX_PALABRAS})`);
  for (const f of RELLENO) if (bajo.includes(f)) faltas.push(`relleno: «${f}»`);
  return faltas;
}

/** Último texto del asistente en un transcript JSONL de Claude Code. */
function ultimoTexto(ruta) {
  const lineas = readFileSync(ruta, "utf8").trim().split("\n").reverse();
  for (const l of lineas) {
    try {
      const m = JSON.parse(l).message;
      if (m?.role !== "assistant") continue;
      const t = typeof m.content === "string"
        ? m.content
        : m.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n");
      if (t) return t;
    } catch {}
  }
  return "";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entrada = JSON.parse(readFileSync(0, "utf8") || "{}");
  // ponytail: un solo rechazo por informe; al segundo intento pasa para no
  // dejar al agente en bucle. Si hace falta más dureza, contar intentos aquí.
  if (entrada.stop_hook_active) process.exit(0);
  const ruta = entrada.agent_transcript_path ?? entrada.transcript_path;
  const texto = entrada.last_assistant_message ?? (ruta ? ultimoTexto(ruta) : "");
  const faltas = revisar(texto);
  if (faltas.length) {
    process.stderr.write(
      `Informe rechazado: ${faltas.join("; ")}. Reescríbelo: hechos, rutas file:línea y decisiones; sin introducción, sin cierre, sin repetir la pregunta.\n`,
    );
    process.exit(2);
  }
}
