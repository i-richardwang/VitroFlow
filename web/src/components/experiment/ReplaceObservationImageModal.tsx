import { Button, Form, Modal, toast } from "@heroui/react";
import { useRouter } from "@tanstack/react-router";

import type { ExperimentObservationImage } from "../../experiments/contracts";
import { assignImagesToObservation } from "../../functions/experiments";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { m } from "../../paraglide/messages";
import { ImageDropZone } from "../ImageDropZone";
import { useUploads } from "./uploads";

export function ReplaceObservationImageModal({
  image,
  isOpen,
  onClose,
}: {
  image: ExperimentObservationImage;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const uploads = useUploads();
  const { busy, run } = useAsyncAction();
  const ready = uploads.images.flatMap((item) => {
    if (item.state.status !== "stored") return [];
    return [
      {
        unit: image.unit.id,
        digest: item.state.digest,
        filename: item.file.name,
      },
    ];
  });

  return (
    <Modal isOpen={isOpen} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={m.close()} />
            <Modal.Header>
              <Modal.Heading>
                {m.unit_replace_heading({
                  file: image.review.filename,
                })}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Form
                id="replace-image"
                className="flex w-full min-w-0 flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const [replacement] = ready;
                  if (!replacement) return;
                  void run(
                    () =>
                      assignImagesToObservation({
                        data: {
                          experiment: image.ref.experiment,
                          observation: image.observation.id,
                          images: [replacement],
                        },
                      }),
                    m.unit_image_not_replaced(),
                  ).then(async (result) => {
                    if (!result.ok) return;
                    toast.success(m.unit_image_replaced());
                    onClose();
                    await router.invalidate();
                  });
                }}
              >
                <ImageDropZone
                  images={uploads.images}
                  onAdd={uploads.add}
                  onRemove={uploads.remove}
                  busy={busy}
                  multiple={false}
                />
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={busy} onPress={onClose}>
                {m.cancel()}
              </Button>
              <Button
                type="submit"
                form="replace-image"
                variant="primary"
                isDisabled={busy || uploads.storing || ready.length === 0}
              >
                {busy
                  ? m.unit_replacing()
                  : uploads.storing
                    ? m.observation_images_uploading()
                    : m.unit_replace()}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
