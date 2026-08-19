import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { env } from "./env.js";
const credential =
  env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY
    ? cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      })
    : applicationDefault();

const app =
  getApps()[0] ??
  initializeApp({
    credential,
    projectId: env.FIREBASE_PROJECT_ID,
    ...(env.FIREBASE_STORAGE_BUCKET
      ? { storageBucket: env.FIREBASE_STORAGE_BUCKET }
      : {}),
  });
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
