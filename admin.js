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
import { evaluateLevelSubmission, BENCHMARK_PROMPTS } from "./scoring-engine.js";

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

// DOM Elements - Dashboard & Judge Analytics
const statTotalTeams = document.getElementById("stat-total-teams");
const statTotalSubmissions = document.getElementById("stat-total-submissions");
const statLatestTime = document.getElementById("stat-latest-time");
const statSyncStatus = document.getElementById("stat-sync-status");
const statTopTeam = document.getElementById("stat-top-team");
const statTopScore = document.getElementById("stat-top-score");
const statAvgScore = document.getElementById("stat-avg-score");
const statScoredTeamsCount = document.getElementById("stat-scored-teams-count");

const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search-btn");
const sortSelect = document.getElementById("sort-select");
const refreshBtn = document.getElementById("refresh-btn");

// Download & Judge Finalization Elements
const downloadMenuBtn = document.getElementById("download-menu-btn");
const downloadDropdownMenu = document.getElementById("download-dropdown-menu");
const exportLeaderboardCsvBtn = document.getElementById("export-leaderboard-csv-btn");
const exportPromptsCsvBtn = document.getElementById("export-prompts-csv-btn");
const exportRawJsonBtn = document.getElementById("export-raw-json-btn");
const judgeFinalizeBtn = document.getElementById("judge-finalize-btn");
const judgeModal = document.getElementById("judge-modal");
const closeJudgeModalBtn = document.getElementById("close-judge-modal-btn");
const judgePodiumContainer = document.getElementById("judge-podium-container");
const judgeSummaryTeams = document.getElementById("judge-summary-teams");
const judgeSummaryTop = document.getElementById("judge-summary-top");
const judgeSummaryAvg = document.getElementById("judge-summary-avg");
const judgeSummarySubs = document.getElementById("judge-summary-subs");
const judgeTableBody = document.getElementById("judge-table-body");
const judgeSignName = document.getElementById("judge-sign-name");
const judgeSignNotes = document.getElementById("judge-sign-notes");
const judgePrintBtn = document.getElementById("judge-print-btn");
const judgeExportCsvBtn = document.getElementById("judge-export-csv-btn");

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
const evalAutoScoreBtn = document.getElementById("eval-auto-score-btn");
const evalKeywordBreakdown = document.getElementById("eval-keyword-breakdown");

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
  if (!team) return "0.00";
  let total = 0;
  for (let lvl = 1; lvl <= 4; lvl++) {
    const rd = getRoundData(team, lvl);
    if (rd && typeof rd.score === "number") {
      total += rd.score;
    }
  }
  return Number(total.toFixed(2)).toFixed(2);
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

  // Judge Analytics: Leader & Top Score
  const sortedByScore = [...teams].sort((a, b) => {
    return parseFloat(calculateTotalScore(b)) - parseFloat(calculateTotalScore(a));
  });

  const topTeam = sortedByScore[0];
  const topScore = topTeam ? parseFloat(calculateTotalScore(topTeam)) : 0;
  if (statTopTeam && statTopScore) {
    if (topTeam && topScore > 0) {
      statTopTeam.textContent = `🥇 ${topTeam.teamName}`;
      statTopScore.textContent = `Top Score: ${topScore.toFixed(2)} pts (Team #${topTeam.teamNumber || '1'})`;
    } else if (topTeam) {
      statTopTeam.textContent = topTeam.teamName;
      statTopScore.textContent = `Top Score: 0.00 pts`;
    } else {
      statTopTeam.textContent = "-";
      statTopScore.textContent = "Top Score: 0.00 pts";
    }
  }

  // Judge Analytics: Average Score & Evaluated Count
  let scoreSum = 0;
  let evaluatedTeams = 0;
  teams.forEach(t => {
    const s = parseFloat(calculateTotalScore(t));
    scoreSum += s;
    if (s > 0) evaluatedTeams++;
  });

  const avgScore = teams.length > 0 ? (scoreSum / teams.length) : 0;
  if (statAvgScore) {
    statAvgScore.textContent = `${avgScore.toFixed(2)} pts`;
  }
  if (statScoredTeamsCount) {
    statScoredTeamsCount.textContent = `${evaluatedTeams} of ${teams.length} teams scored`;
  }
}

// Synchronize visual sort indicators on table headers
function updateSortIndicators(currentSort) {
  const indicators = {
    rank: document.getElementById("sort-ind-rank"),
    num: document.getElementById("sort-ind-num"),
    name: document.getElementById("sort-ind-name"),
    r1: document.getElementById("sort-ind-r1"),
    r2: document.getElementById("sort-ind-r2"),
    r3: document.getElementById("sort-ind-r3"),
    r4: document.getElementById("sort-ind-r4"),
    score: document.getElementById("sort-ind-score")
  };

  // Reset all headers
  document.querySelectorAll(".sortable-th").forEach(th => th.classList.remove("active-sort"));
  Object.values(indicators).forEach(ind => {
    if (ind) ind.textContent = "↕";
  });

  // Activate matching header
  if (currentSort.startsWith("score")) {
    const th = document.querySelector('[data-sort-key="score"]');
    if (th) th.classList.add("active-sort");
    if (indicators.score) indicators.score.textContent = currentSort === "score-desc" ? "▼" : "▲";
  } else if (currentSort.startsWith("num")) {
    const th = document.querySelector('[data-sort-key="num"]');
    if (th) th.classList.add("active-sort");
    if (indicators.num) indicators.num.textContent = currentSort === "num-asc" ? "▲" : "▼";
  } else if (currentSort.startsWith("name")) {
    const th = document.querySelector('[data-sort-key="name"]');
    if (th) th.classList.add("active-sort");
    if (indicators.name) indicators.name.textContent = currentSort === "name-asc" ? "▲" : "▼";
  } else if (currentSort.startsWith("r1")) {
    const th = document.querySelector('[data-sort-key="r1"]');
    if (th) th.classList.add("active-sort");
    if (indicators.r1) indicators.r1.textContent = currentSort === "r1-desc" ? "▼" : "▲";
  } else if (currentSort.startsWith("r2")) {
    const th = document.querySelector('[data-sort-key="r2"]');
    if (th) th.classList.add("active-sort");
    if (indicators.r2) indicators.r2.textContent = currentSort === "r2-desc" ? "▼" : "▲";
  } else if (currentSort.startsWith("r3")) {
    const th = document.querySelector('[data-sort-key="r3"]');
    if (th) th.classList.add("active-sort");
    if (indicators.r3) indicators.r3.textContent = currentSort === "r3-desc" ? "▼" : "▲";
  } else if (currentSort.startsWith("r4")) {
    const th = document.querySelector('[data-sort-key="r4"]');
    if (th) th.classList.add("active-sort");
    if (indicators.r4) indicators.r4.textContent = currentSort === "r4-desc" ? "▼" : "▲";
  }
}

// Render Teams Table: Submissions & Scores with Score-based Sorting & Ranks
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

  // Calculate global leaderboard rank map based on total score descending
  const rankSorted = [...allTeams].sort((a, b) => {
    return parseFloat(calculateTotalScore(b)) - parseFloat(calculateTotalScore(a));
  });
  const rankMap = new Map();
  rankSorted.forEach((t, idx) => {
    rankMap.set(t.id, idx + 1);
  });

  // Sort filtered list according to chosen mode
  filtered.sort((a, b) => {
    const scoreA = parseFloat(calculateTotalScore(a));
    const scoreB = parseFloat(calculateTotalScore(b));
    const numA = Number(a.teamNumber) || 0;
    const numB = Number(b.teamNumber) || 0;

    switch (sortMode) {
      case "score-desc":
        return scoreB - scoreA;
      case "score-asc":
        return scoreA - scoreB;
      case "r1-desc": {
        const rA = Number(getRoundData(a, 1)?.score) || 0;
        const rB = Number(getRoundData(b, 1)?.score) || 0;
        return rB - rA;
      }
      case "r2-desc": {
        const rA = Number(getRoundData(a, 2)?.score) || 0;
        const rB = Number(getRoundData(b, 2)?.score) || 0;
        return rB - rA;
      }
      case "r3-desc": {
        const rA = Number(getRoundData(a, 3)?.score) || 0;
        const rB = Number(getRoundData(b, 3)?.score) || 0;
        return rB - rA;
      }
      case "r4-desc": {
        const rA = Number(getRoundData(a, 4)?.score) || 0;
        const rB = Number(getRoundData(b, 4)?.score) || 0;
        return rB - rA;
      }
      case "num-asc":
        return numA - numB;
      case "num-desc":
        return numB - numA;
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

  // Update header indicators
  updateSortIndicators(sortMode);

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

    // 0. Leaderboard Rank Column
    const rank = rankMap.get(team.id) || 1;
    const tdRank = document.createElement("td");
    tdRank.className = "col-rank";
    let rankBadgeClass = "rank-other";
    let rankLabel = `#${rank}`;
    if (rank === 1) {
      rankBadgeClass = "rank-1";
      rankLabel = "🥇 #1";
    } else if (rank === 2) {
      rankBadgeClass = "rank-2";
      rankLabel = "🥈 #2";
    } else if (rank === 3) {
      rankBadgeClass = "rank-3";
      rankLabel = "🥉 #3";
    }
    tdRank.innerHTML = `<span class="rank-badge ${rankBadgeClass}">${rankLabel}</span>`;
    tr.appendChild(tdRank);

    // 1. Team Number Column
    const tdNum = document.createElement("td");
    tdNum.className = "col-num";
    tdNum.innerHTML = `<span class="team-badge">#${escapeHtml(String(team.teamNumber))}</span>`;
    tr.appendChild(tdNum);

    // 2. Team Name & ID Column
    const tdName = document.createElement("td");
    tdName.className = "col-name";
    tdName.innerHTML = `
      <div class="team-name-cell">${escapeHtml(team.teamName)}</div>
      <div style="font-size: 0.75rem; color: #86efac; font-family: var(--font-mono); margin-top: 2px;">
        ${escapeHtml(team.teamId || team.id)}
      </div>
    `;
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
        const scoreVal = rd.score !== undefined && rd.score !== null ? Number(rd.score).toFixed(2) : "0.00";
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
              <span style="font-size: 0.72rem; color: #64748b; font-family: var(--font-mono);">0.00 pts</span>
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
    evalScoreInput.value = rd.score !== undefined && rd.score !== null ? Number(rd.score).toFixed(2) : "0.00";
    if (evalKeywordBreakdown) evalKeywordBreakdown.innerHTML = "";
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
    evalScoreInput.value = (rd && rd.score !== undefined) ? Number(rd.score).toFixed(2) : "0.00";
    if (evalKeywordBreakdown) evalKeywordBreakdown.innerHTML = "";
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

    const val = parseFloat(Number(evalScoreInput.value).toFixed(2));
    if (isNaN(val) || val < 0 || val > 100) {
      showToast("Please enter a valid score between 0.00 and 100.00.", "error");
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

      showToast(`Score (${val.toFixed(2)} pts) saved inside lvl${currentEvalLevel} for ${currentEvalTeam.teamName}!`, "success");
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

// Auto-Score Keywords Evaluation Button Listener
if (evalAutoScoreBtn) {
  evalAutoScoreBtn.addEventListener("click", () => {
    if (!currentEvalTeam) return;
    const rd = getRoundData(currentEvalTeam, currentEvalLevel);
    if (!rd || (!rd.scenarios && !rd.resp)) {
      showToast("No submitted prompt found to evaluate for this round.", "warning");
      return;
    }

    const result = evaluateLevelSubmission(currentEvalLevel, rd);
    if (evalScoreInput) {
      evalScoreInput.value = result.levelScore.toFixed(2);
    }

    if (evalKeywordBreakdown) {
      const summaryList = result.scenariosBreakdown.map((sb, i) => {
        const title = sb.title || `Part ${i + 1}`;
        const matched = sb.matchedCore.concat(sb.matchedSemantic);
        const matchPreview = matched.length > 0 
          ? matched.slice(0, 6).join(", ") + (matched.length > 6 ? "..." : "") 
          : "None";
        const negNotice = sb.negativeViolations.length > 0
          ? ` <span style="color:#ef4444;">(-${(sb.negativeViolations.length * 15).toFixed(2)} pts for banned words: ${sb.negativeViolations.join(", ")})</span>`
          : "";
        return `<div style="margin-top: 4px;"><strong>${escapeHtml(title)}:</strong> ${sb.score.toFixed(2)} pts (Matched: <span style="color:#86efac;">${escapeHtml(matchPreview)}</span>)${negNotice}</div>`;
      }).join("");

      evalKeywordBreakdown.innerHTML = `
        <div style="background: rgba(134, 239, 172, 0.08); border: 1px solid rgba(134, 239, 172, 0.3); border-radius: 4px; padding: 10px 12px; margin-top: 8px;">
          <div style="color: #86efac; font-weight: 700; margin-bottom: 2px;">⚡ Keyword Relevance Score: ${result.levelScore.toFixed(2)} / 100.00</div>
          ${summaryList}
        </div>
      `;
    }

    showToast(`Keyword score calculated: ${result.levelScore.toFixed(2)} pts! Click 'Save Score' to confirm.`, "info");
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

// ==========================================
// Robust File Export & Download Helpers
// ==========================================
function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// RFC 4180 CSV Field Escaping
function csvField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

// 1. Export Leaderboard Summary CSV (Judges Sheet)
function exportLeaderboardCsv() {
  if (allTeams.length === 0) {
    showToast("No team data available to export.", "error");
    return;
  }

  // Rank teams strictly by total score
  const ranked = [...allTeams].sort((a, b) => {
    return parseFloat(calculateTotalScore(b)) - parseFloat(calculateTotalScore(a));
  });

  const headers = [
    "Rank", "Team Number", "Team ID", "Team Name", "Leader Name",
    "Round 1 Score", "Round 2 Score", "Round 3 Score", "Round 4 Score",
    "Total Score", "Completed Rounds", "Status", "Last Active"
  ];

  const rows = [headers.map(csvField).join(",")];

  ranked.forEach((t, idx) => {
    const r1 = getRoundData(t, 1);
    const r2 = getRoundData(t, 2);
    const r3 = getRoundData(t, 3);
    const r4 = getRoundData(t, 4);

    const s1 = r1 && typeof r1.score === "number" ? r1.score.toFixed(2) : "0.00";
    const s2 = r2 && typeof r2.score === "number" ? r2.score.toFixed(2) : "0.00";
    const s3 = r3 && typeof r3.score === "number" ? r3.score.toFixed(2) : "0.00";
    const s4 = r4 && typeof r4.score === "number" ? r4.score.toFixed(2) : "0.00";
    const total = calculateTotalScore(t);

    let completedCount = 0;
    if (r1 && (r1.resp || r1.scenarios)) completedCount++;
    if (r2 && (r2.resp || r2.scenarios)) completedCount++;
    if (r3 && (r3.resp || r3.scenarios)) completedCount++;
    if (r4 && (r4.resp || r4.scenarios)) completedCount++;

    const status = completedCount === 4 ? "Completed (4/4)" : `${completedCount}/4 Rounds`;
    const lastActive = r4?.time || r3?.time || r2?.time || r1?.time || formatTimestamp(t);

    rows.push([
      csvField(idx + 1),
      csvField(t.teamNumber || ""),
      csvField(t.teamId || t.id),
      csvField(t.teamName || ""),
      csvField(t.leaderName || ""),
      csvField(s1),
      csvField(s2),
      csvField(s3),
      csvField(s4),
      csvField(total),
      csvField(`${completedCount}/4`),
      csvField(status),
      csvField(lastActive)
    ].join(","));
  });

  const csvContent = "\uFEFF" + rows.join("\r\n");
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadBlob(`Promptathon_Leaderboard_Summary_${dateStr}.csv`, csvContent, "text/csv;charset=utf-8;");
  showToast(`Leaderboard summary exported (${ranked.length} teams)!`, "success");
}

// 2. Export Full Submissions & Prompts CSV
function exportPromptsCsv() {
  if (allTeams.length === 0) {
    showToast("No team data available to export.", "error");
    return;
  }

  const ranked = [...allTeams].sort((a, b) => {
    return parseFloat(calculateTotalScore(b)) - parseFloat(calculateTotalScore(a));
  });

  const headers = [
    "Rank", "Team Number", "Team ID", "Team Name", "Leader Name",
    "R1 Score", "R1 Prompt Submissions",
    "R2 Score", "R2 Prompt Submissions",
    "R3 Score", "R3 Prompt Submissions",
    "R4 Score", "R4 Prompt Submissions",
    "Total Score"
  ];

  const rows = [headers.map(csvField).join(",")];

  ranked.forEach((t, idx) => {
    const r1 = getRoundData(t, 1);
    const r2 = getRoundData(t, 2);
    const r3 = getRoundData(t, 3);
    const r4 = getRoundData(t, 4);

    function formatPromptText(rd) {
      if (!rd) return "";
      if (rd.scenarios) {
        return Object.entries(rd.scenarios)
          .map(([k, v]) => `[${k.toUpperCase()}]: ${v}`)
          .join(" | ");
      }
      return rd.resp || "";
    }

    rows.push([
      csvField(idx + 1),
      csvField(t.teamNumber || ""),
      csvField(t.teamId || t.id),
      csvField(t.teamName || ""),
      csvField(t.leaderName || ""),
      csvField(r1 && typeof r1.score === "number" ? r1.score.toFixed(2) : "0.00"),
      csvField(formatPromptText(r1)),
      csvField(r2 && typeof r2.score === "number" ? r2.score.toFixed(2) : "0.00"),
      csvField(formatPromptText(r2)),
      csvField(r3 && typeof r3.score === "number" ? r3.score.toFixed(2) : "0.00"),
      csvField(formatPromptText(r3)),
      csvField(r4 && typeof r4.score === "number" ? r4.score.toFixed(2) : "0.00"),
      csvField(formatPromptText(r4)),
      csvField(calculateTotalScore(t))
    ].join(","));
  });

  const csvContent = "\uFEFF" + rows.join("\r\n");
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadBlob(`Promptathon_Full_Submissions_${dateStr}.csv`, csvContent, "text/csv;charset=utf-8;");
  showToast(`Full submissions and prompts archive exported!`, "success");
}

// 3. Export Raw Database Snapshot JSON
function exportRawJson() {
  if (allTeams.length === 0) {
    showToast("No team data available to export.", "error");
    return;
  }

  const exportPayload = {
    event: "Promptathon 2026",
    exportedAt: new Date().toISOString(),
    totalTeams: allTeams.length,
    teams: allTeams.map(t => {
      const copy = { ...t };
      copy.totalScore = parseFloat(calculateTotalScore(t));
      return copy;
    })
  };

  const jsonContent = JSON.stringify(exportPayload, null, 2);
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadBlob(`Promptathon_Database_Backup_${dateStr}.json`, jsonContent, "application/json");
  showToast("Raw JSON database snapshot downloaded!", "success");
}

// Dropdown Toggle Handlers
if (downloadMenuBtn && downloadDropdownMenu) {
  downloadMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    downloadDropdownMenu.classList.toggle("show");
  });

  document.addEventListener("click", () => {
    downloadDropdownMenu.classList.remove("show");
  });
}

if (exportLeaderboardCsvBtn) {
  exportLeaderboardCsvBtn.addEventListener("click", () => {
    if (downloadDropdownMenu) downloadDropdownMenu.classList.remove("show");
    exportLeaderboardCsv();
  });
}

if (exportPromptsCsvBtn) {
  exportPromptsCsvBtn.addEventListener("click", () => {
    if (downloadDropdownMenu) downloadDropdownMenu.classList.remove("show");
    exportPromptsCsv();
  });
}

if (exportRawJsonBtn) {
  exportRawJsonBtn.addEventListener("click", () => {
    if (downloadDropdownMenu) downloadDropdownMenu.classList.remove("show");
    exportRawJson();
  });
}

// Column Header Click Handlers for Interactive Sorting
document.querySelectorAll(".sortable-th").forEach(th => {
  th.addEventListener("click", () => {
    const key = th.getAttribute("data-sort-key");
    const current = sortSelect.value;
    let nextSort = "score-desc";

    if (key === "rank" || key === "score") {
      nextSort = current === "score-desc" ? "score-asc" : "score-desc";
    } else if (key === "num") {
      nextSort = current === "num-asc" ? "num-desc" : "num-asc";
    } else if (key === "name") {
      nextSort = current === "name-asc" ? "name-desc" : "name-asc";
    } else if (key === "r1") {
      nextSort = current === "r1-desc" ? "r1-asc" : "r1-desc";
    } else if (key === "r2") {
      nextSort = current === "r2-desc" ? "r2-asc" : "r2-desc";
    } else if (key === "r3") {
      nextSort = current === "r3-desc" ? "r3-asc" : "r3-desc";
    } else if (key === "r4") {
      nextSort = current === "r4-desc" ? "r4-asc" : "r4-desc";
    }

    sortSelect.value = nextSort;
    renderTable();
  });
});

// Judge Finalize Modal Logic
function openJudgeModal() {
  if (!judgeModal) return;

  const ranked = [...allTeams].sort((a, b) => {
    return parseFloat(calculateTotalScore(b)) - parseFloat(calculateTotalScore(a));
  });

  // 1. Populate Top 3 Podium
  if (judgePodiumContainer) {
    const podiumItems = [
      { rank: 1, label: "Champion 🥇", class: "first", color: "#fde047" },
      { rank: 2, label: "Runner Up 🥈", class: "second", color: "#f1f5f9" },
      { rank: 3, label: "3rd Place 🥉", class: "third", color: "#fdba74" }
    ];

    judgePodiumContainer.innerHTML = podiumItems.map(p => {
      const team = ranked[p.rank - 1];
      if (!team) {
        return `
          <div class="judge-podium-card ${p.class}">
            <div style="font-size: 0.75rem; font-weight: 700; color: ${p.color}; text-transform: uppercase;">${p.label}</div>
            <div style="font-size: 1.15rem; font-weight: 800; color: #64748b;">Vacant</div>
            <div style="font-size: 0.8rem; color: #64748b;">No submission</div>
          </div>
        `;
      }

      const total = calculateTotalScore(team);
      const r1 = getRoundData(team, 1)?.score || 0;
      const r2 = getRoundData(team, 2)?.score || 0;
      const r3 = getRoundData(team, 3)?.score || 0;
      const r4 = getRoundData(team, 4)?.score || 0;

      return `
        <div class="judge-podium-card ${p.class}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.72rem; font-weight: 800; color: ${p.color}; text-transform: uppercase; letter-spacing: 0.05em;">${p.label}</span>
            <span style="font-family: var(--font-mono); font-size: 0.72rem; color: #94a3b8;">Team #${escapeHtml(String(team.teamNumber))}</span>
          </div>
          <div style="font-size: 1.25rem; font-weight: 800; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeHtml(team.teamName)}
          </div>
          <div style="font-family: var(--font-mono); font-size: 1.15rem; font-weight: 800; color: ${p.color};">
            ${total} <span style="font-size: 0.75rem; color: #94a3b8;">pts</span>
          </div>
          <div style="font-size: 0.72rem; color: #94a3b8; font-family: var(--font-mono); margin-top: 4px;">
            R1: ${r1.toFixed(2)} | R2: ${r2.toFixed(2)} | R3: ${r3.toFixed(2)} | R4: ${r4.toFixed(2)}
          </div>
        </div>
      `;
    }).join("");
  }

  // 2. Populate Summary Analytics
  let totalScoreSum = 0;
  let scoredTeamsCount = 0;
  let totalSubs = 0;

  ranked.forEach(t => {
    const score = parseFloat(calculateTotalScore(t));
    totalScoreSum += score;
    if (score > 0) scoredTeamsCount++;

    for (let lvl = 1; lvl <= 4; lvl++) {
      const rd = getRoundData(t, lvl);
      if (rd && (rd.scenarios || rd.resp)) totalSubs++;
    }
  });

  const avg = ranked.length > 0 ? (totalScoreSum / ranked.length) : 0;
  const topWinningScore = ranked[0] ? calculateTotalScore(ranked[0]) : "0.00";

  if (judgeSummaryTeams) judgeSummaryTeams.textContent = `${ranked.length} Teams`;
  if (judgeSummaryTop) judgeSummaryTop.textContent = `${topWinningScore} pts`;
  if (judgeSummaryAvg) judgeSummaryAvg.textContent = `${avg.toFixed(2)} pts`;
  if (judgeSummarySubs) judgeSummarySubs.textContent = `${totalSubs} / ${ranked.length * 4}`;

  // 3. Populate Mini Table
  if (judgeTableBody) {
    judgeTableBody.innerHTML = ranked.map((t, idx) => {
      const r1 = (getRoundData(t, 1)?.score || 0).toFixed(2);
      const r2 = (getRoundData(t, 2)?.score || 0).toFixed(2);
      const r3 = (getRoundData(t, 3)?.score || 0).toFixed(2);
      const r4 = (getRoundData(t, 4)?.score || 0).toFixed(2);
      const total = calculateTotalScore(t);

      let medal = `#${idx + 1}`;
      if (idx === 0) medal = `🥇 #1`;
      else if (idx === 1) medal = `🥈 #2`;
      else if (idx === 2) medal = `🥉 #3`;

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 6px 12px; font-weight: 700; color: #fde047;">${medal}</td>
          <td style="padding: 6px 12px; color: #ffffff;">
            <strong>${escapeHtml(t.teamName)}</strong> <span style="font-size: 0.72rem; color: #94a3b8;">(#${escapeHtml(String(t.teamNumber))})</span>
          </td>
          <td style="padding: 6px 12px; font-family: var(--font-mono); color: #94a3b8;">${r1}</td>
          <td style="padding: 6px 12px; font-family: var(--font-mono); color: #94a3b8;">${r2}</td>
          <td style="padding: 6px 12px; font-family: var(--font-mono); color: #94a3b8;">${r3}</td>
          <td style="padding: 6px 12px; font-family: var(--font-mono); color: #94a3b8;">${r4}</td>
          <td style="padding: 6px 12px; font-family: var(--font-mono); font-weight: 800; color: #86efac;">${total}</td>
        </tr>
      `;
    }).join("");
  }

  judgeModal.classList.remove("hidden");
}

function closeJudgeModal() {
  if (judgeModal) judgeModal.classList.add("hidden");
}

if (judgeFinalizeBtn) {
  judgeFinalizeBtn.addEventListener("click", openJudgeModal);
}

if (closeJudgeModalBtn) {
  closeJudgeModalBtn.addEventListener("click", closeJudgeModal);
}

if (judgeModal) {
  judgeModal.addEventListener("click", (e) => {
    if (e.target === judgeModal) closeJudgeModal();
  });
}

if (judgePrintBtn) {
  judgePrintBtn.addEventListener("click", () => {
    window.print();
  });
}

if (judgeExportCsvBtn) {
  judgeExportCsvBtn.addEventListener("click", () => {
    exportLeaderboardCsv();
  });
}

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
