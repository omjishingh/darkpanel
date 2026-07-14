const fetch = require("node-fetch");
const https = require("https");
const http = require("http");

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });

function pickAgent(url) {
  return String(url).startsWith("https") ? httpsAgent : httpAgent;
}

function normalizeUrl(url) {
  let normalized = String(url || "").trim().replace(/\/$/, "");
  if (!normalized.startsWith("http")) normalized = "https://" + normalized;
  return normalized;
}

async function firebaseGet(firebaseUrl, firebaseSecret, path, query = {}) {
  const base = normalizeUrl(firebaseUrl);
  const auth = String(firebaseSecret || "").trim();
  const params = new URLSearchParams({ auth, ...query });
  const url = `${base}/${path}.json?${params}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    timeout: 15000,
    agent: pickAgent(base),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error("PERMISSION_DENIED");
    }
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function firebasePut(firebaseUrl, firebaseSecret, path, data) {
  const base = normalizeUrl(firebaseUrl);
  const auth = String(firebaseSecret || "").trim();
  const url = `${base}/${path}.json?auth=${auth}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    agent: pickAgent(base),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error("PERMISSION_DENIED");
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/** Queue to Firebase without waiting for RTT — used by Send Auto for sub-100ms dispatch */
function firebasePutFast(firebaseUrl, firebaseSecret, path, data) {
  const base = normalizeUrl(firebaseUrl);
  const auth = String(firebaseSecret || "").trim();
  const url = `${base}/${path}.json?auth=${auth}`;
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    agent: pickAgent(base),
    timeout: 8000,
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`[firebase fast] PUT ${path} HTTP ${res.status}`, text.slice(0, 120));
      }
    })
    .catch((err) => console.error(`[firebase fast] PUT ${path}`, err.message));
}

async function firebasePatch(firebaseUrl, firebaseSecret, path, data) {
  const base = normalizeUrl(firebaseUrl);
  const auth = String(firebaseSecret || "").trim();
  const url = `${base}/${path}.json?auth=${auth}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error("PERMISSION_DENIED");
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function firebaseDelete(firebaseUrl, firebaseSecret, path) {
  const base = normalizeUrl(firebaseUrl);
  const auth = String(firebaseSecret || "").trim();
  const url = `${base}/${path}.json?auth=${auth}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok && res.status === 403) throw new Error("PERMISSION_DENIED");
}

async function testConnection(firebaseUrl, firebaseSecret) {
  await firebaseGet(firebaseUrl, firebaseSecret, "clients");
  return true;
}

module.exports = {
  firebaseGet,
  firebasePut,
  firebasePutFast,
  firebasePatch,
  firebaseDelete,
  testConnection,
  normalizeUrl,
};
