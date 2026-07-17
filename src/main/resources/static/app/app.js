const { createApp, computed, reactive, ref, watch, nextTick, onMounted, onBeforeUnmount } = Vue

const core = (window.JarDiff && window.JarDiff.core) || {}
const api = (window.JarDiff && window.JarDiff.api) || {}
const storage = (window.JarDiff && window.JarDiff.storage) || null

const DEFAULT_IGNORE_SPRINGBOOT = core.DEFAULT_IGNORE_SPRINGBOOT || ''
const mapStatusBadge = core.mapStatusBadge || ((_) => ({ type: 'info', text: '无变化' }))
const mapStructureBadge = core.mapStructureBadge || ((_) => ({ type: 'info', text: '一致' }))
const flattenChanged = core.flattenChanged || ((_) => [])
const findFirstFile = core.findFirstFile || ((_) => '')
const splitIgnoreGlobs = core.splitIgnoreGlobs || ((_) => [])
const isIgnoredByGlobs = core.isIgnoredByGlobs || ((_) => false)
const buildDiffRows = core.buildDiffRows || ((_) => [])

const DETAIL_PANE_BODY = `
  <div style="display:flex;flex-direction:column;min-height:0;height:100%;">
    <div class="viewer-bar" style="border-bottom:1px solid var(--border);">
      <div class="path-input">
        <el-input :model-value="state.selectedPath" readonly size="small" placeholder="从左侧列表选择变更项" />
        <el-tag v-if="selectedInfo.source" type="info" size="small">{{ selectedInfo.source==='deps' ? '依赖' : (selectedInfo.source==='app' ? '应用' : '其他') }}</el-tag>
        <el-tag v-if="selectedInfo.status" :type="mapStatusBadge(selectedInfo.status).type" size="small">{{ mapStatusBadge(selectedInfo.status).text }}</el-tag>
        <el-tag v-if="state.diffLoading" type="warning" size="small">加载中…</el-tag>
        <el-tag
          v-if="state.compareId && state.warmupTotal"
          :type="state.warmupRunning ? 'warning' : (state.warmupFailed ? 'danger' : 'success')"
          size="small"
        >
          预加载 {{ state.warmupDone }}/{{ state.warmupTotal }}<span v-if="state.warmupFailed">（失败 {{ state.warmupFailed }}）</span>
        </el-tag>
        <el-button size="small" :disabled="!state.selectedPath" @click="copySelectedPath">复制路径</el-button>
      </div>
      <div class="viewer-actions">
        <el-switch v-if="isWide" v-model="state.focusMode" size="small" active-text="专注" inactive-text="普通" />
        <el-tabs v-model="state.viewMode" class="viewer-tabs" type="card">
          <el-tab-pane label="结构" name="structure"></el-tab-pane>
          <el-tab-pane label="内容" name="content"></el-tab-pane>
          <el-tab-pane label="摘要" name="summary"></el-tab-pane>
          <el-tab-pane label="依赖" name="deps"></el-tab-pane>
        </el-tabs>

        <template v-if="state.viewMode==='content'">
          <el-button size="small" :disabled="!changeLines.length" @click="stepChange(-1)">上一处</el-button>
          <el-button size="small" :disabled="!changeLines.length" @click="stepChange(1)">下一处</el-button>
          <el-popover v-model:visible="state.hunkPopoverOpen" trigger="click" width="240">
            <div style="display:flex;flex-direction:column;gap:10px;">
              <el-switch v-model="state.showDiffOnly" size="small" active-text="仅差异" inactive-text="全文" />
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <el-button size="small" :disabled="!state.showDiffOnly || !selectedDiff || !selectedDiff.hunks || !selectedDiff.hunks.length" @click="collapseAllHunks">折叠全部</el-button>
                <el-button size="small" :disabled="!state.showDiffOnly || !selectedDiff || !selectedDiff.hunks || !selectedDiff.hunks.length" @click="expandAllHunks">展开全部</el-button>
              </div>
            </div>
            <template #reference>
              <el-button size="small" :disabled="!selectedDiff || selectedDiff.kind!=='text' || !selectedDiff.hunks || !selectedDiff.hunks.length">变更块</el-button>
            </template>
          </el-popover>
          <el-popover v-model:visible="state.readingPopoverOpen" trigger="click" width="220">
            <div style="display:flex;flex-direction:column;gap:10px;">
              <el-switch v-model="state.syncScroll" size="small" active-text="同步滚动" inactive-text="独立滚动" />
              <el-switch v-model="state.wrapLines" size="small" active-text="自动换行" inactive-text="不换行" />
              <el-button size="small" :disabled="!state.selectedPath || state.diffLoading" @click="openDiffDialog(state.selectedPath)">全屏</el-button>
            </div>
            <template #reference>
              <el-button size="small">阅读</el-button>
            </template>
          </el-popover>
        </template>
      </div>
    </div>

    <div v-if="state.viewMode==='content'" style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;">
      <div v-if="state.diffLoading" style="padding:10px;flex:1;overflow:auto;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <el-tag type="warning" size="small">正在加载差异</el-tag>
          <span class="mono" style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">{{ state.diffLoadingPath }}</span>
        </div>
        <div style="margin-top:10px;">
          <el-skeleton :rows="10" animated />
        </div>
      </div>

      <div v-else-if="!selectedDiff" style="padding:10px;flex:1;overflow:auto;">
        <el-alert v-if="state.diffError" type="error" :closable="false" title="差异加载失败" :description="state.diffError" show-icon />
        <el-empty v-else :description="state.compareId ? '请从左侧列表选择变更项查看差异' : '请先完成一次比对'"></el-empty>
      </div>

      <div v-else-if="selectedDiff && selectedDiff.kind==='binary'" style="padding:10px;flex:1;overflow:auto;">
        <el-alert type="info" :closable="false" title="二进制/非文本差异" :description="selectedDiff.message" show-icon />
      </div>

      <div v-else :class="['diff-view', state.wrapLines ? 'wrap-lines' : '']" style="flex:1;min-height:0;">
        <div :class="['diff-sbs', minimapMarks.length ? 'with-minimap' : '']">
          <div class="diff-pane">
            <div class="diff-pane-head">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">左侧基准</span>
              <el-tag v-if="state.syncScroll" type="info" size="small">同步</el-tag>
            </div>
            <div class="diff-pane-body left" ref="mainLeftDiffPaneRef" @scroll="onDiffScroll('left', $event)">
              <template v-for="row in viewRows" :key="row.kind==='row' ? 'r'+row.rowIndex : 'rg'+row.from">
                <div v-if="row.kind==='gap'" class="diff-gap" :data-row-index="Number.isFinite(row.from) ? row.from : undefined">
                  <template v-if="row.gapType==='hunkHeader'">
                    <div class="diff-hunk-head">
                      <div class="diff-hunk-title">
                        变更块 {{ (Number.isFinite(row.hunkIndex) ? row.hunkIndex : 0) + 1 }}
                        <span class="mono" v-if="row.leftStart && row.leftEnd">左 {{ row.leftStart }}-{{ row.leftEnd }}</span>
                        <span class="mono" v-if="row.rightStart && row.rightEnd">右 {{ row.rightStart }}-{{ row.rightEnd }}</span>
                      </div>
                      <div class="diff-hunk-actions">
                        <el-button size="small" @click="scrollToRow(row.from)">定位</el-button>
                        <el-button size="small" type="primary" plain @click="toggleHunkCollapse(row.hunkIndex)">{{ row.collapsed ? '展开' : '折叠' }}</el-button>
                      </div>
                    </div>
                  </template>
                  <template v-else-if="row.gapType==='hunkCollapsed'">
                    <div class="diff-hunk-collapsed">
                      … 已折叠 {{ row.count }} 行 …
                      <el-button size="small" type="primary" plain @click="toggleHunkCollapse(row.hunkIndex)">展开</el-button>
                    </div>
                  </template>
                  <template v-else>
                    … 省略 {{ row.count }} 行 …
                  </template>
                </div>
                <div v-if="row.kind!=='gap'" class="diff-line" :data-row-index="row.rowIndex">
                  <div class="diff-ln">{{ row.leftNo ? String(row.leftNo).padStart(4,' ') : '' }}</div>
                  <div :class="['diff-code', 'line', row.leftType, row.isActive ? 'active' : '']">{{ row.leftText }}</div>
                </div>
              </template>
            </div>
          </div>

          <div class="diff-pane">
            <div class="diff-pane-head">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">右侧目标</span>
              <el-tag v-if="selectedDiff.missingRight" type="danger" size="small">缺失</el-tag>
            </div>
            <div class="diff-pane-body right" ref="mainRightDiffPaneRef" @scroll="onDiffScroll('right', $event)">
              <template v-for="row in viewRows" :key="row.kind==='row' ? 'r2'+row.rowIndex : 'rg2'+row.from">
                <div v-if="row.kind==='gap'" class="diff-gap" :data-row-index="Number.isFinite(row.from) ? row.from : undefined">
                  <template v-if="row.gapType==='hunkHeader'">
                    <div class="diff-hunk-head">
                      <div class="diff-hunk-title">
                        变更块 {{ (Number.isFinite(row.hunkIndex) ? row.hunkIndex : 0) + 1 }}
                        <span class="mono" v-if="row.leftStart && row.leftEnd">左 {{ row.leftStart }}-{{ row.leftEnd }}</span>
                        <span class="mono" v-if="row.rightStart && row.rightEnd">右 {{ row.rightStart }}-{{ row.rightEnd }}</span>
                      </div>
                      <div class="diff-hunk-actions">
                        <el-button size="small" @click="scrollToRow(row.from)">定位</el-button>
                        <el-button size="small" type="primary" plain @click="toggleHunkCollapse(row.hunkIndex)">{{ row.collapsed ? '展开' : '折叠' }}</el-button>
                      </div>
                    </div>
                  </template>
                  <template v-else-if="row.gapType==='hunkCollapsed'">
                    <div class="diff-hunk-collapsed">
                      … 已折叠 {{ row.count }} 行 …
                      <el-button size="small" type="primary" plain @click="toggleHunkCollapse(row.hunkIndex)">展开</el-button>
                    </div>
                  </template>
                  <template v-else>
                    … 省略 {{ row.count }} 行 …
                  </template>
                </div>
                <div v-if="row.kind!=='gap'" class="diff-line" :data-row-index="row.rowIndex">
                  <div class="diff-ln">{{ row.rightNo ? String(row.rightNo).padStart(4,' ') : '' }}</div>
                  <div :class="['diff-code', 'line', row.rightType, row.isActive ? 'active' : '']">{{ row.rightText }}</div>
                </div>
              </template>
            </div>
          </div>

          <div v-if="minimapMarks.length" class="diff-minimap" aria-hidden="true">
            <div
              v-for="m in minimapMarks"
              :key="m.key"
              :class="['diff-minimap-mark', m.kind ? ('mk-' + m.kind) : '']"
              :style="{ top: m.top + '%', height: m.height + '%' }"
              :title="m.kind==='added' ? '新增' : (m.kind==='missing' ? '缺失' : (m.kind==='mixed' ? '混合' : '修改'))"
              role="button"
              tabindex="0"
              @click.stop="scrollToRow(m.rowIndex)"
              @keydown.enter.prevent="scrollToRow(m.rowIndex)"
              @keydown.space.prevent="scrollToRow(m.rowIndex)"
            ></div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="state.viewMode==='structure'" class="structure-compare" style="flex:1;min-height:0;">
      <div v-if="structureRows.length" class="structure-tree-wrap" ref="structureScrollRef" @scroll="onStructureScroll">
        <div :style="{ height: structureVirtualEnabled ? (structureTopPad + 'px') : '' }"></div>
        <div style="display:flex;flex-direction:column;gap:2px;">
          <div
            v-for="r in (structureVirtualEnabled ? structureVisibleRows : structureRows)"
            :key="r.key"
            :class="['structure-row', (state.selectedPath===String(r.node.value||'') || (state.selectedPath && r.node.value && state.selectedPath.startsWith(String(r.node.value) + '!/'))) ? 'is-selected' : '']"
            role="button"
            tabindex="0"
            :data-node-key="r.key"
            @click="onStructureRowClick(r.node)"
            @keydown.enter.prevent="onStructureRowClick(r.node)"
            @keydown.space.prevent="onStructureRowClick(r.node)"
          >
            <div
              class="structure-cell left"
              :class="[(r.status ? ('s-' + r.status) : ''), !r.leftExists ? 'structure-placeholder' : '']"
              :title="r.node.displayTitle || r.node.value"
              :style="{ paddingLeft: (r.depth * 14) + 'px' }"
            >
              <span v-if="(r.node.type==='dir' || r.node.type==='jar') && r.node.children && r.node.children.length" class="structure-expander" aria-hidden="true">
                {{ structureExpanded[r.key] ? '▾' : '▸' }}
              </span>
              <span v-else class="structure-bullet" aria-hidden="true">•</span>
              <span v-if="r.node.type==='dir' || r.node.type==='jar'" class="structure-icon">📁</span>
              <span v-else class="structure-icon">📄</span>
              <span class="structure-label">{{ r.node.displayLabel || r.node.label }}</span>
            </div>
            <div class="structure-gutter"></div>
            <div
              class="structure-cell right"
              :class="[(r.status ? ('s-' + r.status) : ''), !r.rightExists ? 'structure-placeholder' : '']"
              :title="r.node.displayTitle || r.node.value"
              :style="{ paddingLeft: (r.depth * 14) + 'px' }"
            >
              <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                <span v-if="(r.node.type==='dir' || r.node.type==='jar') && r.node.children && r.node.children.length" class="structure-expander" aria-hidden="true">
                  {{ structureExpanded[r.key] ? '▾' : '▸' }}
                </span>
                <span v-else class="structure-bullet" aria-hidden="true">•</span>
                <span v-if="r.node.type==='dir' || r.node.type==='jar'" class="structure-icon">📁</span>
                <span v-else class="structure-icon">📄</span>
                <span class="structure-label">{{ r.node.displayLabel || r.node.label }}</span>
              </div>
              <el-tag
                v-if="(r.node.type==='file' || r.node.type==='jar') && r.node.rightStatus && r.node.rightStatus!=='unchanged'"
                :type="mapStructureBadge('right', r.node.rightStatus).type"
                size="small"
              >
                {{ mapStructureBadge('right', r.node.rightStatus).text }}
              </el-tag>
            </div>
          </div>
        </div>
        <div :style="{ height: structureVirtualEnabled ? (structureBottomPad + 'px') : '' }"></div>
      </div>
      <div v-else style="padding:10px;">
        <el-empty :description="state.compareId ? '结构视图暂无差异' : '请先完成一次比对'"></el-empty>
      </div>
    </div>

    <div v-if="state.viewMode==='summary'" style="padding:10px;flex:1;min-height:0;overflow:auto;">
      <el-empty v-if="!state.compareId" description="请先完成一次比对"></el-empty>
      <template v-else>
        <el-row :gutter="10">
          <el-col :span="state.compareMode==='directory' ? 12 : 8">
            <el-card shadow="never">
              <template #header><span>应用变更</span></template>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <el-tag type="warning" size="small">修改：{{ summaryModel.total.app.modified }}</el-tag>
                <el-tag type="info" size="small">元信息：{{ summaryModel.total.app.meta }}</el-tag>
                <el-tag type="success" size="small">新增：{{ summaryModel.total.app.added }}</el-tag>
                <el-tag type="danger" size="small">缺失：{{ summaryModel.total.app.missing }}</el-tag>
              </div>
            </el-card>
          </el-col>
          <el-col v-if="state.compareMode!=='directory'" :span="8">
            <el-card shadow="never">
              <template #header><span>依赖变更</span></template>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <el-tag type="warning" size="small">修改：{{ summaryModel.total.deps.modified }}</el-tag>
                <el-tag type="info" size="small">元信息：{{ summaryModel.total.deps.meta }}</el-tag>
                <el-tag type="success" size="small">新增：{{ summaryModel.total.deps.added }}</el-tag>
                <el-tag type="danger" size="small">缺失：{{ summaryModel.total.deps.missing }}</el-tag>
              </div>
            </el-card>
          </el-col>
          <el-col :span="state.compareMode==='directory' ? 12 : 8">
            <el-card shadow="never">
              <template #header><span>其他</span></template>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <el-tag type="warning" size="small">修改：{{ summaryModel.total.other.modified }}</el-tag>
                <el-tag type="info" size="small">元信息：{{ summaryModel.total.other.meta }}</el-tag>
                <el-tag type="success" size="small">新增：{{ summaryModel.total.other.added }}</el-tag>
                <el-tag type="danger" size="small">缺失：{{ summaryModel.total.other.missing }}</el-tag>
              </div>
            </el-card>
          </el-col>
        </el-row>

        <el-row :gutter="10" style="margin-top:10px;">
          <el-col :span="12">
            <el-card shadow="never">
              <template #header><span>{{ state.compareMode==='directory' ? 'Top 变化目录' : 'Top 变化目录（应用）' }}</span></template>
              <el-table :data="summaryModel.topChangedDirs" size="small" border style="width:100%;">
                <el-table-column prop="dir" label="目录" min-width="260" />
                <el-table-column prop="count" label="数量" width="90" />
              </el-table>
            </el-card>
          </el-col>
          <el-col :span="12">
            <el-card shadow="never">
              <template #header><span>风险提示</span></template>
              <div v-if="!summaryModel.findings.length" style="padding:4px 0;color:var(--muted);font-size:12px;">暂无明显风险提示</div>
              <div v-else style="display:flex;flex-direction:column;gap:8px;">
                <el-alert
                  v-for="(f,idx) in summaryModel.findings"
                  :key="idx"
                  :type="f.level==='warn' ? 'warning' : (f.level==='info' ? 'info' : 'success')"
                  :closable="false"
                  :title="f.title"
                  :description="f.desc"
                  show-icon
                />
              </div>
            </el-card>
          </el-col>
        </el-row>
      </template>
    </div>

    <div v-if="state.viewMode==='deps'" style="padding:10px;flex:1;min-height:0;overflow:auto;">
      <el-alert type="info" :closable="false" title="依赖视图" description="这里按 lib jar 维度聚合差异；点击可打开 jar 的元信息/差异摘要。" show-icon />
      <div style="margin-top:10px;">
        <el-table :data="dependencyRows" size="small" border style="width:100%;">
          <el-table-column prop="jarPath" label="依赖 jar" min-width="340">
            <template #default="{ row }"><span class="mono" :title="row.jarPath">{{ jarDisplayName(row.jarPath) }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }"><el-tag :type="mapStatusBadge(row.status).type" size="small">{{ mapStatusBadge(row.status).text }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }"><el-button size="small" type="primary" @click.stop="openDependencyDialog(row)">查看</el-button></template>
          </el-table-column>
        </el-table>
        <div v-if="!dependencyRows.length" style="padding:10px;">
          <el-empty description="依赖暂无差异"></el-empty>
        </div>
      </div>
    </div>

    <el-dialog v-model="state.diffDialogOpen" class="glass-dialog" width="96%" top="3vh" :close-on-click-modal="false" modal-class="dialog-modal" @opened="onDiffDialogOpened" @closed="onDiffDialogClosed">
      <template #header>
        <div class="dialog-head">
          <div class="dialog-head-title">
            文件差异：<span class="mono">{{ state.selectedPath }}</span>
          </div>
        </div>
      </template>

      <div class="dialog-shell">
        <div class="dialog-toolbar">
          <div class="dialog-toolbar-left">
            <el-switch v-model="state.syncScroll" size="small" active-text="同步滚动" inactive-text="独立滚动" />
            <el-switch v-model="state.wrapLines" size="small" active-text="自动换行" inactive-text="不换行" />
            <el-switch v-model="state.showDiffOnly" size="small" active-text="仅差异" inactive-text="全文" />
          </div>
          <div class="dialog-toolbar-right">
            <el-button size="small" :disabled="!changeLines.length" @click="stepChange(-1)">上一处</el-button>
            <el-button size="small" :disabled="!changeLines.length" @click="stepChange(1)">下一处</el-button>
          </div>
        </div>

        <div v-if="state.diffLoading" style="padding:10px;flex:1;overflow:auto;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <el-tag type="warning" size="small">正在加载差异</el-tag>
            <span class="mono" style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">{{ state.diffLoadingPath }}</span>
          </div>
          <div style="margin-top:10px;">
            <el-skeleton :rows="10" animated />
          </div>
        </div>

        <div v-else-if="!selectedDiff" style="padding:10px;flex:1;overflow:auto;">
          <el-alert v-if="state.diffError" type="error" :closable="false" title="差异加载失败" :description="state.diffError" show-icon />
          <el-empty v-else description="加载差异中或未选择文件"></el-empty>
        </div>

        <div v-if="selectedDiff && selectedDiff.kind==='binary'" style="padding:10px;flex:1;overflow:auto;">
          <el-alert type="info" :closable="false" title="二进制/非文本差异" :description="selectedDiff.message" show-icon />
        </div>

        <div v-if="selectedDiff && selectedDiff.kind!=='binary'" :class="['diff-view', state.wrapLines ? 'wrap-lines' : '']" style="flex:1;">
          <div :class="['diff-sbs', minimapMarks.length ? 'with-minimap' : '']">
            <div class="diff-pane">
              <div class="diff-pane-head">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">左侧基准</span>
                <el-tag v-if="state.syncScroll" type="info" size="small">同步</el-tag>
              </div>
              <div class="diff-pane-body left" ref="dialogLeftDiffPaneRef" @scroll="onDiffScroll('left', $event)">
                <template v-for="row in viewRows" :key="row.kind==='row' ? 'r3'+row.rowIndex : 'rg3'+row.from">
                  <div v-if="row.kind==='gap'" class="diff-gap" :data-row-index="Number.isFinite(row.from) ? row.from : undefined">
                    <template v-if="row.gapType==='hunkHeader'">
                      <div class="diff-hunk-head">
                        <div class="diff-hunk-title">
                          变更块 {{ (Number.isFinite(row.hunkIndex) ? row.hunkIndex : 0) + 1 }}
                          <span class="mono" v-if="row.leftStart && row.leftEnd">左 {{ row.leftStart }}-{{ row.leftEnd }}</span>
                          <span class="mono" v-if="row.rightStart && row.rightEnd">右 {{ row.rightStart }}-{{ row.rightEnd }}</span>
                        </div>
                        <div class="diff-hunk-actions">
                          <el-button size="small" @click="scrollToRow(row.from)">定位</el-button>
                          <el-button size="small" type="primary" plain @click="toggleHunkCollapse(row.hunkIndex)">{{ row.collapsed ? '展开' : '折叠' }}</el-button>
                        </div>
                      </div>
                    </template>
                    <template v-else-if="row.gapType==='hunkCollapsed'">
                      <div class="diff-hunk-collapsed">
                        … 已折叠 {{ row.count }} 行 …
                        <el-button size="small" type="primary" plain @click="toggleHunkCollapse(row.hunkIndex)">展开</el-button>
                      </div>
                    </template>
                    <template v-else>
                      … 省略 {{ row.count }} 行 …
                    </template>
                  </div>
                  <div v-if="row.kind!=='gap'" class="diff-line" :data-row-index="row.rowIndex">
                    <div class="diff-ln">{{ row.leftNo ? String(row.leftNo).padStart(4,' ') : '' }}</div>
                    <div :class="['diff-code', 'line', row.leftType, row.isActive ? 'active' : '']">{{ row.leftText }}</div>
                  </div>
                </template>
              </div>
            </div>

            <div class="diff-pane">
              <div class="diff-pane-head">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">右侧目标</span>
                <el-tag v-if="selectedDiff.missingRight" type="danger" size="small">缺失</el-tag>
              </div>
              <div class="diff-pane-body right" ref="dialogRightDiffPaneRef" @scroll="onDiffScroll('right', $event)">
                <template v-for="row in viewRows" :key="row.kind==='row' ? 'r4'+row.rowIndex : 'rg4'+row.from">
                  <div v-if="row.kind==='gap'" class="diff-gap" :data-row-index="Number.isFinite(row.from) ? row.from : undefined">
                    <template v-if="row.gapType==='hunkHeader'">
                      <div class="diff-hunk-head">
                        <div class="diff-hunk-title">
                          变更块 {{ (Number.isFinite(row.hunkIndex) ? row.hunkIndex : 0) + 1 }}
                          <span class="mono" v-if="row.leftStart && row.leftEnd">左 {{ row.leftStart }}-{{ row.leftEnd }}</span>
                          <span class="mono" v-if="row.rightStart && row.rightEnd">右 {{ row.rightStart }}-{{ row.rightEnd }}</span>
                        </div>
                        <div class="diff-hunk-actions">
                          <el-button size="small" @click="scrollToRow(row.from)">定位</el-button>
                          <el-button size="small" type="primary" plain @click="toggleHunkCollapse(row.hunkIndex)">{{ row.collapsed ? '展开' : '折叠' }}</el-button>
                        </div>
                      </div>
                    </template>
                    <template v-else-if="row.gapType==='hunkCollapsed'">
                      <div class="diff-hunk-collapsed">
                        … 已折叠 {{ row.count }} 行 …
                        <el-button size="small" type="primary" plain @click="toggleHunkCollapse(row.hunkIndex)">展开</el-button>
                      </div>
                    </template>
                    <template v-else>
                      … 省略 {{ row.count }} 行 …
                    </template>
                  </div>
                  <div v-if="row.kind!=='gap'" class="diff-line" :data-row-index="row.rowIndex">
                    <div class="diff-ln">{{ row.rightNo ? String(row.rightNo).padStart(4,' ') : '' }}</div>
                    <div :class="['diff-code', 'line', row.rightType, row.isActive ? 'active' : '']">{{ row.rightText }}</div>
                  </div>
                </template>
              </div>
            </div>

            <div v-if="minimapMarks.length" class="diff-minimap" aria-hidden="true">
              <div
                v-for="m in minimapMarks"
                :key="m.key"
                :class="['diff-minimap-mark', m.kind ? ('mk-' + m.kind) : '']"
                :style="{ top: m.top + '%', height: m.height + '%' }"
                :title="m.kind==='added' ? '新增' : (m.kind==='missing' ? '缺失' : (m.kind==='mixed' ? '混合' : '修改'))"
                role="button"
                tabindex="0"
                @click.stop="scrollToRow(m.rowIndex)"
                @keydown.enter.prevent="scrollToRow(m.rowIndex)"
                @keydown.space.prevent="scrollToRow(m.rowIndex)"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
`

const APP_TEMPLATE = `
  <el-container class="app-shell">
    <el-header ref="headerContainerRef" class="toolbar-sticky" style="padding:0;">
      <div class="toolbar-wrap">
        <div class="toolbar-left" aria-label="工具标题">
          <div class="brand">
            <div class="brand-mark" aria-hidden="true"></div>
            <div class="brand-title">
              <strong>Jar 版本差异比对</strong>
              <span>先看结论，再定位目标，最后确认证据</span>
            </div>
          </div>
        </div>

        <div class="toolbar-right" aria-label="顶部操作区">
          <el-radio-group v-model="state.compareMode" size="small" aria-label="比对模式">
            <el-radio-button label="single">Jar 包</el-radio-button>
            <el-radio-button label="directory">目录</el-radio-button>
          </el-radio-group>

          <template v-if="state.compareMode==='single'">
            <el-upload v-model:file-list="leftJar" :auto-upload="false" :limit="1" accept=".jar" :show-file-list="false">
              <el-button size="small">旧版 Jar</el-button>
            </el-upload>
            <div v-if="leftJar.length" class="file-pill" title="旧版 jar"><span>{{ leftJar[0].name }}</span></div>

            <el-upload v-model:file-list="rightJar" :auto-upload="false" :limit="1" accept=".jar" :show-file-list="false">
              <el-button size="small">新版 Jar</el-button>
            </el-upload>
            <div v-if="rightJar.length" class="file-pill" title="新版 jar"><span>{{ rightJar[0].name }}</span></div>
          </template>

          <template v-if="state.compareMode==='directory'">
            <el-radio-group v-model="state.directoryInputMode" size="small" @change="onDirectoryInputModeChange">
              <el-radio-button label="picker">选择目录</el-radio-button>
              <el-radio-button label="path">填写路径</el-radio-button>
            </el-radio-group>
            <template v-if="state.directoryInputMode==='picker'">
              <input ref="leftDirInputRef" type="file" webkitdirectory multiple style="display:none;" @change="onDirectoryPicked('left',$event)" />
              <input ref="rightDirInputRef" type="file" webkitdirectory multiple style="display:none;" @change="onDirectoryPicked('right',$event)" />
              <el-button size="small" @click="pickDirectory('left')">旧版目录</el-button>
              <div v-if="leftDirFiles.length" class="file-pill"><span>旧：{{ leftDirPickedPill }}</span></div>
              <el-button size="small" @click="pickDirectory('right')">新版目录</el-button>
              <div v-if="rightDirFiles.length" class="file-pill"><span>新：{{ rightDirPickedPill }}</span></div>
            </template>
            <template v-else>
              <div class="dir-path-inputs">
                <el-autocomplete
                  v-model="state.leftDirPath"
                  class="dir-path-input"
                  :fetch-suggestions="suggestDirHistory"
                  :trigger-on-focus="true"
                  clearable
                  size="small"
                  placeholder="旧版目录路径"
                  @blur="trimDirPaths"
                />
                <el-autocomplete
                  v-model="state.rightDirPath"
                  class="dir-path-input"
                  :fetch-suggestions="suggestDirHistory"
                  :trigger-on-focus="true"
                  clearable
                  size="small"
                  placeholder="新版目录路径"
                  @blur="trimDirPaths"
                />
              </div>
            </template>
          </template>

          <el-button size="small" type="primary" :loading="state.isComparing" @click="startCompare" :disabled="!canCompare">开始比对</el-button>
          <el-button size="small" @click="state.settingsOpen = true">设置</el-button>
          <el-tag type="info" size="small">{{ compareLimitHint }}</el-tag>
        </div>
      </div>
    </el-header>

    <el-main style="padding:0;">
      <div class="workspace">
        <div class="summary-grid" aria-label="结论摘要">
          <div
            :class="['summary-card','s-modified', !state.compareId ? 'is-disabled' : '']"
            role="button"
            tabindex="0"
            :aria-disabled="!state.compareId"
            @click="onSummaryCardActivate('modified')"
            @keydown.enter.prevent="onSummaryCardActivate('modified')"
            @keydown.space.prevent="onSummaryCardActivate('modified')"
          >
            <div style="min-width:0;">
              <div class="k">修改</div>
              <div class="hint">优先关注：行为/签名变化</div>
            </div>
            <div class="v">{{ summaryTotals.modified }}</div>
          </div>
          <div
            :class="['summary-card','s-added', !state.compareId ? 'is-disabled' : '']"
            role="button"
            tabindex="0"
            :aria-disabled="!state.compareId"
            @click="onSummaryCardActivate('added')"
            @keydown.enter.prevent="onSummaryCardActivate('added')"
            @keydown.space.prevent="onSummaryCardActivate('added')"
          >
            <div style="min-width:0;">
              <div class="k">新增</div>
              <div class="hint">新增类/资源/依赖</div>
            </div>
            <div class="v">{{ summaryTotals.added }}</div>
          </div>
          <div
            :class="['summary-card','s-missing', !state.compareId ? 'is-disabled' : '']"
            role="button"
            tabindex="0"
            :aria-disabled="!state.compareId"
            @click="onSummaryCardActivate('missing')"
            @keydown.enter.prevent="onSummaryCardActivate('missing')"
            @keydown.space.prevent="onSummaryCardActivate('missing')"
          >
            <div style="min-width:0;">
              <div class="k">缺失</div>
              <div class="hint">删除项最容易引发兼容性风险</div>
            </div>
            <div class="v">{{ summaryTotals.missing }}</div>
          </div>
          <div
            :class="['summary-card','s-meta', !state.compareId ? 'is-disabled' : '']"
            role="button"
            tabindex="0"
            :aria-disabled="!state.compareId"
            @click="onSummaryCardActivate('meta')"
            @keydown.enter.prevent="onSummaryCardActivate('meta')"
            @keydown.space.prevent="onSummaryCardActivate('meta')"
          >
            <div style="min-width:0;">
              <div class="k">元信息</div>
              <div class="hint">时间戳/顺序/压缩差异</div>
            </div>
            <div class="v">{{ summaryTotals.meta }}</div>
          </div>
        </div>

        <div v-if="state.compareError">
          <el-alert type="error" title="比对失败" :description="state.compareError" show-icon @close="clearCompareError" />
        </div>

        <div v-if="state.isComparing">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
            <el-tag v-if="state.compareStage" type="warning" size="small">{{ state.compareStage }}</el-tag>
            <span v-if="state.compareDetail" class="mono" style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">{{ state.compareDetail }}</span>
          </div>
          <el-progress :percentage="state.percent" :stroke-width="10" :status="compareProgressStatus" />
        </div>

        <div
          :class="['workspace-grid', isWide ? 'workspace-split' : '']"
          aria-label="工作台"
          :style="isWide ? { gridTemplateColumns: workspaceGridColumns } : undefined"
        >
          <div v-if="!state.focusMode" class="pane" aria-label="差异列表">
            <div class="pane-head" style="flex-direction:column;align-items:stretch;">
              <div class="filter-bar">
                <el-input v-model="state.search" clearable size="small" placeholder="搜索：路径 / 类名 / 资源名" style="width:320px;" />
                <el-select v-model="state.statusFilter" size="small" style="width:110px;">
                  <el-option label="全部类型" value="all" />
                  <el-option label="修改" value="modified" />
                  <el-option label="元信息" value="meta" />
                  <el-option label="新增" value="added" />
                  <el-option label="缺失" value="missing" />
                </el-select>
                <el-select v-model="state.sourceFilter" size="small" style="width:110px;">
                  <el-option label="全部范围" value="all" />
                  <el-option label="应用" value="app" />
                  <el-option v-if="state.compareMode!=='directory'" label="依赖" value="deps" />
                  <el-option label="其他" value="other" />
                </el-select>
                <el-select v-model="state.riskFilter" size="small" style="width:110px;">
                  <el-option label="全部风险" value="all" />
                  <el-option label="高风险" value="high" />
                  <el-option label="中风险" value="medium" />
                  <el-option label="低风险" value="low" />
                </el-select>
                <el-select v-model="state.groupBy" size="small" style="width:120px;">
                  <el-option label="按目录" value="dir" />
                  <el-option label="按包/路径" value="package" />
                  <el-option label="按类型" value="kind" />
                  <el-option label="按风险" value="risk" />
                </el-select>
                <el-switch v-model="state.groupedView" size="small" active-text="分组" inactive-text="平铺" />
                <el-button size="small" @click="resetFilters">重置</el-button>
              </div>
              <div class="chip-row" v-if="activeFilterChips.length">
                <el-tag v-for="c in activeFilterChips" :key="c.key" closable size="small" @close="clearFilterChip(c.key)">
                  {{ c.label }}：{{ c.value }}
                </el-tag>
              </div>
            </div>

            <div class="pane-body" style="padding:10px;">
              <el-empty v-if="!state.compareId" description="请先完成一次比对"></el-empty>
              <template v-else>
                <div v-if="!changedFiles.length" style="padding:10px;">
                  <el-empty description="暂无差异或已被筛选条件清空"></el-empty>
                </div>
                <template v-else>
                  <el-collapse v-if="state.groupedView" v-model="state.listGroupsOpen">
                    <el-collapse-item v-for="g in listGroups" :key="g.key" :name="g.key">
                      <template #title>
                        <div style="display:flex;align-items:center;gap:10px;min-width:0;width:100%;">
                          <div class="mono" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ g.title }}</div>
                          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                            <el-tag v-if="g.stats.modified" type="warning" size="small">改 {{ g.stats.modified }}</el-tag>
                            <el-tag v-if="g.stats.meta" type="info" size="small">元 {{ g.stats.meta }}</el-tag>
                            <el-tag v-if="g.stats.added" type="success" size="small">新 {{ g.stats.added }}</el-tag>
                            <el-tag v-if="g.stats.missing" type="danger" size="small">缺 {{ g.stats.missing }}</el-tag>
                            <el-tag type="info" size="small">共 {{ g.rows.length }}</el-tag>
                          </div>
                        </div>
                      </template>

                      <el-table :data="g.rows" size="small" border style="width:100%;" @row-click="openFromListRow">
                        <el-table-column label="类型" width="84">
                          <template #default="{ row }"><el-tag :type="mapStatusBadge(row.status).type" size="small">{{ mapStatusBadge(row.status).text }}</el-tag></template>
                        </el-table-column>
                        <el-table-column label="路径" min-width="280">
                          <template #default="{ row }">
                            <el-link :underline="false" @click.stop="openStructureFromListRow(row)">
                              <span class="mono" :title="row.displayPath || row.path">{{ row.displayPath || row.path }}</span>
                            </el-link>
                          </template>
                        </el-table-column>
                        <el-table-column prop="changeSummary" label="摘要" min-width="140" />
                        <el-table-column label="风险" width="90">
                          <template #default="{ row }"><el-tag :type="mapRiskTagType(row.riskLevel)" size="small">{{ row.riskLevel }}</el-tag></template>
                        </el-table-column>
                        <el-table-column label="操作" width="90">
                          <template #default="{ row }"><el-button size="small" type="primary" @click.stop="openFromListRow(row)">查看</el-button></template>
                        </el-table-column>
                      </el-table>
                    </el-collapse-item>
                  </el-collapse>

                  <el-table v-else :data="listGroups[0] ? listGroups[0].rows : []" size="small" border style="width:100%;" @row-click="openFromListRow">
                    <el-table-column label="类型" width="84">
                      <template #default="{ row }"><el-tag :type="mapStatusBadge(row.status).type" size="small">{{ mapStatusBadge(row.status).text }}</el-tag></template>
                    </el-table-column>
                    <el-table-column label="路径" min-width="280">
                      <template #default="{ row }">
                        <el-link :underline="false" @click.stop="openStructureFromListRow(row)">
                          <span class="mono" :title="row.displayPath || row.path">{{ row.displayPath || row.path }}</span>
                        </el-link>
                      </template>
                    </el-table-column>
                    <el-table-column prop="changeSummary" label="摘要" min-width="140" />
                    <el-table-column label="风险" width="90">
                      <template #default="{ row }"><el-tag :type="mapRiskTagType(row.riskLevel)" size="small">{{ row.riskLevel }}</el-tag></template>
                    </el-table-column>
                    <el-table-column label="操作" width="90">
                      <template #default="{ row }"><el-button size="small" type="primary" @click.stop="openFromListRow(row)">查看</el-button></template>
                    </el-table-column>
                  </el-table>
                </template>
              </template>
            </div>
          </div>

          <div
            v-if="isWide && !state.focusMode"
            class="pane-resizer"
            role="separator"
            aria-orientation="vertical"
            tabindex="0"
            @mousedown.prevent="startSidebarResize"
            @dblclick="resetSidebarWidth"
            @keydown.left.prevent="nudgeSidebar(-12)"
            @keydown.right.prevent="nudgeSidebar(12)"
          ></div>

          <div v-if="isWide" class="pane" aria-label="详情面板">
            ${DETAIL_PANE_BODY}
          </div>
        </div>

        <el-drawer v-if="!isWide" v-model="state.detailDrawerOpen" title="变更详情" size="72%">
          ${DETAIL_PANE_BODY}
        </el-drawer>

        <el-dialog v-model="state.depsDialogOpen" class="glass-dialog" width="96%" top="3vh" :close-on-click-modal="false" modal-class="dialog-modal">
          <template #header>
            <div class="dialog-head">
              <div class="dialog-head-title">
                依赖差异：<span class="mono">{{ jarDisplayName(state.depsJarPath) }}</span>
                <span style="color:var(--muted);font-size:12px;margin-left:8px;">{{ state.depsJarPath }}</span>
                <el-tag v-if="state.depsJarStatus" :type="mapStatusBadge(state.depsJarStatus).type" size="small" style="margin-left:8px;">
                  {{ mapStatusBadge(state.depsJarStatus).text }}
                </el-tag>
                <el-tag v-if="state.depsInnerChanged" type="info" size="small" style="margin-left:8px;">内部差异：{{ state.depsInnerChanged }}</el-tag>
              </div>
            </div>
          </template>
          <div class="dialog-shell">
            <div class="dialog-toolbar">
              <div class="dialog-toolbar-left">
                <el-tabs v-model="state.depsViewMode" class="viewer-tabs" type="card">
                  <el-tab-pane label="结构" name="structure"></el-tab-pane>
                  <el-tab-pane label="内容" name="content"></el-tab-pane>
                </el-tabs>
              </div>
              <div v-if="state.depsViewMode==='content'" class="dialog-toolbar-right">
                <el-tag v-if="state.depsDiffLoading" type="warning" size="small">加载中…</el-tag>
                <el-switch v-model="state.syncScroll" size="small" active-text="同步滚动" inactive-text="独立滚动" />
                <el-switch v-model="state.wrapLines" size="small" active-text="自动换行" inactive-text="不换行" />
                <el-switch v-model="state.showDiffOnly" size="small" active-text="仅差异" inactive-text="全文" />
                <el-button size="small" :disabled="!depsChangeLines.length" @click="depsStepChange(-1)">上一处</el-button>
                <el-button size="small" :disabled="!depsChangeLines.length" @click="depsStepChange(1)">下一处</el-button>
              </div>
              <div v-else class="dialog-toolbar-right">
                <el-button size="small" type="primary" @click="openDepsJarMeta">查看 jar 本体差异</el-button>
              </div>
            </div>
            <div v-if="state.depsViewMode==='structure'" ref="depsStructureScrollRef" class="structure-compare deps-structure" style="flex:1;min-height:0;" @scroll="onDepsStructureScroll">
              <div class="structure-compare-cols" aria-hidden="true">
                <div>左侧基准</div>
                <div class="mid"></div>
                <div>右侧目标</div>
              </div>
              <div class="structure-tree-wrap">
                <div v-if="state.depsTreeLoading" style="padding:10px;">
                  <el-skeleton :rows="10" animated />
                </div>
                <div v-else-if="state.depsTreeError" style="padding:10px;">
                  <el-alert type="error" :closable="false" title="依赖结构加载失败" :description="state.depsTreeError" show-icon />
                </div>
                <div v-else-if="depsStructureRows.length" style="display:flex;flex-direction:column;gap:2px;">
                  <div
                    v-for="r in depsStructureRows"
                    :key="r.key"
                    :class="['structure-row', (state.depsSelectedPath===String(r.node.value||'') || (state.depsSelectedPath && r.node.value && state.depsSelectedPath.startsWith(String(r.node.value) + '!/'))) ? 'is-selected' : '']"
                    role="button"
                    tabindex="0"
                    @click="onDepsStructureRowClick(r.node)"
                    @keydown.enter.prevent="onDepsStructureRowClick(r.node)"
                    @keydown.space.prevent="onDepsStructureRowClick(r.node)"
                  >
                    <div class="structure-cell left" :class="[(r.status ? ('s-' + r.status) : ''), !r.leftExists ? 'structure-placeholder' : '']" :title="r.node.displayTitle || r.node.value" :style="{ paddingLeft: (r.depth * 14) + 'px' }">
                      <span v-if="(r.node.type==='dir' || r.node.type==='jar') && r.node.children && r.node.children.length" class="structure-expander" aria-hidden="true">
                        {{ depsStructureExpanded[r.key] ? '▾' : '▸' }}
                      </span>
                      <span v-else class="structure-bullet" aria-hidden="true">•</span>
                      <span v-if="r.node.type==='dir' || r.node.type==='jar'" class="structure-icon">📁</span>
                      <span v-else class="structure-icon">📄</span>
                      <span class="structure-label">{{ r.node.displayLabel || r.node.label }}</span>
                    </div>
                    <div class="structure-gutter"></div>
                    <div class="structure-cell right" :class="[(r.status ? ('s-' + r.status) : ''), !r.rightExists ? 'structure-placeholder' : '']" :title="r.node.displayTitle || r.node.value" :style="{ paddingLeft: (r.depth * 14) + 'px' }">
                      <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                        <span v-if="(r.node.type==='dir' || r.node.type==='jar') && r.node.children && r.node.children.length" class="structure-expander" aria-hidden="true">
                          {{ depsStructureExpanded[r.key] ? '▾' : '▸' }}
                        </span>
                        <span v-else class="structure-bullet" aria-hidden="true">•</span>
                        <span v-if="r.node.type==='dir' || r.node.type==='jar'" class="structure-icon">📁</span>
                        <span v-else class="structure-icon">📄</span>
                        <span class="structure-label">{{ r.node.displayLabel || r.node.label }}</span>
                      </div>
                      <el-tag v-if="(r.node.type==='file' || r.node.type==='jar') && r.node.rightStatus && r.node.rightStatus!=='unchanged'" :type="mapStructureBadge('right', r.node.rightStatus).type" size="small">
                        {{ mapStructureBadge('right', r.node.rightStatus).text }}
                      </el-tag>
                    </div>
                  </div>
                </div>
                <div v-else style="padding:10px;">
                  <template v-if="!state.deepCompareLib">
                    <el-alert
                      type="info"
                      :closable="false"
                      title="未开启依赖 jar 深度比对"
                      description="当前比对只把依赖 jar 当作文件处理，因此无法展开内部结构。请在设置中勾选“依赖 jar 深度比对”后重新比对。"
                      show-icon
                    />
                    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
                      <el-button size="small" type="primary" @click="state.settingsOpen=true">打开设置</el-button>
                    </div>
                  </template>
                  <el-empty v-else description="暂无内部结构差异"></el-empty>
                </div>
              </div>
            </div>
            <div v-if="state.depsViewMode==='content'" style="flex:1;overflow:hidden;display:flex;flex-direction:column;">
              <div v-if="state.depsDiffLoading" style="padding:10px;flex:1;overflow:auto;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                  <el-tag type="warning" size="small">正在加载差异</el-tag>
                  <span class="mono" style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">{{ state.depsDiffLoadingPath }}</span>
                </div>
                <div style="margin-top:10px;"><el-skeleton :rows="10" animated /></div>
              </div>
              <div v-else-if="!depsSelectedDiff" style="padding:10px;flex:1;overflow:auto;">
                <el-alert v-if="state.depsDiffError" type="error" :closable="false" title="差异加载失败" :description="state.depsDiffError" show-icon />
                <el-empty v-else description="请选择结构中的文件或查看 jar 本体差异"></el-empty>
              </div>
              <div v-else-if="depsSelectedDiff.kind==='binary'" style="padding:10px;flex:1;overflow:auto;">
                <el-alert type="info" :closable="false" title="二进制/非文本差异" :description="depsSelectedDiff.message" show-icon />
              </div>
              <div v-else class="diff-view" style="flex:1;">
                <div :class="['diff-sbs', depsMinimapMarks.length ? 'with-minimap' : '']">
                  <div class="diff-pane">
                    <div class="diff-pane-head">
                      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">左侧基准</span>
                      <el-tag v-if="state.syncScroll" type="info" size="small">同步</el-tag>
                    </div>
                    <div class="diff-pane-body left" ref="depsLeftDiffPaneRef" @scroll="onDepsDiffScroll('left', $event)">
                      <template v-for="row in depsViewRows" :key="row.kind==='row' ? 'dr'+row.rowIndex : 'drg'+row.from">
                        <div v-if="row.kind==='gap'" class="diff-gap" :data-row-index="Number.isFinite(row.from) ? row.from : undefined">
                          <template v-if="row.gapType==='hunkHeader'">
                            <div class="diff-hunk-head">
                              <div class="diff-hunk-title">
                                变更块 {{ (Number.isFinite(row.hunkIndex) ? row.hunkIndex : 0) + 1 }}
                                <span class="mono" v-if="row.leftStart && row.leftEnd">左 {{ row.leftStart }}-{{ row.leftEnd }}</span>
                                <span class="mono" v-if="row.rightStart && row.rightEnd">右 {{ row.rightStart }}-{{ row.rightEnd }}</span>
                              </div>
                              <div class="diff-hunk-actions">
                                <el-button size="small" @click="scrollToDepsRow(row.from)">定位</el-button>
                                <el-button size="small" type="primary" plain @click="toggleDepsHunkCollapse(row.hunkIndex)">{{ row.collapsed ? '展开' : '折叠' }}</el-button>
                              </div>
                            </div>
                          </template>
                          <template v-else-if="row.gapType==='hunkCollapsed'">
                            <div class="diff-hunk-collapsed">
                              … 已折叠 {{ row.count }} 行 …
                              <el-button size="small" type="primary" plain @click="toggleDepsHunkCollapse(row.hunkIndex)">展开</el-button>
                            </div>
                          </template>
                          <template v-else>
                            … 省略 {{ row.count }} 行 …
                          </template>
                        </div>
                        <div v-if="row.kind!=='gap'" class="diff-line" :data-row-index="row.rowIndex">
                          <div class="diff-ln">{{ row.leftNo ? String(row.leftNo).padStart(4,' ') : '' }}</div>
                          <div :class="['diff-code', state.wrapLines ? 'wrap' : '', 'line', row.leftType, row.isActive ? 'active' : '']">{{ row.leftText }}</div>
                        </div>
                      </template>
                    </div>
                  </div>
                  <div class="diff-pane">
                    <div class="diff-pane-head">
                      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">右侧目标</span>
                      <el-tag v-if="depsSelectedDiff.missingRight" type="danger" size="small">缺失</el-tag>
                    </div>
                    <div class="diff-pane-body right" ref="depsRightDiffPaneRef" @scroll="onDepsDiffScroll('right', $event)">
                      <template v-for="row in depsViewRows" :key="row.kind==='row' ? 'dr2'+row.rowIndex : 'drg2'+row.from">
                        <div v-if="row.kind==='gap'" class="diff-gap" :data-row-index="Number.isFinite(row.from) ? row.from : undefined">
                          <template v-if="row.gapType==='hunkHeader'">
                            <div class="diff-hunk-head">
                              <div class="diff-hunk-title">
                                变更块 {{ (Number.isFinite(row.hunkIndex) ? row.hunkIndex : 0) + 1 }}
                                <span class="mono" v-if="row.leftStart && row.leftEnd">左 {{ row.leftStart }}-{{ row.leftEnd }}</span>
                                <span class="mono" v-if="row.rightStart && row.rightEnd">右 {{ row.rightStart }}-{{ row.rightEnd }}</span>
                              </div>
                              <div class="diff-hunk-actions">
                                <el-button size="small" @click="scrollToDepsRow(row.from)">定位</el-button>
                                <el-button size="small" type="primary" plain @click="toggleDepsHunkCollapse(row.hunkIndex)">{{ row.collapsed ? '展开' : '折叠' }}</el-button>
                              </div>
                            </div>
                          </template>
                          <template v-else-if="row.gapType==='hunkCollapsed'">
                            <div class="diff-hunk-collapsed">
                              … 已折叠 {{ row.count }} 行 …
                              <el-button size="small" type="primary" plain @click="toggleDepsHunkCollapse(row.hunkIndex)">展开</el-button>
                            </div>
                          </template>
                          <template v-else>
                            … 省略 {{ row.count }} 行 …
                          </template>
                        </div>
                        <div v-if="row.kind!=='gap'" class="diff-line" :data-row-index="row.rowIndex">
                          <div class="diff-ln">{{ row.rightNo ? String(row.rightNo).padStart(4,' ') : '' }}</div>
                          <div :class="['diff-code', state.wrapLines ? 'wrap' : '', 'line', row.rightType, row.isActive ? 'active' : '']">{{ row.rightText }}</div>
                        </div>
                      </template>
                    </div>
                  </div>

                  <div v-if="depsMinimapMarks.length" class="diff-minimap" aria-hidden="true">
                    <div
                      v-for="m in depsMinimapMarks"
                      :key="m.key"
                      :class="['diff-minimap-mark', m.kind ? ('mk-' + m.kind) : '']"
                      :style="{ top: m.top + '%', height: m.height + '%' }"
                      :title="m.kind==='added' ? '新增' : (m.kind==='missing' ? '缺失' : (m.kind==='mixed' ? '混合' : '修改'))"
                      role="button"
                      tabindex="0"
                      @click.stop="scrollToDepsRow(m.rowIndex)"
                      @keydown.enter.prevent="scrollToDepsRow(m.rowIndex)"
                      @keydown.space.prevent="scrollToDepsRow(m.rowIndex)"
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </el-dialog>

        <el-drawer v-model="state.settingsOpen" title="比对设置" size="360px">
          <el-form label-position="top">
            <el-divider content-position="left">范围</el-divider>
            <el-checkbox v-model="state.includeClasses">对比 classes（.class 等）</el-checkbox>
            <el-checkbox v-model="state.includeResources">对比 resources（配置/资源）</el-checkbox>
            <el-checkbox v-if="state.compareMode!=='directory'" v-model="state.includeLib">对比 lib 依赖（BOOT-INF/lib）</el-checkbox>
            <el-checkbox v-if="state.compareMode!=='directory'" v-model="state.deepCompareLib">依赖 jar 深度比对（可选）</el-checkbox>

            <el-divider content-position="left">上限</el-divider>
            <el-form-item v-if="state.compareMode==='single'" label="单个 jar 上限（MB）">
              <el-input-number v-model="state.limitJarMb" :min="1" :max="state.serverLimits && state.serverLimits.maxJarMb ? state.serverLimits.maxJarMb : 512" controls-position="right" style="width:100%;" />
            </el-form-item>
            <el-form-item v-if="state.compareMode==='directory'" label="目录文件数上限（每侧）">
              <el-input-number v-model="state.limitDirFiles" :min="1" :max="state.serverLimits && state.serverLimits.maxDirFiles ? state.serverLimits.maxDirFiles : 20000" controls-position="right" style="width:100%;" />
            </el-form-item>
            <el-form-item v-if="state.compareMode==='directory'" label="目录总大小上限（MB/侧）">
              <el-input-number v-model="state.limitDirMb" :min="1" :max="state.serverLimits && state.serverLimits.maxDirMb ? state.serverLimits.maxDirMb : 800" controls-position="right" style="width:100%;" />
            </el-form-item>
            <el-form-item label="差异预热数量（条）">
              <el-input-number v-model="state.warmupLimit" :min="0" :max="state.serverLimits && state.serverLimits.maxWarmupDiffs ? state.serverLimits.maxWarmupDiffs : 1200" controls-position="right" style="width:100%;" />
              <div style="margin-top:6px;color:var(--muted);font-size:12px;">可直接填写例如 400；填 0 表示自动使用后端默认值（{{ state.serverLimits && state.serverLimits.defaultWarmupDiffs ? state.serverLimits.defaultWarmupDiffs : 400 }}）</div>
            </el-form-item>

            <el-divider content-position="left">忽略规则</el-divider>
            <el-form-item label="预置">
              <el-select v-model="state.ignorePreset" size="small" style="width:100%;" @change="applyIgnorePreset">
                <el-option label="Spring Boot 常见噪音（推荐）" value="springboot" />
                <el-option label="不忽略" value="none" />
                <el-option label="自定义" value="custom" />
              </el-select>
            </el-form-item>
            <el-form-item label="规则（glob，每行一条）">
              <el-input v-model="state.ignoreGlobs" type="textarea" :rows="8" placeholder="例如：META-INF/*.SF" />
              <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">
                <el-button size="small" @click="resetIgnoreToDefault">恢复默认</el-button>
                <el-tag v-if="ignorePreview.count" type="info" size="small">预览命中：{{ ignorePreview.count }} 条差异</el-tag>
                <el-tag v-else type="info" size="small">预览命中：0</el-tag>
              </div>
              <div v-if="ignorePreview.samples && ignorePreview.samples.length" style="margin-top:8px;">
                <el-collapse>
                  <el-collapse-item title="查看命中样例（最多10条）" name="1">
                    <div v-for="(p,idx) in ignorePreview.samples" :key="idx" class="mono" style="font-size:12px;padding:2px 0;">{{ p }}</div>
                    <div style="margin-top:6px;color:var(--muted);font-size:12px;">修改忽略规则后需要重新比对才会生效</div>
                  </el-collapse-item>
                </el-collapse>
              </div>
            </el-form-item>

            <el-divider content-position="left">显示</el-divider>
            <el-checkbox v-model="state.showNestedJar">结构视图展示内嵌 jar 结构</el-checkbox>
          </el-form>
        </el-drawer>
      </div>
    </el-main>
  </el-container>
`

const App = {
  setup() {
    let autoRestoreCanceled = false
    function cancelAutoRestore() {
      autoRestoreCanceled = true
    }

    const state = reactive({
      compareMode: 'single',
      includeLib: true,
      includeClasses: true,
      includeResources: true,
      deepCompareLib: true,
      showNestedJar: true,
      serverLimits: {
        maxJarMb: 512,
        maxDirFiles: 20000,
        maxDirMb: 800,
        maxWarmupDiffs: 1200,
        defaultWarmupDiffs: 400
      },
      limitJarMb: 512,
      limitDirFiles: 20000,
      limitDirMb: 800,
      warmupLimit: 400,
      directoryInputMode: 'picker',
      leftDirPath: '',
      rightDirPath: '',
      ignorePreset: 'springboot',
      ignoreGlobs: DEFAULT_IGNORE_SPRINGBOOT,
      search: '',
      selectedPath: '',
      isComparing: false,
      compareStage: '',
      compareDetail: '',
      compareError: '',
      warmupRunning: false,
      warmupTotal: 0,
      warmupDone: 0,
      warmupSkipped: 0,
      warmupFailed: 0,
      percent: 0,
      settingsOpen: false,
      statusFilter: 'all',
      sourceFilter: 'all',
      riskFilter: 'all',
      groupBy: 'dir',
      groupedView: true,
      detailDrawerOpen: false,
      listGroupsOpen: [],
      syncScroll: true,
      wrapLines: false,
      showDiffOnly: false,
      collapsedHunks: [],
      activeChangeIndex: 0,
      viewMode: 'structure',
      compareId: '',
      leftJarMd5: '',
      rightJarMd5: '',
      currentDiff: null,
      diffError: '',
      diffLoading: false,
      diffLoadingPath: '',
      diffSeq: 0,
      diffDialogOpen: false,
      readingPopoverOpen: false,
      hunkPopoverOpen: false,
      depsDialogOpen: false,
      depsJarPath: '',
      depsJarStatus: '',
      depsInnerChanged: 0,
      depsViewMode: 'structure',
      depsSelectedPath: '',
      depsCurrentDiff: null,
      depsDiffError: '',
      depsDiffLoading: false,
      depsDiffLoadingPath: '',
      depsDiffSeq: 0,
      depsCollapsedHunks: [],
      depsActiveChangeIndex: 0,
      depsTreeLoading: false,
      depsTreeError: '',
      dirHistory: [],
      leftGroupsOpen: ['app'],
      leftTab: 'app',
      directoryLeftTab: 'dir',
      dirGroupDepth: 3,
      sidebarWidthSingle: 360,
      sidebarWidthDirectory: 420,
      focusMode: false,
      compactMode: false,
      headerCollapsed: false
    })

    const leftJar = ref([])
    const rightJar = ref([])

    const leftDirFiles = ref([])
    const rightDirFiles = ref([])
    const leftDirInputRef = ref(null)
    const rightDirInputRef = ref(null)

    const treeData = ref([])

    const headerContainerRef = ref(null)

    /**
     * 将顶部区域实际高度写入 CSS 变量，确保布局高度计算与内容一致。
     */
    function syncHeaderHeightVar() {
      const r = headerContainerRef.value
      const el = r && r.$el ? r.$el : r
      if (!el || !el.getBoundingClientRect) return
      const h = Math.ceil(el.getBoundingClientRect().height || 0)
      if (h > 0) document.documentElement.style.setProperty('--app-header-h', h + 'px')
    }

    let persistTimer = null
    let warmupTimer = null

    let headerResizeHandler = null

    onMounted(() => {
      syncHeaderHeightVar()
      headerResizeHandler = () => {
        syncHeaderHeightVar()
        syncViewportFlags()
      }
      window.addEventListener('resize', headerResizeHandler)
      nextTick(() => syncHeaderHeightVar())
    })

    watch(
      () => [!!state.compactMode, !!state.headerCollapsed],
      () => {
        nextTick(() => syncHeaderHeightVar())
      }
    )

    onBeforeUnmount(() => {
      if (headerResizeHandler) window.removeEventListener('resize', headerResizeHandler)
    })

    function buildPersistSnapshot() {
      return {
        ts: Date.now(),
        settings: {
          compareMode: state.compareMode,
          includeLib: !!state.includeLib,
          includeClasses: !!state.includeClasses,
          includeResources: !!state.includeResources,
          deepCompareLib: !!state.deepCompareLib,
          showNestedJar: !!state.showNestedJar,
          limitJarMb: Number.isFinite(state.limitJarMb) ? state.limitJarMb : 512,
          limitDirFiles: Number.isFinite(state.limitDirFiles) ? state.limitDirFiles : 20000,
          limitDirMb: Number.isFinite(state.limitDirMb) ? state.limitDirMb : 800,
          warmupLimit: Number.isFinite(state.warmupLimit) ? state.warmupLimit : 0,
          directoryInputMode: String(state.directoryInputMode || 'picker'),
          leftDirPath: String(state.leftDirPath || ''),
          rightDirPath: String(state.rightDirPath || ''),
          dirHistory: normalizeDirHistoryList(state.dirHistory),
          ignorePreset: String(state.ignorePreset || ''),
          ignoreGlobs: String(state.ignoreGlobs || ''),
          statusFilter: String(state.statusFilter || 'all'),
          syncScroll: !!state.syncScroll,
          wrapLines: !!state.wrapLines,
          showDiffOnly: !!state.showDiffOnly,
          leftTab: String(state.leftTab || 'app'),
          directoryLeftTab: String(state.directoryLeftTab || 'dir'),
          dirGroupDepth: Number.isFinite(state.dirGroupDepth) ? state.dirGroupDepth : 3,
          viewMode: String(state.viewMode || 'content'),
          sidebarWidthSingle: Number.isFinite(state.sidebarWidthSingle) ? state.sidebarWidthSingle : 360,
          sidebarWidthDirectory: Number.isFinite(state.sidebarWidthDirectory) ? state.sidebarWidthDirectory : 420,
          focusMode: !!state.focusMode,
          compactMode: !!state.compactMode,
          headerCollapsed: !!state.headerCollapsed
        },
        lastCompare: {
          compareId: String(state.compareId || ''),
          selectedPath: String(state.selectedPath || ''),
          leftJarMd5: String(state.leftJarMd5 || ''),
          rightJarMd5: String(state.rightJarMd5 || '')
        }
      }
    }

    function schedulePersist() {
      if (!storage) return
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        try {
          storage.save(buildPersistSnapshot())
        } catch (e) {}
      }, 300)
    }

    function applyPersisted(p) {
      if (autoRestoreCanceled) return
      const s = p && p.settings ? p.settings : null
      if (!s) return
      if (s.compareMode === 'single' || s.compareMode === 'directory') state.compareMode = s.compareMode
      if (typeof s.includeLib === 'boolean') state.includeLib = s.includeLib
      if (typeof s.includeClasses === 'boolean') state.includeClasses = s.includeClasses
      if (typeof s.includeResources === 'boolean') state.includeResources = s.includeResources
      if (typeof s.deepCompareLib === 'boolean') state.deepCompareLib = s.deepCompareLib
      if (typeof s.showNestedJar === 'boolean') state.showNestedJar = s.showNestedJar
      if (typeof s.limitJarMb === 'number' && isFinite(s.limitJarMb)) state.limitJarMb = s.limitJarMb
      if (typeof s.limitDirFiles === 'number' && isFinite(s.limitDirFiles)) state.limitDirFiles = s.limitDirFiles
      if (typeof s.limitDirMb === 'number' && isFinite(s.limitDirMb)) state.limitDirMb = s.limitDirMb
      if (typeof s.warmupLimit === 'number' && isFinite(s.warmupLimit)) state.warmupLimit = s.warmupLimit
      if (typeof s.directoryInputMode === 'string') state.directoryInputMode = s.directoryInputMode
      if (typeof s.leftDirPath === 'string') state.leftDirPath = s.leftDirPath
      if (typeof s.rightDirPath === 'string') state.rightDirPath = s.rightDirPath
      if (Array.isArray(s.dirHistory)) state.dirHistory = normalizeDirHistoryList(s.dirHistory)
      if (typeof s.ignorePreset === 'string') state.ignorePreset = s.ignorePreset
      if (typeof s.ignoreGlobs === 'string') state.ignoreGlobs = s.ignoreGlobs
      if (typeof s.statusFilter === 'string') state.statusFilter = s.statusFilter
      if (typeof s.syncScroll === 'boolean') state.syncScroll = s.syncScroll
      if (typeof s.wrapLines === 'boolean') state.wrapLines = s.wrapLines
      if (typeof s.showDiffOnly === 'boolean') state.showDiffOnly = s.showDiffOnly
      if (typeof s.leftTab === 'string') state.leftTab = s.leftTab
      if (typeof s.directoryLeftTab === 'string') state.directoryLeftTab = s.directoryLeftTab === 'list' ? 'list' : 'dir'
      if (typeof s.dirGroupDepth === 'number' && isFinite(s.dirGroupDepth)) state.dirGroupDepth = s.dirGroupDepth
      if (typeof s.viewMode === 'string') state.viewMode = s.viewMode
      if (typeof s.sidebarWidthSingle === 'number' && isFinite(s.sidebarWidthSingle)) state.sidebarWidthSingle = s.sidebarWidthSingle
      if (typeof s.sidebarWidthDirectory === 'number' && isFinite(s.sidebarWidthDirectory)) state.sidebarWidthDirectory = s.sidebarWidthDirectory
      if (typeof s.focusMode === 'boolean') state.focusMode = s.focusMode
      if (typeof s.compactMode === 'boolean') state.compactMode = s.compactMode
      if (typeof s.headerCollapsed === 'boolean') state.headerCollapsed = s.headerCollapsed
      clampClientLimits()
      normalizeViewMode()
    }

    /**
     * 将前端设置的上限值裁剪到后端允许范围内，避免设置失效或出现异常值。
     */
    function clampClientLimits() {
      const sl = state.serverLimits || {}
      const maxJar = Number.isFinite(sl.maxJarMb) ? sl.maxJarMb : 512
      const maxDirFiles = Number.isFinite(sl.maxDirFiles) ? sl.maxDirFiles : 20000
      const maxDirMb = Number.isFinite(sl.maxDirMb) ? sl.maxDirMb : 800
      const maxWarm = Number.isFinite(sl.maxWarmupDiffs) ? sl.maxWarmupDiffs : 1200

      const jarMb = Number.isFinite(state.limitJarMb) ? state.limitJarMb : 512
      const dirFiles = Number.isFinite(state.limitDirFiles) ? state.limitDirFiles : 20000
      const dirMb = Number.isFinite(state.limitDirMb) ? state.limitDirMb : 800
      const warm = Number.isFinite(state.warmupLimit) ? state.warmupLimit : 0

      state.limitJarMb = Math.min(Math.max(1, Math.floor(jarMb)), maxJar)
      state.limitDirFiles = Math.min(Math.max(1, Math.floor(dirFiles)), maxDirFiles)
      state.limitDirMb = Math.min(Math.max(1, Math.floor(dirMb)), maxDirMb)
      state.warmupLimit = Math.min(Math.max(0, Math.floor(warm)), maxWarm)
      const depth = Number.isFinite(state.dirGroupDepth) ? Math.floor(state.dirGroupDepth) : 3
      state.dirGroupDepth = Math.min(6, Math.max(1, depth))

      const wSingle = Number.isFinite(state.sidebarWidthSingle) ? Math.floor(state.sidebarWidthSingle) : 360
      const wDir = Number.isFinite(state.sidebarWidthDirectory) ? Math.floor(state.sidebarWidthDirectory) : 420
      state.sidebarWidthSingle = Math.min(760, Math.max(280, wSingle))
      state.sidebarWidthDirectory = Math.min(820, Math.max(300, wDir))
    }

    function normalizeViewMode() {
      const m = String(state.compareMode || '')
      const v = String(state.viewMode || '')
      const allowed = m === 'directory' ? ['structure', 'content', 'summary'] : ['structure', 'content', 'summary', 'deps']
      if (!allowed.includes(v)) state.viewMode = 'structure'
    }

    /**
     * 拉取后端限制配置，用于前端上限设置面板的最大值联动与校验。
     */
    async function loadServerLimits() {
      if (!api || !api.getLimits) return
      try {
        const v = await api.getLimits()
        if (!v) return
        const next = Object.assign({}, state.serverLimits || {})
        if (Number.isFinite(v.maxJarMb)) next.maxJarMb = v.maxJarMb
        if (Number.isFinite(v.maxDirFiles)) next.maxDirFiles = v.maxDirFiles
        if (Number.isFinite(v.maxDirMb)) next.maxDirMb = v.maxDirMb
        if (Number.isFinite(v.maxWarmupDiffs)) next.maxWarmupDiffs = v.maxWarmupDiffs
        if (Number.isFinite(v.defaultWarmupDiffs)) next.defaultWarmupDiffs = v.defaultWarmupDiffs
        state.serverLimits = next
        clampClientLimits()
      } catch (e) {}
    }

    function decorateTree(nodes) {
      return (nodes || []).map((n) => {
        const copy = Object.assign({}, n || {})
        if (typeof copy.label === 'string' && copy.label.toLowerCase().endsWith('.jar!')) {
          copy.displayLabel = copy.label.slice(0, -1)
          copy.displayTitle = typeof copy.value === 'string' && copy.value.endsWith('!') ? copy.value.slice(0, -1) : copy.value
          copy.type = 'jar'
        } else {
          copy.displayLabel = copy.label
          copy.displayTitle = copy.value
        }
        if (Array.isArray(copy.children) && copy.children.length) {
          copy.children = decorateTree(copy.children)
        }
        return copy
      })
    }

    const depsLoadedTreeData = ref([])
    const depsLoadedOuter = ref('')

    const displayTreeData = computed(() => {
      if (!state.showNestedJar) return treeData.value
      return decorateTree(treeData.value)
    })

    const canCompare = computed(() => {
      if (state.compareMode === 'directory') {
        if (state.directoryInputMode === 'path') return !!state.leftDirPath.trim() && !!state.rightDirPath.trim()
        return leftDirFiles.value.length > 0 && rightDirFiles.value.length > 0
      }
      return leftJar.value.length > 0 && rightJar.value.length > 0
    })

    function aggregateDirectoryJarDiffs(items) {
      const pri = (s) => (s === 'missing' ? 0 : s === 'added' ? 1 : s === 'modified' ? 2 : s === 'meta' ? 3 : 9)
      const pickStatus = (a, b) => {
        const aa = String(a || '')
        const bb = String(b || '')
        if (!aa) return bb
        if (!bb) return aa
        return pri(bb) < pri(aa) ? bb : aa
      }

      const jarAgg = new Map()
      const outerStatus = new Map()

      for (const x of items || []) {
        if (!x || !x.path) continue
        const path = String(x.path || '').replace(/\\/g, '/')
        const status = String(x.status || '')
        const idx = path.indexOf('!/')
        if (idx > 0) {
          const jarPath = path.slice(0, idx)
          const cur = jarAgg.get(jarPath) || { jarPath, innerChanged: 0, status: '' }
          cur.innerChanged += 1
          cur.status = pickStatus(cur.status, status)
          jarAgg.set(jarPath, cur)
          continue
        }
        if (path.endsWith('!')) {
          const jarPath = path.slice(0, -1)
          const cur = jarAgg.get(jarPath) || { jarPath, innerChanged: 0, status: '' }
          cur.status = pickStatus(cur.status, status)
          jarAgg.set(jarPath, cur)
          continue
        }
        if (path.toLowerCase().endsWith('.jar')) {
          outerStatus.set(path, pickStatus(outerStatus.get(path), status))
        }
      }

      const out = []
      for (const x of items || []) {
        if (!x || !x.path) continue
        const path = String(x.path || '').replace(/\\/g, '/')
        const status = String(x.status || '')
        const idx = path.indexOf('!/')
        if (idx > 0) continue
        if (path.endsWith('!')) continue

        const agg = jarAgg.get(path)
        if (agg && agg.innerChanged > 0) continue

        out.push({ path, status })
      }

      const seen = new Set()
      for (const r of out) {
        if (r && r.path) seen.add(String(r.path))
      }

      for (const agg of jarAgg.values()) {
        if (!agg || !agg.jarPath) continue
        const mergedStatus = pickStatus(outerStatus.get(agg.jarPath), agg.status)
        if (agg.innerChanged > 0) {
          out.push({ path: agg.jarPath, status: mergedStatus, jarPath: agg.jarPath, innerChanged: agg.innerChanged, jarContainer: true })
          seen.add(String(agg.jarPath))
          continue
        }
        if (mergedStatus && !seen.has(String(agg.jarPath))) {
          out.push({ path: agg.jarPath, status: mergedStatus })
          seen.add(String(agg.jarPath))
        }
      }

      out.sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')))
      return out
    }

    const changedFiles = computed(() => {
      const keyword = state.search.trim().toLowerCase()
      const filter = state.statusFilter
      const sourceFilter = state.sourceFilter
      const riskFilter = state.riskFilter
      const raw = flattenChanged(displayTreeData.value)
      const all = state.compareMode === 'directory' ? aggregateDirectoryJarDiffs(raw) : raw
      const filtered =
        state.compareMode === 'directory'
          ? all
          : (all || []).filter((x) => {
              const p = String(x && x.path ? x.path : '').replace(/\\/g, '/')
              const idx = p.indexOf('!/')
              if (idx > 0 && (p.startsWith('BOOT-INF/lib/') || p.startsWith('WEB-INF/lib/'))) return false
              return true
            })
      return filtered
        .map((x) => {
          const path = x && x.path ? String(x.path) : ''
          const status = x && x.status ? String(x.status) : ''
          const jarContainer = !!(x && x.jarContainer)
          const innerChanged = x && Number.isFinite(x.innerChanged) ? x.innerChanged : 0
          const jarPath = x && x.jarPath ? String(x.jarPath) : ''
          const source = jarContainer ? 'other' : classifyChangedPath(path)
          const displayPath = toDisplayPath(path, source)
          const riskLevel = inferRiskLevel(path, source, status)
          const changeSummary = jarContainer ? 'jar 内部差异（' + innerChanged + '）' : inferChangeSummary(path, source, status)
          const groupKey = buildGroupKey(path, source, status, riskLevel)
          return { path, status, source, displayPath, riskLevel, changeSummary, groupKey, jarContainer, innerChanged, jarPath: jarPath || path }
        })
        .filter((x) => {
          const hay = (x.displayPath || x.path || '').toLowerCase()
          const hitKeyword = !keyword || hay.includes(keyword)
          const hitStatus = filter === 'all' || x.status === filter
          const hitSource = sourceFilter === 'all' || x.source === sourceFilter
          const hitRisk = riskFilter === 'all' || x.riskLevel === riskFilter
          return hitKeyword && hitStatus && hitSource && hitRisk
        })
    })

    function classifyChangedPath(path) {
      const p = typeof path === 'string' ? path : ''
      if (!p) return 'other'
      const norm = p.replace(/\\/g, '/')
      const idx = norm.indexOf('!/')
      const inner = idx >= 0 ? norm.slice(idx + 2) : norm
      const lower = norm.toLowerCase()

      const isDeps =
        norm.startsWith('BOOT-INF/lib/') ||
        norm.startsWith('WEB-INF/lib/') ||
        norm.includes('.jar!/') ||
        (lower.endsWith('.jar') && (norm.includes('/lib/') || norm.includes('/libs/')))
      if (isDeps) return 'deps'
      if (norm.startsWith('BOOT-INF/classes/') || norm.startsWith('WEB-INF/classes/')) return 'app'
      if (inner.startsWith('src/') || inner.includes('/src/')) return 'app'
      if (inner.includes('/main/java/') || inner.includes('/main/resources/') || inner.includes('/java/') || inner.includes('/resources/')) return 'app'
      return 'other'
    }

    function toDisplayPath(path, source) {
      const p = String(path || '')
      if (!p) return ''
      const norm = p.replace(/\\/g, '/')
      if (source === 'app') {
        if (norm.startsWith('BOOT-INF/classes/')) return norm.slice('BOOT-INF/classes/'.length)
        if (norm.startsWith('WEB-INF/classes/')) return norm.slice('WEB-INF/classes/'.length)
      }
      if (source === 'deps') {
        const idx = norm.indexOf('!/')
        const inner = idx >= 0 ? norm.slice(idx + 2) : ''
        const outer = idx >= 0 ? norm.slice(0, idx) : norm
        const jarName = jarDisplayName(outer)
        return inner ? jarName + '!/' + inner : jarName
      }
      return norm
    }

    function inferRiskLevel(path, source, status) {
      const p = String(path || '')
      if (!p) return 'low'
      const norm = p.replace(/\\/g, '/')
      const up = norm.toUpperCase()
      if (up.startsWith('META-INF/') && (up.endsWith('.SF') || up.endsWith('.RSA') || up.endsWith('.DSA'))) return 'high'
      if (norm.startsWith('BOOT-INF/classes/') && (norm.includes('application.') || norm.includes('bootstrap.'))) return 'high'
      if (source === 'deps') return 'medium'
      if (norm.toLowerCase().endsWith('.class') && status === 'modified') return 'medium'
      if (status === 'missing') return source === 'app' ? 'medium' : 'low'
      return 'low'
    }

    function inferChangeSummary(path, source, status) {
      const p = String(path || '')
      const norm = p.replace(/\\/g, '/')
      const lower = norm.toLowerCase()
      if (source === 'deps') {
        if (status === 'added') return '新增依赖'
        if (status === 'missing') return '移除依赖'
        if (status === 'meta') return '元信息变更（压缩/时间戳/顺序）'
        return '依赖变更'
      }
      if (lower.endsWith('.class')) return status === 'modified' ? '字节码变化' : status === 'added' ? '新增类' : '删除类'
      if (lower.endsWith('.yml') || lower.endsWith('.yaml') || lower.endsWith('.properties') || lower.endsWith('.xml')) {
        return status === 'modified' ? '配置变更' : status === 'added' ? '新增配置' : '删除配置'
      }
      if (lower.startsWith('meta-inf/')) return status === 'modified' ? '元信息变更' : status === 'added' ? '新增元信息' : '删除元信息'
      return status === 'modified' ? '内容变更' : status === 'added' ? '新增文件' : '删除文件'
    }

    function buildGroupKey(path, source, status, riskLevel) {
      const mode = String(state.groupBy || 'dir')
      if (mode === 'kind') return status || 'unknown'
      if (mode === 'risk') return riskLevel || 'low'
      const p = String(path || '').replace(/\\/g, '/')
      if (source === 'deps') return 'deps'
      const idx = p.indexOf('!/')
      const inner = idx >= 0 ? p.slice(idx + 2) : p
      const appRel = inner.startsWith('BOOT-INF/classes/') ? inner.slice('BOOT-INF/classes/'.length) : inner
      const rel = appRel.startsWith('WEB-INF/classes/') ? appRel.slice('WEB-INF/classes/'.length) : appRel
      if (mode === 'package') {
        const base = rel.toLowerCase().endsWith('.class') ? rel.replace(/\/[^/]+$/, '') : rel.replace(/\/[^/]+$/, '')
        return base ? base.replace(/\//g, '.') : '(root)'
      }
      const seg = rel.split('/').filter(Boolean)
      const depth = Number.isFinite(state.dirGroupDepth) ? Math.floor(state.dirGroupDepth) : 3
      const n = Math.min(6, Math.max(1, depth))
      return seg.slice(0, n).join('/') || '(root)'
    }

    const groupedChanged = computed(() => {
      const groups = { app: [], deps: [], other: [] }
      for (const x of changedFiles.value || []) {
        if (x.source === 'app') groups.app.push(x)
        else if (x.source === 'deps') groups.deps.push(x)
        else groups.other.push(x)
      }
      return groups
    })

    const isWide = ref(typeof window !== 'undefined' ? window.innerWidth >= 1100 : true)

    function syncViewportFlags() {
      isWide.value = typeof window !== 'undefined' ? window.innerWidth >= 1100 : true
    }

    onMounted(() => {
      syncViewportFlags()
      if (typeof window !== 'undefined') window.addEventListener('resize', syncViewportFlags, { passive: true })
    })

    let sidebarResizeMoveHandler = null
    let sidebarResizeUpHandler = null

    function getActiveSidebarWidth() {
      return state.compareMode === 'directory' ? state.sidebarWidthDirectory : state.sidebarWidthSingle
    }

    function setActiveSidebarWidth(w) {
      if (state.compareMode === 'directory') state.sidebarWidthDirectory = w
      else state.sidebarWidthSingle = w
    }

    function resetSidebarWidth() {
      setActiveSidebarWidth(state.compareMode === 'directory' ? 420 : 360)
      clampClientLimits()
    }

    function nudgeSidebar(delta) {
      const cur = Number.isFinite(getActiveSidebarWidth()) ? getActiveSidebarWidth() : state.compareMode === 'directory' ? 420 : 360
      setActiveSidebarWidth(cur + delta)
      clampClientLimits()
    }

    /**
     * 工作台两栏布局的 grid 列定义（左侧列表 + 分隔条 + 右侧详情）。
     * 说明：在专注模式下隐藏左侧列表，因此切换为单列布局。
     */
    const workspaceGridColumns = computed(() => {
      if (!isWide.value) return 'minmax(0, 1fr)'
      if (state.focusMode) return 'minmax(0, 1fr)'
      const w = Number.isFinite(getActiveSidebarWidth()) ? getActiveSidebarWidth() : 360
      return w + 'px 8px minmax(520px, 1fr)'
    })

    function startSidebarResize(evt) {
      if (!evt) return
      const startX = typeof evt.clientX === 'number' ? evt.clientX : 0
      const startW = Number.isFinite(getActiveSidebarWidth()) ? getActiveSidebarWidth() : state.compareMode === 'directory' ? 420 : 360

      const onMove = (e) => {
        const x = e && typeof e.clientX === 'number' ? e.clientX : startX
        const next = startW + (x - startX)
        setActiveSidebarWidth(next)
        clampClientLimits()
      }

      const onUp = () => {
        if (sidebarResizeMoveHandler) window.removeEventListener('mousemove', sidebarResizeMoveHandler)
        if (sidebarResizeUpHandler) window.removeEventListener('mouseup', sidebarResizeUpHandler)
        sidebarResizeMoveHandler = null
        sidebarResizeUpHandler = null
      }

      sidebarResizeMoveHandler = onMove
      sidebarResizeUpHandler = onUp
      window.addEventListener('mousemove', sidebarResizeMoveHandler)
      window.addEventListener('mouseup', sidebarResizeUpHandler)
    }

    onBeforeUnmount(() => {
      if (sidebarResizeMoveHandler) window.removeEventListener('mousemove', sidebarResizeMoveHandler)
      if (sidebarResizeUpHandler) window.removeEventListener('mouseup', sidebarResizeUpHandler)
      if (typeof window !== 'undefined') window.removeEventListener('resize', syncViewportFlags)
      sidebarResizeMoveHandler = null
      sidebarResizeUpHandler = null
    })

    /**
     * 切换右侧阅读区“专注/普通”模式：专注模式隐藏侧栏，减少干扰。
     */
    function toggleFocusMode() {
      state.focusMode = !state.focusMode
    }

    /**
     * 一键应用侧栏宽度预设，降低“拖拽调宽”成本。
     */
    function applySidebarPreset(preset) {
      const key = String(preset || '')
      if (key === 'narrow') setActiveSidebarWidth(state.compareMode === 'directory' ? 340 : 300)
      else if (key === 'wide') setActiveSidebarWidth(state.compareMode === 'directory' ? 560 : 520)
      else setActiveSidebarWidth(state.compareMode === 'directory' ? 420 : 360)
      clampClientLimits()
    }

    function mapRiskTagType(level) {
      const v = String(level || '')
      if (v === 'high') return 'danger'
      if (v === 'medium') return 'warning'
      return 'info'
    }

    function resetFilters() {
      state.search = ''
      state.statusFilter = 'all'
      state.sourceFilter = 'all'
      state.riskFilter = 'all'
      state.groupBy = 'dir'
      state.groupedView = true
    }

    function clearFilterChip(key) {
      if (key === 'search') state.search = ''
      else if (key === 'status') state.statusFilter = 'all'
      else if (key === 'source') state.sourceFilter = 'all'
      else if (key === 'risk') state.riskFilter = 'all'
      else if (key === 'groupBy') state.groupBy = 'dir'
      else if (key === 'grouped') state.groupedView = true
    }

    const activeFilterChips = computed(() => {
      const chips = []
      if (state.search && state.search.trim()) chips.push({ key: 'search', label: '搜索', value: state.search.trim() })
      if (state.statusFilter !== 'all') chips.push({ key: 'status', label: '类型', value: mapStatusBadge(state.statusFilter).text })
      if (state.sourceFilter !== 'all') chips.push({ key: 'source', label: '范围', value: state.sourceFilter === 'app' ? '应用' : state.sourceFilter === 'deps' ? '依赖' : '其他' })
      if (state.riskFilter !== 'all') chips.push({ key: 'risk', label: '风险', value: state.riskFilter })
      if (state.groupBy !== 'dir') chips.push({ key: 'groupBy', label: '分组', value: state.groupBy })
      if (!state.groupedView) chips.push({ key: 'grouped', label: '视图', value: '不分组' })
      return chips
    })

    function countStatus(rows) {
      const out = { added: 0, missing: 0, modified: 0, meta: 0 }
      for (const r of rows || []) {
        if (!r) continue
        if (r.status === 'added') out.added += 1
        else if (r.status === 'missing') out.missing += 1
        else if (r.status === 'modified') out.modified += 1
        else if (r.status === 'meta') out.meta += 1
      }
      return out
    }

    const listGroups = computed(() => {
      const rows = changedFiles.value || []
      if (!state.groupedView) {
        return [{ key: 'all', title: '全部', rows, stats: countStatus(rows) }]
      }
      const m = new Map()
      for (const r of rows) {
        const k = String(r && r.groupKey ? r.groupKey : '(root)')
        const cur = m.get(k) || { key: k, title: k, rows: [], stats: { added: 0, missing: 0, modified: 0, meta: 0 } }
        cur.rows.push(r)
        if (r.status === 'added') cur.stats.added += 1
        else if (r.status === 'missing') cur.stats.missing += 1
        else if (r.status === 'modified') cur.stats.modified += 1
        else if (r.status === 'meta') cur.stats.meta += 1
        m.set(k, cur)
      }
      const out = Array.from(m.values())
      out.sort((a, b) => b.rows.length - a.rows.length || String(a.key).localeCompare(String(b.key)))
      return out
    })

    watch(
      () => [state.compareId, state.groupBy, state.groupedView],
      async () => {
        await nextTick()
        const first = listGroups.value && listGroups.value[0] ? listGroups.value[0].key : ''
        state.listGroupsOpen = first ? [first] : []
      }
    )

    /**
     * 变化文件列表行点击：打开内容差异并在窄屏时弹出详情抽屉
     * @param {any} row
     */
    async function openFromListRow(row) {
      if (!row || !row.path) return
      const p = String(row.path || '')
      if (row.jarContainer && row.jarPath) {
        openDependencyDialog({
          jarPath: String(row.jarPath || p),
          status: String(row.status || ''),
          innerChanged: Number.isFinite(row.innerChanged) ? row.innerChanged : 0
        })
        if (!isWide.value) state.detailDrawerOpen = true
        return
      }
      if (state.compareMode === 'directory' && !p.includes('!/') && p.toLowerCase().endsWith('.jar')) {
        let innerChanged = 0
        const prefix = p + '!/'
        for (const x of allChanged.value || []) {
          const xp = x && x.path ? String(x.path) : ''
          if (xp && xp.startsWith(prefix)) innerChanged += 1
        }
        openDependencyDialog({ jarPath: p, status: String(row.status || ''), innerChanged })
        if (!isWide.value) state.detailDrawerOpen = true
        return
      }
      if (classifyChangedPath(p) === 'deps' && !p.includes('!/') && p.toLowerCase().endsWith('.jar')) {
        let innerChanged = 0
        const prefix = p + '!/'
        for (const x of allChanged.value || []) {
          const xp = x && x.path ? String(x.path) : ''
          if (xp && xp.startsWith(prefix)) innerChanged += 1
        }
        openDependencyDialog({ jarPath: p, status: String(row.status || ''), innerChanged })
        if (!isWide.value) state.detailDrawerOpen = true
        return
      }
      await openDiff(p)
      if (!isWide.value) state.detailDrawerOpen = true
    }

    /**
     * 变化文件列表路径点击：切换到结构视图并定位到对应节点（不直接进入内容页）
     * @param {any} row
     */
    async function openStructureFromListRow(row) {
      if (!row || !row.path) return
      state.selectedPath = String(row.path || '')
      state.viewMode = 'structure'
      if (!isWide.value) state.detailDrawerOpen = true
      await nextTick()
      await navigateToStructureValue(state.selectedPath)
    }

    /**
     * 将变化文件列表构建为可渲染的目录树数据
     * @param {Array<{path:string,status:string}>} files
     * @param {(fullPath:string)=>string} toDisplayPath
     * @returns {Array<Object>}
     */
    function buildChangedTree(files, toDisplayPath) {
      const roots = []
      const dirIndex = new Map()

      const ensureDir = (parentChildren, dirKey, label) => {
        const existed = dirIndex.get(dirKey)
        if (existed) return existed
        const node = { key: dirKey, label, type: 'dir', children: [] }
        dirIndex.set(dirKey, node)
        parentChildren.push(node)
        return node
      }

      for (const f of files || []) {
        if (!f || !f.path) continue
        const fullPath = String(f.path || '')
        const displayPath = String(toDisplayPath(fullPath) || '')
        const seg = displayPath.split('/').filter(Boolean)
        if (!seg.length) continue

        let children = roots
        let prefix = ''
        for (let i = 0; i < seg.length - 1; i++) {
          prefix = prefix ? prefix + '/' + seg[i] : seg[i]
          const dirKey = 'dir:' + prefix
          const dir = ensureDir(children, dirKey, seg[i])
          children = dir.children
        }

        const leafLabel = seg[seg.length - 1]
        const jarContainer = !!(f && f.jarContainer)
        const innerChanged = f && Number.isFinite(f.innerChanged) ? f.innerChanged : 0
        const jarPath = f && f.jarPath ? String(f.jarPath) : jarContainer ? fullPath : ''
        children.push({
          key: fullPath,
          label: leafLabel,
          type: jarContainer ? 'jar' : 'file',
          path: fullPath,
          status: f.status || '',
          displayPath,
          jarContainer,
          innerChanged,
          jarPath
        })
      }

      const sortTree = (nodes) => {
        nodes.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
          return String(a.label || '').localeCompare(String(b.label || ''))
        })
        for (const n of nodes) {
          if (n && Array.isArray(n.children) && n.children.length) sortTree(n.children)
        }
      }

      sortTree(roots)
      return roots
    }

    const appChangedTree = computed(() => {
      const list = groupedChanged.value.app || []
      return buildChangedTree(list, (p) => (p.startsWith('BOOT-INF/classes/') ? p.slice('BOOT-INF/classes/'.length) : p))
    })

    const otherChangedTree = computed(() => {
      const list = groupedChanged.value.other || []
      return buildChangedTree(list, (p) => p)
    })

    const directoryChangedTree = computed(() => {
      if (state.compareMode !== 'directory') return []
      const rows = changedFiles.value || []
      const displayMap = new Map()
      for (const r of rows) {
        if (!r || !r.path) continue
        displayMap.set(String(r.path), String(r.displayPath || r.path))
      }
      return buildChangedTree(rows, (p) => displayMap.get(String(p || '')) || String(p || ''))
    })

    const directoryHotlist = computed(() => {
      if (state.compareMode !== 'directory') return []
      const depthRaw = Number.isFinite(state.dirGroupDepth) ? Math.floor(state.dirGroupDepth) : 3
      const depth = Math.min(6, Math.max(1, depthRaw))

      const scoreOf = (stats) => {
        const missing = Number.isFinite(stats && stats.missing) ? stats.missing : 0
        const modified = Number.isFinite(stats && stats.modified) ? stats.modified : 0
        const added = Number.isFinite(stats && stats.added) ? stats.added : 0
        const meta = Number.isFinite(stats && stats.meta) ? stats.meta : 0
        return missing * 1000000 + modified * 10000 + added * 100 + meta
      }

      const map = new Map()
      for (const r of changedFiles.value || []) {
        if (!r) continue
        const disp = String(r.displayPath || r.path || '').replace(/\\/g, '/')
        const seg = disp.split('/').filter(Boolean)
        if (!seg.length) continue
        const dirSeg = seg.length > 1 ? seg.slice(0, -1) : []
        const groupSeg = dirSeg.slice(0, depth)
        const key = groupSeg.join('/') || '(root)'
        const delta = r.jarContainer ? Math.max(1, Number.isFinite(r.innerChanged) ? r.innerChanged : 0) : 1
        const cur =
          map.get(key) || { key, title: key, query: key === '(root)' ? '' : groupSeg.join('/'), count: 0, stats: { added: 0, missing: 0, modified: 0, meta: 0 } }
        cur.count += delta
        if (r.status === 'added') cur.stats.added += delta
        else if (r.status === 'missing') cur.stats.missing += delta
        else if (r.status === 'modified') cur.stats.modified += delta
        else if (r.status === 'meta') cur.stats.meta += delta
        map.set(key, cur)
      }

      const out = Array.from(map.values())
        .map((x) => Object.assign({}, x, { score: scoreOf(x.stats) }))
        .sort((a, b) => b.score - a.score || b.count - a.count || String(a.key).localeCompare(String(b.key)))
      return out
    })

    const directorySummaryTree = computed(() => {
      if (state.compareMode !== 'directory') return []
      const depthRaw = Number.isFinite(state.dirGroupDepth) ? Math.floor(state.dirGroupDepth) : 3
      const depth = Math.min(6, Math.max(1, depthRaw))

      const scoreOf = (stats) => {
        const missing = Number.isFinite(stats && stats.missing) ? stats.missing : 0
        const modified = Number.isFinite(stats && stats.modified) ? stats.modified : 0
        const added = Number.isFinite(stats && stats.added) ? stats.added : 0
        const meta = Number.isFinite(stats && stats.meta) ? stats.meta : 0
        return missing * 1000000 + modified * 10000 + added * 100 + meta
      }

      const roots = []
      const nodeIndex = new Map()

      const ensureNode = (parentChildren, prefix, label) => {
        const key = 'ds:' + prefix
        const existed = nodeIndex.get(key)
        if (existed) return existed
        const node = { key, label, query: prefix, stats: { added: 0, missing: 0, modified: 0, meta: 0 }, total: 0, children: [] }
        nodeIndex.set(key, node)
        parentChildren.push(node)
        return node
      }

      for (const r of changedFiles.value || []) {
        if (!r) continue
        const disp = String(r.displayPath || r.path || '').replace(/\\/g, '/')
        const seg = disp.split('/').filter(Boolean)
        if (!seg.length) continue
        const dirSeg = seg.length > 1 ? seg.slice(0, -1) : []
        const top = dirSeg.slice(0, depth)
        if (!top.length) continue

        const delta = r.jarContainer ? Math.max(1, Number.isFinite(r.innerChanged) ? r.innerChanged : 0) : 1
        let children = roots
        let prefix = ''
        for (let i = 0; i < top.length; i++) {
          prefix = prefix ? prefix + '/' + top[i] : top[i]
          const node = ensureNode(children, prefix, top[i])
          node.total += delta
          if (r.status === 'added') node.stats.added += delta
          else if (r.status === 'missing') node.stats.missing += delta
          else if (r.status === 'modified') node.stats.modified += delta
          else if (r.status === 'meta') node.stats.meta += delta
          children = node.children
        }
      }

      const sortTree = (nodes) => {
        nodes.sort((a, b) => scoreOf(b.stats) - scoreOf(a.stats) || b.total - a.total || String(a.label || '').localeCompare(String(b.label || '')))
        for (const n of nodes) {
          if (n && Array.isArray(n.children) && n.children.length) sortTree(n.children)
        }
      }
      sortTree(roots)
      return roots
    })

    function onDirectoryHotItemClick(item) {
      const q = item && typeof item.query === 'string' ? item.query : ''
      state.search = q
      state.directoryLeftTab = 'list'
    }

    function onDirectorySummaryNodeClick(node) {
      const q = node && typeof node.query === 'string' ? node.query : ''
      state.search = q
      state.directoryLeftTab = 'list'
    }

    const allChanged = computed(() => {
      return flattenChanged(treeData.value)
    })

    const allChangedMap = computed(() => {
      const m = new Map()
      for (const x of allChanged.value || []) {
        if (!x || !x.path) continue
        m.set(x.path, x.status)
      }
      return m
    })

    const summaryModel = computed(() => {
      const total = {
        app: { added: 0, missing: 0, modified: 0, meta: 0 },
        deps: { added: 0, missing: 0, modified: 0, meta: 0 },
        other: { added: 0, missing: 0, modified: 0, meta: 0 }
      }

      const topDirs = new Map()

      for (const x of allChanged.value || []) {
        const group = classifyChangedPath(x.path)
        const bucket = group === 'app' ? total.app : group === 'deps' ? total.deps : total.other
        if (x.status === 'added') bucket.added += 1
        else if (x.status === 'missing') bucket.missing += 1
        else if (x.status === 'modified') bucket.modified += 1
        else if (x.status === 'meta') bucket.meta += 1

        if (group === 'app') {
          const p = String(x.path || '')
          const rel = p.startsWith('BOOT-INF/classes/') ? p.slice('BOOT-INF/classes/'.length) : p
          const seg = rel.split('/').filter(Boolean)
          const key = seg.slice(0, 3).join('/') || rel
          topDirs.set(key, (topDirs.get(key) || 0) + 1)
        }
      }

      const topChangedDirs = Array.from(topDirs.entries())
        .map(([dir, count]) => ({ dir, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12)

      const findings = []
      if (total.deps.added + total.deps.missing + total.deps.modified > 0) {
        findings.push({ level: 'warn', title: '依赖发生变化', desc: '建议在“依赖”视图确认新增/删除/版本漂移，并评估回归范围。' })
      }
      const hasConfig = (allChanged.value || []).some((x) => {
        const p = String(x && x.path ? x.path : '')
        return p.includes('BOOT-INF/classes/') && (p.includes('application.') || p.includes('bootstrap.'))
      })
      if (hasConfig) {
        findings.push({ level: 'warn', title: '关键配置变更', desc: '检测到 application*/bootstrap* 相关配置变化，建议核对环境差异与默认值。' })
      }
      const hasSign = (allChanged.value || []).some((x) => {
        const p = String(x && x.path ? x.path : '').toUpperCase()
        return p.startsWith('META-INF/') && (p.endsWith('.SF') || p.endsWith('.RSA') || p.endsWith('.DSA'))
      })
      if (hasSign) {
        findings.push({ level: 'info', title: '签名/证书文件变化', desc: '若非预期变更，可通过忽略规则减少噪音，但发布审计仍需保留记录。' })
      }

      return { total, topChangedDirs, findings }
    })

    const summaryTotals = computed(() => {
      const t = summaryModel.value && summaryModel.value.total ? summaryModel.value.total : null
      if (!t) return { added: 0, missing: 0, modified: 0, meta: 0 }
      const includeDeps = state.compareMode !== 'directory'
      return {
        added: (t.app.added || 0) + (t.other.added || 0) + (includeDeps ? t.deps.added || 0 : 0),
        missing: (t.app.missing || 0) + (t.other.missing || 0) + (includeDeps ? t.deps.missing || 0 : 0),
        modified: (t.app.modified || 0) + (t.other.modified || 0) + (includeDeps ? t.deps.modified || 0 : 0),
        meta: (t.app.meta || 0) + (t.other.meta || 0) + (includeDeps ? t.deps.meta || 0 : 0)
      }
    })

    function applyQuickStatusFilter(kind) {
      const v = String(kind || 'all')
      state.statusFilter = v === 'modified' || v === 'added' || v === 'missing' || v === 'meta' ? v : 'all'
    }

    function onSummaryCardActivate(kind) {
      if (!state.compareId) return
      applyQuickStatusFilter(kind)
    }

    const dependencyRows = computed(() => {
      const jarMap = new Map()
      for (const x of allChanged.value || []) {
        const p = String(x && x.path ? x.path : '')
        if (!p.startsWith('BOOT-INF/lib/')) continue
        const idx = p.indexOf('!/')
        const jarPath = idx > 0 ? p.slice(0, idx) : p
        const isInner = idx > 0
        const cur = jarMap.get(jarPath) || { jarPath, status: '', innerChanged: 0 }
        if (isInner) cur.innerChanged += 1
        if (!isInner) cur.status = x.status
        if (!cur.status && x.status) cur.status = x.status
        jarMap.set(jarPath, cur)
      }
      const rows = Array.from(jarMap.values())
      const pri = (s) => (s === 'missing' ? 0 : s === 'added' ? 1 : s === 'modified' ? 2 : s === 'meta' ? 3 : 9)
      rows.sort((a, b) => pri(a.status) - pri(b.status) || a.jarPath.localeCompare(b.jarPath))
      return rows
    })

    /**
     * 依赖 jar 路径转展示名（只保留文件名）
     * @param {string} jarPath
     * @returns {string}
     */
    function jarDisplayName(jarPath) {
      const p = String(jarPath || '')
      if (!p) return ''
      const idx = p.lastIndexOf('/')
      return idx >= 0 ? p.slice(idx + 1) : p
    }

    const selectedInfo = computed(() => {
      const p = String(state.selectedPath || '')
      if (!p) return { status: '', source: '' }
      const status = allChangedMap.value.get(p) || ''
      const source = classifyChangedPath(p)
      return { status, source }
    })

    const ignorePreview = computed(() => {
      const globs = splitIgnoreGlobs(state.ignoreGlobs)
      if (!globs.length) return { count: 0, samples: [] }
      let count = 0
      const samples = []
      for (const x of allChanged.value || []) {
        const p = x && x.path ? x.path : ''
        if (!p) continue
        if (isIgnoredByGlobs(p, globs)) {
          count += 1
          if (samples.length < 10) samples.push(p)
        }
      }
      return { count, samples }
    })

    function applyIgnorePreset(preset) {
      const v = String(preset || '')
      state.ignorePreset = v
      if (v === 'springboot') state.ignoreGlobs = DEFAULT_IGNORE_SPRINGBOOT
      else if (v === 'none') state.ignoreGlobs = ''
    }

    function resetIgnoreToDefault() {
      applyIgnorePreset('springboot')
    }

    const structureStats = computed(() => {
      const total = { added: 0, missing: 0, modified: 0, meta: 0, unchanged: 0 }
      ;(function walk(nodes) {
        for (const n of nodes || []) {
          if (n && (n.type === 'file' || n.type === 'jar')) {
            const s = n.rightStatus || 'unchanged'
            if (s === 'added') total.added += 1
            else if (s === 'missing') total.missing += 1
            else if (s === 'modified') total.modified += 1
            else if (s === 'meta') total.meta += 1
            else total.unchanged += 1
          }
          if (n && Array.isArray(n.children) && n.children.length) walk(n.children)
        }
      })(treeData.value)
      return total
    })

    const selectedDiff = computed(() => state.currentDiff)

    const diffStats = computed(() => {
      const d = selectedDiff.value
      if (!d || d.kind !== 'text' || !Array.isArray(d.highlights)) return { add: 0, del: 0, mod: 0 }

      const add = new Set()
      const del = new Set()
      const mod = new Set()

      for (const h of d.highlights) {
        if (!h || !h.type || !h.side || !Number.isFinite(h.line)) continue
        const key = h.side + ':' + h.line
        if (h.type === 'add') add.add(key)
        else if (h.type === 'del') del.add(key)
        else if (h.type === 'mod') mod.add(key)
      }

      return { add: add.size, del: del.size, mod: mod.size }
    })

    const changeLines = computed(() => {
      const d = selectedDiff.value
      if (!d || d.kind !== 'text' || !Array.isArray(d.rows) || !d.rows.length) return []

      const leftMap = new Map()
      const rightMap = new Map()
      for (const h of d.highlights || []) {
        if (!h || !h.side || !h.type || !Number.isFinite(h.line)) continue
        if (h.side === 'left') leftMap.set(h.line, h.type)
        if (h.side === 'right') rightMap.set(h.line, h.type)
      }

      const out = []
      for (let idx = 0; idx < d.rows.length; idx++) {
        const r = d.rows[idx] || {}
        const lt = r.leftNo ? leftMap.get(r.leftNo) || '' : ''
        const rt = r.rightNo ? rightMap.get(r.rightNo) || '' : ''
        if (lt || rt) out.push(idx)
      }
      return out
    })

    const viewRows = computed(() => {
      const activeRowIndex = changeLines.value[state.activeChangeIndex]
      const rows = buildDiffRows(selectedDiff.value, state.showDiffOnly, activeRowIndex, state.collapsedHunks)
      return window.JarDiff && window.JarDiff.ui && window.JarDiff.ui.filterOutHunkGaps
        ? window.JarDiff.ui.filterOutHunkGaps(rows, state.showDiffOnly)
        : rows
    })

    function buildMinimapMarks(d) {
      const fn = window.JarDiff && window.JarDiff.ui && window.JarDiff.ui.buildMinimapMarksFromDiff
      return typeof fn === 'function' ? fn(d) : []
    }

    const minimapMarks = computed(() => buildMinimapMarks(selectedDiff.value))

    const mainLeftDiffPaneRef = ref(null)
    const mainRightDiffPaneRef = ref(null)
    const dialogLeftDiffPaneRef = ref(null)
    const dialogRightDiffPaneRef = ref(null)
    const isSyncingDiffScroll = ref(false)

    /**
     * 获取当前可视区域的 diff 容器（主界面 / 全屏弹窗）
     * @param {'left'|'right'} side
     * @returns {HTMLElement|null}
     */
    function getActiveDiffPaneEl(side) {
      const isDialog = !!state.diffDialogOpen
      if (isDialog) return side === 'left' ? dialogLeftDiffPaneRef.value : dialogRightDiffPaneRef.value
      return side === 'left' ? mainLeftDiffPaneRef.value : mainRightDiffPaneRef.value
    }

    /**
     * 根据触发滚动的元素，推断本次同步滚动应在“主界面”还是“全屏弹窗”内进行
     * @param {HTMLElement|null} el
     * @returns {{leftEl:HTMLElement|null,rightEl:HTMLElement|null}}
     */
    function resolveDiffPanePair(el) {
      const dl = dialogLeftDiffPaneRef.value
      const dr = dialogRightDiffPaneRef.value
      if (el && (el === dl || el === dr)) return { leftEl: dl, rightEl: dr }
      return { leftEl: mainLeftDiffPaneRef.value, rightEl: mainRightDiffPaneRef.value }
    }

    watch(
      () => state.selectedPath,
      async () => {
        state.activeChangeIndex = 0
        await loadDiff()
      }
    )

    const DIFF_CACHE_MAX = 60
    const diffCache = new Map()
    const depsDiffCache = new Map()

    /**
     * 构造差异缓存 key（绑定 compareId，避免不同报告串用缓存）
     * @param {string} compareId
     * @param {string} path
     * @returns {string}
     */
    function makeDiffCacheKey(compareId, path) {
      return String(compareId || '') + '::' + String(path || '')
    }

    /**
     * 读取缓存并刷新 LRU 顺序
     * @param {Map<string, any>} cache
     * @param {string} key
     * @returns {any|null}
     */
    function getFromCache(cache, key) {
      if (!cache || !cache.has(key)) return null
      const v = cache.get(key)
      cache.delete(key)
      cache.set(key, v)
      return v
    }

    /**
     * 写入缓存并按 LRU 上限淘汰
     * @param {Map<string, any>} cache
     * @param {string} key
     * @param {any} value
     * @param {number} maxSize
     */
    function putToCache(cache, key, value, maxSize) {
      if (!cache) return
      if (cache.has(key)) cache.delete(key)
      cache.set(key, value)
      const max = typeof maxSize === 'number' && maxSize > 0 ? maxSize : 60
      while (cache.size > max) {
        const firstKey = cache.keys().next().value
        cache.delete(firstKey)
      }
    }

    /**
     * 清空本次会话的差异缓存（通常在开始一次新的比对前调用）
     */
    function clearDiffCaches() {
      diffCache.clear()
      depsDiffCache.clear()
    }

    function stopWarmupPoll() {
      if (warmupTimer) clearInterval(warmupTimer)
      warmupTimer = null
    }

    function resetWarmupState() {
      state.warmupRunning = false
      state.warmupTotal = 0
      state.warmupDone = 0
      state.warmupSkipped = 0
      state.warmupFailed = 0
    }

    async function startWarmup() {
      stopWarmupPoll()
      if (!api || !api.warmDiffs || !api.warmDiffStatus) return
      const id = String(state.compareId || '')
      if (!id) return
      const total = (allChanged.value || []).length
      if (!total) return
      clampClientLimits()
      const sl = state.serverLimits || {}
      const serverDefault = Number.isFinite(sl.defaultWarmupDiffs) ? sl.defaultWarmupDiffs : 400
      const maxWarm = Number.isFinite(sl.maxWarmupDiffs) ? sl.maxWarmupDiffs : 1200
      const configured = Number.isFinite(state.warmupLimit) ? state.warmupLimit : 0
      const wanted = configured > 0 ? configured : serverDefault
      const limit = Math.min(total, Math.max(1, wanted), maxWarm)
      state.warmupRunning = true
      state.warmupTotal = limit
      state.warmupDone = 0
      state.warmupSkipped = 0
      state.warmupFailed = 0
      try {
        await api.warmDiffs(id, limit)
      } catch (e) {
        state.warmupRunning = false
        return
      }
      warmupTimer = setInterval(async () => {
        if (String(state.compareId || '') !== id) {
          stopWarmupPoll()
          return
        }
        try {
          const s = await api.warmDiffStatus(id)
          if (!s) return
          state.warmupRunning = !!s.running
          state.warmupTotal = Number.isFinite(s.total) ? s.total : state.warmupTotal
          state.warmupDone = Number.isFinite(s.done) ? s.done : state.warmupDone
          state.warmupSkipped = Number.isFinite(s.skipped) ? s.skipped : state.warmupSkipped
          state.warmupFailed = Number.isFinite(s.failed) ? s.failed : state.warmupFailed
          if (!s.running) stopWarmupPoll()
        } catch (e) {}
      }, 800)
    }

    /**
     * 统计文件列表总字节数（用于目录比对的提示信息）
     * @param {Array<File>} list
     * @returns {number}
     */
    function sumFileBytes(list) {
      let total = 0
      for (const f of list || []) {
        const n = f && typeof f.size === 'number' ? f.size : 0
        total += n > 0 ? n : 0
      }
      return total
    }

    /**
     * 将字节数格式化为可读字符串
     * @param {number} bytes
     * @returns {string}
     */
    function formatBytes(bytes) {
      const b = typeof bytes === 'number' && isFinite(bytes) ? bytes : 0
      if (b <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let v = b
      let i = 0
      while (v >= 1024 && i < units.length - 1) {
        v = v / 1024
        i += 1
      }
      const fixed = v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2
      return v.toFixed(fixed) + ' ' + units[i]
    }

    function getCompareLimitHint() {
      const jarMb = Number.isFinite(state.limitJarMb) ? state.limitJarMb : 512
      const dirFiles = Number.isFinite(state.limitDirFiles) ? state.limitDirFiles : 20000
      const dirMb = Number.isFinite(state.limitDirMb) ? state.limitDirMb : 800
      if (state.compareMode === 'single') return 'jar 上限：' + jarMb + 'MB/个'
      return '目录上限：' + dirFiles + ' 个文件/侧，' + dirMb + 'MB/侧'
    }

    const compareLimitHint = computed(() => getCompareLimitHint())

    const leftDirPickedPill = computed(() => {
      const count = (leftDirFiles.value || []).length
      if (!count) return ''
      const bytes = sumFileBytes(leftDirFiles.value)
      return count + ' 个 / ' + formatBytes(bytes)
    })

    const rightDirPickedPill = computed(() => {
      const count = (rightDirFiles.value || []).length
      if (!count) return ''
      const bytes = sumFileBytes(rightDirFiles.value)
      return count + ' 个 / ' + formatBytes(bytes)
    })

    const compareProgressStatus = computed(() => {
      if (state.compareError) return 'exception'
      if (!state.isComparing) return ''
      return state.percent >= 100 ? 'success' : ''
    })

    const DIR_HISTORY_MAX = 12

    /**
     * 规范化目录路径历史：去重、去空、截断长度。
     * @param {Array<any>} list
     * @returns {string[]}
     */
    function normalizeDirHistoryList(list) {
      const out = []
      const seen = new Set()
      for (const it of list || []) {
        const v = typeof it === 'string' ? it.trim() : ''
        if (!v) continue
        if (seen.has(v)) continue
        seen.add(v)
        out.push(v)
        if (out.length >= DIR_HISTORY_MAX) break
      }
      return out
    }

    /**
     * 将本次使用的路径写入历史（最新在前）。
     * @param {string[]} paths
     */
    function addDirHistory(paths) {
      const cur = Array.isArray(state.dirHistory) ? state.dirHistory : []
      state.dirHistory = normalizeDirHistoryList([...(paths || []), ...cur])
    }

    /**
     * 裁剪路径输入两侧空白，减少“看起来对了但多了空格”的失败。
     */
    function trimDirPaths() {
      state.leftDirPath = String(state.leftDirPath || '').trim()
      state.rightDirPath = String(state.rightDirPath || '').trim()
    }

    /**
     * 规范化路径用于等价判断：去首尾空白 + 去除末尾分隔符。
     * @param {string} p
     * @returns {string}
     */
    function normalizeDirPathForCompare(p) {
      const s = String(p || '').trim()
      return s.replace(/[\\/]+$/g, '')
    }

    /**
     * 交换左右目录路径。
     */
    function swapDirPaths() {
      const l = String(state.leftDirPath || '')
      const r = String(state.rightDirPath || '')
      state.leftDirPath = r
      state.rightDirPath = l
    }

    /**
     * 交换左右目录选择（选择目录模式）。
     */
    function swapPickedDirs() {
      const l = Array.isArray(leftDirFiles.value) ? leftDirFiles.value : []
      const r = Array.isArray(rightDirFiles.value) ? rightDirFiles.value : []
      leftDirFiles.value = r
      rightDirFiles.value = l
      if (leftDirInputRef.value) leftDirInputRef.value.value = ''
      if (rightDirInputRef.value) rightDirInputRef.value.value = ''
    }

    /**
     * 清空左右目录选择（选择目录模式）。
     */
    function clearPickedDirs() {
      leftDirFiles.value = []
      rightDirFiles.value = []
      if (leftDirInputRef.value) leftDirInputRef.value.value = ''
      if (rightDirInputRef.value) rightDirInputRef.value.value = ''
    }

    /**
     * 清空目录路径输入。
     */
    function clearDirPaths() {
      state.leftDirPath = ''
      state.rightDirPath = ''
    }

    /**
     * 清理本次比对错误提示。
     */
    function clearCompareError() {
      state.compareError = ''
    }

    /**
     * 目录路径自动完成建议。
     * @param {string} queryString
     * @param {(items:Array<{value:string}>)=>void} cb
     */
    function suggestDirHistory(queryString, cb) {
      const q = String(queryString || '').trim().toLowerCase()
      const list = Array.isArray(state.dirHistory) ? state.dirHistory : []
      const out = []
      for (const x of list) {
        const v = typeof x === 'string' ? x : ''
        if (!v) continue
        if (!q || v.toLowerCase().includes(q)) out.push({ value: v })
        if (out.length >= DIR_HISTORY_MAX) break
      }
      cb(out)
    }

    /**
     * 校验本次比对的输入是否超出上限，超限则提示并阻止比对。
     * @returns {boolean}
     */
    function validateCompareLimits() {
      clampClientLimits()
      const MAX_JAR_BYTES = 1024 * 1024 * (Number.isFinite(state.limitJarMb) ? state.limitJarMb : 512)
      const MAX_DIR_FILES = Number.isFinite(state.limitDirFiles) ? state.limitDirFiles : 20000
      const MAX_DIR_BYTES = 1024 * 1024 * (Number.isFinite(state.limitDirMb) ? state.limitDirMb : 800)

      if (state.compareMode === 'single') {
        const l = leftJar.value && leftJar.value[0] ? leftJar.value[0].raw : null
        const r = rightJar.value && rightJar.value[0] ? rightJar.value[0].raw : null
        const ls = l && typeof l.size === 'number' ? l.size : 0
        const rs = r && typeof r.size === 'number' ? r.size : 0
        if (ls > MAX_JAR_BYTES || rs > MAX_JAR_BYTES) {
          ElementPlus.ElMessage.error('文件超出上限，已禁止比对（' + getCompareLimitHint() + '）')
          return false
        }
        return true
      }

      if (state.directoryInputMode === 'path') return true

      const leftCount = (leftDirFiles.value || []).length
      const rightCount = (rightDirFiles.value || []).length
      const leftBytes = sumFileBytes(leftDirFiles.value)
      const rightBytes = sumFileBytes(rightDirFiles.value)
      if (leftCount > MAX_DIR_FILES || rightCount > MAX_DIR_FILES) {
        ElementPlus.ElMessage.error('文件数量超出上限，已禁止比对（' + getCompareLimitHint() + '）')
        return false
      }
      if (leftBytes > MAX_DIR_BYTES || rightBytes > MAX_DIR_BYTES) {
        ElementPlus.ElMessage.error('目录总大小超出上限，已禁止比对（' + getCompareLimitHint() + '）')
        return false
      }
      return true
    }

    async function startCompare() {
      cancelAutoRestore()
      state.compareError = ''
      if (!canCompare.value) {
        if (state.compareMode === 'directory') {
          ElementPlus.ElMessage.warning(state.directoryInputMode === 'path' ? '请填写左右目录路径' : '请先选择两个目录')
        } else {
          ElementPlus.ElMessage.warning('请先选择两个 jar')
        }
        return
      }
      if (!validateCompareLimits()) return

      clearDiffCaches()
      stopWarmupPoll()
      resetWarmupState()
      state.isComparing = true
      state.percent = 5
      state.compareStage = state.compareMode === 'directory' ? '准备目录比对' : '准备 jar 比对'
      state.compareDetail = ''
      state.currentDiff = null
      state.compareId = ''
      state.leftTab = 'app'
      state.statusFilter = 'all'

      /**
       * 将上传进度映射为进度条百分比（只前进不后退）。
       * @param {number} loaded
       * @param {number} total
       * @param {number} from
       * @param {number} to
       */
      function bumpUploadPercent(loaded, total, from, to) {
        if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return
        const f = Number.isFinite(from) ? from : 0
        const t = Number.isFinite(to) ? to : 100
        const ratio = Math.max(0, Math.min(1, loaded / total))
        const p = Math.round(f + (t - f) * ratio)
        if (p > state.percent) state.percent = p
      }

      try {
        if (state.compareMode === 'single') {
          state.compareStage = '上传并分析 jar'
          await nextTick()
          const fd = new FormData()
          fd.append('leftJar', leftJar.value[0].raw)
          fd.append('rightJar', rightJar.value[0].raw)
          fd.append('includeLib', String(state.includeLib))
          fd.append('includeClasses', String(state.includeClasses))
          fd.append('includeResources', String(state.includeResources))
          fd.append('deepCompareLib', String(state.deepCompareLib))
          fd.append('ignoreGlobs', String(state.ignoreGlobs || ''))
          fd.append('limitJarMb', String(state.limitJarMb || ''))

          state.percent = 30
          const data = await api.compareJars(fd, (loaded, total) => bumpUploadPercent(loaded, total, 30, 70))

          state.compareStage = '构建结构树'
          state.compareId = data.id || ''
          state.leftJarMd5 = data.left && data.left.md5 ? data.left.md5 : ''
          state.rightJarMd5 = data.right && data.right.md5 ? data.right.md5 : ''
          treeData.value = Array.isArray(data.tree) ? data.tree : []
          state.selectedPath = findFirstFile(treeData.value)
          state.viewMode = 'structure'
          if (!groupedChanged.value.app.length && dependencyRows.value.length) state.leftTab = 'deps'
          state.percent = 100
          state.compareStage = '完成'
          schedulePersist()
          startWarmup()
        } else {
          function stripPickedRoot(p, fallbackName) {
            const s = String(p || '')
            const n = String(fallbackName || '')
            if (!s) return n
            const norm = s.replace(/\\/g, '/').replace(/^\/+/, '')
            const idx = norm.indexOf('/')
            if (idx < 0) return norm || n
            const rest = norm.slice(idx + 1)
            return rest || n
          }

          let data
          if (state.directoryInputMode === 'path') {
            trimDirPaths()
            const leftPath = String(state.leftDirPath || '')
            const rightPath = String(state.rightDirPath || '')
            if (!leftPath || !rightPath) {
              ElementPlus.ElMessage.warning('请填写左右目录路径')
              state.isComparing = false
              return
            }
            const nl = normalizeDirPathForCompare(leftPath)
            const nr = normalizeDirPathForCompare(rightPath)
            if (nl && nr && nl === nr) {
              ElementPlus.ElMessage.warning('左右目录路径相同，无法比对')
              state.isComparing = false
              return
            }
            addDirHistory([leftPath, rightPath])
            state.compareDetail = '左侧：' + leftPath + '，右侧：' + rightPath
            state.compareStage = '读取目录路径'
            await nextTick()

            const fd = new FormData()
            fd.append('leftPath', leftPath)
            fd.append('rightPath', rightPath)
            fd.append('includeLib', String(state.includeLib))
            fd.append('includeClasses', String(state.includeClasses))
            fd.append('includeResources', String(state.includeResources))
            fd.append('deepCompareLib', String(state.deepCompareLib))
            fd.append('ignoreGlobs', String(state.ignoreGlobs || ''))
            fd.append('limitDirFiles', String(state.limitDirFiles || ''))
            fd.append('limitDirMb', String(state.limitDirMb || ''))
            state.compareStage = '分析目录'
            state.percent = 40
            data = await api.compareDirectoryByPath(fd)
          } else {
            const leftCount = (leftDirFiles.value || []).length
            const rightCount = (rightDirFiles.value || []).length
            const leftBytes = sumFileBytes(leftDirFiles.value)
            const rightBytes = sumFileBytes(rightDirFiles.value)
            state.compareDetail =
              '左 ' + leftCount + ' 个（' + formatBytes(leftBytes) + '），右 ' + rightCount + ' 个（' + formatBytes(rightBytes) + '）'
            state.compareStage = '整理目录文件'
            await nextTick()

            const fd = new FormData()
            for (const f of leftDirFiles.value || []) fd.append('leftFiles', f, stripPickedRoot(f.webkitRelativePath, f.name))
            for (const f of rightDirFiles.value || []) fd.append('rightFiles', f, stripPickedRoot(f.webkitRelativePath, f.name))
            fd.append('includeLib', String(state.includeLib))
            fd.append('includeClasses', String(state.includeClasses))
            fd.append('includeResources', String(state.includeResources))
            fd.append('deepCompareLib', String(state.deepCompareLib))
            fd.append('ignoreGlobs', String(state.ignoreGlobs || ''))
            fd.append('limitDirFiles', String(state.limitDirFiles || ''))
            fd.append('limitDirMb', String(state.limitDirMb || ''))
            state.compareStage = '上传并分析目录'
            state.percent = 40
            data = await api.compareDirectory(fd, (loaded, total) => bumpUploadPercent(loaded, total, 40, 80))
          }
          state.compareStage = '构建结构树'
          state.compareId = data.id || ''
          state.leftJarMd5 = data.left && data.left.md5 ? data.left.md5 : ''
          state.rightJarMd5 = data.right && data.right.md5 ? data.right.md5 : ''
          treeData.value = Array.isArray(data.tree) ? data.tree : []
          state.selectedPath = findFirstFile(treeData.value)
          state.viewMode = 'structure'
          if (!groupedChanged.value.app.length && groupedChanged.value.other.length) state.leftTab = 'other'
          state.percent = 100
          state.compareStage = '完成'
          schedulePersist()
          startWarmup()
        }
      } catch (e) {
        const msg = e && e.message ? e.message : '比对失败'
        state.compareError = msg
        ElementPlus.ElMessage.error(msg)
        state.percent = 0
      } finally {
        state.isComparing = false
        state.compareStage = ''
        state.compareDetail = ''
      }
    }

    async function openDiffDialog(path) {
      if (!path) return
      await selectPath(path, true)
    }

    async function openDiff(path) {
      if (!path) return
      await selectPath(path, false)
    }

    /**
     * 在新页面打开指定文件的差异内容（携带 compareId 与 path 参数）
     * @param {string} path
     */
    function openDiffInNewPage(path) {
      if (!state.compareId || !path) return
      try {
        const u = new URL(window.location.href)
        u.searchParams.set('id', String(state.compareId || ''))
        u.searchParams.set('path', String(path || ''))
        window.open(u.toString(), '_blank')
      } catch (e) {}
    }

    async function selectPath(path, openDialog) {
      if (!path) return
      state.diffError = ''
      state.selectedPath = path
      state.viewMode = 'content'
      if (openDialog) {
        state.readingPopoverOpen = false
        state.diffDialogOpen = true
      }
      await loadDiff()
    }

    async function loadDiff() {
      if (!state.compareId || !state.selectedPath) return
      const req = (state.diffSeq = (state.diffSeq || 0) + 1)
      const wantedPath = String(state.selectedPath || '')
      state.collapsedHunks = []
      const cacheKey = makeDiffCacheKey(state.compareId, wantedPath)
      const cached = getFromCache(diffCache, cacheKey)
      if (cached) {
        state.diffError = ''
        state.diffLoading = false
        state.diffLoadingPath = ''
        state.currentDiff = cached
        scheduleSyncDiffRowHeights()
        return
      }
      try {
        state.diffError = ''
        state.diffLoading = true
        state.diffLoadingPath = wantedPath
        state.currentDiff = null
        const data = await api.loadDiff(state.compareId, wantedPath)
        if (req !== state.diffSeq) return
        state.currentDiff = data
        putToCache(diffCache, cacheKey, data, DIFF_CACHE_MAX)
        scheduleSyncDiffRowHeights()
      } catch (e) {
        if (req !== state.diffSeq) return
        state.currentDiff = null
        state.diffError = e && e.message ? e.message : '加载差异失败'
      } finally {
        if (req === state.diffSeq) {
          state.diffLoading = false
          state.diffLoadingPath = ''
        }
      }
    }

    async function restoreLastCompare() {
      if (autoRestoreCanceled || state.isComparing) return
      if (!storage || !api.loadReportV2) return
      const persisted = storage.load ? storage.load() : null
      if (!persisted || !persisted.lastCompare) return
      const id = persisted.lastCompare.compareId
      if (!id) return
      applyPersisted(persisted)

      state.compareMode = 'single'

      state.isComparing = true
      state.percent = 20
      try {
        if (autoRestoreCanceled) return
        const report = await api.loadReportV2(id)
        const result = report && report.result ? report.result : null
        if (!result) throw new Error('恢复失败')

        state.compareId = result.id || id
        state.leftJarMd5 = result.left && result.left.md5 ? result.left.md5 : ''
        state.rightJarMd5 = result.right && result.right.md5 ? result.right.md5 : ''
        treeData.value = Array.isArray(result.tree) ? result.tree : []

        if (report.options) {
          if (typeof report.options.includeLib === 'boolean') state.includeLib = report.options.includeLib
          if (typeof report.options.includeClasses === 'boolean') state.includeClasses = report.options.includeClasses
          if (typeof report.options.includeResources === 'boolean') state.includeResources = report.options.includeResources
          if (typeof report.options.deepCompareLib === 'boolean') state.deepCompareLib = report.options.deepCompareLib
          if (Array.isArray(report.options.ignoreGlobs)) state.ignoreGlobs = report.options.ignoreGlobs.join('\n')
        }

        const preferredPath = persisted.lastCompare.selectedPath || ''
        state.selectedPath = preferredPath || findFirstFile(treeData.value)
        if (!groupedChanged.value.app.length && dependencyRows.value.length) state.leftTab = 'deps'

        state.percent = 100
        ElementPlus.ElMessage.success('已恢复上次比对（如已过期请重新比对）')
        schedulePersist()
      } catch (e) {
        ElementPlus.ElMessage.warning('上次比对已过期或不可恢复，请重新比对')
        try {
          storage.save({ ts: Date.now(), settings: persisted.settings || {}, lastCompare: { compareId: '' } })
        } catch (err) {}
      } finally {
        state.isComparing = false
      }
    }

    /**
     * 从 URL 查询参数恢复：用于“结构点击新页打开”的落地页
     * @returns {Promise<boolean>}
     */
    async function restoreFromQuery() {
      if (autoRestoreCanceled || state.isComparing) return false
      if (!api || !api.loadReportV2) return false
      let id = ''
      let path = ''
      try {
        const qs = new URLSearchParams(window.location.search || '')
        id = String(qs.get('id') || '')
        path = String(qs.get('path') || '')
      } catch (e) {
        return false
      }
      if (!id) return false

      state.compareMode = 'single'
      state.isComparing = true
      state.percent = 20
      try {
        if (autoRestoreCanceled) return false
        const report = await api.loadReportV2(id)
        const result = report && report.result ? report.result : null
        if (!result) throw new Error('恢复失败')

        state.compareId = result.id || id
        state.leftJarMd5 = result.left && result.left.md5 ? result.left.md5 : ''
        state.rightJarMd5 = result.right && result.right.md5 ? result.right.md5 : ''
        treeData.value = Array.isArray(result.tree) ? result.tree : []

        state.selectedPath = path || findFirstFile(treeData.value)
        state.viewMode = 'content'
        state.percent = 100
        await loadDiff()
        schedulePersist()
        return true
      } catch (e) {
        state.diffError = e && e.message ? e.message : '恢复失败'
        return false
      } finally {
        state.isComparing = false
      }
    }

    async function stepChange(dir) {
      const total = changeLines.value.length
      if (!total) return
      const next = Math.min(total - 1, Math.max(0, state.activeChangeIndex + dir))
      state.activeChangeIndex = next
      await nextTick()
      const rowIndex = changeLines.value[state.activeChangeIndex]
      if (!Number.isFinite(rowIndex)) return
      const leftEl = getActiveDiffPaneEl('left')
      const rightEl = getActiveDiffPaneEl('right')
      if (leftEl) {
        const node = leftEl.querySelector('[data-row-index="' + rowIndex + '"]')
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
      }
      if (rightEl) {
        const node = rightEl.querySelector('[data-row-index="' + rowIndex + '"]')
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
      }
    }

    function scrollToRow(rowIndex) {
      if (!Number.isFinite(rowIndex)) return
      const leftEl = getActiveDiffPaneEl('left')
      const rightEl = getActiveDiffPaneEl('right')
      const fn = window.JarDiff && window.JarDiff.ui && window.JarDiff.ui.scrollPaneToRowIndex
      if (typeof fn !== 'function') return
      fn(leftEl, rowIndex)
      fn(rightEl, rowIndex)
    }

    function toggleHunkCollapse(hunkIndex) {
      if (!Number.isFinite(hunkIndex)) return
      if (!Array.isArray(state.collapsedHunks)) state.collapsedHunks = []
      const idx = state.collapsedHunks.indexOf(hunkIndex)
      if (idx >= 0) state.collapsedHunks.splice(idx, 1)
      else state.collapsedHunks.push(hunkIndex)
      state.collapsedHunks.sort((a, b) => a - b)
      scheduleSyncDiffRowHeights()
    }

    /**
     * 折叠当前文件的所有变更块。
     * 说明：折叠能力仅在“仅差异”视图下可见，因此这里会强制切到仅差异。
     */
    function collapseAllHunks() {
      const d = selectedDiff.value
      const hunks = d && Array.isArray(d.hunks) ? d.hunks : []
      const ids = []
      for (const h of hunks) {
        const i = Number.isFinite(h && h.index) ? h.index : null
        if (i == null) continue
        ids.push(i)
      }
      state.collapsedHunks = ids.sort((a, b) => a - b)
      scheduleSyncDiffRowHeights()
    }

    /**
     * 展开当前文件的所有变更块。
     * 说明：展开同样依赖“仅差异”视图，避免用户误判“无效果”。
     */
    function expandAllHunks() {
      state.collapsedHunks = []
      scheduleSyncDiffRowHeights()
    }

    function scrollToDepsRow(rowIndex) {
      if (!Number.isFinite(rowIndex)) return
      const leftEl = depsLeftDiffPaneRef.value
      const rightEl = depsRightDiffPaneRef.value
      const fn = window.JarDiff && window.JarDiff.ui && window.JarDiff.ui.scrollPaneToRowIndex
      if (typeof fn !== 'function') return
      fn(leftEl, rowIndex)
      fn(rightEl, rowIndex)
    }

    function toggleDepsHunkCollapse(hunkIndex) {
      if (!Number.isFinite(hunkIndex)) return
      if (!Array.isArray(state.depsCollapsedHunks)) state.depsCollapsedHunks = []
      const idx = state.depsCollapsedHunks.indexOf(hunkIndex)
      if (idx >= 0) state.depsCollapsedHunks.splice(idx, 1)
      else state.depsCollapsedHunks.push(hunkIndex)
      state.depsCollapsedHunks.sort((a, b) => a - b)
      scheduleSyncDepsDiffRowHeights()
    }

    function onDiffScroll(from, evt) {
      scheduleSyncDiffRowHeightsByScroll()
      if (!state.syncScroll) return
      if (isSyncingDiffScroll.value) return
      const scrollEl = evt && evt.target ? evt.target : null
      const pair = resolveDiffPanePair(scrollEl)
      const fromEl = from === 'left' ? (scrollEl || pair.leftEl) : (scrollEl || pair.rightEl)
      const toEl = from === 'left' ? pair.rightEl : pair.leftEl
      if (!fromEl || !toEl) return
      const fromScrollTop = fromEl.scrollTop
      const fromScrollLeft = fromEl.scrollLeft
      const fromLines = Array.from(fromEl.querySelectorAll('[data-row-index]'))
      if (!fromLines.length) return

      let anchor = null
      for (const n of fromLines) {
        if (n.offsetTop + n.offsetHeight > fromScrollTop) {
          anchor = n
          break
        }
      }
      if (!anchor) anchor = fromLines[fromLines.length - 1]

      const rowIndex = anchor.getAttribute('data-row-index')
      if (!rowIndex) return
      const toAnchor = toEl.querySelector('[data-row-index="' + rowIndex + '"]')
      if (!toAnchor) return

      const delta = fromScrollTop - anchor.offsetTop
      isSyncingDiffScroll.value = true
      toEl.scrollTop = Math.max(0, toAnchor.offsetTop + delta)
      toEl.scrollLeft = fromScrollLeft
      requestAnimationFrame(() => (isSyncingDiffScroll.value = false))
    }

    /**
     * 左侧结构化树点击文件时打开差异
     * @param {any} node
     */
    async function onLeftTreeClick(node) {
      if (!node) return
      if ((node.type === 'jar' || node.jarContainer) && (node.jarPath || node.path || node.key)) {
        openDependencyDialog({
          jarPath: String(node.jarPath || node.path || node.key),
          status: String(node.status || ''),
          innerChanged: Number.isFinite(node.innerChanged) ? node.innerChanged : 0
        })
        return
      }
      if (node.type !== 'file') return
      await openDiff(node.path || node.key)
    }

    /**
     * 全屏弹窗打开后刷新行高与同步滚动状态
     */
    async function onDiffDialogOpened() {
      isSyncingDiffScroll.value = false
      await nextTick()
      scheduleSyncDiffRowHeights()
    }

    /**
     * 全屏弹窗关闭后刷新行高与同步滚动状态
     */
    async function onDiffDialogClosed() {
      isSyncingDiffScroll.value = false
      await nextTick()
      scheduleSyncDiffRowHeights()
    }

    /**
     * 合并高频触发的“行高同步”请求，避免切换自动换行时触发大量重复计算导致卡顿
     */
    let isSyncDiffRowHeightsScheduled = false
    async function scheduleSyncDiffRowHeights() {
      if (isSyncDiffRowHeightsScheduled) return
      isSyncDiffRowHeightsScheduled = true
      await nextTick()
      requestAnimationFrame(() => {
        isSyncDiffRowHeightsScheduled = false
        syncDiffRowHeights()
      })
    }

    /**
     * 由滚动事件触发的行高同步（节流），确保“仅同步可视区”策略下滚动后仍能对齐
     */
    let syncDiffRowHeightsScrollTimer = 0
    function scheduleSyncDiffRowHeightsByScroll() {
      if (!state.wrapLines) return
      if (syncDiffRowHeightsScrollTimer) window.clearTimeout(syncDiffRowHeightsScrollTimer)
      syncDiffRowHeightsScrollTimer = window.setTimeout(() => {
        syncDiffRowHeightsScrollTimer = 0
        scheduleSyncDiffRowHeights()
      }, 80)
    }

    function syncDiffRowHeights() {
      const leftEl = getActiveDiffPaneEl('left')
      const rightEl = getActiveDiffPaneEl('right')
      if (!leftEl || !rightEl) return

      const leftNodes = Array.from(leftEl.querySelectorAll('.diff-line'))
      const rightNodes = Array.from(rightEl.querySelectorAll('.diff-line'))

      if (!state.wrapLines) {
        for (const n of leftNodes) n.style.height = ''
        for (const n of rightNodes) n.style.height = ''
        return
      }

      const viewTop = leftEl.scrollTop
      const viewBottom = viewTop + leftEl.clientHeight
      const buffer = 400
      const leftMap = new Map()
      for (const n of leftNodes) {
        const k = n.getAttribute('data-row-index')
        if (k == null) continue
        const top = n.offsetTop
        const bottom = top + n.offsetHeight
        if (bottom < viewTop - buffer) continue
        if (top > viewBottom + buffer) continue
        leftMap.set(k, n)
      }
      const rightMap = new Map()
      for (const n of rightNodes) {
        const k = n.getAttribute('data-row-index')
        if (k == null) continue
        rightMap.set(k, n)
      }

      for (const [k, ln] of leftMap.entries()) {
        const rn = rightMap.get(k)
        if (!rn) continue
        ln.style.height = ''
        rn.style.height = ''
        const lh = ln.getBoundingClientRect().height
        const rh = rn.getBoundingClientRect().height
        const h = Math.max(lh, rh)
        ln.style.height = h + 'px'
        rn.style.height = h + 'px'
      }
    }

    watch(() => state.wrapLines, () => scheduleSyncDiffRowHeights())
    watch(() => state.showDiffOnly, (v) => {
      if (!v) {
        state.collapsedHunks = []
        state.hunkPopoverOpen = false
      }
      scheduleSyncDiffRowHeights()
    })
    watch(() => state.selectedPath, () => scheduleSyncDiffRowHeights())
    watch(() => state.diffDialogOpen, () => scheduleSyncDiffRowHeights())

    const structureExpanded = ref({})

    /**
     * 初始化结构视图的展开状态：默认不展开，由用户逐层展开
     */
    function initStructureExpanded() {
      structureExpanded.value = Object.create(null)
    }

    function buildStructureExpandedForDiff(nodes, aggStatus) {
      const out = Object.create(null)
      let expandedCount = 0
      const maxExpanded = 900

      const walk = (list) => {
        for (const n of list || []) {
          if (!n) continue
          const key = n.value != null ? String(n.value) : n.key != null ? String(n.key) : String(n.label || '')
          const hasChildren = Array.isArray(n.children) && n.children.length
          if (hasChildren && key && aggStatus && aggStatus[key]) {
            out[key] = true
            expandedCount += 1
            if (expandedCount >= maxExpanded) return true
            if (walk(n.children)) return true
          }
        }
        return false
      }

      walk(nodes || [])
      return out
    }

    function buildAggStatusMapByChanged(changed) {
      const out = Object.create(null)
      const rank = (s) => (s === 'missing' ? 4 : s === 'added' ? 3 : s === 'modified' ? 2 : s === 'meta' ? 1 : 0)
      const pick = (a, b) => (rank(a) >= rank(b) ? a : b)

      const touch = (key, status) => {
        if (!key) return
        const cur = out[key]
        out[key] = cur ? pick(cur, status) : status
      }

      const touchPrefixes = (baseKey, seg, status) => {
        if (!seg || seg.length <= 1) return
        let prefix = ''
        for (let i = 0; i < seg.length - 1; i++) {
          prefix = prefix ? prefix + '/' + seg[i] : seg[i]
          touch(baseKey ? baseKey + '/' + prefix : prefix, status)
        }
      }

      for (const x of changed || []) {
        if (!x || !x.path) continue
        const status = String(x.status || '')
        if (!status || status === 'unchanged') continue
        const raw = String(x.path || '').replace(/\\/g, '/')
        if (!raw) continue

        const idx = raw.indexOf('!/')
        if (idx > 0) {
          const outer = raw.slice(0, idx)
          const inner = raw.slice(idx + 2)
          const outerKey = outer.endsWith('!') ? outer : outer + '!'
          touch(outer, status)
          touch(outerKey, status)
          touch(raw, status)

          const seg = inner.split('/').filter(Boolean)
          if (seg.length) {
            touchPrefixes(outerKey, seg, status)
          }
          continue
        }

        touch(raw, status)
        if (raw.endsWith('!')) {
          touch(raw.slice(0, -1), status)
          continue
        }

        const seg = raw.split('/').filter(Boolean)
        if (!seg.length) continue
        touchPrefixes('', seg, status)
      }

      return out
    }

    function buildStructureExpandedForDiffFromChanged(changed) {
      const out = Object.create(null)
      let expandedCount = 0
      const maxExpanded = 900

      const touch = (key) => {
        if (!key || out[key]) return
        out[key] = true
        expandedCount += 1
      }

      for (const x of changed || []) {
        if (expandedCount >= maxExpanded) break
        if (!x || !x.path) continue
        const status = String(x.status || '')
        if (!status || status === 'unchanged') continue
        const raw = String(x.path || '').replace(/\\/g, '/')
        if (!raw) continue

        const idx = raw.indexOf('!/')
        if (idx > 0) {
          const outer = raw.slice(0, idx)
          const inner = raw.slice(idx + 2)
          const outerKey = outer.endsWith('!') ? outer : outer + '!'
          touch(outerKey)
          if (expandedCount >= maxExpanded) break
          const seg = inner.split('/').filter(Boolean)
          if (seg.length > 1) {
            let prefix = ''
            for (let i = 0; i < seg.length - 1; i++) {
              prefix = prefix ? prefix + '/' + seg[i] : seg[i]
              touch(outerKey + '/' + prefix)
              if (expandedCount >= maxExpanded) break
            }
          }
          continue
        }

        if (raw.endsWith('!')) {
          touch(raw)
          continue
        }

        const seg = raw.split('/').filter(Boolean)
        if (seg.length <= 1) continue
        let prefix = ''
        for (let i = 0; i < seg.length - 1; i++) {
          prefix = prefix ? prefix + '/' + seg[i] : seg[i]
          touch(prefix)
          if (expandedCount >= maxExpanded) break
        }
      }

      return out
    }

    /**
     * 计算结构节点（目录/文件）的聚合变动状态，用于文件夹着色提示
     * @param {Array<any>} nodes
     * @returns {Record<string, string>}
     */
    function buildAggStatusMap(nodes) {
      const out = Object.create(null)
      const rank = (s) => (s === 'missing' ? 4 : s === 'added' ? 3 : s === 'modified' ? 2 : s === 'meta' ? 1 : 0)
      const pick = (a, b) => (rank(a) >= rank(b) ? a : b)

      const walk = (n) => {
        if (!n) return ''
        const key = n.value != null ? String(n.value) : n.key != null ? String(n.key) : String(n.label || '')
        let status = ''
        const hasChildren = Array.isArray(n.children) && n.children.length
        const selfStatus = String(n.rightStatus || '')
        if (n.type === 'file' || (n.type === 'jar' && !hasChildren)) {
          status = selfStatus && selfStatus !== 'unchanged' ? selfStatus : ''
        } else {
          status = selfStatus && selfStatus !== 'unchanged' ? selfStatus : ''
          for (const c of n.children || []) {
            const cs = walk(c)
            if (cs) status = pick(status, cs)
          }
        }
        if (key) out[key] = status
        return status
      }

      for (const r of nodes || []) walk(r)
      return out
    }

    function buildDepsAggStatusMap(jarPath, changed) {
      const out = Object.create(null)
      const jp = String(jarPath || '')
      if (!jp) return out
      const prefix = jp + '!/'
      const list = []
      for (const x of changed || []) {
        if (!x || !x.path) continue
        const status = String(x.status || '')
        if (!status || status === 'unchanged') continue
        const raw = String(x.path || '').replace(/\\/g, '/')
        if (!raw) continue
        if (raw.startsWith(prefix)) {
          list.push({ path: raw, status })
          const rel = raw.slice(prefix.length)
          if (rel) list.push({ path: rel, status })
          continue
        }
        if (raw === jp || raw === jp + '!') {
          list.push({ path: raw, status })
        }
      }
      if (!list.length) return out
      return buildAggStatusMapByChanged(list)
    }

    watch(
      () => [treeData.value, state.showNestedJar, state.compareMode],
      () => {
        if (state.compareMode === 'directory') {
          const changed = allChanged.value || []
          structureExpanded.value = buildStructureExpandedForDiffFromChanged(changed)
          return
        }
        initStructureExpanded()
      },
      { immediate: true }
    )

    /**
     * 将结构树按展开状态转换为平铺行，避免 el-table 树形展开/收缩卡顿
     * @param {Array<any>} nodes
     * @param {Record<string, boolean>} expanded
     * @param {Record<string, string>} aggStatus
     * @returns {Array<{node:any,depth:number,key:string}>}
     */
    function flattenVisibleStructureRows(nodes, expanded, aggStatus) {
      const out = []
      ;(function walk(list, depth) {
        for (const n of list || []) {
          if (!n) continue
          const key = n.value != null ? String(n.value) : n.key != null ? String(n.key) : String(n.label || '')
          let leftExists = typeof n.leftExists === 'boolean' ? n.leftExists : true
          let rightExists = typeof n.rightExists === 'boolean' ? n.rightExists : true
          if (!leftExists && !rightExists) {
            leftExists = true
            rightExists = true
          }
          out.push({ node: n, depth, key, status: aggStatus && aggStatus[key] ? aggStatus[key] : '', leftExists, rightExists })
          const hasChildren = Array.isArray(n.children) && n.children.length
          if (hasChildren && expanded && expanded[key]) walk(n.children, depth + 1)
        }
      })(nodes || [], 0)
      return out
    }

    const structureAggStatus = computed(() => {
      structureTreeTouch.value
      if (state.compareMode === 'directory') return buildAggStatusMapByChanged(allChanged.value || [])
      return buildAggStatusMap(displayTreeData.value)
    })

    const structureRows = computed(() => {
      return flattenVisibleStructureRows(displayTreeData.value, structureExpanded.value || {}, structureAggStatus.value)
    })

    const structureVirtualEnabled = computed(() => {
      return state.compareMode === 'directory' && (structureRows.value || []).length >= 900
    })

    const structureRowPx = ref(32)
    const structureTopPad = ref(0)
    const structureBottomPad = ref(0)
    const structureVisibleRows = ref([])

    let structureScrollRaf = 0
    function syncStructureVirtual() {
      if (!structureVirtualEnabled.value) {
        structureTopPad.value = 0
        structureBottomPad.value = 0
        structureVisibleRows.value = []
        return
      }
      const el = structureScrollRef.value
      const rows = structureRows.value || []
      if (!el || !rows.length) {
        structureTopPad.value = 0
        structureBottomPad.value = 0
        structureVisibleRows.value = []
        return
      }

      if (!Number.isFinite(structureRowPx.value) || structureRowPx.value < 16) {
        structureRowPx.value = 32
      }
      const rowH = structureRowPx.value
      const scrollTop = el.scrollTop || 0
      const viewH = el.clientHeight || 0
      const bufferRows = 24

      let start = Math.floor(scrollTop / rowH) - bufferRows
      if (start < 0) start = 0
      let end = Math.ceil((scrollTop + viewH) / rowH) + bufferRows
      if (end > rows.length) end = rows.length

      structureTopPad.value = start * rowH
      structureBottomPad.value = Math.max(0, (rows.length - end) * rowH)
      structureVisibleRows.value = rows.slice(start, end)
    }

    async function measureStructureRowPx() {
      if (!structureVirtualEnabled.value) return
      await nextTick()
      const el = structureScrollRef.value
      if (!el) return
      const row = el.querySelector('.structure-row')
      if (!row || !row.getBoundingClientRect) return
      const h = Math.ceil(row.getBoundingClientRect().height || 0)
      if (h >= 16 && h <= 120) structureRowPx.value = h + 2
    }

    const depsLeftDiffPaneRef = ref(null)
    const depsRightDiffPaneRef = ref(null)
    const isSyncingDepsDiffScroll = ref(false)
    const depsStructureExpanded = ref({})
    const structureScrollRef = ref(null)
    const depsStructureScrollRef = ref(null)
    const lastStructureScrollTop = ref(0)
    const lastDepsStructureScrollTop = ref(0)

    /**
     * 初始化依赖弹窗的结构展开状态
     */
    function initDepsStructureExpanded(rootKey) {
      const next = Object.create(null)
      const k = rootKey != null ? String(rootKey) : ''
      if (k) next[k] = true
      depsStructureExpanded.value = next
    }

    /**
     * 构建“依赖弹窗结构视图”的默认展开键集合：自动展开含差异的目录，便于直接看到差异文件名
     * @param {Array<any>} nodes
     * @param {Record<string,string>} aggStatus
     * @param {string} rootKey
     * @returns {Record<string, boolean>}
     */
    function buildDepsExpandedForDiff(nodes, aggStatus, rootKey) {
      const out = Object.create(null)
      const rk = rootKey != null ? String(rootKey) : ''
      if (rk) out[rk] = true

      let expandedCount = 0
      const maxExpanded = 1600

      ;(function walk(list) {
        for (const n of list || []) {
          if (!n) continue
          const key = n.value != null ? String(n.value) : n.key != null ? String(n.key) : ''
          const hasChildren = Array.isArray(n.children) && n.children.length
          if (hasChildren) {
            const s = aggStatus && key && aggStatus[key] ? String(aggStatus[key]) : ''
            if (s && !out[key]) {
              out[key] = true
              expandedCount += 1
              if (expandedCount >= maxExpanded) return
            }
            walk(n.children)
            if (expandedCount >= maxExpanded) return
          }
        }
      })(nodes || [])

      return out
    }

    /**
     * 在结构树中按 value 精确查找节点
     * @param {Array<any>} nodes
     * @param {string} value
     * @returns {any|null}
     */
    function findTreeNodeByValue(nodes, value) {
      const v = String(value || '')
      if (!v) return null
      for (const n of nodes || []) {
        if (!n) continue
        if (String(n.value || '') === v) return n
        if (Array.isArray(n.children) && n.children.length) {
          const hit = findTreeNodeByValue(n.children, v)
          if (hit) return hit
        }
      }
      return null
    }

    /**
     * 在结构树中按自定义匹配器查找首个节点
     * @param {Array<any>} nodes
     * @param {(node:any)=>boolean} matcher
     * @returns {any|null}
     */
    function findTreeNode(nodes, matcher) {
      if (!matcher) return null
      for (const n of nodes || []) {
        if (!n) continue
        if (matcher(n)) return n
        if (Array.isArray(n.children) && n.children.length) {
          const hit = findTreeNode(n.children, matcher)
          if (hit) return hit
        }
      }
      return null
    }

    /**
     * 查找 value 对应节点的祖先路径（包含目标节点本身）
     * @param {Array<any>} nodes
     * @param {string} value
     * @returns {Array<any>}
     */
    function findTreeNodePath(nodes, value) {
      const v = String(value || '')
      if (!v) return []
      for (const n of nodes || []) {
        if (!n) continue
        if (String(n.value || '') === v) return [n]
        if (Array.isArray(n.children) && n.children.length) {
          const sub = findTreeNodePath(n.children, v)
          if (sub && sub.length) return [n].concat(sub)
        }
      }
      return []
    }

    /**
     * 将任意字符串转为可安全拼接到属性选择器中的文本（用于 data-node-key 查询）
     * @param {string} value
     * @returns {string}
     */
    function escapeForAttrSelector(value) {
      const s = String(value || '')
      if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s)
      return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    }

    /**
     * 将结构树滚动到指定节点 key 对应的可视位置
     * @param {string} key
     */
    async function scrollToStructureKey(key) {
      const k = String(key || '')
      if (!k) return
      await nextTick()
      const root = structureScrollRef.value
      if (!root) return
      const sel = '[data-node-key="' + escapeForAttrSelector(k) + '"]'
      const el = root.querySelector(sel)
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' })
    }

    /**
     * 在结构视图中展开目标节点的祖先并滚动定位到目标节点
     * @param {string} value
     */
    async function navigateToStructureValue(value) {
      const v = String(value || '')
      if (!v) return
      const path = findTreeNodePath(displayTreeData.value, v)
      if (!path || !path.length) return
      const nextExpanded = Object.assign({}, structureExpanded.value || {})
      for (let i = 0; i < path.length - 1; i++) {
        const n = path[i]
        if (!n) continue
        const key = n.value != null ? String(n.value) : ''
        if (!key) continue
        if (Array.isArray(n.children) && n.children.length) nextExpanded[key] = true
      }
      structureExpanded.value = nextExpanded
      await scrollToStructureKey(v)
    }

    const depsInnerRoot = computed(() => {
      if (!state.depsJarPath) return null
      const jarPath = String(state.depsJarPath || '')
      const jarName = jarDisplayName(jarPath)
      const key = jarPath
      const key2 = jarPath + '!'
      const labelKey = jarName ? jarName : ''
      const labelKey2 = jarName ? jarName + '!' : ''
      return (
        findTreeNodeByValue(treeData.value, key) ||
        findTreeNodeByValue(treeData.value, key2) ||
        findTreeNode(treeData.value, (n) => {
          const v = n && n.value != null ? String(n.value) : ''
          const lb = n && n.label != null ? String(n.label) : ''
          if (v === key || v === key2) return true
          if (labelKey && lb === labelKey) return true
          if (labelKey2 && lb === labelKey2) return true
          if (v && (v.endsWith('/' + key) || v.endsWith('/' + key2))) return true
          return false
        })
      )
    })

    /**
     * 清理依赖弹窗的内部结构缓存与加载状态
     */
    function resetDepsInnerTree() {
      depsLoadedTreeData.value = []
      depsLoadedOuter.value = ''
      state.depsTreeLoading = false
      state.depsTreeError = ''
    }

    /**
     * 拉取并构建依赖 jar 的内部结构树（用于依赖差异弹窗结构视图）
     * @param {string} jarPath
     */
    async function loadDepsInnerTree(jarPath) {
      const jp = String(jarPath || state.depsJarPath || '')
      if (!jp) return
      if (!state.compareId) return
      if (!state.deepCompareLib) return
      if (!api || !api.loadNestedTree) return
      if (depsLoadedOuter.value === jp && Array.isArray(depsLoadedTreeData.value) && depsLoadedTreeData.value.length) return

      state.depsTreeLoading = true
      state.depsTreeError = ''
      try {
        const children = await api.loadNestedTree(state.compareId, jp)
        const decorated = decorateTree(Array.isArray(children) ? children : [])
        const jarName = jarDisplayName(jp)
        const root = {
          type: 'jar',
          label: (jarName ? jarName : jp) + '!',
          value: jp + '!',
          displayLabel: jarName,
          displayTitle: jp,
          leftExists: true,
          rightExists: true,
          children: decorated
        }
        const js = String(state.depsJarStatus || '')
        if (js === 'added') {
          root.leftExists = false
          root.rightExists = true
        } else if (js === 'missing') {
          root.leftExists = true
          root.rightExists = false
        }
        depsLoadedOuter.value = jp
        depsLoadedTreeData.value = [root]

        const treeAgg = buildAggStatusMap([root])
        const changedAgg = buildDepsAggStatusMap(jp, allChanged.value || [])
        const agg = changedAgg && Object.keys(changedAgg).length ? Object.assign({}, treeAgg, changedAgg) : treeAgg
        depsStructureExpanded.value = buildDepsExpandedForDiff([root], agg, root.value)
      } catch (e) {
        depsLoadedTreeData.value = []
        state.depsTreeError = e && e.message ? e.message : '加载依赖 jar 结构失败'
      } finally {
        state.depsTreeLoading = false
      }
    }

    function buildDepsFallbackTree(jarPath) {
      const jp = String(jarPath || '')
      if (!jp) return []
      const prefix = jp + '!/'
      const files = []
      for (const x of allChanged.value || []) {
        const p = String(x && x.path ? x.path : '')
        if (!p.startsWith(prefix)) continue
        files.push({ path: p, status: String(x.status || '') })
      }
      if (!files.length) return []

      const statusToExists = (status) => {
        if (status === 'added') return { left: false, right: true }
        if (status === 'missing') return { left: true, right: false }
        return { left: true, right: true }
      }

      const jarName = jarDisplayName(jp)
      const root = {
        type: 'jar',
        label: (jarName ? jarName : jp) + '!',
        value: jp + '!',
        displayLabel: jarName,
        displayTitle: jp,
        leftExists: true,
        rightExists: true,
        children: []
      }

      const js = String(state.depsJarStatus || '')
      if (js === 'added') {
        root.leftExists = false
        root.rightExists = true
      } else if (js === 'missing') {
        root.leftExists = true
        root.rightExists = false
      }

      const dirIndex = new Map()
      const ensureDir = (parentChildren, dirValue, label, ex) => {
        const key = String(dirValue || '')
        const existed = dirIndex.get(key)
        if (existed) {
          existed.leftExists = existed.leftExists || ex.left
          existed.rightExists = existed.rightExists || ex.right
          return existed
        }
        const node = { type: 'dir', label, value: key, leftExists: !!ex.left, rightExists: !!ex.right, children: [] }
        dirIndex.set(key, node)
        parentChildren.push(node)
        return node
      }

      for (const f of files) {
        const fullPath = String(f.path || '')
        const rel = fullPath.slice(prefix.length)
        const seg = rel.split('/').filter(Boolean)
        if (!seg.length) continue
        const ex = statusToExists(String(f.status || ''))
        let children = root.children
        let built = ''
        for (let i = 0; i < seg.length - 1; i++) {
          built = built ? built + '/' + seg[i] : seg[i]
          const dirValue = prefix + built
          const dir = ensureDir(children, dirValue, seg[i], ex)
          children = dir.children
        }
        const leafLabel = seg[seg.length - 1]
        children.push({
          type: 'file',
          label: leafLabel,
          value: fullPath,
          leftExists: !!ex.left,
          rightExists: !!ex.right,
          rightStatus: String(f.status || '')
        })
        root.leftExists = root.leftExists || ex.left
        root.rightExists = root.rightExists || ex.right
      }

      const sortTree = (nodes) => {
        ;(nodes || []).sort((a, b) => {
          if (!a || !b) return 0
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
          return String(a.label || '').localeCompare(String(b.label || ''))
        })
        for (const n of nodes || []) {
          if (n && Array.isArray(n.children) && n.children.length) sortTree(n.children)
        }
      }
      sortTree(root.children)
      return [root]
    }

    const depsDisplayTreeData = computed(() => {
      const jarPath = String(state.depsJarPath || '')
      if (!jarPath) return []
      if (Array.isArray(depsLoadedTreeData.value) && depsLoadedTreeData.value.length) return depsLoadedTreeData.value
      const n = depsInnerRoot.value
      const hasChildren = !!(n && Array.isArray(n.children) && n.children.length)
      if (!hasChildren) return buildDepsFallbackTree(jarPath)
      const displayLabel = jarDisplayName(jarPath)
      const wrapped = Object.assign({}, n, { type: 'jar', displayLabel, displayTitle: jarPath })
      return [wrapped]
    })

    const depsAggStatus = computed(() => {
      const jarPath = String(state.depsJarPath || '')
      const fromChanged = buildDepsAggStatusMap(jarPath, allChanged.value || [])
      const fromTree = buildAggStatusMap(depsDisplayTreeData.value)
      if (!fromChanged || !Object.keys(fromChanged).length) return fromTree
      return Object.assign({}, fromTree, fromChanged)
    })

    const depsStructureRows = computed(() => {
      return flattenVisibleStructureRows(depsDisplayTreeData.value, depsStructureExpanded.value || {}, depsAggStatus.value)
    })

    const depsSelectedDiff = computed(() => state.depsCurrentDiff)

    const depsChangeLines = computed(() => {
      const d = depsSelectedDiff.value
      if (!d || d.kind !== 'text' || !Array.isArray(d.rows) || !d.rows.length) return []

      const leftMap = new Map()
      const rightMap = new Map()
      for (const h of d.highlights || []) {
        if (!h || !h.side || !h.type || !Number.isFinite(h.line)) continue
        if (h.side === 'left') leftMap.set(h.line, h.type)
        if (h.side === 'right') rightMap.set(h.line, h.type)
      }

      const out = []
      for (let idx = 0; idx < d.rows.length; idx++) {
        const r = d.rows[idx] || {}
        const lt = r.leftNo ? leftMap.get(r.leftNo) || '' : ''
        const rt = r.rightNo ? rightMap.get(r.rightNo) || '' : ''
        if (lt || rt) out.push(idx)
      }
      return out
    })

    const depsViewRows = computed(() => {
      const activeRowIndex = depsChangeLines.value[state.depsActiveChangeIndex]
      const rows = buildDiffRows(depsSelectedDiff.value, state.showDiffOnly, activeRowIndex, state.depsCollapsedHunks)
      return window.JarDiff && window.JarDiff.ui && window.JarDiff.ui.filterOutHunkGaps
        ? window.JarDiff.ui.filterOutHunkGaps(rows, state.showDiffOnly)
        : rows
    })

    const depsMinimapMarks = computed(() => buildMinimapMarks(depsSelectedDiff.value))

    /**
     * 加载依赖弹窗当前选中文件的差异内容
     */
    async function loadDepsDiff() {
      if (!state.compareId || !state.depsSelectedPath) return
      const req = (state.depsDiffSeq = (state.depsDiffSeq || 0) + 1)
      const wantedPath = String(state.depsSelectedPath || '')
      state.depsCollapsedHunks = []
      const cacheKey = makeDiffCacheKey(state.compareId, wantedPath)
      const cached = getFromCache(depsDiffCache, cacheKey)
      if (cached) {
        state.depsDiffError = ''
        state.depsDiffLoading = false
        state.depsDiffLoadingPath = ''
        state.depsCurrentDiff = cached
        scheduleSyncDepsDiffRowHeights()
        return
      }
      try {
        state.depsDiffError = ''
        state.depsDiffLoading = true
        state.depsDiffLoadingPath = wantedPath
        state.depsCurrentDiff = null
        const data = await api.loadDiff(state.compareId, wantedPath)
        if (req !== state.depsDiffSeq) return
        state.depsCurrentDiff = data
        putToCache(depsDiffCache, cacheKey, data, DIFF_CACHE_MAX)
        scheduleSyncDepsDiffRowHeights()
      } catch (e) {
        if (req !== state.depsDiffSeq) return
        state.depsCurrentDiff = null
        state.depsDiffError = e && e.message ? e.message : '加载差异失败'
      } finally {
        if (req === state.depsDiffSeq) {
          state.depsDiffLoading = false
          state.depsDiffLoadingPath = ''
        }
      }
    }

    /**
     * 依赖弹窗：左右内容同步滚动
     * @param {'left'|'right'} from
     * @param {Event} evt
     */
    function onDepsDiffScroll(from, evt) {
      scheduleSyncDepsDiffRowHeightsByScroll()
      if (!state.syncScroll) return
      if (isSyncingDepsDiffScroll.value) return
      const scrollEl = evt && evt.target ? evt.target : null
      const fromEl = from === 'left' ? (scrollEl || depsLeftDiffPaneRef.value) : (scrollEl || depsRightDiffPaneRef.value)
      const toEl = from === 'left' ? depsRightDiffPaneRef.value : depsLeftDiffPaneRef.value
      if (!fromEl || !toEl) return
      const fromScrollTop = fromEl.scrollTop
      const fromScrollLeft = fromEl.scrollLeft
      const fromLines = Array.from(fromEl.querySelectorAll('[data-row-index]'))
      if (!fromLines.length) return

      let anchor = null
      for (const n of fromLines) {
        if (n.offsetTop + n.offsetHeight > fromScrollTop) {
          anchor = n
          break
        }
      }
      if (!anchor) anchor = fromLines[fromLines.length - 1]

      const rowIndex = anchor.getAttribute('data-row-index')
      if (!rowIndex) return
      const toAnchor = toEl.querySelector('[data-row-index="' + rowIndex + '"]')
      if (!toAnchor) return

      const delta = fromScrollTop - anchor.offsetTop
      isSyncingDepsDiffScroll.value = true
      toEl.scrollTop = Math.max(0, toAnchor.offsetTop + delta)
      toEl.scrollLeft = fromScrollLeft
      requestAnimationFrame(() => (isSyncingDepsDiffScroll.value = false))
    }

    /**
     * 合并依赖弹窗的“行高同步”请求，避免切换自动换行导致卡顿
     */
    let isSyncDepsDiffRowHeightsScheduled = false
    async function scheduleSyncDepsDiffRowHeights() {
      if (!state.depsDialogOpen) return
      if (!state.wrapLines) {
        syncDepsDiffRowHeights()
        return
      }
      if (isSyncDepsDiffRowHeightsScheduled) return
      isSyncDepsDiffRowHeightsScheduled = true
      await nextTick()
      requestAnimationFrame(() => {
        isSyncDepsDiffRowHeightsScheduled = false
        syncDepsDiffRowHeights()
      })
    }

    /**
     * 由滚动事件触发的依赖弹窗行高同步（节流），确保“仅同步可视区”策略下滚动后仍能对齐
     */
    let syncDepsDiffRowHeightsScrollTimer = 0
    function scheduleSyncDepsDiffRowHeightsByScroll() {
      if (!state.depsDialogOpen) return
      if (!state.wrapLines) return
      if (syncDepsDiffRowHeightsScrollTimer) window.clearTimeout(syncDepsDiffRowHeightsScrollTimer)
      syncDepsDiffRowHeightsScrollTimer = window.setTimeout(() => {
        syncDepsDiffRowHeightsScrollTimer = 0
        scheduleSyncDepsDiffRowHeights()
      }, 80)
    }

    /**
     * 依赖弹窗：开启自动换行时同步左右行高
     */
    function syncDepsDiffRowHeights() {
      const leftEl = depsLeftDiffPaneRef.value
      const rightEl = depsRightDiffPaneRef.value
      if (!leftEl || !rightEl) return

      const leftNodes = Array.from(leftEl.querySelectorAll('.diff-line'))
      const rightNodes = Array.from(rightEl.querySelectorAll('.diff-line'))

      if (!state.wrapLines) {
        for (const n of leftNodes) n.style.height = ''
        for (const n of rightNodes) n.style.height = ''
        return
      }

      const viewTop = leftEl.scrollTop
      const viewBottom = viewTop + leftEl.clientHeight
      const buffer = 400
      const leftMap = new Map()
      for (const n of leftNodes) {
        const k = n.getAttribute('data-row-index')
        if (k == null) continue
        const top = n.offsetTop
        const bottom = top + n.offsetHeight
        if (bottom < viewTop - buffer) continue
        if (top > viewBottom + buffer) continue
        leftMap.set(k, n)
      }
      const rightMap = new Map()
      for (const n of rightNodes) {
        const k = n.getAttribute('data-row-index')
        if (k == null) continue
        rightMap.set(k, n)
      }

      for (const [k, ln] of leftMap.entries()) {
        const rn = rightMap.get(k)
        if (!rn) continue
        ln.style.height = ''
        rn.style.height = ''
        const lh = ln.getBoundingClientRect().height
        const rh = rn.getBoundingClientRect().height
        const h = Math.max(lh, rh)
        ln.style.height = h + 'px'
        rn.style.height = h + 'px'
      }
    }

    watch(() => state.wrapLines, () => scheduleSyncDepsDiffRowHeights())
    watch(() => state.showDiffOnly, () => scheduleSyncDepsDiffRowHeights())
    watch(() => state.depsSelectedPath, () => scheduleSyncDepsDiffRowHeights())
    watch(() => state.depsDialogOpen, () => scheduleSyncDepsDiffRowHeights())

    watch(
      () => state.depsViewMode,
      async (mode) => {
        if (!state.depsDialogOpen) return
        if (String(mode || '') !== 'content') return
        if (!state.depsSelectedPath) return
        state.depsActiveChangeIndex = 0
        await loadDepsDiff()
      }
    )

    /**
     * 依赖弹窗：打开 jar 本体差异（未开启深度比对时的兜底）
     */
    function openDepsJarMeta() {
      if (!state.depsJarPath) return
      state.depsSelectedPath = String(state.depsJarPath || '')
      state.depsViewMode = 'content'
      state.depsActiveChangeIndex = 0
      loadDepsDiff()
    }

    /**
     * 打开依赖差异弹窗：展示该依赖的结构与文件内容差异
     * @param {{jarPath:string,status:string}} row
     */
    async function openDependencyDialog(row) {
      const jarPath = row && row.jarPath ? String(row.jarPath) : ''
      if (!jarPath) return
      state.depsJarPath = jarPath
      state.depsJarStatus = row && row.status ? String(row.status) : ''
      state.depsInnerChanged = row && Number.isFinite(row.innerChanged) ? row.innerChanged : 0
      state.depsDialogOpen = true
      state.depsViewMode = 'structure'
      state.depsSelectedPath = ''
      state.depsCurrentDiff = null
      state.depsDiffError = ''
      state.depsActiveChangeIndex = 0
      resetDepsInnerTree()
      const root = depsInnerRoot.value
      const rootKey = root && root.value ? String(root.value) : jarPath + '!'
      initDepsStructureExpanded(rootKey)
      await nextTick()
      state.depsViewMode = 'structure'
      loadDepsInnerTree(jarPath)
    }

    /**
     * 依赖弹窗结构行点击：目录展开/收缩，文件进入内容比对
     * @param {any} node
     */
    function onDepsStructureRowClick(node) {
      if (!node) return
      if (node.type === 'file') {
        state.depsSelectedPath = String(node.value || '')
        state.depsViewMode = 'content'
        state.depsActiveChangeIndex = 0
        loadDepsDiff()
        return
      }
      const key = node.value != null ? String(node.value) : ''
      if (!key) return
      const hasChildren = Array.isArray(node.children) && node.children.length
      if (!hasChildren) return
      const cur = Object.assign({}, depsStructureExpanded.value || {})
      cur[key] = !cur[key]
      depsStructureExpanded.value = cur
    }

    /**
     * 依赖弹窗：上一处/下一处差异定位
     * @param {number} dir
     */
    async function depsStepChange(dir) {
      const total = depsChangeLines.value.length
      if (!total) return
      const next = Math.min(total - 1, Math.max(0, state.depsActiveChangeIndex + dir))
      state.depsActiveChangeIndex = next
      await nextTick()
      const rowIndex = depsChangeLines.value[state.depsActiveChangeIndex]
      if (!Number.isFinite(rowIndex)) return
      const leftEl = depsLeftDiffPaneRef.value
      const rightEl = depsRightDiffPaneRef.value
      if (leftEl) {
        const node = leftEl.querySelector('[data-row-index="' + rowIndex + '"]')
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
      }
      if (rightEl) {
        const node = rightEl.querySelector('[data-row-index="' + rowIndex + '"]')
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
      }
    }

    /**
     * 结构视图行点击：目录展开/收缩，文件打开差异
     * @param {any} node
     */
    const lazyJarLoading = new Set()
    const structureTreeTouch = ref(0)

    /**
     * 标记结构树已发生“深层变更”（例如懒加载 jar 子树），强制刷新依赖其深层字段的计算属性。
     */
    function touchStructureTree() {
      structureTreeTouch.value = (structureTreeTouch.value || 0) + 1
    }

    async function onStructureRowClick(node) {
      if (!node) return
      if (node.type === 'file') {
        openDiff(node.value)
        return
      }
      const key = node.value != null ? String(node.value) : ''
      if (!key) return
      const hasChildren = Array.isArray(node.children) && node.children.length
      if (!hasChildren) {
        if (node.type !== 'jar') return
        if (!api || !api.loadNestedTree) return
        if (!state.compareId) return
        if (lazyJarLoading.has(key)) return
        lazyJarLoading.add(key)
        try {
          const children = await api.loadNestedTree(state.compareId, key)
          node.children = decorateTree(Array.isArray(children) ? children : [])
          if (!node.children.length) {
            ElementPlus.ElMessage.info('该 jar 无可展示的内部文件或对侧缺失')
            return
          }
          const cur = Object.assign({}, structureExpanded.value || {})
          cur[key] = true
          structureExpanded.value = cur
          touchStructureTree()
        } catch (e) {
          const msg = e && e.message ? e.message : '加载 jar 结构失败'
          ElementPlus.ElMessage.error(msg)
        } finally {
          lazyJarLoading.delete(key)
        }
        return
      }
      const cur = Object.assign({}, structureExpanded.value || {})
      cur[key] = !cur[key]
      structureExpanded.value = cur
    }

    function onStructureScroll(evt) {
      const el = evt && evt.target ? evt.target : structureScrollRef.value
      if (!el) return
      lastStructureScrollTop.value = el.scrollTop || 0
      if (!structureVirtualEnabled.value) return
      if (structureScrollRaf) return
      structureScrollRaf = requestAnimationFrame(() => {
        structureScrollRaf = 0
        syncStructureVirtual()
      })
    }

    function onDepsStructureScroll(evt) {
      const el = evt && evt.target ? evt.target : depsStructureScrollRef.value
      if (!el) return
      lastDepsStructureScrollTop.value = el.scrollTop || 0
    }

    watch(
      () => state.viewMode,
      async (v) => {
        if (v !== 'structure') return
        await nextTick()
        const el = structureScrollRef.value
        if (!el) return
        el.scrollTop = lastStructureScrollTop.value || 0
        await measureStructureRowPx()
        syncStructureVirtual()
      }
    )

    watch(
      () => [structureVirtualEnabled.value, structureRows.value.length, state.compareMode, state.showNestedJar],
      async () => {
        await measureStructureRowPx()
        syncStructureVirtual()
      }
    )

    watch(
      () => state.compareMode,
      () => {
        normalizeViewMode()
        if (state.compareMode === 'directory' && state.leftTab === 'deps') state.leftTab = 'app'
      }
    )

    watch(
      () => [state.compareMode, state.directoryInputMode, leftJar.value.length, rightJar.value.length, leftDirFiles.value.length, rightDirFiles.value.length],
      async () => {
        await nextTick()
        syncHeaderHeightVar()
      }
    )

    watch(
      () => [state.depsDialogOpen, state.depsViewMode, state.depsJarPath],
      async ([open, mode]) => {
        if (!open || mode !== 'structure') return
        await nextTick()
        const el = depsStructureScrollRef.value
        if (!el) return
        el.scrollTop = lastDepsStructureScrollTop.value || 0
      }
    )

    function onNodeClick(node) {
      if (!node || node.type !== 'file') return
      if (
        typeof node.value === 'string' &&
        node.value.startsWith('BOOT-INF/lib/') &&
        node.value.toLowerCase().endsWith('.jar') &&
        Array.isArray(node.children) &&
        node.children.length
      ) {
        return
      }
      openDiff(node.value)
    }

    function pickDirectory(side) {
      if (state.directoryInputMode !== 'picker') onDirectoryInputModeChange('picker')
      const el = side === 'left' ? leftDirInputRef.value : rightDirInputRef.value
      if (el && typeof el.click === 'function') el.click()
    }

    function onDirectoryInputModeChange(mode) {
      const m = mode === 'path' ? 'path' : 'picker'
      state.directoryInputMode = m
      if (m === 'path') {
        leftDirFiles.value = []
        rightDirFiles.value = []
        if (leftDirInputRef.value) leftDirInputRef.value.value = ''
        if (rightDirInputRef.value) rightDirInputRef.value.value = ''
        return
      }
      state.leftDirPath = ''
      state.rightDirPath = ''
    }

    function onDirectoryPicked(side, evt) {
      const files = evt && evt.target && evt.target.files ? Array.from(evt.target.files) : []
      const list = files.filter((f) => f && f.name)
      list.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name))
      state.directoryInputMode = 'picker'
      state.leftDirPath = ''
      state.rightDirPath = ''
      if (side === 'left') leftDirFiles.value = list
      else rightDirFiles.value = list
      try {
        if (evt && evt.target) evt.target.value = ''
      } catch (e) {}
    }

    async function copyText(text) {
      const s = String(text || '')
      if (!s) return
      try {
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(s)
        } else {
          const ta = document.createElement('textarea')
          ta.value = s
          ta.style.position = 'fixed'
          ta.style.left = '-9999px'
          ta.style.top = '0'
          document.body.appendChild(ta)
          ta.focus()
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        ElementPlus.ElMessage.success('已复制')
      } catch (e) {
        ElementPlus.ElMessage.error('复制失败')
      }
    }

    function copySelectedPath() {
      if (!state.selectedPath) return
      copyText(state.selectedPath)
    }

    watch(
      () => [
        state.compareMode,
        state.includeLib,
        state.includeClasses,
        state.includeResources,
        state.deepCompareLib,
        state.showNestedJar,
        state.limitJarMb,
        state.limitDirFiles,
        state.limitDirMb,
        state.warmupLimit,
        state.directoryInputMode,
        state.leftDirPath,
        state.rightDirPath,
        state.dirHistory,
        state.ignorePreset,
        state.ignoreGlobs,
        state.statusFilter,
        state.syncScroll,
        state.wrapLines,
        state.showDiffOnly,
        state.leftTab,
        state.directoryLeftTab,
        state.dirGroupDepth,
        state.sidebarWidthSingle,
        state.sidebarWidthDirectory,
        state.focusMode,
        state.viewMode,
        state.compareId,
        state.selectedPath
      ],
      () => schedulePersist()
    )

    setTimeout(async () => {
      await loadServerLimits()
      if (autoRestoreCanceled || state.isComparing) return
      const ok = await restoreFromQuery()
      if (autoRestoreCanceled || state.isComparing) return
      if (!ok) await restoreLastCompare()
    }, 0)

    return {
      state,
      headerContainerRef,
      leftJar,
      rightJar,
      leftDirFiles,
      rightDirFiles,
      leftDirInputRef,
      rightDirInputRef,
      treeData,
      displayTreeData,
      canCompare,
      changedFiles,
      groupedChanged,
      isWide,
      workspaceGridColumns,
      listGroups,
      directoryChangedTree,
      directoryHotlist,
      directorySummaryTree,
      onDirectoryHotItemClick,
      onDirectorySummaryNodeClick,
      activeFilterChips,
      clearFilterChip,
      resetFilters,
      mapRiskTagType,
      openFromListRow,
      openStructureFromListRow,
      appChangedTree,
      otherChangedTree,
      summaryModel,
      summaryTotals,
      dependencyRows,
      jarDisplayName,
      selectedInfo,
      ignorePreview,
      applyQuickStatusFilter,
      onSummaryCardActivate,
      applyIgnorePreset,
      resetIgnoreToDefault,
      structureStats,
      selectedDiff,
      diffStats,
      changeLines,
      viewRows,
      minimapMarks,
      mainLeftDiffPaneRef,
      mainRightDiffPaneRef,
      dialogLeftDiffPaneRef,
      dialogRightDiffPaneRef,
      structureRows,
      structureExpanded,
      structureScrollRef,
      depsStructureScrollRef,
      mapStatusBadge,
      mapStructureBadge,
      structureVirtualEnabled,
      structureVisibleRows,
      structureTopPad,
      structureBottomPad,
      compareLimitHint,
      leftDirPickedPill,
      rightDirPickedPill,
      compareProgressStatus,
      startCompare,
      openDiff,
      openDiffDialog,
      openDependencyDialog,
      stepChange,
      scrollToRow,
      toggleHunkCollapse,
      collapseAllHunks,
      expandAllHunks,
      onDiffScroll,
      onStructureScroll,
      onDepsStructureScroll,
      onStructureRowClick,
      onLeftTreeClick,
      onDiffDialogOpened,
      onDiffDialogClosed,
      depsStructureRows,
      depsStructureExpanded,
      depsSelectedDiff,
      depsChangeLines,
      depsViewRows,
      depsMinimapMarks,
      depsLeftDiffPaneRef,
      depsRightDiffPaneRef,
      onDepsDiffScroll,
      onDepsStructureRowClick,
      depsStepChange,
      scrollToDepsRow,
      toggleDepsHunkCollapse,
      openDepsJarMeta,
      startSidebarResize,
      resetSidebarWidth,
      nudgeSidebar,
      toggleFocusMode,
      applySidebarPreset,
      copySelectedPath,
      swapDirPaths,
      swapPickedDirs,
      clearDirPaths,
      clearPickedDirs,
      clearCompareError,
      suggestDirHistory,
      trimDirPaths,
      pickDirectory,
      onDirectoryInputModeChange,
      onDirectoryPicked
    }
  },
  template: `
    <el-container :class="['app-shell', { compact: state.compactMode }]">
      <el-header ref="headerContainerRef" class="app-topbar">
        <div v-if="!state.headerCollapsed" class="app-header">
          <div class="brand" aria-label="工具标题">
            <div class="brand-mark" aria-hidden="true"></div>
            <div class="brand-title">
              <strong>Jar 版本差异比对</strong>
              <span v-if="!state.compactMode">左侧为基准：结构对齐 + 内容左右对照</span>
            </div>
          </div>

          <div class="header-actions" aria-label="顶部操作区">
            <div class="header-row">
              <el-radio-group v-model="state.compareMode" size="small" aria-label="比对模式">
                <el-radio-button label="single">jar包比对</el-radio-button>
                <el-radio-button label="directory">目录比对</el-radio-button>
              </el-radio-group>

              <el-upload
                v-if="state.compareMode==='single'"
                v-model:file-list="leftJar"
                :auto-upload="false"
                :limit="1"
                accept=".jar"
                :show-file-list="false"
              >
                <el-button size="small">选择左侧 jar</el-button>
              </el-upload>
              <div v-if="state.compareMode==='single' && leftJar.length" class="file-pill" title="左侧 jar">
                <span>{{ leftJar[0].name }}</span>
              </div>

              <el-upload
                v-if="state.compareMode==='single'"
                v-model:file-list="rightJar"
                :auto-upload="false"
                :limit="1"
                accept=".jar"
                :show-file-list="false"
              >
                <el-button size="small">选择右侧 jar</el-button>
              </el-upload>
              <div v-if="state.compareMode==='single' && rightJar.length" class="file-pill" title="右侧 jar">
                <span>{{ rightJar[0].name }}</span>
              </div>

              <template v-if="state.compareMode==='directory'">
                <el-radio-group v-model="state.directoryInputMode" size="small" @change="onDirectoryInputModeChange">
                  <el-radio-button label="picker">选择目录</el-radio-button>
                  <el-radio-button label="path">填写路径</el-radio-button>
                </el-radio-group>
                <template v-if="state.directoryInputMode==='picker'">
                <input ref="leftDirInputRef" type="file" webkitdirectory multiple style="display:none;" @change="onDirectoryPicked('left',$event)" />
                <input ref="rightDirInputRef" type="file" webkitdirectory multiple style="display:none;" @change="onDirectoryPicked('right',$event)" />
                <el-button size="small" @click="pickDirectory('left')">选择左侧目录</el-button>
                <div v-if="leftDirFiles.length" class="file-pill"><span>左侧：{{ leftDirPickedPill }}</span></div>
                <el-button size="small" @click="pickDirectory('right')">选择右侧目录</el-button>
                <div v-if="rightDirFiles.length" class="file-pill"><span>右侧：{{ rightDirPickedPill }}</span></div>
                <el-button-group>
                  <el-button size="small" :disabled="!leftDirFiles.length && !rightDirFiles.length" @click="swapPickedDirs">交换</el-button>
                  <el-button size="small" :disabled="!leftDirFiles.length && !rightDirFiles.length" @click="clearPickedDirs">清空</el-button>
                </el-button-group>
                </template>
                <template v-else>
                  <el-autocomplete
                    v-model="state.leftDirPath"
                    :fetch-suggestions="suggestDirHistory"
                    :trigger-on-focus="true"
                    clearable
                    size="small"
                    placeholder="左侧目录路径"
                    style="width:260px;"
                    @blur="trimDirPaths"
                  />
                  <el-autocomplete
                    v-model="state.rightDirPath"
                    :fetch-suggestions="suggestDirHistory"
                    :trigger-on-focus="true"
                    clearable
                    size="small"
                    placeholder="右侧目录路径"
                    style="width:260px;"
                    @blur="trimDirPaths"
                  />
                  <el-button-group>
                    <el-button size="small" :disabled="!state.leftDirPath && !state.rightDirPath" @click="swapDirPaths">交换</el-button>
                    <el-button size="small" :disabled="!state.leftDirPath && !state.rightDirPath" @click="clearDirPaths">清空</el-button>
                  </el-button-group>
                </template>
              </template>
            </div>

            <div class="header-row header-row-actions">
              <el-button
                size="small"
                type="primary"
                :loading="state.isComparing"
                @click="startCompare"
                :disabled="!canCompare"
              >
                开始比对
              </el-button>
              <el-button size="small" @click="state.settingsOpen = true">设置</el-button>
              <el-tag type="info" size="small">{{ compareLimitHint }}</el-tag>
            </div>
          </div>
        </div>

        <div v-else class="app-header app-header-collapsed">
          <div class="brand" aria-label="工具标题">
            <div class="brand-mark" aria-hidden="true"></div>
            <div class="brand-title">
              <strong>Jar 版本差异比对</strong>
            </div>
          </div>
          <div class="header-row">
            <el-button size="small" type="primary" :loading="state.isComparing" @click="startCompare" :disabled="!canCompare">开始比对</el-button>
            <el-button size="small" @click="state.settingsOpen = true">设置</el-button>
            <el-button size="small" @click="state.headerCollapsed = false">展开顶部</el-button>
          </div>
        </div>
      </el-header>

      <el-container class="layout">
        <el-aside v-if="state.compareMode==='single' && !state.focusMode" :width="(state.sidebarCollapsed ? 56 : state.sidebarWidthSingle) + 'px'" :class="['sidebar', { 'is-collapsed': state.sidebarCollapsed }]" aria-label="文件定位区">
          <template v-if="!state.sidebarCollapsed">
          <div class="panel">
            <div class="panel-head">
              <el-input
                v-model="state.search"
                clearable
                size="small"
                placeholder="搜索路径"
                style="flex:1;min-width:180px;"
              />
              <el-radio-group v-model="state.statusFilter" size="small">
                <el-radio-button label="all">全部</el-radio-button>
                <el-radio-button label="modified">修改</el-radio-button>
                <el-radio-button label="added">新增</el-radio-button>
                <el-radio-button label="missing">缺失</el-radio-button>
                <el-radio-button label="meta">元信息</el-radio-button>
              </el-radio-group>
            </div>
            <div class="panel-body">
              <div class="file-list" v-if="state.compareMode==='single' || (state.compareMode==='directory' && state.compareId)">
                <div v-if="changedFiles.length">
                  <el-tabs v-model="state.leftTab" class="left-tabs" stretch>
                    <el-tab-pane :label="'应用（' + groupedChanged.app.length + '）'" name="app"></el-tab-pane>
                    <el-tab-pane v-if="state.compareMode!=='directory'" :label="'依赖（' + dependencyRows.length + '）'" name="deps"></el-tab-pane>
                    <el-tab-pane v-if="groupedChanged.other.length" :label="'其他（' + groupedChanged.other.length + '）'" name="other"></el-tab-pane>
                  </el-tabs>

                  <div v-if="state.leftTab==='app'">
                    <div v-if="appChangedTree.length" style="padding:6px 0;">
                      <el-tree
                        :data="appChangedTree"
                        node-key="key"
                        :expand-on-click-node="false"
                        :highlight-current="true"
                        :current-node-key="state.selectedPath"
                        @node-click="onLeftTreeClick"
                      >
                        <template #default="{ data }">
                          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;width:100%;">
                            <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" :title="data.type==='file' ? data.path : data.label">
                              {{ data.label }}
                            </div>
                            <el-tag v-if="data.type==='file' && data.status" :type="mapStatusBadge(data.status).type" size="small">
                              {{ mapStatusBadge(data.status).text }}
                            </el-tag>
                          </div>
                        </template>
                      </el-tree>
                    </div>
                    <div v-else style="padding:10px;">
                      <el-empty description="应用暂无差异"></el-empty>
                    </div>
                  </div>

                  <div v-else-if="state.leftTab==='deps'">
                    <div
                      v-for="r in dependencyRows"
                      :key="r.jarPath"
                      class="file-item"
                      :class="{ active: state.selectedPath===r.jarPath || (state.selectedPath && state.selectedPath.startsWith(r.jarPath + '!/')) }"
                      @click="openDependencyDialog(r)"
                      role="button"
                      tabindex="0"
                    >
                      <div class="file-path mono" :title="r.jarPath">{{ jarDisplayName(r.jarPath) }}</div>
                      <div style="display:flex;align-items:center;gap:8px;flex:0 0 auto;">
                        <el-tag v-if="r.status" :type="mapStatusBadge(r.status).type" size="small">{{ mapStatusBadge(r.status).text }}</el-tag>
                        <el-button size="small" type="primary" @click.stop="openDependencyDialog(r)">查看</el-button>
                      </div>
                    </div>
                    <div v-if="!dependencyRows.length" style="padding:10px;">
                      <el-empty description="依赖暂无差异"></el-empty>
                    </div>
                  </div>

                  <div v-else>
                    <div v-if="otherChangedTree.length" style="padding:6px 0;">
                      <el-tree
                        :data="otherChangedTree"
                        node-key="key"
                        :expand-on-click-node="false"
                        :highlight-current="true"
                        :current-node-key="state.selectedPath"
                        @node-click="onLeftTreeClick"
                      >
                        <template #default="{ data }">
                          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;width:100%;">
                            <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" :title="data.type==='file' ? data.path : data.label">
                              {{ data.label }}
                            </div>
                            <el-tag v-if="data.type==='file' && data.status" :type="mapStatusBadge(data.status).type" size="small">
                              {{ mapStatusBadge(data.status).text }}
                            </el-tag>
                          </div>
                        </template>
                      </el-tree>
                    </div>
                    <div v-else style="padding:10px;">
                      <el-empty description="其他暂无差异"></el-empty>
                    </div>
                  </div>
                </div>

                <div v-else style="padding:10px;">
                  <el-empty :description="state.compareId ? '暂无差异' : '请先完成一次比对'"></el-empty>
                </div>
              </div>

            </div>
          </div>
          </template>
          <template v-else>
            <div class="sidebar-rail" aria-label="侧栏收起">
              <el-button size="small" type="primary" style="width:100%;" @click="toggleSidebarCollapsed(false)">展开</el-button>
              <div class="rail-section">
                <el-tooltip content="应用" placement="right">
                  <el-button size="small" style="width:100%;" @click="openSidebarAndSelectTab('app')">应 {{ groupedChanged.app.length }}</el-button>
                </el-tooltip>
                <el-tooltip v-if="state.compareMode!=='directory'" content="依赖" placement="right">
                  <el-button size="small" style="width:100%;" @click="openSidebarAndSelectTab('deps')">依 {{ dependencyRows.length }}</el-button>
                </el-tooltip>
                <el-tooltip v-if="groupedChanged.other.length" content="其他" placement="right">
                  <el-button size="small" style="width:100%;" @click="openSidebarAndSelectTab('other')">其 {{ groupedChanged.other.length }}</el-button>
                </el-tooltip>
              </div>
            </div>
          </template>
        </el-aside>

        <el-aside v-if="state.compareMode==='directory' && !state.focusMode" :width="(state.sidebarCollapsed ? 56 : state.sidebarWidthDirectory) + 'px'" :class="['sidebar', { 'is-collapsed': state.sidebarCollapsed }]" aria-label="目录定位区">
          <template v-if="!state.sidebarCollapsed">
          <div class="panel">
            <div class="panel-head">
              <el-input
                v-model="state.search"
                clearable
                size="small"
                placeholder="搜索目录或文件名"
                style="flex:1;min-width:180px;"
              />
              <el-radio-group v-model="state.statusFilter" size="small">
                <el-radio-button label="all">全部</el-radio-button>
                <el-radio-button label="modified">修改</el-radio-button>
                <el-radio-button label="added">新增</el-radio-button>
                <el-radio-button label="missing">缺失</el-radio-button>
                <el-radio-button label="meta">元信息</el-radio-button>
              </el-radio-group>
            </div>

            <div class="panel-body">
              <div class="file-list" v-if="state.compareId">
                <div v-if="changedFiles.length">
                  <el-tabs v-model="state.directoryLeftTab" class="left-tabs" stretch>
                    <el-tab-pane label="目录维度" name="dir"></el-tab-pane>
                    <el-tab-pane :label="'文件清单（' + changedFiles.length + '）'" name="list"></el-tab-pane>
                  </el-tabs>

                  <div v-if="state.directoryLeftTab==='dir'">
                    <div style="padding:6px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                      <span style="font-size:12px;color:var(--muted);">目录层级</span>
                      <el-input-number v-model="state.dirGroupDepth" :min="1" :max="6" size="small" controls-position="right" style="width:110px;" />
                      <el-tag type="info" size="small">热榜默认 5 条</el-tag>
                    </div>

                    <el-divider content-position="left">目录热榜</el-divider>
                    <div v-if="directoryHotlist.length" style="display:flex;flex-direction:column;gap:6px;">
                      <div
                        v-for="d in directoryHotlist.slice(0,5)"
                        :key="d.key"
                        class="file-item"
                        style="display:flex;align-items:center;justify-content:space-between;gap:10px;"
                        role="button"
                        tabindex="0"
                        @click="onDirectoryHotItemClick(d)"
                        @keydown.enter.prevent="onDirectoryHotItemClick(d)"
                        @keydown.space.prevent="onDirectoryHotItemClick(d)"
                        :title="d.title"
                      >
                        <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" class="mono">{{ d.title }}</div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                          <el-tag v-if="d.stats.modified" type="warning" size="small">改 {{ d.stats.modified }}</el-tag>
                          <el-tag v-if="d.stats.meta" type="info" size="small">元 {{ d.stats.meta }}</el-tag>
                          <el-tag v-if="d.stats.added" type="success" size="small">新 {{ d.stats.added }}</el-tag>
                          <el-tag v-if="d.stats.missing" type="danger" size="small">缺 {{ d.stats.missing }}</el-tag>
                          <el-tag type="info" size="small">共 {{ d.count }}</el-tag>
                        </div>
                      </div>
                    </div>
                    <div v-else style="padding:10px 0;">
                      <el-empty description="暂无目录热榜"></el-empty>
                    </div>

                    <el-divider content-position="left">目录树摘要</el-divider>
                    <div v-if="directorySummaryTree.length" style="padding:6px 0;">
                      <el-tree :data="directorySummaryTree" node-key="key" :expand-on-click-node="false" @node-click="onDirectorySummaryNodeClick">
                        <template #default="{ data }">
                          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;width:100%;">
                            <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" :title="data.query">{{ data.label }}</div>
                            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                              <el-tag v-if="data.stats && data.stats.modified" type="warning" size="small">改 {{ data.stats.modified }}</el-tag>
                              <el-tag v-if="data.stats && data.stats.meta" type="info" size="small">元 {{ data.stats.meta }}</el-tag>
                              <el-tag v-if="data.stats && data.stats.added" type="success" size="small">新 {{ data.stats.added }}</el-tag>
                              <el-tag v-if="data.stats && data.stats.missing" type="danger" size="small">缺 {{ data.stats.missing }}</el-tag>
                              <el-tag type="info" size="small">共 {{ data.total }}</el-tag>
                            </div>
                          </div>
                        </template>
                      </el-tree>
                    </div>
                    <div v-else style="padding:10px 0;">
                      <el-empty description="暂无目录摘要"></el-empty>
                    </div>
                  </div>

                  <div v-else>
                    <div v-if="directoryChangedTree.length" style="padding:6px 0;">
                      <el-tree
                        :data="directoryChangedTree"
                        node-key="key"
                        :expand-on-click-node="false"
                        :highlight-current="true"
                        :current-node-key="state.selectedPath"
                        @node-click="onLeftTreeClick"
                      >
                        <template #default="{ data }">
                          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;width:100%;">
                            <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" :title="data.type==='file' || data.type==='jar' ? data.path : data.label">
                              {{ data.label }}
                            </div>
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                              <el-tag v-if="data.type==='jar' && data.innerChanged" type="info" size="small">内 {{ data.innerChanged }}</el-tag>
                              <el-tag v-if="(data.type==='file' || data.type==='jar') && data.status" :type="mapStatusBadge(data.status).type" size="small">
                                {{ mapStatusBadge(data.status).text }}
                              </el-tag>
                            </div>
                          </div>
                        </template>
                      </el-tree>
                    </div>
                    <div v-else style="padding:10px;">
                      <el-empty description="暂无差异"></el-empty>
                    </div>
                  </div>
                </div>

                <div v-else style="padding:10px;">
                  <el-empty :description="state.compareId ? '暂无差异' : '请先完成一次比对'"></el-empty>
                </div>
              </div>

              <div v-else style="padding:10px;">
                <el-empty description="请先完成一次比对"></el-empty>
              </div>
            </div>
          </div>
          </template>
          <template v-else>
            <div class="sidebar-rail" aria-label="侧栏收起">
              <el-button size="small" type="primary" style="width:100%;" @click="toggleSidebarCollapsed(false)">展开</el-button>
              <div class="rail-section">
                <el-tooltip content="目录维度" placement="right">
                  <el-button size="small" style="width:100%;" @click="openSidebarAndSelectTab('dir')">目</el-button>
                </el-tooltip>
                <el-tooltip content="文件清单" placement="right">
                  <el-button size="small" style="width:100%;" @click="openSidebarAndSelectTab('list')">单 {{ changedFiles.length }}</el-button>
                </el-tooltip>
              </div>
            </div>
          </template>
        </el-aside>

        <el-aside
          v-if="!state.focusMode && !state.sidebarCollapsed && (state.compareMode==='single' || state.compareMode==='directory')"
          width="8px"
          class="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          tabindex="0"
          @mousedown.prevent="startSidebarResize"
          @dblclick="resetSidebarWidth"
          @keydown.left.prevent="nudgeSidebar(-12)"
          @keydown.right.prevent="nudgeSidebar(12)"
        ></el-aside>

        <el-main class="content" aria-label="差异阅读区">
          <div class="viewer">
            <div class="viewer-bar">
              <div class="path-input">
                <el-input :model-value="state.selectedPath" readonly size="small" placeholder="选择左侧差异文件" />
                <el-button size="small" :disabled="!state.selectedPath" @click="copySelectedPath">复制路径</el-button>
                <template v-if="!state.focusMode">
                  <el-tag v-if="selectedInfo.source" type="info" size="small">{{ selectedInfo.source==='deps' ? '依赖' : (selectedInfo.source==='app' ? '应用' : '其他') }}</el-tag>
                  <el-tag v-if="selectedInfo.status" :type="mapStatusBadge(selectedInfo.status).type" size="small">{{ mapStatusBadge(selectedInfo.status).text }}</el-tag>
                  <el-tag v-if="state.diffLoading" type="warning" size="small">加载中…</el-tag>
                  <el-tag
                    v-if="state.compareId && state.warmupTotal"
                    :type="state.warmupRunning ? 'warning' : (state.warmupFailed ? 'danger' : 'success')"
                    size="small"
                  >
                    预加载 {{ state.warmupDone }}/{{ state.warmupTotal }}<span v-if="state.warmupFailed">（失败 {{ state.warmupFailed }}）</span>
                  </el-tag>
                  <el-tag v-if="state.leftJarMd5" class="md5-tag" type="info" size="small">左 MD5：<span class="mono md5">{{ state.leftJarMd5 }}</span></el-tag>
                  <el-tag v-if="state.rightJarMd5" class="md5-tag" type="info" size="small">右 MD5：<span class="mono md5">{{ state.rightJarMd5 }}</span></el-tag>
                </template>
              </div>
              <div class="viewer-actions">
                <el-popover v-if="!state.focusMode" trigger="click" width="260">
                  <div style="display:flex;flex-direction:column;gap:10px;">
                    <el-switch v-model="state.sidebarCollapsed" size="small" active-text="侧栏收起" inactive-text="侧栏展开" />
                    <el-switch v-model="state.compactMode" size="small" active-text="紧凑" inactive-text="舒适" />
                    <el-switch v-model="state.headerCollapsed" size="small" active-text="收起顶部" inactive-text="展开顶部" />
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                      <el-button size="small" @click="applySidebarPreset('narrow')">侧栏偏窄</el-button>
                      <el-button size="small" @click="applySidebarPreset('balanced')">平衡</el-button>
                      <el-button size="small" @click="applySidebarPreset('wide')">侧栏偏宽</el-button>
                    </div>
                  </div>
                  <template #reference>
                    <el-button size="small">布局</el-button>
                  </template>
                </el-popover>

                <el-popover v-if="state.focusMode" trigger="click" width="360">
                  <div style="display:flex;flex-direction:column;gap:12px;">
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                      <el-tag v-if="selectedInfo.source" type="info" size="small">{{ selectedInfo.source==='deps' ? '依赖' : (selectedInfo.source==='app' ? '应用' : '其他') }}</el-tag>
                      <el-tag v-if="selectedInfo.status" :type="mapStatusBadge(selectedInfo.status).type" size="small">{{ mapStatusBadge(selectedInfo.status).text }}</el-tag>
                      <el-tag v-if="state.diffLoading" type="warning" size="small">加载中…</el-tag>
                      <el-tag
                        v-if="state.compareId && state.warmupTotal"
                        :type="state.warmupRunning ? 'warning' : (state.warmupFailed ? 'danger' : 'success')"
                        size="small"
                      >
                        预加载 {{ state.warmupDone }}/{{ state.warmupTotal }}<span v-if="state.warmupFailed">（失败 {{ state.warmupFailed }}）</span>
                      </el-tag>
                      <el-tag v-if="state.leftJarMd5" class="md5-tag" type="info" size="small">左 MD5：<span class="mono md5">{{ state.leftJarMd5 }}</span></el-tag>
                      <el-tag v-if="state.rightJarMd5" class="md5-tag" type="info" size="small">右 MD5：<span class="mono md5">{{ state.rightJarMd5 }}</span></el-tag>
                    </div>

                    <el-divider content-position="left">布局</el-divider>
                    <el-switch v-model="state.compactMode" size="small" active-text="紧凑" inactive-text="舒适" />
                    <el-switch v-model="state.headerCollapsed" size="small" active-text="收起顶部" inactive-text="展开顶部" />
                  </div>
                  <template #reference>
                    <el-button size="small">信息</el-button>
                  </template>
                </el-popover>

                <el-switch v-model="state.focusMode" size="small" active-text="专注" inactive-text="普通" />

                <el-tabs v-model="state.viewMode" class="viewer-tabs" type="card">
                  <el-tab-pane label="结构" name="structure"></el-tab-pane>
                  <el-tab-pane label="内容" name="content"></el-tab-pane>
                  <el-tab-pane label="摘要" name="summary"></el-tab-pane>
                  <el-tab-pane v-if="state.compareMode!=='directory'" label="依赖" name="deps"></el-tab-pane>
                </el-tabs>

                <template v-if="state.viewMode==='content'">
                  <el-button size="small" :disabled="!changeLines.length" @click="stepChange(-1)">上一处</el-button>
                  <el-button size="small" :disabled="!changeLines.length" @click="stepChange(1)">下一处</el-button>
                  <el-popover trigger="click" width="220">
                    <div style="display:flex;flex-direction:column;gap:10px;">
                      <el-switch v-model="state.syncScroll" size="small" active-text="同步滚动" inactive-text="独立滚动" />
                      <el-switch v-model="state.wrapLines" size="small" active-text="自动换行" inactive-text="不换行" />
                      <el-switch v-model="state.showDiffOnly" size="small" active-text="仅差异" inactive-text="全文" />
                      <el-button size="small" :disabled="!state.selectedPath || state.diffLoading" @click="openDiffDialog(state.selectedPath)">全屏</el-button>
                    </div>
                    <template #reference>
                      <el-button size="small">阅读</el-button>
                    </template>
                  </el-popover>
                </template>
              </div>
            </div>

            <div v-if="state.compareError" style="padding:10px;border-bottom:1px solid var(--border);">
              <el-alert type="error" title="比对失败" :description="state.compareError" show-icon @close="clearCompareError" />
            </div>

            <div v-if="state.isComparing" style="padding:10px;border-bottom:1px solid var(--border);">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
                <el-tag v-if="state.compareStage" type="warning" size="small">{{ state.compareStage }}</el-tag>
                <span v-if="state.compareDetail" class="mono" style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">{{ state.compareDetail }}</span>
              </div>
              <el-progress :percentage="state.percent" :stroke-width="10" :status="compareProgressStatus" />
            </div>

              <div v-if="state.viewMode==='content'" style="flex:1;overflow:hidden;display:flex;flex-direction:column;">
                <div v-if="state.diffLoading" style="padding:10px;flex:1;overflow:auto;">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                    <el-tag type="warning" size="small">正在加载差异</el-tag>
                    <span class="mono" style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">{{ state.diffLoadingPath }}</span>
                  </div>
                  <div style="margin-top:10px;">
                    <el-skeleton :rows="10" animated />
                  </div>
                </div>

              <div v-else-if="!selectedDiff" style="padding:10px;flex:1;overflow:auto;">
                  <el-alert v-if="state.diffError" type="error" :closable="false" title="差异加载失败" :description="state.diffError" show-icon />
                  <el-empty v-else :description="state.compareId ? '请从左侧变化列表或结构视图点击文件查看差异' : '请先完成一次比对'"></el-empty>
                </div>

                <div v-else-if="selectedDiff.kind==='binary'" style="padding:10px;flex:1;overflow:auto;">
                  <el-alert type="info" :closable="false" title="二进制/非文本差异" :description="selectedDiff.message" show-icon />
                  <div style="margin-top:10px;">
                    <el-descriptions :column="2" size="small" border>
                      <el-descriptions-item label="类型">{{ selectedDiff.fileType || 'binary' }}</el-descriptions-item>
                      <el-descriptions-item label="嵌套">{{ selectedDiff.nested ? '是' : '否' }}</el-descriptions-item>
                      <el-descriptions-item label="容器" v-if="selectedDiff.nested"><span class="mono">{{ selectedDiff.containerEntry }}</span></el-descriptions-item>
                      <el-descriptions-item label="内部路径" v-if="selectedDiff.nested"><span class="mono">{{ selectedDiff.innerPath }}</span></el-descriptions-item>
                    </el-descriptions>
                  </div>
                  <div style="margin-top:10px;">
                    <el-descriptions :column="2" size="small" border>
                      <el-descriptions-item label="左 size">{{ selectedDiff.leftMeta && selectedDiff.leftMeta.size!=null ? selectedDiff.leftMeta.size : '—' }}</el-descriptions-item>
                      <el-descriptions-item label="右 size">{{ selectedDiff.rightMeta && selectedDiff.rightMeta.size!=null ? selectedDiff.rightMeta.size : '—' }}</el-descriptions-item>
                      <el-descriptions-item label="左 MD5"><span class="mono">{{ selectedDiff.leftMeta && selectedDiff.leftMeta.md5 ? selectedDiff.leftMeta.md5 : '—' }}</span></el-descriptions-item>
                      <el-descriptions-item label="右 MD5"><span class="mono">{{ selectedDiff.rightMeta && selectedDiff.rightMeta.md5 ? selectedDiff.rightMeta.md5 : '—' }}</span></el-descriptions-item>
                      <el-descriptions-item label="左 CRC32"><span class="mono">{{ selectedDiff.leftMeta && selectedDiff.leftMeta.crc32!=null ? selectedDiff.leftMeta.crc32 : '—' }}</span></el-descriptions-item>
                      <el-descriptions-item label="右 CRC32"><span class="mono">{{ selectedDiff.rightMeta && selectedDiff.rightMeta.crc32!=null ? selectedDiff.rightMeta.crc32 : '—' }}</span></el-descriptions-item>
                    </el-descriptions>
                  </div>
                </div>

                <div v-else :class="['diff-view', state.wrapLines ? 'wrap-lines' : '']" style="flex:1;">
                  <div v-if="selectedDiff && selectedDiff.fileType==='class' && selectedDiff.classSummary" style="padding:10px;border-bottom:1px solid var(--border);background:#fff;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                      <strong style="font-size:12px;">类签名摘要</strong>
                      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                        <el-tag type="success" size="small">字段新增：{{ selectedDiff.classSummary.addedFields }}</el-tag>
                        <el-tag type="danger" size="small">字段缺失：{{ selectedDiff.classSummary.removedFields }}</el-tag>
                        <el-tag type="success" size="small">方法新增：{{ selectedDiff.classSummary.addedMethods }}</el-tag>
                        <el-tag type="danger" size="small">方法缺失：{{ selectedDiff.classSummary.removedMethods }}</el-tag>
                      </div>
                    </div>
                    <div v-if="(selectedDiff.classSummary.sampleAdded && selectedDiff.classSummary.sampleAdded.length) || (selectedDiff.classSummary.sampleRemoved && selectedDiff.classSummary.sampleRemoved.length)" style="margin-top:8px;">
                      <el-collapse>
                        <el-collapse-item title="查看样例" name="1">
                          <div v-if="selectedDiff.classSummary.sampleAdded && selectedDiff.classSummary.sampleAdded.length">
                            <div style="color:var(--muted);font-size:12px;margin-bottom:4px;">新增（最多展示一部分）</div>
                            <div v-for="(s,idx) in selectedDiff.classSummary.sampleAdded" :key="'a'+idx" class="mono" style="font-size:12px;padding:2px 0;">{{ s }}</div>
                          </div>
                          <div v-if="selectedDiff.classSummary.sampleRemoved && selectedDiff.classSummary.sampleRemoved.length" style="margin-top:8px;">
                            <div style="color:var(--muted);font-size:12px;margin-bottom:4px;">缺失（最多展示一部分）</div>
                            <div v-for="(s,idx) in selectedDiff.classSummary.sampleRemoved" :key="'r'+idx" class="mono" style="font-size:12px;padding:2px 0;">{{ s }}</div>
                          </div>
                        </el-collapse-item>
                      </el-collapse>
                    </div>
                  </div>
                  <div class="diff-sbs">
                    <div class="diff-pane">
                      <div class="diff-pane-head">
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">左侧基准</span>
                        <el-tag v-if="state.syncScroll" type="info" size="small">同步</el-tag>
                      </div>
                      <div class="diff-pane-body left" ref="mainLeftDiffPaneRef" @scroll="onDiffScroll('left', $event)">
                        <template v-for="row in viewRows" :key="row.kind==='row' ? 'r'+row.rowIndex : 'rg'+row.from">
                          <div v-if="row.kind==='gap'" class="diff-gap">… 省略 {{ row.count }} 行 …</div>
                          <div v-if="row.kind!=='gap'" class="diff-line" :data-row-index="row.rowIndex">
                            <div class="diff-ln">{{ row.leftNo ? String(row.leftNo).padStart(4,' ') : '' }}</div>
                            <div :class="['diff-code', 'line', row.leftType, row.isActive ? 'active' : '']">{{ row.leftText }}</div>
                          </div>
                        </template>
                      </div>
                    </div>

                    <div class="diff-pane">
                      <div class="diff-pane-head">
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">右侧目标</span>
                        <el-tag v-if="selectedDiff.missingRight" type="danger" size="small">缺失</el-tag>
                      </div>
                      <div class="diff-pane-body right" ref="mainRightDiffPaneRef" @scroll="onDiffScroll('right', $event)">
                        <template v-for="row in viewRows" :key="row.kind==='row' ? 'r'+row.rowIndex : 'rg'+row.from">
                          <div v-if="row.kind==='gap'" class="diff-gap">… 省略 {{ row.count }} 行 …</div>
                          <div v-if="row.kind!=='gap'" class="diff-line" :data-row-index="row.rowIndex">
                            <div class="diff-ln">{{ row.rightNo ? String(row.rightNo).padStart(4,' ') : '' }}</div>
                            <div :class="['diff-code', 'line', row.rightType, row.isActive ? 'active' : '']">{{ row.rightText }}</div>
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            <div v-if="state.viewMode==='structure'" ref="structureScrollRef" class="structure-compare" @scroll="onStructureScroll">
              <div class="structure-compare-head">
                <strong style="font-size:12px;">结构对齐视图（左侧为基准）</strong>
                <div style="display:inline-flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                  <el-tag type="warning" size="small">修改：{{ structureStats.modified }}</el-tag>
                  <el-tag type="info" size="small">元信息：{{ structureStats.meta }}</el-tag>
                  <el-tag type="success" size="small">新增：{{ structureStats.added }}</el-tag>
                  <el-tag type="danger" size="small">缺失：{{ structureStats.missing }}</el-tag>
                </div>
              </div>
              <div class="structure-compare-cols" aria-hidden="true">
                <div>左侧基准</div>
                <div class="mid"></div>
                <div>右侧目标</div>
              </div>
              <div class="structure-tree-wrap">
                <div v-if="structureRows.length" style="display:flex;flex-direction:column;gap:2px;">
                  <div
                    v-for="r in structureRows"
                    :key="r.key"
                    class="structure-row"
                    role="button"
                    tabindex="0"
                    :data-node-key="r.key"
                    @click="onStructureRowClick(r.node)"
                  >
                    <div
                      class="structure-cell left"
                      :class="[(r.status ? ('s-' + r.status) : ''), !r.leftExists ? 'structure-placeholder' : '']"
                      :title="r.node.displayTitle || r.node.value"
                      :style="{ paddingLeft: (r.depth * 14) + 'px' }"
                    >
                      <span v-if="(r.node.type==='dir' || r.node.type==='jar') && r.node.children && r.node.children.length" style="width:14px;display:inline-flex;justify-content:center;color:#6b7280;">
                        {{ structureExpanded[r.key] ? '▾' : '▸' }}
                      </span>
                      <span v-else style="width:14px;display:inline-flex;justify-content:center;color:#9ca3af;">•</span>
                      <span v-if="r.node.type==='dir' || r.node.type==='jar'" class="structure-icon">📁</span>
                      <span v-else class="structure-icon">📄</span>
                      <span class="structure-label">{{ r.node.displayLabel || r.node.label }}</span>
                    </div>
                    <div class="structure-gutter"></div>
                    <div
                      class="structure-cell right"
                      :class="[(r.status ? ('s-' + r.status) : ''), !r.rightExists ? 'structure-placeholder' : '']"
                      :title="r.node.displayTitle || r.node.value"
                      :style="{ paddingLeft: (r.depth * 14) + 'px' }"
                    >
                      <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                        <span v-if="(r.node.type==='dir' || r.node.type==='jar') && r.node.children && r.node.children.length" style="width:14px;display:inline-flex;justify-content:center;color:#6b7280;">
                          {{ structureExpanded[r.key] ? '▾' : '▸' }}
                        </span>
                        <span v-else style="width:14px;display:inline-flex;justify-content:center;color:#9ca3af;">•</span>
                        <span v-if="r.node.type==='dir' || r.node.type==='jar'" class="structure-icon">📁</span>
                        <span v-else class="structure-icon">📄</span>
                        <span class="structure-label">{{ r.node.displayLabel || r.node.label }}</span>
                      </div>
                      <el-tag
                        v-if="(r.node.type==='file' || r.node.type==='jar') && r.node.rightStatus && r.node.rightStatus!=='unchanged'"
                        :type="mapStructureBadge('right', r.node.rightStatus).type"
                        size="small"
                      >
                        {{ mapStructureBadge('right', r.node.rightStatus).text }}
                      </el-tag>
                    </div>
                  </div>
                </div>
                <div v-else style="padding:10px;">
                  <el-empty :description="state.compareId ? '结构视图暂无差异' : '请先完成一次比对'"></el-empty>
                </div>
              </div>
            </div>

            <div v-if="state.viewMode==='summary'" style="padding:10px;flex:1;overflow:auto;">
              <el-empty v-if="!state.compareId" description="请先完成一次比对"></el-empty>
              <template v-else>
              <el-row :gutter="10">
                <el-col :span="state.compareMode==='directory' ? 12 : 8">
                  <el-card shadow="never">
                    <template #header><span>应用变更</span></template>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                      <el-tag type="warning" size="small">修改：{{ summaryModel.total.app.modified }}</el-tag>
                      <el-tag type="info" size="small">元信息：{{ summaryModel.total.app.meta }}</el-tag>
                      <el-tag type="success" size="small">新增：{{ summaryModel.total.app.added }}</el-tag>
                      <el-tag type="danger" size="small">缺失：{{ summaryModel.total.app.missing }}</el-tag>
                    </div>
                  </el-card>
                </el-col>
                <el-col v-if="state.compareMode!=='directory'" :span="8">
                  <el-card shadow="never">
                    <template #header><span>依赖变更</span></template>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                      <el-tag type="warning" size="small">修改：{{ summaryModel.total.deps.modified }}</el-tag>
                      <el-tag type="info" size="small">元信息：{{ summaryModel.total.deps.meta }}</el-tag>
                      <el-tag type="success" size="small">新增：{{ summaryModel.total.deps.added }}</el-tag>
                      <el-tag type="danger" size="small">缺失：{{ summaryModel.total.deps.missing }}</el-tag>
                    </div>
                  </el-card>
                </el-col>
                <el-col :span="state.compareMode==='directory' ? 12 : 8">
                  <el-card shadow="never">
                    <template #header><span>其他</span></template>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                      <el-tag type="warning" size="small">修改：{{ summaryModel.total.other.modified }}</el-tag>
                      <el-tag type="info" size="small">元信息：{{ summaryModel.total.other.meta }}</el-tag>
                      <el-tag type="success" size="small">新增：{{ summaryModel.total.other.added }}</el-tag>
                      <el-tag type="danger" size="small">缺失：{{ summaryModel.total.other.missing }}</el-tag>
                    </div>
                  </el-card>
                </el-col>
              </el-row>

              <el-row :gutter="10" style="margin-top:10px;">
                <el-col :span="12">
                  <el-card shadow="never">
                    <template #header><span>{{ state.compareMode==='directory' ? 'Top 变化目录' : 'Top 变化目录（应用）' }}</span></template>
                    <el-table :data="summaryModel.topChangedDirs" size="small" border style="width:100%;">
                      <el-table-column prop="dir" label="目录" min-width="260" />
                      <el-table-column prop="count" label="数量" width="90" />
                    </el-table>
                  </el-card>
                </el-col>
                <el-col :span="12">
                  <el-card shadow="never">
                    <template #header><span>风险提示</span></template>
                    <div v-if="!summaryModel.findings.length" style="padding:4px 0;color:var(--muted);font-size:12px;">暂无明显风险提示</div>
                    <div v-else style="display:flex;flex-direction:column;gap:8px;">
                      <el-alert
                        v-for="(f,idx) in summaryModel.findings"
                        :key="idx"
                        :type="f.level==='warn' ? 'warning' : (f.level==='info' ? 'info' : 'success')"
                        :closable="false"
                        :title="f.title"
                        :description="f.desc"
                        show-icon
                      />
                    </div>
                  </el-card>
                </el-col>
              </el-row>
              </template>
            </div>

            <div v-if="state.viewMode==='deps'" style="padding:10px;flex:1;overflow:auto;">
              <el-alert type="info" :closable="false" title="依赖视图" description="这里按 lib jar 维度聚合差异；点击可打开 jar 的元信息/差异摘要。" show-icon />
              <div style="margin-top:10px;">
                <el-table :data="dependencyRows" size="small" border style="width:100%;">
                  <el-table-column prop="jarPath" label="依赖 jar" min-width="340">
                    <template #default="{ row }"><span class="mono" :title="row.jarPath">{{ jarDisplayName(row.jarPath) }}</span></template>
                  </el-table-column>
                  <el-table-column label="状态" width="90">
                    <template #default="{ row }"><el-tag :type="mapStatusBadge(row.status).type" size="small">{{ mapStatusBadge(row.status).text }}</el-tag></template>
                  </el-table-column>
                  <el-table-column label="操作" width="120">
                    <template #default="{ row }"><el-button size="small" type="primary" @click.stop="openDependencyDialog(row)">查看</el-button></template>
                  </el-table-column>
                </el-table>
                <div v-if="!dependencyRows.length" style="padding:10px;">
                  <el-empty description="依赖暂无差异"></el-empty>
                </div>
              </div>
            </div>

            <el-dialog v-model="state.diffDialogOpen" width="96%" top="3vh" :close-on-click-modal="false" @opened="onDiffDialogOpened" @closed="onDiffDialogClosed">
              <template #header>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;">
                  <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    文件差异：<span class="mono">{{ state.selectedPath }}</span>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
                    <el-tag v-if="state.leftJarMd5" class="md5-tag" type="info" size="small">左 MD5：<span class="mono md5">{{ state.leftJarMd5 }}</span></el-tag>
                    <el-tag v-if="state.rightJarMd5" class="md5-tag" type="info" size="small">右 MD5：<span class="mono md5">{{ state.rightJarMd5 }}</span></el-tag>
                  </div>
                </div>
              </template>

              <div style="height:80vh;display:flex;flex-direction:column;overflow:hidden;">
                <div style="padding:8px 10px;border-bottom:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
                  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                    <el-switch v-model="state.syncScroll" size="small" active-text="同步滚动" inactive-text="独立滚动" />
                    <el-switch v-model="state.wrapLines" size="small" active-text="自动换行" inactive-text="不换行" />
                    <el-switch v-model="state.showDiffOnly" size="small" active-text="仅差异" inactive-text="全文" />
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <el-button size="small" :disabled="!changeLines.length" @click="stepChange(-1)">上一处</el-button>
                    <el-button size="small" :disabled="!changeLines.length" @click="stepChange(1)">下一处</el-button>
                  </div>
                </div>

                <div v-if="state.diffLoading" style="padding:10px;flex:1;overflow:auto;">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                    <el-tag type="warning" size="small">正在加载差异</el-tag>
                    <span class="mono" style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">{{ state.diffLoadingPath }}</span>
                  </div>
                  <div style="margin-top:10px;">
                    <el-skeleton :rows="10" animated />
                  </div>
                </div>

                <div v-else-if="!selectedDiff" style="padding:10px;flex:1;overflow:auto;">
                  <el-alert v-if="state.diffError" type="error" :closable="false" title="差异加载失败" :description="state.diffError" show-icon />
                  <el-empty v-else description="加载差异中或未选择文件"></el-empty>
                </div>

                <div v-if="selectedDiff && selectedDiff.kind==='binary'" style="padding:10px;flex:1;overflow:auto;">
                  <el-alert type="info" :closable="false" title="二进制差异" :description="selectedDiff.message" show-icon />
                </div>

                <div v-if="selectedDiff && selectedDiff.kind!=='binary'" class="diff-view" style="flex:1;">
                  <div class="diff-sbs">
                    <div class="diff-pane">
                      <div class="diff-pane-head">
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">左侧基准</span>
                        <el-tag v-if="state.syncScroll" type="info" size="small">同步</el-tag>
                      </div>
                      <div class="diff-pane-body left" ref="dialogLeftDiffPaneRef" @scroll="onDiffScroll('left', $event)">
                        <template v-for="row in viewRows" :key="row.kind==='row' ? 'r'+row.rowIndex : 'rg'+row.from">
                          <div v-if="row.kind==='gap'" class="diff-gap">… 省略 {{ row.count }} 行 …</div>
                          <div v-if="row.kind!=='gap'" class="diff-line" :data-row-index="row.rowIndex">
                            <div class="diff-ln">{{ row.leftNo ? String(row.leftNo).padStart(4,' ') : '' }}</div>
                            <div :class="['diff-code', state.wrapLines ? 'wrap' : '', 'line', row.leftType, row.isActive ? 'active' : '']">{{ row.leftText }}</div>
                          </div>
                        </template>
                      </div>
                    </div>

                    <div class="diff-pane">
                      <div class="diff-pane-head">
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">右侧目标</span>
                        <el-tag v-if="selectedDiff.missingRight" type="danger" size="small">缺失</el-tag>
                      </div>
                      <div class="diff-pane-body right" ref="dialogRightDiffPaneRef" @scroll="onDiffScroll('right', $event)">
                        <template v-for="row in viewRows" :key="row.kind==='row' ? 'r'+row.rowIndex : 'rg'+row.from">
                          <div v-if="row.kind==='gap'" class="diff-gap">… 省略 {{ row.count }} 行 …</div>
                          <div v-if="row.kind!=='gap'" class="diff-line" :data-row-index="row.rowIndex">
                            <div class="diff-ln">{{ row.rightNo ? String(row.rightNo).padStart(4,' ') : '' }}</div>
                            <div :class="['diff-code', state.wrapLines ? 'wrap' : '', 'line', row.rightType, row.isActive ? 'active' : '']">{{ row.rightText }}</div>
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </el-dialog>

            <el-dialog v-model="state.depsDialogOpen" width="96%" top="3vh" :close-on-click-modal="false">
              <template #header>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;">
                  <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    依赖差异：<span class="mono">{{ jarDisplayName(state.depsJarPath) }}</span>
                    <span style="color:var(--muted);font-size:12px;margin-left:8px;">{{ state.depsJarPath }}</span>
                    <el-tag v-if="state.depsJarStatus" :type="mapStatusBadge(state.depsJarStatus).type" size="small" style="margin-left:8px;">
                      {{ mapStatusBadge(state.depsJarStatus).text }}
                    </el-tag>
                    <el-tag v-if="state.depsInnerChanged" type="info" size="small" style="margin-left:8px;">内部差异：{{ state.depsInnerChanged }}</el-tag>
                  </div>
                </div>
              </template>

              <div style="height:80vh;display:flex;flex-direction:column;overflow:hidden;">
                <div style="padding:8px 10px;border-bottom:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
                  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                    <el-tabs v-model="state.depsViewMode" class="viewer-tabs" type="card">
                      <el-tab-pane label="结构" name="structure"></el-tab-pane>
                      <el-tab-pane label="内容" name="content"></el-tab-pane>
                    </el-tabs>
                  </div>
                  <div v-if="state.depsViewMode==='content'" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
                    <el-tag v-if="state.depsDiffLoading" type="warning" size="small">加载中…</el-tag>
                    <el-switch v-model="state.syncScroll" size="small" active-text="同步滚动" inactive-text="独立滚动" />
                    <el-switch v-model="state.wrapLines" size="small" active-text="自动换行" inactive-text="不换行" />
                    <el-switch v-model="state.showDiffOnly" size="small" active-text="仅差异" inactive-text="全文" />
                    <el-button size="small" :disabled="!depsChangeLines.length" @click="depsStepChange(-1)">上一处</el-button>
                    <el-button size="small" :disabled="!depsChangeLines.length" @click="depsStepChange(1)">下一处</el-button>
                  </div>
                  <div v-else style="display:flex;align-items:center;gap:8px;">
                    <el-button size="small" type="primary" @click="openDepsJarMeta">查看 jar 本体差异</el-button>
                  </div>
                </div>

                <div
                  v-if="state.depsViewMode==='structure'"
                  ref="depsStructureScrollRef"
                  class="structure-compare deps-structure"
                  style="flex:1;min-height:0;"
                  @scroll="onDepsStructureScroll"
                >
                  <div class="structure-compare-cols" aria-hidden="true">
                    <div>左侧基准</div>
                    <div class="mid"></div>
                    <div>右侧目标</div>
                  </div>
                  <div class="structure-tree-wrap">
                <div v-if="state.depsTreeLoading" style="padding:10px;">
                  <el-skeleton :rows="10" animated />
                </div>
                <div v-else-if="state.depsTreeError" style="padding:10px;">
                  <el-alert type="error" :closable="false" title="依赖结构加载失败" :description="state.depsTreeError" show-icon />
                </div>
                <div v-else-if="depsStructureRows.length" style="display:flex;flex-direction:column;gap:2px;">
                      <div
                        v-for="r in depsStructureRows"
                        :key="r.key"
                        class="structure-row"
                        role="button"
                        tabindex="0"
                        @click="onDepsStructureRowClick(r.node)"
                      >
                        <div
                          class="structure-cell left"
                          :class="[(r.status ? ('s-' + r.status) : ''), !r.leftExists ? 'structure-placeholder' : '']"
                          :title="r.node.displayTitle || r.node.value"
                          :style="{ paddingLeft: (r.depth * 14) + 'px' }"
                        >
                          <span v-if="(r.node.type==='dir' || r.node.type==='jar') && r.node.children && r.node.children.length" style="width:14px;display:inline-flex;justify-content:center;color:#6b7280;">
                            {{ depsStructureExpanded[r.key] ? '▾' : '▸' }}
                          </span>
                          <span v-else style="width:14px;display:inline-flex;justify-content:center;color:#9ca3af;">•</span>
                          <span v-if="r.node.type==='dir' || r.node.type==='jar'" class="structure-icon">📁</span>
                          <span v-else class="structure-icon">📄</span>
                          <span class="structure-label">{{ r.node.displayLabel || r.node.label }}</span>
                        </div>
                        <div class="structure-gutter"></div>
                        <div
                          class="structure-cell right"
                          :class="[(r.status ? ('s-' + r.status) : ''), !r.rightExists ? 'structure-placeholder' : '']"
                          :title="r.node.displayTitle || r.node.value"
                          :style="{ paddingLeft: (r.depth * 14) + 'px' }"
                        >
                          <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                            <span v-if="(r.node.type==='dir' || r.node.type==='jar') && r.node.children && r.node.children.length" style="width:14px;display:inline-flex;justify-content:center;color:#6b7280;">
                              {{ depsStructureExpanded[r.key] ? '▾' : '▸' }}
                            </span>
                            <span v-else style="width:14px;display:inline-flex;justify-content:center;color:#9ca3af;">•</span>
                            <span v-if="r.node.type==='dir' || r.node.type==='jar'" class="structure-icon">📁</span>
                            <span v-else class="structure-icon">📄</span>
                            <span class="structure-label">{{ r.node.displayLabel || r.node.label }}</span>
                          </div>
                          <el-tag
                            v-if="(r.node.type==='file' || r.node.type==='jar') && r.node.rightStatus && r.node.rightStatus!=='unchanged'"
                            :type="mapStructureBadge('right', r.node.rightStatus).type"
                            size="small"
                          >
                            {{ mapStructureBadge('right', r.node.rightStatus).text }}
                          </el-tag>
                        </div>
                      </div>
                    </div>
                    <div v-else style="padding:10px;">
                      <el-empty description="未开启依赖深度比对，暂无内部结构差异"></el-empty>
                    </div>
                  </div>
                </div>

                <div v-if="state.depsViewMode==='content'" style="flex:1;overflow:hidden;display:flex;flex-direction:column;">
                  <div v-if="state.depsDiffLoading" style="padding:10px;flex:1;overflow:auto;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                      <el-tag type="warning" size="small">正在加载差异</el-tag>
                      <span class="mono" style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">{{ state.depsDiffLoadingPath }}</span>
                    </div>
                    <div style="margin-top:10px;">
                      <el-skeleton :rows="10" animated />
                    </div>
                  </div>

                  <div v-else-if="!depsSelectedDiff" style="padding:10px;flex:1;overflow:auto;">
                    <el-alert v-if="state.depsDiffError" type="error" :closable="false" title="差异加载失败" :description="state.depsDiffError" show-icon />
                    <el-empty v-else description="请选择结构中的文件或查看 jar 本体差异"></el-empty>
                  </div>

                  <div v-else-if="depsSelectedDiff.kind==='binary'" style="padding:10px;flex:1;overflow:auto;">
                    <el-alert type="info" :closable="false" title="二进制/非文本差异" :description="depsSelectedDiff.message" show-icon />
                  </div>

                  <div v-else class="diff-view" style="flex:1;">
                    <div class="diff-sbs">
                      <div class="diff-pane">
                        <div class="diff-pane-head">
                          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">左侧基准</span>
                          <el-tag v-if="state.syncScroll" type="info" size="small">同步</el-tag>
                        </div>
                        <div class="diff-pane-body left" ref="depsLeftDiffPaneRef" @scroll="onDepsDiffScroll('left', $event)">
                          <template v-for="row in depsViewRows" :key="row.kind==='row' ? 'dr'+row.rowIndex : 'drg'+row.from">
                            <div v-if="row.kind==='gap'" class="diff-gap">… 省略 {{ row.count }} 行 …</div>
                            <div v-if="row.kind!=='gap'" class="diff-line" :data-row-index="row.rowIndex">
                              <div class="diff-ln">{{ row.leftNo ? String(row.leftNo).padStart(4,' ') : '' }}</div>
                              <div :class="['diff-code', state.wrapLines ? 'wrap' : '', 'line', row.leftType, row.isActive ? 'active' : '']">{{ row.leftText }}</div>
                            </div>
                          </template>
                        </div>
                      </div>

                      <div class="diff-pane">
                        <div class="diff-pane-head">
                          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">右侧目标</span>
                          <el-tag v-if="depsSelectedDiff.missingRight" type="danger" size="small">缺失</el-tag>
                        </div>
                        <div class="diff-pane-body right" ref="depsRightDiffPaneRef" @scroll="onDepsDiffScroll('right', $event)">
                          <template v-for="row in depsViewRows" :key="row.kind==='row' ? 'dr'+row.rowIndex : 'drg'+row.from">
                            <div v-if="row.kind==='gap'" class="diff-gap">… 省略 {{ row.count }} 行 …</div>
                            <div v-if="row.kind!=='gap'" class="diff-line" :data-row-index="row.rowIndex">
                              <div class="diff-ln">{{ row.rightNo ? String(row.rightNo).padStart(4,' ') : '' }}</div>
                              <div :class="['diff-code', state.wrapLines ? 'wrap' : '', 'line', row.rightType, row.isActive ? 'active' : '']">{{ row.rightText }}</div>
                            </div>
                          </template>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </el-dialog>

          </div>

          <el-drawer v-model="state.settingsOpen" title="比对设置" size="360px">
            <el-form label-position="top">
              <el-divider content-position="left">范围</el-divider>
              <el-checkbox v-model="state.includeClasses">对比 classes（.class 等）</el-checkbox>
              <el-checkbox v-model="state.includeResources">对比 resources（配置/资源）</el-checkbox>
              <el-checkbox v-if="state.compareMode!=='directory'" v-model="state.includeLib">对比 lib 依赖（BOOT-INF/lib）</el-checkbox>
              <el-checkbox v-if="state.compareMode!=='directory'" v-model="state.deepCompareLib">依赖 jar 深度比对（可选）</el-checkbox>

              <el-divider content-position="left">上限</el-divider>
              <el-form-item v-if="state.compareMode==='single'" label="单个 jar 上限（MB）">
                <el-input-number
                  v-model="state.limitJarMb"
                  :min="1"
                  :max="state.serverLimits && state.serverLimits.maxJarMb ? state.serverLimits.maxJarMb : 512"
                  controls-position="right"
                  style="width:100%;"
                />
              </el-form-item>
              <el-form-item v-if="state.compareMode==='directory'" label="目录文件数上限（每侧）">
                <el-input-number
                  v-model="state.limitDirFiles"
                  :min="1"
                  :max="state.serverLimits && state.serverLimits.maxDirFiles ? state.serverLimits.maxDirFiles : 20000"
                  controls-position="right"
                  style="width:100%;"
                />
              </el-form-item>
              <el-form-item v-if="state.compareMode==='directory'" label="目录总大小上限（MB/侧）">
                <el-input-number
                  v-model="state.limitDirMb"
                  :min="1"
                  :max="state.serverLimits && state.serverLimits.maxDirMb ? state.serverLimits.maxDirMb : 800"
                  controls-position="right"
                  style="width:100%;"
                />
              </el-form-item>
              <el-form-item label="差异预热数量（条）">
                <el-input-number
                  v-model="state.warmupLimit"
                  :min="0"
                  :max="state.serverLimits && state.serverLimits.maxWarmupDiffs ? state.serverLimits.maxWarmupDiffs : 1200"
                  controls-position="right"
                  style="width:100%;"
                />
                <div style="margin-top:6px;color:var(--muted);font-size:12px;">
                  可直接填写例如 400；填 0 表示自动使用后端默认值（{{ state.serverLimits && state.serverLimits.defaultWarmupDiffs ? state.serverLimits.defaultWarmupDiffs : 400 }}）
                </div>
              </el-form-item>

              <el-divider content-position="left">忽略规则</el-divider>
              <el-form-item label="预置">
                <el-select v-model="state.ignorePreset" size="small" style="width:100%;" @change="applyIgnorePreset">
                  <el-option label="Spring Boot 常见噪音（推荐）" value="springboot" />
                  <el-option label="不忽略" value="none" />
                  <el-option label="自定义" value="custom" />
                </el-select>
              </el-form-item>
              <el-form-item label="规则（glob，每行一条）">
                <el-input v-model="state.ignoreGlobs" type="textarea" :rows="8" placeholder="例如：META-INF/*.SF" />
                <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">
                  <el-button size="small" @click="resetIgnoreToDefault">恢复默认</el-button>
                  <el-tag v-if="ignorePreview.count" type="info" size="small">预览命中：{{ ignorePreview.count }} 条差异</el-tag>
                  <el-tag v-else type="info" size="small">预览命中：0</el-tag>
                </div>
                <div v-if="ignorePreview.samples && ignorePreview.samples.length" style="margin-top:8px;">
                  <el-collapse>
                    <el-collapse-item title="查看命中样例（最多10条）" name="1">
                      <div v-for="(p,idx) in ignorePreview.samples" :key="idx" class="mono" style="font-size:12px;padding:2px 0;">{{ p }}</div>
                      <div style="margin-top:6px;color:var(--muted);font-size:12px;">修改忽略规则后需要重新比对才会生效</div>
                    </el-collapse-item>
                  </el-collapse>
                </div>
              </el-form-item>

              <el-divider content-position="left">显示</el-divider>
              <el-checkbox v-model="state.showNestedJar">结构视图展示内嵌 jar 结构</el-checkbox>
            </el-form>
          </el-drawer>
        </el-main>
      </el-container>
    </el-container>
  `
}

App.template = APP_TEMPLATE

const app = createApp(App)
app.use(ElementPlus)
app.mount('#app')
