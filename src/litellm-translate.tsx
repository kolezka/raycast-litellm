import { LaunchProps } from "@raycast/api";
import { AnswerView } from "./lib/ui/AnswerView/main";
import { CommandName } from "./lib/enums";
import { PROMPTS } from "./lib/prompts";
import { fillLanguages } from "./lib/translate";

interface TranslateArguments {
  source: string;
  target: string;
}

/**
 * The ported prompt names both languages, which upstream supplied through
 * Raycast command arguments. They are substituted here rather than in
 * `fillPlaceholders`, which is shared by every command and has no business
 * knowing about translation.
 */
export default function Command(props: LaunchProps<{ arguments: TranslateArguments }>): React.JSX.Element {
  const p = PROMPTS[CommandName.TRANSLATE];
  if (!p) throw new Error("Missing prompt definition for translate");

  const prompt = fillLanguages(p.template, props.arguments);

  return <AnswerView command={CommandName.TRANSLATE} prompt={prompt} creativity={p.creativity} />;
}
