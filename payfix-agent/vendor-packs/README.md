# PayFix Device Vendor Packs

Vendor packs are PC-side local adapters that wrap an approved terminal SDK or processor-specific protocol.

They are not firmware files installed on the terminal. A reader can have the correct device files, firmware,
and drivers, while PayFix still needs one of these bridge files on the computer so it knows how to call the
vendor SDK command that starts a tap/swipe/insert/sale flow.

PayFix does not fake SDK commands. If a terminal requires vendor commands to prompt tap/swipe/insert, add the
PC-side bridge adapter here:

```txt
payfix-agent/vendor-packs/idtech.cjs
payfix-agent/vendor-packs/verifone.cjs
payfix-agent/vendor-packs/ingenico.cjs
payfix-agent/vendor-packs/pax.cjs
payfix-agent/vendor-packs/dejavoo.cjs
```

Each adapter must export:

```js
exports.runAction = async function runAction(payload) {
  return {
    ok: true,
    message: "Action completed",
    diagnostics: [],
  };
};
```

`payload` includes:

- `actionId`: action selected in Device Lab, such as `start-sale` or `start-card-read`
- `params`: UI-supplied values, such as amount, timeout, terminal id, or vendor config
- `connection`: connection hints, such as COM port, baud rate, host, or port
- `captureSession`: optional current capture session metadata
- `helpers.note`: PCI safety reminder

Adapters must never return full PAN, CVV, or unredacted track data.

## ID TECH bridge

`idtech.cjs` is a configurable bridge instead of a dead template. Copy:

```txt
idtech.config.example.json
```

to:

```txt
idtech.config.json
```

Then choose one wiring mode:

- SDK mode: set `sdkModule` to a local approved ID TECH SDK wrapper and map `sdkMethods`.
- Protocol mode: add exact vendor-approved command bytes under `commands[start-card-read].hex`.

Device Lab passes the selected connection into the bridge. It is not locked to COM1:

```js
{ mode: "serial", path: "COM1", baudRate: 9600 }
{ mode: "serial", path: "COM7", baudRate: 115200 }
{ mode: "tcp", host: "192.168.1.50", port: 10009 }
```

If the terminal is in keyboard-wedge mode, use Device Lab's keyboard-wedge capture instead of SDK command packs.
