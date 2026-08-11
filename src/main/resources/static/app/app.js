;// [AGC:FILE] tool=Cc author=maxwell date=2026-07-24
;(function () {
  const { createApp, ref, reactive, computed, watch, nextTick, onMounted, provide } = Vue

  // --- helpers ---
  function badgeClass(status) {
    return { modified: 'tree-badge--modified', added: 'tree-badge--added', missing: 'tree-badge--missing', meta: 'tree-badge--meta' }[status] || ''
  }

  function statusTextClass(status) {
    return { modified: 'tree-text--modified', added: 'tree-text--added', missing: 'tree-text--missing', meta: 'tree-text--meta' }[status] || ''
  }

  const FILE_ICON_BASE = '/vendor/vscode-icons/'
  const FILE_ICONS = {
    class: 'class.svg', jar: 'jar.svg', zip: 'zip.svg', java: 'java.svg', js: 'javascript.svg',
    html: 'html.svg', htm: 'html.svg', jsp: 'html.svg', xml: 'xml.svg', json: 'json.svg', css: 'css.svg',
    yml: 'yaml.svg', yaml: 'yaml.svg', properties: 'config.svg', mf: 'manifest.svg', gradle: 'gradle.svg',
    md: 'markdown.svg', txt: 'text.svg', kt: 'kotlin.svg', groovy: 'groovy.svg', scala: 'scala.svg'
  }

  function nodeIconSrc(node, open) {
    if (!node) return FILE_ICON_BASE + 'default-file.svg'
    if (node.type === 'dir') return FILE_ICON_BASE + (open ? 'default-folder-opened.svg' : 'default-folder.svg')
    var value = (node.label || node.value || '').toLowerCase()
    var extension = value.indexOf('.') >= 0 ? value.substring(value.lastIndexOf('.') + 1) : ''
    if (node.type === 'jar' && extension !== 'zip') extension = 'jar'
    return FILE_ICON_BASE + (FILE_ICONS[extension] || 'default-file.svg')
  }

  function aggregateStatus(node) {
    if (!node) return ''
    if (node.type === 'file' || node.type === 'jar') return node.rightStatus && node.rightStatus !== 'unchanged' ? node.rightStatus : ''
    var statuses = []
    ;(function walk(children) {
      for (var i = 0; children && i < children.length; i++) {
        var child = children[i]
        if ((child.type === 'file' || child.type === 'jar') && child.rightStatus && child.rightStatus !== 'unchanged') statuses.push(child.rightStatus)
        if (child.children) walk(child.children)
      }
    })(node.children)
    if (statuses.indexOf('modified') >= 0) return 'modified'
    if (statuses.indexOf('added') >= 0) return 'added'
    if (statuses.indexOf('missing') >= 0) return 'missing'
    if (statuses.indexOf('meta') >= 0) return 'meta'
    return ''
  }

  function changedCount(node) {
    if (!node) return 0
    if (node.type === 'file') return node.rightStatus && node.rightStatus !== 'unchanged' ? 1 : 0
    if (node.type === 'jar') return node.innerChanges > 0 ? node.innerChanges : (node.rightStatus && node.rightStatus !== 'unchanged' ? 1 : 0)
    var total = 0
    for (var i = 0; node.children && i < node.children.length; i++) total += changedCount(node.children[i])
    return total
  }

  const app = createApp({
    template: /*html*/`
    <div id="app-root" class="app-root">
      <section v-if="!compareId" class="setup-shell">
        <header class="setup-header">
          <div class="brand-lockup"><span class="brand-mark">JD</span><span>Jar Diff</span></div>
          <span class="setup-header__path">新建比对</span>
          <!-- [AGC:START] tool=Cc date=2026-07-29 author=maxwell -->
          <div class="setup-header__actions"><span class="setup-header__status">版本比对</span></div>
          <!-- [AGC:END] -->
        </header>
        <div class="setup-configbar">
          <div class="setup-configbar__group">
            <span class="setup-configbar__label">比对类型</span>
            <div class="mode-tabs" role="tablist" aria-label="比对类型">
              <!-- [AGC:START] tool=Cc date=2026-07-29 author=maxwell -->
              <button v-for="m in visibleModes" :key="m.value" role="tab" :aria-selected="mode === m.value" :aria-label="'切换到' + m.label + '比对'" :class="['mode-tab', { 'mode-tab--active': mode === m.value }]" @click="switchMode(m.value)">
                <span>{{ m.label }}</span>
              </button>
              <!-- [AGC:END] -->
            </div>
          </div>
          <span v-if="mode!=='text'" class="setup-configbar__separator"></span>
          <div v-if="mode!=='text'" class="setup-configbar__group">
            <span class="setup-configbar__label">比对范围</span>
            <div class="setup-checks">
              <button type="button" :class="['scope-chip', { 'scope-chip--active': setting.includeClasses }]" :aria-pressed="setting.includeClasses" @click="toggleScope('includeClasses')"><span></span>Class 文件</button>
              <button type="button" :class="['scope-chip', { 'scope-chip--active': setting.includeResources }]" :aria-pressed="setting.includeResources" @click="toggleScope('includeResources')"><span></span>资源文件</button>
              <button type="button" :class="['scope-chip', { 'scope-chip--active': setting.includeLib }]" :aria-pressed="setting.includeLib" @click="toggleScope('includeLib')"><span></span>依赖 Jar</button>
            </div>
          </div>
        </div>
        <main class="setup-main">
          <div class="setup-intro">
            <h1>新建版本比对</h1>
            <p>选择旧版与新版，生成结构树和文件差异。</p>
          </div>
          <div class="setup-workspace">
            <div :class="['source-grid', { 'source-grid--text': mode==='text' }]">
                <div :class="['source-field', { 'source-field--ready': (mode==='jar' && jarLeftPath) || (mode==='file' && fileLeftPath) || (mode==='dir' && dirLeft) || (mode==='text' && textLeft !== '') }]">
                  <div class="source-field__head"><span class="source-field__step">01</span><span class="source-field__label">{{ mode === 'text' ? '旧版文本' : '旧版本' }}</span></div>
                  <div class="source-field__control">
                    <button v-if="mode==='jar'" type="button" class="upload-button" @click="onChooseJarLeft">选择旧版 Jar</button>
                    <button v-if="mode==='file'" type="button" class="upload-button" @click="onChooseFileLeft">选择旧版文件</button>
                    <el-input v-if="mode==='dir'" v-model="dirLeft" placeholder="输入旧版目录路径" size="large" />
                    <button v-if="mode==='dir'" type="button" class="upload-button" @click="onChooseDirLeft">浏览…</button>
                    <!-- [AGC:START] tool=Cc author=maxwell date=2026-07-29 -->
                    <textarea v-if="mode==='text'" v-model="textLeft" class="text-source-input" placeholder="粘贴旧版文本" aria-label="旧版文本"></textarea>
                    <!-- [AGC:END] -->
                    <span v-if="mode==='jar' && jarLeftPath" class="source-field__value" :title="jarLeftPath">{{ jarLeftPath }}</span>
                    <span v-if="mode==='file' && fileLeftPath" class="source-field__value" :title="fileLeftPath">{{ fileLeftPath }}</span>
                  </div>
                </div>
                <div class="source-divider" aria-hidden="true"><span></span><b>旧 → 新</b><span></span></div>
                <div :class="['source-field', { 'source-field--ready': (mode==='jar' && jarRightPath) || (mode==='file' && fileRightPath) || (mode==='dir' && dirRight) || (mode==='text' && textRight !== '') }]">
                  <div class="source-field__head"><span class="source-field__step">02</span><span class="source-field__label">{{ mode === 'text' ? '新版文本' : '新版本' }}</span></div>
                  <div class="source-field__control">
                    <button v-if="mode==='jar'" type="button" class="upload-button" @click="onChooseJarRight">选择新版 Jar</button>
                    <button v-if="mode==='file'" type="button" class="upload-button" @click="onChooseFileRight">选择新版文件</button>
                    <el-input v-if="mode==='dir'" v-model="dirRight" placeholder="输入新版目录路径" size="large" />
                    <button v-if="mode==='dir'" type="button" class="upload-button" @click="onChooseDirRight">浏览…</button>
                    <!-- [AGC:START] tool=Cc author=maxwell date=2026-07-29 -->
                    <textarea v-if="mode==='text'" v-model="textRight" class="text-source-input" placeholder="粘贴新版文本" aria-label="新版文本"></textarea>
                    <!-- [AGC:END] -->
                    <span v-if="mode==='jar' && jarRightPath" class="source-field__value" :title="jarRightPath">{{ jarRightPath }}</span>
                    <span v-if="mode==='file' && fileRightPath" class="source-field__value" :title="fileRightPath">{{ fileRightPath }}</span>
                  </div>
                </div>
              </div>
            <div :class="['setup-options', { 'setup-options--text': mode==='text' }]">
              <div v-if="mode!=='text'" class="setup-ignore-wrap">
                <span class="setup-section-label">忽略规则</span>
                <el-popover placement="top-start" trigger="click" width="520" popper-class="ignore-popover">
                  <template #reference>
                    <button type="button" class="ignore-trigger">
                      <span>忽略规则 {{ ignoreRuleCount }}</span>
                      <span aria-hidden="true">编辑</span>
                    </button>
                  </template>
                  <div class="ignore-editor">
                    <span class="ignore-editor__label">每行一条规则</span>
                    <el-input v-model="ignoreGlobs" type="textarea" :rows="8" resize="vertical" placeholder="例如：META-INF/**" />
                  </div>
                </el-popover>
              </div>
              <!-- [AGC:START] tool=Cc author=maxwell date=2026-07-29 -->
              <span v-if="mode==='text' && !canStartTextCompare" class="text-compare-hint">请至少粘贴一侧文本</span>
              <button class="compare-button" @click="startCompare" :disabled="comparing || (mode==='text' && !canStartTextCompare)"><span>{{ comparing ? '正在建立索引...' : '开始比对' }}</span><span aria-hidden="true">→</span></button>
              <!-- [AGC:END] -->
            </div>
          </div>
        </main>
      </section>

      <section v-else :class="['result-shell', { 'result-shell--diff-focus': diffFocus }]">
        <header class="result-toolbar">
          <div class="brand-lockup"><span class="brand-mark">JD</span><span>Jar Diff</span></div>
          <span class="result-toolbar__path">{{ compareLabel }}</span>
          <div class="result-toolbar__actions">
            <button class="toolbar-action" title="重新选择两个版本" @click="resetCompare">新建比对</button>
            <button class="toolbar-action toolbar-action--icon" title="高级设置" @click="showSettings=!showSettings">⚙</button>
          </div>
        </header>
        <div class="workspace" @mouseup="stopResize">
          <div class="left-panel" :style="{ width: leftWidth + 'px' }">
            <div class="navigation-header">
              <div class="navigation-switcher" role="tablist" aria-label="文件导航模式">
                <button :class="['navigation-tab', { 'navigation-tab--active': navigationMode === 'changes' }]" @click="switchNavigationMode('changes')">变更树 <span>{{ changedFileCount }}</span></button>
                <button :class="['navigation-tab', { 'navigation-tab--active': navigationMode === 'structure' }]" @click="switchNavigationMode('structure')">左右结构</button>
              </div>
              <button v-if="navigationMode==='structure'" class="icon-button" :title="structureFull ? '退出全宽' : '全宽结构'" @click="structureFull=!structureFull">{{ structureFull ? '×' : '↗' }}</button>
            </div>
            <div v-if="navigationMode==='structure'" class="structure-view">
              <div class="structure-head"><span>旧版本</span><span>新版本</span></div>
              <div class="structure-compare">
                <div class="structure-pane" @scroll="syncStructureScroll">
                  <template v-for="node in treeData" :key="'l'+node.value"><tree-node-struct :node="node" side="left" :nested-states="nestedStates" @select="selectFileFromStruct" @expand-nested="expandNested" /></template>
                </div>
                <div class="structure-pane" @scroll="syncStructureScroll">
                  <template v-for="node in treeData" :key="'r'+node.value"><tree-node-struct :node="node" side="right" :nested-states="nestedStates" @select="selectFileFromStruct" @expand-nested="expandNested" /></template>
                </div>
              </div>
            </div>
            <div v-else class="changes-view">
              <div class="tree-search">
                <el-input v-model="searchQuery" placeholder="搜索变更文件" size="small" clearable />
                <el-select v-model="statusFilter" size="small" style="margin-top:6px;width:100%" placeholder="全部状态">
                  <el-option label="变更文件" value="changed" />
                  <el-option label="全部状态" value="all" /><el-option label="修改" value="modified" /><el-option label="新增" value="added" /><el-option label="缺失" value="missing" /><el-option label="元信息" value="meta" />
                </el-select>
              </div>
              <div class="file-tree">
                <template v-for="node in filteredTree" :key="node.value"><tree-node :node="node" :nested-states="nestedStates" @select="selectFile" @expand-nested="expandNested" /></template>
                <div v-if="filteredTree.length===0 && treeData.length>0" class="tree-empty">没有匹配的文件</div>
              </div>
              <div class="stats-bar"><span><i class="status-dot status-dot--modified"></i>修改 <strong>{{ stats.modified }}</strong></span><span><i class="status-dot status-dot--added"></i>新增 <strong>{{ stats.added }}</strong></span><span><i class="status-dot status-dot--missing"></i>缺失 <strong>{{ stats.missing }}</strong></span><span><i class="status-dot status-dot--meta"></i>元信息 <strong>{{ stats.meta }}</strong></span></div>
            </div>
          </div>
          <div class="resizer" @mousedown="startResize"></div>
          <div class="right-panel">
            <div v-if="!selectedPath" class="diff-empty"><span class="diff-empty__mark">⌘</span><span>选择文件查看差异</span></div>
            <template v-else>
              <div class="diff-header"><div class="diff-header__title-wrap"><span class="eyebrow">CURRENT FILE</span><div class="diff-header__path-row"><span class="diff-header__title">{{ selectedPath }}</span><button class="path-copy-button" :title="pathCopied ? '路径已复制' : '复制完整路径'" :aria-label="pathCopied ? '路径已复制' : '复制完整路径'" @click="copySelectedPath">{{ pathCopied ? '✓' : '⧉' }}</button></div></div><div class="diff-header__actions"><div class="diff-font-control" aria-label="代码字号"><button class="diff-font-button" title="减小代码字号" :disabled="diffFontSize<=8" @click="adjustDiffFont(-1)">−</button><span>{{ diffFontSize }}</span><button class="diff-font-button" title="增大代码字号" :disabled="diffFontSize>=18" @click="adjustDiffFont(1)">＋</button></div><button :class="['view-toggle', { 'view-toggle--active': viewMode==='side-by-side' }]" @click="viewMode='side-by-side'">并排</button><button :class="['view-toggle', { 'view-toggle--active': viewMode==='line-by-line' }]" @click="viewMode='line-by-line'">统一</button><button class="icon-button" :title="diffFocus ? '退出专注模式' : '专注模式'" @click="diffFocus=!diffFocus">{{ diffFocus ? '×' : '⛶' }}</button></div></div>
              <div class="diff-content" :style="{ '--diff-font-size': diffFontSize + 'px' }">
                <div v-if="diffLoading" class="diff-state">加载差异...</div>
                <div v-else-if="diffError" class="diff-state diff-state--error"><strong>加载失败</strong><span>{{ diffError }}</span><button class="retry-button" @click="retryDiff">重试</button></div>
                <div v-else v-html="diffHtml" class="diff-rendered"></div>
              </div>
              <div class="diff-nav"><span class="hunk-position">{{ hunkCount ? (hunkIndex + 1) + ' / ' + hunkCount : '无变更块' }}</span><button class="icon-button" :disabled="!hunkCount" title="上一处变更" @click="navigateHunk(-1)">↑</button><button class="icon-button" :disabled="!hunkCount" title="下一处变更" @click="navigateHunk(1)">↓</button></div>
            </template>
          </div>
          <el-drawer v-model="showSettings" title="比对范围" direction="rtl" size="280px" :z-index="9999"><div class="settings-drawer"><label><input type="checkbox" v-model="setting.includeClasses" /> 包含 Class 文件</label><label><input type="checkbox" v-model="setting.includeResources" /> 包含资源文件</label><label><input type="checkbox" v-model="setting.includeLib" /> 包含依赖 Jar</label></div></el-drawer>
          <div v-if="structureFull" class="structure-fullwidth"><div class="fullwidth-toolbar"><span>左右结构</span><button class="icon-button" title="退出全宽" @click="structureFull=false">×</button></div><div class="structure-head"><span>旧版本</span><span>新版本</span></div><div class="structure-compare"><div class="structure-pane" @scroll="syncStructureScroll"><template v-for="node in treeData" :key="'fl'+node.value"><tree-node-struct :node="node" side="left" :nested-states="nestedStates" @select="selectFileFromStruct" @expand-nested="expandNested" /></template></div><div class="structure-pane" @scroll="syncStructureScroll"><template v-for="node in treeData" :key="'fr'+node.value"><tree-node-struct :node="node" side="right" :nested-states="nestedStates" @select="selectFileFromStruct" @expand-nested="expandNested" /></template></div></div></div>
        </div>
      </section>
    </div>
    `,

    components: {
      TreeNode: {
        name: 'TreeNode',
        props: { node: Object, nestedStates: Object },
        emits: ['select', 'expand-nested'],
        template: /*html*/`
          <div>
            <div v-if="node.type==='dir'">
              <div :class="['tree-dir', statusTextClass(directoryStatus)]" @click="toggleDir">
                <span :class="['tree-dir__arrow', { 'tree-dir__arrow--open': open }]">▶</span>
                <img class="tree-node-icon" :src="nodeIconSrc(node, open)" alt="" />
                <span class="tree-node-label">{{ node.label || node.value }}</span>
                <span v-if="directoryChangeCount > 0" class="tree-dir__count">{{ directoryChangeCount }}</span>
                <span v-if="directoryStatus" class="tree-badge" :class="badgeClass(directoryStatus)"></span>
              </div>
              <div v-show="open" style="padding-left:14px" class="tree-children-enter">
                <template v-for="child in node.children" :key="child.value">
                  <tree-node :node="child" :nested-states="nestedStates" @select="$emit('select', $event)" @expand-nested="$emit('expand-nested', $event)" />
                </template>
              </div>
            </div>
            <div v-else-if="node.type==='jar'">
              <div :class="['tree-nested', statusTextClass(node.rightStatus)]" @click="toggleNested">
                <span :class="['tree-dir__arrow', { 'tree-dir__arrow--open': open }]">▶</span>
                <img class="tree-node-icon" :src="nodeIconSrc(node, open)" alt="" />
                <span class="tree-node-label">{{ node.label || node.value }}</span>
                <span class="tree-nested__count" v-if="node.innerChanges > 0">[{{ node.innerChanges }} 变更]</span>
                <span class="tree-badge" :class="badgeClass(node.rightStatus)"></span>
              </div>
              <div v-show="open" style="padding-left:14px">
                <template v-for="child in node.children" :key="child.value">
                  <tree-node :node="child" :nested-states="nestedStates" @select="$emit('select', $event)" @expand-nested="$emit('expand-nested', $event)" />
                </template>
                <div v-if="nestedState && nestedState.status==='loading'" class="tree-nested-state">加载内部文件...</div>
                <button v-if="nestedState && nestedState.status==='error'" class="tree-nested-state tree-nested-state--error" @click.stop="$emit('expand-nested', node.value)">加载失败：{{ nestedState.message }} 重试</button>
              </div>
            </div>
            <div v-else>
              <div :class="['tree-file', statusTextClass(node.rightStatus), { 'tree-file--active': isSelected(node.value) }]" @click="$emit('select', node.value)">
                <img class="tree-node-icon" :src="nodeIconSrc(node, false)" alt="" />
                <span class="tree-node-label">{{ node.label || node.value }}</span>
                <span class="tree-badge" :class="badgeClass(node.rightStatus)"></span>
              </div>
            </div>
          </div>
        `,
        data: function () { return { open: false } },
        computed: {
          nestedState: function () { return this.nestedStates && this.nestedStates[this.node.value] },
          directoryStatus: function () { return aggregateStatus(this.node) },
          directoryChangeCount: function () { return changedCount(this.node) },
        },
        methods: {
          toggleDir: function () { this.open = !this.open },
          toggleNested: function () {
            this.open = !this.open
            if (this.open && (!this.node.children || this.node.children.length === 0) && (!this.nestedState || this.nestedState.status === 'error')) {
              this.$emit('expand-nested', this.node.value)
            }
          },
          badgeClass: badgeClass,
          statusTextClass: statusTextClass,
          nodeIconSrc: nodeIconSrc,
          isSelected: function (path) {
            return this.$root.selectedPath === path
          }
        }
      },
      TreeNodeStruct: {
        name: 'TreeNodeStruct',
        props: { node: Object, side: String, nestedStates: Object },
        emits: ['select', 'expand-nested'],
        inject: ['expandedPaths'],
        template: /*html*/`
          <div>
            <div v-if="node.type==='dir' || node.type==='jar'">
              <div :class="['tree-dir', sideExists ? statusTextClass(folderStatus) : '', { 'tree-row--placeholder': !sideExists }]" @click="toggle">
                <span :class="['tree-dir__arrow', { 'tree-dir__arrow--open': isOpen }]">▶</span>
                <img v-if="sideExists" class="tree-node-icon" :src="nodeIconSrc(node, isOpen)" alt="" />
                <span v-else class="tree-node-icon"></span>
                <span class="tree-node-label">{{ sideExists ? (node.label || node.value) : '—' }}</span>
                <span v-if="sideExists && folderChangeCount > 0" class="tree-dir__count">{{ folderChangeCount }}</span>
                <span class="tree-badge" :class="folderBadge" v-if="sideExists && folderBadge"></span>
              </div>
              <div v-show="isOpen" style="padding-left:14px">
                <template v-for="child in node.children" :key="child.value">
                  <tree-node-struct :node="child" :side="side" :nested-states="nestedStates" @select="$emit('select', $event)" @expand-nested="$emit('expand-nested', $event)" />
                </template>
                <div v-if="node.type==='jar' && nestedState && nestedState.status==='loading'" class="tree-nested-state">加载内部文件...</div>
                <button v-if="node.type==='jar' && nestedState && nestedState.status==='error'" class="tree-nested-state tree-nested-state--error" @click.stop="$emit('expand-nested', node.value)">加载失败：{{ nestedState.message }} 重试</button>
              </div>
            </div>
            <div v-else>
              <div :class="['tree-file', sideExists ? statusTextClass(node.rightStatus) : '', { 'tree-row--placeholder': !sideExists, 'tree-file--active': sideExists && $root.selectedPath === node.value }]" @click="selectFile">
                <img v-if="sideExists" class="tree-node-icon" :src="nodeIconSrc(node, false)" alt="" />
                <span v-else class="tree-node-icon"></span>
                <span v-if="sideExists" class="tree-node-label">{{ node.label || node.value }}</span>
                <span v-else class="tree-node-label structure-placeholder">—</span>
                <span class="tree-badge" :class="badgeClass(node.rightStatus)" v-if="sideExists"></span>
              </div>
            </div>
          </div>
        `,
        computed: {
          isOpen: function () { return this.expandedPaths[this.node.value] === true },
          sideExists: function () {
            var key = this.side === 'left' ? 'leftExists' : 'rightExists'
            return this.node[key] !== false
          },
          folderBadge: function () {
            if (this.node.type !== 'dir' && this.node.type !== 'jar') return ''
            return badgeClass(this.folderStatus)
          },
          folderStatus: function () {
            return aggregateStatus(this.node)
          },
          folderChangeCount: function () {
            return changedCount(this.node)
          },
          nestedState: function () {
            return this.nestedStates && this.nestedStates[this.node.value]
          }
        },
        methods: {
          toggle: function () {
            if (!this.sideExists) return
            var key = this.node.value
            if (this.expandedPaths[key]) {
              this.expandedPaths[key] = false
            } else {
              this.expandedPaths[key] = true
            }
            if (this.node.type === 'jar' && (!this.node.children || this.node.children.length === 0) && (!this.nestedState || this.nestedState.status === 'error')) {
              this.$emit('expand-nested', this.node.value)
            }
          },
          selectFile: function () {
            if (this.sideExists) this.$emit('select', this.node.value)
          },
          badgeClass: badgeClass,
          statusTextClass: statusTextClass,
          nodeIconSrc: nodeIconSrc
        }
      }
    },

    setup: function () {
      // --- state ---
      // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
      var storedMode = JarDiff.storage.get('mode') || 'jar'
      var mode = ref(storedMode === 'dir' ? 'jar' : storedMode)
      // [AGC:END]
      var modes = [{ value: 'jar', label: 'Jar 包' }, { value: 'dir', label: '目录' }, { value: 'file', label: '文件' }, { value: 'text', label: '文本' }]
      // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
      var directoryCompareEnabled = ref(false)
      // [AGC:END]
      var dirLeft = ref(''), dirRight = ref('')
      // [AGC:START] tool=Cc author=maxwell date=2026-07-29
      var textLeft = ref(''), textRight = ref('')
      // [AGC:END]
      // 忽略规则初值：优先取用户本地保存的值；为空时由 onMounted 从后端配置的 jardiff.ignore.default-globs 填充
      var ignoreGlobs = ref(JarDiff.storage.get('ignore') || '')
      // [AGC:START] tool=Cc author=maxwell date=2026-07-29
      var compareId = ref('')
      // [AGC:END]
      var treeData = ref([])
      var selectedPath = ref(null)
      var diffHtml = ref('')
      var diffLoading = ref(false)
      var diffError = ref('')
      var navigationMode = ref(JarDiff.storage.get('navigationMode') || 'changes')
      var viewMode = ref(JarDiff.storage.get('viewMode') || 'side-by-side')
      var storedDiffFontSize = Number(JarDiff.storage.get('diffFontSize'))
      var diffFontSize = ref(storedDiffFontSize >= 8 && storedDiffFontSize <= 18 ? storedDiffFontSize : 13)
      var pathCopied = ref(false)
      var diffFocus = ref(false)
      var searchQuery = ref('')
      // [AGC:START] tool=Cc author=maxwell date=2026-07-27
      var statusFilter = ref('changed')
      // [AGC:END]
      var structureFull = ref(false)
      var comparing = ref(false)
      var expandedPaths = reactive({})
      var leftWidth = ref(400)
      var savedLeftWidth = ref(400)
      var nestedStates = reactive({})
      var structureSyncing = ref(false)
      var diffRequestSeq = ref(0)
      var hunkTargets = ref([])
      var hunkIndex = ref(0)
      var jarLeftPath = ref('')
      var jarRightPath = ref('')
      var fileLeftPath = ref('')
      var fileRightPath = ref('')
      // [AGC:START] tool=Cc author=maxwell date=2026-07-29
      var textLeftFile = ref(null)
      var textRightFile = ref(null)
      // [AGC:END]
      var resize = reactive({ done: true, x: 0, w: 0 })
      var showSettings = ref(false)
      var setting = reactive({
        includeClasses: JarDiff.storage.get('setting.includeClasses') !== false,
        includeResources: JarDiff.storage.get('setting.includeResources') !== false,
        includeLib: JarDiff.storage.get('setting.includeLib') !== false
      })

      // --- computed ---
      // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
      var visibleModes = computed(function () {
        return modes.filter(function (item) { return item.value !== 'dir' || directoryCompareEnabled.value })
      })
      // [AGC:END]

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

      // [AGC:START] tool=Cc author=maxwell date=2026-07-27
      var filteredTree = computed(function () {
        var query = (searchQuery.value || '').toLowerCase()
        var sf = statusFilter.value
        function matchesLeaf(n) {
          var s = n.rightStatus || 'unchanged'
          var isChanged = s !== 'unchanged' || (n.type === 'jar' && n.innerChanges > 0)
          if (sf === 'changed' && !isChanged) return false
          if (sf !== 'all' && sf !== 'changed' && s !== sf) return false
          if (query && (n.value || '').toLowerCase().indexOf(query) === -1) return false
          return true
        }
        function filter(nodes) {
          var out = []
          for (var i = 0; nodes && i < nodes.length; i++) {
            var n = nodes[i]
            if (n.type === 'dir' || n.type === 'jar') {
              var kids = filter(n.children || [])
              var selfMatches = n.type === 'jar' && matchesLeaf(n)
              if (kids.length > 0 || selfMatches) {
                var copy = Object.assign({}, n, { children: kids })
                out.push(copy)
              }
            } else if (matchesLeaf(n)) {
              out.push(n)
            }
          }
          return out
        }
        return filter(treeData.value)
      })
      // [AGC:END]

      var changedFileCount = computed(function () {
        return stats.value.modified + stats.value.added + stats.value.missing + stats.value.meta
      })

      var hunkCount = computed(function () { return hunkTargets.value.length })
      var ignoreRuleCount = computed(function () { return JarDiff.core.splitIgnoreGlobs(ignoreGlobs.value).length })
      // [AGC:START] tool=Cc author=maxwell date=2026-07-29
      var canStartTextCompare = computed(function () { return textLeft.value !== '' || textRight.value !== '' })
      // [AGC:END]

      var compareLabel = computed(function () {
        if (mode.value === 'jar' && jarLeftPath.value && jarRightPath.value) return baseName(jarLeftPath.value) + '  vs  ' + baseName(jarRightPath.value)
        if (mode.value === 'dir') return (dirLeft.value || '旧版目录') + '  vs  ' + (dirRight.value || '新版目录')
        if (mode.value === 'file' && fileLeftPath.value && fileRightPath.value) return baseName(fileLeftPath.value) + '  vs  ' + baseName(fileRightPath.value)
        // [AGC:START] tool=Cc author=maxwell date=2026-07-29
        if (mode.value === 'text') return 'pasted-text.txt'
        // [AGC:END]
        return '当前比对'
      })

      // --- methods ---
      function switchMode(m) {
        mode.value = m
        JarDiff.storage.set('mode', m)
      }

      function toggleScope(key) {
        setting[key] = !setting[key]
      }

      function switchNavigationMode(next) {
        if (navigationMode.value === next) return
        if (next === 'structure') {
          savedLeftWidth.value = leftWidth.value
          leftWidth.value = Math.max(leftWidth.value, Math.round(window.innerWidth * 0.55))
        } else {
          leftWidth.value = savedLeftWidth.value
        }
        navigationMode.value = next
        JarDiff.storage.set('navigationMode', next)
      }

      function adjustDiffFont(delta) {
        diffFontSize.value = Math.max(8, Math.min(18, diffFontSize.value + delta))
        JarDiff.storage.set('diffFontSize', diffFontSize.value)
      }

      function copySelectedPath() {
        if (!selectedPath.value) return
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
          ElementPlus.ElMessage.error('当前浏览器不支持复制路径')
          return
        }
        navigator.clipboard.writeText(selectedPath.value).then(function () {
          pathCopied.value = true
          ElementPlus.ElMessage.success('路径已复制')
          setTimeout(function () { pathCopied.value = false }, 1500)
        }).catch(function (err) {
          console.error('copy path failed', err)
          ElementPlus.ElMessage.error('复制路径失败，请检查浏览器权限')
        })
      }

      function resetCompare() {
        compareId.value = ''
        selectedPath.value = null
        treeData.value = []
        diffHtml.value = ''
        diffError.value = ''
        diffLoading.value = false
        hunkTargets.value = []
        hunkIndex.value = 0
        structureFull.value = false
        diffFocus.value = false
        navigationMode.value = 'changes'
        JarDiff.storage.set('compareId', '')
      }

      function baseName(p) { return p ? String(p).replace(/^.*[/\\]/, '') : '' }
      function onChooseJarLeft() { JarDiff.api.chooseJar('选择旧版 Jar', function (p) { if (p) jarLeftPath.value = p }) }
      function onChooseJarRight() { JarDiff.api.chooseJar('选择新版 Jar', function (p) { if (p) jarRightPath.value = p }) }
      function onChooseFileLeft() { JarDiff.api.chooseFile('选择旧版文件', function (p) { if (p) fileLeftPath.value = p }) }
      function onChooseFileRight() { JarDiff.api.chooseFile('选择新版文件', function (p) { if (p) fileRightPath.value = p }) }
      function onChooseDirLeft() { JarDiff.api.chooseDirectory('选择旧版目录', function (p) { if (p) dirLeft.value = p }) }
      function onChooseDirRight() { JarDiff.api.chooseDirectory('选择新版目录', function (p) { if (p) dirRight.value = p }) }

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
          diffError.value = ''
          hunkTargets.value = []
          hunkIndex.value = 0
          Object.keys(nestedStates).forEach(function (key) { delete nestedStates[key] })
          if (mode.value === 'file' || mode.value === 'text') {
            // 文件接口只返回元数据和缓存 id，Diff 仍需提交原始两个文件。
            selectedPath.value = mode.value === 'text' ? 'pasted-text.txt' : ((result.left && result.left.name) || 'file')
            loadFileDiff()
          }
        }
        if (mode.value === 'jar') {
          if (!jarLeftPath.value || !jarRightPath.value) { comparing.value = false; return }
          var fd = new FormData()
          fd.append('leftPath', jarLeftPath.value)
          fd.append('rightPath', jarRightPath.value)
          fd.append('includeLib', setting.includeLib)
          fd.append('includeClasses', setting.includeClasses)
          fd.append('includeResources', setting.includeResources)
          if (setting.includeLib) fd.append('deepCompareLib', 'true')
          fd.append('ignoreGlobs', ignoreGlobs.value)
          JarDiff.api.compareJarsByPath(fd).then(onDone.bind(null, null)).catch(onDone)
        } else if (mode.value === 'dir') {
          var leftPath = dirLeft.value.trim()
          var rightPath = dirRight.value.trim()
          if (!leftPath || !rightPath) { comparing.value = false; return }
          var dfd = new FormData()
          dfd.append('leftPath', leftPath)
          dfd.append('rightPath', rightPath)
          dfd.append('includeLib', setting.includeLib)
          dfd.append('includeClasses', setting.includeClasses)
          dfd.append('includeResources', setting.includeResources)
          if (setting.includeLib) dfd.append('deepCompareLib', 'true')
          dfd.append('ignoreGlobs', ignoreGlobs.value)
          JarDiff.api.compareDirectoryByPath(dfd).then(onDone.bind(null, null)).catch(onDone)
        } else if (mode.value === 'file') {
          if (!fileLeftPath.value || !fileRightPath.value) { comparing.value = false; return }
          var ffd = new FormData()
          ffd.append('leftPath', fileLeftPath.value)
          ffd.append('rightPath', fileRightPath.value)
          JarDiff.api.compareFilesByPath(ffd).then(function (r) { onDone(null, r) }).catch(onDone)
        // [AGC:START] tool=Cc author=maxwell date=2026-07-29
        } else if (mode.value === 'text') {
          if (!canStartTextCompare.value) { comparing.value = false; return }
          textLeftFile.value = new File([textLeft.value], 'pasted-text.txt', { type: 'text/plain;charset=utf-8' })
          textRightFile.value = new File([textRight.value], 'pasted-text.txt', { type: 'text/plain;charset=utf-8' })
          var tfd = new FormData()
          tfd.append('left', textLeftFile.value)
          tfd.append('right', textRightFile.value)
          JarDiff.api.compareFiles(tfd, null).then(function (r) { onDone(null, r) }).catch(onDone)
        // [AGC:END]
        }
      }

      function selectFile(path) {
        if (!path) return
        selectedPath.value = path
        loadUnifiedDiff(path)
        nextTick(function () {
          var container = document.querySelector('.diff-content')
          if (container) container.scrollTop = 0
        })
      }

      function selectFileFromStruct(path) {
        selectFile(path)
        if (structureFull.value) structureFull.value = false
      }

      // [AGC:START] tool=Cc author=maxwell date=2026-07-27
      function loadFileDiff() {
        var requestId = ++diffRequestSeq.value
        diffLoading.value = true
        diffError.value = ''
        var api = window.JarDiff.api
        var promise = mode.value === 'file'
          ? api.loadFilesUnifiedDiffByPath(fileLeftPath.value, fileRightPath.value)
          : api.loadFilesUnifiedDiff(textLeftFile.value, textRightFile.value)
        promise.then(function (text) {
          if (requestId !== diffRequestSeq.value) return
          diffLoading.value = false
          if (text && text.trim()) {
            try { diffHtml.value = Diff2Html.html(text, { drawFileList: false, matching: 'lines', outputFormat: viewMode.value }) }
            catch (e) { diffHtml.value = '<pre style=\"color:var(--text-primary);padding:16px\">' + escapeHtml(text) + '</pre>' }
          } else {
            diffHtml.value = '<div style=\"padding:24px;text-align:center;color:var(--text-muted)\">无文本差异</div>'
          }
          nextTick(refreshHunks)
        }).catch(function (err) {
          if (requestId !== diffRequestSeq.value) return
          diffLoading.value = false
          diffError.value = err && err.message ? err.message : '请求失败'
        })
      }
      // [AGC:END]

      function loadUnifiedDiff(path) {
        var requestId = ++diffRequestSeq.value
        diffLoading.value = true
        diffError.value = ''
        diffHtml.value = ''
        JarDiff.api.loadUnifiedDiff(compareId.value, path).then(function (text) {
          if (requestId !== diffRequestSeq.value) return
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
          nextTick(refreshHunks)
        }).catch(function (err) {
          if (requestId !== diffRequestSeq.value) return
          diffLoading.value = false
          diffError.value = err && err.message ? err.message : '请求失败'
        })
      }

      function navigateHunk(dir) {
        var targets = hunkTargets.value
        if (!targets.length) return
        hunkIndex.value = Math.max(0, Math.min(targets.length - 1, hunkIndex.value + dir))
        var container = document.querySelector('.diff-content')
        if (!container) return
        var target = targets[hunkIndex.value]
        var containerRect = container.getBoundingClientRect()
        var targetRect = target.getBoundingClientRect()
        var top = container.scrollTop + targetRect.top - containerRect.top - (container.clientHeight - targetRect.height) / 2
        container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      }

      function refreshHunks() {
        var container = document.querySelector('.diff-content')
        if (!container) return
        var containerRect = container.getBoundingClientRect()
        var rows = Array.prototype.filter.call(container.querySelectorAll('tr'), function (row) {
          return row.querySelector('.d2h-ins, .d2h-del') !== null
        }).sort(function (left, right) {
          return left.getBoundingClientRect().top - right.getBoundingClientRect().top
        })
        var targets = []
        var lastBottom = -Infinity
        for (var i = 0; i < rows.length; i++) {
          var rect = rows[i].getBoundingClientRect()
          var top = container.scrollTop + rect.top - containerRect.top
          var bottom = top + rect.height
          if (top > lastBottom + 2) targets.push(rows[i])
          lastBottom = Math.max(lastBottom, bottom)
        }
        hunkTargets.value = targets
        hunkIndex.value = 0
      }

      function retryDiff() {
        if (!selectedPath.value) return
        if (mode.value === 'file' || mode.value === 'text') loadFileDiff()
        else loadUnifiedDiff(selectedPath.value)
      }

      function expandNested(path) {
        if (!path) return
        nestedStates[path] = { status: 'loading', message: '' }
        JarDiff.api.loadNestedTree(compareId.value, path).then(function (nodes) {
          function update(search) {
            for (var i = 0; search && i < search.length; i++) {
              if (search[i].value === path) {
                search[i].children = nodes
                return true
              }
              if (search[i].children && update(search[i].children)) return true
            }
            return false
          }
          update(treeData.value)
          treeData.value = treeData.value.slice()
          nestedStates[path] = { status: 'ready', message: '' }
        }).catch(function (err) {
          nestedStates[path] = { status: 'error', message: err && err.message ? err.message : '请求失败' }
        })
      }

      function syncStructureScroll(event) {
        if (structureSyncing.value) return
        structureSyncing.value = true
        var top = event.currentTarget.scrollTop
        requestAnimationFrame(function () {
          var panes = document.querySelectorAll('.structure-pane')
          for (var i = 0; i < panes.length; i++) {
            if (panes[i] !== event.currentTarget) panes[i].scrollTop = top
          }
          structureSyncing.value = false
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
      watch(navigationMode, function (v) { JarDiff.storage.set('navigationMode', v) })
      watch(viewMode, function (v) {
        JarDiff.storage.set('viewMode', v)
        if (selectedPath.value) {
          if (mode.value === 'file' || mode.value === 'text') loadFileDiff()
          else loadUnifiedDiff(selectedPath.value)
        }
      })
      watch(ignoreGlobs, function (v) { JarDiff.storage.set('ignore', v) })
      watch([function () { return setting.includeClasses }, function () { return setting.includeResources }, function () { return setting.includeLib }],
        function () {
          JarDiff.storage.set('setting.includeClasses', setting.includeClasses)
          JarDiff.storage.set('setting.includeResources', setting.includeResources)
          JarDiff.storage.set('setting.includeLib', setting.includeLib)
        })

      // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
      onMounted(function () {
        JarDiff.api.getCapabilities().then(function (capabilities) {
          directoryCompareEnabled.value = !!(capabilities && capabilities.directoryCompareEnabled === true)
          if (directoryCompareEnabled.value && storedMode === 'dir' && JarDiff.storage.get('mode') === 'dir') {
            mode.value = 'dir'
          } else if (!directoryCompareEnabled.value && (mode.value === 'dir' || JarDiff.storage.get('mode') === 'dir')) {
            switchMode('jar')
          }
        }).catch(function (err) {
          console.error('load compare capabilities failed', err)
          directoryCompareEnabled.value = false
          if (mode.value === 'dir' || JarDiff.storage.get('mode') === 'dir') switchMode('jar')
        })

        // 用户未自定义过忽略规则时，用配置文件预置的默认规则填充输入框（界面可见、可直接改）
        JarDiff.api.getLimits().then(function (lim) {
          if (!ignoreGlobs.value && lim && lim.defaultIgnoreGlobs) {
            ignoreGlobs.value = lim.defaultIgnoreGlobs
          }
        }).catch(function (err) {
          console.error('load default ignore globs failed', err)
        })
      })
      // [AGC:END]

      provide('expandedPaths', expandedPaths)

      // --- exposed ---
      return {
        mode, visibleModes, dirLeft, dirRight, textLeft, textRight, jarLeftPath, jarRightPath, fileLeftPath, fileRightPath, ignoreGlobs, compareId, treeData, selectedPath,
        diffHtml, diffLoading, diffError, navigationMode, viewMode, diffFontSize, pathCopied, diffFocus, searchQuery, statusFilter,
        structureFull, comparing, expandedPaths, leftWidth, showSettings, setting, stats, filteredTree,
        changedFileCount, hunkCount, ignoreRuleCount, canStartTextCompare, hunkIndex, compareLabel, nestedStates,
        switchMode, toggleScope, switchNavigationMode, adjustDiffFont, copySelectedPath, resetCompare, startCompare, selectFile, selectFileFromStruct, navigateHunk,
        loadFileDiff, expandNested, startResize, doResize, stopResize,
        syncStructureScroll, retryDiff, onChooseJarLeft, onChooseJarRight, onChooseFileLeft, onChooseFileRight, onChooseDirLeft, onChooseDirRight, baseName
      }
    }
  })

  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  if (typeof ElementPlus !== 'undefined') {
    app.use(ElementPlus)
  }
  app.mount('#app')
})()
