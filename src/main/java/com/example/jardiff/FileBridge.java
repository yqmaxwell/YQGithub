package com.example.jardiff;

import java.io.File;
import javafx.application.Platform;
import javafx.scene.web.WebEngine;
import javafx.stage.DirectoryChooser;
import javafx.stage.FileChooser;
import javafx.stage.FileChooser.ExtensionFilter;
import javafx.stage.Stage;

/**
 * JS↔Java 桥接对象：WebView 前端调用弹出原生文件/目录选择器。
 *
 * <p><b>为何异步</b>：FileChooser/DirectoryChooser 必须在 JavaFX Application Thread 调用，而 JS→Java
 * 桥调用不在该线程；且模态阻塞会打断桥的同步返回值。因此本类用 {@link Platform#runLater} 切到 FX
 * 线程弹窗，用户选定后通过 {@link WebEngine#executeScript} 回调 {@code window.__jardiffOnChosen(path)}，
 * 由前端分发到对应输入。
 */
public class FileBridge {

  private final Stage stage;
  private final WebEngine engine;

  public FileBridge(Stage stage, WebEngine engine) {
    this.stage = stage;
    this.engine = engine;
  }

  /** 弹出文件选择器（过滤 jar/zip/war），选定后异步回调前端。 */
  public void chooseJar(String title) {
    pickAndReport(
        () -> {
          FileChooser fc = new FileChooser();
          fc.setTitle(title == null ? "选择 Jar" : title);
          fc.getExtensionFilters().add(new ExtensionFilter("Jar/Zip/War", "*.jar", "*.zip", "*.war"));
          return fc.showOpenDialog(stage);
        });
  }

  /** 弹出目录选择器，选定后异步回调前端。 */
  public void chooseDirectory(String title) {
    pickAndReport(
        () -> {
          DirectoryChooser dc = new DirectoryChooser();
          dc.setTitle(title == null ? "选择目录" : title);
          return dc.showDialog(stage);
        });
  }

  /** 弹出文件选择器（任意文件，用于 .class/.java 等单文件比对），选定后异步回调前端。 */
  public void chooseFile(String title) {
    pickAndReport(
        () -> {
          FileChooser fc = new FileChooser();
          fc.setTitle(title == null ? "选择文件" : title);
          return fc.showOpenDialog(stage);
        });
  }

  private interface FilePicker {
    File pick();
  }

  /** 在 JavaFX Application Thread 弹选择器，选定后通过 executeScript 回调 window.__jardiffOnChosen。 */
  private void pickAndReport(FilePicker picker) {
    Platform.runLater(
        () -> {
          File f = null;
          try {
            f = picker.pick();
          } catch (Throwable ignored) {
          }
          if (f != null) {
            engine.executeScript(
                "window.__jardiffOnChosen && window.__jardiffOnChosen("
                    + jsStringLiteral(f.getAbsolutePath())
                    + ")");
          }
        });
  }

  /** 把 Java 字符串转成单引号包裹的 JS 字符串字面量（转义反斜杠和单引号）。 */
  private static String jsStringLiteral(String s) {
    StringBuilder sb = new StringBuilder("'");
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c == '\\' || c == '\'') sb.append('\\');
      sb.append(c);
    }
    sb.append("'");
    return sb.toString();
  }
}
