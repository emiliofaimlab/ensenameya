import {
  AwardIcon,
  BriefcaseIcon,
  CodeIcon,
  FlaskConicalIcon,
  GraduationCapIcon,
  HeartIcon,
  LanguagesIcon,
  MusicIcon,
  PaletteIcon,
  SigmaIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

/** Icono por categoría del seed. Lo comparten los chips del home (P01) y el
 *  selector de categoría del hero de P06. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  idiomas: LanguagesIcon,
  matematicas: SigmaIcon,
  programacion: CodeIcon,
  ciencias: FlaskConicalIcon,
  musica: MusicIcon,
  "arte-y-diseno": PaletteIcon,
  negocios: BriefcaseIcon,
  "preparacion-examenes": GraduationCapIcon,
  "vida-y-creatividad": HeartIcon,
  "habilidades-profesionales": AwardIcon,
};

/** `SparklesIcon` cubre las categorías que se añadan después del seed. */
export function categoryIcon(slug: string): LucideIcon {
  return CATEGORY_ICONS[slug] ?? SparklesIcon;
}
