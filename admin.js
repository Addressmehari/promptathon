// Firebase Modular SDK imports
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { initFirebaseFromEnv } from "./firebase-config.js";

// State
let db = null;
let allTeams = [];
let pendingDeleteId = null;
let cachedAdminAuth = null;
let isAuthenticated = false;
let currentEvalTeam = null;
let currentEvalLevel = 1;

// DOM Elements - Authentication
const adminLoginScreen = document.getElementById("admin-login-screen");
const adminDashboardScreen = document.getElementById("admin-dashboard-screen");
const adminLoginForm = document.getElementById("admin-login-form");
const adminUsernameInput = document.getElementById("admin-username");
const adminPasswordInput = document.getElementById("admin-password");
const loginErrorBanner = document.getElementById("login-error-banner");
const loginErrorText = document.getElementById("login-error-text");
const adminLogoutBtn = document.getElementById("admin-logout-btn");

// DOM Elements - Dashboard
const statTotalTeams = document.getElementById("stat-total-teams");
const statTotalSubmissions = document.getElementById("stat-total-submissions");
const statLatestTime = document.getElementById("stat-latest-time");
const statSyncStatus = document.getElementById("stat-sync-status");

const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search-btn");
const sortSelect = document.getElementById("sort-select");
const exportCsvBtn = document.getElementById("export-csv-btn");
const refreshBtn = document.getElementById("refresh-btn");

const showingCount = document.getElementById("showing-count");
const teamsTbody = document.getElementById("teams-tbody");
const emptyState = document.getElementById("empty-state");
const emptyStateDesc = document.getElementById("empty-state-desc");
const adminErrorBox = document.getElementById("admin-error-box");
const adminErrorText = document.getElementById("admin-error-text");

// DOM Elements - Evaluation Modal
const evalModal = document.getElementById("eval-modal");
const closeEvalModalBtn = document.getElementById("close-eval-modal-btn");
const evalTeamBadge = document.getElementById("eval-team-badge");
const evalTeamTitle = document.getElementById("eval-team-title");
const evalTeamSub = document.getElementById("eval-team-sub");
const evalTabBtns = document.querySelectorAll(".eval-tab-btn");
const evalStatusTag = document.getElementById("eval-status-tag");
const evalTimeTag = document.getElementById("eval-time-tag");
const evalPromptContent = document.getElementById("eval-prompt-content");
const evalScoreInput = document.getElementById("eval-score-input");
const evalSaveScoreBtn = document.getElementById("eval-save-score-btn");
const evalUnlockLevelBtn = document.getElementById("eval-unlock-level-btn");

const deleteModal = document.getElementById("delete-modal");
const deleteTargetName = document.getElementById("delete-target-name");
const cancelDeleteBtn = document.getElementById("cancel-delete-btn");
const confirmDeleteBtn = document.getElementById("confirm-delete-btn");
const toastContainer = document.getElementById("toast-container");

// Toast notification helper
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove());
  }, 3500);
}

// Error Banner Helper
function showError(msg) {
  adminErrorText.textContent = msg;
  adminErrorBox.classList.remove("hidden");
}

function clearError() {
  adminErrorBox.classList.add("hidden");
  adminErrorText.textContent = "";
}

// Format timestamp helper
function formatTimestamp(item) {
  if (item.registeredAtFormatted) {
    return item.registeredAtFormatted;
  }
  if (item.createdAt && typeof item.createdAt.toDate === "function") {
    return item.createdAt.toDate().toLocaleString();
  }
  return "N/A";
}

// Helpers for Submissions & Scores
function getRoundData(team, lvl) {
  if (team[`lvl${lvl}`]) return team[`lvl${lvl}`];
  if (team[`level_${lvl}_response`]) {
    return {
      resp: team[`level_${lvl}_response`],
      score: 0,
      time: team[`level_${lvl}_submitted_at`] || ""
    };
  }
  return null;
}

function calculateTotalScore(team) {
  let total = 0;
  for (let lvl = 1; lvl <= 4; lvl++) {
    const rd = getRoundData(team, lvl);
    if (rd && typeof rd.score === "number") {
      total += rd.score;
    }
  }
  return total;
}

// Update Metric Cards
function updateStats(teams) {
  statTotalTeams.textContent = teams.length;

  let totalSubs = 0;
  teams.forEach(t => {
    for (let lvl = 1; lvl <= 4; lvl++) {
      const rd = getRoundData(t, lvl);
      if (rd && (rd.scenarios || rd.resp)) totalSubs++;
    }
  });

  if (statTotalSubmissions) {
    statTotalSubmissions.textContent = `${totalSubs} / ${teams.length * 4}`;
  }
}

// Render Teams Table: Submissions & Scores Alone
function renderTable() {
  const query = searchInput.value.trim().toLowerCase();
  const sortMode = sortSelect.value;

  // Filter
  let filtered = allTeams.filter(team => {
    const numMatch = String(team.teamNumber || "").toLowerCase().includes(query);
    const nameMatch = (team.teamName || "").toLowerCase().includes(query);
    const idMatch = (team.teamId || team.id || "").toLowerCase().includes(query);
    return numMatch || nameMatch || idMatch;
  });

  // Sort
  filtered.sort((a, b) => {
    switch (sortMode) {
      case "num-asc":
        return (Number(a.teamNumber) || 0) - (Number(b.teamNumber) || 0);
      case "num-desc":
        return (Number(b.teamNumber) || 0) - (Number(a.teamNumber) || 0);
      case "score-desc":
        return calculateTotalScore(b) - calculateTotalScore(a);
      case "name-asc":
        return (a.teamName || "").localeCompare(b.teamName || "");
      case "time-desc":
      default: {
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        return timeB - timeA;
      }
    }
  });

  // Clear Table
  teamsTbody.innerHTML = "";

  // Update Header Count
  if (query) {
    showingCount.textContent = `Showing ${filtered.length} of ${allTeams.length} teams`;
  } else {
    showingCount.textContent = `${allTeams.length} registered contestant team${allTeams.length === 1 ? "" : "s"}`;
  }

  // Handle Empty States
  if (filtered.length === 0) {
    emptyState.classList.remove("hidden");
    if (query) {
      emptyStateDesc.textContent = `No teams matched the search "${query}".`;
    } else {
      emptyStateDesc.textContent = "Contestant teams and their round submissions will appear here in real-time.";
    }
    return;
  }

  emptyState.classList.add("hidden");

  // Populate Rows
  const fragment = document.createDocumentFragment();

  filtered.forEach(team => {
    const tr = document.createElement("tr");

    // 1. Team Number Column
    const tdNum = document.createElement("td");
    tdNum.className = "col-num";
    tdNum.innerHTML = `<span class="team-badge">#${escapeHtml(String(team.teamNumber))}</span>`;

    // 2. Team Name & ID Column
    const tdName = document.createElement("td");
    tdName.className = "col-name";
    tdName.innerHTML = `
      <div class="team-name-cell">${escapeHtml(team.teamName)}</div>
      <div style="font-size: 0.75rem; color: #86efac; font-family: var(--font-mono); margin-top: 2px;">
        ${escapeHtml(team.teamId || team.id)}
      </div>
    `;

    tr.appendChild(tdNum);
    tr.appendChild(tdName);

    // 3, 4, 5, 6. Round 1 to 4 Submissions & Scores
    for (let lvl = 1; lvl <= 4; lvl++) {
      const tdLvl = document.createElement("td");
      tdLvl.className = `col-lvl col-lvl-${lvl}`;
      const rd = getRoundData(team, lvl);

      const isViolated = Boolean(
        rd?.violated === "true" ||
        rd?.violated === true ||
        (team[`level_${lvl}_strikes`] >= 3)
      );

      if (isViolated) {
        tdLvl.innerHTML = `
          <div class="level-cell-box">
            <span class="level-status-badge violated" title="Terminated: 3 Safe-Browsing Violations" style="cursor: pointer; color: #ef4444; border-color: rgba(239, 68, 68, 0.45); background: rgba(239, 68, 68, 0.15);">
              🚨 Violated (3 Strikes)
            </span>
            <span style="font-size: 0.72rem; color: #f87171; font-family: var(--font-mono); font-weight: 700;">Locked</span>
          </div>
        `;
        tdLvl.querySelector(".level-status-badge").addEventListener("click", () => openEvalModal(team, lvl));
      } else if (rd && (rd.scenarios || rd.resp)) {
        const scoreVal = rd.score !== undefined && rd.score !== null ? rd.score : 0;
        tdLvl.innerHTML = `
          <div class="level-cell-box">
            <span class="level-status-badge submitted" title="Click to view prompt & score" style="cursor: pointer;">
              ✓ Submitted
            </span>
            <span class="level-score-pill">${escapeHtml(String(scoreVal))} pts</span>
          </div>
        `;
        tdLvl.querySelector(".level-status-badge").addEventListener("click", () => openEvalModal(team, lvl));
      } else {
        const startedAt = rd?.startedAt || team[`level_${lvl}_startedAt`] || team[`lvl${lvl}_startedAt`];
        if (startedAt) {
          const elapsed = Date.now() - startedAt;
          const remainingMins = Math.max(0, Math.floor((40 * 60 * 1000 - elapsed) / 60000));
          tdLvl.innerHTML = `
            <div class="level-cell-box">
              <span class="level-status-badge pending" title="Level started - timer active" style="cursor: pointer; color: #fde047; border-color: rgba(253, 224, 71, 0.4); background: rgba(253, 224, 71, 0.1);">
                ⏳ ${remainingMins}m left
              </span>
              <span style="font-size: 0.72rem; color: #64748b; font-family: var(--font-mono);">In Progress</span>
            </div>
          `;
        } else {
          tdLvl.innerHTML = `
            <div class="level-cell-box">
              <span class="level-status-badge pending" title="Not started yet" style="cursor: pointer;">- Pending</span>
              <span style="font-size: 0.72rem; color: #64748b; font-family: var(--font-mono);">0 pts</span>
            </div>
          `;
        }
        tdLvl.querySelector(".level-status-badge").addEventListener("click", () => openEvalModal(team, lvl));
      }
      tr.appendChild(tdLvl);
    }

    // 7. Total Score Column
    const tdScore = document.createElement("td");
    tdScore.className = "col-score";
    tdScore.innerHTML = `
      <span style="font-family: var(--font-mono); font-weight: 800; font-size: 1.05rem; color: #86efac;">
        ${calculateTotalScore(team)}
      </span>
      <span style="font-size: 0.75rem; color: #94a3b8;">pts</span>
    `;
    tr.appendChild(tdScore);

    // 8. Admin Control Action Column
    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    tdActions.innerHTML = `
      <button type="button" class="table-btn-eval" title="Review Submissions & Score Team">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
        <span>Review & Score</span>
      </button>
    `;
    tdActions.querySelector(".table-btn-eval").addEventListener("click", () => openEvalModal(team, 1));
    tr.appendChild(tdActions);

    fragment.appendChild(tr);
  });

  teamsTbody.appendChild(fragment);
}

// ==========================================
// Evaluation & Scoring Modal Logic
// ==========================================
function openEvalModal(team, level = 1) {
  currentEvalTeam = team;
  currentEvalLevel = level;

  evalTeamBadge.textContent = team.teamId || team.id || "TEAM";
  evalTeamTitle.textContent = team.teamName || "Team Contestant";
  evalTeamSub.textContent = `Leader: ${team.leaderName || "N/A"} • Team #${team.teamNumber || "-"}`;

  updateEvalModalView();
  evalModal.classList.remove("hidden");
}

function closeEvalModal() {
  evalModal.classList.add("hidden");
  currentEvalTeam = null;
}

if (closeEvalModalBtn) {
  closeEvalModalBtn.addEventListener("click", closeEvalModal);
}
if (evalModal) {
  evalModal.addEventListener("click", (e) => {
    if (e.target === evalModal) closeEvalModal();
  });
}

function updateEvalModalView() {
  if (!currentEvalTeam) return;

  // Active tab button visual state
  evalTabBtns.forEach(btn => {
    const lvl = parseInt(btn.getAttribute("data-lvl"), 10);
    if (lvl === currentEvalLevel) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  const rd = getRoundData(currentEvalTeam, currentEvalLevel);

  // Admin can always assign/edit scores
  evalScoreInput.disabled = false;
  evalSaveScoreBtn.disabled = false;

  const hasSubmission = Boolean(rd && (rd.scenarios || rd.resp));

  const isViolated = Boolean(
    rd?.violated === "true" ||
    rd?.violated === true ||
    (currentEvalTeam?.[`level_${currentEvalLevel}_strikes`] >= 3)
  );

  if (isViolated) {
    evalStatusTag.className = "eval-status-tag pending";
    evalStatusTag.style.color = "#ef4444";
    evalStatusTag.style.borderColor = "rgba(239, 68, 68, 0.5)";
    evalStatusTag.style.background = "rgba(239, 68, 68, 0.15)";
    evalStatusTag.textContent = "🚨 VIOLATED (3 STRIKES RECORDED)";
    evalTimeTag.textContent = rd.time ? `Terminated on ${rd.time}` : "Terminated due to Safe-Browsing rule violations";
  } else if (hasSubmission) {
    evalStatusTag.className = "eval-status-tag submitted";
    evalStatusTag.style.color = "";
    evalStatusTag.style.borderColor = "";
    evalStatusTag.style.background = "";
    evalStatusTag.textContent = rd.autoSubmitted ? "✓ AUTO-SUBMITTED (TIME EXPIRED)" : "✓ SUBMITTED (ALL 3 PARTS)";
    
    let timeText = rd.time ? `Submitted: ${rd.time}` : "Submitted";
    const startedAt = currentEvalTeam?.[`level_${currentEvalLevel}_startedAt`] || rd?.startedAt;
    if (startedAt) {
      const startStr = new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      timeText = `Started: ${startStr} • ${timeText}`;
    }
    evalTimeTag.textContent = timeText;

    // Format scenarios nicely inside evalPromptContent
    if (rd.scenarios && (rd.scenarios.scenario_1 || rd.scenarios.scenario1)) {
      const s1 = rd.scenarios.scenario_1 || rd.scenarios.scenario1 || "";
      const s2 = rd.scenarios.scenario_2 || rd.scenarios.scenario2 || "";
      const s3 = rd.scenarios.scenario_3 || rd.scenarios.scenario3 || "";

      if (!s2 && !s3) {
        evalPromptContent.innerHTML = `
          <div style="background: rgba(14, 20, 26, 0.95); border: 1px solid rgba(253, 224, 71, 0.3); border-radius: 4px; padding: 14px 16px;">
            <div style="font-size: 0.75rem; font-weight: 700; color: #fde047; font-family: var(--font-mono); margin-bottom: 8px;">[ROUND ${currentEvalLevel} // NAVIGATION PROMPT]</div>
            <div style="font-size: 0.92rem; color: #ffffff; white-space: pre-wrap; line-height: 1.6;">${escapeHtml(s1)}</div>
          </div>
        `;
      } else {
        evalPromptContent.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 14px;">
            <div style="background: rgba(14, 20, 26, 0.95); border: 1px solid rgba(134, 239, 172, 0.25); border-radius: 4px; padding: 12px 14px;">
              <div style="font-size: 0.75rem; font-weight: 700; color: #86efac; font-family: var(--font-mono); margin-bottom: 6px;">[CATEGORY / SCENARIO 1]</div>
              <div style="font-size: 0.88rem; color: #ffffff; white-space: pre-wrap; line-height: 1.5;">${escapeHtml(s1)}</div>
            </div>
            <div style="background: rgba(14, 20, 26, 0.95); border: 1px solid rgba(134, 239, 172, 0.25); border-radius: 4px; padding: 12px 14px;">
              <div style="font-size: 0.75rem; font-weight: 700; color: #86efac; font-family: var(--font-mono); margin-bottom: 6px;">[CATEGORY / SCENARIO 2]</div>
              <div style="font-size: 0.88rem; color: #ffffff; white-space: pre-wrap; line-height: 1.5;">${escapeHtml(s2)}</div>
            </div>
            <div style="background: rgba(14, 20, 26, 0.95); border: 1px solid rgba(134, 239, 172, 0.25); border-radius: 4px; padding: 12px 14px;">
              <div style="font-size: 0.75rem; font-weight: 700; color: #86efac; font-family: var(--font-mono); margin-bottom: 6px;">[CATEGORY / SCENARIO 3]</div>
              <div style="font-size: 0.88rem; color: #ffffff; white-space: pre-wrap; line-height: 1.5;">${escapeHtml(s3)}</div>
            </div>
          </div>
        `;
      }
    } else {
      evalPromptContent.textContent = rd.resp || "Submitted prompt";
    }

    evalPromptContent.style.color = "#f1f5f9";
    evalScoreInput.value = rd.score !== undefined && rd.score !== null ? rd.score : 0;
    evalUnlockLevelBtn.disabled = false;
    evalUnlockLevelBtn.style.opacity = "1";
    evalUnlockLevelBtn.style.cursor = "pointer";
  } else {
    const startedAt = rd?.startedAt || currentEvalTeam?.[`level_${currentEvalLevel}_startedAt`] || currentEvalTeam?.[`lvl${currentEvalLevel}_startedAt`];
    if (startedAt) {
      evalStatusTag.className = "eval-status-tag pending";
      evalStatusTag.textContent = "⏳ IN PROGRESS (TIMER ACTIVE)";
      evalStatusTag.style.color = "#fde047";
      evalStatusTag.style.borderColor = "rgba(253, 224, 71, 0.4)";
      evalStatusTag.style.background = "rgba(253, 224, 71, 0.12)";

      const startStr = new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const elapsed = Date.now() - startedAt;
      const remainingMins = Math.max(0, Math.floor((40 * 60 * 1000 - elapsed) / 60000));
      const remainingSecs = Math.max(0, Math.floor(((40 * 60 * 1000 - elapsed) % 60000) / 1000));
      evalTimeTag.textContent = `Started: ${startStr} • ⏱ ${remainingMins}m ${remainingSecs}s remaining (of 40m)`;
    } else {
      evalStatusTag.className = "eval-status-tag pending";
      evalStatusTag.textContent = "PENDING / NOT STARTED";
      evalStatusTag.style.color = "";
      evalStatusTag.style.borderColor = "";
      evalStatusTag.style.background = "";
      evalTimeTag.textContent = "Round not yet started by team";
    }

    evalPromptContent.textContent = "This team has not submitted responses for this round yet.";
    evalPromptContent.style.color = "#64748b";
    evalScoreInput.value = (rd && rd.score !== undefined) ? rd.score : 0;
    evalUnlockLevelBtn.disabled = true;
    evalUnlockLevelBtn.style.opacity = "0.5";
    evalUnlockLevelBtn.style.cursor = "not-allowed";
  }
}

// Tab Switch Listener
evalTabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    currentEvalLevel = parseInt(btn.getAttribute("data-lvl"), 10);
    updateEvalModalView();
  });
});

// Save Score to Firestore - Updates inside lvl1/lvl2/lvl3/lvl4 map directly
if (evalSaveScoreBtn) {
  evalSaveScoreBtn.addEventListener("click", async () => {
    if (!currentEvalTeam || !db) return;

    const val = parseInt(evalScoreInput.value, 10);
    if (isNaN(val) || val < 0 || val > 100) {
      showToast("Please enter a valid score between 0 and 100.", "error");
      return;
    }

    evalSaveScoreBtn.disabled = true;
    evalSaveScoreBtn.textContent = "Saving...";

    try {
      const docRef = doc(db, "registrations", currentEvalTeam.id);
      const existingLvl = getRoundData(currentEvalTeam, currentEvalLevel) || {};
      
      // Save clean map: { resp, scenarios, score, time } inside lvlX
      const updatedLvl = {
        resp: existingLvl.resp || "",
        score: val,
        time: existingLvl.time || new Date().toLocaleString()
      };
      if (existingLvl.scenarios) {
        updatedLvl.scenarios = existingLvl.scenarios;
      }

      // Save clean map strictly inside lvlX, deleting any root score field
      await setDoc(docRef, {
        [`lvl${currentEvalLevel}`]: updatedLvl,
        score: deleteField(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      // Update local team object
      currentEvalTeam[`lvl${currentEvalLevel}`] = updatedLvl;
      delete currentEvalTeam.score;

      showToast(`Score (${val} pts) saved inside lvl${currentEvalLevel} for ${currentEvalTeam.teamName}!`, "success");
      updateEvalModalView();
      renderTable();

    } catch (err) {
      console.error("Score save error:", err);
      showToast("Failed to save score to database: " + err.message, "error");
    } finally {
      evalSaveScoreBtn.disabled = false;
      evalSaveScoreBtn.textContent = "Save Score";
    }
  });
}

// Unlock / Reset Level for Team in Firestore
if (evalUnlockLevelBtn) {
  evalUnlockLevelBtn.addEventListener("click", async () => {
    if (!currentEvalTeam || !db) return;

    const confirmUnlock = confirm(
      `Unlock Level ${currentEvalLevel} for ${currentEvalTeam.teamName}?\n\nThis will remove their prompt submission from the database and allow them to resubmit.`
    );
    if (!confirmUnlock) return;

    evalUnlockLevelBtn.disabled = true;
    evalUnlockLevelBtn.innerHTML = `<span>Unlocking...</span>`;

    try {
      const docRef = doc(db, "registrations", currentEvalTeam.id);
      
      // Delete the round map, any legacy fields, start time, strikes, and root score field
      await updateDoc(docRef, {
        [`lvl${currentEvalLevel}`]: deleteField(),
        [`level_${currentEvalLevel}_response`]: deleteField(),
        [`level-${currentEvalLevel}-response`]: deleteField(),
        [`level_${currentEvalLevel}_startedAt`]: deleteField(),
        [`lvl${currentEvalLevel}_startedAt`]: deleteField(),
        [`level_${currentEvalLevel}_strikes`]: deleteField(),
        score: deleteField(),
        updatedAt: serverTimestamp()
      });

      delete currentEvalTeam[`lvl${currentEvalLevel}`];
      delete currentEvalTeam[`level_${currentEvalLevel}_response`];
      delete currentEvalTeam[`level-${currentEvalLevel}-response`];
      delete currentEvalTeam[`level_${currentEvalLevel}_startedAt`];
      delete currentEvalTeam[`lvl${currentEvalLevel}_startedAt`];
      delete currentEvalTeam[`level_${currentEvalLevel}_strikes`];
      delete currentEvalTeam.score;

      showToast(`Level ${currentEvalLevel} unlocked for ${currentEvalTeam.teamName}!`, "success");
      updateEvalModalView();
      renderTable();

    } catch (err) {
      console.error("Level unlock error:", err);
      showToast("Failed to unlock level: " + err.message, "error");
    } finally {
      evalUnlockLevelBtn.disabled = false;
      evalUnlockLevelBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <span>Unlock / Reset Level</span>
      `;
    }
  });
}

// Basic HTML escaping
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Modal handling
function openDeleteModal(team) {
  pendingDeleteId = team.id;
  deleteTargetName.textContent = `Team #${team.teamNumber} (${team.teamName})`;
  deleteModal.classList.remove("hidden");
}

function closeDeleteModal() {
  pendingDeleteId = null;
  deleteModal.classList.add("hidden");
}

cancelDeleteBtn.addEventListener("click", closeDeleteModal);
deleteModal.addEventListener("click", (e) => {
  if (e.target === deleteModal) closeDeleteModal();
});

// Delete team from Firestore
confirmDeleteBtn.addEventListener("click", async () => {
  if (!pendingDeleteId || !db) return;

  confirmDeleteBtn.disabled = true;
  confirmDeleteBtn.textContent = "Deleting...";

  try {
    await deleteDoc(doc(db, "registrations", pendingDeleteId));
    showToast("Team registration deleted.", "success");
    closeDeleteModal();
  } catch (err) {
    console.error("Failed to delete registration:", err);
    showToast(
      err.code === "permission-denied" 
        ? "Permission denied. Check Firestore security rules for delete." 
        : "Failed to delete team.", 
      "error"
    );
  } finally {
    confirmDeleteBtn.disabled = false;
    confirmDeleteBtn.textContent = "Delete Team";
  }
});

// Export CSV Functionality
exportCsvBtn.addEventListener("click", () => {
  if (allTeams.length === 0) {
    showToast("No team data available to export.", "error");
    return;
  }

  const csvRows = [
    ["Team Number", "Team ID", "Team Name", "Leader", "R1 Score", "R1 Prompt", "R2 Score", "R2 Prompt", "R3 Score", "R3 Prompt", "R4 Score", "R4 Prompt", "Total Score"]
  ];

  allTeams.forEach(t => {
    const r1 = getRoundData(t, 1);
    const r2 = getRoundData(t, 2);
    const r3 = getRoundData(t, 3);
    const r4 = getRoundData(t, 4);

    csvRows.push([
      `"${t.teamNumber || ""}"`,
      `"${t.teamId || t.id}"`,
      `"${(t.teamName || "").replace(/"/g, '""')}"`,
      `"${(t.leaderName || "").replace(/"/g, '""')}"`,
      `"${r1 && r1.score !== undefined ? r1.score : 0}"`,
      `"${(r1?.resp || "").replace(/"/g, '""')}"`,
      `"${r2 && r2.score !== undefined ? r2.score : 0}"`,
      `"${(r2?.resp || "").replace(/"/g, '""')}"`,
      `"${r3 && r3.score !== undefined ? r3.score : 0}"`,
      `"${(r3?.resp || "").replace(/"/g, '""')}"`,
      `"${r4 && r4.score !== undefined ? r4.score : 0}"`,
      `"${(r4?.resp || "").replace(/"/g, '""')}"`,
      `"${calculateTotalScore(t)}"`
    ]);
  });

  const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Promptathon_Registered_Teams_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast(`Exported ${allTeams.length} teams to CSV!`, "success");
});

// Search and Filter Events
searchInput.addEventListener("input", () => {
  if (searchInput.value.trim().length > 0) {
    clearSearchBtn.classList.remove("hidden");
  } else {
    clearSearchBtn.classList.add("hidden");
  }
  renderTable();
});

clearSearchBtn.addEventListener("click", () => {
  searchInput.value = "";
  clearSearchBtn.classList.add("hidden");
  renderTable();
  searchInput.focus();
});

sortSelect.addEventListener("change", renderTable);

refreshBtn.addEventListener("click", () => {
  showToast("Real-time sync active. Data is up-to-date.", "success");
  renderTable();
});

// Real-time Firestore Listener
let unsubscribe = null;
function setupRealtimeListener() {
  if (!db) return;

  clearError();
  const regCol = collection(db, "registrations");

  unsubscribe = onSnapshot(
    regCol,
    (snapshot) => {
      allTeams = [];
      snapshot.forEach(docSnap => {
        const teamData = docSnap.data();
        delete teamData.score; // strictly rely on lvl1..lvl4 scores
        allTeams.push({
          id: docSnap.id,
          ...teamData
        });
      });

      console.log(`Fetched ${allTeams.length} registered teams from Firestore`);
      updateStats(allTeams);
      renderTable();
    },
    (error) => {
      console.error("Firestore onSnapshot error:", error);
      let errorMsg = "Unable to load registrations from Firestore. ";
      if (error.code === "permission-denied") {
        errorMsg += "Permission denied. Check your Firestore Security Rules to allow reading the 'registrations' collection.";
      } else {
        errorMsg += error.message || "Please check network connection.";
      }
      showError(errorMsg);
      teamsTbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center; padding: 32px; color: #fca5a5;">
            ${escapeHtml(errorMsg)}
          </td>
        </tr>
      `;
    }
  );
}

// ==========================================
// Authentication & Session Logic
// ==========================================
function showLoginError(msg) {
  loginErrorText.textContent = msg;
  loginErrorBanner.classList.remove("hidden");
}

function clearLoginError() {
  loginErrorBanner.classList.add("hidden");
  loginErrorText.textContent = "";
}

function unlockDashboard() {
  isAuthenticated = true;
  adminLoginScreen.classList.add("hidden");
  adminDashboardScreen.classList.remove("hidden");
  clearLoginError();

  if (db && !unsubscribe) {
    setupRealtimeListener();
  }
}

function lockDashboard() {
  isAuthenticated = false;
  adminDashboardScreen.classList.add("hidden");
  adminLoginScreen.classList.remove("hidden");

  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

function checkExistingSession() {
  const isAuth = sessionStorage.getItem("promptathon_admin_auth") === "true";
  if (isAuth) {
    unlockDashboard();
  } else {
    lockDashboard();
  }
}

// Handle Admin Login Submission
adminLoginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  clearLoginError();

  const enteredUser = adminUsernameInput.value.trim();
  const enteredPass = adminPasswordInput.value;

  if (!enteredUser || !enteredPass) {
    showLoginError("Please enter both username/email and password.");
    return;
  }

  if (!cachedAdminAuth) {
    showLoginError("Configuration is still loading. Please try again.");
    return;
  }

  const expectedEmail = (cachedAdminAuth.email || "").toLowerCase();
  const expectedPassword = cachedAdminAuth.password || "";

  // Accepts matching email, 'admin', or username portion of email
  const userMatches =
    enteredUser.toLowerCase() === expectedEmail ||
    enteredUser.toLowerCase() === "admin" ||
    (expectedEmail.includes("@") && enteredUser.toLowerCase() === expectedEmail.split("@")[0]);

  const passMatches = enteredPass === expectedPassword;

  if (userMatches && passMatches) {
    sessionStorage.setItem("promptathon_admin_auth", "true");
    unlockDashboard();
    showToast("Welcome to Admin Dashboard!", "success");
    adminLoginForm.reset();
  } else {
    showLoginError("Invalid username or password. Please try again.");
    adminPasswordInput.value = "";
    adminPasswordInput.focus();
  }
});

adminUsernameInput.addEventListener("input", clearLoginError);
adminPasswordInput.addEventListener("input", clearLoginError);

// Handle Admin Logout
adminLogoutBtn.addEventListener("click", () => {
  sessionStorage.removeItem("promptathon_admin_auth");
  lockDashboard();
  showToast("Logged out successfully.", "success");
  clearLoginError();
  adminUsernameInput.focus();
});

// Initialize Firebase from env.js / .env
initFirebaseFromEnv()
  .then(({ db: firestoreDb, config, adminAuth }) => {
    db = firestoreDb;
    cachedAdminAuth = adminAuth;
    console.log("Firebase initialized in Admin for project:", config.projectId);
    
    // Verify session
    checkExistingSession();
  })
  .catch((err) => {
    console.error("Firebase initialization failed in Admin:", err);
    showLoginError(err.message || "Failed to initialize Firebase from configuration.");
    showError(err.message || "Failed to initialize Firebase from configuration.");
  });
