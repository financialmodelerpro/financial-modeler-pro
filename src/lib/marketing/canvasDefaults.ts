import type { CanvasElement, TextProps, ImageProps, ShapeProps, CanvasBackground } from './types';

// Used by both server (render route) and client (editor) — keep pure.

export function uid(): string {
  return 'el-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const DEFAULT_TEXT: TextProps = {
  content: 'Your text here',
  fontSize: 56,
  fontWeight: 700,
  color: '#FFFFFF',
  fontFamily: 'Inter',
  textAlign: 'left',
  lineHeight: 1.15,
  letterSpacing: 0,
  fontStyle: 'normal',
};

export const DEFAULT_IMAGE: ImageProps = {
  src: '',
  objectFit: 'cover',
  borderRadius: 0,
  opacity: 100,
  filter: 'none',
  brightness: 100,
  lockAspectRatio: true,
  borderColor: 'transparent',
  borderWidth: 0,
};

export const DEFAULT_SHAPE: ShapeProps = {
  backgroundColor: '#F59E0B',
  borderRadius: 8,
  borderColor: 'transparent',
  borderWidth: 0,
  opacity: 100,
  lockAspectRatio: false,
};

export const DEFAULT_BACKGROUND: CanvasBackground = {
  type: 'color',
  color: '#1B4F72',
};

export function makeTextElement(partial?: Partial<CanvasElement>): CanvasElement {
  return {
    id: uid(),
    type: 'text',
    x: 80,
    y: 80,
    width: 600,
    height: 120,
    zIndex: 1,
    text: { ...DEFAULT_TEXT },
    ...partial,
  };
}

export function makeImageElement(src: string, partial?: Partial<CanvasElement>): CanvasElement {
  return {
    id: uid(),
    type: 'image',
    x: 80,
    y: 80,
    width: 300,
    height: 300,
    zIndex: 1,
    image: { ...DEFAULT_IMAGE, src },
    ...partial,
  };
}

export function makeShapeElement(partial?: Partial<CanvasElement>): CanvasElement {
  return {
    id: uid(),
    type: 'shape',
    x: 80,
    y: 80,
    width: 200,
    height: 80,
    zIndex: 1,
    shape: { ...DEFAULT_SHAPE },
    ...partial,
  };
}

/** Build CSS `background` value for a CanvasBackground. */
export function backgroundToCss(bg: CanvasBackground): { background: string; backgroundSize?: string; backgroundPosition?: string } {
  if (bg.type === 'image' && bg.image) {
    return { background: `url(${bg.image}) center / cover no-repeat`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  if (bg.type === 'gradient' && bg.gradient) {
    const { from, to, direction } = bg.gradient;
    if (direction === 'radial') return { background: `radial-gradient(circle, ${from} 0%, ${to} 100%)` };
    return { background: `linear-gradient(${direction}, ${from} 0%, ${to} 100%)` };
  }
  return { background: bg.color || '#1B4F72' };
}
