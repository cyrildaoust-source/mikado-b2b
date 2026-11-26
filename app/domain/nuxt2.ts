/*
 * Lecture de l'état Nuxt 2 d'une page (`window.__NUXT__=(function(a,b,…){…return {…}}(…))`)
 * sans exécuter le script : un petit analyseur d'expressions JavaScript
 * (objets, tableaux, chaînes, nombres, littéraux, paramètres) suffit.
 */

type Value = unknown;

class Parser {
  i = 0;
  constructor(
    readonly s: string,
    readonly scope: Map<string, Value> = new Map(),
  ) {}

  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  peek(t: string) {
    this.ws();
    return this.s.startsWith(t, this.i);
  }

  eat(t: string) {
    if (!this.peek(t)) throw new Error(`« ${t} » attendu en ${this.i}`);
    this.i += t.length;
  }

  ident(): string {
    this.ws();
    const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i, this.i + 64));
    if (!m) throw new Error(`identifiant attendu en ${this.i}`);
    this.i += m[0].length;
    return m[0];
  }

  string(): string {
    const q = this.s[this.i];
    let j = this.i + 1;
    let raw = "";
    while (j < this.s.length && this.s[j] !== q) {
      if (this.s[j] === "\\") {
        raw += this.s.slice(j, j + 2);
        j += 2;
      } else {
        raw += this.s[j] === '"' ? '\\"' : this.s[j];
        j++;
      }
    }
    this.i = j + 1;
    return JSON.parse(`"${raw.replace(/\\x([0-9a-fA-F]{2})/g, "\\u00$1").replace(/\\'/g, "'")}"`);
  }

  value(): Value {
    this.ws();
    const c = this.s[this.i];
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"' || c === "'") return this.string();
    if (this.s.startsWith("!0", this.i)) return (this.i += 2), true;
    if (this.s.startsWith("!1", this.i)) return (this.i += 2), false;
    if (this.s.startsWith("void 0", this.i)) return (this.i += 6), undefined;
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(this.s.slice(this.i, this.i + 40));
    if (num) return (this.i += num[0].length), Number(num[0]);
    const id = this.ident();
    if (id === "true") return true;
    if (id === "false") return false;
    if (id === "null") return null;
    if (id === "undefined") return undefined;
    if (id === "Array" && this.peek("(")) {
      this.eat("(");
      const n = this.value();
      this.eat(")");
      return Array.from({ length: Number(n) || 0 });
    }
    return this.scope.get(id);
  }

  object(): Record<string, Value> {
    this.eat("{");
    const o: Record<string, Value> = {};
    while (!this.peek("}")) {
      this.ws();
      const c = this.s[this.i];
      const key = c === '"' || c === "'" ? this.string() : /\d/.test(c) ? String(this.value()) : this.ident();
      this.eat(":");
      o[key] = this.value();
      if (!this.peek("}")) this.eat(",");
    }
    this.eat("}");
    return o;
  }

  array(): Value[] {
    this.eat("[");
    const a: Value[] = [];
    while (!this.peek("]")) {
      a.push(this.value());
      if (!this.peek("]")) this.eat(",");
    }
    this.eat("]");
    return a;
  }
}

/** État Nuxt 2 de la page, ou null s'il est absent ou illisible. */
export function nuxt2State(html: string): Record<string, unknown> | null {
  const start = html.indexOf("window.__NUXT__=(function(");
  if (start < 0) return null;
  try {
    const head = new Parser(html);
    head.i = start + "window.__NUXT__=(function(".length;
    const params: string[] = [];
    while (!head.peek(")")) {
      params.push(head.ident());
      if (!head.peek(")")) head.eat(",");
    }
    head.eat(")");
    head.eat("{");
    const ret = html.indexOf("return ", head.i);
    if (ret < 0) return null;
    // Premier passage pour trouver la fin du corps, puis les arguments « }(…)) ».
    const probe = new Parser(html);
    probe.i = ret + "return ".length;
    probe.value();
    while (probe.peek(";")) probe.eat(";");
    probe.eat("}");
    probe.eat("(");
    const scope = new Map<string, Value>();
    for (let k = 0; !probe.peek(")"); k++) {
      const v = probe.value();
      if (k < params.length) scope.set(params[k], v);
      if (!probe.peek(")")) probe.eat(",");
    }
    const body = new Parser(html, scope);
    body.i = ret + "return ".length;
    const v = body.value();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
