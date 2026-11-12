import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, closeOverlay } from "herdr";

const GOLD = "#ffd100";
const FRAME = "#c9a227";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const compact = (n) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`;
const date = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${y === new Date().getFullYear() ? "" : ` ${y}`}`;
};

// A WoW tooltip from the quest bar's gold coin: Claude tokens used today, in
// the last 7 days and all time, together and per machine. props {tokens}, as
// the quest bar summarised them.
export default class GoldCard extends View {
  row(title, field, note) {
    const tk = props()?.tokens;
    const machines = tk?.machines ?? [];
    return v_flex().gap(3)
      .child(h_flex().justify_between().items_center()
        .child(div().text_color(GOLD).child(title))
        .child(h_flex().gap(5).items_center()
          .child(image("mods/quest-bar/coin.svg").size(13))
          .child(div().text_color("#ffffff").child(compact(tk?.[field] ?? 0)))))
      .when(machines.length > 1, (el) => el.child(div().text_size(11).text_color("#a39a84").truncate()
        .child(machines.map((m) => `${m.name} ${compact(m[field])}`).join("  ·  "))))
      .when(Boolean(note), (el) => el.child(div().text_size(11).text_color("#8f8770").child(note)));
  }

  render() {
    const tk = props()?.tokens;
    return v_flex().id("root").w(320).p(14).gap(12).bg("#0a0c16f2").border(1).border_color(FRAME).rounded(5)
      .text_size(12.5).text_color("#e6dcc2").cursor_pointer()
      .on_click(() => { const id = props()?.overlay; if (id) closeOverlay(id); })
      .child(div().text_size(15).text_color("#ffffff").child("Gold"))
      .when(!tk, (el) => el.child(div().text_color("#a39a84").child("Still counting… open it again in a moment.")))
      .when(Boolean(tk), (el) => el
        .child(this.row("Today", "today"))
        .child(this.row("Last 7 days", "week"))
        .child(this.row("All time", "all", tk.since ? `Since ${date(tk.since)}, the oldest history Claude has kept` : null))
        .child(div().h(1).bg("#5c4d2e"))
        .child(div().text_size(11).text_color("#8f8770")
          .child("Input, output and cache writes, subagents included. Cache reads are left out: they re-count the same context every turn.")));
  }
}
