import type { CampusGpaProfile, CampusGradePlan, CampusState } from "./campus-model";

/**
 * The main page owns the concrete notebook record types.  Keeping the merge
 * operation structural lets this module remain a domain helper instead of
 * making the page's UI types part of the persistence layer.
 */
type MergeCourse = {
  id: string;
  title: string;
  term: string;
  weekday: number | null;
  period: number | null;
  archivedAt?: string | null;
};

type MergeSession = {
  id: string;
  courseId: string;
  course: string;
};

type MergeMemo = {
  id: string;
  sessionId: string;
  courseId: string;
  course: string;
};

type MergeState<TCourse extends MergeCourse, TSession extends MergeSession, TMemo extends MergeMemo> = {
  courses: TCourse[];
  sessions: TSession[];
  memos: TMemo[];
  globalTags: string[];
  courseTags: Record<string, string[]>;
  courseTemplates: Record<string, string>;
  terms: string[];
  activeTerm: string;
  tutorialSeen: boolean;
  campus: CampusState;
  displayPreferences: unknown;
};

type PdfEntry = { id: string; blob: Blob };

/**
 * Merge a backup into an existing normalized state.
 *
 * A backup is a separate notebook, so an ID collision means "another
 * record", not "the same record".  Every incoming entity is therefore kept
 * and re-identified when necessary.  The maps are then applied to all
 * relationship fields, including Campus sourceId references and PDF/session
 * references.
 */
export function mergeImportedState<
  TCourse extends MergeCourse,
  TSession extends MergeSession,
  TMemo extends MergeMemo,
  TState extends MergeState<TCourse, TSession, TMemo>,
  TPdf extends PdfEntry,
>(
  existing: TState,
  incoming: TState,
  pdfs: TPdf[],
): { state: TState; pdfs: TPdf[] } {
  const courseIds = reidentifyIncoming(existing.courses, incoming.courses, "course");
  const usedCourseIds = new Set(existing.courses.map((course) => course.id));
  const occupied = new Set(
    existing.courses
      .filter((course) => !course.archivedAt && course.weekday !== null && course.period !== null)
      .map((course) => `${course.term}:${course.weekday}:${course.period}`),
  );
  const importedCourses = incoming.courses.map((course, index) => {
    const id = courseIds.itemIds[index] ?? reserveImportId("course", course.id, usedCourseIds);
    usedCourseIds.add(id);
    const sameName = existing.courses.some((item) => item.title === course.title && item.term === course.term);
    const slot = course.weekday !== null && course.period !== null
      ? `${course.term}:${course.weekday}:${course.period}`
      : "";
    const collision = Boolean(slot && occupied.has(slot));
    if (slot && !collision) occupied.add(slot);
    return {
      ...course,
      id,
      title: sameName ? `${course.title}（読み込み）` : course.title,
      weekday: collision ? null : course.weekday,
      period: collision ? null : course.period,
    };
  });
  const courseById = new Map(importedCourses.map((course) => [course.id, course]));

  const sessionIds = reidentifyIncoming(existing.sessions, incoming.sessions, "session");
  const importedSessions = incoming.sessions.map((session, index) => {
    const id = sessionIds.itemIds[index] ?? session.id;
    const courseId = courseIds.firstIds.get(session.courseId) ?? session.courseId;
    return {
      ...session,
      id,
      courseId,
      course: courseById.get(courseId)?.title ?? session.course,
    };
  });
  const sessionMap = sessionIds.firstIds;

  const memoIds = reidentifyIncoming(existing.memos, incoming.memos, "memo");
  const importedMemos = incoming.memos.map((memo, index) => {
    const id = memoIds.itemIds[index] ?? memo.id;
    const courseId = courseIds.firstIds.get(memo.courseId) ?? memo.courseId;
    return {
      ...memo,
      id,
      courseId,
      course: courseById.get(courseId)?.title ?? memo.course,
      sessionId: sessionMap.get(memo.sessionId) ?? memo.sessionId,
    };
  });

  const importedTags = Object.fromEntries(
    Object.entries(incoming.courseTags).map(([id, tags]) => [courseIds.firstIds.get(id) ?? id, tags]),
  );
  const importedTemplates = Object.fromEntries(
    Object.entries(incoming.courseTemplates).map(([id, value]) => [courseIds.firstIds.get(id) ?? id, value]),
  );

  return {
    state: {
      ...existing,
      courses: [...existing.courses, ...importedCourses],
      sessions: [...existing.sessions, ...importedSessions],
      memos: [...existing.memos, ...importedMemos],
      globalTags: Array.from(new Set([...existing.globalTags, ...incoming.globalTags])),
      courseTags: { ...existing.courseTags, ...importedTags },
      courseTemplates: { ...existing.courseTemplates, ...importedTemplates },
      terms: Array.from(new Set([...existing.terms, ...incoming.terms])),
      // The currently open notebook remains selected after a merge.
      activeTerm: existing.activeTerm,
      tutorialSeen: existing.tutorialSeen,
      campus: mergeCampusImported(existing.campus, incoming.campus, courseIds.firstIds),
      displayPreferences: existing.displayPreferences,
    } as TState,
    pdfs: pdfs.map((entry) => ({ ...entry, id: sessionMap.get(entry.id) ?? entry.id })),
  };
}

type LegacyImportCourse = {
  id: string;
  title: string;
  termName: string;
  instructor: string;
  weekday: number | null;
  period: number | null;
  room: string;
  createdAt: string;
};

type CurrentCourse = {
  id: string;
  title: string;
  term: string;
  weekday: number | null;
  period: number | null;
  archivedAt?: string | null;
};

/**
 * Import old CMTR courses and Campus records as one unit.  Course IDs can
 * collide with notebook courses already on the device; in that case the
 * course gets a new ID and every Campus courseId is remapped through the same
 * map before records are appended.
 */
export function mergeLegacyCampusData<TCourse extends CurrentCourse>(
  existingCourses: TCourse[],
  incomingCourses: LegacyImportCourse[],
  existingCampus: CampusState,
  incomingCampus: CampusState,
): { courses: TCourse[]; campus: CampusState } {
  const usedCourseIds = new Set(existingCourses.map((course) => course.id));
  const occupied = new Set(
    existingCourses
      .filter((course) => !course.archivedAt && course.weekday !== null && course.period !== null)
      .map((course) => `${course.term}:${course.weekday}:${course.period}`),
  );
  const courseMap = new Map<string, string>();
  const importedCourses = incomingCourses.map((course) => {
    const id = usedCourseIds.has(course.id)
      ? reserveImportId("course", course.id, usedCourseIds)
      : course.id;
    usedCourseIds.add(id);
    if (!courseMap.has(course.id)) courseMap.set(course.id, id);
    const slot = course.weekday !== null && course.period !== null
      ? `${course.termName}:${course.weekday}:${course.period}`
      : "";
    const collision = Boolean(slot && occupied.has(slot));
    if (slot && !collision) occupied.add(slot);
    const sameName = existingCourses.some((item) => item.title === course.title && item.term === course.termName);
    return {
      id,
      title: sameName ? `${course.title}（読み込み）` : course.title,
      term: course.termName,
      instructor: course.instructor,
      weekday: collision ? null : course.weekday,
      period: collision ? null : course.period,
      room: course.room,
      createdAt: course.createdAt,
    } as unknown as TCourse;
  });
  return {
    courses: [...existingCourses, ...importedCourses],
    campus: mergeCampusImported(existingCampus, incomingCampus, courseMap),
  };
}

/**
 * Merge Campus records while preserving every incoming record.
 *
 * The returned state contains no ID-based overwrite.  Assignment/exam IDs
 * are mapped before studyTasks are copied, so generated or hand-created tasks
 * continue to point at the imported source after a collision.
 */
export function mergeCampusImported(
  existing: CampusState,
  incoming: CampusState,
  courseMap: ReadonlyMap<string, string>,
) {
  const assignmentIds = reidentifyIncoming(existing.assignments, incoming.assignments, "assignment");
  const templateIds = reidentifyIncoming(existing.assignmentTemplates, incoming.assignmentTemplates, "assignment-template");
  const examIds = reidentifyIncoming(existing.exams, incoming.exams, "exam");
  const attendanceIds = reidentifyIncoming(existing.attendanceRecords, incoming.attendanceRecords, "attendance");
  const studyTaskIds = reidentifyIncoming(existing.studyTasks, incoming.studyTasks, "study-task");

  const remapCourse = <T extends { courseId: string }>(items: T[]) => items.map((item) => ({
    ...item,
    courseId: courseMap.get(item.courseId) ?? item.courseId,
  }));

  const assignments = incoming.assignments.map((item, index) => ({
    ...item,
    id: assignmentIds.itemIds[index] ?? item.id,
    courseId: courseMap.get(item.courseId) ?? item.courseId,
  }));
  const assignmentTemplates = incoming.assignmentTemplates.map((item, index) => ({
    ...item,
    id: templateIds.itemIds[index] ?? item.id,
    courseId: courseMap.get(item.courseId) ?? item.courseId,
  }));
  const exams = incoming.exams.map((item, index) => ({
    ...item,
    id: examIds.itemIds[index] ?? item.id,
    courseId: courseMap.get(item.courseId) ?? item.courseId,
  }));
  const attendanceRecords = incoming.attendanceRecords.map((item, index) => ({
    ...item,
    id: attendanceIds.itemIds[index] ?? item.id,
    courseId: courseMap.get(item.courseId) ?? item.courseId,
  }));
  const studyTasks = incoming.studyTasks.map((item, index) => {
    const sourceMap = item.sourceType === "exam" ? examIds.firstIds : assignmentIds.firstIds;
    return {
      ...item,
      id: studyTaskIds.itemIds[index] ?? item.id,
      sourceId: sourceMap.get(item.sourceId) ?? item.sourceId,
    };
  });

  const importedPlans = reidentifyIncoming(
    existing.gpaProfile.plans,
    remapCourse(incoming.gpaProfile.plans),
    "grade-plan",
  );
  const gpaPlans: CampusGradePlan[] = remapCourse(incoming.gpaProfile.plans).map((plan, index) => ({
    ...plan,
    id: importedPlans.itemIds[index] ?? plan.id,
  }));
  const importedDegreeCategories = reidentifyIncoming(
    existing.degreePlan.categories,
    incoming.degreePlan.categories,
    "degree-category",
  );
  const degreeCategories = incoming.degreePlan.categories.map((category, index) => ({
    ...category,
    id: importedDegreeCategories.itemIds[index] ?? category.id,
  }));

  const mergedGpaProfile: CampusGpaProfile = existing.gpaProfile.plans.length > 0
    ? { ...existing.gpaProfile, plans: [...existing.gpaProfile.plans, ...gpaPlans] }
    : { ...incoming.gpaProfile, plans: gpaPlans };
  const mergedDegreePlan = existing.degreePlan.categories.length > 0
    ? { categories: [...existing.degreePlan.categories, ...degreeCategories] }
    : { categories: degreeCategories };

  return {
    ...existing,
    betaAccess: existing.betaAccess.enabled ? existing.betaAccess : incoming.betaAccess,
    assignments: [...existing.assignments, ...assignments],
    assignmentTemplates: [...existing.assignmentTemplates, ...assignmentTemplates],
    exams: [...existing.exams, ...exams],
    attendanceRecords: [...existing.attendanceRecords, ...attendanceRecords],
    studyTasks: [...existing.studyTasks, ...studyTasks],
    gpaProfile: mergedGpaProfile,
    degreePlan: mergedDegreePlan,
  } as CampusState;
}

type Identified = { id: string };

type Reidentified = {
  /** ID assigned to each incoming array element (index-safe for duplicates). */
  itemIds: string[];
  /** First incoming occurrence by source ID, used by relationship fields. */
  firstIds: Map<string, string>;
};

function reidentifyIncoming<T extends Identified>(
  existing: T[],
  incoming: T[],
  prefix: string,
): Reidentified {
  const used = new Set(existing.map((item) => item.id));
  const itemIds: string[] = [];
  const firstIds = new Map<string, string>();
  for (const item of incoming) {
    const id = used.has(item.id) || firstIds.has(item.id)
      ? reserveImportId(prefix, item.id, used)
      : item.id;
    used.add(id);
    // There is one relationship target for a source ID in valid data.  If a
    // malformed backup repeats an ID, keep both rows and make references point
    // to the first row rather than silently dropping either row.
    itemIds.push(id);
    if (!firstIds.has(item.id)) firstIds.set(item.id, id);
  }
  return { itemIds, firstIds };
}

function reserveImportId(prefix: string, originalId: string, used: Set<string>) {
  const safeOriginal = originalId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96) || "record";
  const base = `${prefix}-import-${safeOriginal}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}
