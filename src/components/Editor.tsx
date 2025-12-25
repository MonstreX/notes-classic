import React, { useMemo } from 'react';
import JoditEditor from 'jodit-react';
import 'jodit/es2015/jodit.min.css';

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
}

const Editor: React.FC<EditorProps> = ({ content, onChange }) => {
  const config = useMemo(() => {
    const findCallout = (node: Node | null, root: HTMLElement) => {
      let current = node;
      while (current && current !== root) {
        if (current.nodeType === 1 && (current as HTMLElement).classList.contains('note-callout')) {
          return current as HTMLElement;
        }
        current = current.parentNode;
      }
      return null;
    };

    const fragmentHasContent = (fragment: DocumentFragment) => {
      if (fragment.textContent && fragment.textContent.trim().length > 0) return true;
      return !!fragment.querySelector('img,table,ul,ol,li,hr,pre,blockquote');
    };

    const isRangeAtStart = (callout: HTMLElement, range: Range) => {
      const test = range.cloneRange();
      test.selectNodeContents(callout);
      test.setEnd(range.startContainer, range.startOffset);
      return !fragmentHasContent(test.cloneContents());
    };

    const isRangeAtEnd = (callout: HTMLElement, range: Range) => {
      const test = range.cloneRange();
      test.selectNodeContents(callout);
      test.setStart(range.endContainer, range.endOffset);
      return !fragmentHasContent(test.cloneContents());
    };

    const isCalloutEmpty = (callout: HTMLElement) => {
      if (callout.textContent && callout.textContent.trim().length > 0) return false;
      return !callout.querySelector('img,table,ul,ol,li,hr,pre,blockquote');
    };

    return {
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
      'callout',
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
      'callout',
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
      'callout',
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
      'callout',
      '|',
      'undo',
      'redo',
    ],
    commandToHotkeys: {
      callout: 'ctrl+l',
    },
    controls: {
      callout: {
        tooltip: 'Callout',
        text: 'C',
        exec: (editor: any) => {
          if (!editor || !editor.s || editor.s.isCollapsed()) return;
          const range = editor.s.range;
          const isInsideCallout = (node: Node | null) => {
            let current = node;
            while (current && current !== editor.editor) {
              if (current.nodeType === 1 && (current as HTMLElement).classList.contains('note-callout')) {
                return true;
              }
              current = current.parentNode;
            }
            return false;
          };
          if (isInsideCallout(range.startContainer) || isInsideCallout(range.endContainer)) return;
          const wrapper = editor.createInside.element('div');
          wrapper.className = 'note-callout';
          const fragment = range.extractContents();
          wrapper.appendChild(fragment);
          range.insertNode(wrapper);
          editor.s.setCursorAfter(wrapper);
          editor.synchronizeValues();
        },
      },
    },
    cleanHTML: {
      fillEmptyParagraph: false,
      removeEmptyElements: false,
    },
    style: {
      minHeight: '500px',
    },
    events: {
      keydown: function (event: KeyboardEvent) {
        const editor: any = this;
        if (!editor || !editor.s) return;
        if (event.key !== 'Enter' && event.key !== 'Backspace' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Delete') return;
        if (!editor.s.range || !editor.s.isCollapsed()) return;
        const callout = findCallout(editor.s.range.startContainer, editor.editor);
        if (!callout) return;

        const range: Range = editor.s.range;

        if (event.key === 'Enter') {
          const block = editor.createInside.element(editor.o.enter || 'p');
          block.innerHTML = '<br>';
          range.deleteContents();
          range.insertNode(block);
          editor.s.setCursorIn(block);
          editor.synchronizeValues();
          event.preventDefault();
          event.stopPropagation();
          return false;
        }

        if (event.key === 'Backspace' && isRangeAtStart(callout, range)) {
          editor.s.setCursorBefore(callout);
          callout.remove();
          editor.synchronizeValues();
          event.preventDefault();
          event.stopPropagation();
          return false;
        }

        if (event.key === 'Delete' && isRangeAtEnd(callout, range)) {
          editor.s.setCursorAfter(callout);
          callout.remove();
          editor.synchronizeValues();
          event.preventDefault();
          event.stopPropagation();
          return false;
        }

        if (event.key === 'ArrowDown' && isRangeAtEnd(callout, range)) {
          editor.s.setCursorAfter(callout);
          event.preventDefault();
          event.stopPropagation();
          return false;
        }

        if (event.key === 'ArrowUp' && isRangeAtStart(callout, range)) {
          editor.s.setCursorBefore(callout);
          event.preventDefault();
          event.stopPropagation();
          return false;
        }
      },
      keyup: function () {
        const editor: any = this;
        if (!editor || !editor.s || !editor.s.range) return;
        const callout = findCallout(editor.s.range.startContainer, editor.editor);
        if (!callout) return;
        if (isCalloutEmpty(callout)) {
          editor.s.setCursorBefore(callout);
          callout.remove();
          editor.synchronizeValues();
        }
      },
    },
  };
  }, []);

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
