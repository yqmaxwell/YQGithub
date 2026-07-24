;(function () {
  async function fetchJson(url, init) {
    const resp = await fetch(url, init)
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      const msg = text && text.length < 200 ? text : ''
      throw new Error('请求失败：' + resp.status + (msg ? ' ' + msg : ''))
    }
    return await resp.json()
  }

  /**
   * 使用 XMLHttpRequest 发送上传请求，以便在前端拿到 upload progress。
   * @param {string} url
   * @param {FormData} fd
   * @param {(loaded:number,total:number,evt:ProgressEvent)=>void=} onProgress
   * @returns {Promise<any>}
   */
  function uploadJson(url, fd, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', url, true)
      xhr.responseType = 'text'

      xhr.upload.onprogress = (evt) => {
        if (typeof onProgress !== 'function') return
        const loaded = evt && typeof evt.loaded === 'number' ? evt.loaded : 0
        const total = evt && typeof evt.total === 'number' ? evt.total : 0
        onProgress(loaded, total, evt)
      }

      xhr.onerror = () => reject(new Error('请求失败：网络错误'))
      xhr.onabort = () => reject(new Error('请求失败：已取消'))
      xhr.onload = () => {
        const status = xhr.status || 0
        const ok = status >= 200 && status < 300
        const text = typeof xhr.responseText === 'string' ? xhr.responseText : ''
        if (!ok) {
          const msg = text && text.length < 200 ? text : ''
          reject(new Error('请求失败：' + status + (msg ? ' ' + msg : '')))
          return
        }
        try {
          resolve(text ? JSON.parse(text) : {})
        } catch (e) {
          reject(new Error('请求失败：响应解析错误'))
        }
      }

      xhr.send(fd)
    })
  }

  async function compareJars(fd, onProgress) {
    return await uploadJson('/api/compare/jars', fd, onProgress)
  }

  async function compareDirectorySummary(fd, onProgress) {
    return await uploadJson('/api/compare/directory/summary', fd, onProgress)
  }

  async function compareDirectory(fd, onProgress) {
    return await uploadJson('/api/compare/directory', fd, onProgress)
  }

  async function compareDirectoryByPath(fd) {
    return await fetchJson('/api/compare/directory/path', { method: 'POST', body: fd })
  }

  async function loadDiff(id, path) {
    const url =
      '/api/compare/diff?id=' + encodeURIComponent(id) + '&path=' + encodeURIComponent(path || '')
    return await fetchJson(url)
  }

  async function warmDiffs(id, limit) {
    const url =
      '/api/compare/diff/warm?id=' +
      encodeURIComponent(id) +
      '&limit=' +
      encodeURIComponent(String(limit == null ? 300 : limit))
    return await fetchJson(url, { method: 'POST' })
  }

  async function warmDiffStatus(id) {
    const url = '/api/compare/diff/warm/status?id=' + encodeURIComponent(id)
    return await fetchJson(url)
  }

  /**
   * 获取后端限制上限（用于前端设置面板的最大值联动与校验）
   * @returns {Promise<{maxJarMb:number,maxDirFiles:number,maxDirMb:number,maxWarmupDiffs:number,defaultWarmupDiffs:number}>}
   */
  async function getLimits() {
    return await fetchJson('/api/compare/limits')
  }

  async function loadReportV2(id) {
    const url = '/api/compare/report.v2.json?id=' + encodeURIComponent(id)
    return await fetchJson(url)
  }

  async function loadNestedTree(id, outer) {
    const url =
      '/api/compare/nested/tree?id=' + encodeURIComponent(id) + '&outer=' + encodeURIComponent(outer || '')
    return await fetchJson(url)
  }

  /**
   * 获取统一差异格式文本，供 diff2html 渲染。
   */
  async function loadUnifiedDiff(id, path) {
    const url =
      '/api/compare/diff/unified?id=' + encodeURIComponent(id) + '&path=' + encodeURIComponent(path || '')
    const resp = await fetch(url)
    if (!resp.ok) throw new Error('请求失败：' + resp.status)
    return await resp.text()
  }

  /**
   * 上传两个文件进行比对（支持 .class 反编译）。
   */
  async function compareFiles(fd, onProgress) {
    return await uploadJson('/api/compare/files', fd, onProgress)
  }

  /**
   * 直接获取两个文件比对的统一差异格式文本。
   */
  async function loadFilesUnifiedDiff(leftFile, rightFile) {
    const fd = new FormData()
    fd.append('left', leftFile)
    fd.append('right', rightFile)
    const resp = await fetch('/api/compare/files/unified', { method: 'POST', body: fd })
    if (!resp.ok) throw new Error('请求失败：' + resp.status)
    return await resp.text()
  }

  window.JarDiff = window.JarDiff || {}
  window.JarDiff.api = {
    compareJars,
    compareDirectorySummary,
    compareDirectory,
    compareDirectoryByPath,
    loadDiff,
    warmDiffs,
    warmDiffStatus,
    getLimits,
    loadReportV2,
    loadNestedTree,
    loadUnifiedDiff,
    compareFiles,
    loadFilesUnifiedDiff
  }
})()
