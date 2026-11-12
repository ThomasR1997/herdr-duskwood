import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, hc, agents, notify } from "herdr";

// The choices Claude Code's /model and /effort take.
// Models by full id, so a pick is exactly that version, not what an alias points to.
const MODELS = [
  { value: "claude-fable-5-2", label: "Fable 5.2", note: "longest, toughest work" },
  { value: "claude-opus-5-5", label: "Opus 5.5", note: "everyday default" },
  { value: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "faster, lighter" },
  { value: "claude-haiku-5-5", label: "Haiku 5.5", note: "quickest" },
];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"].map((value) => ({ value, label: value }));
const GOLD = "#ffd100";
const FRAME = "#5c4d2e";

// A popup from the status bar: props {terminal, kind: "model" | "effort", current}.
// Picking one types the slash command into that Claude session, only while it waits
// for a prompt (idle, or done = finished unseen), so it never lands in a running turn
// or a permission prompt.
export default class ModelMenu extends View {
  pick(value) {
    const { terminal, kind, overlay } = props();
    closeOverlay(overlay);
    const status = agents().find((a) => a.address === terminal)?.status;
    if (status !== "idle" && status !== "done") {
      notify({ title: `Not switched`, body: `Claude is ${status ?? "gone"}; try again when it's waiting.`, level: "warning" });
      return;
    }
    hc(["send", terminal, `/${kind} ${value}`])
      .then((r) => { if (r.code !== 0) throw new Error(r.stderr || r.stdout); })
      .catch((e) => notify({ title: "Not switched", body: String(e?.message ?? e).slice(0, 200), level: "error" }));
  }

  render() {
    const { kind, current } = props() ?? {};
    const items = kind === "effort" ? EFFORTS : MODELS;
    const now = String(current ?? "").toLowerCase();
    return v_flex().id("root").w_full().p(6).gap(2).bg("#0d1019").border(1).border_color(FRAME).rounded(4).text_size(13)
      .child(div().px(8).py(4).text_size(11).text_color("#8f8770").child(kind === "effort" ? "Effort" : "Model"))
      .children(items.map((item) => {
        const on = now === item.label.toLowerCase() || now === item.value;
        return h_flex().id(`i-${item.value}`).px(8).py(5).gap(8).rounded(3).items_center().cursor_pointer()
          .when(on, (el) => el.bg("#2a2416"))
          .hover((s) => s.bg("#1f2639"))
          .on_click(() => this.pick(item.value))
          .child(div().w(10).text_color(GOLD).child(on ? "◆" : ""))
          .child(div().flex_1().text_color(on ? GOLD : "#e6dcc2").child(item.label))
          .when(Boolean(item.note), (el) => el.child(div().text_size(11).text_color("#8f8770").child(item.note)));
      }));
  }
}
