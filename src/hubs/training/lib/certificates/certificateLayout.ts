// Shared certificate layout types and defaults.
// Import from here - never export these from an API route file.

export interface ElemPos {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CertLayout {
  logo:         ElemPos;
  heading:      ElemPos;
  studentBlock: ElemPos;
  signature:    ElemPos;
}

/** Canvas dimensions (px) */
export const CERT_CANVAS_W = 680;
export const CERT_CANVAS_H = 960;

/** Default layout - used when no saved layout exists in the DB */
export const DEFAULT_CERT_LAYOUT: CertLayout = {
  logo:         { left: 195, top: 46,  width: 290, height: 80  },
  heading:      { left: 40,  top: 185, width: 600, height: 60  },
  studentBlock: { left: 40,  top: 280, width: 600, height: 380 },
  signature:    { left: 80,  top: 750, width: 520, height: 70  },
};
