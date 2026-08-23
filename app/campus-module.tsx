"use client";

import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleGauge,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FileCheck2,
  GraduationCap,
  KeyRound,
  ListTodo,
  LockKeyhole,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { authenticatedFetch } from "./firebase-auth-client";
import {
  calculateGpaProjection,
  type CampusAssignment,
  type CampusExam,
  type CampusState,
  type GradeCode,
  isArchivedStudyTask,
  isWithinNextDays,
  localDateISO,
  normalizeCampusState,
  refreshGeneratedStudyTasks,
  sortStudyTasks,
} from "./campus-model";
import SharedCampusCalendar from "./shared-campus-calendar";

export type CampusCourse = {
  id: string;
  title: string;
  term: string;
  weekday: number | null;
  period: number | null;
  room: string;
  archivedAt?: string | null;
};

type CampusSection = "today" | "assignments" | "calendar" | "study" | "progress" | "settings";

export default function CampusModule({
  campus,
  courses,
  terms,
  activeTerm,
  onChange,
  onOpenCourse,
  onLeave,
  onImportLegacy,
  onActivated,
  hasLegacyData,
  firebaseEnabled,
}: {
  campus: CampusState;
  courses: CampusCourse[];
  terms: string[];
  activeTerm: string;
  onChange: (next: CampusState) => void;
  onOpenCourse: (courseId: string) => void;
  onLeave: () => void;
  onImportLegacy: () => void;
  onActivated: () => void;
  hasLegacyData: boolean;
  firebaseEnabled: boolean | null;
}) {
  const [section, setSection] = useState<CampusSection>("today");
  const [termId, setTermId] = useState(activeTerm);
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [showExamForm, setShowExamForm] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(localDateISO(new Date()).slice(0, 7));
  const normalized = useMemo(() => normalizeCampusState(campus), [campus]);
  const activeCourses = courses.filter((course) => !course.archivedAt && course.term === termId);
  const courseName = (courseId: string) => courses.find((course) => course.id === courseId)?.title ?? "講義未設定";

  if (!normalized.betaAccess.enabled) {
    return (
      <CampusAccessGate
        onLeave={onLeave}
        hasLegacyData={hasLegacyData}
        onActivate={() => {
          onActivated();
          onChange({
            ...normalized,
            betaAccess: { ...normalized.betaAccess, enabled: true, activatedAt: new Date().toISOString() },
          });
        }}
        onImportLegacy={onImportLegacy}
        firebaseEnabled={firebaseEnabled}
      />
    );
  }

  const assignments = normalized.assignments.filter((item) => item.termId === termId);
  const exams = normalized.exams.filter((item) => item.termId === termId);
  const tasks = sortStudyTasks(normalized.studyTasks.filter((item) => item.termId === termId && !isArchivedStudyTask(item)));
  const todayISO = localDateISO(new Date());
  const todayWeekday = new Date().getDay();
  const todayCourses = activeCourses.filter((course) => course.weekday === todayWeekday).sort((a, b) => (a.period ?? 99) - (b.period ?? 99));
  const dueSoon = assignments
    .filter((item) => item.status !== "done" && isWithinNextDays(item.dueISO, todayISO, 7))
    .sort((a, b) => a.dueISO.localeCompare(b.dueISO));
  const nextExams = exams.filter((item) => item.datetime.slice(0, 10) >= todayISO).sort((a, b) => a.datetime.localeCompare(b.datetime)).slice(0, 4);
  const termOptions = terms.length > 0 ? terms : [activeTerm];

  const setCampus = (patch: Partial<CampusState>) => onChange(normalizeCampusState({ ...normalized, ...patch }));
  const recordAttendance = (courseId: string, period: number | null, status: "present" | "late" | "absent") => {
    const id = `attendance-${courseId}-${todayISO}`;
    setCampus({
      attendanceRecords: [
        ...normalized.attendanceRecords.filter((record) => record.id !== id),
        { id, courseId, dateISO: todayISO, period, status, createdAt: new Date().toISOString() },
      ],
    });
  };
  const updateAssignment = (id: string, patch: Partial<CampusAssignment>) => setCampus({
    assignments: normalized.assignments.map((item) => item.id === id ? { ...item, ...patch } : item),
  });
  const deleteAssignment = (id: string) => {
    if (!window.confirm("この提出物を削除しますか？")) return;
    setCampus({
      assignments: normalized.assignments.filter((item) => item.id !== id),
      studyTasks: normalized.studyTasks.filter((task) => !(task.sourceType === "assignment" && task.sourceId === id)),
    });
  };
  const deleteExam = (id: string) => {
    if (!window.confirm("この試験を削除しますか？")) return;
    setCampus({
      exams: normalized.exams.filter((item) => item.id !== id),
      studyTasks: normalized.studyTasks.filter((task) => !(task.sourceType === "exam" && task.sourceId === id)),
    });
  };
  const refreshTasks = () => onChange(refreshGeneratedStudyTasks(normalized));
  const toggleTask = (id: string) => setCampus({
    studyTasks: normalized.studyTasks.map((task) => task.id === id
      ? { ...task, status: task.status === "todo" ? "done" : "todo", doneAtISO: task.status === "todo" ? todayISO : null }
      : task),
  });

  return (
    <div className="campus-shell">
      <header className="campus-header">
        <div>
          <button className="campus-back" type="button" onClick={onLeave}><ArrowLeft size={17} /> まなびメモへ</button>
          <p className="campus-kicker">CAMPUS MUSTER · ACADEMIC PLANNER</p>
          <h1>今日やることが、すぐ分かる。</h1>
          <p>授業・提出物・試験を、まなびメモの講義と一緒に管理します。</p>
        </div>
        <label className="campus-term-select">
          <span>表示する学期</span>
          <select value={termId} onChange={(event) => setTermId(event.target.value)}>
            {termOptions.map((term) => <option key={term}>{term}</option>)}
          </select>
        </label>
      </header>

      <nav className="campus-tabs" aria-label="Campus Musterメニュー">
        <CampusTab active={section === "today"} icon={<CircleGauge size={18} />} label="今日" onClick={() => setSection("today")} />
        <CampusTab active={section === "assignments"} icon={<ClipboardList size={18} />} label="提出物" onClick={() => setSection("assignments")} />
        <CampusTab active={section === "calendar"} icon={<CalendarDays size={18} />} label="カレンダー" onClick={() => setSection("calendar")} />
        <CampusTab active={section === "study"} icon={<ListTodo size={18} />} label="試験・学習" onClick={() => setSection("study")} />
        <CampusTab active={section === "progress"} icon={<GraduationCap size={18} />} label="長期確認" onClick={() => setSection("progress")} />
        <CampusTab active={section === "settings"} icon={<Settings2 size={18} />} label="設定" onClick={() => setSection("settings")} />
      </nav>

      {section === "today" && (
        <div className="campus-content">
          <section className="campus-stat-grid" aria-label="今学期の概要">
            <CampusStat label="未完了の提出物" value={String(assignments.filter((item) => item.status !== "done").length)} note="締切順に確認" />
            <CampusStat label="直近の試験" value={nextExams[0] ? formatShortDate(nextExams[0].datetime) : "なし"} note={nextExams[0]?.title ?? "登録済みの予定はありません"} />
            <CampusStat label="学習タスク" value={String(tasks.filter((task) => task.status === "todo").length)} note={normalized.planningProfile.supportMode === "off" ? "学習支援はOFF" : "自動生成を利用中"} />
          </section>

          <div className="campus-dashboard-grid">
            <CampusPanel title="今日の授業" icon={<BookOpen size={19} />} action={<button type="button" onClick={onLeave}>時間割で編集</button>}>
              {todayCourses.length === 0 ? <CampusEmpty text="今日の授業は時間割にありません。" /> : todayCourses.map((course) => {
                const attendance = normalized.attendanceRecords.find((record) => record.courseId === course.id && record.dateISO === todayISO);
                return (
                  <article className="today-course" key={course.id}>
                    <button type="button" className="today-course-main" onClick={() => onOpenCourse(course.id)}>
                      <span>{course.period ? `${course.period}限` : "時限未設定"}</span>
                      <strong>{course.title}</strong>
                      <small>{course.room || "教室未設定"}</small>
                    </button>
                    <div className="attendance-buttons" aria-label={`${course.title}の出席`}>
                      {(["present", "late", "absent"] as const).map((status) => (
                        <button key={status} className={attendance?.status === status ? "active" : ""} type="button" onClick={() => recordAttendance(course.id, course.period, status)}>
                          {status === "present" ? "出席" : status === "late" ? "遅刻" : "欠席"}
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </CampusPanel>

            <CampusPanel title="直近7日の提出物" icon={<ClipboardCheck size={19} />} action={<button type="button" onClick={() => setShowAssignmentForm(true)}><Plus size={14} /> 追加</button>}>
              {dueSoon.length === 0 ? <CampusEmpty text="近い締切の提出物はありません。" /> : dueSoon.map((item) => (
                <CampusListRow key={item.id} title={item.title} meta={`${courseName(item.courseId)} · ${formatDateTime(item.dueISO)}`} tone={daysUntil(item.dueISO) <= 1 ? "danger" : "normal"} action={<button type="button" onClick={() => updateAssignment(item.id, { status: "done" })}><Check size={15} /> 完了</button>} />
              ))}
            </CampusPanel>

            <CampusPanel title="次の試験" icon={<FileCheck2 size={19} />} action={<button type="button" onClick={() => setShowExamForm(true)}><Plus size={14} /> 追加</button>}>
              {nextExams.length === 0 ? <CampusEmpty text="これからの試験は登録されていません。" /> : nextExams.map((exam) => (
                <CampusListRow key={exam.id} title={exam.title} meta={`${courseName(exam.courseId)} · ${formatDateTime(exam.datetime)}`} tone={daysUntil(exam.datetime) <= 3 ? "danger" : "normal"} />
              ))}
            </CampusPanel>

            {normalized.planningProfile.showStudyOnDashboard && (
              <CampusPanel title="今日からの学習" icon={<Sparkles size={19} />} action={<button type="button" onClick={refreshTasks}><RefreshCw size={14} /> 更新</button>}>
                {tasks.filter((task) => task.status === "todo").slice(0, 5).length === 0 ? <CampusEmpty text="現在の学習タスクはありません。設定から任意で有効にできます。" /> : tasks.filter((task) => task.status === "todo").slice(0, 5).map((task) => (
                  <CampusListRow key={task.id} title={task.title} meta={`${formatShortDate(task.dueISO)}まで · ${task.intensity === "hard" ? "しっかり" : task.intensity === "light" ? "軽め" : "標準"}`} action={<button type="button" onClick={() => toggleTask(task.id)}><Check size={15} /> 完了</button>} />
                ))}
              </CampusPanel>
            )}
          </div>
        </div>
      )}

      {section === "assignments" && (
        <div className="campus-content">
          <CampusSectionHeading title="提出物" description="未完了を先に、同じ状態では締切順に表示します。" action={<button className="campus-primary" type="button" onClick={() => setShowAssignmentForm(true)}><Plus size={16} /> 提出物を追加</button>} />
          <div className="campus-record-list">
            {[...assignments].sort((a, b) => a.status === b.status ? a.dueISO.localeCompare(b.dueISO) : a.status === "done" ? 1 : -1).map((item) => (
              <article className={`campus-record ${item.status === "done" ? "done" : ""}`} key={item.id}>
                <div className="campus-record-date"><strong>{formatShortDate(item.dueISO)}</strong><span>{formatClock(item.dueISO)}</span></div>
                <div className="campus-record-body"><small>{courseName(item.courseId)} · 重要度{item.importance}</small><h3>{item.title}</h3><p>{item.note || `所要時間の目安 ${item.estimatedMinutes}分`}</p></div>
                <label className="campus-status-select"><span>状態</span><select value={item.status} onChange={(event) => updateAssignment(item.id, { status: event.target.value as CampusAssignment["status"] })}><option value="todo">未着手</option><option value="doing">進行中</option><option value="done">完了</option></select></label>
                <button className="icon-danger" type="button" aria-label={`${item.title}を削除`} onClick={() => deleteAssignment(item.id)}><Trash2 size={17} /></button>
              </article>
            ))}
            {assignments.length === 0 && <CampusEmpty text="今学期の提出物はまだありません。" />}
          </div>
        </div>
      )}

      {section === "calendar" && (
        <>
          <CampusCalendar month={calendarMonth} setMonth={setCalendarMonth} assignments={assignments} exams={exams} tasks={normalized.planningProfile.showStudyOnCalendar ? tasks : []} courseName={courseName} />
          <SharedCampusCalendar termLabel={termId} courseOptions={activeCourses.map((course) => course.title)} />
        </>
      )}

      {section === "study" && (
        <div className="campus-content">
          <CampusSectionHeading title="試験・学習" description="試験と提出物から、選んだペースに合わせて学習タスクを作ります。" action={<><button className="campus-secondary" type="button" onClick={refreshTasks}><RefreshCw size={16} /> タスク更新</button><button className="campus-primary" type="button" onClick={() => setShowExamForm(true)}><Plus size={16} /> 試験を追加</button></>} />
          <div className="campus-two-columns">
            <CampusPanel title="試験予定" icon={<FileCheck2 size={19} />}>
              {exams.length === 0 ? <CampusEmpty text="試験を登録すると、学習開始日の提案に使えます。" /> : [...exams].sort((a, b) => a.datetime.localeCompare(b.datetime)).map((exam) => (
                <CampusListRow key={exam.id} title={exam.title} meta={`${courseName(exam.courseId)} · ${formatDateTime(exam.datetime)}${exam.location ? ` · ${exam.location}` : ""}`} action={<button className="icon-danger" type="button" aria-label={`${exam.title}を削除`} onClick={() => deleteExam(exam.id)}><Trash2 size={15} /></button>} />
              ))}
            </CampusPanel>
            <CampusPanel title="学習タスク" icon={<ListTodo size={19} />}>
              {tasks.length === 0 ? <CampusEmpty text="学習支援は任意です。設定をOFFのままでも利用できます。" /> : tasks.map((task) => (
                <label className={`study-task-row ${task.status === "done" ? "done" : ""}`} key={task.id}>
                  <input type="checkbox" checked={task.status === "done"} onChange={() => toggleTask(task.id)} />
                  <span><strong>{task.title}</strong><small>{formatShortDate(task.dueISO)}まで</small></span>
                </label>
              ))}
            </CampusPanel>
          </div>
        </div>
      )}

      {section === "progress" && <CampusProgress state={normalized} courses={activeCourses} onChange={onChange} />}

      {section === "settings" && (
        <CampusSettings state={normalized} onChange={onChange} hasLegacyData={hasLegacyData} onImportLegacy={onImportLegacy} />
      )}

      {showAssignmentForm && <AssignmentForm courses={activeCourses} termId={termId} onClose={() => setShowAssignmentForm(false)} onSave={(assignment) => { setCampus({ assignments: [...normalized.assignments, assignment] }); setShowAssignmentForm(false); }} />}
      {showExamForm && <ExamForm courses={activeCourses} termId={termId} onClose={() => setShowExamForm(false)} onSave={(exam) => { setCampus({ exams: [...normalized.exams, exam] }); setShowExamForm(false); }} />}
    </div>
  );
}

function CampusAccessGate({ onLeave, onActivate, hasLegacyData, onImportLegacy, firebaseEnabled }: { onLeave: () => void; onActivate: () => void; hasLegacyData: boolean; onImportLegacy: () => void; firebaseEnabled: boolean | null }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus("checking"); setMessage("");
    try {
      const response = await authenticatedFetch("/api/campus-access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "招待コードを確認できませんでした。");
      onActivate();
    } catch (cause) {
      setStatus("error"); setMessage(cause instanceof Error ? cause.message : "招待コードを確認できませんでした。");
    }
  }
  return (
    <div className="campus-gate">
      <button className="campus-back" type="button" onClick={onLeave}><ArrowLeft size={17} /> まなびメモへ</button>
      <div className="campus-gate-card">
        <span className="campus-gate-icon"><LockKeyhole size={28} /></span>
        <p className="campus-kicker">CAMPUS MUSTER · ACADEMIC PLANNER</p>
        <h1>{firebaseEnabled === false ? "Campus Musterは準備中です。" : "大学生活の管理を、ひとつの場所へ。"}</h1>
        <p>{firebaseEnabled === false
          ? "Firebaseが設定されていないため、招待ベータの有効化はできません。時間割・ノート・PDFなど、まなびメモの端末内機能はそのまま利用できます。"
          : "提出物、今日の授業、試験、出席を、まなびメモの時間割とつなげて管理する限定ベータです。Firebaseログイン後、招待コードで有効化できます。"}</p>
        {hasLegacyData && <button className="legacy-import-button" type="button" onClick={onImportLegacy}><RefreshCw size={17} /> この端末の旧CMTRデータを引き継ぐ</button>}
        {firebaseEnabled !== false && <form className="campus-code-form" onSubmit={submit}>
          <label><span>招待コード</span><div><KeyRound size={18} /><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="コードを入力" autoComplete="one-time-code" /></div></label>
          <button className="campus-primary" type="submit" disabled={status === "checking" || !code.trim()}>{status === "checking" ? "確認中…" : "Campus Musterを有効にする"}</button>
        </form>}
        {message && <p className="campus-form-error" role="alert">{message}</p>}
        <small>{firebaseEnabled === false
          ? "Firebaseを設定すると、ログイン後に招待コードを確認できます。Campusデータも、まず端末内に保存されます。"
          : "データはまず端末内に保存されます。アカウント同期を有効にした場合だけ、同じアカウントの端末間で共有されます。"}</small>
      </div>
    </div>
  );
}

function CampusProgress({ state, courses, onChange }: { state: CampusState; courses: CampusCourse[]; onChange: (state: CampusState) => void }) {
  const projection = calculateGpaProjection(state.gpaProfile);
  const updateGpa = (patch: Partial<CampusState["gpaProfile"]>) => onChange({ ...state, gpaProfile: { ...state.gpaProfile, ...patch } });
  const addPlan = () => updateGpa({ plans: [...state.gpaProfile.plans, { id: campusId("grade"), courseId: courses[0]?.id ?? "", courseName: courses[0]?.title ?? "科目", credits: 2, targetGrade: "A" }] });
  const updatePlan = (id: string, patch: Partial<CampusState["gpaProfile"]["plans"][number]>) => updateGpa({ plans: state.gpaProfile.plans.map((plan) => plan.id === id ? { ...plan, ...patch } : plan) });
  const addCategory = () => onChange({ ...state, degreePlan: { categories: [...state.degreePlan.categories, { id: campusId("degree"), name: "専門科目", requiredCredits: 0, earnedCredits: 0 }] } });
  const updateCategory = (id: string, patch: Partial<CampusState["degreePlan"]["categories"][number]>) => onChange({ ...state, degreePlan: { categories: state.degreePlan.categories.map((category) => category.id === id ? { ...category, ...patch } : category) } });
  return (
    <div className="campus-content">
      <CampusSectionHeading title="長期確認" description="毎日見る画面からは分け、履修登録や学期の切り替わりに確認します。" />
      <div className="campus-two-columns progress-columns">
        <section className="campus-panel progress-panel">
          <div className="campus-panel-heading"><span><CircleGauge size={19} /></span><h2>GPA評価計画</h2></div>
          <div className="gpa-input-grid">
            <NumberField label="現在の累積GPA" value={state.gpaProfile.currentGpa} step="0.01" onChange={(value) => updateGpa({ currentGpa: value })} />
            <NumberField label="取得済み単位" value={state.gpaProfile.earnedCredits} onChange={(value) => updateGpa({ earnedCredits: value ?? 0 })} />
            <NumberField label="目標累積GPA" value={state.gpaProfile.targetCumulativeGpa} step="0.01" onChange={(value) => updateGpa({ targetCumulativeGpa: value })} />
            <NumberField label="制度上の最大GPA" value={state.gpaProfile.maxGpa} step="0.1" onChange={(value) => updateGpa({ maxGpa: value ?? 4.3 })} />
          </div>
          <div className="projection-cards">
            <CampusStat label="今学期の計画" value={projection.plannedGpa === null ? "未設定" : projection.plannedGpa.toFixed(2)} note={`${projection.plannedCredits}単位を計画`} />
            <CampusStat label="計画後の累積" value={projection.projectedCumulative === null ? "未設定" : projection.projectedCumulative.toFixed(2)} note={projection.requiredPlannedGpa !== null && projection.requiredPlannedGpa > state.gpaProfile.maxGpa ? "現在の科目数では目標到達が困難" : "科目ごとの評価目標から算出"} />
          </div>
          <div className="grade-plan-list">
            {state.gpaProfile.plans.map((plan) => <div className="grade-plan-row" key={plan.id}>
              <select value={plan.courseId} onChange={(event) => { const course = courses.find((item) => item.id === event.target.value); updatePlan(plan.id, { courseId: event.target.value, courseName: course?.title ?? plan.courseName }); }}><option value="">科目を選択</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select>
              <input aria-label="単位数" type="number" min="0" max="30" value={plan.credits} onChange={(event) => updatePlan(plan.id, { credits: Number(event.target.value) })} />
              <select aria-label="目標評価" value={plan.targetGrade} onChange={(event) => updatePlan(plan.id, { targetGrade: event.target.value as GradeCode })}>{(["S", "A", "B", "C", "D", "F"] as const).map((grade) => <option key={grade}>{grade}</option>)}</select>
              <button className="icon-danger" type="button" aria-label="評価計画を削除" onClick={() => updateGpa({ plans: state.gpaProfile.plans.filter((item) => item.id !== plan.id) })}><Trash2 size={16} /></button>
            </div>)}
          </div>
          <button className="campus-secondary full" type="button" onClick={addPlan}><Plus size={15} /> 科目の評価目標を追加</button>
          <p className="campus-note">大学・学部によって評価方式が異なるため、最大値と評価点は設定として保持します。公式の履修手引と照合して利用してください。</p>
        </section>

        <section className="campus-panel progress-panel">
          <div className="campus-panel-heading"><span><GraduationCap size={19} /></span><h2>卒業要件</h2></div>
          <div className="degree-total"><strong>{state.degreePlan.categories.reduce((sum, category) => sum + Math.min(category.earnedCredits, category.requiredCredits), 0)}</strong><span> / {state.degreePlan.categories.reduce((sum, category) => sum + category.requiredCredits, 0)} 単位</span></div>
          <div className="degree-list">
            {state.degreePlan.categories.map((category) => {
              const progress = category.requiredCredits > 0 ? Math.min(100, category.earnedCredits / category.requiredCredits * 100) : 0;
              return <div className="degree-row" key={category.id}>
                <input aria-label="区分名" value={category.name} onChange={(event) => updateCategory(category.id, { name: event.target.value })} />
                <div><label>取得 <input type="number" min="0" value={category.earnedCredits} onChange={(event) => updateCategory(category.id, { earnedCredits: Number(event.target.value) })} /></label><label>必要 <input type="number" min="0" value={category.requiredCredits} onChange={(event) => updateCategory(category.id, { requiredCredits: Number(event.target.value) })} /></label></div>
                <span className="degree-bar"><i style={{ width: `${progress}%` }} /></span>
                <small>{Math.max(0, category.requiredCredits - category.earnedCredits)}単位不足</small>
              </div>;
            })}
          </div>
          <button className="campus-secondary full" type="button" onClick={addCategory}><Plus size={15} /> 単位区分を追加</button>
          <p className="campus-note">総単位だけでなく、教養・専門など区分ごとの不足を確認するための記録です。</p>
        </section>
      </div>
    </div>
  );
}

function CampusSettings({ state, onChange, hasLegacyData, onImportLegacy }: { state: CampusState; onChange: (state: CampusState) => void; hasLegacyData: boolean; onImportLegacy: () => void }) {
  const profile = state.planningProfile;
  const setProfile = (patch: Partial<typeof profile>) => onChange({ ...state, planningProfile: { ...profile, ...patch } });
  return <div className="campus-content">
    <CampusSectionHeading title="Campus Muster設定" description="学習支援は任意です。OFFでも提出物・授業・試験管理はすべて利用できます。" />
    <div className="settings-card-grid">
      <section className="campus-panel settings-panel">
        <div className="campus-panel-heading"><span><Clock3 size={19} /></span><h2>実行支援</h2></div>
        <label><span>提出物への着手</span><select value={profile.style} onChange={(event) => setProfile({ style: event.target.value as typeof profile.style })}><option value="early">早め</option><option value="normal">標準</option><option value="lastMinute">直前</option></select></label>
        <label><span>試験の学習サポート</span><select value={profile.supportMode} onChange={(event) => setProfile({ supportMode: event.target.value as typeof profile.supportMode })}><option value="off">OFF</option><option value="lastMinute">直前型</option><option value="standard">標準</option><option value="steady">着実型</option></select></label>
        <label className="switch-row"><span>今日の画面に学習タスクを表示</span><input type="checkbox" checked={profile.showStudyOnDashboard} onChange={(event) => setProfile({ showStudyOnDashboard: event.target.checked })} /></label>
        <label className="switch-row"><span>カレンダーに学習タスクを表示</span><input type="checkbox" checked={profile.showStudyOnCalendar} onChange={(event) => setProfile({ showStudyOnCalendar: event.target.checked })} /></label>
      </section>
      <section className="campus-panel settings-panel">
        <div className="campus-panel-heading"><span><RefreshCw size={19} /></span><h2>旧CMTRから移行</h2></div>
        <p>この端末に残っている`cmtr:*`データを検査し、講義IDなどの参照を維持して取り込みます。元データは自動削除しません。</p>
        <button className="campus-secondary full" type="button" disabled={!hasLegacyData} onClick={onImportLegacy}>{hasLegacyData ? "旧データを取り込む" : "旧データは見つかりませんでした"}</button>
      </section>
      <section className="campus-panel settings-panel">
        <div className="campus-panel-heading"><span><LockKeyhole size={19} /></span><h2>許可メンバー共有</h2></div>
        <p>個人のノート・PDF・時間割はアカウントごとに分離したまま、共有カレンダーだけを許可された2〜3人で確認できます。</p>
        <dl className="beta-details"><div><dt>個人データ</dt><dd>アカウントごと</dd></div><div><dt>共有対象</dt><dd>課題・予定・完了</dd></div><div><dt>公開共有</dt><dd>使用しない</dd></div></dl>
      </section>
    </div>
  </div>;
}

function AssignmentForm({ courses, termId, onClose, onSave }: { courses: CampusCourse[]; termId: string; onClose: () => void; onSave: (value: CampusAssignment) => void }) {
  const [courseId, setCourseId] = useState(courses[0]?.id ?? ""); const [title, setTitle] = useState(""); const [dueISO, setDueISO] = useState(`${localDateISO(new Date())}T23:59`); const [importance, setImportance] = useState<1 | 2 | 3>(2); const [minutes, setMinutes] = useState(60); const [note, setNote] = useState("");
  return <CampusModal title="提出物を追加" onClose={onClose}><form className="campus-entry-form" onSubmit={(event) => { event.preventDefault(); if (!title.trim() || !dueISO) return; onSave({ id: campusId("assignment"), courseId, termId, title: title.trim(), dueISO, status: "todo", type: "課題", importance, estimatedMinutes: minutes, note, createdAt: new Date().toISOString() }); }}>
    <label><span>講義</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">講義未設定</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
    <label><span>提出物名</span><input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例：第3回レポート" /></label>
    <div className="campus-form-grid"><label><span>締切</span><input required type="datetime-local" value={dueISO} onChange={(event) => setDueISO(event.target.value)} /></label><label><span>重要度</span><select value={importance} onChange={(event) => setImportance(Number(event.target.value) as 1 | 2 | 3)}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label></div>
    <label><span>所要時間の目安</span><input type="number" min="0" max="100000" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
    <label><span>メモ</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
    <div className="campus-modal-actions"><button type="button" className="campus-secondary" onClick={onClose}>キャンセル</button><button type="submit" className="campus-primary">保存</button></div>
  </form></CampusModal>;
}

function ExamForm({ courses, termId, onClose, onSave }: { courses: CampusCourse[]; termId: string; onClose: () => void; onSave: (value: CampusExam) => void }) {
  const [courseId, setCourseId] = useState(courses[0]?.id ?? ""); const [title, setTitle] = useState(""); const [datetime, setDatetime] = useState(`${localDateISO(new Date())}T09:00`); const [examType, setExamType] = useState<CampusExam["examType"]>("other"); const [location, setLocation] = useState(""); const [note, setNote] = useState("");
  return <CampusModal title="試験を追加" onClose={onClose}><form className="campus-entry-form" onSubmit={(event) => { event.preventDefault(); if (!title.trim() || !datetime) return; onSave({ id: campusId("exam"), courseId, termId, title: title.trim(), datetime, examType, location, note, createdAt: new Date().toISOString() }); }}>
    <label><span>講義</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">講義未設定</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
    <label><span>試験名</span><input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例：期末試験" /></label>
    <div className="campus-form-grid"><label><span>日時</span><input required type="datetime-local" value={datetime} onChange={(event) => setDatetime(event.target.value)} /></label><label><span>種類</span><select value={examType} onChange={(event) => setExamType(event.target.value as CampusExam["examType"])}><option value="quiz">小テスト</option><option value="midterm">中間</option><option value="final">期末</option><option value="other">その他</option></select></label></div>
    <label><span>教室</span><input value={location} onChange={(event) => setLocation(event.target.value)} /></label><label><span>メモ</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
    <div className="campus-modal-actions"><button type="button" className="campus-secondary" onClick={onClose}>キャンセル</button><button type="submit" className="campus-primary">保存</button></div>
  </form></CampusModal>;
}

function CampusCalendar({ month, setMonth, assignments, exams, tasks, courseName }: { month: string; setMonth: (value: string) => void; assignments: CampusAssignment[]; exams: CampusExam[]; tasks: CampusState["studyTasks"]; courseName: (id: string) => string }) {
  const monthStart = new Date(`${month}-01T12:00:00`); const firstDay = monthStart.getDay(); const days = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate(); const cells = Array.from({ length: firstDay + days }, (_, index) => index < firstDay ? null : index - firstDay + 1);
  const move = (delta: number) => { const next = new Date(monthStart); next.setMonth(next.getMonth() + delta); setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`); };
  return <div className="campus-content"><CampusSectionHeading title="カレンダー" description="提出物・試験・学習タスクを同じ月で確認します。" action={<div className="month-actions"><button type="button" onClick={() => move(-1)}><ChevronLeft size={17} /></button><strong>{monthStart.getFullYear()}年{monthStart.getMonth() + 1}月</strong><button type="button" onClick={() => move(1)}><ChevronRight size={17} /></button></div>} />
    <div className="campus-calendar"><div className="calendar-weekdays">{["日", "月", "火", "水", "木", "金", "土"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{cells.map((day, index) => { const date = day ? `${month}-${String(day).padStart(2, "0")}` : ""; const events = day ? [...assignments.filter((item) => item.dueISO.startsWith(date)).map((item) => ({ id: item.id, kind: "assignment", title: item.title, course: courseName(item.courseId) })), ...exams.filter((item) => item.datetime.startsWith(date)).map((item) => ({ id: item.id, kind: "exam", title: item.title, course: courseName(item.courseId) })), ...tasks.filter((item) => item.dueISO === date && item.status === "todo").map((item) => ({ id: item.id, kind: "study", title: item.title, course: "学習" }))] : []; return <div className={`calendar-cell ${date === localDateISO(new Date()) ? "today" : ""}`} key={`${day}-${index}`}><span>{day}</span>{events.slice(0, 4).map((event) => <div className={`calendar-event ${event.kind}`} key={`${event.kind}-${event.id}`} title={`${event.course} ${event.title}`}><small>{event.course}</small>{event.title}</div>)}{events.length > 4 && <small className="calendar-more">ほか{events.length - 4}件</small>}</div>; })}</div></div>
  </div>;
}

function CampusModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="campus-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="campus-modal" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="閉じる">×</button></header>{children}</section></div>; }
function CampusTab({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) { return <button type="button" className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span></button>; }
function CampusStat({ label, value, note }: { label: string; value: string; note: string }) { return <article className="campus-stat"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function CampusPanel({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) { return <section className="campus-panel"><div className="campus-panel-heading"><span>{icon}</span><h2>{title}</h2>{action && <div className="campus-panel-action">{action}</div>}</div><div className="campus-panel-body">{children}</div></section>; }
function CampusSectionHeading({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) { return <header className="campus-section-heading"><div><h2>{title}</h2><p>{description}</p></div>{action && <div>{action}</div>}</header>; }
function CampusEmpty({ text }: { text: string }) { return <div className="campus-empty"><ClipboardCheck size={20} /><p>{text}</p></div>; }
function CampusListRow({ title, meta, action, tone = "normal" }: { title: string; meta: string; action?: React.ReactNode; tone?: "normal" | "danger" }) { return <article className={`campus-list-row ${tone}`}><span><strong>{title}</strong><small>{meta}</small></span>{action && <div>{action}</div>}</article>; }
function NumberField({ label, value, step = "1", onChange }: { label: string; value: number | null; step?: string; onChange: (value: number | null) => void }) { return <label><span>{label}</span><input type="number" min="0" step={step} value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} /></label>; }
function formatShortDate(value: string) { const date = new Date(value.length === 10 ? `${value}T12:00:00` : value); return Number.isNaN(date.getTime()) ? value.slice(0, 10) : `${date.getMonth() + 1}/${date.getDate()}`; }
function formatClock(value: string) { return value.includes("T") ? value.slice(11, 16) : "終日"; }
function formatDateTime(value: string) { return `${formatShortDate(value)} ${formatClock(value)}`; }
function daysUntil(value: string) { const target = new Date(`${value.slice(0, 10)}T12:00:00`).getTime(); const today = new Date(`${localDateISO(new Date())}T12:00:00`).getTime(); return Math.round((target - today) / 86400000); }
function campusId(prefix: string) {
  const bytes = new Uint8Array(10);
  globalThis.crypto?.getRandomValues?.(bytes);
  const random = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("");
  return `${prefix}-${Date.now().toString(36)}-${random || Math.random().toString(36).slice(2)}`;
}
