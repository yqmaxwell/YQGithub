package com.example.jardiff.core;

import java.util.ArrayList;
import java.util.List;

public class DiffResult {
  private String kind;
  private String fileType;
  private boolean nested;
  private String containerEntry;
  private String innerPath;
  private String leftName;
  private String rightName;
  private List<String> left = new ArrayList<>();
  private List<String> right = new ArrayList<>();
  private List<Row> rows = new ArrayList<>();
  private List<Highlight> highlights = new ArrayList<>();
  private List<Hunk> hunks = new ArrayList<>();
  private boolean missingRight;
  private boolean missingLeft;
  private String message;
  private FileSideMeta leftMeta;
  private FileSideMeta rightMeta;
  private ClassSignatureSummary classSummary;

  public DiffResult() {
  }

  public String getKind() {
    return kind;
  }

  public void setKind(String kind) {
    this.kind = kind;
  }

  public String getFileType() {
    return fileType;
  }

  public void setFileType(String fileType) {
    this.fileType = fileType;
  }

  public boolean isNested() {
    return nested;
  }

  public void setNested(boolean nested) {
    this.nested = nested;
  }

  public String getContainerEntry() {
    return containerEntry;
  }

  public void setContainerEntry(String containerEntry) {
    this.containerEntry = containerEntry;
  }

  public String getInnerPath() {
    return innerPath;
  }

  public void setInnerPath(String innerPath) {
    this.innerPath = innerPath;
  }

  public String getLeftName() {
    return leftName;
  }

  public void setLeftName(String leftName) {
    this.leftName = leftName;
  }

  public String getRightName() {
    return rightName;
  }

  public void setRightName(String rightName) {
    this.rightName = rightName;
  }

  public List<String> getLeft() {
    return left;
  }

  public void setLeft(List<String> left) {
    this.left = left;
  }

  public List<String> getRight() {
    return right;
  }

  public void setRight(List<String> right) {
    this.right = right;
  }

  public List<Row> getRows() {
    return rows;
  }

  public void setRows(List<Row> rows) {
    this.rows = rows;
  }

  public List<Highlight> getHighlights() {
    return highlights;
  }

  public void setHighlights(List<Highlight> highlights) {
    this.highlights = highlights;
  }

  public List<Hunk> getHunks() {
    return hunks;
  }

  public void setHunks(List<Hunk> hunks) {
    this.hunks = hunks;
  }

  public boolean isMissingRight() {
    return missingRight;
  }

  public void setMissingRight(boolean missingRight) {
    this.missingRight = missingRight;
  }

  public boolean isMissingLeft() {
    return missingLeft;
  }

  public void setMissingLeft(boolean missingLeft) {
    this.missingLeft = missingLeft;
  }

  public String getMessage() {
    return message;
  }

  public void setMessage(String message) {
    this.message = message;
  }

  public FileSideMeta getLeftMeta() {
    return leftMeta;
  }

  public void setLeftMeta(FileSideMeta leftMeta) {
    this.leftMeta = leftMeta;
  }

  public FileSideMeta getRightMeta() {
    return rightMeta;
  }

  public void setRightMeta(FileSideMeta rightMeta) {
    this.rightMeta = rightMeta;
  }

  public ClassSignatureSummary getClassSummary() {
    return classSummary;
  }

  public void setClassSummary(ClassSignatureSummary classSummary) {
    this.classSummary = classSummary;
  }

  public static class ClassSignatureSummary {
    private int addedFields;
    private int removedFields;
    private int addedMethods;
    private int removedMethods;
    private List<String> sampleAdded = new ArrayList<>();
    private List<String> sampleRemoved = new ArrayList<>();

    public int getAddedFields() {
      return addedFields;
    }

    public void setAddedFields(int addedFields) {
      this.addedFields = addedFields;
    }

    public int getRemovedFields() {
      return removedFields;
    }

    public void setRemovedFields(int removedFields) {
      this.removedFields = removedFields;
    }

    public int getAddedMethods() {
      return addedMethods;
    }

    public void setAddedMethods(int addedMethods) {
      this.addedMethods = addedMethods;
    }

    public int getRemovedMethods() {
      return removedMethods;
    }

    public void setRemovedMethods(int removedMethods) {
      this.removedMethods = removedMethods;
    }

    public List<String> getSampleAdded() {
      return sampleAdded;
    }

    public void setSampleAdded(List<String> sampleAdded) {
      this.sampleAdded = sampleAdded;
    }

    public List<String> getSampleRemoved() {
      return sampleRemoved;
    }

    public void setSampleRemoved(List<String> sampleRemoved) {
      this.sampleRemoved = sampleRemoved;
    }
  }

  public static class FileSideMeta {
    private Long size;
    private String md5;
    private Long crc32;

    public FileSideMeta() {
    }

    public FileSideMeta(Long size, String md5, Long crc32) {
      this.size = size;
      this.md5 = md5;
      this.crc32 = crc32;
    }

    public Long getSize() {
      return size;
    }

    public void setSize(Long size) {
      this.size = size;
    }

    public String getMd5() {
      return md5;
    }

    public void setMd5(String md5) {
      this.md5 = md5;
    }

    public Long getCrc32() {
      return crc32;
    }

    public void setCrc32(Long crc32) {
      this.crc32 = crc32;
    }
  }

  public static class Row {
    private Integer leftNo;
    private Integer rightNo;
    private String leftText;
    private String rightText;

    public Row() {
    }

    public Row(Integer leftNo, Integer rightNo, String leftText, String rightText) {
      this.leftNo = leftNo;
      this.rightNo = rightNo;
      this.leftText = leftText;
      this.rightText = rightText;
    }

    public Integer getLeftNo() {
      return leftNo;
    }

    public void setLeftNo(Integer leftNo) {
      this.leftNo = leftNo;
    }

    public Integer getRightNo() {
      return rightNo;
    }

    public void setRightNo(Integer rightNo) {
      this.rightNo = rightNo;
    }

    public String getLeftText() {
      return leftText;
    }

    public void setLeftText(String leftText) {
      this.leftText = leftText;
    }

    public String getRightText() {
      return rightText;
    }

    public void setRightText(String rightText) {
      this.rightText = rightText;
    }
  }

  public static class Highlight {
    private String side;
    private int line;
    private String type;

    public Highlight() {
    }

    public Highlight(String side, int line, String type) {
      this.side = side;
      this.line = line;
      this.type = type;
    }

    public String getSide() {
      return side;
    }

    public void setSide(String side) {
      this.side = side;
    }

    public int getLine() {
      return line;
    }

    public void setLine(int line) {
      this.line = line;
    }

    public String getType() {
      return type;
    }

    public void setType(String type) {
      this.type = type;
    }
  }

  public static class Hunk {
    private int index;
    private int startRow;
    private int endRow;
    private int changeStartRow;
    private int changeEndRow;
    private Integer leftStart;
    private Integer leftEnd;
    private Integer rightStart;
    private Integer rightEnd;

    public Hunk() {
    }

    public int getIndex() {
      return index;
    }

    public void setIndex(int index) {
      this.index = index;
    }

    public int getStartRow() {
      return startRow;
    }

    public void setStartRow(int startRow) {
      this.startRow = startRow;
    }

    public int getEndRow() {
      return endRow;
    }

    public void setEndRow(int endRow) {
      this.endRow = endRow;
    }

    public int getChangeStartRow() {
      return changeStartRow;
    }

    public void setChangeStartRow(int changeStartRow) {
      this.changeStartRow = changeStartRow;
    }

    public int getChangeEndRow() {
      return changeEndRow;
    }

    public void setChangeEndRow(int changeEndRow) {
      this.changeEndRow = changeEndRow;
    }

    public Integer getLeftStart() {
      return leftStart;
    }

    public void setLeftStart(Integer leftStart) {
      this.leftStart = leftStart;
    }

    public Integer getLeftEnd() {
      return leftEnd;
    }

    public void setLeftEnd(Integer leftEnd) {
      this.leftEnd = leftEnd;
    }

    public Integer getRightStart() {
      return rightStart;
    }

    public void setRightStart(Integer rightStart) {
      this.rightStart = rightStart;
    }

    public Integer getRightEnd() {
      return rightEnd;
    }

    public void setRightEnd(Integer rightEnd) {
      this.rightEnd = rightEnd;
    }
  }
}
