"use client";

import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileArchive,
  FileText,
  FolderOpen,
  GraduationCap,
  GripHorizontal,
  HardDrive,
  HelpCircle,
  History,
  Lightbulb,
  ListFilter,
  LoaderCircle,
  MessageCircle,
  NotebookPen,
  Paperclip,
  Pin,
  Plus,
  Quote,
  RotateCcw,
  Rows3,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  StickyNote,
  Tags,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  deletePdfsFromDevice,
  getStorageHealth,
  loadAllPdfs,
  loadAppState,
  loadLocalMetricSummary,
  loadPdfFromDevice,
  recordLocalMetric,
  requestPersistentStorage,
  restoreAppStateAndPdfs,
  saveAppState,
  saveAppStateAndDeletePdfs,
  saveAppStateAndPdf,
} from "./local-files";
import { createBackupFile, inspectBackupFile, type InspectedBackup } from "./backup";
import { mergeImportedState, mergeLegacyCampusData } from "./data-migration-model";
import {
  formatPdfProcessingError,
  pdfFileWarning,
  pdfSizeLabel,
  MAX_PDF_FILE_SIZE_BYTES,
  ProcessedTopic,
  processPdfLocally,
} from "./pdf-local";
import CampusModule from "./campus-module";
import { localCampusPreviewEnabled } from "./local-campus-preview";
import AccountSync from "./account-sync";
import PdfReferenceCard from "./pdf-reference-card";
import {
  fullPdfPatch,
  isMatchingPdfReference,
  makeLightweightPdfPatch,
  normalizePdfReferenceFields,
  sha256Blob,
} from "./pdf-reference-model";
import {
  EMPTY_CAMPUS_STATE,
  type CampusState,
  normalizeCampusState,
  readLegacyCampusBundle,
} from "./campus-model";
import {
  isMemoReviewDue,
  memoDateKey,
  normalizeMemoReview,
  scheduleMemoReview,
  startMemoReview,
  stopMemoReview,
  type MemoReviewResult,
} from "./memo-review-model";
import {
  activeOnly,
  DEFAULT_DISPLAY_PREFERENCES,
  isTrashExpired,
  mayInitializeEmptyDevice,
  normalizeDisplayPreferences,
  purgeExpiredTrash,
  trashDaysRemaining,
  trashOnly,
  type DisplayPreferences,
} from "./data-safety-model";

type View = "start" | "course" | "review" | "workspace" | "campus" | "settings";
type TagScope = "global" | "course";
type SaveStatus = "loading" | "dirty" | "saving" | "saved" | "error" | "conflict";
type NoteReviewState = {
  layout: "list" | "timetable";
  query: string;
  term: string;
  courseId: string;
  content: "all" | "body" | "pdf" | "memo" | "empty";
  sort: "newest" | "oldest" | "course";
  timetableCourseId: string;
};

type Course = {
  id: string;
  title: string;
  term: string;
  instructor: string;
  weekday: number | null;
  period: number | null;
  room: string;
  createdAt: string;
  archivedAt?: string | null;
  deletedAt?: string | null;
};

type CourseInput = Omit<Course, "id" | "createdAt">;

type SessionRecord = {
  id: string;
  courseId: string;
  course: string;
  sessionNumber: string;
  title: string;
  fileName?: string;
  pageCount: number;
  pageTexts: string[];
  topics: ProcessedTopic[];
  needsOcr: boolean;
  pdfWarnings?: string[];
  hasPdf: boolean;
  pdfReferenceOnly?: boolean;
  pdfReferenceSha256?: string;
  pdfReleasedAt?: string | null;
  lastPdfPage: number;
  noteText: string;
  notebookPrefs: NotebookPrefs;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
};

type NotebookPrefs = {
  paper: "lined" | "plain" | "grid" | "dots";
  width: "compact" | "standard" | "wide";
  fontSize: "small" | "medium" | "large";
  pdfPosition: "left" | "right";
  pdfPercent: number;
  pdfZoom: number;
};

type ReflectionStatus = "still-important" | "still-unclear" | "changed" | "connected";

type Reflection = {
  id: string;
  status: ReflectionStatus;
  text: string;
  createdAt: string;
};

type Memo = {
  id: string;
  sessionId: string;
  courseId: string;
  course: string;
  sessionNumber: string;
  sessionTitle: string;
  page: number | null;
  text: string;
  tags: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  sourceStart: number | null;
  sourceEnd: number | null;
  sourceText: string;
  reflections: Reflection[];
  pinned?: boolean;
  reviewStage?: number;
  nextReviewAt?: string | null;
  lastReviewedAt?: string | null;
  createdAt: string;
  deletedAt?: string | null;
};

type SavedState = {
  courses?: Course[];
  sessions?: SessionRecord[];
  memos?: Memo[];
  globalTags?: string[];
  courseTags?: Record<string, string[]>;
  courseTemplates?: Record<string, string>;
  terms?: string[];
  activeTerm?: string;
  tutorialSeen?: boolean;
  campus?: CampusState;
  displayPreferences?: DisplayPreferences;
};

type NormalizedState = {
  courses: Course[];
  sessions: SessionRecord[];
  memos: Memo[];
  globalTags: string[];
  courseTags: Record<string, string[]>;
  courseTemplates: Record<string, string>;
  terms: string[];
  activeTerm: string;
  tutorialSeen: boolean;
  campus: CampusState;
  displayPreferences: DisplayPreferences;
};

type UndoAction = {
  id: string;
  message: string;
  undo: () => void;
  finalize?: () => void | Promise<void>;
};

type PendingImport = InspectedBackup<SavedState> & {
  fileName: string;
  normalized: NormalizedState;
};

type LegacyLecture = {
  id: string;
  course: string;
  session: string;
  title: string;
  fileName: string;
  pageCount: number;
  pageTexts: string[];
  topics: ProcessedTopic[];
  needsOcr: boolean;
  createdAt: string;
};

type LegacyMemo = {
  id: number;
  course: string;
  lecture: string;
  page: number;
  kind: string;
  text: string;
  tags: string[];
  date: string;
};

const STATE_KEY = "manabi-memo-state-v7";
const PREVIOUS_STATE_KEYS = [
  "manabi-memo-state-v6",
  "manabi-memo-state-v5",
  "manabi-memo-state-v4",
  "manabi-memo-state-v3",
  "manabi-memo-state-v2",
];
const LEGACY_STATE_KEY = "manabi-memo-state-v1";
const CURRENT_SCHEMA_VERSION = 12;
const DEFAULT_TERM = defaultAcademicTerm();
const weekdays = [
  { value: 1, short: "月", label: "月曜日" },
  { value: 2, short: "火", label: "火曜日" },
  { value: 3, short: "水", label: "水曜日" },
  { value: 4, short: "木", label: "木曜日" },
  { value: 5, short: "金", label: "金曜日" },
  { value: 6, short: "土", label: "土曜日" },
];
const periods = [
  { value: 1, start: "08:40", end: "10:10" },
  { value: 2, start: "10:20", end: "11:50" },
  { value: 3, start: "12:40", end: "14:10" },
  { value: 4, start: "14:20", end: "15:50" },
  { value: 5, start: "16:00", end: "17:30" },
];
const initialGlobalTags = ["テスト対策", "要復習", "疑問", "自分との関連"];
const initialCourseTags: Record<string, string[]> = {};
const defaultNotebookPrefs: NotebookPrefs = {
  paper: "lined",
  width: "standard",
  fontSize: "medium",
  pdfPosition: "left",
  pdfPercent: 48,
  pdfZoom: 100,
};
const previousDemoSessionIds = new Set(["sample-industry-12", "sample-constitution-6"]);
const previousDemoMemoIds = new Set(["sample-memo-1", "sample-memo-2", "sample-memo-3"]);

export default function HomePage() {
  const [view, setView] = useState<View>("start");
  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [globalTags, setGlobalTags] = useState<string[]>(initialGlobalTags);
  const [courseTags, setCourseTags] = useState<Record<string, string[]>>(initialCourseTags);
  const [courseTemplates, setCourseTemplates] = useState<Record<string, string>>({});
  const [terms, setTerms] = useState<string[]>([DEFAULT_TERM]);
  const [tutorialSeen, setTutorialSeen] = useState(false);
  const [campus, setCampus] = useState<CampusState>(EMPTY_CAMPUS_STATE);
  const [displayPreferences, setDisplayPreferences] = useState<DisplayPreferences>(DEFAULT_DISPLAY_PREFERENCES);
  const [accountCampusEntitlement, setAccountCampusEntitlement] = useState<boolean | null>(null);
  const [firebaseEnabled, setFirebaseEnabled] = useState<boolean | null>(null);
  const [hasLegacyCampusData, setHasLegacyCampusData] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [courseReturnView, setCourseReturnView] = useState<"start" | "campus">("start");
  const [selectedSession, setSelectedSession] = useState("1");
  const [activeTerm, setActiveTerm] = useState(DEFAULT_TERM);
  const [showCourseDialog, setShowCourseDialog] = useState(false);
  const [showTermDialog, setShowTermDialog] = useState(false);
  const [placementCourseId, setPlacementCourseId] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [courseDialogDefaults, setCourseDialogDefaults] = useState<{ weekday: number | null; period: number | null }>({
    weekday: null,
    period: null,
  });
  const [draftPdf, setDraftPdf] = useState<File | null>(null);
  const [starting, setStarting] = useState(false);
  const [startProgress, setStartProgress] = useState({ message: "", progress: 0 });
  const [startError, setStartError] = useState("");

  const [activeSessionId, setActiveSessionId] = useState("");
  const [workspaceReturnView, setWorkspaceReturnView] = useState<"course" | "review">("course");
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [showPdf, setShowPdf] = useState(false);
  const [page, setPage] = useState(1);
  const [showTagCreator, setShowTagCreator] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [newTagScope, setNewTagScope] = useState<TagScope>("global");
  const [pdfStatus, setPdfStatus] = useState({ message: "", progress: 0, error: "" });

  const [reviewCourse, setReviewCourse] = useState("すべて");
  const [reviewTerm, setReviewTerm] = useState("すべて");
  const [reviewTag, setReviewTag] = useState("すべて");
  const [reviewQuery, setReviewQuery] = useState("");
  const [reviewKind, setReviewKind] = useState<"notes" | "memos">("notes");
  const [noteReviewState, setNoteReviewState] = useState<NoteReviewState>({ layout: "list", query: "", term: "all", courseId: "all", content: "all", sort: "newest", timetableCourseId: "" });
  const [focusedMemoId, setFocusedMemoId] = useState<string | null>(null);
  const [reflectionMemoId, setReflectionMemoId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [loadError, setLoadError] = useState("");
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importing, setImporting] = useState(false);
  const [storageHealth, setStorageHealth] = useState({ persisted: false, usage: 0, quota: 0 });
  const [metricSummary, setMetricSummary] = useState<Record<string, number>>({});
  const [resetBackupConfirmed, setResetBackupConfirmed] = useState(false);
  const [resetConfirmationText, setResetConfirmationText] = useState("");
  const pdfLoadRequest = useRef(0);
  const writerId = useRef(createId("writer"));
  const storageRevision = useRef(0);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const saveEpoch = useRef(0);
  const lastPersistedFingerprint = useRef("");
  const latestStateRef = useRef<SavedState>({});
  const storageChannel = useRef<BroadcastChannel | null>(null);

  function applyNormalizedState(normalized: NormalizedState) {
    const expiredCourseIds = new Set(normalized.courses.filter((course) => isTrashExpired(course)).map((course) => course.id));
    const expiredSessionIds = new Set(normalized.sessions.filter((session) => isTrashExpired(session) || expiredCourseIds.has(session.courseId)).map((session) => session.id));
    const expiredPdfIds = normalized.sessions.filter((session) => expiredSessionIds.has(session.id)).map((session) => session.id);
    const safeState: NormalizedState = {
      ...normalized,
      courses: purgeExpiredTrash(normalized.courses),
      sessions: purgeExpiredTrash(normalized.sessions).filter((session) => !expiredCourseIds.has(session.courseId)),
      memos: purgeExpiredTrash(normalized.memos).filter((memo) => !expiredCourseIds.has(memo.courseId) && !expiredSessionIds.has(memo.sessionId)),
    };
    if (expiredPdfIds.length > 0) void deletePdfsFromDevice(expiredPdfIds);
    setCourses(safeState.courses);
    setSessions(safeState.sessions);
    setMemos(safeState.memos);
    setGlobalTags(safeState.globalTags);
    setCourseTags(safeState.courseTags);
    setCourseTemplates(safeState.courseTemplates);
    setTerms(safeState.terms);
    setTutorialSeen(safeState.tutorialSeen);
    setCampus(safeState.campus);
    setDisplayPreferences(safeState.displayPreferences);
    setActiveTerm(safeState.activeTerm);
    const firstCourseId = safeState.courses.find((course) => !course.archivedAt && !course.deletedAt)?.id ?? safeState.courses.find((course) => !course.deletedAt)?.id ?? "";
    setSelectedCourseId(firstCourseId);
    setSelectedSession(firstCourseId ? nextSessionNumber(firstCourseId, safeState.sessions) : "1");
  }

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      try {
        const legacyCampus = readLegacyCampusBundle(window.localStorage, DEFAULT_TERM);
        if (legacyCampus) setHasLegacyCampusData(true);
        const stored = await loadAppState<SavedState>();
        if (cancelled) return;
        if (stored) {
          if (stored.schemaVersion > CURRENT_SCHEMA_VERSION) {
            setLoadError("新しい版で保存されたデータです。アプリを更新してから開いてください。データは上書きしていません。");
            setSaveStatus("error");
            return;
          }
          if (!isSavedStateShape(stored.data)) {
            setLoadError("保存データの一部を確認できませんでした。データは上書きせず保護しています。");
            setSaveStatus("error");
            return;
          }
          const normalized = normalizeSavedState(stored.data);
          applyNormalizedState(normalized);
          storageRevision.current = stored.revision;
          lastPersistedFingerprint.current = stateFingerprint(normalized);
          setLastSavedAt(stored.savedAt);
          setShowTutorial(!normalized.tutorialSeen);
          setAutoSaveEnabled(true);
          setSaveStatus("saved");
          return;
        }

        let restored: NormalizedState | null = null;
        let foundLegacy = false;
        for (const key of [STATE_KEY, ...PREVIOUS_STATE_KEYS]) {
          const saved = window.localStorage.getItem(key);
          if (!saved) continue;
          foundLegacy = true;
          try {
            const parsed = JSON.parse(saved) as SavedState;
            if (isSavedStateShape(parsed)) {
              restored = normalizeSavedState(parsed);
              break;
            }
          } catch { /* 次の旧版を試す */ }
        }
        if (!restored) {
          const legacy = window.localStorage.getItem(LEGACY_STATE_KEY);
          if (legacy) {
            foundLegacy = true;
            const migrated = migrateLegacyState(JSON.parse(legacy));
            restored = normalizeSavedState({ ...migrated, tutorialSeen: true });
          }
        }
        if (restored) {
          applyNormalizedState(restored);
          setShowTutorial(!restored.tutorialSeen);
          setAutoSaveEnabled(true);
          setSaveStatus("dirty");
        } else if (foundLegacy) {
          setLoadError("旧い保存データを読み込めませんでした。データは上書きしていません。");
          setSaveStatus("error");
        } else {
          setShowTutorial(true);
          setAutoSaveEnabled(true);
          setSaveStatus("dirty");
        }
      } catch {
        if (!cancelled) {
          setLoadError("端末の保存領域を利用できません。ブラウザの設定をご確認ください。");
          setSaveStatus("error");
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
          void getStorageHealth().then(setStorageHealth).catch(() => undefined);
          void loadLocalMetricSummary().then((summary) => setMetricSummary(summary.counts)).catch(() => undefined);
        }
      }
    }
    void hydrate();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated || !autoSaveEnabled) return;
    const state: SavedState = { courses, sessions, memos, globalTags, courseTags, courseTemplates, terms, activeTerm, tutorialSeen, campus, displayPreferences };
    latestStateRef.current = state;
    const fingerprint = stateFingerprint(state);
    if (fingerprint === lastPersistedFingerprint.current) return;
    setSaveStatus("dirty");
    const epoch = saveEpoch.current;
    const saveTimer = window.setTimeout(() => {
      saveChain.current = saveChain.current.catch(() => undefined).then(async () => {
        if (epoch !== saveEpoch.current) return;
        setSaveStatus("saving");
        try {
          const saved = await saveAppState(state, CURRENT_SCHEMA_VERSION, storageRevision.current, writerId.current);
          if (epoch !== saveEpoch.current) return;
          storageRevision.current = saved.revision;
          lastPersistedFingerprint.current = fingerprint;
          setLastSavedAt(saved.savedAt);
          setSaveStatus("saved");
          storageChannel.current?.postMessage({ writerId: writerId.current, revision: saved.revision });
        } catch (cause) {
          if (isStorageConflict(cause)) {
            setSaveStatus("conflict");
            setAutoSaveEnabled(false);
          } else {
            setSaveStatus("error");
            void recordLocalMetric("save_failed", { reason: storageErrorCode(cause) });
          }
        }
      });
    }, 520);
    return () => window.clearTimeout(saveTimer);
  }, [activeTerm, autoSaveEnabled, campus, courseTags, courseTemplates, courses, displayPreferences, globalTags, hydrated, memos, sessions, terms, tutorialSeen]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("manabi-memo-state");
    storageChannel.current = channel;
    channel.onmessage = (event) => {
      const value = event.data as { writerId?: string; revision?: number };
      if (value.writerId !== writerId.current && typeof value.revision === "number" && value.revision > storageRevision.current) {
        setSaveStatus("conflict");
        setAutoSaveEnabled(false);
      }
    };
    return () => { channel.close(); storageChannel.current = null; };
  }, []);

  useEffect(() => {
    function protectUnsaved(event: BeforeUnloadEvent) {
      if (saveStatus === "dirty" || saveStatus === "saving" || saveStatus === "error" || saveStatus === "conflict") {
        event.preventDefault();
      }
    }
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, [saveStatus]);

  useEffect(() => {
    function flushWhenHidden() {
      if (document.visibilityState !== "hidden" || saveStatus !== "dirty" || !autoSaveEnabled) return;
      const state = latestStateRef.current;
      const fingerprint = stateFingerprint(state);
      const epoch = saveEpoch.current;
      saveChain.current = saveChain.current.catch(() => undefined).then(async () => {
        if (epoch !== saveEpoch.current || fingerprint === lastPersistedFingerprint.current) return;
        try {
          const saved = await saveAppState(state, CURRENT_SCHEMA_VERSION, storageRevision.current, writerId.current);
          storageRevision.current = saved.revision;
          lastPersistedFingerprint.current = fingerprint;
          setLastSavedAt(saved.savedAt);
          setSaveStatus("saved");
          storageChannel.current?.postMessage({ writerId: writerId.current, revision: saved.revision });
        } catch (cause) {
          setSaveStatus(isStorageConflict(cause) ? "conflict" : "error");
        }
      });
    }
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => document.removeEventListener("visibilitychange", flushWhenHidden);
  }, [autoSaveEnabled, saveStatus]);

  useEffect(() => {
    if (!undoAction) return;
    const active = undoAction;
    const timer = window.setTimeout(() => {
      if (active.finalize) void active.finalize();
      setUndoAction((current) => current?.id === active.id ? null : current);
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [undoAction]);

  const activeCourses = useMemo(() => activeOnly(courses), [courses]);
  const activeSessions = useMemo(() => activeOnly(sessions).filter((session) => activeCourses.some((course) => course.id === session.courseId)), [activeCourses, sessions]);
  const activeMemos = useMemo(() => activeOnly(memos).filter((memo) => activeSessions.some((session) => session.id === memo.sessionId)), [activeSessions, memos]);
  const localCampusPreview = localCampusPreviewEnabled();
  const effectiveCampusEntitlement = localCampusPreview ? true : accountCampusEntitlement;
  const campusVisible = localCampusPreview || displayPreferences.campusMusterEnabled;
  const campusAccessEnabled = (effectiveCampusEntitlement ?? campus.betaAccess.enabled) && campusVisible;

  const selectedCourse = useMemo(
    () => activeCourses.find((course) => course.id === selectedCourseId) ?? null,
    [activeCourses, selectedCourseId],
  );

  const activeSession = useMemo(
    () => activeSessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, activeSessions],
  );

  const sessionMemos = useMemo(
    () => activeMemos.filter((memo) => memo.sessionId === activeSessionId),
    [activeMemos, activeSessionId],
  );

  const currentCourseTags = activeSession
    ? (courseTags[activeSession.courseId] ?? courseTags[activeSession.course] ?? [])
    : [];

  const allReviewTags = useMemo(
    () => Array.from(new Set([
      ...globalTags,
      ...Object.values(courseTags).flat(),
      ...activeMemos.flatMap((memo) => memo.tags),
    ])),
    [activeMemos, courseTags, globalTags],
  );

  const filteredMemos = useMemo(
    () => activeMemos.filter((memo) => {
      if (!memo.text.trim()) return false;
      const course = activeCourses.find((item) => item.id === memo.courseId);
      const normalizedQuery = reviewQuery.trim().toLocaleLowerCase("ja-JP");
      const matchesTerm = reviewTerm === "すべて" || course?.term === reviewTerm;
      const matchesCourse = reviewCourse === "すべて" || memo.courseId === reviewCourse;
      const matchesTag = reviewTag === "すべて" || memo.tags.includes(reviewTag);
      const searchableText = [
        memo.text,
        memo.course,
        memo.sessionTitle,
        ...memo.tags,
        ...memo.reflections.map((reflection) => reflection.text),
      ].join(" ").toLocaleLowerCase("ja-JP");
      const matchesQuery = !normalizedQuery || searchableText.includes(normalizedQuery);
      return matchesTerm && matchesCourse && matchesTag && matchesQuery;
    }),
    [activeCourses, activeMemos, reviewCourse, reviewQuery, reviewTag, reviewTerm],
  );

  const existingSelection = useMemo(
    () => activeSessions.find((session) => (
      session.courseId === selectedCourseId
      && normalizeSessionNumber(session.sessionNumber) === normalizeSessionNumber(selectedSession)
    )),
    [activeSessions, selectedCourseId, selectedSession],
  );

  const todayMemo = useMemo(() => {
    const activeCourseIds = new Set(activeCourses.filter((course) => !course.archivedAt && course.term === activeTerm).map((course) => course.id));
    return pickDailyMemo(activeMemos.filter((memo) => activeCourseIds.has(memo.courseId)));
  }, [activeCourses, activeMemos, activeTerm]);
  const reflectionMemo = useMemo(
    () => activeMemos.find((memo) => memo.id === reflectionMemoId) ?? null,
    [activeMemos, reflectionMemoId],
  );

  function chooseCourse(courseId: string) {
    setSelectedCourseId(courseId);
    setSelectedSession(nextSessionNumber(courseId, activeSessions));
    setDraftPdf(null);
    setStartError("");
  }

  function openCourseDialog(weekday: number | null = null, period: number | null = null) {
    setCourseDialogDefaults({ weekday, period });
    setShowCourseDialog(true);
  }

  function registerCourse(input: CourseInput) {
    const title = input.title.trim();
    const term = input.term.trim() || activeTerm || DEFAULT_TERM;
    const instructor = input.instructor.trim();
    const room = input.room.trim();
    if (!title) return;

    const existing = activeCourses.find((course) => (
      course.title.toLocaleLowerCase("ja-JP") === title.toLocaleLowerCase("ja-JP")
      && course.term.toLocaleLowerCase("ja-JP") === term.toLocaleLowerCase("ja-JP")
    ));
    if (existing) {
      chooseCourse(existing.id);
      setActiveTerm(existing.term || DEFAULT_TERM);
      setShowCourseDialog(false);
      return;
    }

    const isFirstCourse = activeCourses.length === 0;
    const nextCourse: Course = {
      id: createId("course"),
      title,
      term,
      instructor,
      weekday: input.weekday,
      period: input.period,
      room,
      createdAt: new Date().toISOString(),
    };
    setCourses((current) => [
      ...current.map((course) => (
        nextCourse.weekday !== null
        && nextCourse.period !== null
        && course.term === nextCourse.term
        && course.weekday === nextCourse.weekday
        && course.period === nextCourse.period
          ? { ...course, weekday: null, period: null }
          : course
      )),
      nextCourse,
    ]);
    setTerms((current) => current.includes(term) ? current : [...current, term]);
    setSelectedCourseId(nextCourse.id);
    setSelectedSession("1");
    setActiveTerm(nextCourse.term);
    setDraftPdf(null);
    setStartError("");
    setShowCourseDialog(false);
    setView("course");
    void recordLocalMetric("course_created", { placed: nextCourse.weekday !== null && nextCourse.period !== null });
    if (isFirstCourse) setSelectedSession("1");
  }

  function addTerm(termValue: string) {
    const term = termValue.trim();
    if (!term) return;
    setTerms((current) => current.includes(term) ? current : [...current, term]);
    setActiveTerm(term);
    setShowTermDialog(false);
  }

  function placeCourse(courseId: string, weekday: number, period: number) {
    setCourses((current) => {
      const target = current.find((course) => course.id === courseId);
      if (!target) return current;
      return current.map((course) => {
        if (course.id === courseId) return { ...course, weekday, period };
        if (course.term === target.term && course.weekday === weekday && course.period === period) {
          return { ...course, weekday: null, period: null };
        }
        return course;
      });
    });
    setPlacementCourseId(null);
  }

  function unplaceCourse(courseId: string) {
    setCourses((current) => current.map((course) => course.id === courseId
      ? { ...course, weekday: null, period: null }
      : course));
    setPlacementCourseId(null);
  }

  function finishTutorial() {
    setTutorialSeen(true);
    setShowTutorial(false);
  }

  function openCourseFromTimetable(courseId: string) {
    const course = activeCourses.find((item) => item.id === courseId);
    if (!course) return;
    chooseCourse(courseId);
    setCourseReturnView("start");
    setActiveTerm(course.term || DEFAULT_TERM);
    setView("course");
    void recordLocalMetric("course_detail_open", { source: "timetable" });
  }

  function openCourseFromCampus(courseId: string) {
    const course = activeCourses.find((item) => item.id === courseId);
    if (!course) return;
    chooseCourse(courseId);
    setActiveTerm(course.term || DEFAULT_TERM);
    setCourseReturnView("campus");
    setView("course");
    void recordLocalMetric("course_detail_open", { source: "campus" });
  }

  function saveCourseEdit(input: CourseInput) {
    const course = activeCourses.find((item) => item.id === editingCourseId);
    if (!course || !input.title.trim()) return;
    const term = input.term.trim() || DEFAULT_TERM;
    const title = input.title.trim();
    const collision = activeCourses.find((item) => item.id !== course.id && item.term === term
      && item.weekday === input.weekday && item.period === input.period && input.weekday !== null && input.period !== null);
    if (collision && !window.confirm(`${collision.title}が同じ時間に配置されています。保存すると、その講義を未配置へ移します。`)) return;
    setCourses((current) => current.map((item) => {
      if (item.id === course.id) return { ...item, ...input, title, term };
      if (collision?.id === item.id) return { ...item, weekday: null, period: null };
      return item;
    }));
    setSessions((current) => current.map((session) => session.courseId === course.id ? { ...session, course: title, updatedAt: new Date().toISOString() } : session));
    setMemos((current) => current.map((memo) => memo.courseId === course.id ? { ...memo, course: title } : memo));
    setTerms((current) => current.includes(term) ? current : [...current, term]);
    setActiveTerm(term);
    setEditingCourseId(null);
  }

  function saveSessionEdit(sessionId: string, sessionNumber: string, title: string) {
    const session = activeSessions.find((item) => item.id === sessionId);
    const normalizedNumber = normalizeSessionNumber(sessionNumber);
    if (!session || !isValidSessionNumber(normalizedNumber)) return;
    if (activeSessions.some((item) => item.id !== sessionId && item.courseId === session.courseId && normalizeSessionNumber(item.sessionNumber) === normalizedNumber)) return;
    const nextTitle = title.trim() || `${sessionLabel(normalizedNumber)}のノート`;
    setSessions((current) => current.map((item) => item.id === sessionId
      ? { ...item, sessionNumber: normalizedNumber, title: nextTitle, updatedAt: new Date().toISOString() }
      : item));
    setMemos((current) => current.map((memo) => memo.sessionId === sessionId
      ? { ...memo, sessionNumber: normalizedNumber, sessionTitle: nextTitle }
      : memo));
    setEditingSessionId(null);
  }

  function offerUndo(action: UndoAction) {
    setUndoAction((current) => {
      if (current?.finalize) void current.finalize();
      return action;
    });
  }

  function archiveCourse(courseId: string) {
    const previous = activeCourses.find((course) => course.id === courseId);
    if (!previous) return;
    setCourses((current) => current.map((course) => course.id === courseId ? { ...course, archivedAt: new Date().toISOString() } : course));
    setView("start");
    offerUndo({ id: createId("undo"), message: `${previous.title}を時間割からしまいました`, undo: () => setCourses((current) => current.map((course) => course.id === courseId ? previous : course)) });
  }

  function restoreCourse(courseId: string) {
    setCourses((current) => current.map((course) => course.id === courseId ? { ...course, archivedAt: null } : course));
  }

  function deleteSession(sessionId: string) {
    const session = activeSessions.find((item) => item.id === sessionId);
    if (!session || !window.confirm(`${session.course}の${sessionLabel(session.sessionNumber)}「${session.title}」をごみ箱へ移します。ノート・付箋・PDFは30日間残り、設定から元に戻せます。`)) return;
    const deletedAt = new Date().toISOString();
    setSessions((current) => current.map((item) => item.id === sessionId ? { ...item, deletedAt } : item));
    if (editingSessionId === sessionId) setEditingSessionId(null);
    offerUndo({
      id: createId("undo"),
      message: `${session.course}の${sessionLabel(session.sessionNumber)}をごみ箱へ移しました`,
      undo: () => restoreTrashItem("session", sessionId),
    });
  }

  function deleteCourse(courseId: string) {
    const course = activeCourses.find((item) => item.id === courseId);
    if (!course || !window.confirm(`${course.title}をごみ箱へ移します。すべての授業回・付箋・PDFは30日間残り、設定から元に戻せます。`)) return;
    const deletedAt = new Date().toISOString();
    setCourses((current) => current.map((item) => item.id === courseId ? { ...item, deletedAt } : item));
    setView("start");
    offerUndo({
      id: createId("undo"),
      message: `${course.title}をごみ箱へ移しました`,
      undo: () => restoreTrashItem("course", courseId),
    });
  }

  function restoreTrashItem(kind: "course" | "session" | "memo", id: string) {
    if (kind === "course") {
      setCourses((current) => current.map((course) => course.id === id ? { ...course, deletedAt: null } : course));
      return;
    }
    if (kind === "session") {
      setSessions((current) => current.map((session) => session.id === id ? { ...session, deletedAt: null } : session));
      return;
    }
    setMemos((current) => current.map((memo) => memo.id === id ? { ...memo, deletedAt: null } : memo));
  }

  async function openSession(session: SessionRecord, targetPage?: number, knownBlob?: Blob, memoId?: string, origin: "course" | "review" = "course") {
    const requestId = pdfLoadRequest.current + 1;
    pdfLoadRequest.current = requestId;
    setActiveSessionId(session.id);
    setWorkspaceReturnView(origin);
    setSelectedCourseId(session.courseId);
    setSelectedSession(session.sessionNumber);
    const restoredPage = targetPage ?? session.lastPdfPage ?? 1;
    const pageToOpen = Math.min(Math.max(1, restoredPage), Math.max(1, session.pageCount));
    setPage(pageToOpen);
    if (session.hasPdf && targetPage !== undefined) {
      setSessions((current) => current.map((item) => item.id === session.id
        ? { ...item, lastPdfPage: pageToOpen }
        : item));
    }
    setShowTagCreator(false);
    setFocusedMemoId(memoId ?? null);
    setPdfStatus({ message: "", progress: 0, error: "" });
    setPdfBlob(knownBlob ?? null);
    setShowPdf(Boolean(session.hasPdf));
    setShowSessionDialog(false);
    setView("workspace");
    void recordLocalMetric("session_opened", { hasPdf: session.hasPdf });

    if (session.hasPdf && !knownBlob) {
      try {
        const stored = await loadPdfFromDevice(session.id);
        if (pdfLoadRequest.current === requestId) setPdfBlob(stored);
      } catch {
        if (pdfLoadRequest.current === requestId) setPdfBlob(null);
      }
    }
  }

  async function startSelectedSession() {
    if (!selectedCourse) return;
    const course = selectedCourse.title;
    const sessionNumber = normalizeSessionNumber(selectedSession);
    if (!isValidSessionNumber(selectedSession) || starting) return;

    setStarting(true);
    setStartError("");
    setStartProgress({ message: "", progress: 0 });

    try {
      if (!draftPdf && existingSelection) {
        await openSession(existingSelection);
        return;
      }

      const id = existingSelection?.id ?? createId("session");
      let nextSession: SessionRecord;

      if (draftPdf) {
        const processed = await processPdfLocally(draftPdf, (message, progress) => {
          setStartProgress({ message, progress });
        });
        nextSession = {
          id,
          courseId: selectedCourse.id,
          course,
          sessionNumber,
          title: existingSelection?.title || draftPdf.name.replace(/\.pdf$/i, ""),
          fileName: draftPdf.name,
          pageCount: processed.pageCount,
          pageTexts: processed.pageTexts,
          topics: processed.topics,
          needsOcr: processed.needsOcr,
          pdfWarnings: processed.warnings,
          hasPdf: true,
          ...fullPdfPatch(),
          lastPdfPage: existingSelection?.lastPdfPage ?? 1,
          noteText: existingSelection?.noteText ?? courseTemplates[selectedCourse.id] ?? "",
          notebookPrefs: existingSelection?.notebookPrefs ?? { ...defaultNotebookPrefs },
          createdAt: existingSelection?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      } else {
        nextSession = {
          id,
          courseId: selectedCourse.id,
          course,
          sessionNumber,
          title: sessionLabel(sessionNumber) + "のノート",
          pageCount: 0,
          pageTexts: [],
          topics: [],
          needsOcr: false,
          hasPdf: false,
          ...fullPdfPatch(),
          lastPdfPage: 1,
          noteText: courseTemplates[selectedCourse.id] ?? "",
          notebookPrefs: { ...defaultNotebookPrefs },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      const nextSessions = [nextSession, ...sessions.filter((item) => item.id !== nextSession.id)];
      if (draftPdf) {
        await persistStateAndPdf({ ...currentSavedState(), sessions: nextSessions }, nextSession.id, draftPdf);
      }
      setSessions(nextSessions);
      setDraftPdf(null);
      await openSession(nextSession, 1, draftPdf ?? undefined);
    } catch (cause) {
      console.error("Session start failed", cause);
      setStartError(formatPdfProcessingError(cause));
    } finally {
      setStarting(false);
    }
  }

  async function attachPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await attachPdfFile(file);
  }

  async function attachPdfFile(file: File) {
    if (!activeSession || pdfStatus.message || !isPdfFile(file)) return;

    try {
      setPdfStatus({ message: "PDFを開いています", progress: 5, error: "" });
      const processed = await processPdfLocally(file, (message, progress) => {
        setPdfStatus({ message, progress, error: "" });
      });
      const latestSessions = (latestStateRef.current.sessions ?? sessions) as SessionRecord[];
      const currentSession = latestSessions.find((session) => session.id === activeSession.id) ?? activeSession;
      const candidateSha256 = await sha256Blob(file);
      if (currentSession.pdfReferenceOnly && !isMatchingPdfReference(currentSession, { sha256: candidateSha256, fileName: file.name, pageCount: processed.pageCount })) {
        const proceed = window.confirm("以前参照していたPDFと一致しません。付箋のページ参照がずれる可能性があります。このPDFへ差し替えますか？");
        if (!proceed) {
          setPdfStatus({ message: "", progress: 0, error: "PDFの再追加をキャンセルしました。" });
          return;
        }
      }
      const updated: SessionRecord = {
        ...currentSession,
        title: currentSession.title.endsWith("のメモ") || currentSession.title.endsWith("のノート")
          ? file.name.replace(/\.pdf$/i, "")
          : currentSession.title,
        fileName: file.name,
        pageCount: processed.pageCount,
        pageTexts: processed.pageTexts,
        topics: processed.topics,
        needsOcr: processed.needsOcr,
        pdfWarnings: processed.warnings,
        hasPdf: true,
        ...fullPdfPatch(),
        lastPdfPage: 1,
        updatedAt: new Date().toISOString(),
      };
      const nextSessions = latestSessions.map((session) => session.id === updated.id ? updated : session);
      await persistStateAndPdf({ ...currentSavedState(), sessions: nextSessions }, updated.id, file);
      setSessions(nextSessions);
      setPdfBlob(file);
      setPage(1);
      setShowPdf(true);
      setPdfStatus({ message: "", progress: 0, error: "" });
    } catch (cause) {
      console.error("PDF attach failed", cause);
      setPdfStatus({ message: "", progress: 0, error: formatPdfProcessingError(cause) });
    }
  }

  function currentSavedState(): SavedState {
    return { ...latestStateRef.current, courses, sessions, memos, globalTags, courseTags, courseTemplates, terms, activeTerm, tutorialSeen, campus, displayPreferences };
  }

  const handleCampusEntitlement = useCallback((enabled: boolean | null) => {
    setAccountCampusEntitlement(enabled);
    if (enabled === null) return;
    setCampus((current) => current.betaAccess.enabled === enabled ? current : normalizeCampusState({
      ...current,
      betaAccess: {
        ...current.betaAccess,
        enabled,
        activatedAt: enabled ? current.betaAccess.activatedAt ?? new Date().toISOString() : current.betaAccess.activatedAt,
      },
    }));
  }, []);

  const handleFirebaseAvailability = useCallback((enabled: boolean | null) => {
    setFirebaseEnabled(enabled);
  }, []);

  async function applyCloudAccountState(value: unknown, pdfs: Array<{ id: string; blob: Blob }>) {
    if (!isSavedStateShape(value)) throw new Error("クラウドの保存形式を確認できませんでした");
    let normalized = normalizeSavedState(value);
    if (accountCampusEntitlement !== null) {
      normalized = {
        ...normalized,
        campus: normalizeCampusState({
          ...normalized.campus,
          betaAccess: { ...normalized.campus.betaAccess, enabled: accountCampusEntitlement },
        }),
      };
    }
    const pdfIds = new Set(pdfs.map((entry) => entry.id));
    const expectedIds = normalized.sessions.filter((session) => session.hasPdf).map((session) => session.id);
    if (expectedIds.some((id) => !pdfIds.has(id)) || pdfs.some((entry) => !normalized.sessions.some((session) => session.id === entry.id))) {
      throw new Error("クラウドのノートとPDFの対応を確認できませんでした");
    }
    saveEpoch.current += 1;
    await saveChain.current.catch(() => undefined);
    const saved = await restoreAppStateAndPdfs(normalized, pdfs, true, CURRENT_SCHEMA_VERSION, storageRevision.current, writerId.current);
    storageRevision.current = saved.revision;
    lastPersistedFingerprint.current = stateFingerprint(normalized);
    applyNormalizedState(normalized);
    setLastSavedAt(saved.savedAt);
    setSaveStatus("saved");
    setAutoSaveEnabled(true);
    setLoadError("");
    storageChannel.current?.postMessage({ writerId: writerId.current, revision: saved.revision });
  }

  async function persistStateAndPdf(state: SavedState, sessionId: string, blob: Blob) {
    const health = await getStorageHealth();
    const remaining = Math.max(0, health.quota - health.usage);
    if (health.quota > 0 && remaining < blob.size * 1.25 + 10 * 1024 * 1024) throw new DOMException("保存容量が不足しています", "QuotaExceededError");
    saveEpoch.current += 1;
    await saveChain.current.catch(() => undefined);
    setSaveStatus("saving");
    const saved = await saveAppStateAndPdf(state, { id: sessionId, blob }, CURRENT_SCHEMA_VERSION, storageRevision.current, writerId.current);
    storageRevision.current = saved.revision;
    lastPersistedFingerprint.current = stateFingerprint(state);
    setLastSavedAt(saved.savedAt);
    setSaveStatus("saved");
    setStorageHealth(await getStorageHealth());
    storageChannel.current?.postMessage({ writerId: writerId.current, revision: saved.revision });
  }

  async function releasePdfToReference(sessionId: string) {
    const latestSessions = (latestStateRef.current.sessions ?? sessions) as SessionRecord[];
    const target = latestSessions.find((session) => session.id === sessionId);
    if (!target?.hasPdf || !window.confirm("PDF本体と抽出テキストをこの端末から外して、ファイル名・ページ数・付箋のページ参照だけを残します。元のPDFを再追加するまで表示とPDF本文検索はできません。続けますか？")) return;
    try {
      setPdfStatus({ message: "PDFを軽量な参照へ切り替えています", progress: 20, error: "" });
      const storedPdf = await loadPdfFromDevice(sessionId);
      if (!storedPdf) throw new Error("端末内のPDF本体を確認できませんでした。再追加してから軽量化してください。");
      const sha256 = await sha256Blob(storedPdf);
      setPdfStatus({ message: "参照情報を安全に保存しています", progress: 70, error: "" });
      const updated: SessionRecord = {
        ...target,
        ...makeLightweightPdfPatch(target, sha256),
        updatedAt: new Date().toISOString(),
      };
      const nextSessions = latestSessions.map((session) => session.id === sessionId ? updated : session);
      const nextState = { ...currentSavedState(), sessions: nextSessions };
      saveEpoch.current += 1;
      await saveChain.current.catch(() => undefined);
      setSaveStatus("saving");
      const saved = await saveAppStateAndDeletePdfs(nextState, [sessionId], CURRENT_SCHEMA_VERSION, storageRevision.current, writerId.current);
      storageRevision.current = saved.revision;
      lastPersistedFingerprint.current = stateFingerprint(nextState);
      setSessions(nextSessions);
      setPdfBlob(null);
      setShowPdf(false);
      setLastSavedAt(saved.savedAt);
      setSaveStatus("saved");
      setStorageHealth(await getStorageHealth());
      setPdfStatus({ message: "", progress: 0, error: "" });
      storageChannel.current?.postMessage({ writerId: writerId.current, revision: saved.revision });
      void recordLocalMetric("pdf_released_to_reference", { pageCount: target.pageCount });
    } catch (cause) {
      setSaveStatus("error");
      setPdfStatus({ message: "", progress: 0, error: cause instanceof Error ? cause.message : "PDFを軽量化できませんでした。" });
    }
  }

  function createMemo(
    position: { x: number; y: number },
    source?: { text: string; start: number; end: number },
  ) {
    if (!activeSession) return "";
    const id = createId("memo");
    const nextMemo: Memo = {
      id,
      sessionId: activeSession.id,
      courseId: activeSession.courseId,
      course: activeSession.course,
      sessionNumber: activeSession.sessionNumber,
      sessionTitle: activeSession.title,
      page: activeSession.hasPdf || activeSession.pdfReferenceOnly ? page : null,
      text: source?.text ?? "",
      tags: [],
      x: position.x,
      y: position.y,
      width: 310,
      height: 230,
      sourceStart: source?.start ?? null,
      sourceEnd: source?.end ?? null,
      sourceText: source?.text ?? "",
      reflections: [],
      createdAt: new Date().toISOString(),
    };
    setMemos((current) => [nextMemo, ...current]);
    void recordLocalMetric("sticky_created", { fromSelection: Boolean(source?.text) });
    return id;
  }

  function updateMemo(memoId: string, changes: Partial<Pick<Memo, "text" | "tags" | "x" | "y" | "width" | "height" | "page" | "reflections" | "pinned" | "reviewStage" | "nextReviewAt" | "lastReviewedAt">>) {
    setMemos((current) => current.map((memo) => memo.id === memoId ? { ...memo, ...changes } : memo));
  }

  function toggleMemoPin(memoId: string) {
    setMemos((current) => current.map((memo) => memo.id === memoId
      ? { ...memo, pinned: !memo.pinned }
      : memo));
  }

  function beginMemoReview(memoId: string) {
    setMemos((current) => current.map((memo) => {
      if (memo.id !== memoId) return memo;
      return { ...memo, ...startMemoReview(), pinned: memo.pinned === true };
    }));
    void recordLocalMetric("memo_review_started");
  }

  function recordMemoReview(memoId: string, result: MemoReviewResult) {
    setMemos((current) => current.map((memo) => memo.id === memoId
      ? { ...memo, ...scheduleMemoReview(memo, result) }
      : memo));
    void recordLocalMetric(result === "remembered" ? "memo_review_remembered" : "memo_review_again");
  }

  function finishMemoReview(memoId: string) {
    setMemos((current) => current.map((memo) => memo.id === memoId
      ? { ...memo, ...stopMemoReview(memo) }
      : memo));
  }

  function updateSessionNote(sessionId: string, noteText: string) {
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, noteText, updatedAt: new Date().toISOString() } : session));
  }

  function updateNotebookPrefs(sessionId: string, changes: Partial<NotebookPrefs>) {
    setSessions((current) => current.map((session) => session.id === sessionId
      ? { ...session, notebookPrefs: { ...session.notebookPrefs, ...changes } }
      : session));
  }

  function changePdfPage(value: number) {
    if (!activeSession) return;
    const nextPage = clampNumber(value, 1, Math.max(1, activeSession.pageCount));
    setPage(nextPage);
    setSessions((current) => current.map((session) => session.id === activeSession.id
      ? { ...session, lastPdfPage: nextPage }
      : session));
  }

  function saveCourseTemplate(courseId: string, template: string) {
    setCourseTemplates((current) => ({ ...current, [courseId]: template }));
  }

  function clearCourseTemplate(courseId: string) {
    setCourseTemplates((current) => {
      const next = { ...current };
      delete next[courseId];
      return next;
    });
  }

  function deleteMemo(memoId: string) {
    const memo = activeMemos.find((item) => item.id === memoId);
    if (!memo) return;
    setMemos((current) => current.map((item) => item.id === memoId ? { ...item, deletedAt: new Date().toISOString() } : item));
    offerUndo({ id: createId("undo"), message: "付箋をごみ箱へ移しました", undo: () => restoreTrashItem("memo", memoId) });
  }

  function addReflection(memoId: string, status: ReflectionStatus, text: string) {
    const reflection: Reflection = {
      id: createId("reflection"),
      status,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    setMemos((current) => current.map((memo) => memo.id === memoId
      ? { ...memo, reflections: [...memo.reflections, reflection] }
      : memo));
    setReflectionMemoId(null);
  }

  function openMemoOrigin(memo: Memo, origin: "course" | "review" = "course") {
    const session = activeSessions.find((item) => item.id === memo.sessionId);
    if (session) {
      void recordLocalMetric("origin_reopened", { hasPdfPage: memo.page !== null });
      void openSession(session, memo.page ?? 1, undefined, memo.id, origin);
    }
  }

  async function exportNotebookData(silent = false) {
    try {
      const state = currentSavedState();
      const sessionIds = new Set(sessions.map((session) => session.id));
      const allPdfs = (await loadAllPdfs()).filter((entry) => sessionIds.has(entry.id));
      const storedIds = new Set(allPdfs.map((entry) => entry.id));
      const missing = sessions.filter((session) => session.hasPdf && !storedIds.has(session.id));
      if (missing.length > 0) throw new Error(`端末に見つからないPDFが${missing.length}件あります。資料を再追加してから書き出してください。`);
      const blob = await createBackupFile(state, allPdfs);
      downloadBlob(blob, `manabi-memo-${new Date().toISOString().slice(0, 10)}.manabimemo`);
      if (!silent) setImportMessage(`PDF ${allPdfs.length}件を含む完全バックアップを書き出しました`);
      void recordLocalMetric("backup_completed", { pdfCount: allPdfs.length });
      return true;
    } catch (cause) {
      setImportMessage(cause instanceof Error ? cause.message : "バックアップを作成できませんでした");
      return false;
    }
  }

  async function importNotebookData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const inspection = await inspectBackupFile<SavedState>(file);
      if (!isSavedStateShape(inspection.manifest.state)) throw new Error("ノートデータの形式を確認できません");
      let normalized = normalizeSavedState(inspection.manifest.state);
      const storedPdfIds = new Set(inspection.pdfs.map((entry) => entry.id));
      const expectedPdfIds = new Set(normalized.sessions.filter((session) => session.hasPdf).map((session) => session.id));
      const missingIds = [...expectedPdfIds].filter((id) => !storedPdfIds.has(id));
      const extraIds = [...storedPdfIds].filter((id) => !normalized.sessions.some((session) => session.id === id));
      if (!inspection.legacy && (missingIds.length > 0 || extraIds.length > 0)) throw new Error("バックアップ内のノートとPDFの対応が壊れています");
      if (inspection.legacy && missingIds.length > 0) {
        normalized = { ...normalized, sessions: normalized.sessions.map((session) => missingIds.includes(session.id) ? { ...session, hasPdf: false } : session) };
      }
      setPendingImport({ ...inspection, normalized });
      setImportMode("merge");
      setImportMessage("");
      void recordLocalMetric("import_preview", { legacy: inspection.legacy, pdfCount: inspection.pdfs.length });
    } catch (cause) {
      setImportMessage(cause instanceof Error ? cause.message : "このファイルは読み込めませんでした");
    }
  }

  async function applyPendingImport() {
    if (!pendingImport || importing) return;
    if (importMode === "replace") {
      const ok = window.confirm(`現在の講義${courses.length}件とPDFを置き換えます。先に完全バックアップを自動で書き出します。続けますか？`);
      if (!ok) return;
    }
    setImporting(true);
    try {
      if (importMode === "replace" && !(await exportNotebookData(true))) throw new Error("現在のデータを退避できなかったため、置き換えを中止しました");
      const merged = importMode === "merge"
        ? mergeImportedState(normalizeSavedState(currentSavedState()), pendingImport.normalized, pendingImport.pdfs)
        : { state: pendingImport.normalized, pdfs: pendingImport.pdfs };
      const required = merged.pdfs.reduce((total, entry) => total + entry.blob.size, 0);
      const health = await getStorageHealth();
      if (health.quota > 0 && health.quota - health.usage < required * 1.15 && importMode === "merge") throw new DOMException("保存容量が不足しています", "QuotaExceededError");
      saveEpoch.current += 1;
      await saveChain.current.catch(() => undefined);
      const saved = await restoreAppStateAndPdfs(merged.state, merged.pdfs, importMode === "replace", CURRENT_SCHEMA_VERSION, storageRevision.current, writerId.current);
      storageRevision.current = saved.revision;
      lastPersistedFingerprint.current = stateFingerprint(merged.state);
      applyNormalizedState(normalizeSavedState(merged.state));
      setLastSavedAt(saved.savedAt);
      setSaveStatus("saved");
      setAutoSaveEnabled(true);
      setLoadError("");
      setPendingImport(null);
      setImportMessage(importMode === "merge" ? "現在のデータに安全に追加しました" : "バックアップの内容に置き換えました");
      setStorageHealth(await getStorageHealth());
      storageChannel.current?.postMessage({ writerId: writerId.current, revision: saved.revision });
      void recordLocalMetric("import_completed", { mode: importMode, pdfCount: merged.pdfs.length });
    } catch (cause) {
      setImportMessage(isQuotaError(cause) ? "端末の空き容量が足りないため、現在のデータを変更せず中止しました" : cause instanceof Error ? cause.message : "読み込みを完了できませんでした");
    } finally {
      setImporting(false);
    }
  }

  function addCustomTag() {
    const tag = newTag.trim();
    if (!tag || !activeSession) return "";

    if (newTagScope === "global") {
      setGlobalTags((current) => current.includes(tag) ? current : [...current, tag]);
    } else {
      setCourseTags((current) => {
        const tags = current[activeSession.courseId] ?? current[activeSession.course] ?? [];
        return {
          ...current,
          [activeSession.courseId]: tags.includes(tag) ? tags : [...tags, tag],
        };
      });
    }
    setNewTag("");
    setShowTagCreator(false);
    return tag;
  }

  function returnToStart() {
    pdfLoadRequest.current += 1;
    setView("start");
    setPdfBlob(null);
    setActiveSessionId("");
    setFocusedMemoId(null);
    setShowPdf(false);
  }

  function returnToCourse() {
    pdfLoadRequest.current += 1;
    setView(workspaceReturnView === "review" ? "review" : selectedCourseId ? "course" : "start");
    setPdfBlob(null);
    setActiveSessionId("");
    setFocusedMemoId(null);
    setShowPdf(false);
  }

  async function reloadSavedState() {
    if (!window.confirm("このタブの未保存変更を破棄し、端末に保存済みの内容を読み込みますか？")) return;
    saveEpoch.current += 1;
    await saveChain.current.catch(() => undefined);
    try {
      const stored = await loadAppState<SavedState>();
      if (!stored || !isSavedStateShape(stored.data)) throw new Error("保存済みデータを確認できません");
      const normalized = normalizeSavedState(stored.data);
      applyNormalizedState(normalized);
      storageRevision.current = stored.revision;
      lastPersistedFingerprint.current = stateFingerprint(normalized);
      setLastSavedAt(stored.savedAt);
      setLoadError("");
      setAutoSaveEnabled(true);
      setSaveStatus("saved");
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "保存済みデータを読み込めませんでした");
    }
  }

  async function beginEmptyState() {
    if (!mayInitializeEmptyDevice({ backupConfirmed: resetBackupConfirmed, confirmationText: resetConfirmationText })) {
      setLoadError("初期化する前に、バックアップの確認欄と確認文字「初期化」を入力してください。保護中のデータは変更していません。");
      return;
    }
    if (!window.confirm("保護中の保存データに代えて、この端末を空の状態で初期化します。確認済みのバックアップはお手元にありますか？")) return;
    try {
      const current = await loadAppState<SavedState>();
      const empty = normalizeSavedState({ courses: [], sessions: [], memos: [], terms: [DEFAULT_TERM], activeTerm: DEFAULT_TERM, tutorialSeen: false, campus: EMPTY_CAMPUS_STATE, displayPreferences: DEFAULT_DISPLAY_PREFERENCES });
      saveEpoch.current += 1;
      await saveChain.current.catch(() => undefined);
      const saved = await saveAppState(empty, CURRENT_SCHEMA_VERSION, current?.revision ?? 0, writerId.current);
      storageRevision.current = saved.revision;
      lastPersistedFingerprint.current = stateFingerprint(empty);
      applyNormalizedState(empty);
      setLoadError("");
      setAutoSaveEnabled(true);
      setSaveStatus("saved");
      setShowTutorial(true);
      setResetBackupConfirmed(false);
      setResetConfirmationText("");
    } catch {
      setSaveStatus("error");
      setLoadError("新しい保存領域を作れませんでした。バックアップを書き出してから、ブラウザの空き容量をご確認ください。");
    }
  }

  async function makeStoragePersistent() {
    const persisted = await requestPersistentStorage();
    setStorageHealth(await getStorageHealth());
    setImportMessage(persisted ? "この端末で保存領域を維持する設定になりました" : "ブラウザの設定により永続化されませんでした。定期的なバックアップをご利用ください");
    void recordLocalMetric("storage_persist_result", { persisted });
  }

  function importLegacyCampusData() {
    const legacyBundle = readLegacyCampusBundle(window.localStorage, activeTerm || DEFAULT_TERM);
    if (!legacyBundle) {
      setImportMessage("この端末に旧CMTRデータは見つかりませんでした");
      setHasLegacyCampusData(false);
      return;
    }
    const legacy = legacyBundle.campus;
    const counts = {
      courses: legacyBundle.courses.length,
      terms: legacyBundle.termNames.length,
      assignments: legacy.assignments.length,
      exams: legacy.exams.length,
      attendance: legacy.attendanceRecords.length,
      tasks: legacy.studyTasks.length,
    };
    if (!window.confirm(`旧CMTRから授業${counts.courses}件、学期${counts.terms}件、提出物${counts.assignments}件、試験${counts.exams}件、出席${counts.attendance}件、学習タスク${counts.tasks}件を取り込みます。元のcmtr:*データは削除しません。よろしいですか？`)) return;
    const importedLegacyCampus = normalizeCampusState({
      ...legacy,
      betaAccess: {
        enabled: true,
        activatedAt: campus.betaAccess.activatedAt ?? new Date().toISOString(),
        importedLegacyAt: new Date().toISOString(),
      },
    });
    const mergedLegacy = mergeLegacyCampusData(courses, legacyBundle.courses, campus, importedLegacyCampus);
    setCourses(mergedLegacy.courses);
    setTerms((current) => Array.from(new Set([...current, ...legacyBundle.termNames])));
    if (legacyBundle.activeTermName) setActiveTerm(legacyBundle.activeTermName);
    setCampus(mergedLegacy.campus);
    setImportMessage("旧CMTRの授業・学期・大学生活データを取り込みました。元データは安全のため残しています");
    void recordLocalMetric("campus_legacy_imported", counts);
  }

  if (!hydrated) {
    return (
      <div className="memo-app">
        <aside className="app-rail" aria-label="メインメニュー">
          <div className="brand"><span className="brand-mark"><StickyNote size={21} /></span><span><strong>まなびメモ</strong><small>授業中は、まず書くだけ</small></span></div>
        </aside>
        <div className="app-main">
          <main className="admin-empty" aria-busy="true"><LoaderCircle className="spin" size={24} /><h1>端末のノートを読み込んでいます</h1><p>保存内容を確認してから表示します。</p></main>
        </div>
      </div>
    );
  }

  return (
    <div className="memo-app">
      <aside className="app-rail" aria-label="メインメニュー">
        <button className="brand" onClick={returnToStart}>
          <span className="brand-mark"><StickyNote size={21} /></span>
            <span><strong>まなびメモ</strong><small>授業中は、まず書くだけ</small></span>
        </button>

        <nav className="main-nav">
          <button className={view === "start" || view === "course" || (view === "workspace" && workspaceReturnView === "course") ? "active" : ""} onClick={returnToStart}>
            <CalendarDays size={19} />
            <span>時間割</span>
          </button>
          <button className={view === "review" || (view === "workspace" && workspaceReturnView === "review") ? "active" : ""} onClick={() => setView("review")}>
            <ListFilter size={19} />
            <span>ノートを見返す</span>
          </button>
          {campusVisible && <button className={view === "campus" ? "active campus-nav-button" : "campus-nav-button"} onClick={() => setView("campus")}>
            <GraduationCap size={19} />
            <span>大学生活<small>学びも遊びも</small></span>
          </button>}
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            <Settings2 size={19} />
            <span>設定</span>
          </button>
        </nav>

        <button className="rail-help" type="button" onClick={() => setShowHelp(true)}>
          <Lightbulb size={18} /><span>使い方・ヘルプ</span>
        </button>

        <button className="rail-feedback" type="button" onClick={() => setShowFeedback(true)}>
          <MessageCircle size={18} /><span>ご意見・不具合報告</span>
        </button>

      </aside>

      <AccountSync
        currentState={currentSavedState()}
        schemaVersion={CURRENT_SCHEMA_VERSION}
        hydrated={hydrated}
        localHasData={hasMeaningfulState(currentSavedState())}
        onApplyCloud={applyCloudAccountState}
        onCampusEntitlement={handleCampusEntitlement}
        onFirebaseAvailability={handleFirebaseAvailability}
      />

      <div className="app-main">
        <header className="mobile-header">
          <button className="mobile-brand" onClick={returnToStart}>
            <span className="brand-mark"><StickyNote size={18} /></span>
            <strong>まなびメモ</strong>
          </button>
          {view === "workspace" && <button className="quiet-button" onClick={returnToCourse}>{workspaceReturnView === "review" ? "見返しへ戻る" : "講義へ戻る"}</button>}
        </header>

        <div className={`save-state-bar ${saveStatus}`} role={saveStatus === "error" || saveStatus === "conflict" ? "alert" : "status"}>
          {saveStatus === "saving" ? <LoaderCircle className="spin" size={16} /> : saveStatus === "saved" ? <Check size={16} /> : <HardDrive size={16} />}
          <span>{saveStatusLabel(saveStatus, lastSavedAt)}</span>
        </div>

        {(loadError || saveStatus === "error" || saveStatus === "conflict") && (
          <div className="storage-alert" role="alert">
            <AlertTriangle size={18} />
            <span>
              <strong>{loadError ? "保存データを保護しています" : saveStatus === "conflict" ? "別のタブで更新されました" : "この端末に保存できていません"}</strong>
              <small>{loadError || (saveStatus === "conflict" ? "どちらの内容を残すか選んでください。自動では上書きしません。" : "ページを閉じる前に、バックアップを書き出してください。")}</small>
            </span>
            <div className="storage-alert-actions">
              {saveStatus === "conflict" && <button type="button" onClick={() => void exportNotebookData()}>このタブをバックアップ</button>}
              {saveStatus === "conflict" && <button type="button" onClick={() => void reloadSavedState()}>保存済みを再読込</button>}
              {loadError && <label className="reset-safety-check"><input type="checkbox" checked={resetBackupConfirmed} onChange={(event) => setResetBackupConfirmed(event.target.checked)} /><span>バックアップを保管した、または不要と確認しました</span></label>}
              {loadError && <label className="reset-safety-text"><span>確認のため「初期化」と入力</span><input value={resetConfirmationText} onChange={(event) => setResetConfirmationText(event.target.value)} /></label>}
              {loadError && <button type="button" disabled={!mayInitializeEmptyDevice({ backupConfirmed: resetBackupConfirmed, confirmationText: resetConfirmationText })} onClick={() => void beginEmptyState()}>空の状態で初期化する</button>}
            </div>
          </div>
        )}

        <main className={view === "workspace" ? "workspace-main" : ""}>
          {view === "start" && (
            <StartView
              courses={activeCourses}
              terms={terms}
              todayDay={hydrated ? new Date().getDay() : 0}
              activeTerm={activeTerm}
              setActiveTerm={setActiveTerm}
              recentSessions={activeSessions.filter((session) => { const course = activeCourses.find((item) => item.id === session.courseId); return course?.term === activeTerm && !course.archivedAt; }).slice(0, 4)}
              memoCount={(sessionId) => activeMemos.filter((memo) => memo.sessionId === sessionId).length}
              courseMemoCount={(courseId) => activeMemos.filter((memo) => memo.courseId === courseId).length}
              onAddCourse={openCourseDialog}
              onAddTerm={() => setShowTermDialog(true)}
              onPlaceCourse={setPlacementCourseId}
              onSelectCourse={openCourseFromTimetable}
              onOpen={openSession}
              todayMemo={todayMemo}
              onOpenMemo={openMemoOrigin}
              onReflect={setReflectionMemoId}
              onRestoreCourse={restoreCourse}
            />
          )}

          {view === "course" && selectedCourse && (
            <CourseDetailView
              course={selectedCourse}
              sessions={activeSessions.filter((session) => session.courseId === selectedCourse.id)}
              memoCount={(sessionId) => activeMemos.filter((memo) => memo.sessionId === sessionId).length}
              onBack={() => setView(courseReturnView)}
              onStart={() => { setSelectedSession(nextSessionNumber(selectedCourse.id, activeSessions)); setShowSessionDialog(true); }}
              onOpen={openSession}
              onEditCourse={() => setEditingCourseId(selectedCourse.id)}
              onEditSession={setEditingSessionId}
              onDeleteSession={deleteSession}
              onArchive={() => archiveCourse(selectedCourse.id)}
              onDelete={() => deleteCourse(selectedCourse.id)}
              backLabel={courseReturnView === "campus" ? "Campus Musterへ戻る" : "時間割へ戻る"}
              campusEnabled={campusAccessEnabled}
              nextAssignment={campus.assignments.filter((item) => item.courseId === selectedCourse.id && item.status !== "done").sort((a, b) => a.dueISO.localeCompare(b.dueISO))[0]}
              nextExam={campus.exams.filter((item) => item.courseId === selectedCourse.id).sort((a, b) => a.datetime.localeCompare(b.datetime))[0]}
              onOpenCampus={() => setView("campus")}
            />
          )}

          {view === "campus" && campusVisible && (
            <CampusModule
              campus={effectiveCampusEntitlement === null ? campus : normalizeCampusState({
                ...campus,
                betaAccess: { ...campus.betaAccess, enabled: effectiveCampusEntitlement },
              })}
              courses={activeCourses}
              terms={terms}
              activeTerm={activeTerm}
              onChange={setCampus}
              onOpenCourse={openCourseFromCampus}
              onLeave={returnToStart}
              onImportLegacy={importLegacyCampusData}
              onActivated={() => setAccountCampusEntitlement(true)}
              hasLegacyData={hasLegacyCampusData}
              firebaseEnabled={localCampusPreview ? true : firebaseEnabled}
              localPreview={localCampusPreview}
            />
          )}

          {view === "review" && (
            <ReviewView
              courses={activeCourses}
              sessions={activeSessions}
              reviewKind={reviewKind}
              setReviewKind={setReviewKind}
              noteReviewState={noteReviewState}
              setNoteReviewState={(changes) => setNoteReviewState((current) => ({ ...current, ...changes }))}
              terms={terms}
              tags={allReviewTags}
              term={reviewTerm}
              setTerm={setReviewTerm}
              course={reviewCourse}
              setCourse={setReviewCourse}
              tag={reviewTag}
              setTag={setReviewTag}
              query={reviewQuery}
              setQuery={setReviewQuery}
              memos={filteredMemos}
              allMemos={activeMemos}
              memoCount={(sessionId) => activeMemos.filter((memo) => memo.sessionId === sessionId).length}
              onOpenNote={(session) => void openSession(session, undefined, undefined, undefined, "review")}
              onEditNote={(session) => {
                setSelectedCourseId(session.courseId);
                setEditingSessionId(session.id);
              }}
              onDeleteNote={deleteSession}
              onOpenMemo={(memo) => openMemoOrigin(memo, "review")}
              onReflect={setReflectionMemoId}
              onTogglePin={toggleMemoPin}
              onStartReview={beginMemoReview}
              onReviewResult={recordMemoReview}
              onStopReview={finishMemoReview}
              onStart={returnToStart}
              onExport={exportNotebookData}
              onImport={importNotebookData}
              importMessage={importMessage}
              storageHealth={storageHealth}
              metricSummary={metricSummary}
              onPersist={makeStoragePersistent}
            />
          )}

          {view === "settings" && (
            <SettingsView
              campusEligible={effectiveCampusEntitlement ?? campus.betaAccess.enabled}
              firebaseEnabled={firebaseEnabled}
              displayPreferences={displayPreferences}
              onChangeDisplay={setDisplayPreferences}
              onOpenAccount={() => window.dispatchEvent(new Event("manabi-memo:open-account"))}
              onExport={exportNotebookData}
              onImport={importNotebookData}
              importMessage={importMessage}
              storageHealth={storageHealth}
              metricSummary={metricSummary}
              onPersist={makeStoragePersistent}
              courses={courses}
              sessions={sessions}
              memos={memos}
              onRestore={restoreTrashItem}
            />
          )}

          {view === "workspace" && activeSession && (
            <WorkspaceView
              key={activeSession.id}
              session={activeSession}
              memos={sessionMemos}
              pdfBlob={pdfBlob}
              showPdf={showPdf}
              setShowPdf={setShowPdf}
              page={page}
              setPage={changePdfPage}
              globalTags={globalTags}
              courseTags={currentCourseTags}
              showTagCreator={showTagCreator}
              setShowTagCreator={setShowTagCreator}
              newTag={newTag}
              setNewTag={setNewTag}
              newTagScope={newTagScope}
              setNewTagScope={setNewTagScope}
              addCustomTag={addCustomTag}
              createMemo={createMemo}
              updateMemo={updateMemo}
              updateSessionNote={updateSessionNote}
              updateNotebookPrefs={updateNotebookPrefs}
              hasCourseTemplate={Boolean(courseTemplates[activeSession.courseId])}
              saveCourseTemplate={saveCourseTemplate}
              clearCourseTemplate={clearCourseTemplate}
              deleteMemo={deleteMemo}
              attachPdf={attachPdf}
              attachPdfFile={attachPdfFile}
              releasePdfToReference={releasePdfToReference}
              pdfStatus={pdfStatus}
              initialMemoId={focusedMemoId}
              saveStatus={saveStatus}
              lastSavedAt={lastSavedAt}
              onBack={returnToCourse}
            />
          )}
        </main>
      </div>

      {view !== "workspace" && (
        <nav className={`mobile-nav${campusVisible ? " has-campus" : ""}`} aria-label="モバイルメニュー">
          <button className={view === "start" || view === "course" ? "active" : ""} onClick={returnToStart}>
            <CalendarDays size={20} /><span>時間割</span>
          </button>
          <button className={view === "review" ? "active" : ""} onClick={() => setView("review")}>
            <ListFilter size={20} /><span>見返す</span>
          </button>
          {campusVisible && <button className={view === "campus" ? "active" : ""} onClick={() => setView("campus")}>
            <GraduationCap size={20} /><span>大学生活</span>
          </button>}
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            <Settings2 size={20} /><span>設定</span>
          </button>
        </nav>
      )}

      <div className="mobile-utility-buttons">
        <button className="mobile-feedback" type="button" aria-label="ご意見・不具合報告" title="ご意見・不具合報告" onClick={() => setShowFeedback(true)}><MessageCircle size={19} /></button>
        <button className="mobile-help" type="button" aria-label="使い方・ヘルプ" title="使い方・ヘルプ" onClick={() => setShowHelp(true)}><Lightbulb size={20} /></button>
      </div>

      {showCourseDialog && (
        <CourseDialog
          onClose={() => setShowCourseDialog(false)}
          onSubmit={registerCourse}
          defaultTerm={activeTerm}
          defaultWeekday={courseDialogDefaults.weekday}
          defaultPeriod={courseDialogDefaults.period}
        />
      )}

      {editingCourseId && activeCourses.find((course) => course.id === editingCourseId) && (
        <CourseEditDialog course={activeCourses.find((course) => course.id === editingCourseId) as Course} onClose={() => setEditingCourseId(null)} onSave={saveCourseEdit} />
      )}

      {editingSessionId && activeSessions.find((session) => session.id === editingSessionId) && (
        <SessionEditDialog session={activeSessions.find((session) => session.id === editingSessionId) as SessionRecord} sessions={activeSessions.filter((session) => session.courseId === selectedCourseId)} onClose={() => setEditingSessionId(null)} onSave={(number, title) => saveSessionEdit(editingSessionId, number, title)} />
      )}

      {showTermDialog && <TermDialog existingTerms={terms} onClose={() => setShowTermDialog(false)} onSubmit={addTerm} />}

      {placementCourseId && activeCourses.find((course) => course.id === placementCourseId) && (
        <CoursePlacementDialog
          course={activeCourses.find((course) => course.id === placementCourseId) as Course}
          courses={activeCourses}
          onClose={() => setPlacementCourseId(null)}
          onPlace={placeCourse}
          onUnplace={unplaceCourse}
        />
      )}

      {showHelp && (
        <HelpDialog
          view={view}
          onClose={() => setShowHelp(false)}
          onRestartTutorial={() => { setShowHelp(false); setShowTutorial(true); }}
        />
      )}

      {showFeedback && <FeedbackDialog view={view} onClose={() => setShowFeedback(false)} />}

      {showTutorial && (
        <TutorialOverlay
          onClose={finishTutorial}
          onFinish={finishTutorial}
        />
      )}

      {showSessionDialog && selectedCourse && (
        <SessionStartDialog
          course={selectedCourse}
          sessionNumber={selectedSession}
          setSessionNumber={setSelectedSession}
          draftPdf={draftPdf}
          setDraftPdf={setDraftPdf}
          starting={starting}
          progress={startProgress}
          error={startError}
          existing={existingSelection}
          onClose={() => setShowSessionDialog(false)}
          onStart={startSelectedSession}
        />
      )}

      {reflectionMemo && (
        <ReflectionDialog
          memo={reflectionMemo}
          onClose={() => setReflectionMemoId(null)}
          onSave={(status, text) => addReflection(reflectionMemo.id, status, text)}
        />
      )}

      {pendingImport && <ImportPreviewDialog pending={pendingImport} mode={importMode} setMode={setImportMode} importing={importing} onClose={() => !importing && setPendingImport(null)} onApply={() => void applyPendingImport()} />}

      {undoAction && <div className="undo-toast" role="status" aria-live="polite"><span>{undoAction.message}</span><button type="button" onClick={() => { undoAction.undo(); setUndoAction(null); }}><History size={15} /> 元に戻す</button></div>}
    </div>
  );
}

function SettingsView({
  campusEligible,
  firebaseEnabled,
  displayPreferences,
  onChangeDisplay,
  onOpenAccount,
  onExport,
  onImport,
  importMessage,
  storageHealth,
  metricSummary,
  onPersist,
  courses,
  sessions,
  memos,
  onRestore,
}: {
  campusEligible: boolean;
  firebaseEnabled: boolean | null;
  displayPreferences: DisplayPreferences;
  onChangeDisplay: (value: DisplayPreferences) => void;
  onOpenAccount: () => void;
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  importMessage: string;
  storageHealth: { persisted: boolean; usage: number; quota: number };
  metricSummary: Record<string, number>;
  onPersist: () => void;
  courses: Course[];
  sessions: SessionRecord[];
  memos: Memo[];
  onRestore: (kind: "course" | "session" | "memo", id: string) => void;
}) {
  const trashedCourses = trashOnly(courses);
  const trashedCourseIds = new Set(trashedCourses.map((course) => course.id));
  const trashedSessions = trashOnly(sessions).filter((session) => !trashedCourseIds.has(session.courseId));
  const trashedSessionIds = new Set(trashedSessions.map((session) => session.id));
  const trashedMemos = trashOnly(memos).filter((memo) => !trashedCourseIds.has(memo.courseId) && !trashedSessionIds.has(memo.sessionId));
  const trashCount = trashedCourses.length + trashedSessions.length + trashedMemos.length;

  return (
    <div className="settings-page">
      <header className="review-heading settings-page-heading"><div><p className="eyebrow">SETTINGS</p><h1>設定</h1><p>アカウント、データ管理、表示を分けて確認できます。</p></div></header>

      <div className="settings-section-grid">
        <section className="settings-section-card">
          <div className="settings-section-title"><span><ShieldCheck size={21} /></span><div><p className="eyebrow">ACCOUNT</p><h2>アカウント</h2></div></div>
          <p>ログイン状態、クラウド同期、端末間で共有する内容を確認します。別アカウントの同期情報が残る場合は、自動同期を停止します。</p>
          <button type="button" className="settings-primary-action" onClick={onOpenAccount}>アカウントと同期を開く <ChevronRight size={16} /></button>
        </section>

        <section className="settings-section-card settings-data-card">
          <div className="settings-section-title"><span><HardDrive size={21} /></span><div><p className="eyebrow">DATA MANAGEMENT</p><h2>データ管理</h2></div></div>
          <p>講義、ノート、付箋、PDFをまとめてバックアップできます。ブラウザデータを消す前に保管してください。</p>
          <div className="settings-data-actions">
            <button type="button" onClick={onExport}><Download size={16} /> 完全バックアップ</button>
            <label><Upload size={16} /> バックアップを読み込む<input type="file" accept=".manabimemo,.json,application/json,application/x-manabi-memo" onChange={onImport} /></label>
            <button type="button" onClick={onPersist}>{storageHealth.persisted ? <Check size={16} /> : <HardDrive size={16} />}{storageHealth.persisted ? "保存の維持は設定済み" : "端末保存を安定させる"}</button>
          </div>
          {importMessage && <small className="settings-message" role="status">{importMessage}</small>}
          <dl className="settings-storage-summary"><div><dt>使用量</dt><dd>{formatBytes(storageHealth.usage)}</dd></div><div><dt>利用可能枠</dt><dd>{storageHealth.quota ? formatBytes(storageHealth.quota) : "確認不可"}</dd></div><div><dt>端末内の操作記録</dt><dd>{Object.values(metricSummary).reduce((total, count) => total + count, 0)}件</dd></div></dl>

          <div className="trash-panel">
            <div className="trash-panel-heading"><span><Trash2 size={18} /></span><div><h3>共通ごみ箱</h3><p>削除した講義・ノート・付箋は30日間復元できます。</p></div><b>{trashCount}</b></div>
            {trashCount > 0 ? <div className="trash-list">
              {trashedCourses.map((course) => <TrashRow key={`course-${course.id}`} title={course.title} detail="講義とすべての授業回" days={trashDaysRemaining(course)} onRestore={() => onRestore("course", course.id)} />)}
              {trashedSessions.map((session) => <TrashRow key={`session-${session.id}`} title={session.title} detail={`${session.course}・${sessionLabel(session.sessionNumber)}`} days={trashDaysRemaining(session)} onRestore={() => onRestore("session", session.id)} />)}
              {trashedMemos.map((memo) => <TrashRow key={`memo-${memo.id}`} title={memo.text.trim().slice(0, 42) || "空の付箋"} detail={`${memo.course}・${sessionLabel(memo.sessionNumber)}の付箋`} days={trashDaysRemaining(memo)} onRestore={() => onRestore("memo", memo.id)} />)}
            </div> : <p className="trash-empty">ごみ箱は空です。</p>}
          </div>
        </section>

        <section className="settings-section-card">
          <div className="settings-section-title"><span><Settings2 size={21} /></span><div><p className="eyebrow">DISPLAY</p><h2>表示</h2></div></div>
          <label className="settings-toggle-row"><span><strong>Campus Musterを表示</strong><small>{firebaseEnabled === false ? "Firebase未設定のため、招待ベータは利用できません。時間割・ノートなど端末内の基本機能は引き続き利用できます。" : campusEligible ? "大学生活管理をメニューへ追加します。" : "表示をONにした後、Firebaseログインと招待コードでベータを有効化できます。"}</small></span><input type="checkbox" checked={displayPreferences.campusMusterEnabled} onChange={(event) => onChangeDisplay({ ...displayPreferences, campusMusterEnabled: event.target.checked })} /></label>
        </section>
      </div>
    </div>
  );
}

function TrashRow({ title, detail, days, onRestore }: { title: string; detail: string; days: number; onRestore: () => void }) {
  return <article><span><strong>{title}</strong><small>{detail}・あと{days}日</small></span><button type="button" onClick={onRestore}><History size={15} /> 元に戻す</button></article>;
}

function StartView({
  courses,
  terms,
  todayDay,
  activeTerm,
  setActiveTerm,
  recentSessions,
  memoCount,
  courseMemoCount,
  onAddCourse,
  onAddTerm,
  onPlaceCourse,
  onSelectCourse,
  onOpen,
  todayMemo,
  onOpenMemo,
  onReflect,
  onRestoreCourse,
}: {
  courses: Course[];
  terms: string[];
  todayDay: number;
  activeTerm: string;
  setActiveTerm: (term: string) => void;
  recentSessions: SessionRecord[];
  memoCount: (sessionId: string) => number;
  courseMemoCount: (courseId: string) => number;
  onAddCourse: (weekday?: number | null, period?: number | null) => void;
  onAddTerm: () => void;
  onPlaceCourse: (courseId: string) => void;
  onSelectCourse: (courseId: string) => void;
  onOpen: (session: SessionRecord) => void;
  todayMemo: Memo | null;
  onOpenMemo: (memo: Memo) => void;
  onReflect: (memoId: string) => void;
  onRestoreCourse: (courseId: string) => void;
}) {
  const availableTerms = terms.length > 0 ? terms : [DEFAULT_TERM];
  const displayedTerm = availableTerms.includes(activeTerm) ? activeTerm : availableTerms[0];
  const termCourses = courses.filter((course) => !course.archivedAt && (course.term || "学期未設定") === displayedTerm);
  const archivedCourses = courses.filter((course) => course.archivedAt && (course.term || "学期未設定") === displayedTerm);
  const placedCourseIds = new Set<string>();
  const today = todayDay;

  return (
    <div className="timetable-page">
      <header className="timetable-heading">
        <div>
          <p className="eyebrow">YOUR TIMETABLE</p>
          <h1>{displayedTerm}</h1>
          <p>講義を選ぶと、次の授業ノートをすぐに始められます。</p>
        </div>
        <div className="timetable-heading-actions">
          <label className="term-switcher">
            <span>学期</span>
            <select value={displayedTerm} onChange={(event) => setActiveTerm(event.target.value)}>
              {availableTerms.map((term) => <option value={term} key={term}>{term}</option>)}
            </select>
          </label>
          <button type="button" className="term-add" onClick={onAddTerm}><Plus size={16} /> 新しい学期</button>
          <button type="button" className="timetable-add" onClick={() => onAddCourse(null, null)}>
            <Plus size={17} /> 講義を追加
          </button>
        </div>
      </header>

      {termCourses.length === 0 && (
        <div className="empty-term-guide"><CalendarDays size={19} /><span><strong>この学期の時間割はまだ空です</strong><small>空いているマスを押すか、「講義を追加」から始められます。</small></span></div>
      )}

      <section className="timetable-shell" aria-label={displayedTerm + "の時間割"}>
        <div className="timetable-guide"><span>講義をタップ</span><p>授業回とPDFを確認してノートへ進みます</p></div>
        <div className="timetable-grid">
          <div className="timetable-corner" aria-hidden="true" />
          {weekdays.map((day) => (
            <div className={today === day.value ? "weekday-heading today" : "weekday-heading"} key={day.value}>
              <span>{day.short}</span><small>{day.label}</small>
            </div>
          ))}

          {periods.map((period) => (
            <div className="timetable-row" key={period.value}>
              <div className="period-heading">
                <strong>{period.value}</strong>
                <span>{period.start}<i />{period.end}</span>
              </div>
              {weekdays.map((day) => {
                const slotCourses = termCourses.filter((course) => course.weekday === day.value && course.period === period.value);
                const course = slotCourses[0];
                if (course) placedCourseIds.add(course.id);
                return course ? (
                  <article
                    className={today === day.value ? "timetable-course today" : "timetable-course"}
                    key={day.value}
                  >
                    <button type="button" className="course-open-area" onClick={() => onSelectCourse(course.id)} aria-label={course.title + "の授業ノートを始める"}>
                      <strong>{course.title}</strong>
                      <span>{course.room || course.instructor || "教室未設定"}</span>
                      <small>付箋 {courseMemoCount(course.id)}枚</small>
                    </button>
                    <button type="button" className="course-place-edit" onClick={() => onPlaceCourse(course.id)} aria-label={course.title + "の配置を変更"}><Settings2 size={12} /><span>配置</span></button>
                    {slotCourses.length > 1 && <b>+{slotCourses.length - 1}</b>}
                  </article>
                ) : (
                  <button
                    type="button"
                    className={today === day.value ? "timetable-empty today" : "timetable-empty"}
                    key={day.value}
                    onClick={() => onAddCourse(day.value, period.value)}
                    aria-label={day.label + period.value + "限に講義を追加"}
                  >
                    <Plus size={15} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {termCourses.filter((course) => !placedCourseIds.has(course.id)).length > 0 && (
        <section className="unplaced-section">
          <div className="section-title"><div><p className="eyebrow">OTHER COURSES</p><h2>時間割に未配置</h2></div><span>曜日・時限はあとで設定できます</span></div>
          <div className="unplaced-list">
            {termCourses.filter((course) => !placedCourseIds.has(course.id)).map((course) => (
              <article key={course.id} className="unplaced-course-card">
                <span className="course-tile-icon"><BookOpen size={17} /></span>
                <span><strong>{course.title}</strong><small>{course.instructor || "担当教員未設定"}・付箋{courseMemoCount(course.id)}枚</small></span>
                <div><button type="button" onClick={() => onPlaceCourse(course.id)}><CalendarDays size={14} /> 時間割に配置</button><button type="button" aria-label={course.title + "のノートを開く"} onClick={() => onSelectCourse(course.id)}><ChevronRight size={17} /></button></div>
              </article>
            ))}
          </div>
        </section>
      )}

      {recentSessions.length > 0 && (
        <section className="recent-section">
          <div className="section-title"><div><p className="eyebrow">RECENT</p><h2>最近の授業</h2></div></div>
          <div className="recent-list">
            {recentSessions.map((session) => (
              <button key={session.id} className="recent-session" onClick={() => onOpen(session)}>
                <span className="session-badge">{session.sessionNumber}</span>
                <span className="recent-copy"><strong>{session.course}</strong><small>{sessionLabel(session.sessionNumber)}・付箋 {memoCount(session.id)}枚</small></span>
                {session.hasPdf && <span className="pdf-badge"><FileText size={13} /> PDF</span>}
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        </section>
      )}

      {todayMemo && (
        <section className="again-section" aria-labelledby="again-title">
          <div className="section-title">
            <div><p className="eyebrow">ONE MORE LOOK</p><h2 id="again-title">もう一度見る</h2></div>
            <span>過去の付箋から、今日は1枚だけ</span>
          </div>
          <div className={`again-card tone-${memoTone(todayMemo.id)}`}>
            <div className="again-card-copy">
              <div className="sticky-tags">
                {todayMemo.tags.length > 0
                  ? todayMemo.tags.map((tag) => <span key={tag}>{tag}</span>)
                  : <span>ジャンルなし</span>}
              </div>
              <p>{todayMemo.text}</p>
              <small>{todayMemo.course}・{sessionLabel(todayMemo.sessionNumber)}{todayMemo.page ? `・資料${todayMemo.page}ページ` : ""}</small>
            </div>
            <div className="again-card-actions">
              <button type="button" className="again-open" onClick={() => onOpenMemo(todayMemo)}>元のノートを開く</button>
              <button type="button" className="again-reflect" onClick={() => onReflect(todayMemo.id)}>今の考えを一言足す</button>
            </div>
          </div>
        </section>
      )}

      {archivedCourses.length > 0 && <details className="archived-section"><summary><span><strong>しまった講義</strong><small>{archivedCourses.length}件・ノートと付箋は残っています</small></span></summary><div>{archivedCourses.map((course) => <span className="archived-course-row" key={course.id}><span><strong>{course.title}</strong><small>{course.instructor || course.term}</small></span><button type="button" onClick={() => onRestoreCourse(course.id)}>時間割へ戻す</button></span>)}</div></details>}
    </div>
  );
}

function CourseRegistrationForm({
  onSubmit,
  submitLabel = "講義を登録する",
  defaultTerm = DEFAULT_TERM,
  defaultWeekday = null,
  defaultPeriod = null,
  initialValue,
}: {
  onSubmit: (input: CourseInput) => void;
  submitLabel?: string;
  defaultTerm?: string;
  defaultWeekday?: number | null;
  defaultPeriod?: number | null;
  initialValue?: Course;
}) {
  const [title, setTitle] = useState(initialValue?.title ?? "");
  const [term, setTerm] = useState(initialValue?.term ?? defaultTerm);
  const [instructor, setInstructor] = useState(initialValue?.instructor ?? "");
  const [weekday, setWeekday] = useState<number | null>(initialValue?.weekday ?? defaultWeekday);
  const [period, setPeriod] = useState<number | null>(initialValue?.period ?? defaultPeriod);
  const [room, setRoom] = useState(initialValue?.room ?? "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    onSubmit({ title, term, instructor, weekday, period, room });
  }

  return (
    <form className="registration-form" onSubmit={submit}>
      <div className="registration-heading">
        <span className="course-tile-icon"><BookOpen size={19} /></span>
        <div><strong>講義の情報</strong><small>講義名だけで登録できます</small></div>
      </div>
      <div className="registration-grid">
        <label className="registration-field required">
          <span>講義名</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例：経済学入門" autoFocus />
        </label>
        <label className="registration-field">
          <span>学期</span>
          <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="例：2026年度 前期" />
        </label>
        <label className="registration-field">
          <span>担当教員 <small>任意</small></span>
          <input value={instructor} onChange={(event) => setInstructor(event.target.value)} placeholder="例：山田先生" />
        </label>
        <label className="registration-field schedule-field">
          <span>曜日 <small>任意</small></span>
          <select value={weekday ?? ""} onChange={(event) => setWeekday(event.target.value ? Number(event.target.value) : null)}>
            <option value="">未設定</option>
            {weekdays.map((day) => <option value={day.value} key={day.value}>{day.label}</option>)}
          </select>
        </label>
        <label className="registration-field schedule-field">
          <span>時限 <small>任意</small></span>
          <select value={period ?? ""} onChange={(event) => setPeriod(event.target.value ? Number(event.target.value) : null)}>
            <option value="">未設定</option>
            {periods.map((item) => <option value={item.value} key={item.value}>{item.value}限</option>)}
          </select>
        </label>
        <label className="registration-field schedule-field room-field">
          <span>教室 <small>任意</small></span>
          <input value={room} onChange={(event) => setRoom(event.target.value)} placeholder="例：321" />
        </label>
      </div>
      <button className="registration-submit" type="submit" disabled={!title.trim()}>
        <Plus size={17} /> {submitLabel} <ChevronRight size={17} />
      </button>
    </form>
  );
}

function CourseDialog({
  onClose,
  onSubmit,
  defaultTerm,
  defaultWeekday,
  defaultPeriod,
}: {
  onClose: () => void;
  onSubmit: (input: CourseInput) => void;
  defaultTerm: string;
  defaultWeekday: number | null;
  defaultPeriod: number | null;
}) {
  useEffect(() => {
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="course-dialog" role="dialog" aria-modal="true" aria-labelledby="course-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-heading">
          <div><p className="eyebrow">NEW COURSE</p><h2 id="course-dialog-title">新しい講義を登録</h2><span>登録後、第1回の授業ノートから始められます。</span></div>
          <button className="dialog-close" type="button" aria-label="閉じる" onClick={onClose}><X size={19} /></button>
        </div>
        <CourseRegistrationForm
          onSubmit={onSubmit}
          defaultTerm={defaultTerm}
          defaultWeekday={defaultWeekday}
          defaultPeriod={defaultPeriod}
        />
      </section>
    </div>
  );
}

function CourseDetailView({
  course, sessions, memoCount, onBack, onStart, onOpen, onEditCourse, onEditSession, onDeleteSession, onArchive, onDelete,
  backLabel, campusEnabled, nextAssignment, nextExam, onOpenCampus,
}: {
  course: Course;
  sessions: SessionRecord[];
  memoCount: (sessionId: string) => number;
  onBack: () => void;
  onStart: () => void;
  onOpen: (session: SessionRecord) => void;
  onEditCourse: () => void;
  onEditSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onArchive: () => void;
  onDelete: () => void;
  backLabel: string;
  campusEnabled: boolean;
  nextAssignment?: CampusState["assignments"][number];
  nextExam?: CampusState["exams"][number];
  onOpenCampus: () => void;
}) {
  const ordered = [...sessions].sort((a, b) => Number(normalizeSessionNumber(a.sessionNumber)) - Number(normalizeSessionNumber(b.sessionNumber)));
  const stickyCount = ordered.reduce((total, session) => total + memoCount(session.id), 0);
  return (
    <div className="course-detail-page">
      <button type="button" className="course-detail-back" onClick={onBack}><ArrowLeft size={17} /> {backLabel}</button>
      <header className="course-detail-header">
        <div className="course-detail-identity"><span className="course-detail-icon"><BookOpen size={23} /></span><div><p className="eyebrow">COURSE NOTEBOOK</p><h1>{course.title}</h1><p>{course.term}・{course.weekday ? weekdayLabel(course.weekday) : "曜日未設定"}{course.period ? `${course.period}限` : ""}{course.room ? `・${course.room}` : ""}{course.instructor ? `・${course.instructor}` : ""}</p></div></div>
        <div className="course-detail-actions">
          <button type="button" onClick={onEditCourse}><Settings2 size={15} /> 講義を編集</button>
          <button type="button" onClick={onArchive}><Archive size={15} /> 時間割からしまう</button>
          <button type="button" className="danger" onClick={onDelete}><Trash2 size={15} /> 削除</button>
        </div>
      </header>
      <div className="course-detail-layout">
        <aside className="course-overview-card"><span>この講義</span><dl><div><dt>授業回</dt><dd>{ordered.length}</dd></div><div><dt>付箋</dt><dd>{stickyCount}</dd></div><div><dt>PDF</dt><dd>{ordered.filter((item) => item.hasPdf).length}</dd></div></dl><button type="button" className="course-next-button" onClick={onStart}><Plus size={17} /> 第{nextSessionNumber(course.id, sessions)}回を始める</button><p>PDFは後からでも追加できます。まず本文だけで始めても大丈夫です。</p>{campusEnabled && <div className="course-campus-summary"><span><GraduationCap size={16} /> Campus Muster</span><p><strong>次の提出物</strong>{nextAssignment ? `${nextAssignment.title} · ${formatDateTime(nextAssignment.dueISO)}` : "登録なし"}</p><p><strong>次の試験</strong>{nextExam ? `${nextExam.title} · ${formatDateTime(nextExam.datetime)}` : "登録なし"}</p><button type="button" onClick={onOpenCampus}>大学生活管理を開く <ChevronRight size={15} /></button></div>}</aside>
        <section className="session-library"><div className="section-title"><div><p className="eyebrow">ALL CLASSES</p><h2>すべての授業回</h2></div></div>
          {ordered.length > 0 ? <div className="session-library-list">{ordered.map((session) => (
            <article className="session-library-row" key={session.id}>
              <button type="button" className="session-library-open" onClick={() => onOpen(session)}><span className="session-number">{normalizeSessionNumber(session.sessionNumber)}</span><span className="session-library-copy"><strong>{session.title}</strong><small>{formatDate(session.updatedAt || session.createdAt)}・本文{session.noteText.trim() ? "あり" : "なし"}・付箋{memoCount(session.id)}枚</small></span><span className="session-flags">{session.hasPdf && <i><FileText size={13} /> PDF</i>}<ChevronRight size={17} /></span></button>
              <div className="session-library-tools"><button type="button" aria-label={`${sessionLabel(session.sessionNumber)}を編集`} onClick={() => onEditSession(session.id)}><Settings2 size={16} /></button><button type="button" className="danger" aria-label={`${sessionLabel(session.sessionNumber)}を削除`} onClick={() => onDeleteSession(session.id)}><Trash2 size={16} /></button></div>
            </article>
          ))}</div> : <div className="course-empty-sessions"><div><NotebookPen size={29} /><h3>まだ授業回がありません</h3><p>本文だけなら、すぐに書き始められます。</p><button type="button" onClick={onStart}>第1回を始める</button></div></div>}
        </section>
      </div>
    </div>
  );
}

function NoteReviewPanel({
  courses,
  sessions,
  state,
  onChange,
  memoCount,
  onOpen,
  onEdit,
  onDelete,
}: {
  courses: Course[];
  sessions: SessionRecord[];
  state: NoteReviewState;
  onChange: (changes: Partial<NoteReviewState>) => void;
  memoCount: (sessionId: string) => number;
  onOpen: (session: SessionRecord) => void;
  onEdit: (session: SessionRecord) => void;
  onDelete: (sessionId: string) => void;
}) {
  const { layout, query, term, courseId, content, sort, timetableCourseId } = state;
  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const terms = useMemo(() => Array.from(new Set(courses.map((course) => course.term).filter(Boolean))).sort().reverse(), [courses]);
  const orderedCourses = useMemo(() => [...courses].sort((a, b) => a.title.localeCompare(b.title, "ja")), [courses]);
  const emptyCount = sessions.filter((session) => !session.noteText.trim() && !session.hasPdf && memoCount(session.id) === 0).length;
  const filledCount = sessions.length - emptyCount;
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");

  const filteredSessions = sessions
    .filter((session) => {
      const linkedCourse = courseById.get(session.courseId);
      const count = memoCount(session.id);
      const isEmpty = !session.noteText.trim() && !session.hasPdf && count === 0;
      if (term !== "all" && linkedCourse?.term !== term) return false;
      if (courseId !== "all" && session.courseId !== courseId) return false;
      if (content === "empty" && !isEmpty) return false;
      if (content === "body" && !session.noteText.trim()) return false;
      if (content === "pdf" && !session.hasPdf) return false;
      if (content === "memo" && count === 0) return false;
      if (!normalizedQuery) return true;
      return [session.course, session.title, session.fileName, session.noteText, ...session.pageTexts, ...session.topics.map((topic) => topic.label)]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("ja").includes(normalizedQuery));
    })
    .sort((a, b) => {
      if (sort === "course") {
        const byCourse = a.course.localeCompare(b.course, "ja");
        return byCourse || Number(normalizeSessionNumber(a.sessionNumber)) - Number(normalizeSessionNumber(b.sessionNumber));
      }
      const aTime = new Date(a.updatedAt || a.createdAt).getTime() || 0;
      const bTime = new Date(b.updatedAt || b.createdAt).getTime() || 0;
      return sort === "oldest" ? aTime - bTime : bTime - aTime;
    });

  function clearFilters() {
    onChange({ query: "", term: "all", courseId: "all", content: "all", sort: "newest" });
  }

  return (
    <div className="note-review-panel">
      <div className="note-layout-switch" role="tablist" aria-label="ノートの表示方法">
        <button type="button" role="tab" aria-selected={layout === "list"} className={layout === "list" ? "active" : ""} onClick={() => onChange({ layout: "list" })}><Rows3 size={16} /> 一覧から選ぶ</button>
        <button type="button" role="tab" aria-selected={layout === "timetable"} className={layout === "timetable" ? "active" : ""} onClick={() => onChange({ layout: "timetable", ...(term === "all" && terms[0] ? { term: terms[0] } : {}) })}><CalendarDays size={16} /> 時間割から選ぶ</button>
      </div>

      <section className="note-management-summary" aria-label="ノートの件数">
        <div><span>すべて</span><strong>{sessions.length}</strong><small>件</small></div>
        <div><span>内容あり</span><strong>{filledCount}</strong><small>件</small></div>
        <button type="button" className={content === "empty" ? "active" : ""} onClick={() => onChange({ content: content === "empty" ? "all" : "empty" })}><span>空のノート</span><strong>{emptyCount}</strong><small>件</small></button>
        <div><span>PDFあり</span><strong>{sessions.filter((session) => session.hasPdf).length}</strong><small>件</small></div>
      </section>

      <section className="note-management-filters" aria-label="ノートを絞り込む">
        <label className="note-management-search"><span><Search size={16} /> ノートを検索</span><input type="search" value={query} onChange={(event) => onChange({ query: event.target.value })} placeholder="講義名、タイトル、本文、PDFから探す" /></label>
        <label><span><CalendarDays size={16} /> 学期</span><select value={term} onChange={(event) => onChange({ term: event.target.value, timetableCourseId: "" })}><option value="all">すべての学期</option>{terms.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        <label><span><FolderOpen size={16} /> 講義</span><select value={courseId} onChange={(event) => onChange({ courseId: event.target.value })}><option value="all">すべての講義</option>{orderedCourses.map((item) => <option value={item.id} key={item.id}>{item.title}{item.archivedAt ? "（しまった講義）" : ""}</option>)}</select></label>
        <label><span><FileText size={16} /> 内容</span><select value={content} onChange={(event) => onChange({ content: event.target.value as NoteReviewState["content"] })}><option value="all">すべて</option><option value="body">本文あり</option><option value="pdf">PDFあり</option><option value="memo">付箋あり</option><option value="empty">空のノートだけ</option></select></label>
        <label><span><Rows3 size={16} /> 並び順</span><select value={sort} onChange={(event) => onChange({ sort: event.target.value as NoteReviewState["sort"] })}><option value="newest">更新が新しい順</option><option value="oldest">更新が古い順</option><option value="course">講義・授業回順</option></select></label>
      </section>

      <div className="note-management-result">
        <div><h2>{layout === "list" ? "授業ノート" : `${term === "all" ? terms[0] ?? "学期未設定" : term}の時間割`}</h2><span>{filteredSessions.length}件が対象</span></div>
        <p><ShieldCheck size={16} /> 削除後30日間は、設定の共通ごみ箱から元に戻せます。</p>
      </div>

      {layout === "timetable" ? (
        <ReviewTimetablePanel
          courses={courses}
          sessions={filteredSessions}
          term={term === "all" ? terms[0] ?? "" : term}
          selectedCourseId={timetableCourseId}
          onSelectCourse={(value) => onChange({ timetableCourseId: value })}
          memoCount={memoCount}
          onOpen={onOpen}
        />
      ) : filteredSessions.length > 0 ? (
        <div className="note-management-list">
          {filteredSessions.map((session) => {
            const linkedCourse = courseById.get(session.courseId);
            const count = memoCount(session.id);
            const isEmpty = !session.noteText.trim() && !session.hasPdf && count === 0;
            const preview = noteReviewPreview(session, normalizedQuery);
            return (
              <article className={isEmpty ? "note-management-row empty-note" : "note-management-row"} key={session.id}>
                <button type="button" className="note-management-open" onClick={() => onOpen(session)}>
                  <span className="session-number">{normalizeSessionNumber(session.sessionNumber)}</span>
                  <span className="note-management-copy">
                    <small>{session.course}{linkedCourse?.term ? `・${linkedCourse.term}` : ""}{linkedCourse?.archivedAt ? "・しまった講義" : ""}</small>
                    <strong>{session.title}</strong>
                    <span className="note-review-excerpt">{preview.source === "pdf" && <b>PDF内で一致</b>}{preview.text}</span>
                    <span>更新 {formatDate(session.updatedAt || session.createdAt)}・{sessionLabel(session.sessionNumber)}・付箋 {count}枚</span>
                  </span>
                  <span className="note-management-flags">
                    {isEmpty ? <i className="empty">空のノート</i> : <i>内容あり</i>}
                    {session.hasPdf && <i><FileText size={13} /> PDF</i>}
                    <ChevronRight size={18} />
                  </span>
                </button>
                <div className="note-management-actions">
                  <button type="button" onClick={() => onEdit(session)}><Settings2 size={16} /> 名前を変更</button>
                  <button type="button" className="danger" onClick={() => onDelete(session.id)}><Trash2 size={16} /> 削除</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="note-management-empty">
          <NotebookPen size={30} />
          <h2>{sessions.length === 0 ? "まだ授業ノートがありません" : "条件に合うノートはありません"}</h2>
          <p>{sessions.length === 0 ? "時間割から講義を選ぶと、最初のノートを作れます。" : "検索する言葉や絞り込みを変えてみてください。"}</p>
          {sessions.length > 0 && <button type="button" onClick={clearFilters}>絞り込みを外す</button>}
        </div>
      )}
    </div>
  );
}

function ReviewTimetablePanel({ courses, sessions, term, selectedCourseId, onSelectCourse, memoCount, onOpen }: { courses: Course[]; sessions: SessionRecord[]; term: string; selectedCourseId: string; onSelectCourse: (courseId: string) => void; memoCount: (sessionId: string) => number; onOpen: (session: SessionRecord) => void }) {
  const termCourses = courses.filter((course) => !course.archivedAt && course.term === term);
  const sessionsByCourse = new Map(termCourses.map((course) => [course.id, sessions.filter((session) => session.courseId === course.id)]));
  const firstCourseId = termCourses.find((course) => (sessionsByCourse.get(course.id)?.length ?? 0) > 0)?.id ?? "";
  const activeCourseId = termCourses.some((course) => course.id === selectedCourseId) ? selectedCourseId : firstCourseId;
  const selectedCourse = termCourses.find((course) => course.id === activeCourseId);
  const selectedSessions = [...(sessionsByCourse.get(activeCourseId) ?? [])].sort((a, b) => Number(normalizeSessionNumber(a.sessionNumber)) - Number(normalizeSessionNumber(b.sessionNumber)));
  const unplaced = termCourses.filter((course) => course.weekday === null || course.period === null);

  if (!term) return <div className="note-management-empty"><CalendarDays size={30} /><h2>学期がまだありません</h2><p>時間割で講義を登録すると、ここから選べるようになります。</p></div>;

  return (
    <div className="review-timetable-layout">
      <section className="timetable-shell review-timetable-shell" aria-label={`${term}のノート時間割`}>
        <div className="timetable-guide"><span>講義を選択</span><p>ノートがある講義には件数と最終更新日を表示します</p></div>
        <div className="timetable-grid">
          <div className="timetable-corner" aria-hidden="true" />
          {weekdays.map((day) => <div className="weekday-heading" key={day.value}><span>{day.short}</span><small>{day.label}</small></div>)}
          {periods.map((period) => (
            <div className="timetable-row" key={period.value}>
              <div className="period-heading"><strong>{period.value}</strong><span>{period.start}<i />{period.end}</span></div>
              {weekdays.map((day) => {
                const course = termCourses.find((item) => item.weekday === day.value && item.period === period.value);
                if (!course) return <div className="review-timetable-empty" key={day.value} aria-hidden="true" />;
                const courseSessions = sessionsByCourse.get(course.id) ?? [];
                const latest = [...courseSessions].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))[0];
                return (
                  <button type="button" key={day.value} className={`review-timetable-course${activeCourseId === course.id ? " active" : ""}${courseSessions.length === 0 ? " no-match" : ""}`} onClick={() => onSelectCourse(course.id)}>
                    <strong>{course.title}</strong><span>ノート {courseSessions.length}件</span><small>{latest ? `最終更新 ${formatDate(latest.updatedAt || latest.createdAt)}` : "該当するノートなし"}</small>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {unplaced.length > 0 && <div className="review-unplaced-courses"><span>時間割に未配置</span>{unplaced.map((course) => <button type="button" className={activeCourseId === course.id ? "active" : ""} key={course.id} onClick={() => onSelectCourse(course.id)}>{course.title}<small>{sessionsByCourse.get(course.id)?.length ?? 0}件</small></button>)}</div>}

      <section className="review-course-notes">
        <div><p className="eyebrow">COURSE NOTES</p><h3>{selectedCourse?.title ?? "講義を選んでください"}</h3><span>{selectedSessions.length}件</span></div>
        {selectedSessions.length > 0 ? <div>{selectedSessions.map((session) => <button type="button" key={session.id} onClick={() => onOpen(session)}><span className="session-number">{normalizeSessionNumber(session.sessionNumber)}</span><span><strong>{session.title}</strong><small>{formatDate(session.updatedAt || session.createdAt)}・付箋{memoCount(session.id)}枚{session.hasPdf ? "・PDFあり" : ""}</small></span><ChevronRight size={17} /></button>)}</div> : <p>この講義には、条件に合うノートがありません。</p>}
      </section>
    </div>
  );
}

function CourseEditDialog({ course, onClose, onSave }: { course: Course; onClose: () => void; onSave: (input: CourseInput) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="course-dialog" role="dialog" aria-modal="true" aria-labelledby="course-edit-title" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-heading"><div><p className="eyebrow">EDIT COURSE</p><h2 id="course-edit-title">講義を編集</h2><span>講義名や学期、時間割の位置を変更できます。</span></div><button className="dialog-close" type="button" aria-label="閉じる" onClick={onClose}><X size={19} /></button></div><CourseRegistrationForm initialValue={course} onSubmit={onSave} submitLabel="変更を保存する" /></section></div>;
}

function SessionEditDialog({ session, sessions, onClose, onSave }: { session: SessionRecord; sessions: SessionRecord[]; onClose: () => void; onSave: (number: string, title: string) => void }) {
  const [number, setNumber] = useState(session.sessionNumber);
  const [title, setTitle] = useState(session.title);
  const duplicate = sessions.some((item) => item.id !== session.id && normalizeSessionNumber(item.sessionNumber) === normalizeSessionNumber(number));
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="term-dialog" role="dialog" aria-modal="true" aria-labelledby="session-edit-title" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-heading"><div><p className="eyebrow">EDIT CLASS</p><h2 id="session-edit-title">授業回を編集</h2></div><button className="dialog-close" type="button" onClick={onClose} aria-label="閉じる"><X size={19} /></button></div><form className="registration-form" onSubmit={(event) => { event.preventDefault(); if (!duplicate) onSave(number, title); }}><label className="registration-field"><span>回数</span><input value={number} onChange={(event) => setNumber(event.target.value)} inputMode="numeric" aria-invalid={duplicate} />{duplicate && <small role="alert">この回はすでにあります</small>}</label><label className="registration-field"><span>タイトル</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label><button className="registration-submit" type="submit" disabled={duplicate || !isValidSessionNumber(number)}>変更を保存する</button></form></section></div>;
}

function ImportPreviewDialog({ pending, mode, setMode, importing, onClose, onApply }: { pending: PendingImport; mode: "merge" | "replace"; setMode: (mode: "merge" | "replace") => void; importing: boolean; onClose: () => void; onApply: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="course-dialog import-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-heading"><div><p className="eyebrow">RESTORE</p><h2 id="import-title">読み込む内容を確認</h2><span>ファイルを選んだだけでは、現在のデータは変わりません。</span></div><button className="dialog-close" type="button" onClick={onClose} aria-label="閉じる"><X size={19} /></button></div><div className="import-file-card"><History size={22} /><span><strong>{pending.fileName}</strong><small>{pending.manifest.exportedAt ? formatDateTime(pending.manifest.exportedAt) : "旧形式"}・{formatBytes(pending.bytes)}</small></span></div><dl className="import-counts"><div><dt>講義</dt><dd>{pending.normalized.courses.length}</dd></div><div><dt>授業回</dt><dd>{pending.normalized.sessions.length}</dd></div><div><dt>付箋</dt><dd>{pending.normalized.memos.length}</dd></div><div><dt>提出物</dt><dd>{pending.normalized.campus.assignments.length}</dd></div><div><dt>試験</dt><dd>{pending.normalized.campus.exams.length}</dd></div><div><dt>PDF</dt><dd>{pending.pdfs.length}</dd></div></dl>{pending.legacy && <p className="import-warning"><AlertTriangle size={16} /> 旧形式にはPDF本体が含まれません。PDFは必要な授業回へ再追加してください。</p>}<fieldset className="import-modes"><legend>読み込み方法</legend><label><input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} /><span><strong>現在のデータに追加（推奨）</strong><small>同じIDは別の講義・授業回として安全に追加します。</small></span></label><label><input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /><span><strong>現在のデータを置き換える</strong><small>実行前に現在の完全バックアップを自動で書き出します。</small></span></label></fieldset><div className="import-preview-actions"><button type="button" className="secondary-action" onClick={onClose} disabled={importing}>キャンセル</button><button type="button" className="registration-submit" onClick={onApply} disabled={importing}>{importing ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{importing ? "読み込み中" : "この内容を読み込む"}</button></div></section></div>;
}

function TermDialog({
  existingTerms,
  onClose,
  onSubmit,
}: {
  existingTerms: string[];
  onClose: () => void;
  onSubmit: (term: string) => void;
}) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [season, setSeason] = useState("前期");
  const value = `${year}年度 ${season}`;
  const alreadyExists = existingTerms.includes(value);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="course-dialog term-dialog" role="dialog" aria-modal="true" aria-labelledby="term-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-heading"><div><p className="eyebrow">NEW TERM</p><h2 id="term-dialog-title">新しい学期を作る</h2><span>講義や授業回のない、まっさらな時間割を用意します。</span></div><button className="dialog-close" type="button" aria-label="閉じる" onClick={onClose}><X size={19} /></button></div>
        <div className="term-form-grid">
          <label><span>年度</span><input inputMode="numeric" value={year} onChange={(event) => setYear(event.target.value.replace(/[^0-9]/g, "").slice(0, 4))} /></label>
          <label><span>学期</span><select value={season} onChange={(event) => setSeason(event.target.value)}><option>前期</option><option>後期</option><option>通年</option><option>その他</option></select></label>
        </div>
        {alreadyExists && <p className="existing-hint"><Check size={15} /> この学期はすでにあります。選択中の学期へ切り替えます。</p>}
        <button type="button" className="registration-submit" disabled={year.length !== 4} onClick={() => onSubmit(value)}><CalendarDays size={17} /> {alreadyExists ? "この学期へ切り替える" : "空の時間割を作る"}<ChevronRight size={17} /></button>
      </section>
    </div>
  );
}

function CoursePlacementDialog({
  course,
  courses,
  onClose,
  onPlace,
  onUnplace,
}: {
  course: Course;
  courses: Course[];
  onClose: () => void;
  onPlace: (courseId: string, weekday: number, period: number) => void;
  onUnplace: (courseId: string) => void;
}) {
  const [weekday, setWeekday] = useState(course.weekday ?? 1);
  const [period, setPeriod] = useState(course.period ?? 1);
  const occupied = courses.find((item) => item.id !== course.id && item.term === course.term && item.weekday === weekday && item.period === period);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="course-dialog placement-dialog" role="dialog" aria-modal="true" aria-labelledby="placement-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-heading"><div><p className="eyebrow">PLACE COURSE</p><h2 id="placement-dialog-title">時間割に配置</h2><span>{course.title}・{course.term}</span></div><button className="dialog-close" type="button" aria-label="閉じる" onClick={onClose}><X size={19} /></button></div>
        <div className="placement-preview"><span className="course-tile-icon"><BookOpen size={18} /></span><div><strong>{course.title}</strong><small>{weekdayLabel(weekday)}・{period}限{course.room ? `・${course.room}` : ""}</small></div></div>
        <div className="term-form-grid">
          <label><span>曜日</span><select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{weekdays.map((day) => <option value={day.value} key={day.value}>{day.label}</option>)}</select></label>
          <label><span>時限</span><select value={period} onChange={(event) => setPeriod(Number(event.target.value))}>{periods.map((item) => <option value={item.value} key={item.value}>{item.value}限（{item.start}〜）</option>)}</select></label>
        </div>
        {occupied && <p className="placement-warning"><AlertTriangle size={16} /><span><strong>{occupied.title}が配置されています</strong><small>配置すると、{occupied.title}は未配置へ移動します。ノートは削除されません。</small></span></p>}
        <div className="placement-actions"><button type="button" className="registration-submit" onClick={() => onPlace(course.id, weekday, period)}><CalendarDays size={17} /> {course.weekday ? "配置を変更" : "時間割に配置"}<ChevronRight size={17} /></button>{course.weekday && <button type="button" className="secondary-action" onClick={() => onUnplace(course.id)}>未配置に戻す</button>}</div>
      </section>
    </div>
  );
}

function HelpDialog({ view, onClose, onRestartTutorial }: { view: View; onClose: () => void; onRestartTutorial: () => void }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const items = view === "workspace"
    ? ["本文にはそのまま入力できます。見返したい文章だけを選び、付箋にします。", "ノート設定では用紙・幅・文字サイズ・PDFの左右配置を変更できます。", "Ctrl + / で入力部品、Ctrl + , で設定、Ctrl + Enterで選択文を付箋にできます。"]
    : view === "review"
      ? ["ノートと付箋を切り替えて見返せます。", "ノートは一覧から探すほか、時間割から講義を選ぶこともできます。", "検索ではノート本文やPDFから読み取った文章まで確認できます。"]
      : ["空きマスから講義を登録できます。", "未配置の講義は『時間割に配置』から曜日と時限を選べます。", "学期を追加すると、講義のない新しい時間割が作られます。"];
  useEffect(() => {
    function handleDialogKeys(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")).filter((item) => !item.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    window.addEventListener("keydown", handleDialogKeys);
    return () => { window.removeEventListener("keydown", handleDialogKeys); document.body.style.overflow = previousOverflow; };
  }, [onClose]);
  return (
    <div className="modal-backdrop help-backdrop" role="presentation" onMouseDown={onClose}>
      <aside ref={dialogRef} tabIndex={-1} className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="help-heading"><span><Lightbulb size={20} /></span><div><p className="eyebrow">HELP</p><h2 id="help-title">この画面の使い方</h2></div><button type="button" aria-label="閉じる" onClick={onClose}><X size={19} /></button></div>
        <div className="help-list">{items.map((item, index) => <div key={item}><span>{index + 1}</span><p>{item}</p></div>)}</div>
        <section className="help-local"><ShieldCheck size={18} /><div><strong>端末保存とアカウント同期</strong><p>データはまずこの端末に保存されます。アカウント画面で同期を有効にすると、時間割・ノート・Campus Muster・PDFを自分の端末間で共有できます。</p></div></section>
        <div className="help-legal"><a href="/privacy">プライバシーポリシー</a><a href="/terms">利用規約</a></div>
        <button type="button" className="tutorial-restart" onClick={onRestartTutorial}><HelpCircle size={17} /> 最初から使い方を見る</button>
      </aside>
    </div>
  );
}

function FeedbackDialog({ view, onClose }: { view: View; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const [category, setCategory] = useState("usability");
  const [message, setMessage] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    function handleDialogKeys(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")).filter((item) => !item.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    window.addEventListener("keydown", handleDialogKeys);
    return () => { window.removeEventListener("keydown", handleDialogKeys); document.body.style.overflow = previousOverflow; };
  }, [onClose, submitting]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (message.trim().length < 5 || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          message,
          replyEmail,
          website,
          sourceView: view === "workspace" ? "ノート" : view === "review" ? "見返し" : view === "campus" ? "Campus Muster" : view === "settings" ? "設定" : "時間割",
          deviceId: getFeedbackDeviceId(),
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "送信できませんでした。");
      setMessage("");
      setReplyEmail("");
      setResult({ type: "success", message: "送信しました。ご協力ありがとうございます。" });
    } catch (error) {
      setResult({ type: "error", message: error instanceof Error ? error.message : "現在送信できません。" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop feedback-backdrop" role="presentation" onMouseDown={() => { if (!submitting) onClose(); }}>
      <aside ref={dialogRef} tabIndex={-1} className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="help-heading">
          <span><MessageCircle size={20} /></span>
          <div><p className="eyebrow">FEEDBACK</p><h2 id="feedback-title">ご意見・不具合報告</h2></div>
          <button type="button" aria-label="閉じる" onClick={onClose} disabled={submitting}><X size={19} /></button>
        </div>
        <form onSubmit={submit}>
          <label><span>種類</span><select value={category} onChange={(event) => setCategory(event.target.value)} disabled={submitting}><option value="bug">不具合</option><option value="usability">使いにくい</option><option value="request">機能の希望</option><option value="other">その他</option></select></label>
          <label><span>内容</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} minLength={5} maxLength={2000} placeholder="どの画面で、どのように感じたか教えてください" disabled={submitting} required /></label>
          <label><span>返信先メールアドレス <small>任意</small></span><input type="email" value={replyEmail} onChange={(event) => setReplyEmail(event.target.value)} maxLength={200} placeholder="返信が必要な場合だけ入力" disabled={submitting} /></label>
          <label className="feedback-honeypot" aria-hidden="true"><span>ウェブサイト</span><input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
          <p className="feedback-privacy"><ShieldCheck size={16} /> ノート、付箋、講義名、PDFは送信されません。送信前に個人情報が含まれていないかご確認ください。<a href="/privacy" target="_blank" rel="noreferrer">詳しく見る</a></p>
          {result && <p className={`feedback-result ${result.type}`} role="status">{result.message}</p>}
          <button className="feedback-submit" type="submit" disabled={message.trim().length < 5 || submitting}>{submitting ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}{submitting ? "送信しています" : "送信する"}</button>
        </form>
      </aside>
    </div>
  );
}

function TutorialOverlay({ onClose, onFinish }: { onClose: () => void; onFinish: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [step, setStep] = useState(0);
  const slides = [
    { icon: <CalendarDays size={28} />, label: "時間割から始めます", title: "空いているマスから、講義を登録", body: "講義がまだなくても、最初に時間割が開きます。空きマスを選ぶと曜日と時限が入った状態で登録できます。", demo: "timetable" },
    { icon: <BookOpen size={28} />, label: "あとから配置できます", title: "未配置の講義も、迷子になりません", body: "曜日や時限を決めずに登録した講義は、未配置欄に残ります。時間割に配置から、いつでも移動できます。", demo: "unplaced" },
    { icon: <CalendarDays size={28} />, label: "学期ごとに分かれます", title: "新しい学期は、まっさらな時間割", body: "前期と後期では講義を混ぜず、それぞれの授業回を第1回から管理できます。", demo: "term" },
    { icon: <NotebookPen size={28} />, label: "授業中は、まず書くだけ", title: "PDFを見ながら、隣でノート", body: "講義と授業回を選び、必要ならPDFを追加します。PDFがなくても、そのまま本文を書き始められます。", demo: "note" },
    { icon: <Settings2 size={28} />, label: "必要になったら整えます", title: "用紙や型を選び、文章を付箋に", body: "本文を中心にしながら、用紙・文字・テンプレートを変更できます。見返したい文章だけを付箋にできます。", demo: "customize" },
    { icon: <ListFilter size={28} />, label: "学んだことへ戻ります", title: "講義やジャンルを越えて見返す", body: "付箋を絞り込み、元のノートと資料へ戻れます。困ったときは、電球のヘルプを開いてください。", demo: "review" },
  ];
  const slide = slides[step];
  useEffect(() => {
    function handleDialogKeys(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")).filter((item) => !item.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    window.addEventListener("keydown", handleDialogKeys);
    return () => { window.removeEventListener("keydown", handleDialogKeys); document.body.style.overflow = previousOverflow; };
  }, [onClose]);
  return (
    <div ref={dialogRef} tabIndex={-1} className="tutorial-overlay" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <div className="tutorial-card">
        <div className={`tutorial-demo demo-${slide.demo}`} aria-hidden="true"><span className="tutorial-demo-icon">{slide.icon}</span><div className="demo-lines"><i /><i /><i /></div><div className="demo-accent" /></div>
        <div className="tutorial-copy"><div className="tutorial-progress"><span>{step + 1} / {slides.length}</span><div>{slides.map((_, index) => <i key={index} className={index <= step ? "active" : ""} />)}</div></div><p>{slide.label}</p><h2 id="tutorial-title">{slide.title}</h2><div>{slide.body}</div></div>
        <div className="tutorial-actions"><button type="button" className="tutorial-skip" onClick={onClose}>スキップ</button><div>{step > 0 && <button type="button" className="tutorial-back" onClick={() => setStep((current) => current - 1)}>戻る</button>}<button type="button" className="tutorial-next" onClick={() => step === slides.length - 1 ? onFinish() : setStep((current) => current + 1)}>{step === slides.length - 1 ? "時間割を使う" : "続く"}<ChevronRight size={17} /></button></div></div>
      </div>
    </div>
  );
}

function SessionStartDialog({
  course,
  sessionNumber,
  setSessionNumber,
  draftPdf,
  setDraftPdf,
  starting,
  progress,
  error,
  existing,
  onClose,
  onStart,
}: {
  course: Course;
  sessionNumber: string;
  setSessionNumber: (value: string) => void;
  draftPdf: File | null;
  setDraftPdf: (value: File | null) => void;
  starting: boolean;
  progress: { message: string; progress: number };
  error: string;
  existing?: SessionRecord;
  onClose: () => void;
  onStart: () => void;
}) {
  const schedule = course.weekday && course.period
    ? weekdayLabel(course.weekday) + "・" + course.period + "限"
    : "曜日・時限未設定";
  const draftPdfWarning = draftPdf ? pdfFileWarning(draftPdf) : "";
  const draftPdfTooLarge = Boolean(draftPdf && draftPdf.size > MAX_PDF_FILE_SIZE_BYTES);

  useEffect(() => {
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !starting) onClose();
    }
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [onClose, starting]);

  return (
    <div className="modal-backdrop session-backdrop" role="presentation" onMouseDown={() => { if (!starting) onClose(); }}>
      <section className="course-dialog session-dialog" role="dialog" aria-modal="true" aria-labelledby="session-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="session-dialog-top">
          <div className="session-course-icon"><BookOpen size={20} /></div>
          <div>
            <p>{schedule}{course.room ? "・" + course.room : ""}</p>
            <h2 id="session-dialog-title">{course.title}</h2>
            <span>{course.instructor || course.term}</span>
          </div>
          <button type="button" aria-label="閉じる" onClick={onClose} disabled={starting}><X size={19} /></button>
        </div>

        <div className="session-quick-row">
          <div>
            <strong>何回目の授業ですか？</strong>
            <small>次の回を自動で入れています</small>
          </div>
          <div className="session-stepper">
            <button type="button" aria-label="授業回を一つ戻す" onClick={() => setSessionNumber(String(Math.max(1, Number(normalizeSessionNumber(sessionNumber)) - 1)))} disabled={starting}>−</button>
            <label><span>第</span><input aria-label="授業回" inputMode="numeric" maxLength={3} value={sessionNumber} onChange={(event) => setSessionNumber(event.target.value.replace(/\D/g, ""))} disabled={starting} /><span>回</span></label>
            <button type="button" aria-label="授業回を一つ進める" onClick={() => setSessionNumber(String(Number(normalizeSessionNumber(sessionNumber)) + 1))} disabled={starting}>＋</button>
          </div>
        </div>
        {existing && <p className="existing-hint session-existing"><Check size={15} /> この回のノートがあります。続きから開きます。</p>}

        <div className="optional-pdf dialog-pdf">
          <div><Paperclip size={18} /><span><strong>この回の講義資料</strong><small>PDFなしでも始められます</small></span></div>
          {draftPdf ? (
            <div className="selected-file">
              <FileText size={18} />
              <span>{draftPdf.name}<small>{pdfSizeLabel(draftPdf.size)}</small></span>
              <button type="button" aria-label="PDFを外す" onClick={() => setDraftPdf(null)} disabled={starting}><X size={16} /></button>
            </div>
          ) : (
            <label className="pdf-pick-button">
              <Upload size={16} /> PDFを選ぶ
              <input type="file" accept="application/pdf,.pdf" onChange={(event) => setDraftPdf(event.target.files?.[0] ?? null)} disabled={starting} />
            </label>
          )}
        </div>
        <p className="pdf-rights-note">個人学習で利用できる講義資料を選んでください。PDFはこの端末内で処理されます。</p>
        {draftPdfTooLarge && <p className="pdf-limit-warning" role="alert"><AlertTriangle size={16} /> PDFが大きすぎます（上限 {pdfSizeLabel(MAX_PDF_FILE_SIZE_BYTES)}）。ページを分けて追加してください。</p>}
        {!draftPdfTooLarge && draftPdfWarning && <p className="pdf-limit-warning"><AlertTriangle size={16} /> {draftPdfWarning}</p>}

        {starting && draftPdf && (
          <div className="start-progress">
            <div><LoaderCircle size={18} className="spin" /><span>{progress.message || "PDFを準備しています"}</span><b>{progress.progress}%</b></div>
            <i><span style={{ width: progress.progress + "%" }} /></i>
          </div>
        )}
        {error && <p className="form-error"><AlertTriangle size={17} /> {error}</p>}

        <button className="start-button session-start-button" onClick={onStart} disabled={!isValidSessionNumber(sessionNumber) || starting || draftPdfTooLarge}>
          {starting ? <LoaderCircle size={19} className="spin" /> : <StickyNote size={19} />}
          {starting ? "準備しています" : existing && !draftPdf ? "この授業のノートを続ける" : "この授業のノートを始める"}
          {!starting && <ChevronRight size={19} />}
        </button>
      </section>
    </div>
  );
}

function WorkspaceView({
  session,
  memos,
  pdfBlob,
  showPdf,
  setShowPdf,
  page,
  setPage,
  globalTags,
  courseTags,
  showTagCreator,
  setShowTagCreator,
  newTag,
  setNewTag,
  newTagScope,
  setNewTagScope,
  addCustomTag,
  createMemo,
  updateMemo,
  updateSessionNote,
  updateNotebookPrefs,
  hasCourseTemplate,
  saveCourseTemplate,
  clearCourseTemplate,
  deleteMemo,
  attachPdf,
  attachPdfFile,
  releasePdfToReference,
  pdfStatus,
  initialMemoId,
  saveStatus,
  lastSavedAt,
  onBack,
}: {
  session: SessionRecord;
  memos: Memo[];
  pdfBlob: Blob | null;
  showPdf: boolean;
  setShowPdf: (value: boolean) => void;
  page: number;
  setPage: (value: number) => void;
  globalTags: string[];
  courseTags: string[];
  showTagCreator: boolean;
  setShowTagCreator: (value: boolean) => void;
  newTag: string;
  setNewTag: (value: string) => void;
  newTagScope: TagScope;
  setNewTagScope: (value: TagScope) => void;
  addCustomTag: () => string;
  createMemo: (position: { x: number; y: number }, source?: { text: string; start: number; end: number }) => string;
  updateMemo: (memoId: string, changes: Partial<Pick<Memo, "text" | "tags" | "x" | "y" | "width" | "height" | "page" | "reflections" | "pinned" | "reviewStage" | "nextReviewAt" | "lastReviewedAt">>) => void;
  updateSessionNote: (sessionId: string, noteText: string) => void;
  updateNotebookPrefs: (sessionId: string, changes: Partial<NotebookPrefs>) => void;
  hasCourseTemplate: boolean;
  saveCourseTemplate: (courseId: string, template: string) => void;
  clearCourseTemplate: (courseId: string) => void;
  deleteMemo: (memoId: string) => void;
  attachPdf: (event: ChangeEvent<HTMLInputElement>) => void;
  attachPdfFile: (file: File) => Promise<void>;
  releasePdfToReference: (sessionId: string) => Promise<void>;
  pdfStatus: { message: string; progress: number; error: string };
  initialMemoId: string | null;
  saveStatus: SaveStatus;
  lastSavedAt: string;
  onBack: () => void;
}) {
  const topic = topicForPage(session.topics, page);
  const [activeMemoId, setActiveMemoId] = useState<string | null>(initialMemoId);
  const [noteSelection, setNoteSelection] = useState<{ text: string; start: number; end: number } | null>(null);
  const [showNotebookSettings, setShowNotebookSettings] = useState(false);
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [draggingPdfOver, setDraggingPdfOver] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const notebookTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const dragRef = useRef<{
    memoId: string;
    pointerId: number;
    startX: number;
    startY: number;
    initialLeft: number;
    initialTop: number;
    maxTravelX: number;
    maxTop: number;
  } | null>(null);
  const resizeRef = useRef<{
    memoId: string;
    pointerId: number;
    axis: "horizontal" | "vertical" | "both";
    startX: number;
    startY: number;
    initialWidth: number;
    initialHeight: number;
    maxWidth: number;
    maxHeight: number;
  } | null>(null);
  const splitRef = useRef<{ pointerId: number; startX: number; startPercent: number; width: number } | null>(null);

  const activeMemo = memos.find((memo) => memo.id === activeMemoId) ?? null;
  const writingLineCount = session.noteText.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 34)), 0);
  const notebookHeight = Math.max(
    860,
    150 + writingLineCount * 36,
    ...memos.map((memo) => memo.y + memo.height + 80),
  );
  const availableTags = Array.from(new Set([...globalTags, ...courseTags]));
  const prefs = session.notebookPrefs ?? defaultNotebookPrefs;
  const pdfZoom = prefs.pdfZoom ?? 100;

  useEffect(() => {
    if (!activeMemoId) return;
    textareaRefs.current.get(activeMemoId)?.focus();
  }, [activeMemoId, memos.length]);

  useEffect(() => {
    function handleWorkspaceShortcuts(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isWriting = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT" || target?.isContentEditable;
      if (event.key === "Escape") {
        setShowInsertMenu(false);
        setShowNotebookSettings(false);
        setActiveMemoId(null);
        notebookTextareaRef.current?.focus();
        return;
      }
      if (!isWriting && showPdf && session.hasPdf && event.key === "PageUp") {
        event.preventDefault();
        setPage(Math.max(1, page - 1));
        return;
      }
      if (!isWriting && showPdf && session.hasPdf && event.key === "PageDown") {
        event.preventDefault();
        setPage(Math.min(session.pageCount, page + 1));
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === "/") {
        event.preventDefault();
        setShowInsertMenu((current) => !current);
      }
      if (event.key === ",") {
        event.preventDefault();
        setShowNotebookSettings((current) => !current);
      }
      if ((event.key === "Enter" || (event.shiftKey && event.key.toLowerCase() === "m")) && noteSelection) {
        event.preventDefault();
        turnSelectionIntoMemo();
      }
    }
    window.addEventListener("keydown", handleWorkspaceShortcuts);
    return () => window.removeEventListener("keydown", handleWorkspaceShortcuts);
  });

  function handleTagToggle(tag: string) {
    if (!activeMemo) return;
    const nextTags = activeMemo.tags.includes(tag)
      ? activeMemo.tags.filter((item) => item !== tag)
      : [...activeMemo.tags, tag];
    updateMemo(activeMemo.id, { tags: nextTags });
  }

  function handleAddCustomTag() {
    const tag = addCustomTag();
    if (tag && activeMemo && !activeMemo.tags.includes(tag)) {
      updateMemo(activeMemo.id, { tags: [...activeMemo.tags, tag] });
    }
  }

  function addTextBox() {
    const memoId = createMemo(nextNotebookPosition(memos));
    if (memoId) setActiveMemoId(memoId);
  }

  function turnSelectionIntoMemo() {
    if (!noteSelection) return;
    const memoId = createMemo(nextNotebookPosition(memos), noteSelection);
    if (memoId) {
      setActiveMemoId(memoId);
      setNoteSelection(null);
    }
  }

  function insertNotePart(text: string) {
    const textarea = notebookTextareaRef.current;
    const start = textarea?.selectionStart ?? session.noteText.length;
    const end = textarea?.selectionEnd ?? start;
    const before = session.noteText.slice(0, start);
    const after = session.noteText.slice(end);
    const prefix = before && !before.endsWith("\n") ? "\n" : "";
    const insertion = `${prefix}${text}`;
    updateSessionNote(session.id, before + insertion + after);
    setShowInsertMenu(false);
    window.requestAnimationFrame(() => {
      const target = notebookTextareaRef.current;
      if (!target) return;
      const cursor = before.length + insertion.length;
      target.focus();
      target.setSelectionRange(cursor, cursor);
    });
  }

  function applyNoteTemplate(template: "lecture" | "cornell" | "seminar") {
    const snippets = {
      lecture: "■ 今日のテーマ\n\n■ 講義ノート\n\n■ あとで考えたいこと\n",
      cornell: "■ キーワード・問い\n\n■ ノート\n\n■ まとめ\n",
      seminar: "■ 主張\n\n■ 根拠・具体例\n\n■ 自分の考え\n\n■ 議論で気になったこと\n",
    };
    insertNotePart(snippets[template]);
  }

  function beginSplitResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const grid = event.currentTarget.closest<HTMLElement>(".workspace-grid");
    if (!grid) return;
    splitRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startPercent: prefs.pdfPercent,
      width: grid.getBoundingClientRect().width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveSplitResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const split = splitRef.current;
    if (!split || split.pointerId !== event.pointerId) return;
    const direction = prefs.pdfPosition === "left" ? 1 : -1;
    const next = split.startPercent + ((event.clientX - split.startX) / split.width) * 100 * direction;
    updateNotebookPrefs(session.id, { pdfPercent: Math.round(clampNumber(next, 30, 70)) });
  }

  function endSplitResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (splitRef.current?.pointerId !== event.pointerId) return;
    splitRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function returnToMemoSource(memo: Memo) {
    if (memo.page && session.hasPdf) {
      setPage(memo.page);
      setShowPdf(true);
    }
    if (memo.sourceStart === null || memo.sourceEnd === null || !memo.sourceText) return;
    const textarea = notebookTextareaRef.current;
    if (!textarea) return;
    let start = memo.sourceStart;
    let end = memo.sourceEnd;
    if (session.noteText.slice(start, end) !== memo.sourceText) {
      const relocated = session.noteText.indexOf(memo.sourceText);
      if (relocated >= 0) {
        start = relocated;
        end = relocated + memo.sourceText.length;
      }
    }
    setActiveMemoId(null);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, end);
    });
  }

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, memo: Memo) {
    if (event.button !== 0) return;
    const canvas = canvasRef.current;
    const card = event.currentTarget.closest<HTMLElement>(".notebook-sticky");
    if (!canvas || !card) return;

    const canvasRect = canvas.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const maxTravelX = Math.max(1, canvasRect.width - cardRect.width - 32);
    dragRef.current = {
      memoId: memo.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialLeft: 16 + maxTravelX * (memo.x / 100),
      initialTop: memo.y,
      maxTravelX,
      maxTop: Math.max(18, canvasRect.height - cardRect.height - 18),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveMemoId(memo.id);
    event.preventDefault();
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const left = clampNumber(drag.initialLeft + event.clientX - drag.startX, 16, 16 + drag.maxTravelX);
    const top = clampNumber(drag.initialTop + event.clientY - drag.startY, 18, drag.maxTop);
    updateMemo(drag.memoId, {
      x: Math.round(((left - 16) / drag.maxTravelX) * 1000) / 10,
      y: Math.round(top),
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function beginResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    memo: Memo,
    axis: "horizontal" | "vertical" | "both",
  ) {
    if (event.button !== 0) return;
    const canvas = canvasRef.current;
    const card = event.currentTarget.closest<HTMLElement>(".notebook-sticky");
    if (!canvas || !card) return;
    const canvasRect = canvas.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    resizeRef.current = {
      memoId: memo.id,
      pointerId: event.pointerId,
      axis,
      startX: event.clientX,
      startY: event.clientY,
      initialWidth: cardRect.width,
      initialHeight: cardRect.height,
      maxWidth: Math.max(190, canvasRect.right - cardRect.left - 16),
      maxHeight: Math.max(720, canvasRect.bottom - cardRect.top - 18),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveMemoId(memo.id);
    event.stopPropagation();
    event.preventDefault();
  }

  function moveResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const changes: Partial<Pick<Memo, "width" | "height">> = {};
    if (resize.axis !== "vertical") {
      changes.width = Math.round(clampNumber(
        resize.initialWidth + event.clientX - resize.startX,
        190,
        resize.maxWidth,
      ));
    }
    if (resize.axis !== "horizontal") {
      changes.height = Math.round(clampNumber(
        resize.initialHeight + event.clientY - resize.startY,
        160,
        resize.maxHeight,
      ));
    }
    updateMemo(resize.memoId, changes);
  }

  function endResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resizeWithKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    memo: Memo,
    axis: "horizontal" | "vertical" | "both",
  ) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    const changes: Partial<Pick<Memo, "width" | "height">> = {};
    if (axis !== "vertical" && event.key === "ArrowLeft") changes.width = Math.max(190, memo.width - step);
    if (axis !== "vertical" && event.key === "ArrowRight") changes.width = memo.width + step;
    if (axis !== "horizontal" && event.key === "ArrowUp") changes.height = Math.max(160, memo.height - step);
    if (axis !== "horizontal" && event.key === "ArrowDown") changes.height = memo.height + step;
    if (Object.keys(changes).length > 0) updateMemo(memo.id, changes);
  }

  function moveWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>, memo: Memo) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 5 : 1.5;
    if (event.key === "ArrowLeft") updateMemo(memo.id, { x: clampNumber(memo.x - step, 0, 100) });
    if (event.key === "ArrowRight") updateMemo(memo.id, { x: clampNumber(memo.x + step, 0, 100) });
    if (event.key === "ArrowUp") updateMemo(memo.id, { y: clampNumber(memo.y - step * 8, 18, notebookHeight - memo.height - 18) });
    if (event.key === "ArrowDown") updateMemo(memo.id, { y: clampNumber(memo.y + step * 8, 18, notebookHeight - memo.height - 18) });
  }

  return (
    <div className="note-workspace">
      <header className="workspace-header">
        <button className="back-link" onClick={onBack}><ArrowLeft size={18} /> 授業を選び直す</button>
        <div className="workspace-title">
          <span>{session.course}</span>
          <h1>{sessionLabel(session.sessionNumber)}のノート</h1>
          {!isDefaultSessionTitle(session.title, session.sessionNumber) && <small>{session.title}</small>}
        </div>
        <div className="workspace-actions">
          <button
            className={showNotebookSettings ? "active" : ""}
            onClick={() => setShowNotebookSettings((current) => !current)}
            aria-label="ノートの表示と型を設定"
            title="ノート設定（Ctrl+,）"
          >
            <Settings2 size={17} /> ノート設定
          </button>
          {session.hasPdf ? (
            <>
              <button className={showPdf ? "active" : ""} onClick={() => setShowPdf(!showPdf)}>
                <FileText size={17} /> {showPdf ? "資料を閉じる" : "資料を開く"}
              </button>
              <button className="pdf-lighten-button" type="button" disabled={Boolean(pdfStatus.message)} onClick={() => void releasePdfToReference(session.id)} title="PDF本体を外して参照だけ残す">
                <FileArchive size={17} /> 容量を軽くする
              </button>
            </>
          ) : (
            <label className="attach-button">
              <Paperclip size={17} /> {session.pdfReferenceOnly ? "PDFを再追加" : "PDFを追加"}
              <input type="file" accept="application/pdf,.pdf" onChange={attachPdf} disabled={Boolean(pdfStatus.message)} />
            </label>
          )}
        </div>
      </header>

      {pdfStatus.message && (
        <div className="inline-progress"><LoaderCircle size={16} className="spin" /><span>{pdfStatus.message}</span><b>{pdfStatus.progress}%</b></div>
      )}
      {pdfStatus.error && <div className="inline-error"><AlertTriangle size={16} /> {pdfStatus.error}</div>}

      {session.pdfReferenceOnly && <PdfReferenceCard
        fileName={session.fileName ?? "講義資料.pdf"}
        pageCount={Math.max(1, session.pageCount)}
        lastPage={page}
        memoPages={memos.flatMap((memo) => memo.page ? [memo.page] : [])}
        releasedAt={session.pdfReleasedAt ?? null}
        onPageChange={setPage}
        onSelect={attachPdf}
        disabled={Boolean(pdfStatus.message)}
      />}

      <div
        className={showPdf && session.hasPdf ? `workspace-grid with-pdf pdf-${prefs.pdfPosition}` : "workspace-grid"}
        style={showPdf && session.hasPdf ? {
          gridTemplateColumns: prefs.pdfPosition === "left"
            ? `${prefs.pdfPercent}fr 8px ${100 - prefs.pdfPercent}fr`
            : `${100 - prefs.pdfPercent}fr 8px ${prefs.pdfPercent}fr`,
        } : undefined}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) {
            event.preventDefault();
            setDraggingPdfOver(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDraggingPdfOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDraggingPdfOver(false);
          const file = Array.from(event.dataTransfer.files).find(isPdfFile);
          if (file) void attachPdfFile(file);
        }}
      >
        {draggingPdfOver && <div className="pdf-drop-overlay"><Upload size={27} /><strong>この授業回にPDFを追加</strong><span>ここへドロップしてください</span></div>}
        <section className="notebook-column">
          <div className="notebook-toolbar">
            <div className="notebook-label">
              <span><NotebookPen size={19} /></span>
              <div>
                <strong>ノート本文へそのまま入力</strong>
                <small className={`save-state ${saveStatus}`} role="status">
                  {saveStatusLabel(saveStatus, lastSavedAt)}
                </small>
              </div>
            </div>
            <div className="notebook-toolbar-actions">
              <button className={showInsertMenu ? "insert-part-button active" : "insert-part-button"} onClick={() => setShowInsertMenu((current) => !current)}>
                <Rows3 size={16} /> 入力部品
              </button>
              {noteSelection && (
                <button className="selection-to-sticky" onClick={turnSelectionIntoMemo}>
                  <Quote size={16} /> 選んだ文を付箋に
                </button>
              )}
              <button className="add-textbox-button" onClick={addTextBox}><Plus size={17} /> 付箋を追加</button>
            </div>
          </div>

          {showInsertMenu && (
            <div className="insert-menu" role="menu" aria-label="ノートへ追加">
              <span>ノートへ追加</span>
              <button type="button" onClick={() => insertNotePart("■ 見出し\n")}>見出し</button>
              <button type="button" onClick={() => insertNotePart("・箇条書き\n")}>箇条書き</button>
              <button type="button" onClick={() => insertNotePart("□ チェック項目\n")}>チェック</button>
              <button type="button" onClick={() => insertNotePart("｜引用・先生の言葉\n")}>引用</button>
              <button type="button" onClick={() => insertNotePart("────────────────\n")}>区切り</button>
              <small>Ctrl + /</small>
            </div>
          )}

          {showNotebookSettings && (
            <aside className="notebook-settings" aria-label="ノート設定">
              <div className="settings-heading"><div><Settings2 size={17} /><span><strong>ノート設定</strong><small>この授業回だけに保存されます</small></span></div><button type="button" aria-label="ノート設定を閉じる" onClick={() => setShowNotebookSettings(false)}><X size={16} /></button></div>
              <div className="settings-group">
                <span>用紙</span>
                <div>{([ ["lined", "罫線"], ["plain", "白紙"], ["grid", "方眼"], ["dots", "ドット"] ] as const).map(([value, label]) => <button type="button" key={value} className={prefs.paper === value ? "active" : ""} onClick={() => updateNotebookPrefs(session.id, { paper: value })}>{label}</button>)}</div>
              </div>
              <div className="settings-group">
                <span>ページ幅</span>
                <div>{([ ["compact", "狭め"], ["standard", "標準"], ["wide", "広め"] ] as const).map(([value, label]) => <button type="button" key={value} className={prefs.width === value ? "active" : ""} onClick={() => updateNotebookPrefs(session.id, { width: value })}>{label}</button>)}</div>
              </div>
              <div className="settings-group">
                <span>文字</span>
                <div>{([ ["small", "小"], ["medium", "中"], ["large", "大"] ] as const).map(([value, label]) => <button type="button" key={value} className={prefs.fontSize === value ? "active" : ""} onClick={() => updateNotebookPrefs(session.id, { fontSize: value })}>{label}</button>)}</div>
              </div>
              {session.hasPdf && (
                <div className="settings-group desktop-layout-setting">
                  <span>資料の位置・幅</span>
                  <div>
                    <button type="button" className={prefs.pdfPosition === "left" ? "active" : ""} onClick={() => updateNotebookPrefs(session.id, { pdfPosition: "left" })}>左</button>
                    <button type="button" className={prefs.pdfPosition === "right" ? "active" : ""} onClick={() => updateNotebookPrefs(session.id, { pdfPosition: "right" })}>右</button>
                    {[40, 50, 60].map((percent) => <button type="button" key={percent} className={prefs.pdfPercent === percent ? "active" : ""} onClick={() => updateNotebookPrefs(session.id, { pdfPercent: percent })}>資料 {percent}%</button>)}
                  </div>
                </div>
              )}
              <div className="settings-group template-setting">
                <span>ノートの型を追加</span>
                <div><button type="button" onClick={() => applyNoteTemplate("lecture")}>講義ノート</button><button type="button" onClick={() => applyNoteTemplate("cornell")}>Cornell式</button><button type="button" onClick={() => applyNoteTemplate("seminar")}>ゼミ・議論</button></div>
              </div>
              <div className="course-template-setting">
                <button type="button" onClick={() => saveCourseTemplate(session.courseId, session.noteText)} disabled={!session.noteText.trim()}>現在の構成を、この講義の次回の型にする</button>
                {hasCourseTemplate && <button type="button" onClick={() => clearCourseTemplate(session.courseId)}>次回を白紙に戻す</button>}
              </div>
            </aside>
          )}

          {activeMemo && (
            <div className="notebook-tagbar">
              <div className="notebook-tagbar-title">
                <Tags size={15} />
                <span>選択中の付箋のジャンル</span>
              </div>
              <div className="tag-row compact">
                {availableTags.map((tag) => {
                  const selected = activeMemo.tags.includes(tag);
                  const courseTag = courseTags.includes(tag);
                  return (
                    <button type="button" key={tag} className={(selected ? "selected " : "") + (courseTag ? "course" : "")} onClick={() => handleTagToggle(tag)}>
                      {selected && <Check size={12} />}{tag}
                    </button>
                  );
                })}
                <button type="button" className="inline-new-tag" onClick={() => setShowTagCreator(true)}><Plus size={13} /> 新しいジャンル</button>
              </div>
              {showTagCreator && (
                <div className="tag-creator notebook-tag-creator">
                  <input value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="新しいジャンル名" aria-label="新しいジャンル名" />
                  <div className="scope-switch">
                    <button type="button" className={newTagScope === "global" ? "active" : ""} onClick={() => setNewTagScope("global")}>全講義</button>
                    <button type="button" className={newTagScope === "course" ? "active" : ""} onClick={() => setNewTagScope("course")}>この講義だけ</button>
                  </div>
                  <button type="button" className="tag-add" onClick={handleAddCustomTag} disabled={!newTag.trim()}>追加</button>
                  <button type="button" className="tag-cancel" aria-label="ジャンル作成を閉じる" onClick={() => setShowTagCreator(false)}><X size={16} /></button>
                </div>
              )}
            </div>
          )}

          <div className="notebook-scroll">
            <div
              className={`notebook-canvas paper-${prefs.paper} width-${prefs.width} font-${prefs.fontSize}`}
              ref={canvasRef}
              style={{ height: notebookHeight }}
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) setActiveMemoId(null);
              }}
            >
              <div className="notebook-page-heading">
                <span>{session.course}</span>
                <strong>{sessionLabel(session.sessionNumber)}</strong>
                {session.hasPdf && <button onClick={() => setShowPdf(true)}>資料 {page}ページを表示</button>}
                {session.pdfReferenceOnly && <span className="notebook-pdf-reference">資料 {page}ページを参照中</span>}
              </div>

              <textarea
                ref={notebookTextareaRef}
                className="notebook-writing"
                aria-label="ノート本文"
                value={session.noteText}
                onFocus={() => {
                  setActiveMemoId(null);
                  setShowTagCreator(false);
                }}
                onChange={(event) => updateSessionNote(session.id, event.target.value)}
                onSelect={(event) => {
                  const target = event.currentTarget;
                  const selected = target.value.slice(target.selectionStart, target.selectionEnd);
                  setNoteSelection(selected.trim()
                    ? { text: selected, start: target.selectionStart, end: target.selectionEnd }
                    : null);
                }}
                placeholder="ここから授業ノートを書き始める…"
                autoFocus
              />

              {memos.map((memo, index) => (
                <article
                  className={`notebook-sticky tone-${memoTone(memo.id)}${activeMemoId === memo.id ? " selected" : ""}`}
                  key={memo.id}
                  style={{
                    left: `calc(16px + (100% - 32px) * ${memo.x / 100})`,
                    top: memo.y,
                    transform: `translateX(-${memo.x}%)`,
                    width: `min(${memo.width}px, calc(100% - 32px))`,
                    height: memo.height,
                  }}
                  onClick={() => setActiveMemoId(memo.id)}
                >
                  <header>
                    <button
                      type="button"
                      className="sticky-drag-handle"
                      aria-label={`付箋${index + 1}を移動`}
                      title="ドラッグして移動"
                      onPointerDown={(event) => beginDrag(event, memo)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onKeyDown={(event) => moveWithKeyboard(event, memo)}
                    >
                      <GripHorizontal size={18} />
                    </button>
                    <div className="notebook-sticky-tags">
                      {memo.tags.length > 0 ? memo.tags.map((tag) => <span key={tag}>{tag}</span>) : <span>ジャンルなし</span>}
                    </div>
                    <button
                      type="button"
                      className={`sticky-pin${memo.pinned ? " active" : ""}`}
                      aria-label={memo.pinned ? `付箋${index + 1}のピン留めを外す` : `付箋${index + 1}をピン留め`}
                      title={memo.pinned ? "ピン留めを外す" : "ピン留め"}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateMemo(memo.id, { pinned: !memo.pinned });
                      }}
                    >
                      <Pin size={14} fill={memo.pinned ? "currentColor" : "none"} />
                    </button>
                    <button
                      type="button"
                      className="sticky-delete"
                      aria-label={`付箋${index + 1}を削除`}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteMemo(memo.id);
                        if (activeMemoId === memo.id) setActiveMemoId(null);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </header>
                  <textarea
                    ref={(element) => {
                      if (element) textareaRefs.current.set(memo.id, element);
                      else textareaRefs.current.delete(memo.id);
                    }}
                    aria-label={`付箋${index + 1}の本文`}
                    value={memo.text}
                    onFocus={() => setActiveMemoId(memo.id)}
                    onChange={(event) => updateMemo(memo.id, { text: event.target.value })}
                    placeholder="この授業で気づいたことを書く…"
                    rows={5}
                  />
                  <footer>
                    {memo.sourceText ? (
                      <button onClick={() => returnToMemoSource(memo)}>元の文章へ戻る</button>
                    ) : <span>自動保存</span>}
                    {memo.page && (session.hasPdf
                      ? <button onClick={() => { setPage(memo.page ?? 1); setShowPdf(true); }}>資料 {memo.page}ページ</button>
                      : <span>資料 {memo.page}ページ参照</span>)}
                  </footer>
                  <button
                    type="button"
                    className="sticky-resize-edge horizontal"
                    aria-label={`付箋${index + 1}の幅を変更`}
                    onPointerDown={(event) => beginResize(event, memo, "horizontal")}
                    onPointerMove={moveResize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    onKeyDown={(event) => resizeWithKeyboard(event, memo, "horizontal")}
                  />
                  <button
                    type="button"
                    className="sticky-resize-edge vertical"
                    aria-label={`付箋${index + 1}の高さを変更`}
                    onPointerDown={(event) => beginResize(event, memo, "vertical")}
                    onPointerMove={moveResize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    onKeyDown={(event) => resizeWithKeyboard(event, memo, "vertical")}
                  />
                  <button
                    type="button"
                    className="sticky-resize-corner"
                    aria-label={`付箋${index + 1}のサイズを変更`}
                    title="ドラッグしてサイズ変更"
                    onPointerDown={(event) => beginResize(event, memo, "both")}
                    onPointerMove={moveResize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    onKeyDown={(event) => resizeWithKeyboard(event, memo, "both")}
                  />
                </article>
              ))}
            </div>
          </div>

          <div className="notebook-footnote">
            <GripHorizontal size={15} /> ノート本文へ直接入力できます。付箋は上部で移動し、端をドラッグするとサイズを変えられます。
          </div>
        </section>

        {showPdf && session.hasPdf && (
          <button
            type="button"
            className="workspace-splitter"
            aria-label="資料とノートの幅を変更"
            title="ドラッグして幅を変更"
            onPointerDown={beginSplitResize}
            onPointerMove={moveSplitResize}
            onPointerUp={endSplitResize}
            onPointerCancel={endSplitResize}
          ><span /></button>
        )}

        {showPdf && session.hasPdf && (
          <aside className="pdf-column">
            <div className="pdf-heading">
              <div><FileText size={18} /><span><strong>{session.fileName}</strong><small>{topic?.label ?? "講義資料"}</small></span></div>
              <button aria-label="資料を閉じる" onClick={() => setShowPdf(false)}><X size={18} /></button>
            </div>
            {session.pdfWarnings?.map((warning) => <div className="ocr-note" key={warning}><AlertTriangle size={15} /> {warning}</div>)}
            {session.needsOcr && !session.pdfWarnings?.some((warning) => warning.includes("OCR")) && <div className="ocr-note"><AlertTriangle size={15} /> 画像中心のPDFです。本文検索・見出し整理は利用できません。OCR機能はこの端末版に含まれていません。</div>}
            <div className="pdf-page">
              {pdfBlob ? <PdfPagePreview blob={pdfBlob} page={page} zoom={pdfZoom} /> : <TextPageFallback text={session.pageTexts[page - 1]} page={page} />}
            </div>
            <div className="pdf-controls">
              <button aria-label="前のページ" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}><ChevronLeft size={18} /></button>
              <label className="pdf-page-jump"><span className="sr-only">ページ番号</span><input aria-label="ページ番号" type="number" min="1" max={Math.max(1, session.pageCount)} value={page} onChange={(event) => setPage(clampNumber(Number(event.target.value) || 1, 1, Math.max(1, session.pageCount)))} /><small>/ {Math.max(1, session.pageCount)}</small></label>
              <button aria-label="次のページ" onClick={() => setPage(Math.min(session.pageCount, page + 1))} disabled={page >= session.pageCount}><ChevronRight size={18} /></button>
              <span className="pdf-control-divider" />
              <button aria-label="PDFを縮小" onClick={() => updateNotebookPrefs(session.id, { pdfZoom: Math.max(75, pdfZoom - 25) })}>−</button>
              <span className="pdf-zoom-value">{pdfZoom}%</span>
              <button aria-label="PDFを拡大" onClick={() => updateNotebookPrefs(session.id, { pdfZoom: Math.min(200, pdfZoom + 25) })}>＋</button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function ReviewView({
  courses,
  sessions,
  reviewKind,
  setReviewKind,
  noteReviewState,
  setNoteReviewState,
  terms,
  tags,
  term,
  setTerm,
  course,
  setCourse,
  tag,
  setTag,
  query,
  setQuery,
  memos,
  allMemos,
  memoCount,
  onOpenNote,
  onEditNote,
  onDeleteNote,
  onOpenMemo,
  onReflect,
  onTogglePin,
  onStartReview,
  onReviewResult,
  onStopReview,
  onStart,
  onExport,
  onImport,
  importMessage,
  storageHealth,
  metricSummary,
  onPersist,
}: {
  courses: Course[];
  sessions: SessionRecord[];
  reviewKind: "notes" | "memos";
  setReviewKind: (value: "notes" | "memos") => void;
  noteReviewState: NoteReviewState;
  setNoteReviewState: (changes: Partial<NoteReviewState>) => void;
  terms: string[];
  tags: string[];
  term: string;
  setTerm: (value: string) => void;
  course: string;
  setCourse: (value: string) => void;
  tag: string;
  setTag: (value: string) => void;
  query: string;
  setQuery: (value: string) => void;
  memos: Memo[];
  allMemos: Memo[];
  memoCount: (sessionId: string) => number;
  onOpenNote: (session: SessionRecord) => void;
  onEditNote: (session: SessionRecord) => void;
  onDeleteNote: (sessionId: string) => void;
  onOpenMemo: (memo: Memo) => void;
  onReflect: (memoId: string) => void;
  onTogglePin: (memoId: string) => void;
  onStartReview: (memoId: string) => void;
  onReviewResult: (memoId: string, result: MemoReviewResult) => void;
  onStopReview: (memoId: string) => void;
  onStart: () => void;
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  importMessage: string;
  storageHealth: { persisted: boolean; usage: number; quota: number };
  metricSummary: Record<string, number>;
  onPersist: () => void;
}) {
  return (
    <div className="review-page review-hub-page">
      <header className="review-heading">
        <div><p className="eyebrow">REVIEW</p><h1>ノートを見返す</h1><p>{reviewKind === "notes" ? "授業ノートの本文まで検索し、一覧や時間割から開けます。" : "残しておいた付箋を、講義やジャンルから探せます。"}</p></div>
        <button className="secondary-action" onClick={onStart}><Plus size={17} /> 新しい授業ノート</button>
      </header>
      <div className="review-kind-switch" role="tablist" aria-label="見返す内容">
        <button type="button" role="tab" aria-selected={reviewKind === "notes"} className={reviewKind === "notes" ? "active" : ""} onClick={() => setReviewKind("notes")}><NotebookPen size={18} /><span><strong>ノート</strong><small>本文・PDFから探す</small></span><b>{sessions.length}</b></button>
        <button type="button" role="tab" aria-selected={reviewKind === "memos"} className={reviewKind === "memos" ? "active" : ""} onClick={() => setReviewKind("memos")}><StickyNote size={18} /><span><strong>付箋</strong><small>大切な箇所を見返す</small></span><b>{allMemos.filter((memo) => memo.text.trim()).length}</b></button>
      </div>
      {reviewKind === "notes" ? (
        <NoteReviewPanel courses={courses} sessions={sessions} state={noteReviewState} onChange={setNoteReviewState} memoCount={memoCount} onOpen={onOpenNote} onEdit={onEditNote} onDelete={onDeleteNote} />
      ) : (
        <MemoReviewPanel courses={courses} terms={terms} tags={tags} term={term} setTerm={setTerm} course={course} setCourse={setCourse} tag={tag} setTag={setTag} query={query} setQuery={setQuery} memos={memos} allMemos={allMemos} onOpen={onOpenMemo} onReflect={onReflect} onTogglePin={onTogglePin} onStartReview={onStartReview} onReviewResult={onReviewResult} onStopReview={onStopReview} onExport={onExport} onImport={onImport} importMessage={importMessage} storageHealth={storageHealth} metricSummary={metricSummary} onPersist={onPersist} />
      )}
    </div>
  );
}

function MemoReviewPanel({
  courses,
  terms,
  tags,
  term,
  setTerm,
  course,
  setCourse,
  tag,
  setTag,
  query,
  setQuery,
  memos,
  allMemos,
  onOpen,
  onReflect,
  onTogglePin,
  onStartReview,
  onReviewResult,
  onStopReview,
  onExport,
  onImport,
  importMessage,
  storageHealth,
  metricSummary,
  onPersist,
}: {
  courses: Course[];
  terms: string[];
  tags: string[];
  term: string;
  setTerm: (value: string) => void;
  course: string;
  setCourse: (value: string) => void;
  tag: string;
  setTag: (value: string) => void;
  query: string;
  setQuery: (value: string) => void;
  memos: Memo[];
  allMemos: Memo[];
  onOpen: (memo: Memo) => void;
  onReflect: (memoId: string) => void;
  onTogglePin: (memoId: string) => void;
  onStartReview: (memoId: string) => void;
  onReviewResult: (memoId: string, result: MemoReviewResult) => void;
  onStopReview: (memoId: string) => void;
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  importMessage: string;
  storageHealth: { persisted: boolean; usage: number; quota: number };
  metricSummary: Record<string, number>;
  onPersist: () => void;
}) {
  const [relatedMemoId, setRelatedMemoId] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "due" | "pinned">("all");
  const [revealedMemoIds, setRevealedMemoIds] = useState<Set<string>>(() => new Set());
  const today = memoDateKey();
  const dueCount = memos.filter((memo) => isMemoReviewDue(memo, today)).length;
  const pinnedCount = memos.filter((memo) => memo.pinned).length;
  const visibleMemos = [...memos]
    .filter((memo) => scope === "all" || (scope === "due" ? isMemoReviewDue(memo, today) : memo.pinned))
    .sort((left, right) => {
      const pinDifference = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
      if (pinDifference !== 0) return pinDifference;
      const dueDifference = Number(isMemoReviewDue(right, today)) - Number(isMemoReviewDue(left, today));
      if (dueDifference !== 0) return dueDifference;
      return right.createdAt.localeCompare(left.createdAt);
    });
  const selectedCourseTitle = course === "すべて"
    ? "すべての講義"
    : courses.find((item) => item.id === course)?.title ?? "すべての講義";

  return (
    <div className="memo-review-panel">
      <section className="review-queue" aria-label="付箋の復習メニュー">
        <div>
          <CalendarDays size={20} />
          <span><strong>今日の復習 {dueCount}枚</strong><small>覚えた付箋は、1日・3日・7日後を目安にもう一度表示します。</small></span>
        </div>
        <div className="review-scope-switch" role="group" aria-label="付箋の表示範囲">
          <button type="button" className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>すべて <b>{memos.length}</b></button>
          <button type="button" className={scope === "due" ? "active" : ""} onClick={() => setScope("due")}>今日復習 <b>{dueCount}</b></button>
          <button type="button" className={scope === "pinned" ? "active" : ""} onClick={() => setScope("pinned")}><Pin size={14} /> ピン留め <b>{pinnedCount}</b></button>
        </div>
      </section>
      <section className="review-filter">
        <div className="review-search">
          <label htmlFor="review-search"><Search size={16} /> 付箋を検索</label>
          <input id="review-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="言葉、講義名、ジャンルから探す" />
        </div>
        <div className="term-filter">
          <label htmlFor="review-term"><CalendarDays size={16} /> 学期</label>
          <select id="review-term" value={term} onChange={(event) => setTerm(event.target.value)}>
            <option value="すべて">すべての学期</option>
            {terms.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </div>
        <div className="course-filter">
          <label htmlFor="review-course"><FolderOpen size={16} /> 講義</label>
          <select id="review-course" value={course} onChange={(event) => setCourse(event.target.value)}>
            <option value="すべて">すべての講義</option>
            {courses.map((item) => (
              <option value={item.id} key={item.id}>{item.title}{item.term ? "（" + item.term + "）" : ""}</option>
            ))}
          </select>
        </div>
        <div className="genre-filter">
          <span><Tags size={16} /> ジャンル</span>
          <div>
            <button className={tag === "すべて" ? "active" : ""} onClick={() => setTag("すべて")}>すべて</button>
            {tags.map((item) => <button key={item} className={tag === item ? "active" : ""} onClick={() => setTag(item)}>{item}</button>)}
          </div>
        </div>
      </section>

      <div className="review-result-heading">
        <h2>{selectedCourseTitle}</h2>
        <span>{scope === "due" ? "今日の復習" : scope === "pinned" ? "ピン留め" : tag === "すべて" ? "全ジャンル" : tag}・{visibleMemos.length}枚</span>
      </div>

      {visibleMemos.length > 0 ? (
        <div className="review-grid">
          {visibleMemos.map((memo, index) => {
            const latestReflection = memo.reflections.at(-1);
            const related = relatedMemoId === memo.id ? findRelatedMemos(memo, allMemos) : [];
            const review = normalizeMemoReview(memo);
            const due = isMemoReviewDue(memo, today);
            const concealed = scope === "due" && !revealedMemoIds.has(memo.id);
            return (
              <article className={`review-sticky tone-${index % 4}${memo.pinned ? " pinned" : ""}${due ? " due" : ""}`} key={memo.id}>
                <div className="review-sticky-tools">
                  <span>{due ? "今日の復習" : review.nextReviewAt ? `次回 ${formatReviewDate(review.nextReviewAt)}` : "自由メモ"}</span>
                  <button type="button" className={memo.pinned ? "active" : ""} aria-label={memo.pinned ? "ピン留めを外す" : "ピン留めする"} onClick={() => onTogglePin(memo.id)}><Pin size={15} fill={memo.pinned ? "currentColor" : "none"} /></button>
                </div>
                <button className={`review-sticky-main${concealed ? " concealed" : ""}`} onClick={() => {
                  if (concealed) {
                    setRevealedMemoIds((current) => new Set(current).add(memo.id));
                  } else {
                    onOpen(memo);
                  }
                }}>
                  <div className="sticky-tags">{memo.tags.map((item) => <span key={item}>{item}</span>)}</div>
                  <p>{concealed ? "内容を思い出してから、ここを押して答え合わせ" : memo.text}</p>
                  {!concealed && latestReflection && (
                    <div className="review-reflection">
                      <span>{reflectionStatusLabel(latestReflection.status)}</span>
                      {latestReflection.text && <small>{latestReflection.text}</small>}
                    </div>
                  )}
                </button>
                <footer>
                  <span><strong>{memo.course}</strong><small>{sessionLabel(memo.sessionNumber)}{memo.page ? "・資料" + memo.page + "ページ" : ""}</small></span>
                  <div>
                    <button type="button" onClick={() => setRelatedMemoId(relatedMemoId === memo.id ? null : memo.id)}>関連を探す</button>
                    <button type="button" onClick={() => onReflect(memo.id)}>今の考えを足す</button>
                  </div>
                </footer>
                <div className="review-actions">
                  {!review.nextReviewAt ? (
                    <button type="button" className="review-start" onClick={() => onStartReview(memo.id)}>復習に追加</button>
                  ) : due ? (
                    <>
                      <button type="button" disabled={concealed} onClick={() => onReviewResult(memo.id, "again")}><RotateCcw size={14} /> もう一度</button>
                      <button type="button" className="remembered" disabled={concealed} onClick={() => onReviewResult(memo.id, "remembered")}><Check size={14} /> 覚えた</button>
                    </>
                  ) : (
                    <>
                      <span>次は {formatReviewDate(review.nextReviewAt)}</span>
                      <button type="button" onClick={() => onStopReview(memo.id)}>復習を終了</button>
                    </>
                  )}
                </div>
                {relatedMemoId === memo.id && (
                  <div className="related-memos">
                    <strong>この端末の付箋から</strong>
                    {related.length > 0 ? related.map((item) => (
                      <button key={item.id} type="button" onClick={() => onOpen(item)}>
                        <span>{item.course}・{sessionLabel(item.sessionNumber)}</span>
                        <small>{item.text}</small>
                      </button>
                    )) : <p>別の講義に、近い言葉の付箋はまだありません。</p>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-review">
          <ListFilter size={28} />
          <h2>{scope === "due" ? "今日復習する付箋はありません" : scope === "pinned" ? "ピン留めした付箋はありません" : "該当する付箋はありません"}</h2>
          <p>{scope === "due" ? "付箋の復習日になると、ここに自動で並びます。" : scope === "pinned" ? "大切な付箋のピンを押すと、ここにまとめられます。" : "検索する言葉、学期、講義、ジャンルを変えてみてください。"}</p>
          <button onClick={() => { setScope("all"); setQuery(""); setTerm("すべて"); setCourse("すべて"); setTag("すべて"); }}>すべての付箋を見る</button>
        </div>
      )}

      <details className="data-tools">
        <summary>端末の引っ越し・バックアップ</summary>
        <div>
          <p>講義、ノート、付箋、PDF本体を1つの完全バックアップに保存できます。読み込み前に内容を確認できます。</p>
          <span>
            <button type="button" onClick={() => onExport()}><Download size={15} /> 完全バックアップ</button>
            <label><Upload size={15} /> バックアップを読み込む<input type="file" accept=".manabimemo,.json,application/json,application/x-manabi-memo" onChange={onImport} /></label>
          </span>
          {importMessage && <small role="status">{importMessage}</small>}
        </div>
      </details>

      <details className="storage-diagnostics">
        <summary>保存状態を確認</summary>
        <p>ノートとPDFはこの端末に保存されています。クラウド同期の利用中も、ブラウザデータを消す前に完全バックアップを作成してください。</p>
        <div className="storage-diagnostics-grid"><div><span>保存の維持</span><strong>{storageHealth.persisted ? "有効" : "未設定"}</strong></div><div><span>使用量</span><strong>{formatBytes(storageHealth.usage)}</strong></div><div><span>利用可能枠</span><strong>{storageHealth.quota ? formatBytes(storageHealth.quota) : "確認不可"}</strong></div><button type="button" onClick={onPersist}>{storageHealth.persisted ? "設定済み" : "保存を安定させる"}</button></div>
      </details>

      <details className="local-metrics">
        <summary>この端末の利用サマリー</summary>
        <p>本文・講義名・PDF名・タグ名は記録せず、操作回数だけを端末内で集計します。外部には送信しません。</p>
        <div className="local-metrics-grid">{Object.entries(metricSummary).length > 0 ? Object.entries(metricSummary).map(([name, count]) => <div key={name}><span>{metricLabel(name)}</span><strong>{count}</strong></div>) : <span>まだ集計はありません</span>}</div>
      </details>
    </div>
  );
}

function ReflectionDialog({
  memo,
  onClose,
  onSave,
}: {
  memo: Memo;
  onClose: () => void;
  onSave: (status: ReflectionStatus, text: string) => void;
}) {
  const [status, setStatus] = useState<ReflectionStatus>("still-important");
  const [text, setText] = useState("");
  const options: Array<{ value: ReflectionStatus; label: string }> = [
    { value: "still-important", label: "今も重要だと思う" },
    { value: "still-unclear", label: "まだよく分からない" },
    { value: "changed", label: "考えが変わった" },
    { value: "connected", label: "別の講義とつながった" },
  ];

  useEffect(() => {
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="reflection-dialog" role="dialog" aria-modal="true" aria-labelledby="reflection-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-heading reflection-heading">
          <div><p className="eyebrow">LOOK AGAIN</p><h2 id="reflection-title">今の自分から、一言。</h2><span>元の付箋はそのまま残ります。</span></div>
          <button className="dialog-close" type="button" aria-label="閉じる" onClick={onClose}><X size={19} /></button>
        </div>
        <blockquote>{memo.text}</blockquote>
        <div className="reflection-statuses" aria-label="今の考え">
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className={status === option.value ? "active" : ""}
              onClick={() => setStatus(option.value)}
            >
              {status === option.value && <Check size={14} />}{option.label}
            </button>
          ))}
        </div>
        <label className="reflection-text">
          <span>一言メモ <small>任意</small></span>
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="今わかったことや、つながったことを書く…" autoFocus />
        </label>
        <button className="reflection-save" type="button" onClick={() => onSave(status, text)}>
          この考えを付け足す
        </button>
      </section>
    </div>
  );
}

function PdfPagePreview({ blob, page, zoom }: { blob: Blob; page: number; zoom: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let loadingTask: { promise: Promise<unknown>; destroy: () => Promise<void> } | null = null;

    async function renderPage() {
      try {
        setStatus("loading");
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const data = new Uint8Array(await blob.arrayBuffer());
        loadingTask = pdfjs.getDocument({ data });
        const document = await loadingTask.promise as Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
        const pdfPage = await document.getPage(page);
        const viewport = pdfPage.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas unavailable");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const currentRenderTask = pdfPage.render({ canvas, canvasContext: context, viewport });
        renderTask = currentRenderTask;
        await currentRenderTask.promise;
        if (!cancelled) setStatus("ready");
      } catch (cause) {
        if (!cancelled) {
          console.error("PDF page render failed", cause);
          setStatus("error");
        }
      }
    }

    void renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [blob, page]);

  return (
    <div className="pdf-canvas-wrap" aria-label={"PDF " + page + "ページ"}>
      {status === "loading" && <div className="pdf-render-status"><LoaderCircle size={20} className="spin" /> ページを表示しています</div>}
      {status === "error" && <div className="pdf-render-status error"><AlertTriangle size={20} /> ページを表示できませんでした</div>}
      <canvas ref={canvasRef} className={status === "ready" ? "ready" : ""} style={{ width: `${zoom}%` }} />
    </div>
  );
}

function TextPageFallback({ text, page }: { text?: string; page: number }) {
  return (
    <div className="text-page-fallback">
      <FileText size={23} />
      <strong>{page}ページの抽出テキスト</strong>
      <p>{text || "PDF本体がこの端末に見つかりません。同じPDFをもう一度追加してください。"}</p>
    </div>
  );
}

function normalizeSavedState(value: SavedState) {
  const rawCourses = Array.isArray(value.courses) ? value.courses : [];
  const isPreviousPrototype = !Array.isArray(value.courses);
  const rawSessions = (Array.isArray(value.sessions) ? value.sessions : [])
    .filter((session): session is SessionRecord => Boolean(session) && typeof session === "object")
    .filter((session) => !isPreviousPrototype || !previousDemoSessionIds.has(session.id));
  const rawMemos = (Array.isArray(value.memos) ? value.memos : [])
    .filter((memo): memo is Memo => Boolean(memo) && typeof memo === "object")
    .filter((memo) => !isPreviousPrototype || (
      !previousDemoMemoIds.has(memo.id) && !previousDemoSessionIds.has(memo.sessionId)
    ));
  const coursesById = new Map<string, Course>();

  for (const course of rawCourses) {
    if (!course || typeof course.title !== "string" || !course.title.trim()) continue;
    const normalized: Course = {
      id: typeof course.id === "string" && course.id ? course.id : stableCourseId(course.title),
      title: course.title.trim(),
      term: typeof course.term === "string" && course.term.trim() ? course.term.trim() : DEFAULT_TERM,
      instructor: typeof course.instructor === "string" ? course.instructor : "",
      weekday: typeof course.weekday === "number" && course.weekday >= 1 && course.weekday <= 6 ? course.weekday : null,
      period: typeof course.period === "number" && course.period >= 1 && course.period <= 5 ? course.period : null,
      room: typeof course.room === "string" ? course.room : "",
      createdAt: typeof course.createdAt === "string" ? course.createdAt : new Date().toISOString(),
      archivedAt: typeof course.archivedAt === "string" ? course.archivedAt : null,
      deletedAt: typeof course.deletedAt === "string" && Number.isFinite(new Date(course.deletedAt).getTime()) ? course.deletedAt : null,
    };
    coursesById.set(normalized.id, normalized);
  }

  function ensureCourse(titleValue: unknown, preferredId?: string) {
    const title = typeof titleValue === "string" && titleValue.trim() ? titleValue.trim() : "名称未設定の講義";
    if (preferredId && coursesById.has(preferredId)) return coursesById.get(preferredId) as Course;
    const sameTitle = Array.from(coursesById.values()).find((course) => course.title === title);
    if (sameTitle) return sameTitle;
    const course: Course = {
      id: preferredId || stableCourseId(title),
      title,
      term: DEFAULT_TERM,
      instructor: "",
      weekday: null,
      period: null,
      room: "",
      createdAt: new Date().toISOString(),
    };
    coursesById.set(course.id, course);
    return course;
  }

  const sessions = rawSessions.map((session) => {
    const course = ensureCourse(session?.course, session?.courseId);
    const hasPdf = Boolean(session.hasPdf);
    const fileName = typeof session.fileName === "string" ? session.fileName.trim().slice(0, 260) : "";
    const pageCount = typeof session.pageCount === "number" && Number.isFinite(session.pageCount)
      ? clampNumber(Math.round(session.pageCount), 0, 10_000)
      : 0;
    const pdfReference = normalizePdfReferenceFields(session, hasPdf, fileName, pageCount);
    return {
      ...session,
      courseId: course.id,
      course: course.title,
      fileName,
      pageCount,
      pageTexts: pdfReference.pdfReferenceOnly ? [] : Array.isArray(session.pageTexts) ? session.pageTexts : [],
      topics: pdfReference.pdfReferenceOnly ? [] : Array.isArray(session.topics) ? session.topics : [],
      needsOcr: pdfReference.pdfReferenceOnly ? false : Boolean(session.needsOcr),
      pdfWarnings: pdfReference.pdfReferenceOnly ? [] : Array.isArray(session.pdfWarnings)
        ? session.pdfWarnings.filter((warning): warning is string => typeof warning === "string").slice(0, 8)
        : [],
      hasPdf,
      ...pdfReference,
      lastPdfPage: typeof session.lastPdfPage === "number"
        ? clampNumber(Math.round(session.lastPdfPage), 1, Math.max(1, pageCount))
        : 1,
      noteText: typeof session.noteText === "string" ? session.noteText : "",
      notebookPrefs: normalizeNotebookPrefs(session.notebookPrefs),
      deletedAt: typeof session.deletedAt === "string" && Number.isFinite(new Date(session.deletedAt).getTime()) ? session.deletedAt : null,
    };
  });
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));

  const memos = rawMemos.map((memo, index) => {
    const linkedSession = sessionsById.get(memo.sessionId);
    const course = linkedSession
      ? coursesById.get(linkedSession.courseId) as Course
      : ensureCourse(memo?.course, memo?.courseId);
    const fallbackPosition = defaultNotebookPosition(index);
    return {
      ...memo,
      courseId: course.id,
      course: course.title,
      tags: Array.isArray(memo.tags) ? memo.tags.filter((tag): tag is string => typeof tag === "string") : [],
      x: typeof memo.x === "number" && Number.isFinite(memo.x)
        ? clampNumber(memo.x, 0, 100)
        : fallbackPosition.x,
      y: typeof memo.y === "number" && Number.isFinite(memo.y)
        ? Math.max(165, memo.y)
        : fallbackPosition.y,
      width: typeof memo.width === "number" && Number.isFinite(memo.width)
        ? clampNumber(memo.width, 190, 760)
        : 310,
      height: typeof memo.height === "number" && Number.isFinite(memo.height)
        ? clampNumber(memo.height, 160, 720)
        : 230,
      sourceStart: typeof memo.sourceStart === "number" ? memo.sourceStart : null,
      sourceEnd: typeof memo.sourceEnd === "number" ? memo.sourceEnd : null,
      sourceText: typeof memo.sourceText === "string" ? memo.sourceText : "",
      reflections: Array.isArray(memo.reflections)
        ? memo.reflections.filter((reflection) => (
          reflection
          && typeof reflection.id === "string"
          && isReflectionStatus(reflection.status)
        )).map((reflection) => ({
          id: reflection.id,
          status: reflection.status,
          text: typeof reflection.text === "string" ? reflection.text : "",
          createdAt: typeof reflection.createdAt === "string" ? reflection.createdAt : new Date().toISOString(),
        }))
        : [],
      ...normalizeMemoReview(memo),
      deletedAt: typeof memo.deletedAt === "string" && Number.isFinite(new Date(memo.deletedAt).getTime()) ? memo.deletedAt : null,
    };
  });

  const normalizedCourseTags: Record<string, string[]> = {};
  if (value.courseTags && typeof value.courseTags === "object") {
    for (const [key, tags] of Object.entries(value.courseTags)) {
      if (!Array.isArray(tags)) continue;
      const course = coursesById.get(key)
        ?? Array.from(coursesById.values()).find((item) => item.title === key);
      if (course) normalizedCourseTags[course.id] = Array.from(new Set(tags.filter((tag): tag is string => typeof tag === "string")));
    }
  }

  return {
    courses: Array.from(coursesById.values()),
    sessions,
    memos,
    globalTags: Array.isArray(value.globalTags) && value.globalTags.length > 0
      ? Array.from(new Set(value.globalTags.filter((tag): tag is string => typeof tag === "string")))
      : initialGlobalTags,
    courseTags: normalizedCourseTags,
    courseTemplates: value.courseTemplates && typeof value.courseTemplates === "object"
      ? Object.fromEntries(Object.entries(value.courseTemplates).filter(([, template]) => typeof template === "string"))
      : {},
    terms: Array.from(new Set([
      ...(Array.isArray(value.terms) ? value.terms.filter((term): term is string => typeof term === "string" && Boolean(term.trim())) : []),
      ...Array.from(coursesById.values()).map((course) => course.term || DEFAULT_TERM),
    ])).length > 0 ? Array.from(new Set([
      ...(Array.isArray(value.terms) ? value.terms.filter((term): term is string => typeof term === "string" && Boolean(term.trim())) : []),
      ...Array.from(coursesById.values()).map((course) => course.term || DEFAULT_TERM),
    ])) : [DEFAULT_TERM],
    activeTerm: typeof value.activeTerm === "string" && value.activeTerm.trim()
      ? value.activeTerm
      : Array.from(coursesById.values())[0]?.term || DEFAULT_TERM,
    tutorialSeen: typeof value.tutorialSeen === "boolean" ? value.tutorialSeen : rawCourses.length > 0,
    campus: normalizeCampusState(value.campus),
    displayPreferences: normalizeDisplayPreferences(value.displayPreferences),
  };
}

function migrateLegacyState(value: { importedLectures?: LegacyLecture[]; memos?: LegacyMemo[] }) {
  const courseNames = Array.from(new Set([
    ...(value.importedLectures ?? []).map((lecture) => lecture.course),
    ...(value.memos ?? []).map((memo) => memo.course),
  ].map((title) => title.trim()).filter(Boolean)));
  const courses: Course[] = courseNames.map((title) => ({
    id: stableCourseId(title),
    title,
    term: DEFAULT_TERM,
    instructor: "",
    weekday: null,
    period: null,
    room: "",
    createdAt: new Date().toISOString(),
  }));
  const courseIdFor = (title: string) => (
    courses.find((course) => course.title === title.trim())?.id ?? stableCourseId(title)
  );

  const sessions: SessionRecord[] = (value.importedLectures ?? []).map((lecture) => ({
    id: lecture.id,
    courseId: courseIdFor(lecture.course),
    course: lecture.course,
    sessionNumber: normalizeSessionNumber(lecture.session),
    title: lecture.title,
    fileName: lecture.fileName,
    pageCount: lecture.pageCount,
    pageTexts: lecture.pageTexts ?? [],
    topics: lecture.topics ?? [],
    needsOcr: Boolean(lecture.needsOcr),
    hasPdf: true,
    lastPdfPage: 1,
    noteText: "",
    notebookPrefs: { ...defaultNotebookPrefs },
    createdAt: lecture.createdAt,
  }));

  const memos: Memo[] = (value.memos ?? []).map((legacy, index) => {
    const courseId = courseIdFor(legacy.course);
    const sessionNumber = normalizeSessionNumber(legacy.lecture);
    let session = sessions.find((item) => (
      item.courseId === courseId
      && normalizeSessionNumber(item.sessionNumber) === sessionNumber
    ));
    if (!session) {
      session = {
        id: createId("legacy-session"),
        courseId,
        course: legacy.course,
        sessionNumber,
        title: legacy.lecture.replace(/^第?\d+回?[\s　]*/, "") || sessionLabel(sessionNumber) + "のノート",
        pageCount: 0,
        pageTexts: [],
        topics: [],
        needsOcr: false,
        hasPdf: false,
        lastPdfPage: 1,
        noteText: "",
        notebookPrefs: { ...defaultNotebookPrefs },
        createdAt: legacy.date || new Date().toISOString(),
      };
      sessions.push(session);
    }
    const position = defaultNotebookPosition(index);
    return {
      id: "legacy-memo-" + legacy.id,
      sessionId: session.id,
      courseId,
      course: legacy.course,
      sessionNumber,
      sessionTitle: session.title,
      page: legacy.page || null,
      text: legacy.text,
      tags: Array.from(new Set([legacy.kind, ...(legacy.tags ?? [])].filter(Boolean))),
      x: position.x,
      y: position.y,
      width: 310,
      height: 230,
      sourceStart: null,
      sourceEnd: null,
      sourceText: "",
      reflections: [],
      createdAt: legacy.date || new Date().toISOString(),
    };
  });

  return { courses, sessions, memos };
}

function stableCourseId(title: string) {
  let hash = 2166136261;
  for (let index = 0; index < title.length; index += 1) {
    hash = Math.imul(hash ^ title.charCodeAt(index), 16777619);
  }
  return "course-legacy-" + (hash >>> 0).toString(36);
}

function defaultNotebookPosition(index: number) {
  const xPattern = [4, 68, 34, 82, 14, 56];
  return {
    x: xPattern[index % xPattern.length],
    y: 180 + Math.floor(index / 2) * 250,
  };
}

function nextNotebookPosition(memos: Memo[]) {
  return defaultNotebookPosition(memos.length);
}

function memoTone(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return Math.abs(hash) % 4;
}

function pickDailyMemo(memos: Memo[]) {
  const todayKey = memoDateKey();
  const allCandidates = memos.filter((memo) => memo.text.trim());
  const dueCandidates = allCandidates.filter((memo) => isMemoReviewDue(memo, todayKey));
  const pinnedCandidates = allCandidates.filter((memo) => memo.pinned);
  const candidates = dueCandidates.length > 0
    ? dueCandidates
    : pinnedCandidates.length > 0 ? pinnedCandidates : allCandidates;
  if (candidates.length === 0) return null;
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  let hash = 0;
  for (let index = 0; index < dateKey.length; index += 1) {
    hash = (hash * 31 + dateKey.charCodeAt(index)) | 0;
  }
  return candidates[Math.abs(hash) % candidates.length];
}

function formatReviewDate(dateKey: string) {
  const [, month, day] = dateKey.split("-").map(Number);
  return `${month}月${day}日`;
}

function isReflectionStatus(value: unknown): value is ReflectionStatus {
  return value === "still-important"
    || value === "still-unclear"
    || value === "changed"
    || value === "connected";
}

function reflectionStatusLabel(status: ReflectionStatus) {
  if (status === "still-unclear") return "まだよく分からない";
  if (status === "changed") return "考えが変わった";
  if (status === "connected") return "別の講義とつながった";
  return "今も重要だと思う";
}

function findRelatedMemos(source: Memo, memos: Memo[]) {
  const sourceTokens = memoTokens(source);
  return memos
    .filter((memo) => memo.id !== source.id && memo.courseId !== source.courseId && memo.text.trim())
    .map((memo) => {
      const targetTokens = memoTokens(memo);
      const overlap = Array.from(sourceTokens).filter((token) => targetTokens.has(token)).length;
      const sharedTags = source.tags.filter((tag) => memo.tags.includes(tag)).length;
      return { memo, score: overlap / Math.max(1, Math.min(sourceTokens.size, targetTokens.size)) + sharedTags * 0.35 };
    })
    .filter((item) => item.score >= 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.memo);
}

function memoTokens(memo: Memo) {
  const normalized = `${memo.text} ${memo.tags.join(" ")}`
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s　、。！？!?「」『』（）()・:：,.;；/\\]+/g, "");
  const tokens = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    tokens.add(normalized.slice(index, index + 2));
  }
  return tokens;
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function isSavedStateShape(value: unknown): value is SavedState {
  if (!value || typeof value !== "object") return false;
  const state = value as SavedState;
  return (typeof state.courses === "undefined" || Array.isArray(state.courses))
    && Array.isArray(state.sessions)
    && Array.isArray(state.memos)
    && (typeof state.campus === "undefined" || Boolean(state.campus && typeof state.campus === "object"));
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLocaleLowerCase("ja-JP").endsWith(".pdf");
}

function normalizeNotebookPrefs(value: unknown): NotebookPrefs {
  if (!value || typeof value !== "object") return { ...defaultNotebookPrefs };
  const prefs = value as Partial<NotebookPrefs>;
  return {
    paper: prefs.paper === "plain" || prefs.paper === "grid" || prefs.paper === "dots" ? prefs.paper : "lined",
    width: prefs.width === "compact" || prefs.width === "wide" ? prefs.width : "standard",
    fontSize: prefs.fontSize === "small" || prefs.fontSize === "large" ? prefs.fontSize : "medium",
    pdfPosition: prefs.pdfPosition === "right" ? "right" : "left",
    pdfPercent: typeof prefs.pdfPercent === "number" ? clampNumber(prefs.pdfPercent, 30, 70) : 48,
    pdfZoom: typeof prefs.pdfZoom === "number" ? clampNumber(prefs.pdfZoom, 75, 200) : 100,
  };
}

function isDefaultSessionTitle(title: string, sessionNumber: string) {
  const label = sessionLabel(sessionNumber);
  return title === label + "のメモ" || title === label + "のノート";
}

function nextSessionNumber(courseId: string, sessions: SessionRecord[]) {
  const sessionNumbers = sessions
    .filter((session) => session.courseId === courseId)
    .map((session) => Number(normalizeSessionNumber(session.sessionNumber)))
    .filter((value) => Number.isFinite(value));
  return String(sessionNumbers.length > 0 ? Math.max(...sessionNumbers) + 1 : 1);
}

function weekdayLabel(value: number) {
  return weekdays.find((day) => day.value === value)?.label ?? "曜日未設定";
}

function normalizeSessionNumber(value: string) {
  return value.match(/\d+/)?.[0] ?? (value.trim().replace(/^第|回$/g, "") || "1");
}

function isValidSessionNumber(value: string) {
  return /^\d+$/.test(value.trim()) && Number(value) >= 1;
}

function sessionLabel(value: string) {
  return "第" + normalizeSessionNumber(value) + "回";
}

function defaultAcademicTerm() {
  const now = new Date();
  const year = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  const season = now.getMonth() >= 9 || now.getMonth() < 3 ? "後期" : "前期";
  return `${year}年度 ${season}`;
}

function stateFingerprint(state: SavedState | NormalizedState) {
  return JSON.stringify(state);
}

function hasMeaningfulState(state: SavedState) {
  const campus = normalizeCampusState(state.campus);
  return Boolean(
    state.courses?.length
    || state.sessions?.length
    || state.memos?.length
    || campus.assignments.length
    || campus.exams.length
    || campus.attendanceRecords.length
    || campus.studyTasks.length
    || campus.gpaProfile.plans.length
    || campus.degreePlan.categories.length,
  );
}

function saveStatusLabel(status: SaveStatus, savedAt: string) {
  if (status === "loading") return "保存データを確認中";
  if (status === "dirty") return "未保存の変更があります";
  if (status === "saving") return "この端末に保存中";
  if (status === "error") return "保存できていません";
  if (status === "conflict") return "別のタブの更新を確認してください";
  return savedAt ? `保存しました ${formatTime(savedAt)}` : "この端末に保存しました";
}

function isStorageConflict(cause: unknown) {
  return cause instanceof Error && (cause.name === "StorageConflictError" || cause.message === "STORAGE_CONFLICT");
}

function isQuotaError(cause: unknown) {
  return cause instanceof DOMException && cause.name === "QuotaExceededError";
}

function storageErrorCode(cause: unknown) {
  if (isQuotaError(cause)) return "quota";
  if (isStorageConflict(cause)) return "conflict";
  return "unknown";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "更新日不明" : new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(date);
}

function noteReviewPreview(session: SessionRecord, query: string) {
  const sources: Array<{ text: string; source: "note" | "pdf" }> = [
    { text: session.noteText, source: "note" },
    ...session.pageTexts.map((text) => ({ text, source: "pdf" as const })),
  ];
  const match = query ? sources.find((source) => source.text.toLocaleLowerCase("ja").includes(query)) : sources.find((source) => source.text.trim());
  if (!match) return { text: "本文はまだありません", source: "note" as const };
  const compact = match.text.replace(/\s+/g, " ").trim();
  const index = query ? compact.toLocaleLowerCase("ja").indexOf(query) : 0;
  const start = Math.max(0, index - 45);
  const excerpt = compact.slice(start, start + 150);
  return { text: `${start > 0 ? "…" : ""}${excerpt}${start + 150 < compact.length ? "…" : ""}`, source: match.source };
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "作成日時不明" : new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function metricLabel(name: string) {
  const labels: Record<string, string> = {
    course_created: "講義を作成",
    course_detail_open: "講義を開く",
    session_opened: "授業回を開く",
    sticky_created: "付箋を作成",
    origin_reopened: "元の資料へ戻る",
    backup_completed: "バックアップ",
    import_completed: "復元",
    save_failed: "保存エラー",
    storage_persist_result: "保存設定",
    memo_review_started: "付箋の復習を開始",
    memo_review_remembered: "復習で覚えた",
    memo_review_again: "復習でもう一度",
  };
  return labels[name] ?? name;
}

function topicForPage(topics: ProcessedTopic[], page: number) {
  return topics.find((topic) => page >= topic.startPage && page <= topic.endPage) ?? topics[0];
}

function createId(prefix: string) {
  const id = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : Date.now() + "-" + Math.random().toString(16).slice(2);
  return prefix + "-" + id;
}

function getFeedbackDeviceId() {
  const key = "manabi-memo-feedback-device";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const next = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(key, next);
    return next;
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  }
}
