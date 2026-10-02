export interface Logger {
  silent: boolean;
  chapter(title: string): void;
  step(title: string, fn: () => Promise<void> | void): Promise<void>;
  info(message: string): void;
  detail(label: string, value: string): void;
  decision(label: string, reason: string): void;
}

export function createLogger(options: { silent?: boolean } = {}): Logger {
  const silent = options.silent ?? false;
  const write = (line = ''): void => {
    if (!silent) process.stdout.write(`${line}\n`);
  };
  let index = 0;

  return {
    silent,
    chapter(title) {
      index += 1;
      write(`\n=== ${index}. ${title} ===`);
    },
    async step(title, fn) {
      write(`\n-- ${title}`);
      await fn();
    },
    info(message) {
      write(`   ${message}`);
    },
    detail(label, value) {
      write(`   ${label.padEnd(28)} ${value}`);
    },
    decision(label, reason) {
      write(`   DECISION ${label}: ${reason}`);
    },
  };
}
