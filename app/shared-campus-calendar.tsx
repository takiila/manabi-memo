"use client";

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  CloudOff,
  Edit3,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authenticatedFetch, observeFirebaseUser } from "./firebase-auth-client";
import {
  incompleteMembers,
  normalizeSharedCalendarSnapshot,
  sharedCalendarCacheKey,
  sharedCourseProgress,
  type SharedCalendarEvent,
  type SharedCalendarKind,
  type SharedCalendarSnapshot,
} from "./shared-calendar-model";

type LoadStatus = "loading" | "ready" | "offline" | "signed-out" | "unavailable" | "error";
type CalendarFilter = "all" | "study" | "play";
type EventFormState = {
  eventId: string;
  expectedUpdatedAt: string;
  kind: SharedCalendarKind;
  termLabel: string;
  courseLabel: string;
  title: string;
  dueAt: string;
  note: string;
};

const KIND_LABELS: Record<SharedCalendarKind, string> = {
  assignment: "課題",
  check: "確認事項",
  event: "予定",
  play: "遊び候補",
};

export default function SharedCampusCalendar({ termLabel, courseOptions }: { termLabel: string; courseOptions: string[] }) {
  const [snapshot, setSnapshot] = useState<SharedCalendarSnapshot | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [message, setMessage] = useState("");
  const [month, setMonth] = useState(localMonth());
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<EventFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const authEmailRef = useRef("");
  const requestGenerationRef = useRef(0);

  const storeSnapshot = useCallback((value: unknown, expectedEmail: string) => {
    const normalized = normalizeSharedCalendarSnapshot(value);
    if (!normalized.currentUser || normalized.currentUser !== expectedEmail) throw new Error("共有カレンダーの利用者を確認できませんでした。");
    setSnapshot(normalized);
    const key = sharedCalendarCacheKey(normalized.currentUser);
    try { if (key) localStorage.setItem(key, JSON.stringify(normalized)); } catch { /* the in-memory snapshot remains usable */ }
    return normalized;
  }, []);

  const refresh = useCallback(async (email?: string) => {
    const expectedEmail = email || authEmailRef.current;
    if (!expectedEmail) return;
    const requestGeneration = ++requestGenerationRef.current;
    setMessage("");
    try {
      const response = await authenticatedFetch("/api/shared-calendar", { cache: "no-store" });
      const result = await response.json() as Record<string, unknown>;
      if (requestGeneration !== requestGenerationRef.current || expectedEmail !== authEmailRef.current) return;
      if (!response.ok) {
        const error = typeof result.error === "string" ? result.error : "共有カレンダーを読み込めませんでした。";
        if (response.status === 401 || response.status === 403) {
          setSnapshot(null);
          setStatus("signed-out");
        }
        else if (response.status === 503) setStatus("unavailable");
        else setStatus("error");
        setMessage(error);
        return;
      }
      storeSnapshot(result, expectedEmail);
      setStatus("ready");
    } catch {
      if (requestGeneration !== requestGenerationRef.current || expectedEmail !== authEmailRef.current) return;
      const cached = readCache(expectedEmail);
      if (cached) setSnapshot(cached);
      setStatus(cached ? "offline" : "error");
      setMessage(cached
        ? "オフラインのため、最後に同期した内容を表示しています。変更はオンライン復帰後に行えます。"
        : "共有カレンダーに接続できませんでした。");
    }
  }, [storeSnapshot]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: () => void = () => undefined;
    let activeEmail = "";
    void observeFirebaseUser((user, enabled) => {
      if (disposed) return;
      if (!enabled) {
        authEmailRef.current = "";
        requestGenerationRef.current += 1;
        setSnapshot(null);
        setStatus("unavailable");
        setMessage("共有カレンダーにはFirebaseアカウント設定が必要です。");
        return;
      }
      const email = user?.email?.trim().toLocaleLowerCase("en-US") ?? "";
      if (!email) {
        activeEmail = "";
        authEmailRef.current = "";
        requestGenerationRef.current += 1;
        setSnapshot(null);
        setStatus("signed-out");
        setMessage("共有カレンダーを見るには、許可されたアカウントでログインしてください。");
        return;
      }
      if (email === activeEmail) return;
      activeEmail = email;
      authEmailRef.current = email;
      requestGenerationRef.current += 1;
      const cached = readCache(email);
      setSnapshot(cached?.currentUser === email ? cached : null);
      setStatus(cached ? "offline" : "loading");
      void refresh(email);
    }).then((stop) => { if (disposed) stop(); else unsubscribe = stop; });
    return () => { disposed = true; unsubscribe(); };
  }, [refresh]);

  const mutate = async (body: Record<string, unknown>) => {
    if (status === "offline") {
      setMessage("変更するにはインターネットへ接続してください。");
      return null;
    }
    const expectedEmail = authEmailRef.current;
    if (!expectedEmail) return null;
    const requestGeneration = ++requestGenerationRef.current;
    setSaving(true);
    setMessage("");
    try {
      const response = await authenticatedFetch("/api/shared-calendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as Record<string, unknown>;
      if (requestGeneration !== requestGenerationRef.current || expectedEmail !== authEmailRef.current) return null;
      if (!response.ok) {
        const error = typeof result.error === "string" ? result.error : "共有カレンダーを更新できませんでした。";
        if (response.status === 401 || response.status === 403) {
          setSnapshot(null);
          setStatus("signed-out");
        }
        setMessage(error);
        if (response.status === 409) await refresh(expectedEmail);
        return null;
      }
      const next = storeSnapshot(result, expectedEmail);
      setStatus("ready");
      return next;
    } catch {
      if (requestGeneration !== requestGenerationRef.current || expectedEmail !== authEmailRef.current) return null;
      setStatus(snapshot ? "offline" : "error");
      setMessage("通信が途切れたため更新できませんでした。内容は変更していません。");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const activeEvents = useMemo(() => (snapshot?.events ?? []).filter((event) => !event.deletedAt && event.termLabel === termLabel), [snapshot, termLabel]);
  const trashedEvents = useMemo(() => (snapshot?.events ?? []).filter((event) => event.deletedAt), [snapshot]);
  const members = useMemo(() => snapshot?.members ?? [], [snapshot]);
  const selected = activeEvents.find((event) => event.id === selectedId) ?? null;
  const visibleEvents = useMemo(() => activeEvents.filter((event) => filter === "all" || (filter === "play" ? event.kind === "play" : event.kind !== "play")), [activeEvents, filter]);
  const studyEvents = useMemo(() => activeEvents.filter((event) => event.kind !== "play"), [activeEvents]);
  const playEvents = useMemo(() => activeEvents.filter((event) => event.kind === "play"), [activeEvents]);
  const progress = useMemo(() => sharedCourseProgress(activeEvents, members, termLabel), [activeEvents, members, termLabel]);
  const myPending = studyEvents.filter((event) => !event.completions.some((completion) => completion.email === snapshot?.currentUser)).length;
  const groupPending = studyEvents.filter((event) => incompleteMembers(event, members).length > 0).length;
  const allAvailable = playEvents.filter((event) => members.length > 0 && incompleteMembers(event, members).length === 0).length;

  const moveMonth = (offset: number) => {
    const date = new Date(`${month}-01T12:00:00`);
    date.setMonth(date.getMonth() + offset);
    setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  };

  const saveForm = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const common = {
      kind: form.kind,
      termLabel: form.termLabel,
      courseLabel: form.courseLabel,
      title: form.title,
      dueAt: form.dueAt,
      note: form.note,
    };
    const result = form.eventId
      ? await mutate({ action: "update", eventId: form.eventId, expectedUpdatedAt: form.expectedUpdatedAt, ...common })
      : await mutate({ action: "create", ...common });
    if (result) {
      setForm(null);
      setSelectedId(form.eventId);
    }
  };

  if (!snapshot && status !== "loading") {
    return (
      <div className="campus-content shared-calendar-content">
        <section className="shared-calendar-unavailable">
          <CalendarDays size={25} />
          <div><h2>学びと遊びの共有カレンダー</h2><p>{message}</p></div>
          {status === "error" && <button className="campus-secondary" type="button" onClick={() => void refresh()}><RefreshCw size={15} /> 再試行</button>}
        </section>
      </div>
    );
  }

  return (
    <div className="campus-content shared-calendar-content">
      <header className="shared-calendar-heading">
        <div>
          <p className="campus-kicker">PRIVATE GROUP · {members.length || 0} MEMBERS</p>
          <h2>学びと遊びの共有カレンダー</h2>
          <p>課題の完了と、遊び候補への参加可否を、許可された2〜3人だけで共有します。</p>
        </div>
        <div className="shared-calendar-actions">
          <button className="campus-secondary" type="button" disabled={saving} onClick={() => void refresh(snapshot?.currentUser)}><RefreshCw size={16} /> 更新</button>
          <button className="campus-primary" type="button" disabled={status !== "ready" || saving} onClick={() => setForm(newEventForm(termLabel, courseOptions[0]))}><Plus size={16} /> 共有予定を追加</button>
        </div>
      </header>

      {message && <p className={`shared-calendar-message ${status}`} role="status">{status === "offline" && <CloudOff size={16} />}{message}</p>}

      <section className="shared-stat-grid" aria-label="共有カレンダーの概要">
        <SharedStat label="自分が未完了" value={myPending} note={snapshot?.currentUser || ""} />
        <SharedStat label="誰かが未完了" value={groupPending} note={`学び ${studyEvents.length}件中`} />
        <SharedStat label="全員が参加OK" value={allAvailable} note={`遊び候補 ${playEvents.length}件中`} />
      </section>

      <section className="shared-member-strip" aria-label="共有メンバー">
        <Users size={17} />
        <strong>共有メンバー</strong>
        {members.map((member) => <span className={`member-tone-${memberTone(member.email, members)}`} key={member.email} title={member.email}><i aria-hidden="true" />{member.displayName}{member.email === snapshot?.currentUser ? "（自分）" : ""}</span>)}
      </section>

      <div className="shared-calendar-filters" aria-label="表示する予定">
        <strong>表示</strong>
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>すべて <span>{activeEvents.length}</span></button>
        <button type="button" className={filter === "study" ? "active" : ""} onClick={() => setFilter("study")}>学び <span>{studyEvents.length}</span></button>
        <button type="button" className={filter === "play" ? "active" : ""} onClick={() => setFilter("play")}>遊び <span>{playEvents.length}</span></button>
      </div>

      <div className="shared-month-toolbar">
        <div><strong>{monthTitle(month)}</strong><small>学びは完了、遊びは参加OKを、各メンバーが自分で回答します。</small></div>
        <div className="month-actions"><button type="button" aria-label="前の月" onClick={() => moveMonth(-1)}><ChevronLeft size={17} /></button><button type="button" onClick={() => setMonth(localMonth())}>今月</button><button type="button" aria-label="次の月" onClick={() => moveMonth(1)}><ChevronRight size={17} /></button></div>
      </div>

      <div className="shared-calendar-layout">
        <SharedMonthCalendar month={month} events={visibleEvents} members={members} selectedId={selectedId} onSelect={setSelectedId} />
        <SharedEventDetail
          event={selected}
          members={members}
          currentUser={snapshot?.currentUser ?? ""}
          saving={saving || status !== "ready"}
          onToggle={(event, completed) => void mutate({ action: "set-completion", eventId: event.id, completed })}
          onEdit={(event) => setForm(eventForm(event))}
          onTrash={async (event) => {
            if (!window.confirm(`「${event.title}」を30日間のごみ箱へ移しますか？`)) return;
            if (await mutate({ action: "trash", eventId: event.id, expectedUpdatedAt: event.updatedAt })) setSelectedId("");
          }}
        />
      </div>

      <section className="shared-progress-section">
        <div><h3>科目ごとの共有進捗</h3><p>課題・確認事項ごとに、メンバー全員のチェック状況を集計します。</p></div>
        <div className="shared-progress-grid">
          {progress.length === 0 ? <p className="shared-empty">進捗を集計できる共有課題・確認事項はまだありません。</p> : progress.map((course) => (
            <article className="shared-progress-card" key={course.courseLabel}>
              <div><strong>{course.courseLabel}</strong><span>{course.percent}%</span></div>
              <div className="shared-progress-bar"><i style={{ width: `${course.percent}%` }} /></div>
              <small>{course.completedChecks}/{course.totalChecks} 完了 · {course.eventCount}件</small>
              <p>{course.incompleteMembers.length === 0 ? "全員完了" : `未完了: ${memberNames(course.incompleteMembers, members).join("、")}`}</p>
            </article>
          ))}
        </div>
      </section>

      {trashedEvents.length > 0 && (
        <details className="shared-trash">
          <summary>ごみ箱（{trashedEvents.length}件・30日後に完全削除）</summary>
          {trashedEvents.map((event) => <div key={event.id}><span><strong>{event.title}</strong><small>{formatDateTime(event.dueAt)}</small></span><button className="campus-secondary" type="button" disabled={saving || status !== "ready"} onClick={() => void mutate({ action: "restore", eventId: event.id, expectedUpdatedAt: event.updatedAt })}><RotateCcw size={14} /> 戻す</button></div>)}
        </details>
      )}

      {form && <SharedEventForm form={form} courseOptions={courseOptions} saving={saving} onChange={setForm} onClose={() => setForm(null)} onSubmit={saveForm} />}
    </div>
  );
}

function SharedMonthCalendar({ month, events, members, selectedId, onSelect }: { month: string; events: SharedCalendarEvent[]; members: SharedCalendarSnapshot["members"]; selectedId: string; onSelect: (id: string) => void }) {
  const [expandedDate, setExpandedDate] = useState("");
  const monthStart = new Date(`${month}-01T12:00:00`);
  const firstWeekday = monthStart.getDay();
  const days = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: firstWeekday + days }, (_, index) => index < firstWeekday ? null : index - firstWeekday + 1);
  while (cells.length % 7) cells.push(null);
  const today = localDate();
  return (
    <div className="campus-calendar shared-month-calendar">
      <div className="calendar-weekdays">{["日", "月", "火", "水", "木", "金", "土"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{cells.map((day, index) => {
        const date = day ? `${month}-${String(day).padStart(2, "0")}` : "";
        const dayEvents = day ? events.filter((event) => event.dueAt.startsWith(date)) : [];
        const visibleEvents = expandedDate === date ? dayEvents : dayEvents.slice(0, 3);
        return <div className={`calendar-cell shared-calendar-cell ${date === today ? "today" : ""}`} key={`${day ?? "blank"}-${index}`}><span>{day}</span>{visibleEvents.map((event) => {
          const complete = members.length - incompleteMembers(event, members).length;
          const responseLabel = event.kind === "play" ? "参加OK" : "完了";
          return <button type="button" className={`shared-calendar-event ${event.kind} member-tone-${memberTone(event.createdBy, members)} ${selectedId === event.id ? "selected" : ""}`} key={event.id} title={`${event.courseLabel} ${event.title} ${complete}/${members.length}${responseLabel}`} onClick={() => onSelect(event.id)}><small>{event.courseLabel || KIND_LABELS[event.kind]}</small><b>{event.title}</b><em>{complete}/{members.length}</em></button>;
        })}{dayEvents.length > 3 && <button className="shared-calendar-more" type="button" onClick={() => setExpandedDate(expandedDate === date ? "" : date)}>{expandedDate === date ? "閉じる" : `ほか${dayEvents.length - 3}件`}</button>}</div>;
      })}</div>
    </div>
  );
}

function SharedEventDetail({ event, members, currentUser, saving, onToggle, onEdit, onTrash }: { event: SharedCalendarEvent | null; members: SharedCalendarSnapshot["members"]; currentUser: string; saving: boolean; onToggle: (event: SharedCalendarEvent, completed: boolean) => void; onEdit: (event: SharedCalendarEvent) => void; onTrash: (event: SharedCalendarEvent) => void }) {
  if (!event) return <aside className="shared-event-detail empty"><CalendarDays size={27} /><h3>予定を選択</h3><p>カレンダー内の項目を選ぶと、メモと全員の状況がここに表示されます。</p></aside>;
  const incomplete = incompleteMembers(event, members);
  const isPlay = event.kind === "play";
  return (
    <aside className="shared-event-detail">
      <header><span className={`shared-kind ${event.kind}`}>{KIND_LABELS[event.kind]}</span><div><button type="button" aria-label="編集" disabled={saving} onClick={() => onEdit(event)}><Edit3 size={16} /></button><button className="danger" type="button" aria-label="ごみ箱へ移動" disabled={saving} onClick={() => onTrash(event)}><Trash2 size={16} /></button></div></header>
      <small>{event.courseLabel || (isPlay ? "場所未設定" : "科目未設定")}</small>
      <h3>{event.title}</h3>
      <time dateTime={event.dueAt}>{formatDateTime(event.dueAt)}</time>
      <span className={`shared-event-author member-tone-${memberTone(event.createdBy, members)}`}><i aria-hidden="true" />登録: {displayMember(event.createdBy, members)}</span>
      {event.note && <p className="shared-event-note">{event.note}</p>}
      <div className={`shared-incomplete ${incomplete.length === 0 ? "complete" : ""}`}><strong>{isPlay ? (incomplete.length === 0 ? "全員が参加OK" : `参加OK ${event.completions.length}人`) : (incomplete.length === 0 ? "全員完了" : `未完了 ${incomplete.length}人`)}</strong><span>{incomplete.length === 0 ? (isPlay ? "この候補日は全員が参加できます。" : "この項目は全員がチェック済みです。") : `${isPlay ? "未回答" : "未完了"}: ${incomplete.map((member) => member.displayName).join("、")}`}</span></div>
      <div className="shared-member-checks">
        {members.map((member) => {
          const done = event.completions.some((completion) => completion.email === member.email);
          const isMe = member.email === currentUser;
          return <div key={member.email}><span className={done ? "done" : ""}>{done ? <Check size={15} /> : <Circle size={15} />}<span><strong>{member.displayName}{isMe ? "（自分）" : ""}</strong><small>{done ? (isPlay ? "参加OK" : "完了") : (isPlay ? "未回答" : "未完了")}</small></span></span>{isMe ? <button type="button" disabled={saving} onClick={() => onToggle(event, !done)}>{done ? (isPlay ? "参加OKを取り消す" : "未完了に戻す") : (isPlay ? "参加できる" : "自分を完了にする")}</button> : <small>{isPlay ? "本人のみ回答可" : "本人のみ変更可"}</small>}</div>;
        })}
      </div>
      <footer>更新: {displayMember(event.updatedBy, members)} · {formatUpdatedAt(event.updatedAt)}</footer>
    </aside>
  );
}

function SharedEventForm({ form, courseOptions, saving, onChange, onClose, onSubmit }: { form: EventFormState; courseOptions: string[]; saving: boolean; onChange: (next: EventFormState) => void; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  const isPlay = form.kind === "play";
  return <div className="campus-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="campus-modal" role="dialog" aria-modal="true" aria-label={form.eventId ? "共有予定を編集" : "共有予定を追加"}><header><h2>{form.eventId ? "共有予定を編集" : "共有予定を追加"}</h2><button type="button" onClick={onClose} aria-label="閉じる">×</button></header><form className="campus-entry-form" onSubmit={onSubmit}>
    <div className="campus-form-grid"><label><span>種類</span><select value={form.kind} onChange={(event) => onChange({ ...form, kind: event.target.value as SharedCalendarKind })}><option value="assignment">課題</option><option value="check">確認事項</option><option value="event">予定</option><option value="play">遊び候補</option></select></label><label><span>学期</span><input value={form.termLabel} maxLength={100} required onChange={(event) => onChange({ ...form, termLabel: event.target.value })} /></label></div>
    <label><span>タイトル</span><input value={form.title} maxLength={120} required autoFocus onChange={(event) => onChange({ ...form, title: event.target.value })} placeholder={isPlay ? "映画、旅行、打ち上げなど" : "レポート提出、履修確認など"} /></label>
    <div className="campus-form-grid"><label><span>{isPlay ? "場所・遊びの種類" : "科目"}</span><input list={isPlay ? undefined : "shared-course-options"} value={form.courseLabel} maxLength={100} onChange={(event) => onChange({ ...form, courseLabel: event.target.value })} placeholder={isPlay ? "梅田、映画など（未設定でも可）" : "科目未設定でも保存可"} /><datalist id="shared-course-options">{courseOptions.map((course) => <option value={course} key={course} />)}</datalist></label><label><span>日時</span><input type="datetime-local" value={form.dueAt} required onChange={(event) => onChange({ ...form, dueAt: event.target.value })} /></label></div>
    <label><span>共有メモ</span><textarea value={form.note} maxLength={2000} onChange={(event) => onChange({ ...form, note: event.target.value })} placeholder={isPlay ? "集合場所、予算、候補プランなど" : "提出方法、持ち物、確認内容など"} /></label>
    <p className="campus-note">この内容だけが許可メンバーに表示され、個人予定は自動共有されません。{isPlay ? "参加可否" : "完了状態"}は各メンバーが自分の分だけ変更できます。</p>
    <div className="campus-modal-actions"><button type="button" className="campus-secondary" onClick={onClose}>キャンセル</button><button type="submit" className="campus-primary" disabled={saving}>{saving ? "保存中…" : "共有して保存"}</button></div>
  </form></section></div>;
}

function SharedStat({ label, value, note }: { label: string; value: number; note: string }) {
  return <article><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function newEventForm(termLabel: string, courseLabel = ""): EventFormState {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(17, 0, 0, 0);
  return { eventId: "", expectedUpdatedAt: "", kind: "assignment", termLabel, courseLabel: courseLabel ?? "", title: "", dueAt: localDateTime(date), note: "" };
}

function eventForm(event: SharedCalendarEvent): EventFormState {
  return { eventId: event.id, expectedUpdatedAt: event.updatedAt, kind: event.kind, termLabel: event.termLabel, courseLabel: event.courseLabel, title: event.title, dueAt: event.dueAt, note: event.note };
}

function readCache(email: string) {
  const key = sharedCalendarCacheKey(email);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const normalized = normalizeSharedCalendarSnapshot(JSON.parse(raw));
    return normalized.currentUser === email ? normalized : null;
  } catch { return null; }
}

function memberNames(emails: string[], members: SharedCalendarSnapshot["members"]) {
  return emails.map((email) => members.find((member) => member.email === email)?.displayName || email.split("@")[0]);
}

function memberTone(email: string, members: SharedCalendarSnapshot["members"]) {
  const index = members.findIndex((member) => member.email === email);
  return index < 0 ? 0 : index % 3;
}

function displayMember(email: string, members: SharedCalendarSnapshot["members"]) {
  return members.find((member) => member.email === email)?.displayName || email.split("@")[0] || "メンバー";
}

function localMonth() { return localDate().slice(0, 7); }
function localDate() { return localDateTime(new Date()).slice(0, 10); }
function localDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function monthTitle(month: string) {
  const [year, value] = month.split("-");
  return `${year}年${Number(value)}月`;
}
function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(date) : value;
}
function formatUpdatedAt(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "";
}
