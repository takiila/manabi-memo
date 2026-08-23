import { NextResponse } from "next/server";
import { accountForRequest } from "../../server-auth-response";
import { execute, queryAll, queryOne, withTransaction } from "@/lib/server/database";
import { parseAllowedAccountEmails } from "@/lib/server/account-access-policy";
import { isSameOriginRequest } from "@/lib/server/request-security";
import { isValidSharedDateTime, type SharedCalendarEvent, type SharedCalendarKind, type SharedCalendarSnapshot } from "@/app/shared-calendar-model";

const EVENT_ID_PATTERN = /^[a-zA-Z0-9-]{16,100}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type EventRow = {
  id: string;
  kind: string;
  term_label: string;
  course_label: string;
  title: string;
  due_at: string;
  note: string;
  created_by_email: string;
  updated_by_email: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

type CompletionRow = { event_id: string; member_email: string; completed_at: number };
type MutationBody = Record<string, unknown> & { action?: unknown };

export async function GET(request: Request) {
  const auth = await accountForRequest(request);
  if ("response" in auth) return auth.response;
  const currentEmail = normalizedEmail(auth.account.email);
  const members = configuredMembers(currentEmail);
  if (!members.ok) return json({ error: members.error }, 503);
  await registerMember(currentEmail, auth.account.displayName);
  await purgeExpiredTrash();
  return json(await calendarSnapshot(currentEmail, members.values));
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return json({ error: "送信元を確認できませんでした。" }, 403);
  const auth = await accountForRequest(request);
  if ("response" in auth) return auth.response;
  const currentEmail = normalizedEmail(auth.account.email);
  const members = configuredMembers(currentEmail);
  if (!members.ok) return json({ error: members.error }, 503);
  await registerMember(currentEmail, auth.account.displayName);
  await purgeExpiredTrash();

  let body: MutationBody;
  try { body = await request.json() as MutationBody; } catch { return json({ error: "共有予定を読み取れませんでした。" }, 400); }

  const action = typeof body.action === "string" ? body.action : "";
  if (action === "create") {
    const fields = parseEventFields(body);
    if (!fields) return json({ error: "課題・確認事項の入力内容を確認してください。" }, 400);
    const id = crypto.randomUUID();
    const now = Date.now();
    await execute(
      "INSERT INTO shared_calendar_events (id, kind, term_label, course_label, title, due_at, note, created_by_email, updated_by_email, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
      [id, fields.kind, fields.termLabel, fields.courseLabel, fields.title, fields.dueAt, fields.note, currentEmail, currentEmail, now, now],
    );
    return json(await calendarSnapshot(currentEmail, members.values), 201);
  }

  const eventId = typeof body.eventId === "string" && EVENT_ID_PATTERN.test(body.eventId) ? body.eventId : "";
  if (!eventId) return json({ error: "共有予定を確認できませんでした。" }, 400);

  if (action === "set-completion") {
    const event = await activeEvent(eventId);
    if (!event) return json({ error: "共有予定が見つかりません。" }, 404);
    const completed = body.completed === true;
    const now = Date.now();
    if (completed) {
      await execute(
        "INSERT INTO shared_calendar_completions (event_id, member_email, completed_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(event_id, member_email) DO UPDATE SET completed_at = excluded.completed_at, updated_at = excluded.updated_at",
        [eventId, currentEmail, now, now],
      );
    } else {
      await execute("DELETE FROM shared_calendar_completions WHERE event_id = ? AND member_email = ?", [eventId, currentEmail]);
    }
    return json(await calendarSnapshot(currentEmail, members.values));
  }

  const expectedUpdatedAt = parseExpectedUpdatedAt(body.expectedUpdatedAt);
  if (expectedUpdatedAt === null) return json({ error: "共有予定の更新版を確認できませんでした。" }, 400);

  if (action === "update") {
    const fields = parseEventFields(body);
    if (!fields) return json({ error: "課題・確認事項の入力内容を確認してください。" }, 400);
    const now = Math.max(Date.now(), expectedUpdatedAt + 1);
    const result = await execute(
      "UPDATE shared_calendar_events SET kind = ?, term_label = ?, course_label = ?, title = ?, due_at = ?, note = ?, updated_by_email = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL",
      [fields.kind, fields.termLabel, fields.courseLabel, fields.title, fields.dueAt, fields.note, currentEmail, now, eventId, expectedUpdatedAt],
    );
    if (result.changes !== 1) return conflict();
    return json(await calendarSnapshot(currentEmail, members.values));
  }

  if (action === "trash") {
    const now = Math.max(Date.now(), expectedUpdatedAt + 1);
    const result = await execute(
      "UPDATE shared_calendar_events SET deleted_at = ?, updated_by_email = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL",
      [now, currentEmail, now, eventId, expectedUpdatedAt],
    );
    if (result.changes !== 1) return conflict();
    return json(await calendarSnapshot(currentEmail, members.values));
  }

  if (action === "restore") {
    const now = Math.max(Date.now(), expectedUpdatedAt + 1);
    const cutoff = Date.now() - TRASH_RETENTION_MS;
    const result = await execute(
      "UPDATE shared_calendar_events SET deleted_at = NULL, updated_by_email = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NOT NULL AND deleted_at >= ?",
      [currentEmail, now, eventId, expectedUpdatedAt, cutoff],
    );
    if (result.changes !== 1) return conflict();
    return json(await calendarSnapshot(currentEmail, members.values));
  }

  return json({ error: "共有予定の操作を確認できませんでした。" }, 400);
}

async function calendarSnapshot(currentUser: string, members: string[]): Promise<SharedCalendarSnapshot> {
  const [events, completions, profiles] = await Promise.all([
    queryAll<EventRow>("SELECT id, kind, term_label, course_label, title, due_at, note, created_by_email, updated_by_email, created_at, updated_at, deleted_at FROM shared_calendar_events WHERE deleted_at IS NULL OR deleted_at >= ? ORDER BY due_at ASC LIMIT 1000", [Date.now() - TRASH_RETENTION_MS]),
    queryAll<CompletionRow>("SELECT c.event_id, c.member_email, c.completed_at FROM shared_calendar_completions c INNER JOIN shared_calendar_events e ON e.id = c.event_id WHERE e.deleted_at IS NULL OR e.deleted_at >= ?", [Date.now() - TRASH_RETENTION_MS]),
    queryAll<{ email: string; display_name: string }>("SELECT email, display_name FROM shared_calendar_member_profiles"),
  ]);
  const allowed = new Set(members);
  const profileNames = new Map(profiles.map((profile) => [profile.email, profile.display_name]));
  const byEvent = new Map<string, CompletionRow[]>();
  for (const completion of completions.filter((item) => allowed.has(item.member_email))) {
    byEvent.set(completion.event_id, [...(byEvent.get(completion.event_id) ?? []), completion]);
  }
  return {
    currentUser,
    members: members.map((email) => ({ email, displayName: profileNames.get(email) || email.split("@")[0] })),
    events: events.map((event): SharedCalendarEvent => ({
      id: event.id,
      kind: event.kind === "check" || event.kind === "event" ? event.kind : "assignment",
      termLabel: event.term_label,
      courseLabel: event.course_label,
      title: event.title,
      dueAt: event.due_at,
      note: event.note,
      createdBy: event.created_by_email,
      updatedBy: event.updated_by_email,
      createdAt: new Date(event.created_at).toISOString(),
      updatedAt: new Date(event.updated_at).toISOString(),
      deletedAt: event.deleted_at === null ? null : new Date(event.deleted_at).toISOString(),
      completions: (byEvent.get(event.id) ?? []).map((completion) => ({ email: completion.member_email, completedAt: new Date(completion.completed_at).toISOString() })),
    })),
    fetchedAt: new Date().toISOString(),
  };
}

async function registerMember(email: string, displayName: string) {
  const label = displayName.trim().slice(0, 120) || email.split("@")[0];
  await execute(
    "INSERT INTO shared_calendar_member_profiles (email, display_name, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, last_seen_at = excluded.last_seen_at",
    [email, label, Date.now()],
  );
}

function configuredMembers(currentEmail: string) {
  const values = parseAllowedAccountEmails(process.env.ALLOWED_ACCOUNT_EMAILS);
  if (values.length < 2) return { ok: false as const, error: "共有カレンダーには2人以上の利用者メール設定が必要です。" };
  if (values.length > 3) return { ok: false as const, error: "共有カレンダーの利用者メール設定は3人までです。" };
  if (!values.includes(currentEmail)) return { ok: false as const, error: "このアカウントは共有メンバーではありません。" };
  return { ok: true as const, values };
}

function parseEventFields(body: MutationBody) {
  const kind: SharedCalendarKind | "" = body.kind === "assignment" || body.kind === "check" || body.kind === "event" ? body.kind : "";
  const title = text(body.title, 120);
  const termLabel = text(body.termLabel, 100);
  const courseLabel = text(body.courseLabel, 100);
  const dueAt = typeof body.dueAt === "string" && DATE_TIME_PATTERN.test(body.dueAt) && isValidSharedDateTime(body.dueAt) ? body.dueAt : "";
  const note = text(body.note, 2000);
  return kind && title && dueAt ? { kind, title, termLabel, courseLabel, dueAt, note } : null;
}

function parseExpectedUpdatedAt(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isSafeInteger(time) && time >= 0 ? time : null;
}

async function activeEvent(id: string) {
  return queryOne<{ id: string }>("SELECT id FROM shared_calendar_events WHERE id = ? AND deleted_at IS NULL", [id]);
}

async function purgeExpiredTrash() {
  const cutoff = Date.now() - TRASH_RETENTION_MS;
  await withTransaction(async (transaction) => {
    await transaction.execute("DELETE FROM shared_calendar_completions WHERE event_id IN (SELECT id FROM shared_calendar_events WHERE deleted_at IS NOT NULL AND deleted_at < ?)", [cutoff]);
    await transaction.execute("DELETE FROM shared_calendar_events WHERE deleted_at IS NOT NULL AND deleted_at < ?", [cutoff]);
  });
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizedEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function conflict() {
  return json({ error: "別のメンバーが先に更新しました。最新内容を読み直してください。", conflict: true }, 409);
}

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "cache-control": "no-store" } });
}
