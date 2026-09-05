import { List } from "@raycast/api";
import { ChatModel } from "../litellm/types";

export function ModelDropdown(props: {
  models: ChatModel[];
  value: string;
  onChange: (model: string) => void;
}): React.JSX.Element {
  return (
    <List.Dropdown tooltip="Model" value={props.value} onChange={props.onChange}>
      {props.models.map((m) => (
        <List.Dropdown.Item key={m.id} title={m.id} value={m.id} />
      ))}
    </List.Dropdown>
  );
}
