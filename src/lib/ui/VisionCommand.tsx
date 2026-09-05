import { Detail, showToast, Toast } from "@raycast/api";
import * as React from "react";
import { AnswerView } from "./AnswerView/main";
import { getCommandImages } from "./image";
import { CommandName } from "../enums";
import { PROMPTS } from "../prompts";
import { ChatImage } from "../litellm/types";

/**
 * Shell shared by the two vision commands.
 *
 * Like Summarize Website, these cannot let `AnswerView` acquire their own
 * input: it is an image, not a selection. The images are read here and
 * `AnswerView` is not rendered until they arrive, so it never falls back to
 * reading text.
 */
export function VisionCommand(props: { command: CommandName }): React.JSX.Element {
  const p = PROMPTS[props.command];
  if (!p) throw new Error(`Missing prompt definition for ${props.command}`);

  const [images, setImages] = React.useState<ChatImage[] | undefined>();
  const [problem, setProblem] = React.useState<string | undefined>();

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await getCommandImages();
        if (!cancelled) setImages(found);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setProblem(message);
        await showToast({ style: Toast.Style.Failure, title: "No image to read", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.command]);

  if (problem) return <Detail markdown={`## No image to read\n\n${problem}`} />;
  if (!images) return <Detail isLoading markdown="" />;

  return <AnswerView command={props.command} prompt={p.template} creativity={p.creativity} images={images} />;
}
