window.HabitsApp = window.HabitsApp || {};

window.HabitsApp.registerStatsModule = function registerStatsModule(ctx) {
  const { WORKOUTS } = ctx.constants;
  const state = ctx.state;
  const utils = ctx.utils;
  const deps = ctx.deps;

  function renderWeightChart() {
    const emptyEl = document.getElementById('weight-chart-empty');
    const wrapEl = document.getElementById('weight-chart-wrap');
    const canvas = document.getElementById('weight-chart-canvas');
    const cutoffStr = deps.getStatsRangeCutoffStr();
    const rows = [...(deps.getWeightSync() || [])]
      .filter(row => !cutoffStr || row.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date));

    deps.destroyWeightChart();

    if (rows.length < 2 || typeof window.Chart === 'undefined') {
      emptyEl.hidden = false;
      wrapEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    wrapEl.hidden = false;

    const labels = rows.map(row => {
      const d = new Date(row.date + 'T00:00:00');
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });
    const rawValues = rows.map(row => row.value_lbs);
    const avg7Values = deps.computeRollingSeries(rows, rawValues);
    const trendValues = deps.computeRollingSeries(rows, avg7Values);
    const plottedValues = [...rawValues, ...avg7Values, ...trendValues].filter(value => Number.isFinite(value));
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

    state.weightChart = new window.Chart(canvas, {
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

  function renderStatsView(currentData) {
    const container = document.getElementById('stats-content');
    const history = currentData.history || [];
    const NON_WORKOUT_TYPES = new Set(['off']);
    const realWorkouts = history.filter(entry => !NON_WORKOUT_TYPES.has(entry.type));

    const today = utils.todayStr();
    const cutoffStr = deps.getStatsRangeCutoffStr();
    const rangeEntries = cutoffStr
      ? realWorkouts.filter(entry => entry.date >= cutoffStr)
      : realWorkouts.slice();

    if (realWorkouts.length === 0) {
      container.innerHTML = '<div class="stats-empty">No data yet.</div>';
      document.getElementById('view-stats').appendChild(document.getElementById('weight-chart-section'));
      renderWeightChart();
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    const totalWorkouts = rangeEntries.length;
    const workoutDates = new Set(realWorkouts.map(entry => entry.date));

    function computeCurrentStreak() {
      const cursor = new Date();
      if (!workoutDates.has(utils.todayStr())) cursor.setDate(cursor.getDate() - 1);
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

    function computeLongestStreak() {
      if (workoutDates.size === 0) return 0;
      const sorted = Array.from(workoutDates).sort();
      function toUtcDay(dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        return Date.UTC(y, m - 1, d);
      }
      let best = 1;
      let run = 1;
      for (let i = 1; i < sorted.length; i++) {
        const diff = (toUtcDay(sorted[i]) - toUtcDay(sorted[i - 1])) / 86400000;
        if (diff === 1) {
          run++;
          best = Math.max(best, run);
        } else {
          run = 1;
        }
      }
      return best;
    }

    const currentStreak = computeCurrentStreak();
    const longestStreak = computeLongestStreak();
    const distinctDays = new Set(rangeEntries.map(entry => entry.date)).size;
    let denominator;
    const statsRangeDays = deps.getStatsRangeDays();
    if (statsRangeDays) {
      denominator = statsRangeDays;
    } else {
      const allDates = realWorkouts.map(entry => entry.date).sort();
      const first = new Date(allDates[0] + 'T00:00:00');
      const todayDate = new Date(today + 'T00:00:00');
      denominator = Math.round((todayDate - first) / 86400000) + 1;
    }
    const consistencyPct = Math.round((distinctDays / denominator) * 100);

    const ROTATION_TYPE_IDS = new Set(['peloton', 'upper_push', 'upper_pull', 'lower', 'yoga']);
    const typeOrder = ['peloton', 'upper_push', 'upper_pull', 'lower', 'yoga'];
    const typeCounts = {};
    typeOrder.forEach(id => { typeCounts[id] = 0; });
    rangeEntries.forEach(entry => {
      if (typeCounts[entry.type] !== undefined) typeCounts[entry.type]++;
    });

    const otherEntries = rangeEntries
      .filter(entry => !ROTATION_TYPE_IDS.has(entry.type))
      .sort((a, b) => b.date.localeCompare(a.date));
    const otherCount = otherEntries.length;
    const maxCount = Math.max(...Object.values(typeCounts), otherCount, 1);

    const STAT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function fmtDate(dateStr) {
      const [, m, d] = dateStr.split('-');
      return `${STAT_MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
    }

    const otherPct = maxCount > 0 ? Math.round((otherCount / maxCount) * 100) : 0;
    const otherRowHtml = otherCount > 0 ? `
        <div class="stats-type-row stats-other-row" id="stats-other-row" role="button" tabindex="0" aria-expanded="false">
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
          ${otherEntries.map(entry => `
            <div class="stats-other-entry">
              <span class="stats-other-date">${fmtDate(entry.date)}</span>
              <span class="stats-other-name">${utils.escapeHtml(entry.note) || 'Other activity'}</span>
            </div>
          `).join('')}
        </div>` : '';

    const html = `
        <div class="stats-section">
          <div class="stats-section-label">Total Workouts</div>
          <div class="stats-card">
            <div class="stats-big-number">${totalWorkouts}</div>
            <div class="stats-big-label">${state.statsRange === '7' ? 'in the last 7 days' : state.statsRange === '30' ? 'in the last 30 days' : 'all time'}</div>
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
              const workout = WORKOUTS.find(x => x.id === id);
              const count = typeCounts[id];
              const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
              const lastDone = utils.lastDoneBadge(currentData[workout.id] ? utils.daysSince(currentData[workout.id]) : null);
              const lastDoneHtml = lastDone.doneToday
                ? `${lastDone.text}<i data-lucide="check" class="last-done-pill-icon"></i>`
                : lastDone.text;
              return `
                <div class="stats-type-row">
                  <i data-lucide="${workout.icon}" class="stats-type-icon"></i>
                  <div class="stats-type-info">
                    <div class="stats-type-name">${workout.name}</div>
                    <div class="stats-type-last-done last-done-pill ${lastDone.className}">
                      ${lastDoneHtml}
                    </div>
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
    document.getElementById('view-stats').appendChild(document.getElementById('weight-chart-section'));
    renderWeightChart();
    if (typeof lucide !== 'undefined') lucide.createIcons();

    if (otherCount > 0) {
      const otherRow = document.getElementById('stats-other-row');
      const otherList = document.getElementById('stats-other-list');
      const chevron = otherRow.querySelector('.stats-other-chevron');
      const toggleOtherList = () => {
        const nowExpanded = otherList.hidden;
        otherList.hidden = !nowExpanded;
        otherRow.setAttribute('aria-expanded', String(nowExpanded));
        chevron.setAttribute('data-lucide', nowExpanded ? 'chevron-up' : 'chevron-down');
        if (typeof lucide !== 'undefined') lucide.createIcons();
      };
      otherRow.addEventListener('click', toggleOtherList);
      otherRow.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleOtherList();
        }
      });
    }
  }

  function switchStatsRange(range) {
    state.statsRange = range;
    document.getElementById('stats-btn-7').classList.toggle('active', range === '7');
    document.getElementById('stats-btn-30').classList.toggle('active', range === '30');
    document.getElementById('stats-btn-all').classList.toggle('active', range === 'all');
    if (state.cachedData) renderStatsView(state.cachedData);
  }

  function bindEvents() {
    document.getElementById('stats-btn-7').onclick = () => switchStatsRange('7');
    document.getElementById('stats-btn-30').onclick = () => switchStatsRange('30');
    document.getElementById('stats-btn-all').onclick = () => switchStatsRange('all');
  }

  return {
    bindEvents,
    renderWeightChart,
    renderStatsView,
    switchStatsRange,
  };
};
