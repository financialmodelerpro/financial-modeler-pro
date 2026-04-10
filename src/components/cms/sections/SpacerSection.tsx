interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

export function SpacerSection({ content, styles }: Props) {
  const height  = content.height as string ?? '60px';
  const bgColor = (styles.bgColor as string) ?? 'transparent';

  return <div style={{ height, background: bgColor }} aria-hidden="true" />;
}
