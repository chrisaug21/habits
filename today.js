window.HabitsApp = window.HabitsApp || {};

window.HabitsApp.registerTodayModule = function registerTodayModule(ctx) {
  const { TEST_MODE, BASE_OTHER_ACTIVITIES_KEY, BASE_SKIP_REASONS_KEY, BASE_JOURNAL_KEY, BASE_WEIGHT_KEY, DEFAULT_USER_PREFERENCES, SKIP_DEFAULTS, MAX_ACTIVITY_LENGTH } = ctx.constants;
  const state = ctx.state;
  const utils = ctx.utils;
  const data = ctx.data;
  const deps = ctx.deps;

  async function markDone() {
    if (state.isProcessing) return;
    state.isProcessing = true;
    utils.setButtonsDisabled(true);
    try {
      const loaded = await data.loadData();
      const today = utils.todayStr();
      const rotation = utils.getActiveRotation();
      const idx = (loaded.rotationIndex || 0) % rotation.length;
      const workoutId = rotation[idx].id;

      loaded[workoutId] = today;
      loaded.rotationIndex = (idx + 1) % rotation.length;
      loaded.actionDate = today;
      loaded.history = loaded.history || [];
      loaded.history.push({ type: workoutId, date: today, advanced: true });

      await data.saveData(loaded);
      render(loaded);
      utils.showToast('Logged ✓');
    } catch {
      utils.setButtonsDisabled(false);
      utils.showToast('Could not save — check your connection');
    } finally {
      state.isProcessing = false;
    }
  }

  function openSkipModal() {
    const modal = document.getElementById('skip-modal');
    const input = document.getElementById('skip-reason-input');
    const chipsEl = document.getElementById('skip-reason-chips');

    const saved = loadSkipReasons();
    const chips = saved.length ? saved : SKIP_DEFAULTS;

    chipsEl.innerHTML = '';
    for (const reason of chips) {
      const chip = document.createElement('button');
      chip.className = 'activity-chip';
      chip.textContent = reason;
      chip.type = 'button';
      chip.onclick = () => {
        input.value = reason;
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
    if (state.isProcessing) return;
    state.isProcessing = true;
    utils.setButtonsDisabled(true);
    try {
      closeSkipModal();
      const loaded = await data.loadData();
      const today = utils.todayStr();

      loaded.actionDate = today;
      loaded.history = loaded.history || [];
      const entry = { type: 'off', date: today, advanced: false };
      if (reason) entry.note = reason;
      loaded.history.push(entry);

      await data.saveData(loaded);
      if (reason) saveSkipReason(reason);
      render(loaded);
      utils.showToast('Day off logged');
    } catch {
      utils.setButtonsDisabled(false);
      utils.showToast('Could not save — check your connection');
    } finally {
      state.isProcessing = false;
    }
  }

  async function undoLastEntry() {
    if (state.isProcessing) return;
    state.isProcessing = true;
    utils.setButtonsDisabled(true);
    try {
      const loaded = await data.loadData();
      const today = utils.todayStr();
      const yesterday = utils.getYesterdayStr();
      const history = loaded.history || [];
      if (!history.length) {
        render(loaded);
        return;
      }

      const last = history[history.length - 1];
      if (last.date !== today && last.date !== yesterday) {
        render(loaded);
        return;
      }

      const deletedSid = last._sid ?? null;
      loaded.history = history.slice(0, -1);

      if (last.type !== 'off') {
        const prev = [...loaded.history].reverse().find(entry => entry.type === last.type);
        if (prev) loaded[last.type] = prev.date;
        else delete loaded[last.type];
      }

      const wasRotationAdvancing =
        last.advanced === true ||
        (!('advanced' in last) && last.type !== 'off');
      if (wasRotationAdvancing) {
        const rotation = utils.getActiveRotation();
        loaded.rotationIndex = ((loaded.rotationIndex || 0) - 1 + rotation.length) % rotation.length;
      }

      const stillLockedToday = (loaded.history || []).some(entry =>
        entry.date === today && (
          entry.advanced === true ||
          entry.type === 'off' ||
          entry.type === 'other' ||
          (!('advanced' in entry) && entry.type !== 'off')
        )
      );
      if (stillLockedToday) loaded.actionDate = today;
      else delete loaded.actionDate;

      await data.saveData(loaded, deletedSid);
      render(loaded);
      const name = last.type === 'off'
        ? 'day off'
        : last.type === 'other'
        ? (last.note || 'other activity')
        : (utils.getWorkoutById(last.type)?.name ?? last.type);
      utils.showToast(`Undone — ${name}`);
    } catch {
      utils.setButtonsDisabled(false);
      utils.showToast('Could not save — check your connection');
    } finally {
      state.isProcessing = false;
    }
  }

  async function markRowDone(id) {
    if (state.isProcessing) return;
    state.isProcessing = true;
    utils.setButtonsDisabled(true);
    try {
      const loaded = await data.loadData();
      const today = utils.todayStr();

      loaded[id] = today;
      loaded.actionDate = today;
      loaded.history = loaded.history || [];
      loaded.history.push({ type: id, date: today, advanced: false });

      await data.saveData(loaded);
      render(loaded);
      utils.showToast('Logged ✓');
    } catch {
      utils.setButtonsDisabled(false);
      utils.showToast('Could not save — check your connection');
    } finally {
      state.isProcessing = false;
    }
  }

  function openLogActivityModal() {
    const opts = document.getElementById('log-activity-options');
    opts.innerHTML = '';

    const suggestedId = state.cachedData ? utils.getSuggested(state.cachedData)?.id : null;
    for (const workout of utils.getActiveWorkoutList()) {
      if (workout.id === suggestedId) continue;
      const btn = document.createElement('button');
      btn.className = 'log-activity-option';
      btn.type = 'button';
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', workout.icon);
      btn.appendChild(icon);
      btn.appendChild(document.createTextNode(workout.name));
      btn.onclick = () => {
        closeLogActivityModal();
        markRowDone(workout.id);
      };
      opts.appendChild(btn);
    }

    const restBtn = document.createElement('button');
    restBtn.className = 'log-activity-option';
    restBtn.type = 'button';
    const moonIcon = document.createElement('i');
    moonIcon.setAttribute('data-lucide', 'moon');
    restBtn.appendChild(moonIcon);
    restBtn.appendChild(document.createTextNode('Rest Day'));
    restBtn.onclick = () => {
      closeLogActivityModal();
      openSkipModal();
    };
    opts.appendChild(restBtn);

    const otherBtn = document.createElement('button');
    otherBtn.className = 'log-activity-option log-activity-option--other';
    otherBtn.type = 'button';
    const zapIcon = document.createElement('i');
    zapIcon.setAttribute('data-lucide', 'zap');
    otherBtn.appendChild(zapIcon);
    otherBtn.appendChild(document.createTextNode('Other activity…'));
    otherBtn.onclick = () => {
      closeLogActivityModal();
      openOtherActivityModal();
    };
    opts.appendChild(otherBtn);

    document.getElementById('log-activity-modal').hidden = false;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    setTimeout(() => opts.querySelector('.log-activity-option')?.focus(), 80);
  }

  function closeLogActivityModal() {
    document.getElementById('log-activity-modal').hidden = true;
  }

  function loadOtherActivities() {
    try {
      const parsed = data.readCachedJSON(BASE_OTHER_ACTIVITIES_KEY, []);
      if (typeof parsed === 'string') return [parsed];
      if (Array.isArray(parsed)) return parsed.filter(activity => typeof activity === 'string');
      return [];
    } catch {
      return [];
    }
  }

  function saveOtherActivities(name) {
    const existing = loadOtherActivities();
    const nameLower = name.toLowerCase();
    const deduped = existing.filter(activity => activity.toLowerCase() !== nameLower);
    data.writeCachedJSON(BASE_OTHER_ACTIVITIES_KEY, [name, ...deduped].slice(0, 10));
  }

  function loadSkipReasons() {
    try {
      const parsed = data.readCachedJSON(BASE_SKIP_REASONS_KEY, []);
      if (typeof parsed === 'string') return [parsed];
      if (Array.isArray(parsed)) return parsed.filter(reason => typeof reason === 'string');
      return [];
    } catch {
      return [];
    }
  }

  function saveSkipReason(reason) {
    const existing = loadSkipReasons();
    const reasonLower = reason.toLowerCase();
    const deduped = existing.filter(saved => saved.toLowerCase() !== reasonLower);
    data.writeCachedJSON(BASE_SKIP_REASONS_KEY, [reason, ...deduped].slice(0, 10));
  }

  function openOtherActivityModal() {
    const modal = document.getElementById('other-activity-modal');
    const input = document.getElementById('other-activity-input');
    const chipsEl = document.getElementById('other-activity-chips');
    const confirmBtn = document.getElementById('modal-confirm-btn');

    chipsEl.innerHTML = '';
    for (const activity of loadOtherActivities()) {
      const chip = document.createElement('button');
      chip.className = 'activity-chip';
      chip.textContent = activity;
      chip.type = 'button';
      chip.onclick = () => {
        input.value = activity;
        confirmBtn.disabled = false;
        setTimeout(() => input.focus(), 50);
      };
      chipsEl.appendChild(chip);
    }

    input.value = '';
    confirmBtn.disabled = true;
    modal.hidden = false;
    setTimeout(() => input.focus(), 80);
  }

  function closeOtherActivityModal() {
    document.getElementById('other-activity-modal').hidden = true;
  }

  async function logOtherActivity(activityName) {
    const name = String(activityName || '').trim().slice(0, MAX_ACTIVITY_LENGTH);
    if (!name || state.isProcessing) return;
    state.isProcessing = true;
    utils.setButtonsDisabled(true);
    try {
      closeOtherActivityModal();
      const loaded = await data.loadData();
      const today = utils.todayStr();

      loaded.actionDate = today;
      loaded.history = loaded.history || [];
      loaded.history.push({ type: 'other', date: today, advanced: false, note: name });

      await data.saveData(loaded);
      saveOtherActivities(name);
      render(loaded);
      utils.showToast(`${name} logged`);
    } catch {
      utils.setButtonsDisabled(false);
      utils.showToast('Could not save — check your connection');
    } finally {
      state.isProcessing = false;
    }
  }

  function getJournalSync() {
    if (state.cachedJournal !== null) return state.cachedJournal;
    state.cachedJournal = data.readCachedJSON(BASE_JOURNAL_KEY, []);
    return state.cachedJournal;
  }

  async function loadJournal() {
    const local = data.readCachedJSON(BASE_JOURNAL_KEY, []);
    if (!state.sb || TEST_MODE) {
      state.cachedJournal = local;
      return local;
    }
    try {
      const { data: rows, error } = await state.sb.from('journal').select('*').eq('user_id', state.currentUser?.id)
        .order('date', { ascending: false });
      if (error) throw error;
      const journal = (rows || []).map(row => ({
        date: row.date,
        intention: row.intention || '',
        gratitude: row.gratitude || '',
        one_thing: row.one_thing || '',
      }));
      data.writeCachedJSON(BASE_JOURNAL_KEY, journal);
      state.cachedJournal = journal;
      return journal;
    } catch (err) {
      console.warn('Journal load failed, using localStorage:', err);
      utils.showToast('Could not load journal — showing cached data');
      state.cachedJournal = local;
      return local;
    }
  }

  async function saveJournalEntry(entry) {
    if (TEST_MODE) {
      const journal = state.cachedJournal ? [...state.cachedJournal] : [];
      const idx = journal.findIndex(item => item.date === entry.date);
      if (idx !== -1) journal[idx] = entry;
      else journal.unshift(entry);
      state.cachedJournal = journal;
      data.writeCachedJSON(BASE_JOURNAL_KEY, journal);
      return;
    }
    if (!state.sb) throw new Error('Supabase client not available');

    const { error } = await state.sb.from('journal').upsert({
      date: entry.date,
      intention: entry.intention || null,
      gratitude: entry.gratitude || null,
      one_thing: entry.one_thing || null,
      user_id: state.currentUser?.id,
    }, { onConflict: 'date,user_id' });
    if (error) throw error;

    const journal = state.cachedJournal ? [...state.cachedJournal] : [];
    const idx = journal.findIndex(item => item.date === entry.date);
    if (idx !== -1) journal[idx] = entry;
    else journal.unshift(entry);
    state.cachedJournal = journal;
    data.writeCachedJSON(BASE_JOURNAL_KEY, journal);
  }

  function checkGratitudeSimilarity(newGratitude) {
    if (!newGratitude) return false;
    const journal = state.cachedJournal || [];
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffStr = utils.dateToStr(sevenDaysAgo);
    const today = utils.todayStr();
    const needle = newGratitude.trim().toLowerCase();
    return journal.some(entry => {
      if (!entry.gratitude || entry.date >= today || entry.date < cutoffStr) return false;
      const haystack = entry.gratitude.trim().toLowerCase();
      return needle.includes(haystack) || haystack.includes(needle);
    });
  }

  function openJournalModal() {
    const journal = getJournalSync() || [];
    const todayEntry = journal.find(entry => entry.date === utils.todayStr());
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
    state.journalNudgeConfirmed = false;
  }

  function renderJournalCard() {
    if (!state.userPreferences.show_journal_card) return;
    const journal = getJournalSync() || [];
    const entry = journal.find(item => item.date === utils.todayStr());
    const content = document.getElementById('journal-card-content');
    content.innerHTML = '';

    if (entry) {
      const badge = document.createElement('div');
      badge.className = 'card-done-badge card-done-badge--journal';
      badge.textContent = 'Done ✓';
      content.appendChild(badge);

      const fields = [
        { label: 'Intention', value: entry.intention },
        { label: 'Gratitude', value: entry.gratitude },
        { label: 'One thing', value: entry.one_thing },
      ];

      const COLLAPSE_LINES = 3;

      fields.forEach(({ label, value }) => {
        if (!value) return;
        const fieldEl = document.createElement('div');
        fieldEl.className = 'journal-card-field';

        const labelEl = document.createElement('div');
        labelEl.className = 'journal-card-label';
        labelEl.textContent = label + ':';

        const valueEl = document.createElement('div');
        valueEl.className = 'journal-card-value';
        valueEl.textContent = value;

        const lineHeight = 1.45;
        const fontSize = 14;
        const maxPx = COLLAPSE_LINES * lineHeight * fontSize;

        fieldEl.appendChild(labelEl);
        fieldEl.appendChild(valueEl);
        content.appendChild(fieldEl);

        requestAnimationFrame(() => {
          if (valueEl.scrollHeight > maxPx + 4) {
            valueEl.classList.add('journal-card-value--collapsed');
            if (!content.querySelector('.journal-card-toggle')) {
              const toggle = document.createElement('button');
              toggle.className = 'journal-card-toggle';
              toggle.textContent = 'Show more';
              toggle.onclick = () => {
                const collapsed = content.querySelectorAll('.journal-card-value--collapsed');
                const expanded = content.querySelectorAll('.journal-card-value--expanded');
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
              const editBtnEl = content.querySelector('.card-edit-btn');
              if (editBtnEl) content.insertBefore(toggle, editBtnEl);
              else content.appendChild(toggle);
            }
          }
        });
      });

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
    const oneThing = document.getElementById('journal-one-thing').value.trim();

    if (!intention && !gratitude && !oneThing) return;

    if (gratitude && !state.journalNudgeConfirmed && checkGratitudeSimilarity(gratitude)) {
      document.getElementById('journal-nudge').hidden = false;
      return;
    }

    const entry = { date: utils.todayStr(), intention, gratitude, one_thing: oneThing };
    document.getElementById('journal-save-btn').disabled = true;
    try {
      await saveJournalEntry(entry);
      state.journalNudgeConfirmed = false;
      closeJournalModal();
      renderJournalCard();
      utils.showToast('Journal saved ✓');
    } catch {
      utils.showToast('Could not save — check your connection');
    } finally {
      document.getElementById('journal-save-btn').disabled = false;
    }
  }

  function getWeightSync() {
    if (state.cachedWeight !== null) return state.cachedWeight;
    state.cachedWeight = data.readCachedJSON(BASE_WEIGHT_KEY, []);
    return state.cachedWeight;
  }

  async function loadWeight() {
    const local = data.readCachedJSON(BASE_WEIGHT_KEY, []);
    if (!state.sb || TEST_MODE) {
      state.cachedWeight = local;
      return local;
    }
    try {
      const { data: rows, error } = await state.sb.from('weight').select('date, value_lbs').eq('user_id', state.currentUser?.id)
        .order('date', { ascending: false });
      if (error) throw error;
      const weights = (rows || []).map(row => ({ date: row.date, value_lbs: parseFloat(row.value_lbs) }));
      data.writeCachedJSON(BASE_WEIGHT_KEY, weights);
      state.cachedWeight = weights;
      return weights;
    } catch (err) {
      console.warn('Weight load failed, using localStorage:', err);
      utils.showToast('Could not load weight — showing cached data');
      state.cachedWeight = local;
      return local;
    }
  }

  async function syncAllData() {
    if (!state.sb) throw new Error('No Supabase connection');
    const [stateRes, historyRes, journalRes, weightRes] = await Promise.all([
      state.sb.from('state').select('*').eq('user_id', state.currentUser?.id)
        .order('id', { ascending: false }).limit(1).maybeSingle(),
      state.sb.from('history').select('*').eq('user_id', state.currentUser?.id)
        .order('sequence', { ascending: true, nullsFirst: true }),
      state.sb.from('journal').select('*').eq('user_id', state.currentUser?.id)
        .order('date', { ascending: false }),
      state.sb.from('weight').select('date, value_lbs').eq('user_id', state.currentUser?.id)
        .order('date', { ascending: false }),
      data.loadWorkoutLibrary(),
      data.loadUserRotation(),
    ]);
    if (stateRes.error) throw stateRes.error;
    if (historyRes.error) throw historyRes.error;
    if (journalRes.error) throw journalRes.error;
    if (weightRes.error) throw weightRes.error;

    state.cachedJournal = (journalRes.data || []).map(row => ({
      date: row.date,
      intention: row.intention || '',
      gratitude: row.gratitude || '',
      one_thing: row.one_thing || '',
    }));
    state.cachedWeight = (weightRes.data || []).map(row => ({ date: row.date, value_lbs: parseFloat(row.value_lbs) }));
    data.writeCachedJSON(BASE_JOURNAL_KEY, state.cachedJournal);
    data.writeCachedJSON(BASE_WEIGHT_KEY, state.cachedWeight);

    const stateRow = stateRes.data ?? { rotation_index: 0, action_date: null };
    const historyRows = historyRes.data || [];
    const loaded = {
      rotationIndex: stateRow.rotation_index ?? 0,
      actionDate: stateRow.action_date ?? null,
      _maxSeq: historyRows.reduce((max, row) => Math.max(max, row.sequence ?? -1), -1),
      history: historyRows.map(row => ({
        type: row.type,
        date: row.date,
        advanced: row.advanced,
        note: row.note ?? undefined,
        _sid: row.id,
      })),
    };
    for (const { type, date } of historyRows) {
      if (type !== 'off' && (!loaded[type] || date > loaded[type])) {
        loaded[type] = date;
      }
    }
    state.cachedData = loaded;
    deps.renderSettingsTodayTab();
    await render(loaded);
  }

  async function saveWeightEntry(date, valueLbs) {
    if (TEST_MODE) {
      const rows = state.cachedWeight ? [...state.cachedWeight] : [];
      const idx = rows.findIndex(row => row.date === date);
      const entry = { date, value_lbs: valueLbs };
      if (idx !== -1) rows[idx] = entry;
      else rows.unshift(entry);
      state.cachedWeight = rows;
      data.writeCachedJSON(BASE_WEIGHT_KEY, rows);
      return;
    }
    if (!state.sb) throw new Error('Supabase client not available');

    const { error } = await state.sb.from('weight').upsert({ date, value_lbs: valueLbs, user_id: state.currentUser?.id }, { onConflict: 'date,user_id' });
    if (error) throw error;

    const rows = state.cachedWeight ? [...state.cachedWeight] : [];
    const idx = rows.findIndex(row => row.date === date);
    const entry = { date, value_lbs: valueLbs };
    if (idx !== -1) rows[idx] = entry;
    else rows.unshift(entry);
    state.cachedWeight = rows;
    data.writeCachedJSON(BASE_WEIGHT_KEY, rows);
  }

  function openWeightModal(dateStr = utils.todayStr(), options = {}) {
    if (!utils.isValidISODate(dateStr)) dateStr = utils.todayStr();
    const { fromBackfill = false } = options;
    state.activeWeightDate = dateStr;
    state.weightModalFromBackfill = fromBackfill;
    if (fromBackfill) deps.hideBackfillModal();

    const existing = (getWeightSync() || []).find(row => row.date === dateStr);
    const input = document.getElementById('weight-input');
    input.value = existing ? existing.value_lbs : '';
    document.getElementById('weight-save-btn').disabled = !existing;
    document.getElementById('weight-modal').hidden = false;
    input.focus();
  }

  function closeWeightModal() {
    document.getElementById('weight-modal').hidden = true;
    if (state.weightModalFromBackfill && deps.getBackfillDate()) deps.showBackfillModal();
    state.activeWeightDate = null;
    state.weightModalFromBackfill = false;
  }

  async function saveWeight() {
    const val = parseFloat(document.getElementById('weight-input').value);
    if (!val || val < 50 || val > 999) return;
    document.getElementById('weight-save-btn').disabled = true;
    try {
      const saveDate = state.activeWeightDate || utils.todayStr();
      await saveWeightEntry(saveDate, val);
      if (state.weightModalFromBackfill && deps.getBackfillDate() === saveDate) {
        deps.setBackfillWeightEntry((getWeightSync() || []).find(row => row.date === saveDate) || null);
        deps.showBackfillReadonly(deps.getBackfillExisting());
      }
      closeWeightModal();
      renderWeightCard();
      if (state.historyViewActive && state.historySubTab === 'calendar' && state.cachedData) {
        deps.renderCalendar(state.cachedData);
      }
      if (state.statsViewActive && state.cachedData) {
        deps.renderStatsView(state.cachedData);
      }
      utils.showToast('Weight saved');
    } catch {
      utils.showToast('Could not save — check your connection');
    } finally {
      document.getElementById('weight-save-btn').disabled = false;
    }
  }

  function renderWeightCard() {
    if (!state.userPreferences.show_weight_card) return;
    const today = utils.todayStr();
    const entry = (getWeightSync() || []).find(row => row.date === today);
    const content = document.getElementById('weight-card-content');
    if (entry) {
      content.innerHTML =
        `<div class="weight-logged-value">${entry.value_lbs} lbs</div>` +
        `<div class="card-done-badge card-done-badge--weight">Done ✓</div>` +
        `<button class="card-edit-btn" id="weight-edit-card-btn">Edit</button>`;
      document.getElementById('weight-edit-card-btn').onclick = () => openWeightModal();
    } else {
      content.innerHTML = '<button class="card-action-btn" id="weight-open-btn">Log Weight</button>';
      document.getElementById('weight-open-btn').onclick = () => openWeightModal();
    }
  }

  async function render(preloadedData = null) {
    const loaded = preloadedData || await data.loadData();
    state.cachedData = loaded;
    const preferences = state.userPreferences || DEFAULT_USER_PREFERENCES;

    const today = utils.todayStr();
    const nextInRotation = utils.getSuggested(loaded);
    const actionTakenToday = loaded.actionDate === today;
    const todayEntry = [...(loaded.history || [])].reverse().find(entry => entry.date === today);
    const skippedToday = todayEntry?.type === 'off';
    const otherToday = todayEntry?.type === 'other';
    const heroWorkout = (actionTakenToday && !skippedToday && !otherToday && todayEntry)
      ? (utils.getWorkoutById(todayEntry.type) || nextInRotation)
      : nextInRotation;

    document.getElementById('date-label').textContent = new Date().toLocaleDateString(
      undefined, { weekday: 'long', month: 'long', day: 'numeric' }
    );

    const history = loaded.history || [];
    const heroState = skippedToday ? 'skipped' : otherToday ? 'other' : (todayEntry ? 'done' : 'default');
    const sugDays = loaded[heroWorkout.id] ? utils.daysSince(loaded[heroWorkout.id]) : null;

    document.getElementById('suggestion-eyebrow').textContent =
      heroState === 'done'    ? 'Completed'      :
      heroState === 'skipped' ? 'Day Off'        :
      heroState === 'other'   ? 'Other Activity' : 'Next Up Workout';

    const heroIconWrap = document.getElementById('hero-icon-wrap');
    const heroIconName =
      heroState === 'skipped' ? 'moon' :
      heroState === 'other'   ? 'zap'  : heroWorkout.icon;
    heroIconWrap.className = 'hero-icon-wrap' +
      (heroState === 'skipped' ? ' is-rest' : heroState === 'other' ? ' is-other' : '');
    heroIconWrap.innerHTML = `<i data-lucide="${heroIconName}"></i>`;

    document.getElementById('suggestion-name').textContent =
      heroState === 'skipped' ? 'Rest Day' :
      heroState === 'other'   ? (todayEntry?.note || 'Other Activity') :
      heroState === 'done'    ? (utils.getWorkoutById(todayEntry.type)?.name || heroWorkout.name) :
      heroWorkout.name;

    const suggestionLastDoneEl = document.getElementById('suggestion-last-done');
    if (heroState === 'default') utils.renderLastDonePill(suggestionLastDoneEl, sugDays, { prefixLastDone: true });
    else suggestionLastDoneEl.hidden = true;

    document.getElementById('suggestion-subtitle').textContent =
      heroState === 'done'    ? 'Completed today' :
      heroState === 'skipped' ? 'Day off logged'  :
      heroState === 'other'   ? 'Other activity logged' :
                                 '';
    document.getElementById('suggestion-card').hidden = !preferences.show_workout_card;

    const mainBtn = document.getElementById('main-done-btn');
    const logOtherBtn = document.getElementById('log-other-btn');
    const undoBtn = document.getElementById('undo-btn');

    mainBtn.disabled = false;
    logOtherBtn.disabled = false;
    undoBtn.disabled = false;
    mainBtn.hidden = heroState !== 'default';
    logOtherBtn.hidden = heroState !== 'default';

    if (heroState === 'default') {
      mainBtn.onclick = markDone;
      logOtherBtn.onclick = openLogActivityModal;
      undoBtn.hidden = true;
    } else {
      const undoLabel =
        heroState === 'skipped' ? 'Rest Day' :
        heroState === 'other'   ? (todayEntry?.note || 'Other Activity') :
        heroState === 'done'    ? (utils.getWorkoutById(todayEntry.type)?.name || heroWorkout.name) :
        heroWorkout.name;
      undoBtn.innerHTML = '';
      const undoIcon = document.createElement('i');
      undoIcon.setAttribute('data-lucide', 'undo-2');
      undoBtn.appendChild(undoIcon);
      undoBtn.appendChild(document.createTextNode(`Undo ${undoLabel}`));
      undoBtn.onclick = undoLastEntry;
      undoBtn.hidden = false;
    }

    const tomorrowPreviewEl = document.getElementById('tomorrow-preview');
    tomorrowPreviewEl.hidden = !preferences.show_workout_card || heroState === 'default';
    const rotIdx = loaded.rotationIndex || 0;
    const activeRotation = utils.getActiveRotation();
    const tomorrowWorkout = actionTakenToday
      ? activeRotation[rotIdx % activeRotation.length]
      : activeRotation[(rotIdx + 1) % activeRotation.length];
    const tomorrowNameEl = document.getElementById('tomorrow-name');
    tomorrowNameEl.innerHTML = '';
    const tomorrowIconEl = document.createElement('i');
    tomorrowIconEl.setAttribute('data-lucide', tomorrowWorkout.icon);
    tomorrowIconEl.className = 'tomorrow-icon';
    tomorrowNameEl.appendChild(tomorrowIconEl);
    tomorrowNameEl.appendChild(document.createTextNode(tomorrowWorkout.name));
    utils.renderLastDonePill(
      document.getElementById('tomorrow-last-done'),
      loaded[tomorrowWorkout.id] ? utils.daysSince(loaded[tomorrowWorkout.id]) : null,
      { prefixLastDone: true }
    );

    const firstUsePrompt = document.getElementById('first-use-prompt');
    if (firstUsePrompt) {
      firstUsePrompt.hidden = !preferences.show_workout_card || !(history.length === 0 && heroState === 'default');
    }

    document.getElementById('journal-card').hidden = !preferences.show_journal_card;
    document.getElementById('weight-card').hidden = !preferences.show_weight_card;
    if (preferences.show_journal_card) renderJournalCard();
    if (preferences.show_weight_card) renderWeightCard();

    if (state.historyViewActive) deps.renderHistoryView(loaded);
    if (state.statsViewActive) deps.renderStatsView(loaded);

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function bindEvents() {
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

    document.getElementById('log-activity-cancel-btn').onclick = () => closeLogActivityModal();
    document.getElementById('log-activity-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('log-activity-modal')) closeLogActivityModal();
    });

    document.getElementById('weight-save-btn').onclick = () => saveWeight();
    document.getElementById('weight-cancel-btn').onclick = () => closeWeightModal();
    document.getElementById('weight-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('weight-modal')) closeWeightModal();
    });
    document.getElementById('weight-input').addEventListener('input', () => {
      const val = parseFloat(document.getElementById('weight-input').value);
      document.getElementById('weight-save-btn').disabled = !(val >= 50 && val <= 999);
    });

    document.getElementById('journal-save-btn').onclick = () => saveJournal();
    document.getElementById('journal-cancel-btn').onclick = () => closeJournalModal();
    document.getElementById('journal-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('journal-modal')) closeJournalModal();
    });
    document.getElementById('journal-nudge-yes').onclick = () => {
      state.journalNudgeConfirmed = true;
      document.getElementById('journal-nudge').hidden = true;
      saveJournal();
    };
    document.getElementById('journal-nudge-change').onclick = () => {
      document.getElementById('journal-nudge').hidden = true;
      document.getElementById('journal-gratitude').focus();
    };
  }

  return {
    bindEvents,
    markDone,
    logSkip,
    undoLastEntry,
    markRowDone,
    openLogActivityModal,
    closeLogActivityModal,
    loadOtherActivities,
    saveOtherActivities,
    loadSkipReasons,
    saveSkipReason,
    openOtherActivityModal,
    closeOtherActivityModal,
    logOtherActivity,
    getJournalSync,
    loadJournal,
    saveJournalEntry,
    checkGratitudeSimilarity,
    openJournalModal,
    closeJournalModal,
    renderJournalCard,
    saveJournal,
    getWeightSync,
    loadWeight,
    syncAllData,
    saveWeightEntry,
    openWeightModal,
    closeWeightModal,
    saveWeight,
    renderWeightCard,
    render,
  };
};
