"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { loadPublicAuthConfig } from "./firebase-config-client";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";

let authPromise: Promise<Auth | null> | null = null;

export async function firebaseAuth(): Promise<Auth | null> {
  if (!authPromise) {
    // Cache intentional "disabled" or successful auth, but never cache transient failures.
    authPromise = (async () => {
      const result = await loadPublicAuthConfig();
      if (!result.enabled || !result.config) return null;
      const app = getApps().length ? getApp() : initializeApp(result.config);
      const auth = getAuth(app);
      auth.languageCode = "ja";
      await setPersistence(auth, browserLocalPersistence);
      return auth;
    })().catch(cause => {
      authPromise = null;
      throw cause;
    });
  }
  return authPromise;
}

export async function observeFirebaseUser(callback: (user: User | null, enabled: boolean) => void) {
  const auth = await firebaseAuth();
  if (!auth) {
    callback(null, false);
    return () => undefined;
  }
  return onAuthStateChanged(auth, (user) => callback(user, true));
}

export async function firebaseIdToken(forceRefresh = false) {
  const auth = await firebaseAuth();
  return auth?.currentUser ? auth.currentUser.getIdToken(forceRefresh) : null;
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = await firebaseIdToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export async function signInWithEmail(email: string, password: string) {
  const auth = await requiredAuth();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  if (!credential.user.emailVerified) {
    await sendEmailVerification(credential.user);
    await signOut(auth);
    throw new Error("確認メールを再送しました。メール内のリンクを開いてからログインしてください。");
  }
  return credential.user;
}

export async function signUpWithEmail(email: string, password: string) {
  const auth = await requiredAuth();
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(credential.user);
  await signOut(auth);
}

export async function signInWithGoogle() {
  const auth = await requiredAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return (await signInWithPopup(auth, provider)).user;
}

export async function resetFirebasePassword(email: string) {
  const auth = await requiredAuth();
  await sendPasswordResetEmail(auth, email);
}

export async function signOutFirebase() {
  const auth = await requiredAuth();
  await signOut(auth);
}

async function requiredAuth() {
  const auth = await firebaseAuth();
  if (!auth) throw new Error("アカウント機能は現在設定中です。");
  return auth;
}
