import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, agents, panes, run, exec, appHome, home, shared } from "herdr";

// WoW quest difficulty colours, and what each means for a BMAD story.
const DIFFICULTY = [
  { key: "grey", color: "#9d9d9d", label: "Done" },
  { key: "green", color: "#40c040", label: "Turn in" },
  { key: "yellow", color: "#ffe633", label: "Available" },
  { key: "orange", color: "#ffa033", label: "Design first" },
  { key: "red", color: "#ff2a1f", label: "Blocked" },
];
const COLOR = Object.fromEntries(DIFFICULTY.map((d) => [d.key, d.color]));
const GOLD = "#ffd100";
const FRAME = "#5c4d2e";
const PARCHMENT = "#e6d6ac";
const INK = "#2e1f0b";
const INK_HEAD = "#6b3d00";

export default class QuestLog extends View {
  init(_props, cx) {
    this.where = null;
    this.data = null;
    this.selected = null;
    this.shown = new Set(["green", "yellow", "orange", "red"]);
    this.folded = new Set();
    this.ticks = 0;
    this.tick(cx);
    cx.timer.every(5000, (cx) => this.tick(cx));
  }

  // The shown space's quests, again when the space changes and every minute,
  // read on the space's own machine.
  tick(cx) {
    const space = spaces().find((s) => s.active);
    const machine = space?.machine ?? null;
    const folder = space?.folder || home();
    const where = `${machine ?? ""}|${folder}`;
    const moved = where !== this.where;
    if (moved) this.where = where;
    // The quest bar marks each change it sees (a merge, a new PR): read again then too.
    const stamp = shared("quests.updated");
    const changed = stamp !== this.stamp;
    this.stamp = stamp;
    if (!moved && !changed && this.ticks++ % 12 !== 0) return;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", await this.helper(machine), folder, "--log"], { timeout: 90000, on: machine });
        if (where === this.where) this.data = JSON.parse(r.stdout);
      } catch {}
      cx.notify();
    });
  }

  // quests.py where it runs: here, or copied to ~/.herdr-quests on another
  // machine (again on each load of this mod, so it never goes stale there).
  async helper(machine) {
    const local = `${appHome()}/mods/quest-bar/quests.py`;
    if (!machine) return local;
    this.homes ??= new Map();
    if (!this.homes.has(machine)) {
      const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine });
      this.homes.set(machine, r.stdout.trim());
      await exec("sh", ["-c", 'hc file write --on "$1" "$2" < "$3"', "sh", machine, `${r.stdout.trim()}/.herdr-quests/quests.py`, local]);
    }
    return `${this.homes.get(machine)}/.herdr-quests/quests.py`;
  }

  // The sessions working on a story: in its worktree, on its branch (or a
  // branch naming it), or naming it in their tab or title. Waiting ones first.
  sessions(q) {
    const byPane = new Map(panes().map((p) => [p.pane, p]));
    const [a, b] = q.id.split(".");
    const named = new RegExp(`(^|[^\\d.])${a}[.-]${b}([^\\d]|$)`);
    const t = q.turnin;
    return agents()
      .filter((ag) => {
        const p = byPane.get(ag.pane);
        return (t?.paths ?? []).some((path) => p?.cwd?.startsWith(path))
          || (t?.branch && p?.branch === t.branch)
          || named.test(p?.branch ?? "") || named.test(ag.tab_name) || named.test(ag.title);
      })
      .sort((x, y) => (x.status === "working") - (y.status === "working"));
  }

  header(d) {
    return h_flex().px(14).h(44).flex_shrink_0().items_center().gap(8).border_b(1).border_color(FRAME)
      .child(image("mods/quest-bar/excl.svg").w(11).h(17))
      .child(div().text_size(16).text_color(GOLD).child("Quest Log"))
      .child(div().flex_1())
      .child(div().text_size(12).text_color("#c9c0a8").child(d?.bmad ? `${d.done}/${d.total}` : ""))
      .child(div().id("close").px(6).text_size(14).text_color("#c9c0a8").cursor_pointer()
        .hover((s) => s.text_color(GOLD))
        .on_click(() => run("layout.hide", { id: "questlog" })).child("✕"));
  }

  // The legend doubles as the filter: click a difficulty to show or hide it.
  filters(log) {
    return h_flex().px(12).py(8).gap(6).flex_wrap().flex_shrink_0().border_b(1).border_color(FRAME).children(
      DIFFICULTY.map((d) => {
        const on = this.shown.has(d.key);
        const n = log.filter((q) => q.color === d.key).length;
        return h_flex().id(`f-${d.key}`).gap(5).items_center().px(7).py(2).rounded(3).cursor_pointer()
          .border(1).border_color(on ? d.color : "#2a2a2a").opacity(on ? 1 : 0.5)
          .on_click((_e, cx) => { on ? this.shown.delete(d.key) : this.shown.add(d.key); cx.notify(); })
          .child(div().size(8).rounded(4).bg(d.color))
          .child(div().text_size(11).text_color(d.color).child(`${d.label} ${n}`));
      }));
  }

  list(d) {
    const rows = [];
    const byEpic = new Map();
    for (const q of d.log) {
      if (!byEpic.has(q.epic)) byEpic.set(q.epic, []);
      byEpic.get(q.epic).push(q);
    }
    for (const [epic, quests] of byEpic) {
      const visible = quests.filter((q) => this.shown.has(q.color));
      if (visible.length === 0) continue;
      const folded = this.folded.has(epic);
      const done = quests.filter((q) => q.color === "grey").length;
      rows.push(h_flex().id(`e-${epic}`).px(12).pt(10).pb(4).gap(6).items_center().cursor_pointer()
        .on_click((_e, cx) => { folded ? this.folded.delete(epic) : this.folded.add(epic); cx.notify(); })
        .child(div().w(12).text_color("#c9c0a8").text_size(12).child(folded ? "+" : "–"))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color("#efe6cf")
          .child(d.epic_titles[epic] ?? `Epic ${epic}`))
        .child(div().text_size(11).text_color("#8f8770").child(`${done}/${quests.length}`)));
      if (folded) continue;
      for (const q of visible) {
        const picked = this.selected === q.id;
        rows.push(h_flex().id(`q-${q.id}`).pl(30).pr(12).py(3).gap(8).items_center().cursor_pointer()
          .when(picked, (el) => el.bg("#2a2416"))
          .hover((s) => s.bg("#1c1a16"))
          .on_click((_e, cx) => { this.selected = picked ? null : q.id; cx.notify(); })
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(COLOR[q.color])
            .child(`[${q.id}] ${q.title}`))
          .when(this.sessions(q).length > 0, (el) => el.child(image("mods/quest-log/pin.svg").w(9).h(13).flex_shrink_0()))
          .child(div().flex_shrink_0().text_size(10.5).text_color("#8f8770").child(q.label)));
      }
    }
    if (rows.length === 0) rows.push(div().p(16).text_color("#8f8770").child("No quests match these filters."));
    return v_flex().id("list").flex_1().min_h(0).overflow_y_scrollbar().pb(10).children(rows);
  }

  button(id, label, onClick) {
    return div().id(id).px(12).py(4).rounded(3).bg("#7a150d").border(1).border_color(GOLD)
      .text_size(12).text_color(GOLD).cursor_pointer().hover((s) => s.bg("#9a2016"))
      .on_click(onClick).child(label);
  }

  // The parchment page, as in WoW's quest log.
  detail(q, space) {
    const found = this.sessions(q);
    const actions = [];
    // Show on Map jumps to the session working on it; each click goes to the next one.
    if (found.length > 0) {
      actions.push(this.button("map", found.length > 1 ? `Show on Map (${found.length})` : "Show on Map", () => {
        this.hop = ((this.hop ?? -1) + 1) % found.length;
        run("pane.focus", { pane: found[this.hop].pane });
      }));
    } else if (q.color === "yellow" && space) {
      actions.push(this.button("accept", "Accept", () =>
        run("tab.new", { space: space.id, name: `! ${q.id}`, argv: space.machine ? ["claude", `/bmad-build ${q.id}`] : [`${appHome()}/mods/quest-bar/claude-session`, `/bmad-build ${q.id}`] })));
    }
    if (q.turnin?.url) actions.push(this.button("pr", `Open PR #${q.turnin.pr}`, () => exec("open", [q.turnin.url]).catch(() => {})));
    if (q.file) actions.push(this.button("file", "Open story", () => exec("open", [q.file]).catch(() => {})));

    const heading = (text) => div().pt(10).pb(3).text_size(13).text_color(INK_HEAD).child(text);
    return v_flex().id("detail").h(330).flex_shrink_0().bg(PARCHMENT).border_t(2).border_color(FRAME)
      .child(v_flex().id("page").flex_1().min_h(0).overflow_y_scrollbar().px(16).py(12).text_color(INK).text_size(12.5)
        .child(h_flex().gap(8).items_center()
          .child(div().size(10).rounded(5).bg(COLOR[q.color]).border(1).border_color(INK))
          .child(div().flex_1().text_size(15).text_color(INK).child(`${q.id}  ${q.title}`)))
        .when(Boolean(q.story), (el) => el.child(heading("Description")).child(div().child(q.story)))
        .child(heading(q.label))
        .child(div().text_color("#4a3a1f").child(q.note || "Nothing noted.")))
      .when(actions.length > 0, (el) => el.child(h_flex().px(12).py(8).gap(8).flex_wrap().bg("#1a140a").children(actions)));
  }

  render() {
    const d = this.data;
    const space = spaces().find((s) => s.active);
    const root = v_flex().id("root").size_full().bg("#0d1019").text_color("#e6dcc2");
    if (!d?.bmad) {
      return root.child(this.header(d)).child(div().p(16).text_color("#8f8770")
        .child(d ? `${space?.name ?? "This space"} has no BMAD quest log.` : "Unrolling the scroll…"));
    }
    const q = d.log.find((x) => x.id === this.selected);
    return root.child(this.header(d)).child(this.filters(d.log)).child(this.list(d))
      .when(Boolean(q), (el) => el.child(this.detail(q, space)));
  }
}
