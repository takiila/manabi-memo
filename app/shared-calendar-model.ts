export type SharedCalendarKind = "assignment" | "check" | "event" | "play";

export type SharedCalendarMember = {
  email: string;
  displayName: string;
};

export type SharedCalendarCompletion = {
  email: string;
  completedAt: string;
};

export type SharedCalendarEvent = {
  id: string;
  kind: SharedCalendarKind;
  termLabel: string;
  courseLabel: string;
  title: string;
  dueAt: string;
  note: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  completions: SharedCalendarCompletion[];
};

export type SharedCalendarSnapshot = {
  currentUser: string;
  members: SharedCalendarMember[];
  events: SharedCalendarEvent[];
  fetchedAt: string;
};

export type SharedCourseProgress = {
  courseLabel: string;
  completedChecks: number;
  totalChecks: number;
  percent: number;
  incompleteMembers: string[];
  eventCount: number;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function normalizeSharedCalendarSnapshot(value: unknown): SharedCalendarSnapshot {
  const source = record(value);
  const members = array(source.members).flatMap((value) => {
    const item = record(value);
    const email = cleanEmail(item.email);
    if (!email) return [];
    return [{ email, displayName: cleanText(item.displayName, 120) || email.split("@")[0] }];
  });
  const memberEmails = new Set(members.map((member) => member.email));
  const events = array(source.events).flatMap((value) => {
    const item = record(value);
    const id = cleanId(item.id);
    const title = cleanText(item.title, 120);
    const dueAt = typeof item.dueAt === "string" && DATE_TIME_PATTERN.test(item.dueAt) && isValidSharedDateTime(item.dueAt) ? item.dueAt : "";
    if (!id || !title || !dueAt) return [];
    const completions = array(item.completions).flatMap((value) => {
      const completion = record(value);
      const email = cleanEmail(completion.email);
      const completedAt = cleanISO(completion.completedAt);
      return email && completedAt && memberEmails.has(email) ? [{ email, completedAt }] : [];
    });
    return [{
      id,
      kind: item.kind === "check" || item.kind === "event" || item.kind === "play" ? item.kind : "assignment",
      termLabel: cleanText(item.termLabel, 100),
      courseLabel: cleanText(item.courseLabel, 100),
      title,
      dueAt,
      note: cleanText(item.note, 2000),
      createdBy: cleanEmail(item.createdBy),
      updatedBy: cleanEmail(item.updatedBy),
      createdAt: cleanISO(item.createdAt),
      updatedAt: cleanISO(item.updatedAt),
      deletedAt: item.deletedAt === null ? null : cleanISO(item.deletedAt) || null,
      completions: uniqueBy(completions, (completion) => completion.email),
    } satisfies SharedCalendarEvent];
  });
  const trashCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return {
    currentUser: cleanEmail(source.currentUser),
    members: uniqueBy(members, (member) => member.email),
    events: uniqueBy(events, (event) => event.id).filter((event) => !event.deletedAt || Date.parse(event.deletedAt) >= trashCutoff).sort((left, right) => left.dueAt.localeCompare(right.dueAt)),
    fetchedAt: cleanISO(source.fetchedAt) || new Date(0).toISOString(),
  };
}

export function incompleteMembers(event: SharedCalendarEvent, members: SharedCalendarMember[]) {
  const completed = new Set(event.completions.map((completion) => completion.email));
  return members.filter((member) => !completed.has(member.email));
}

export function sharedCourseProgress(events: SharedCalendarEvent[], members: SharedCalendarMember[], termLabel?: string): SharedCourseProgress[] {
  const active = events.filter((event) => !event.deletedAt && event.kind !== "event" && event.kind !== "play" && (!termLabel || event.termLabel === termLabel));
  const grouped = new Map<string, SharedCalendarEvent[]>();
  for (const event of active) {
    const key = event.courseLabel || "科目未設定";
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  return [...grouped.entries()].map(([courseLabel, courseEvents]) => {
    const totalChecks = courseEvents.length * members.length;
    const completedChecks = courseEvents.reduce((sum, event) => sum + members.filter((member) => event.completions.some((completion) => completion.email === member.email)).length, 0);
    const incomplete = new Set(courseEvents.flatMap((event) => incompleteMembers(event, members).map((member) => member.email)));
    return {
      courseLabel,
      completedChecks,
      totalChecks,
      percent: totalChecks === 0 ? 0 : Math.round(completedChecks / totalChecks * 100),
      incompleteMembers: [...incomplete],
      eventCount: courseEvents.length,
    };
  }).sort((left, right) => left.percent - right.percent || left.courseLabel.localeCompare(right.courseLabel, "ja"));
}

export function sharedCalendarCacheKey(email: string) {
  const normalized = cleanEmail(email);
  return normalized ? `manabi-shared-calendar-v1:${normalized}` : "";
}

export function isValidSharedDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";
  return EMAIL_PATTERN.test(email) && email.length <= 254 ? email : "";
}

function cleanId(value: unknown) {
  const id = typeof value === "string" ? value : "";
  return /^[a-zA-Z0-9-]{16,100}$/.test(id) ? id : "";
}

function cleanISO(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}
