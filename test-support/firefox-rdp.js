import net from "node:net";


/*
 * A small client for the Firefox Remote Debugging Protocol, which
 * Firefox for Android serves on its debugger socket: JSON packets,
 * each prefixed with its byte length and a colon.
 *
 * Replies carry no "type" and come back in request order for each
 * actor; packets with a "type" are events.
 */
export class RemoteFirefox {
  #socket;
  #buffer = Buffer.alloc(0);
  #pending = new Map();
  #listeners = new Set();
  #closed = null;


  static async connect(port, host = "127.0.0.1") {
    const client = new RemoteFirefox();

    client.#socket = net.connect(port, host);

    const hello = client.waitFor((packet) => packet.from === "root");

    await new Promise((resolve, reject) => {
      client.#socket.once("connect", resolve);
      client.#socket.once("error", reject);
    });

    client.#socket.on("data", (data) => client.#receive(data));

    client.#socket.on("close", () => {
      client.#closed ??= new Error("The debugger connection closed.");

      for (const queue of client.#pending.values()) {
        for (const { reject } of queue) {
          reject(client.#closed);
        }
      }

      client.#pending.clear();
    });

    client.#socket.on("error", (error) => {
      client.#closed = error;
    });

    await withTimeout(hello, 10000, "No greeting from Firefox");

    return client;
  }


  #receive(data) {
    this.#buffer = Buffer.concat([this.#buffer, data]);

    for (;;) {
      const colon = this.#buffer.indexOf(":");

      if (colon < 0) {
        return;
      }

      const length = Number(this.#buffer.subarray(0, colon));
      const end = colon + 1 + length;

      if (this.#buffer.length < end) {
        return;
      }

      const packet = JSON.parse(this.#buffer.subarray(colon + 1, end));

      this.#buffer = this.#buffer.subarray(end);

      this.#dispatch(packet);
    }
  }


  #dispatch(packet) {
    const queue = this.#pending.get(packet.from);

    if (!packet.type && queue?.length) {
      const { resolve, reject, type } = queue.shift();

      if (packet.error) {
        reject(new Error(`${type} to ${packet.from}: ${packet.error} ${packet.message ?? ""}`));
      } else {
        resolve(packet);
      }

      return;
    }

    for (const listener of [...this.#listeners]) {
      listener(packet);
    }
  }


  request(to, type, fields = {}) {
    if (this.#closed) {
      return Promise.reject(this.#closed);
    }

    return new Promise((resolve, reject) => {
      const queue = this.#pending.get(to) ?? [];

      queue.push({ resolve, reject, type });
      this.#pending.set(to, queue);

      const text = JSON.stringify({ to, type, ...fields });

      this.#socket.write(`${Buffer.byteLength(text)}:${text}`);
    });
  }


  // Calls listener with every event; the returned function stops it.
  onEvent(listener) {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  }


  waitFor(match, timeout = 30000) {
    let remove;

    const found = new Promise((resolve) => {
      remove = this.onEvent((packet) => {
        if (match(packet)) {
          remove();
          resolve(packet);
        }
      });
    });

    return withTimeout(found, timeout, "Timed out waiting for Firefox")
      .finally(remove);
  }


  /*
   * Runs an async function body in a console actor's global and
   * returns its JSON result. Errors it throws are rethrown here; the
   * console reports a rejected await only as a flag, so the body's
   * errors are caught in the page and sent back as data.
   */
  async evaluate(consoleActor, body) {
    const text = `(async () => {
      try {
        return JSON.stringify({ value: await (async () => {\n${body}\n})() });
      } catch (error) {
        return JSON.stringify({ error: String(error?.stack ? \`\${error}\\n\${error.stack}\` : error) });
      }
    })()`;

    let resultID;
    const early = [];

    const stop = this.onEvent((packet) => {
      if (packet.from === consoleActor && packet.type === "evaluationResult") {
        early.push(packet);
      }
    });

    let packet;

    try {
      ({ resultID } = await this.request(consoleActor, "evaluateJSAsync", {
        text,
        mapped: { await: true }
      }));

      packet = early.find((event) => event.resultID === resultID) ??
        await this.waitFor((event) => {
          return event.from === consoleActor &&
            event.type === "evaluationResult" &&
            event.resultID === resultID;
        }, 60000);
    } finally {
      stop();
    }

    if (packet.exceptionMessage || packet.exception || packet.topLevelAwaitRejected) {
      throw new Error(packet.exceptionMessage ?? "The evaluation failed.");
    }

    const { value, error } = JSON.parse(await this.#text(packet.result));

    if (error) {
      throw new Error(error);
    }

    return value;
  }


  async #text(grip) {
    if (grip?.type === "longString") {
      const { substring } = await this.request(grip.actor, "substring", {
        start: 0,
        end: grip.length
      });

      return substring;
    }

    return grip;
  }


  close() {
    this.#closed ??= new Error("The debugger connection was closed.");
    this.#socket?.destroy();
  }
}


export function withTimeout(promise, ms, message) {
  let timer;

  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${message} after ${ms} ms.`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}
