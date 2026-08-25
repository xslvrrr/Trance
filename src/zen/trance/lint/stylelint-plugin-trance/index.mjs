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
  "Unexpected !important in Trance CSS. Fix the selector or add a rule to trance-reset.css instead (TRANCE.md §6.2 rule 1).",
  (root, report) => {
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
    if (basename(root) === TOKENS_FILE) {
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
    if (file === TOKENS_FILE || file === MOTION_FILE) {
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
 */
const noWillChange = rule(
  "no-will-change",
  "will-change in Trance CSS. TranceMotion.animate() adds and removes it around the animation instead (TRANCE.md §3.5, §6.2 rule 6).",
  (root, report) => {
    root.walkDecls(decl => {
      if (decl.prop.toLowerCase() === "will-change") {
        report(decl);
      }
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
    if (basename(root) === TOKENS_FILE) {
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
