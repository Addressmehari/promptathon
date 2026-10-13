// Firebase Firestore & Modular SDK Imports
import { 
  doc, 
  getDoc, 
  setDoc,
  onSnapshot,
  deleteField,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { initFirebaseFromEnv } from "./firebase-config.js";

/**
 * Initializes Level Page session, previous response loading, and Firestore submission
 * @param {number} levelNumber (1, 2, 3, or 4)
 */
export async function initLevelPage(levelNumber) {
  // 1. Verify logged-in session
  const sessionData = sessionStorage.getItem("promptathon_active_team");
  if (!sessionData) {
    window.location.href = "index.html";
    return;
  }

  let team = null;
  try {
    team = JSON.parse(sessionData);
  } catch (e) {
    window.location.href = "index.html";
    return;
  }

  // Progression Gate: Level 2, 3, 4 require completion of previous round
  if (levelNumber > 1) {
    const priorLevel = levelNumber - 1;
    const priorCompleted = Boolean(
      team[`lvl${priorLevel}`]?.resp ||
      team[`level_${priorLevel}_response`] ||
      team[`level-${priorLevel}-response`]
    );
    if (!priorCompleted) {
      alert(`Level ${levelNumber} is locked! You must complete Level ${priorLevel} first.`);
      window.location.href = "index.html";
      return;
    }
  }

  // Populate header team badge & name
  const badgeEl = document.getElementById("level-team-badge");
  const nameEl = document.getElementById("level-team-name");
  if (badgeEl) badgeEl.textContent = team.teamId || "ACTIVE TEAM";
  if (nameEl) nameEl.textContent = team.teamName || "Team Contestant";

  const promptInput = document.getElementById("level-prompt-input");
  const submitBtn = document.getElementById("submit-level-btn");
  const toastContainer = document.getElementById("toast-container");

  // Toast notification helper
  function showToast(message, type = "success") {
    if (!toastContainer) {
      alert(message);
      return;
    }
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

  // 2. Connect to Firestore
  let db = null;
  try {
    const fb = await initFirebaseFromEnv();
    db = fb.db;
  } catch (err) {
    console.warn("Firestore connection warning in level:", err.message);
  }

  // 3. Lock & Unlock state helpers
  let isAlreadySubmitted = false;
  let existingScore = 0;

  function lockAsSubmitted(responseText, submissionTime) {
    isAlreadySubmitted = true;
    if (promptInput) {
      if (responseText) promptInput.value = responseText;
      promptInput.readOnly = true;
      promptInput.style.cursor = "not-allowed";
      promptInput.style.opacity = "0.85";
      promptInput.style.borderColor = "rgba(134, 239, 172, 0.4)";
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add("btn-locked");
      submitBtn.style.cursor = "not-allowed";
      submitBtn.style.opacity = "0.75";
      submitBtn.style.background = "rgba(134, 239, 172, 0.12)";
      submitBtn.style.borderColor = "rgba(134, 239, 172, 0.35)";
      submitBtn.style.color = "#86efac";
      submitBtn.style.pointerEvents = "none";
      const btnText = submitBtn.querySelector(".btn-text");
      if (btnText) {
        btnText.innerHTML = `🔒 Level ${levelNumber} Submitted & Locked`;
      }
    }

    let lockNotice = document.getElementById("level-locked-notice");
    if (!lockNotice && promptInput) {
      lockNotice = document.createElement("div");
      lockNotice.id = "level-locked-notice";
      lockNotice.className = "level-locked-badge";
      lockNotice.style.cssText = "display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 10px 14px; background: rgba(134, 239, 172, 0.08); border: 1px solid rgba(134, 239, 172, 0.3); border-radius: 4px; font-size: 0.82rem; color: #86efac; font-family: var(--font-mono, monospace);";
      lockNotice.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <span><strong>LOCKED:</strong> Response submitted${submissionTime ? ` on ${submissionTime}` : ""}. Further submissions for this round are locked.</span>
      `;
      promptInput.parentNode.insertBefore(lockNotice, promptInput.nextSibling);
    }
  }

  function unlockState(notify = false) {
    const wasLocked = isAlreadySubmitted;
    isAlreadySubmitted = false;

    if (promptInput) {
      promptInput.readOnly = false;
      promptInput.style.cursor = "text";
      promptInput.style.opacity = "1";
      promptInput.style.borderColor = "";
      if (wasLocked) promptInput.value = "";
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.classList.remove("btn-locked");
      submitBtn.style.cursor = "pointer";
      submitBtn.style.opacity = "1";
      submitBtn.style.background = "";
      submitBtn.style.borderColor = "";
      submitBtn.style.color = "";
      submitBtn.style.pointerEvents = "auto";
      const btnText = submitBtn.querySelector(".btn-text");
      if (btnText) {
        btnText.innerHTML = `Submit Level ${levelNumber} Response &rarr;`;
      }
    }

    const lockNotice = document.getElementById("level-locked-notice");
    if (lockNotice) {
      lockNotice.remove();
    }

    // Clean up local cache and session so database is single source of truth
    localStorage.removeItem(`team_${team.teamId}_level_${levelNumber}`);
    if (team[`lvl${levelNumber}`]) delete team[`lvl${levelNumber}`];
    if (team[`level_${levelNumber}_response`]) delete team[`level_${levelNumber}_response`];
    if (team[`level-${levelNumber}-response`]) delete team[`level-${levelNumber}-response`];
    sessionStorage.setItem("promptathon_active_team", JSON.stringify(team));

    if (notify && wasLocked) {
      showToast(`Level ${levelNumber} was unlocked in database! You can now submit again.`, "info");
    }
  }

  // 4. Real-time Firestore sync: DB is Single Source of Truth
  // If response exists in DB -> Locked. If deleted from DB -> Instantly UNLOCKED!
  if (db && team.teamId) {
    onSnapshot(doc(db, "registrations", team.teamId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();

        // Live progression check: if prior level was reset/deleted, redirect to dashboard
        if (levelNumber > 1) {
          const priorLevel = levelNumber - 1;
          const priorCompleted = Boolean(
            data[`lvl${priorLevel}`]?.resp ||
            data[`level_${priorLevel}_response`] ||
            data[`level-${priorLevel}-response`]
          );
          if (!priorCompleted) {
            alert(`Level ${priorLevel} is no longer completed in database. Redirecting to mission map.`);
            window.location.href = "index.html";
            return;
          }
        }

        if (data[`lvl${levelNumber}`]?.score !== undefined) {
          existingScore = data[`lvl${levelNumber}`].score;
        }
        const remoteResponse = data[`lvl${levelNumber}`]?.resp ||
                               data[`level_${levelNumber}_response`] || 
                               data[`level-${levelNumber}-response`];
        if (remoteResponse) {
          lockAsSubmitted(remoteResponse, data[`lvl${levelNumber}`]?.time);
        } else {
          // Field was deleted from database -> Unlock!
          unlockState(true);
        }
      } else {
        // Document was deleted -> Unlock!
        unlockState(true);
      }
    }, (error) => {
      console.warn("Firestore listener warning:", error.message);
    });
  } else {
    // Fallback check from session if offline
    const sessionResponse = team[`lvl${levelNumber}`]?.resp || team[`level_${levelNumber}_response`];
    if (sessionResponse) {
      lockAsSubmitted(sessionResponse, team[`lvl${levelNumber}`]?.time);
    }
  }

  // 4. Handle Submit Button Click
  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      // Guard against duplicate submission
      if (isAlreadySubmitted) {
        showToast("This level has already been submitted and is locked.", "warning");
        return;
      }

      const promptVal = promptInput?.value?.trim();
      if (!promptVal) {
        showToast("Please enter your prompt before submitting.", "error");
        promptInput?.focus();
        return;
      }

      const btnTextEl = submitBtn.querySelector(".btn-text");
      submitBtn.disabled = true;
      if (btnTextEl) btnTextEl.textContent = "Saving & Locking...";

      const lvlPayload = {
        resp: promptVal,
        score: existingScore,
        time: new Date().toLocaleString()
      };

      try {
        // Save clean lvl1 / lvl2 / lvl3 / lvl4 map to Firestore
        if (db && team.teamId) {
          const docRef = doc(db, "registrations", team.teamId);
          await setDoc(docRef, {
            [`lvl${levelNumber}`]: lvlPayload,
            // Clean up any legacy flat fields
            [`level_${levelNumber}_response`]: deleteField(),
            [`level-${levelNumber}-response`]: deleteField(),
            [`level_${levelNumber}_details`]: deleteField(),
            [`level_${levelNumber}_submitted_at`]: deleteField(),
            lastUpdatedLevel: deleteField()
          }, { merge: true });
          console.log(`Saved clean lvl${levelNumber} map to Firestore for team:`, team.teamId);
        }

        // Cache locally in browser
        localStorage.setItem(`team_${team.teamId}_level_${levelNumber}`, JSON.stringify(lvlPayload));

        // Update active team session data
        team[`lvl${levelNumber}`] = lvlPayload;
        delete team[`level_${levelNumber}_response`];
        delete team[`level-${levelNumber}-response`];
        sessionStorage.setItem("promptathon_active_team", JSON.stringify(team));

        // Lock button and textarea permanently so contestant cannot submit again
        lockAsSubmitted(promptVal, lvlPayload.time);

        // Confetti celebration & feedback
        if (typeof confetti === "function") {
          confetti({ particleCount: 70, spread: 70, origin: { y: 0.6 } });
        }
        showToast(`Level ${levelNumber} response submitted! Round is now locked.`, "success");

      } catch (err) {
        console.error("Submission error:", err);
        // Fallback save in localStorage & session
        localStorage.setItem(`team_${team.teamId}_level_${levelNumber}`, JSON.stringify(lvlPayload));
        team[`lvl${levelNumber}`] = lvlPayload;
        sessionStorage.setItem("promptathon_active_team", JSON.stringify(team));
        lockAsSubmitted(promptVal, lvlPayload.time);
        showToast(`Saved locally! (Database sync pending)`, "warning");
      }
    });
  }
}
