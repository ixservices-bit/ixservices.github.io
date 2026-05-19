(function () {
  const config = window.ICQA_CONFIG || {};
  const sources = config.sources || {};
  const timeoutMs = config.fetchTimeoutMs || 12000;
  const recentWindowDays = config.recentWindowDays || 7;

  const els = {
    refreshBtn: document.getElementById("refreshBtn"),
    statusPill: document.getElementById("statusPill"),
    lastUpdated: document.getElementById("lastUpdated"),
    kpiGrid: document.getElementById("kpiGrid"),
    usageSummary: document.getElementById("usageSummary"),
    userSummary: document.getElementById("userSummary"),
    topForms: document.getElementById("topForms"),
    leastForms: document.getElementById("leastForms"),
    wallpaperUsage: document.getElementById("wallpaperUsage"),
    feedbackPanel: document.getElementById("feedbackPanel"),
    versionPanel: document.getElementById("versionPanel")
  };

  const csvHeaders = (text) => parseCsv(text)[0] || [];
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    text = (text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i + 1];
      if (ch === '"') { if (quoted && next === '"') { cell += '"'; i++; } else quoted = !quoted; continue; }
      if (ch === "," && !quoted) { row.push(cell); cell = ""; continue; }
      if (ch === "\n" && !quoted) { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
      cell += ch;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(c => c.trim()));
  }

  function num(v) { const n = Number(String(v || "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; }
  function clean(v) { return String(v || "").trim(); }
  function minutesFromSeconds(s) { return Math.round(Math.max(0, s) / 60); }
  function fmtMinutes(m) { if (!m) return "0m"; if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`; return `${m}m`; }
  function fmtDate(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? clean(v) : d.toLocaleString(); }
  function daysAgo(n) { return new Date(Date.now() - n * 86400000); }

  async function fetchText(url) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally { clearTimeout(t); }
  }

  function renderLoading() {
    els.statusPill.textContent = "Loading";
    document.body.classList.add("is-loading");
    const skeleton = '<div class="skeleton"></div>';
    els.kpiGrid.innerHTML = skeleton.repeat(4);
    els.usageSummary.innerHTML = skeleton.repeat(2);
    els.userSummary.innerHTML = skeleton.repeat(2);
    els.topForms.innerHTML = skeleton.repeat(4);
    els.leastForms.innerHTML = skeleton.repeat(4);
    els.wallpaperUsage.innerHTML = skeleton.repeat(4);
    els.feedbackPanel.innerHTML = skeleton.repeat(3);
    els.versionPanel.innerHTML = skeleton.repeat(2);
  }

  function metricCard(label, value, hint) {
    return `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint || ""}</div></div>`;
  }

  function listItem(title, value, sub, badge) {
    return `<div class="row-item"><div><div class="badge ${badge || ""}">${badge || ""}</div><div class="row-title">${title}</div><div class="row-sub">${sub || ""}</div></div><div class="row-value">${value}</div></div>`;
  }

  function emptyState(msg) { return `<div class="empty-state">${msg}</div>`; }

  async function loadDashboard() {
    renderLoading();
    const start = Date.now();
    const results = await Promise.allSettled(Object.entries(sources).map(async ([key, url]) => [key, await fetchText(url)]));
    const data = {};
    const errors = [];
    for (const r of results) {
      if (r.status === "fulfilled") { const [k, v] = r.value; data[k] = v; }
      else errors.push(r.reason?.message || "Fetch failed");
    }
    const featureRows = parseCsv(data.featureUsage || "");
    const userRows = parseCsv(data.userUsage || "");
    const wallpaperRows = parseCsv(data.wallpaperUsage || "");
    const feedbackRows = parseCsv(data.feedback || "");
    const managersRows = parseCsv(data.managers || "");
    const activeRows = parseCsv(data.activeUsers || "");
    const quickLinkRows = parseCsv(data.quickLinks || "");

    const featureHeader = csvHeaders(data.featureUsage || "");
    const userHeader = csvHeaders(data.userUsage || "");
    const wallpaperHeader = csvHeaders(data.wallpaperUsage || "");
    const feedbackHeader = csvHeaders(data.feedback || "");
    const quickHeader = csvHeaders(data.quickLinks || "");

    const feature = featureRows.slice(1).map(r => rowMap(featureHeader, r));
    const users = userRows.slice(1).map(r => rowMap(userHeader, r));
    const wallpaper = wallpaperRows.slice(1).map(r => rowMap(wallpaperHeader, r));
    const feedback = feedbackRows.slice(1).map(r => rowMap(feedbackHeader, r));
    const quick = quickLinkRows.slice(1).map(r => rowMap(quickHeader, r));
    const active = activeRows.slice(1).map(r => rowMap(["Username","Machine","Build","Status","LastHeartbeat","AssemblyVersion"], r));
    const managers = managersRows.slice(1).map(r => r.map(clean));

    const usageRows = feature.filter(r => clean(r.FormName)).filter(r => !clean(r.ButtonName));
    const totalSeconds = usageRows.reduce((sum, r) => sum + num(r.ActiveSeconds), 0);
    const icqaSeconds = usageRows.filter(r => /ICQA/i.test(clean(r.Build))).reduce((sum, r) => sum + num(r.ActiveSeconds), 0);
    const rdcSeconds = usageRows.filter(r => /RDC/i.test(clean(r.Build))).reduce((sum, r) => sum + num(r.ActiveSeconds), 0);
    const byForm = aggregate(usageRows, r => clean(r.FormName), r => num(r.ActiveSeconds)).sort((a,b)=>b.value-a.value);
    const recentCutoff = daysAgo(recentWindowDays);
    const activeUsers = dedupeCount(usageRows.filter(r => new Date(r.Timestamp || r.SubmittedAt || 0) >= recentCutoff), r => `${clean(r.Username)}|${clean(r.Machine)}`);
    const recentUsers = usageRows.slice().sort((a,b)=>new Date(b.Timestamp||0)-new Date(a.Timestamp||0)).slice(0, 8);
    const wallpaperAgg = aggregate(wallpaper, r => clean(r[wallpaperHeader[0]] || r.Title || r.Name || "Wallpaper"), r => 1).sort((a,b)=>b.value-a.value);
    const feedbackSorted = feedback.slice().sort((a,b)=>(new Date(b.SubmittedAt||0)-new Date(a.SubmittedAt||0))).slice(0, 5);
    const latestIcqa = clean(data.icqaVersion);
    const latestRdc = clean(data.rdcVersion);
    const appVersion = latestIcqa || latestRdc || "";

    els.kpiGrid.innerHTML = [
      metricCard("Total usage", fmtMinutes(minutesFromSeconds(totalSeconds)), "All tracked form time"),
      metricCard("ICQA usage", fmtMinutes(minutesFromSeconds(icqaSeconds)), `${pct(icqaSeconds, totalSeconds)} of tracked time`),
      metricCard("RDC usage", fmtMinutes(minutesFromSeconds(rdcSeconds)), `${pct(rdcSeconds, totalSeconds)} of tracked time`),
      metricCard("Active users", String(activeUsers), `Last ${recentWindowDays} days`)
    ].join("");

    els.usageSummary.innerHTML = [
      listItem("Tracked forms", byForm.length.toString(), "Form rows with active time", "good"),
      listItem("Quick links", quick.length.toString(), "Links loaded from CSV", quick.length ? "good" : "warn")
    ].join("");

    els.userSummary.innerHTML = [
      listItem("Current usage rows", users.length.toString(), "UserUsage.csv records", users.length ? "good" : "warn"),
      listItem("Recent activity", recentUsers.length.toString(), "Most recent tracked sessions", recentUsers.length ? "good" : "warn")
    ].join("");

    els.topForms.innerHTML = byForm.length ? byForm.slice(0, 5).map(x => listItem(x.key, fmtMinutes(minutesFromSeconds(x.value)), "Most active forms", "good")).join("") : emptyState("No feature usage rows were available.");
    els.leastForms.innerHTML = byForm.length ? byForm.slice(-5).reverse().map(x => listItem(x.key, fmtMinutes(minutesFromSeconds(x.value)), "Lowest tracked forms", "warn")).join("") : emptyState("No feature usage rows were available.");
    els.wallpaperUsage.innerHTML = wallpaperAgg.length ? wallpaperAgg.slice(0, 5).map(x => listItem(x.key, String(x.value), "Wallpaper selections", "good")).join("") : emptyState("No wallpaper usage file was available.");

    els.feedbackPanel.innerHTML = feedbackSorted.length ? feedbackSorted.map(x => {
      const message = clean(x.Message || x.message).slice(0, 140);
      return `<div class="row-item"><div><div class="badge ${statusBadge(x.Status)}">${clean(x.Status || "New")}</div><div class="row-title">${clean(x.DisplayName || x.displayName || "Anonymous")}</div><div class="row-sub">${clean(x.Category || x.category || "")} ${message ? "• " + message : ""}</div></div><div class="row-value">${fmtDate(x.SubmittedAt || x.submittedAt || "")}</div></div>`;
    }).join("") : emptyState("No feedback file was available.");

    const buildStatus = [
      { label: "ICQA version", value: latestIcqa || "Missing", hint: latestIcqa ? "Raw txt loaded from GitHub" : "Version file missing", badge: latestIcqa ? "good" : "warn" },
      { label: "RDC version", value: latestRdc || "Missing", hint: latestRdc ? "Raw txt loaded from GitHub" : "Version file missing", badge: latestRdc ? "good" : "warn" },
      { label: "Managers file", value: managers.length.toString(), hint: "Rows found in managers.csv", badge: managers.length ? "good" : "warn" }
    ];
    els.versionPanel.innerHTML = buildStatus.map(x => listItem(x.label, x.value, x.hint, x.badge)).join("") + (appVersion ? `<div class="meta-line">Latest available version text: ${appVersion}</div>` : "");

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    els.statusPill.textContent = errors.length ? `Loaded with ${errors.length} issue(s)` : `Updated in ${elapsed}s`;
    els.statusPill.className = `status-pill ${errors.length ? "warn" : "good"}`;
    els.lastUpdated.textContent = `Last updated ${new Date().toLocaleTimeString()}${errors.length ? ` • ${errors.length} fetch issue(s)` : ""}`;
    document.body.classList.remove("is-loading");
    if (errors.length) {
      const msg = errors.slice(0, 2).join(" | ");
      els.userSummary.insertAdjacentHTML("afterbegin", `<div class="empty-state">Some CSV files could not be loaded: ${escapeHtml(msg)}</div>`);
    }
  }

  function rowMap(headers, row) {
    const out = {};
    for (let i = 0; i < headers.length; i++) out[headers[i]] = row[i] ?? "";
    return out;
  }
  function aggregate(rows, keyFn, valueFn) {
    const map = new Map();
    rows.forEach(r => { const key = clean(keyFn(r)); if (!key) return; map.set(key, (map.get(key) || 0) + valueFn(r)); });
    return [...map.entries()].map(([key, value]) => ({ key, value }));
  }
  function dedupeCount(rows, keyFn) { return new Set(rows.map(r => clean(keyFn(r))).filter(Boolean)).size; }
  function pct(part, whole) { if (!whole) return "n/a"; return `${Math.round((part / whole) * 100)}%`; }
  function statusBadge(status) {
    const s = clean(status).toLowerCase();
    if (s.includes("fix") || s.includes("ack")) return "good";
    if (s.includes("work") || s.includes("follow")) return "warn";
    return "bad";
  }
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[ch]));
  }

  els.refreshBtn.addEventListener("click", () => loadDashboard());
  loadDashboard().catch(err => {
    els.statusPill.textContent = "Load failed";
    els.statusPill.className = "status-pill bad";
    document.body.classList.remove("is-loading");
    els.lastUpdated.textContent = "Dashboard could not load.";
    els.usageSummary.innerHTML = emptyState(escapeHtml(err.message || "Unknown error"));
    els.userSummary.innerHTML = emptyState("Try Refresh after checking network access.");
  });
})();
