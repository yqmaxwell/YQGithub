const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const READY_TIMEOUT_MS = 60000
const KILL_GRACE_MS = 3000

let mainWindow = null
let javaProcess = null
let backendPort = 0
let quitting = false

// 打包后 jar 位于 resources/app 下，开发时直接用 target 目录
function findJar(dir) {
  if (!fs.existsSync(dir)) return null
  const name = fs.readdirSync(dir).find((it) => /^jar-diff-tool-.*\.jar$/.test(it))
  return name ? path.join(dir, name) : null
}

function resolveJarPath() {
  if (app.isPackaged) {
    const packaged = findJar(path.join(process.resourcesPath, 'app'))
    if (packaged) return packaged
  }
  return findJar(path.resolve(__dirname, '..', 'target'))
}

// GUI 应用不继承 shell 的 PATH，macOS 需要经 java_home 查找
function resolveJavaCommand() {
  const candidates = []
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
  }
  if (process.platform === 'darwin') {
    const probe = spawnSync('/usr/libexec/java_home', [], { encoding: 'utf8' })
    if (probe.status === 0 && probe.stdout) {
      candidates.push(path.join(probe.stdout.trim(), 'bin', 'java'))
    }
  }
  candidates.push(process.platform === 'win32' ? 'java.exe' : 'java')
  for (const candidate of candidates) {
    if (candidate === 'java' || candidate === 'java.exe') return candidate
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const jarPath = resolveJarPath()
    if (!jarPath) {
      reject(new Error('未找到 jar-diff-tool 程序包，请先执行 mvn package'))
      return
    }
    const javaCommand = resolveJavaCommand()
    if (!javaCommand) {
      reject(new Error('未找到 Java 运行环境，请安装 JRE 8 或以上版本'))
      return
    }

    // 工作目录放在 userData，避免 logback 往安装目录写日志
    const workDir = app.getPath('userData')
    fs.mkdirSync(workDir, { recursive: true })

    javaProcess = spawn(
      javaCommand,
      ['-Dfile.encoding=UTF-8', '-jar', jarPath, '--server.port=0'],
      { cwd: workDir, windowsHide: true }
    )

    let settled = false
    let stdoutBuffer = ''

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('后端服务启动超时（' + READY_TIMEOUT_MS / 1000 + ' 秒）'))
    }, READY_TIMEOUT_MS)

    javaProcess.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      stdoutBuffer += text
      process.stdout.write('[backend] ' + text)
      const match = stdoutBuffer.match(/Tomcat started on port\(s\): (\d+)/)
      if (match && !settled) {
        settled = true
        clearTimeout(timer)
        backendPort = Number(match[1])
        resolve(backendPort)
      }
    })

    javaProcess.stderr.on('data', (chunk) => {
      process.stderr.write('[backend] ' + chunk.toString('utf8'))
    })

    javaProcess.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('无法启动 Java 进程：' + err.message))
    })

    javaProcess.on('exit', (code) => {
      if (settled && !quitting) {
        dialog.showErrorBox('后端服务已退出', 'Java 进程意外结束，退出码 ' + code)
        app.quit()
        return
      }
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(new Error('Java 进程启动后立即退出，退出码 ' + code))
      }
    })
  })
}

function stopBackend() {
  if (!javaProcess || javaProcess.killed) return
  const pid = javaProcess.pid
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      javaProcess.kill('SIGTERM')
    }
  } catch (err) {
    process.stderr.write('[main] 终止后端失败: ' + err.message + '\n')
  }
}

function forceStopBackend() {
  if (!javaProcess || javaProcess.killed) return
  try {
    javaProcess.kill('SIGKILL')
  } catch (err) {
    process.stderr.write('[main] 强制终止后端失败: ' + err.message + '\n')
  }
}

function registerDialogHandlers() {
  ipcMain.handle('dialog:choose-jar', async (event, title) => {
    return pickPath({
      title: title || '选择 Jar',
      properties: ['openFile'],
      filters: [{ name: 'Jar/Zip/War', extensions: ['jar', 'zip', 'war'] }]
    })
  })

  ipcMain.handle('dialog:choose-directory', async (event, title) => {
    return pickPath({
      title: title || '选择目录',
      properties: ['openDirectory']
    })
  })

  ipcMain.handle('dialog:choose-file', async (event, title) => {
    return pickPath({
      title: title || '选择文件',
      properties: ['openFile']
    })
  })
}

async function pickPath(options) {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Jar 差异比对工具',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.loadURL('http://127.0.0.1:' + backendPort + '/')

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    registerDialogHandlers()
    try {
      await startBackend()
    } catch (err) {
      dialog.showErrorBox('启动失败', err.message)
      app.quit()
      return
    }
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && backendPort) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    stopBackend()
    setTimeout(forceStopBackend, KILL_GRACE_MS)
  })

  app.on('will-quit', () => {
    stopBackend()
  })
}
