window.HabitsApp = window.HabitsApp || {};

window.HabitsApp.registerSettingsModule = function registerSettingsModule(ctx) {
  const { DEFAULT_USER_PREFERENCES, BASE_STORAGE_KEY, BASE_OTHER_ACTIVITIES_KEY, BASE_SKIP_REASONS_KEY, BASE_JOURNAL_KEY, BASE_WEIGHT_KEY } = ctx.constants;
  const state = ctx.state;
  const utils = ctx.utils;
  const data = ctx.data;
  const deps = ctx.deps;

  function renderSettingsTodayTab() {
    document.getElementById('toggle-workout-card').checked = !!state.userPreferences.show_workout_card;
    document.getElementById('toggle-journal-card').checked = !!state.userPreferences.show_journal_card;
    document.getElementById('toggle-weight-card').checked = !!state.userPreferences.show_weight_card;
  }

  async function handlePreferenceToggle(key, checked, inputId) {
    const input = document.getElementById(inputId);
    const previous = !!state.userPreferences[key];

    input.disabled = true;
    state.userPreferences = { ...state.userPreferences, [key]: checked };
    renderSettingsTodayTab();
    await deps.render(state.cachedData);

    try {
      await data.saveUserPreference(key, checked);
    } catch (err) {
      console.error('[preferences] update failed:', err);
      state.userPreferences = { ...state.userPreferences, [key]: previous };
      renderSettingsTodayTab();
      await deps.render(state.cachedData);
      utils.showToast('Could not save setting');
    } finally {
      input.disabled = false;
    }
  }

  function renderSettingsAccount() {
    const email = deps.getUserEmail();
    const meta = deps.getUserMetadata();
    document.getElementById('settings-email').textContent = email || 'No email found';
    document.getElementById('settings-avatar').textContent = deps.getUserInitial();
    document.getElementById('settings-first-name').value = meta.first_name || '';
    document.getElementById('settings-last-name').value = meta.last_name || '';
    renderSettingsTodayTab();
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
    deps.markWelcomeDismissed();
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
