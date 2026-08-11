;(function () {
  function mapStatusBadge(status) {
    if (status === 'added') return { type: 'success', text: '新增' }
    if (status === 'missing') return { type: 'danger', text: '缺失' }
    if (status === 'modified') return { type: 'warning', text: '修改' }
    if (status === 'meta') return { type: 'info', text: '元信息' }
    return { type: 'info', text: '无变化' }
  }

  function mapStructureBadge(side, status) {
    if (side === 'right' && status === 'missing') return { type: 'danger', text: '缺失' }
    if (side === 'right' && status === 'added') return { type: 'success', text: '新增' }
    if (side === 'right' && status === 'modified') return { type: 'warning', text: '修改' }
    if (side === 'right' && status === 'meta') return { type: 'info', text: '元信息' }
    return { type: 'info', text: '一致' }
  }

  function flattenChanged(tree) {
    const list = []
    ;(function walk(nodes) {
      for (const n of nodes || []) {
        if (n && (n.type === 'file' || n.type === 'jar')) {
          const s = n.rightStatus || 'unchanged'
          if (s !== 'unchanged') list.push({ path: n.value, status: s })
        }
        if (n && Array.isArray(n.children) && n.children.length) walk(n.children)
      }
    })(tree || [])
    list.sort((a, b) => a.path.localeCompare(b.path))
    return list
  }

  function findFirstFile(tree) {
    for (const n of tree || []) {
      if (n && n.type === 'file') return n.value
      if (n && Array.isArray(n.children) && n.children.length) {
        const c = findFirstFile(n.children)
        if (c) return c
      }
    }
    return ''
  }

  function splitIgnoreGlobs(raw) {
    if (raw == null) return []
    const s = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const parts = s.split(/[\n,;]+/)
    const out = []
    for (const p of parts) {
      const v = String(p || '').trim()
      if (v) out.push(v)
    }
    return out
  }

  function matchesGlob(glob, text) {
    if (!glob || !text) return false
    const g = String(glob).replace(/\\/g, '/').trim()
    const t = String(text).replace(/\\/g, '/')
    let gi = 0
    let ti = 0
    let star = -1
    let mark = -1
    while (ti < t.length) {
      if (gi < g.length) {
        const gc = g.charAt(gi)
        if (gc === '?') {
          gi += 1
          ti += 1
          continue
        }
        if (gc === '*') {
          while (gi + 1 < g.length && g.charAt(gi + 1) === '*') gi += 1
          star = gi
          gi += 1
          mark = ti
          continue
        }
        if (gc === t.charAt(ti)) {
          gi += 1
          ti += 1
          continue
        }
      }
      if (star !== -1) {
        gi = star + 1
        mark += 1
        ti = mark
        continue
      }
      return false
    }
    while (gi < g.length && g.charAt(gi) === '*') gi += 1
    return gi === g.length
  }

  function isIgnoredByGlobs(path, globs) {
    if (!path || !globs || !globs.length) return false
    const p = String(path)
    const idx = p.indexOf('!/')
    const inner = idx >= 0 ? p.slice(idx + 2) : ''
    for (const gg of globs) {
      const g = String(gg || '').trim()
      if (!g) continue
      if (matchesGlob(g, p)) return true
      if (inner && matchesGlob(g, inner)) return true
    }
    return false
  }

  /**
   * 将后端返回的对齐行（rows）转换为前端渲染行（含省略段、差异类型与激活行）
   */
  function buildDiffRows(d, showDiffOnly, activeRowIndex, collapsedHunks) {
    if (!d || d.kind !== 'text') return []
    const base = Array.isArray(d.rows) && d.rows.length ? d.rows : []

    /**
     * 将空字符串转换为不可断行空格，保证“新增/缺失占位行”在渲染时仍有稳定的可视高度
     * @param {any} v
     * @returns {string}
     */
    function renderText(v) {
      const s = v == null ? '' : String(v)
      return s === '' ? '\u00A0' : s
    }

    const leftMap = new Map()
    const rightMap = new Map()
    for (const h of d.highlights || []) {
      if (!h || !h.side || !h.type || !Number.isFinite(h.line)) continue
      if (h.side === 'left') leftMap.set(h.line, h.type)
      if (h.side === 'right') rightMap.set(h.line, h.type)
    }

    function pushRow(rows, i) {
      const r = base[i] || {}
      const leftNo = r.leftNo ?? null
      const rightNo = r.rightNo ?? null
      let leftType = leftNo ? leftMap.get(leftNo) || '' : ''
      let rightType = rightNo ? rightMap.get(rightNo) || '' : ''
      rows.push({
        kind: 'row',
        rowIndex: i,
        leftNo,
        rightNo,
        leftText: renderText(r.leftText),
        rightText: renderText(r.rightText),
        leftType,
        rightType,
        isActive: activeRowIndex === i
      })
    }

    const collapsed = new Set(Array.isArray(collapsedHunks) ? collapsedHunks : [])

    if (showDiffOnly && Array.isArray(d.hunks) && d.hunks.length) {
      const hunks = d.hunks
        .map((h) => ({
          index: Number.isFinite(h && h.index) ? h.index : 0,
          startRow: Number.isFinite(h && h.startRow) ? h.startRow : 0,
          endRow: Number.isFinite(h && h.endRow) ? h.endRow : 0,
          leftStart: Number.isFinite(h && h.leftStart) ? h.leftStart : null,
          leftEnd: Number.isFinite(h && h.leftEnd) ? h.leftEnd : null,
          rightStart: Number.isFinite(h && h.rightStart) ? h.rightStart : null,
          rightEnd: Number.isFinite(h && h.rightEnd) ? h.rightEnd : null
        }))
        .sort((a, b) => a.startRow - b.startRow)

      const rows = []
      let cursor = 0
      for (const h of hunks) {
        const s = Math.max(0, Math.min(base.length - 1, h.startRow))
        const e = Math.max(0, Math.min(base.length - 1, h.endRow))
        if (cursor < s) rows.push({ kind: 'gap', gapType: 'omitted', from: cursor, to: s - 1, count: s - cursor })

        rows.push({
          kind: 'gap',
          gapType: 'hunkHeader',
          hunkIndex: h.index,
          from: s,
          to: e,
          count: e - s + 1,
          collapsed: collapsed.has(h.index),
          leftStart: h.leftStart,
          leftEnd: h.leftEnd,
          rightStart: h.rightStart,
          rightEnd: h.rightEnd
        })

        if (collapsed.has(h.index)) {
          rows.push({ kind: 'gap', gapType: 'hunkCollapsed', hunkIndex: h.index, from: s, to: e, count: e - s + 1 })
        } else {
          for (let i = s; i <= e; i++) pushRow(rows, i)
        }
        cursor = e + 1
      }
      if (cursor < base.length) rows.push({ kind: 'gap', gapType: 'omitted', from: cursor, to: base.length - 1, count: base.length - cursor })
      return rows
    }

    const anchors = []
    for (let idx = 0; idx < base.length; idx++) {
      const r = base[idx] || {}
      const lt = r.leftNo ? leftMap.get(r.leftNo) || '' : ''
      const rt = r.rightNo ? rightMap.get(r.rightNo) || '' : ''
      if (lt || rt) anchors.push(idx)
    }

    const keep = new Set()
    if (showDiffOnly && anchors.length) {
      for (const a of anchors) {
        for (let i = Math.max(0, a - 2); i <= Math.min(base.length - 1, a + 2); i++) keep.add(i)
      }
    } else {
      for (let i = 0; i < base.length; i++) keep.add(i)
    }

    const rows = []
    let i = 0
    while (i < base.length) {
      if (!keep.has(i)) {
        const start = i
        while (i < base.length && !keep.has(i)) i++
        const end = i - 1
        rows.push({ kind: 'gap', gapType: 'omitted', from: start, to: end, count: end - start + 1 })
        continue
      }
      pushRow(rows, i)
      i++
    }

    return rows
  }

  window.JarDiff = window.JarDiff || {}
  window.JarDiff.core = {
    mapStatusBadge,
    mapStructureBadge,
    flattenChanged,
    findFirstFile,
    splitIgnoreGlobs,
    matchesGlob,
    isIgnoredByGlobs,
    buildDiffRows
  }
})()
