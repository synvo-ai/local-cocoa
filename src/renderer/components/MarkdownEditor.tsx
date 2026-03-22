import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { marked } from 'marked';
import TurndownService from 'turndown';
import {
    Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
    List, ListOrdered, Quote, Minus,
} from 'lucide-react';
import { cn } from '../lib/utils';

// Module-level singleton — no need to re-create on every render
const turndownService = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });

export interface MarkdownEditorHandle {
    focus(): void;
}

interface MarkdownEditorProps {
    value: string;
    onChange: (md: string) => void;
    placeholder?: string;
    /** CSS min-height applied to the content area (e.g. "8rem", "300px") */
    minHeight?: string;
    className?: string;
    onKeyDown?: (e: React.KeyboardEvent) => void;
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
    function MarkdownEditor({ value, onChange, placeholder, minHeight = '8rem', className, onKeyDown }, ref) {
        // Keep onChange stable in the onUpdate closure without recreating the editor
        const onChangeRef = useRef(onChange);
        useLayoutEffect(() => { onChangeRef.current = onChange; });

        // Track last value we set from props to detect external vs internal changes
        const externalValueRef = useRef(value);
        // Flag to suppress the onUpdate callback when we set content programmatically
        const suppressUpdateRef = useRef(false);

        const editor = useEditor({
            extensions: [
                StarterKit,
                Placeholder.configure({ placeholder: placeholder ?? 'Start writing...' }),
            ],
            content: String(marked.parse(value || '')),
            onUpdate({ editor }) {
                if (suppressUpdateRef.current) {
                    suppressUpdateRef.current = false;
                    return;
                }
                const md = turndownService.turndown(editor.getHTML());
                externalValueRef.current = md;
                onChangeRef.current(md);
            },
        });

        // Expose imperative focus so callers can focus the editor programmatically
        useImperativeHandle(ref, () => ({
            focus: () => { editor?.commands.focus(); },
        }), [editor]);

        // Sync external value changes into the editor (e.g. switching notes)
        useEffect(() => {
            if (!editor || value === externalValueRef.current) return;
            externalValueRef.current = value;
            suppressUpdateRef.current = true;
            editor.commands.setContent(String(marked.parse(value || '')));
        }, [value, editor]);

        return (
            <div className={cn('markdown-editor-wrapper rounded-lg border bg-background shadow-sm overflow-hidden flex flex-col', className)}>
                {/* ——— Toolbar ——— */}
                <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b bg-muted/30 flex-shrink-0">
                    <ToolbarButton
                        active={editor?.isActive('heading', { level: 1 }) ?? false}
                        onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
                        title="Heading 1"
                    ><Heading1 className="h-3.5 w-3.5" /></ToolbarButton>
                    <ToolbarButton
                        active={editor?.isActive('heading', { level: 2 }) ?? false}
                        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
                        title="Heading 2"
                    ><Heading2 className="h-3.5 w-3.5" /></ToolbarButton>
                    <ToolbarButton
                        active={editor?.isActive('heading', { level: 3 }) ?? false}
                        onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
                        title="Heading 3"
                    ><Heading3 className="h-3.5 w-3.5" /></ToolbarButton>

                    <div className="w-px h-4 bg-border mx-1" />

                    <ToolbarButton
                        active={editor?.isActive('bold') ?? false}
                        onClick={() => editor?.chain().focus().toggleBold().run()}
                        title="Bold (⌘B)"
                    ><Bold className="h-3.5 w-3.5" /></ToolbarButton>
                    <ToolbarButton
                        active={editor?.isActive('italic') ?? false}
                        onClick={() => editor?.chain().focus().toggleItalic().run()}
                        title="Italic (⌘I)"
                    ><Italic className="h-3.5 w-3.5" /></ToolbarButton>
                    <ToolbarButton
                        active={editor?.isActive('strike') ?? false}
                        onClick={() => editor?.chain().focus().toggleStrike().run()}
                        title="Strikethrough"
                    ><Strikethrough className="h-3.5 w-3.5" /></ToolbarButton>

                    <div className="w-px h-4 bg-border mx-1" />

                    <ToolbarButton
                        active={editor?.isActive('blockquote') ?? false}
                        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
                        title="Blockquote"
                    ><Quote className="h-3.5 w-3.5" /></ToolbarButton>
                    <ToolbarButton
                        active={editor?.isActive('bulletList') ?? false}
                        onClick={() => editor?.chain().focus().toggleBulletList().run()}
                        title="Bullet list"
                    ><List className="h-3.5 w-3.5" /></ToolbarButton>
                    <ToolbarButton
                        active={editor?.isActive('orderedList') ?? false}
                        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                        title="Ordered list"
                    ><ListOrdered className="h-3.5 w-3.5" /></ToolbarButton>

                    <div className="w-px h-4 bg-border mx-1" />

                    <ToolbarButton
                        active={false}
                        onClick={() => editor?.chain().focus().setHorizontalRule().run()}
                        title="Horizontal rule"
                    ><Minus className="h-3.5 w-3.5" /></ToolbarButton>
                </div>

                {/* ——— Content area ——— */}
                <div
                    className="markdown-editor-content flex-1 overflow-y-auto"
                    style={{ minHeight }}
                    onKeyDown={onKeyDown}
                >
                    <EditorContent editor={editor} />
                </div>
            </div>
        );
    }
);

function ToolbarButton({ active, onClick, title, children }: {
    active: boolean;
    onClick: () => void;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            // Use onMouseDown + preventDefault so the editor doesn't lose focus
            onMouseDown={(e) => { e.preventDefault(); onClick(); }}
            title={title}
            className={cn(
                'inline-flex items-center justify-center rounded p-1.5 transition-colors',
                active
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
        >
            {children}
        </button>
    );
}

export default MarkdownEditor;
