"use client";

import { AlertTriangle, Check, Cloud, CloudOff, LoaderCircle, LogIn, RefreshCw, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  authenticatedFetch,
  observeFirebaseUser,
  resetFirebasePassword,
  signInWithEmail,
  signInWithGoogle,
  signOutFirebase,
  signUpWithEmail,
} from "./firebase-auth-client";
import { loadAllPdfs } from "./local-files";
import { decideSyncPlan, fingerprintState, type LocalSyncMeta } from "./sync-model";
import { pdfVersionsFromState } from "./pdf-sync-model";
import { retryTransient } from "./sync-retry-model";

type Account = { id: string; displayName: string; email: string; provider?: string };
type CloudPdf = { sessionId: string; size: number; sha256: string; stateRevision: number; noteVersion: string; updatedAt: string };
type CloudEnvelope = {
  exists: boolean;
  deleted?: boolean;
  pending?: boolean;
  incomplete?: boolean;
  pendingTransactionId?: string | null;
  revision: number;
  schemaVersion?: number;
  state?: unknown;
  updatedAt?: string;
  updatedBy?: string;
  pdfs: CloudPdf[];
};
type SyncPhase = "idle" | "checking" | "syncing" | "synced" | "offline" | "choice" | "conflict" | "account-mismatch" | "error";

type AccountSyncProps = {
  currentState: object;
  schemaVersion: number;
  hydrated: boolean;
  localHasData: boolean;
  onApplyCloud: (state: unknown, pdfs: Array<{ id: string; blob: Blob }>) => Promise<void>;
  onCampusEntitlement: (enabled: boolean | null) => void;
  onFirebaseAvailability?: (enabled: boolean | null) => void;
};

const META_KEY = "manabi-memo-account-sync-v1";
const DEVICE_KEY = "manabi-memo-sync-device-v1";

type PendingUpload = {
  accountId: string;
  baseRevision: number;
  targetRevision: number;
  transactionId: string;
  fingerprint: string;
  manifests: Array<{ sessionId: string; size: number; sha256: string; noteVersion: string }>;
};

export default function AccountSync({ currentState, schemaVersion, hydrated, localHasData, onApplyCloud, onCampusEntitlement, onFirebaseAvailability }: AccountSyncProps) {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [meta, setMeta] = useState<LocalSyncMeta | null>(null);
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [panelOpen, setPanelOpen] = useState(false);
  const [cloud, setCloud] = useState<CloudEnvelope | null>(null);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState("");
  const [firebaseEnabled, setFirebaseEnabled] = useState<boolean | null>(null);
  const [legacyLinkAvailable, setLegacyLinkAvailable] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [mismatchedAccount, setMismatchedAccount] = useState(false);
  const pendingUploadRef = useRef<PendingUpload | null>(null);
  const localFingerprint = useMemo(() => fingerprintState(currentState), [currentState]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: () => void = () => undefined;
    void observeFirebaseUser(async (user, enabled) => {
      if (cancelled) return;
      setFirebaseEnabled(enabled);
      onFirebaseAvailability?.(enabled);
      if (enabled && (!user || !user.emailVerified)) {
        setAccount(null);
        setMeta(null);
        setLegacyLinkAvailable(false);
        onCampusEntitlement(false);
        return;
      }
      await loadAccount(enabled);
    }).then((cleanup) => { unsubscribe = cleanup; });
    async function loadAccount(useFirebase: boolean) {
      try {
        const response = useFirebase
          ? await authenticatedFetch("/api/account", { cache: "no-store" })
          : await fetch("/api/account", { cache: "no-store" });
        if (response.status === 401) {
          if (!cancelled) { setAccount(null); setMeta(null); onCampusEntitlement(false); }
          return;
        }
        if (!response.ok) throw new Error("アカウントを確認できませんでした");
        const result = await response.json() as { account: Account; campusBeta: boolean; legacyLinkAvailable?: boolean };
        if (cancelled) return;
        setAccount(result.account);
        setLegacyLinkAvailable(result.legacyLinkAvailable === true);
        onCampusEntitlement(result.campusBeta);
        const storedMeta = readStoredMeta();
        if (storedMeta && storedMeta.accountId !== result.account.id) {
          setMeta(null);
          setMismatchedAccount(true);
          setPhase("account-mismatch");
          setMessage("この端末には別のアカウントで使った同期情報があります。内容を自動送信せず停止しました。");
          setPanelOpen(true);
        } else {
          setMismatchedAccount(false);
          setMeta(storedMeta);
        }
      } catch {
        if (!cancelled) { setAccount(null); onCampusEntitlement(null); }
      }
    }
    return () => { cancelled = true; unsubscribe(); };
  }, [onCampusEntitlement, onFirebaseAvailability]);

  useEffect(() => {
    if (!hydrated || !account || !meta?.enabled || phase !== "idle") return;
    void reconcile();
    // reconcileは現在の端末状態を使い、アカウント確定時に一度だけ実行する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, hydrated, meta?.enabled]);

  useEffect(() => {
    if (!hydrated || !account || !meta?.enabled || phase !== "synced" || localFingerprint === meta.fingerprint) return;
    const timer = window.setTimeout(() => void uploadLocal(meta.revision), 1800);
    return () => window.clearTimeout(timer);
    // uploadLocalは最新stateを閉包し、変更ごとにタイマーを張り直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFingerprint, phase, meta?.revision, meta?.fingerprint, account?.id]);

  useEffect(() => {
    const handleOnline = () => {
      if (account && meta?.enabled) void reconcile();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, meta?.enabled]);

  useEffect(() => {
    if (!panelOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanelOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [panelOpen]);

  useEffect(() => {
    const openPanel = () => setPanelOpen(true);
    window.addEventListener("manabi-memo:open-account", openPanel);
    return () => window.removeEventListener("manabi-memo:open-account", openPanel);
  }, []);

  async function fetchCloud() {
    const response = await authenticatedFetch("/api/sync/state", { cache: "no-store" });
    if (response.status === 401) {
      setAccount(null);
      throw new Error("ログイン状態を確認できませんでした。");
    }
    const result = await response.json() as CloudEnvelope & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "クラウドデータを確認できませんでした。");
    setCloud(result);
    return result;
  }

  async function reconcile() {
    if (!account || !hydrated) return;
    setPhase("checking");
    setMessage("");
    try {
      const remote = await fetchCloud();
      if ((remote.schemaVersion ?? 1) > schemaVersion) {
        throw new Error("クラウドデータが新しい形式です。アプリを更新してから同期してください。");
      }
      if (remote.deleted) {
        setPhase("conflict");
        setMessage("別の端末でクラウドデータが削除されています。この端末の内容は保護しています。");
        setPanelOpen(true);
        return;
      }
      if (remote.pending || remote.incomplete) {
        const pending = pendingUploadRef.current;
        if (pending && pending.accountId === account.id && pending.fingerprint === localFingerprint) {
          return void await uploadLocal(pending.baseRevision);
        }
        setPhase("error");
        setMessage("前回のクラウド同期がPDFの確認前に中断されています。内容を確認してから再試行してください。");
        setPanelOpen(true);
        return;
      }
      const cloudFingerprint = remote.exists ? fingerprintState(remote.state) : "";
      const storedMeta = readMeta(account.id);
      const plan = decideSyncPlan({
        localHasData,
        cloudExists: remote.exists,
        localFingerprint,
        cloudFingerprint,
        cloudRevision: remote.revision,
        meta: readStoredMeta(),
        accountId: account.id,
      });
      if (plan === "account-mismatch") {
        setMismatchedAccount(true);
        setPhase("account-mismatch");
        setPanelOpen(true);
        return;
      }
      if (plan === "upload") return void await uploadLocal(remote.revision);
      if (plan === "download") return void await downloadCloud(remote);
      if (plan === "choice" || plan === "conflict") {
        setPhase(plan);
        setPanelOpen(true);
        return;
      }
      const pdfMeta = await inspectLocalPdfs(remote.pdfs, remote.revision);
      if (pdfMeta.needsUpload) return void await uploadLocal(remote.revision);
      const next = makeMeta(account.id, remote.revision, localFingerprint, storedMeta, pdfMeta.hashes, pdfMeta.tokens);
      persistMeta(next);
      setMeta(next);
      setPhase("synced");
      setMessage("この端末とクラウドは同じ内容です。");
    } catch (cause) {
      handleSyncFailure(cause);
    }
  }

  async function uploadLocal(baseRevision: number) {
    if (!account) return;
    setPhase("syncing");
    setProgress("ノートと予定を保存しています");
    try {
      const pdfIds = pdfSessionIds(currentState);
      const entries = await loadAllPdfs();
      const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
      const tokens = pdfTokens(currentState);
      const manifests: PendingUpload["manifests"] = [];
      for (const id of pdfIds) {
        const entry = entriesById.get(id);
        if (!entry) throw new Error(`この端末にPDF本体がありません。再度追加してから同期してください: ${id}`);
        manifests.push({ sessionId: id, size: entry.blob.size, sha256: await hashBlob(entry.blob), noteVersion: tokens[id] ?? "" });
      }
      let pending = pendingUploadRef.current;
      if (!pending || pending.accountId !== account.id || pending.baseRevision !== baseRevision || pending.fingerprint !== localFingerprint) {
        const response = await retryAuthenticatedFetch("/api/sync/state", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ baseRevision, schemaVersion, state: currentState, deviceId: deviceId(), pdfIds, pdfs: manifests }),
        });
        const result = await response.json() as { transactionId?: string; revision?: number; error?: string; conflict?: boolean };
        if (response.status === 409 || result.conflict) return void await showSyncConflict();
        if (!response.ok || typeof result.revision !== "number" || typeof result.transactionId !== "string") throw new Error(result.error ?? "クラウドへ保存できませんでした。");
        pending = { accountId: account.id, baseRevision, targetRevision: result.revision, transactionId: result.transactionId, fingerprint: localFingerprint, manifests };
        pendingUploadRef.current = pending;
      }
      for (let index = 0; index < pending.manifests.length; index += 1) {
        const manifest = pending.manifests[index];
        const entry = entriesById.get(manifest.sessionId);
        if (!entry) throw new Error(`この端末にPDF本体がありません。再度追加してから同期してください: ${manifest.sessionId}`);
        setProgress(`PDFを同期しています ${index + 1}/${pending.manifests.length}`);
        const transfer = { ...manifest, transactionId: pending.transactionId, stateRevision: pending.targetRevision };
        const direct = await uploadPdfDirectly(transfer, entry.blob);
        if (direct.conflict) return void await showSyncConflict();
        if (!direct.used) {
          const response = await retryAuthenticatedFetch(`/api/sync/pdf?sessionId=${encodeURIComponent(manifest.sessionId)}&transactionId=${encodeURIComponent(pending.transactionId)}`, {
            method: "PUT",
            headers: { "content-type": "application/pdf", "x-content-sha256": manifest.sha256, "x-state-revision": String(pending.targetRevision), "x-note-version": encodeURIComponent(manifest.noteVersion) },
            body: entry.blob,
          });
          const result = await response.json().catch(() => ({})) as { error?: string; conflict?: boolean };
          if (response.status === 409 || result.conflict) return void await showSyncConflict();
          if (!response.ok) throw new Error(result.error ?? `PDFを同期できませんでした: ${manifest.sessionId}`);
        }
      }
      const commitResponse = await retryAuthenticatedFetch("/api/sync/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionId: pending.transactionId }),
      });
      const commitResult = await commitResponse.json().catch(() => ({})) as { revision?: number; error?: string; conflict?: boolean };
      if (commitResponse.status === 409 || commitResult.conflict) return void await showSyncConflict();
      if (!commitResponse.ok || commitResult.revision !== pending.targetRevision) throw new Error(commitResult.error ?? "クラウド同期を確定できませんでした。");
      const hashes = Object.fromEntries(pending.manifests.map((item) => [item.sessionId, item.sha256]));
      const next = makeMeta(account.id, pending.targetRevision, localFingerprint, meta, hashes, tokens);
      pendingUploadRef.current = null;
      persistMeta(next);
      setMeta(next);
      setPhase("synced");
      setProgress("");
      setMessage("この端末の変更をクラウドへ保存しました。");
    } catch (cause) {
      handleSyncFailure(cause);
    }
  }

  async function inspectLocalPdfs(remotePdfs: CloudPdf[], stateRevision: number) {
    const entries = await loadAllPdfs();
    const remoteById = new Map(remotePdfs.map((item) => [item.sessionId, item]));
    const tokens = pdfTokens(currentState);
    const hashes: Record<string, string> = {};
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    const ids = pdfSessionIds(currentState);
    let needsUpload = false;
    for (const id of ids) {
      const remote = remoteById.get(id);
      const entry = entriesById.get(id);
      if (!entry && remote && remote.noteVersion === tokens[id]) continue;
      if (!entry) throw new Error(`この端末にPDF本体がありません。再度追加してから同期してください: ${id}`);
      const sha256 = await hashBlob(entry.blob);
      hashes[id] = sha256;
      if (!remote || remote.sha256 !== sha256 || remote.size !== entry.blob.size || remote.noteVersion !== tokens[id] || remote.stateRevision !== stateRevision) {
        needsUpload = true;
      }
    }
    return { hashes, tokens, needsUpload };
  }

  async function downloadCloud(remote = cloud) {
    if (!account || !remote?.exists || !remote.state) return;
    if ((remote.schemaVersion ?? 1) > schemaVersion) {
      setPhase("error");
      setMessage("クラウドデータが新しい形式です。アプリを更新してから同期してください。");
      return;
    }
    setPhase("syncing");
    setProgress("クラウドの内容を確認しています");
    try {
      const pdfs: Array<{ id: string; blob: Blob }> = [];
      const hashes: Record<string, string> = {};
      const expectedVersions = pdfVersionsFromState(remote.state);
      for (let index = 0; index < remote.pdfs.length; index += 1) {
        const item = remote.pdfs[index];
        if (!expectedVersions[item.sessionId] || expectedVersions[item.sessionId] !== item.noteVersion) {
          throw new Error(`ノートの更新版に対応するPDFを確認できませんでした: ${item.sessionId}`);
        }
        setProgress(`PDFを受け取っています ${index + 1}/${remote.pdfs.length}`);
        const directBlob = await downloadPdfDirectly(item);
        let blob: Blob;
        if (directBlob) {
          blob = directBlob;
        } else {
          const response = await authenticatedFetch(`/api/sync/pdf?sessionId=${encodeURIComponent(item.sessionId)}`, { cache: "no-store" });
          if (!response.ok) throw new Error(`PDFを受け取れませんでした: ${item.sessionId}`);
          blob = await response.blob();
        }
        const sha256 = await hashBlob(blob);
        if (sha256 !== item.sha256) throw new Error(`PDFの整合性を確認できませんでした: ${item.sessionId}`);
        pdfs.push({ id: item.sessionId, blob });
        hashes[item.sessionId] = sha256;
      }
      await onApplyCloud(remote.state, pdfs);
      const fingerprint = fingerprintState(remote.state);
      const next = makeMeta(account.id, remote.revision, fingerprint, meta, hashes, pdfTokens(remote.state));
      persistMeta(next);
      setMeta(next);
      setPhase("synced");
      setProgress("");
      setMessage("クラウドの内容をこの端末へ反映しました。");
    } catch (cause) {
      handleSyncFailure(cause);
    }
  }

  function acceptRemoteDeletion() {
    if (!account) return;
    const next = { ...makeMeta(account.id, cloud?.revision ?? 0, localFingerprint, meta), enabled: false };
    persistMeta(next);
    setMeta(next);
    setPhase("idle");
    setMessage("この端末のデータを残したまま、クラウド同期を停止しました。");
  }

  async function enableSync() {
    if (!account || mismatchedAccount) return;
    const next = makeMeta(account.id, 0, "", meta);
    persistMeta(next);
    setMeta(next);
    await reconcile();
  }

  function clearPreviousAccountBinding() {
    if (!account || !window.confirm("この端末に残っている以前のアカウントとの同期情報だけを解除します。端末内のノートは削除しません。続けますか？")) return;
    window.localStorage.removeItem(META_KEY);
    setMismatchedAccount(false);
    setMeta(null);
    setPhase("idle");
    setMessage("以前のアカウントとの同期情報を解除しました。内容を確認してから同期を開始できます。");
  }

  function stopSync() {
    if (!account) return;
    const next = { ...makeMeta(account.id, meta?.revision ?? 0, meta?.fingerprint ?? "", meta), enabled: false };
    persistMeta(next);
    setMeta(next);
    setPhase("idle");
    setMessage("自動同期を停止しました。端末内のデータは残っています。");
  }

  async function deleteCloud() {
    if (!window.confirm("クラウド上のノート・予定・PDFを削除します。この端末のデータは残ります。よろしいですか？")) return;
    setPhase("syncing");
    try {
      const response = await authenticatedFetch("/api/sync/state", { method: "DELETE" });
      if (!response.ok) throw new Error("クラウドデータを削除できませんでした。");
      window.localStorage.removeItem(META_KEY);
      setMeta(null);
      setCloud(null);
      setPhase("idle");
      setMessage("クラウド上のデータを削除しました。端末内の内容はそのままです。");
    } catch (cause) {
      handleSyncFailure(cause);
    }
  }

  async function submitFirebaseAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authEmail.trim() || authPassword.length < 8) {
      setAuthMessage("メールアドレスと8文字以上のパスワードを入力してください。");
      return;
    }
    setAuthBusy(true);
    setAuthMessage("");
    try {
      if (authMode === "signup") {
        await signUpWithEmail(authEmail.trim(), authPassword);
        setAuthMessage("確認メールを送りました。メール内のリンクを開いたあと、ログインしてください。");
        setAuthMode("signin");
      } else {
        await signInWithEmail(authEmail.trim(), authPassword);
        setAuthMessage("ログインしました。");
      }
      setAuthPassword("");
    } catch (cause) {
      setAuthMessage(readableAuthError(cause));
    } finally {
      setAuthBusy(false);
    }
  }

  async function googleSignIn() {
    setAuthBusy(true);
    setAuthMessage("");
    try {
      await signInWithGoogle();
    } catch (cause) {
      setAuthMessage(readableAuthError(cause));
    } finally {
      setAuthBusy(false);
    }
  }

  async function resetPassword() {
    if (!authEmail.trim()) {
      setAuthMessage("先にメールアドレスを入力してください。");
      return;
    }
    setAuthBusy(true);
    try {
      await resetFirebasePassword(authEmail.trim());
      setAuthMessage("パスワード再設定メールを送りました。");
    } catch (cause) {
      setAuthMessage(readableAuthError(cause));
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    if (!firebaseEnabled) return;
    await signOutFirebase();
    setAccount(null);
    setMeta(null);
    setCloud(null);
    setPhase("idle");
    onCampusEntitlement(false);
  }

  async function linkLegacyAccount() {
    setAuthBusy(true);
    setAuthMessage("");
    try {
      const response = await authenticatedFetch("/api/account/link-chatgpt", { method: "POST" });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "旧アカウントを連携できませんでした。");
      window.location.reload();
    } catch (cause) {
      setAuthMessage(readableAuthError(cause));
    } finally {
      setAuthBusy(false);
    }
  }

  function handleSyncFailure(cause: unknown) {
    const offline = !navigator.onLine || cause instanceof TypeError;
    setPhase(offline ? "offline" : "error");
    setProgress("");
    setMessage(offline ? "オフラインです。変更は端末に保存され、接続が戻ると再同期します。" : cause instanceof Error ? cause.message : "同期を完了できませんでした。");
  }

  async function showSyncConflict() {
    pendingUploadRef.current = null;
    const latest = await fetchCloud();
    setCloud(latest);
    setPhase("conflict");
    setPanelOpen(true);
  }

  const label = account === undefined ? "アカウント確認中" : !account ? "ログイン・同期" : phase === "synced" ? "クラウド同期済み" : phase === "offline" ? "オフライン" : meta?.enabled ? "同期を確認" : "アカウント・同期";
  const statusIcon = phase === "syncing" || phase === "checking" ? <LoaderCircle className="spin" size={18} /> : phase === "synced" ? <Check size={18} /> : phase === "offline" ? <CloudOff size={18} /> : <Cloud size={18} />;

  return <>
    <button className={`account-sync-launcher ${phase}`} type="button" onClick={() => setPanelOpen(true)}>
      {statusIcon}<span><strong>{label}</strong><small>{account ? account.email : "同じアカウントで端末間共有"}</small></span>
    </button>
    {panelOpen && <div className="modal-backdrop account-sync-backdrop" role="presentation" onMouseDown={() => setPanelOpen(false)}>
      <section className="account-sync-panel" role="dialog" aria-modal="true" aria-labelledby="account-sync-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p className="eyebrow">ACCOUNT & SYNC BETA</p><h2 id="account-sync-title">アカウントとクラウド同期</h2></div><button type="button" onClick={() => setPanelOpen(false)} aria-label="閉じる"><X size={19} /></button></header>
        {account === undefined || firebaseEnabled === null ? <div className="account-sync-loading"><LoaderCircle className="spin" size={24} /> ログイン状態を確認しています</div> : !account && firebaseEnabled ? <div className="account-signin-card firebase-signin-card">
          <span><UserRound size={24} /></span><h3>同じ学習環境を、PCとスマートフォンで</h3><p>まなびメモのアカウントで、時間割、講義ノート、付箋、Campus Musterの予定、PDFを端末間で同期できます。ログインだけでは同期を開始しません。</p>
          <button className="account-google" type="button" onClick={() => void googleSignIn()} disabled={authBusy}><LogIn size={18} /> Googleで続ける</button>
          <div className="account-auth-divider"><span>または</span></div>
          <div className="account-auth-tabs" role="tablist" aria-label="アカウント操作"><button type="button" role="tab" aria-selected={authMode === "signin"} onClick={() => { setAuthMode("signin"); setAuthMessage(""); }}>ログイン</button><button type="button" role="tab" aria-selected={authMode === "signup"} onClick={() => { setAuthMode("signup"); setAuthMessage(""); }}>新規登録</button></div>
          <form className="account-auth-form" onSubmit={submitFirebaseAuth}>
            <label><span>メールアドレス</span><input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} autoComplete="email" required /></label>
            <label><span>パスワード</span><input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} autoComplete={authMode === "signup" ? "new-password" : "current-password"} minLength={8} required /></label>
            <button className="account-primary full" type="submit" disabled={authBusy}>{authBusy ? "確認中…" : authMode === "signup" ? "確認メールを送る" : "ログイン"}</button>
          </form>
          {authMode === "signin" && <button className="account-text-button" type="button" onClick={() => void resetPassword()} disabled={authBusy}>パスワードを忘れた場合</button>}
          {authMessage && <p className="account-auth-message" role="status">{authMessage}</p>}
        </div> : !account ? <div className="account-signin-card">
          <span><UserRound size={24} /></span><h3>アカウント機能は未設定です</h3><p>Firebaseの公開設定値を.env.localへ追加すると、Googleまたはメールアドレスでログインできます。端末内のノート・PDF・Campus Musterは設定前も利用できます。</p>
        </div> : <>
          <div className="account-profile"><span><UserRound size={20} /></span><div><strong>{account.displayName}</strong><small>{account.email}</small></div>{firebaseEnabled ? <button type="button" onClick={() => void logout()}>ログアウト</button> : <a href="/signout-with-chatgpt?return_to=%2F">ログアウト</a>}</div>
          {firebaseEnabled && legacyLinkAvailable && <div className="legacy-account-link"><strong>以前のChatGPT同期データがある場合</strong><p>メールアドレスだけでは自動統合しません。旧アカウントでも本人確認したあと、明示的に連携します。</p><button type="button" onClick={() => void linkLegacyAccount()} disabled={authBusy}>確認済みの旧アカウントを連携</button>{authMessage && <p className="account-auth-message" role="status">{authMessage}</p>}</div>}
          <div className={`account-sync-status ${phase}`} role={phase === "error" ? "alert" : "status"} aria-live="polite">{statusIcon}<div><strong>{phaseTitle(phase, meta?.enabled ?? false)}</strong><p>{progress || message || phaseDescription(phase)}</p></div></div>
          {phase === "account-mismatch" && <div className="sync-choice" role="alert"><AlertTriangle size={21} /><div><h3>別のアカウントの同期情報が残っています</h3><p>取り違えを防ぐため、自動同期は止めています。以前のアカウントへ戻るか、端末内の内容を確認してから同期情報だけを解除してください。</p></div><button type="button" className="secondary" onClick={clearPreviousAccountBinding}>以前のアカウントとの同期情報を解除</button></div>}
          {(phase === "choice" || phase === "conflict") && <div className="sync-choice" role="alert"><AlertTriangle size={21} /><div><h3>{cloud?.deleted ? "別の端末でクラウドデータが削除されています" : phase === "choice" ? "最初に残す内容を選んでください" : "この端末とクラウドの両方に変更があります"}</h3><p>{cloud?.deleted ? "この端末の内容は残しています。同期を再開するか、この端末では同期を停止するか選んでください。" : "自動では上書きしません。どちらかを選ぶまで、端末内の内容は変更されません。"}</p></div>{!cloud?.deleted && <div className="sync-compare"><SyncSummary label="この端末" state={currentState} pdfCount={pdfSessionIds(currentState).length} /><SyncSummary label="クラウド" state={cloud?.state} pdfCount={cloud?.pdfs.length ?? 0} /></div>}<button type="button" onClick={() => void uploadLocal(cloud?.revision ?? 0)}>この端末の内容をクラウドへ保存</button><button type="button" className="secondary" onClick={() => cloud?.deleted ? acceptRemoteDeletion() : void downloadCloud()}>{cloud?.deleted ? "この端末では同期を停止" : "クラウドの内容をこの端末へ反映"}</button></div>}
          {!meta?.enabled && phase !== "choice" && phase !== "conflict" && phase !== "account-mismatch" && <button type="button" className="account-primary full" onClick={() => void enableSync()}><Cloud size={18} /> クラウド同期を始める</button>}
          {meta?.enabled && phase !== "choice" && phase !== "conflict" && <div className="account-sync-actions"><button type="button" onClick={() => void reconcile()} disabled={phase === "syncing" || phase === "checking"}><RefreshCw size={17} /> 今すぐ同期</button><button type="button" onClick={stopSync}>自動同期を停止</button></div>}
          <div className="account-sync-scope"><h3>同期する内容</h3><p>時間割・講義・授業回・ノート本文・付箋・タグ・Campus Musterの提出物、試験、出席、学習タスク、GPA計画、卒業要件・PDF</p><small>同じアカウントのPCとスマートフォンで共有され、別アカウントのデータとは分離されます。</small></div>
          {meta?.enabled && <button type="button" className="account-delete-cloud" onClick={() => void deleteCloud()}><Trash2 size={16} /> クラウド上の学習データを削除</button>}
        </>}
      </section>
    </div>}
  </>;
}

function SyncSummary({ label, state, pdfCount }: { label: string; state: unknown; pdfCount: number }) {
  const summary = stateSummary(state);
  return <section><strong>{label}</strong><dl><div><dt>講義</dt><dd>{summary.courses}</dd></div><div><dt>授業回</dt><dd>{summary.sessions}</dd></div><div><dt>付箋</dt><dd>{summary.memos}</dd></div><div><dt>提出物・試験</dt><dd>{summary.campus}</dd></div><div><dt>PDF</dt><dd>{pdfCount}</dd></div></dl></section>;
}

function stateSummary(value: unknown) {
  if (!value || typeof value !== "object") return { courses: 0, sessions: 0, memos: 0, campus: 0 };
  const state = value as Record<string, unknown>;
  const campus = state.campus && typeof state.campus === "object" ? state.campus as Record<string, unknown> : {};
  return {
    courses: Array.isArray(state.courses) ? state.courses.length : 0,
    sessions: Array.isArray(state.sessions) ? state.sessions.length : 0,
    memos: Array.isArray(state.memos) ? state.memos.length : 0,
    campus: (Array.isArray(campus.assignments) ? campus.assignments.length : 0) + (Array.isArray(campus.exams) ? campus.exams.length : 0),
  };
}

function phaseTitle(phase: SyncPhase, enabled: boolean) {
  if (phase === "checking") return "クラウドの更新を確認中";
  if (phase === "syncing") return "同期しています";
  if (phase === "synced") return "クラウドと同期済み";
  if (phase === "offline") return "オフラインで利用中";
  if (phase === "choice") return "初回同期の確認が必要です";
  if (phase === "conflict") return "内容の選択が必要です";
  if (phase === "account-mismatch") return "アカウントを確認してください";
  if (phase === "error") return "同期を完了できませんでした";
  return enabled ? "同期の準備ができています" : "クラウド同期はまだ始まっていません";
}

function phaseDescription(phase: SyncPhase) {
  if (phase === "synced") return "時間割・ノート・Campus Muster・PDFを同じアカウントで共有します。";
  if (phase === "offline") return "端末内への保存を続けています。";
  return "同期を始めても、端末内のデータはオフライン用として残ります。";
}

function makeMeta(accountId: string, revision: number, fingerprint: string, previous: LocalSyncMeta | null, pdfHashes = previous?.pdfHashes ?? {}, tokens = previous?.pdfTokens ?? {}): LocalSyncMeta {
  return { accountId, enabled: true, revision, fingerprint, pdfHashes, pdfTokens: tokens };
}

function readMeta(accountId: string): LocalSyncMeta | null {
  const value = readStoredMeta();
  return value?.accountId === accountId ? value : null;
}

function readStoredMeta(): LocalSyncMeta | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(META_KEY) ?? "null") as Partial<LocalSyncMeta> | null;
    if (!value || typeof value.accountId !== "string" || typeof value.revision !== "number") return null;
    return { accountId: value.accountId, enabled: value.enabled === true, revision: value.revision, fingerprint: typeof value.fingerprint === "string" ? value.fingerprint : "", pdfHashes: value.pdfHashes ?? {}, pdfTokens: value.pdfTokens ?? {} };
  } catch { return null; }
}

function persistMeta(value: LocalSyncMeta) {
  window.localStorage.setItem(META_KEY, JSON.stringify(value));
}

function deviceId() {
  const existing = window.localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const value = `device-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  window.localStorage.setItem(DEVICE_KEY, value);
  return value;
}

function pdfSessionIds(state: object) {
  const sessions = "sessions" in state && Array.isArray(state.sessions) ? state.sessions : [];
  return sessions.flatMap((item) => item && typeof item === "object" && "id" in item && "hasPdf" in item && item.hasPdf === true && typeof item.id === "string" ? [item.id] : []);
}

function pdfTokens(state: unknown) {
  return pdfVersionsFromState(state);
}

async function hashBlob(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type DirectUploadInput = {
  transactionId: string;
  sessionId: string;
  size: number;
  sha256: string;
  stateRevision: number;
  noteVersion: string;
};

async function uploadPdfDirectly(input: DirectUploadInput, blob: Blob) {
  const prepareResponse = await retryAuthenticatedFetch("/api/sync/pdf/transfer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "prepare-upload", ...input }),
  });
  const prepared = await prepareResponse.json().catch(() => ({})) as {
    direct?: boolean;
    uploadUrl?: string;
    error?: string;
    conflict?: boolean;
  };
  if (prepareResponse.status === 409 || prepared.conflict) return { used: true, conflict: true };
  if (!prepareResponse.ok) throw new Error(prepared.error ?? `PDFを同期できませんでした: ${input.sessionId}`);
  if (!prepared.direct) return { used: false, conflict: false };
  if (!prepared.uploadUrl) throw new Error("PDFの安全なアップロード先を確認できませんでした。");

  const uploadResponse = await retryTransient(() => fetch(prepared.uploadUrl!, {
    method: "PUT",
    headers: { "content-type": "application/pdf" },
    body: blob,
    cache: "no-store",
  }), { maxAttempts: 3, delay: retryDelay });

  const completeResponse = await retryAuthenticatedFetch("/api/sync/pdf/transfer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "complete-upload", ...input }),
  });
  const completed = await completeResponse.json().catch(() => ({})) as { ok?: boolean; error?: string; conflict?: boolean };
  if (completed.conflict) return { used: true, conflict: true };
  if (!completeResponse.ok || !completed.ok) {
    const uploadMessage = uploadResponse.ok ? "" : `（ストレージ応答: ${uploadResponse.status}）`;
    throw new Error(completed.error ?? `PDFのアップロードを確定できませんでした。${uploadMessage}`);
  }
  return { used: true, conflict: false };
}

async function downloadPdfDirectly(item: CloudPdf) {
  const prepareResponse = await retryAuthenticatedFetch("/api/sync/pdf/transfer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "prepare-download", sessionId: item.sessionId }),
  });
  const prepared = await prepareResponse.json().catch(() => ({})) as {
    direct?: boolean;
    downloadUrl?: string;
    size?: number;
    sha256?: string;
    stateRevision?: number;
    noteVersion?: string;
    error?: string;
  };
  if (!prepareResponse.ok) throw new Error(prepared.error ?? `PDFを受け取れませんでした: ${item.sessionId}`);
  if (!prepared.direct) return null;
  if (
    !prepared.downloadUrl
    || prepared.size !== item.size
    || prepared.sha256 !== item.sha256
    || prepared.stateRevision !== item.stateRevision
    || prepared.noteVersion !== item.noteVersion
  ) throw new Error(`PDFの転送情報がクラウド状態と一致しませんでした: ${item.sessionId}`);
  const response = await retryTransient(() => fetch(prepared.downloadUrl!, { cache: "no-store" }), {
    maxAttempts: 3,
    delay: retryDelay,
  });
  if (!response.ok) throw new Error(`PDFを受け取れませんでした: ${item.sessionId}`);
  const blob = await response.blob();
  if (blob.size !== item.size) throw new Error(`PDFのサイズを確認できませんでした: ${item.sessionId}`);
  return blob;
}

async function retryDelay(attempt: number) {
  await new Promise((resolve) => window.setTimeout(resolve, 150 * (attempt + 1)));
}

async function retryAuthenticatedFetch(input: RequestInfo | URL, init: RequestInit, attempts = 3) {
  return retryTransient(() => authenticatedFetch(input, init), {
    maxAttempts: attempts,
    delay: retryDelay,
  });
}

function readableAuthError(cause: unknown) {
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) return "ログイン画面が閉じられました。";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "メールアドレスまたはパスワードを確認してください。";
  if (code.includes("email-already-in-use")) return "このメールアドレスはすでに登録されています。";
  if (code.includes("invalid-email")) return "メールアドレスの形式を確認してください。";
  if (code.includes("weak-password")) return "もう少し長く、推測されにくいパスワードを設定してください。";
  if (code.includes("too-many-requests")) return "短時間に確認が集中しました。少し時間を置いてからお試しください。";
  if (code.includes("network-request-failed")) return "通信を確認して、もう一度お試しください。";
  return cause instanceof Error ? cause.message : "アカウント操作を完了できませんでした。";
}
