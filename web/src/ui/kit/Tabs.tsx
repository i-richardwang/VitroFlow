import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";

/*
 * A row of tabs over a hairline, the selected one in the primary color with
 * a 2px bar under it that slides to the next selection. It only switches: the
 * caller renders the part `activeKey` names. The bar is placed on the server
 * already, so the first frame does not slide it in from the start.
 */

interface TabsItem<Key extends string> {
  key: Key;
  label: ReactNode;
}

interface TabsProps<Key extends string> {
  activeKey: Key;
  items: TabsItem<Key>[];
  onChange: (key: Key) => void;
}

export function Tabs<Key extends string>({
  activeKey,
  items,
  onChange,
}: TabsProps<Key>) {
  return (
    <BaseTabs.Root
      className="ui-tabs"
      value={activeKey}
      onValueChange={(next: Key | null) => {
        if (next != null) onChange(next);
      }}
    >
      <BaseTabs.List className="ui-tabs-list">
        <BaseTabs.Indicator
          renderBeforeHydration
          className="ui-tabs-indicator"
        />
        {items.map((item) => (
          <BaseTabs.Tab key={item.key} className="ui-tabs-tab" value={item.key}>
            {item.label}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
    </BaseTabs.Root>
  );
}
