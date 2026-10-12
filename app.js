// Firebase JS SDK Modular Imports
import { 
  collection, 
  addDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { initFirebaseFromEnv } from "./firebase-config.js";

// Initialize Firebase & Firestore from .env
let db = null;
initFirebaseFromEnv()
  .then(({ db: firestoreDb, config }) => {
    db = firestoreDb;
    console.log("Firebase initialized successfully with project:", config.projectId);
  })
  .catch((err) => {
    console.error("Firebase initialization failed:", err);
    showError(err.message || "Failed to initialize Firebase from .env configuration.");
  });

// DOM Elements
const registrationForm = document.getElementById("registration-form");
const teamNumberInput = document.getElementById("team-number");
const teamNameInput = document.getElementById("team-name");
const submitBtn = document.getElementById("submit-btn");
const btnLoader = document.getElementById("btn-loader");
const errorBanner = document.getElementById("form-error-banner");
const errorMessageText = document.getElementById("error-message-text");

const registrationCard = document.getElementById("registration-card");
const successCard = document.getElementById("success-card");
const displayTeamNumber = document.getElementById("display-team-number");
const displayTeamName = document.getElementById("display-team-name");
const displayTimestamp = document.getElementById("display-timestamp");
const displayDocId = document.getElementById("display-doc-id");
const registerAnotherBtn = document.getElementById("register-another-btn");
const toastContainer = document.getElementById("toast-container");

// Helper: Toast Notifications
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  toastContainer.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  // Auto remove after 4 seconds
  setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove());
  }, 4000);
}

// Helper: Show/Hide Error Banner
function showError(message) {
  errorMessageText.textContent = message;
  errorBanner.classList.remove("hidden");
}

function clearError() {
  errorBanner.classList.add("hidden");
  errorMessageText.textContent = "";
}

// Set Loading State
function setLoading(isLoading) {
  if (isLoading) {
    submitBtn.disabled = true;
    btnLoader.classList.remove("hidden");
    submitBtn.querySelector(".btn-text").textContent = "Registering...";
    submitBtn.querySelector(".btn-arrow").classList.add("hidden");
  } else {
    submitBtn.disabled = false;
    btnLoader.classList.add("hidden");
    submitBtn.querySelector(".btn-text").textContent = "Register Team";
    submitBtn.querySelector(".btn-arrow").classList.remove("hidden");
  }
}

// Trigger Confetti Celebration
function triggerConfetti() {
  if (typeof confetti === "function") {
    // Left burst
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { x: 0.2, y: 0.6 }
    });
    // Right burst
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { x: 0.8, y: 0.6 }
    });
  }
}

// Handle Form Submission
registrationForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const teamNumberVal = teamNumberInput.value.trim();
  const teamNameVal = teamNameInput.value.trim();

  // Client-side Validation
  if (!teamNumberVal || isNaN(teamNumberVal) || Number(teamNumberVal) <= 0) {
    showError("Please enter a valid Team Number (positive number).");
    teamNumberInput.focus();
    return;
  }

  if (!teamNameVal) {
    showError("Please enter your Team Name.");
    teamNameInput.focus();
    return;
  }

  if (teamNameVal.length > 50) {
    showError("Team Name cannot exceed 50 characters.");
    teamNameInput.focus();
    return;
  }

  if (!db) {
    showError("Firebase is not initialized. Check console for details.");
    return;
  }

  setLoading(true);

  try {
    const registrationData = {
      teamNumber: Number(teamNumberVal),
      teamName: teamNameVal,
      createdAt: serverTimestamp(),
      registeredAtFormatted: new Date().toLocaleString()
    };

    // Store in Firestore collection 'registrations'
    const docRef = await addDoc(collection(db, "registrations"), registrationData);
    console.log("Registration saved to Firestore with ID:", docRef.id);

    // Update Confirmation Pass View
    displayTeamNumber.textContent = `#${teamNumberVal}`;
    displayTeamName.textContent = teamNameVal;
    displayTimestamp.textContent = `Registered: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    displayDocId.textContent = `REF: ${docRef.id.slice(0, 10).toUpperCase()}`;

    // Switch views
    registrationCard.classList.add("hidden");
    successCard.classList.remove("hidden");

    // Success notifications & confetti
    showToast(`Team #${teamNumberVal} registered successfully!`, "success");
    triggerConfetti();

    // Reset form
    registrationForm.reset();
  } catch (error) {
    console.error("Firestore submission error:", error);
    let friendlyMessage = "Failed to submit registration. ";

    if (error.code === "permission-denied") {
      friendlyMessage += "Firestore Security Rules currently reject writes. Please update Firestore rules to allow writes.";
    } else if (error.message) {
      friendlyMessage += error.message;
    } else {
      friendlyMessage += "Please check your network and try again.";
    }

    showError(friendlyMessage);
    showToast("Registration failed. See error on screen.", "error");
  } finally {
    setLoading(false);
  }
});

// Register Another Team Button
registerAnotherBtn.addEventListener("click", () => {
  successCard.classList.add("hidden");
  registrationCard.classList.remove("hidden");
  clearError();
  teamNumberInput.focus();
});

// Clear error on user typing
teamNumberInput.addEventListener("input", clearError);
teamNameInput.addEventListener("input", clearError);
