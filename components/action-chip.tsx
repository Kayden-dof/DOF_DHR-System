const STYLE: Record<string, string> = {
  INSERT: 'bg-ok-bg text-ok',
  UPDATE: 'bg-warn-bg text-warn',
  DELETE: 'bg-danger-bg text-danger',
};

const LABEL: Record<string, string> = {
  INSERT: '등록',
  UPDATE: '변경',
  DELETE: '삭제',
};

export default function ActionChip({ action }: { action: string }) {
  return (
    <span className={`chip ${STYLE[action] ?? 'bg-canvas text-muted'}`}>
      {LABEL[action] ?? action}
    </span>
  );
}
