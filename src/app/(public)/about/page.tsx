import Image from "next/image";
import {
  ArrowUpRightIcon,
  ClockIcon,
  ShieldCheckIcon,
  StarIcon,
  TargetIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { FeatureSplit } from "@/components/home/feature-split";
import { TrustCards } from "@/components/home/trust";
import { FAQ_SOBRE_NOSOTROS, HomeFaq } from "@/components/home/home-faq";
import { Testimonials } from "@/components/home/testimonials";
import { FinalCta } from "@/components/home/final-cta";
import { compactCount } from "@/lib/catalog/format";
import { getHomeStats, listTestimonials } from "@/lib/catalog/queries";

export const metadata = {
  title: "Sobre nosotros · Enséñame Ya",
  description:
    "Conectamos a quien quiere aprender con quien sabe enseñar: mentorías 1:1 en vivo, con tutores verificados y enfoque en el resultado.",
};

/** Las 4 tarjetas de "En qué creemos". Las fotos salen del propio Figma; el
 *  badge circular alterna naranja y azul, como en el diseño. */
const VALUES = [
  {
    img: "/img/valor-resultados.jpg",
    title: "Resultados validados",
    text: "Evaluamos el éxito por tus metas cumplidas y por las nuevas habilidades que logras dominar.",
  },
  {
    img: "/img/valor-talento.jpg",
    title: "Talento garantizado",
    text: "Validamos manualmente a cada tutor para asegurar su experiencia y energía propia antes de su primera sesión.",
  },
  {
    img: "/img/valor-transparencia.jpg",
    title: "Transparencia total",
    text: "Cuentas claras y honestidad absoluta. Pagas exactamente por el resultado que decides aprender.",
  },
  {
    img: "/img/home-teach.jpg",
    title: "Conocimiento sin fronteras",
    text: "Acercamos el aprendizaje de primer nivel a cada rincón de la comunidad hispanohablante.",
  },
];

export default async function AboutPage() {
  const [stats, testimonials] = await Promise.all([
    getHomeStats(),
    listTestimonials(),
  ]);

  return (
    <>
      {/* Hero de P02 (386:404, 1280×846): degradado azul, ola clara y la alumna
          recortada por el borde inferior. */}
      <section className="relative isolate overflow-hidden bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white lg:h-[846px]">
        {/* Capa decorativa anclada a la rejilla de 1280 del Figma, igual que en
            P03. La ola NO es del ancho del hero: mide 1712 y arranca 113px por
            fuera del borde izquierdo (386:405), así que estirarla a 1280 le
            cambiaba la curva. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 mx-auto hidden max-w-[1280px] lg:block"
        >
          <Image
            src="/img/about-wave.svg"
            alt=""
            width={1672}
            height={525}
            className="absolute top-[359px] -left-[113px] w-[1712px] max-w-none"
          />
        </div>

        <Container className="flex flex-col items-center pt-16 text-center lg:pt-[76px]">
          {/* "Conectamos" va en Poppins Light Italic, como "talento" en P01.
              Interlineado 60 sobre 64 (386:407): más apretado que el normal. */}
          <h1 className="max-w-[842px] text-3xl font-semibold text-balance sm:text-[64px] sm:leading-[0.94]">
            <em className="font-light">Conectamos</em> a quien quiere aprender
            con quien sabe enseñar
          </h1>
          <p className="mt-[30px] max-w-[700px] text-pretty text-[17px] leading-6 font-medium text-white/90">
            Enséñame Ya nació para garantizar que dominar un nuevo idioma,
            materia o habilidad sea una experiencia emocionante y efectiva.
            Aprende de forma práctica de la mano de expertos que potencian tu
            talento.
          </p>
        </Container>

        {/* 386:406 — 651×816 a x=339 del borde izquierdo de la rejilla: NO va
            centrada, cae 24px a la derecha del eje. El borde inferior del hero
            la recorta, que es para lo que el hero tiene alto fijo. */}
        <div className="pointer-events-none mx-auto max-w-[1280px] lg:absolute lg:inset-0">
          <Image
            src="/img/about-hero-alumna.png"
            alt=""
            width={651}
            height={816}
            priority
            className="mx-auto mt-2 h-auto w-[420px] max-w-full lg:absolute lg:top-[268px] lg:left-[339px] lg:mx-0 lg:mt-0 lg:w-[651px] lg:max-w-none"
          />
        </div>
      </section>

      <TrustCards title="Reserva con tranquilidad garantizada" />

      <FeatureSplit
        title="Transformamos la forma de aprender para llevarte al siguiente nivel"
        text="Diseñamos un espacio dinámico, moderno e interactivo donde avanzas con paso firme de la mano de un tutor enfocado exclusivamente en tu éxito."
        points={[
          {
            icon: UserIcon,
            text: "Mentoría 1 a 1",
            desc: "Mentorías totalmente personalizadas y adaptadas a tu propio ritmo de aprendizaje.",
          },
          {
            icon: TargetIcon,
            text: "Avanza con agilidad",
            desc: "Ve directo hacia la meta elegida mediante explicaciones prácticas y dinámicas.",
          },
          {
            icon: ClockIcon,
            text: "Control de tu agenda",
            desc: "Tú decides cuándo y con quién conectarte con total libertad y flexibilidad.",
          },
        ]}
        cta={{ href: "/tutors", label: "Explorar mentorías", variant: "outline" }}
        image={{
          src: "/img/about-mission.jpg",
          alt: "Alumna tomando una mentoría en vivo",
        }}
        badge={
          stats
            ? {
                value: compactCount(stats.sessions),
                label: "mentorías impartidas",
                position: "bottom-left",
              }
            : undefined
        }
      />

      <FeatureSplit
        reverse
        title="Enfocados en tus logros y en el valor de tus resultados"
        text="Tu tutor diseña una ruta con objetivos claros para que cada sesión sea un paso certero hacia el éxito que planificaron."
        points={[
          {
            icon: TargetIcon,
            text: "Resultados asegurados",
            desc: "Cada mentoría detalla con precisión la meta real que vas a conquistar.",
          },
          {
            icon: ShieldCheckIcon,
            text: "Filtro de confianza",
            desc: "Colaboramos únicamente con profesionales calificados y aprobados por nuestro equipo.",
          },
          {
            icon: WalletIcon,
            text: "Tu inversión protegida",
            desc: "Gestión de cobros y payouts con total claridad, transparencia y seguridad.",
          },
        ]}
        cta={{ href: "/how-it-works", label: "Conoce cómo funciona" }}
        image={{
          src: "/img/about-outcome.jpg",
          alt: "Tutor explicando durante una sesión 1 a 1",
        }}
        badge={
          stats?.ratingAvg
            ? {
                value: `${stats.ratingAvg} / 5`,
                label: "valoración media",
                icon: StarIcon,
                position: "top-right",
              }
            : undefined
        }
        tone="soft"
      />

      <Container>
        <Section>
          <h2 className="text-center text-[28px] font-bold">En qué creemos</h2>
          <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map(({ img, title, text }, i) => (
              <li
                key={title}
                className="overflow-hidden rounded-[22px] border border-[#e6e6e6] bg-muted"
              >
                <Image
                  src={img}
                  alt=""
                  width={546}
                  height={380}
                  className="aspect-[273/190] w-full object-cover"
                />
                <div className="p-6 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[15px] font-bold">{title}</h3>
                    {/* Badge de flecha: alterna naranja y azul (386:531/542/553/564). */}
                    <span
                      className={`grid size-[38px] shrink-0 place-items-center rounded-full text-white ${
                        i % 2 === 0 ? "bg-primary" : "bg-brand"
                      }`}
                    >
                      <ArrowUpRightIcon className="size-4" />
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    {text}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </Container>

      <Testimonials items={testimonials} />
      <HomeFaq items={FAQ_SOBRE_NOSOTROS} />
      <FinalCta text="Crea tu cuenta gratis en segundos y asegura tu primera meta, o conviértete en tutor y empieza a facturar con orgullo por lo que sabes." />
    </>
  );
}
