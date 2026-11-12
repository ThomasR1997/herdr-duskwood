import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, agents, panes, machines, theme, run, exec, readTextFile, appHome, home, openOverlay, playSound, setShared, focused } from "herdr";

// WoW's own interface colours, kept apart from the theme on purpose.
const GOLD = "#ffd100";
const XP = ["#b04cff", "#5c1a9c"];
const REP = ["#45c22c", "#1f6e12"];
const FRAME = "#5c4d2e";
const ICON = (name) => `mods/quest-bar/${name}.svg`;
const MAX_LEVEL = 60;

// A local date as YYYY-MM-DD, the way tokens.py names its days.
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// {machine: {day: tokens}} -> today, the last 7 days and all time, per machine and together.
function summarize(per) {
  const now = new Date();
  const week = new Set(Array.from({ length: 7 }, (_, i) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i))));
  const today = dayKey(now);
  const machines = Object.entries(per).map(([name, days]) => {
    const keys = Object.keys(days).sort();
    const sum = (pick) => keys.filter(pick).reduce((a, k) => a + days[k], 0);
    return { name, today: days[today] ?? 0, week: sum((k) => week.has(k)), all: sum(() => true), since: keys[0] ?? null };
  });
  const add = (f) => machines.reduce((a, m) => a + m[f], 0);
  const since = machines.map((m) => m.since).filter(Boolean).sort()[0] ?? null;
  return { days: per, machines, today: add("today"), week: add("week"), all: add("all"), since };
}

const compact = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`;

export default class QuestBar extends View {
  init(_props, cx) {
    this.where = null;
    this.data = null;
    this.limits = null;
    this.offering = false;
    this.ticks = 0;
    this.turn = 0;
    this.tick(cx);
    cx.timer.every(5000, (cx) => this.tick(cx));
  }

  // Every 5 s: the 5-hour limit, and the quests again when the space changes.
  // Quests, the remote branch, pull requests and tokens every minute.
  tick(cx) {
    const space = spaces().find((s) => s.active);
    const machine = space?.machine ?? null;
    const folder = space?.folder || home();
    const where = `${machine ?? ""}|${folder}`;
    const moved = where !== this.where;
    if (moved) {
      this.where = where;
      this.offering = false;
    }
    // The last window with a terminal: clicking this bar may move focus off it.
    this.terminal = focused()?.terminal ?? this.terminal ?? null;
    const n = this.ticks++;
    cx.spawn(async (cx) => {
      this.limits = await this.newestLimits(machine);
      if (n % 12 === 0) await this.countTokens().catch(() => {});
      if (moved || n % 12 === 0) {
        try {
          const script = await this.helper(machine);
          // --remote every time: fetch the main branch and list open pull requests,
          // so a merge shows within a minute.
          const r = await exec("python3", ["-I", script, folder, "--remote"], { timeout: 90000, on: machine });
          if (where === this.where) {
            // Tell the quest log when anything changed, so it reads again at once.
            if (r.stdout !== this.raw) setShared("quests.updated", Date.now());
            this.raw = r.stdout;
            this.data = JSON.parse(r.stdout);
            this.checkLevel(this.data);
          }
        } catch {}
      }
      cx.notify();
    });
  }

  // A machine's home folder (null: this Mac), asked once.
  async homeOf(machine) {
    if (!machine) return home();
    this.homes ??= new Map();
    if (!this.homes.has(machine)) {
      const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine });
      this.homes.set(machine, r.stdout.trim());
    }
    return this.homes.get(machine);
  }

  // A helper script where it runs: here, or copied to ~/.herdr-quests on another
  // machine (again on each load of this mod, so it never goes stale there).
  async helper(machine, file = "quests.py") {
    const local = `${appHome()}/mods/quest-bar/${file}`;
    if (!machine) return local;
    const remote = `${await this.homeOf(machine)}/.herdr-quests/${file}`;
    this.copied ??= new Set();
    if (!this.copied.has(`${machine}|${file}`)) {
      await exec("sh", ["-c", 'hc file write --on "$1" "$2" < "$3"', "sh", machine, remote, local]);
      this.copied.add(`${machine}|${file}`);
    }
    return remote;
  }

  // Tokens per day on this Mac and every machine connected now (never one that's
  // asleep: reaching a stopped Codespace would start it). A machine that can't
  // answer this time keeps its last count.
  async countTokens() {
    const offset = -new Date().getTimezoneOffset();
    const names = [null, ...machines().filter((m) => m.name && m.layout === "ready").map((m) => m.name)];
    const per = {};
    for (const m of names) {
      const label = m ?? "This Mac";
      try {
        const r = await exec("python3", ["-I", await this.helper(m, "tokens.py"), String(offset)], { timeout: 120000, on: m });
        per[label] = JSON.parse(r.stdout).days;
      } catch {
        if (this.tokens?.days?.[label]) per[label] = this.tokens.days[label];
      }
    }
    this.tokens = summarize(per);
  }

  // The 5-hour and weekly limits are the account's: whichever machine's Claude
  // reported last has the newest numbers.
  async newestLimits(machine) {
    const read = async (m) => {
      try { return JSON.parse(await readTextFile(`${await this.homeOf(m)}/.claude/herdr/rate-limits.json`, { on: m })); } catch { return null; }
    };
    const found = [await read(null), machine ? await read(machine) : null].filter(Boolean);
    return found.sort((a, b) => (b.saved_at ?? 0) - (a.saved_at ?? 0))[0] ?? null;
  }

  // Ding: when a project's level rises past the one last seen here. The first
  // sight of a project only records its level.
  checkLevel(d) {
    if (!d?.bmad) return;
    const level = Math.floor((d.done / Math.max(1, d.total)) * MAX_LEVEL);
    const key = `level:${d.repo}`;
    let seen = null;
    try { seen = localStorage.getItem(key); } catch {}
    try { localStorage.setItem(key, String(level)); } catch {}
    if (seen !== null && level > Number(seen)) this.ding(level);
  }

  ding(level) {
    setShared("quest.level", level);
    openOverlay({ mod: "level-up", kind: "window", frame: "none", width: 560, height: 360, props: { level } });
    playSound(`${appHome()}/mods/quest-bar/ding.wav`);
  }

  // The 5-hour bar's tooltip: both limits and the window's context.
  usage() {
    openOverlay({ mod: "usage-card", kind: "popup", frame: "none", width: 300, height: 290,
      props: { terminal: focused()?.terminal ?? this.terminal, limits: this.limits } });
  }

  // A WoW bar: dark frame, gradient fill, twenty segment ticks.
  bar(id, width, fraction, colors, label, t) {
    const f = Math.max(0, Math.min(1, fraction));
    return div().id(id).relative().w(width).h(17).rounded(2).bg("#05060a").border(1).border_color(FRAME).overflow_hidden()
      .child(v_flex().absolute().left(0).top(0).h_full().w(Math.round((width - 2) * f))
        .child(div().flex_1().bg(colors[0])).child(div().flex_1().bg(colors[1])))
      .child(h_flex().absolute().left(0).top(0).size_full().children(
        Array.from({ length: 20 }, (_, i) => div().flex_1().h_full().when(i < 19, (el) => el.border_r(1).border_color("#00000066")))))
      .child(h_flex().absolute().left(0).top(0).size_full().justify_center().items_center()
        .text_size(11).text_color("#ffffff").child(label));
  }

  fiveHour(t) {
    const five = this.limits?.five_hour;
    const pct = five?.used_percentage ?? five?.utilization;
    if (pct == null) return this.bar("xp", 230, 0, XP, "5h limit · waiting for Claude", t);
    let resets = five.resets_at;
    resets = typeof resets === "number" ? resets * 1000 : Date.parse(resets);
    const past = Number.isFinite(resets) && resets < Date.now();
    const used = past ? 0 : Number(pct);
    const when = Number.isFinite(resets) && !past
      ? ` · resets ${String(new Date(resets).getHours()).padStart(2, "0")}:${String(new Date(resets).getMinutes()).padStart(2, "0")}` : "";
    return this.bar("xp", 230, used / 100, XP, `5h limit ${Math.round(used)}%${when}`, t);
  }

  counter(id, icon, n, label, color) {
    return h_flex().id(id).gap(4).items_center().opacity(n > 0 ? 1 : 0.45)
      .child(image(ICON(icon)).w(10).h(16))
      .child(div().text_color(color).child(`${n} ${label}`));
  }

  // The sessions working on a turn-in story: in its worktree, on its branch,
  // or naming it in their tab or title. Waiting ones first, busy ones last.
  sessions(item) {
    const byPane = new Map(panes().map((p) => [p.pane, p]));
    const [a, b] = item.id.split(".");
    const named = new RegExp(`(^|[^\\d.])${a}[.-]${b}([^\\d]|$)`);
    return agents()
      .filter((ag) => {
        const p = byPane.get(ag.pane);
        return item.paths.some((path) => p?.cwd?.startsWith(path))
          || (item.branch && p?.branch === item.branch)
          || named.test(ag.tab_name) || named.test(ag.title);
      })
      .sort((x, y) => (x.status === "working") - (y.status === "working"));
  }

  // Each click jumps to the next session with something to turn in. A story
  // with no session open opens its pull request instead.
  turnIn(d) {
    const stops = d.turnin.flatMap((item) => {
      const found = this.sessions(item);
      return found.length > 0 ? found.map((ag) => ({ pane: ag.pane })) : item.url ? [{ url: item.url }] : [];
    });
    if (stops.length === 0) return;
    const stop = stops[this.turn++ % stops.length];
    if (stop.pane) run("pane.focus", { pane: stop.pane });
    else exec("open", [stop.url]).catch(() => {});
  }

  quest(d, space, t) {
    const next = d.ready[0] ?? d.next;
    if (!next) return div().text_color(t.muted).child("No quests left. Well met!");
    const title = `${next.id}  ${next.title}`;
    if (this.offering) {
      const button = (id, label, onClick) => div().id(id).px(10).py(2).rounded(3)
        .bg("#7a150d").border(1).border_color(GOLD)
        .text_color(GOLD).text_size(11).hover((s) => s.bg("#b8261a")).on_click(onClick).child(label);
      return h_flex().gap(8).items_center().min_w(0)
        .child(div().text_color(GOLD).truncate().child(`Accept ${next.id}?`))
        .child(button("accept", "Accept", (_e, cx) => {
          this.offering = false;
          run("tab.new", { space: space.id, name: `! ${next.id}`, argv: space.machine ? ["claude", `/bmad-build ${next.id}`] : [`${appHome()}/mods/quest-bar/claude-session`, `/bmad-build ${next.id}`] });
          cx.notify();
        }))
        .child(button("decline", "Decline", (_e, cx) => { this.offering = false; cx.notify(); }));
    }
    return h_flex().id("quest").gap(6).items_center().min_w(0).cursor_pointer()
      .on_click((_e, cx) => { this.offering = true; cx.notify(); })
      .child(image(ICON("excl")).w(13).h(20).flex_shrink_0())
      .child(div().text_color(GOLD).truncate().child(title));
  }

  render() {
    const t = theme();
    const d = this.data;
    const space = spaces().find((s) => s.active);
    const needy = agents().filter((a) => a.status === "blocked" || a.status === "done");

    const root = h_flex().id("root").size_full().px(16).gap(20).items_center().text_size(14)
      .bg("#0d1019f0").border_b(1).border_color(FRAME);

    if (d?.bmad) {
      const level = Math.floor((d.done / Math.max(1, d.total)) * MAX_LEVEL);
      root
        .child(div().id("log").flex_shrink_0().px(8).py(2).rounded(3).border(1).border_color(FRAME)
          .text_color("#c9c0a8").text_size(12).cursor_pointer()
          .hover((s) => s.text_color(GOLD).border_color(GOLD))
          .on_click(() => run("layout.toggle", { id: "questlog" })).child("Quest Log"))
        .child(h_flex().flex_1().min_w(0).child(this.quest(d, space, t)))
        .child(this.counter("ready", "excl", d.ready.length, "ready", GOLD))
        .child(this.counter("active", "quest-active", d.active.length, "in progress", "#d8d8d8"))
        .child(this.counter("turnin", "quest-turnin", d.turnin.length, "to turn in", GOLD)
          .cursor_pointer().on_click(() => this.turnIn(d)))
        .child(v_flex().gap(2).items_center()
          .child(this.bar("rep", 200, d.done / Math.max(1, d.total), REP, `Lvl ${level} · ${d.done}/${d.total} quests`, t)));
    } else {
      root.child(div().flex_1().text_color(t.muted).child(space ? `${space.name}: no quest log here` : ""));
    }

    return root
      .child(this.fiveHour(t).cursor_pointer().on_click(() => this.usage()))
      .child(h_flex().id("needs").gap(4).items_center().cursor_pointer().opacity(needy.length > 0 ? 1 : 0.45)
        .on_click(() => { if (needy[0]) run("pane.focus", { pane: needy[0].pane }); })
        .child(image(ICON(needy.length > 0 ? "excl-red" : "excl")).w(10).h(16))
        .child(div().text_color(needy.length > 0 ? "#ff6b5a" : t.muted).child(`${needy.length} need${needy.length === 1 ? "s" : ""} you`)))
      .child(h_flex().id("gold").gap(5).items_center().cursor_pointer()
        .on_click(() => openOverlay({ mod: "gold-card", kind: "popup", frame: "none", width: 320, height: 300, props: { tokens: this.tokens } }))
        .child(image(ICON("coin")).size(15))
        .child(div().text_color(GOLD).child(`${compact(this.tokens?.today ?? 0)}`))
        .child(div().text_color(t.muted).text_size(12).child("tokens today")));
  }
}
