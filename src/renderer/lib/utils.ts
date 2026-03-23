import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function getShowInExplorerLabel() {
    return (window as any).env?.PLATFORM === 'darwin' ? 'Open Finder' : 'Open Explorer';
}
