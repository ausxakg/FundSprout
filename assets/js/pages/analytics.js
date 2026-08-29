/* ==========================================================================
   FundSprout — Analytics Page
   ========================================================================== */

const AnalyticsPage = {
  range: 'monthly',
  trendChart: null,
  distributionChart: null,

  init() {
    document.querySelectorAll('#page-analytics .pill-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#page-analytics .pill-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.range = tab.dataset.range;
        this.render();
      });
    });
    this.render();
  },

  chartColors() {
    const style = getComputedStyle(document.documentElement);
    return {
      text: style.getPropertyValue('--text-secondary').trim() || '#94A3B8',
      grid: style.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.08)',
      green: '#22C55E',
      blue: '#3B82F6',
      red: '#EF4444',
      yellow: '#FBBF24'
    };
  },

  bucketData() {
    const range = this.range;
    const allowances = DB.data.allowances.filter((a) => !a.planned && Utils.inRange(a.date, range));
    const expenses = DB.data.expenses.filter((e) => Utils.inRange(e.date, range));

    // Build date buckets
    let labels = [];
    let keyFn;
    const todayISO = Utils.todayISO();
    const [todayYear, todayMonth] = todayISO.split('-').map(Number);
    if (range === 'daily') {
      labels = Array.from({ length: 24 }, (_, h) => `${h}:00`);
      keyFn = (time) => `${parseInt((time || '00:00').split(':')[0], 10)}:00`;
    } else if (range === 'weekly') {
      const start = Utils.startOfWeek();
      labels = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setUTCDate(start.getUTCDate() + i);
        return d.toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short' });
      });
      keyFn = (date) => {
        const d = Utils._dateFromISO(date);
        return d.toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short' });
      };
    } else if (range === 'monthly') {
      const daysInMonth = new Date(Date.UTC(todayYear, todayMonth, 0)).getUTCDate();
      labels = Array.from({ length: daysInMonth }, (_, i) => `${i + 1}`);
      keyFn = (date) => String(Number(date.split('-')[2]));
    } else {
      labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      keyFn = (date) => labels[Number(date.split('-')[1]) - 1];
    }

    const allowanceMap = Object.fromEntries(labels.map((l) => [l, 0]));
    const expenseMap = Object.fromEntries(labels.map((l) => [l, 0]));

    allowances.forEach((a) => {
      const k = range === 'daily' ? keyFn(a.time) : keyFn(a.date);
      if (k in allowanceMap) allowanceMap[k] += a.amount;
    });
    expenses.forEach((e) => {
      const k = range === 'daily' ? keyFn(e.time) : keyFn(e.date);
      if (k in expenseMap) expenseMap[k] += e.amount;
    });

    return {
      labels,
      allowanceSeries: labels.map((l) => Round2(allowanceMap[l])),
      expenseSeries: labels.map((l) => Round2(expenseMap[l]))
    };
  },

  render() {
    const range = this.range;
    const allowances = DB.data.allowances.filter((a) => !a.planned && Utils.inRange(a.date, range));
    const expenses = DB.data.expenses.filter((e) => Utils.inRange(e.date, range));

    const totalAllowance = allowances.reduce((s, a) => s + a.amount, 0);
    const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);
    const balance = DB.data.balance;
    const totalSaved = DB.data.plants.reduce((s, p) => s + p.saved, 0);
    const highestExpense = expenses.reduce((max, e) => Math.max(max, e.amount), 0);

    const catTotals = {};
    expenses.forEach((e) => { catTotals[e.category] = (catTotals[e.category] || 0) + e.amount; });
    const topCategory = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];

    const todayISO = Utils.todayISO();
    const [todayYear, todayMonth] = todayISO.split('-').map(Number);
    const dayCount = { daily: 1, weekly: 7, monthly: new Date(Date.UTC(todayYear, todayMonth, 0)).getUTCDate(), yearly: 365 }[range];
    const avgDaily = totalExpense / dayCount;

    document.getElementById('statTotalAllowance').textContent = Utils.formatMoney(totalAllowance);
    document.getElementById('statTotalExpense').textContent = Utils.formatMoney(totalExpense);
    document.getElementById('statBalance').textContent = Utils.formatMoney(balance);
    document.getElementById('statSaved').textContent = Utils.formatMoney(totalSaved);
    document.getElementById('statHighestExpense').textContent = Utils.formatMoney(highestExpense);
    document.getElementById('statTopCategory').textContent = topCategory ? topCategory[0] : '—';
    document.getElementById('statAvgDaily').textContent = Utils.formatMoney(avgDaily);
    document.getElementById('statTotalTx').textContent = String(allowances.length + expenses.length);

    this.renderTrendChart();
    this.renderDistributionChart(catTotals);
  },

  renderTrendChart() {
    const { labels, allowanceSeries, expenseSeries } = this.bucketData();
    const colors = this.chartColors();
    const ctx = document.getElementById('trendChart').getContext('2d');

    if (this.trendChart) this.trendChart.destroy();
    this.trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Allowance',
            data: allowanceSeries,
            borderColor: colors.blue,
            backgroundColor: 'rgba(59,130,246,0.12)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2.5
          },
          {
            label: 'Expenses',
            data: expenseSeries,
            borderColor: colors.red,
            backgroundColor: 'rgba(239,68,68,0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2.5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: DB.data.settings.animations ? { duration: 700 } : false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1A1D24', borderColor: colors.grid, borderWidth: 1,
            titleColor: '#F8FAFC', bodyColor: '#94A3B8', padding: 10, cornerRadius: 10,
            callbacks: { label: (item) => `${item.dataset.label}: ${Utils.formatMoney(item.raw)}` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: colors.text, font: { size: 11 }, maxRotation: 0, autoSkip: true } },
          y: { grid: { color: colors.grid }, ticks: { color: colors.text, font: { size: 11 }, callback: (v) => Utils.formatCompact(v) } }
        }
      }
    });
  },

  renderDistributionChart(catTotals) {
    const colors = this.chartColors();
    const ctx = document.getElementById('distributionChart').getContext('2d');
    const palette = ['#22C55E', '#3B82F6', '#FBBF24', '#EF4444', '#A78BFA', '#F472B6', '#2DD4BF', '#F97316'];
    const entries = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
    const labels = entries.map((e) => e[0]);
    const data = entries.map((e) => e[1]);

    if (this.distributionChart) this.distributionChart.destroy();

    const legendWrap = document.getElementById('distributionLegend');
    if (!entries.length) {
      legendWrap.innerHTML = `<span class="text-tertiary text-sm">No expense data for this period yet.</span>`;
    } else {
      legendWrap.innerHTML = labels.map((l, i) => `
        <span class="legend-dot"><span class="dot" style="background:${palette[i % palette.length]}"></span>${Utils.escapeHtml(l)} · ${Utils.formatMoney(data[i])}</span>
      `).join('');
    }

    this.distributionChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: data.length ? data : [1],
          backgroundColor: data.length ? palette : [colors.grid],
          borderColor: 'transparent',
          borderRadius: 6,
          spacing: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        animation: DB.data.settings.animations ? { duration: 700 } : false,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: data.length > 0,
            backgroundColor: '#1A1D24', borderColor: colors.grid, borderWidth: 1,
            titleColor: '#F8FAFC', bodyColor: '#94A3B8', padding: 10, cornerRadius: 10,
            callbacks: { label: (item) => `${item.label}: ${Utils.formatMoney(item.raw)}` }
          }
        }
      }
    });
  }
};