const fetch = require("node-fetch");

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
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error("PERMISSION_DENIED");
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
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

module.exports = { firebaseGet, firebasePut, firebasePatch, firebaseDelete, testConnection, normalizeUrl };
