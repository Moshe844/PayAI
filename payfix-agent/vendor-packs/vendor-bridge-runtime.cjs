/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const net = require("net");

function redact(value) {
  return String(value || "")
    .replace(/(%B)(\d{6})\d{3,9}(\d{4}\^)/g, "$1$2******$3")
    .replace(/(;)(\d{6})\d{3,9}(\d{4}=)/g, "$1$2******$3")
    .replace(/\b(\d{6})\d{3,9}(\d{4})\b/g, "$1******$2");
}

function readConfig(configPath) {
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function normalizeConnection(connection) {
  if (!connection || typeof connection !== "object") {
    throw new Error("Missing connection. Select COM Serial or TCP/IP in Device Lab before running the vendor action.");
  }

  if (connection.mode === "serial") {
    if (!connection.path) throw new Error("Missing serial COM port. Enter COM1, COM3, COM7, etc.");
    return {
      mode: "serial",
      path: String(connection.path),
      baudRate: Number(connection.baudRate || 9600),
    };
  }

  if (connection.mode === "tcp") {
    if (!connection.host) throw new Error("Missing TCP/IP host.");
    return {
      mode: "tcp",
      host: String(connection.host),
      port: Number(connection.port || 10009),
    };
  }

  throw new Error(`Unsupported connection mode: ${connection.mode}`);
}

function toBuffer(command) {
  if (!command) throw new Error("Missing command.");
  if (command.hex) return Buffer.from(String(command.hex).replace(/\s+/g, ""), "hex");
  if (command.text) return Buffer.from(String(command.text), command.encoding || "utf8");
  throw new Error("Command must define hex or text.");
}

function waitForSerialResponse(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => {
      cleanup();
      resolve(Buffer.concat(chunks));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      port.off("data", onData);
      port.off("error", onError);
    }

    function onData(chunk) {
      chunks.push(Buffer.from(chunk));
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    port.on("data", onData);
    port.on("error", onError);
  });
}

async function runProtocolCommand(connection, command, timeoutMs) {
  const payload = toBuffer(command);

  if (connection.mode === "serial") {
    const { SerialPort } = require("serialport");
    const port = new SerialPort({
      path: connection.path,
      baudRate: connection.baudRate,
      autoOpen: false,
    });

    await new Promise((resolve, reject) => port.open((error) => (error ? reject(error) : resolve())));
    await new Promise((resolve, reject) => port.write(payload, (error) => (error ? reject(error) : resolve())));
    await new Promise((resolve, reject) => port.drain((error) => (error ? reject(error) : resolve())));
    const response = await waitForSerialResponse(port, timeoutMs);
    await new Promise((resolve) => port.close(() => resolve()));

    return {
      transport: "serial",
      connection: `${connection.path} @ ${connection.baudRate}`,
      sentHex: payload.toString("hex").toUpperCase(),
      responseHex: response.toString("hex").toUpperCase(),
      responseText: redact(response.toString("utf8")),
    };
  }

  const response = await new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.createConnection({ host: connection.host, port: connection.port }, () => {
      socket.write(payload);
    });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(Buffer.concat(chunks));
    }, timeoutMs);

    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
  });

  return {
    transport: "tcp",
    connection: `${connection.host}:${connection.port}`,
    sentHex: payload.toString("hex").toUpperCase(),
    responseHex: response.toString("hex").toUpperCase(),
    responseText: redact(response.toString("utf8")),
  };
}

async function runSdkAction(config, payload, connection) {
  if (!config.sdkModule) return null;

  const sdkPath = path.isAbsolute(config.sdkModule)
    ? config.sdkModule
    : path.resolve(process.cwd(), config.sdkModule);
  const sdk = require(sdkPath);
  const methods = config.sdkMethods || {};
  const methodName = methods[payload.actionId] || payload.actionId;
  const target = sdk.default || sdk;
  const fn = target[methodName] || target.runAction;

  if (typeof fn !== "function") {
    throw new Error(`Configured SDK module does not export ${methodName} or runAction.`);
  }

  return fn({
    ...payload,
    connection,
    params: payload.params || {},
    safety: {
      redactPanAndTrack: true,
      neverReturnCvv: true,
    },
  });
}

function createVendorBridge(options) {
  const configPath = path.join(__dirname, `${options.id}.config.json`);

  return async function runAction(payload) {
    const config = readConfig(configPath);
    const connection = normalizeConnection(payload.connection);
    const timeoutMs = Number((payload.params && payload.params.timeoutMs) || config.timeoutMs || 10000);

    const sdkResult = await runSdkAction(config, payload, connection);
    if (sdkResult) {
      return {
        ok: true,
        mode: "sdk",
        vendor: options.vendor,
        actionId: payload.actionId,
        connection,
        result: sdkResult,
      };
    }

    const command = config.commands && config.commands[payload.actionId];
    if (command && (command.hex || command.text)) {
      const result = await runProtocolCommand(connection, command, timeoutMs);
      return {
        ok: true,
        mode: "protocol",
        vendor: options.vendor,
        actionId: payload.actionId,
        result,
      };
    }

    return {
      ok: false,
      vendor: options.vendor,
      actionId: payload.actionId,
      connection,
      message: `${options.vendor} bridge is installed, but no SDK module or protocol command is configured for this action yet.`,
      nextSteps: [
        `Create ${configPath}.`,
        `For SDK mode, set sdkModule to your approved local ${options.vendor} SDK wrapper and map sdkMethods.`,
        "For protocol mode, add exact vendor-approved command bytes under commands[actionId].hex or .text.",
        "Use any COM port by selecting/typing it in Device Lab; PayFix passes it through as connection.path.",
      ],
    };
  };
}

module.exports = {
  createVendorBridge,
};
