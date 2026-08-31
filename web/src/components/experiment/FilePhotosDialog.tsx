import {
  Alert,
  Button,
  Description,
  Fieldset,
  Form,
  Label,
  ListBox,
  Modal,
  Select,
  toast,
} from "@heroui/react";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import type { ExperimentDish } from "../../experiments/contracts";
import { suggestDish } from "../../experiments/naming";
import {
  observationLabel,
  type ExperimentObservation,
} from "../../experiments/schema";
import { filePhotographs } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { ImageDropZone, type ListedImage } from "../ImageDropZone";
import { useUploads } from "./uploads";

const UNFILED = "unfiled";

export function FilePhotosDialog({
  experiment,
  observation,
  dishes,
  photographed,
  onClose,
}: {
  experiment: string;
  observation: ExperimentObservation;
  dishes: ExperimentDish[];
  photographed: ReadonlySet<string>;
  onClose: () => void;
}) {
  const router = useRouter();
  const uploads = useUploads();
  const { busy, run } = useAsyncAction();
  const [filing, setFiling] = useState<Record<number, string | null>>({});
  const suggested = useRef(new Set<number>());

  const open = dishes.filter((dish) => !photographed.has(dish.id));
  const openDishes = useRef(open);
  openDishes.current = open;

  /** Each file is guessed once, when it arrives; a choice made is never undone. */
  const { images } = uploads;
  useEffect(() => {
    const arrived = images.filter((image) => !suggested.current.has(image.id));
    if (arrived.length === 0) return;
    for (const image of arrived) suggested.current.add(image.id);
    setFiling((current) => {
      const claimed = new Set(
        Object.values(current).filter((dish): dish is string => dish !== null),
      );
      const next = { ...current };
      for (const image of arrived) {
        const label = suggestDish(
          image.file.name,
          openDishes.current.map((dish) => dish.label),
        );
        const dish = openDishes.current.find((item) => item.label === label);
        if (!dish || claimed.has(dish.id)) continue;
        claimed.add(dish.id);
        next[image.id] = dish.id;
      }
      return next;
    });
  }, [images]);

  const ready = uploads.images.flatMap((image) => {
    if (image.state.status !== "stored") return [];
    const dish = filing[image.id];
    if (!dish) return [];
    return [{ dish, digest: image.state.digest, filename: image.file.name }];
  });
  const stored = uploads.images.filter(
    (image) => image.state.status === "stored",
  );
  const unfiled = stored.length - ready.length;

  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                Photograph {observationLabel(observation)}
              </Modal.Heading>
              <Description>
                Drop the photographs of {observation.observedOn} and check which
                dish each one shows. Filenames are only a guess.
              </Description>
            </Modal.Header>
            <Modal.Body>
              {open.length === 0 ? (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Every dish is photographed</Alert.Title>
                    <Alert.Description>
                      Remove a photograph from {observationLabel(observation)}
                      before filing another.
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : (
                <Form
                  className="w-full"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(
                      () =>
                        filePhotographs({
                          data: {
                            experiment,
                            observation: observation.id,
                            photos: ready,
                          },
                        }),
                      "Nothing was filed",
                    ).then(async (result) => {
                      if (!result.ok) return;
                      uploads.clearStored();
                      setFiling({});
                      toast.success(
                        `${result.value.photos} filed under ${observationLabel(observation)}`,
                      );
                      await router.invalidate();
                      if (!uploads.failed) onClose();
                    });
                  }}
                >
                  <Fieldset className="w-full">
                    <ImageDropZone
                      images={uploads.images}
                      onAdd={uploads.add}
                      onRemove={(id) => {
                        uploads.remove(id);
                        setFiling(({ [id]: _removed, ...rest }) => rest);
                      }}
                      busy={busy}
                      annotate={(image) => (
                        <DishChoice
                          image={image}
                          dishes={open}
                          taken={
                            new Set(
                              Object.entries(filing)
                                .filter(
                                  ([id, dish]) =>
                                    dish !== null && Number(id) !== image.id,
                                )
                                .map(([, dish]) => dish!),
                            )
                          }
                          value={filing[image.id] ?? null}
                          busy={busy}
                          onChange={(dish) =>
                            setFiling((current) => ({
                              ...current,
                              [image.id]: dish,
                            }))
                          }
                        />
                      )}
                    />
                    <Fieldset.Actions>
                      {unfiled > 0 ? (
                        <span className="me-auto text-sm text-warning">
                          {unfiled === 1
                            ? "Assign the remaining photograph before filing"
                            : `Assign the remaining ${unfiled} photographs before filing`}
                        </span>
                      ) : null}
                      <Button variant="tertiary" onPress={onClose}>
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        variant="primary"
                        isDisabled={
                          busy ||
                          uploads.storing ||
                          ready.length === 0 ||
                          unfiled > 0
                        }
                      >
                        {busy
                          ? "Filing…"
                          : uploads.storing
                            ? "Uploading…"
                            : `File ${ready.length}`}
                      </Button>
                    </Fieldset.Actions>
                  </Fieldset>
                </Form>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function DishChoice({
  image,
  dishes,
  taken,
  value,
  busy,
  onChange,
}: {
  image: ListedImage;
  dishes: ExperimentDish[];
  taken: ReadonlySet<string>;
  value: string | null;
  busy: boolean;
  onChange: (dish: string | null) => void;
}) {
  if (image.state.status !== "stored") return null;
  return (
    <Select
      aria-label={`Dish shown by ${image.file.name}`}
      className="w-40 shrink-0"
      variant="secondary"
      isDisabled={busy}
      disabledKeys={[...taken]}
      selectedKey={value ?? UNFILED}
      onSelectionChange={(key) =>
        onChange(key === UNFILED ? null : String(key))
      }
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id={UNFILED} textValue="No dish">
            <Label className="text-muted">No dish</Label>
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {dishes.map((dish) => (
            <ListBox.Item key={dish.id} id={dish.id} textValue={dish.label}>
              <Label>{dish.label}</Label>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
