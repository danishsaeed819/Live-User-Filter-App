(function () {
  "use strict";

  const DEBOUNCE_MS = 180;
  const ROLES = ["All", "Designer", "Engineer", "Product", "Support"];
  const STATUSES = ["All", "active", "away", "offline"];
  const COUNTRIES = ["All", ...[...new Set(USERS.map((u) => u.country))].sort()];

  const SEARCH_INDEX = USERS.map((user) => ({
    user,
    haystack: `${user.name} ${user.role} ${user.city} ${user.country} ${user.email}`.toLowerCase(),
  }));

  const state = {
    query: "",
    role: "All",
    status: "All",
    country: "All",
    filtered: [],
    focusedIndex: -1,
    isDebouncing: false,
    lastRenderedKey: "",
  };

  const dom = {
    search: document.getElementById("search"),
    clearSearch: document.getElementById("clear-search"),
    roleFilters: document.getElementById("role-filters"),
    statusFilters: document.getElementById("status-filters"),
    countryFilters: document.getElementById("country-filters"),
    userList: document.getElementById("user-list"),
    emptyState: document.getElementById("empty-state"),
    resultCount: document.getElementById("result-count"),
    debounceIndicator: document.getElementById("debounce-indicator"),
    perfIndicator: document.getElementById("perf-indicator"),
    resetBtn: document.getElementById("reset-btn"),
    teamCount: document.getElementById("team-count"),
  };

  const rowCache = new Map();
  let debounceTimer = null;
  let renderFrame = null;

  function debounce(fn, ms) {
    return function (...args) {
      clearTimeout(debounceTimer);
      state.isDebouncing = true;
      updateDebounceUI();
      debounceTimer = setTimeout(() => {
        state.isDebouncing = false;
        updateDebounceUI();
        fn.apply(this, args);
      }, ms);
    };
  }

  function normalize(str) {
    return str.toLowerCase().trim();
  }

  function getInitials(name) {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  function hashHue(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query);
    if (idx === -1) return escapeHtml(text);
    const before = escapeHtml(text.slice(0, idx));
    const match = escapeHtml(text.slice(idx, idx + query.length));
    const after = escapeHtml(text.slice(idx + query.length));
    return `${before}<mark class="highlight">${match}</mark>${after}`;
  }

  function matchesQuery(haystack, query) {
    return !query || haystack.includes(query);
  }

  function filterUsers() {
    const query = normalize(state.query);
    return SEARCH_INDEX
      .filter(({ user, haystack }) => {
        if (state.role !== "All" && user.role !== state.role) return false;
        if (state.status !== "All" && user.status !== state.status) return false;
        if (state.country !== "All" && user.country !== state.country) return false;
        return matchesQuery(haystack, query);
      })
      .map(({ user }) => user);
  }

  function buildCardHTML(user, query) {
    const hue = hashHue(user.name);
    const statusLabel = user.status.charAt(0).toUpperCase() + user.status.slice(1);
    const location = `${user.city}, ${user.country}`;

    return `
      <div class="user-card__avatar" style="--avatar-hue: ${hue}">${getInitials(user.name)}</div>
      <div class="user-card__body">
        <div class="user-card__top">
          <span class="user-card__name">${highlightText(user.name, query)}</span>
          <span class="user-card__status user-card__status--${user.status}">${statusLabel}</span>
        </div>
        <div class="user-card__meta">
          <span class="user-card__role user-card__role--${user.role.toLowerCase()}">${highlightText(user.role, query)}</span>
          <span class="user-card__dot" aria-hidden="true">·</span>
          <span class="user-card__city">${highlightText(location, query)}</span>
        </div>
        <span class="user-card__email">${highlightText(user.email, query)}</span>
      </div>
    `;
  }

  function createUserRow(user) {
    const li = document.createElement("li");
    li.className = "user-card";
    li.dataset.id = user.id;
    li.dataset.role = user.role;
    li.tabIndex = 0;
    li.setAttribute("role", "listitem");
    return li;
  }

  function updateRowContent(row, user) {
    row.innerHTML = buildCardHTML(user, normalize(state.query));
  }

  function getOrCreateRow(user) {
    let row = rowCache.get(user.id);
    if (!row) {
      row = createUserRow(user);
      rowCache.set(user.id, row);
    }
    updateRowContent(row, user);
    return row;
  }

  function getRenderKey(filtered) {
    const query = normalize(state.query);
    return `${query}|${state.role}|${state.status}|${state.country}|${filtered.map((u) => u.id).join(",")}`;
  }

  function updateResultUI(filtered) {
    const hasResults = filtered.length > 0;
    dom.emptyState.hidden = hasResults;
    dom.userList.hidden = !hasResults;
    dom.clearSearch.hidden = !state.query;

    const allShowing =
      filtered.length === USERS.length &&
      !state.query &&
      state.role === "All" &&
      state.status === "All" &&
      state.country === "All";

    dom.resultCount.textContent = allShowing
      ? `Showing all ${USERS.length} users`
      : `${filtered.length} of ${USERS.length} users`;
  }

  function renderList() {
    const start = performance.now();
    const { filtered } = state;
    const renderKey = getRenderKey(filtered);

    if (renderKey === state.lastRenderedKey) {
      filtered.forEach((user, index) => {
        const row = rowCache.get(user.id);
        if (row) row.classList.toggle("user-card--focused", index === state.focusedIndex);
      });
      updateResultUI(filtered);
      return;
    }

    state.lastRenderedKey = renderKey;
    const fragment = document.createDocumentFragment();

    filtered.forEach((user, index) => {
      const row = getOrCreateRow(user);
      row.classList.toggle("user-card--focused", index === state.focusedIndex);
      row.style.animationDelay = `${Math.min(index, 12) * 25}ms`;
      row.classList.remove("user-card--no-animate");
      fragment.appendChild(row);
    });

    dom.userList.replaceChildren(fragment);
    updateResultUI(filtered);

    const ms = (performance.now() - start).toFixed(1);
    dom.perfIndicator.textContent = `Updated in ${ms}ms`;
  }

  function scheduleRender() {
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderFrame = null;
      renderList();
    });
  }

  function syncFiltered() {
    state.filtered = filterUsers();
    if (state.focusedIndex >= state.filtered.length) {
      state.focusedIndex = state.filtered.length - 1;
    }
  }

  function applyFiltersInstant() {
    syncFiltered();
    state.lastRenderedKey = "";
    updateResultUI(state.filtered);
    scheduleRender();
  }

  const debouncedRender = debounce(() => {
    syncFiltered();
    state.lastRenderedKey = "";
    scheduleRender();
  }, DEBOUNCE_MS);

  function updateDebounceUI() {
    dom.debounceIndicator.textContent = state.isDebouncing ? "Filtering…" : "";
    dom.debounceIndicator.classList.toggle("stats-bar__debounce--active", state.isDebouncing);
  }

  function buildChips(container, options, groupKey) {
    options.forEach((value) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = value === "All" ? "All" : value.charAt(0).toUpperCase() + value.slice(1);
      btn.dataset.value = value;
      btn.setAttribute("aria-pressed", value === "All" ? "true" : "false");

      if (value !== "All" && groupKey === "status") btn.classList.add(`chip--${value}`);
      if (value !== "All" && groupKey === "role") btn.classList.add(`chip--role-${value.toLowerCase()}`);

      btn.addEventListener("click", () => {
        state[groupKey] = value;
        container.querySelectorAll(".chip").forEach((chip) => {
          chip.setAttribute("aria-pressed", chip.dataset.value === value ? "true" : "false");
        });
        state.focusedIndex = -1;
        state.lastRenderedKey = "";
        applyFiltersInstant();
      });

      container.appendChild(btn);
    });
  }

  function resetAll() {
    state.query = "";
    state.role = "All";
    state.status = "All";
    state.country = "All";
    state.focusedIndex = -1;
    state.lastRenderedKey = "";
    dom.search.value = "";

    [dom.roleFilters, dom.statusFilters, dom.countryFilters].forEach((container) => {
      container.querySelectorAll(".chip").forEach((chip) => {
        chip.setAttribute("aria-pressed", chip.dataset.value === "All" ? "true" : "false");
      });
    });

    applyFiltersInstant();
    dom.search.focus();
  }

  function focusRow(index) {
    if (state.filtered.length === 0) return;
    const clamped = Math.max(0, Math.min(index, state.filtered.length - 1));
    state.focusedIndex = clamped;
    scheduleRender();

    const row = dom.userList.children[clamped];
    if (row) {
      row.focus();
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function handleKeydown(e) {
    if (e.key === "/" && document.activeElement !== dom.search) {
      e.preventDefault();
      dom.search.focus();
      return;
    }

    if (e.key === "Escape") {
      if (dom.search.value || state.role !== "All" || state.status !== "All" || state.country !== "All") {
        e.preventDefault();
        resetAll();
      }
      return;
    }

    if (document.activeElement === dom.search) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(state.focusedIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(state.focusedIndex - 1);
    }
  }

  function init() {
    buildChips(dom.roleFilters, ROLES, "role");
    buildChips(dom.statusFilters, STATUSES, "status");
    buildChips(dom.countryFilters, COUNTRIES, "country");

    dom.search.addEventListener("input", (e) => {
      state.query = e.target.value;
      state.focusedIndex = -1;
      syncFiltered();
      updateResultUI(state.filtered);
      debouncedRender();
    });

    dom.clearSearch.addEventListener("click", () => {
      state.query = "";
      dom.search.value = "";
      state.focusedIndex = -1;
      state.lastRenderedKey = "";
      applyFiltersInstant();
      dom.search.focus();
    });

    dom.resetBtn.addEventListener("click", resetAll);
    document.addEventListener("keydown", handleKeydown);

    dom.userList.addEventListener("focusin", (e) => {
      const card = e.target.closest(".user-card");
      if (!card) return;
      const index = state.filtered.findIndex((u) => String(u.id) === card.dataset.id);
      if (index !== -1) state.focusedIndex = index;
    });

    dom.teamCount.textContent = `${USERS.length} members · ${COUNTRIES.length - 1} countries`;
    applyFiltersInstant();
  }

  init();
})();
