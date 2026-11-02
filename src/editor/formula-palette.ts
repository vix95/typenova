/** Data for the math editor: symbol groups, structures and ready-made formulas (LaTeX, shown rendered by KaTeX). */

export interface PaletteItem {
  /** LaTeX shown on the button. */ show: string;
  /** LaTeX inserted into the field (`#?` marks a placeholder). Defaults to `show`. */ insert?: string;
  tip?: [string, string];
}
export interface PaletteGroup { id: string; pl: string; en: string; items: PaletteItem[] }
export interface FormulaTemplate { pl: string; en: string; latex: string }

const plain = (...latex: string[]): PaletteItem[] => latex.map(show => ({ show }));

export const PALETTE_GROUPS: PaletteGroup[] = [
  { id: "structures", pl: "Struktury", en: "Structures", items: [
    { show: "\\frac{a}{b}", insert: "\\frac{#?}{#?}", tip: ["Ułamek", "Fraction"] },
    { show: "\\sqrt{x}", insert: "\\sqrt{#?}", tip: ["Pierwiastek", "Square root"] },
    { show: "\\sqrt[n]{x}", insert: "\\sqrt[#?]{#?}", tip: ["Pierwiastek n-tego stopnia", "n-th root"] },
    { show: "x^{n}", insert: "#@^{#?}", tip: ["Potęga", "Superscript"] },
    { show: "x_{n}", insert: "#@_{#?}", tip: ["Indeks dolny", "Subscript"] },
    { show: "x_{i}^{n}", insert: "#@_{#?}^{#?}", tip: ["Indeks dolny i górny", "Sub- and superscript"] },
    { show: "\\sum_{i=1}^{n}", insert: "\\sum_{i=1}^{n}#?", tip: ["Suma", "Sum"] },
    { show: "\\prod_{i=1}^{n}", insert: "\\prod_{i=1}^{n}#?", tip: ["Iloczyn", "Product"] },
    { show: "\\int_{a}^{b}", insert: "\\int_{#?}^{#?}#?\\,\\mathrm{d}x", tip: ["Całka oznaczona", "Definite integral"] },
    { show: "\\oint", insert: "\\oint_{#?}#?", tip: ["Całka krzywoliniowa", "Contour integral"] },
    { show: "\\lim_{x\\to\\infty}", insert: "\\lim_{#?\\to #?}#?", tip: ["Granica", "Limit"] },
    { show: "\\binom{n}{k}", insert: "\\binom{#?}{#?}", tip: ["Symbol Newtona", "Binomial coefficient"] },
    { show: "\\begin{cases}x&a\\\\y&b\\end{cases}", insert: "\\begin{cases}#?&#?\\\\#?&#?\\end{cases}", tip: ["Układ przypadków", "Cases"] },
    { show: "\\begin{aligned}a&=b\\\\&=c\\end{aligned}", insert: "\\begin{aligned}#?&=#?\\\\&=#?\\end{aligned}", tip: ["Wyrównane równania", "Aligned equations"] },
  ] },
  { id: "matrices", pl: "Macierze", en: "Matrices", items: [
    { show: "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", insert: "\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}", tip: ["Macierz 2×2 w nawiasach okrągłych", "2×2 matrix in parentheses"] },
    { show: "\\begin{pmatrix}a&b&c\\\\d&e&f\\\\g&h&i\\end{pmatrix}", insert: "\\begin{pmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{pmatrix}", tip: ["Macierz 3×3 w nawiasach okrągłych", "3×3 matrix in parentheses"] },
    { show: "\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}", insert: "\\begin{bmatrix}#?&#?\\\\#?&#?\\end{bmatrix}", tip: ["Macierz 2×2 w nawiasach kwadratowych", "2×2 matrix in brackets"] },
    { show: "\\begin{bmatrix}a&b&c\\\\d&e&f\\end{bmatrix}", insert: "\\begin{bmatrix}#?&#?&#?\\\\#?&#?&#?\\end{bmatrix}", tip: ["Macierz 2×3 w nawiasach kwadratowych", "2×3 matrix in brackets"] },
    { show: "\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}", insert: "\\begin{vmatrix}#?&#?\\\\#?&#?\\end{vmatrix}", tip: ["Wyznacznik", "Determinant"] },
    { show: "\\begin{Bmatrix}a&b\\\\c&d\\end{Bmatrix}", insert: "\\begin{Bmatrix}#?&#?\\\\#?&#?\\end{Bmatrix}", tip: ["Macierz w nawiasach klamrowych", "Matrix in braces"] },
  ] },
  { id: "accents", pl: "Akcenty", en: "Accents", items: [
    { show: "\\bar{x}", insert: "\\bar{#@}", tip: ["Kreska nad (bar)", "Bar"] },
    { show: "\\overline{xy}", insert: "\\overline{#@}", tip: ["Długa kreska nad", "Overline"] },
    { show: "\\underline{xy}", insert: "\\underline{#@}", tip: ["Kreska pod", "Underline"] },
    { show: "\\hat{x}", insert: "\\hat{#@}", tip: ["Daszek", "Hat"] },
    { show: "\\widehat{xy}", insert: "\\widehat{#@}", tip: ["Szeroki daszek", "Wide hat"] },
    { show: "\\tilde{x}", insert: "\\tilde{#@}", tip: ["Tylda", "Tilde"] },
    { show: "\\vec{v}", insert: "\\vec{#@}", tip: ["Wektor", "Vector"] },
    { show: "\\overrightarrow{AB}", insert: "\\overrightarrow{#@}", tip: ["Strzałka w prawo nad", "Arrow over (right)"] },
    { show: "\\overleftarrow{AB}", insert: "\\overleftarrow{#@}", tip: ["Strzałka w lewo nad", "Arrow over (left)"] },
    { show: "\\dot{x}", insert: "\\dot{#@}", tip: ["Kropka (pochodna po czasie)", "Dot (time derivative)"] },
    { show: "\\ddot{x}", insert: "\\ddot{#@}", tip: ["Dwie kropki", "Double dot"] },
    { show: "\\breve{x}", insert: "\\breve{#@}", tip: ["Łuk", "Breve"] },
    { show: "\\check{x}", insert: "\\check{#@}", tip: ["Haczyk", "Check"] },
    { show: "\\acute{x}", insert: "\\acute{#@}", tip: ["Akcent ostry", "Acute"] },
    { show: "\\grave{x}", insert: "\\grave{#@}", tip: ["Akcent słaby", "Grave"] },
    { show: "\\overbrace{xy}^{n}", insert: "\\overbrace{#@}^{#?}", tip: ["Klamra nad z opisem", "Brace over with a label"] },
    { show: "\\underbrace{xy}_{n}", insert: "\\underbrace{#@}_{#?}", tip: ["Klamra pod z opisem", "Brace under with a label"] },
  ] },
  { id: "decorations", pl: "Dekoracje", en: "Decorations", items: [
    { show: "\\boxed{x}", insert: "\\boxed{#@}", tip: ["Ramka wokół", "Box around"] },
    { show: "\\cancel{x}", insert: "\\cancel{#@}", tip: ["Przekreślenie ukośne", "Cancel (slash)"] },
    { show: "\\bcancel{x}", insert: "\\bcancel{#@}", tip: ["Przekreślenie ukośne w drugą stronę", "Cancel (back slash)"] },
    { show: "\\xcancel{x}", insert: "\\xcancel{#@}", tip: ["Przekreślenie krzyżowe", "Cancel (cross)"] },
    { show: "\\overset{a}{=}", insert: "\\overset{#?}{#@}", tip: ["Symbol nad", "Symbol over"] },
    { show: "\\underset{a}{=}", insert: "\\underset{#?}{#@}", tip: ["Symbol pod", "Symbol under"] },
    { show: "\\stackrel{!}{=}", insert: "\\stackrel{#?}{#@}", tip: ["Symbol nad relacją", "Symbol stacked over a relation"] },
    { show: "\\phantom{x}", insert: "\\phantom{#@}", tip: ["Niewidoczne miejsce", "Invisible space"] },
    { show: "\\displaystyle\\sum", insert: "\\displaystyle #@", tip: ["Duży styl (displaystyle)", "Display style"] },
    { show: "\\mathrm{x}", insert: "\\mathrm{#@}", tip: ["Pismo proste", "Upright text"] },
    { show: "\\mathbf{x}", insert: "\\mathbf{#@}", tip: ["Pogrubienie", "Bold"] },
    { show: "\\boldsymbol{x}", insert: "\\boldsymbol{#@}", tip: ["Pogrubiony symbol", "Bold symbol"] },
  ] },
  { id: "calculus", pl: "Analiza i liczby", en: "Calculus and numbers", items: [
    { show: "\\frac{\\mathrm{d}}{\\mathrm{d}x}", insert: "\\frac{\\mathrm{d}}{\\mathrm{d}x}#?", tip: ["Pochodna", "Derivative"] },
    { show: "\\frac{\\mathrm{d}^n}{\\mathrm{d}x^n}", insert: "\\frac{\\mathrm{d}^{#?}}{\\mathrm{d}x^{#?}}#?", tip: ["Pochodna n-tego rzędu", "n-th derivative"] },
    { show: "\\frac{\\partial}{\\partial x}", insert: "\\frac{\\partial}{\\partial x}#?", tip: ["Pochodna cząstkowa", "Partial derivative"] },
    { show: "\\iint", insert: "\\iint_{#?}#?", tip: ["Całka podwójna", "Double integral"] },
    { show: "\\iiint", insert: "\\iiint_{#?}#?", tip: ["Całka potrójna", "Triple integral"] },
    { show: "\\int_{-\\infty}^{\\infty}", insert: "\\int_{-\\infty}^{\\infty}#?\\,\\mathrm{d}x", tip: ["Całka po całej osi", "Integral over the whole line"] },
    { show: "\\left|x\\right|", insert: "\\left|#?\\right|", tip: ["Wartość bezwzględna", "Absolute value"] },
    { show: "\\lVert x\\rVert", insert: "\\lVert #?\\rVert", tip: ["Norma", "Norm"] },
    { show: "\\log_a(x)", insert: "\\log_{#?}(#?)", tip: ["Logarytm o podstawie a", "Logarithm base a"] },
    { show: "\\lvert z\\rvert", insert: "\\lvert #?\\rvert", tip: ["Moduł liczby zespolonej", "Modulus"] },
    { show: "\\arg(z)", insert: "\\arg(#?)", tip: ["Argument", "Argument"] },
    { show: "\\Re(z)", insert: "\\Re(#?)", tip: ["Część rzeczywista", "Real part"] },
    { show: "\\Im(z)", insert: "\\Im(#?)", tip: ["Część urojona", "Imaginary part"] },
    { show: "\\overline{z}", insert: "\\overline{#?}", tip: ["Sprzężenie", "Conjugate"] },
  ] },
  { id: "greek", pl: "Greka", en: "Greek", items: plain(
    "\\alpha", "\\beta", "\\gamma", "\\delta", "\\epsilon", "\\varepsilon", "\\zeta", "\\eta", "\\theta", "\\vartheta", "\\iota", "\\kappa", "\\lambda", "\\mu",
    "\\nu", "\\xi", "\\pi", "\\rho", "\\sigma", "\\tau", "\\upsilon", "\\phi", "\\varphi", "\\chi", "\\psi", "\\omega",
    "\\Gamma", "\\Delta", "\\Theta", "\\Lambda", "\\Xi", "\\Pi", "\\Sigma", "\\Phi", "\\Psi", "\\Omega") },
  { id: "operators", pl: "Operatory", en: "Operators", items: plain(
    "+", "-", "\\pm", "\\mp", "\\times", "\\div", "\\cdot", "\\ast", "\\star", "\\circ", "\\oplus", "\\otimes", "\\cup", "\\cap", "\\setminus",
    "\\wedge", "\\vee", "\\neg", "\\nabla", "\\partial", "\\infty", "\\emptyset", "\\angle", "\\degree", "\\ldots", "\\cdots", "\\vdots", "\\ddots") },
  { id: "relations", pl: "Relacje", en: "Relations", items: plain(
    "=", "\\neq", "\\approx", "\\equiv", "\\sim", "\\simeq", "\\cong", "<", ">", "\\leq", "\\geq", "\\ll", "\\gg", "\\propto",
    "\\in", "\\notin", "\\ni", "\\subset", "\\subseteq", "\\supset", "\\supseteq", "\\forall", "\\exists", "\\nexists", "\\parallel", "\\perp", "\\mid") },
  { id: "arrows", pl: "Strzałki", en: "Arrows", items: plain(
    "\\to", "\\leftarrow", "\\leftrightarrow", "\\Rightarrow", "\\Leftarrow", "\\Leftrightarrow", "\\mapsto", "\\uparrow", "\\downarrow",
    "\\implies", "\\iff", "\\rightharpoonup", "\\hookrightarrow", "\\longrightarrow", "\\xrightarrow{f}") },
  { id: "functions", pl: "Funkcje i zbiory", en: "Functions and sets", items: [
    ...plain("\\sin", "\\cos", "\\tan", "\\arcsin", "\\log", "\\ln", "\\exp", "\\min", "\\max", "\\det", "\\gcd", "\\sup", "\\inf"),
    ...plain("\\mathbb{R}", "\\mathbb{N}", "\\mathbb{Z}", "\\mathbb{Q}", "\\mathbb{C}", "\\mathcal{L}", "\\mathrm{d}", "\\mathbf{v}", "\\text{tekst}"),
  ] },
];

export const FORMULA_TEMPLATES: FormulaTemplate[] = [
  { pl: "Wzór kwadratowy", en: "Quadratic formula", latex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" },
  { pl: "Twierdzenie Pitagorasa", en: "Pythagorean theorem", latex: "a^2 + b^2 = c^2" },
  { pl: "Tożsamość Eulera", en: "Euler's identity", latex: "e^{i\\pi} + 1 = 0" },
  { pl: "Całka Gaussa", en: "Gaussian integral", latex: "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,\\mathrm{d}x = \\sqrt{\\pi}" },
  { pl: "Definicja pochodnej", en: "Definition of the derivative", latex: "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}" },
  { pl: "Szereg Taylora", en: "Taylor series", latex: "f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!}(x-a)^n" },
  { pl: "Rozkład normalny", en: "Normal distribution", latex: "f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}}\\, e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}" },
  { pl: "Równania Maxwella (prawo Gaussa)", en: "Maxwell (Gauss's law)", latex: "\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}" },
  { pl: "Równanie Schrödingera", en: "Schrödinger equation", latex: "i\\hbar \\frac{\\partial}{\\partial t}\\Psi = \\hat{H}\\Psi" },
  { pl: "Macierz obrotu", en: "Rotation matrix", latex: "R(\\theta) = \\begin{pmatrix}\\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta\\end{pmatrix}" },
];
