import React, { useCallback, useMemo, useRef } from 'react';
import JoditEditor from 'jodit-react';
import 'jodit/es2015/jodit.min.css';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import php from 'highlight.js/lib/languages/php';
import 'highlight.js/styles/github.css';
import { writeText } from '@tauri-apps/api/clipboard';

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
}

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('php', php);

const DEBUG_CODE = false;

const Editor: React.FC<EditorProps> = ({ content, onChange }) => {
  const extractCodeText = useCallback((code: HTMLElement, mutate: boolean) => {
    const clone = code.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-jodit-selection_marker]').forEach((el) => el.remove());
    clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    const raw = clone.textContent || '';
    const text = raw.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n');
    if (mutate) {
      code.textContent = text;
    }
    return text;
  }, []);

  const applyHighlightToEditor = useCallback((editor: any) => {
    if (!editor || !editor.editor) return;
    if (DEBUG_CODE) {
      console.log('[note-code] highlight run', {
        blocks: editor.editor.querySelectorAll('.note-code').length,
      });
    }
    editor.editor.querySelectorAll('.note-code').forEach((block: HTMLElement) => {
      const code = block.querySelector('code') as HTMLElement | null;
      if (!code) return;
      const lang = block.getAttribute('data-lang') || 'auto';
      const text = extractCodeText(code, true);
      if (DEBUG_CODE) {
        console.log('[note-code] block', {
          lang,
          textLength: text.length,
          sample: text.slice(0, 80),
        });
      }
      if (!text.trim()) return;
      if (lang !== 'auto') {
        const mapped = lang === 'js' ? 'javascript' : lang === 'html' ? 'xml' : lang;
        try {
          const result = hljs.highlight(text, { language: mapped });
          code.innerHTML = result.value;
          code.className = `hljs language-${mapped}`;
        } catch (e) {}
        return;
      }
      try {
        const result = hljs.highlightAuto(text, ['php', 'html', 'javascript', 'css']);
        code.innerHTML = result.value;
        code.className = result.language ? `hljs language-${result.language}` : 'hljs';
      } catch (e) {}
    });
  }, [extractCodeText]);

  const joditRef = useRef<any>(null);

  const setupCodeToolbarHandlers = useCallback(
    (editor: any) => {
      if (!editor || !editor.editor) return;
      if ((editor as any).__noteCodeSetup) return;
      (editor as any).__noteCodeSetup = true;

      if (DEBUG_CODE) {
        console.log('[note-code] attach');
      }

      editor.editor.addEventListener(
        'change',
        (event: Event) => {
          const target = event.target as HTMLElement | null;
          if (!target) return;
          if (target.classList.contains('note-code-select')) {
            const block = target.closest('.note-code') as HTMLElement | null;
            if (!block) return;
            const lang = (target as HTMLSelectElement).value;
            block.setAttribute('data-lang', lang);
            applyHighlightToEditor(editor);
          }
        },
        true
      );

      editor.editor.addEventListener(
        'click',
        async (event: Event) => {
          const target = event.target as HTMLElement | null;
          if (!target) return;
          if (target.classList.contains('note-code-copy')) {
            const block = target.closest('.note-code') as HTMLElement | null;
            if (!block) return;
            const code = block.querySelector('code') as HTMLElement | null;
            if (!code) return;
            const text = extractCodeText(code, false);
            if (!text) return;
            try {
              await writeText(text);
              return;
            } catch (e) {}
            try {
              await navigator.clipboard.writeText(text);
            } catch (e) {}
          }
        },
        true
      );
    },
    [applyHighlightToEditor, extractCodeText]
  );

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

    const findCodeBlock = (node: Node | null, root: HTMLElement) => {
      let current = node;
      while (current && current !== root) {
        if (current.nodeType === 1 && (current as HTMLElement).classList.contains('note-code')) {
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

    const isBlockEmpty = (block: HTMLElement) => {
      if (block.textContent && block.textContent.trim().length > 0) return false;
      return !block.querySelector('img,table,ul,ol,li,hr,pre,blockquote,code');
    };

    return {
    readonly: false,
    toolbarAdaptive: false,
    iframe: false,
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
      'codeblock',
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
      'codeblock',
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
      'codeblock',
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
      'codeblock',
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
      codeblock: {
        tooltip: 'Code Block',
        text: '</>',
        exec: (editor: any) => {
          if (!editor || !editor.s || editor.s.isCollapsed()) return;
          const range: Range = editor.s.range;
          const isInsideBlock = (node: Node | null) => {
            let current = node;
            while (current && current !== editor.editor) {
              if (current.nodeType === 1) {
                const el = current as HTMLElement;
                if (el.classList.contains('note-code') || el.classList.contains('note-callout')) {
                  return true;
                }
              }
              current = current.parentNode;
            }
            return false;
          };
          if (isInsideBlock(range.startContainer) || isInsideBlock(range.endContainer)) return;
          const fragment = range.extractContents();
          const temp = document.createElement('div');
          temp.appendChild(fragment);
          temp.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
          const text = (temp.textContent || '').replace(/\u00a0/g, ' ');
          if (!text.trim()) return;
          const wrapper = editor.createInside.element('div');
          wrapper.className = 'note-code';
          wrapper.setAttribute('data-lang', 'auto');

          const toolbar = editor.createInside.element('div');
          toolbar.className = 'note-code-toolbar';
          toolbar.setAttribute('contenteditable', 'false');

          const select = editor.createInside.element('select');
          select.className = 'note-code-select';
          const langs = ['auto', 'php', 'html', 'js', 'css'];
          langs.forEach((lang) => {
            const opt = editor.createInside.element('option');
            opt.value = lang;
            opt.textContent = lang.toUpperCase();
            if (lang === 'auto') opt.selected = true;
            select.appendChild(opt);
          });

          const button = editor.createInside.element('button');
          button.className = 'note-code-copy';
          button.type = 'button';
          button.textContent = 'Copy';

          toolbar.appendChild(select);
          toolbar.appendChild(button);

          const pre = editor.createInside.element('pre');
          const code = editor.createInside.element('code');
          code.textContent = text;
          pre.appendChild(code);

          wrapper.appendChild(toolbar);
          wrapper.appendChild(pre);

          range.insertNode(wrapper);
          editor.s.setCursorIn(code);
          editor.synchronizeValues();
          applyHighlightToEditor(editor);
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
        const codeBlock = findCodeBlock(editor.s.range.startContainer, editor.editor);
        const block = codeBlock || callout;
        if (!block) return;

        const range: Range = editor.s.range;

        if (event.key === 'Enter') {
          if (codeBlock) {
            const textNode = editor.createInside.text('\n');
            range.deleteContents();
            range.insertNode(textNode);
            editor.s.setCursorAfter(textNode);
            editor.synchronizeValues();
            event.preventDefault();
            event.stopPropagation();
            return false;
          } else {
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
        }

        if (event.key === 'Backspace' && isRangeAtStart(block, range)) {
          editor.s.setCursorBefore(block);
          block.remove();
          editor.synchronizeValues();
          event.preventDefault();
          event.stopPropagation();
          return false;
        }

        if (event.key === 'Delete' && isRangeAtEnd(block, range)) {
          editor.s.setCursorAfter(block);
          block.remove();
          editor.synchronizeValues();
          event.preventDefault();
          event.stopPropagation();
          return false;
        }

        if (event.key === 'ArrowDown' && isRangeAtEnd(block, range)) {
          editor.s.setCursorAfter(block);
          event.preventDefault();
          event.stopPropagation();
          return false;
        }

        if (event.key === 'ArrowUp' && isRangeAtStart(block, range)) {
          editor.s.setCursorBefore(block);
          event.preventDefault();
          event.stopPropagation();
          return false;
        }
      },
      keyup: function () {
        const editor: any = this;
        if (!editor || !editor.s || !editor.s.range) return;
        const callout = findCallout(editor.s.range.startContainer, editor.editor);
        const codeBlock = findCodeBlock(editor.s.range.startContainer, editor.editor);
        const block = codeBlock || callout;
        if (!block) return;
        if (isBlockEmpty(block)) {
          editor.s.setCursorBefore(block);
          block.remove();
          editor.synchronizeValues();
        }
      },
      blur: function () {
        const editor: any = this;
        if (!editor || !editor.editor) return;
        applyHighlightToEditor(editor);
      },
      afterSetValue: function () {
        const editor: any = this;
        if (!editor || !editor.editor) return;
        window.setTimeout(() => {
          applyHighlightToEditor(editor);
        }, 0);
      },
      change: function () {
        const editor: any = this;
        if (!editor || !editor.editor) return;
        const selection = editor.s?.range;
        const active = selection ? (findCodeBlock(selection.startContainer, editor.editor) || findCallout(selection.startContainer, editor.editor)) : null;
        if (active && isBlockEmpty(active)) {
          active.remove();
          editor.synchronizeValues();
        }
        if (!selection || !findCodeBlock(selection.startContainer, editor.editor)) {
          applyHighlightToEditor(editor);
        }
      },
    },
  };
  }, [applyHighlightToEditor]);

  const handleEditorRef = useCallback(
    (instance: any) => {
      if (!instance) return;
      if (joditRef.current === instance) return;
      joditRef.current = instance;
      setupCodeToolbarHandlers(instance);
      applyHighlightToEditor(instance);
    },
    [applyHighlightToEditor, setupCodeToolbarHandlers]
  );

  const handleChange = useCallback(
    (value: string) => {
      onChange(value);
      const editor = joditRef.current;
      if (!editor) return;
      window.setTimeout(() => {
        applyHighlightToEditor(editor);
      }, 0);
    },
    [onChange, applyHighlightToEditor]
  );

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 overflow-y-auto px-10 pb-8 pt-0 notes-editor">
        <JoditEditor
          value={content}
          config={config}
          editorRef={handleEditorRef}
          onChange={handleChange}
        />
      </div>
    </div>
  );
};

export default Editor;
