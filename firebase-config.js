import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/**
 * Parse .env format string into key-value pairs (fallback)
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
 * Loads configuration from env.js or .env and initializes Firebase & Firestore
 * @returns {Promise<{ app: any, db: any, config: any, adminAuth: { email: string, password: string } }>}
 */
export async function initFirebaseFromEnv() {
  let env = null;

  // 1. Primary method: Load from env.js (browser-friendly ES module, bypasses server dotfile restrictions)
  try {
    const envModule = await import("./env.js");
    if (envModule && envModule.ENV) {
      env = envModule.ENV;
    }
  } catch (err) {
    // env.js not present or failed to load, proceed to fallback
  }

  // 2. Fallback method: Fetch .env (works if server permits dotfile requests)
  if (!env && window.location.protocol !== "file:") {
    try {
      const response = await fetch(".env");
      if (response.ok) {
        const envContent = await response.text();
        env = parseEnv(envContent);
      }
    } catch (err) {
      // fetch blocked or failed
    }
  }

  if (!env) {
    throw new Error(
      "Configuration not found. Please ensure 'env.js' exists in your root folder (see env.example.js)."
    );
  }

  const firebaseConfig = {
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    projectId: env.FIREBASE_PROJECT_ID,
    storageBucket: env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
    appId: env.FIREBASE_APP_ID,
    measurementId: env.FIREBASE_MEASUREMENT_ID,
  };

  const adminAuth = {
    email: env.ADMIN_EMAIL || "",
    password: env.ADMIN_PASSWORD || "",
  };

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error(
      "Invalid configuration: FIREBASE_API_KEY and FIREBASE_PROJECT_ID are required in env.js."
    );
  }

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  return { app, db, config: firebaseConfig, adminAuth };
}
