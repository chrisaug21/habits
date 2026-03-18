window.HabitsApp = window.HabitsApp || {};

window.HabitsApp.registerDataModule = function registerDataModule(ctx) {
  const {
    TEST_MODE,
    BASE_STORAGE_KEY,
    BASE_WELCOMED_KEY,
    DEFAULT_USER_PREFERENCES,
  } = ctx.constants;
  const state = ctx.state;
  const deps = ctx.deps;

  function getScopedStorageKeyForUser(baseKey, userId = state.currentUser?.id) {
    return userId ? `${userId}:${baseKey}` : null;
  }

  function getScopedStorageKey(baseKey) {
    return getScopedStorageKeyForUser(baseKey);
  }

  function readCachedJSON(baseKey, fallback) {
    const key = getScopedStorageKey(baseKey);
    if (!key) return fallback;
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch { return fallback; }
  }

  function writeCachedJSON(baseKey, value) {
    const key = getScopedStorageKey(baseKey);
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(value));
  }

  function removeCachedValue(baseKey) {
    const key = getScopedStorageKey(baseKey);
    if (!key) return;
    localStorage.removeItem(key);
  }

  function getWelcomeState(userId = state.currentUser?.id) {
    const key = getScopedStorageKeyForUser(BASE_WELCOMED_KEY, userId);
    return key ? localStorage.getItem(key) : null;
  }

  function hasPendingWelcome(userId = state.currentUser?.id) {
    return getWelcomeState(userId) === 'pending';
  }

  function hasDismissedWelcome(userId = state.currentUser?.id) {
    return getWelcomeState(userId) === '1';
  }

  function markWelcomePending(userId = state.currentUser?.id) {
    const key = getScopedStorageKeyForUser(BASE_WELCOMED_KEY, userId);
    if (!key) return;
    localStorage.setItem(key, 'pending');
  }

  function markWelcomeDismissed(userId = state.currentUser?.id) {
    const key = getScopedStorageKeyForUser(BASE_WELCOMED_KEY, userId);
    if (!key) return;
    localStorage.setItem(key, '1');
  }

  function normalizeUserPreferences(row) {
    return {
      show_workout_card: row?.show_workout_card ?? DEFAULT_USER_PREFERENCES.show_workout_card,
      show_journal_card: row?.show_journal_card ?? DEFAULT_USER_PREFERENCES.show_journal_card,
      show_weight_card: row?.show_weight_card ?? DEFAULT_USER_PREFERENCES.show_weight_card,
    };
  }

  function normalizeWorkoutLibraryRow(row) {
    if (!row?.id) return null;
    return {
      id: row.id,
      name: row.name || 'Untitled workout',
      category: row.category || '',
      icon: row.icon || '',
      is_global: !!row.is_global,
      created_by: row.created_by || null,
    };
  }

  function migrateLegacyCacheKeys() {
    if (TEST_MODE) return;
    const migrateKey = (oldKey, baseKey) => {
      const newKey = getScopedStorageKey(baseKey);
      if (!newKey) return;
      if (localStorage.getItem(newKey) !== null) return;
      const old = localStorage.getItem(oldKey);
      if (old === null) return;
      localStorage.setItem(newKey, old);
      localStorage.removeItem(oldKey);
    };
    migrateKey('wmw_v1', 'habits_v1');
    migrateKey('wmw_other_activities', 'habits_other_activities');
    migrateKey('habits_v1', 'habits_v1');
    migrateKey('habits_other_activities', 'habits_other_activities');
    migrateKey('habits_v1_skip_reasons', 'habits_v1_skip_reasons');
    migrateKey('habits_journal', 'habits_journal');
    migrateKey('habits_weight', 'habits_weight');
  }

  async function loadData() {
    if (!state.sb || TEST_MODE) {
      return readCachedJSON(BASE_STORAGE_KEY, {});
    }
    try {
      const userId = state.currentUser?.id;
      const local = readCachedJSON(BASE_STORAGE_KEY, {});

      const [stateRes, historyRes] = await Promise.all([
        state.sb.from('state').select('*').eq('user_id', userId)
          .order('id', { ascending: false }).limit(1).maybeSingle(),
        state.sb.from('history').select('*').eq('user_id', userId)
          .order('sequence', { ascending: true, nullsFirst: true }),
      ]);
      if (stateRes.error) throw stateRes.error;
      if (historyRes.error) throw historyRes.error;

      let stateRow = stateRes.data;
      if (!stateRow) {
        const { data: upsertedState, error: upsertErr } = await state.sb.from('state')
          .upsert({
            user_id: userId,
            rotation_index: 0,
            action_date: null,
          }, { onConflict: 'user_id' })
          .select('*')
          .single();
        if (upsertErr) {
          console.warn('[loadData] State row upsert failed:', upsertErr);
        }
        stateRow = upsertedState ?? { rotation_index: 0, action_date: null };
      }

      const historyRows = historyRes.data || [];
      const supabaseMaxSeq = historyRows.reduce((m, row) => Math.max(m, row.sequence ?? -1), -1);
      const localMaxSeq = typeof local._maxSeq === 'number' ? local._maxSeq : -1;

      const loaded = {
        rotationIndex: stateRow.rotation_index ?? 0,
        actionDate: stateRow.action_date ?? null,
        _maxSeq: Math.max(supabaseMaxSeq, localMaxSeq),
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

      const supabaseSids = new Set(historyRows.map(row => row.id));
      const missed = (local.history || []).filter(entry => entry._sid && !supabaseSids.has(entry._sid));
      if (missed.length) {
        console.warn('[loadData] Supabase SELECT missed', missed.length,
          'recently-synced entries — re-appending from localStorage:',
          missed.map(entry => ({ type: entry.type, date: entry.date, _sid: entry._sid })));
        loaded.history = [...loaded.history, ...missed];
      }

      state.lastSyncedAt = Date.now();
      state.syncOffline = false;
      deps.updateSyncStamp();
      writeCachedJSON(BASE_STORAGE_KEY, loaded);
      return loaded;
    } catch (err) {
      console.warn('Supabase read failed, falling back to localStorage:', err);
      deps.showToast?.('Could not reach the server — using cached data');
      state.syncOffline = false;
      deps.updateSyncStamp();
      return readCachedJSON(BASE_STORAGE_KEY, {});
    }
  }

  async function loadWorkoutLibrary() {
    if (!state.currentUser?.id) {
      state.workoutLibrary = [];
      return state.workoutLibrary;
    }
    if (!state.sb || TEST_MODE) {
      state.workoutLibrary = [];
      return state.workoutLibrary;
    }
    try {
      const userId = state.currentUser.id;
      const { data: rows, error } = await state.sb.from('workout_library')
        .select('id, name, category, icon, is_global, created_by')
        .or(`is_global.eq.true,created_by.eq.${userId}`)
        .order('is_global', { ascending: false })
        .order('name', { ascending: true });
      if (error) throw error;

      state.workoutLibrary = (rows || [])
        .map(normalizeWorkoutLibraryRow)
        .filter(Boolean);
      return state.workoutLibrary;
    } catch (err) {
      console.warn('[workout-library] load failed:', err);
      state.workoutLibrary = [];
      return state.workoutLibrary;
    }
  }

  async function loadUserRotation() {
    if (!state.currentUser?.id) {
      state.userRotation = null;
      return state.userRotation;
    }
    if (!state.sb || TEST_MODE) {
      state.userRotation = null;
      return state.userRotation;
    }
    try {
      const { data: rows, error } = await state.sb.from('user_rotation')
        .select(`
          id,
          position,
          workout_id,
          workout_library (
            id,
            name,
            category,
            icon,
            is_global,
            created_by
          )
        `)
        .eq('user_id', state.currentUser.id)
        .order('position', { ascending: true });
      if (error) throw error;

      const rotation = (rows || [])
        .map(row => {
          const workout = normalizeWorkoutLibraryRow(row.workout_library);
          if (!workout) return null;
          return {
            ...workout,
            rotation_slot_id: row.id || row.position || null,
            position: row.position ?? null,
          };
        })
        .filter(Boolean);
      state.userRotation = rotation.length ? rotation : null;
      return state.userRotation;
    } catch (err) {
      console.warn('[user-rotation] load failed:', err);
      state.userRotation = null;
      return state.userRotation;
    }
  }

  async function saveData(data, deletedSid = null) {
    if (TEST_MODE) {
      writeCachedJSON(BASE_STORAGE_KEY, data);
      return;
    }
    if (!state.sb) throw new Error('Supabase client not available');

    if (deletedSid) {
      const { error: delErr } = await state.sb.from('history').delete().eq('id', deletedSid);
      if (delErr) throw delErr;
    }

    const newEntries = (data.history || []).filter(entry => !entry._sid);
    if (newEntries.length) {
      const baseSeq = (typeof data._maxSeq === 'number' ? data._maxSeq : data.history.filter(entry => entry._sid).length - 1) + 1;
      const rows = newEntries.map((entry, i) => ({
        type: entry.type,
        date: entry.date,
        advanced: entry.advanced ?? true,
        note: entry.note ?? null,
        sequence: baseSeq + i,
        user_id: state.currentUser?.id,
      }));
      console.log('[saveData] Inserting rows into Supabase:', rows.map(row => ({ type: row.type, date: row.date, sequence: row.sequence })));
      const { data: inserted, error: insErr } = await state.sb.from('history').insert(rows).select('id, sequence');
      if (insErr) {
        console.error('[saveData] Supabase INSERT failed:', insErr, 'rows attempted:', rows.map(row => ({ type: row.type, date: row.date, sequence: row.sequence })));
        throw insErr;
      }
      console.log('[saveData] Supabase INSERT succeeded:', inserted);
      const insertedBySeq = {};
      inserted.forEach(row => { insertedBySeq[row.sequence] = row.id; });
      newEntries.forEach((entry, i) => {
        const seq = baseSeq + i;
        if (insertedBySeq[seq] !== undefined) entry._sid = insertedBySeq[seq];
      });
      data._maxSeq = baseSeq + newEntries.length - 1;
    }

    const { error: stateErr } = await state.sb.from('state').update({
      rotation_index: data.rotationIndex ?? 0,
      action_date: data.actionDate ?? null,
    }).eq('user_id', state.currentUser?.id);
    if (stateErr) throw stateErr;

    state.lastSyncedAt = Date.now();
    state.syncOffline = false;
    deps.updateSyncStamp();
    writeCachedJSON(BASE_STORAGE_KEY, data);
  }

  async function saveUserRotation(rotationArray) {
    const orderedIds = Array.isArray(rotationArray)
      ? rotationArray.filter(id => typeof id === 'string' && id)
      : [];
    if (orderedIds.length < 2) throw new Error('Rotation must contain at least 2 workouts');

    const nextRotation = orderedIds
      .map((id, index) => {
        const workout = (state.workoutLibrary || []).find(item => item.id === id);
        if (!workout) return null;
        return {
          ...workout,
          rotation_slot_id: (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
            ? crypto.randomUUID()
            : `rotation-slot-${Date.now()}-${index}`,
          position: index,
        };
      })
      .filter(Boolean);
    if (nextRotation.length !== orderedIds.length) {
      throw new Error('Could not resolve all workouts in the rotation');
    }

    if (TEST_MODE) {
      state.userRotation = nextRotation;
      return state.userRotation;
    }
    if (!state.sb || !state.currentUser?.id) throw new Error('Supabase client not available');

    try {
      const { error } = await state.sb.rpc('save_user_rotation', {
        p_user_id: state.currentUser.id,
        p_workout_ids: orderedIds,
      });
      if (error) throw error;

      state.userRotation = nextRotation;
      return state.userRotation;
    } catch (err) {
      console.error('[user-rotation] save failed:', err);
      deps.showToast?.('Could not save rotation');
      throw err;
    }
  }

  async function saveCustomWorkout({ name, category }) {
    const trimmedName = String(name || '').trim();
    const normalizedCategory = String(category || '').trim();
    if (!trimmedName || !normalizedCategory) {
      throw new Error('Workout name and category are required');
    }

    const payload = {
      name: trimmedName,
      category: normalizedCategory,
      is_global: false,
      created_by: state.currentUser?.id || null,
    };

    if (TEST_MODE) {
      const createdWorkout = normalizeWorkoutLibraryRow({
        ...payload,
        id: `test-${Date.now()}`,
      });
      state.workoutLibrary = [...(state.workoutLibrary || []), createdWorkout];
      return createdWorkout;
    }
    if (!state.sb || !state.currentUser?.id) throw new Error('Supabase client not available');

    const { data: inserted, error } = await state.sb.from('workout_library')
      .insert(payload)
      .select('id, name, category, icon, is_global, created_by')
      .single();
    if (error) throw error;

    const workout = normalizeWorkoutLibraryRow(inserted);
    state.workoutLibrary = [...(state.workoutLibrary || []), workout];
    return workout;
  }

  async function insertDefaultUserPreferences() {
    if (!state.sb || !state.currentUser?.id) return { ...DEFAULT_USER_PREFERENCES };
    const row = {
      user_id: state.currentUser.id,
      show_workout_card: DEFAULT_USER_PREFERENCES.show_workout_card,
      show_journal_card: DEFAULT_USER_PREFERENCES.show_journal_card,
      show_weight_card: DEFAULT_USER_PREFERENCES.show_weight_card,
    };
    const { data, error } = await state.sb.from('user_preferences')
      .upsert(row, { onConflict: 'user_id' })
      .select('*')
      .single();
    if (error) return { ...DEFAULT_USER_PREFERENCES };
    return normalizeUserPreferences(data || row);
  }

  async function loadUserPreferences() {
    if (!state.sb || TEST_MODE || !state.currentUser?.id) {
      state.userPreferences = { ...DEFAULT_USER_PREFERENCES };
      return state.userPreferences;
    }
    try {
      const { data, error } = await state.sb.from('user_preferences').select('*').eq('user_id', state.currentUser.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!data) {
        state.userPreferences = await insertDefaultUserPreferences();
        return state.userPreferences;
      }
      state.userPreferences = normalizeUserPreferences(data);
      return state.userPreferences;
    } catch (err) {
      console.warn('[preferences] load failed, using defaults:', err);
      state.userPreferences = { ...DEFAULT_USER_PREFERENCES };
      return state.userPreferences;
    }
  }

  async function saveUserPreference(key, value) {
    const prevPreferences = { ...state.userPreferences };
    const nextPreferences = { ...state.userPreferences, [key]: value };
    state.userPreferences = nextPreferences;

    if (TEST_MODE) return;
    if (!state.sb || !state.currentUser?.id) {
      state.userPreferences = prevPreferences;
      throw new Error('Supabase client not available');
    }

    try {
      const payload = { user_id: state.currentUser.id, [key]: value };
      const { data, error } = await state.sb.from('user_preferences')
        .upsert(payload, { onConflict: 'user_id' })
        .select('show_workout_card, show_journal_card, show_weight_card')
        .single();
      if (error) throw error;

      if (data) {
        state.userPreferences = normalizeUserPreferences(data);
      }
    } catch (error) {
      state.userPreferences = prevPreferences;
      throw error;
    }
  }

  return {
    readCachedJSON,
    writeCachedJSON,
    removeCachedValue,
    getWelcomeState,
    hasPendingWelcome,
    hasDismissedWelcome,
    markWelcomePending,
    markWelcomeDismissed,
    normalizeUserPreferences,
    normalizeWorkoutLibraryRow,
    migrateLegacyCacheKeys,
    loadData,
    loadWorkoutLibrary,
    loadUserRotation,
    saveData,
    saveUserRotation,
    saveCustomWorkout,
    insertDefaultUserPreferences,
    loadUserPreferences,
    saveUserPreference,
  };
};
