export const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export type SoftDeletable = { deletedAt?: string | null };

export type DisplayPreferences = {
  campusMusterEnabled: boolean;
};

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  campusMusterEnabled: false,
};

export function normalizeDisplayPreferences(value: unknown): DisplayPreferences {
  if (!value || typeof value !== "object") return { ...DEFAULT_DISPLAY_PREFERENCES };
  const input = value as Partial<DisplayPreferences>;
  return { campusMusterEnabled: input.campusMusterEnabled === true };
}

export function isInTrash(value: SoftDeletable) {
  return Boolean(validDeletedAt(value.deletedAt));
}

export function activeOnly<T extends SoftDeletable>(values: T[]) {
  return values.filter((value) => !isInTrash(value));
}

export function trashOnly<T extends SoftDeletable>(values: T[], now = new Date()) {
  return values
    .filter((value) => isInTrash(value) && !isTrashExpired(value, now))
    .sort((left, right) => String(right.deletedAt).localeCompare(String(left.deletedAt)));
}

export function isTrashExpired(value: SoftDeletable, now = new Date()) {
  const deletedAt = validDeletedAt(value.deletedAt);
  return deletedAt ? now.getTime() - new Date(deletedAt).getTime() >= TRASH_RETENTION_MS : false;
}

export function trashDaysRemaining(value: SoftDeletable, now = new Date()) {
  const deletedAt = validDeletedAt(value.deletedAt);
  if (!deletedAt) return TRASH_RETENTION_DAYS;
  const remaining = TRASH_RETENTION_MS - (now.getTime() - new Date(deletedAt).getTime());
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

export function purgeExpiredTrash<T extends SoftDeletable>(values: T[], now = new Date()) {
  return values.filter((value) => !isTrashExpired(value, now));
}

export function mayInitializeEmptyDevice(input: { backupConfirmed: boolean; confirmationText: string }) {
  return input.backupConfirmed && input.confirmationText.trim() === "初期化";
}

function validDeletedAt(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  return Number.isFinite(new Date(value).getTime()) ? value : null;
}
