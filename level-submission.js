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
 * Initializes Level Page session, previous response loading, and multi-scenario Firestore submission
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
      team[`lvl${priorLevel}`]?.scenarios ||
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

  // Elements for 3 scenarios
  const scenario1Input = document.getElementById("scenario-1-input");
  const scenario2Input = document.getElementById("scenario-2-input");
  const scenario3Input = document.getElementById("scenario-3-input");
  const singleLegacyInput = document.getElementById("level-prompt-input");

  const scenario1Pill = document.getElementById("scenario-1-status");
  const scenario2Pill = document.getElementById("scenario-2-status");
  const scenario3Pill = document.getElementById("scenario-3-status");
  const progressBadge = document.getElementById("progress-count-badge");

  const submitBtn = document.getElementById("submit-level-btn");
  const toastContainer = document.getElementById("toast-container");

  // Helper: Live scenario completion indicators
  function updateProgress() {
    let completedCount = 0;
    if (scenario1Input) {
      const isFilled = Boolean(scenario1Input.value.trim());
      if (isFilled) completedCount++;
      if (scenario1Pill) {
        scenario1Pill.textContent = isFilled ? "✓ Completed" : "Pending";
        scenario1Pill.className = `scenario-status-pill ${isFilled ? "filled" : ""}`;
      }
    }
    if (scenario2Input) {
      const isFilled = Boolean(scenario2Input.value.trim());
      if (isFilled) completedCount++;
      if (scenario2Pill) {
        scenario2Pill.textContent = isFilled ? "✓ Completed" : "Pending";
        scenario2Pill.className = `scenario-status-pill ${isFilled ? "filled" : ""}`;
      }
    }
    if (scenario3Input) {
      const isFilled = Boolean(scenario3Input.value.trim());
      if (isFilled) completedCount++;
      if (scenario3Pill) {
        scenario3Pill.textContent = isFilled ? "✓ Completed" : "Pending";
        scenario3Pill.className = `scenario-status-pill ${isFilled ? "filled" : ""}`;
      }
    }
    if (progressBadge) {
      progressBadge.textContent = `${completedCount} / 3 COMPLETED`;
      if (completedCount === 3) {
        progressBadge.style.color = "#86efac";
        progressBadge.style.borderColor = "rgba(134, 239, 172, 0.4)";
        progressBadge.style.background = "rgba(134, 239, 172, 0.15)";
      } else {
        progressBadge.style.color = "#fde047";
        progressBadge.style.borderColor = "rgba(253, 224, 71, 0.3)";
        progressBadge.style.background = "rgba(253, 224, 71, 0.08)";
      }
    }
  }

  [scenario1Input, scenario2Input, scenario3Input].forEach(inp => {
    if (inp) {
      inp.addEventListener("input", updateProgress);
    }
  });

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

  // 2. Connect to Firestore & Timer Configuration (Strictly Database-Driven)
  const LEVEL_DURATION_MINUTES = 40;
  const LEVEL_DURATION_MS = LEVEL_DURATION_MINUTES * 60 * 1000;
  let levelTimerInterval = null;
  let levelStartedAt = null;
  let isTimeExpired = false;
  let isRecordingStartTime = false;

  const timerBadge = document.getElementById("level-timer-badge");
  const timerClock = document.getElementById("level-timer-clock");

  // Always clear any stale localStorage keys so client timer never diverges from database
  try {
    localStorage.removeItem(`team_${team.teamId}_level_${levelNumber}_startedAt`);
  } catch (e) {}

  let db = null;
  try {
    const fb = await initFirebaseFromEnv();
    db = fb.db;
  } catch (err) {
    console.warn("Firestore connection warning in level:", err.message);
  }

  // 3. Countdown Timer Functions (Driven 100% by Database start time)
  function resetCountdownTimer() {
    if (levelTimerInterval) {
      clearInterval(levelTimerInterval);
      levelTimerInterval = null;
    }
    levelStartedAt = null;
    isTimeExpired = false;
    if (timerClock) timerClock.textContent = "40:00";
    if (timerBadge) {
      timerBadge.className = "level-timer-badge";
      timerBadge.setAttribute("title", "40-Minute Countdown Timer");
    }
  }

  function startCountdown(startedAtMs) {
    if (!startedAtMs || isNaN(startedAtMs)) return;
    levelStartedAt = Number(startedAtMs);

    if (levelTimerInterval) clearInterval(levelTimerInterval);

    function tick() {
      if (isAlreadySubmitted) {
        if (timerClock) timerClock.textContent = "COMPLETED";
        if (timerBadge) {
          timerBadge.className = "level-timer-badge timer-finished";
          timerBadge.setAttribute("title", "Round completed & locked");
        }
        clearInterval(levelTimerInterval);
        return;
      }

      const now = Date.now();
      const elapsed = now - levelStartedAt;
      const remaining = Math.max(0, LEVEL_DURATION_MS - elapsed);

      const totalSeconds = Math.floor(remaining / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const formatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

      if (timerClock) {
        timerClock.textContent = formatted;
      }

      if (timerBadge) {
        if (remaining <= 0) {
          timerBadge.className = "level-timer-badge timer-critical timer-expired";
        } else if (remaining < 5 * 60 * 1000) { // Under 5 mins: urgent red pulse
          timerBadge.className = "level-timer-badge timer-critical";
        } else if (remaining < 10 * 60 * 1000) { // Under 10 mins: amber warning
          timerBadge.className = "level-timer-badge timer-warning";
        } else {
          timerBadge.className = "level-timer-badge";
        }
      }

      if (remaining <= 0 && !isTimeExpired && !isAlreadySubmitted) {
        isTimeExpired = true;
        clearInterval(levelTimerInterval);
        onTimeExpired();
      }
    }

    tick();
    levelTimerInterval = setInterval(tick, 1000);
  }

  async function onTimeExpired() {
    showToast("⏰ 40 minutes has expired! Auto-submitting your work now...", "warning");
    await executeSubmission(true);
  }

  // Sync Timer Strictly from Database: DB is the single source of truth
  async function syncTimerFromDb(data) {
    const isCompleted = Boolean(
      data?.[`lvl${levelNumber}`]?.scenarios ||
      data?.[`lvl${levelNumber}`]?.resp ||
      data?.[`level_${levelNumber}_response`]
    );
    if (isCompleted) {
      if (levelTimerInterval) clearInterval(levelTimerInterval);
      if (timerClock) timerClock.textContent = "COMPLETED";
      if (timerBadge) timerBadge.className = "level-timer-badge timer-finished";
      return;
    }

    // Read strictly from Firestore DB level_<levelNumber>_startedAt
    const dbStartTime = data?.[`level_${levelNumber}_startedAt`];

    // If database has an active startedAt, run countdown strictly from it
    if (dbStartTime) {
      startCountdown(Number(dbStartTime));
      return;
    }

    // If database does NOT have startedAt (was reset or never started):
    // Stop any existing ticking clock and reset visually to 40:00
    resetCountdownTimer();

    // Create fresh start time and write ONLY level_<levelNumber>_startedAt to DB
    if (db && team.teamId && !isRecordingStartTime) {
      isRecordingStartTime = true;
      const freshStart = Date.now();
      try {
        const docRef = doc(db, "registrations", team.teamId);
        await setDoc(docRef, {
          [`level_${levelNumber}_startedAt`]: freshStart
        }, { merge: true });
        console.log(`Initialized fresh level_${levelNumber}_startedAt in DB:`, freshStart);
        startCountdown(freshStart);
      } catch (err) {
        console.warn("Could not save start time to DB:", err.message);
      } finally {
        isRecordingStartTime = false;
      }
    }
  }

  // 4. Lock & Unlock state helpers
  let isAlreadySubmitted = false;
  let existingScore = 0;

  function lockAsSubmitted(dataPayload, submissionTime) {
    isAlreadySubmitted = true;
    if (levelTimerInterval) clearInterval(levelTimerInterval);
    if (timerClock) timerClock.textContent = "COMPLETED";
    if (timerBadge) {
      timerBadge.className = "level-timer-badge timer-finished";
      timerBadge.setAttribute("title", "Round completed & locked");
    }

    // Extract scenario values
    let s1 = "";
    let s2 = "";
    let s3 = "";

    if (dataPayload && typeof dataPayload === "object" && (dataPayload.scenario_1 || dataPayload.scenario1)) {
      s1 = dataPayload.scenario_1 || dataPayload.scenario1 || "";
      s2 = dataPayload.scenario_2 || dataPayload.scenario2 || "";
      s3 = dataPayload.scenario_3 || dataPayload.scenario3 || "";
    } else if (typeof dataPayload === "string") {
      const m1 = dataPayload.match(/\[SCENARIO 1\]\s*([\s\S]*?)(?=\[SCENARIO 2\]|$)/i);
      const m2 = dataPayload.match(/\[SCENARIO 2\]\s*([\s\S]*?)(?=\[SCENARIO 3\]|$)/i);
      const m3 = dataPayload.match(/\[SCENARIO 3\]\s*([\s\S]*?)$/i);
      if (m1 || m2 || m3) {
        s1 = m1 ? m1[1].trim() : "";
        s2 = m2 ? m2[1].trim() : "";
        s3 = m3 ? m3[1].trim() : "";
      } else {
        s1 = dataPayload;
      }
    }

    if (scenario1Input && s1) scenario1Input.value = s1;
    if (scenario2Input && s2) scenario2Input.value = s2;
    if (scenario3Input && s3) scenario3Input.value = s3;
    if (singleLegacyInput && !s2 && !s3 && s1) singleLegacyInput.value = s1;

    [scenario1Input, scenario2Input, scenario3Input, singleLegacyInput].forEach(inp => {
      if (inp) {
        inp.readOnly = true;
        inp.style.cursor = "not-allowed";
        inp.style.opacity = "0.85";
        inp.style.borderColor = "rgba(134, 239, 172, 0.4)";
      }
    });

    document.querySelectorAll(".scenario-card").forEach(card => card.classList.add("card-locked"));

    updateProgress();
    if (scenario1Pill) scenario1Pill.textContent = "🔒 Submitted";
    if (scenario2Pill) scenario2Pill.textContent = "🔒 Submitted";
    if (scenario3Pill) scenario3Pill.textContent = "🔒 Submitted";

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
        btnText.innerHTML = `🔒 Level ${levelNumber} Submitted & Locked (All 3 Categories)`;
      }
    }

    let lockNotice = document.getElementById("level-locked-notice");
    if (!lockNotice && (scenario1Input || singleLegacyInput)) {
      lockNotice = document.createElement("div");
      lockNotice.id = "level-locked-notice";
      lockNotice.className = "level-locked-badge";
      lockNotice.style.cssText = "display: flex; align-items: center; gap: 8px; margin-top: 14px; padding: 12px 16px; background: rgba(134, 239, 172, 0.08); border: 1px solid rgba(134, 239, 172, 0.3); border-radius: 6px; font-size: 0.85rem; color: #86efac; font-family: var(--font-mono, monospace);";
      lockNotice.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <span><strong>LOCKED:</strong> All 3 scenario responses submitted${submissionTime ? ` on ${submissionTime}` : ""}. Further edits for this round are locked.</span>
      `;
      const anchor = document.querySelector(".level-footer-actions") || document.querySelector(".scenarios-container");
      if (anchor) anchor.parentNode.insertBefore(lockNotice, anchor);
    }
  }

  function unlockState(notify = false) {
    const wasLocked = isAlreadySubmitted;
    isAlreadySubmitted = false;
    isTimeExpired = false;

    // Reset countdown timer visually to 40:00 when unlocked
    resetCountdownTimer();

    [scenario1Input, scenario2Input, scenario3Input, singleLegacyInput].forEach(inp => {
      if (inp) {
        inp.readOnly = false;
        inp.style.cursor = "text";
        inp.style.opacity = "1";
        inp.style.borderColor = "";
        if (wasLocked) inp.value = "";
      }
    });

    document.querySelectorAll(".scenario-card").forEach(card => card.classList.remove("card-locked"));

    updateProgress();

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
        btnText.innerHTML = `Submit All 3 Scenarios &rarr;`;
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
    delete team[`level_${levelNumber}_startedAt`];
    sessionStorage.setItem("promptathon_active_team", JSON.stringify(team));

    if (notify && wasLocked) {
      showToast(`Level ${levelNumber} was unlocked in database! You can now edit and resubmit.`, "info");
    }
  }

  // 5. Real-time Firestore sync: DB is Single Source of Truth
  if (db && team.teamId) {
    onSnapshot(doc(db, "registrations", team.teamId), async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();

        // Live progression check: if prior level was reset/deleted, redirect to dashboard
        if (levelNumber > 1) {
          const priorLevel = levelNumber - 1;
          const priorCompleted = Boolean(
            data[`lvl${priorLevel}`]?.scenarios ||
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

        const lvlData = data[`lvl${levelNumber}`];
        if (lvlData?.score !== undefined) {
          existingScore = lvlData.score;
        }

        const hasPayload = lvlData?.scenarios || lvlData?.resp || data[`level_${levelNumber}_response`] || data[`level-${levelNumber}-response`];
        if (hasPayload) {
          const payload = lvlData?.scenarios || lvlData?.resp || data[`level_${levelNumber}_response`];
          lockAsSubmitted(payload, lvlData?.time);
        } else {
          // If level submission was cleared / unlocked in database
          if (isAlreadySubmitted) {
            unlockState(true);
          }
          // Sync timer countdown strictly from database level_<levelNumber>_startedAt
          await syncTimerFromDb(data);
        }
      } else {
        unlockState(true);
      }
    }, (error) => {
      console.warn("Firestore listener warning:", error.message);
    });
  } else {
    // Fallback check from session if offline
    const sessionLvl = team[`lvl${levelNumber}`];
    if (sessionLvl?.scenarios || sessionLvl?.resp || team[`level_${levelNumber}_response`]) {
      const payload = sessionLvl?.scenarios || sessionLvl?.resp || team[`level_${levelNumber}_response`];
      lockAsSubmitted(payload, sessionLvl?.time);
    } else {
      syncTimerFromDb(team);
    }
  }

  // Initial progress calculation
  updateProgress();

  // 6. Unified Submission Executor (supports manual submit & auto-submit on time expiry)
  async function executeSubmission(isAutoSubmit = false) {
    if (isAlreadySubmitted) {
      if (!isAutoSubmit) {
        showToast("This level has already been submitted and is locked.", "warning");
      }
      return;
    }

    let s1Val = scenario1Input?.value?.trim() || "";
    let s2Val = scenario2Input?.value?.trim() || "";
    let s3Val = scenario3Input?.value?.trim() || "";

    if (!isAutoSubmit) {
      if (!scenario1Input && singleLegacyInput) {
        const val = singleLegacyInput.value.trim();
        if (!val) {
          showToast("Please enter your prompt before submitting.", "error");
          singleLegacyInput.focus();
          return;
        }
      } else {
        const missing = [];
        if (!s1Val) missing.push("Scenario 1");
        if (!s2Val) missing.push("Scenario 2");
        if (!s3Val) missing.push("Scenario 3");

        if (missing.length > 0) {
          showToast(`Please complete all 3 categories before submitting. Missing: ${missing.join(", ")}`, "error");
          if (!s1Val) scenario1Input?.focus();
          else if (!s2Val) scenario2Input?.focus();
          else if (!s3Val) scenario3Input?.focus();
          return;
        }
      }
    } else {
      // Auto-submit fallback for empty fields
      if (!s1Val) s1Val = "[Auto-submitted: No response provided before 40m time limit]";
      if (!s2Val) s2Val = "[Auto-submitted: No response provided before 40m time limit]";
      if (!s3Val) s3Val = "[Auto-submitted: No response provided before 40m time limit]";
      if (scenario1Input && !scenario1Input.value.trim()) scenario1Input.value = s1Val;
      if (scenario2Input && !scenario2Input.value.trim()) scenario2Input.value = s2Val;
      if (scenario3Input && !scenario3Input.value.trim()) scenario3Input.value = s3Val;
    }

    const btnTextEl = submitBtn?.querySelector(".btn-text");
    if (submitBtn) submitBtn.disabled = true;
    if (btnTextEl) btnTextEl.textContent = isAutoSubmit ? "Time Expired - Saving..." : "Saving & Locking...";

    const consolidatedResp = `[SCENARIO 1]\n${s1Val}\n\n[SCENARIO 2]\n${s2Val}\n\n[SCENARIO 3]\n${s3Val}`;

    const lvlPayload = {
      scenarios: {
        scenario_1: s1Val,
        scenario_2: s2Val,
        scenario_3: s3Val
      },
      resp: consolidatedResp,
      score: existingScore,
      time: new Date().toLocaleString(),
      autoSubmitted: isAutoSubmit
    };

    try {
      if (db && team.teamId) {
        const docRef = doc(db, "registrations", team.teamId);
        await setDoc(docRef, {
          [`lvl${levelNumber}`]: lvlPayload,
          [`level_${levelNumber}_response`]: deleteField(),
          [`level-${levelNumber}-response`]: deleteField(),
          [`level_${levelNumber}_details`]: deleteField(),
          [`level_${levelNumber}_submitted_at`]: deleteField(),
          lastUpdatedLevel: deleteField(),
          score: deleteField()
        }, { merge: true });
        console.log(`Saved clean lvl${levelNumber} scenarios map to Firestore for team:`, team.teamId);
      }

      localStorage.setItem(`team_${team.teamId}_level_${levelNumber}`, JSON.stringify(lvlPayload));
      team[`lvl${levelNumber}`] = lvlPayload;
      delete team.score;
      delete team[`level_${levelNumber}_response`];
      delete team[`level-${levelNumber}-response`];
      sessionStorage.setItem("promptathon_active_team", JSON.stringify(team));

      lockAsSubmitted(lvlPayload.scenarios, lvlPayload.time);

      if (isAutoSubmit) {
        showToast(`⏰ 40-minute time limit reached! Responses for Level ${levelNumber} submitted and locked.`, "warning");
      } else {
        if (typeof confetti === "function") {
          confetti({ particleCount: 80, spread: 75, origin: { y: 0.6 } });
        }
        showToast(`All 3 categories for Level ${levelNumber} submitted! Round is now locked.`, "success");
      }

    } catch (err) {
      console.error("Submission error:", err);
      localStorage.setItem(`team_${team.teamId}_level_${levelNumber}`, JSON.stringify(lvlPayload));
      team[`lvl${levelNumber}`] = lvlPayload;
      sessionStorage.setItem("promptathon_active_team", JSON.stringify(team));
      lockAsSubmitted(lvlPayload.scenarios, lvlPayload.time);
      showToast(isAutoSubmit ? "Time expired! Saved locally." : "Saved locally! (Database sync pending)", "warning");
    }
  }

  // 7. Handle Submit Button Click
  if (submitBtn) {
    submitBtn.addEventListener("click", () => executeSubmission(false));
  }
}
