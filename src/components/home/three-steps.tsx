import Image from "next/image";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

const STEPS = [
  {
    n: "01",
    title: "Elige tu meta",
    text: "Cuéntanos qué quieres lograr. Encuentra tutorías diseñadas específicamente para alcanzar un objetivo real.",
    img: "/img/step-1.png",
  },
  {
    n: "02",
    title: "Asegura tu espacio",
    text: "Elige tu horario favorito y reserva en un checkout protegido, con la tranquilidad de que tu inversión está respaldada.",
    img: "/img/step-2.png",
  },
  {
    n: "03",
    title: "Alcanza el éxito",
    text: "Conéctate a tu videollamada privada, evoluciona a tu propio ritmo y califica tu experiencia.",
    img: "/img/step-3.png",
  },
];

export function ThreeSteps() {
  return (
    <Container>
      <Section>
        <div className="rounded-[17px] bg-primary px-6 py-10 sm:px-10">
          <h2 className="text-center text-[26px] font-semibold text-primary-foreground">
            Tu resultado asegurado en 3 simples pasos
          </h2>

          <ol className="mt-8 grid gap-6 lg:grid-cols-3">
            {STEPS.map((s) => (
              <li
                key={s.n}
                className="rounded-[17px] bg-card p-6 shadow-card"
              >
                <p className="text-2xl font-bold text-brand">{s.n}</p>
                {/* Imagen del paso (303×166 en el Figma), exportada del propio archivo. */}
                <Image
                  src={s.img}
                  alt=""
                  width={606}
                  height={332}
                  className="mt-3 aspect-[303/166] w-full rounded-[10px] object-cover"
                />
                <h3 className="mt-3 text-2xl font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </Section>
    </Container>
  );
}
