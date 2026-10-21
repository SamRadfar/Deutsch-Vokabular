import { Bot, Dumbbell, Folder, GraduationCap, HardHat, HeartPulse, Landmark, Star, Thermometer, type LucideIcon } from 'lucide-react';

/** Line icon per category (UI only; replaces the emoji prefix of the content labels). */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  arch: Landmark,
  acad: GraduationCap,
  bautechnik: HardHat,
  bauphysik: Thermometer,
  fitness: Dumbbell,
  anatomie: HeartPulse,
  dreame: Bot,
  mine: Star,
};

/** Own categories ("uc_…") share one folder icon. */
export const categoryIcon = (key: string): LucideIcon | undefined => CATEGORY_ICONS[key] ?? (key.startsWith('uc_') ? Folder : undefined);
