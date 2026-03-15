  // DOMContentLoaded ensures the deferred Supabase CDN script has executed before
  // app initialisation runs. Without this wrapper, the inline script would run
  // during HTML parsing — before the deferred script — and window.supabase
  // would be undefined.
  document.addEventListener('DOMContentLoaded', function () {

    // ── Supabase config ──────────────────────────────────────────────────────
    const SUPABASE_URL = '%%SUPABASE_URL%%';
    const SUPABASE_KEY = '%%SUPABASE_KEY%%';
    let sb = null;
    let currentUser = null; // set after successful auth, used by all write operations
    try {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch (e) {
      console.warn('Supabase unavailable; running in localStorage-only mode.', e);
    }
    // ────────────────────────────────────────────────────────────────────────

    const WORKOUTS = [
      { id: 'peloton',    name: 'Cardio \u2014 Peloton Ride',    icon: 'bike'            },
      { id: 'upper_push', name: 'Strength \u2014 Upper Push',    icon: 'dumbbell'        },
      { id: 'upper_pull', name: 'Strength \u2014 Upper Pull',    icon: 'dumbbell'        },
      { id: 'lower',      name: 'Strength \u2014 Lower Body',    icon: 'dumbbell'        },
      { id: 'yoga',       name: 'Flexibility \u2014 Yoga',       icon: 'flower-2'        },
    ];

    // Fixed rotation: Peloton every other slot, Yoga every 4th workout overall
    const ROTATION = [
      'peloton', 'upper_push',
      'peloton', 'yoga',
      'peloton', 'upper_pull',
      'peloton', 'yoga',
      'peloton', 'lower',
      'peloton', 'yoga',
    ];

    const VERSION = '1.5.2';

    // ── Test mode ────────────────────────────────────────────────────────────
    const TEST_MODE = new URLSearchParams(window.location.search).get('test') === 'true';
    const STORAGE_KEY = TEST_MODE ? 'habits_test' : 'habits_v1';
    // ────────────────────────────────────────────────────────────────────────

    // ── localStorage key migration (wmw_ → habits_) ──────────────────────────
    // One-time migration: if habits_v1 doesn't exist yet but wmw_v1 does,
    // copy the data over and delete the old key. Same for other_activities.
    if (!TEST_MODE) {
      const migrateKey = (oldKey, newKey) => {
        if (localStorage.getItem(newKey) === null) {
          const old = localStorage.getItem(oldKey);
          if (old !== null) {
            localStorage.setItem(newKey, old);
            localStorage.removeItem(oldKey);
          }
        }
      };
      migrateKey('wmw_v1',              'habits_v1');
      migrateKey('wmw_other_activities', 'habits_other_activities');
    }
    // ────────────────────────────────────────────────────────────────────────

    async function loadData() {
      if (!sb || TEST_MODE) {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch { return {}; }
      }
      try {
        const userId = currentUser?.id;
        let local = {};
        try { local = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch {}

        const [stateRes, historyRes] = await Promise.all([
          // order + limit(1) so duplicate rows (same user_id) never cause
          // maybeSingle() to error — we always get the most-recently inserted row.
          sb.from('state').select('*').eq('user_id', userId)
            .order('id', { ascending: false }).limit(1).maybeSingle(),
          // Order by sequence (explicit insert order) rather than created_at so that
          // batch re-inserts — which share the same timestamp — come back in the
          // correct order.
          sb.from('history').select('*').eq('user_id', userId)
            .order('sequence', { ascending: true, nullsFirst: true }),
        ]);
        if (stateRes.error) throw stateRes.error;
        if (historyRes.error) throw historyRes.error;

        // New user — no state row exists yet, insert defaults.
        // The state table's primary key sequence was never auto-incremented
        // (original code always upserted with explicit id:1), so nextval()
        // returns 1 and collides with the existing row. We fetch the current
        // max id first and insert with max+1 to safely advance past it.
        // If the insert fails (e.g. RLS policy on anon key), log it and fall
        // through with rotation_index:0 so new users never see stale state.
        let stateRow = stateRes.data;
        if (!stateRow) {
          const { data: maxRow } = await sb.from('state')
            .select('id').order('id', { ascending: false }).limit(1).maybeSingle();
          const safeId = (maxRow?.id ?? 0) + 1;
          const { data: newState, error: insertErr } = await sb.from('state')
            .insert({ id: safeId, rotation_index: 0, action_date: null, user_id: userId })
            .select().single();
          if (insertErr) {
            console.warn('[loadData] State row insert failed:', insertErr);
          }
          stateRow = newState ?? { rotation_index: 0, action_date: null };
        }

        const historyRows = historyRes.data || [];

        // _maxSeq must be the true highest sequence in Supabase so new inserts
        // always use max + 1. Take the max of (a) what Supabase just returned
        // and (b) what localStorage already recorded — guards against read-after-
        // write timing where a just-inserted row hasn't appeared in SELECT yet.
        const supabaseMaxSeq = historyRows.reduce((m, r) => Math.max(m, r.sequence ?? -1), -1);
        const localMaxSeq    = typeof local._maxSeq === 'number' ? local._maxSeq : -1;

        const data = {
          rotationIndex: stateRow.rotation_index ?? 0,
          actionDate:    stateRow.action_date    ?? null,
          _maxSeq: Math.max(supabaseMaxSeq, localMaxSeq),
          history: historyRows.map(r => ({ type: r.type, date: r.date, advanced: r.advanced, note: r.note ?? undefined, _sid: r.id })),
        };

        // Derive each workout's last-done date from history
        for (const { type, date } of historyRows) {
          if (type !== 'off' && (!data[type] || date > data[type])) {
            data[type] = date;
          }
        }

        // Guard against read-after-write timing: if localStorage holds entries
        // that were already synced (_sid set) but didn't appear in this SELECT
        // result, re-append them so they aren't silently lost when we overwrite
        // localStorage below. Entries absent from Supabase with no _sid are
        // handled by the offline-sync path above, not here.
        const supabaseSids = new Set(historyRows.map(r => r.id));
        const missed = (local.history || []).filter(e => e._sid && !supabaseSids.has(e._sid));
        if (missed.length) {
          console.warn('[loadData] Supabase SELECT missed', missed.length,
            'recently-synced entries — re-appending from localStorage:',
            missed.map(e => ({ type: e.type, date: e.date, _sid: e._sid })));
          data.history = [...data.history, ...missed];
        }

        lastSyncedAt = Date.now();
        syncOffline  = false;
        updateSyncStamp();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); // keep local cache fresh
        return data;
      } catch (err) {
        console.warn('Supabase read failed, falling back to localStorage:', err);
        syncOffline = true;
        updateSyncStamp();
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch { return {}; }
      }
    }

    async function saveData(data, deletedSid = null) {
      if (TEST_MODE) {
        // Test mode — write to localStorage only, no Supabase
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return;
      }
      if (!sb) throw new Error('Supabase client not available');

      // History operations run FIRST — if they fail, state is never touched
      // If this save was triggered by an undo, delete only that one row
      if (deletedSid) {
        const { error: delErr } = await sb.from('history').delete().eq('id', deletedSid);
        if (delErr) throw delErr;
      }

      // Insert the newly-pushed entry (no _sid means not yet in Supabase)
      const newEntries = (data.history || []).filter(e => !e._sid);
      if (newEntries.length) {
        // Base sequence = max existing Supabase sequence + 1, so new inserts
        // never collide with gaps left by undo deletions.
        const baseSeq = (typeof data._maxSeq === 'number' ? data._maxSeq : data.history.filter(e => e._sid).length - 1) + 1;
        const rows = newEntries.map((e, i) => ({
          type: e.type,
          date: e.date,
          advanced: e.advanced ?? true,
          note: e.note ?? null,
          sequence: baseSeq + i,
          user_id: currentUser?.id,
        }));
        console.log('[saveData] Inserting rows into Supabase:', rows.map(r => ({ type: r.type, date: r.date, sequence: r.sequence })));
        const { data: inserted, error: insErr } = await sb.from('history').insert(rows).select('id, sequence');
        if (insErr) {
          console.error('[saveData] Supabase INSERT failed:', insErr, 'rows attempted:', rows.map(r => ({ type: r.type, date: r.date, sequence: r.sequence })));
          throw insErr;
        }
        console.log('[saveData] Supabase INSERT succeeded:', inserted);
        // Match returned rows by sequence value — insert order is not guaranteed.
        const insertedBySeq = {};
        inserted.forEach(row => { insertedBySeq[row.sequence] = row.id; });
        newEntries.forEach((e, i) => {
          const seq = baseSeq + i;
          if (insertedBySeq[seq] !== undefined) e._sid = insertedBySeq[seq];
        });
        // Keep _maxSeq current so subsequent saves in the same session are correct.
        data._maxSeq = baseSeq + newEntries.length - 1;
      }

      // State update runs AFTER history succeeds — no partial commit.
      // The row was created by loadData() on first login, so UPDATE is sufficient.
      const { error: stateErr } = await sb.from('state').update({
        rotation_index: data.rotationIndex ?? 0,
        action_date:    data.actionDate    ?? null,
      }).eq('user_id', currentUser?.id);
      if (stateErr) throw stateErr;

      // Supabase confirmed — update localStorage as read cache only
      lastSyncedAt = Date.now();
      syncOffline  = false;
      updateSyncStamp();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    function todayStr() {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    function isValidISODate(dateStr) {
      if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
      const [year, month, day] = dateStr.split('-').map(Number);
      if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
      const date = new Date(year, month - 1, day);
      return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
      );
    }

    function getYesterdayStr() {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    function daysSince(dateStr) {
      if (!dateStr) return null;
      const [y, m, d] = dateStr.split('-').map(Number);
      const then = new Date(y, m - 1, d);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      return Math.round((now - then) / 86_400_000);
    }

    // Next workout is always the current rotation position
    function getSuggested(data) {
      const idx = (data.rotationIndex || 0) % ROTATION.length;
      return WORKOUTS.find(w => w.id === ROTATION[idx]);
    }

    function pillClass(days, doneToday) {
      if (doneToday)                  return 'today';
      if (days === null || days >= 6) return 'urgent';
      if (days >= 3)                  return 'warning';
      return 'ok';
    }

    function pillText(days, doneToday) {
      if (doneToday)     return 'Today';
      if (days === null) return 'Never';
      if (days === 1)    return '1 day';
      return `${days}d`;
    }

    function lastDoneText(days, doneToday) {
      if (doneToday)     return 'Completed today';
      if (days === null) return 'Never done';
      if (days === 1)    return 'Last done 1 day ago';
      return `Last done ${days} days ago`;
    }

    let toastTimer;
    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
    }

    function getUserEmail() {
      return currentUser?.email || '';
    }

    function getUserMetadata() {
      return currentUser?.user_metadata || {};
    }

    function getUserDisplayName() {
      const meta = getUserMetadata();
      const firstName = (meta.first_name || '').trim();
      const lastName = (meta.last_name || '').trim();
      return [firstName, lastName].filter(Boolean).join(' ');
    }

    function getUserFeedbackIdentity() {
      const name = getUserDisplayName();
      const email = getUserEmail();
      if (name && email) return `${name} <${email}>`;
      return name || email || 'Unknown user';
    }

    function getUserInitial() {
      const email = getUserEmail().trim();
      return (email.charAt(0) || '?').toUpperCase();
    }

    let settingsProfileEditing = true;

    function hasSavedProfileName(meta = getUserMetadata()) {
      return !!((meta.first_name || '').trim() || (meta.last_name || '').trim());
    }

    function setProfileEditing(isEditing) {
      settingsProfileEditing = isEditing;
      ['settings-first-name', 'settings-last-name'].forEach(id => {
        const input = document.getElementById(id);
        input.readOnly = !isEditing;
        input.classList.toggle('is-readonly', !isEditing);
      });
      document.getElementById('save-profile-btn').textContent = isEditing ? 'Save profile' : 'Edit profile';
    }

    // ── Double-tap guard ─────────────────────────────────────────────────────
    // Each action function sets this true at the start and false when complete
    // (via try/finally). Any tap that arrives during a network round-trip hits
    // the guard and returns immediately — no duplicate mutations.
    let isProcessing = false;
    let lastSyncedAt = null;  // Date.now() timestamp of last successful Supabase sync
    let syncOffline  = false; // true if the last Supabase attempt failed

    function setButtonsDisabled(disabled) {
      ['main-done-btn', 'log-other-btn', 'undo-btn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
      });
      document.querySelectorAll('.row-done-btn').forEach(el => {
        el.disabled = disabled;
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    // Main "Done!" — logs the workout and advances the rotation
    async function markDone() {
      if (isProcessing) return;
      isProcessing = true;
      setButtonsDisabled(true);
      try {
        const data = await loadData();
        const today = todayStr();
        const idx = (data.rotationIndex || 0) % ROTATION.length;
        const workoutId = ROTATION[idx];

        data[workoutId] = today;                              // keep last-done date for the UI
        data.rotationIndex = (idx + 1) % ROTATION.length;    // advance rotation
        data.actionDate = today;                              // lock today's card
        data.history = data.history || [];
        data.history.push({ type: workoutId, date: today, advanced: true });

        await saveData(data);
        render(data);
        showToast('Logged \u2713');
      } catch {
        setButtonsDisabled(false);
        showToast('Could not save \u2014 check your connection');
      } finally {
        isProcessing = false;
      }
    }

    // "Skip Today" — logs an off day, rotation stays put
    const SKIP_DEFAULTS = ['Sick', 'Travel', 'Vacation', 'Social obligation'];

    function openSkipModal() {
      const modal    = document.getElementById('skip-modal');
      const input    = document.getElementById('skip-reason-input');
      const chipsEl  = document.getElementById('skip-reason-chips');

      const saved = loadSkipReasons();
      const chips = saved.length ? saved : SKIP_DEFAULTS;

      chipsEl.innerHTML = '';
      for (const r of chips) {
        const chip = document.createElement('button');
        chip.className = 'activity-chip';
        chip.textContent = r;
        chip.type = 'button';
        chip.onclick = () => {
          input.value = r;
          setTimeout(() => input.focus(), 50);
        };
        chipsEl.appendChild(chip);
      }

      input.value = '';
      modal.hidden = false;
      setTimeout(() => input.focus(), 80);
    }

    function closeSkipModal() {
      document.getElementById('skip-modal').hidden = true;
    }

    async function logSkip(reason) {
      if (isProcessing) return;
      isProcessing = true;
      setButtonsDisabled(true);
      try {
        closeSkipModal();
        const data = await loadData();
        const today = todayStr();

        data.actionDate = today;
        data.history = data.history || [];
        const entry = { type: 'off', date: today, advanced: false };
        if (reason) entry.note = reason;
        data.history.push(entry);

        if (reason) saveSkipReason(reason);

        await saveData(data);
        render(data);
        showToast('Day off logged');
      } catch {
        setButtonsDisabled(false);
        showToast('Could not save \u2014 check your connection');
      } finally {
        isProcessing = false;
      }
    }

    // Undo — removes the most recent history entry if it's from today or yesterday
    async function undoLastEntry() {
      if (isProcessing) return;
      isProcessing = true;
      setButtonsDisabled(true);
      try {
        const data = await loadData();
        const today = todayStr();
        const yesterday = getYesterdayStr();
        const history = data.history || [];
        if (!history.length) { render(data); return; }

        const last = history[history.length - 1];
        if (last.date !== today && last.date !== yesterday) { render(data); return; }

        const deletedSid = last._sid ?? null; // capture before removing so saveData can delete the right row

        // Remove the entry
        data.history = history.slice(0, -1);

        // Restore the previous last-done date for this workout type
        if (last.type !== 'off') {
          const prev = [...data.history].reverse().find(e => e.type === last.type);
          if (prev) {
            data[last.type] = prev.date;
          } else {
            delete data[last.type];
          }
        }

        // Roll back rotation if this entry advanced it.
        // New entries use advanced:true/false explicitly.
        // Old entries (no 'advanced' key) are assumed rotation-advancing if they're a workout,
        // since only markDone logged workouts before the advanced flag was introduced.
        const wasRotationAdvancing =
          last.advanced === true ||
          (!('advanced' in last) && last.type !== 'off');
        if (wasRotationAdvancing) {
          data.rotationIndex = ((data.rotationIndex || 0) - 1 + ROTATION.length) % ROTATION.length;
        }

        // Recalculate actionDate from what remains in history rather than guessing.
        // The card is locked today only if a rotation-advancing done or a skip still exists for today.
        const stillLockedToday = (data.history || []).some(e =>
          e.date === today && (
            e.advanced === true ||                          // new markDone entry
            e.type === 'off' ||                            // skip entry
            e.type === 'other' ||                          // other activity entry
            (!('advanced' in e) && e.type !== 'off')       // old entry without flag (backward compat)
          )
        );
        if (stillLockedToday) {
          data.actionDate = today;
        } else {
          delete data.actionDate;
        }

        await saveData(data, deletedSid);
        render(data);
        const name = last.type === 'off'
          ? 'day off'
          : last.type === 'other'
          ? (last.note || 'other activity')
          : (WORKOUTS.find(w => w.id === last.type)?.name ?? last.type);
        showToast(`Undone \u2014 ${name}`);
      } catch {
        setButtonsDisabled(false);
        showToast('Could not save \u2014 check your connection');
      } finally {
        isProcessing = false;
      }
    }

    // Row-level done — marks a specific workout without affecting the rotation
    async function markRowDone(id) {
      if (isProcessing) return;
      isProcessing = true;
      setButtonsDisabled(true);
      try {
        const data = await loadData();
        const today = todayStr();

        data[id] = today;
        data.actionDate = today; // lock the hero card for the day
        data.history = data.history || [];
        data.history.push({ type: id, date: today, advanced: false });

        await saveData(data);
        render(data);
        showToast('Logged \u2713');
      } catch {
        setButtonsDisabled(false);
        showToast('Could not save \u2014 check your connection');
      } finally {
        isProcessing = false;
      }
    }

    function openLogActivityModal() {
      const opts = document.getElementById('log-activity-options');
      opts.innerHTML = '';

      // Workout types — exclude the currently scheduled workout (logged via Done! only)
      const suggestedId = cachedData ? getSuggested(cachedData).id : null;
      for (const w of WORKOUTS) {
        if (w.id === suggestedId) continue;
        const btn = document.createElement('button');
        btn.className = 'log-activity-option';
        btn.type = 'button';
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', w.icon);
        btn.appendChild(icon);
        btn.appendChild(document.createTextNode(w.name));
        btn.onclick = () => { closeLogActivityModal(); markRowDone(w.id); };
        opts.appendChild(btn);
      }

      // Rest Day
      const restBtn = document.createElement('button');
      restBtn.className = 'log-activity-option';
      restBtn.type = 'button';
      const moonIcon = document.createElement('i');
      moonIcon.setAttribute('data-lucide', 'moon');
      restBtn.appendChild(moonIcon);
      restBtn.appendChild(document.createTextNode('Rest Day'));
      restBtn.onclick = () => { closeLogActivityModal(); openSkipModal(); };
      opts.appendChild(restBtn);

      // Freeform other activity
      const otherBtn = document.createElement('button');
      otherBtn.className = 'log-activity-option log-activity-option--other';
      otherBtn.type = 'button';
      const zapIcon = document.createElement('i');
      zapIcon.setAttribute('data-lucide', 'zap');
      otherBtn.appendChild(zapIcon);
      otherBtn.appendChild(document.createTextNode('Other activity\u2026'));
      otherBtn.onclick = () => { closeLogActivityModal(); openOtherActivityModal(); };
      opts.appendChild(otherBtn);

      document.getElementById('log-activity-modal').hidden = false;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      setTimeout(() => opts.querySelector('.log-activity-option')?.focus(), 80);
    }

    function closeLogActivityModal() {
      document.getElementById('log-activity-modal').hidden = true;
    }

    // ── HTML escape helper (prevents XSS when injecting user text into innerHTML)
    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ── Other Activity helpers ───────────────────────────────────────────────
    const OTHER_ACTIVITIES_KEY = TEST_MODE ? 'habits_test_other_activities' : 'habits_other_activities';
    const SKIP_REASONS_KEY = STORAGE_KEY + '_skip_reasons';
    const JOURNAL_KEY = TEST_MODE ? 'habits_test_journal' : 'habits_journal';
    const WEIGHT_KEY  = TEST_MODE ? 'habits_test_weight'  : 'habits_weight';

    function loadOtherActivities() {
      try {
        const parsed = JSON.parse(localStorage.getItem(OTHER_ACTIVITIES_KEY));
        if (typeof parsed === 'string') return [parsed];
        if (Array.isArray(parsed)) return parsed.filter(a => typeof a === 'string');
        return [];
      } catch { return []; }
    }

    function saveOtherActivities(name) {
      const existing = loadOtherActivities();
      const nameLower = name.toLowerCase();
      // Remove any existing entry that matches case-insensitively, then prepend
      const deduped = existing.filter(a => a.toLowerCase() !== nameLower);
      localStorage.setItem(OTHER_ACTIVITIES_KEY, JSON.stringify([name, ...deduped].slice(0, 10)));
    }

    function loadSkipReasons() {
      try {
        const parsed = JSON.parse(localStorage.getItem(SKIP_REASONS_KEY));
        if (typeof parsed === 'string') return [parsed];
        if (Array.isArray(parsed)) return parsed.filter(r => typeof r === 'string');
        return [];
      } catch { return []; }
    }

    function saveSkipReason(reason) {
      const existing = loadSkipReasons();
      const reasonLower = reason.toLowerCase();
      const deduped = existing.filter(r => r.toLowerCase() !== reasonLower);
      localStorage.setItem(SKIP_REASONS_KEY, JSON.stringify([reason, ...deduped].slice(0, 10)));
    }

    function openOtherActivityModal() {
      const modal      = document.getElementById('other-activity-modal');
      const input      = document.getElementById('other-activity-input');
      const chipsEl    = document.getElementById('other-activity-chips');
      const confirmBtn = document.getElementById('modal-confirm-btn');

      // Populate previous-activity chips
      chipsEl.innerHTML = '';
      for (const a of loadOtherActivities()) {
        const chip = document.createElement('button');
        chip.className = 'activity-chip';
        chip.textContent = a;
        chip.type = 'button';
        chip.onclick = () => {
          input.value = a;
          confirmBtn.disabled = false;
          setTimeout(() => input.focus(), 50);
        };
        chipsEl.appendChild(chip);
      }

      input.value = '';
      confirmBtn.disabled = true;
      modal.hidden = false;
      // Brief delay so the sheet animates into view before keyboard pops
      setTimeout(() => input.focus(), 80);
    }

    function closeOtherActivityModal() {
      document.getElementById('other-activity-modal').hidden = true;
    }

    const MAX_ACTIVITY_LENGTH = 100;

    async function logOtherActivity(activityName) {
      const name = String(activityName || '').trim().slice(0, MAX_ACTIVITY_LENGTH);
      if (!name || isProcessing) return;
      isProcessing = true;
      setButtonsDisabled(true);
      try {
        closeOtherActivityModal();
        const data = await loadData();
        const today = todayStr();

        data.actionDate = today;
        data.history = data.history || [];
        data.history.push({ type: 'other', date: today, advanced: false, note: name });

        saveOtherActivities(name);

        await saveData(data);
        render(data);
        showToast(`${name} logged`);
      } catch {
        setButtonsDisabled(false);
        showToast('Could not save \u2014 check your connection');
      } finally {
        isProcessing = false;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Backfill Modal ───────────────────────────────────────────────────────
    // Lets the user log or edit a workout/rest/other for any past day.

    // All 7 selectable options shown in the modal
    const BACKFILL_OPTIONS = [
      ...WORKOUTS.map(w => ({ id: w.id, name: w.name, icon: w.icon, color: 'purple' })),
      { id: 'off',   name: 'Rest Day',       icon: 'moon', color: 'amber' },
      { id: 'other', name: 'Other Activity', icon: 'zap',  color: 'teal'  },
    ];

    const BF_WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const BF_MONTHS   = ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'];

    let backfillDate         = null;  // 'YYYY-MM-DD' being edited
    let backfillExisting     = null;  // existing history entry object, or null
    let backfillJournalEntry = null;  // journal entry for this date, or null
    let backfillWeightEntry  = null;  // weight entry for this date, or null
    let backfillSelectedType = null;  // currently selected option id
    let backfillSaving       = false; // true while confirmBackfill is awaiting
    let activeWeightDate     = null;  // date currently being edited in the weight modal
    let weightModalFromBackfill = false; // true when weight modal was opened from the day-detail sheet

    function showBackfillModal() {
      document.getElementById('backfill-modal').hidden = false;
    }

    function hideBackfillModal() {
      document.getElementById('backfill-modal').hidden = true;
    }

    function openBackfillModal(dateStr) {
      backfillDate = dateStr;

      // Find the most-recent logged entry for this date
      const history = cachedData ? (cachedData.history || []) : [];
      backfillExisting = [...history].reverse().find(e => e.date === dateStr) || null;

      // Look up the journal entry for this date (used in the readonly view)
      const journalEntry = (getJournalSync() || []).find(e => e.date === dateStr) || null;
      backfillJournalEntry = journalEntry;
      backfillWeightEntry = (getWeightSync() || []).find(r => r.date === dateStr) || null;

      // Build the date label: "Wednesday, February 19"
      const d = new Date(dateStr + 'T00:00:00');
      document.getElementById('backfill-date-label').textContent =
        `${BF_WEEKDAYS[d.getDay()]}, ${BF_MONTHS[d.getMonth()]} ${d.getDate()}`;

      // All past days open into the same read-only day-detail state first.
      _showBackfillReadonly(backfillExisting);

      showBackfillModal();
    }

    function closeBackfillModal() {
      if (backfillSaving) return; // don't dismiss while a save is in flight
      hideBackfillModal();
      backfillDate     = null;
      backfillExisting = null;
      backfillJournalEntry = null;
      backfillWeightEntry = null;
      backfillSelectedType = null;
    }

    function _showBackfillReadonly(entry) {
      document.getElementById('backfill-readonly').hidden  = false;
      document.getElementById('backfill-edit-view').hidden = true;

      const hasExercise = !!entry;
      const isOff   = entry?.type === 'off';
      const isOther = entry?.type === 'other';
      const workout = (hasExercise && !isOff && !isOther) ? WORKOUTS.find(w => w.id === entry.type) : null;

      const iconName = !hasExercise ? 'dumbbell' :
        (isOff ? 'moon' : isOther ? 'zap' : (workout ? workout.icon : 'dumbbell'));
      const displayName = !hasExercise ? 'No exercise logged' :
        (isOff   ? (entry.note || 'Rest Day') :
         isOther ? (entry.note || 'Other Activity') :
         (workout ? workout.name : entry.type));

      const iconEl = document.getElementById('backfill-readonly-icon');
      iconEl.className = 'backfill-readonly-icon' +
        (!hasExercise ? ' is-empty' : isOff ? ' is-rest' : isOther ? ' is-other' : '');
      iconEl.innerHTML = `<i data-lucide="${iconName}"></i>`;
      document.getElementById('backfill-readonly-name').textContent = displayName;

      const weightValueEl = document.getElementById('backfill-weight-value');
      if (backfillWeightEntry) {
        weightValueEl.textContent = `${backfillWeightEntry.value_lbs} lbs`;
        weightValueEl.classList.remove('is-empty');
      } else {
        weightValueEl.textContent = 'No weight logged';
        weightValueEl.classList.add('is-empty');
      }

      const weightBtn = document.getElementById('backfill-weight-btn');
      weightBtn.textContent = backfillWeightEntry ? 'Edit Weight' : 'Add Weight';
      weightBtn.disabled = false;

      const exerciseBtn = document.getElementById('backfill-edit-btn');
      exerciseBtn.textContent = hasExercise ? 'Edit Exercise' : 'Add Exercise';

      if (typeof lucide !== 'undefined') lucide.createIcons();

      // Show journal entry for this past day, if one exists
      const journalSection = document.getElementById('backfill-journal-section');
      const journalContent = document.getElementById('backfill-journal-content');
      if (backfillJournalEntry) {
        const j = backfillJournalEntry;
        const fields = [
          { label: 'Intention',  value: j.intention },
          { label: 'Gratitude',  value: j.gratitude },
          { label: 'One Thing',  value: j.one_thing },
        ].filter(f => f.value);
        if (fields.length) {
          journalContent.innerHTML = fields.map(f => `
            <div class="backfill-journal-field">
              <div class="backfill-journal-label">${f.label}</div>
              <div class="backfill-journal-value">${escapeHtml(f.value)}</div>
            </div>`).join('');
          journalSection.hidden = false;
        } else {
          journalSection.hidden = true;
        }
      } else {
        journalSection.hidden = true;
      }
    }

    function _showBackfillEdit(preselectedType) {
      document.getElementById('backfill-readonly').hidden  = true;
      document.getElementById('backfill-edit-view').hidden = false;

      backfillSelectedType = preselectedType;
      _renderBackfillOptions(preselectedType);

      // Pre-fill the note input when editing an existing rest-day or other-activity entry
      const otherInput = document.getElementById('backfill-other-input');
      if ((preselectedType === 'other' || preselectedType === 'off') && backfillExisting?.note) {
        otherInput.value = backfillExisting.note;
      } else {
        otherInput.value = '';
      }

      _updateBackfillOtherSection(preselectedType === 'other' || preselectedType === 'off', preselectedType);
      _updateBackfillConfirmBtn();
    }

    function _renderBackfillOptions(selectedType) {
      const container = document.getElementById('backfill-options');
      container.innerHTML = '';

      for (const opt of BACKFILL_OPTIONS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'backfill-option' +
          (opt.color === 'amber' ? ' is-rest'  : '') +
          (opt.color === 'teal'  ? ' is-other' : '') +
          (opt.id === selectedType ? ' selected' : '');
        btn.dataset.type = opt.id;

        const iconEl = document.createElement('i');
        iconEl.setAttribute('data-lucide', opt.icon);
        const nameEl = document.createElement('span');
        nameEl.textContent = opt.name;
        btn.appendChild(iconEl);
        btn.appendChild(nameEl);

        btn.onclick = () => _selectBackfillOption(opt.id);
        container.appendChild(btn);
      }

      if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function _selectBackfillOption(type) {
      backfillSelectedType = type;

      // Toggle selected class on all option buttons
      document.querySelectorAll('.backfill-option').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.type === type);
      });

      _updateBackfillOtherSection(type === 'other' || type === 'off', type);
      _updateBackfillConfirmBtn();
    }

    function _updateBackfillOtherSection(show, type) {
      const section = document.getElementById('backfill-other-section');
      const input   = document.getElementById('backfill-other-input');
      section.hidden = !show;
      if (show) {
        // Placeholder and chips differ by type
        if (type === 'off') {
          input.placeholder = 'Reason (optional)';
          const saved = loadSkipReasons();
          const suggestions = saved.length ? saved : SKIP_DEFAULTS;
          const chipsEl = document.getElementById('backfill-other-chips');
          chipsEl.innerHTML = '';
          for (const r of suggestions) {
            const chip = document.createElement('button');
            chip.className = 'activity-chip';
            chip.textContent = r;
            chip.type = 'button';
            chip.onclick = () => {
              input.value = r;
              setTimeout(() => input.focus(), 50);
            };
            chipsEl.appendChild(chip);
          }
        } else {
          input.placeholder = 'Activity name (optional)';
          const chipsEl = document.getElementById('backfill-other-chips');
          chipsEl.innerHTML = '';
          for (const a of loadOtherActivities()) {
            const chip = document.createElement('button');
            chip.className = 'activity-chip';
            chip.textContent = a;
            chip.type = 'button';
            chip.onclick = () => {
              input.value = a;
              setTimeout(() => input.focus(), 50);
            };
            chipsEl.appendChild(chip);
          }
        }
        setTimeout(() => input.focus(), 80);
      }
    }

    function _updateBackfillConfirmBtn() {
      const btn = document.getElementById('backfill-confirm-btn');
      btn.disabled = !backfillSelectedType;
    }

    async function confirmBackfill() {
      if (!backfillDate || !backfillSelectedType || isProcessing) return;
      const otherInput = document.getElementById('backfill-other-input').value.trim();

      // Capture all shared mutable state into locals BEFORE any await so that
      // closeBackfillModal() (e.g. via an overlay tap during the network call)
      // cannot race and reset the module-level variables to null mid-save.
      const capturedDate     = backfillDate;
      const capturedType     = backfillSelectedType;
      const capturedExisting = backfillExisting;
      // Note is optional for both Rest Day and Other Activity; null if not entered
      const capturedNote     = (capturedType === 'other' || capturedType === 'off') && otherInput
        ? String(otherInput).slice(0, MAX_ACTIVITY_LENGTH)
        : null;

      isProcessing  = true;
      backfillSaving = true;
      const wasEdit = !!capturedExisting;

      try {
        const data    = await loadData();
        const history = data.history || [];

        // Re-look-up the entry from freshly-loaded history so _sid and advanced
        // are never stale from when the modal was opened (fixes second-edit bug).
        const liveExisting = capturedExisting
          ? ([...history].reverse().find(e => e.date === capturedDate) || capturedExisting)
          : null;

        const newType = capturedType;
        const note    = capturedNote;
        const dateStr = capturedDate;

        // Rotation advancement: only for workouts, only when this is the most-recent entry
        const isRotationWorkout = !!WORKOUTS.find(w => w.id === newType);
        const hasLaterEntries   = history.some(e => e.date > dateStr);
        const shouldAdvance     = isRotationWorkout && !hasLaterEntries;

        // Helper: recompute per-workout last-done dates from the full history.
        // Runs after any mutation so data.peloton etc. are never stale.
        function recomputeLastDone() {
          for (const w of WORKOUTS) {
            const maxDate = history
              .filter(e => e.type === w.id)
              .reduce((max, e) => (!max || e.date > max) ? e.date : max, null);
            if (maxDate) data[w.id] = maxDate;
            else delete data[w.id];
          }
        }

        if (capturedExisting) {
          // ── Edit existing entry ──────────────────────────────────────────────
          const wasAdvanced = liveExisting.advanced !== false;

          // Locate the entry in the freshly-loaded history array.
          // Three-step priority so the lookup never fails silently:
          //   1. Exact _sid match (normal path for synced entries)
          //   2. Reverse search by date+type among still-unsynced rows
          //   3. Reverse search by date+type ignoring _sid (catches entries
          //      that were offline when opened but got synced by loadData())
          let idx = -1;
          if (liveExisting._sid != null) {
            idx = history.findIndex(e => e._sid === liveExisting._sid);
          }
          if (idx === -1) {
            for (let i = history.length - 1; i >= 0; i--) {
              if (history[i].date === dateStr &&
                  history[i].type === capturedExisting.type &&
                  !history[i]._sid) {
                idx = i;
                break;
              }
            }
          }
          if (idx === -1) {
            for (let i = history.length - 1; i >= 0; i--) {
              if (history[i].date === dateStr &&
                  history[i].type === capturedExisting.type) {
                idx = i;
                break;
              }
            }
          }

          // ── CR-2: Supabase UPDATE runs FIRST so localStorage is only mutated
          //    after the remote write succeeds. If the update fails, throwing here
          //    leaves localStorage untouched and prevents the "save then revert"
          //    pattern caused by Supabase overwriting a premature local change.
          if (sb && !TEST_MODE && liveExisting._sid != null) {
            console.log(`[backfill] Updating history row id=${liveExisting._sid}`, { newType, note, shouldAdvance });
            const { error } = await sb.from('history').update({
              type:     newType,
              note:     note || null,
              advanced: shouldAdvance,
            }).eq('id', liveExisting._sid);
            if (error) {
              console.error(`[backfill] Supabase UPDATE failed for id=${liveExisting._sid}:`, error);
              throw error;
            }
            console.log(`[backfill] Supabase UPDATE succeeded for id=${liveExisting._sid}`);
          }

          // Remote confirmed (or offline) — now safe to mutate local state
          if (idx !== -1) {
            history[idx].type     = newType;
            history[idx].advanced = shouldAdvance;
            if (note) { history[idx].note = note; }
            else      { delete history[idx].note; }

            // Sync rotation index to match the change in advancing status:
            // forward when entry goes non-advancing → advancing; rollback
            // when entry goes advancing → non-advancing
            if (shouldAdvance && !wasAdvanced) {
              data.rotationIndex = (data.rotationIndex || 0) + 1;
            } else if (!shouldAdvance && wasAdvanced) {
              data.rotationIndex = ((data.rotationIndex || 0) - 1 + ROTATION.length) % ROTATION.length;
            }
          }

          recomputeLastDone();
          data.history = history;
          await saveData(data);
        } else {
          // ── New backfill entry ───────────────────────────────────────────────
          const newEntry = { type: newType, date: dateStr, advanced: shouldAdvance };
          if (note) newEntry.note = note;

          if (shouldAdvance) {
            data.rotationIndex = (data.rotationIndex || 0) + 1;
          }

          history.push(newEntry);
          console.log('[backfill] New entry pushed', {
            type: newType, date: dateStr, advanced: shouldAdvance,
            historyLengthBeforePush: history.length - 1,
            newEntryIndex: history.indexOf(newEntry),
          });
          recomputeLastDone();
          data.history = history;
          await saveData(data);
        }

        // Keep suggestion chip lists up to date
        if (newType === 'other' && note) saveOtherActivities(note);
        if (newType === 'off'   && note) saveSkipReason(note);

        cachedData = data;
        backfillSaving = false; // clear guard so the programmatic close proceeds
        closeBackfillModal();

        // Re-render whichever history sub-view is visible
        renderCalendar(data);
        if (historyViewActive && historySubTab === 'list') renderHistoryList(data);

        const displayName = newType === 'off'   ? 'Rest day' :
                            newType === 'other'  ? (note || 'Other activity') :
                            (WORKOUTS.find(w => w.id === newType)?.name ?? newType);
        showToast(wasEdit ? `${displayName} updated` : `${displayName} logged`);

      } catch {
        showToast('Could not save \u2014 check your connection');
      } finally {
        isProcessing  = false;
        backfillSaving = false;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Journal state + helpers ─────────────────────────────────────────────
    let cachedJournal = null;          // array of { date, intention, gratitude, one_thing }
    let _journalNudgeConfirmed = false; // true after user taps "Yes" on gratitude nudge
    let cachedWeight  = null;          // array of { date, value_lbs }

    // Populate cachedJournal from localStorage only (sync, no network).
    // Used by calendar rendering so dots appear without waiting for a Supabase call.
    function getJournalSync() {
      if (cachedJournal !== null) return cachedJournal;
      try { cachedJournal = JSON.parse(localStorage.getItem(JOURNAL_KEY)) || []; }
      catch { cachedJournal = []; }
      return cachedJournal;
    }

    // Load journal from Supabase, cache to localStorage, update cachedJournal.
    async function loadJournal() {
      let local = [];
      try { local = JSON.parse(localStorage.getItem(JOURNAL_KEY)) || []; } catch {}
      if (!sb || TEST_MODE) {
        cachedJournal = local;
        return local;
      }
      try {
        const { data, error } = await sb.from('journal').select('*').eq('user_id', currentUser?.id)
          .order('date', { ascending: false });
        if (error) throw error;
        const journal = (data || []).map(r => ({
          date:       r.date,
          intention:  r.intention  || '',
          gratitude:  r.gratitude  || '',
          one_thing:  r.one_thing  || '',
        }));
        localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
        cachedJournal = journal;
        return journal;
      } catch (err) {
        console.warn('Journal load failed, using localStorage:', err);
        cachedJournal = local;
        return local;
      }
    }

    // Save or update a journal entry ({ date, intention, gratitude, one_thing }).
    async function saveJournalEntry(entry) {
      if (TEST_MODE) {
        const journal = cachedJournal ? [...cachedJournal] : [];
        const idx = journal.findIndex(e => e.date === entry.date);
        if (idx !== -1) { journal[idx] = entry; } else { journal.unshift(entry); }
        cachedJournal = journal;
        localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
        return;
      }
      if (!sb) throw new Error('Supabase client not available');

      // Write to Supabase FIRST — throws on failure so caller can show error
      const { error } = await sb.from('journal').upsert({
        date:      entry.date,
        intention: entry.intention || null,
        gratitude: entry.gratitude || null,
        one_thing: entry.one_thing || null,
        user_id:   currentUser?.id,
      }, { onConflict: ['date', 'user_id'] });
      if (error) throw error;

      // Supabase confirmed — update cache
      const journal = cachedJournal ? [...cachedJournal] : [];
      const idx = journal.findIndex(e => e.date === entry.date);
      if (idx !== -1) { journal[idx] = entry; } else { journal.unshift(entry); }
      cachedJournal = journal;
      localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
    }

    // Returns true if newGratitude is a substring (or superset) of any gratitude
    // entry from the last 7 days (case-insensitive).
    function checkGratitudeSimilarity(newGratitude) {
      if (!newGratitude) return false;
      const journal = cachedJournal || [];
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const cutoffStr = dateToStr(sevenDaysAgo);
      const today = todayStr();
      const needle = newGratitude.trim().toLowerCase();
      return journal.some(e => {
        if (!e.gratitude || e.date >= today || e.date < cutoffStr) return false;
        const haystack = e.gratitude.trim().toLowerCase();
        return needle.includes(haystack) || haystack.includes(needle);
      });
    }

    // ── Journal modal + card ────────────────────────────────────────────────
    function openJournalModal() {
      const journal = getJournalSync() || [];
      const todayEntry = journal.find(e => e.date === todayStr());
      _showJournalForm(todayEntry || null);
      document.getElementById('journal-modal').hidden = false;
      setTimeout(() => document.getElementById('journal-intention').focus(), 80);
    }

    function closeJournalModal() {
      document.getElementById('journal-modal').hidden = true;
    }

    function _showJournalForm(prefill) {
      document.getElementById('journal-intention').value = prefill?.intention || '';
      document.getElementById('journal-gratitude').value = prefill?.gratitude || '';
      document.getElementById('journal-one-thing').value = prefill?.one_thing || '';
      document.getElementById('journal-nudge').hidden = true;
      _journalNudgeConfirmed = false;
    }

    function renderJournalCard() {
      const journal = getJournalSync() || [];
      const entry = journal.find(e => e.date === todayStr());
      const content = document.getElementById('journal-card-content');
      content.innerHTML = '';

      if (entry) {
        // Done badge
        const badge = document.createElement('div');
        badge.className = 'card-done-badge card-done-badge--journal';
        badge.textContent = 'Done \u2713';
        content.appendChild(badge);

        // One row per filled field
        const fields = [
          { label: 'Intention', value: entry.intention },
          { label: 'Gratitude', value: entry.gratitude },
          { label: 'One thing', value: entry.one_thing },
        ];

        const COLLAPSE_LINES = 3; // lines per field before "Show more" kicks in
        let anyCollapsed = false;

        fields.forEach(({ label, value }) => {
          if (!value) return;
          const fieldEl = document.createElement('div');
          fieldEl.className = 'journal-card-field';

          const labelEl = document.createElement('div');
          labelEl.className = 'journal-card-label';
          labelEl.textContent = label + ':';

          const valueEl = document.createElement('div');
          valueEl.className = 'journal-card-value';
          valueEl.textContent = value; // textContent — no XSS

          // Collapse long fields; toggle revealed on click
          const lineHeight = 1.45; // em, matches CSS
          const fontSize   = 14;   // px approx
          const maxPx = COLLAPSE_LINES * lineHeight * fontSize;

          fieldEl.appendChild(labelEl);
          fieldEl.appendChild(valueEl);
          content.appendChild(fieldEl);

          // Measure after paint to decide if toggle is needed
          requestAnimationFrame(() => {
            if (valueEl.scrollHeight > maxPx + 4) {
              anyCollapsed = true;
              valueEl.classList.add('journal-card-value--collapsed');
              if (!content.querySelector('.journal-card-toggle')) {
                const toggle = document.createElement('button');
                toggle.className = 'journal-card-toggle';
                toggle.textContent = 'Show more';
                toggle.onclick = () => {
                  const collapsed = content.querySelectorAll('.journal-card-value--collapsed');
                  const expanded  = content.querySelectorAll('.journal-card-value--expanded');
                  if (collapsed.length > 0) {
                    collapsed.forEach(el => {
                      el.classList.remove('journal-card-value--collapsed');
                      el.classList.add('journal-card-value--expanded');
                    });
                    toggle.textContent = 'Show less';
                  } else {
                    expanded.forEach(el => {
                      el.classList.remove('journal-card-value--expanded');
                      el.classList.add('journal-card-value--collapsed');
                    });
                    toggle.textContent = 'Show more';
                  }
                };
                // Insert before Edit button so order is: fields → Show more → Edit
                const editBtnEl = content.querySelector('.card-edit-btn');
                if (editBtnEl) {
                  content.insertBefore(toggle, editBtnEl);
                } else {
                  content.appendChild(toggle);
                }
              }
            }
          });
        });

        // Edit button
        const editBtn = document.createElement('button');
        editBtn.className = 'card-edit-btn';
        editBtn.textContent = 'Edit';
        editBtn.onclick = openJournalModal;
        content.appendChild(editBtn);

      } else {
        const openBtn = document.createElement('button');
        openBtn.className = 'card-action-btn';
        openBtn.textContent = 'Journal';
        openBtn.onclick = openJournalModal;
        content.appendChild(openBtn);
      }
    }

    async function saveJournal() {
      const intention = document.getElementById('journal-intention').value.trim();
      const gratitude = document.getElementById('journal-gratitude').value.trim();
      const oneThing  = document.getElementById('journal-one-thing').value.trim();

      // Block saving if all fields are empty
      if (!intention && !gratitude && !oneThing) return;

      // Gratitude similarity check — only run once per save attempt
      if (gratitude && !_journalNudgeConfirmed && checkGratitudeSimilarity(gratitude)) {
        document.getElementById('journal-nudge').hidden = false;
        return; // wait for user response
      }

      const entry = { date: todayStr(), intention, gratitude, one_thing: oneThing };
      document.getElementById('journal-save-btn').disabled = true;
      try {
        await saveJournalEntry(entry);
        _journalNudgeConfirmed = false;
        closeJournalModal();
        renderJournalCard();
        showToast('Journal saved \u2713');
      } catch {
        showToast('Could not save \u2014 check your connection');
      } finally {
        document.getElementById('journal-save-btn').disabled = false;
      }
    }

    // ────────────────────────────────────────────────────────────────────────

    // ── Weight modal + card ─────────────────────────────────────────────────
    function getWeightSync() {
      if (cachedWeight !== null) return cachedWeight;
      try { cachedWeight = JSON.parse(localStorage.getItem(WEIGHT_KEY)) || []; }
      catch { cachedWeight = []; }
      return cachedWeight;
    }

    async function loadWeight() {
      let local = [];
      try { local = JSON.parse(localStorage.getItem(WEIGHT_KEY)) || []; } catch {}
      if (!sb || TEST_MODE) { cachedWeight = local; return local; }
      try {
        const { data, error } = await sb.from('weight').select('date, value_lbs').eq('user_id', currentUser?.id)
          .order('date', { ascending: false });
        if (error) throw error;
        const rows = (data || []).map(r => ({ date: r.date, value_lbs: parseFloat(r.value_lbs) }));
        localStorage.setItem(WEIGHT_KEY, JSON.stringify(rows));
        cachedWeight = rows;
        return rows;
      } catch (err) {
        console.warn('Weight load failed, using localStorage:', err);
        cachedWeight = local;
        return local;
      }
    }

    // Reads all three Supabase tables in parallel. Throws on any failure so
    // the sync-btn handler can distinguish a real sync from a silent fallback.
    async function syncAllData() {
      if (!sb) throw new Error('No Supabase connection');
      const [stateRes, historyRes, journalRes, weightRes] = await Promise.all([
        sb.from('state').select('*').eq('user_id', currentUser?.id)
          .order('id', { ascending: false }).limit(1).maybeSingle(),
        sb.from('history').select('*').eq('user_id', currentUser?.id)
          .order('sequence', { ascending: true, nullsFirst: true }),
        sb.from('journal').select('*').eq('user_id', currentUser?.id)
          .order('date', { ascending: false }),
        sb.from('weight').select('date, value_lbs').eq('user_id', currentUser?.id)
          .order('date', { ascending: false }),
      ]);
      if (stateRes.error)   throw stateRes.error;
      if (historyRes.error) throw historyRes.error;
      if (journalRes.error) throw journalRes.error;
      if (weightRes.error)  throw weightRes.error;
      // Update journal + weight caches directly
      cachedJournal = (journalRes.data || []).map(r => ({
        date: r.date, intention: r.intention || '', gratitude: r.gratitude || '', one_thing: r.one_thing || '',
      }));
      cachedWeight = (weightRes.data || []).map(r => ({ date: r.date, value_lbs: parseFloat(r.value_lbs) }));
      localStorage.setItem(JOURNAL_KEY, JSON.stringify(cachedJournal));
      localStorage.setItem(WEIGHT_KEY,  JSON.stringify(cachedWeight));
      // render() calls loadData() internally for state+history (preserves offline-sync logic)
      await render();
    }

    async function saveWeightEntry(date, valueLbs) {
      if (TEST_MODE) {
        const rows = cachedWeight ? [...cachedWeight] : [];
        const idx = rows.findIndex(r => r.date === date);
        const entry = { date, value_lbs: valueLbs };
        if (idx !== -1) { rows[idx] = entry; } else { rows.unshift(entry); }
        cachedWeight = rows;
        localStorage.setItem(WEIGHT_KEY, JSON.stringify(rows));
        return;
      }
      if (!sb) throw new Error('Supabase client not available');

      // Write to Supabase FIRST — throws on failure so caller can show error
      const { error } = await sb.from('weight').upsert({ date, value_lbs: valueLbs, user_id: currentUser?.id }, { onConflict: ['date', 'user_id'] });
      if (error) throw error;

      // Supabase confirmed — update cache
      const rows = cachedWeight ? [...cachedWeight] : [];
      const idx = rows.findIndex(r => r.date === date);
      const entry = { date, value_lbs: valueLbs };
      if (idx !== -1) { rows[idx] = entry; } else { rows.unshift(entry); }
      cachedWeight = rows;
      localStorage.setItem(WEIGHT_KEY, JSON.stringify(rows));
    }

    function openWeightModal(dateStr = todayStr(), options = {}) {
      if (!isValidISODate(dateStr)) {
        dateStr = todayStr();
      }
      const { fromBackfill = false } = options;
      activeWeightDate = dateStr;
      weightModalFromBackfill = fromBackfill;
      if (fromBackfill) hideBackfillModal();

      const existing = (getWeightSync() || []).find(r => r.date === dateStr);
      const input = document.getElementById('weight-input');
      input.value = existing ? existing.value_lbs : '';
      document.getElementById('weight-save-btn').disabled = !existing;
      document.getElementById('weight-modal').hidden = false;
      input.focus();
    }

    function closeWeightModal() {
      document.getElementById('weight-modal').hidden = true;
      if (weightModalFromBackfill && backfillDate) showBackfillModal();
      activeWeightDate = null;
      weightModalFromBackfill = false;
    }

    async function saveWeight() {
      const val = parseFloat(document.getElementById('weight-input').value);
      if (!val || val < 50 || val > 999) return;
      document.getElementById('weight-save-btn').disabled = true;
      try {
        const saveDate = activeWeightDate || todayStr();
        await saveWeightEntry(saveDate, val);
        if (weightModalFromBackfill && backfillDate === saveDate) {
          backfillWeightEntry = (getWeightSync() || []).find(r => r.date === saveDate) || null;
          _showBackfillReadonly(backfillExisting);
        }
        closeWeightModal();
        renderWeightCard();
        if (historyViewActive && historySubTab === 'calendar' && cachedData) {
          renderCalendar(cachedData);
        }
        if (statsViewActive && cachedData) {
          renderStatsView(cachedData);
        }
        showToast('Weight saved');
      } catch {
        showToast('Could not save \u2014 check your connection');
      } finally {
        document.getElementById('weight-save-btn').disabled = false;
      }
    }

    function renderWeightCard() {
      const today = todayStr();
      const entry = (getWeightSync() || []).find(r => r.date === today);
      const content = document.getElementById('weight-card-content');
      if (entry) {
        content.innerHTML =
          `<div class="weight-logged-value">${entry.value_lbs} lbs</div>` +
          `<div class="card-done-badge card-done-badge--weight">Done ✓</div>` +
          `<button class="card-edit-btn" id="weight-edit-card-btn">Edit</button>`;
        document.getElementById('weight-edit-card-btn').onclick = () => openWeightModal();
      } else {
        content.innerHTML = `<button class="card-action-btn" id="weight-open-btn">Log Weight</button>`;
        document.getElementById('weight-open-btn').onclick = () => openWeightModal();
      }
    }

    // ── History view state ──────────────────────────────────────────────────
    let cachedData = null;        // last-loaded data, used by history renders
    let historyViewActive = false;
    let statsViewActive = false;
    let historySubTab = 'calendar'; // 'calendar' or 'list'
    let statsRange = '30'; // '7', '30', or 'all'
    let calViewDate = new Date(); // month currently shown in the calendar
    let weightChart = null;      // Chart.js instance for the Stats tab weight chart

    // Convert a Date object → 'YYYY-MM-DD' string (local time)
    function dateToStr(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    // Build a lookup map: dateStr → last history entry for that date
    function buildHistoryMap(data) {
      const map = {};
      for (const entry of (data.history || [])) {
        // Later entries override earlier ones for the same date
        map[entry.date] = entry;
      }
      return map;
    }

    // Project future workouts: starting from today (or the first un-logged day),
    // assign one rotation workout per calendar day going forward (up to 365 days).
    // data.rotationIndex already accounts for all past logged workouts.
    function buildProjectionMap(data) {
      const histMap = buildHistoryMap(data);
      const map = {};
      let rotIdx = data.rotationIndex || 0;
      const start = new Date();
      start.setHours(0, 0, 0, 0);

      for (let i = 0; i <= 365; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const ds = dateToStr(d);
        // Only project days that have no actual logged data
        if (!histMap[ds]) {
          map[ds] = ROTATION[rotIdx % ROTATION.length];
          rotIdx = (rotIdx + 1) % ROTATION.length;
        }
      }
      return map;
    }

    // ── Calendar renderer ───────────────────────────────────────────────────
    function renderCalendar(data) {
      const container = document.getElementById('hview-calendar');
      const histMap = buildHistoryMap(data);
      const projMap = buildProjectionMap(data);
      const today = todayStr();

      // Build date sets for journal and weight dot indicators
      const journalDateSet = new Set((getJournalSync() || []).map(e => e.date));
      const weightDateSet  = new Set((getWeightSync()  || []).map(r => r.date));

      const year  = calViewDate.getFullYear();
      const month = calViewDate.getMonth(); // 0-indexed

      const MONTH_NAMES = [
        'January','February','March','April','May','June',
        'July','August','September','October','November','December',
      ];

      const firstDayDow = new Date(year, month, 1).getDay();  // 0=Sun
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      let html = `
        <div class="cal-header">
          <button class="cal-nav-btn" id="cal-prev-btn">
            <i data-lucide="chevron-left"></i>
          </button>
          <span class="cal-month-label">${MONTH_NAMES[month]} ${year}</span>
          <button class="cal-nav-btn" id="cal-next-btn">
            <i data-lucide="chevron-right"></i>
          </button>
        </div>
        <div class="cal-grid">
      `;

      // Day-of-week column headers
      for (const d of ['S','M','T','W','T','F','S']) {
        html += `<div class="cal-dow">${d}</div>`;
      }

      // Empty filler cells before the 1st of the month
      for (let i = 0; i < firstDayDow; i++) {
        html += '<div class="cal-day"></div>';
      }

      // One cell per day
      for (let day = 1; day <= daysInMonth; day++) {
        const ds = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const isToday   = ds === today;
        const isFuture  = ds > today;
        const histEntry = histMap[ds];
        const projId    = projMap[ds]; // set for un-logged days >= today

        const isPast = ds < today;

        const classes = ['cal-day'];
        if (isToday)  classes.push('is-today');
        if (isPast)   classes.push('is-past');

        let iconHtml = '';

        if (histEntry) {
          // Actual logged data — show the real result
          if (histEntry.type === 'off') {
            classes.push('has-rest');
            iconHtml = '<i class="cal-icon" data-lucide="moon"></i>';
          } else if (histEntry.type === 'other') {
            classes.push('has-other');
            iconHtml = '<i class="cal-icon" data-lucide="zap"></i>';
          } else {
            classes.push('has-workout');
            const w = WORKOUTS.find(w => w.id === histEntry.type);
            if (w) iconHtml = `<i class="cal-icon" data-lucide="${w.icon}"></i>`;
          }
        } else if (projId) {
          // No log yet (today un-actioned or a future date) — show projected
          classes.push('is-projected');
          const w = WORKOUTS.find(w => w.id === projId);
          if (w) iconHtml = `<i class="cal-icon" data-lucide="${w.icon}"></i>`;
        }
        // Past days with no data: just the number, no icon

        const dateAttr = isPast ? ` data-date="${ds}" role="button" tabindex="0"` : '';
        const journalDot = journalDateSet.has(ds) ? '<span class="cal-journal-dot"></span>' : '';
        const weightDot  = weightDateSet.has(ds)  ? '<span class="cal-weight-dot"></span>'  : '';
        html += `<div class="${classes.join(' ')}"${dateAttr}>${iconHtml}<span class="cal-day-num">${day}</span>${journalDot}${weightDot}</div>`;
      }

      html += '</div>';
      container.innerHTML = html;

      // Past-day tap or keyboard activation → open backfill modal
      container.querySelectorAll('.cal-day.is-past[data-date]').forEach(cell => {
        cell.addEventListener('click', () => openBackfillModal(cell.dataset.date));
        cell.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openBackfillModal(cell.dataset.date);
          }
        });
      });

      // Month navigation
      document.getElementById('cal-prev-btn').onclick = () => {
        calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() - 1, 1);
        renderCalendar(data);
      };
      document.getElementById('cal-next-btn').onclick = () => {
        calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() + 1, 1);
        renderCalendar(data);
      };

      if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // ── History list renderer ───────────────────────────────────────────────
    function renderHistoryList(data) {
      const container = document.getElementById('hview-list');
      const today = todayStr();

      const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

      // Build one row per history entry, most-recent first
      // Sort by date descending — YYYY-MM-DD strings compare correctly lexicographically,
      // so this is safe for both Supabase and localStorage data paths.
      const entries = [...(data.history || [])].sort((a, b) => b.date.localeCompare(a.date));

      // Helper: build one list row's HTML
      function rowHtml(dateStr, type, isProjected, isToday, note = null) {
        const d = new Date(dateStr + 'T00:00:00');
        const thisYear = new Date().getFullYear();
        const yearSuffix = d.getFullYear() !== thisYear ? `, ${d.getFullYear()}` : '';
        const dateMain = `${MONTHS[d.getMonth()]} ${d.getDate()}${yearSuffix}`;
        const dayName  = WEEKDAYS[d.getDay()];

        const isOff   = type === 'off';
        const isOther = type === 'other';
        const workout  = (isOff || isOther) ? null : WORKOUTS.find(w => w.id === type);
        const iconName = isOff ? 'moon' : isOther ? 'zap' : (workout ? workout.icon : 'dumbbell');
        const color    = isOff ? 'amber' : isOther ? 'teal' : 'purple';
        const dispName = isOff   ? 'Rest Day' :
                         isOther ? (note || 'Other Activity') :
                         (workout ? workout.name : type);

        const rowCls = [
          'hlist-row',
          isProjected ? 'is-projected' : '',
          isToday     ? 'is-today'     : '',
        ].filter(Boolean).join(' ');

        return `
          <div class="${rowCls}">
            <i class="hlist-icon ${color}" data-lucide="${iconName}"></i>
            <div class="hlist-date">
              <div class="hlist-date-main">${dateMain}</div>
              <div class="hlist-date-sub">${dayName}</div>
            </div>
            ${isOff && note
              ? `<div class="hlist-name-wrap">
                   <div class="hlist-name ${color}">${escapeHtml(dispName)}</div>
                   <div class="hlist-note">${escapeHtml(note)}</div>
                 </div>`
              : `<div class="hlist-name ${color}">${escapeHtml(dispName)}</div>`
            }
          </div>`;
      }

      let html = '';

      if (entries.length) {
        html += '<div class="hlist">';
        for (const e of entries) {
          html += rowHtml(e.date, e.type, false, e.date === today, e.note);
        }
        html += '</div>';
      } else {
        html += '<div class="hlist-empty">No data yet.</div>';
      }

      container.innerHTML = html;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // ── Schedule renderer ───────────────────────────────────────────────────
    function renderSchedule(data) {
      const container = document.getElementById('hview-schedule');

      const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

      // Build 14 future projected days (starting tomorrow)
      const projMap = buildProjectionMap(data);
      const futureRows = [];
      for (let i = 1; i <= 14; i++) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + i);
        const ds = dateToStr(d);
        if (projMap[ds]) futureRows.push({ date: ds, type: projMap[ds] });
      }

      function rowHtml(dateStr, type) {
        const d = new Date(dateStr + 'T00:00:00');
        const thisYear = new Date().getFullYear();
        const yearSuffix = d.getFullYear() !== thisYear ? `, ${d.getFullYear()}` : '';
        const dateMain = `${MONTHS[d.getMonth()]} ${d.getDate()}${yearSuffix}`;
        const dayName  = WEEKDAYS[d.getDay()];

        const workout  = WORKOUTS.find(w => w.id === type);
        const iconName = workout ? workout.icon : 'dumbbell';
        const dispName = workout ? workout.name : type;

        return `
          <div class="hlist-row is-projected">
            <i class="hlist-icon purple" data-lucide="${iconName}"></i>
            <div class="hlist-date">
              <div class="hlist-date-main">${dateMain}</div>
              <div class="hlist-date-sub">${dayName}</div>
            </div>
            <div class="hlist-name purple">${escapeHtml(dispName)}</div>
          </div>`;
      }

      let html = '';
      if (futureRows.length) {
        html += '<div class="hlist-section-label">Coming Up</div>';
        html += '<div class="hlist">';
        for (const r of futureRows) {
          html += rowHtml(r.date, r.type);
        }
        html += '</div>';
      } else {
        html += '<div class="hlist-empty">No upcoming workouts.</div>';
      }

      container.innerHTML = html;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // Decide which history sub-view to render
    function renderHistoryView(data) {
      if (historySubTab === 'calendar') renderCalendar(data);
      else if (historySubTab === 'schedule') renderSchedule(data);
      else renderHistoryList(data);
    }

    function destroyWeightChart() {
      if (weightChart) {
        weightChart.destroy();
        weightChart = null;
      }
    }

    function dateDiffInDays(startDateStr, endDateStr) {
      const [sy, sm, sd] = startDateStr.split('-').map(Number);
      const [ey, em, ed] = endDateStr.split('-').map(Number);
      return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000);
    }

    function computeRollingSeries(rows, values) {
      return rows.map((row, idx) => {
        const windowValues = [];
        for (let i = idx; i >= 0; i--) {
          const diff = dateDiffInDays(rows[i].date, row.date);
          if (diff > 6) break;
          const value = values[i];
          if (Number.isFinite(value)) windowValues.push(value);
        }
        if (!windowValues.length) return null;
        const avg = windowValues.reduce((sum, value) => sum + value, 0) / windowValues.length;
        return Math.round(avg * 10) / 10;
      });
    }

    function getStatsRangeDays(range = statsRange) {
      if (range === '7') return 7;
      if (range === '30') return 30;
      return null;
    }

    function getStatsRangeCutoffStr(range = statsRange) {
      const days = getStatsRangeDays(range);
      if (!days) return null;

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (days - 1));
      return cutoff.getFullYear() + '-' +
        String(cutoff.getMonth() + 1).padStart(2, '0') + '-' +
        String(cutoff.getDate()).padStart(2, '0');
    }

    function renderWeightChart() {
      const emptyEl = document.getElementById('weight-chart-empty');
      const wrapEl  = document.getElementById('weight-chart-wrap');
      const canvas  = document.getElementById('weight-chart-canvas');
      const cutoffStr = getStatsRangeCutoffStr();
      const rows = [...(getWeightSync() || [])]
        .filter(row => !cutoffStr || row.date >= cutoffStr)
        .sort((a, b) => a.date.localeCompare(b.date));

      destroyWeightChart();

      if (rows.length < 2 || typeof window.Chart === 'undefined') {
        emptyEl.hidden = false;
        wrapEl.hidden = true;
        return;
      }

      emptyEl.hidden = true;
      wrapEl.hidden = false;

      const labels = rows.map(r => {
        const d = new Date(r.date + 'T00:00:00');
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      });
      const rawValues = rows.map(r => r.value_lbs);
      const avg7Values = computeRollingSeries(rows, rawValues);
      const trendValues = computeRollingSeries(rows, avg7Values);
      const plottedValues = [...rawValues, ...avg7Values, ...trendValues].filter(v => Number.isFinite(v));
      const minValue = Math.min(...plottedValues);
      const maxValue = Math.max(...plottedValues);
      const range = maxValue - minValue;
      const buffer = Math.max(1.5, range * 0.12 || 1.5);
      const css = getComputedStyle(document.documentElement);
      const accent = css.getPropertyValue('--accent').trim() || '#6c63ff';
      const coral = css.getPropertyValue('--coral').trim() || '#ff6b6b';
      const textSecondary = css.getPropertyValue('--text-secondary').trim() || '#6a6a90';
      const textPrimary = css.getPropertyValue('--text-primary').trim() || '#e4e4f4';
      const border = css.getPropertyValue('--border').trim() || '#222235';

      weightChart = new window.Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Weight',
              data: rawValues,
              showLine: false,
              pointRadius: 2.5,
              pointHoverRadius: 4,
              pointBackgroundColor: coral,
              pointBorderColor: coral,
            },
            {
              label: '7-day average',
              data: avg7Values,
              borderColor: accent,
              backgroundColor: accent,
              borderWidth: 2.5,
              pointRadius: 0,
              pointHitRadius: 12,
              tension: 0.32,
            },
            {
              label: 'Trend',
              data: trendValues,
              borderColor: textPrimary,
              backgroundColor: textPrimary,
              borderWidth: 2,
              pointRadius: 0,
              pointHitRadius: 12,
              tension: 0.28,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#13131e',
              borderColor: border,
              borderWidth: 1,
              titleColor: '#e4e4f4',
              bodyColor: '#e4e4f4',
              displayColors: false,
              callbacks: {
                label(context) {
                  if (!Number.isFinite(context.raw)) return null;
                  return `${context.dataset.label}: ${context.raw} lbs`;
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              border: { color: border },
              ticks: {
                color: textSecondary,
                autoSkip: true,
                maxTicksLimit: 5,
                maxRotation: 0,
              },
            },
            y: {
              suggestedMin: minValue - buffer,
              suggestedMax: maxValue + buffer,
              grid: { color: border },
              border: { color: border },
              ticks: {
                color: textSecondary,
                maxTicksLimit: 5,
              },
            },
          },
        },
      });
    }

    // ── Stats view ─────────────────────────────────────────────────────────
    function renderStatsView(data) {
      renderWeightChart();
      const container = document.getElementById('stats-content');
      const history   = data.history || [];

      // Real workouts = everything except known non-workout types (skip/rest days).
      // Using a type-based exclusion rather than the `advanced` flag means
      // backtracked entries (advanced: false but a genuine workout), free-form
      // "other" entries, and legacy rows without an advanced field all count.
      const NON_WORKOUT_TYPES = new Set(['off']);
      const realWorkouts = history.filter(e => !NON_WORKOUT_TYPES.has(e.type));

      // ── Determine the filtered set for range-dependent stats ──────────────
      const today = todayStr();
      let rangeEntries;
      const cutoffStr = getStatsRangeCutoffStr();
      if (cutoffStr) {
        rangeEntries = realWorkouts.filter(e => e.date >= cutoffStr);
      } else {
        rangeEntries = realWorkouts.slice();
      }

      // ── Empty state ───────────────────────────────────────────────────────
      if (realWorkouts.length === 0) {
        container.innerHTML = '<div class="stats-empty">No data yet.</div>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
      }

      // ── 1. Total workouts ─────────────────────────────────────────────────
      const totalWorkouts = rangeEntries.length;

      // ── 2. Streaks ────────────────────────────────────────────────────────
      // NOTE: Streaks are ALWAYS computed from the full history regardless of
      // the selected range toggle. A streak that began 45 days ago must still
      // show correctly when "Last 30 Days" is selected.
      const workoutDates = new Set(realWorkouts.map(e => e.date));

      // Current streak: consecutive days ending today (or yesterday if nothing
      // logged today) where a real workout was logged.
      function computeCurrentStreak() {
        const cursor = new Date();
        // If nothing logged today, start from yesterday
        if (!workoutDates.has(todayStr())) cursor.setDate(cursor.getDate() - 1);
        let streak = 0;
        while (true) {
          const dateStr = cursor.getFullYear() + '-' +
            String(cursor.getMonth() + 1).padStart(2, '0') + '-' +
            String(cursor.getDate()).padStart(2, '0');
          if (!workoutDates.has(dateStr)) break;
          streak++;
          cursor.setDate(cursor.getDate() - 1);
        }
        return streak;
      }

      // Longest streak: longest consecutive calendar-day run in all history.
      // Uses Date.UTC to parse dates so DST clock changes never corrupt the
      // 86400000 ms-per-day assumption (UTC has no DST transitions).
      function computeLongestStreak() {
        if (workoutDates.size === 0) return 0;
        const sorted = Array.from(workoutDates).sort();
        function toUtcDay(dateStr) {
          const [y, m, d] = dateStr.split('-').map(Number);
          return Date.UTC(y, m - 1, d);
        }
        let best = 1, run = 1;
        for (let i = 1; i < sorted.length; i++) {
          const diff = (toUtcDay(sorted[i]) - toUtcDay(sorted[i - 1])) / 86400000;
          if (diff === 1) { run++; best = Math.max(best, run); }
          else run = 1;
        }
        return best;
      }

      const currentStreak = computeCurrentStreak();
      const longestStreak = computeLongestStreak();

      // ── 3. Consistency % ──────────────────────────────────────────────────
      const distinctDays = new Set(rangeEntries.map(e => e.date)).size;
      let denominator;
      const statsRangeDays = getStatsRangeDays();
      if (statsRangeDays) {
        denominator = statsRangeDays;
      } else {
        // All Time: days from first-ever logged workout to today (inclusive)
        const allDates = realWorkouts.map(e => e.date).sort();
        const first = new Date(allDates[0] + 'T00:00:00');
        const todayDate = new Date(today + 'T00:00:00');
        denominator = Math.round((todayDate - first) / 86400000) + 1;
      }
      const consistencyPct = Math.round((distinctDays / denominator) * 100);

      // ── 4. Workouts by type ───────────────────────────────────────────────
      const ROTATION_TYPE_IDS = new Set(['peloton', 'upper_push', 'upper_pull', 'lower', 'yoga']);
      const typeOrder = ['peloton', 'upper_push', 'upper_pull', 'lower', 'yoga'];
      const typeCounts = {};
      typeOrder.forEach(id => { typeCounts[id] = 0; });
      rangeEntries.forEach(e => {
        if (typeCounts[e.type] !== undefined) typeCounts[e.type]++;
      });

      // "Other" = real workout entries whose type isn't one of the 5 rotation types.
      // These are free-form activities logged via Log Other Activity or backfill.
      // The human-readable label is stored in e.note; fall back to 'Other activity'.
      const otherEntries = rangeEntries
        .filter(e => !ROTATION_TYPE_IDS.has(e.type))
        .sort((a, b) => b.date.localeCompare(a.date));
      const otherCount   = otherEntries.length;

      // Scale all bars (including Other) relative to the overall max.
      const maxCount = Math.max(...Object.values(typeCounts), otherCount, 1);

      // ── Helper: format YYYY-MM-DD → "Mar 5" for the expand list ──────────
      const STAT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      function fmtDate(dateStr) {
        const [, m, d] = dateStr.split('-');
        return `${STAT_MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
      }

      // ── Helper: escape user-supplied text before inserting into HTML ───────
      function escapeHtml(str) {
        return String(str ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      // ── Other row + expandable list (only rendered when count > 0) ────────
      const otherPct = maxCount > 0 ? Math.round((otherCount / maxCount) * 100) : 0;
      const otherRowHtml = otherCount > 0 ? `
        <div class="stats-type-row stats-other-row" id="stats-other-row">
          <i data-lucide="zap" class="stats-type-icon"></i>
          <div class="stats-type-info">
            <div class="stats-type-name">Other</div>
            <div class="stats-bar-track">
              <div class="stats-bar-fill" style="width:${otherPct}%"></div>
            </div>
          </div>
          <div class="stats-other-meta">
            <i data-lucide="chevron-down" class="stats-other-chevron"></i>
            <div class="stats-type-count">${otherCount}</div>
          </div>
        </div>
        <div class="stats-other-list" id="stats-other-list" hidden>
          ${otherEntries.map(e => `
            <div class="stats-other-entry">
              <span class="stats-other-date">${fmtDate(e.date)}</span>
              <span class="stats-other-name">${escapeHtml(e.note) || 'Other activity'}</span>
            </div>
          `).join('')}
        </div>` : '';

      // ── Render ────────────────────────────────────────────────────────────
      const html = `
        <div class="stats-section">
          <div class="stats-section-label">Total Workouts</div>
          <div class="stats-card">
            <div class="stats-big-number">${totalWorkouts}</div>
            <div class="stats-big-label">${statsRange === '7' ? 'in the last 7 days' : statsRange === '30' ? 'in the last 30 days' : 'all time'}</div>
          </div>
        </div>

        <div class="stats-section">
          <div class="stats-section-label">Streaks</div>
          <div class="stats-pair">
            <div class="stats-card">
              <div class="stats-big-number">${currentStreak}</div>
              <div class="stats-big-label">current streak</div>
            </div>
            <div class="stats-card">
              <div class="stats-big-number">${longestStreak}</div>
              <div class="stats-big-label">longest streak</div>
            </div>
          </div>
        </div>

        <div class="stats-section">
          <div class="stats-section-label">Consistency</div>
          <div class="stats-card">
            <div class="stats-big-number">${consistencyPct}%</div>
            <div class="stats-big-label">${distinctDays} of ${denominator} days</div>
          </div>
        </div>

        <div class="stats-section">
          <div class="stats-section-label">Workouts by Type</div>
          <div class="stats-card">
            ${typeOrder.map(id => {
              const w = WORKOUTS.find(x => x.id === id);
              const count = typeCounts[id];
              const pct   = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
              return `
                <div class="stats-type-row">
                  <i data-lucide="${w.icon}" class="stats-type-icon"></i>
                  <div class="stats-type-info">
                    <div class="stats-type-name">${w.name}</div>
                    <div class="stats-bar-track">
                      <div class="stats-bar-fill" style="width:${pct}%"></div>
                    </div>
                  </div>
                  <div class="stats-type-count">${count}</div>
                </div>`;
            }).join('')}
            ${otherRowHtml}
          </div>
        </div>
      `;

      container.innerHTML = html;
      if (typeof lucide !== 'undefined') lucide.createIcons();

      // Attach expand/collapse handler for the Other row after innerHTML is set.
      if (otherCount > 0) {
        const otherRow  = document.getElementById('stats-other-row');
        const otherList = document.getElementById('stats-other-list');
        const chevron   = otherRow.querySelector('.stats-other-chevron');
        otherRow.addEventListener('click', () => {
          const nowExpanded = otherList.hidden;
          otherList.hidden  = !nowExpanded;
          chevron.setAttribute('data-lucide', nowExpanded ? 'chevron-up' : 'chevron-down');
          if (typeof lucide !== 'undefined') lucide.createIcons();
        });
      }
    }

    // ── Tab switching ───────────────────────────────────────────────────────
    function switchMainTab(tab) {
      historyViewActive = tab === 'history';
      statsViewActive   = tab === 'stats';
      document.getElementById('view-today').hidden    = tab !== 'today';
      document.getElementById('view-history').hidden  = tab !== 'history';
      document.getElementById('view-stats').hidden    = tab !== 'stats';
      document.getElementById('view-settings').hidden = tab !== 'settings';
      document.getElementById('nav-today-btn').classList.toggle('active', tab === 'today');
      document.getElementById('nav-history-btn').classList.toggle('active', tab === 'history');
      document.getElementById('nav-stats-btn').classList.toggle('active', tab === 'stats');
      document.getElementById('nav-settings-btn').classList.toggle('active', tab === 'settings');
      if (historyViewActive) switchHistorySubTab('calendar');
      if (statsViewActive) {
        // Always reset to Last 30 Days when entering the Stats tab so the
        // toggle never carries over state from a previous visit.
        statsRange = '30';
        document.getElementById('stats-btn-7').classList.remove('active');
        document.getElementById('stats-btn-30').classList.add('active');
        document.getElementById('stats-btn-all').classList.remove('active');
        if (cachedData) renderStatsView(cachedData);
      }
    }

    function switchHistorySubTab(tab) {
      historySubTab = tab;
      document.getElementById('htab-calendar').classList.toggle('active', tab === 'calendar');
      document.getElementById('htab-list').classList.toggle('active', tab === 'list');
      document.getElementById('htab-schedule').classList.toggle('active', tab === 'schedule');
      document.getElementById('hview-calendar').hidden = tab !== 'calendar';
      document.getElementById('hview-list').hidden     = tab !== 'list';
      document.getElementById('hview-schedule').hidden = tab !== 'schedule';
      if (cachedData) renderHistoryView(cachedData);
    }

    // ── Modal event listeners ───────────────────────────────────────────────
    // Tapping the dark overlay (outside the sheet) dismisses the modal
    document.getElementById('other-activity-modal').addEventListener('click', function (e) {
      if (e.target === this) closeOtherActivityModal();
    });
    document.getElementById('modal-cancel-btn').onclick = closeOtherActivityModal;
    document.getElementById('modal-confirm-btn').onclick = () => {
      const name = document.getElementById('other-activity-input').value.trim();
      if (name) logOtherActivity(name);
    };
    document.getElementById('other-activity-input').addEventListener('input', function () {
      document.getElementById('modal-confirm-btn').disabled = this.value.trim() === '';
    });
    document.getElementById('other-activity-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        const name = this.value.trim();
        if (name) logOtherActivity(name);
      }
    });

    // ── Skip modal event listeners ──────────────────────────────────────────
    document.getElementById('skip-modal').addEventListener('click', function (e) {
      if (e.target === this) closeSkipModal();
    });
    document.getElementById('skip-cancel-btn').onclick = closeSkipModal;
    document.getElementById('skip-confirm-btn').onclick = () => {
      const reason = document.getElementById('skip-reason-input').value.trim() || null;
      logSkip(reason);
    };
    document.getElementById('skip-reason-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        const reason = this.value.trim() || null;
        logSkip(reason);
      }
    });

    // ── Backfill modal event listeners ──────────────────────────────────────
    document.getElementById('backfill-modal').addEventListener('click', function (e) {
      if (e.target === this) closeBackfillModal();
    });
    document.getElementById('backfill-x-btn').onclick = closeBackfillModal;
    document.getElementById('backfill-edit-btn').onclick = () => {
      _showBackfillEdit(backfillExisting ? backfillExisting.type : null);
    };
    document.getElementById('backfill-weight-btn').onclick = () => {
      if (!backfillDate) return;
      openWeightModal(backfillDate, { fromBackfill: true });
    };
    document.getElementById('backfill-cancel-btn').onclick = () => {
      if (backfillExisting) {
        // Return to read-only view instead of closing
        _showBackfillReadonly(backfillExisting);
      } else {
        closeBackfillModal();
      }
    };
    document.getElementById('backfill-confirm-btn').onclick = confirmBackfill;
    document.getElementById('backfill-other-input').addEventListener('input', _updateBackfillConfirmBtn);
    document.getElementById('backfill-other-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !document.getElementById('backfill-confirm-btn').disabled) {
        confirmBackfill();
      }
    });

    // ── Nav event listeners ─────────────────────────────────────────────────
    document.getElementById('nav-today-btn').onclick    = () => switchMainTab('today');
    document.getElementById('nav-history-btn').onclick  = () => switchMainTab('history');
    document.getElementById('nav-stats-btn').onclick    = () => switchMainTab('stats');
    document.getElementById('nav-settings-btn').onclick = () => switchMainTab('settings');

    document.getElementById('save-profile-btn').onclick = () => saveProfile();
    document.getElementById('sync-btn').onclick = async () => {
      const syncBtn = document.getElementById('sync-btn');
      if (syncBtn.classList.contains('is-syncing')) return;

      syncBtn.classList.add('is-syncing');
      try {
        await syncAllData();
        showToast('Synced ✓');
      } catch {
        showToast('Sync failed — check your connection');
      } finally {
        syncBtn.classList.remove('is-syncing');
      }
    };
    document.getElementById('change-password-btn').onclick = () => openPasswordModal();
    document.getElementById('feedback-btn').onclick = () => openFeedbackModal();
    document.getElementById('signout-btn').onclick = async () => {
      if (!confirm('Are you sure you want to sign out?')) return;
      try {
        await sb.auth.signOut();
        cachedData    = null;
        cachedJournal = null;
        cachedWeight  = null;
        showAuthScreen();
      } catch {
        showToast('Sign out failed — check your connection');
      }
    };
    document.getElementById('delete-account-btn').onclick = () => openDeleteAccountModal();
    document.getElementById('feedback-cancel-btn').onclick = () => closeFeedbackModal();
    document.getElementById('feedback-send-btn').onclick = () => sendFeedback();
    document.getElementById('feedback-input').addEventListener('input', e => {
      document.getElementById('feedback-send-btn').disabled = e.target.value.trim() === '';
    });
    document.getElementById('feedback-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('feedback-modal')) closeFeedbackModal();
    });
    document.getElementById('password-cancel-btn').onclick = () => closePasswordModal();
    document.getElementById('password-save-btn').onclick = () => changePassword();
    document.getElementById('password-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('password-modal')) closePasswordModal();
    });
    document.getElementById('delete-account-cancel-btn').onclick = () => closeDeleteAccountModal();
    document.getElementById('delete-account-confirm-btn').onclick = () => deleteAccount();
    document.getElementById('delete-account-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('delete-account-modal')) closeDeleteAccountModal();
    });

    document.getElementById('htab-calendar').onclick   = () => switchHistorySubTab('calendar');
    document.getElementById('htab-list').onclick       = () => switchHistorySubTab('list');
    document.getElementById('htab-schedule').onclick   = () => switchHistorySubTab('schedule');

    // ── Journal event listeners ─────────────────────────────────────────────
    // ── Log activity chooser listeners ─────────────────────────────────────
    document.getElementById('log-activity-cancel-btn').onclick = () => closeLogActivityModal();
    document.getElementById('log-activity-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('log-activity-modal')) closeLogActivityModal();
    });

    // ── Weight event listeners ──────────────────────────────────────────────
    document.getElementById('weight-save-btn').onclick   = () => saveWeight();
    document.getElementById('weight-cancel-btn').onclick = () => closeWeightModal();
    document.getElementById('weight-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('weight-modal')) closeWeightModal();
    });
    document.getElementById('weight-input').addEventListener('input', () => {
      const val = parseFloat(document.getElementById('weight-input').value);
      document.getElementById('weight-save-btn').disabled = !(val >= 50 && val <= 999);
    });

    // ── Journal event listeners ─────────────────────────────────────────────
    document.getElementById('journal-save-btn').onclick   = () => saveJournal();
    document.getElementById('journal-cancel-btn').onclick = () => closeJournalModal();
    document.getElementById('journal-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('journal-modal')) closeJournalModal();
    });
    document.getElementById('journal-nudge-yes').onclick = () => {
      _journalNudgeConfirmed = true;
      document.getElementById('journal-nudge').hidden = true;
      saveJournal();
    };
    document.getElementById('journal-nudge-change').onclick = () => {
      document.getElementById('journal-nudge').hidden = true;
      document.getElementById('journal-gratitude').focus();
    };

    // ── Stats range toggle ─────────────────────────────────────────────────
    document.getElementById('stats-btn-7').onclick = () => switchStatsRange('7');
    document.getElementById('stats-btn-30').onclick = () => switchStatsRange('30');
    document.getElementById('stats-btn-all').onclick = () => switchStatsRange('all');

    function switchStatsRange(range) {
      statsRange = range;
      document.getElementById('stats-btn-7').classList.toggle('active', range === '7');
      document.getElementById('stats-btn-30').classList.toggle('active', range === '30');
      document.getElementById('stats-btn-all').classList.toggle('active', range === 'all');
      if (cachedData) renderStatsView(cachedData);
    }

    // ── Main render ─────────────────────────────────────────────────────────
    async function render(preloadedData = null) {
      const data = preloadedData || await loadData();
      cachedData = data; // cache so history renderers can access it on-demand

      const today = todayStr();
      const nextInRotation = getSuggested(data);
      const actionTakenToday = data.actionDate === today;

      // What specifically happened today (if anything)
      const todayEntry = [...(data.history || [])].reverse().find(e => e.date === today);
      const skippedToday = todayEntry?.type === 'off';
      const otherToday   = todayEntry?.type === 'other';

      // Hero card stays on the completed workout for the rest of the day.
      // Only flip to the next rotation item when a new day begins.
      const heroWorkout = (actionTakenToday && !skippedToday && !otherToday && todayEntry)
        ? (WORKOUTS.find(w => w.id === todayEntry.type) || nextInRotation)
        : nextInRotation;

      // Date label
      document.getElementById('date-label').textContent = new Date().toLocaleDateString(
        undefined, { weekday: 'long', month: 'long', day: 'numeric' }
      );

      // ── Hero card — four distinct states ─────────────────────────────────
      // 'default'  = nothing logged today → Done! + Skip + Other visible, Undo hidden
      // 'done'     = workout completed today → Undo visible, action buttons hidden
      // 'skipped'  = rest day logged today  → Undo visible, action buttons hidden
      // 'other'    = other activity logged  → Undo visible, action buttons hidden
      const history = data.history || [];
      // Derive state from todayEntry (the source of truth), not actionTakenToday.
      // actionDate and history can drift out of sync on a partial Supabase write,
      // so using todayEntry prevents a false 'done' state with no actual log entry.
      const heroState = skippedToday ? 'skipped' : otherToday ? 'other' : (todayEntry ? 'done' : 'default');
      const sugDays = data[heroWorkout.id] ? daysSince(data[heroWorkout.id]) : null;

      // Eyebrow label
      document.getElementById('suggestion-eyebrow').textContent =
        heroState === 'done'    ? 'Completed'      :
        heroState === 'skipped' ? 'Day Off'        :
        heroState === 'other'   ? 'Other Activity' : 'Next Up Workout';

      // Icon — rebuild the inner element so lucide picks up the change each render
      const heroIconWrap = document.getElementById('hero-icon-wrap');
      const heroIconName =
        heroState === 'skipped' ? 'moon' :
        heroState === 'other'   ? 'zap'  : heroWorkout.icon;
      heroIconWrap.className = 'hero-icon-wrap' +
        (heroState === 'skipped' ? ' is-rest' : heroState === 'other' ? ' is-other' : '');
      heroIconWrap.innerHTML = `<i data-lucide="${heroIconName}"></i>`;

      // Name
      document.getElementById('suggestion-name').textContent =
        heroState === 'skipped' ? 'Rest Day' :
        heroState === 'other'   ? (todayEntry?.note || 'Other Activity') :
        heroState === 'done'    ? (WORKOUTS.find(w => w.id === todayEntry.type)?.name || heroWorkout.name) :
        heroWorkout.name;

      // Subtitle
      document.getElementById('suggestion-subtitle').textContent =
        heroState === 'done'    ? 'Completed today'       :
        heroState === 'skipped' ? 'Day off logged'        :
        heroState === 'other'   ? 'Other activity logged' :
                                   lastDoneText(sugDays, false);

      // Buttons — mutually exclusive per state
      const mainBtn      = document.getElementById('main-done-btn');
      const logOtherBtn  = document.getElementById('log-other-btn');
      const undoBtn      = document.getElementById('undo-btn');

      // Re-enable all hero buttons: setButtonsDisabled(true) fires at the start of
      // every action and is never explicitly reversed — render() is the natural
      // place to restore interactive state after a round-trip completes.
      mainBtn.disabled     = false;
      logOtherBtn.disabled = false;
      undoBtn.disabled     = false;

      mainBtn.hidden     = heroState !== 'default';
      logOtherBtn.hidden = heroState !== 'default';

      if (heroState === 'default') {
        mainBtn.onclick     = markDone;
        logOtherBtn.onclick = openLogActivityModal;
        undoBtn.hidden = true;
      } else {
        // Undo button with lucide icon (no iOS emoji arrow)
        const undoLabel =
          heroState === 'skipped' ? 'Rest Day' :
          heroState === 'other'   ? (todayEntry?.note || 'Other Activity') :
          heroState === 'done'    ? (WORKOUTS.find(w => w.id === todayEntry.type)?.name || heroWorkout.name) :
          heroWorkout.name;
        undoBtn.innerHTML = '';
        const undoIcon = document.createElement('i');
        undoIcon.setAttribute('data-lucide', 'undo-2');
        undoBtn.appendChild(undoIcon);
        undoBtn.appendChild(document.createTextNode(`Undo ${undoLabel}`));
        undoBtn.onclick = undoLastEntry;
        undoBtn.hidden = false;
      }

      // Tomorrow preview — reads rotation_index directly, same source as the calendar.
      // Advancing action (Done!): rotationIndex already incremented, so ROTATION[idx] IS tomorrow.
      // Non-advancing action (skip/other/chooser): rotationIndex unchanged, so ROTATION[idx]
      //   is still today's scheduled workout, which is also tomorrow's (rotation didn't move).
      // No action yet today: rotationIndex points to today, so tomorrow is idx + 1.
      const tomorrowPreviewEl = document.getElementById('tomorrow-preview');
      tomorrowPreviewEl.hidden = heroState === 'default';
      const rotIdx = data.rotationIndex || 0;
      const tomorrowWorkout = actionTakenToday
        ? WORKOUTS.find(w => w.id === ROTATION[rotIdx % ROTATION.length])
        : WORKOUTS.find(w => w.id === ROTATION[(rotIdx + 1) % ROTATION.length]);
      const tomorrowNameEl = document.getElementById('tomorrow-name');
      tomorrowNameEl.innerHTML = '';
      const tomorrowIconEl = document.createElement('i');
      tomorrowIconEl.setAttribute('data-lucide', tomorrowWorkout.icon);
      tomorrowIconEl.className = 'tomorrow-icon';
      tomorrowNameEl.appendChild(tomorrowIconEl);
      tomorrowNameEl.appendChild(document.createTextNode(tomorrowWorkout.name));

      // First-use prompt — shown only to new users who have no history yet
      const firstUsePrompt = document.getElementById('first-use-prompt');
      if (firstUsePrompt) {
        firstUsePrompt.hidden = !(history.length === 0 && heroState === 'default');
      }

      // Update Today tab cards
      renderJournalCard();
      renderWeightCard();

      // If the history or stats view is visible, keep it in sync with the new data
      if (historyViewActive) renderHistoryView(data);
      if (statsViewActive) renderStatsView(data);

      // Replace all data-lucide placeholder elements with SVG icons
      if (typeof lucide !== 'undefined') lucide.createIcons();

    }

    // ── Test mode banner ─────────────────────────────────────────────────────
    if (TEST_MODE) {
      document.getElementById('test-banner').hidden = false;
      document.getElementById('test-reset-btn').onclick = () => {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(OTHER_ACTIVITIES_KEY);
        localStorage.removeItem(SKIP_REASONS_KEY);
        localStorage.removeItem(JOURNAL_KEY);
        localStorage.removeItem(WEIGHT_KEY);
        cachedJournal = null;
        cachedWeight  = null;
        render();
      };
      document.getElementById('test-exit-btn').onclick = toggleTestMode;
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Version stamp + sync status ───────────────────────────────────────────
    function updateSyncStamp() {
      let status = '';
      if (syncOffline) {
        status = 'offline';
      } else if (lastSyncedAt !== null) {
        const secsAgo = Math.floor((Date.now() - lastSyncedAt) / 1000);
        status = secsAgo < 60 ? 'synced just now' : `synced ${Math.floor(secsAgo / 60)}m ago`;
      }
      const stamp = status ? `v${VERSION} · ${status}` : `v${VERSION}`;
      document.getElementById('version-stamp').textContent = stamp;
      document.getElementById('settings-version-stamp').textContent = stamp;
    }
    updateSyncStamp();
    setInterval(updateSyncStamp, 30_000);

    function renderSettingsAccount() {
      const email = getUserEmail();
      const meta = getUserMetadata();
      document.getElementById('settings-email').textContent = email || 'No email found';
      document.getElementById('settings-avatar').textContent = getUserInitial();
      document.getElementById('settings-first-name').value = meta.first_name || '';
      document.getElementById('settings-last-name').value = meta.last_name || '';
      setProfileEditing(!hasSavedProfileName(meta));
    }

    function openFeedbackModal() {
      document.getElementById('feedback-input').value = '';
      document.getElementById('feedback-send-btn').disabled = true;
      document.getElementById('feedback-modal').hidden = false;
      document.getElementById('feedback-input').focus();
    }

    function closeFeedbackModal() {
      document.getElementById('feedback-modal').hidden = true;
    }

    function openPasswordModal() {
      document.getElementById('new-password-input').value = '';
      document.getElementById('password-error').hidden = true;
      document.getElementById('password-modal').hidden = false;
      document.getElementById('new-password-input').focus();
    }

    function closePasswordModal() {
      document.getElementById('password-modal').hidden = true;
    }

    function openDeleteAccountModal() {
      document.getElementById('delete-account-modal').hidden = false;
    }

    function closeDeleteAccountModal() {
      document.getElementById('delete-account-modal').hidden = true;
    }

    async function saveProfile() {
      if (!sb) {
        showToast('Could not connect to the server');
        return;
      }
      const btn = document.getElementById('save-profile-btn');
      if (!settingsProfileEditing) {
        setProfileEditing(true);
        document.getElementById('settings-first-name').focus();
        return;
      }
      const firstName = document.getElementById('settings-first-name').value.trim();
      const lastName = document.getElementById('settings-last-name').value.trim();
      btn.disabled = true;
      try {
        const { data, error } = await sb.auth.updateUser({
          data: {
            ...getUserMetadata(),
            first_name: firstName || null,
            last_name: lastName || null,
          },
        });
        if (error) throw error;
        currentUser = data.user || currentUser;
        renderSettingsAccount();
        setProfileEditing(!(firstName || lastName));
        showToast('Profile saved');
      } catch (err) {
        console.error('[profile] update failed:', err);
        showToast('Could not save profile');
      } finally {
        btn.disabled = false;
      }
    }

    async function sendPasswordReset() {
      if (!sb) {
        document.getElementById('login-error').textContent = 'Could not connect to the server. Please try again later.';
        document.getElementById('login-error').hidden = false;
        return;
      }
      const email = document.getElementById('login-email').value.trim();
      const errorEl = document.getElementById('login-error');
      errorEl.hidden = true;
      if (!email) {
        errorEl.textContent = 'Enter your email first';
        errorEl.hidden = false;
        return;
      }
      try {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}${window.location.pathname}`,
        });
        if (error) throw error;
        showToast('Password reset email sent');
      } catch (err) {
        errorEl.textContent = authErrorMessage(err);
        errorEl.hidden = false;
      }
    }

    async function changePassword() {
      if (!sb) {
        document.getElementById('password-error').textContent = 'Could not connect to the server. Please try again later.';
        document.getElementById('password-error').hidden = false;
        return;
      }
      const password = document.getElementById('new-password-input').value;
      const errorEl = document.getElementById('password-error');
      errorEl.hidden = true;
      if (password.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters';
        errorEl.hidden = false;
        return;
      }
      const btn = document.getElementById('password-save-btn');
      btn.disabled = true;
      try {
        const { data, error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        currentUser = data.user || currentUser;
        closePasswordModal();
        showToast('Password updated');
      } catch (err) {
        console.error('[auth] password update failed:', err);
        errorEl.textContent = authErrorMessage(err);
        errorEl.hidden = false;
      } finally {
        btn.disabled = false;
      }
    }

    async function sendFeedback() {
      const body = document.getElementById('feedback-input').value.trim();
      if (!body) return;
      const btn = document.getElementById('feedback-send-btn');
      btn.disabled = true;
      try {
        const payload = new URLSearchParams({
          'form-name': 'feedback',
          name: getUserDisplayName() || getUserEmail() || 'Unknown user',
          email: getUserEmail() || '',
          message: `Habits App Feedback\nFrom: ${getUserFeedbackIdentity()}\n\n${body}`,
        });
        const res = await fetch('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: payload.toString(),
        });
        if (!res.ok) throw new Error(`Feedback submit failed: ${res.status}`);
        closeFeedbackModal();
        showToast('Feedback sent');
      } catch (err) {
        console.error('[feedback] submit failed:', err);
        showToast('Could not send feedback');
      } finally {
        btn.disabled = false;
      }
    }

    async function deleteAccount() {
      if (!sb) {
        showToast('Could not connect to the server');
        return;
      }
      const btn = document.getElementById('delete-account-confirm-btn');
      btn.disabled = true;
      const userId = currentUser?.id;
      const deletionRequestedAt = new Date().toISOString();
      try {
        const [historyRes, journalRes, weightRes, stateRes] = await Promise.all([
          sb.from('history').delete().eq('user_id', userId),
          sb.from('journal').delete().eq('user_id', userId),
          sb.from('weight').delete().eq('user_id', userId),
          sb.from('state').delete().eq('user_id', userId),
        ]);
        [historyRes, journalRes, weightRes, stateRes].forEach(res => {
          if (res.error) throw res.error;
        });

        let usedFallback = false;
        try {
          const { error } = await sb.auth.admin.deleteUser(userId);
          if (error) throw error;
        } catch (adminErr) {
          usedFallback = true;
          console.warn('[account-delete] admin delete unavailable, flagging account instead:', adminErr);
          const { error } = await sb.auth.updateUser({
            data: {
              ...getUserMetadata(),
              deletion_requested_at: deletionRequestedAt,
              deletion_requested_email: getUserEmail(),
              deletion_requested_name: getUserDisplayName() || null,
            },
          });
          if (error) throw error;
        }

        closeDeleteAccountModal();
        cachedData = null;
        cachedJournal = null;
        cachedWeight = null;
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(JOURNAL_KEY);
        localStorage.removeItem(WEIGHT_KEY);
        localStorage.removeItem(OTHER_ACTIVITIES_KEY);
        localStorage.removeItem(SKIP_REASONS_KEY);
        showToast(usedFallback ? 'Goodbye - account flagged for deletion' : 'Goodbye');
        setTimeout(() => {
          sb.auth.signOut();
        }, 1200);
      } catch (err) {
        console.error('[account-delete] failed:', err);
        showToast('Could not delete account');
      } finally {
        btn.disabled = false;
      }
    }

    function toggleTestMode() {
      const url = new URL(window.location.href);
      if (url.searchParams.get('test') === 'true') {
        url.searchParams.delete('test');
      } else {
        url.searchParams.set('test', 'true');
      }
      window.location.href = url.toString();
    }

    // Triple-tap within 600 ms to toggle test mode
    let _tapCount = 0;
    let _tapTimer = null;
    document.getElementById('version-stamp').addEventListener('click', () => {
      _tapCount++;
      if (_tapCount === 3) {
        _tapCount = 0;
        clearTimeout(_tapTimer);
        toggleTestMode();
        return;
      }
      clearTimeout(_tapTimer);
      _tapTimer = setTimeout(() => { _tapCount = 0; }, 600);
    });

    // Alt+Shift+T (desktop) — same toggle (Ctrl+Shift+T is reserved by browsers)
    document.addEventListener('keydown', e => {
      if (e.altKey && e.shiftKey && e.key === 'T') toggleTestMode();
    });
    // ──────────────────────────────────────────────────────────────────────────

    // ── Auth panel navigation ────────────────────────────────────────────────
    document.getElementById('show-signup-btn').onclick = () => {
      document.getElementById('login-panel').hidden = true;
      document.getElementById('signup-panel').hidden = false;
    };
    document.getElementById('show-login-btn').onclick = () => {
      document.getElementById('signup-panel').hidden = true;
      document.getElementById('login-panel').hidden = false;
    };
    document.getElementById('forgot-password-btn').onclick = () => sendPasswordReset();
    // ────────────────────────────────────────────────────────────────────────

    // ── Auth helpers ─────────────────────────────────────────────────────────
    function showApp() {
      document.getElementById('auth-screen').hidden = true;
      document.getElementById('app-container').hidden = false;
      document.getElementById('bottom-nav').hidden = false;
      renderSettingsAccount();
    }

    function showAuthScreen() {
      cachedData    = null;
      cachedJournal = null;
      cachedWeight  = null;
      document.getElementById('auth-screen').hidden = false;
      document.getElementById('app-container').hidden = true;
      document.getElementById('bottom-nav').hidden = true;
      // Reset both panels to a clean state
      document.getElementById('login-email').value    = '';
      document.getElementById('login-password').value = '';
      document.getElementById('login-error').hidden   = true;
      document.getElementById('signup-email').value    = '';
      document.getElementById('signup-password').value = '';
      document.getElementById('signup-error').hidden          = true;
      document.getElementById('signup-password-error').hidden = true;
      document.getElementById('feedback-modal').hidden = true;
      document.getElementById('password-modal').hidden = true;
      document.getElementById('delete-account-modal').hidden = true;
      // Always land on the login panel
      document.getElementById('login-panel').hidden  = false;
      document.getElementById('signup-panel').hidden = true;
    }

    function authErrorMessage(err) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('invalid login') || msg.includes('invalid credentials') || msg.includes('wrong password')) {
        return 'Incorrect email or password';
      }
      if (msg.includes('already registered') || msg.includes('user already exists') || msg.includes('already been registered')) {
        return 'An account with this email already exists';
      }
      if (msg.includes('password') && (msg.includes('character') || msg.includes('short'))) {
        return 'Password must be at least 8 characters';
      }
      if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('email send rate')) {
        return 'Too many attempts. Please wait a moment and try again.';
      }
      console.error('[auth] Unhandled Supabase error:', err);
      return 'Something went wrong. Please try again.';
    }

    // Bundles the three calls that kick off the main app after auth is confirmed.
    function initApp() {
      switchMainTab('today');
      renderSettingsAccount();
      render();
      loadJournal().then(() => {
        renderJournalCard();
        if (historyViewActive && historySubTab === 'calendar' && cachedData) {
          renderCalendar(cachedData);
        }
      });
      loadWeight().then(() => {
        renderWeightCard();
        if (historyViewActive && historySubTab === 'calendar' && cachedData) {
          renderCalendar(cachedData);
        }
        if (statsViewActive && cachedData) {
          renderStatsView(cachedData);
        }
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Auth input Enter-key handlers ────────────────────────────────────────
    ['login-email', 'login-password'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('login-btn').click();
      });
    });
    ['signup-email', 'signup-password'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('signup-btn').click();
      });
    });
    document.getElementById('new-password-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('password-save-btn').click();
    });
    // ─────────────────────────────────────────────────────────────────────────

    // ── Sign In button ────────────────────────────────────────────────────────
    document.getElementById('login-btn').onclick = async () => {
      const email    = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const errorEl  = document.getElementById('login-error');
      errorEl.hidden = true;
      const btn = document.getElementById('login-btn');
      btn.disabled = true;
      try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        currentUser = data.user;
        showApp();
        initApp();
      } catch (err) {
        errorEl.textContent = authErrorMessage(err);
        errorEl.hidden = false;
      } finally {
        btn.disabled = false;
      }
    };

    // ── Create Account button ─────────────────────────────────────────────────
    document.getElementById('signup-btn').onclick = async () => {
      const email    = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      const errorEl  = document.getElementById('signup-error');
      const pwErrEl  = document.getElementById('signup-password-error');
      pwErrEl.hidden = true;
      errorEl.hidden = true;
      if (password.length < 8) {
        pwErrEl.hidden = false;
        return;
      }
      const btn = document.getElementById('signup-btn');
      btn.disabled = true;
      try {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          // Supabase email confirmation is enabled — account created but not yet
          // confirmed. Do not unlock the app; prompt the user to check their inbox.
          errorEl.textContent = 'Account created! Check your email to confirm before signing in.';
          errorEl.hidden = false;
          return;
        }
        currentUser = data.user;
        showApp();
        initApp();
      } catch (err) {
        errorEl.textContent = authErrorMessage(err);
        errorEl.hidden = false;
      } finally {
        btn.disabled = false;
      }
    };

    // ── Startup auth check ────────────────────────────────────────────────────
    // onAuthStateChange handles session expiry → show login screen.
    // The startup getSession() check handles returning users on reload.
    if (sb) {
      sb.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          currentUser = null;
          showAuthScreen();
        } else if (event === 'PASSWORD_RECOVERY' && session) {
          currentUser = session.user;
          showApp();
          initApp();
          openPasswordModal();
          showToast('Choose a new password');
        } else if (session) {
          currentUser = session.user;
        }
      });

      (async () => {
        const { data: { session } } = await sb.auth.getSession();
        if (session) {
          currentUser = session.user;
          showApp();
          initApp();
        }
        // No session → auth screen stays visible (already shown by default)
      })();
    } else {
      // Supabase client unavailable — auth is not possible, leave login screen visible
      document.getElementById('login-error').textContent = 'Could not connect to the server. Please try again later.';
      document.getElementById('login-error').hidden = false;
    }

  }); // end DOMContentLoaded

  // Register service worker outside DOMContentLoaded so it starts as early as
  // possible — it does not depend on the Supabase client.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
