package com.example.jardiff.core;

public class Stats {
  private int added;
  private int missing;
  private int modified;
  private int unchanged;

  public Stats() {
  }

  public Stats(int added, int missing, int modified, int unchanged) {
    this.added = added;
    this.missing = missing;
    this.modified = modified;
    this.unchanged = unchanged;
  }

  public int getAdded() {
    return added;
  }

  public void setAdded(int added) {
    this.added = added;
  }

  public int getMissing() {
    return missing;
  }

  public void setMissing(int missing) {
    this.missing = missing;
  }

  public int getModified() {
    return modified;
  }

  public void setModified(int modified) {
    this.modified = modified;
  }

  public int getUnchanged() {
    return unchanged;
  }

  public void setUnchanged(int unchanged) {
    this.unchanged = unchanged;
  }
}
