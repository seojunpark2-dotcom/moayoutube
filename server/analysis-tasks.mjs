export function createAnalysisTasks({
  extract,
  metadata,
  key = (id) => id,
  now = Date.now,
}) {
  const entries = new Map();
  return {
    get(id, options) {
      const name = key(id, options);
      for (const [k, value] of entries)
        if (value.expires <= now()) entries.delete(k);
      if (entries.has(name)) return entries.get(name);
      if (entries.size >= 40) entries.delete(entries.keys().next().value);
      const task = {
        state: "pending",
        expires: now() + 300000,
        result: null,
        error: null,
        metadata: null,
      };
      entries.set(name, task);
      task.metadataPromise = Promise.resolve()
        .then(() => metadata(id))
        .then(
          (data) => (task.metadata = data),
          () => null,
        );
      task.promise = Promise.resolve()
        .then(() => extract(id, options))
        .then(
          (result) => {
            task.result = result;
            task.state = "ready";
            return result;
          },
          (error) => {
            task.error = error;
            task.state = "error";
            task.expires = now() + 15000;
            return null;
          },
        );
      return task;
    },
  };
}
