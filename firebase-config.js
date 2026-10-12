import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

/**
 * Parse .env format string into key-value pairs
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
 * Loads configuration from .env and initializes Firebase & Firestore
 * @returns {Promise<{ app: any, db: any, config: any }>}
 */
export async function initFirebaseFromEnv() {
  // If window.location.protocol is file:, warn user about local file restrictions
  if (window.location.protocol === "file:") {
    throw new Error(
      "Browsers block loading .env via file:// URL. Please serve the project via a local web server (e.g. VS Code Live Server or 'npx serve')."
    );
  }

  const response = await fetch(".env");
  if (!response.ok) {
    throw new Error(
      `Unable to load .env file (HTTP ${response.status}). Ensure a valid .env file exists in the root directory.`
    );
  }

  const envContent = await response.text();
  const env = parseEnv(envContent);

  const firebaseConfig = {
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    projectId: env.FIREBASE_PROJECT_ID,
    storageBucket: env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
    appId: env.FIREBASE_APP_ID,
    measurementId: env.FIREBASE_MEASUREMENT_ID,
  };

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error(
      "Invalid .env configuration: FIREBASE_API_KEY and FIREBASE_PROJECT_ID are required."
    );
  }

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  return { app, db, config: firebaseConfig };
}
