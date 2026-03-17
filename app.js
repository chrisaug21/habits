  window.HabitsApp = window.HabitsApp || {
    constants: {},
    state: {},
    utils: {},
    data: {},
    actions: {},
    views: {},
    auth: {},
    settings: {},
    modules: {},
    registerTodayModule: null,
    registerLogModule: null,
    registerStatsModule: null,
    registerSettingsModule: null,
    registerAuthModule: null,
    registerSharedModule: null,
    registerDataModule: null,
  };

  // DOMContentLoaded ensures the deferred Supabase CDN script has executed before
  // app initialisation runs. Without this wrapper, the inline script would run
  // during HTML parsing — before the deferred script — and window.supabase
  // would be undefined.
  document.addEventListener('DOMContentLoaded', function () {
    const App = window.HabitsApp;

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

    const VERSION = '1.5.16';

    // ── Test mode ────────────────────────────────────────────────────────────
    const TEST_MODE = new URLSearchParams(window.location.search).get('test') === 'true';
    const BASE_STORAGE_KEY = TEST_MODE ? 'habits_test' : 'habits_v1';
    const BASE_OTHER_ACTIVITIES_KEY = TEST_MODE ? 'habits_test_other_activities' : 'habits_other_activities';
    const BASE_SKIP_REASONS_KEY = `${BASE_STORAGE_KEY}_skip_reasons`;
    const BASE_JOURNAL_KEY = TEST_MODE ? 'habits_test_journal' : 'habits_journal';
    const BASE_WEIGHT_KEY = TEST_MODE ? 'habits_test_weight' : 'habits_weight';
    const BASE_WELCOMED_KEY = 'habits_welcomed';
    const DEFAULT_USER_PREFERENCES = Object.freeze({
      show_workout_card: true,
      show_journal_card: true,
      show_weight_card: true,
    });
    // ────────────────────────────────────────────────────────────────────────

    let settingsProfileEditing = true;
    let lastFocusedBeforeWelcome = null;

    // ── Double-tap guard ─────────────────────────────────────────────────────
    // Each action function sets this true at the start and false when complete
    // (via try/finally). Any tap that arrives during a network round-trip hits
    // the guard and returns immediately — no duplicate mutations.
    let isProcessing = false;
    let lastSyncedAt = null;  // Date.now() timestamp of last successful Supabase sync
    let syncOffline  = false; // true if the last Supabase attempt failed
    let userPreferences = { ...DEFAULT_USER_PREFERENCES };

    const SKIP_DEFAULTS = ['Sick', 'Travel', 'Vacation', 'Social obligation'];
    const MAX_ACTIVITY_LENGTH = 100;
    let cachedData = null;        // last-loaded data, used by feature renders
    let cachedJournal = null;          // array of { date, intention, gratitude, one_thing }
    let _journalNudgeConfirmed = false; // true after user taps "Yes" on gratitude nudge
    let cachedWeight  = null;          // array of { date, value_lbs }
    let activeWeightDate     = null;  // date currently being edited in the weight modal
    let weightModalFromBackfill = false; // true when weight modal was opened from the day-detail sheet
    let historyViewActive = false;
    let statsViewActive = false;
    let historySubTab = 'calendar'; // 'calendar' | 'list' | 'schedule'
    let statsRange = '30'; // '7', '30', or 'all'
    let calViewDate = new Date();
    let weightChart = null;      // Chart.js instance for the Stats tab weight chart

    App.constants = {
      ...App.constants,
      WORKOUTS,
      ROTATION,
      TEST_MODE,
      BASE_OTHER_ACTIVITIES_KEY,
      BASE_SKIP_REASONS_KEY,
      BASE_JOURNAL_KEY,
      BASE_WEIGHT_KEY,
      DEFAULT_USER_PREFERENCES,
      SKIP_DEFAULTS,
      MAX_ACTIVITY_LENGTH,
      BASE_STORAGE_KEY,
      BASE_WELCOMED_KEY,
    };

    App.state = {
      ...App.state,
      get sb() { return sb; },
      get currentUser() { return currentUser; },
      set currentUser(value) { currentUser = value; },
      get lastSyncedAt() { return lastSyncedAt; },
      set lastSyncedAt(value) { lastSyncedAt = value; },
      get syncOffline() { return syncOffline; },
      set syncOffline(value) { syncOffline = value; },
      get isProcessing() { return isProcessing; },
      set isProcessing(value) { isProcessing = value; },
      get userPreferences() { return userPreferences; },
      set userPreferences(value) { userPreferences = value; },
      get cachedData() { return cachedData; },
      set cachedData(value) { cachedData = value; },
      get cachedJournal() { return cachedJournal; },
      set cachedJournal(value) { cachedJournal = value; },
      get cachedWeight() { return cachedWeight; },
      set cachedWeight(value) { cachedWeight = value; },
      get journalNudgeConfirmed() { return _journalNudgeConfirmed; },
      set journalNudgeConfirmed(value) { _journalNudgeConfirmed = value; },
      get activeWeightDate() { return activeWeightDate; },
      set activeWeightDate(value) { activeWeightDate = value; },
      get weightModalFromBackfill() { return weightModalFromBackfill; },
      set weightModalFromBackfill(value) { weightModalFromBackfill = value; },
      get historyViewActive() { return historyViewActive; },
      set historyViewActive(value) { historyViewActive = value; },
      get historySubTab() { return historySubTab; },
      set historySubTab(value) { historySubTab = value; },
      get statsViewActive() { return statsViewActive; },
      set statsViewActive(value) { statsViewActive = value; },
      get statsRange() { return statsRange; },
      set statsRange(value) { statsRange = value; },
      get calViewDate() { return calViewDate; },
      set calViewDate(value) { calViewDate = value; },
      get weightChart() { return weightChart; },
      set weightChart(value) { weightChart = value; },
      get settingsProfileEditing() { return settingsProfileEditing; },
      set settingsProfileEditing(value) { settingsProfileEditing = value; },
      get lastFocusedBeforeWelcome() { return lastFocusedBeforeWelcome; },
      set lastFocusedBeforeWelcome(value) { lastFocusedBeforeWelcome = value; },
    };

    const Shared = App.registerSharedModule({
      constants: App.constants,
      state: App.state,
    });

    App.utils = {
      ...App.utils,
      ...Shared,
    };

    const Data = App.registerDataModule({
      constants: App.constants,
      state: App.state,
      deps: {
        updateSyncStamp: () => Shared.updateSyncStamp(),
        showToast: msg => Shared.showToast(msg),
      },
    });

    App.data = {
      ...App.data,
      ...Data,
    };

    const {
      todayStr,
      getYesterdayStr,
      daysSince,
      dateToStr,
      isValidISODate,
      getSuggested,
      lastDoneBadge,
      renderLastDonePill,
      showToast,
      getUserEmail,
      getUserMetadata,
      getUserDisplayName,
      getUserFeedbackIdentity,
      getUserInitial,
      hasSavedProfileName,
      setProfileEditing,
      setButtonsDisabled,
      escapeHtml,
      updateSyncStamp,
      toggleTestMode,
      bindTestModeTapTrigger,
    } = Shared;

    const {
      readCachedJSON,
      writeCachedJSON,
      loadData,
      saveData,
      loadUserPreferences,
      saveUserPreference,
      normalizeUserPreferences,
      insertDefaultUserPreferences,
      removeCachedValue,
      hasPendingWelcome,
      hasDismissedWelcome,
      markWelcomePending,
      markWelcomeDismissed,
      migrateLegacyCacheKeys,
    } = Data;

    const Today = App.registerTodayModule({
      constants: App.constants,
      state: App.state,
      utils: App.utils,
      data: App.data,
      deps: {
        hideBackfillModal: () => App.modules.log?.hideBackfillModal?.(),
        showBackfillModal: () => App.modules.log?.showBackfillModal?.(),
        getBackfillDate: () => App.modules.log?.getBackfillDate?.() ?? null,
        getBackfillExisting: () => App.modules.log?.getBackfillExisting?.() ?? null,
        setBackfillWeightEntry: value => App.modules.log?.setBackfillWeightEntry?.(value),
        showBackfillReadonly: entry => App.modules.log?.showBackfillReadonly?.(entry),
        renderCalendar: data => App.modules.log?.renderCalendar?.(data),
        renderHistoryView: data => App.modules.log?.renderHistoryView?.(data),
        renderStatsView: data => renderStatsView(data),
        renderSettingsTodayTab: () => renderSettingsTodayTab(),
      },
    });

    App.modules.today = Today;
    App.actions = {
      ...App.actions,
      markDone: Today.markDone,
      logSkip: Today.logSkip,
      undoLastEntry: Today.undoLastEntry,
      markRowDone: Today.markRowDone,
      logOtherActivity: Today.logOtherActivity,
      saveJournal: Today.saveJournal,
      saveWeight: Today.saveWeight,
    };
    App.views = {
      ...App.views,
      render: Today.render,
      renderJournalCard: Today.renderJournalCard,
      renderWeightCard: Today.renderWeightCard,
    };

    const {
      getJournalSync,
      loadJournal,
      openJournalModal,
      renderJournalCard,
      saveJournal,
      getWeightSync,
      loadWeight,
      renderWeightCard,
      syncAllData,
      render,
      openWeightModal,
      closeWeightModal,
      saveWeight,
    } = Today;

    const Log = App.registerLogModule({
      constants: App.constants,
      state: App.state,
      utils: App.utils,
      data: App.data,
      deps: {
        getJournalSync: () => getJournalSync(),
        getWeightSync: () => getWeightSync(),
        openWeightModal: (dateStr, options) => openWeightModal(dateStr, options),
        loadOtherActivities: () => App.modules.today.loadOtherActivities(),
        saveOtherActivities: name => App.modules.today.saveOtherActivities(name),
        loadSkipReasons: () => App.modules.today.loadSkipReasons(),
        saveSkipReason: reason => App.modules.today.saveSkipReason(reason),
      },
    });

    App.modules.log = Log;
    App.views = {
      ...App.views,
      renderCalendar: Log.renderCalendar,
      renderHistoryView: Log.renderHistoryView,
    };

    const {
      openBackfillModal,
      closeBackfillModal,
      showBackfillReadonly,
      hideBackfillModal,
      renderCalendar,
      renderHistoryList,
      renderSchedule,
      renderHistoryView,
      switchHistorySubTab,
    } = Log;

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

    const Stats = App.registerStatsModule({
      constants: App.constants,
      state: App.state,
      utils: App.utils,
      deps: {
        getWeightSync: () => getWeightSync(),
        destroyWeightChart: () => destroyWeightChart(),
        computeRollingSeries: (rows, values) => computeRollingSeries(rows, values),
        getStatsRangeDays: (range) => getStatsRangeDays(range),
        getStatsRangeCutoffStr: (range) => getStatsRangeCutoffStr(range),
      },
    });

    App.modules.stats = Stats;
    App.views = {
      ...App.views,
      renderStatsView: Stats.renderStatsView,
    };

    const {
      renderWeightChart,
      renderStatsView,
      switchStatsRange,
    } = Stats;

    const Settings = App.registerSettingsModule({
      constants: App.constants,
      state: App.state,
      utils: App.utils,
      data: App.data,
      deps: {
        render: data => render(data),
        syncAllData: () => syncAllData(),
        showAuthScreen: () => showAuthScreen(),
        authErrorMessage: err => authErrorMessage(err),
        getUserMetadata: () => getUserMetadata(),
        getUserEmail: () => getUserEmail(),
        getUserInitial: () => getUserInitial(),
        getUserDisplayName: () => getUserDisplayName(),
        getUserFeedbackIdentity: () => getUserFeedbackIdentity(),
        hasSavedProfileName: meta => hasSavedProfileName(meta),
        setProfileEditing: value => setProfileEditing(value),
        markWelcomeDismissed: userId => markWelcomeDismissed(userId),
      },
    });

    App.modules.settings = Settings;
    App.settings = {
      ...App.settings,
      renderSettingsTodayTab: Settings.renderSettingsTodayTab,
      renderSettingsAccount: Settings.renderSettingsAccount,
      openWelcomeScreen: Settings.openWelcomeScreen,
      closeWelcomeScreen: Settings.closeWelcomeScreen,
      openPasswordModal: Settings.openPasswordModal,
      closePasswordModal: Settings.closePasswordModal,
    };

    const {
      renderSettingsTodayTab,
      renderSettingsAccount,
      openWelcomeScreen,
      closeWelcomeScreen,
      openPasswordModal,
      closePasswordModal,
    } = Settings;

    const Auth = App.registerAuthModule({
      constants: App.constants,
      state: App.state,
      utils: App.utils,
      data: App.data,
      deps: {
        migrateLegacyCacheKeys: () => migrateLegacyCacheKeys(),
        renderSettingsAccount: () => renderSettingsAccount(),
        renderSettingsTodayTab: () => renderSettingsTodayTab(),
        render: () => render(),
        hasPendingWelcome: () => hasPendingWelcome(),
        hasDismissedWelcome: () => hasDismissedWelcome(),
        openWelcomeScreen: () => openWelcomeScreen(),
        loadJournal: () => loadJournal(),
        renderJournalCard: () => renderJournalCard(),
        renderCalendar: data => renderCalendar(data),
        loadWeight: () => loadWeight(),
        renderWeightCard: () => renderWeightCard(),
        renderStatsView: data => renderStatsView(data),
        switchMainTab: tab => switchMainTab(tab),
        markWelcomePending: userId => markWelcomePending(userId),
        openPasswordModal: () => openPasswordModal(),
      },
    });

    App.auth = {
      ...App.auth,
      sendPasswordReset: Auth.sendPasswordReset,
      showApp: Auth.showApp,
      showAuthScreen: Auth.showAuthScreen,
      authErrorMessage: Auth.authErrorMessage,
      initApp: Auth.initApp,
    };

    const {
      showAuthScreen,
      authErrorMessage,
      initApp,
    } = Auth;

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

    // ── Nav event listeners ─────────────────────────────────────────────────
    document.getElementById('nav-today-btn').onclick    = () => switchMainTab('today');
    document.getElementById('nav-history-btn').onclick  = () => switchMainTab('history');
    document.getElementById('nav-stats-btn').onclick    = () => switchMainTab('stats');
    document.getElementById('nav-settings-btn').onclick = () => switchMainTab('settings');
    Log.bindEvents();
    Today.bindEvents();
    Stats.bindEvents();
    Settings.bindEvents();
    Auth.bindEvents();

    if (TEST_MODE) {
      document.getElementById('test-banner').hidden = false;
      document.getElementById('test-reset-btn').onclick = () => {
        removeCachedValue(BASE_STORAGE_KEY);
        removeCachedValue(BASE_OTHER_ACTIVITIES_KEY);
        removeCachedValue(BASE_SKIP_REASONS_KEY);
        removeCachedValue(BASE_JOURNAL_KEY);
        removeCachedValue(BASE_WEIGHT_KEY);
        cachedJournal = null;
        cachedWeight  = null;
        render();
      };
      document.getElementById('test-exit-btn').onclick = toggleTestMode;
    }

    updateSyncStamp();
    setInterval(updateSyncStamp, 30_000);
    ['version-stamp', 'login-version-stamp', 'signup-version-stamp'].forEach(id => {
      bindTestModeTapTrigger(document.getElementById(id));
    });
    document.addEventListener('keydown', e => {
      if (e.altKey && e.shiftKey && e.key === 'T') toggleTestMode();
    });

    document.getElementById('new-password-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('password-save-btn').click();
    });

  }); // end DOMContentLoaded

  // Register service worker outside DOMContentLoaded so it starts as early as
  // possible — it does not depend on the Supabase client.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
