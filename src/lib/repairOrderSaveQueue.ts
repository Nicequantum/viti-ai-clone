/**
 * H2: Serializes repair-order PUTs so flush + immediate save cannot race.
 */

let saveChain: Promise<unknown> = Promise.resolve();

export function enqueueRepairOrderSave<T>(task: () => Promise<T>): Promise<T> {
  const next = saveChain.then(task, task);
  saveChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export async function awaitRepairOrderSaveQueue(): Promise<void> {
  await saveChain;
}