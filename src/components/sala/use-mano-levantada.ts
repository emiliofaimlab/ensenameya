"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { CanalSala } from "./canal-sala";

/**
 * EY-221 · Levantar la mano, sincronizado por el canal de la sala.
 *
 * `mia` es la propia; `delOtro`, la del otro participante. Al subir la del otro
 * suena un aviso corto y sale un toast (además del indicador sobre el vídeo y
 * en la ventana flotante, que es lo que se ve en pantalla completa: el toast
 * vive fuera del contenedor y ahí no aparece).
 *
 * En el 1:1 cualquiera de los dos puede bajar la mano del otro (el tutor que ya
 * atendió la pregunta): se le pide con `mano-bajar` y el dueño la baja y lo
 * anuncia, así el estado siempre lo emite quien lo tiene.
 *
 * B8 · En una grupal (`grupal`) eso no servía: con diez alumnos, cada uno leía
 * «El tutor levantó la mano» cuando la levantaba un compañero, con un «Bajar»
 * que bajaba la de otro, y la tutora leía «Un alumno…» sin saber quién. Ahora:
 *  · el ALUMNO solo ve la suya: ignora las manos ajenas y solo baja la propia
 *    con un `mano-bajar` que traiga su id (`a`);
 *  · la TUTORA lleva una `cola` por orden de llegada, con el remitente que da
 *    Daily (`fromId`), y baja cada mano con `bajar(id)`. `delOtro` no se usa.
 */
type ManoGrupal = {
  soyTutor: boolean;
  /** Mi `session_id` de Daily: el que debe traer un `mano-bajar` para mí. */
  miId: string | null;
  nombreDe: (id: string) => string;
  /** Los `session_id` de Daily que siguen en la sala. */
  presentes: string[];
};

export function useManoLevantada({
  canal,
  nombreOtro,
  otroPresente,
  grupal,
}: {
  canal: CanalSala | null;
  /** «El alumno» / «El tutor», para el aviso. */
  nombreOtro: string;
  /** Si el otro se va de la sala, su mano deja de estar levantada. */
  otroPresente: boolean;
  /** B8 · solo en la sala grupal; sin él, el 1:1 de siempre. */
  grupal?: ManoGrupal;
}) {
  const [mia, setMia] = useState(false);
  const [delOtro, setDelOtro] = useState(false);
  /** B8 · ids de Daily con la mano arriba, por orden de llegada (tutora). */
  const [cola, setCola] = useState<string[]>([]);
  const miaRef = useRef(false);
  const delOtroRef = useRef(false);
  const colaRef = useRef<string[]>([]);
  // El oyente del canal no se re-suscribe en cada render: lee lo grupal de aquí.
  const grupalRef = useRef(grupal);
  useEffect(() => {
    grupalRef.current = grupal;
  });

  const fijarMia = useCallback(
    (arriba: boolean) => {
      miaRef.current = arriba;
      setMia(arriba);
      canal?.enviar({ k: "mano", arriba });
    },
    [canal],
  );

  useEffect(() => {
    if (!canal) return;
    const quitar = canal.escuchar((m, de) => {
      const g = grupalRef.current;
      if (m.k === "sync-request") {
        if (miaRef.current) canal.enviar({ k: "mano", arriba: true });
      } else if (m.k === "mano") {
        if (g) {
          // B8 · el alumno no ve las manos de sus compañeros.
          if (!g.soyTutor) return;
          const esta = colaRef.current.includes(de);
          if (m.arriba && !esta) {
            sonarAviso();
            toast(`${g.nombreDe(de)} levantó la mano`, { id: `sala-mano-${de}`, icon: "✋" });
            colaRef.current = [...colaRef.current, de];
            setCola(colaRef.current);
          } else if (!m.arriba && esta) {
            colaRef.current = colaRef.current.filter((id) => id !== de);
            setCola(colaRef.current);
          }
          return;
        }
        // El aviso sale FUERA del `setState`: un efecto dentro del updater
        // sonaría dos veces en desarrollo (StrictMode lo ejecuta doble).
        if (m.arriba && !delOtroRef.current) {
          sonarAviso();
          toast(`${nombreOtro} levantó la mano`, { id: "sala-mano", icon: "✋" });
        }
        delOtroRef.current = m.arriba;
        setDelOtro(m.arriba);
      } else if (m.k === "mano-bajar") {
        // B8 · en grupal solo vale el que trae MI id: la tutora baja una mano
        // concreta y el mensaje les llega a todos.
        if (g && m.a !== g.miId) return;
        miaRef.current = false;
        setMia(false);
        canal.enviar({ k: "mano", arriba: false });
      }
    });
    // El `sync-request` NO se manda aquí: lo manda una vez la sala, cuando ya
    // están escuchando todos sus hooks (ver `live-room.tsx`).
    return quitar;
  }, [canal, nombreOtro]);

  // Se fue de la sala con la mano arriba: no la dejamos colgando. Es un
  // ajuste DERIVADO de una prop (no hay evento que escuchar aquí), así que se
  // hace en render, que es lo que recomienda React para esto.
  const [presenteAntes, setPresenteAntes] = useState(otroPresente);
  if (presenteAntes !== otroPresente) {
    setPresenteAntes(otroPresente);
    if (!otroPresente && delOtro) setDelOtro(false);
  }
  // B8 · lo mismo para la cola de la tutora: quien se fue sale de ella. Con
  // la lista vacía (sala simulada, sin Daily) no hay a quién mirar y no se poda.
  const presentesClave = grupal?.presentes.join(",") ?? "";
  const [presentesAntes, setPresentesAntes] = useState(presentesClave);
  if (presentesAntes !== presentesClave) {
    setPresentesAntes(presentesClave);
    if (grupal && grupal.presentes.length > 0) {
      const siguen = cola.filter((id) => grupal.presentes.includes(id));
      if (siguen.length !== cola.length) setCola(siguen);
    }
  }

  // Espejos para el oyente del canal (que no se re-suscribe en cada cambio).
  useEffect(() => {
    delOtroRef.current = delOtro;
  }, [delOtro]);
  useEffect(() => {
    colaRef.current = cola;
  }, [cola]);

  const alternar = useCallback(() => fijarMia(!miaRef.current), [fijarMia]);
  const bajarLaDelOtro = useCallback(() => {
    setDelOtro(false);
    canal?.enviar({ k: "mano-bajar" });
  }, [canal]);
  /** B8 · la tutora baja la mano de UN alumno: sale de la cola y se le pide a él. */
  const bajar = useCallback(
    (id: string) => {
      colaRef.current = colaRef.current.filter((x) => x !== id);
      setCola(colaRef.current);
      canal?.enviar({ k: "mano-bajar", a: id });
    },
    [canal],
  );

  // El nombre se resuelve al pintar, no al llegar la mano: si el mensaje se
  // adelanta a la lista de participantes, se corrige solo en el siguiente render.
  const colaConNombre = grupal
    ? cola.map((id) => ({ id, nombre: grupal.nombreDe(id) }))
    : [];

  return { mia, delOtro, alternar, bajarLaDelOtro, cola: colaConNombre, bajar };
}

/**
 * Dos tonos cortos con WebAudio: sin fichero que servir ni que cargar. Si el
 * navegador no deja (sin gesto previo), se calla y queda el aviso visual.
 */
let ctx: AudioContext | null = null;
function sonarAviso() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      const t = t0 + i * 0.14;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.14);
    });
  } catch {
    /* sin audio: queda el indicador */
  }
}
