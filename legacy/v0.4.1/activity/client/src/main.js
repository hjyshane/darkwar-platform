import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./styles.css";

const state = {
  publicConfig: null,
  discordSdk: null,
  auth: null,
  accessToken: null,
  session: null,
  activeTab: "overview",
  loading: true,
  error: null,
  devBypass: false,
  overview: null,
  arena: null,
  rankings: null,
  alliances: null,
  allianceDetail: null,
  players: null,
  playerDetail: null,
  refresh: null,
  filters: {
    arenaServer: "",
    rankingServer: "",
    allianceQuery: "",
    allianceServer: "",
    playerQuery: "",
  },
};

const app = document.querySelector("#app");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatInteger(value) {
  const parsed = number(value);
  return parsed === null ? "—" : Math.round(parsed).toLocaleString();
}

function formatPower(value) {
  const parsed = number(value);
  if (parsed === null) return "—";
  const absolute = Math.abs(parsed);
  if (absolute >= 1_000_000_000) return `${(parsed / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${(parsed / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(parsed / 1_000).toFixed(1)}K`;
  return Math.round(parsed).toLocaleString();
}

function formatDelta(value, formatter = formatPower) {
  const parsed = number(value);
  if (parsed === null) return "—";
  if (parsed === 0) return "0";
  return `${parsed > 0 ? "+" : ""}${formatter(parsed)}`;
}

function formatDate(value, includeTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

function relativeTime(value) {
  if (!value) return "never";
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (absolute < 60) return formatter.format(seconds, "second");
  if (absolute < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (absolute < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  return formatter.format(Math.round(seconds / 86400), "day");
}

function badge(text, tone = "neutral") {
  return `<span class="badge badge-${tone}">${escapeHtml(text)}</span>`;
}

function statusBadge(status) {
  const normalized = String(status || "unknown");
  const tone = {
    completed: "good",
    current: "good",
    running: "info",
    queued: "info",
    waiting_idle: "warn",
    waiting_setup: "warn",
    partial: "warn",
    failed: "bad",
    cancelled: "neutral",
    stale: "bad",
  }[normalized] || "neutral";
  return badge(normalized.replaceAll("_", " "), tone);
}

function metric(label, value, detail = "") {
  return `
    <article class="metric">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      ${detail ? `<div class="metric-detail">${escapeHtml(detail)}</div>` : ""}
    </article>`;
}

function emptyState(title, detail) {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`;
}

async function publicFetch(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.devBypass) {
    headers.set("X-DarkWar-Dev-Bypass", "1");
  } else if (state.accessToken) {
    headers.set("Authorization", `Bearer ${state.accessToken}`);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

function withTimeout(promise, milliseconds, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds)),
  ]);
}

async function authenticate() {
  state.publicConfig = await publicFetch("/api/activity/config");
  const clientId = state.publicConfig.client_id;
  if (!clientId) {
    if (state.publicConfig.dev_bypass) {
      state.devBypass = true;
      state.session = await apiFetch("/api/session");
      return;
    }
    throw new Error("DISCORD_CLIENT_ID is not configured on the Activity server.");
  }

  try {
    const discordSdk = new DiscordSDK(clientId);
    state.discordSdk = discordSdk;
    await withTimeout(discordSdk.ready(), 10_000, "Discord SDK did not become ready.");
    const { code } = await discordSdk.commands.authorize({
      client_id: clientId,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify"],
    });
    const token = await publicFetch("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    state.accessToken = token.access_token;
    state.auth = await discordSdk.commands.authenticate({
      access_token: state.accessToken,
    });
    if (!state.auth) throw new Error("Discord authenticate returned no session.");
    state.session = await apiFetch("/api/session");
  } catch (error) {
    if (state.publicConfig.dev_bypass) {
      state.devBypass = true;
      state.session = await apiFetch("/api/session");
      return;
    }
    throw error;
  }
}

async function loadOverview() {
  state.overview = await apiFetch("/api/overview");
}

async function loadArena() {
  const params = new URLSearchParams({ limit: "100" });
  if (state.filters.arenaServer) params.set("server_id", state.filters.arenaServer);
  state.arena = await apiFetch(`/api/arena?${params}`);
}

async function loadRankings() {
  const params = new URLSearchParams({ limit: "100" });
  if (state.filters.rankingServer) params.set("server_id", state.filters.rankingServer);
  state.rankings = await apiFetch(`/api/rankings?${params}`);
}

async function loadAlliances() {
  const params = new URLSearchParams({ limit: "100" });
  if (state.filters.allianceQuery) params.set("query", state.filters.allianceQuery);
  if (state.filters.allianceServer) params.set("server_id", state.filters.allianceServer);
  state.alliances = await apiFetch(`/api/alliances?${params}`);
}

async function loadAlliance(code) {
  state.allianceDetail = await apiFetch(`/api/alliance/${encodeURIComponent(code)}`);
}

async function loadPlayers() {
  const params = new URLSearchParams({ limit: "100", query: state.filters.playerQuery });
  state.players = await apiFetch(`/api/players?${params}`);
}

async function loadPlayer(uid) {
  state.playerDetail = await apiFetch(`/api/player/${encodeURIComponent(uid)}`);
}

async function loadRefresh() {
  state.refresh = await apiFetch("/api/refresh/jobs?limit=50");
}

async function loadTab(tab = state.activeTab) {
  state.error = null;
  if (tab === "overview") await loadOverview();
  if (tab === "arena") await loadArena();
  if (tab === "rankings") await loadRankings();
  if (tab === "alliances") await loadAlliances();
  if (tab === "players") await loadPlayers();
  if (tab === "refresh") await loadRefresh();
}

function renderShell(content) {
  const userName = state.session?.global_name || state.session?.username || "Discord user";
  const role = state.session?.is_admin ? "Admin" : "Viewer";
  const tabs = [
    ["overview", "Overview"],
    ["arena", "Arena"],
    ["rankings", "Rankings"],
    ["alliances", "Alliances"],
    ["players", "Players"],
    ["refresh", "Refresh"],
  ];
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <div class="eyebrow">SERVER 580 INTELLIGENCE</div>
          <h1>DarkWar Command Center</h1>
        </div>
        <div class="user-chip">
          <span class="status-dot"></span>
          <span>${escapeHtml(userName)}</span>
          ${badge(role, state.session?.is_admin ? "good" : "neutral")}
        </div>
      </header>
      <nav class="tabs" aria-label="Dashboard sections">
        ${tabs.map(([id, label]) => `<button class="tab ${state.activeTab === id ? "active" : ""}" data-tab="${id}">${label}</button>`).join("")}
      </nav>
      ${state.error ? `<div class="alert alert-error">${escapeHtml(state.error)}</div>` : ""}
      <main class="content">${content}</main>
      <footer>
        <span>DarkWar Tracker v0.4.0</span>
        <button class="link-button" data-action="reload-tab">Refresh data</button>
      </footer>
    </div>`;
  wireShell();
}

function wireShell() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.activeTab = button.dataset.tab;
      state.error = null;
      renderCurrentTab(true);
      try {
        await loadTab();
      } catch (error) {
        state.error = error.message;
      }
      renderCurrentTab();
    });
  });
  document.querySelector("[data-action='reload-tab']")?.addEventListener("click", async () => {
    try {
      await loadTab();
      state.error = null;
    } catch (error) {
      state.error = error.message;
    }
    renderCurrentTab();
  });
}

function renderLoading(message = "Loading data…") {
  return `<div class="loading-panel"><div class="spinner"></div><span>${escapeHtml(message)}</span></div>`;
}

function renderOverview() {
  const data = state.overview;
  if (!data) return renderLoading();
  const fresh = data.freshness || {};
  const freshnessCards = Object.values(fresh).map((item) => {
    const coverage = item.coverage_total !== null && item.coverage_total !== undefined
      ? `${item.coverage_current}/${item.coverage_total}`
      : null;
    return `
      <article class="status-card">
        <div class="status-card-head">
          <strong>${escapeHtml(item.label)}</strong>
          ${badge(item.current ? "Current" : "Stale", item.current ? "good" : "bad")}
        </div>
        <div class="status-time">${item.latest_at ? formatDate(item.latest_at) : "No snapshot"}</div>
        <div class="status-detail">${coverage ? `Coverage ${coverage}` : escapeHtml(item.detail || "Weekly baseline")}</div>
      </article>`;
  }).join("");

  const arena = data.arena_match;
  const own = data.own_alliance;
  const activeJobs = (data.jobs || []).filter((job) => ["queued", "waiting_idle", "running", "waiting_setup", "partial"].includes(job.status));
  const changes = data.changes || [];
  return `
    <section class="metric-grid">
      ${metric("Known players", formatInteger(data.totals.players), "Across captured sources")}
      ${metric("Known alliances", formatInteger(data.totals.alliances), "Ranking and member data")}
      ${metric("Member snapshots", formatInteger(data.totals.member_snapshots), own ? `[${own.code}] latest ${relativeTime(own.captured_at)}` : "No own alliance")}
      ${metric("Pending refresh", formatInteger(activeJobs.length), activeJobs[0] ? activeJobs[0].status.replaceAll("_", " ") : "Queue clear")}
    </section>

    <section class="section">
      <div class="section-heading">
        <div><div class="eyebrow">WEEKLY BASELINE</div><h2>Refresh coverage</h2></div>
        <div class="muted">Reset ${formatDate(data.week.reset_at)} · scheduled ${formatDate(data.week.scheduled_at)}</div>
      </div>
      <div class="status-grid">${freshnessCards}</div>
    </section>

    <section class="split-grid">
      <article class="panel">
        <div class="panel-heading"><h2>Arena matchup</h2><button class="link-button" data-go="arena">Open arena</button></div>
        ${arena ? `
          <div class="versus"><span>S${escapeHtml(arena.base_server)}</span><b>VS</b><span>${escapeHtml(arena.opponent_servers || "?")}</span></div>
          <div class="compact-grid">
            <div><span>Top entries</span><strong>${formatInteger(arena.player_count)}</strong></div>
            <div><span>Own defense</span><strong>${formatPower(arena.own_defense_power)}</strong></div>
            <div><span>Last capture</span><strong>${formatDate(arena.captured_at)}</strong></div>
          </div>` : emptyState("No arena snapshot", "Open or reconnect the game after weekly reset.")}
      </article>
      <article class="panel">
        <div class="panel-heading"><h2>Own alliance</h2><button class="link-button" data-alliance="${escapeHtml(own?.code || "")}">Open roster</button></div>
        ${own ? `
          <div class="alliance-title"><strong>[${escapeHtml(own.code)}]</strong><span>${escapeHtml(own.full_name || "")}</span></div>
          <div class="compact-grid">
            <div><span>Members</span><strong>${formatInteger(own.member_count)}</strong></div>
            <div><span>Alliance power</span><strong>${formatPower(own.latest_fight_power)}</strong></div>
            <div><span>Snapshot</span><strong>${relativeTime(own.captured_at)}</strong></div>
          </div>` : emptyState("Own alliance unresolved", "Set activity.own_alliance_code in config.toml.")}
      </article>
    </section>

    <section class="section">
      <div class="section-heading"><div><div class="eyebrow">RECENT ACTIVITY</div><h2>Roster changes</h2></div></div>
      ${changes.length ? `<div class="event-list">${changes.map((event) => `
        <div class="event-row">
          <div>${badge(`[${event.alliance_code}]`, "neutral")} <strong>${escapeHtml(event.player_name || event.player_uid)}</strong></div>
          <div class="event-type">${escapeHtml(event.event_type.replaceAll("_", " "))}${event.numeric_delta !== null ? ` · ${formatDelta(event.numeric_delta, formatInteger)}` : ""}</div>
          <time>${relativeTime(event.detected_at)}</time>
        </div>`).join("")}</div>` : emptyState("No detected changes", "Changes appear after two or more member snapshots.")}
    </section>`;
}

function renderArena() {
  const data = state.arena;
  if (!data) return renderLoading();
  if (!data.match) return emptyState("No arena match", "No user.get.arena.info response has been stored.");
  const entries = data.entries || [];
  return `
    <section class="section">
      <div class="section-heading">
        <div><div class="eyebrow">WEEKLY ARENA</div><h2>S${escapeHtml(data.match.base_server)} vs ${escapeHtml(data.match.opponent_servers || "?")}</h2></div>
        <div class="filter-row">
          <label>Server<select id="arena-server-filter"><option value="">All</option>${(data.servers || []).map((row) => `<option value="${row.server_id}" ${String(row.server_id) === state.filters.arenaServer ? "selected" : ""}>S${row.server_id}</option>`).join("")}</select></label>
        </div>
      </div>
      <section class="metric-grid small">
        ${metric("Snapshot", formatDate(data.snapshot?.captured_at), data.snapshot ? relativeTime(data.snapshot.captured_at) : "")}
        ${metric("Players", formatInteger(data.snapshot?.player_count), "Top list returned")}
        ${metric("Own defense", formatPower(data.snapshot?.own_defense_power), "Arena defense power")}
        ${metric("Storm cutoff", formatInteger(data.snapshot?.storm_lowest_rank), "Lowest qualifying rank")}
      </section>
      <div class="server-grid">${(data.servers || []).map((row) => `
        <article class="server-card"><strong>S${row.server_id}</strong><span>${row.player_count} entries · ${row.top10_count} top 10</span><small>Avg ${formatPower(row.average_power)} · Max ${formatPower(row.max_power)}</small></article>`).join("")}</div>
      ${entries.length ? renderTable([
        ["#", (r) => formatInteger(r.arena_rank)],
        ["Player", (r) => `<button class="table-link" data-player="${escapeHtml(r.player_uid)}">${escapeHtml(r.player_name || r.player_uid)}</button><small>S${escapeHtml(r.server_id)} · ${r.alliance_code ? `[${escapeHtml(r.alliance_code)}]` : "No alliance"}</small>`],
        ["Score", (r) => `${formatInteger(r.score)}<small>${r.score_change !== null ? formatDelta(r.score_change, formatInteger) : ""}</small>`],
        ["Defense", (r) => `${formatPower(r.power)}<small>${r.power_change !== null ? formatDelta(r.power_change) : ""}</small>`],
        ["Rank Δ", (r) => formatDelta(r.rank_change, formatInteger)],
      ], entries) : emptyState("No entries", "The selected server is not present in this snapshot.")}
    </section>
    <section class="section">
      <div class="section-heading"><h2>Alliance representation</h2></div>
      <div class="chip-grid">${(data.alliances || []).map((row) => `<button class="alliance-chip" data-alliance="${escapeHtml(row.alliance_code)}"><strong>[${escapeHtml(row.alliance_code)}]</strong><span>S${row.server_id} · ${row.player_count} players · best #${row.best_rank}</span></button>`).join("")}</div>
    </section>`;
}

function renderRankings() {
  const data = state.rankings;
  if (!data) return renderLoading();
  return `
    <section class="section">
      <div class="section-heading">
        <div><div class="eyebrow">CROSS-SERVER</div><h2>Rankings</h2></div>
        <label>Server<select id="ranking-server-filter"><option value="">All</option>${[577,578,579,580,581,582,583,584].map((id) => `<option value="${id}" ${String(id) === state.filters.rankingServer ? "selected" : ""}>S${id}</option>`).join("")}</select></label>
      </div>
      <div class="split-grid tables">
        <article class="panel">
          <div class="panel-heading"><h2>Players</h2><span class="muted">${formatDate(data.player_snapshot?.captured_at)}</span></div>
          ${(data.players || []).length ? renderTable([
            ["#", (r) => formatInteger(r.cross_server_rank)],
            ["Player", (r) => `<button class="table-link" data-player="${escapeHtml(r.player_uid)}">${escapeHtml(r.player_name || r.player_uid)}</button><small>S${r.server_id} · ${r.alliance_code ? `[${escapeHtml(r.alliance_code)}]` : "—"}</small>`],
            ["Power", (r) => formatPower(r.power)],
            ["HQ", (r) => formatInteger(r.hq_level)],
          ], data.players) : emptyState("No player ranking", "Open the cross-server player ranking in game.")}
        </article>
        <article class="panel">
          <div class="panel-heading"><h2>Alliances</h2><span class="muted">${formatDate(data.alliance_snapshot?.captured_at)}</span></div>
          ${(data.alliances || []).length ? renderTable([
            ["Rank", (r) => formatInteger(r.cross_server_rank ?? r.server_rank)],
            ["Alliance", (r) => `<button class="table-link" data-alliance="${escapeHtml(r.code)}">[${escapeHtml(r.code || "?")}]</button><small>S${r.server_id} · ${escapeHtml(r.full_name || "")}</small>`],
            ["Power", (r) => formatPower(r.fight_power)],
            ["Members", (r) => `${formatInteger(r.member_count)}/${formatInteger(r.max_members)}`],
          ], data.alliances) : emptyState("No alliance ranking", "Open the cross-server alliance ranking in game.")}
        </article>
      </div>
    </section>`;
}

function renderAlliances() {
  const list = state.alliances?.alliances || [];
  const detail = state.allianceDetail;
  if (detail) return renderAllianceDetail(detail);
  return `
    <section class="section">
      <div class="section-heading"><div><div class="eyebrow">ALLIANCE INTELLIGENCE</div><h2>Alliance directory</h2></div></div>
      <form class="search-row" id="alliance-search-form">
        <input id="alliance-query" value="${escapeHtml(state.filters.allianceQuery)}" placeholder="Code, name, or leader" />
        <select id="alliance-server"><option value="">All servers</option>${[577,578,579,580,581,582,583,584].map((id) => `<option value="${id}" ${String(id) === state.filters.allianceServer ? "selected" : ""}>S${id}</option>`).join("")}</select>
        <button type="submit" class="primary-button">Search</button>
      </form>
      ${list.length ? `<div class="alliance-grid">${list.map((row) => `
        <button class="alliance-card" data-alliance="${escapeHtml(row.code)}">
          <div class="alliance-card-head"><strong>[${escapeHtml(row.code || "?")}]</strong>${row.tracked ? badge("Tracked", "info") : ""}</div>
          <span>${escapeHtml(row.full_name || "")}</span>
          <div class="alliance-stats"><b>${formatPower(row.latest_fight_power)}</b><span>S${row.server_id} · ${formatInteger(row.latest_member_count)} members</span></div>
          <small>${row.latest_member_snapshot ? `Roster ${relativeTime(row.latest_member_snapshot)}` : "Roster not captured"}</small>
        </button>`).join("")}</div>` : emptyState("No matching alliance", "Change the search or collect alliance rankings.")}
    </section>`;
}

function renderAllianceDetail(data) {
  const a = data.alliance;
  const members = data.members || [];
  return `
    <section class="section">
      <button class="back-button" data-action="close-alliance">← Alliance directory</button>
      <div class="hero-heading">
        <div><div class="eyebrow">S${escapeHtml(a.server_id)} ALLIANCE</div><h2>[${escapeHtml(a.code)}] ${escapeHtml(a.full_name || "")}</h2><p>${escapeHtml(a.leader || "Unknown leader")}</p></div>
        <div>${a.tracked ? badge("Tracked", "info") : badge("Not tracked", "neutral")}</div>
      </div>
      <section class="metric-grid small">
        ${metric("Alliance power", formatPower(a.latest_fight_power), "Latest ranking")}
        ${metric("Members", formatInteger(data.snapshot?.member_count), data.snapshot?.presence_redacted ? "Public/redacted" : "Internal presence")}
        ${metric("Gift level", formatInteger(a.gift_level), "")}
        ${metric("Snapshot", formatDate(data.snapshot?.captured_at), data.snapshot ? relativeTime(data.snapshot.captured_at) : "")}
      </section>
      ${members.length ? renderTable([
        ["Member", (r) => `<button class="table-link" data-player="${escapeHtml(r.player_uid)}">${escapeHtml(r.player_name || r.player_uid)}</button><small>${escapeHtml(r.rank_name || `R${r.alliance_rank || "?"}`)}</small>`],
        ["Power", (r) => `${formatPower(r.power)}<small>${r.power_change !== null ? formatDelta(r.power_change) : ""}</small>`],
        ["HQ", (r) => `${formatInteger(r.hq_level)}<small>${r.hq_change ? formatDelta(r.hq_change, formatInteger) : ""}</small>`],
        ["Kills", (r) => `${formatInteger(r.army_kill)}<small>${r.kill_change !== null ? formatDelta(r.kill_change, formatInteger) : ""}</small>`],
        ["Status", (r) => data.snapshot?.presence_redacted ? badge("Redacted", "neutral") : (r.online ? badge("Online", "good") : badge("Offline", "neutral"))],
      ], members) : emptyState("No roster snapshot", "Open this alliance's member list in game.")}
    </section>`;
}

function renderPlayers() {
  if (state.playerDetail) return renderPlayerDetail(state.playerDetail);
  const players = state.players?.players || [];
  return `
    <section class="section">
      <div class="section-heading"><div><div class="eyebrow">PLAYER SCOUT</div><h2>Player search</h2></div></div>
      <form class="search-row" id="player-search-form">
        <input id="player-query" value="${escapeHtml(state.filters.playerQuery)}" placeholder="Player name or UID" />
        <button type="submit" class="primary-button">Search</button>
      </form>
      ${players.length ? renderTable([
        ["Player", (r) => `<button class="table-link" data-player="${escapeHtml(r.player_uid)}">${escapeHtml(r.player_name || r.player_uid)}</button><small>S${r.server_id} · ${r.alliance_code ? `[${escapeHtml(r.alliance_code)}]` : "No alliance"}</small>`],
        ["Power", (r) => formatPower(r.power)],
        ["HQ", (r) => formatInteger(r.hq_level)],
        ["Cross rank", (r) => formatInteger(r.cross_server_rank)],
        ["Profile", (r) => r.profile_snapshot_id ? badge("Detailed", "good") : badge("Basic", "neutral")],
      ], players) : emptyState("No players", state.filters.playerQuery ? "No player matched the search." : "Enter a name or UID, or browse captured players.")}
    </section>`;
}

function renderPlayerDetail(data) {
  const p = data.profile || data.public || data.player;
  const profile = data.profile;
  const components = profile ? [
    ["Building", profile.building_power], ["Science", profile.science_power],
    ["Hero", profile.hero_power], ["Army", profile.army_power],
    ["Vehicle", profile.vehicle_power], ["Pet", profile.pet_power],
  ] : [];
  const maxComponent = Math.max(1, ...components.map(([, value]) => number(value) || 0));
  return `
    <section class="section">
      <button class="back-button" data-action="close-player">← Player search</button>
      <div class="hero-heading">
        <div><div class="eyebrow">S${escapeHtml(p.server_id || data.player.server_id)} PLAYER</div><h2>${escapeHtml(p.player_name || data.player.player_name || data.player.player_uid)}</h2><p>${escapeHtml(p.alliance_code ? `[${p.alliance_code}] ${p.alliance_name || ""}` : data.player.player_uid)}</p></div>
        <div>${profile ? badge("Detailed profile", "good") : badge("Public/basic profile", "neutral")}</div>
      </div>
      <section class="metric-grid small">
        ${metric("Current power", formatPower(profile?.current_power ?? data.public?.power), "")}
        ${metric("Reported max", formatPower(profile?.reported_max_power), "")}
        ${metric("HQ", formatInteger(profile?.base_level ?? data.public?.main_building_level), "")}
        ${metric("Army kills", formatInteger(profile?.army_kill ?? data.public?.army_kill), "")}
      </section>
      ${profile ? `<div class="split-grid">
        <article class="panel"><div class="panel-heading"><h2>Power composition</h2></div><div class="bar-list">${components.map(([label, value]) => `<div class="bar-row"><div><span>${label}</span><strong>${formatPower(value)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(1, ((number(value) || 0) / maxComponent) * 100)}%"></div></div></div>`).join("")}</div></article>
        <article class="panel"><div class="panel-heading"><h2>Battle profile</h2></div><div class="detail-list"><div><span>Wins</span><strong>${formatInteger(profile.battle_win)}</strong></div><div><span>Losses</span><strong>${formatInteger(profile.battle_lose)}</strong></div><div><span>Army dead</span><strong>${formatInteger(profile.army_dead)}</strong></div><div><span>Scouts</span><strong>${formatInteger(profile.scout_count)}</strong></div><div><span>Likes</span><strong>${formatInteger(profile.likes)}</strong></div><div><span>Captured</span><strong>${formatDate(profile.captured_at)}</strong></div></div></article>
      </div>` : emptyState("Detailed profile not captured", "Open this player's profile while the collector is running.")}
      ${(data.ranking_history || []).length ? `<section class="subsection"><h2>Ranking history</h2>${renderTable([
        ["Captured", (r) => formatDate(r.captured_at)], ["Rank", (r) => formatInteger(r.cross_server_rank)], ["Power", (r) => formatPower(r.power)], ["Alliance", (r) => r.alliance_code ? `[${escapeHtml(r.alliance_code)}]` : "—"]
      ], data.ranking_history)}</section>` : ""}
    </section>`;
}

function renderRefresh() {
  const data = state.refresh;
  if (!data) return renderLoading();
  const jobs = data.jobs || [];
  const admin = state.session?.is_admin;
  const workflows = [
    ["arena", "Arena", "Reconnect and capture weekly Arena data"],
    ["rankings", "Rankings", "Player and alliance ranking screens"],
    ["my_alliance", "My alliance", "Own alliance roster and presence"],
    ["tracked_alliances", "Tracked alliances", "Tracked competitor rosters"],
    ["full_weekly", "Full weekly", "Arena plus every core weekly screen"],
  ];
  return `
    <section class="section">
      <div class="section-heading"><div><div class="eyebrow">IDLE-AWARE CONTROL</div><h2>Refresh Center</h2></div>${admin ? badge("Admin controls enabled", "good") : badge("View only", "neutral")}</div>
      <div class="status-grid">${Object.values(data.freshness || {}).map((item) => `<article class="status-card"><div class="status-card-head"><strong>${escapeHtml(item.label)}</strong>${badge(item.current ? "Current" : "Stale", item.current ? "good" : "bad")}</div><div class="status-time">${item.latest_at ? formatDate(item.latest_at) : "No snapshot"}</div><div class="status-detail">${escapeHtml(item.detail || "")}</div></article>`).join("")}</div>
    </section>
    <section class="section">
      <div class="section-heading"><h2>Request refresh</h2><span class="muted">Jobs wait for idle by default and reuse passive captures.</span></div>
      <div class="workflow-grid">${workflows.map(([id, title, detail]) => `<article class="workflow-card"><div><strong>${title}</strong><p>${detail}</p></div><button class="primary-button" data-queue="${id}" ${admin ? "" : "disabled"}>Queue</button></article>`).join("")}</div>
    </section>
    <section class="section">
      <div class="section-heading"><h2>Job history</h2></div>
      ${jobs.length ? `<div class="job-list">${jobs.map((job) => `<article class="job-card"><div class="job-card-head"><div><strong>#${job.job_id} · ${escapeHtml(job.job_type.replaceAll("_", " "))}</strong><small>${escapeHtml(job.trigger_type)} · ${formatDate(job.requested_at)}</small></div>${statusBadge(job.status)}</div><div class="step-list">${(job.steps || []).map((step) => `<div><span>${escapeHtml(step.workflow_id.replaceAll("_", " "))}</span>${statusBadge(step.status)}</div>`).join("")}</div>${job.last_error ? `<div class="alert alert-error">${escapeHtml(job.last_error)}</div>` : ""}${admin && ["queued", "waiting_idle", "waiting_setup", "partial"].includes(job.status) ? `<button class="secondary-button" data-cancel="${job.job_id}">Cancel</button>` : ""}</article>`).join("")}</div>` : emptyState("No refresh jobs", "Queue a manual job or wait for the weekly scheduler.")}
    </section>`;
}

function renderTable(columns, rows) {
  return `<div class="table-wrap"><table><thead><tr>${columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map(([, renderer]) => `<td>${renderer(row)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderCurrentTab(loading = false) {
  let content = loading ? renderLoading() : {
    overview: renderOverview,
    arena: renderArena,
    rankings: renderRankings,
    alliances: renderAlliances,
    players: renderPlayers,
    refresh: renderRefresh,
  }[state.activeTab]();
  renderShell(content);
  wireContent();
}

function wireContent() {
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", async () => {
    state.activeTab = button.dataset.go;
    renderCurrentTab(true);
    try { await loadTab(); } catch (error) { state.error = error.message; }
    renderCurrentTab();
  }));
  document.querySelectorAll("[data-alliance]").forEach((button) => button.addEventListener("click", async () => {
    const code = button.dataset.alliance;
    if (!code) return;
    state.activeTab = "alliances";
    renderCurrentTab(true);
    try { await loadAlliance(code); } catch (error) { state.error = error.message; }
    renderCurrentTab();
  }));
  document.querySelectorAll("[data-player]").forEach((button) => button.addEventListener("click", async () => {
    state.activeTab = "players";
    renderCurrentTab(true);
    try { await loadPlayer(button.dataset.player); } catch (error) { state.error = error.message; }
    renderCurrentTab();
  }));
  document.querySelector("[data-action='close-alliance']")?.addEventListener("click", () => { state.allianceDetail = null; renderCurrentTab(); });
  document.querySelector("[data-action='close-player']")?.addEventListener("click", () => { state.playerDetail = null; renderCurrentTab(); });
  document.querySelector("#arena-server-filter")?.addEventListener("change", async (event) => {
    state.filters.arenaServer = event.target.value;
    renderCurrentTab(true); try { await loadArena(); } catch (error) { state.error = error.message; } renderCurrentTab();
  });
  document.querySelector("#ranking-server-filter")?.addEventListener("change", async (event) => {
    state.filters.rankingServer = event.target.value;
    renderCurrentTab(true); try { await loadRankings(); } catch (error) { state.error = error.message; } renderCurrentTab();
  });
  document.querySelector("#alliance-search-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.filters.allianceQuery = document.querySelector("#alliance-query").value;
    state.filters.allianceServer = document.querySelector("#alliance-server").value;
    renderCurrentTab(true); try { await loadAlliances(); } catch (error) { state.error = error.message; } renderCurrentTab();
  });
  document.querySelector("#player-search-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.filters.playerQuery = document.querySelector("#player-query").value;
    renderCurrentTab(true); try { await loadPlayers(); } catch (error) { state.error = error.message; } renderCurrentTab();
  });
  document.querySelectorAll("[data-queue]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await apiFetch("/api/refresh/queue", { method: "POST", body: JSON.stringify({ job_type: button.dataset.queue, idle_required: true }) });
      await loadRefresh();
      state.error = null;
    } catch (error) { state.error = error.message; }
    renderCurrentTab();
  }));
  document.querySelectorAll("[data-cancel]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await apiFetch(`/api/refresh/jobs/${button.dataset.cancel}/cancel`, { method: "POST" });
      await loadRefresh();
      state.error = null;
    } catch (error) { state.error = error.message; }
    renderCurrentTab();
  }));
}

async function boot() {
  try {
    await authenticate();
    await loadOverview();
    state.loading = false;
    renderCurrentTab();
    setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        if (state.activeTab === "overview") await loadOverview();
        if (state.activeTab === "refresh") await loadRefresh();
        renderCurrentTab();
      } catch (error) {
        state.error = error.message;
        renderCurrentTab();
      }
    }, 30_000);
  } catch (error) {
    state.error = error.message;
    app.innerHTML = `<main class="fatal"><div class="fatal-icon">!</div><h1>Activity could not start</h1><p>${escapeHtml(error.message)}</p><small>Check the Activity server, Discord credentials, URL Mapping, and user allowlist.</small></main>`;
  }
}

boot();
