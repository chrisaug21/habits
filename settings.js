window.HabitsApp = window.HabitsApp || {};

window.HabitsApp.registerSettingsModule = function registerSettingsModule(ctx) {
  const { DEFAULT_USER_PREFERENCES, BASE_STORAGE_KEY, BASE_OTHER_ACTIVITIES_KEY, BASE_SKIP_REASONS_KEY, BASE_JOURNAL_KEY, BASE_WEIGHT_KEY } = ctx.constants;
  const state = ctx.state;
  const utils = ctx.utils;
  const data = ctx.data;
  const deps = ctx.deps;
  const pendingPreferenceSaves = {};
  let stagedRotationSlots = null;
  let rotationBuilderSaving = false;
  let customWorkoutSaving = false;
  let rotationSortable = null;

  function renderSettingsTodayTab() {
    document.getElementById('toggle-workout-card').checked = !!state.userPreferences.show_workout_card;
    document.getElementById('toggle-journal-card').checked = !!state.userPreferences.show_journal_card;
    document.getElementById('toggle-weight-card').checked = !!state.userPreferences.show_weight_card;
  }

  function getBuilderSeedRotation() {
    return utils.getActiveRotation().map((workout, index) => ({
      slotId: workout.rotation_slot_id || `default-slot-${index}`,
      workoutId: workout.id,
    }));
  }

  function makeStagedSlot(workoutId) {
    return {
      slotId: (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `staged-slot-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      workoutId,
    };
  }

  function destroyRotationSortable() {
    if (rotationSortable && typeof rotationSortable.destroy === 'function') {
      rotationSortable.destroy();
    }
    rotationSortable = null;
  }

  function syncStagedSlotsFromDom() {
    const currentListEl = document.getElementById('rotation-builder-current-list');
    const orderedSlotIds = [...currentListEl.querySelectorAll('[data-slot-id]')]
      .map(row => row.dataset.slotId);
    if (!Array.isArray(stagedRotationSlots) || !orderedSlotIds.length) return;

    const slotMap = new Map(stagedRotationSlots.map(slot => [slot.slotId, slot]));
    stagedRotationSlots = orderedSlotIds
      .map(slotId => slotMap.get(slotId))
      .filter(Boolean);
  }

  function initRotationSortable() {
    destroyRotationSortable();
    const currentListEl = document.getElementById('rotation-builder-current-list');
    if (!currentListEl || typeof window.Sortable === 'undefined') return;

    rotationSortable = window.Sortable.create(currentListEl, {
      animation: 150,
      handle: '.rotation-builder-drag-handle',
      ghostClass: 'rotation-builder-row--dragging',
      chosenClass: 'rotation-builder-row--picked',
      onEnd() {
        syncStagedSlotsFromDom();
        renderRotationBuilder();
      },
    });
  }

  function hideCustomWorkoutForm() {
    document.getElementById('rotation-custom-form').hidden = true;
    document.getElementById('rotation-custom-name').value = '';
    document.getElementById('rotation-custom-category').value = 'Cardio';
    customWorkoutSaving = false;
  }

  function showCustomWorkoutForm() {
    document.getElementById('rotation-custom-form').hidden = false;
    document.getElementById('rotation-custom-name').focus();
  }

  function renderSettingsRotation() {
    const emptyEl = document.getElementById('settings-rotation-empty');
    const listEl = document.getElementById('settings-rotation-list');
    const buttonEl = document.getElementById('rotation-builder-open-btn');

    if (!utils.hasCustomRotation()) {
      emptyEl.hidden = false;
      listEl.hidden = true;
      listEl.innerHTML = '';
      buttonEl.textContent = 'Customize my rotation';
      return;
    }

    const rotation = state.userRotation || [];
    emptyEl.hidden = true;
    listEl.hidden = false;
    listEl.innerHTML = rotation.map((workout, index) => `
      <div class="settings-rotation-row">
        <div class="settings-rotation-row-index">${index + 1}</div>
        <div class="settings-rotation-row-icon"><i data-lucide="${workout.icon}"></i></div>
        <div class="settings-rotation-row-copy">
          <div class="settings-rotation-row-name">${utils.escapeHtml(workout.name)}</div>
          <div class="settings-rotation-row-position">${utils.escapeHtml(workout.category || '')}</div>
        </div>
      </div>
    `).join('');
    buttonEl.textContent = 'Edit rotation';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function renderRotationBuilder() {
    if (!Array.isArray(stagedRotationSlots)) return;

    const stagedRotation = stagedRotationSlots
      .map(slot => {
        const workout = utils.getWorkoutById(slot.workoutId);
        if (!workout) return null;
        return { ...slot, workout };
      })
      .filter(Boolean);
    const currentListEl = document.getElementById('rotation-builder-current-list');
    currentListEl.innerHTML = stagedRotation.map((workout, index) => `
      <div class="rotation-builder-row" data-slot-id="${workout.slotId}">
        <div class="rotation-builder-row-position">${index + 1}</div>
        <button class="rotation-builder-drag-handle" type="button" aria-label="Drag to reorder">
          <i data-lucide="grip"></i>
        </button>
        <div class="rotation-builder-row-icon"><i data-lucide="${workout.workout.icon}"></i></div>
        <div class="rotation-builder-row-copy">
          <div class="rotation-builder-row-name">${utils.escapeHtml(workout.workout.name)}</div>
          <div class="rotation-builder-row-meta">${utils.escapeHtml(workout.workout.category || '')}</div>
        </div>
        <div class="rotation-builder-reorder">
          <button class="rotation-builder-icon-btn" type="button" data-move-up="${workout.slotId}" ${index === 0 ? 'disabled' : ''} aria-label="Move up">
            <i data-lucide="chevron-up"></i>
          </button>
          <button class="rotation-builder-icon-btn" type="button" data-move-down="${workout.slotId}" ${index === stagedRotation.length - 1 ? 'disabled' : ''} aria-label="Move down">
            <i data-lucide="chevron-down"></i>
          </button>
        </div>
        <button class="rotation-builder-remove-btn" type="button" data-remove-slot="${workout.slotId}" ${stagedRotation.length <= 2 ? 'disabled' : ''}>Remove</button>
      </div>
    `).join('');

    const library = [...(state.workoutLibrary || [])]
      .sort((a, b) => {
        if (a.is_global !== b.is_global) return a.is_global ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    const globalWorkouts = library.filter(workout => workout.is_global);
    const customWorkouts = library.filter(workout => !workout.is_global);

    const renderLibraryRows = workouts => workouts.map(workout => `
      <div class="rotation-builder-library-row">
        <div class="rotation-builder-row-icon"><i data-lucide="${workout.icon}"></i></div>
        <div class="rotation-builder-library-copy">
          <div class="rotation-builder-library-name">${utils.escapeHtml(workout.name)}</div>
          <div class="rotation-builder-library-meta">${utils.escapeHtml(workout.category || '')}</div>
        </div>
        <button class="rotation-builder-add-btn" type="button" data-add-workout="${workout.id}">Add</button>
      </div>
    `).join('');

    document.getElementById('rotation-library-global-group').hidden = globalWorkouts.length === 0;
    document.getElementById('rotation-library-custom-group').hidden = customWorkouts.length === 0;
    document.getElementById('rotation-library-global-list').innerHTML = renderLibraryRows(globalWorkouts);
    document.getElementById('rotation-library-custom-list').innerHTML = renderLibraryRows(customWorkouts);
    document.getElementById('rotation-library-empty').hidden = library.length !== 0;
    document.getElementById('rotation-builder-save-btn').disabled = stagedRotationSlots.length < 2 || rotationBuilderSaving;

    if (typeof lucide !== 'undefined') lucide.createIcons();
    initRotationSortable();
  }

  function openRotationBuilder() {
    stagedRotationSlots = getBuilderSeedRotation();
    rotationBuilderSaving = false;
    hideCustomWorkoutForm();
    renderRotationBuilder();
    document.getElementById('rotation-builder-modal').hidden = false;
    document.getElementById('app-container').inert = true;
    document.getElementById('bottom-nav').inert = true;
    setTimeout(() => document.getElementById('rotation-builder-close-btn').focus(), 80);
  }

  function closeRotationBuilder() {
    if (rotationBuilderSaving || customWorkoutSaving) return;
    stagedRotationSlots = null;
    destroyRotationSortable();
    hideCustomWorkoutForm();
    document.getElementById('rotation-builder-modal').hidden = true;
    document.getElementById('app-container').inert = false;
    document.getElementById('bottom-nav').inert = false;
  }

  function moveStagedWorkout(slotId, direction) {
    if (!Array.isArray(stagedRotationSlots)) return;
    const index = stagedRotationSlots.findIndex(slot => slot.slotId === slotId);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= stagedRotationSlots.length) return;
    const nextSlots = [...stagedRotationSlots];
    [nextSlots[index], nextSlots[targetIndex]] = [nextSlots[targetIndex], nextSlots[index]];
    stagedRotationSlots = nextSlots;
    renderRotationBuilder();
  }

  function addWorkoutToStage(workoutId) {
    if (!Array.isArray(stagedRotationSlots)) return;
    stagedRotationSlots = [...stagedRotationSlots, makeStagedSlot(workoutId)];
    renderRotationBuilder();
  }

  function removeWorkoutFromStage(slotId) {
    if (!Array.isArray(stagedRotationSlots) || stagedRotationSlots.length <= 2) return;
    stagedRotationSlots = stagedRotationSlots.filter(slot => slot.slotId !== slotId);
    renderRotationBuilder();
  }

  async function saveStagedRotation() {
    if (!Array.isArray(stagedRotationSlots) || stagedRotationSlots.length < 2 || rotationBuilderSaving) return;
    rotationBuilderSaving = true;
    document.getElementById('rotation-builder-save-btn').disabled = true;
    try {
      await data.saveUserRotation(stagedRotationSlots.map(slot => slot.workoutId));
      renderSettingsRotation();
      await deps.render(state.cachedData);
      closeRotationBuilder();
      utils.showToast('Rotation saved');
    } catch (err) {
      console.error('[rotation-builder] save failed:', err);
    } finally {
      rotationBuilderSaving = false;
      if (!document.getElementById('rotation-builder-modal').hidden) {
        document.getElementById('rotation-builder-save-btn').disabled = stagedRotationSlots.length < 2;
      }
    }
  }

  async function saveCustomWorkoutFromBuilder() {
    if (customWorkoutSaving) return;
    const name = document.getElementById('rotation-custom-name').value.trim();
    const category = document.getElementById('rotation-custom-category').value;
    if (!name) {
      utils.showToast('Enter a workout name');
      document.getElementById('rotation-custom-name').focus();
      return;
    }

    customWorkoutSaving = true;
    document.getElementById('rotation-custom-save-btn').disabled = true;
    try {
      await data.saveCustomWorkout({ name, category });
      hideCustomWorkoutForm();
      renderRotationBuilder();
      utils.showToast('Workout added');
    } catch (err) {
      console.error('[rotation-builder] custom workout save failed:', err);
      utils.showToast('Could not save workout');
    } finally {
      customWorkoutSaving = false;
      document.getElementById('rotation-custom-save-btn').disabled = false;
    }
  }

  async function handlePreferenceToggle(key, checked, inputId) {
    const input = document.getElementById(inputId);
    const priorSave = pendingPreferenceSaves[key];
    if (priorSave) {
      await priorSave.catch(() => {});
    }

    const previous = !!state.userPreferences[key];
    const expectedValue = checked;

    input.disabled = true;
    state.userPreferences = { ...state.userPreferences, [key]: expectedValue };
    renderSettingsTodayTab();
    await deps.render(state.cachedData);

    const savePromise = (async () => {
      try {
        await data.saveUserPreference(key, expectedValue);
        if (state.userPreferences[key] === expectedValue) {
          renderSettingsTodayTab();
        }
      } catch (err) {
        console.error('[preferences] update failed:', err);
        if (state.userPreferences[key] === expectedValue) {
          state.userPreferences = { ...state.userPreferences, [key]: previous };
          renderSettingsTodayTab();
          await deps.render(state.cachedData);
          utils.showToast('Could not save setting');
        }
      } finally {
        if (pendingPreferenceSaves[key] === savePromise) {
          delete pendingPreferenceSaves[key];
          input.disabled = false;
        }
      }
    })();

    pendingPreferenceSaves[key] = savePromise;
    await savePromise;
  }

  function renderSettingsAccount() {
    const email = deps.getUserEmail();
    const meta = deps.getUserMetadata();
    document.getElementById('settings-email').textContent = email || 'No email found';
    document.getElementById('settings-avatar').textContent = deps.getUserInitial();
    document.getElementById('settings-first-name').value = meta.first_name || '';
    document.getElementById('settings-last-name').value = meta.last_name || '';
    renderSettingsTodayTab();
    renderSettingsRotation();
    deps.setProfileEditing(!deps.hasSavedProfileName(meta));
  }

  function openWelcomeScreen() {
    const screen = document.getElementById('welcome-screen');
    state.lastFocusedBeforeWelcome = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    screen.hidden = false;
    document.getElementById('app-container').inert = true;
    document.getElementById('bottom-nav').inert = true;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    requestAnimationFrame(() => {
      screen.scrollTop = 0;
      screen.scrollTo(0, 0);
      const card = screen.querySelector('.welcome-card');
      if (card) card.scrollIntoView({ block: 'start' });
      const continueBtn = document.getElementById('welcome-continue-btn');
      if (continueBtn) continueBtn.focus({ preventScroll: true });
    });
  }

  function closeWelcomeScreen() {
    deps.markWelcomeDismissed(state.currentUser?.id);
    const screen = document.getElementById('welcome-screen');
    screen.hidden = true;
    document.getElementById('app-container').inert = false;
    document.getElementById('bottom-nav').inert = false;
    if (state.lastFocusedBeforeWelcome && typeof state.lastFocusedBeforeWelcome.focus === 'function') {
      state.lastFocusedBeforeWelcome.focus();
    }
    state.lastFocusedBeforeWelcome = null;
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
    if (!state.sb) {
      utils.showToast('Could not connect to the server');
      return;
    }
    const btn = document.getElementById('save-profile-btn');
    if (!state.settingsProfileEditing) {
      deps.setProfileEditing(true);
      document.getElementById('settings-first-name').focus();
      return;
    }
    const firstName = document.getElementById('settings-first-name').value.trim();
    const lastName = document.getElementById('settings-last-name').value.trim();
    btn.disabled = true;
    try {
      const { data: userData, error } = await state.sb.auth.updateUser({
        data: {
          ...deps.getUserMetadata(),
          first_name: firstName || null,
          last_name: lastName || null,
        },
      });
      if (error) throw error;
      state.currentUser = userData.user || state.currentUser;
      renderSettingsAccount();
      deps.setProfileEditing(!(firstName || lastName));
      utils.showToast('Profile saved');
    } catch (err) {
      console.error('[profile] update failed:', err);
      utils.showToast('Could not save profile');
    } finally {
      btn.disabled = false;
    }
  }

  async function changePassword() {
    if (!state.sb) {
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
      const { data: userData, error } = await state.sb.auth.updateUser({ password });
      if (error) throw error;
      state.currentUser = userData.user || state.currentUser;
      closePasswordModal();
      utils.showToast('Password updated');
    } catch (err) {
      console.error('[auth] password update failed:', err);
      errorEl.textContent = deps.authErrorMessage(err);
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
        name: deps.getUserDisplayName() || deps.getUserEmail() || 'Unknown user',
        email: deps.getUserEmail() || '',
        message: `Habits App Feedback\nFrom: ${deps.getUserFeedbackIdentity()}\n\n${body}`,
      });
      const res = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: payload.toString(),
      });
      if (!res.ok) throw new Error(`Feedback submit failed: ${res.status}`);
      closeFeedbackModal();
      utils.showToast('Feedback sent');
    } catch (err) {
      console.error('[feedback] submit failed:', err);
      utils.showToast('Could not send feedback');
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteAccount() {
    if (!state.sb) {
      utils.showToast('Could not connect to the server');
      return;
    }
    const btn = document.getElementById('delete-account-confirm-btn');
    btn.disabled = true;
    const userId = state.currentUser?.id;
    const deletionRequestedAt = new Date().toISOString();
    try {
      const [historyRes, journalRes, weightRes, stateRes, preferencesRes] = await Promise.all([
        state.sb.from('history').delete().eq('user_id', userId),
        state.sb.from('journal').delete().eq('user_id', userId),
        state.sb.from('weight').delete().eq('user_id', userId),
        state.sb.from('state').delete().eq('user_id', userId),
        state.sb.from('user_preferences').delete().eq('user_id', userId),
      ]);
      [historyRes, journalRes, weightRes, stateRes, preferencesRes].forEach(res => {
        if (res.error) throw res.error;
      });

      let usedFallback = false;
      try {
        const { error } = await state.sb.auth.admin.deleteUser(userId);
        if (error) throw error;
      } catch (adminErr) {
        usedFallback = true;
        console.warn('[account-delete] admin delete unavailable, flagging account instead:', adminErr);
        const { error } = await state.sb.auth.updateUser({
          data: {
            ...deps.getUserMetadata(),
            deletion_requested_at: deletionRequestedAt,
            deletion_requested_email: deps.getUserEmail(),
            deletion_requested_name: deps.getUserDisplayName() || null,
          },
        });
        if (error) throw error;
      }

      closeDeleteAccountModal();
      state.cachedData = null;
      state.cachedJournal = null;
      state.cachedWeight = null;
      state.workoutLibrary = [];
      state.userRotation = null;
      state.userPreferences = { ...DEFAULT_USER_PREFERENCES };
      data.removeCachedValue(BASE_STORAGE_KEY);
      data.removeCachedValue(BASE_JOURNAL_KEY);
      data.removeCachedValue(BASE_WEIGHT_KEY);
      data.removeCachedValue(BASE_OTHER_ACTIVITIES_KEY);
      data.removeCachedValue(BASE_SKIP_REASONS_KEY);
      utils.showToast(usedFallback ? 'Goodbye - account flagged for deletion' : 'Goodbye');
      setTimeout(() => {
        state.sb.auth.signOut();
      }, 1200);
    } catch (err) {
      console.error('[account-delete] failed:', err);
      utils.showToast('Could not delete account');
    } finally {
      btn.disabled = false;
    }
  }

  async function syncAllData() {
    return deps.syncAllData();
  }

  async function signOut() {
    if (!confirm('Are you sure you want to sign out?')) return;
    try {
      await state.sb.auth.signOut();
      state.cachedData = null;
      state.cachedJournal = null;
      state.cachedWeight = null;
      state.workoutLibrary = [];
      state.userRotation = null;
      state.userPreferences = { ...DEFAULT_USER_PREFERENCES };
      deps.showAuthScreen();
    } catch {
      utils.showToast('Sign out failed — check your connection');
    }
  }

  function bindEvents() {
    document.getElementById('welcome-continue-btn').onclick = () => closeWelcomeScreen();
    document.getElementById('tutorial-btn').onclick = () => openWelcomeScreen();

    document.getElementById('save-profile-btn').onclick = () => saveProfile();
    document.getElementById('toggle-workout-card').addEventListener('change', e => {
      handlePreferenceToggle('show_workout_card', e.target.checked, 'toggle-workout-card');
    });
    document.getElementById('toggle-journal-card').addEventListener('change', e => {
      handlePreferenceToggle('show_journal_card', e.target.checked, 'toggle-journal-card');
    });
    document.getElementById('toggle-weight-card').addEventListener('change', e => {
      handlePreferenceToggle('show_weight_card', e.target.checked, 'toggle-weight-card');
    });
    document.getElementById('sync-btn').onclick = async () => {
      const syncBtn = document.getElementById('sync-btn');
      if (syncBtn.classList.contains('is-syncing')) return;

      syncBtn.classList.add('is-syncing');
      try {
        await syncAllData();
        utils.showToast('Synced ✓');
      } catch {
        utils.showToast('Sync failed — check your connection');
      } finally {
        syncBtn.classList.remove('is-syncing');
      }
    };
    document.getElementById('change-password-btn').onclick = () => openPasswordModal();
    document.getElementById('feedback-btn').onclick = () => openFeedbackModal();
    document.getElementById('signout-btn').onclick = () => signOut();
    document.getElementById('delete-account-btn').onclick = () => openDeleteAccountModal();
    document.getElementById('rotation-builder-open-btn').onclick = () => openRotationBuilder();
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
    document.getElementById('rotation-builder-close-btn').onclick = () => closeRotationBuilder();
    document.getElementById('rotation-builder-cancel-btn').onclick = () => closeRotationBuilder();
    document.getElementById('rotation-builder-save-btn').onclick = () => saveStagedRotation();
    document.getElementById('rotation-add-own-btn').onclick = () => showCustomWorkoutForm();
    document.getElementById('rotation-custom-cancel-btn').onclick = () => hideCustomWorkoutForm();
    document.getElementById('rotation-custom-save-btn').onclick = () => saveCustomWorkoutFromBuilder();
    document.getElementById('rotation-builder-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('rotation-builder-modal')) closeRotationBuilder();
    });
    document.getElementById('rotation-builder-modal').addEventListener('click', e => {
      const addButton = e.target.closest('[data-add-workout]');
      if (addButton) {
        addWorkoutToStage(addButton.dataset.addWorkout);
        return;
      }
      const removeButton = e.target.closest('[data-remove-slot]');
      if (removeButton) {
        removeWorkoutFromStage(removeButton.dataset.removeSlot);
        return;
      }
      const moveUpButton = e.target.closest('[data-move-up]');
      if (moveUpButton) {
        moveStagedWorkout(moveUpButton.dataset.moveUp, 'up');
        return;
      }
      const moveDownButton = e.target.closest('[data-move-down]');
      if (moveDownButton) {
        moveStagedWorkout(moveDownButton.dataset.moveDown, 'down');
      }
    });
    document.getElementById('rotation-custom-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') saveCustomWorkoutFromBuilder();
    });
  }

  return {
    bindEvents,
    renderSettingsTodayTab,
    renderSettingsAccount,
    openWelcomeScreen,
    closeWelcomeScreen,
    openFeedbackModal,
    closeFeedbackModal,
    openPasswordModal,
    closePasswordModal,
    openDeleteAccountModal,
    closeDeleteAccountModal,
    handlePreferenceToggle,
    saveProfile,
    changePassword,
    sendFeedback,
    deleteAccount,
  };
};
