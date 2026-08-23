export type AssignmentStatus = "todo" | "doing" | "done";
export type AttendanceStatus = "present" | "late" | "absent";
export type StudySupportMode = "off" | "lastMinute" | "standard" | "steady";
export type AssignmentStyle = "early" | "normal" | "lastMinute";
export type StudyTaskStatus = "todo" | "done";
export type StudyTaskSource = "exam" | "assignment";

export type CampusAssignment = {
  id: string;
  courseId: string;
  termId: string;
  title: string;
  dueISO: string;
  status: AssignmentStatus;
  type: string;
  importance: 1 | 2 | 3;
  estimatedMinutes: number;
  note: string;
  createdAt: string;
};

export type CampusExam = {
  id: string;
  courseId: string;
  termId: string;
  title: string;
  datetime: string;
  examType: "quiz" | "midterm" | "final" | "other";
  location: string;
  note: string;
  createdAt: string;
};

export type CampusAttendance = {
  id: string;
  courseId: string;
  dateISO: string;
  period: number | null;
  status: AttendanceStatus;
  createdAt: string;
};

export type CampusAssignmentTemplate = {
  id: string;
  courseId: string;
  termId: string;
  title: string;
  weekday: number;
  dueTime: string;
  enabled: boolean;
  note: string;
};

export type CampusStudyTask = {
  id: string;
  termId: string;
  sourceType: StudyTaskSource;
  sourceId: string;
  title: string;
  dueISO: string;
  intensity: "light" | "normal" | "hard";
  status: StudyTaskStatus;
  doneAtISO: string | null;
  note: string;
};

export type CampusPlanningProfile = {
  style: AssignmentStyle;
  earlyDaysBeforeDue: number;
  normalDaysBeforeDue: number;
  lastMinuteDaysBeforeDue: number;
  supportMode: StudySupportMode;
  showStudyOnDashboard: boolean;
  showStudyOnCalendar: boolean;
};

export type GradeCode = "S" | "A" | "B" | "C" | "D" | "F";

export type CampusGradePlan = {
  id: string;
  courseId: string;
  courseName: string;
  credits: number;
  targetGrade: GradeCode;
};

export type CampusGpaProfile = {
  currentGpa: number | null;
  earnedCredits: number;
  targetCumulativeGpa: number | null;
  maxGpa: number;
  gradePoints: Record<GradeCode, number>;
  plans: CampusGradePlan[];
};

export type CampusDegreeCategory = {
  id: string;
  name: string;
  requiredCredits: number;
  earnedCredits: number;
};

export type CampusDegreePlan = {
  categories: CampusDegreeCategory[];
};

export type CampusBetaAccess = {
  enabled: boolean;
  activatedAt: string | null;
  importedLegacyAt: string | null;
};

export type CampusState = {
  schemaVersion: 1;
  betaAccess: CampusBetaAccess;
  assignments: CampusAssignment[];
  assignmentTemplates: CampusAssignmentTemplate[];
  exams: CampusExam[];
  attendanceRecords: CampusAttendance[];
  studyTasks: CampusStudyTask[];
  planningProfile: CampusPlanningProfile;
  gpaProfile: CampusGpaProfile;
  degreePlan: CampusDegreePlan;
};

export type LegacyCampusCourse = {
  id: string;
  title: string;
  termId: string;
  termName: string;
  instructor: string;
  weekday: number | null;
  period: number | null;
  room: string;
  createdAt: string;
};

export type LegacyCampusBundle = {
  campus: CampusState;
  courses: LegacyCampusCourse[];
  termNames: string[];
  activeTermName: string;
  activeTermId: string;
  termViewMode: "active" | "all";
};

export const DEFAULT_PLANNING_PROFILE: CampusPlanningProfile = {
  style: "normal",
  earlyDaysBeforeDue: 7,
  normalDaysBeforeDue: 3,
  lastMinuteDaysBeforeDue: 1,
  supportMode: "off",
  showStudyOnDashboard: true,
  showStudyOnCalendar: true,
};

export const DEFAULT_GPA_PROFILE: CampusGpaProfile = {
  currentGpa: null,
  earnedCredits: 0,
  targetCumulativeGpa: null,
  maxGpa: 4.3,
  gradePoints: { S: 4.3, A: 4, B: 3, C: 2, D: 1, F: 0 },
  plans: [],
};

export const EMPTY_CAMPUS_STATE: CampusState = {
  schemaVersion: 1,
  betaAccess: { enabled: false, activatedAt: null, importedLegacyAt: null },
  assignments: [],
  assignmentTemplates: [],
  exams: [],
  attendanceRecords: [],
  studyTasks: [],
  planningProfile: DEFAULT_PLANNING_PROFILE,
  gpaProfile: DEFAULT_GPA_PROFILE,
  degreePlan: { categories: [] },
};

export function normalizeCampusState(value: unknown): CampusState {
  const source = isRecord(value) ? value : {};
  const access = isRecord(source.betaAccess) ? source.betaAccess : {};
  const planning = isRecord(source.planningProfile) ? source.planningProfile : {};
  const gpa = isRecord(source.gpaProfile) ? source.gpaProfile : {};
  const degree = isRecord(source.degreePlan) ? source.degreePlan : {};
  const gradePoints = isRecord(gpa.gradePoints) ? gpa.gradePoints : {};
  return {
    schemaVersion: 1,
    betaAccess: {
      enabled: access.enabled === true,
      activatedAt: optionalString(access.activatedAt),
      importedLegacyAt: optionalString(access.importedLegacyAt),
    },
    assignments: arrayOf(source.assignments, normalizeAssignment),
    assignmentTemplates: arrayOf(source.assignmentTemplates, normalizeTemplate),
    exams: arrayOf(source.exams, normalizeExam),
    attendanceRecords: arrayOf(source.attendanceRecords, normalizeAttendance),
    studyTasks: arrayOf(source.studyTasks, normalizeStudyTask),
    planningProfile: {
      style: oneOf(planning.style, ["early", "normal", "lastMinute"] as const, DEFAULT_PLANNING_PROFILE.style),
      earlyDaysBeforeDue: boundedNumber(planning.earlyDaysBeforeDue, 0, 60, 7),
      normalDaysBeforeDue: boundedNumber(planning.normalDaysBeforeDue, 0, 60, 3),
      lastMinuteDaysBeforeDue: boundedNumber(planning.lastMinuteDaysBeforeDue, 0, 60, 1),
      supportMode: oneOf(planning.supportMode, ["off", "lastMinute", "standard", "steady"] as const, "off"),
      showStudyOnDashboard: planning.showStudyOnDashboard !== false,
      showStudyOnCalendar: planning.showStudyOnCalendar !== false,
    },
    gpaProfile: {
      currentGpa: optionalBoundedNumber(gpa.currentGpa, 0, 10),
      earnedCredits: boundedNumber(gpa.earnedCredits, 0, 999, 0),
      targetCumulativeGpa: optionalBoundedNumber(gpa.targetCumulativeGpa, 0, 10),
      maxGpa: boundedNumber(gpa.maxGpa, 1, 10, 4.3),
      gradePoints: {
        S: boundedNumber(gradePoints.S, 0, 10, 4.3),
        A: boundedNumber(gradePoints.A, 0, 10, 4),
        B: boundedNumber(gradePoints.B, 0, 10, 3),
        C: boundedNumber(gradePoints.C, 0, 10, 2),
        D: boundedNumber(gradePoints.D, 0, 10, 1),
        F: boundedNumber(gradePoints.F, 0, 10, 0),
      },
      plans: arrayOf(gpa.plans, normalizeGradePlan),
    },
    degreePlan: { categories: arrayOf(degree.categories, normalizeDegreeCategory) },
  };
}

export function refreshGeneratedStudyTasks(state: CampusState, todayISO = localDateISO(new Date())) {
  const next = normalizeCampusState(state);
  const existing = new Map(next.studyTasks.map((task) => [task.id, task]));
  const generated: CampusStudyTask[] = [];
  const examOffsets = next.planningProfile.supportMode === "steady"
    ? [14, 7, 3, 1]
    : next.planningProfile.supportMode === "standard"
      ? [7, 3, 1]
      : next.planningProfile.supportMode === "lastMinute" ? [1] : [];

  for (const exam of next.exams) {
    const examDate = datePart(exam.datetime);
    if (!examDate || examDate < todayISO) continue;
    for (const offset of examOffsets) {
      const dueISO = addDays(examDate, -offset);
      if (dueISO < todayISO) continue;
      const id = `study-exam-${exam.id}-${offset}`;
      generated.push(existing.get(id) ?? {
        id,
        termId: exam.termId,
        sourceType: "exam",
        sourceId: exam.id,
        title: `${exam.title}：${offset}日前の準備`,
        dueISO,
        intensity: offset <= 1 ? "hard" : offset <= 3 ? "normal" : "light",
        status: "todo",
        doneAtISO: null,
        note: "",
      });
    }
  }

  const styleKey = `${next.planningProfile.style}DaysBeforeDue` as const;
  const assignmentOffset = next.planningProfile[styleKey];
  for (const assignment of next.assignments) {
    const dueISO = datePart(assignment.dueISO);
    if (!dueISO || dueISO < todayISO || assignment.status === "done") continue;
    const taskDueISO = addDays(dueISO, -assignmentOffset);
    if (taskDueISO < todayISO) continue;
    const id = `study-assignment-${assignment.id}-${assignmentOffset}`;
    generated.push(existing.get(id) ?? {
      id,
      termId: assignment.termId,
      sourceType: "assignment",
      sourceId: assignment.id,
      title: `提出物 着手：${assignment.title}`,
      dueISO: taskDueISO,
      intensity: assignment.estimatedMinutes >= 180 ? "hard" : assignment.estimatedMinutes >= 60 ? "normal" : "light",
      status: "todo",
      doneAtISO: null,
      note: "",
    });
  }

  const sourceStillExists = (task: CampusStudyTask) => task.sourceType === "exam"
    ? next.exams.some((exam) => exam.id === task.sourceId)
    : next.assignments.some((assignment) => assignment.id === task.sourceId);
  const generatedIds = new Set(generated.map((task) => task.id));
  next.studyTasks = [
    ...generated,
    ...next.studyTasks.filter((task) => !generatedIds.has(task.id) && sourceStillExists(task) && task.status === "done"),
  ];
  return next;
}

export function sortStudyTasks(tasks: CampusStudyTask[]) {
  return [...tasks].sort((left, right) => {
    if (left.status !== right.status) return left.status === "todo" ? -1 : 1;
    return left.dueISO.localeCompare(right.dueISO);
  });
}

export function isArchivedStudyTask(task: CampusStudyTask, todayISO = localDateISO(new Date())) {
  if (task.status !== "done" || !task.doneAtISO) return false;
  return addDays(datePart(task.doneAtISO), 14) < todayISO;
}

/**
 * Returns true for a date in the inclusive window starting today. Campus's
 * 「直近7日」 card therefore means today through six days from today, rather
 * than every future item truncated to an arbitrary number of rows.
 */
export function isWithinNextDays(value: string, todayISO = localDateISO(new Date()), days = 7) {
  const target = datePart(value);
  const windowDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 7;
  if (!target || !/^\d{4}-\d{2}-\d{2}$/.test(todayISO)) return false;
  return target >= todayISO && target <= addDays(todayISO, windowDays - 1);
}

export function calculateGpaProjection(profile: CampusGpaProfile) {
  const plannedCredits = profile.plans.reduce((sum, plan) => sum + plan.credits, 0);
  const plannedPoints = profile.plans.reduce(
    (sum, plan) => sum + plan.credits * (profile.gradePoints[plan.targetGrade] ?? 0),
    0,
  );
  const plannedGpa = plannedCredits > 0 ? plannedPoints / plannedCredits : null;
  const totalCredits = profile.earnedCredits + plannedCredits;
  const projectedCumulative = totalCredits > 0 && profile.currentGpa !== null
    ? ((profile.currentGpa * profile.earnedCredits) + plannedPoints) / totalCredits
    : plannedGpa;
  const requiredPlannedGpa = profile.targetCumulativeGpa !== null && plannedCredits > 0 && profile.currentGpa !== null
    ? ((profile.targetCumulativeGpa * totalCredits) - (profile.currentGpa * profile.earnedCredits)) / plannedCredits
    : null;
  return { plannedCredits, plannedGpa, projectedCumulative, requiredPlannedGpa };
}

export function readLegacyCampusBundle(storage: Pick<Storage, "getItem">, fallbackTerm: string): LegacyCampusBundle | null {
  const parse = (key: string): unknown => {
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    try { return JSON.parse(raw); } catch { return undefined; }
  };
  const hasLegacy = [
    "cmtr:courses", "cmtr:timetable", "cmtr:terms", "cmtr:activeTermId", "cmtr:termViewMode",
    "cmtr:assignments", "cmtr:assignmentTemplates", "cmtr:exams", "cmtr:attendanceRecords",
    "cmtr:studyTasks", "cmtr:planningProfile", "cmtr:gpaProfile", "cmtr:degreePlan",
  ].some((key) => storage.getItem(key));
  if (!hasLegacy) return null;

  const terms = normalizeLegacyTerms(parse("cmtr:terms"));
  const storedActiveTermId = typeof parse("cmtr:activeTermId") === "string" ? String(parse("cmtr:activeTermId")) : "";
  const activeTerm = terms.find((term) => term.id === storedActiveTermId);
  const activeTermId = (activeTerm?.id ?? storedActiveTermId) || fallbackTerm;
  const activeTermName = activeTerm?.name ?? fallbackTerm;
  const timetableSlots = readLegacyTimetableSlots(parse("cmtr:timetable"));
  const courses = normalizeLegacyCourses(parse("cmtr:courses"), terms, timetableSlots, activeTermId, activeTermName);
  const termById = new Map(terms.map((term) => [term.id, term.name]));
  const courseTermById = new Map(courses.map((course) => [course.id, course.termName]));
  const sourceTermById = legacySourceTerms(
    [parse("cmtr:assignments"), parse("cmtr:exams")],
    termById,
    courseTermById,
    activeTermName,
  );
  const campus = normalizeCampusState({
    assignments: remapLegacyTermReferences(parse("cmtr:assignments"), termById, courseTermById, sourceTermById, activeTermName),
    assignmentTemplates: remapLegacyTermReferences(parse("cmtr:assignmentTemplates"), termById, courseTermById, sourceTermById, activeTermName),
    exams: remapLegacyTermReferences(parse("cmtr:exams"), termById, courseTermById, sourceTermById, activeTermName),
    attendanceRecords: parse("cmtr:attendanceRecords"),
    studyTasks: remapLegacyTermReferences(parse("cmtr:studyTasks"), termById, courseTermById, sourceTermById, activeTermName),
    planningProfile: parse("cmtr:planningProfile"),
    gpaProfile: parse("cmtr:gpaProfile"),
    degreePlan: parse("cmtr:degreePlan"),
    betaAccess: { enabled: true, importedLegacyAt: new Date().toISOString() },
  });
  const referencedTermNames = [
    ...campus.assignments,
    ...campus.assignmentTemplates,
    ...campus.exams,
    ...campus.studyTasks,
  ].map((item) => item.termId);
  return {
    campus,
    courses,
    termNames: Array.from(new Set([
      fallbackTerm,
      ...terms.map((term) => term.name),
      ...courses.map((course) => course.termName),
      ...referencedTermNames,
    ])),
    activeTermName,
    activeTermId,
    termViewMode: parse("cmtr:termViewMode") === "active" ? "active" : "all",
  };
}

export function readLegacyCampusState(storage: Pick<Storage, "getItem">, fallbackTerm: string) {
  return readLegacyCampusBundle(storage, fallbackTerm)?.campus ?? null;
}

function normalizeLegacyTerms(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ id: string; name: string }>;
  return value.flatMap((item) => {
    if (!isRecord(item) || !requiredString(item.id) || !requiredString(item.name)) return [];
    return [{ id: String(item.id), name: String(item.name).slice(0, 100) }];
  });
}

function normalizeLegacyCourses(
  value: unknown,
  terms: Array<{ id: string; name: string }>,
  timetableSlots: Map<string, { weekday: number; period: number }>,
  fallbackTermId: string,
  fallbackTermName: string,
) {
  if (!Array.isArray(value)) return [] as LegacyCampusCourse[];
  const termById = new Map(terms.map((term) => [term.id, term.name]));
  return value.flatMap((item) => {
    if (!isRecord(item) || !requiredString(item.id)) return [];
    const title = optionalString(item.title) ?? optionalString(item.name) ?? optionalString(item.courseName);
    if (!title) return [];
    const termId = optionalString(item.termId) ?? fallbackTermId;
    const slot = timetableSlots.get(String(item.id));
    const rawWeekday = typeof item.weekday === "number" ? Math.round(item.weekday) : null;
    const rawPeriod = typeof item.period === "number" ? Math.round(item.period) : null;
    return [{
      id: String(item.id),
      title: title.slice(0, 160),
      termId,
      termName: termById.get(termId) ?? optionalString(item.term) ?? fallbackTermName,
      instructor: optionalString(item.instructor) ?? optionalString(item.teacher) ?? "",
      weekday: rawWeekday && rawWeekday >= 1 && rawWeekday <= 6 ? rawWeekday : slot?.weekday ?? null,
      period: rawPeriod && rawPeriod >= 1 && rawPeriod <= 10 ? rawPeriod : slot?.period ?? null,
      room: optionalString(item.room) ?? optionalString(item.classroom) ?? optionalString(item.location) ?? "",
      createdAt: optionalString(item.createdAt) ?? new Date().toISOString(),
    }];
  });
}

function readLegacyTimetableSlots(value: unknown) {
  const slots = new Map<string, { weekday: number; period: number }>();
  const weekdayByKey: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const courseIdFrom = (cell: unknown) => typeof cell === "string"
    ? cell
    : isRecord(cell) && requiredString(cell.courseId) ? String(cell.courseId) : "";
  if (isRecord(value)) {
    for (const [key, weekday] of Object.entries(weekdayByKey)) {
      const cells = value[key];
      if (!Array.isArray(cells)) continue;
      cells.forEach((cell, index) => {
        const courseId = courseIdFrom(cell);
        if (courseId && !slots.has(courseId)) slots.set(courseId, { weekday, period: index + 1 });
      });
    }
  }
  if (Array.isArray(value)) {
    for (const cell of value) {
      if (!isRecord(cell)) continue;
      const courseId = courseIdFrom(cell);
      const weekday = typeof cell.weekday === "number" ? Math.round(cell.weekday) : weekdayByKey[String(cell.day ?? "")];
      const period = typeof cell.period === "number" ? Math.round(cell.period) : 0;
      if (courseId && weekday >= 1 && weekday <= 6 && period >= 1 && period <= 10 && !slots.has(courseId)) {
        slots.set(courseId, { weekday, period });
      }
    }
  }
  return slots;
}

function normalizeAssignment(value: unknown): CampusAssignment | null {
  if (!isRecord(value) || !requiredString(value.id) || !requiredString(value.title) || !requiredString(value.dueISO)) return null;
  return {
    id: String(value.id), courseId: optionalString(value.courseId) ?? "", termId: optionalString(value.termId) ?? "学期未設定",
    title: String(value.title).slice(0, 160), dueISO: String(value.dueISO),
    status: oneOf(value.status, ["todo", "doing", "done"] as const, "todo"),
    type: optionalString(value.type) ?? "課題", importance: oneOf(value.importance, [1, 2, 3] as const, 2),
    estimatedMinutes: boundedNumber(value.estimatedMinutes, 0, 100000, 60), note: optionalString(value.note) ?? "",
    createdAt: optionalString(value.createdAt) ?? new Date().toISOString(),
  };
}

function normalizeExam(value: unknown): CampusExam | null {
  if (!isRecord(value) || !requiredString(value.id) || !requiredString(value.datetime)) return null;
  return {
    id: String(value.id), courseId: optionalString(value.courseId) ?? "", termId: optionalString(value.termId) ?? "学期未設定",
    title: (optionalString(value.title) ?? optionalString(value.courseName) ?? "試験").slice(0, 160), datetime: String(value.datetime),
    examType: oneOf(value.examType, ["quiz", "midterm", "final", "other"] as const, "other"),
    location: optionalString(value.location) ?? "", note: optionalString(value.note) ?? "",
    createdAt: optionalString(value.createdAt) ?? new Date().toISOString(),
  };
}

function normalizeAttendance(value: unknown): CampusAttendance | null {
  if (!isRecord(value) || !requiredString(value.courseId) || !requiredString(value.dateISO)) return null;
  return {
    id: optionalString(value.id) ?? `attendance-${value.courseId}-${datePart(String(value.dateISO))}`,
    courseId: String(value.courseId), dateISO: datePart(String(value.dateISO)),
    period: typeof value.period === "number" ? Math.round(value.period) : null,
    status: oneOf(value.status, ["present", "late", "absent"] as const, "present"),
    createdAt: optionalString(value.createdAt) ?? new Date().toISOString(),
  };
}

function normalizeTemplate(value: unknown): CampusAssignmentTemplate | null {
  if (!isRecord(value) || !requiredString(value.id) || !requiredString(value.title)) return null;
  return {
    id: String(value.id), courseId: optionalString(value.courseId) ?? "", termId: optionalString(value.termId) ?? "学期未設定",
    title: String(value.title).slice(0, 160), weekday: boundedNumber(value.weekday, 0, 6, 1),
    dueTime: optionalString(value.dueTime) ?? "23:59", enabled: value.enabled !== false, note: optionalString(value.note) ?? "",
  };
}

function normalizeStudyTask(value: unknown): CampusStudyTask | null {
  if (!isRecord(value) || !requiredString(value.id) || !requiredString(value.sourceId) || !requiredString(value.dueISO)) return null;
  const status = oneOf(value.status, ["todo", "done"] as const, "todo");
  return {
    id: String(value.id), termId: optionalString(value.termId) ?? "学期未設定",
    sourceType: oneOf(value.sourceType, ["exam", "assignment"] as const, "exam"), sourceId: String(value.sourceId),
    title: (optionalString(value.title) ?? "学習タスク").slice(0, 180), dueISO: datePart(String(value.dueISO)),
    intensity: oneOf(value.intensity, ["light", "normal", "hard"] as const, "normal"), status,
    doneAtISO: status === "done" ? optionalString(value.doneAtISO)?.slice(0, 10) ?? localDateISO(new Date()) : null,
    note: optionalString(value.note) ?? "",
  };
}

function normalizeGradePlan(value: unknown): CampusGradePlan | null {
  if (!isRecord(value) || !requiredString(value.id)) return null;
  return {
    id: String(value.id), courseId: optionalString(value.courseId) ?? "", courseName: optionalString(value.courseName) ?? "科目",
    credits: boundedNumber(value.credits, 0, 30, 2), targetGrade: oneOf(value.targetGrade, ["S", "A", "B", "C", "D", "F"] as const, "A"),
  };
}

function normalizeDegreeCategory(value: unknown): CampusDegreeCategory | null {
  if (!isRecord(value) || !requiredString(value.id) || !requiredString(value.name)) return null;
  return {
    id: String(value.id), name: String(value.name).slice(0, 100), requiredCredits: boundedNumber(value.requiredCredits, 0, 999, 0),
    earnedCredits: boundedNumber(value.earnedCredits, 0, 999, 0),
  };
}

function remapLegacyTermReferences(
  value: unknown,
  termById: ReadonlyMap<string, string>,
  courseTermById: ReadonlyMap<string, string>,
  sourceTermById: ReadonlyMap<string, string>,
  fallbackTermName: string,
) {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!isRecord(item)) return item;
    const rawTermId = optionalString(item.termId);
    const courseId = optionalString(item.courseId);
    const sourceId = optionalString(item.sourceId);
    // Old CMTR records used opaque term IDs while the current Campus UI uses
    // the persisted term name.  Prefer the explicit term mapping, then infer
    // from the linked course/source so a partially written old record still
    // lands in the right semester.  Keep unknown non-empty values rather than
    // dropping a user's data.
    const termName = (rawTermId && termById.get(rawTermId))
      ?? (sourceId && sourceTermById.get(sourceId))
      ?? (courseId && courseTermById.get(courseId))
      ?? rawTermId
      ?? fallbackTermName;
    return { ...item, termId: termName };
  });
}

function legacySourceTerms(
  values: unknown[],
  termById: ReadonlyMap<string, string>,
  courseTermById: ReadonlyMap<string, string>,
  fallbackTermName: string,
) {
  const sourceTerms = new Map<string, string>();
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!isRecord(item)) continue;
      const id = optionalString(item.id);
      if (!id) continue;
      const rawTermId = optionalString(item.termId);
      const courseId = optionalString(item.courseId);
      const termName = (rawTermId && termById.get(rawTermId))
        ?? (courseId && courseTermById.get(courseId))
        ?? rawTermId
        ?? fallbackTermName;
      sourceTerms.set(id, termName);
    }
  }
  return sourceTerms;
}

function arrayOf<T>(value: unknown, normalize: (item: unknown) => T | null) {
  return Array.isArray(value) ? value.map(normalize).filter((item): item is T => item !== null) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function optionalBoundedNumber(value: unknown, minimum: number, maximum: number) {
  if (value === null || typeof value === "undefined" || value === "") return null;
  return boundedNumber(value, minimum, maximum, minimum);
}

function oneOf<const T extends readonly (string | number)[]>(value: unknown, choices: T, fallback: T[number]): T[number] {
  return choices.includes(value as T[number]) ? value as T[number] : fallback;
}

export function localDateISO(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function datePart(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  date.setDate(date.getDate() + days);
  return localDateISO(date);
}
