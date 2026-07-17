;(function () {
  window.JarDiff = window.JarDiff || {}
  window.JarDiff.ui = window.JarDiff.ui || {}

  function filterOutHunkGaps(rows, showDiffOnly) {
    if (showDiffOnly) return rows
    return (rows || []).filter((r) => !(r && r.kind === 'gap' && (r.gapType === 'hunkHeader' || r.gapType === 'hunkCollapsed')))
  }

  function scrollPaneToRowIndex(pane, rowIndex) {
    if (!pane || !Number.isFinite(rowIndex)) return
    const exact = pane.querySelector('[data-row-index="' + rowIndex + '"]')
    if (exact) {
      const targetTop = Math.max(0, exact.offsetTop - pane.clientHeight * 0.35)
      pane.scrollTop = targetTop
      return
    }
    const nodes = Array.from(pane.querySelectorAll('[data-row-index]'))
    if (!nodes.length) return
    let best = null
    let bestDelta = Infinity
    for (const n of nodes) {
      const k = n.getAttribute('data-row-index')
      const v = k == null ? NaN : Number(k)
      if (!Number.isFinite(v)) continue
      const d = Math.abs(v - rowIndex)
      if (d < bestDelta) {
        bestDelta = d
        best = n
      }
      if (d === 0) break
    }
    if (!best) return
    const targetTop = Math.max(0, best.offsetTop - pane.clientHeight * 0.35)
    pane.scrollTop = targetTop
  }

  function buildMinimapMarksFromDiff(d) {
    if (!d || d.kind !== 'text' || !Array.isArray(d.rows) || !d.rows.length) return []
    const total = d.rows.length
    if (!Array.isArray(d.hunks) || !d.hunks.length) return []
    const leftMap = new Map()
    const rightMap = new Map()
    for (const hi of d.highlights || []) {
      if (!hi || !hi.side || !hi.type || !Number.isFinite(hi.line)) continue
      if (hi.side === 'left') leftMap.set(hi.line, hi.type)
      if (hi.side === 'right') rightMap.set(hi.line, hi.type)
    }
    const out = []
    for (const h of d.hunks) {
      const startRow = Number.isFinite(h && h.startRow) ? h.startRow : 0
      const endRow = Number.isFinite(h && h.endRow) ? h.endRow : startRow
      const s = Math.max(0, Math.min(total - 1, startRow))
      const e = Math.max(0, Math.min(total - 1, endRow))
      let hasAdd = false
      let hasDel = false
      let hasMod = false
      for (let i = s; i <= e; i++) {
        const r = d.rows[i] || {}
        const lt = r.leftNo ? leftMap.get(r.leftNo) || '' : ''
        const rt = r.rightNo ? rightMap.get(r.rightNo) || '' : ''
        const a = lt === 'add' || rt === 'add'
        const de = lt === 'del' || rt === 'del'
        const m = lt === 'mod' || rt === 'mod'
        if (a) hasAdd = true
        if (de) hasDel = true
        if (m) hasMod = true
        if (hasMod && hasAdd && hasDel) break
      }
      const kind = hasMod ? 'modified' : hasAdd && hasDel ? 'mixed' : hasAdd ? 'added' : hasDel ? 'missing' : 'modified'
      const top = (s / total) * 100
      const height = Math.max((1 / total) * 100, ((e - s + 1) / total) * 100)
      out.push({
        key: 'h' + (Number.isFinite(h && h.index) ? h.index : out.length),
        rowIndex: s,
        top,
        height,
        kind
      })
    }
    return out
  }

  window.JarDiff.ui.filterOutHunkGaps = filterOutHunkGaps
  window.JarDiff.ui.scrollPaneToRowIndex = scrollPaneToRowIndex
  window.JarDiff.ui.buildMinimapMarksFromDiff = buildMinimapMarksFromDiff
})()
