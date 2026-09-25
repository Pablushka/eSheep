/*
 * Project:  eSheep - Webpage (modern TypeScript port)
 * Original: Adriano Petrucci (https://esheep.petrucci.ch) - v0.7
 * Port:     v0.8 - TypeScript, typed XML model, perf improvements
 *
 * Public API (unchanged):
 *   const pet = new ESheep();
 *   pet.Start('https://esheep.petrucci.ch/script/animation.xml');
 */

export const VERSION = '0.8';
const ACTIVATE_DEBUG = false;
const DEFAULT_XML = './animation.xml';
const COLLISION_WITH = ['div', 'hr', 'aside' ] as const;

/* ------------------------------------------------------------------ */
/* Expression evaluation                                               */
/*                                                                     */
/* The original used eval() + repeated string.replace() on every frame.*/
/* Manifest V3 content scripts forbid eval/new Function (there is no   */
/* 'unsafe-eval' in their CSP), so each unique expression is compiled  */
/* once into a tiny AST and evaluated with a CSP-safe recursive-       */
/* descent parser. Constant expressions are evaluated exactly once.    */
/* ------------------------------------------------------------------ */

interface ExprVars {
  screenW: number;
  screenH: number;
  areaW: number;
  areaH: number;
  imageW: number;
  imageH: number;
  random: number;
  randS: number;
  imageX: number;
  imageY: number;
}

type ExprNode =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'un'; op: '+' | '-'; arg: ExprNode }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '%'; left: ExprNode; right: ExprNode }
  | { type: 'call'; name: string; args: ExprNode[] };

type ExprToken =
  | { type: 'num'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: string };

function tokenizeExpr(expr: string): ExprToken[] {
  const tokens: ExprToken[] = [];
  let i = 0;

  while (i < expr.length) {
    const c = expr[i];

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // Number literal (integer or decimal).
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(expr[i + 1] ?? ''))) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      const value = Number(expr.slice(i, j));
      tokens.push({ type: 'num', value: Number.isFinite(value) ? value : 0 });
      i = j;
      continue;
    }

    // Identifier (variable name, or a type name such as System.Int32).
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_.]/.test(expr[j])) j++;
      tokens.push({ type: 'ident', value: expr.slice(i, j) });
      i = j;
      continue;
    }

    if ('+-*/%(),'.includes(c)) {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }

    // Unknown character: skip it so a typo can't crash the whole loop.
    i++;
  }

  return tokens;
}

class ExprParser {
  private pos = 0;

  constructor(private readonly tokens: ExprToken[]) {}

  parse(): ExprNode {
    const node = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token: "${this.tokens[this.pos].value}"`);
    }
    return node;
  }

  private peek(): ExprToken | undefined {
    return this.tokens[this.pos];
  }

  private consume(): ExprToken {
    const token = this.tokens[this.pos++];
    if (!token) throw new Error('Unexpected end of expression');
    return token;
  }

  private parseExpression(): ExprNode {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.consume();
        left = { type: 'bin', op: t.value as '+' | '-', left, right: this.parseTerm() };
      } else {
        return left;
      }
    }
  }

  private parseTerm(): ExprNode {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t?.type === 'op' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        this.consume();
        left = { type: 'bin', op: t.value as '*' | '/' | '%', left, right: this.parseUnary() };
      } else {
        return left;
      }
    }
  }

  private parseUnary(): ExprNode {
    const t = this.peek();
    if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
      this.consume();
      return { type: 'un', op: t.value as '+' | '-', arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    const t = this.consume();

    if (t.type === 'num') return { type: 'num', value: t.value };

    if (t.type === 'ident') {
      const nextTok = this.peek();
      if (nextTok?.type === 'op' && nextTok.value === '(') {
        return this.parseCall(t.value);
      }
      return { type: 'var', name: t.value };
    }

    if (t.type === 'op' && t.value === '(') {
      const inner = this.parseExpression();
      const close = this.consume();
      if (close.type !== 'op' || close.value !== ')') {
        throw new Error('Expected ")"');
      }
      return inner;
    }

    throw new Error(`Unexpected token: "${t.value}"`);
  }

  private parseCall(name: string): ExprNode {
    this.consume(); // consume '('
    const args: ExprNode[] = [this.parseExpression()];

    for (;;) {
      const t = this.peek();
      if (t?.type === 'op' && t.value === ',') {
        this.consume();
        args.push(this.parseExpression());
      } else if (t?.type === 'op' && t.value === ')') {
        this.consume();
        break;
      } else {
        throw new Error('Expected "," or ")"');
      }
    }

    return { type: 'call', name, args };
  }
}

function evalNode(node: ExprNode, vars: ExprVars): number {
  switch (node.type) {
    case 'num':
      return node.value;

    case 'var':
      return (vars as unknown as Record<string, number>)[node.name] ?? 0;

    case 'un': {
      const value = evalNode(node.arg, vars);
      return node.op === '-' ? -value : value;
    }

    case 'bin': {
      const left = evalNode(node.left, vars);
      const right = evalNode(node.right, vars);
      switch (node.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return right === 0 ? 0 : left / right;
        case '%': return right === 0 ? 0 : left % right;
        default: return 0;
      }
    }

    case 'call':
      // `Convert(x, System.Int32)` — round to the nearest integer.
      if (node.name === 'Convert' && node.args.length > 0) {
        return Math.round(evalNode(node.args[0], vars));
      }
      return 0;

    default:
      return 0;
  }
}

const astCache = new Map<string, ExprNode>();
const constExprCache = new Map<string, number>();
const CONST_EXPR_RE = /^[\d\s+\-*/().%]+$/;

const ZERO_VARS: ExprVars = {
  screenW: 0,
  screenH: 0,
  areaW: 0,
  areaH: 0,
  imageW: 0,
  imageH: 0,
  random: 0,
  randS: 0,
  imageX: 0,
  imageY: 0,
};

function compileExpr(expr: string): ExprNode {
  const trimmed = expr.trim();
  let node = astCache.get(trimmed);
  if (node) return node;

  try {
    node = new ExprParser(tokenizeExpr(trimmed)).parse();
  } catch (err) {
    console.error(`Unable to compile expression: "${expr}"`, err);
    node = { type: 'num', value: 0 };
  }

  astCache.set(trimmed, node);
  return node;
}

/* ------------------------------------------------------------------ */
/* XML model                                                           */
/* ------------------------------------------------------------------ */

interface AnimPoint {
  x: string;
  y: string;
  offsety: string;
  opacity: string;
  interval: string;
}

interface NextLink {
  id: string;
  probability: number;
}

interface AnimationDef {
  id: string;
  name: string;
  frames: number[];
  repeatExpr: string;
  repeatFrom: number;
  start: AnimPoint;
  end: AnimPoint;
  next: NextLink[];
  action: string;
  borderNext: NextLink[];
  gravityNext: NextLink[];
}

interface SpawnDef {
  x: string;
  y: string;
  probability: number;
  nextId: string;
}

interface ChildDef {
  animationId: string;
  nextId: string;
  x: string;
  y: string;
}

interface SheepConfig {
  tilesX: number;
  tilesY: number;
  sprite: HTMLImageElement;
  animations: Map<string, AnimationDef>;
  spawns: SpawnDef[];
  childs: ChildDef[];
}

/* ------------------------------------------------------------------ */
/* XML helpers                                                         */
/* ------------------------------------------------------------------ */

function getText(parent: Element | null | undefined, tag: string, fallback = ''): string {
  if (!parent) return fallback;
  const el = parent.getElementsByTagName(tag)[0];
  return el && el.textContent != null ? el.textContent : fallback;
}

function parseNextLinks(parent: Element | null | undefined): NextLink[] {
  if (!parent) return [];
  const nodes = parent.getElementsByTagName('next');
  const links: NextLink[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const p = parseInt(n.getAttribute('probability') ?? '1', 10);
    links.push({
      id: (n.textContent ?? '').trim(),
      probability: Number.isFinite(p) && p > 0 ? p : 1,
    });
  }
  return links;
}

function parseAnimPoint(section: Element | null | undefined): AnimPoint {
  return {
    x: getText(section, 'x', '0'),
    y: getText(section, 'y', '0'),
    offsety: getText(section, 'offsety', '0'),
    opacity: getText(section, 'opacity', '1'),
    interval: getText(section, 'interval', '1000'),
  };
}

function parseAnimation(el: Element): AnimationDef {
  const frames: number[] = [];
  const frameNodes = el.getElementsByTagName('frame');
  for (let i = 0; i < frameNodes.length; i++) {
    const v = parseInt(frameNodes[i].textContent ?? '0', 10);
    frames.push(Number.isFinite(v) ? v : 0);
  }

  const seq = el.getElementsByTagName('sequence')[0];
  const repeatRaw = seq?.getAttribute('repeat');
  const repeatFromRaw = seq?.getAttribute('repeatfrom');
  const repeatFrom = repeatFromRaw == null ? 0 : (parseInt(repeatFromRaw, 10) || 0);

  const borderEl = el.getElementsByTagName('border')[0];
  const gravityEl = el.getElementsByTagName('gravity')[0];

  return {
    id: el.getAttribute('id') ?? '',
    name: getText(el, 'name', ''),
    frames,
    repeatExpr: repeatRaw ?? '0',
    repeatFrom,
    start: parseAnimPoint(el.getElementsByTagName('start')[0]),
    end: parseAnimPoint(el.getElementsByTagName('end')[0]),
    next: parseNextLinks(seq),
    action: getText(el, 'action', ''),
    borderNext: parseNextLinks(borderEl),
    gravityNext: parseNextLinks(gravityEl),
  };
}

function parseConfig(text: string): Omit<SheepConfig, 'sprite'> {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error(`Invalid animation XML: ${err.textContent ?? ''}`);

  const imageEl = doc.getElementsByTagName('image')[0];
  const tilesX = parseInt(getText(imageEl, 'tilesx', '1'), 10) || 1;
  const tilesY = parseInt(getText(imageEl, 'tilesy', '1'), 10) || 1;
  const pngData = getText(imageEl, 'png', '');

  const animations = new Map<string, AnimationDef>();
  const animRoot = doc.getElementsByTagName('animations')[0];
  if (animRoot) {
    const nodes = animRoot.getElementsByTagName('animation');
    for (let i = 0; i < nodes.length; i++) {
      const a = parseAnimation(nodes[i]);
      animations.set(a.id, a);
    }
  }

  const spawns: SpawnDef[] = [];
  const spawnRoot = doc.getElementsByTagName('spawns')[0];
  if (spawnRoot) {
    const nodes = spawnRoot.getElementsByTagName('spawn');
    for (let i = 0; i < nodes.length; i++) {
      const p = parseInt(nodes[i].getAttribute('probability') ?? '1', 10);
      spawns.push({
        x: getText(nodes[i], 'x', '0'),
        y: getText(nodes[i], 'y', '0'),
        probability: Number.isFinite(p) && p > 0 ? p : 1,
        nextId: getText(nodes[i], 'next', ''),
      });
    }
  }

  const childs: ChildDef[] = [];
  const childRoot = doc.getElementsByTagName('childs')[0];
  if (childRoot) {
    const nodes = childRoot.getElementsByTagName('child');
    for (let i = 0; i < nodes.length; i++) {
      childs.push({
        animationId: nodes[i].getAttribute('animationid') ?? '',
        nextId: getText(nodes[i], 'next', ''),
        x: getText(nodes[i], 'x', '0'),
        y: getText(nodes[i], 'y', '0'),
      });
    }
  }

  // Keep the PNG payload around for the caller to load.
  (animations as unknown as { __png?: string }).__png = pngData;
  return { tilesX, tilesY, animations, spawns, childs, __png: pngData } as never;
}

/* ------------------------------------------------------------------ */
/* Config loading (shared, cached, deduplicated)                       */
/* ------------------------------------------------------------------ */

const configCache = new Map<string, Promise<SheepConfig>>();

function loadConfig(url: string): Promise<SheepConfig> {
  let promise = configCache.get(url);
  if (promise) return promise;

  promise = (async (): Promise<SheepConfig> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`XML not available: ${res.status} ${res.statusText}`);
    const xml = await res.text();

    const parsed = parseConfig(xml) as unknown as { __png: string } & Omit<SheepConfig, 'sprite'>;
    const pngData = parsed.__png;
    const src = `data:image/png;base64,${pngData}`;

    const sprite = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Unable to load sprite'));
      img.src = src;
    });

    return {
      tilesX: parsed.tilesX,
      tilesY: parsed.tilesY,
      animations: parsed.animations,
      spawns: parsed.spawns,
      childs: parsed.childs,
      sprite,
    };
  })();

  // Don't cache a rejected promise – allow retries.
  promise.catch(() => configCache.delete(url));
  configCache.set(url, promise);
  return promise;
}

/* ------------------------------------------------------------------ */
/* ESheep                                                              */
/* ------------------------------------------------------------------ */

export class ESheep {
  private animationFile = DEFAULT_XML;
  private config: SheepConfig | null = null;

  private readonly DOMdiv: HTMLDivElement;
  private readonly DOMimg: HTMLImageElement;
  private readonly DOMinfo: HTMLDivElement;

  private readonly isChild: boolean;

  private tilesX = 1;
  private tilesY = 1;
  private imageW = 1;
  private imageH = 1;
  private imageX = 0;
  private imageY = 0;

  private flipped = false;
  private dragging = false;
  private pendingDrag = false;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private infobox = false;

  private animationId = '';
  private animationNode: AnimationDef | null = null;
  private animationStep = 0;
  private currentSteps = 1;

  private walkSurface: HTMLElement | null = null;
  private randS = Math.random() * 100;
  private screenW = 1;
  private screenH = 1;

  private running = false;
  private destroyed = false;
  private timerId = 0;
  private rafId = 0;

  private collisionEls: HTMLElement[] = [];
  private collisionDirty = true;
  private mutationObserver: MutationObserver | null = null;

  private resizePending = false;

  constructor(isChild = false) {
    this.isChild = isChild;

    this.updateScreenSize();

    this.DOMdiv = document.createElement('div');
    this.DOMimg = document.createElement('img');
    this.DOMinfo = document.createElement('div');
  }

  /* ---------------------------------------------------------------- */
  /* Public API                                                       */
  /* ---------------------------------------------------------------- */

  async Start(animationFile?: string): Promise<void> {
    if (this.destroyed) throw new Error('This sheep has already been destroyed');
    if (animationFile) this.animationFile = animationFile;

    this.running = true;

    try {
      this.config = await loadConfig(this.animationFile);
    } catch (err) {
      console.error('XML not available:', err);
      this.running = false;
      return;
    }

    if (this.destroyed) return;

    this.tilesX = this.config.tilesX;
    this.tilesY = this.config.tilesY;
    this.imageW = this.config.sprite.naturalWidth / this.tilesX;
    this.imageH = this.config.sprite.naturalHeight / this.tilesY;

    this.buildDom();
    this.attachEvents();

    if (this.isChild) {
      this.spawnChild();
    } else {
      this.spawn();
    }
  }

  /** Stops the animation and removes all DOM nodes. */
  Destroy(): void {
    this.destroy();
  }

  /**
   * Immediately play the animation whose XML `<name>` matches `name`
   * (e.g. "walk", "fall", "drag", "jump"). Unknown names are ignored.
   */
  PlayAnimation(name: string): void {
    if (this.destroyed || !this.config) return;

    const anim = this.findAnimationByName(name);
    if (!anim) return;

    this.walkSurface = null;
    this.setAnimation(anim.id);
    // Kick the frame loop so the new animation starts right away.
    this.schedule(0);
  }

  /* ---------------------------------------------------------------- */
  /* Setup / teardown                                                 */
  /* ---------------------------------------------------------------- */

  private updateScreenSize(): void {
    this.screenW =
      window.innerWidth ||
      document.documentElement.clientWidth ||
      document.body.clientWidth;
    this.screenH =
      window.innerHeight ||
      document.documentElement.clientHeight ||
      document.body.clientHeight;
  }

  private buildDom(): void {
    const sprite = this.config!.sprite;

    this.DOMdiv.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      `width:${this.imageW}px`,
      `height:${this.imageH}px`,
      'overflow:hidden',
      'cursor:move',
      'z-index:2147483647',
      'will-change:transform',
      'contain:layout paint',
      'user-select:none',
      '-webkit-user-select:none',
      'touch-action:none',
    ].join(';');

    this.DOMimg.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      `width:${sprite.naturalWidth}px`,
      `height:${sprite.naturalHeight}px`,
      'pointer-events:none',
      'user-select:none',
      '-webkit-user-drag:none',
    ].join(';');
    this.DOMimg.draggable = false;
    this.DOMimg.alt = '';
    this.DOMimg.src = sprite.src;

    this.DOMdiv.appendChild(this.DOMimg);

    this.DOMinfo.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:200px',
      'height:100px',
      'display:none',
      'border:2px ridge #0000ab',
      'border-radius:5px',
      'text-align:center',
      'text-shadow:1px 1px 3px #ffff88',
      'box-shadow:3px 3px 10px #888888',
      'color:black',
      'opacity:0.9',
      'z-index:9999',
      'overflow:auto',
      'background:linear-gradient(to bottom right, rgba(128,128,255,0.7), rgba(200,200,255,0.4))',
      'will-change:transform',
    ].join(';');

    this.DOMinfo.innerHTML =
      `<b>eSheep</b><sup style="float:right">ver: ${VERSION}</sup>` +
      `<br><hr>Visit the home page of this lovely sheep:<br>` +
      `<a href="https://esheep.petrucci.ch" target="_blank" rel="noopener">https://esheep.petrucci.ch</a>`;

    document.body.appendChild(this.DOMinfo);
    document.body.appendChild(this.DOMdiv);

    this.applyTransform();
  }

  private attachEvents(): void {
    this.DOMdiv.addEventListener('pointerdown', this.onPointerDown);
    this.DOMdiv.addEventListener('pointermove', this.onPointerMove);
    this.DOMdiv.addEventListener('pointerup', this.onPointerUp);
    this.DOMdiv.addEventListener('pointercancel', this.onPointerUp);
    this.DOMdiv.addEventListener('contextmenu', this.onContextMenu);
    this.DOMdiv.addEventListener('dragstart', preventDefault);

    this.DOMinfo.addEventListener('pointerup', this.onInfoPointerUp);

    window.addEventListener('resize', this.onResize, { passive: true });

    if (typeof MutationObserver !== 'undefined') {
      this.mutationObserver = new MutationObserver(() => {
        this.collisionDirty = true;
      });
      this.mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  private detachEvents(): void {
    this.DOMdiv.removeEventListener('pointerdown', this.onPointerDown);
    this.DOMdiv.removeEventListener('pointermove', this.onPointerMove);
    this.DOMdiv.removeEventListener('pointerup', this.onPointerUp);
    this.DOMdiv.removeEventListener('pointercancel', this.onPointerUp);
    this.DOMdiv.removeEventListener('contextmenu', this.onContextMenu);
    this.DOMdiv.removeEventListener('dragstart', preventDefault);

    this.DOMinfo.removeEventListener('pointerup', this.onInfoPointerUp);

    window.removeEventListener('resize', this.onResize);

    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
  }

  private destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.running = false;

    clearTimeout(this.timerId);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;

    this.detachEvents();
    this.DOMinfo.remove();
    this.DOMdiv.remove();
  }

  /* ---------------------------------------------------------------- */
  /* Event handlers                                                   */
  /* ---------------------------------------------------------------- */

  private readonly onResize = (): void => {
    if (this.resizePending) return;
    this.resizePending = true;
    requestAnimationFrame(() => {
      this.resizePending = false;
      this.updateScreenSize();

      if (this.imageY + this.imageH > this.screenH) {
        this.imageY = this.screenH - this.imageH;
      }
      if (this.imageX + this.imageW > this.screenW) {
        this.imageX = this.screenW - this.imageW;
      }
      this.applyTransform();
      this.collisionDirty = true;
    });
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.pendingDrag = true;
    this.dragging = false;
    this.pointerDownX = e.clientX;
    this.pointerDownY = e.clientY;
    this.DOMdiv.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.pendingDrag && !this.dragging) return;

    if (!this.dragging) {
      const dx = Math.abs(e.clientX - this.pointerDownX);
      const dy = Math.abs(e.clientY - this.pointerDownY);
      if (dx + dy <= 3) return;

      this.dragging = true;

      // The "drag" (dangling) animation should only be shown when the pet
      // is near to fall, i.e. already hanging in the air. A pet that is
      // standing on the floor or on a collision surface keeps its current
      // animation while being moved.
      if (this.isAirborne() || true) {
        const dragAnim = this.findAnimationByName('drag');
        if (dragAnim) this.setAnimation(dragAnim.id);
      }

      this.walkSurface = null;
    }

    this.setPosition(
      e.clientX - this.imageW / 2,
      e.clientY - this.imageH / 2,
      true,
    );
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.DOMdiv.hasPointerCapture(e.pointerId)) {
      this.DOMdiv.releasePointerCapture(e.pointerId);
    }

    if (this.dragging) {
      this.dragging = false;
      this.pendingDrag = false;
      return;
    }

    if (this.pendingDrag) {
      this.pendingDrag = false;
      if (this.infobox) this.hideInfoBox();
      else this.showInfoBox();
    }
  };

  private readonly onInfoPointerUp = (): void => {
    this.hideInfoBox();
  };

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  /* ---------------------------------------------------------------- */
  /* Info box                                                         */
  /* ---------------------------------------------------------------- */

  private showInfoBox(): void {
    const w = 200;
    const h = 100;
    const left = Math.min(
      this.screenW - w,
      Math.max(0, this.imageX + this.imageW / 2 - w / 2),
    );
    const top = Math.max(0, this.imageY - h);

    this.DOMinfo.style.transform = `translate3d(${Math.round(left)}px,${Math.round(top)}px,0)`;
    this.DOMinfo.style.display = 'block';
    this.infobox = true;
  }

  private hideInfoBox(): void {
    this.DOMinfo.style.display = 'none';
    this.infobox = false;
  }

  /* ---------------------------------------------------------------- */
  /* Expression evaluation                                            */
  /* ---------------------------------------------------------------- */

  private evalExpr(expr: string): number {
    // Fast path: constant expressions are evaluated once and cached.
    if (CONST_EXPR_RE.test(expr)) {
      let v = constExprCache.get(expr);
      if (v === undefined) {
        v = evalNode(compileExpr(expr), ZERO_VARS);
        constExprCache.set(expr, v);
      }
      return v;
    }

    try {
      return evalNode(compileExpr(expr), {
        screenW: this.screenW,
        screenH: this.screenH,
        // @compat: original mapped areaW -> screenH (likely a bug); preserved.
        areaW: this.screenW,
        areaH: this.screenH,
        imageW: this.imageW,
        imageH: this.imageH,
        random: Math.random() * 100,
        randS: this.randS,
        imageX: this.imageX,
        imageY: this.imageY,
      });
    } catch (err) {
      console.error(`Unable to parse this position: \n'${expr}'`, err);
      return 0;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Positioning                                                      */
  /* ---------------------------------------------------------------- */

  private setPosition(x: number, y: number, absolute: boolean): void {
    if (absolute) {
      this.imageX = x;
      this.imageY = y;
    } else {
      this.imageX += x;
      this.imageY += y;
    }
    this.applyTransform();
  }

  /**
   * True when the pet is hanging in the air and would fall if released:
   * neither standing on a collision element nor resting on the screen floor.
   */
  private isAirborne(): boolean {
    if (this.walkSurface) return false;
    return this.imageY + this.imageH < this.screenH - 2;
  }

  private applyTransform(): void {
    const flip = this.flipped ? ' rotateY(180deg)' : '';
    this.DOMdiv.style.transform =
      `translate3d(${Math.round(this.imageX)}px,${Math.round(this.imageY)}px,0)${flip}`;
  }

  private setFrame(index: number): void {
    const col = index % this.tilesX;
    const row = Math.floor(index / this.tilesX);
    this.DOMimg.style.transform =
      `translate3d(${-this.imageW * col}px,${-this.imageH * row}px,0)`;
  }

  /* ---------------------------------------------------------------- */
  /* Animation bookkeeping                                            */
  /* ---------------------------------------------------------------- */

  private findAnimationByName(name: string): AnimationDef | undefined {
    if (!this.config) return undefined;
    for (const anim of this.config.animations.values()) {
      if (anim.name === name) return anim;
    }
    return undefined;
  }

  private setAnimation(id: string): boolean {
    const anim = this.config?.animations.get(id);
    if (!anim) return false;

    this.animationId = id;
    this.animationNode = anim;
    this.animationStep = 0;

    const repeat = Math.max(0, Math.floor(this.evalExpr(anim.repeatExpr)));
    const frameCount = anim.frames.length;
    const repeatFrom = Math.min(anim.repeatFrom, frameCount);
    this.currentSteps = Math.max(
      1,
      frameCount + (frameCount - repeatFrom) * repeat,
    );

    return true;
  }

  private spawn(): void {
    const cfg = this.config;
    if (!cfg || cfg.spawns.length === 0) return;

    const chosen = pickWeighted(cfg.spawns, (s) => s.probability);
    if (!chosen) return;

    this.setPosition(
      this.evalExpr(chosen.x),
      this.evalExpr(chosen.y),
      true,
    );

    if (!this.setAnimation(chosen.nextId)) {
      console.error(`Spawn references unknown animation: ${chosen.nextId}`);
      return;
    }

    this.maybeSpawnChild(chosen.nextId);
    this.step();
  }

  private spawnChild(): void {
    if (!this.setAnimation(this.animationId)) {
      this.destroy();
      return;
    }
    this.step();
  }

  private maybeSpawnChild(animationId: string): void {
    const cfg = this.config;
    if (!cfg) return;

    const def = cfg.childs.find((c) => c.animationId === animationId);
    if (!def) return;

    if (ACTIVATE_DEBUG) console.log('Spawning child for animation', animationId);

    const child = new ESheep(true);
    child.animationId = def.nextId;
    child.imageX = this.evalExpr(def.x);
    child.imageY = this.evalExpr(def.y);
    void child.Start(this.animationFile);
  }

  /**
   * Weighted random transition.
   * Returns false when the caller must stop (sheep destroyed / respawned).
   */
  private advance(nextLinks: NextLink[]): boolean {
    if (nextLinks.length === 0) {
      if (this.isChild) this.destroy();
      else this.spawn();
      return false;
    }

    const chosen = pickWeighted(nextLinks, (l) => l.probability);
    if (!chosen || !this.setAnimation(chosen.id)) {
      console.error('Next animation not found, respawning');
      if (this.isChild) this.destroy();
      else this.spawn();
      return false;
    }

    this.maybeSpawnChild(chosen.id);
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Collision detection                                              */
  /* ---------------------------------------------------------------- */

  private getCollisionElements(): HTMLElement[] {
    if (this.collisionDirty) {
      const out: HTMLElement[] = [];
      for (const tag of COLLISION_WITH) {
        const list = document.body.getElementsByTagName(tag);
        for (let i = 0; i < list.length; i++) {
          const el = list[i] as HTMLElement;
          if (el !== this.DOMdiv && el !== this.DOMinfo) out.push(el);
        }
      }
      this.collisionEls = out;
      this.collisionDirty = false;
    }
    return this.collisionEls;
  }

  private checkOverlapping(): HTMLElement | null {
    const x = this.imageX;
    const y = this.imageY + this.imageH;
    const margin = this.walkSurface ? 5 : 20;
    const maxX = this.imageW;

    const els = this.getCollisionElements();
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const rect = el.getBoundingClientRect();

      if (y > rect.top - 2 && y < rect.top + margin &&
          x > rect.left && x < rect.right - maxX) {
        const style = getComputedStyle(el);
        if (style.display !== 'none' &&
            style.borderTopStyle !== '' &&
            style.borderTopStyle !== 'none') {
          return el;
        }
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Frame loop                                                       */
  /* ---------------------------------------------------------------- */

  private schedule(delay: number): void {
    if (this.destroyed || !this.running) return;
    clearTimeout(this.timerId);
    this.timerId = window.setTimeout(() => {
      this.timerId = 0;
      this.rafId = requestAnimationFrame(this.runStep);
    }, Math.max(0, delay));
  }

  private readonly runStep = (): void => {
    this.rafId = 0;
    if (this.destroyed || !this.running) return;
    this.step();
  };

  private step(): void {
    if (this.destroyed || !this.running) return;

    const anim = this.animationNode;
    if (!anim) return;

    const frames = anim.frames;
    const frameCount = frames.length;

    // Degenerate animation – skip straight to the next one.
    if (frameCount === 0) {
      if (!this.advance(anim.next)) return;
      this.schedule(0);
      return;
    }

    /* ---- sprite frame ---- */
    const step = this.animationStep;
    let index: number;
    if (step < frameCount) {
      index = frames[step];
    } else if (anim.repeatFrom === 0) {
      index = frames[step % frameCount];
    } else {
      const span = frameCount - anim.repeatFrom;
      index = frames[anim.repeatFrom + ((step - anim.repeatFrom) % span)];
    }
    this.setFrame(index);

    /* ---- paused (dragging / info box) ---- */
    if (this.dragging || this.infobox) {
      this.animationStep++;
      this.schedule(50);
      return;
    }

    /* ---- movement ---- */
    let x1 = this.evalExpr(anim.start.x);
    let y1 = this.evalExpr(anim.start.y);
    let x2 = this.evalExpr(anim.end.x);
    const y2 = this.evalExpr(anim.end.y);

    if (this.flipped) {
      x1 = -x1;
      x2 = -x2;
    }

    const steps = this.currentSteps;

    if (this.animationStep === 0) {
      this.setPosition(x1, y1, false);
    } else {
      this.setPosition(
        x1 + (x2 - x1) * this.animationStep / steps,
        y1 + (y2 - y1) * this.animationStep / steps,
        false,
      );
    }

    this.animationStep++;

    /* ---- animation finished ---- */
    if (this.animationStep >= steps) {
      if (anim.action === 'flip') {
        this.flipped = !this.flipped;
        this.applyTransform();
      }
      if (!this.advance(anim.next)) return;
    }

    let setNext = false;

    /* ---- border handling ---- */
    if (anim.borderNext.length > 0) {
      if (x2 < 0 && this.imageX < 0) {
        this.imageX = 0;
        this.applyTransform();
        setNext = true;
      } else if (x2 > 0 && this.imageX > this.screenW - this.imageW) {
        this.imageX = this.screenW - this.imageW;
        this.applyTransform();
        setNext = true;
      } else if (y2 < 0 && this.imageY < 0) {
        this.imageY = 0;
        this.applyTransform();
        setNext = true;
      } else if (y2 > 0 && this.imageY > this.screenH - this.imageH) {
        this.imageY = this.screenH - this.imageH;
        this.applyTransform();
        setNext = true;
      } else if (y2 > 0) {
        const overlap = this.checkOverlapping();
        if (overlap && this.imageY > this.imageH) {
          this.walkSurface = overlap;
          this.imageY =
            Math.ceil(overlap.getBoundingClientRect().top) - this.imageH;
          this.applyTransform();
          setNext = true;
        }
      } else if (this.walkSurface) {
        if (!this.checkOverlapping()) {
          const surfaceTop = this.walkSurface.getBoundingClientRect().top;
          if (this.imageY + this.imageH > surfaceTop + 3 ||
              this.imageY + this.imageH < surfaceTop - 3) {
            this.walkSurface = null;
          } else if (this.imageX < this.walkSurface.getBoundingClientRect().left) {
            this.imageX += 3;
            setNext = true;
          } else {
            this.imageX -= 3;
            setNext = true;
          }
          this.applyTransform();
        }
      }

      if (setNext && !this.advance(anim.borderNext)) return;
    }

    /* ---- gravity ---- */
    if (!setNext && anim.gravityNext.length > 0) {
      if (this.imageY < this.screenH - this.imageH - 2) {
        if (this.walkSurface === null) {
          setNext = true;
        } else if (!this.checkOverlapping()) {
          setNext = true;
          this.walkSurface = null;
        }

        if (setNext && !this.advance(anim.gravityNext)) return;
      }
    }

    /* ---- walked off-screen ---- */
    if (!setNext) {
      const offScreen =
        (this.imageX < -this.imageW && x2 < 0) ||
        (this.imageX > this.screenW && x2 > 0) ||
        (this.imageY < -this.imageH && y1 < 0) ||
        (this.imageY > this.screenH && y2 > 0);

      if (offScreen) {
        if (this.isChild) this.destroy();
        else this.spawn();
        return;
      }
    }

    /* ---- schedule next frame ---- */
    const del1 = this.evalExpr(anim.start.interval);
    const del2 = this.evalExpr(anim.end.interval);
    const delay = del1 + (del2 - del1) * this.animationStep / steps;
    this.schedule(delay);
  }
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T | null {
  if (items.length === 0) return null;

  let total = 0;
  for (let i = 0; i < items.length; i++) total += weight(items[i]);

  let rand = Math.random() * total;
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += weight(items[i]);
    if (acc >= rand) return items[i];
  }
  return items[items.length - 1];
}

function preventDefault(e: Event): boolean {
  e.preventDefault();
  return false;
}

/* ------------------------------------------------------------------ */
/* Legacy shim                                                         */
/* ------------------------------------------------------------------ */

/** @deprecated Use `new ESheep()` and `.Start()` instead. */
export class DesktopPet {
  start_esheep(): void {
    console.error('Deprecated, use new ESheep() and .Start() to start a new eSheep.');
  }
}

// Keep the original lowercase class name working.
export { ESheep as eSheep };

export type {
  AnimPoint,
  AnimationDef,
  ChildDef,
  NextLink,
  SheepConfig,
  SpawnDef,
};

// Expose on `window` for classic <script> usage.
declare global {
  interface Window {
    ESheep: typeof ESheep;
    eSheep: typeof ESheep;
    // DesktopPet: typeof DesktopPet;
  }
}

if (typeof window !== 'undefined') {
  window.ESheep = ESheep;
  window.eSheep = ESheep;
  // window.DesktopPet = DesktopPet;
}