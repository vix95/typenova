/** Welcome document text and the initial editor content. */
import { showWelcomeWhenNoSession } from "./document-state";

export const startText = `# Welcome to TypeNova

A modern Markdown editor for focused writing and knowledge building.

## Key Features
- Fast and responsive editing with syntax highlighting
- Live Markdown preview with code, tables and task lists
- Mathematics support: $E = mc^2$ or block equations
- Diagrams with Mermaid
- Local images and online images
- Project folder with file explorer
- Table of contents and document navigation
- Auto-save and version history
- Distraction-free focus mode

## Getting Started
1. Open a folder or create a new document.
2. Start writing Markdown on the left.
3. See the formatted result on the right.
4. Use Ctrl+K to quickly find commands.

## Example
\`\`\`python
def greet(name: str) -> str:
    return f"Hello, {name}!"

print(greet("TypeNova"))
\`\`\`

> TypeNova is a fast, private workspace for writing, thinking and building knowledge.
`;
export const initialDocumentText = showWelcomeWhenNoSession ? startText : "";
