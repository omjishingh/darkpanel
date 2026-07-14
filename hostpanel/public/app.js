(function () {
  const API = location.origin;
  let token = localStorage.getItem("hp_token") || "";
  let cache = null;
  let consoleAppId = "";

  const $ = (id) => document.getElementById(id);
  const show = (el, on) => {
    if (typeof el === "string") el = $(el);
    if (el) el.classList.toggle("hidden", !on);
  };

  function toast(msg, err) {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast " + (err ? "err" : "ok");
    show(el, true);
    setTimeout(() => show(el, false), 4000);
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied!");
    } catch (_) {
      toast("Copy failed", true);
    }
  }

  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = "Bearer " + token;
    if (opts.body && !(opts.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(API + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function logout() {
    token = "";
    localStorage.removeItem("hp_token");
    show("appView", false);
    show("loginView", true);
  }

  async function doLogin() {
    const username = $("loginUser").value.trim();
    const password = $("loginPass").value;
    $("loginErr").classList.add("hidden");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      token = data.token;
      localStorage.setItem("hp_token", token);
      enterApp(data.username);
    } catch (e) {
      $("loginErr").textContent = e.message;
      $("loginErr").classList.remove("hidden");
    }
  }

  function enterApp(username) {
    show("loginView", false);
    show("appView", true);
    $("sidebarUser").textContent = username;
    loadDashboard();
  }

  function switchTab(tab) {
    document.querySelectorAll(".nav-btn[data-tab]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    show("tabDashboard", tab === "dashboard");
    show("tabDeploy", tab === "deploy");
    show("tabLogs", tab === "logs");
    if (tab === "logs") renderHistory();
  }

  function badgeClass(status) {
    if (status === "online") return "online";
    if (status === "not_found") return "not_found";
    return "stopped";
  }

  function formatDeploySteps(steps) {
    if (!steps || !steps.length) return "";
    return steps.map((s) => "$ " + s.cmd + "\n" + (s.out || "")).join("\n\n");
  }

  function renderApps(data) {
    const grid = $("appsGrid");
    const apps = data?.apps || [];
    if (!apps.length) {
      grid.innerHTML = '<div class="empty">No apps yet — Deploy New se bot add karo</div>';
      return;
    }
    grid.innerHTML = apps
      .map((a) => {
        const whBlock =
          a.source === "git" && a.webhookUrl
            ? `<div class="wh-block">
            <label>Auto-deploy link (GitHub webhook)</label>
            <div class="wh-row">
              <input type="text" readonly class="wh-input" value="${esc(a.webhookUrl)}" />
              <button type="button" class="btn-sm copy-wh" data-url="${esc(a.webhookUrl)}">Copy</button>
            </div>
            <p class="hint">GitHub → Settings → Webhooks → paste URL → Push events</p>
          </div>`
            : "";
        return `<div class="app-card" data-id="${esc(a.id)}">
        <div class="app-card-head">
          <div><h3>${esc(a.name)}</h3><p class="muted">${esc(a.id)} · ${esc(a.type)} · ${esc(a.source)}</p></div>
          <span class="badge ${badgeClass(a.status)}">${esc(a.status)}</span>
        </div>
        <div class="app-meta">
          <span>PM2: <b>${esc(a.runningPm2Name || a.pm2Name || a.id)}</b></span>
          <span>RAM ${esc(fmtBytes(a.memory))}</span>
          <span>${esc(a.startScript)}</span>
        </div>
        <div class="deps-pill">${esc(a.autoDeps || "—")}</div>
        ${whBlock}
        <div class="app-actions">
          <button class="btn-sm" data-act="open" data-id="${esc(a.id)}">Console</button>
          <button class="btn-sm btn-accent-sm" data-act="deploy" data-id="${esc(a.id)}">Deploy</button>
          <button class="btn-sm" data-act="restart" data-id="${esc(a.id)}">Restart</button>
          <button class="btn-sm danger" data-act="stop" data-id="${esc(a.id)}">Stop</button>
        </div>
      </div>`;
      })
      .join("");

    grid.querySelectorAll("[data-act]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        if (act === "open") openConsole(id);
        else if (act === "deploy") runDeploy(id);
        else if (act === "restart") runAction(id, "restart");
        else if (act === "stop") runAction(id, "stop");
      };
    });
    grid.querySelectorAll(".copy-wh").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        copyText(btn.dataset.url || "");
      };
    });
    grid.querySelectorAll(".app-card").forEach((card) => {
      card.onclick = () => openConsole(card.dataset.id);
    });
  }

  function renderHistory() {
    const el = $("deployHistory");
    const logs = cache?.deployLogs || [];
    if (!logs.length) {
      el.innerHTML = '<div class="empty">No deploys yet</div>';
      return;
    }
    el.innerHTML = logs
      .map((l) => {
        const steps = (l.steps || [])
          .map((s) => `<li><b>${esc(s.cmd)}</b></li>`)
          .join("");
        return `<div class="deploy-row ${l.ok ? "ok" : "fail"}">
        <div><b>${esc(l.appName || l.appId)}</b> · ${esc(l.trigger || "manual")}</div>
        <div class="sub">${esc(new Date(l.at).toLocaleString())}${l.error ? " · " + esc(l.error) : " · success"}</div>
        ${steps ? `<ul class="step-list">${steps}</ul>` : ""}
      </div>`;
      })
      .join("");
  }

  async function loadDashboard() {
    try {
      cache = await api("/api/apps");
      $("serverInfo").textContent =
        (cache.apps?.length || 0) +
        " apps · Auto: requirements.txt → pip, package.json → npm · " +
        (cache.publicUrl || "");
      renderApps(cache);
      renderHistory();
    } catch (e) {
      if (e.message.includes("Unauthorized") || e.message.includes("Invalid")) logout();
      else toast(e.message, true);
    }
  }

  function showDeployResult(id, log) {
    const app = (cache?.apps || []).find((a) => a.id === id);
    const header = [
      "=== DEPLOY " + (log.ok ? "OK" : "FAILED") + " ===",
      app?.webhookUrl ? "Webhook: " + app.webhookUrl : "",
      "",
      formatDeploySteps(log.steps),
      log.error ? "\nERROR: " + log.error : "",
    ]
      .filter(Boolean)
      .join("\n");
    $("consoleBody").textContent = header;
    show("consoleDrawer", true);
    $("consoleTitle").textContent = (app?.name || id) + " — Deploy output";
    consoleAppId = id;
  }

  async function runDeploy(id) {
    toast("Deploying " + id + " — deps install + PM2 start…");
    try {
      const data = await api("/api/apps/" + id + "/deploy", { method: "POST" });
      showDeployResult(id, data.log || {});
      toast(data.log?.ok ? "Deployed " + id : "Deploy failed", !data.log?.ok);
      await loadDashboard();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function runAction(id, action) {
    try {
      await api("/api/apps/" + id + "/" + action, { method: "POST" });
      toast(action + " — " + id);
      await loadDashboard();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function openConsole(id) {
    consoleAppId = id;
    const app = (cache?.apps || []).find((a) => a.id === id);
    $("consoleTitle").textContent = (app?.name || id) + " — Console";
    show("consoleDrawer", true);
    const lines = [
      app?.webhookUrl ? "Auto-deploy webhook:\n" + app.webhookUrl : "",
      app?.autoDeps ? "Auto deps: " + app.autoDeps : "",
      "",
      "--- LOGS ---",
    ];
    try {
      const data = await api("/api/apps/" + id + "/logs?lines=150");
      $("consoleBody").textContent = lines.filter(Boolean).join("\n") + "\n" + (data.text || "No logs");
    } catch (e) {
      $("consoleBody").textContent = lines.join("\n") + "\nError: " + e.message;
    }
  }

  async function refreshConsoleLogs() {
    if (!consoleAppId) return;
    await openConsole(consoleAppId);
  }

  async function uploadZip() {
    const file = $("zipFile").files[0];
    if (!file) return toast("ZIP file select karo", true);
    const fd = new FormData();
    fd.append("zip", file);
    fd.append("id", $("zipId").value.trim());
    fd.append("name", $("zipName").value.trim());
    fd.append("startScript", $("zipStart").value.trim());
    fd.append("type", $("zipType").value);
    $("zipStatus").textContent = "Upload → extract → pip/npm install → PM2 start…";
    $("btnUploadZip").disabled = true;
    try {
      const data = await api("/api/apps/upload", { method: "POST", body: fd });
      $("zipStatus").textContent = "Done: " + (data.app?.name || "OK");
      if (data.log) showDeployResult(data.app?.id || $("zipId").value.trim(), data.log);
      toast("ZIP deployed — requirements auto-installed");
      $("zipFile").value = "";
      switchTab("dashboard");
      await loadDashboard();
    } catch (e) {
      $("zipStatus").textContent = "Error: " + e.message;
      toast(e.message, true);
    } finally {
      $("btnUploadZip").disabled = false;
    }
  }

  async function addGit() {
    const payload = {
      id: $("gitId").value.trim(),
      name: $("gitName").value.trim(),
      repo: $("gitRepo").value.trim(),
      branch: $("gitBranch").value.trim() || "main",
      startScript: $("gitStart").value.trim(),
      type: $("gitType").value,
      source: "git",
    };
    try {
      const created = await api("/api/apps", { method: "POST", body: JSON.stringify(payload) });
      const dep = await api("/api/apps/" + created.app.id + "/deploy", { method: "POST" });
      if (dep.log) showDeployResult(created.app.id, dep.log);
      toast("Git deployed — webhook card me copy karo");
      switchTab("dashboard");
      await loadDashboard();
    } catch (e) {
      toast(e.message, true);
    }
  }

  function init() {
    $("btnLogin").onclick = doLogin;
    $("btnLogout").onclick = logout;
    $("btnRefresh").onclick = loadDashboard;

    document.querySelectorAll(".nav-btn[data-tab]").forEach((b) => {
      b.onclick = () => switchTab(b.dataset.tab);
    });

    document.querySelectorAll(".dtab").forEach((t) => {
      t.onclick = () => {
        document.querySelectorAll(".dtab").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        show("modeZip", t.dataset.mode === "zip");
        show("modeGit", t.dataset.mode === "git");
      };
    });

    $("btnUploadZip").onclick = uploadZip;
    $("btnAddGit").onclick = addGit;
    $("btnCloseConsole").onclick = () => show("consoleDrawer", false);
    $("btnConsoleDeploy").onclick = () => consoleAppId && runDeploy(consoleAppId);
    $("btnConsoleRestart").onclick = () => consoleAppId && runAction(consoleAppId, "restart");
    $("btnConsoleStop").onclick = () => consoleAppId && runAction(consoleAppId, "stop");
    $("btnConsoleRefreshLogs").onclick = refreshConsoleLogs;

    if (token) {
      api("/api/auth/me")
        .then((d) => enterApp(d.username))
        .catch(logout);
    }
  }

  init();
})();
