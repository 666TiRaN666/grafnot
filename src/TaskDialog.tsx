import { useState } from 'react';
import type { Lang } from './i18n';
import { tr } from './i18n';
import { Modal } from './widgets';

export interface TaskDraft {
  text: string;
  desc: string;
  due: string;
}

export function TaskDialog({
  lang,
  title,
  source,
  initial,
  onSave,
  onClose,
}: {
  lang: Lang;
  title: string;
  source?: string;
  initial: TaskDraft;
  onSave: (d: TaskDraft) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial.text);
  const [desc, setDesc] = useState(initial.desc);
  const [due, setDue] = useState(initial.due);
  const ok = text.trim().length > 0;

  return (
    <Modal title={title} lang={lang} onClose={onClose}>
      {source && (
        <div className="g-dlgsrc">
          {tr('fromSrc', lang)}: {source}
        </div>
      )}
      <input
        className="g-in"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={tr('addTaskPh', lang)}
        aria-label="title"
      />
      <textarea
        className="g-area"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder={tr('descPh', lang)}
        rows={3}
        aria-label="description"
      />
      <input
        type="date"
        className="g-date"
        value={due}
        onChange={(e) => setDue(e.target.value)}
        aria-label="due date"
      />
      <div className="g-modal-actions">
        <button type="button" className="g-btn" onClick={onClose}>
          {tr('cancelBtn', lang)}
        </button>
        <button
          type="button"
          className="g-btn primary"
          disabled={!ok}
          onClick={() => onSave({ text: text.trim(), desc: desc.trim(), due })}
        >
          {tr('saveBtn', lang)}
        </button>
      </div>
    </Modal>
  );
}
