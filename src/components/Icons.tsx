import React from "react";

export type IconProps = {
  size?: number;
  strokeWidth?: number;
  className?: string;
};

type IconBaseProps = IconProps & { children: React.ReactNode };

const IconBase: React.FC<IconBaseProps> = ({
  size = 16,
  strokeWidth = 2,
  className,
  children,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const TrashIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </IconBase>
);

export const CopyIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </IconBase>
);

export const PlusIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </IconBase>
);

export const ShapesIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <circle cx="17" cy="7" r="4" />
    <path d="M4 21l6-10 6 10Z" />
  </IconBase>
);

export const CircleDashedIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" strokeDasharray="3 3.5" />
  </IconBase>
);

export const UndoIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </IconBase>
);

export const RedoIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </IconBase>
);

export const SaveIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
    <path d="M17 21v-8H7v8" />
    <path d="M7 3v5h8" />
  </IconBase>
);

export const FolderOpenIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1H5.5a2 2 0 0 0-1.94 1.51L2 19V7Z" />
    <path d="M2.5 19.4 4.3 12a2 2 0 0 1 2-1.5H21l-2.2 7.9a2 2 0 0 1-1.9 1.6H4a1.7 1.7 0 0 1-1.5-1.1Z" />
  </IconBase>
);

export const DownloadIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </IconBase>
);

export const UploadIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M12 15V3" />
    <path d="m7 8 5-5 5 5" />
    <path d="M5 21h14" />
  </IconBase>
);

export const ImageIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-5-5L5 21" />
  </IconBase>
);

export const VectorIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M8 6h5a5 5 0 0 1 5 5v5" />
  </IconBase>
);

export const FileTextIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
    <path d="M9 13h6" />
    <path d="M9 17h6" />
  </IconBase>
);

export const LockIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </IconBase>
);

export const UnlockIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 7.2-2.4" />
  </IconBase>
);

export const ChevronUpIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="m6 15 6-6 6 6" />
  </IconBase>
);

export const ChevronDownIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="m6 9 6 6 6-6" />
  </IconBase>
);

export const ChevronLeftIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="m15 18-6-6 6-6" />
  </IconBase>
);

export const ChevronRightIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="m9 18 6-6-6-6" />
  </IconBase>
);

export const MergeIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M8 3 4 7l4 4" />
    <path d="M4 7h9a4 4 0 0 1 4 4v0" />
    <path d="m16 21 4-4-4-4" />
    <path d="M20 17h-9a4 4 0 0 1-4-4v0" />
  </IconBase>
);

export const UngroupIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <rect x="8" y="8" width="8" height="8" rx="2" />
    <path d="M9 9 4 4" />
    <path d="M9 15 4 20" />
    <path d="M15 9l5-5" />
    <path d="M15 15l5 5" />
  </IconBase>
);

export const CloseIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M18 6 6 18" />
    <path d="M6 6l12 12" />
  </IconBase>
);

export const HelpIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 0 1 4.85.83c0 1.67-2.35 2.17-2.35 3.67" />
    <path d="M12 17.5h.01" />
  </IconBase>
);

export const ZoomInIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
    <path d="M11 8v6" />
    <path d="M8 11h6" />
  </IconBase>
);

export const ZoomOutIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
    <path d="M8 11h6" />
  </IconBase>
);

export const HandIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M18 11V6a2 2 0 0 0-4 0v5" />
    <path d="M14 10V4a2 2 0 0 0-4 0v6" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M6 14v0a8 8 0 0 0 8 8h0a8 8 0 0 0 8-8v-3a2 2 0 0 0-4 0" />
  </IconBase>
);

export const FrameIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M3 3v18" />
    <path d="M21 3v18" />
    <path d="M3 3h18" />
    <path d="M3 21h18" />
  </IconBase>
);

export const PipetteIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="m2 22 1-4 12.5-12.5a2.121 2.121 0 0 1 3 3L6 21l-4 1Z" />
    <path d="m14.5 6.5 3 3" />
    <path d="M17 3.5a2.5 2.5 0 0 1 3.5 3.5" />
  </IconBase>
);

export const AlignLeftIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <line x1="4" y1="2" x2="4" y2="22" />
    <rect x="4" y="6" width="10" height="4" rx="1" />
    <rect x="4" y="14" width="16" height="4" rx="1" />
  </IconBase>
);

export const AlignCenterHIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <line x1="12" y1="2" x2="12" y2="22" />
    <rect x="7" y="6" width="10" height="4" rx="1" />
    <rect x="4" y="14" width="16" height="4" rx="1" />
  </IconBase>
);

export const AlignRightIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <line x1="20" y1="2" x2="20" y2="22" />
    <rect x="10" y="6" width="10" height="4" rx="1" />
    <rect x="4" y="14" width="16" height="4" rx="1" />
  </IconBase>
);

export const AlignTopIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <line x1="2" y1="4" x2="22" y2="4" />
    <rect x="6" y="4" width="4" height="10" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </IconBase>
);

export const AlignMiddleIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <line x1="2" y1="12" x2="22" y2="12" />
    <rect x="6" y="7" width="4" height="10" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </IconBase>
);

export const AlignBottomIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <line x1="2" y1="20" x2="22" y2="20" />
    <rect x="6" y="10" width="4" height="10" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </IconBase>
);

export const DistributeHorizontalIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <rect x="2" y="8" width="4" height="8" rx="1" />
    <rect x="10" y="8" width="4" height="8" rx="1" />
    <rect x="18" y="8" width="4" height="8" rx="1" />
  </IconBase>
);

export const DistributeVerticalIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <rect x="8" y="10" width="8" height="4" rx="1" />
    <rect x="8" y="18" width="8" height="4" rx="1" />
  </IconBase>
);
