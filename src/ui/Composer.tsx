import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Bold, Code, Italic, Strikethrough } from 'lucide-react';
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type EditorState,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { AutoLinkPlugin } from '@lexical/react/LexicalAutoLinkPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode, ListNode } from '@lexical/list';
import { CodeNode } from '@lexical/code';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { mergeRegister } from '@lexical/utils';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  CODE,
  HEADING,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  UNORDERED_LIST,
  type Transformer,
} from '@lexical/markdown';
import { findLink } from './markdown';
import { MESSAGE_LIMIT } from './format';
import { readSession, usePrefersFinePointer, writeSession } from './hooks';

const COUNTDOWN_FROM = 200;
// Below the server's 6s typing lifetime, so a steady typist never flickers off.
const TYPING_REFRESH = 3_000;

/*
 * The composer is a small rich-text editor: Markdown typed into it turns into formatting as you
 * go (`**bold**`, `- ` lists, `# ` headings, `> ` quotes, ``` code), and what's sent is Markdown.
 * Only syntax the message renderer understands is enabled, so a message looks the same before
 * and after sending. `*` italics only apply at word boundaries, so `2*3*4` stays literal.
 */
const TRANSFORMERS: Transformer[] = [
  HEADING,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  CODE,
  INLINE_CODE,
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  { ...ITALIC_STAR, intraword: false },
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  LINK,
];

const THEME = {
  paragraph: 'rc-p',
  quote: 'rc-quote',
  heading: { h1: 'rc-h1', h2: 'rc-h2', h3: 'rc-h3', h4: 'rc-h4', h5: 'rc-h4', h6: 'rc-h4' },
  list: { ul: 'rc-ul', ol: 'rc-ol', listitem: 'rc-li', nested: { listitem: 'rc-li-nested' } },
  code: 'rc-pre',
  link: 'rc-link',
  text: { bold: 'rc-b', italic: 'rc-i', strikethrough: 'rc-s', code: 'rc-code' },
};

const toMarkdown = () => $convertToMarkdownString(TRANSFORMERS, undefined, true);
const fromMarkdown = (md: string) => $convertFromMarkdownString(md, TRANSFORMERS, undefined, true);

const MATCHERS = [
  (text: string) => {
    const m = findLink(text);
    return m && { index: m.index, length: m.text.length, text: m.text, url: m.href };
  },
];

type Format = { type: TextFormatType; label: string; keys: string; icon: ReactNode };
const FORMATS: Format[] = [
  { type: 'bold', label: 'Bold', keys: '⌘B', icon: <Bold size={14} strokeWidth={2.6} /> },
  { type: 'italic', label: 'Italic', keys: '⌘I', icon: <Italic size={14} strokeWidth={2.4} /> },
  { type: 'strikethrough', label: 'Strikethrough', keys: '⌘⇧X', icon: <Strikethrough size={14} strokeWidth={2.4} /> },
  { type: 'code', label: 'Code', keys: '⌘E', icon: <Code size={14} strokeWidth={2.4} /> },
];

export function Composer({
  draftKey,
  spaceName,
  onSend,
  onTyping,
  isQueued,
}: {
  draftKey: string;
  spaceName: string;
  onSend: (body: string) => Promise<void>;
  onTyping: (typing: boolean) => void;
  isQueued: (body: string) => boolean;
}) {
  const [initial] = useState(() => readSession(draftKey));
  const [markdown, setMarkdown] = useState(initial);
  return (
    <LexicalComposer
      initialConfig={{
        namespace: 'composer',
        theme: THEME,
        nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode, AutoLinkNode],
        editorState: initial ? () => fromMarkdown(initial) : undefined,
        onError: (error: Error) => console.error(error),
      }}
    >
      <ComposerBody
        draftKey={draftKey}
        spaceName={spaceName}
        markdown={markdown}
        setMarkdown={setMarkdown}
        onSend={onSend}
        onTyping={onTyping}
        isQueued={isQueued}
      />
    </LexicalComposer>
  );
}

function ComposerBody({
  draftKey,
  spaceName,
  markdown,
  setMarkdown,
  onSend,
  onTyping,
  isQueued,
}: {
  draftKey: string;
  spaceName: string;
  markdown: string;
  setMarkdown: (md: string) => void;
  onSend: (body: string) => Promise<void>;
  onTyping: (typing: boolean) => void;
  isQueued: (body: string) => boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const fine = usePrefersFinePointer();
  const [active, setActive] = useState<Set<TextFormatType> | null>(null);
  const body = markdown.trim();
  const remaining = MESSAGE_LIMIT - body.length;
  const canSend = body.length > 0 && remaining >= 0;
  // Commands registered once read the latest send() through a ref.
  const sendRef = useRef<() => void>(() => {});

  useEffect(() => {
    writeSession(draftKey, markdown);
  }, [draftKey, markdown]);

  // Typing signal: refresh every few seconds while there's text, stop when it empties or the composer
  // closes. The latest callback is kept in a ref so unmounting reports to the space it belonged to.
  const typingRef = useRef({ onTyping, sentAt: 0 });
  typingRef.current.onTyping = onTyping;
  useEffect(() => {
    const t = typingRef.current;
    if (body) {
      if (Date.now() - t.sentAt > TYPING_REFRESH) {
        t.sentAt = Date.now();
        t.onTyping(true);
      }
    } else if (t.sentAt) {
      t.sentAt = 0;
      t.onTyping(false);
    }
  }, [body]);
  useEffect(() => {
    const t = typingRef.current;
    return () => {
      if (t.sentAt) t.onTyping(false);
    };
  }, []);

  useEffect(() => {
    if (fine) editor.focus(undefined, { defaultSelection: 'rootEnd' });
  }, [editor, fine]);

  sendRef.current = () => {
    if (!canSend) return;
    const text = body;
    reset(editor, '');
    writeSession(draftKey, '');
    // The parent owns the durable queue; queued failures surface as a retryable bubble.
    // If the send never made it into the queue, hand the text back instead of losing it.
    const restore = () => {
      if (isQueued(text)) return;
      if (!editor.getEditorState().read(() => $getRoot().getTextContent().trim())) reset(editor, text);
    };
    try {
      onSend(text).catch(restore);
    } catch {
      restore();
    }
    editor.focus();
  };

  useEffect(
    () =>
      mergeRegister(
        // Enter sends on keyboards; Shift+Enter (and Enter on touch keyboards) makes a new line, list item or code line.
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (e) => {
            if (!e || e.isComposing) return false;
            if (e.shiftKey) {
              // A real new block (next list item, out of a heading), not a soft break inside the current one.
              e.preventDefault();
              editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
              return true;
            }
            if (!fine) return false;
            e.preventDefault();
            sendRef.current();
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        // Underline has no Markdown form, so ⌘U would be silently dropped on send; don't offer it.
        editor.registerCommand(FORMAT_TEXT_COMMAND, (format) => format === 'underline', COMMAND_PRIORITY_CRITICAL),
        editor.registerCommand(
          KEY_DOWN_COMMAND,
          (e) => {
            if (!(e.metaKey || e.ctrlKey)) return false;
            const key = e.key.toLowerCase();
            const format: TextFormatType | null = key === 'e' ? 'code' : key === 'x' && e.shiftKey ? 'strikethrough' : null;
            if (!format) return false;
            e.preventDefault();
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            syncFormats();
            return false;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerUpdateListener(() => syncFormats()),
      ),
    [editor, fine],
  );

  function syncFormats() {
    editor.getEditorState().read(() => {
      const sel = $getSelection();
      const focused = editor.getRootElement()?.contains(document.activeElement);
      if (!focused || !$isRangeSelection(sel) || sel.isCollapsed()) return setActive(null);
      setActive(new Set(FORMATS.map((f) => f.type).filter((t) => sel.hasFormat(t))));
    });
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        sendRef.current();
      }}
    >
      <AnimatePresence>
        {active && (
          <motion.div
            className="format-bar"
            role="toolbar"
            aria-label="Format text"
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 600, damping: 34 }}
          >
            {FORMATS.map((f) => (
              <button
                key={f.type}
                type="button"
                className="format-btn"
                aria-label={f.label}
                aria-pressed={active.has(f.type)}
                title={`${f.label}  ${f.keys}`}
                // Keep the editor's selection: act on press, before focus moves.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, f.type)}
              >
                {f.icon}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="capsule">
        <div className="composer-field">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="composer-input rc"
                aria-label={`Message ${spaceName}`}
                aria-describedby={remaining <= COUNTDOWN_FROM ? 'composer-count' : undefined}
                aria-placeholder={`Message ${spaceName}`}
                placeholder={<div className="composer-placeholder">Message {spaceName}</div>}
                spellCheck
                onBlur={() => setActive(null)}
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <AnimatePresence>
          {remaining <= COUNTDOWN_FROM && (
            <motion.span
              id="composer-count"
              className="composer-count"
              data-over={remaining < 0 || undefined}
              aria-live="polite"
              aria-label={remaining < 0 ? `${-remaining} characters over the limit` : `${remaining} characters left`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              {remaining}
            </motion.span>
          )}
        </AnimatePresence>
        <button type="submit" className="send" disabled={!canSend} aria-label="Send" title="Send">
          <ArrowUp size={15} strokeWidth={2.4} />
        </button>
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin validateUrl={(url) => /^(https?:|mailto:)/i.test(url)} />
      <AutoLinkPlugin matchers={MATCHERS} />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <OnChangePlugin ignoreSelectionChange onChange={(state: EditorState) => state.read(() => setMarkdown(toMarkdown()))} />
    </form>
  );
}

function reset(editor: LexicalEditor, md: string) {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    if (md) fromMarkdown(md);
    else root.append($createParagraphNode());
  });
}
