package com.example.jardiff;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.concurrent.Worker;
import javafx.scene.Scene;
import javafx.scene.control.Alert;
import javafx.scene.web.WebEngine;
import javafx.scene.web.WebView;
import javafx.stage.Stage;
import netscape.javascript.JSObject;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * 桌面工具入口：启动内嵌 Spring Boot 服务后，用 JavaFX WebView 窗口加载本地前端页面。
 *
 * <p>用法：{@code java -jar jar-diff-tool-1.0.0.jar}，启动后弹出桌面窗口，无需浏览器。
 *
 * <p>端口策略：优先使用配置的 {@code server.port}（默认 8085）；若被占用，从该端口起递增
 * 探测最多 100 个端口，自动选用第一个可用端口，避免启动失败。
 *
 * <p>文件选择：向 WebView 注入 {@link FileBridge}，前端 JS 调 {@code window.jardiffBridge}
 * 弹出原生 FileChooser/DirectoryChooser（JavaFX WebView 默认不处理 &lt;input type=file&gt;）。
 *
 * <p>依赖 Oracle JDK 8 自带的 JavaFX（{@code jre/lib/ext/jfxrt.jar}），无需额外声明依赖。
 */
public class JarDiffLauncher extends Application {

  private static final int DEFAULT_PORT = 8085;
  private static final String PROBE_RANGE_KEY = "jardiff.port.probe-range";
  private static final int DEFAULT_PROBE_RANGE = 100;

  private static String[] cliArgs;
  private ConfigurableApplicationContext springContext;

  private static java.awt.image.BufferedImage APP_ICON;

  public static void main(String[] args) {
    // 尽早生成图标并设置 macOS Dock 图标（JavaFX 启动后再设往往不生效）。
    APP_ICON = renderIcon();
    setupMacDockIcon(APP_ICON);
    cliArgs = args;
    Application.launch(JarDiffLauncher.class, args);
  }

  @Override
  public void start(Stage stage) {
    int preferredPort = resolvePreferredPort(cliArgs, DEFAULT_PORT);
    int actualPort;
    try {
      actualPort = findAvailablePort(preferredPort, resolveProbeRange(cliArgs));
    } catch (IllegalStateException e) {
      showErrorAndExit(e.getMessage());
      return;
    }

    try {
      springContext =
          new SpringApplicationBuilder(JarDiffApplication.class)
              .headless(false)
              .run(withServerPort(cliArgs, actualPort));
    } catch (Exception e) {
      showErrorAndExit("服务启动失败：" + e.getMessage());
      return;
    }

    WebView webView = new WebView();
    WebEngine engine = webView.getEngine();
    FileBridge bridge = new FileBridge(stage, engine);
    injectBridge(engine, bridge);
    // 页面（重新）加载后重新注入，保证 SPA 刷新后 bridge 仍可用
    engine.getLoadWorker()
        .stateProperty()
        .addListener(
            (obs, old, state) -> {
              if (state == Worker.State.SUCCEEDED) {
                injectBridge(engine, bridge);
              }
            });
    engine.load("http://localhost:" + actualPort + "/");

    Scene scene = new Scene(webView, 1280, 800);
    stage.setTitle("Jar 差异比对工具");
    stage.setScene(scene);
    if (APP_ICON != null) {
      stage.getIcons().add(javafx.embed.swing.SwingFXUtils.toFXImage(APP_ICON, null));
    }
    stage.show();
  }

  @Override
  public void stop() {
    // 关闭 Spring/Tomcat。引入 Dock 图标后 AWT 的 EventDispatchThread 等非 daemon 线程无法优雅
    // 关闭，故用 System.exit 强制退出，确保关窗后进程彻底结束。
    if (springContext != null) {
      springContext.close();
    }
    Platform.exit();
    System.exit(0);
  }

  /** 把 FileBridge 注入到 WebView 的 window 对象，供前端 JS 调用原生文件选择器。 */
  private static void injectBridge(WebEngine engine, FileBridge bridge) {
    try {
      JSObject win = (JSObject) engine.executeScript("window");
      win.setMember("jardiffBridge", bridge);
    } catch (Exception ignored) {
      // 页面未就绪等情况忽略，SUCCEEDED 时会重试
    }
  }

  /** 从命令行参数解析期望端口；未指定则返回默认端口。 */
  private static int resolvePreferredPort(String[] args, int defaultPort) {
    for (String a : args) {
      if (a.startsWith("--server.port=")) {
        try {
          return Integer.parseInt(a.substring("--server.port=".length()));
        } catch (NumberFormatException ignored) {
          // 忽略非法值，继续用默认
        }
      }
    }
    return defaultPort;
  }

  /** 在原参数基础上覆盖 server.port（移除已有项再加新的），命令行参数优先级高于配置文件。 */
  private static String[] withServerPort(String[] args, int port) {
    List<String> list = new ArrayList<>();
    for (String a : args) {
      if (!a.startsWith("--server.port=")) {
        list.add(a);
      }
    }
    list.add("--server.port=" + port);
    return list.toArray(new String[0]);
  }

  /**
   * 解析端口探测范围。优先级：命令行 {@code --jardiff.port.probe-range=N} → classpath 下的
   * {@code application.properties} → 默认 100。取值非法或缺省时逐级回退。
   *
   * <p>本方法在 Spring 启动前调用，拿不到 Environment，故直接轻量读取 properties。
   */
  private static int resolveProbeRange(String[] args) {
    for (String a : args) {
      if (a.startsWith("--" + PROBE_RANGE_KEY + "=")) {
        int v = parsePositiveInt(a.substring(PROBE_RANGE_KEY.length() + 3));
        if (v > 0) return v;
      }
    }
    try (InputStream in =
        JarDiffLauncher.class.getClassLoader().getResourceAsStream("application.properties")) {
      if (in != null) {
        Properties props = new Properties();
        props.load(in);
        int v = parsePositiveInt(props.getProperty(PROBE_RANGE_KEY));
        if (v > 0) return v;
      }
    } catch (IOException ignored) {
      // 读不到配置则用默认值
    }
    return DEFAULT_PROBE_RANGE;
  }

  private static int parsePositiveInt(String raw) {
    if (raw == null) return -1;
    try {
      int v = Integer.parseInt(raw.trim());
      return v > 0 ? v : -1;
    } catch (NumberFormatException ignored) {
      return -1;
    }
  }

  /** 从 from 起，绑定 127.0.0.1 探测可用端口；占用则递增，最多尝试 probeRange 个。 */
  private static int findAvailablePort(int from, int probeRange) {
    for (int p = from; p < from + probeRange; p++) {
      try (ServerSocket ss = new ServerSocket(p, 50, InetAddress.getByName("127.0.0.1"))) {
        return p;
      } catch (IOException ignored) {
        // 端口被占，继续尝试下一个
      }
    }
    throw new IllegalStateException(
        "在 " + from + "~" + (from + probeRange - 1) + " 范围内未找到可用端口");
  }

  private void showErrorAndExit(String message) {
    Alert alert = new Alert(Alert.AlertType.ERROR);
    alert.setTitle("Jar 差异比对工具");
    alert.setHeaderText(null);
    alert.setContentText(message);
    alert.showAndWait();
    Platform.exit();
  }

  /**
   * 用 Graphics2D 生成应用图标（深色圆角方块 + "JD" 字样，配色与前端主题一致），返回 BufferedImage。
   * 同一份图既用于 macOS Dock（setDockIconImage），也转成 JavaFX Image 用于窗口标题栏。
   * 如需替换，把 PNG 放进 resources 并改为 {@code ImageIO.read} 读入。
   */
  private static java.awt.image.BufferedImage renderIcon() {
    int canvas = 256;
    int box = 192;          // 方块占 75%，四周留透明边距，符合 macOS 图标规范、避免 Dock 里显大
    int offset = (canvas - box) / 2;
    int arc = 56;
    java.awt.image.BufferedImage img =
        new java.awt.image.BufferedImage(canvas, canvas, java.awt.image.BufferedImage.TYPE_INT_ARGB);
    java.awt.Graphics2D g = img.createGraphics();
    g.setRenderingHint(java.awt.RenderingHints.KEY_ANTIALIASING, java.awt.RenderingHints.VALUE_ANTIALIAS_ON);
    g.setRenderingHint(java.awt.RenderingHints.KEY_TEXT_ANTIALIASING, java.awt.RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
    g.setColor(new java.awt.Color(0x1F, 0x23, 0x28));
    g.fillRoundRect(offset, offset, box, box, arc, arc);
    g.setColor(java.awt.Color.WHITE);
    g.setFont(g.getFont().deriveFont(java.awt.Font.BOLD, 96f));
    java.awt.FontMetrics fm = g.getFontMetrics();
    String label = "JD";
    int x = offset + (box - fm.stringWidth(label)) / 2;
    int y = offset + (box - fm.getHeight()) / 2 + fm.getAscent();
    g.drawString(label, x, y);
    g.dispose();
    return img;
  }

  /** 在 macOS 上设置 Dock 图标（反射调 com.apple.eawt.Application，避免编译期依赖该 Mac 专属类）。 */
  private static void setupMacDockIcon(java.awt.Image icon) {
    try {
      Class<?> appClass = Class.forName("com.apple.eawt.Application");
      Object app = appClass.getMethod("getApplication").invoke(null);
      appClass.getMethod("setDockIconImage", java.awt.Image.class).invoke(app, icon);
    } catch (Throwable ignored) {
      // 非 Mac 平台或 API 不可用，忽略（窗口图标仍由 stage.getIcons 提供）
    }
  }
}
