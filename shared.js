window.HabitsApp = window.HabitsApp || {};

window.HabitsApp.registerSharedModule = function registerSharedModule(ctx) {
  const { WORKOUTS, ROTATION, VERSION } = ctx.constants;
  const state = ctx.state;
  let toastTimer;
  let tapCount = 0;
  let tapTimer = null;

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
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
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

  function dateToStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function getSuggested(data) {
    const idx = (data.rotationIndex || 0) % ROTATION.length;
    return WORKOUTS.find(w => w.id === ROTATION[idx]);
  }

  function lastDoneBadge(days, options = {}) {
    const { prefixLastDone = false } = options;
    if (days === null) return { text: 'Never', className: 'is-red', doneToday: false };
    if (days === 0) return { text: 'Today', className: 'is-green', doneToday: true };
    const text = prefixLastDone ? `Last done ${days}d ago` : `${days}d ago`;
    if (days >= 8) return { text, className: 'is-red', doneToday: false };
    if (days >= 4) return { text, className: 'is-yellow', doneToday: false };
    return { text, className: 'is-green', doneToday: false };
  }

  function renderLastDonePill(el, days, options = {}) {
    if (!el) return;
    const badge = lastDoneBadge(days, options);
    el.hidden = false;
    const baseClass = el.dataset.baseClass ? `${el.dataset.baseClass} ` : '';
    el.className = `${baseClass}last-done-pill ${badge.className}`.trim();
    if (badge.doneToday) {
      el.innerHTML = '';
      el.appendChild(document.createTextNode(badge.text));
      const icon = document.createElement('i');
      icon.setAttribute('data-lucide', 'check');
      icon.className = 'last-done-pill-icon';
      el.appendChild(icon);
    } else {
      el.textContent = badge.text;
    }
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function getUserEmail() {
    return state.currentUser?.email || '';
  }

  function getUserMetadata() {
    return state.currentUser?.user_metadata || {};
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

  function hasSavedProfileName(meta = getUserMetadata()) {
    return !!((meta.first_name || '').trim() || (meta.last_name || '').trim());
  }

  function setProfileEditing(isEditing) {
    state.settingsProfileEditing = isEditing;
    ['settings-first-name', 'settings-last-name'].forEach(id => {
      const input = document.getElementById(id);
      if (!input) return;
      input.readOnly = !isEditing;
      input.classList.toggle('is-readonly', !isEditing);
    });
    const saveBtn = document.getElementById('save-profile-btn');
    if (saveBtn) {
      saveBtn.textContent = isEditing ? 'Save profile' : 'Edit profile';
    }
  }

  function setButtonsDisabled(disabled) {
    ['main-done-btn', 'log-other-btn', 'undo-btn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
    document.querySelectorAll('.row-done-btn').forEach(el => {
      el.disabled = disabled;
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function updateSyncStamp() {
    let status = '';
    if (state.syncOffline) {
      status = 'offline';
    } else if (state.lastSyncedAt !== null) {
      const secsAgo = Math.floor((Date.now() - state.lastSyncedAt) / 1000);
      status = secsAgo < 60 ? 'synced just now' : `synced ${Math.floor(secsAgo / 60)}m ago`;
    }
    const stamp = status ? `v${VERSION} · ${status}` : `v${VERSION}`;
    document.getElementById('version-stamp').textContent = stamp;
    document.getElementById('settings-version-stamp').textContent = stamp;
    document.getElementById('login-version-stamp').textContent = `v${VERSION}`;
    document.getElementById('signup-version-stamp').textContent = `v${VERSION}`;
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

  function bindTestModeTapTrigger(el) {
    el.addEventListener('click', () => {
      tapCount++;
      if (tapCount === 3) {
        tapCount = 0;
        clearTimeout(tapTimer);
        toggleTestMode();
        return;
      }
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 600);
    });
  }

  return {
    todayStr,
    isValidISODate,
    getYesterdayStr,
    daysSince,
    dateToStr,
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
  };
};
