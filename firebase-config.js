import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/**
 * Built-in Production Fallback Configuration
 * Ensures immediate connectivity on any online deployment (Vercel, Netlify, GitHub Pages, Firebase Hosting)
 * even when .env and env.js are not served or blocked by server dotfile rules.
 */
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyB0x_WECfo3QpRFIetsMwZ9jzM0tcljg48",
  authDomain: "promptathon-hp.firebaseapp.com",
  projectId: "promptathon-hp",
  storageBucket: "promptathon-hp.firebasestorage.app",
  messagingSenderId: "195648128484",
  appId: "1:195648128484:web:67d0350a3ee6580fec33f1",
  measurementId: "G-2H65NM8043",
};

/**
 * Parse .env format string into key-value pairs (local dev fallback)
 * @param {string} text 
 * @returns {Record<string, string>}
 */
function parseEnv(text) {
  const env = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      env[key] = val;
    }
  });
  return env;
}

/**
 * Loads configuration and initializes Firebase & Firestore
 * Gracefully prioritizes: env.js -> local .env -> DEFAULT_FIREBASE_CONFIG (online deployment)
 * @returns {Promise<{ app: any, db: any, config: any, adminAuth: { email: string, password: string } }>}
 */
export async function initFirebaseFromEnv() {
  let env = null;

  // 1. Check for custom env.js if provided
  try {
    const envModule = await import("./env.js");
    if (envModule && envModule.ENV) {
      env = envModule.ENV;
    }
  } catch (err) {
    // env.js not present or ignored in git, proceed to fallbacks
  }

  // 2. Check for local .env ONLY on localhost (avoids 404 console noise in online production)
  const isLocalhost = 
    window.location.hostname === "localhost" || 
    window.location.hostname === "127.0.0.1" ||
    window.location.protocol === "file:";

  if (!env && isLocalhost && window.location.protocol !== "file:") {
    try {
      const response = await fetch(".env");
      if (response.ok) {
        const envContent = await response.text();
        env = parseEnv(envContent);
      }
    } catch (err) {
      // Local fetch failed, fallback to DEFAULT_FIREBASE_CONFIG
    }
  }

  // 3. Fallback to production default config (ensures 100% online deployment uptime)
  const firebaseConfig = {
    apiKey: env?.FIREBASE_API_KEY || DEFAULT_FIREBASE_CONFIG.apiKey,
    authDomain: env?.FIREBASE_AUTH_DOMAIN || DEFAULT_FIREBASE_CONFIG.authDomain,
    projectId: env?.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_CONFIG.projectId,
    storageBucket: env?.FIREBASE_STORAGE_BUCKET || DEFAULT_FIREBASE_CONFIG.storageBucket,
    messagingSenderId: env?.FIREBASE_MESSAGING_SENDER_ID || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
    appId: env?.FIREBASE_APP_ID || DEFAULT_FIREBASE_CONFIG.appId,
    measurementId: env?.FIREBASE_MEASUREMENT_ID || DEFAULT_FIREBASE_CONFIG.measurementId,
  };

  const adminAuth = (env?.ADMIN_EMAIL && env?.ADMIN_PASSWORD) ? {
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
  } : null;

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  return { app, db, config: firebaseConfig, adminAuth };
}
