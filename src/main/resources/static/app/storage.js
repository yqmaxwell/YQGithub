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

  window.JarDiff = window.JarDiff || {}
  window.JarDiff.storage = { load, save, clear, KEY }
})()
