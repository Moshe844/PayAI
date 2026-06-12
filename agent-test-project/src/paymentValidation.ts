import { validate as validateUuid } from "uuid";

type PaymentRequest = {
  orderId: string;
  amountCents: number;
  currency: string;
};

export function validatePaymentRequest(input: unknown) {
  const request = input as PaymentRequest;

  if (!validateUuid(request.orderId)) {
    throw new Error("Payment request orderId must be a UUID.");
  }

  if (!Number.isInteger(request.amountCents) || request.amountCents <= 0) {
    throw new Error("Payment amount must be a positive integer in cents.");
  }

  if (!/^[A-Z]{3}$/.test(request.currency)) {
    throw new Error("Currency must be a 3-letter ISO code.");
  }

  return request;
}
