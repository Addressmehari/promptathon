// Firebase Modular SDK imports
import { 
  doc, 
  getDoc, 
  getDocs,
  collection,
  query,
  where,
  onSnapshot,
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

// DOM Elements - Level Action
const startLevelBtn = document.getElementById("start-level-btn");
const startBtnText = document.getElementById("start-btn-text");
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

// ==========================================
// Selectable & Choosable Rounds (Healthbar Stops)
// ==========================================
let selectedLevel = 1;
const healthStops = document.querySelectorAll(".health-stop");
const healthbarFill = document.querySelector(".healthbar-fill");
const healthbarStatusBadge = document.querySelector(".healthbar-status-badge");

function isLevelCompleted(lvl) {
  if (!currentTeam) return false;
  return Boolean(
    currentTeam[`lvl${lvl}`]?.scenarios ||
    currentTeam[`lvl${lvl}`]?.resp ||
    currentTeam[`level_${lvl}_response`] || 
    currentTeam[`level-${lvl}-response`]
  );
}

function isLevelViolated(lvl) {
  if (!currentTeam) return false;
  return Boolean(
    currentTeam[`lvl${lvl}`]?.violated === "true" ||
    currentTeam[`lvl${lvl}`]?.violated === true ||
    (currentTeam[`level_${lvl}_strikes`] >= 3)
  );
}

function isLevelStarted(lvl) {
  if (!currentTeam) return false;
  return Boolean(
    currentTeam[`level_${lvl}_startedAt`] ||
    currentTeam[`lvl${lvl}`]?.startedAt
  );
}

function isLevelUnlocked(lvl) {
  if (lvl === 1) return true;
  return isLevelCompleted(lvl - 1);
}

function updateStopIndicators() {
  healthStops.forEach((s) => {
    const levelNum = parseInt(s.getAttribute("data-level"), 10);
    const completed = isLevelCompleted(levelNum);
    const unlocked = isLevelUnlocked(levelNum);
    const started = isLevelStarted(levelNum);
    const violated = isLevelViolated(levelNum);
    const pill = s.querySelector(".stop-status-pill");
    const isSelected = (selectedLevel === levelNum);

    s.classList.remove("stop-locked", "stop-completed", "stop-violated");

    if (violated) {
      s.classList.add("stop-violated");
      if (pill) {
        pill.className = "stop-status-pill violated";
        pill.textContent = "🚨 Violated";
      }
    } else if (!unlocked) {
      s.classList.add("stop-locked");
      if (pill) {
        pill.className = "stop-status-pill locked";
        pill.textContent = "🔒 Locked";
      }
    } else if (completed) {
      s.classList.add("stop-completed");
      if (pill) {
        pill.className = isSelected ? "stop-status-pill active" : "stop-status-pill completed";
        pill.textContent = "✓ Submitted";
      }
    } else if (started) {
      if (pill) {
        pill.className = isSelected ? "stop-status-pill active" : "stop-status-pill upcoming";
        pill.textContent = isSelected ? "In Progress" : "⏳ Running";
      }
    } else {
      if (pill) {
        pill.className = isSelected ? "stop-status-pill active" : "stop-status-pill upcoming";
        pill.textContent = isSelected ? "Selected" : "Select";
      }
    }
  });

  // Update Box C button text according to selected round's unlock, submission, and violation status
  const selectedCompleted = isLevelCompleted(selectedLevel);
  const selectedUnlocked = isLevelUnlocked(selectedLevel);
  const selectedStarted = isLevelStarted(selectedLevel);
  const selectedViolated = isLevelViolated(selectedLevel);

  if (startBtnText && startLevelBtn) {
    startLevelBtn.classList.remove("btn-locked", "btn-violated");

    if (selectedViolated) {
      startLevelBtn.classList.add("btn-locked", "btn-violated");
      startLevelBtn.style.cursor = "not-allowed";
      startLevelBtn.style.opacity = "0.8";
      startBtnText.textContent = `Level ${selectedLevel} Locked (3 Violations Triggered 🚨)`;
    } else if (selectedCompleted) {
      startLevelBtn.classList.add("btn-locked", "btn-submitted-locked");
      startLevelBtn.style.cursor = "not-allowed";
      startLevelBtn.style.opacity = "0.85";
      startBtnText.textContent = `Level ${selectedLevel} Submitted & Locked 🔒`;
    } else if (!selectedUnlocked) {
      startLevelBtn.classList.add("btn-locked");
      startLevelBtn.style.cursor = "not-allowed";
      startLevelBtn.style.opacity = "0.6";
      startBtnText.textContent = `Level ${selectedLevel} Locked (Complete Level ${selectedLevel - 1} First)`;
    } else if (selectedStarted) {
      startLevelBtn.style.cursor = "pointer";
      startLevelBtn.style.opacity = "1";
      startBtnText.textContent = `Continue Level ${selectedLevel} (In Progress ⏳) \u2192`;
    } else {
      startLevelBtn.style.cursor = "pointer";
      startLevelBtn.style.opacity = "1";
      startBtnText.textContent = `Start Level ${selectedLevel} \u2192`;
    }
  }
}

function selectRound(stopEl) {
  const stopIndex = parseInt(stopEl.getAttribute("data-stop"), 10);
  const levelNum = parseInt(stopEl.getAttribute("data-level"), 10) || (stopIndex + 1);

  if (!isLevelUnlocked(levelNum)) {
    showToast(`Level ${levelNum} is locked! Complete Level ${levelNum - 1} first to unlock it.`, "warning");
    return;
  }

  selectedLevel = levelNum;

  // Update stop card visual states
  healthStops.forEach((s) => {
    s.classList.remove("stop-selected", "stop-active");
  });

  stopEl.classList.add("stop-selected", "stop-active");
  updateStopIndicators();

  // Update Healthbar track fill
  if (healthbarFill) {
    healthbarFill.style.width = `${levelNum * 25}%`;
  }

  // Update Status badge in Box B header
  if (healthbarStatusBadge) {
    healthbarStatusBadge.textContent = `STOP ${stopIndex} // LEVEL ${levelNum} SELECTED`;
  }

  const roundName = stopEl.querySelector(".stop-name")?.textContent || `Round ${levelNum}`;
  showToast(`${roundName} (Level ${levelNum}) selected!`, "info");
}

healthStops.forEach((stop) => {
  stop.addEventListener("click", () => selectRound(stop));
});

// Start Level Button Handler (Loads level page in same tab, preserving session)
if (startLevelBtn) {
  startLevelBtn.addEventListener("click", () => {
    if (!currentTeam) {
      showToast("Please sign in with your team credentials first.", "error");
      return;
    }
    if (isLevelViolated(selectedLevel)) {
      showToast(`Level ${selectedLevel} is permanently locked due to Safe-Browsing rule violations (3 strikes).`, "error");
      return;
    }
    if (isLevelCompleted(selectedLevel)) {
      showToast(`Level ${selectedLevel} has already been submitted and is locked. You cannot enter even to view.`, "warning");
      return;
    }
    if (!isLevelUnlocked(selectedLevel)) {
      showToast(`Level ${selectedLevel} is locked! Complete Level ${selectedLevel - 1} first.`, "error");
      return;
    }
    window.location.href = `level${selectedLevel}.html`;
  });
}

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
        ...data,
        teamId: data.teamId || directSnap.id,
        originalId: data.originalId || "",
        teamName: data.teamName || "",
        leaderName: data.leaderName || "",
        participants: data.participants || "",
        password: String(data.password || "")
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
        ...data,
        teamId: data.teamId || d.id,
        originalId: data.originalId || "",
        teamName: data.teamName || "",
        leaderName: data.leaderName || "",
        participants: data.participants || "",
        password: String(data.password || "")
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
          ...data,
          teamId: data.teamId || d.id,
          originalId: data.originalId || "",
          teamName: data.teamName || "",
          leaderName: data.leaderName || "",
          participants: data.participants || "",
          password: String(data.password || "")
        };
      }

      if (tId.startsWith(`PRMT-${clean}`) || oId === `TEAM-${clean}`) {
        return {
          ...data,
          teamId: data.teamId || d.id,
          originalId: data.originalId || "",
          teamName: data.teamName || "",
          leaderName: data.leaderName || "",
          participants: data.participants || "",
          password: String(data.password || "")
        };
      }

      // If user typed only a number like "4" or "004"
      const numMatch = clean.match(/\d+/);
      if (numMatch) {
        const padded = `TEAM-${numMatch[0].padStart(3, "0")}`;
        if (oId === padded || tId.includes(`-${numMatch[0].padStart(3, "0")}-`)) {
          return {
            ...data,
            teamId: data.teamId || d.id,
            originalId: data.originalId || "",
            teamName: data.teamName || "",
            leaderName: data.leaderName || "",
            participants: data.participants || "",
            password: String(data.password || "")
          };
        }
      }
    }
  } catch (e) {
    console.error("Firestore scan error:", e);
  }

  return null;
}

let teamDocUnsubscribe = null;

function calculateTeamScore(data) {
  if (!data) return "0.00";
  let total = 0;
  for (let lvl = 1; lvl <= 4; lvl++) {
    const s = data[`lvl${lvl}`]?.score;
    if (typeof s === "number") total += s;
  }
  return Number(total.toFixed(2)).toFixed(2);
}

// Switch to Workspace
function unlockWorkspace(teamData) {
  currentTeam = { ...teamData };
  delete currentTeam.score;
  sessionStorage.setItem("promptathon_active_team", JSON.stringify(currentTeam));

  // Populate pass and identity elements
  workspaceTeamBadge.textContent = currentTeam.teamId;
  workspaceTeamName.textContent = currentTeam.teamName;
  passTeamId.textContent = currentTeam.teamId;
  passOriginalId.textContent = currentTeam.originalId;
  passLeaderName.textContent = currentTeam.leaderName || "N/A";
  passParticipants.textContent = currentTeam.participants || "Team Members";

  // Score display (computed strictly from lvl1..lvl4 scores)
  const teamScoreNum = document.getElementById("team-score-num");
  if (teamScoreNum) {
    teamScoreNum.textContent = calculateTeamScore(currentTeam);
  }

  // Update visual state of level stops to show which ones are already completed
  updateStopIndicators();

  // Listen to Firestore doc in real-time: if admin deletes a level from DB, unlock it immediately!
  if (teamDocUnsubscribe) {
    teamDocUnsubscribe();
    teamDocUnsubscribe = null;
  }
  const firestoreDb = db;
  if (firestoreDb && teamData.teamId) {
    teamDocUnsubscribe = onSnapshot(doc(firestoreDb, "registrations", teamData.teamId), (docSnap) => {
      if (docSnap.exists()) {
        const liveData = docSnap.data();
        currentTeam = {
          ...currentTeam,
          ...liveData
        };
        delete currentTeam.score;

        // Clean out any level that was removed from Firestore
        for (let lvl = 1; lvl <= 4; lvl++) {
          const exists = liveData[`lvl${lvl}`]?.scenarios || liveData[`lvl${lvl}`]?.resp || liveData[`level_${lvl}_response`];
          if (!exists) {
            localStorage.removeItem(`team_${teamData.teamId}_level_${lvl}`);
            if (currentTeam[`lvl${lvl}`]) delete currentTeam[`lvl${lvl}`];
            if (currentTeam[`level_${lvl}_response`]) delete currentTeam[`level_${lvl}_response`];
            if (currentTeam[`level-${lvl}-response`]) delete currentTeam[`level-${lvl}-response`];
          }
        }
        sessionStorage.setItem("promptathon_active_team", JSON.stringify(currentTeam));
        if (teamScoreNum) {
          teamScoreNum.textContent = calculateTeamScore(currentTeam);
        }
        updateStopIndicators();
      }
    }, (err) => {
      console.warn("Live team doc listener warning:", err.message);
    });
  }

  // Switch screens
  loginContainer.classList.add("hidden");
  teamWorkspace.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Switch back to Login
function lockWorkspace() {
  if (teamDocUnsubscribe) {
    teamDocUnsubscribe();
    teamDocUnsubscribe = null;
  }
  closeSidebar();
  currentTeam = null;
  sessionStorage.removeItem("promptathon_active_team");
  teamWorkspace.classList.add("hidden");
  loginContainer.classList.remove("hidden");
  teamLoginForm.reset();
  clearLoginError();
  teamIdInput.focus();
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
