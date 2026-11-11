/** Unknown/unhydrated sessions stay protected. Both Google and code admins use the verified role. */
export function captureProtectionRequired(role: unknown, hydrated: unknown) {
  return !(hydrated === true && role === 'admin');
}

/** Native calls cannot be cancelled. Serialize them so an old allow never wins over a newer protect. */
export function createProtectionQueue(api: {
  prevent(): Promise<void>; allow(): Promise<void>;
  enableSwitcher(): Promise<void>; disableSwitcher(): Promise<void>;
}) {
  let tail: Promise<void> = Promise.resolve();
  const enqueue = (operation: () => Promise<void>) => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
  return {
    capture: (required: boolean) => enqueue(() => required ? api.prevent() : api.allow()),
    switcher: (enabled: boolean) => enqueue(() => enabled ? api.enableSwitcher() : api.disableSwitcher()),
  };
}
