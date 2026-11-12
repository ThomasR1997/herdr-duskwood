import { View, div, image } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, shared, closeOverlay } from "herdr";

const W = 560;
const H = 360;
const GOLD = "#ffd100";

// WoW's level-up: a golden burst swells behind the words, holds, then fades.
// Every move is a native transition; the timers only change the targets.
export default class LevelUp extends View {
  init(_props, cx) {
    this.phase = 0;
    cx.timer.after(40, (cx) => { this.phase = 1; cx.notify(); });
    cx.timer.after(3400, (cx) => { this.phase = 2; cx.notify(); });
    cx.timer.after(4300, () => this.close());
  }

  close() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  // Gold letters with a dark outline: dark copies nudged around, gold on top.
  outlined(text, size) {
    const nudges = [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, 2], [-2, 2], [2, -2], [0, 4]];
    return div().relative()
      .children(nudges.map(([x, y]) => div().absolute().left(x).top(y).text_size(size).text_color("#2a1400").child(text)))
      .child(div().relative().text_size(size).text_color(GOLD).child(text));
  }

  render() {
    const level = props()?.level ?? shared("quest.level") ?? "?";
    const p = this.phase;
    const burst = p === 0 ? 40 : p === 1 ? 340 : 420;
    const shown = p === 1 ? 1 : 0;
    return div().id("root").relative().w(W).h(H).cursor_pointer().on_click(() => this.close())
      // The burst grows from its centre: its left/top move as its size does.
      .child(div().absolute().left((W - burst) / 2).top((H - burst) / 2 - 10).w(burst).h(burst)
        .opacity(p === 2 ? 0 : 1)
        .transition("width", { duration: 700, easing: "ease-out" })
        .transition("height", { duration: 700, easing: "ease-out" })
        .transition("left", { duration: 700, easing: "ease-out" })
        .transition("top", { duration: 700, easing: "ease-out" })
        .transition("opacity", { duration: 800, easing: "ease-in" })
        .child(image("mods/level-up/burst.svg").size_full().loop("opacity", { from: 0.75, to: 1, period: 900 })))
      // The words rise into place as they appear.
      .child(v_flex().absolute().left(0).w(W).top(p === 0 ? 150 : 112).items_center().gap(2)
        .opacity(shown)
        .transition("top", { duration: 600, easing: "ease-out" })
        .transition("opacity", { duration: p === 2 ? 700 : 350, delay: p === 1 ? 150 : 0 })
        .child(this.outlined("Level Up!", 56))
        .child(div().px(14).py(4).rounded(4).bg("#000000a0").text_size(19).text_color("#fff6c2")
          .child(`You have reached Level ${level}`)));
  }
}
