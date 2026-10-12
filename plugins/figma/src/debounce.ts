export interface Debounced {
  (): void;
  cancel(): void;
}

// Selection changes arrive in bursts while someone drags or shift-clicks. Waiting for a quiet
// moment means the page is scanned once per burst instead of once per event.
export function debounce(run: () => void, waitMs: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const debounced = (() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      run();
    }, waitMs);
  }) as Debounced;

  debounced.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  return debounced;
}
