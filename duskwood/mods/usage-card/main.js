import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, readTextFile, home, closeOverlay, exec } from "herdr";

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
const FRAME = "#c9a227";
const XP = ["#b04cff", "#5c1a9c"];
const RESTED = ["#4f9cff", "#1c4f9c"];
const REP = ["#45c22c", "#1f6e12"];
const W = 300;

const clock = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const until = (ms) => {
  const min = Math.max(0, Math.round((ms - Date.now()) / 60000));
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `in ${h} h ${min % 60} min` : `in ${Math.round(h / 24)} days`;
};
const day = (ms) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(ms).getDay()];
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`);
const resetAt = (v) => (typeof v === "number" ? v * 1000 : Date.parse(v));

// A WoW tooltip from the quest bar's 5-hour bar: the 5-hour limit, the weekly
// limit and the focused Claude session's context. props {terminal}.
export default class UsageCard extends View {
  init(_props, cx) {
    this.limits = null;
    this.session = null;
    this.read(cx);
    cx.timer.every(2000, (cx) => this.read(cx));
  }

  read(cx) {
    const terminal = props()?.terminal;
    cx.spawn(async (cx) => {
      const load = async (path) => {
        try { return JSON.parse(await readTextFile(path)); } catch { return null; }
      };
      // The quest bar hands over the newest limits from any machine; this Mac's file otherwise.
      const local = await load(`${home()}/.claude/herdr/rate-limits.json`);
      const given = props()?.limits;
      this.limits = (given?.saved_at ?? 0) > (local?.saved_at ?? 0) ? given : local;
      this.homes ??= new Map();
      this.session = terminal ? await sessionFile(terminal, this.homes).catch(() => null) : null;
      cx.notify();
    });
  }

  bar(fraction, colors) {
    const width = W - 28;
    const f = Math.max(0, Math.min(1, fraction));
    return div().relative().w(width).h(12).rounded(2).bg("#05060a").border(1).border_color("#5c4d2e").overflow_hidden()
      .child(v_flex().absolute().left(0).top(0).h_full().w(Math.round((width - 2) * f))
        .child(div().flex_1().bg(colors[0])).child(div().flex_1().bg(colors[1])))
      .child(h_flex().absolute().left(0).top(0).size_full().children(
        Array.from({ length: 20 }, (_, i) => div().flex_1().h_full().when(i < 19, (el) => el.border_r(1).border_color("#00000066")))));
  }

  // One limit: a heading, its bar, and when it resets. A limit past its reset reads 0.
  limit(title, entry, colors, when) {
    const pct = entry?.used_percentage ?? entry?.utilization;
    const at = resetAt(entry?.resets_at);
    const past = Number.isFinite(at) && at < Date.now();
    const used = pct == null ? null : past ? 0 : Number(pct);
    return v_flex().gap(4)
      .child(h_flex().justify_between()
        .child(div().text_color(GOLD).child(title))
        .child(div().text_color("#ffffff").child(used == null ? "—" : `${Math.round(used)}% used`)))
      .child(this.bar((used ?? 0) / 100, colors))
      .child(div().text_size(11).text_color("#a39a84").child(
        used == null ? "Waiting for a Claude session to report it"
          : Number.isFinite(at) && !past ? `Resets ${when(at)} (${until(at)})` : "Fresh: nothing used yet"));
  }

  context() {
    const s = this.session;
    const head = h_flex().justify_between()
      .child(div().text_color(GOLD).child("Context, this window"))
      .child(div().text_color("#ffffff").child(s?.context != null ? `${s.context}%` : "—"));
    if (!s) {
      return v_flex().gap(4).child(head)
        .child(div().text_size(11).text_color("#a39a84").child("No Claude session in the focused window"));
    }
    const of = s.context_size ? ` of ${compact(s.context_size)}` : "";
    return v_flex().gap(4).child(head)
      .child(this.bar((s.context ?? 0) / 100, REP))
      .child(div().text_size(11).text_color("#a39a84").truncate()
        .child(`${s.context_tokens != null ? compact(s.context_tokens) : "?"}${of} tokens · ${s.model}${s.effort ? ` · ${s.effort}` : ""}`))
      .when(Boolean(s.session_name), (el) => el.child(div().text_size(11).text_color("#c9c0a8").truncate().child(s.session_name)));
  }

  render() {
    const l = this.limits;
    return v_flex().id("root").w(W).p(14).gap(12).bg("#0a0c16f2").border(1).border_color(FRAME).rounded(5)
      .text_size(12.5).text_color("#e6dcc2").cursor_pointer()
      .on_click(() => { const id = props()?.overlay; if (id) closeOverlay(id); })
      .child(div().text_size(15).text_color("#ffffff").child("Experience"))
      .child(this.limit("5-hour limit", l?.five_hour, XP, clock))
      .child(this.limit("Weekly limit", l?.seven_day, RESTED, (at) => `${day(at)} ${clock(at)}`))
      .child(div().h(1).bg("#5c4d2e"))
      .child(this.context());
  }
}
