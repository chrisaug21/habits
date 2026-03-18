window.HabitsApp = window.HabitsApp || {};

window.HabitsApp.registerLogModule = function registerLogModule(ctx) {
  const { WORKOUTS, ROTATION, TEST_MODE, SKIP_DEFAULTS, MAX_ACTIVITY_LENGTH } = ctx.constants;
  const state = ctx.state;
  const utils = ctx.utils;
  const data = ctx.data;
  const deps = ctx.deps;

  const BACKFILL_OPTIONS = [
    ...WORKOUTS.map(w => ({ id: w.id, name: w.name, icon: w.icon, color: 'purple' })),
    { id: 'off', name: 'Rest Day', icon: 'moon', color: 'amber' },
    { id: 'other', name: 'Other Activity', icon: 'zap', color: 'teal' },
  ];

  const BF_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const BF_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  let backfillDate = null;
  let backfillExisting = null;
  let backfillJournalEntry = null;
  let backfillWeightEntry = null;
  let backfillSelectedType = null;
  let backfillSaving = false;

  function showBackfillModal() {
    document.getElementById('backfill-modal').hidden = false;
  }

  function hideBackfillModal() {
    document.getElementById('backfill-modal').hidden = true;
  }

  function getBackfillDate() {
    return backfillDate;
  }

  function getBackfillExisting() {
    return backfillExisting;
  }

  function setBackfillWeightEntry(value) {
    backfillWeightEntry = value;
  }

  function openBackfillModal(dateStr) {
    backfillDate = dateStr;

    const history = state.cachedData ? (state.cachedData.history || []) : [];
    backfillExisting = [...history].reverse().find(entry => entry.date === dateStr) || null;

    backfillJournalEntry = (deps.getJournalSync() || []).find(entry => entry.date === dateStr) || null;
    backfillWeightEntry = (deps.getWeightSync() || []).find(entry => entry.date === dateStr) || null;

    const d = new Date(dateStr + 'T00:00:00');
    document.getElementById('backfill-date-label').textContent =
      `${BF_WEEKDAYS[d.getDay()]}, ${BF_MONTHS[d.getMonth()]} ${d.getDate()}`;

    showBackfillReadonly(backfillExisting);
    showBackfillModal();
  }

  function closeBackfillModal() {
    if (backfillSaving) return;
    hideBackfillModal();
    backfillDate = null;
    backfillExisting = null;
    backfillJournalEntry = null;
    backfillWeightEntry = null;
    backfillSelectedType = null;
  }

  function showBackfillReadonly(entry) {
    document.getElementById('backfill-readonly').hidden = false;
    document.getElementById('backfill-edit-view').hidden = true;

    const hasExercise = !!entry;
    const isOff = entry?.type === 'off';
    const isOther = entry?.type === 'other';
    const workout = (hasExercise && !isOff && !isOther) ? WORKOUTS.find(w => w.id === entry.type) : null;

    const iconName = !hasExercise ? 'dumbbell' :
      (isOff ? 'moon' : isOther ? 'zap' : (workout ? workout.icon : 'dumbbell'));
    const displayName = !hasExercise ? 'No exercise logged' :
      (isOff ? (entry.note || 'Rest Day') :
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

    const journalSection = document.getElementById('backfill-journal-section');
    const journalContent = document.getElementById('backfill-journal-content');
    if (backfillJournalEntry) {
      const fields = [
        { label: 'Intention', value: backfillJournalEntry.intention },
        { label: 'Gratitude', value: backfillJournalEntry.gratitude },
        { label: 'One Thing', value: backfillJournalEntry.one_thing },
      ].filter(field => field.value);
      if (fields.length) {
        journalContent.innerHTML = fields.map(field => `
            <div class="backfill-journal-field">
              <div class="backfill-journal-label">${field.label}</div>
              <div class="backfill-journal-value">${utils.escapeHtml(field.value)}</div>
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
    document.getElementById('backfill-readonly').hidden = true;
    document.getElementById('backfill-edit-view').hidden = false;

    backfillSelectedType = preselectedType;
    _renderBackfillOptions(preselectedType);

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
        (opt.color === 'amber' ? ' is-rest' : '') +
        (opt.color === 'teal' ? ' is-other' : '') +
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

    document.querySelectorAll('.backfill-option').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.type === type);
    });

    _updateBackfillOtherSection(type === 'other' || type === 'off', type);
    _updateBackfillConfirmBtn();
  }

  function _updateBackfillOtherSection(show, type) {
    const section = document.getElementById('backfill-other-section');
    const input = document.getElementById('backfill-other-input');
    section.hidden = !show;
    if (show) {
      const chipsEl = document.getElementById('backfill-other-chips');
      chipsEl.innerHTML = '';
      if (type === 'off') {
        input.placeholder = 'Reason (optional)';
        const saved = deps.loadSkipReasons();
        const suggestions = saved.length ? saved : SKIP_DEFAULTS;
        for (const reason of suggestions) {
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
      } else {
        input.placeholder = 'Activity name (optional)';
        for (const activity of deps.loadOtherActivities()) {
          const chip = document.createElement('button');
          chip.className = 'activity-chip';
          chip.textContent = activity;
          chip.type = 'button';
          chip.onclick = () => {
            input.value = activity;
            setTimeout(() => input.focus(), 50);
          };
          chipsEl.appendChild(chip);
        }
      }
      setTimeout(() => input.focus(), 80);
    }
  }

  function _updateBackfillConfirmBtn() {
    document.getElementById('backfill-confirm-btn').disabled = !backfillSelectedType;
  }

  async function confirmBackfill() {
    if (!backfillDate || !backfillSelectedType || state.isProcessing) return;
    const otherInput = document.getElementById('backfill-other-input').value.trim();

    const capturedDate = backfillDate;
    const capturedType = backfillSelectedType;
    const capturedExisting = backfillExisting;
    const capturedNote = (capturedType === 'other' || capturedType === 'off') && otherInput
      ? String(otherInput).slice(0, MAX_ACTIVITY_LENGTH)
      : null;

    state.isProcessing = true;
    backfillSaving = true;
    const wasEdit = !!capturedExisting;

    try {
      const loaded = await data.loadData();
      const history = loaded.history || [];
      const liveExisting = capturedExisting
        ? ([...history].reverse().find(entry => entry.date === capturedDate) || capturedExisting)
        : null;

      const newType = capturedType;
      const note = capturedNote;
      const dateStr = capturedDate;
      const rotationIds = WORKOUTS.map(workout => workout.id);
      const isRotationWorkout = !!WORKOUTS.find(w => w.id === newType);
      const hasLaterEntries = history.some(entry => entry.date > dateStr && rotationIds.includes(entry.type));
      const shouldAdvance = isRotationWorkout && !hasLaterEntries;

      function recomputeLastDone() {
        for (const workout of WORKOUTS) {
          const maxDate = history
            .filter(entry => entry.type === workout.id)
            .reduce((max, entry) => (!max || entry.date > max) ? entry.date : max, null);
          if (maxDate) loaded[workout.id] = maxDate;
          else delete loaded[workout.id];
        }
      }

      if (capturedExisting) {
        const wasAdvanced = liveExisting.advanced !== false;
        let idx = -1;
        if (liveExisting._sid != null) {
          idx = history.findIndex(entry => entry._sid === liveExisting._sid);
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

        if (state.sb && !TEST_MODE && liveExisting._sid != null) {
          console.log(`[backfill] Updating history row id=${liveExisting._sid}`, { newType, note, shouldAdvance });
          const { error } = await state.sb.from('history').update({
            type: newType,
            note: note || null,
            advanced: shouldAdvance,
          }).eq('id', liveExisting._sid);
          if (error) {
            console.error(`[backfill] Supabase UPDATE failed for id=${liveExisting._sid}:`, error);
            throw error;
          }
          console.log(`[backfill] Supabase UPDATE succeeded for id=${liveExisting._sid}`);
        }

        if (idx !== -1) {
          history[idx].type = newType;
          history[idx].advanced = shouldAdvance;
          if (note) history[idx].note = note;
          else delete history[idx].note;

          if (shouldAdvance && !wasAdvanced) {
            loaded.rotationIndex = (loaded.rotationIndex || 0) + 1;
          } else if (!shouldAdvance && wasAdvanced) {
            loaded.rotationIndex = ((loaded.rotationIndex || 0) - 1 + ROTATION.length) % ROTATION.length;
          }
        }

        recomputeLastDone();
        loaded.history = history;
        await data.saveData(loaded);
      } else {
        const newEntry = { type: newType, date: dateStr, advanced: shouldAdvance };
        if (note) newEntry.note = note;

        if (shouldAdvance) {
          loaded.rotationIndex = (loaded.rotationIndex || 0) + 1;
        }

        history.push(newEntry);
        console.log('[backfill] New entry pushed', {
          type: newType, date: dateStr, advanced: shouldAdvance,
          historyLengthBeforePush: history.length - 1,
          newEntryIndex: history.indexOf(newEntry),
        });
        recomputeLastDone();
        loaded.history = history;
        await data.saveData(loaded);
      }

      if (newType === 'other' && note) deps.saveOtherActivities(note);
      if (newType === 'off' && note) deps.saveSkipReason(note);

      state.cachedData = loaded;
      backfillSaving = false;
      closeBackfillModal();

      renderCalendar(loaded);
      if (state.historyViewActive && state.historySubTab === 'list') renderHistoryList(loaded);

      const displayName = newType === 'off' ? 'Rest day' :
        newType === 'other' ? (note || 'Other activity') :
          (WORKOUTS.find(w => w.id === newType)?.name ?? newType);
      utils.showToast(wasEdit ? `${displayName} updated` : `${displayName} logged`);
    } catch {
      utils.showToast('Could not save — check your connection');
    } finally {
      state.isProcessing = false;
      backfillSaving = false;
    }
  }

  function buildHistoryMap(currentData) {
    const map = {};
    for (const entry of (currentData.history || [])) {
      map[entry.date] = entry;
    }
    return map;
  }

  function buildProjectionMap(currentData) {
    const histMap = buildHistoryMap(currentData);
    const map = {};
    let rotIdx = currentData.rotationIndex || 0;
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    for (let i = 0; i <= 365; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const ds = utils.dateToStr(d);
      if (!histMap[ds]) {
        map[ds] = ROTATION[rotIdx % ROTATION.length];
        rotIdx = (rotIdx + 1) % ROTATION.length;
      }
    }
    return map;
  }

  function renderCalendar(currentData) {
    const container = document.getElementById('hview-calendar');
    const histMap = buildHistoryMap(currentData);
    const projMap = buildProjectionMap(currentData);
    const today = utils.todayStr();

    const journalDateSet = new Set((deps.getJournalSync() || []).map(entry => entry.date));
    const weightDateSet = new Set((deps.getWeightSync() || []).map(entry => entry.date));

    const viewDate = state.calViewDate;
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    const MONTH_NAMES = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];

    const firstDayDow = new Date(year, month, 1).getDay();
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

    for (const dayName of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
      html += `<div class="cal-dow">${dayName}</div>`;
    }

    for (let i = 0; i < firstDayDow; i++) {
      html += '<div class="cal-day"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = ds === today;
      const isPast = ds < today;
      const histEntry = histMap[ds];
      const projId = projMap[ds];

      const classes = ['cal-day'];
      if (isToday) classes.push('is-today');
      if (isPast) classes.push('is-past');

      let iconHtml = '';

      if (histEntry) {
        if (histEntry.type === 'off') {
          classes.push('has-rest');
          iconHtml = '<i class="cal-icon" data-lucide="moon"></i>';
        } else if (histEntry.type === 'other') {
          classes.push('has-other');
          iconHtml = '<i class="cal-icon" data-lucide="zap"></i>';
        } else {
          classes.push('has-workout');
          const workout = WORKOUTS.find(w => w.id === histEntry.type);
          if (workout) iconHtml = `<i class="cal-icon" data-lucide="${workout.icon}"></i>`;
        }
      } else if (projId) {
        classes.push('is-projected');
        const workout = WORKOUTS.find(w => w.id === projId);
        if (workout) iconHtml = `<i class="cal-icon" data-lucide="${workout.icon}"></i>`;
      }

      const dateAttr = isPast ? ` data-date="${ds}" role="button" tabindex="0"` : '';
      const journalDot = journalDateSet.has(ds) ? '<span class="cal-journal-dot"></span>' : '';
      const weightDot = weightDateSet.has(ds) ? '<span class="cal-weight-dot"></span>' : '';
      html += `<div class="${classes.join(' ')}"${dateAttr}>${iconHtml}<span class="cal-day-num">${day}</span>${journalDot}${weightDot}</div>`;
    }

    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.cal-day.is-past[data-date]').forEach(cell => {
      cell.addEventListener('click', () => openBackfillModal(cell.dataset.date));
      cell.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openBackfillModal(cell.dataset.date);
        }
      });
    });

    document.getElementById('cal-prev-btn').onclick = () => {
      state.calViewDate = new Date(state.calViewDate.getFullYear(), state.calViewDate.getMonth() - 1, 1);
      renderCalendar(currentData);
    };
    document.getElementById('cal-next-btn').onclick = () => {
      state.calViewDate = new Date(state.calViewDate.getFullYear(), state.calViewDate.getMonth() + 1, 1);
      renderCalendar(currentData);
    };

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function renderHistoryList(currentData) {
    const container = document.getElementById('hview-list');
    const today = utils.todayStr();

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const entries = [...(currentData.history || [])].sort((a, b) => b.date.localeCompare(a.date));

    function rowHtml(dateStr, type, isProjected, isToday, note = null) {
      const d = new Date(dateStr + 'T00:00:00');
      const thisYear = new Date().getFullYear();
      const yearSuffix = d.getFullYear() !== thisYear ? `, ${d.getFullYear()}` : '';
      const dateMain = `${MONTHS[d.getMonth()]} ${d.getDate()}${yearSuffix}`;
      const dayName = WEEKDAYS[d.getDay()];

      const isOff = type === 'off';
      const isOther = type === 'other';
      const workout = (isOff || isOther) ? null : WORKOUTS.find(w => w.id === type);
      const iconName = isOff ? 'moon' : isOther ? 'zap' : (workout ? workout.icon : 'dumbbell');
      const color = isOff ? 'amber' : isOther ? 'teal' : 'purple';
      const displayName = isOff ? 'Rest Day' :
        isOther ? (note || 'Other Activity') :
          (workout ? workout.name : type);

      const rowCls = [
        'hlist-row',
        isProjected ? 'is-projected' : '',
        isToday ? 'is-today' : '',
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
                   <div class="hlist-name ${color}">${utils.escapeHtml(displayName)}</div>
                   <div class="hlist-note">${utils.escapeHtml(note)}</div>
                 </div>`
              : `<div class="hlist-name ${color}">${utils.escapeHtml(displayName)}</div>`
            }
          </div>`;
    }

    let html = '';

    if (entries.length) {
      html += '<div class="hlist">';
      for (const entry of entries) {
        html += rowHtml(entry.date, entry.type, false, entry.date === today, entry.note);
      }
      html += '</div>';
    } else {
      html += '<div class="hlist-empty">No data yet.</div>';
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function renderSchedule(currentData) {
    const container = document.getElementById('hview-schedule');

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const projMap = buildProjectionMap(currentData);
    const futureRows = [];
    for (let i = 1; i <= 14; i++) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + i);
      const ds = utils.dateToStr(d);
      if (projMap[ds]) futureRows.push({ date: ds, type: projMap[ds] });
    }

    function rowHtml(dateStr, type) {
      const d = new Date(dateStr + 'T00:00:00');
      const thisYear = new Date().getFullYear();
      const yearSuffix = d.getFullYear() !== thisYear ? `, ${d.getFullYear()}` : '';
      const dateMain = `${MONTHS[d.getMonth()]} ${d.getDate()}${yearSuffix}`;
      const dayName = WEEKDAYS[d.getDay()];

      const workout = WORKOUTS.find(w => w.id === type);
      const iconName = workout ? workout.icon : 'dumbbell';
      const displayName = workout ? workout.name : type;

      return `
          <div class="hlist-row is-projected">
            <i class="hlist-icon purple" data-lucide="${iconName}"></i>
            <div class="hlist-date">
              <div class="hlist-date-main">${dateMain}</div>
              <div class="hlist-date-sub">${dayName}</div>
            </div>
            <div class="hlist-name purple">${utils.escapeHtml(displayName)}</div>
          </div>`;
    }

    let html = '';
    if (futureRows.length) {
      html += '<div class="hlist-section-label">Coming Up</div>';
      html += '<div class="hlist">';
      for (const row of futureRows) {
        html += rowHtml(row.date, row.type);
      }
      html += '</div>';
    } else {
      html += '<div class="hlist-empty">No upcoming workouts.</div>';
    }

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function renderHistoryView(currentData) {
    if (state.historySubTab === 'calendar') renderCalendar(currentData);
    else if (state.historySubTab === 'schedule') renderSchedule(currentData);
    else renderHistoryList(currentData);
  }

  function switchHistorySubTab(tab) {
    state.historySubTab = tab;
    document.getElementById('htab-calendar').classList.toggle('active', tab === 'calendar');
    document.getElementById('htab-list').classList.toggle('active', tab === 'list');
    document.getElementById('htab-schedule').classList.toggle('active', tab === 'schedule');
    document.getElementById('hview-calendar').hidden = tab !== 'calendar';
    document.getElementById('hview-list').hidden = tab !== 'list';
    document.getElementById('hview-schedule').hidden = tab !== 'schedule';
    if (state.cachedData) renderHistoryView(state.cachedData);
  }

  function bindEvents() {
    document.getElementById('backfill-modal').addEventListener('click', function (e) {
      if (e.target === this) closeBackfillModal();
    });
    document.getElementById('backfill-x-btn').onclick = closeBackfillModal;
    document.getElementById('backfill-edit-btn').onclick = () => {
      _showBackfillEdit(backfillExisting ? backfillExisting.type : null);
    };
    document.getElementById('backfill-weight-btn').onclick = () => {
      if (!backfillDate) return;
      deps.openWeightModal(backfillDate, { fromBackfill: true });
    };
    document.getElementById('backfill-cancel-btn').onclick = () => {
      if (backfillExisting) {
        showBackfillReadonly(backfillExisting);
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

    document.getElementById('htab-calendar').onclick = () => switchHistorySubTab('calendar');
    document.getElementById('htab-list').onclick = () => switchHistorySubTab('list');
    document.getElementById('htab-schedule').onclick = () => switchHistorySubTab('schedule');
  }

  return {
    bindEvents,
    showBackfillModal,
    hideBackfillModal,
    getBackfillDate,
    getBackfillExisting,
    setBackfillWeightEntry,
    openBackfillModal,
    closeBackfillModal,
    showBackfillReadonly,
    renderCalendar,
    renderHistoryList,
    renderSchedule,
    renderHistoryView,
    switchHistorySubTab,
  };
};
