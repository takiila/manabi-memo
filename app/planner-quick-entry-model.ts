import { isPlannerDate, type PersonalEvent, type PersonalTodo } from './planner-model';

export type QuickEntryDraft = {
  kind: 'event' | 'todo';
  title: string;
  day: string;
  time: string;
  endTime: string;
  due: string;
  workDay: string;
  workTime: string;
  note: string;
  priority: boolean;
  tags: string[];
};

export type QuickEntryResult =
  | { kind: 'event'; record: PersonalEvent }
  | { kind: 'todo'; record: PersonalTodo };

export function buildQuickEntry(draft: QuickEntryDraft, id: string): QuickEntryResult {
  const title = draft.title.trim();
  if (!title || title.length > 10000) throw new Error('予定・ToDoのタイトルを入力してください。');
  if (!id.trim()) throw new Error('登録IDを生成できませんでした。');

  if (draft.kind === 'event') {
    if (!isPlannerDate(draft.day, false) || draft.day.length !== 10) throw new Error('予定の日付を正しく入力してください。');
    if (draft.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) throw new Error('開始時刻が不正です。');
    if (draft.endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.endTime)) throw new Error('終了時刻が不正です。');
    if (draft.endTime && (!draft.time || draft.endTime < draft.time)) throw new Error('終了時刻は開始時刻以降に設定してください。');
    if (draft.note.length > 10000) throw new Error('メモが長すぎます。');
    return { kind: 'event', record: {
      id: `event-${id}`,
      title,
      start: draft.day + (draft.time ? `T${draft.time}` : ''),
      end: draft.endTime ? `${draft.day}T${draft.endTime}` : '',
      note: draft.note,
      deletedAt: null,
    } };
  }

  if (draft.due && (!isPlannerDate(draft.due, false) || draft.due.length !== 10)) throw new Error('期限の日付が不正です。');
  if (draft.workDay && (!isPlannerDate(draft.workDay, false) || draft.workDay.length !== 10)) throw new Error('作業予定日が不正です。');
  if (draft.workTime && (!draft.workDay || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.workTime))) throw new Error('作業時刻を設定するには正しい作業予定日も入力してください。');
  return { kind: 'todo', record: {
    id: `todo-${id}`, text: title, courseId: '', tags: [...new Set(draft.tags.filter(Boolean))],
    done: false, registered: true, priority: draft.priority,
    due: draft.due, workAt: draft.workDay + (draft.workDay && draft.workTime ? `T${draft.workTime}` : ''),
    deletedAt: null,
  } };
}
