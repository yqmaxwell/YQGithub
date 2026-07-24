;(function () {
  const KEY = 'jardiff:state:v1'

  function safeJsonParse(s) {
    try {
      return JSON.parse(s)
    } catch (e) {
      return null
    }
  }

  function load() {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = safeJsonParse(raw)
    if (!data || typeof data !== 'object') return null
    return data
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data || {}))
  }

  function clear() {
    localStorage.removeItem(KEY)
  }

  function get(key) {
    const data = load()
    return data ? data[key] : undefined
  }

  function set(key, value) {
    const data = load() || {}
    data[key] = value
    save(data)
  }

  window.JarDiff = window.JarDiff || {}
  window.JarDiff.storage = { load, save, clear, get, set, KEY }
})()
