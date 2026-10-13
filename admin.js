// Firebase Modular SDK imports
import { 
  collection, 
  onSnapshot, 
  doc, 
  deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { initFirebaseFromEnv } from "./firebase-config.js";

// State
let db = null;
let allTeams = [];
let pendingDeleteId = null;
let cachedAdminAuth = null;
let isAuthenticated = false;

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
const statLatestTeam = document.getElementById("stat-latest-team");
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

// Update Metric Cards
function updateStats(teams) {
  statTotalTeams.textContent = teams.length;

  if (teams.length > 0) {
    // Sort copy by createdAt / arrival to find latest
    const sortedByArrival = [...teams].sort((a, b) => {
      const timeA = a.createdAt?.seconds || 0;
      const timeB = b.createdAt?.seconds || 0;
      return timeB - timeA;
    });

    const latest = sortedByArrival[0];
    statLatestTeam.textContent = `Team #${latest.teamNumber}: ${latest.teamName}`;
    statLatestTime.textContent = formatTimestamp(latest);
  } else {
    statLatestTeam.textContent = "None yet";
    statLatestTime.textContent = "Waiting for first submission";
  }
}

// Render Teams Table
function renderTable() {
  const query = searchInput.value.trim().toLowerCase();
  const sortMode = sortSelect.value;

  // Filter
  let filtered = allTeams.filter(team => {
    const numMatch = String(team.teamNumber || "").toLowerCase().includes(query);
    const nameMatch = (team.teamName || "").toLowerCase().includes(query);
    return numMatch || nameMatch;
  });

  // Sort
  filtered.sort((a, b) => {
    switch (sortMode) {
      case "num-asc":
        return (Number(a.teamNumber) || 0) - (Number(b.teamNumber) || 0);
      case "num-desc":
        return (Number(b.teamNumber) || 0) - (Number(a.teamNumber) || 0);
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
    showingCount.textContent = `${allTeams.length} registered team${allTeams.length === 1 ? "" : "s"}`;
  }

  // Handle Empty States
  if (filtered.length === 0) {
    emptyState.classList.remove("hidden");
    if (query) {
      emptyStateDesc.textContent = `No teams matched the search "${query}".`;
    } else {
      emptyStateDesc.textContent = "Teams registered via the registration portal will appear here in real-time.";
    }
    return;
  }

  emptyState.classList.add("hidden");

  // Populate Rows
  const fragment = document.createDocumentFragment();

  filtered.forEach(team => {
    const tr = document.createElement("tr");

    // Team Number Column
    const tdNum = document.createElement("td");
    tdNum.className = "col-num";
    tdNum.innerHTML = `<span class="team-badge">#${escapeHtml(String(team.teamNumber))}</span>`;

    // Team Name & Leader Column
    const tdName = document.createElement("td");
    tdName.className = "col-name";
    const leaderHtml = team.leaderName ? `<div style="font-size: 0.75rem; color: #86efac; margin-top: 3px;">Leader: ${escapeHtml(team.leaderName)}</div>` : '';
    tdName.innerHTML = `<span class="team-name-cell">${escapeHtml(team.teamName)}</span>${leaderHtml}`;

    // Team ID Column
    const tdId = document.createElement("td");
    tdId.className = "col-id";
    tdId.innerHTML = `<code class="doc-code" style="font-weight: 700; color: #86efac;">${escapeHtml(team.teamId || team.id)}</code>`;

    // Access PIN Column
    const tdPin = document.createElement("td");
    tdPin.className = "col-pin";
    tdPin.innerHTML = team.password ? `<span style="display:inline-block; padding: 2px 8px; background: rgba(134, 239, 172, 0.1); border: 1px solid rgba(134, 239, 172, 0.25); border-radius: 3px; font-family: var(--font-mono); font-weight: 700; color: #86efac;">${escapeHtml(team.password)}</span>` : '<span style="color:#64748b;">-</span>';

    // Registration Time Column
    const tdTime = document.createElement("td");
    tdTime.className = "col-time";
    tdTime.textContent = formatTimestamp(team);

    // Actions Column
    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    
    const delBtn = document.createElement("button");
    delBtn.className = "table-btn-delete";
    delBtn.title = "Delete Registration";
    delBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="del-icon">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
      <span>Delete</span>
    `;
    delBtn.addEventListener("click", () => openDeleteModal(team));
    tdActions.appendChild(delBtn);

    tr.appendChild(tdNum);
    tr.appendChild(tdName);
    tr.appendChild(tdId);
    tr.appendChild(tdPin);
    tr.appendChild(tdTime);
    tr.appendChild(tdActions);

    fragment.appendChild(tr);
  });

  teamsTbody.appendChild(fragment);
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
    ["Team Number", "Creative Team ID", "Original ID", "Team Name", "Team Leader", "Participants", "Access PIN", "Registration Time"]
  ];

  allTeams.forEach(t => {
    csvRows.push([
      `"${t.teamNumber || ""}"`,
      `"${t.teamId || t.id}"`,
      `"${t.originalId || ""}"`,
      `"${(t.teamName || "").replace(/"/g, '""')}"`,
      `"${(t.leaderName || "").replace(/"/g, '""')}"`,
      `"${(t.participants || "").replace(/"/g, '""')}"`,
      `"${t.password || ""}"`,
      `"${formatTimestamp(t)}"`
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
        allTeams.push({
          id: docSnap.id,
          ...docSnap.data()
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
