;// [AGC:FILE] tool=Cc author=maxwell date=2026-07-24
;(function () {
  const { createApp, ref, reactive, computed, watch, nextTick, onMounted } = Vue

  // --- helpers ---
  function badgeClass(status) {
    return { modified: 'tree-badge--modified', added: 'tree-badge--added', missing: 'tree-badge--missing', meta: 'tree-badge--meta' }[status] || ''
  }

  const app = createApp({
    template: /*html*/`
    <div id="app-root" style="display:flex;flex-direction:column;min-height:100vh">
      <!-- ===== 工具栏 ===== -->
      <div class="toolbar">
        <span class="toolbar__logo">Jar Diff</span>
        <div class="mode-tabs">
          <button v-for="m in modes" :key="m.value" :class="['mode-tab', { 'mode-tab--active': mode === m.value }]" @click="switchMode(m.value)">{{ m.label }}</button>
        </div>
        <span style="flex:0 0 4px"></span>
        <el-upload v-if="mode==='jar'" :auto-upload="false" :limit="1" class="toolbar__file" @change="onJarLeftChange"><el-button class="nbt-btn" size="small">旧版 Jar</el-button></el-upload>
        <el-upload v-if="mode==='jar'" :auto-upload="false" :limit="1" class="toolbar__file" @change="onJarRightChange"><el-button class="nbt-btn" size="small">新版 Jar</el-button></el-upload>
        <span v-if="mode==='dir'" class="toolbar__file"><el-input v-model="dirLeft" placeholder="旧版目录路径" size="small" /></span>
        <span v-if="mode==='dir'" class="toolbar__file"><el-input v-model="dirRight" placeholder="新版目录路径" size="small" /></span>
        <el-upload v-if="mode==='file'" :auto-upload="false" :limit="1" @change="onFileLeftChange"><el-button class="nbt-btn" size="small">旧版文件</el-button></el-upload>
        <el-upload v-if="mode==='file'" :auto-upload="false" :limit="1" @change="onFileRightChange"><el-button class="nbt-btn" size="small">新版文件</el-button></el-upload>
        <el-input v-model="ignoreGlobs" placeholder="忽略规则" size="small" class="toolbar__ignore" />
        <button class="nbt-btn nbt-btn--primary" @click="startCompare" :disabled="comparing">{{ comparing ? '比对中...' : '开始比对' }}</button>
        <button class="nbt-btn" @click="showSettings=!showSettings" style="margin-left:auto" title="高级设置">⚙</button>
        <el-drawer v-model="showSettings" title="高级设置" direction="rtl" size="280px" :z-index="9999">
          <div class="settings-drawer">
            <label><input type="checkbox" v-model="setting.includeClasses" /> 包含 Class 文件</label>
            <label><input type="checkbox" v-model="setting.includeResources" /> 包含资源文件</label>
            <label><input type="checkbox" v-model="setting.includeLib" /> 包含依赖 Jar</label>
          </div>
        </el-drawer>
      </div>

      <!-- ===== 空状态 ===== -->
      <div v-if="!compareId" class="empty-state">
        <div class="empty-state__icon">📦</div>
        <div>选择模式并上传文件开始比对</div>
      </div>

      <!-- ===== 工作区 ===== -->
      <div v-else class="workspace" @mouseup="stopResize">
        <div class="left-panel" :style="{ width: leftWidth + 'px' }">
          <div class="panel-tabs">
            <button :class="['panel-tab', { 'panel-tab--active': leftTab === 'structure' }]" @click="leftTab='structure'">结构比对</button>
            <button :class="['panel-tab', { 'panel-tab--active': leftTab === 'diff' }]" @click="leftTab='diff'">差异比对</button>
          </div>

          <!-- 结构比对 Tab -->
          <div v-show="leftTab==='structure'" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
            <div style="padding:4px 12px;text-align:right;flex-shrink:0">
              <button class="nbt-btn" size="small" @click="structureFull=!structureFull">{{ structureFull ? '退出全宽' : '全宽模式' }}</button>
            </div>
            <div class="structure-compare" style="flex:1">
              <div class="structure-pane">
                <template v-for="node in treeData" :key="'l'+node.value">
                  <tree-node-struct :node="node" side="left" @select="selectFileFromStruct" />
                </template>
              </div>
              <div class="structure-pane">
                <template v-for="node in treeData" :key="'r'+node.value">
                  <tree-node-struct :node="node" side="right" @select="selectFileFromStruct" />
                </template>
              </div>
            </div>
          </div>

          <!-- 差异比对 Tab -->
          <div v-show="leftTab==='diff'" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
            <div class="tree-search">
              <el-input v-model="searchQuery" placeholder="搜索文件..." size="small" clearable />
              <el-select v-model="statusFilter" size="small" style="margin-top:4px;width:100%" placeholder="全部">
                <el-option label="全部" value="all" />
                <el-option label="修改" value="modified" />
                <el-option label="新增" value="added" />
                <el-option label="缺失" value="missing" />
                <el-option label="元信息" value="meta" />
              </el-select>
            </div>
            <div class="file-tree">
              <template v-for="node in filteredTree" :key="node.value">
                <tree-node :node="node" @select="selectFile" @expand-nested="expandNested" />
              </template>
              <div v-if="filteredTree.length===0 && treeData.length>0" style="padding:12px;color:var(--text-muted);text-align:center">没有匹配的文件</div>
            </div>
            <div class="stats-bar">
              <span>修改 <strong>{{ stats.modified }}</strong></span>
              <span>新增 <strong>{{ stats.added }}</strong></span>
              <span>缺失 <strong>{{ stats.missing }}</strong></span>
              <span>元信息 <strong>{{ stats.meta }}</strong></span>
            </div>
          </div>
        </div>

        <div class="resizer" @mousedown="startResize"></div>

        <div class="right-panel">
          <div v-if="!selectedPath" class="empty-state">
            <div class="empty-state__icon">👈</div>
            <div>选择左侧文件查看差异</div>
          </div>
          <template v-else>
            <div class="diff-header">
              <span class="diff-header__title">{{ selectedPath }}</span>
              <div class="diff-header__actions">
                <button :class="['nbt-btn', { 'nbt-btn--primary': viewMode==='side-by-side' }]" size="small" @click="viewMode='side-by-side'">并排</button>
                <button :class="['nbt-btn', { 'nbt-btn--primary': viewMode==='line-by-line' }]" size="small" @click="viewMode='line-by-line'">统一</button>
              </div>
            </div>
            <div class="diff-content" >
              <div v-if="diffLoading" style="padding:24px;text-align:center;color:var(--text-muted)">加载差异...</div>
              <div v-else-if="diffError" style="padding:24px;text-align:center;color:var(--bad)">加载失败</div>
              <div v-else v-html="diffHtml" style="min-height:100%"></div>
            </div>
            <div class="diff-nav">
              <button class="nbt-btn" size="small" @click="navigateHunk(-1)">← 上一处</button>
              <button class="nbt-btn" size="small" @click="navigateHunk(1)">下一处 →</button>
            </div>
          </template>
        </div>

        <!-- 结构比对全宽浮层 -->
        <div v-if="structureFull" class="structure-fullwidth">
          <div style="display:flex;justify-content:flex-end;padding:8px 12px;background:var(--bg-secondary);border-bottom:1px solid var(--border-default)">
            <button class="nbt-btn" size="small" @click="structureFull=false">退出全宽</button>
          </div>
          <div class="structure-compare" style="flex:1">
            <div class="structure-pane">
              <template v-for="node in treeData" :key="'fl'+node.value">
                <tree-node-struct :node="node" side="left" @select="selectFileFromStruct" />
              </template>
            </div>
            <div class="structure-pane">
              <template v-for="node in treeData" :key="'fr'+node.value">
                <tree-node-struct :node="node" side="right" @select="selectFileFromStruct" />
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
    `,

    components: {
      TreeNode: {
        name: 'TreeNode',
        props: { node: Object },
        emits: ['select', 'expand-nested'],
        template: /*html*/`
          <div>
            <div v-if="node.type==='dir'">
              <div class="tree-dir" @click="toggleDir">
                <span :class="['tree-dir__arrow', { 'tree-dir__arrow--open': open }]">▶</span>
                <span>{{ node.label || node.value }}</span>
              </div>
              <div v-show="open" style="padding-left:14px" class="tree-children-enter">
                <template v-for="child in node.children" :key="child.value">
                  <tree-node :node="child" @select="$emit('select', $event)" @expand-nested="$emit('expand-nested', $event)" />
                </template>
              </div>
            </div>
            <div v-else-if="node.type==='jar' && node.innerChanges">
              <div class="tree-nested" @click="toggleNested">
                <span :class="['tree-dir__arrow', { 'tree-dir__arrow--open': open }]">▶</span>
                <span class="tree-badge" :class="badgeClass(node.rightStatus)"></span>
                <span>{{ node.label || node.value }}</span>
                <span class="tree-nested__count">[{{ node.innerChanges }} 变更]</span>
              </div>
              <div v-show="open" style="padding-left:14px">
                <template v-for="child in node.children" :key="child.value">
                  <tree-node :node="child" @select="$emit('select', $event)" @expand-nested="$emit('expand-nested', $event)" />
                </template>
              </div>
            </div>
            <div v-else>
              <div :class="['tree-file', { 'tree-file--active': isSelected(node.value) }]" @click="$emit('select', node.value)">
                <span class="tree-badge" :class="badgeClass(node.rightStatus)"></span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ node.label || node.value }}</span>
              </div>
            </div>
          </div>
        `,
        data: function () { return { open: false } },
        methods: {
          toggleDir: function () { this.open = !this.open },
          toggleNested: function () {
            this.open = !this.open
            if (this.open && this.node.children && this.node.children.length === 0) {
              this.$emit('expand-nested', this.node.value)
            }
          },
          badgeClass: badgeClass,
          isSelected: function (path) {
            var app = this.$root
            while (app && !app.selectedPath) app = app.$parent
            return this.$root.selectedPath === path
          }
        }
      },
      TreeNodeStruct: {
        name: 'TreeNodeStruct',
        props: { node: Object, side: String },
        emits: ['select'],
        template: /*html*/`
          <div>
            <div v-if="node.type==='dir'">
              <div class="tree-dir" @click="open=!open">
                <span :class="['tree-dir__arrow', { 'tree-dir__arrow--open': open }]">▶</span>
                <span>{{ node.label || node.value }}</span>
              </div>
              <div v-show="open" style="padding-left:14px">
                <template v-for="child in node.children" :key="child.value">
                  <tree-node-struct :node="child" :side="side" @select="$emit('select', $event)" />
                </template>
              </div>
            </div>
            <div v-else>
              <div class="tree-file" @click="$emit('select', node.value)">
                <span>{{ node.label || node.value }}</span>
              </div>
            </div>
          </div>
        `,
        data: function () { return { open: false } }
      }
    },

    setup: function () {
      // --- state ---
      var mode = ref(JarDiff.storage.get('mode') || 'jar')
      var modes = [{ value: 'jar', label: 'Jar' }, { value: 'dir', label: '目录' }, { value: 'file', label: '文件' }]
      var dirLeft = ref(''), dirRight = ref('')
      var ignoreGlobs = ref(JarDiff.storage.get('ignore') || JarDiff.core.DEFAULT_IGNORE_SPRINGBOOT || '')
      var compareId = ref(JarDiff.storage.get('compareId') || '')
      var treeData = ref([])
      var selectedPath = ref(null)
      var diffHtml = ref('')
      var diffLoading = ref(false)
      var diffError = ref(false)
      var leftTab = ref(JarDiff.storage.get('leftTab') || 'diff')
      var viewMode = ref(JarDiff.storage.get('viewMode') || 'side-by-side')
      var searchQuery = ref('')
      var statusFilter = ref('all')
      var structureFull = ref(false)
      var comparing = ref(false)
      var leftWidth = ref(400)
      var jarLeftFile = ref(null)
      var jarRightFile = ref(null)
      var fileLeftFile = ref(null)
      var fileRightFile = ref(null)
      var resize = reactive({ done: true, x: 0, w: 0 })
      var showSettings = ref(false)
      var setting = reactive({
        includeClasses: JarDiff.storage.get('setting.includeClasses') !== false,
        includeResources: JarDiff.storage.get('setting.includeResources') !== false,
        includeLib: JarDiff.storage.get('setting.includeLib') !== true
      })

      // --- computed ---
      var stats = computed(function () {
        var s = { modified: 0, added: 0, missing: 0, meta: 0 }
        ;(function walk(nodes) {
          for (var i = 0; nodes && i < nodes.length; i++) {
            var n = nodes[i]
            if (n.type === 'file' || n.type === 'jar') {
              var st = n.rightStatus || ''
              if (s[st] !== undefined) s[st]++
            }
            if (n.children) walk(n.children)
          }
        })(treeData.value)
        return s
      })

      var filteredTree = computed(function () {
        var query = (searchQuery.value || '').toLowerCase()
        var sf = statusFilter.value
        function matches(n) {
          if (n.type === 'dir') return true
          var s = n.rightStatus || 'unchanged'
          if (sf !== 'all' && s !== sf) return false
          if (query && (n.value || '').toLowerCase().indexOf(query) === -1) return false
          return true
        }
        function filter(nodes) {
          var out = []
          for (var i = 0; nodes && i < nodes.length; i++) {
            var n = nodes[i]
            if (n.type === 'dir') {
              var kids = filter(n.children || [])
              if (kids.length > 0) {
                var copy = Object.assign({}, n, { children: kids })
                out.push(copy)
              }
            } else if (matches(n)) {
              out.push(n)
            }
          }
          return out
        }
        return filter(treeData.value)
      })

      // --- methods ---
      function switchMode(m) {
        mode.value = m
        JarDiff.storage.set('mode', m)
      }

      function onJarLeftChange(file) { jarLeftFile.value = file && file.raw }
      function onJarRightChange(file) { jarRightFile.value = file && file.raw }
      function onFileLeftChange(file) { fileLeftFile.value = file && file.raw }
      function onFileRightChange(file) { fileRightFile.value = file && file.raw }

      function startCompare() {
        comparing.value = true
        var onDone = function (err, result) {
          comparing.value = false
          if (err) {
            ElementPlus.ElMessage.error('比对失败: ' + (err.message || err))
            return
          }
          compareId.value = result.id
          treeData.value = result.tree || result.files || []
          selectedPath.value = null
          diffHtml.value = ''
          JarDiff.storage.set('compareId', result.id)
          if (!result.tree && result.files) {
            // File compare mode: select the single file
            selectedPath.value = (result.left && result.left.name) || 'file'
            loadFileDiff(result.id)
          }
        }
        if (mode.value === 'jar') {
          if (!jarLeftFile.value || !jarRightFile.value) { comparing.value = false; return }
          var fd = new FormData()
          fd.append('leftJar', jarLeftFile.value)
          fd.append('rightJar', jarRightFile.value)
          fd.append('includeLib', setting.includeLib)
          fd.append('includeClasses', setting.includeClasses)
          fd.append('includeResources', setting.includeResources)
          var ig = JarDiff.core.splitIgnoreGlobs(ignoreGlobs.value)
          if (ig && ig.length) ig.forEach(function (g, i) { fd.append('ignoreGlobs[' + i + ']', g) })
          JarDiff.api.compareJars(fd, null).then(onDone.bind(null, null)).catch(onDone)
        } else if (mode.value === 'dir') {
          var leftPath = dirLeft.value.trim()
          var rightPath = dirRight.value.trim()
          if (!leftPath || !rightPath) { comparing.value = false; return }
          JarDiff.api.compareDirectoryByPath(leftPath, rightPath).then(onDone.bind(null, null)).catch(onDone)
        } else if (mode.value === 'file') {
          if (!fileLeftFile.value || !fileRightFile.value) { comparing.value = false; return }
          var ffd = new FormData()
          ffd.append('left', fileLeftFile.value)
          ffd.append('right', fileRightFile.value)
          JarDiff.api.compareFiles(ffd, null).then(function (r) { onDone(null, r) }).catch(onDone)
        }
      }

      function selectFile(path) {
        selectedPath.value = path
        loadUnifiedDiff(path)
      }

      function selectFileFromStruct(path) {
        leftTab.value = 'diff'
        selectFile(path)
      }

      function loadFileDiff(id) {
        // For file compare mode
        diffLoading.value = true
        diffError.value = false
        var api = window.JarDiff.api
        api.loadUnifiedDiff(id, selectedPath.value).then(function (text) {
          diffLoading.value = false
          if (text && text.trim()) {
            try { diffHtml.value = Diff2Html.html(text, { drawFileList: false, matching: 'lines', outputFormat: viewMode.value }) }
            catch (e) { diffHtml.value = '<pre style=\"color:var(--text-primary);padding:16px\">' + escapeHtml(text) + '</pre>' }
          } else {
            diffHtml.value = '<div style=\"padding:24px;text-align:center;color:var(--text-muted)\">无文本差异</div>'
          }
        }).catch(function () { diffLoading.value = false; diffError.value = true })
      }

      function loadUnifiedDiff(path) {
        diffLoading.value = true
        diffError.value = false
        diffHtml.value = ''
        JarDiff.api.loadUnifiedDiff(compareId.value, path).then(function (text) {
          diffLoading.value = false
          if (text && text.trim()) {
            try {
              diffHtml.value = Diff2Html.html(text, {
                drawFileList: false,
                matching: 'lines',
                outputFormat: viewMode.value,
                highlight: true
              })
            } catch (e) {
              diffHtml.value = '<pre style="color:var(--text-primary);padding:16px;white-space:pre-wrap;font-family:var(--mono);font-size:13px">' + escapeHtml(text) + '</pre>'
            }
          } else {
            diffHtml.value = '<div style="padding:24px;text-align:center;color:var(--text-muted)">无文本差异</div>'
          }
          nextTick(function () { scrollToFirstHunk() })
        }).catch(function () { diffLoading.value = false; diffError.value = true })
      }

      function navigateHunk(dir) {
        var container = document.querySelector('.diff-content')
        if (!container) return
        var hunks = container.querySelectorAll('.d2h-code-line.d2h-del, .d2h-code-line.d2h-ins')
        if (!hunks.length) return
        var current = -1
        var scrollTop = container.scrollTop
        for (var i = 0; i < hunks.length; i++) {
          if (hunks[i].offsetTop > scrollTop) { current = i; break }
        }
        var next = dir > 0 ? current : Math.max(0, current - 1)
        if (next >= 0 && next < hunks.length) {
          hunks[next].scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }

      function scrollToFirstHunk() {
        nextTick(function () {
          var c = document.querySelector('.d2h-wrapper .d2h-code-line.d2h-del, .d2h-wrapper .d2h-code-line.d2h-ins')
          if (c) c.scrollIntoView({ block: 'center' })
        })
      }

      function expandNested(path) {
        JarDiff.api.loadNestedTree(compareId.value, path).then(function (nodes) {
          if (!nodes || !nodes.length) return
          function update(search) {
            for (var i = 0; search && i < search.length; i++) {
              if (search[i].value === path) {
                search[i].children = nodes
                search[i].expanded = true
                return true
              }
              if (search[i].children && update(search[i].children)) return true
            }
            return false
          }
          update(treeData.value)
          treeData.value = treeData.value.slice()
        })
      }

      function startResize(e) {
        resize.x = e.clientX
        resize.w = leftWidth.value
        resize.done = false
        document.addEventListener('mousemove', doResize)
        document.addEventListener('mouseup', stopResize)
      }

      function doResize(e) {
        if (resize.done) return
        var newW = resize.w + (e.clientX - resize.x)
        leftWidth.value = Math.max(280, Math.min(760, newW))
      }

      function stopResize() {
        resize.done = true
        document.removeEventListener('mousemove', doResize)
        document.removeEventListener('mouseup', stopResize)
      }

      // --- watch ---
      watch(leftTab, function (v) { JarDiff.storage.set('leftTab', v) })
      watch(viewMode, function (v) {
        JarDiff.storage.set('viewMode', v)
        if (selectedPath.value) loadUnifiedDiff(selectedPath.value)
      })
      watch(ignoreGlobs, function (v) { JarDiff.storage.set('ignore', v) })
      watch([function () { return setting.includeClasses }, function () { return setting.includeResources }, function () { return setting.includeLib }],
        function () {
          JarDiff.storage.set('setting.includeClasses', setting.includeClasses)
          JarDiff.storage.set('setting.includeResources', setting.includeResources)
          JarDiff.storage.set('setting.includeLib', setting.includeLib)
        })

      // --- exposed ---
      return {
        mode, modes, dirLeft, dirRight, ignoreGlobs, compareId, treeData, selectedPath,
        diffHtml, diffLoading, diffError, leftTab, viewMode, searchQuery, statusFilter,
        structureFull, comparing, leftWidth, showSettings, setting, stats, filteredTree,
        switchMode, startCompare, selectFile, selectFileFromStruct, navigateHunk,
        loadFileDiff, expandNested, startResize, doResize, stopResize,
        onJarLeftChange, onJarRightChange, onFileLeftChange, onFileRightChange
      }
    }
  })

  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  app.mount('#app')
})()
