  // DOMContentLoaded ensures the deferred Supabase CDN script has executed before
  // app initialisation runs. Without this wrapper, the inline script would run
  // during HTML parsing — before the deferred script — and window.supabase
  // would be undefined.
  document.addEventListener('DOMContentLoaded', function () {

    // ── Supabase config ──────────────────────────────────────────────────────
    const SUPABASE_URL = '%%SUPABASE_URL%%';
    const SUPABASE_KEY = '%%SUPABASE_KEY%%';
    let sb = null;
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

    const VERSION = '1.0.40';

    // ── Test mode ────────────────────────────────────────────────────────────
    const TEST_MODE = new URLSearchParams(window.location.search).get('test') === 'true';
    const STORAGE_KEY = TEST_MODE ? 'wmw_test' : 'wmw_v1';
    // ────────────────────────────────────────────────────────────────────────

    async function loadData() {
      if (!sb || TEST_MODE) {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch { return {}; }
      }
      try {
        // ── Offline sync ────────────────────────────────────────────────────────
        // Entries written while offline have no _sid — they were saved to
        // localStorage only. Push them to Supabase before the normal read so
        // they are not silently overwritten by stale remote state.
        let local = {};
        try { local = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch {}
        const unsynced = (local.history || []).filter(e => !e._sid);
        if (unsynced.length) {
          // Check whether local state (rotation / actionDate) is ahead of Supabase
          const { data: remoteState, error: stateReadErr } = await sb.from('state')
            .select('rotation_index,action_date').eq('id', 1).maybeSingle();
          if (stateReadErr) throw stateReadErr;
          // Upsert local state when the remote row is missing (null = fresh DB)
          // OR when local is ahead — rotationIndex is the primary tie-breaker.
          const localRotation  = local.rotationIndex ?? 0;
          const remoteRotation = remoteState ? (remoteState.rotation_index ?? 0) : -1;
          const localAhead =
            !remoteState ||
            localRotation > remoteRotation ||
            (localRotation === remoteRotation &&
             (local.actionDate || '') > (remoteState.action_date || ''));
          if (localAhead) {
            const { error: upsertErr } = await sb.from('state').upsert({
              id: 1,
              rotation_index: local.rotationIndex ?? 0,
              action_date:    local.actionDate    ?? null,
            });
            if (upsertErr) throw upsertErr;
          }
          // Insert the unsynced history entries.
          // Query the current max sequence first so offline rows never collide
          // with gaps left by undo deletions (same fix as in saveData).
          const { data: maxSeqRow, error: maxSeqErr } = await sb.from('history')
            .select('sequence').order('sequence', { ascending: false }).limit(1).maybeSingle();
          if (maxSeqErr) throw maxSeqErr;
          const offlineBase = (maxSeqRow?.sequence ?? -1) + 1;
          const offlineRows = unsynced.map((e, i) => ({
            type:     e.type,
            date:     e.date,
            advanced: e.advanced ?? true,
            note:     e.note ?? null,
            sequence: offlineBase + i,
          }));
          console.log('[loadData] Offline sync — inserting unsynced rows:', offlineRows.map(r => ({ type: r.type, date: r.date, sequence: r.sequence })));
          const { data: inserted, error: insErr } = await sb.from('history')
            .insert(offlineRows).select('id, sequence');
          if (insErr) {
            console.error('[loadData] Offline sync INSERT failed:', insErr, 'rows attempted:', offlineRows.map(r => ({ type: r.type, date: r.date, sequence: r.sequence })));
            throw insErr;
          }
          console.log('[loadData] Offline sync INSERT succeeded:', inserted);
          // Match by sequence rather than array position — insert order is not
          // guaranteed to be preserved in the returned rows.
          inserted.forEach(row => {
            const match = unsynced.find((_, i) => offlineRows[i].sequence === row.sequence);
            if (match) match._sid = row.id;
          });
          localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
        }
        // ────────────────────────────────────────────────────────────────────────

        const [stateRes, historyRes] = await Promise.all([
          sb.from('state').select('*').eq('id', 1).maybeSingle(),
          // Order by sequence (explicit insert order) rather than created_at so that
          // batch re-inserts — which share the same timestamp — come back in the
          // correct order.
          sb.from('history').select('*').order('sequence', { ascending: true, nullsFirst: true }),
        ]);
        if (stateRes.error) throw stateRes.error;
        if (historyRes.error) throw historyRes.error;

        const state = stateRes.data || {};
        const historyRows = historyRes.data || [];

        // _maxSeq must be the true highest sequence in Supabase so new inserts
        // always use max + 1. Take the max of (a) what Supabase just returned
        // and (b) what localStorage already recorded — guards against read-after-
        // write timing where a just-inserted row hasn't appeared in SELECT yet.
        const supabaseMaxSeq = historyRows.reduce((m, r) => Math.max(m, r.sequence ?? -1), -1);
        const localMaxSeq    = typeof local._maxSeq === 'number' ? local._maxSeq : -1;

        const data = {
          rotationIndex: state.rotation_index ?? 0,
          actionDate:    state.action_date   ?? null,
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
      // Always write localStorage immediately so the fallback is always fresh
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      if (!sb || TEST_MODE) return; // localStorage-only or test mode — skip Supabase
      try {
        // Upsert the single state row (rotation position + today's lock)
        const { error: stateErr } = await sb.from('state').upsert({
          id: 1,
          rotation_index: data.rotationIndex ?? 0,
          action_date:    data.actionDate    ?? null,
        });
        if (stateErr) throw stateErr;

        // If this save was triggered by an undo, delete only that one row
        if (deletedSid) {
          const { error: delErr } = await sb.from('history').delete().eq('id', deletedSid);
          if (delErr) throw delErr;
        }

        // Insert only new entries — those not yet synced (no _sid means never written to Supabase)
        const newEntries = (data.history || []).filter(e => !e._sid);
        if (newEntries.length) {
          // Base sequence = max existing Supabase sequence + 1, so new inserts
          // never collide with gaps left by undo deletions. _maxSeq is set by
          // loadData when reading from Supabase; fall back to synced-entry count
          // for the rare case where data came from the localStorage fallback.
          const baseSeq = (typeof data._maxSeq === 'number' ? data._maxSeq : data.history.filter(e => e._sid).length - 1) + 1;
          const rows = newEntries.map((e, i) => ({
            type: e.type,
            date: e.date,
            advanced: e.advanced ?? true,
            note: e.note ?? null,
            sequence: baseSeq + i,
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
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
        lastSyncedAt = Date.now();
        syncOffline  = false;
        updateSyncStamp();
      } catch (err) {
        console.warn('Supabase write failed (data saved locally):', err);
        syncOffline = true;
        updateSyncStamp();
      }
    }

    function todayStr() {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
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

    // ── Double-tap guard ─────────────────────────────────────────────────────
    // Each action function sets this true at the start and false when complete
    // (via try/finally). Any tap that arrives during a network round-trip hits
    // the guard and returns immediately — no duplicate mutations.
    let isProcessing = false;
    let lastSyncedAt = null;  // Date.now() timestamp of last successful Supabase sync
    let syncOffline  = false; // true if the last Supabase attempt failed

    function setButtonsDisabled(disabled) {
      ['main-done-btn', 'skip-btn', 'log-other-btn', 'undo-btn'].forEach(id => {
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
        data.history = data.history || [];
        data.history.push({ type: id, date: today, advanced: false });

        await saveData(data);
        render(data);
        showToast('Logged \u2713');
      } finally {
        isProcessing = false;
      }
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
    const OTHER_ACTIVITIES_KEY = TEST_MODE ? 'wmw_test_other_activities' : 'wmw_other_activities';
    const SKIP_REASONS_KEY = STORAGE_KEY + '_skip_reasons';

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

    let backfillDate     = null;  // 'YYYY-MM-DD' being edited
    let backfillExisting = null;  // existing history entry object, or null
    let backfillSelectedType = null; // currently selected option id
    let backfillSaving   = false; // true while confirmBackfill is awaiting

    function openBackfillModal(dateStr) {
      backfillDate = dateStr;

      // Find the most-recent logged entry for this date
      const history = cachedData ? (cachedData.history || []) : [];
      backfillExisting = [...history].reverse().find(e => e.date === dateStr) || null;

      // Build the date label: "Wednesday, February 19"
      const d = new Date(dateStr + 'T00:00:00');
      document.getElementById('backfill-date-label').textContent =
        `${BF_WEEKDAYS[d.getDay()]}, ${BF_MONTHS[d.getMonth()]} ${d.getDate()}`;

      if (backfillExisting) {
        // Entry exists — open in read-only mode
        _showBackfillReadonly(backfillExisting);
      } else {
        // No entry — open straight into edit/new mode
        backfillSelectedType = null;
        _showBackfillEdit(null);
      }

      document.getElementById('backfill-modal').hidden = false;
    }

    function closeBackfillModal() {
      if (backfillSaving) return; // don't dismiss while a save is in flight
      document.getElementById('backfill-modal').hidden = true;
      backfillDate     = null;
      backfillExisting = null;
      backfillSelectedType = null;
    }

    function _showBackfillReadonly(entry) {
      document.getElementById('backfill-readonly').hidden  = false;
      document.getElementById('backfill-edit-view').hidden = true;

      const isOff   = entry.type === 'off';
      const isOther = entry.type === 'other';
      const workout = (!isOff && !isOther) ? WORKOUTS.find(w => w.id === entry.type) : null;

      const iconName   = isOff ? 'moon' : isOther ? 'zap' : (workout ? workout.icon : 'dumbbell');
      const displayName = isOff   ? (entry.note || 'Rest Day') :
                          isOther ? (entry.note || 'Other Activity') :
                          (workout ? workout.name : entry.type);

      const iconEl = document.getElementById('backfill-readonly-icon');
      iconEl.className = 'backfill-readonly-icon' +
        (isOff ? ' is-rest' : isOther ? ' is-other' : '');
      iconEl.innerHTML = `<i data-lucide="${iconName}"></i>`;
      document.getElementById('backfill-readonly-name').textContent = displayName;

      if (typeof lucide !== 'undefined') lucide.createIcons();
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

            // Advance rotation only when the entry was found and mutated,
            // and only if it wasn't already counted
            if (shouldAdvance && !wasAdvanced) {
              data.rotationIndex = (data.rotationIndex || 0) + 1;
            }
            // Never decrement, even if the entry changed from workout → rest/other
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

      } finally {
        isProcessing  = false;
        backfillSaving = false;
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── History view state ──────────────────────────────────────────────────
    let cachedData = null;        // last-loaded data, used by history renders
    let historyViewActive = false;
    let historySubTab = 'calendar'; // 'calendar' or 'list'
    let calViewDate = new Date(); // month currently shown in the calendar

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
        html += `<div class="${classes.join(' ')}"${dateAttr}>${iconHtml}<span class="cal-day-num">${day}</span></div>`;
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
        html += '<div class="hlist-empty">No workouts logged yet.</div>';
      }

      if (futureRows.length) {
        html += '<div class="hlist-section-label">Coming Up</div>';
        html += '<div class="hlist">';
        for (const r of futureRows) {
          html += rowHtml(r.date, r.type, true, false);
        }
        html += '</div>';
      }

      container.innerHTML = html;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // Decide which history sub-view to render
    function renderHistoryView(data) {
      if (historySubTab === 'calendar') renderCalendar(data);
      else renderHistoryList(data);
    }

    // ── Tab switching ───────────────────────────────────────────────────────
    function switchMainTab(tab) {
      historyViewActive = tab === 'history';
      document.getElementById('view-today').hidden   = historyViewActive;
      document.getElementById('view-history').hidden = !historyViewActive;
      document.getElementById('nav-today-btn').classList.toggle('active', !historyViewActive);
      document.getElementById('nav-history-btn').classList.toggle('active', historyViewActive);
      if (historyViewActive && cachedData) renderHistoryView(cachedData);
    }

    function switchHistorySubTab(tab) {
      historySubTab = tab;
      document.getElementById('htab-calendar').classList.toggle('active', tab === 'calendar');
      document.getElementById('htab-list').classList.toggle('active', tab === 'list');
      document.getElementById('hview-calendar').hidden = tab !== 'calendar';
      document.getElementById('hview-list').hidden     = tab !== 'list';
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
    document.getElementById('backfill-ro-close-btn').onclick = closeBackfillModal;
    document.getElementById('backfill-edit-btn').onclick = () => {
      _showBackfillEdit(backfillExisting ? backfillExisting.type : null);
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
    document.getElementById('nav-today-btn').onclick   = () => switchMainTab('today');
    document.getElementById('nav-history-btn').onclick = () => switchMainTab('history');
    document.getElementById('htab-calendar').onclick   = () => switchHistorySubTab('calendar');
    document.getElementById('htab-list').onclick       = () => switchHistorySubTab('list');

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
        heroState === 'other'   ? 'Other Activity' : 'Next Up';

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
        heroWorkout.name;

      // Subtitle
      document.getElementById('suggestion-subtitle').textContent =
        heroState === 'done'    ? 'Completed today'       :
        heroState === 'skipped' ? 'Day off logged'        :
        heroState === 'other'   ? 'Other activity logged' :
                                   lastDoneText(sugDays, false);

      // Buttons — mutually exclusive per state
      const mainBtn      = document.getElementById('main-done-btn');
      const skipBtn      = document.getElementById('skip-btn');
      const logOtherBtn  = document.getElementById('log-other-btn');
      const undoBtn      = document.getElementById('undo-btn');

      // Re-enable all hero buttons: setButtonsDisabled(true) fires at the start of
      // every action and is never explicitly reversed — render() is the natural
      // place to restore interactive state after a round-trip completes.
      mainBtn.disabled     = false;
      skipBtn.disabled     = false;
      logOtherBtn.disabled = false;
      undoBtn.disabled     = false;

      mainBtn.hidden     = heroState !== 'default';
      skipBtn.hidden     = heroState !== 'default';
      logOtherBtn.hidden = heroState !== 'default';

      if (heroState === 'default') {
        mainBtn.onclick    = markDone;
        skipBtn.onclick    = openSkipModal;
        logOtherBtn.onclick = openOtherActivityModal;
        undoBtn.hidden = true;
      } else {
        // Undo button with lucide icon (no iOS emoji arrow)
        const undoLabel =
          heroState === 'skipped' ? 'Rest Day' :
          heroState === 'other'   ? (todayEntry?.note || 'Other Activity') :
          heroWorkout.name;
        undoBtn.innerHTML = '';
        const undoIcon = document.createElement('i');
        undoIcon.setAttribute('data-lucide', 'undo-2');
        undoBtn.appendChild(undoIcon);
        undoBtn.appendChild(document.createTextNode(`Undo ${undoLabel}`));
        undoBtn.onclick = undoLastEntry;
        undoBtn.hidden = false;
      }

      // Tomorrow row — one step ahead of whatever is currently next
      // If action was taken today, rotation already advanced so nextInRotation IS tomorrow.
      // If today hasn't been actioned yet, rotation still points to today, so add 1.
      const tomorrowWorkout = actionTakenToday
        ? nextInRotation
        : WORKOUTS.find(w => w.id === ROTATION[((data.rotationIndex || 0) + 1) % ROTATION.length]);
      const tomorrowNameEl = document.getElementById('tomorrow-name');
      tomorrowNameEl.innerHTML = '';
      const tomorrowIconEl = document.createElement('i');
      tomorrowIconEl.setAttribute('data-lucide', tomorrowWorkout.icon);
      tomorrowIconEl.className = 'tomorrow-icon';
      tomorrowNameEl.appendChild(tomorrowIconEl);
      tomorrowNameEl.appendChild(document.createTextNode(tomorrowWorkout.name));

      // Workout list — suggested first, then by most recently done
      const sorted = [...WORKOUTS].sort((a, b) => {
        if (a.id === nextInRotation.id) return -1;
        if (b.id === nextInRotation.id) return 1;
        const doneA = data[a.id] === today;
        const doneB = data[b.id] === today;
        const daysA = data[a.id] ? daysSince(data[a.id]) : null;
        const daysB = data[b.id] ? daysSince(data[b.id]) : null;
        const scoreA = doneA ? -1 : (daysA === null ? Infinity : daysA);
        const scoreB = doneB ? -1 : (daysB === null ? Infinity : daysB);
        return scoreB - scoreA;
      });

      const list = document.getElementById('workout-list');
      list.innerHTML = '';

      for (const w of sorted) {
        const last = data[w.id];
        const days = last ? daysSince(last) : null;
        const doneToday = last === today;
        const isSuggested = w.id === nextInRotation.id;

        const row = document.createElement('div');
        row.className = [
          'workout-row',
          isSuggested ? 'is-suggested' : '',
          doneToday   ? 'done-today'   : '',
        ].filter(Boolean).join(' ');

        const info = document.createElement('div');
        info.className = 'workout-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'workout-name';
        const rowIconEl = document.createElement('i');
        rowIconEl.setAttribute('data-lucide', w.icon);
        rowIconEl.className = 'row-icon';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = w.name;
        nameEl.appendChild(rowIconEl);
        nameEl.appendChild(nameSpan);

        const lastEl = document.createElement('div');
        lastEl.className = 'workout-last';
        lastEl.textContent = lastDoneText(days, doneToday);

        info.appendChild(nameEl);
        info.appendChild(lastEl);

        const pill = document.createElement('span');
        pill.className = 'days-pill ' + pillClass(days, doneToday);
        pill.textContent = pillText(days, doneToday);

        const btn = document.createElement('button');
        btn.className = 'row-done-btn';
        btn.textContent = doneToday ? '\u2713' : 'Done';
        btn.disabled = doneToday;
        if (!doneToday) btn.onclick = () => markRowDone(w.id);

        row.appendChild(info);
        row.appendChild(pill);
        row.appendChild(btn);
        list.appendChild(row);
      }

      // If the history view is visible, keep it in sync with the new data
      if (historyViewActive) renderHistoryView(data);

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
        render();
      };
      document.getElementById('test-exit-btn').onclick = toggleTestMode;
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Version stamp + sync status ───────────────────────────────────────────
    function updateSyncStamp() {
      const el = document.getElementById('version-stamp');
      let status = '';
      if (syncOffline) {
        status = 'offline';
      } else if (lastSyncedAt !== null) {
        const secsAgo = Math.floor((Date.now() - lastSyncedAt) / 1000);
        status = secsAgo < 60 ? 'synced just now' : `synced ${Math.floor(secsAgo / 60)}m ago`;
      }
      el.textContent = status ? `v${VERSION} · ${status}` : `v${VERSION}`;
    }
    updateSyncStamp();
    setInterval(updateSyncStamp, 30_000);

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

    render();

  }); // end DOMContentLoaded

  // Register service worker outside DOMContentLoaded so it starts as early as
  // possible — it does not depend on the Supabase client.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
