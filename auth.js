window.HabitsApp = window.HabitsApp || {};

window.HabitsApp.registerAuthModule = function registerAuthModule(ctx) {
  const { DEFAULT_USER_PREFERENCES } = ctx.constants;
  const state = ctx.state;
  const utils = ctx.utils;
  const data = ctx.data;
  const deps = ctx.deps;

  function showConnectivityError(errorEl) {
    if (errorEl) {
      errorEl.textContent = 'Could not connect to the server. Please try again later.';
      errorEl.hidden = false;
    }
    utils.showToast('Could not connect to the server');
  }

  function shouldShowSignupByDefault() {
    return !state.currentUser && new URLSearchParams(window.location.search).get('signup') === 'true';
  }

  async function sendPasswordReset() {
    const errorEl = document.getElementById('login-error');
    if (!state.sb) {
      showConnectivityError(errorEl);
      return;
    }
    const email = document.getElementById('login-email').value.trim();
    errorEl.hidden = true;
    if (!email) {
      errorEl.textContent = 'Enter your email first';
      errorEl.hidden = false;
      return;
    }
    try {
      const { error } = await state.sb.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${window.location.pathname}`,
      });
      if (error) throw error;
      utils.showToast('Password reset email sent');
    } catch (err) {
      errorEl.textContent = authErrorMessage(err);
      errorEl.hidden = false;
    }
  }

  function showApp() {
    deps.migrateLegacyCacheKeys();
    document.getElementById('auth-screen').hidden = true;
    document.getElementById('app-container').hidden = false;
    document.getElementById('bottom-nav').hidden = false;
    deps.renderSettingsAccount();
  }

  function showAuthScreen() {
    state.cachedData = null;
    state.cachedJournal = null;
    state.cachedWeight = null;
    state.workoutLibrary = [];
    state.userRotation = null;
    state.programs = [];
    state.userPreferences = { ...DEFAULT_USER_PREFERENCES };
    document.getElementById('auth-screen').hidden = false;
    document.getElementById('app-container').hidden = true;
    document.getElementById('bottom-nav').hidden = true;
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').hidden = true;
    document.getElementById('signup-email').value = '';
    document.getElementById('signup-password').value = '';
    document.getElementById('signup-error').hidden = true;
    document.getElementById('signup-password-error').hidden = true;
    document.getElementById('feedback-modal').hidden = true;
    document.getElementById('password-modal').hidden = true;
    document.getElementById('delete-account-modal').hidden = true;
    document.getElementById('welcome-screen').hidden = true;
    document.getElementById('program-reset-modal').hidden = true;
    document.getElementById('program-reset-confirm-modal').hidden = true;
    document.getElementById('app-container').inert = false;
    document.getElementById('bottom-nav').inert = false;
    state.lastFocusedBeforeWelcome = null;
    const showSignup = shouldShowSignupByDefault();
    document.getElementById('login-panel').hidden = showSignup;
    document.getElementById('signup-panel').hidden = !showSignup;
  }

  function resolveInitialAuth(nextScreen) {
    if (state.splashMaxTimer) {
      clearTimeout(state.splashMaxTimer);
      state.splashMaxTimer = null;
    }
    state.authResolved = true;
    if (nextScreen === 'app') {
      deps.setTodayLoading(true);
      deps.setStatsLoading(true);
    }
    if (!state.initialAuthSettled) {
      state.initialAuthSettled = true;
      if (nextScreen === 'app') showApp();
      else showAuthScreen();
      deps.hideSplashScreen();
      return;
    }
    if (nextScreen === 'app') showApp();
    else showAuthScreen();
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

  async function initApp() {
    deps.setTodayLoading(true);
    deps.setStatsLoading(true);
    deps.switchMainTab('today');
    await deps.loadWorkoutLibrary();
    await deps.loadUserRotation();
    await deps.loadPrograms();
    deps.renderSettingsAccount();
    await data.loadUserPreferences();
    deps.renderSettingsTodayTab();
    await deps.render();
    if (deps.hasPendingWelcome() && !deps.hasDismissedWelcome()) {
      deps.openWelcomeScreen();
    }
    deps.loadJournal().then(() => {
      deps.renderJournalCard();
      if (state.historyViewActive && state.historySubTab === 'calendar' && state.cachedData) {
        deps.renderCalendar(state.cachedData);
      }
    });
    deps.loadWeight().then(() => {
      deps.renderWeightCard();
      if (state.historyViewActive && state.historySubTab === 'calendar' && state.cachedData) {
        deps.renderCalendar(state.cachedData);
      }
      if (state.statsViewActive && state.cachedData) {
        deps.renderStatsView(state.cachedData);
      } else {
        deps.setStatsLoading(false);
      }
    });
  }

  function bindEvents() {
    document.getElementById('show-signup-btn').onclick = () => {
      document.getElementById('login-panel').hidden = true;
      document.getElementById('signup-panel').hidden = false;
    };
    document.getElementById('show-login-btn').onclick = () => {
      document.getElementById('signup-panel').hidden = true;
      document.getElementById('login-panel').hidden = false;
    };
    document.getElementById('forgot-password-btn').onclick = () => sendPasswordReset();

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

    document.getElementById('login-btn').onclick = async () => {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const errorEl = document.getElementById('login-error');
      errorEl.hidden = true;
      if (!state.sb) {
        showConnectivityError(errorEl);
        return;
      }
      const btn = document.getElementById('login-btn');
      btn.disabled = true;
      try {
        const { data: userData, error } = await state.sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        state.currentUser = userData.user;
        resolveInitialAuth('app');
        initApp();
      } catch (err) {
        errorEl.textContent = authErrorMessage(err);
        errorEl.hidden = false;
      } finally {
        btn.disabled = false;
      }
    };

    document.getElementById('signup-btn').onclick = async () => {
      const email = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      const errorEl = document.getElementById('signup-error');
      const pwErrEl = document.getElementById('signup-password-error');
      pwErrEl.hidden = true;
      errorEl.hidden = true;
      if (!state.sb) {
        showConnectivityError(errorEl);
        return;
      }
      if (password.length < 8) {
        pwErrEl.hidden = false;
        return;
      }
      const btn = document.getElementById('signup-btn');
      btn.disabled = true;
      try {
        const { data: userData, error } = await state.sb.auth.signUp({ email, password });
        if (error) throw error;
        deps.markWelcomePending(userData.user?.id);
        if (!userData.session) {
          errorEl.textContent = 'Account created! Check your email to confirm before signing in.';
          errorEl.hidden = false;
          return;
        }
        state.currentUser = userData.user;
        resolveInitialAuth('app');
        initApp();
      } catch (err) {
        errorEl.textContent = authErrorMessage(err);
        errorEl.hidden = false;
      } finally {
        btn.disabled = false;
      }
    };

    if (state.sb) {
      state.sb.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          state.currentUser = null;
          resolveInitialAuth('auth');
        } else if (event === 'PASSWORD_RECOVERY' && session) {
          state.currentUser = session.user;
          resolveInitialAuth('app');
          initApp();
          deps.openPasswordModal();
          utils.showToast('Choose a new password');
        } else if (session) {
          state.currentUser = session.user;
        }
      });

      (async () => {
        const { data: { session } } = await state.sb.auth.getSession();
        if (session) {
          state.currentUser = session.user;
          resolveInitialAuth('app');
          initApp();
        } else {
          resolveInitialAuth('auth');
        }
      })();
    } else {
      resolveInitialAuth('auth');
      showConnectivityError(document.getElementById('login-error'));
      ['login-btn', 'signup-btn', 'forgot-password-btn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
      });
    }
  }

  return {
    bindEvents,
    sendPasswordReset,
    showApp,
    showAuthScreen,
    authErrorMessage,
    initApp,
    resolveInitialAuth,
  };
};
