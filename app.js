// Firebase Modular SDK imports
import { 
  doc, 
  getDoc, 
  updateDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { initFirebaseFromEnv } from "./firebase-config.js";
import { PRE_REGISTERED_TEAMS } from "./teams-data.js";

// State
let db = null;
let currentTeam = null;

// Initialize Firebase from env
initFirebaseFromEnv()
  .then(({ db: firestoreDb, config }) => {
    db = firestoreDb;
    console.log("Firebase connected successfully in Team Portal:", config.projectId);
  })
  .catch((err) => {
    console.warn("Firebase initialization warning (local roster verification active):", err.message);
  });

// DOM Elements - Login
const loginContainer = document.getElementById("login-container");
const teamLoginForm = document.getElementById("team-login-form");
const teamIdInput = document.getElementById("team-id-input");
const teamPasswordInput = document.getElementById("team-password-input");
const togglePinBtn = document.getElementById("toggle-pin-btn");
const loginErrorBanner = document.getElementById("login-error-banner");
const loginErrorText = document.getElementById("login-error-text");
const loginSubmitBtn = document.getElementById("login-submit-btn");
const loginBtnLoader = document.getElementById("login-btn-loader");

// DOM Elements - Workspace
const teamWorkspace = document.getElementById("team-workspace");
const workspaceTeamBadge = document.getElementById("workspace-team-badge");
const workspaceTeamName = document.getElementById("workspace-team-name");
const passTeamId = document.getElementById("pass-team-id");
const passOriginalId = document.getElementById("pass-original-id");
const passLeaderName = document.getElementById("pass-leader-name");
const passParticipants = document.getElementById("pass-participants");
const teamLogoutBtn = document.getElementById("team-logout-btn");

// DOM Elements - Submission
const challengeForm = document.getElementById("challenge-submission-form");
const subTitleInput = document.getElementById("sub-title");
const subPromptInput = document.getElementById("sub-prompt");
const subLinkInput = document.getElementById("sub-link");
const submitChallengeBtn = document.getElementById("submit-challenge-btn");
const subLoader = document.getElementById("sub-loader");
const challengeBtnText = document.getElementById("challenge-btn-text");
const submissionReceipt = document.getElementById("submission-receipt");
const receiptTimestamp = document.getElementById("receipt-timestamp");
const toastContainer = document.getElementById("toast-container");

// Helper: Toast Notifications
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove());
  }, 4000);
}

// Helper: Show & Clear Login Errors
function showLoginError(msg) {
  loginErrorText.textContent = msg;
  loginErrorBanner.classList.remove("hidden");
}

function clearLoginError() {
  loginErrorBanner.classList.add("hidden");
  loginErrorText.textContent = "";
}

// Confetti Celebration
function triggerConfetti() {
  if (typeof confetti === "function") {
    confetti({
      particleCount: 60,
      spread: 70,
      origin: { y: 0.6 }
    });
  }
}

// Show/Hide PIN toggle
togglePinBtn.addEventListener("click", () => {
  const currentType = teamPasswordInput.getAttribute("type");
  const newType = currentType === "password" ? "text" : "password";
  teamPasswordInput.setAttribute("type", newType);
  
  togglePinBtn.style.color = newType === "text" ? "#818cf8" : "var(--text-muted)";
});

// Find Team in Pre-Registered Roster
function findTeamInRoster(inputIdentifier) {
  const clean = inputIdentifier.trim().toUpperCase();
  
  return PRE_REGISTERED_TEAMS.find(t => 
    t.teamId.toUpperCase() === clean ||
    t.originalId.toUpperCase() === clean ||
    // Also matches "PRMT-004" or raw numbers like "4" or "004"
    t.teamId.toUpperCase().startsWith(`PRMT-${clean}`) ||
    t.originalId.toUpperCase() === `TEAM-${clean}`
  );
}

// Switch to Workspace
function unlockWorkspace(teamData) {
  currentTeam = teamData;
  sessionStorage.setItem("promptathon_active_team", JSON.stringify(teamData));

  // Populate pass and identity elements
  workspaceTeamBadge.textContent = teamData.teamId;
  workspaceTeamName.textContent = teamData.teamName;
  passTeamId.textContent = teamData.teamId;
  passOriginalId.textContent = teamData.originalId;
  passLeaderName.textContent = teamData.leaderName || "N/A";
  passParticipants.textContent = teamData.participants || "Team Members";

  // Check for any previous submission
  loadTeamSubmission(teamData.teamId);

  // Switch screens
  loginContainer.classList.add("hidden");
  teamWorkspace.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Switch back to Login
function lockWorkspace() {
  currentTeam = null;
  sessionStorage.removeItem("promptathon_active_team");
  teamWorkspace.classList.add("hidden");
  loginContainer.classList.remove("hidden");
  teamLoginForm.reset();
  clearLoginError();
  teamIdInput.focus();
}

// Load previous submission if exists
async function loadTeamSubmission(teamId) {
  // Check local cache first
  const cachedSub = localStorage.getItem(`sub_${teamId}`);
  if (cachedSub) {
    try {
      const parsed = JSON.parse(cachedSub);
      fillSubmissionForm(parsed);
    } catch (e) {}
  }

  // Check Firestore live document
  if (db) {
    try {
      const docSnap = await getDoc(doc(db, "registrations", teamId));
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.submission) {
          fillSubmissionForm(data.submission);
        }
      }
    } catch (err) {
      console.warn("Could not check remote submission:", err.message);
    }
  }
}

function fillSubmissionForm(sub) {
  if (sub.title) subTitleInput.value = sub.title;
  if (sub.prompt) subPromptInput.value = sub.prompt;
  if (sub.link) subLinkInput.value = sub.link;

  submissionReceipt.classList.remove("hidden");
  receiptTimestamp.textContent = `Submitted: ${sub.submittedAtFormatted || "Recorded"}`;
  challengeBtnText.textContent = "Update Solution";
}

// Set Loading State for Login Button
function setLoginLoading(loading) {
  const btnText = loginSubmitBtn.querySelector(".btn-text");
  const btnArrow = loginSubmitBtn.querySelector(".btn-arrow");
  if (loading) {
    loginSubmitBtn.disabled = true;
    loginBtnLoader.classList.remove("hidden");
    if (btnText) btnText.textContent = "Verifying...";
    if (btnArrow) btnArrow.classList.add("hidden");
  } else {
    loginSubmitBtn.disabled = false;
    loginBtnLoader.classList.add("hidden");
    if (btnText) btnText.innerHTML = "Sign In &rarr;";
    if (btnArrow) btnArrow.classList.remove("hidden");
  }
}

// ==========================================
// Strict Authentication Handler
// ==========================================
teamLoginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearLoginError();

  const enteredId = teamIdInput.value.trim();
  const enteredPass = teamPasswordInput.value.trim();

  if (!enteredId || !enteredPass) {
    showLoginError("Please enter both your Team ID and 4-digit PIN.");
    return;
  }

  setLoginLoading(true);

  try {
    let matchedTeam = null;

    // 1. Check verified local pre-registered roster first
    const rosterMatch = findTeamInRoster(enteredId);
    
    // 2. Also query Firestore if connected
    if (db) {
      try {
        const targetDocId = rosterMatch ? rosterMatch.teamId : enteredId.toUpperCase();
        const docRef = doc(db, "registrations", targetDocId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const remoteData = docSnap.data();
          matchedTeam = {
            teamId: remoteData.teamId || targetDocId,
            originalId: remoteData.originalId || "",
            teamName: remoteData.teamName || "",
            leaderName: remoteData.leaderName || "",
            participants: remoteData.participants || "",
            password: String(remoteData.password || "")
          };
        }
      } catch (remoteErr) {
        console.warn("Firestore query error (falling back to roster):", remoteErr.message);
      }
    }

    // Fallback to verified roster if Firestore doc wasn't loaded
    if (!matchedTeam && rosterMatch) {
      matchedTeam = rosterMatch;
    }

    // STRICT CHECK: Team must exist in the official dataset
    if (!matchedTeam) {
      showLoginError("Team ID not found. Only pre-registered teams in the official Promptathon roster can log in.");
      teamIdInput.focus();
      return;
    }

    // STRICT CHECK: Password (PIN) must match exactly
    if (String(matchedTeam.password) !== enteredPass) {
      showLoginError("Incorrect 4-digit PIN for this team. Please check your assigned credentials.");
      teamPasswordInput.value = "";
      teamPasswordInput.focus();
      return;
    }

    // AUTHENTICATION SUCCESSFUL!
    unlockWorkspace(matchedTeam);
    showToast(`Welcome, ${matchedTeam.teamName}!`, "success");
    triggerConfetti();

  } catch (err) {
    console.error("Authentication error:", err);
    showLoginError("An unexpected error occurred during verification. Please try again.");
  } finally {
    setLoginLoading(false);
  }
});

// Clear error on typing
teamIdInput.addEventListener("input", clearLoginError);
teamPasswordInput.addEventListener("input", clearLoginError);

// ==========================================
// Challenge Solution Submission
// ==========================================
challengeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentTeam) return;

  const titleVal = subTitleInput.value.trim();
  const promptVal = subPromptInput.value.trim();
  const linkVal = subLinkInput.value.trim();

  if (!titleVal || !promptVal) {
    showToast("Please provide both solution title and prompt content.", "error");
    return;
  }

  submitChallengeBtn.disabled = true;
  subLoader.classList.remove("hidden");
  challengeBtnText.textContent = "Saving Submission...";

  const submissionData = {
    title: titleVal,
    prompt: promptVal,
    link: linkVal,
    submittedAtFormatted: new Date().toLocaleString(),
    timestampIso: new Date().toISOString()
  };

  try {
    // 1. Save in Firestore under this team's document
    if (db) {
      const docRef = doc(db, "registrations", currentTeam.teamId);
      await updateDoc(docRef, {
        submission: {
          ...submissionData,
          updatedAt: serverTimestamp()
        }
      });
    }

    // 2. Cache in localStorage
    localStorage.setItem(`sub_${currentTeam.teamId}`, JSON.stringify(submissionData));

    // Show receipt
    submissionReceipt.classList.remove("hidden");
    receiptTimestamp.textContent = `Submitted: ${submissionData.submittedAtFormatted}`;
    challengeBtnText.textContent = "Update Solution";

    showToast("Solution submitted successfully!", "success");
    triggerConfetti();
  } catch (err) {
    console.error("Submission error:", err);
    // Still save locally if network/permissions restricted
    localStorage.setItem(`sub_${currentTeam.teamId}`, JSON.stringify(submissionData));
    submissionReceipt.classList.remove("hidden");
    receiptTimestamp.textContent = `Saved Locally: ${submissionData.submittedAtFormatted}`;
    showToast("Solution saved! (Synced locally)", "success");
  } finally {
    submitChallengeBtn.disabled = false;
    subLoader.classList.add("hidden");
  }
});

// ==========================================
// Logout Handler & Session Check
// ==========================================
teamLogoutBtn.addEventListener("click", () => {
  lockWorkspace();
  showToast("Logged out from team workspace.", "success");
});

// Check existing active team session
const savedSession = sessionStorage.getItem("promptathon_active_team");
if (savedSession) {
  try {
    const parsedTeam = JSON.parse(savedSession);
    // Verify it exists in authorized dataset
    if (findTeamInRoster(parsedTeam.teamId)) {
      unlockWorkspace(parsedTeam);
    } else {
      sessionStorage.removeItem("promptathon_active_team");
    }
  } catch (e) {
    sessionStorage.removeItem("promptathon_active_team");
  }
}
