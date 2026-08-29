/* ==========================================================================
   FundSprout — App Shell / Router
   ========================================================================== */

const PAGES = ['dashboard', 'allowance', 'expenses', 'garden', 'analytics', 'activity', 'settings'];

const PAGE_META = {
  dashboard: { title: 'Home', sub: '' },
  allowance: { title: 'Allowance', sub: 'Record money received' },
  expenses: { title: 'Expenses', sub: 'Track your spending' },
  garden: { title: 'My Garden', sub: 'Grow your savings goals' },
  analytics: { title: 'Analytics', sub: 'Understand your money' },
  activity: { title: 'Activity Log', sub: 'Every transaction, in one place' },
  settings: { title: 'Settings', sub: 'Customize FundSprout' }
};

const App = {
  currentPage: 'dashboard',

  init() {
    this.applyTheme(DB.data.settings.theme);
    this.applyAnimations(DB.data.settings.animations);
    this.applySidebarState(DB.data.settings.sidebarCollapsed);
    this.renderGreeting();
    this.bindNav();
    this.bindGlobalActions();
    DB.subscribe((event) => this.onDataChange(event));

    if (typeof SyncManager !== 'undefined') SyncManager.init();

    Dashboard.init();
    AllowancePage.init();
    ExpensesPage.init();
    GardenPage.init();
    AnalyticsPage.init();
    ActivityPage.init();
    SettingsPage.init();

    this.goTo('dashboard');

    if (!DB.available) {
      Toast.warning('Local storage unavailable', 'Your browser is blocking local storage, so changes will not be saved after you close this tab.');
    }
  },

  onDataChange(event) {
    // Keep every page in sync automatically, per spec rule #5
    Dashboard.render();
    AllowancePage.render();
    ExpensesPage.render();
    GardenPage.render();
    AnalyticsPage.render();
    ActivityPage.render();
  },

  bindNav() {
    document.querySelectorAll('.nav-item[data-page]').forEach((el) => {
      el.addEventListener('click', () => this.goTo(el.dataset.page));
    });
    document.querySelectorAll('.bottom-nav-item[data-page]').forEach((el) => {
      el.addEventListener('click', () => this.goTo(el.dataset.page));
    });
    document.getElementById('sidebarCollapseBtn').addEventListener('click', () => {
      const collapsed = !DB.data.settings.sidebarCollapsed;
      DB.updateSettings({ sidebarCollapsed: collapsed });
      this.applySidebarState(collapsed);
    });
  },

  applySidebarState(collapsed) {
    document.getElementById('sidebar').classList.toggle('collapsed', !!collapsed);
    const icon = document.querySelector('#sidebarCollapseBtn i');
    if (icon) icon.className = collapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left';
  },

  goTo(page) {
    if (!PAGES.includes(page)) page = 'dashboard';
    this.currentPage = page;
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
    document.querySelectorAll('.nav-item[data-page]').forEach((el) => el.classList.toggle('active', el.dataset.page === page));
    document.querySelectorAll('.bottom-nav-item[data-page]').forEach((el) => el.classList.toggle('active', el.dataset.page === page));
    const meta = PAGE_META[page];
    document.getElementById('topbarTitle').textContent = page === 'dashboard' ? this.greetingTitle() : meta.title;
    document.getElementById('topbarSub').textContent = page === 'dashboard' ? this.greetingSub() : meta.sub;
    this.updateFab(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  updateFab(page) {
    const fab = document.getElementById('mainFab');
    const map = {
      allowance: { icon: 'fa-plus', action: () => AllowancePage.openCreateModal() },
      expenses: { icon: 'fa-plus', action: () => ExpensesPage.openCreateModal() },
      garden: { icon: 'fa-seedling', action: () => GardenPage.openCreateModal() }
    };
    if (map[page]) {
      fab.style.display = 'flex';
      fab.innerHTML = `<i class="fa-solid ${map[page].icon}"></i>`;
      fab.onclick = map[page].action;
    } else {
      fab.style.display = 'none';
      fab.onclick = null;
    }
  },

  greetingTitle() {
    const h = Number(Utils._parts().hour);
    const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    return `${greet} 👋`;
  },
  greetingSub() {
    return "Here's your financial snapshot for today.";
  },
  renderGreeting() {
    document.getElementById('topbarTitle').textContent = this.greetingTitle();
    document.getElementById('topbarSub').textContent = this.greetingSub();
  },

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('themeToggleIcon');
    if (icon) icon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  },

  applyAnimations(enabled) {
    document.body.classList.toggle('reduce-motion', !enabled);
  },

  bindGlobalActions() {
    document.getElementById('themeToggleBtn').addEventListener('click', () => {
      const next = DB.data.settings.theme === 'dark' ? 'light' : 'dark';
      DB.updateSettings({ theme: next });
      this.applyTheme(next);
      Toast.success('Theme changed', `Switched to ${next} mode.`);
    });

    document.getElementById('mobileMenuBtn').addEventListener('click', () => {
      ModalManager.open('mobileNavModal');
    });
    document.querySelectorAll('#mobileNavModal [data-page]').forEach((el) => {
      el.addEventListener('click', () => {
        this.goTo(el.dataset.page);
        ModalManager.close('mobileNavModal');
      });
    });

    document.getElementById('quickAddBtn').addEventListener('click', () => {
      ModalManager.open('quickAddModal');
    });
    document.querySelectorAll('#quickAddModal [data-quick-action]').forEach((el) => {
      el.addEventListener('click', () => {
        const action = el.dataset.quickAction;
        ModalManager.close('quickAddModal');
        if (action === 'budget') { setTimeout(() => Dashboard.openBudgetModal(), 120); }
        if (action === 'allowance') { this.goTo('allowance'); setTimeout(() => AllowancePage.openCreateModal(), 260); }
        if (action === 'expense') { this.goTo('expenses'); setTimeout(() => ExpensesPage.openCreateModal(), 260); }
        if (action === 'plant') { this.goTo('garden'); setTimeout(() => GardenPage.openCreateModal(), 260); }
      });
    });
  }
};

/* -------------------- Shared Empty State Renderer -------------------- */
function emptyStateHTML({ icon, title, message, actionLabel, actionAttr }) {
  return `
    <div class="empty-state">
      <div class="empty-icon"><i class="fa-solid ${icon}"></i></div>
      <h4>${title}</h4>
      <p>${message}</p>
      ${actionLabel ? `<button class="btn btn-primary btn-sm" ${actionAttr}>${actionLabel}</button>` : ''}
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', () => App.init());
