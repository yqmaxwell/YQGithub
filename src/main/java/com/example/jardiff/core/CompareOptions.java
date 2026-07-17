package com.example.jardiff.core;

public class CompareOptions {
  private final boolean includeLib;
  private final boolean includeClasses;
  private final boolean includeResources;
  private final boolean deepCompareLib;
  private final String[] ignoreGlobs;

  public CompareOptions(boolean includeLib, boolean includeClasses, boolean includeResources, boolean deepCompareLib) {
    this(includeLib, includeClasses, includeResources, deepCompareLib, null);
  }

  public CompareOptions(boolean includeLib, boolean includeClasses, boolean includeResources, boolean deepCompareLib, String[] ignoreGlobs) {
    this.includeLib = includeLib;
    this.includeClasses = includeClasses;
    this.includeResources = includeResources;
    this.deepCompareLib = deepCompareLib;
    this.ignoreGlobs = ignoreGlobs;
  }

  public boolean isIncludeLib() {
    return includeLib;
  }

  public boolean isIncludeClasses() {
    return includeClasses;
  }

  public boolean isIncludeResources() {
    return includeResources;
  }

  public boolean isDeepCompareLib() {
    return deepCompareLib;
  }

  public String[] getIgnoreGlobs() {
    return ignoreGlobs;
  }
}
