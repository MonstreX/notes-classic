import React, { useMemo } from 'react';
import JoditEditor from 'jodit-react';
import 'jodit/es2015/jodit.min.css';

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
}

const Editor: React.FC<EditorProps> = ({ content, onChange }) => {
  const config = useMemo(() => ({
    readonly: false,
    toolbarAdaptive: false,
    statusbar: false,
    spellcheck: true,
    showCharsCounter: false,
    showWordsCounter: false,
    showXPathInStatusbar: false,
    autofocus: false,
    askBeforePasteHTML: false,
    askBeforePasteFromWord: false,
    enter: 'P',
    buttons: [
      'bold',
      'italic',
      'underline',
      '|',
      'ul',
      'ol',
      '|',
      'link',
      'image',
      '|',
      'undo',
      'redo',
    ],
    buttonsMD: [
      'bold',
      'italic',
      'underline',
      '|',
      'ul',
      'ol',
      '|',
      'link',
      'image',
      '|',
      'undo',
      'redo',
    ],
    buttonsSM: [
      'bold',
      'italic',
      '|',
      'ul',
      'ol',
      '|',
      'link',
      '|',
      'undo',
      'redo',
    ],
    buttonsXS: [
      'bold',
      'italic',
      '|',
      'ul',
      'ol',
      '|',
      'undo',
      'redo',
    ],
    cleanHTML: {
      fillEmptyParagraph: false,
      removeEmptyElements: false,
    },
    style: {
      minHeight: '500px',
    },
  }), []);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 overflow-y-auto px-10 pb-8 pt-0 notes-editor">
        <JoditEditor
          value={content}
          config={config}
          onChange={(value) => onChange(value)}
        />
      </div>
    </div>
  );
};

export default Editor;
