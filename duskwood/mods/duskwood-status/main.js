import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, focused, readTextFile, home, openOverlay, exec } from "herdr";

// A terminal address is "t3" here or "machine/t3" on another machine; its Claude
// session file is under that machine's home.
async function sessionFile(address, homes) {
  const slash = address.lastIndexOf("/");
  const machine = slash > 0 ? address.slice(0, slash) : null;
  const id = slash > 0 ? address.slice(slash + 1) : address;
  if (machine && !homes.has(machine)) {
    const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine });
    homes.set(machine, r.stdout.trim());
  }
  const base = machine ? homes.get(machine) : home();
  const text = await readTextFile(`${base}/.claude/herdr/sessions/${id}.json`, { on: machine }).catch(() => null);
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

const GOLD = "#ffd100";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.session = null;
    this.terminal = null;
    this.read(cx);
    cx.timer.every(2000, (cx) => this.read(cx));
  }

  // The focused Claude session's model, effort and context, as its status line
  // saved them (mods/quest-bar/statusline-herdr.py, keyed by Herdr terminal).
  read(cx) {
    const terminal = focused()?.terminal ?? null;
    cx.spawn(async (cx) => {
      this.homes ??= new Map();
      const session = terminal ? await sessionFile(terminal, this.homes).catch(() => null) : null;
      const changed = terminal !== this.terminal || JSON.stringify(session) !== JSON.stringify(this.session);
      this.terminal = terminal;
      this.session = session;
      if (changed) cx.notify();
    });
  }

  // Model and effort chips for the focused Claude session. Clicking one opens a
  // menu that types /model or /effort into it; only while it's idle, so a pick
  // can never land in a permission prompt or a running turn.
  claude(t) {
    const s = this.session;
    const agent = agents().find((a) => a.address === this.terminal);
    if (!s || !agent || !/claude/i.test(agent.app ?? agent.program?.key ?? "")) return null;
    const ready = agent.status === "idle" || agent.status === "done";
    const open = (kind, current) => (e) => {
      if (!ready) return;
      openOverlay({ mod: "model-menu", kind: "popup", frame: "none", width: kind === "effort" ? 170 : 290,
        height: kind === "effort" ? 196 : 162, props: { terminal: this.terminal, kind, current } });
    };
    const level = Math.max(0, EFFORTS.indexOf(s.effort));
    const chip = (id, onClick) => h_flex().id(id).gap(6).items_center().px(8).h(20).rounded(3)
      .border(1).border_color(ready ? "#5c4d2e" : "#00000000")
      .when(ready, (el) => el.cursor_pointer().hover((st) => st.border_color(GOLD)))
      .on_click(onClick);
    return h_flex().gap(8).items_center()
      .child(chip("model", open("model", s.model))
        .child(div().text_color(GOLD).child(s.model)))
      .child(chip("effort", open("effort", s.effort))
        .child(h_flex().gap(2).children(EFFORTS.map((_, i) => div().w(4).h(9).rounded(1).bg(i <= level ? GOLD : "#3a3426"))))
        .child(div().child(s.effort ?? "")))
      .when(s.context != null, (el) => el.child(div().text_color(t.dim).child(`context ${s.context}%`)))
      .when(!ready, (el) => el.child(div().text_color(t.dim).child("· busy")));
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .map((el) => { const c = this.claude(t); return c ? el.child(c) : el; })
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
