export class DeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeadlineError";
  }
}

export function settleWithin<T>(promise: Promise<T>, milliseconds: number, message: string, onDeadline?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { onDeadline?.(); } catch { /* cleanup must not replace the deadline error */ }
      reject(new DeadlineError(message));
    }, milliseconds);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function runResourceWithinDeadline<TResource, TResult>({
  open,
  use,
  close,
  milliseconds,
  message,
  onDeadline,
}: {
  open: () => Promise<TResource>;
  use: (resource: TResource) => Promise<TResult>;
  close: (resource: TResource) => void;
  milliseconds: number;
  message: string;
  onDeadline?: (resource: TResource | undefined) => void;
}) {
  let resource: TResource | undefined;
  let closed = false;
  let deadlineReached = false;
  const closeOnce = () => {
    if (typeof resource === "undefined" || closed) return;
    closed = true;
    try { close(resource); } catch { /* the primary result remains authoritative */ }
  };
  const operation = (async () => {
    const opened = await open();
    resource = opened;
    if (deadlineReached) {
      closeOnce();
      throw new DeadlineError(message);
    }
    return use(opened);
  })();

  try {
    return await settleWithin(operation, milliseconds, message, () => {
      deadlineReached = true;
      try { onDeadline?.(resource); } finally { closeOnce(); }
    });
  } finally {
    closeOnce();
  }
}
