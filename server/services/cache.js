'use strict';

/**
 * Cache en mémoire simple avec TTL.
 * Évite les requêtes API/scraping répétées dans la même session.
 */

const store = new Map();

/**
 * @param {string} key
 * @param {*} value
 * @param {number} ttlSeconds  durée de vie en secondes (défaut : 5 min)
 */
function set(key, value, ttlSeconds = 300) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000
  });
}

/**
 * @param {string} key
 * @returns {*|null}  null si absent ou expiré
 */
function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function del(key) {
  store.delete(key);
}

function clear() {
  store.clear();
}

function size() {
  return store.size;
}

module.exports = { set, get, del, clear, size };
