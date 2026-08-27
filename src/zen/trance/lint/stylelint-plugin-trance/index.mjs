/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Trance: the stylelint plugin that enforces TRANCE.md §6.2.
 *
 * These are not style preferences. Each rule here corresponds to a specific
 * failure mode diagnosed in TRANCE.md §3 — the reasons the mod stack produced
 * visual artifacts and drained power. A reviewer will not catch a stray
 * `!important` or a second `backdrop-filter` reliably; the linter will.
 *
 * Enabled only for `zen/trance/**` in .stylelintrc.js, so upstream Zen and
 * Firefox CSS is unaffected.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// `npm run import` symlinks Trance's source files into the build tree, so this
// module's real path is under `src/`, where there is no node_modules chain that
// reaches stylelint. A bare `import "stylelint"` therefore fails to resolve.
// Resolve against the directory stylelint is actually running in instead.
const requireFromCwd = createRequire(
  pathToFileURL(`${globalThis.process.cwd()}/`)
);
const { createPlugin, utils } = requireFromCwd("stylelint");

const NAMESPACE = "trance";

/** The one file allowed to declare custom properties and literal colours. */
const TOKENS_FILE = "trance-tokens.css";
/** The one file allowed to declare durations and easings besides the tokens. */
const MOTION_FILE = "trance-motion.css";
/** The one file allowed to apply `backdrop-filter`. */
const SURFACES_FILE = "trance-surfaces.css";

/**
 * The one file that is not an author sheet.
 *
 * `trance-internal.css` is registered with `nsIStyleSheetService` as a USER
 * sheet so that it can reach `about:` documents, where no chrome stylesheet is
 * in scope. That is a different cascade origin, and three of the rules below
 * are about author-sheet-versus-author-sheet conflicts specifically:
 *
 *   - `no-important`: in the author origin `!important` is how the mod stack
 *     fought itself (TRANCE.md §3.1). In the user origin it is the documented
 *     way to sit above a page's own author rules, and there is no alternative —
 *     the in-content theme declares some of these normally and some with
 *     `!important`, and user-normal loses to author-normal.
 *   - `no-literal-colors` and `root-tokens-only-in-tokens-file`: the token layer
 *     is a chrome stylesheet. It is not loaded in a content document, so
 *     `var(--trance-*)` resolves to nothing there. The file has to carry its own
 *     small set of values, and it does so in one block at the top.
 *
 * This is an exemption for one named file with a stated reason, not a hole:
 * every other rule still applies to it, and no other file may be added here
 * without the same argument.
 */
const USER_SHEET_FILE = "trance-internal.css";

/**
 * The one file that has to answer a third-party author sheet.
 *
 * Trance ships the Sine mod manager (ADR-018), so Sine's own pane is part of
 * this browser's settings page. Sine's stylesheet is an author sheet injected
 * into the same document at runtime, and roughly a dozen of its declarations
 * carry `!important` — its card background, its shadow, its radius, its padding
 * and its primary button's fill. Inside one origin `!important` beats normal
 * whatever the selector says, so no specificity answers it.
 *
 * That is a different situation from the one the ban is about. §6.2 rule 1
 * exists because the mod stack used `!important` to fight *itself*: four
 * stylesheets over one element with a winner that changed with load order
 * (§3.1). Here there are exactly two sheets, in a fixed order, and Trance's is
 * the one that is meant to win. The exemption is for that file and that
 * argument; every other rule still applies to it.
 */
const SINE_SHEET_FILE = "trance-sine.css";

/**
 * The files that own a palette for a document the token layer cannot reach.
 *
 * `TranceCore` loads trance-tokens.css into browser windows only, so inside
 * `about:preferences` every `--trance-*` resolves to nothing. Firefox's own
 * in-content design tokens are in scope there and are consumed wherever they
 * answer the question — but "the settings page is black" is not a question they
 * answer, and a design that could only be expressed in the values Firefox
 * happened to pick would not be a design.
 *
 * trance-settings.css is therefore the token owner for that document, on the
 * same terms trance-tokens.css is for a browser window: one block, at the top
 * of the file, and nothing below it declares a colour. trance-sine.css consumes
 * that block and declares none of its own — it is listed because two of its
 * shadows need an alpha and there is no token for one.
 */
const PALETTE_FILES = [USER_SHEET_FILE, "trance-settings.css", SINE_SHEET_FILE];

/**
 * The sheets that are not loaded into a browser window.
 *
 * `about:preferences` is a content-ish document. `TranceCore` loads the token
 * layer into browser windows only, so in these files `var(--trance-dur-*)` and
 * `var(--trance-ease-*)` resolve to nothing — a rule written against them would
 * not be a rule, it would be a no-op that reads as one.
 *
 * They are therefore exempt from the duration rule. `no-literal-colors` is a
 * separate list (`PALETTE_FILES`): trance-mod-guard.css is on this one and not
 * on that one, because Firefox's own status colours answer its question exactly
 * and there is simply no equivalent for a duration.
 */
const TOKENLESS_FILES = [
  USER_SHEET_FILE,
  "trance-settings.css",
  "trance-mod-guard.css",
  SINE_SHEET_FILE,
];

/**
 * The reset layer, and the one file allowed to write `will-change: auto`.
 *
 * §6.2 rule 6 bans `will-change` because a static one *promotes* a permanent
 * compositor layer. `will-change: auto` is the initial value: it does the
 * opposite, and it is the only way to take back a promotion an upstream Zen
 * sheet declared statically on an element Trance does not own. Fighting it any
 * other way would need `!important`, which rule 1 bans for better reasons.
 *
 * The exemption is exactly `auto`, exactly here. Any other value in this file
 * is still rejected, and every other rule still applies to it.
 *
 * Refs: TRANCE.md §3.5, §6.2 rule 6, §13 Phase 11
 */
const RESET_SHEET_FILE = "trance-reset.css";

const ruleName = id => `${NAMESPACE}/${id}`;

function basename(node) {
  const file = node.source?.input?.file ?? "";
  return file.split("/").pop() ?? "";
}

/**
 * Builds a plugin from a short definition, so each rule below is just its
 * message, its check, and the TRANCE.md section it enforces.
 *
 * @param {string} id
 * @param {string} message
 * @param {(root: import("postcss").Root, report: Function) => void} check
 */
function rule(id, message, check) {
  const fullName = ruleName(id);
  const messages = utils.ruleMessages(fullName, { rejected: message });

  const ruleFunction = primary => (root, result) => {
    if (
      !utils.validateOptions(result, fullName, {
        actual: primary,
        possible: [true],
      })
    ) {
      return;
    }
    const report = (node, extra = "") =>
      utils.report({
        message: extra ? `${messages.rejected} ${extra}` : messages.rejected,
        node,
        result,
        ruleName: fullName,
      });
    check(root, report);
  };

  ruleFunction.ruleName = fullName;
  ruleFunction.messages = messages;
  return createPlugin(fullName, ruleFunction);
}

/**
 * §6.2 rule 1 — no `!important` anywhere in Trance.
 *
 * `!important` is how every mod tried to win the cascade, and it is why the
 * winner changed between sessions (TRANCE.md §3.1). If a Trance rule needs it,
 * the selector is wrong or the reset layer is missing an entry.
 */
const noImportant = rule(
  "no-important",
  "Unexpected !important in Trance CSS. Fix the selector, add a rule to trance-reset.css, or — if the sheet it has to answer is a third party's — say so where the exemptions are listed (TRANCE.md §6.2 rule 1).",
  (root, report) => {
    const file = basename(root);
    if (file === USER_SHEET_FILE || file === SINE_SHEET_FILE) {
      return;
    }
    root.walkDecls(decl => {
      if (decl.important) {
        report(decl);
      }
    });
  }
);

/**
 * §6.2 rule 2 — literal colours only in the tokens file.
 *
 * One owner per colour. Everything else consumes `--trance-*`.
 */
const COLOUR_PATTERN =
  /(^|[\s,(])(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|\b(?:red|blue|green|black|white|gray|grey|orange|purple|yellow|pink|cyan|magenta)\b)/i;

const noLiteralColors = rule(
  "no-literal-colors",
  `Literal colour outside ${TOKENS_FILE}. Add a --trance-* token and consume it (TRANCE.md §6.2 rule 2).`,
  (root, report) => {
    if ([TOKENS_FILE, ...PALETTE_FILES].includes(basename(root))) {
      return;
    }
    root.walkDecls(decl => {
      // `currentColor` and `transparent` carry no palette decision.
      const value = decl.value.replace(/\b(currentColor|transparent)\b/gi, "");
      if (COLOUR_PATTERN.test(value)) {
        report(decl);
      }
    });
  }
);

/**
 * §6.2 rule 3 — literal durations and easings only in the tokens and motion
 * files. Consistent timing is most of what makes a chrome feel like one system
 * rather than a pile of patches.
 */
const DURATION_PATTERN = /(^|[\s,(])\d*\.?\d+m?s\b/;
// Anchored on token boundaries so `var(--trance-ease-standard)` — which is the
// correct thing to write — is not mistaken for a literal `ease`.
const EASING_PATTERN =
  /(^|[\s,(])(cubic-bezier\(|steps\(|linear|ease-in-out|ease-in|ease-out|ease)([\s,)]|$)/;

const noLiteralDurations = rule(
  "no-literal-durations",
  `Literal duration or easing outside ${TOKENS_FILE}/${MOTION_FILE}. Use a --trance-dur-* or --trance-ease-* token (TRANCE.md §6.2 rule 3).`,
  (root, report) => {
    const file = basename(root);
    if (
      file === TOKENS_FILE ||
      file === MOTION_FILE ||
      TOKENLESS_FILES.includes(file)
    ) {
      return;
    }
    root.walkDecls(decl => {
      const prop = decl.prop.toLowerCase();
      const timingProp =
        prop.startsWith("transition") ||
        prop.startsWith("animation") ||
        prop === "scroll-behavior";
      if (!timingProp) {
        return;
      }
      if (
        DURATION_PATTERN.test(decl.value) ||
        EASING_PATTERN.test(decl.value)
      ) {
        report(decl);
      }
    });
  }
);

/**
 * §6.2 rule 4 — no infinite animations.
 *
 * The single biggest idle-CPU contributor in the mod stack: chrome animations
 * are not throttled by Gecko, so one `infinite` keeps the refresh driver
 * ticking at display rate forever, even offscreen (TRANCE.md §3.4).
 */
const noInfiniteAnimation = rule(
  "no-infinite-animation",
  "Infinite animation in Trance CSS. Drive looping visuals from TranceScheduler, which suspends on blur and occlusion (TRANCE.md §3.4, §6.2 rule 4).",
  (root, report) => {
    root.walkDecls(decl => {
      const prop = decl.prop.toLowerCase();
      if (prop !== "animation" && prop !== "animation-iteration-count") {
        return;
      }
      if (/\binfinite\b/i.test(decl.value)) {
        report(decl);
      }
    });
  }
);

/**
 * §6.2 rule 5 — `backdrop-filter` only in trance-surfaces.css.
 *
 * Each blur surface forces its own compositor layer, defeats occlusion culling
 * for whatever is behind it, and costs a full separable Gaussian pass per
 * frame. Four stacked blurs over the sidebar meant four full-region passes at
 * 120 Hz for a completely static UI (TRANCE.md §3.3). One file owns the budget.
 *
 * `backdrop-filter: none` is allowed anywhere: removing a blur is the opposite
 * of adding one.
 */
const noBackdropFilter = rule(
  "no-backdrop-filter",
  `backdrop-filter outside ${SURFACES_FILE}. The blur budget is one surface per window region and it is owned by that file (TRANCE.md §3.3, §6.2 rule 5).`,
  (root, report) => {
    if (basename(root) === SURFACES_FILE) {
      return;
    }
    root.walkDecls(decl => {
      if (!/^(-\w+-)?backdrop-filter$/i.test(decl.prop)) {
        return;
      }
      if (decl.value.trim().toLowerCase() === "none") {
        return;
      }
      report(decl);
    });
  }
);

/**
 * §6.2 rule 6 — `will-change` never appears in CSS.
 *
 * Static `will-change` promotes a permanent compositor layer for an element
 * that animates for 200 ms a day. TranceMotion adds it for the lifetime of an
 * animation and removes it afterwards (TRANCE.md §3.5).
 *
 * `will-change: auto` in the reset layer is the one exception, and it enforces
 * the same rule rather than bending it — see `RESET_SHEET_FILE`.
 */
const noWillChange = rule(
  "no-will-change",
  "will-change in Trance CSS. TranceMotion.animate() adds and removes it around the animation instead (TRANCE.md §3.5, §6.2 rule 6).",
  (root, report) => {
    const inResetSheet = basename(root) === RESET_SHEET_FILE;
    root.walkDecls(decl => {
      if (decl.prop.toLowerCase() !== "will-change") {
        return;
      }
      if (inResetSheet && decl.value.trim().toLowerCase() === "auto") {
        return;
      }
      report(decl);
    });
  }
);

/**
 * §6.2 rule 7 — one ID or three classes/attributes, max.
 *
 * High-specificity selectors are how the mods ended up in an arms race that
 * `!important` finished. A selector that needs more than this is styling
 * something Trance does not own; the fix is a reset-layer entry, not a longer
 * selector. Add `/* trance-specificity: <reason> *\/` above the rule to opt out.
 */
const maxSpecificity = rule(
  "max-specificity",
  "Selector exceeds the Trance specificity budget (one ID or three classes/attributes). Add a trance-specificity comment justifying it, or move the override to trance-reset.css (TRANCE.md §6.2 rule 7).",
  (root, report) => {
    root.walkRules(node => {
      const previous = node.prev();
      if (
        previous?.type === "comment" &&
        previous.text.trim().startsWith("trance-specificity:")
      ) {
        return;
      }
      // Keyframe selectors ("from", "50%") are not selectors in this sense.
      if (
        node.parent?.type === "atrule" &&
        /keyframes$/i.test(node.parent.name)
      ) {
        return;
      }
      for (const selector of node.selectors ?? []) {
        // A functional pseudo takes the specificity of its heaviest argument,
        // so collapse it to a single unit rather than counting what is inside.
        const flattened = selector.replace(
          /:(?:is|where|not|has|matches)\([^)]*\)/gi,
          ":x"
        );
        const ids = (flattened.match(/#[\w-]+/g) ?? []).length;
        const classesAndAttributes =
          (flattened.match(/\.[\w-]+/g) ?? []).length +
          (flattened.match(/\[[^\]]+\]/g) ?? []).length;

        if (ids > 1 || classesAndAttributes > 3) {
          report(node, `("${selector}")`);
          break;
        }
      }
    });
  }
);

/**
 * §6.2 — only trance-tokens.css declares custom properties on `:root`.
 *
 * This is the mechanism the whole anti-conflict design rests on: one token
 * layer, one owner per property. A feature that declares its own `:root` block
 * has reintroduced the exact ambiguity TRANCE.md §3.1 describes.
 */
const rootTokensOnlyInTokensFile = rule(
  "root-tokens-only-in-tokens-file",
  `Custom property declared on :root outside ${TOKENS_FILE}. One token layer, one owner per property (TRANCE.md §6.2).`,
  (root, report) => {
    if ([TOKENS_FILE, USER_SHEET_FILE].includes(basename(root))) {
      return;
    }
    root.walkRules(node => {
      if (!(node.selectors ?? []).some(sel => /(^|\s):root\b/.test(sel))) {
        return;
      }
      // Direct children only. A nested rule inside a `:root` block targets some
      // other element and is checked on its own terms when walkRules reaches it.
      for (const child of node.nodes ?? []) {
        if (child.type === "decl" && child.prop.startsWith("--")) {
          report(child);
        }
      }
    });
  }
);

export default [
  noImportant,
  noLiteralColors,
  noLiteralDurations,
  noInfiniteAnimation,
  noBackdropFilter,
  noWillChange,
  maxSpecificity,
  rootTokensOnlyInTokensFile,
];
