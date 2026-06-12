/* eslint-disable @typescript-eslint/no-require-imports */
const { createVendorBridge } = require("./vendor-bridge-runtime.cjs");

exports.runAction = createVendorBridge({
  id: "idtech",
  vendor: "ID TECH",
});
