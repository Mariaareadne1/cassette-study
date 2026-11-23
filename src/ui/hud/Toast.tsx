import { useEffect, useState } from 'react';
import type { ControllerView } from '@/deck/controller';

const SHOW_MS = 2600;

/** Short, polite feedback. The live region is always mounted so screen readers hear it. */
export function Toast({ message }: { message: ControllerView['message'] }) {
  const [visible, setVisible] = useState<number | null>(null);
  useEffect(() => {
    if (!message) return;
    setVisible(message.id);
    const t = window.setTimeout(() => setVisible((v) => (v === message.id ? null : v)), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [message]);
  const shown = message && visible === message.id;
  return (
    <div className="cs-toast-wrap" role="status" aria-live="polite">
      {shown && <p className={`cs-toast cs-toast-${message.tone}`}>{message.text}</p>}
    </div>
  );
}
