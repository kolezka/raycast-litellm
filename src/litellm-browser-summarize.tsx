import { BrowserExtension, Detail, showToast, Toast } from "@raycast/api";
import * as React from "react";
import { AnswerView } from "./lib/ui/AnswerView/main";
import { CommandName } from "./lib/enums";
import { PROMPTS } from "./lib/prompts";

const NO_BROWSER = `# Could not read the browser tab

This command reads the frontmost browser tab, which needs the **Raycast browser extension**
installed and a tab open in a supported browser.

Install it from Raycast Settings → Extensions → Browser Extension, then run the command again.`;

/**
 * Unlike the other transformation commands, this one cannot let `AnswerView`
 * acquire its own input: the input is the page, not the selection. So the page
 * text is fetched here and handed down, and `AnswerView` is not rendered until
 * it arrives — rendering earlier would make it fall back to reading the
 * selection and summarize whatever text happened to be highlighted.
 */
export default function Command(): React.JSX.Element {
  const p = PROMPTS[CommandName.BROWSER_SUMMARIZE];
  if (!p) throw new Error("Missing prompt definition for browser-summarize");

  const [page, setPage] = React.useState<string | undefined>();
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const content = await BrowserExtension.getContent({ format: "markdown" });
        if (!cancelled) setPage(content);
      } catch (err) {
        if (cancelled) return;
        setFailed(true);
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not read the browser tab",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <Detail markdown={NO_BROWSER} />;
  if (page === undefined) return <Detail isLoading markdown="" />;

  return (
    <AnswerView
      command={CommandName.BROWSER_SUMMARIZE}
      prompt={p.template}
      creativity={p.creativity}
      input={page}
      inputPlaceholder="browser-tab"
    />
  );
}
