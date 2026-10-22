/** Snippet templates inserted from the toolbar and dialogs. */
export const snippets: Record<string, string> = {
  code: "```language\n// Twój kod\n```",
  python: "```python\ndef main():\n    print(\"Hello, TypeNova!\")\n\nif __name__ == \"__main__\":\n    main()\n```",
  javascript: "```javascript\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet(\"TypeNova\"));\n```",
  typescript: "```typescript\ntype Greeting = { name: string };\n\nconst greet = ({ name }: Greeting): string => `Hello, ${name}!`;\nconsole.log(greet({ name: \"TypeNova\" }));\n```",
  java: "```java\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println(\"Hello, TypeNova!\");\n    }\n}\n```",
  json: "```json\n{\n  \"name\": \"TypeNova\",\n  \"version\": \"0.5.6\"\n}\n```",
  math: "$$\n\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$",
  mermaid: "```mermaid\nflowchart TD\n  A[Start] --> B{Warunek?}\n  B -->|Tak| C[Akcja]\n  B -->|Nie| D[Koniec]\n```",
  table: "| Kolumna 1 | Kolumna 2 |\n| --- | --- |\n| Wartość | Wartość |",
  callout: "> [!NOTE]\n> Treść notatki.",
  frontmatter: "---\ntitle: Tytuł dokumentu\nauthor: Autor\ndate: 2026-10-12\ntags: []\n---\n"
};
