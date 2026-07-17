package com.example.jardiff.core;

import java.util.List;

public class DirectorySummaryResult {
  private List<DirectoryJarRow> rows;

  public DirectorySummaryResult() {
  }

  public DirectorySummaryResult(List<DirectoryJarRow> rows) {
    this.rows = rows;
  }

  public List<DirectoryJarRow> getRows() {
    return rows;
  }

  public void setRows(List<DirectoryJarRow> rows) {
    this.rows = rows;
  }
}
