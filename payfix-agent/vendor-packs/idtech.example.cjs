exports.runAction = async function runAction(payload) {
  throw new Error(
    [
      "ID TECH adapter is not configured.",
      "Install/wrap your approved ID TECH SDK here and rename this file to idtech.cjs.",
      `Requested action: ${payload.actionId}`,
    ].join(" ")
  );
};
