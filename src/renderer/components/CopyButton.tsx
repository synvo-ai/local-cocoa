import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '../lib/utils';

interface CopyButtonProps {
    text: string;
    isUser?: boolean;
    className?: string;
    iconSize?: number;
}

export const CopyButton = ({ 
    text, 
    isUser = false, 
    className,
    iconSize = 14
}: CopyButtonProps) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy text:', err);
        }
    };

    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                handleCopy();
            }}
            className={cn(
                "p-1.5 rounded-md transition-all duration-200 z-20",
                isUser 
                    ? "bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground" 
                    : "bg-background/50 hover:bg-background text-muted-foreground hover:text-foreground border shadow-sm",
                className
            )}
            title="Copy message"
        >
            {copied ? (
                <Check style={{ width: iconSize, height: iconSize }} />
            ) : (
                <Copy style={{ width: iconSize, height: iconSize }} />
            )}
        </button>
    );
};
