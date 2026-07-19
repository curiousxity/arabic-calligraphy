import React, { useRef, useState } from "react";
import type { Block } from "../../types";
import { makeId } from "./utils";
import {
  ShapesIcon,
  CircleDashedIcon,
  ImageIcon,
  LockIcon,
  UnlockIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  MergeIcon,
  UngroupIcon,
  CloseIcon,
} from "../Icons";

const GROUP_HUE_STEP = 47;
const groupColor = (groupId: number) => `hsl(${(groupId * GROUP_HUE_STEP) % 360}, 65%, 55%)`;

const blockTypeIcon = (b: Block) =>
  b.type === "shapeFill" ? (
    <ShapesIcon size={13} />
  ) : b.type === "shapeWarp" ? (
    <CircleDashedIcon size={13} />
  ) : b.type === "image" ? (
    <ImageIcon size={13} />
  ) : (
    "T"
  );

export type LayersPanelProps = {
  blocks: Block[];
  selectedId?: number | null;
  selectedIds?: number[];
  onSelect: (id: number, additive?: boolean) => void;
  onToggleLock: (id: number) => void;
  onMoveUp: (id: number) => void;
  onMoveDown: (id: number) => void;
  onDelete: (id: number) => void;
  onMerge: (idA: number, idB: number) => void;
  onUngroup: (id: number) => void;
  onRename: (id: number, name: string) => void;
  onZoomTo?: (id: number) => void;
};

export const LayersPanel: React.FC<LayersPanelProps> = ({
  blocks,
  selectedId,
  selectedIds = [],
  onSelect,
  onToggleLock,
  onMoveUp,
  onMoveDown,
  onDelete,
  onMerge,
  onUngroup,
  onRename,
  onZoomTo,
}) => {
  const [mergeTarget, setMergeTarget] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLInputElement | null>(null);

  const reversed = [...blocks].reverse();

  const startEdit = (block: Block, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(block.id);
    setEditValue(block.name ?? `Block ${block.id}`);
    setTimeout(() => editRef.current?.select(), 0);
  };

  const commitEdit = () => {
    if (editingId != null) onRename(editingId, editValue.trim() || `Block ${editingId}`);
    setEditingId(null);
  };

  const handleMergeClick = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (mergeTarget == null) setMergeTarget(id);
    else if (mergeTarget === id) setMergeTarget(null);
    else {
      onMerge(mergeTarget, id);
      setMergeTarget(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {mergeTarget != null && (
        <div
          style={{
            fontSize: 11,
            color: "var(--info-text)",
            background: "var(--info-bg)",
            borderRadius: 8,
            padding: "4px 8px",
            textAlign: "center",
          }}
        >
          Click on another layer to group. Grouped layers move together.
        </div>
      )}

      {reversed.map((block) => {
        const isMultiSelected = selectedIds.length > 1 && selectedIds.includes(block.id);
        const isSelected = block.id === selectedId || isMultiSelected;
        const isMerge = block.id === mergeTarget;
        const label = block.name ?? `Block ${block.id}`;

        return (
          <div
            key={block.id}
            onClick={(e) => onSelect(block.id, e.shiftKey || e.ctrlKey || e.metaKey)}
            onDoubleClick={() => onZoomTo?.(block.id)}
            title="Double-click to zoom to this block"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 7px",
              borderRadius: 10,
              background: isSelected
                ? "var(--selection-bg)"
                : isMerge
                  ? "var(--merge-bg)"
                  : "var(--row-bg)",
              border: `1px solid ${
                isSelected
                  ? "var(--selection-border)"
                  : isMerge
                    ? "var(--merge-border)"
                    : "transparent"
              }`,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <span
              style={{
                fontSize: 13,
                width: 18,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: "var(--text-secondary)",
              }}
            >
              {blockTypeIcon(block)}
            </span>

            {block.groupId != null && (
              <span
                title="Grouped — moves together with linked layers"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: groupColor(block.groupId),
                }}
              />
            )}

            {editingId === block.id ? (
              <input
                ref={editRef}
                id={makeId("layer-name", block.id)}
                name={makeId("layerName", block.id)}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  flex: 1,
                  fontSize: 12,
                  border: "1px solid var(--accent-hover)",
                  borderRadius: 5,
                  padding: "1px 5px",
                  background: "var(--input-bg-solid)",
                  outline: "none",
                  direction: "rtl",
                  color: "var(--text-primary)",
                }}
              />
            ) : (
              <span
                onDoubleClick={(e) => startEdit(block, e)}
                title="Double-click to rename"
                style={{
                  flex: 1,
                  fontSize: 12,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--text-primary)",
                  direction: "rtl",
                }}
              >
                {label}
              </span>
            )}

            <button
              type="button"
              title={block.locked ? "Unlock" : "Lock"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleLock(block.id);
              }}
              className="layerIconBtn"
              aria-label={block.locked ? "Unlock layer" : "Lock layer"}
            >
              {block.locked ? <LockIcon size={13} /> : <UnlockIcon size={13} />}
            </button>

            <button
              type="button"
              title="Move up"
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp(block.id);
              }}
              className="layerIconBtn"
              aria-label="Move layer up"
            >
              <ChevronUpIcon size={13} />
            </button>

            <button
              type="button"
              title="Move down"
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown(block.id);
              }}
              className="layerIconBtn"
              aria-label="Move layer down"
            >
              <ChevronDownIcon size={13} />
            </button>

            <button
              type="button"
              title={isMerge ? "Cancel grouping" : "Group with another layer"}
              onClick={(e) => handleMergeClick(block.id, e)}
              className="layerIconBtn"
              aria-label="Group layer"
              style={{
                background: isMerge ? "var(--merge-border)" : "transparent",
                borderRadius: 4,
              }}
            >
              <MergeIcon size={13} />
            </button>

            {block.groupId != null && (
              <button
                type="button"
                title="Ungroup this layer"
                onClick={(e) => {
                  e.stopPropagation();
                  onUngroup(block.id);
                }}
                className="layerIconBtn"
                aria-label="Ungroup layer"
              >
                <UngroupIcon size={13} />
              </button>
            )}

            <button
              type="button"
              title="Delete layer"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(block.id);
              }}
              className="layerIconBtn"
              aria-label="Delete layer"
              style={{ color: "var(--danger)" }}
            >
              <CloseIcon size={13} />
            </button>
          </div>
        );
      })}

      {blocks.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-faint)",
            textAlign: "center",
            padding: 8,
          }}
        >
          No layers yet.
        </div>
      )}
    </div>
  );
};

export default LayersPanel;
