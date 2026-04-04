import { isDigitalJourneyUnitSlug, units, type Unit } from "@/data/units";

export function normalizeUnitSlug(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function resolveUnitFromSlug(param: string | null | undefined): Unit | null {
  const raw = (param ?? "").trim();
  if (!raw) return null;

  const direct = units.find((unit) => unit.slug === raw);
  if (direct) return direct;

  const normalized = normalizeUnitSlug(raw);
  return units.find((unit) => normalizeUnitSlug(unit.slug) === normalized) ?? null;
}

export function isDigitalJourneyUnit(value: Unit | string | null | undefined): boolean {
  const unit = typeof value === "string" ? resolveUnitFromSlug(value) : value;
  if (!unit) return false;
  return isDigitalJourneyUnitSlug(unit.slug);
}

export function getCanonicalDigitalUnitSlug(value: Unit | string): string {
  const unit = typeof value === "string" ? resolveUnitFromSlug(value) : value;
  const slug = unit?.slug ?? (typeof value === "string" ? value : "");

  if (normalizeUnitSlug(slug) === "novohamburgo") return "novohamburgo";
  return slug;
}

export function getNetworkUnitHref(value: Unit | string): string {
  const unit = typeof value === "string" ? resolveUnitFromSlug(value) : value;
  const slug = unit?.slug ?? (typeof value === "string" ? value : "");
  return `/unidades/${slug}`;
}

export function getUnitHref(value: Unit | string): string {
  if (isDigitalJourneyUnit(value)) {
    return `/${getCanonicalDigitalUnitSlug(value)}`;
  }

  return getNetworkUnitHref(value);
}

export function isIndexableUnitPath(path: string | null | undefined): boolean {
  const normalized = normalizeUnitSlug(path);
  return normalized === "barrashoppingsul" || normalized === "novohamburgo";
}
