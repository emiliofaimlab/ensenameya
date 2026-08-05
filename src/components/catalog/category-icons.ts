import {
  AwardIcon,
  BookOpenIcon,
  BriefcaseIcon,
  CameraIcon,
  ChefHatIcon,
  CodeIcon,
  DumbbellIcon,
  FlaskConicalIcon,
  GamepadIcon,
  GlobeIcon,
  GraduationCapIcon,
  HeartIcon,
  LanguagesIcon,
  LeafIcon,
  MicIcon,
  MusicIcon,
  PaletteIcon,
  PenToolIcon,
  SigmaIcon,
  SparklesIcon,
  StethoscopeIcon,
  TrendingUpIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * Paleta de iconos de categoría. Es **lista blanca y menú a la vez**: el admin
 * elige de aquí al crear la categoría (`/admin/categorias`) y el catálogo
 * público pinta desde aquí.
 *
 * Antes el mapa era `slug → icono` y vivía sólo en el código, sembrado con las
 * 10 categorías iniciales: cualquier categoría nueva creada desde el panel caía
 * al genérico y arreglarlo exigía un despliegue. Ahora la elección es un dato
 * (`categories.icon`, migración `20260805120000`).
 *
 * Que siga siendo lista blanca no es cosmético: la columna es texto libre, y
 * esto garantiza que un valor inesperado no acabe pintando algo que nadie
 * revisó — cae al genérico y ya.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  sigma: SigmaIcon,
  languages: LanguagesIcon,
  code: CodeIcon,
  flask: FlaskConicalIcon,
  music: MusicIcon,
  palette: PaletteIcon,
  briefcase: BriefcaseIcon,
  "graduation-cap": GraduationCapIcon,
  heart: HeartIcon,
  award: AwardIcon,
  book: BookOpenIcon,
  camera: CameraIcon,
  "chef-hat": ChefHatIcon,
  dumbbell: DumbbellIcon,
  gamepad: GamepadIcon,
  globe: GlobeIcon,
  leaf: LeafIcon,
  mic: MicIcon,
  pen: PenToolIcon,
  stethoscope: StethoscopeIcon,
  "trending-up": TrendingUpIcon,
  sparkles: SparklesIcon,
};

/** Las claves, para pintar el selector del admin. */
export const CATEGORY_ICON_KEYS = Object.keys(CATEGORY_ICONS);

/**
 * Icono de una categoría. `SparklesIcon` cubre las que no lo tienen puesto y
 * las que traigan una clave fuera de la paleta.
 */
export function categoryIcon(icon: string | null | undefined): LucideIcon {
  return (icon && CATEGORY_ICONS[icon]) || SparklesIcon;
}
