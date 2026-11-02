/** Data for the Mermaid editor: starter diagrams per type and quick-insert lines for each diagram kind. */

export interface MermaidTemplate { id: string; pl: string; en: string; source: string }
export interface QuickLine { pl: string; en: string; text: string }

export const MERMAID_TEMPLATES: MermaidTemplate[] = [
  { id: "flowchart", pl: "Schemat blokowy", en: "Flowchart", source: "flowchart TD\n  A[Start] --> B{Warunek?}\n  B -->|Tak| C[Akcja]\n  B -->|Nie| D[Koniec]\n  C --> D" },
  { id: "sequence", pl: "Diagram sekwencji", en: "Sequence diagram", source: "sequenceDiagram\n  participant U as Użytkownik\n  participant S as Serwer\n  U->>S: Żądanie\n  activate S\n  S-->>U: Odpowiedź\n  deactivate S\n  Note over U,S: Koniec sesji" },
  { id: "class", pl: "Diagram klas", en: "Class diagram", source: "classDiagram\n  class Zwierze {\n    +String imie\n    +dzwiek() void\n  }\n  class Pies\n  Zwierze <|-- Pies" },
  { id: "state", pl: "Diagram stanów", en: "State diagram", source: "stateDiagram-v2\n  [*] --> Nowy\n  Nowy --> WTrakcie: start\n  WTrakcie --> Gotowe: koniec\n  Gotowe --> [*]" },
  { id: "er", pl: "Diagram ER (baza danych)", en: "ER diagram (database)", source: "erDiagram\n  KLIENT ||--o{ ZAMOWIENIE : sklada\n  ZAMOWIENIE ||--|{ POZYCJA : zawiera\n  KLIENT {\n    int id\n    string nazwa\n  }" },
  { id: "gantt", pl: "Wykres Gantta", en: "Gantt chart", source: "gantt\n  title Harmonogram\n  dateFormat YYYY-MM-DD\n  section Etap 1\n  Analiza :a1, 2025-01-01, 7d\n  Projekt :after a1, 5d\n  section Etap 2\n  Wdrożenie :2025-01-15, 10d" },
  { id: "pie", pl: "Wykres kołowy", en: "Pie chart", source: "pie showData\n  title Podział czasu\n  \"Praca\" : 8\n  \"Sen\" : 7\n  \"Reszta\" : 9" },
  { id: "mindmap", pl: "Mapa myśli", en: "Mind map", source: "mindmap\n  root((Temat))\n    Pomysł A\n      Szczegół 1\n      Szczegół 2\n    Pomysł B" },
  { id: "journey", pl: "Ścieżka użytkownika", en: "User journey", source: "journey\n  title Dzień pracy\n  section Rano\n    Kawa: 5: Ja\n    Dojazd: 2: Ja\n  section Praca\n    Spotkanie: 3: Ja, Zespół" },
  { id: "timeline", pl: "Oś czasu", en: "Timeline", source: "timeline\n  title Historia projektu\n  2023 : Pomysł\n  2024 : Prototyp : Pierwsi użytkownicy\n  2025 : Wersja 1.0" },
  { id: "gitgraph", pl: "Graf Git", en: "Git graph", source: "gitGraph\n  commit\n  branch funkcja\n  checkout funkcja\n  commit\n  checkout main\n  merge funkcja" },
];

export const QUICK_LINES: Record<string, QuickLine[]> = {
  flowchart: [
    { pl: "Prostokąt", en: "Rectangle", text: "  A[Tekst]" },
    { pl: "Zaokrąglony", en: "Rounded", text: "  B(Tekst)" },
    { pl: "Stadion", en: "Stadium", text: "  C([Tekst])" },
    { pl: "Romb (decyzja)", en: "Diamond (decision)", text: "  D{Decyzja?}" },
    { pl: "Okrąg", en: "Circle", text: "  E((Tekst))" },
    { pl: "Baza danych", en: "Database", text: "  F[(Baza)]" },
    { pl: "Podprogram", en: "Subroutine", text: "  G[[Podprogram]]" },
    { pl: "Grupa (subgraph)", en: "Group (subgraph)", text: "  subgraph Grupa\n    X[Element]\n  end" },
  ],
  sequence: [
    { pl: "Uczestnik", en: "Participant", text: "  participant X as Nazwa" },
    { pl: "Wiadomość", en: "Message", text: "  A->>B: Wiadomość" },
    { pl: "Odpowiedź", en: "Reply", text: "  B-->>A: Odpowiedź" },
    { pl: "Notatka", en: "Note", text: "  Note over A,B: Notatka" },
    { pl: "Pętla", en: "Loop", text: "  loop Co minutę\n    A->>B: Ping\n  end" },
    { pl: "Warunek (alt)", en: "Alternative (alt)", text: "  alt Sukces\n    A->>B: OK\n  else Błąd\n    A->>B: Ponów\n  end" },
  ],
  class: [
    { pl: "Klasa", en: "Class", text: "  class Nazwa {\n    +String pole\n    +metoda() void\n  }" },
    { pl: "Dziedziczenie", en: "Inheritance", text: "  Rodzic <|-- Dziecko" },
    { pl: "Kompozycja", en: "Composition", text: "  Calosc *-- Czesc" },
    { pl: "Agregacja", en: "Aggregation", text: "  Calosc o-- Czesc" },
    { pl: "Asocjacja", en: "Association", text: "  A --> B" },
  ],
  state: [
    { pl: "Przejście", en: "Transition", text: "  A --> B: zdarzenie" },
    { pl: "Stan początkowy", en: "Start state", text: "  [*] --> Stan" },
    { pl: "Stan końcowy", en: "End state", text: "  Stan --> [*]" },
    { pl: "Stan złożony", en: "Composite state", text: "  state Zlozony {\n    [*] --> Wewnatrz\n  }" },
  ],
  er: [
    { pl: "Relacja 1 do wielu", en: "One to many", text: "  A ||--o{ B : ma" },
    { pl: "Relacja wiele do wielu", en: "Many to many", text: "  A }o--o{ B : laczy" },
    { pl: "Encja z polami", en: "Entity with fields", text: "  ENCJA {\n    int id\n    string nazwa\n  }" },
  ],
  gantt: [
    { pl: "Sekcja", en: "Section", text: "  section Nowa sekcja" },
    { pl: "Zadanie", en: "Task", text: "  Zadanie :2025-02-01, 5d" },
    { pl: "Kamień milowy", en: "Milestone", text: "  Kamień milowy :milestone, 2025-03-01, 0d" },
  ],
  pie: [{ pl: "Wycinek", en: "Slice", text: "  \"Etykieta\" : 10" }],
  mindmap: [{ pl: "Gałąź", en: "Branch", text: "    Nowa gałąź" }, { pl: "Pod-gałąź", en: "Sub-branch", text: "      Nowy szczegół" }],
  journey: [{ pl: "Sekcja", en: "Section", text: "  section Nowa sekcja" }, { pl: "Krok", en: "Step", text: "    Krok: 3: Ja" }],
  timeline: [{ pl: "Okres", en: "Period", text: "  2026 : Zdarzenie" }],
  gitgraph: [
    { pl: "Commit", en: "Commit", text: "  commit" },
    { pl: "Gałąź", en: "Branch", text: "  branch nowa" },
    { pl: "Przełącz", en: "Checkout", text: "  checkout nowa" },
    { pl: "Scal", en: "Merge", text: "  merge nowa" },
  ],
};

/** Node shapes and link styles offered by the flowchart builder. */
export const NODE_SHAPES: Array<{ pl: string; en: string; open: string; close: string }> = [
  { pl: "Prostokąt", en: "Rectangle", open: "[", close: "]" },
  { pl: "Zaokrąglony", en: "Rounded", open: "(", close: ")" },
  { pl: "Stadion", en: "Stadium", open: "([", close: "])" },
  { pl: "Podprogram", en: "Subroutine", open: "[[", close: "]]" },
  { pl: "Romb", en: "Diamond", open: "{", close: "}" },
  { pl: "Okrąg", en: "Circle", open: "((", close: "))" },
  { pl: "Baza danych", en: "Database", open: "[(", close: ")]" },
];

export const LINK_STYLES: Array<{ pl: string; en: string; arrow: string }> = [
  { pl: "Strzałka", en: "Arrow", arrow: "-->" },
  { pl: "Linia", en: "Line", arrow: "---" },
  { pl: "Przerywana", en: "Dotted", arrow: "-.->" },
  { pl: "Gruba", en: "Thick", arrow: "==>" },
];
