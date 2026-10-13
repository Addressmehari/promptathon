// Firebase Modular SDK imports
import { 
  doc, 
  getDoc, 
  getDocs,
  collection,
  query,
  where,
  updateDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { initFirebaseFromEnv } from "./firebase-config.js";

// State
let db = null;
let currentTeam = null;

// Initialize Firebase directly from environment config
const firebaseReady = initFirebaseFromEnv()
  .then(({ db: firestoreDb, config }) => {
    db = firestoreDb;
    console.log("Connected to Firestore database:", config.projectId);
    return firestoreDb;
  })
  .catch((err) => {
    console.error("Firebase connection error:", err.message);
    throw err;
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
  
  togglePinBtn.style.color = newType === "text" ? "var(--primary-accent)" : "var(--text-muted)";
});

// ==========================================
// True Sliding Sidebar Drawer (3-Dot Trigger)
// ==========================================
const openSidebarBtn = document.getElementById("open-sidebar-btn");
const closeSidebarBtn = document.getElementById("close-sidebar-btn");
const teamSidebarDrawer = document.getElementById("team-sidebar-drawer");
const sidebarOverlay = document.getElementById("sidebar-overlay");

function openSidebar() {
  if (teamSidebarDrawer && sidebarOverlay) {
    sidebarOverlay.classList.remove("hidden");
    requestAnimationFrame(() => {
      sidebarOverlay.classList.add("visible");
      teamSidebarDrawer.classList.add("open");
    });
  }
}

function closeSidebar() {
  if (teamSidebarDrawer && sidebarOverlay) {
    sidebarOverlay.classList.remove("visible");
    teamSidebarDrawer.classList.remove("open");
    setTimeout(() => {
      if (!teamSidebarDrawer.classList.contains("open")) {
        sidebarOverlay.classList.add("hidden");
      }
    }, 320);
  }
}

if (openSidebarBtn) openSidebarBtn.addEventListener("click", openSidebar);
if (closeSidebarBtn) closeSidebarBtn.addEventListener("click", closeSidebar);
if (sidebarOverlay) sidebarOverlay.addEventListener("click", closeSidebar);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && teamSidebarDrawer && teamSidebarDrawer.classList.contains("open")) {
    closeSidebar();
  }
});

// Interactive Healthbar Stops (Mockup Round Inspection)
const healthStops = document.querySelectorAll(".health-stop");
healthStops.forEach(stop => {
  stop.addEventListener("click", () => {
    const stopNum = stop.getAttribute("data-stop");
    const roundName = stop.querySelector(".stop-name").textContent;
    const roundDesc = stop.querySelector(".stop-desc").textContent;
    
    if (stopNum === "0") {
      showToast(`Stop 0 [${roundName}]: Active Challenge! Submit your prompt below.`, "success");
    } else if (stopNum === "1") {
      showToast(`Stop 1 [${roundName}]: ${roundDesc} (Unlocks after Round 1 evaluation).`, "info");
    } else {
      showToast(`Stop ${stopNum} [${roundName}]: ${roundDesc} (Locked stage).`, "warning");
    }
  });
});

// Fetch and match team strictly from Firestore database collection "registrations"
async function findTeamInDb(inputIdentifier) {
  const firestoreDb = db || await firebaseReady;
  const clean = inputIdentifier.trim().toUpperCase();

  // 1. Direct fetch by Document ID (teamId, e.g. "PRMT-004-DOOM")
  try {
    const directSnap = await getDoc(doc(firestoreDb, "registrations", clean));
    if (directSnap.exists()) {
      const data = directSnap.data();
      return {
        teamId: data.teamId || directSnap.id,
        originalId: data.originalId || "",
        teamName: data.teamName || "",
        leaderName: data.leaderName || "",
        participants: data.participants || "",
        password: String(data.password || ""),
        score: data.score || 85
      };
    }
  } catch (e) {
    console.warn("Direct doc fetch error:", e.message);
  }

  // 2. Query collection "registrations" for originalId (e.g. "TEAM-004")
  try {
    const qOriginal = query(collection(firestoreDb, "registrations"), where("originalId", "==", clean));
    const snapOriginal = await getDocs(qOriginal);
    if (!snapOriginal.empty) {
      const d = snapOriginal.docs[0];
      const data = d.data();
      return {
        teamId: data.teamId || d.id,
        originalId: data.originalId || "",
        teamName: data.teamName || "",
        leaderName: data.leaderName || "",
        participants: data.participants || "",
        password: String(data.password || ""),
        score: data.score || 85
      };
    }
  } catch (e) {
    console.warn("OriginalId query error:", e.message);
  }

  // 3. Fallback: Search all registration docs for normalized number or partial ID
  try {
    const allDocs = await getDocs(collection(firestoreDb, "registrations"));
    for (const d of allDocs.docs) {
      const data = d.data();
      const tId = (data.teamId || d.id).toUpperCase();
      const oId = (data.originalId || "").toUpperCase();

      if (tId === clean || oId === clean) {
        return {
          teamId: data.teamId || d.id,
          originalId: data.originalId || "",
          teamName: data.teamName || "",
          leaderName: data.leaderName || "",
          participants: data.participants || "",
          password: String(data.password || ""),
          score: data.score || 85
        };
      }

      if (tId.startsWith(`PRMT-${clean}`) || oId === `TEAM-${clean}`) {
        return {
          teamId: data.teamId || d.id,
          originalId: data.originalId || "",
          teamName: data.teamName || "",
          leaderName: data.leaderName || "",
          participants: data.participants || "",
          password: String(data.password || ""),
          score: data.score || 85
        };
      }

      // If user typed only a number like "4" or "004"
      const numMatch = clean.match(/\d+/);
      if (numMatch) {
        const padded = `TEAM-${numMatch[0].padStart(3, "0")}`;
        if (oId === padded || tId.includes(`-${numMatch[0].padStart(3, "0")}-`)) {
          return {
            teamId: data.teamId || d.id,
            originalId: data.originalId || "",
            teamName: data.teamName || "",
            leaderName: data.leaderName || "",
            participants: data.participants || "",
            password: String(data.password || ""),
            score: data.score || 85
          };
        }
      }
    }
  } catch (e) {
    console.error("Firestore scan error:", e);
  }

  return null;
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

  // Score display (mockup / remote)
  const teamScoreNum = document.getElementById("team-score-num");
  if (teamScoreNum && teamData.score) {
    teamScoreNum.textContent = teamData.score;
  }

  // Check for any previous submission
  loadTeamSubmission(teamData.teamId);

  // Switch screens
  loginContainer.classList.add("hidden");
  teamWorkspace.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Switch back to Login
function lockWorkspace() {
  closeSidebar();
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
    // 1. Fetch directly from Firestore collection "registrations"
    const matchedTeam = await findTeamInDb(enteredId);

    // 2. Check team existence in the database
    if (!matchedTeam) {
      showLoginError("Team ID not found in database. Only pre-registered teams can log in.");
      teamIdInput.focus();
      return;
    }

    // 3. Check PIN / password against database
    if (String(matchedTeam.password).trim() !== enteredPass) {
      showLoginError("Incorrect 4-digit PIN for this team. Please check your assigned credentials.");
      teamPasswordInput.value = "";
      teamPasswordInput.focus();
      return;
    }

    // AUTHENTICATION SUCCESSFUL!
    unlockWorkspace(matchedTeam);
    showToast(`Welcome, ${matchedTeam.teamName || matchedTeam.teamId}!`, "success");
    triggerConfetti();

  } catch (err) {
    console.error("Authentication error:", err);
    showLoginError("Database error during verification. Please check your connection and try again.");
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

// Check existing active team session against database
const savedSession = sessionStorage.getItem("promptathon_active_team");
if (savedSession) {
  try {
    const parsedTeam = JSON.parse(savedSession);
    firebaseReady
      .then(async () => {
        const liveTeam = await findTeamInDb(parsedTeam.teamId);
        if (liveTeam) {
          unlockWorkspace(liveTeam);
        } else {
          sessionStorage.removeItem("promptathon_active_team");
        }
      })
      .catch(() => {
        // Fallback to cached session if offline
        unlockWorkspace(parsedTeam);
      });
  } catch (e) {
    sessionStorage.removeItem("promptathon_active_team");
  }
}
