package com.example.jardiff.core;

import java.util.ArrayList;
import java.util.List;

public class TreeNode {
  private String type;
  private String label;
  private String value;
  private boolean leftExists;
  private boolean rightExists;
  private String rightStatus;
  private List<TreeNode> children = new ArrayList<>();

  public TreeNode() {
  }

  public TreeNode(String type, String label, String value) {
    this.type = type;
    this.label = label;
    this.value = value;
  }

  public String getType() {
    return type;
  }

  public void setType(String type) {
    this.type = type;
  }

  public String getLabel() {
    return label;
  }

  public void setLabel(String label) {
    this.label = label;
  }

  public String getValue() {
    return value;
  }

  public void setValue(String value) {
    this.value = value;
  }

  public boolean isLeftExists() {
    return leftExists;
  }

  public void setLeftExists(boolean leftExists) {
    this.leftExists = leftExists;
  }

  public boolean isRightExists() {
    return rightExists;
  }

  public void setRightExists(boolean rightExists) {
    this.rightExists = rightExists;
  }

  public String getRightStatus() {
    return rightStatus;
  }

  public void setRightStatus(String rightStatus) {
    this.rightStatus = rightStatus;
  }

  public List<TreeNode> getChildren() {
    return children;
  }

  public void setChildren(List<TreeNode> children) {
    this.children = children;
  }
}
