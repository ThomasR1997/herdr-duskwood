// A session's (tab's) menu from the sidebar's ⋯ button, opened as a popup with
// props { tab, name, settled, last }. A archives (tab.settle: put away, still
// running) or unarchives; D deletes (tab.close, which ends its terminals) after
// one confirmation. Esc closes.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay } from "herdr";

const GOLD = "#ffd100";
const FRAME = "#5c4d2e";

export default class SessionMenu extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.confirming = false;
  }

  close() {
    closeOverlay(props().overlay);
  }

  archive() {
    const p = props();
    this.close();
    run(p.settled ? "tab.unsettle" : "tab.settle", { id: p.tab });
  }

  remove() {
    const p = props();
    this.close();
    run("tab.close", { id: p.tab, confirmed: true });
  }

  item(id, label, key, color, onClick) {
    return h_flex().id(id).h(28).px(10).gap(10).items_center().rounded(4).cursor_pointer()
      .hover((s) => s.bg("#1f2639")).on_click(onClick)
      .child(div().flex_1().text_color(color).child(label))
      .child(div().px(5).rounded(3).border(1).border_color(FRAME).text_size(11).text_color("#a39a84").child(key));
  }

  render() {
    const p = props() ?? {};
    const root = v_flex().id("session-menu").track_focus(this.handle)
      .on_key_down((e, cx) => {
        const key = e.key?.toLowerCase();
        if (key === "escape") this.confirming ? (this.confirming = false, cx.notify()) : this.close();
        else if (this.confirming && (key === "enter" || key === "d")) this.remove();
        else if (!this.confirming && key === "a") this.archive();
        else if (!this.confirming && key === "d") { this.confirming = true; cx.notify(); }
        else return;
        cx.stop_propagation();
      })
      .size_full().p(5).gap(2).bg("#0d1019").border(1).border_color(FRAME).rounded(5).text_size(13);

    if (this.confirming) {
      return root
        .child(div().px(8).pt(4).text_color("#ffffff").child(`Delete “${p.name}”?`))
        .child(div().px(8).pb(4).text_size(11.5).text_color("#a39a84")
          .child(p.last ? "Ends its sessions. It's the space's only tab, so the space closes too." : "Ends its sessions and closes the tab."))
        .child(this.item("yes", "Delete", "D / ↵", "#ff6b5a", () => this.remove()))
        .child(this.item("no", "Cancel", "Esc", "#e6dcc2", (_e, cx) => { this.confirming = false; cx.notify(); }));
    }
    return root
      .child(div().px(8).py(3).text_size(11).text_color("#8f8770").truncate().child(p.name ?? ""))
      .child(this.item("archive", p.settled ? "Unarchive" : "Archive", "A", GOLD, () => this.archive()))
      .child(this.item("delete", "Delete", "D", "#ff6b5a", (_e, cx) => { this.confirming = true; cx.notify(); }));
  }
}
