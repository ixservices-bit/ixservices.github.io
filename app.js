(function () {
  const config = window.ICQA_CONFIG || {};
  const sources = config.sources || {};
  const state = {
    raw: {},
    rows: {},
    range: "7",
    build: "All Builds",
    search: "",
    view: "overview",
    selectedUser: "",
    selectedForm: "",
    selectedMachine: "",
    selectedFeedback: ""
  };

  const el = {
    refresh: document.getElementById("refreshBtn"),
    status: document.getElementById("statusLine"),
    content: document.getElementById("content"),
    ranges: document.getElementById("rangeTabs"),
    tabs: document.getElementById("viewTabs"),
    build: document.getElementById("buildFilter"),
    search: document.getElementById("searchBox")
  };

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    text = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i + 1];
      if (ch === "\"") {
        if (quoted && next === "\"") { cell += "\""; i++; } else quoted = !quoted;
      } else if (ch === "," && !quoted) {
        row.push(cell.trim()); cell = "";
      } else if (ch === "\n" && !quoted) {
        row.push(cell.trim()); rows.push(row); row = []; cell = "";
      } else {
        cell += ch;
      }
    }
    if (cell.length || row.length) { row.push(cell.trim()); rows.push(row); }
    return rows.filter(r => r.some(c => c !== ""));
  }

  function toObjects(text, fallbackHeaders) {
    const rows = parseCsv(text);
    const headers = (rows.shift() || fallbackHeaders || []).map(h => h.replace(/^\uFEFF/, "").trim());
    return rows.map(r => {
      const o = {};
      headers.forEach((h, i) => { o[h] = r[i] || ""; });
      return o;
    });
  }

  function quickLinkObjects(text) {
    return parseCsv(text).map(row => ({
      Title: clean(row[0]),
      Url: clean(row[1]),
      BuildVisibility: clean(row[2])
    })).filter(x => x.Title && x.Url && !/^title$/i.test(x.Title));
  }

  async function fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs || 12000);
    try {
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async function load() {
    el.status.textContent = "Loading data...";
    el.content.innerHTML = `<div class="empty loading">Loading dashboard data...</div>`;
    const entries = Object.entries(sources);
    const settled = await Promise.allSettled(entries.map(async ([k, url]) => [k, await fetchText(url)]));
    const errors = [];
    settled.forEach((result, index) => {
      const key = entries[index][0];
      if (result.status === "fulfilled") state.raw[key] = result.value[1];
      else errors.push(`${key}: ${result.reason.message || "failed"}`);
    });
    hydrateRows();
    el.status.textContent = `${counts().feature} feature rows, ${counts().users} users, ${counts().feedback} feedback items loaded${errors.length ? `; ${errors.length} source issue(s)` : ""}.`;
    render();
  }

  function hydrateRows() {
    state.rows.feature = toObjects(state.raw.featureUsage, ["Timestamp","SessionId","Username","Machine","Build","FormName","ButtonName","OpenCount","ClickCount","ActiveSeconds"]).map(r => ({
      ...r,
      date: dateValue(r.Timestamp),
      seconds: number(r.ActiveSeconds),
      opens: number(r.OpenCount),
      clicks: number(r.ClickCount)
    }));
    state.rows.users = toObjects(state.raw.userUsage, ["Username","Machine","Build","Status","LastHeartbeat","AssemblyVersion"]).map(r => ({ ...r, lastSeen: dateValue(r.LastHeartbeat) }));
    state.rows.wallpaper = toObjects(state.raw.wallpaperUsage, ["Timestamp","Username","Machine","Build","Wallpaper"]).map(r => ({ ...r, date: dateValue(r.Timestamp), name: first(r.Wallpaper, r.Theme, r.Name, r.Selection, r.Value) || lastValue(r) }));
    state.rows.quickLinks = quickLinkObjects(state.raw.quickLinks);
    state.rows.quickLinkUsage = toObjects(state.raw.quickLinkUsage, ["LinkName","ClickCount","LastClicked"]).map(r => ({ ...r, clicks: number(r.ClickCount), date: dateValue(r.LastClicked) }));
    state.rows.feedback = toObjects(state.raw.feedback, ["Id","SubmittedAt","DisplayName","Email","Category","Message","Username","Machine","Build","Status","StatusUpdatedAt","StatusUpdatedBy"]).map(r => ({ ...r, date: dateValue(r.SubmittedAt) }));
    state.rows.managers = toObjects(state.raw.managers, ["Username","AccountType"]);
    state.rows.machines = toObjects(state.raw.machines, ["Machine","Nickname","Groups","Notes"]);
    state.rows.groups = toObjects(state.raw.groups, ["GroupName","Description"]);
    state.rows.activeUsers = toObjects(state.raw.activeUsers, ["Username","Machine","Build","Status","LastHeartbeat","AssemblyVersion"]).map(r => ({ ...r, lastSeen: dateValue(r.LastHeartbeat) }));
    state.rows.versions = [
      { build: "ICQA", version: clean(state.raw.icqaVersion) },
      { build: "RDC", version: clean(state.raw.rdcVersion) }
    ];
  }

  function filteredFeature() {
    const max = maxDate(state.rows.feature, "date");
    return state.rows.feature.filter(r => {
      if (!matchBuild(r.Build)) return false;
      if (!inRange(r.date, max)) return false;
      return matchesSearch([r.Username, r.Machine, r.Build, r.FormName, r.ButtonName]);
    });
  }

  function formRows(rows = filteredFeature()) {
    return rows.filter(r => clean(r.FormName) && !clean(r.ButtonName));
  }

  function render() {
    setActiveButtons();
    const views = {
      overview: renderOverview,
      analytics: renderAnalytics,
      users: renderUsers,
      forms: renderForms,
      machines: renderMachines,
      groups: renderGroups,
      quicklinks: renderQuickLinks,
      feedback: renderFeedback,
      versions: renderVersions
    };
    (views[state.view] || renderOverview)();
  }

  function renderOverview() {
    const rows = formRows();
    const total = sum(rows, r => r.seconds);
    const icqa = sum(rows.filter(r => /icqa/i.test(r.Build)), r => r.seconds);
    const rdc = sum(rows.filter(r => /rdc/i.test(r.Build)), r => r.seconds);
    const active = state.rows.users.filter(u => /active/i.test(u.Status)).length;
    const topForms = aggregate(rows, r => r.FormName, r => r.seconds).slice(0, 8);
    const users = aggregateUsers(rows).slice(0, 8);
    const wallpaper = wallpaperRows().slice(0, 8);
    el.content.innerHTML = `
      <section class="grid four">
        ${metric("Total usage", fmtDuration(total), "Tracked form time")}
        ${metric("ICQA usage", fmtDuration(icqa), pct(icqa, total))}
        ${metric("RDC usage", fmtDuration(rdc), pct(rdc, total))}
        ${metric("Active machines", active, "Currently reporting active")}
      </section>
      <section class="grid three">
        ${panel("Top Forms", list(topForms, x => row(x.key, fmtDuration(x.value), formSummary(x.key, rows), "clickable", `data-form="${escAttr(x.key)}"`)))}
        ${panel("Most Active Users", listWithOutlier(users, x => userBarRow(x, users, userSummary(x.key, rows))))}
        ${panel("Wallpaper Usage", list(wallpaper, x => row(x.key, x.value, "selection count")))}
      </section>
      <section class="grid two">
        ${panel("Recent Activity", list(recentRows(rows, 12), x => row(x.FormName, fmtDuration(x.seconds), `${x.Username} • ${x.Machine} • ${fmtDate(x.date)}`)))}
        ${panel("Health", healthList())}
      </section>`;
    wireClicks();
  }

  function renderAnalytics() {
    const rows = formRows();
    const totalSessions = unique(rows.map(r => r.SessionId)).length;
    const avg = rows.length ? sum(rows, r => r.seconds) / rows.length : 0;
    const daily = aggregateBy(rows, r => dayKey(r.date), r => uniqueValue(r.Username, r.Machine)).slice(-14);
    const byDay = aggregate(rows, r => dayName(r.date), r => r.seconds);
    const avgByForm = aggregateAvg(rows, r => r.FormName, r => r.seconds).slice(0, 12);
    el.content.innerHTML = `
      <section class="grid four">
        ${metric("Sessions", totalSessions, "Distinct session ids")}
        ${metric("Average form time", fmtDuration(avg), "Average active time per form row")}
        ${metric("Outdated rows", outdatedUsers().length, "Version mismatch")}
        ${metric("Feedback open", openFeedback().length, "New or active feedback")}
      </section>
      <section class="grid two">
        ${panel("Daily Active Users", list(daily, x => barRow(x.key, x.value, maxOf(daily))))}
        ${panel("Busiest Days", list(byDay, x => barRow(x.key, fmtDuration(x.value), maxOf(byDay), x.value)))}
        ${panel("Average Time By Form", list(avgByForm, x => barRow(x.key, fmtDuration(x.value), maxOf(avgByForm), x.value, `data-form="${escAttr(x.key)}"`)))}
        ${panel("Most Active Users", listWithOutlier(aggregateUsers(rows), x => userBarRow(x, aggregateUsers(rows), userSummary(x.key, rows))))}
      </section>`;
    wireClicks();
  }

  function renderUsers() {
    const rows = formRows();
    const users = aggregateUsers(rows).filter(x => matchesSearch([x.key])).map(x => {
      const latest = latestUserRow(x.key);
      return { ...x, latest, forms: aggregate(rows.filter(r => eq(r.Username, x.key)), r => r.FormName, r => r.seconds) };
    });
    const selected = state.selectedUser || (users[0] && users[0].key) || "";
    state.selectedUser = selected;
    const detailRows = rows.filter(r => eq(r.Username, selected));
    el.content.innerHTML = `
      <section class="split-detail">
        ${panel("Users", table(["User","Usage","Build","Status"], users, u => [
          u.key, fmtDuration(u.value), clean(u.latest?.Build), statusBadge(clean(u.latest?.Status))
        ], u => `data-user="${escAttr(u.key)}"`))}
        ${panel(`User Detail: ${esc(selected || "None")}`, selected ? userDetail(selected, detailRows) : empty("No matching user."))}
      </section>`;
    wireClicks();
  }

  function renderForms() {
    const rows = formRows();
    const forms = aggregate(rows, r => r.FormName, r => r.seconds).filter(x => matchesSearch([x.key]));
    const selected = state.selectedForm || (forms[0] && forms[0].key) || "";
    state.selectedForm = selected;
    const detailRows = rows.filter(r => eq(r.FormName, selected));
    el.content.innerHTML = `
      <section class="split-detail">
        ${panel("Forms", table(["Form","Usage","Users"], forms, f => [
          f.key, fmtDuration(f.value), unique(rows.filter(r => eq(r.FormName, f.key)).map(r => r.Username)).length
        ], f => `data-form="${escAttr(f.key)}"`, "compact-table"))}
        ${panel(`Form Detail: ${esc(selected || "None")}`, selected ? formDetail(selected, detailRows) : empty("No matching form."))}
      </section>`;
    wireClicks();
  }

  function renderMachines() {
    const usage = formRows();
    const machines = unique([...state.rows.users.map(u => u.Machine), ...usage.map(u => u.Machine), ...state.rows.machines.map(m => m.Machine)]).filter(m => m && matchesSearch([m, machineMeta(m)?.Nickname, machineMeta(m)?.Groups]));
    const selected = state.selectedMachine || machines[0] || "";
    state.selectedMachine = selected;
    el.content.innerHTML = `
      <section class="split-detail">
        ${panel("Machines", table(["Machine","Nickname","Build","Status","Last Seen"], machines.map(m => ({ name: m, meta: machineMeta(m), latest: latestMachineRow(m), seconds: machineSeconds(m) })), m => [
          m.name, clean(m.meta?.Nickname), clean(m.latest?.Build), statusBadge(clean(m.latest?.Status)), fmtDate(m.latest?.lastSeen)
        ], m => `data-machine="${escAttr(m.name)}"`))}
        ${panel(`Machine Detail: ${esc(selected || "None")}`, selected ? machineDetail(selected) : empty("No matching machine."))}
      </section>`;
    wireClicks();
  }

  function renderGroups() {
    const groups = state.rows.groups.filter(g => matchesSearch([g.GroupName, g.Description])).map(g => ({ ...g, members: groupMembers(g.GroupName) }));
    el.content.innerHTML = `
      <section class="grid two">
        ${panel("Groups", table(["Group","Machines","Description"], groups, g => [g.GroupName, g.members.length, g.Description]))}
        ${panel("Group Members", groups.length ? groups.map(g => `<div class="row"><div><div class="title">${esc(g.GroupName)}</div><div class="sub">${esc(g.members.join(", ") || "No machines assigned")}</div></div><div class="value">${g.members.length}</div></div>`).join("") : empty("No groups found."))}
      </section>`;
  }

  function renderQuickLinks() {
    const usage = quickLinkRows().filter(x => matchesSearch([x.key]));
    const links = state.rows.quickLinks.filter(l => matchesSearch([l.Title, l.Url, l.BuildVisibility]));
    el.content.innerHTML = `
      <section class="grid two">
        ${panel("Quick Link Usage", list(usage, x => row(x.key, x.value, `Last clicked ${fmtDate(x.lastClicked)}`)))}
        ${panel("Quick Link Directory", table(["Title","Visible To"], links, l => [l.Title, clean(l.BuildVisibility) || "Both"], l => `data-url="${escAttr(l.Url)}"`, "compact-table"))}
      </section>`;
    document.querySelectorAll("[data-url]").forEach(x => x.addEventListener("click", () => window.open(x.dataset.url, "_blank", "noopener")));
  }

  function renderFeedback() {
    const items = state.rows.feedback.filter(f => matchesSearch([f.DisplayName, f.Category, f.Message, f.Username, f.Machine, f.Status])).sort((a,b) => b.date - a.date);
    const selected = state.selectedFeedback || (items[0] && items[0].Id) || "";
    state.selectedFeedback = selected;
    const item = items.find(f => f.Id === selected);
    el.content.innerHTML = `
      <section class="split-detail">
        ${panel("Feedback", table(["Submitted","Name","Category","Status","Machine"], items, f => [
          fmtDate(f.date), f.DisplayName, f.Category, statusBadge(f.Status), f.Machine
        ], f => `data-feedback="${escAttr(f.Id)}"`))}
        ${panel("Feedback Detail", item ? feedbackDetail(item) : empty("No feedback selected."))}
      </section>`;
    wireClicks();
  }

  function renderVersions() {
    const users = state.rows.users.filter(u => matchesSearch([u.Username, u.Machine, u.Build, u.AssemblyVersion]));
    el.content.innerHTML = `
      <section class="grid three">
        ${panel("Latest Versions", state.rows.versions.map(v => row(v.build, esc(v.version || "Missing"), "Synced version file")).join(""))}
        ${panel("Outdated Users", table(["User","Machine","Build","Installed","Latest"], outdatedUsers(), u => [u.Username, u.Machine, u.Build, u.AssemblyVersion, latestVersion(u.Build)]))}
        ${panel("Managers", table(["User","Type"], state.rows.managers, m => [first(m.Username, m.User, m.Name), first(m.AccountType, m.Type, m.Role)]))}
      </section>
      ${panel("All User Version Rows", table(["User","Machine","Build","Status","Last Heartbeat","Version"], users, u => [u.Username, u.Machine, u.Build, statusBadge(u.Status), fmtDate(u.lastSeen), u.AssemblyVersion]))}`;
  }

  function userDetail(user, rows) {
    const latest = latestUserRow(user);
    return `
      <div class="grid two">
        <div>${kv("User", user)}${kv("Build", clean(latest?.Build))}${kv("Status", statusBadge(clean(latest?.Status)))}${kv("Version", clean(latest?.AssemblyVersion))}</div>
        <div>${metric("Total usage", fmtDuration(sum(rows, r => r.seconds)), "Tracked time")}${metric("Sessions", unique(rows.map(r => r.SessionId)).length, "Distinct sessions")}</div>
      </div>
      <div class="panel-body">${table(["Form","Usage","Last Used"], aggregate(rows, r => r.FormName, r => r.seconds), f => [f.key, fmtDuration(f.value), fmtDate(maxDate(rows.filter(r => eq(r.FormName, f.key)), "date"))], f => `data-form="${escAttr(f.key)}"`, "compact-table")}</div>
      <div class="panel-body">${table(["Recent Form","Duration","When"], recentRows(rows, 18), r => [r.FormName, fmtDuration(r.seconds), fmtDate(r.date)], r => `data-form="${escAttr(r.FormName)}"`, "compact-table")}</div>`;
  }

  function formDetail(form, rows) {
    return `
      <div class="grid two">
        ${metric("Total usage", fmtDuration(sum(rows, r => r.seconds)), "Tracked time")}
        ${metric("Users", unique(rows.map(r => r.Username)).length, "Distinct users")}
      </div>
        <div class="panel-body">${table(["User","Usage","Last Used"], aggregateUsers(rows), u => [u.key, fmtDuration(u.value), fmtDate(maxDate(rows.filter(r => eq(r.Username, u.key)), "date"))], u => `data-user="${escAttr(u.key)}"`, "compact-table")}</div>
      <div class="panel-body">${table(["Date","User","Duration"], recentRows(rows, 24), r => [fmtDate(r.date), r.Username, fmtDuration(r.seconds)], r => `data-user="${escAttr(r.Username)}"`, "compact-table")}</div>`;
  }

  function machineDetail(machine) {
    const rows = formRows().filter(r => eq(r.Machine, machine));
    const meta = machineMeta(machine);
    const latest = latestMachineRow(machine);
    return `
      <div>${kv("Nickname", clean(meta?.Nickname))}${kv("Groups", clean(meta?.Groups))}${kv("Notes", clean(meta?.Notes))}${kv("Status", statusBadge(clean(latest?.Status)))}${kv("Last Seen", fmtDate(latest?.lastSeen))}</div>
      <div class="panel-body">${table(["User","Usage","Forms"], aggregate(rows, r => r.Username, r => r.seconds), u => [u.key, fmtDuration(u.value), unique(rows.filter(r => eq(r.Username, u.key)).map(r => r.FormName)).length], u => `data-user="${escAttr(u.key)}"` )}</div>
      <div class="panel-body">${table(["Form","Usage","Last Used"], aggregate(rows, r => r.FormName, r => r.seconds), f => [f.key, fmtDuration(f.value), fmtDate(maxDate(rows.filter(r => eq(r.FormName, f.key)), "date"))], f => `data-form="${escAttr(f.key)}"` )}</div>`;
  }

  function feedbackDetail(f) {
    return `${kv("Name", f.DisplayName)}${kv("Email", f.Email)}${kv("Category", f.Category)}${kv("Status", statusBadge(f.Status))}${kv("User", f.Username)}${kv("Machine", f.Machine)}${kv("Build", f.Build)}${kv("Submitted", fmtDate(f.date))}<div class="panel-body"><h3>Message</h3><p class="message">${esc(f.Message)}</p></div>`;
  }

  function healthList() {
    const versionMissing = state.rows.versions.some(v => !v.version || /missing/i.test(v.version));
    const wallpaperCount = wallpaperRows().reduce((a,b) => a + number(b.value), 0);
    return [
      row("Feature usage", state.rows.feature.length, "FeatureUsage.csv rows", "", ""),
      row("User usage", state.rows.users.length, "UserUsage.csv rows", "", ""),
      row("Wallpaper usage", wallpaperCount, wallpaperCount ? "customization_usage.csv rows" : "No selections yet", "", ""),
      row("Versions", versionMissing ? "Check" : "Current", "Version files synced", "", "")
    ].join("");
  }

  function metric(label, value, hint) { return `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-hint">${esc(hint || "")}</div></div>`; }
  function panel(title, body) { return `<article class="panel"><div class="panel-head"><h2>${esc(title)}</h2></div><div class="panel-body">${body || empty("No data.")}</div></article>`; }
  function row(title, value, sub, cls = "", attrs = "") { return `<div class="row ${cls}" ${attrs}><div><div class="title">${esc(title || "Unknown")}</div><div class="sub">${esc(sub || "")}</div></div><div class="value">${value}</div></div>`; }
  function barRow(title, display, max, raw = display, attrs = "") { const width = max ? Math.max(2, Math.round((number(raw) / number(max)) * 100)) : 0; return `<div class="row clickable" ${attrs}><div><div class="title">${esc(title)}</div><div class="bar"><span style="width:${width}%"></span></div></div><div class="value">${display}</div></div>`; }
  function userBarRow(item, items, sub) {
    const scale = outlierScale(items, item);
    const width = Math.min(100, Math.max(2, Math.round((item.value / scale) * 100)));
    const outlierClass = isTopOutlier(items, item) ? " outlier" : "";
    return `<div class="row clickable" data-user="${escAttr(item.key)}"><div><div class="title">${esc(item.key)}</div><div class="sub">${esc(sub || "")}</div><div class="bar${outlierClass}"><span style="width:${width}%"></span></div></div><div class="value">${fmtDuration(item.value)}</div></div>`;
  }
  function outlierScale(items, item) {
    if (!items || items.length < 2) return Math.max(1, item.value);
    const sorted = items.slice().sort((a, b) => b.value - a.value);
    const top = sorted[0].value;
    const second = Math.max(1, sorted[1].value);
    if (top >= second * 2 && item.value !== top) return second;
    return Math.max(1, top);
  }
  function isTopOutlier(items, item) {
    if (!items || items.length < 2) return false;
    const sorted = items.slice().sort((a, b) => b.value - a.value);
    return item.value === sorted[0].value && sorted[0].value > Math.max(1, sorted[1].value) * 2;
  }
  function listWithOutlier(items, fn) { return items && items.length ? items.map(fn).join("") : empty("No matching data."); }
  function list(items, fn) { return items && items.length ? items.map(fn).join("") : empty("No matching data."); }
  function empty(text) { return `<div class="empty">${esc(text)}</div>`; }
  function table(headers, items, rowFn, attrFn, className = "") {
    if (!items || !items.length) return empty("No matching rows.");
    return `<div class="table-wrap ${className}"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${items.map(item => {
      const attrs = attrFn ? attrFn(item) : "";
      return `<tr class="${attrs ? "clickable" : ""}" ${attrs}>${rowFn(item).map(v => `<td>${v}</td>`).join("")}</tr>`;
    }).join("")}</tbody></table></div>`;
  }
  function kv(k, v) { return `<div class="kv"><span>${esc(k)}</span><span>${typeof v === "string" && v.includes("<") ? v : esc(v || "")}</span></div>`; }
  function statusBadge(v) { const s = clean(v) || "Unknown"; const c = /active|fixed|current/i.test(s) ? "ok" : /inactive|working|follow|ack/i.test(s) ? "warn" : /blocked|outdated|new|unknown/i.test(s) ? "bad" : ""; return `<span class="badge ${c}">${esc(s)}</span>`; }
  function link(v) { const url = clean(v); return url ? `<a href="${escAttr(url)}" target="_blank" rel="noopener">${esc(url)}</a>` : ""; }

  function aggregate(rows, keyFn, valueFn) {
    const map = new Map();
    rows.forEach(r => {
      const key = clean(keyFn(r)) || "Unknown";
      const item = map.get(key) || { key, value: 0, count: 0 };
      item.value += number(valueFn(r));
      item.count += 1;
      map.set(key, item);
    });
    return [...map.values()].sort((a,b) => b.value - a.value || a.key.localeCompare(b.key));
  }
  function aggregateUsers(rows) {
    const display = new Map();
    rows.forEach(r => {
      const raw = clean(r.Username);
      if (!raw) return;
      const key = raw.toLowerCase();
      if (!display.has(key) || raw === raw.toUpperCase()) display.set(key, raw);
    });
    return aggregate(rows, r => clean(r.Username).toLowerCase(), r => r.seconds).map(x => ({ ...x, key: display.get(x.key) || x.key }));
  }
  function aggregateAvg(rows, keyFn, valueFn) { return aggregate(rows, keyFn, valueFn).map(x => ({ ...x, value: x.count ? x.value / x.count : 0 })); }
  function aggregateBy(rows, keyFn, uniqueFn) {
    const map = new Map();
    rows.forEach(r => {
      const key = clean(keyFn(r)); if (!key) return;
      const set = map.get(key) || new Set();
      set.add(uniqueFn(r));
      map.set(key, set);
    });
    return [...map.entries()].map(([key, set]) => ({ key, value: set.size })).sort((a,b) => a.key.localeCompare(b.key));
  }
  function wallpaperRows() {
    return aggregate(state.rows.wallpaper.filter(r => clean(r.name) && !/^wallpaper$/i.test(r.name)), r => r.name, () => 1);
  }
  function quickLinkRows() {
    return aggregate(state.rows.quickLinkUsage.filter(r => inRange(r.date, maxDate(state.rows.quickLinkUsage, "date"))), r => r.LinkName, r => r.clicks).map(x => ({ ...x, lastClicked: maxDate(state.rows.quickLinkUsage.filter(r => eq(r.LinkName, x.key)), "date") }));
  }
  function outdatedUsers() { return state.rows.users.filter(u => clean(u.AssemblyVersion) && clean(latestVersion(u.Build)) && !eq(u.AssemblyVersion, latestVersion(u.Build))); }
  function openFeedback() { return state.rows.feedback.filter(f => !/fixed/i.test(f.Status)); }
  function latestVersion(build) { return clean((state.rows.versions.find(v => eq(v.build, build)) || {}).version).replace(/^v/i, ""); }
  function latestUserRow(user) { return state.rows.users.filter(u => eq(u.Username, user)).sort((a,b) => b.lastSeen - a.lastSeen)[0] || {}; }
  function latestMachineRow(machine) { return state.rows.users.filter(u => eq(u.Machine, machine)).sort((a,b) => b.lastSeen - a.lastSeen)[0] || {}; }
  function machineMeta(machine) { return state.rows.machines.find(m => eq(m.Machine, machine)) || {}; }
  function userMachines(user) { return unique([...state.rows.users.filter(u => eq(u.Username, user)).map(u => u.Machine), ...state.rows.feature.filter(r => eq(r.Username, user)).map(r => r.Machine)]).filter(Boolean); }
  function userSummary(user, rows) {
    const userRows = rows.filter(r => eq(r.Username, user));
    const forms = unique(userRows.map(r => r.FormName)).length;
    const latest = maxDate(userRows, "date");
    const parts = [];
    parts.push(`${forms} form${forms === 1 ? "" : "s"}`);
    if (latest instanceof Date && !Number.isNaN(latest.getTime())) parts.push(`last ${shortDate(latest)}`);
    return parts.join(" • ");
  }
  function machineSeconds(machine) { return sum(formRows().filter(r => eq(r.Machine, machine)), r => r.seconds); }
  function formSummary(form, rows) {
    const formItems = rows.filter(r => eq(r.FormName, form));
    const users = unique(formItems.map(r => r.Username)).length;
    const latest = maxDate(formItems, "date");
    const parts = [];
    if (users) parts.push(`${users} user${users === 1 ? "" : "s"}`);
    if (latest instanceof Date && !Number.isNaN(latest.getTime())) parts.push(`last ${shortDate(latest)}`);
    return parts.join(" • ");
  }
  function groupMembers(group) { return state.rows.machines.filter(m => clean(m.Groups).split(/[|;,]/).map(x => x.trim()).some(x => eq(x, group))).map(m => m.Machine); }
  function recentRows(rows, n) { return rows.slice().sort((a,b) => b.date - a.date).slice(0, n); }
  function counts() { return { feature: state.rows.feature?.length || 0, users: state.rows.users?.length || 0, feedback: state.rows.feedback?.length || 0 }; }
  function maxOf(items) { return Math.max(1, ...items.map(x => number(x.value))); }
  function maxDate(rows, prop) { const dates = rows.map(r => r[prop]).filter(d => d instanceof Date && !Number.isNaN(d.getTime())); return dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date(); }
  function inRange(date, max) { if (state.range === "all") return true; if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false; const days = number(state.range); const start = new Date(max); start.setDate(start.getDate() - days + 1); start.setHours(0,0,0,0); const end = new Date(max); end.setHours(23,59,59,999); return date >= start && date <= end; }
  function matchBuild(build) { return state.build === "All Builds" || eq(build, state.build); }
  function matchesSearch(values) { const q = clean(state.search).toLowerCase(); return !q || values.join(" ").toLowerCase().includes(q); }
  function setActiveButtons() {
    el.ranges.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.range === state.range));
    el.tabs.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.view === state.view));
    el.build.value = state.build;
    el.search.value = state.search;
  }
  function wireClicks() {
    document.querySelectorAll("[data-user]").forEach(x => x.addEventListener("click", () => { state.selectedUser = x.dataset.user; state.view = "users"; render(); }));
    document.querySelectorAll("[data-form]").forEach(x => x.addEventListener("click", () => { state.selectedForm = x.dataset.form; state.view = "forms"; render(); }));
    document.querySelectorAll("[data-machine]").forEach(x => x.addEventListener("click", () => { state.selectedMachine = x.dataset.machine; state.view = "machines"; render(); }));
    document.querySelectorAll("[data-feedback]").forEach(x => x.addEventListener("click", () => { state.selectedFeedback = x.dataset.feedback; renderFeedback(); }));
  }

  function clean(v) { return String(v ?? "").trim(); }
  function first(...values) { return values.find(v => clean(v)); }
  function lastValue(o) { const values = Object.values(o).map(clean).filter(Boolean); return values[values.length - 1] || ""; }
  function number(v) { const n = Number(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; }
  function sum(rows, fn) { return rows.reduce((a, r) => a + number(fn(r)), 0); }
  function unique(items) { return [...new Set(items.map(clean).filter(Boolean))]; }
  function uniqueValue(...items) { return items.map(clean).join("|"); }
  function eq(a, b) { return clean(a).toLowerCase() === clean(b).toLowerCase(); }
  function dateValue(v) { const d = new Date(clean(v).replace(" ", "T")); return Number.isNaN(d.getTime()) ? new Date("") : d; }
  function fmtDate(d) { return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toLocaleString() : ""; }
  function shortDate(d) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
    const h = d.getHours();
    const hour = h % 12 || 12;
    const minute = String(d.getMinutes()).padStart(2, "0");
    const suffix = h >= 12 ? "p" : "a";
    return `${d.getMonth() + 1}/${d.getDate()} ${hour}:${minute}${suffix}`;
  }
  function fmtDuration(seconds) { const mins = Math.round(number(seconds) / 60); if (!mins) return "0m"; return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`; }
  function pct(part, total) { return total ? `${Math.round((part / total) * 100)}% of tracked time` : "n/a"; }
  function dayKey(d) { return d instanceof Date && !Number.isNaN(d.getTime()) ? `${d.getMonth()+1}/${d.getDate()}` : ""; }
  function dayName(d) { return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { weekday: "long" }) : "Unknown"; }
  function esc(v) { return String(v ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[ch])); }
  function escAttr(v) { return esc(v).replace(/`/g, "&#96;"); }

  el.refresh.addEventListener("click", load);
  el.ranges.addEventListener("click", e => { if (e.target.dataset.range) { state.range = e.target.dataset.range; render(); } });
  el.tabs.addEventListener("click", e => { if (e.target.dataset.view) { state.view = e.target.dataset.view; render(); } });
  el.build.addEventListener("change", e => { state.build = e.target.value; render(); });
  el.search.addEventListener("input", e => { state.search = e.target.value; render(); });
  load().catch(err => {
    el.status.textContent = "Dashboard load failed.";
    el.content.innerHTML = empty(err.message || "Unknown error");
  });
})();
